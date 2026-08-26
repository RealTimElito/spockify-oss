"""Ghost Tab v2 — native FIM backends, prompt builders, suppression heuristics.

Backends (env GHOST_FIM_BACKEND, default "ollama"):
  - "vllm":   OpenAI-compatible /v1/completions against GHOST_VLLM_BASE_URL with
              model-specific FIM sentinel tokens (starcoder2 / codegemma / codestral).
  - "ollama": Ollama native infill via POST /api/generate with prompt+suffix —
              Ollama applies the model's own FIM template (codestral on cluster).
  - "chat":   legacy chat-prompted pseudo-FIM (gpt-oss) — last-resort fallback.

Failures cascade vllm -> ollama -> chat. The chat call itself lives in
ghost_writer (it needs the router's worker_chat plumbing).

Also home to the server-side suppression heuristics from Cursor's enum:
duplicate-of-suffix, revert-of-recent-deletion, and recently-rejected
(in-memory LRU fed by /spockify/ghost/fate events).
"""

from __future__ import annotations

import logging
import time
import os
import threading
from collections import OrderedDict
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.ghost.fim")

OLLAMA_URL = os.getenv(
    "OLLAMA_URL", "http://ollama.spockify.svc.cluster.local:11434"
).rstrip("/")

GHOST_FIM_BACKEND = os.getenv("GHOST_FIM_BACKEND", "ollama").strip().lower()
GHOST_VLLM_BASE_URL = os.getenv("GHOST_VLLM_BASE_URL", "").strip().rstrip("/")
GHOST_VLLM_MODEL = os.getenv("GHOST_VLLM_MODEL", "").strip()
GHOST_VLLM_API_KEY = os.getenv("GHOST_VLLM_API_KEY", "").strip()
# Per-workspace LoRA selection (see docs/TAB_TRAINING.md).
GHOST_VLLM_SEED_ADAPTER = os.getenv("GHOST_VLLM_SEED_ADAPTER", "tab-seed").strip()
GHOST_VLLM_WORKSPACE_LORA = os.getenv("GHOST_VLLM_WORKSPACE_LORA", "1").strip().lower() not in (
    "0", "false", "no", "off",
)
_VLLM_MODELS_CACHE: dict[str, Any] = {"ts": 0.0, "ids": set()}
_VLLM_MODELS_TTL = float(os.getenv("GHOST_VLLM_MODELS_TTL", "30"))

# Raw Ollama tag (not a LiteLLM alias) — codestral:22b is pulled on the cluster and
# its Ollama template natively supports [SUFFIX]/[PREFIX] infill.
GHOST_OLLAMA_FIM_MODEL = os.getenv("GHOST_OLLAMA_FIM_MODEL", "codestral:22b").strip()
GHOST_FIM_MAX_TOKENS = int(os.getenv("GHOST_FIM_MAX_TOKENS", "64"))
GHOST_FIM_TEMPERATURE = float(os.getenv("GHOST_FIM_TEMPERATURE", "0.05"))
GHOST_FIM_TIMEOUT = float(os.getenv("GHOST_FIM_TIMEOUT", "30"))
# Keep the infill model resident between keystrokes (Ollama default is 5m).
GHOST_FIM_KEEP_ALIVE = os.getenv("GHOST_FIM_KEEP_ALIVE", "1h")

# Char budgets for context folded into the FIM prefix (per task spec).
GHOST_DIFF_HISTORY_CHARS = int(os.getenv("GHOST_DIFF_HISTORY_CHARS", "2000"))
GHOST_CONTEXT_ITEMS_CHARS = int(os.getenv("GHOST_CONTEXT_ITEMS_CHARS", "1500"))
GHOST_LINTER_CHARS = int(os.getenv("GHOST_LINTER_CHARS", "600"))


