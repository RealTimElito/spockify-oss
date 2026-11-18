"""Mid-thought SPAWN (phases A–D) — parent handoff → children → merge.

Locked decisions (Tim + perf/quality defaults):
1. Merge: same parent model, second pass with DONE digests (weights stay warm).
   Optional lighter synth only if memory_guard refuses parent reload — not default.
2. Caps: Spark max 3 concurrent children; compose/OSS max 2.
   Phase A/B: max 1 spawn round per user turn (two-pass / one segment break).
3. IDE: prefer router SSE ``spockify_agents`` for chat parity; keep
   ``spockify_create_agent_run`` for Agent tool-turns only (no double-orchestrate).
   CLI: optional status later; lab already has DONE digests.
4. Phase B: accept segmented think (don't wait on upstream Ollama in-think pause).

Heavy 4-role ensemble is unchanged — this path is High/Medium opportunistic spawn.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

import parallel_agents as pagents

LOG = logging.getLogger("spockify.router.midthought")

# Feature flag — off only for emergency. Compose/Spark both use this path.
MIDTHOUGHT_SPAWN_ENABLED = os.getenv(
    "MIDTHOUGHT_SPAWN_ENABLED", "1"
).lower() in ("1", "true", "yes", "on")

# Host profile: spark | compose | auto (auto ≈ Spark if ≥90Gi RAM else compose).
_HOST_PROFILE = (os.getenv("SPOCKIFY_HOST_PROFILE") or "auto").strip().lower()

_SPAWN_MAX_SPARK = int(os.getenv("MIDTHOUGHT_SPAWN_MAX_SPARK", "3"))
_SPAWN_MAX_COMPOSE = int(os.getenv("MIDTHOUGHT_SPAWN_MAX_COMPOSE", "2"))
# Explicit override wins over profile.
_SPAWN_MAX_OVERRIDE = os.getenv("MIDTHOUGHT_SPAWN_MAX", "").strip()

# One spawn round per user turn in A/B (no nested SPAWN from merge pass).
MIDTHOUGHT_MAX_ROUNDS = int(os.getenv("MIDTHOUGHT_SPAWN_MAX_ROUNDS", "1"))

# Reject spammy / empty SPAWN rows.
_MIN_PROMPT_CHARS = int(os.getenv("MIDTHOUGHT_SPAWN_MIN_PROMPT", "40"))
_MIN_NAME_CHARS = 1

# Accept SPAWN_CHILDREN:[...] or SPAWN:[...] (latter must be a JSON array).
_PARENT_SPAWN_RE = re.compile(
    r"(?:SPAWN_CHILDREN|SPAWN)\s*:\s*(\[[\s\S]*?\])",
    re.IGNORECASE,
)

# Modes that may SPAWN. Heavy stays the fixed ensemble.
_ELIGIBLE_MODES = frozenset({"medium", "high"})

_DEFAULT_CHILD_MODELS = [
    m.strip()
    for m in os.getenv(
        "MIDTHOUGHT_CHILD_MODELS",
        "gpt-oss-20b,gemma4-12b,gemma4-12b",
    ).split(",")
    if m.strip()
]


def host_profile() -> str:
    """Return ``spark`` or ``compose`` for cap selection (Phase C aware)."""
    if _HOST_PROFILE in ("spark", "compose", "oss"):
        return "compose" if _HOST_PROFILE == "oss" else _HOST_PROFILE
    # auto: Spark-class unified memory is ~120Gi; laptops are far smaller.
    try:
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    return "spark" if kb >= 90 * 1024 * 1024 else "compose"
    except (OSError, ValueError, IndexError):
        pass
    return "compose"


def spawn_cap() -> int:
    if _SPAWN_MAX_OVERRIDE:
        try:
            return max(1, min(8, int(_SPAWN_MAX_OVERRIDE)))
        except ValueError:
            pass
    profile = host_profile()
    if profile == "spark":
        return max(1, min(8, _SPAWN_MAX_SPARK))
    return max(1, min(8, _SPAWN_MAX_COMPOSE))


def spawn_enabled() -> bool:
    return MIDTHOUGHT_SPAWN_ENABLED


def spawn_eligible(
    thinking_mode: str,
    *,
    voice_mode: bool = False,
    trivial: bool = False,
    explicit_alias: bool = False,
    pipeline: bool = False,
) -> bool:
    """Whether this turn may honor a structured SPAWN (High / Medium/Auto)."""
    if not spawn_enabled():
        return False
    if voice_mode or trivial or explicit_alias or pipeline:
        return False
    mode = (thinking_mode or "").strip().lower()
    if mode == "light":
        mode = "low"
    return mode in _ELIGIBLE_MODES


def parent_spawn_hint(thinking_mode: str, *, max_children: Optional[int] = None) -> str:
    """System hint — High encourages SPAWN; Medium only when args are clear."""
    n = max_children if max_children is not None else spawn_cap()
    mode = (thinking_mode or "").strip().lower()
    if mode == "high":
        lead = (
            "When the user request has clearly separable parallel subtasks "
            "(independent research, compare options, verify distinct facts), "
            "you MAY spawn child workers. Prefer spawning when parallel work "
            "clearly improves answer quality; skip for simple Q&A."
        )
    else:
        lead = (
            "Only spawn child workers when subtasks are crystal-clear and "
            "prompts are concrete (≥1 sentence of standalone context each). "
            "If unsure, answer yourself — do not SPAWN."
        )
    return (
        f"{lead}\n"
        f"Max {n} children. Each needs a short name and a self-contained prompt "
        f"(≥{_MIN_PROMPT_CHARS} chars) with enough context to work alone — "
        "include the user goal fragment, constraints, and what 'done' looks like.\n"
        "Good prompts ask for FINDINGS + a short recommendation, not vague "
        "'research this'.\n"
        "If you spawn, end your reply with ONLY this marker (no prose after it):\n"
        'SPAWN_CHILDREN:[{"name":"…","prompt":"…"}]\n'
        "Do not invent SPAWN for greetings or single-step asks. "
        "If you need the user's private details or a choice only they can make, "
        'end with ASK_USER: ["question", …] instead of guessing.\n'
        "Child outputs return as DONE digests; you will merge them next."
    )


def _quality_ok(name: str, prompt: str) -> bool:
    if len(name.strip()) < _MIN_NAME_CHARS:
        return False
    if len(prompt.strip()) < _MIN_PROMPT_CHARS:
        return False
    # Reject placeholder spam.
    low = prompt.strip().lower()
    if low in ("todo", "tbd", "…", "...", "do it", "research this"):
        return False
    # Require at least a few tokens of substance (not one vague word).
    words = [w for w in re.split(r"\s+", prompt.strip()) if w]
    if len(words) < 6:
        return False
    return True


def parse_parent_spawn(
    text: str,
    *,
    max_children: Optional[int] = None,
) -> list[pagents.AgentWorkerSpec]:
    """Parse SPAWN / SPAWN_CHILDREN; keep only clear, high-quality args."""
    cap = max_children if max_children is not None else spawn_cap()
    match = _PARENT_SPAWN_RE.search(text or "")
    if not match:
        return []
    try:
        raw = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []
    if not isinstance(raw, list) or not raw:
        return []
    out: list[pagents.AgentWorkerSpec] = []
    models = _DEFAULT_CHILD_MODELS or [pagents.AGENTS_DEFAULT_MODEL]
    for i, item in enumerate(raw[:cap]):
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or "").strip()
        name = str(item.get("name") or f"Worker-{i + 1}").strip() or f"Worker-{i + 1}"
        if not _quality_ok(name, prompt):
            LOG.info("midthought skip weak SPAWN row name=%r prompt_len=%s", name, len(prompt))
            continue
        model_raw = item.get("model")
        model = pagents._resolve_worker_model(  # noqa: SLF001 — shared resolver
            model_raw if model_raw else models[i % len(models)]
        )
        # Never cloud tags.
        if ":cloud" in model.lower() or model.lower().endswith("-cloud"):
            model = models[i % len(models)]
        tools = item.get("tools")
        tool_list = None
        if isinstance(tools, list):
            tool_list = [str(t).strip().lower() for t in tools if str(t).strip()]
        out.append(
            pagents.AgentWorkerSpec(
                id=str(item.get("id") or f"spawn-{i + 1}").strip() or f"spawn-{i + 1}",
                name=name[:64],
                model=model,
                prompt=prompt,
                tools=tool_list,
                wave=1,
            )
        )
    return out


def spawn_args_clear(specs: list[pagents.AgentWorkerSpec]) -> bool:
    """True when structured SPAWN is worth launching (not spammy)."""
    if not specs:
        return False
    return all(_quality_ok(s.name or "", s.prompt or "") for s in specs)


def strip_spawn_marker(text: str) -> str:
    cleaned = _PARENT_SPAWN_RE.sub("", text or "")
    # Also strip legacy nested marker if parent used it.
    cleaned = pagents._strip_spawn_marker(cleaned)  # noqa: SLF001
    return cleaned.rstrip()


def spawn_marker_complete(text: str) -> bool:
    """True once a well-formed SPAWN JSON array is present (Phase B segment break)."""
    match = _PARENT_SPAWN_RE.search(text or "")
    if not match:
        return False
    try:
        raw = json.loads(match.group(1))
    except json.JSONDecodeError:
        return False
    return isinstance(raw, list)


def format_done_digests(run: dict[str, Any], *, max_chars: int = 6000) -> str:
    """Lab-shaped DONE digests for the parent merge pass (quality over brevity)."""
    parts: list[str] = []
    for w in run.get("workers") or []:
        name = str(w.get("name") or w.get("id") or "worker")
        status = str(w.get("status") or "unknown")
        output = str(w.get("output") or "").strip()
        err = str(w.get("error") or "").strip()
        if status == "done":
            body = output or "(empty)"
            header = f"DONE — {name}"
        elif status == "cancelled":
            body = output or err or "cancelled"
            header = f"CANCELLED — {name}"
        else:
            body = output or err or status
            header = f"FAILED — {name} ({status})"
        if len(body) > max_chars:
            body = body[: max_chars - 1] + "…"
        ask = pagents.extract_ask_user(output)
        ask_block = ""
        if ask:
            ask_block = "\nASK_USER:\n" + "\n".join(f"- {q}" for q in ask)
        # Surface a one-line outcome when the child used DONE — …
        outcome = ""
        m = re.search(
            r"(?im)^\s*(?:DONE|COMPLETED(?:\s+WORK)?)\s*[-—:]\s*(.+)$",
            body,
        )
        if m:
            outcome = m.group(1).strip()
        outcome_block = f"\nOUTCOME: {outcome}" if outcome else ""
        parts.append(
            f"### {header}{outcome_block}\n"
            f"FINDINGS:\n{body}"
            f"{ask_block}"
        )
    return "\n\n".join(parts) if parts else "(no worker output)"


def build_merge_messages(
    *,
    user_msg: str,
    parent_segment: str,
    digests: str,
    prior_messages: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Same-parent merge: careful prompt, preserve context for quality."""
    system = (
        "You are Spockify merging mid-thought child worker results.\n"
        "The digests below are COMPLETED WORK (status=DONE), not plans.\n"
        "READ and USE FINDINGS / OUTCOME substance. Do not re-ask workers to "
        "redo analysis already present. Do not invent facts they did not support.\n"
        "Write the final user-facing answer. Prefer clarity and correctness.\n"
        "Lead with the recommendation or answer; use worker findings as support.\n"
        "If any digest lists ASK_USER questions, include a clear "
        "'Need from you' section with those questions — do not bury them.\n"
        "Do not emit SPAWN_CHILDREN or SPAWN markers in this merge pass."
    )
    plan_note = strip_spawn_marker(parent_segment).strip()
    user = (
        f"Original user request:\n{user_msg}\n\n"
    )
    if plan_note:
        user += (
            "Your earlier plan / notes (before workers finished):\n"
            f"{plan_note[:8000]}\n\n"
        )
    user += (
        "COMPLETED WORK from child workers (DONE digests):\n\n"
        f"{digests}\n\n"
        "Merge into one coherent final answer for the user."
    )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    # Keep a short slice of prior thread for continuity (quality), drop system dups.
    if prior_messages:
        kept = 0
        for m in prior_messages:
            role = str(m.get("role") or "")
            if role not in ("user", "assistant"):
                continue
            content = m.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            messages.append({"role": role, "content": content[:4000]})
            kept += 1
            if kept >= 6:
                break
    messages.append({"role": "user", "content": user})
    return messages


def inject_spawn_hint(
    messages: list[dict[str, Any]],
    thinking_mode: str,
) -> list[dict[str, Any]]:
    """Copy messages and append a system hint for eligible modes."""
    hint = parent_spawn_hint(thinking_mode)
    out = [dict(m) for m in messages]
    out.insert(0, {"role": "system", "content": hint})
    return out


def public_spawn_limits() -> dict[str, Any]:
    return {
        "enabled": spawn_enabled(),
        "host_profile": host_profile(),
        "max_children": spawn_cap(),
        "max_rounds": MIDTHOUGHT_MAX_ROUNDS,
        "eligible_modes": sorted(_ELIGIBLE_MODES),
        "merge": "same_parent_second_pass",
        "phase_b": "segmented_think",
        "ide": "router_sse_spockify_agents",
    }