def workspace_adapter_name(workspace_id: str, *, hash_len: int = 12) -> str:
    """Deterministic LoRA name — keep in sync with services/tab-train/tab_train/names.py."""
    import hashlib

    wid = (workspace_id or "").strip()
    if not wid:
        return "tab-global"
    digest = hashlib.sha256(wid.encode("utf-8")).hexdigest()[:hash_len]
    return f"tab-{digest}"


async def _vllm_loaded_models() -> set[str]:
    """Cached GET /v1/models ids (LoRAs appear here once loaded)."""
    now = time.monotonic()
    cached = _VLLM_MODELS_CACHE
    if cached["ids"] and (now - float(cached["ts"])) < _VLLM_MODELS_TTL:
        return set(cached["ids"])  # type: ignore[arg-type]
    if not GHOST_VLLM_BASE_URL:
        return set()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GHOST_VLLM_BASE_URL}/v1/models",
                timeout=min(5.0, GHOST_FIM_TIMEOUT),
            )
            resp.raise_for_status()
            data = resp.json()
        ids = {m.get("id") for m in (data.get("data") or []) if m.get("id")}
        cached["ids"] = ids
        cached["ts"] = now
        return ids
    except Exception as exc:  # noqa: BLE001 - fail soft to base model
        LOG.debug("vllm models list failed: %s", exc)
        return set(cached["ids"] or set())  # type: ignore[arg-type]


async def resolve_vllm_model(workspace_id: Optional[str] = None) -> str:
    """Pick per-workspace LoRA when loaded; else seed adapter; else tab-fim."""
    base = GHOST_VLLM_MODEL or "tab-fim"
    if not GHOST_VLLM_WORKSPACE_LORA:
        return base
    loaded = await _vllm_loaded_models()
    if not loaded:
        return base
    wid = (workspace_id or "").strip()
    if wid:
        cand = workspace_adapter_name(wid)
        if cand in loaded:
            return cand
    seed = GHOST_VLLM_SEED_ADAPTER
    if seed and seed in loaded:
        return seed
    return base

# --- Protocol v2 request sub-models -----------------------------------------


class GhostDiffHistoryEntry(BaseModel):
    """Recent edits to one file, newest last."""

    file: str = ""
    diffs: list[str] = Field(default_factory=list)
    timestamps: list[int] = Field(default_factory=list)


class GhostContextItem(BaseModel):
    """Retrieval snippet (path + optional symbol + contents + score)."""

    path: str = ""
    symbol: Optional[str] = None
    contents: str = ""
    score: float = 0.0


class GhostLinterError(BaseModel):
    path: str = ""
    message: str = ""
    line: int = 0
    severity: str = ""


# --- FIM prompt builders ------------------------------------------------------

_FIM_STYLES: dict[str, dict[str, Any]] = {
    "starcoder": {
        "template": "<fim_prefix>{prefix}<fim_suffix>{suffix}<fim_middle>",
        "stop": ["<fim_prefix>", "<fim_suffix>", "<fim_middle>",
                 "<|endoftext|>", "<file_sep>"],
    },
    "codegemma": {
        "template": "<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>",
        "stop": ["<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>",
                 "<|file_separator|>"],
    },
    # Mistral raw FIM format (note the space after [PREFIX], matching the
    # official template): "[SUFFIX]{suffix}[PREFIX] {prefix}".
    "codestral": {
        "template": "[SUFFIX]{suffix}[PREFIX] {prefix}",
        "stop": ["[PREFIX]", "[SUFFIX]", "</s>"],
    },
}


def fim_style_for_model(model: str) -> str:
    """Pick sentinel style from the model name (starcoder2/codegemma/codestral)."""
    m = (model or "").lower()
    if "starcoder" in m:
        return "starcoder"
    if "codegemma" in m or "gemma" in m:
        return "codegemma"
    if "codestral" in m or "mistral" in m or "devstral" in m:
        return "codestral"
    # Most OSS FIM models understand the starcoder tokens; safest default.
    return "starcoder"


def build_fim_prompt(model: str, prefix: str, suffix: str) -> str:
    style = _FIM_STYLES[fim_style_for_model(model)]
    return style["template"].format(prefix=prefix, suffix=suffix)


def fim_stop_tokens(model: str) -> list[str]:
    return list(_FIM_STYLES[fim_style_for_model(model)]["stop"])


# Sentinels (and hallucinated closing variants) that FIM models sometimes emit
# mid-stream; completions are truncated at the first occurrence.
_FIM_ARTIFACTS = (
    "[PREFIX]", "[/PREFIX]", "[SUFFIX]", "[/SUFFIX]", "[MIDDLE]", "[/MIDDLE]",
    "<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<file_sep>",
    "<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", "<|file_separator|>",
    "<|endoftext|>", "</s>",
)


def strip_fim_artifacts(text: str) -> str:
    """Cut the completion at the first FIM sentinel artifact, if any."""
    cut = len(text)
    for token in _FIM_ARTIFACTS:
        idx = text.find(token)
        if idx != -1 and idx < cut:
            cut = idx
    return text[:cut]


# --- Context block (diff history / retrieval / linter) ------------------------

_LINE_COMMENT = {
    "python": "#", "py": "#", "shell": "#", "bash": "#", "sh": "#",
    "yaml": "#", "toml": "#", "ini": "#", "ruby": "#", "r": "#",
    "javascript": "//", "typescript": "//", "typescriptreact": "//",
    "javascriptreact": "//", "js": "//", "ts": "//", "tsx": "//", "jsx": "//",
    "c": "//", "cpp": "//", "java": "//", "kotlin": "//", "go": "//",
    "rust": "//", "php": "//", "scss": "//", "css": "//", "sql": "--",
}


def _comment(language: str) -> str:
    return _LINE_COMMENT.get((language or "").lower(), "//")


def _commented(text: str, marker: str) -> str:
    return "\n".join(f"{marker} {line}" if line.strip() else marker
                     for line in text.splitlines())


def commented_block(text: str, language: str) -> str:
    """Public helper: render free text as a line-commented block."""
    return _commented(text, _comment(language))


def _diff_history_text(entries: list[GhostDiffHistoryEntry], budget: int) -> str:
    """Newest-last diffs, trimmed from the oldest end to fit the budget."""
    chunks: list[str] = []
    for entry in entries:
        for diff in entry.diffs:
            if diff.strip():
                chunks.append(f"--- {entry.file}\n{diff.strip()}")
    out: list[str] = []
    used = 0
    for chunk in reversed(chunks):  # newest first while filling budget
        if used + len(chunk) > budget:
            break
        out.append(chunk)
        used += len(chunk) + 1
    return "\n".join(reversed(out))


def _context_items_text(items: list[GhostContextItem], budget: int) -> str:
    """Highest-score snippets first, within budget."""
    out: list[str] = []
    used = 0
    for item in sorted(items, key=lambda i: i.score, reverse=True):
        header = item.path + (f" :: {item.symbol}" if item.symbol else "")
        chunk = f"{header}\n{item.contents.strip()}"
        if used + len(chunk) > budget:
            remaining = budget - used
            if remaining > len(header) + 40:
                out.append(chunk[:remaining])
            break
        out.append(chunk)
        used += len(chunk) + 1
    return "\n".join(out)


def _linter_text(errors: list[GhostLinterError], budget: int) -> str:
    lines = [f"{e.path}:{e.line} [{e.severity}] {e.message}".strip()
             for e in errors]
    out: list[str] = []
    used = 0
    for line in lines:
        if used + len(line) > budget:
            break
        out.append(line)
        used += len(line) + 1
    return "\n".join(out)


def build_context_block(
    language: str,
    diff_history: list[GhostDiffHistoryEntry],
    context_items: list[GhostContextItem],
    linter_errors: list[GhostLinterError],
) -> str:
    """Commented context blocks placed before the FIM window (strict budgets)."""
    marker = _comment(language)
    sections: list[str] = []
    diffs = _diff_history_text(diff_history or [], GHOST_DIFF_HISTORY_CHARS)
    if diffs:
        sections.append(
            f"{marker} === recent edits (unified diff, newest last) ===\n"
            + _commented(diffs, marker)
        )
    ctx = _context_items_text(context_items or [], GHOST_CONTEXT_ITEMS_CHARS)
    if ctx:
        sections.append(
            f"{marker} === related code from the workspace ===\n"
            + _commented(ctx, marker)
        )
    lint = _linter_text(linter_errors or [], GHOST_LINTER_CHARS)
    if lint:
        sections.append(
            f"{marker} === current linter errors ===\n" + _commented(lint, marker)
        )
    return "\n".join(sections)


# --- Completion backends -------------------------------------------------------


def backend_chain() -> list[str]:
    """Ordered backends to try; configured one first, chat always last."""
    order = ["vllm", "ollama", "chat"]
    start = GHOST_FIM_BACKEND if GHOST_FIM_BACKEND in order else "ollama"
    chain = order[order.index(start):]
    if not GHOST_VLLM_BASE_URL and "vllm" in chain:
        chain.remove("vllm")
    return chain


async def complete_vllm(
    prefix: str,
    suffix: str,
    *,
    max_tokens: int = 0,
    temperature: Optional[float] = None,
    workspace_id: Optional[str] = None,
    model: Optional[str] = None,
) -> tuple[str, str]:
    """OpenAI-compatible completions with model-native FIM sentinels.

    When workspace_id is set and a matching LoRA is loaded in vLLM, that
    adapter name is used as the OpenAI `model` (see resolve_vllm_model).
    Returns (text, model). Raises on transport/HTTP errors.
    """
    if not GHOST_VLLM_BASE_URL:
        raise RuntimeError("GHOST_VLLM_BASE_URL not configured")
    model = model or await resolve_vllm_model(workspace_id)
    body = {
        "model": model,
        "prompt": build_fim_prompt(model, prefix, suffix),
        "max_tokens": max_tokens or GHOST_FIM_MAX_TOKENS,
        "temperature": GHOST_FIM_TEMPERATURE if temperature is None else temperature,
        "stop": fim_stop_tokens(model),
    }
    headers = {}
    if GHOST_VLLM_API_KEY:
        headers["Authorization"] = f"Bearer {GHOST_VLLM_API_KEY}"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{GHOST_VLLM_BASE_URL}/v1/completions",
            json=body,
            headers=headers,
            timeout=GHOST_FIM_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
    text = (data.get("choices") or [{}])[0].get("text") or ""
    return text, model


async def complete_ollama_infill(
    prefix: str,
    suffix: str,
    *,
    max_tokens: int = 0,
    temperature: Optional[float] = None,
) -> tuple[str, str]:
    """Ollama native infill: /api/generate with prompt+suffix.

    Ollama renders the model's own FIM template (codestral: [SUFFIX]/[PREFIX]).
    Returns (text, model). Raises on transport/HTTP errors.
    """
    model = GHOST_OLLAMA_FIM_MODEL
    body = {
        "model": model,
        "prompt": prefix,
        "suffix": suffix,
        "stream": False,
        "keep_alive": GHOST_FIM_KEEP_ALIVE,
        "options": {
            "num_predict": max_tokens or GHOST_FIM_MAX_TOKENS,
            "temperature": (
                GHOST_FIM_TEMPERATURE if temperature is None else temperature
            ),
            # Codestral over-generates past the fill; stop at sentinels.
            "stop": ["[PREFIX]", "[/PREFIX]", "[SUFFIX]", "[/SUFFIX]",
                     "[MIDDLE]", "[/MIDDLE]"],
        },
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/generate", json=body, timeout=GHOST_FIM_TIMEOUT
        )
        resp.raise_for_status()
        data = resp.json()
    return data.get("response") or "", model


# --- Suppression heuristics -----------------------------------------------------


def _norm_lines(text: str) -> list[str]:
    return [line.strip() for line in text.strip().splitlines() if line.strip()]


def duplicates_suffix(suggestion: str, suffix: str) -> bool:
    """True when the suggestion exactly duplicates the line(s) after the cursor."""
    sug = _norm_lines(suggestion)
    if not sug:
        return False
    after = [line.strip() for line in suffix.lstrip("\n").splitlines()]
    window = [line for line in after[: len(sug) + 4] if line][: len(sug)]
    return len(window) == len(sug) and sug == window


def reverts_deletion(
    suggestion: str, diff_history: list[GhostDiffHistoryEntry]
) -> bool:
    """True when every suggestion line matches text the user just deleted."""
    sug = _norm_lines(suggestion)
    if not sug:
        return False
    deleted: set[str] = set()
    for entry in diff_history or []:
        for diff in entry.diffs:
            for line in diff.splitlines():
                if line.startswith("-") and not line.startswith("---"):
                    stripped = line[1:].strip()
                    if stripped:
                        deleted.add(stripped)
    return bool(deleted) and all(line in deleted for line in sug)


class RejectedLru:
    """Small thread-safe LRU of recently rejected suggestions per file+line."""

    def __init__(self, maxsize: int = 512, per_key: int = 4) -> None:
        self._maxsize = maxsize
        self._per_key = per_key
        self._data: OrderedDict[tuple[str, str, int], list[str]] = OrderedDict()
        self._lock = threading.Lock()

    def add(self, workspace_id: str, rel_path: str, line: int, text: str) -> None:
        if not text:
            return
        key = (workspace_id or "", rel_path or "", int(line))
        with self._lock:
            texts = self._data.pop(key, [])
            texts = ([text] + [t for t in texts if t != text])[: self._per_key]
            self._data[key] = texts
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def contains(
        self, workspace_id: str, rel_path: str, line: int, text: str
    ) -> bool:
        key = (workspace_id or "", rel_path or "", int(line))
        with self._lock:
            return text in self._data.get(key, [])


REJECTED = RejectedLru()


class _RecentRequests:
    """request_id -> suppression key info, so fate events can feed REJECTED."""

    def __init__(self, maxsize: int = 2048) -> None:
        self._maxsize = maxsize
        self._data: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def remember(
        self,
        request_id: str,
        *,
        workspace_id: str,
        rel_path: str,
        line: int,
        suggestion: str,
    ) -> None:
        with self._lock:
            self._data.pop(request_id, None)
            self._data[request_id] = {
                "workspace_id": workspace_id,
                "rel_path": rel_path,
                "line": line,
                "suggestion": suggestion,
            }
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def get(self, request_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            return self._data.get(request_id)


RECENT_REQUESTS = _RecentRequests()


def note_fate(request_id: str, fate: str) -> None:
    """Feed the rejected-suggestions LRU from a fate event."""
    if fate != "rejected":
        return
    info = RECENT_REQUESTS.get(request_id)
    if info and info.get("suggestion"):
        REJECTED.add(
            info["workspace_id"], info["rel_path"], info["line"],
            info["suggestion"],
        )


def suppress_reason(
    suggestion: str,
    *,
    suffix: str,
    diff_history: list[GhostDiffHistoryEntry],
    workspace_id: str,
    rel_path: str,
    line: int,
) -> Optional[str]:
    """Cursor-style suppression checks; returns a reason or None to allow."""
    if not (suggestion or "").strip():
        return None
    if duplicates_suffix(suggestion, suffix):
        return "duplicates_suffix"
    if reverts_deletion(suggestion, diff_history):
        return "reverts_deletion"
    if REJECTED.contains(workspace_id, rel_path, line, suggestion):
        return "recently_rejected"
    return None
