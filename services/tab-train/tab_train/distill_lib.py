"""Teacher completion client + filters for Tab distillation.

Preferred teacher: Ollama **codestral:22b** via native `/api/generate` infill
(same path as router `ghost_fim.complete_ollama_infill`).

Do **not** use Gemini (Flash/Pro) as a teacher — Google ToS restricts using
outputs to train competing/similar models, and it ships code off-box.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from collections import Counter
from typing import Any, Optional

from .eval_lib import aggregate_gate_score, score_pairs
from .fim_format import FIM_MIDDLE, FIM_PREFIX, FIM_SUFFIX, build_fim_prompt

LOG = logging.getLogger("tab_train.distill")

# Default teacher: local Codestral FIM (on-box, Apache-friendly MNPL for
# inference; we only store filtered completions for student SFT).
DEFAULT_TEACHER_MODEL = "codestral:22b"
DEFAULT_TEACHER_URL = "http://ollama.spockify.svc.cluster.local:11434"
DEFAULT_API_STYLE = "ollama_infill"

DEFAULT_STOP = [
        FIM_PREFIX,
        FIM_SUFFIX,
        FIM_MIDDLE,
        "<|endoftext|>",
        "<|file_separator|>",
]

# Codestral / Ollama infill sometimes emits these mid-stream.
_CODESTRAL_STOP = [
        "[PREFIX]", "[/PREFIX]", "[SUFFIX]", "[/SUFFIX]",
        "[MIDDLE]", "[/MIDDLE]", "[INFIX]", "[/INFIX]",
]

_FIM_ARTIFACTS = (
        "[PREFIX]", "[/PREFIX]", "[SUFFIX]", "[/SUFFIX]",
        "[MIDDLE]", "[/MIDDLE]", "[INFIX]", "[/INFIX]",
        "<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<file_sep>",
        "<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>",
        "<|file_separator|>", "<|endoftext|>", "</s>",
)

_FIM_TOKEN_RE = re.compile(
        r"<fim_(?:prefix|suffix|middle)>|<\|endoftext\|>|<\|file_separator\|>"
)


def char_f1(pred: str, gold: str) -> float:
    if not pred and not gold:
        return 1.0
    if not pred or not gold:
        return 0.0
    cp, cg = Counter(pred), Counter(gold)
    overlap = sum((cp & cg).values())
    if overlap == 0:
        return 0.0
    prec = overlap / max(len(pred), 1)
    rec = overlap / max(len(gold), 1)
    return 2 * prec * rec / max(prec + rec, 1e-9)


def strip_fim_artifacts(text: str) -> str:
    """Cut completion at the first FIM / Codestral sentinel, if any."""
    cut = len(text)
    for token in _FIM_ARTIFACTS:
        idx = text.find(token)
        if idx != -1 and idx < cut:
            cut = idx
    return text[:cut]


def clean_completion(text: str) -> str:
    t = (text or "").replace("\x00", "")
    t = strip_fim_artifacts(t)
    t = _FIM_TOKEN_RE.sub("", t)
    if t.startswith("```"):
        t = re.sub(r"^```\w*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    return t.strip("\r")


def is_bad_completion(
        text: str,
        *,
        min_chars: int = 2,
        max_chars: int = 800,
) -> Optional[str]:
    """Return a reject reason, or None if acceptable."""
    t = clean_completion(text)
    if len(t.strip()) < min_chars:
        return "empty"
    if len(t) > max_chars:
        return "too_long"
    if len(set(t)) <= 2 and len(t) >= 24:
        return "char_repeat"
    lines = [ln for ln in t.splitlines() if ln.strip()]
    if len(lines) >= 6 and len(set(lines)) == 1:
        return "line_repeat"
    if not any(ch.isalnum() or ch in "_$." for ch in t):
        return "no_code"
    return None


def select_label(
        *,
        ground_truth: str,
        teacher: Optional[str],
        mode: str,
        min_teacher_f1: float = 0.35,
) -> tuple[Optional[str], str]:
    """Pick SFT middle + reason tag.

    Modes:
      ground_truth — always GT (synthetic FIM self-supervision)
      teacher — teacher only (reject if bad)
      teacher_filtered — teacher when similar enough to GT, else GT
      mix — prefer teacher when good+similar, else GT
    """
    gt = (ground_truth or "").rstrip("\n")
    mode = (mode or "ground_truth").strip().lower()
    if mode == "ground_truth":
        return (gt if gt.strip() else None), "ground_truth"

    tea = clean_completion(teacher or "").rstrip("\n") if teacher is not None else ""
    bad = is_bad_completion(tea) if tea else "empty"
    if mode == "teacher":
        if bad:
            return None, f"reject_{bad}"
        return tea, "teacher"

    f1 = char_f1(tea, gt) if tea and not bad else 0.0
    if mode in ("teacher_filtered", "mix"):
        if not bad and f1 >= min_teacher_f1:
            return tea, f"teacher_f1={f1:.3f}"
        if gt.strip():
            return gt, "fallback_gt"
        return None, f"reject_{bad or 'low_f1'}"
    raise ValueError(f"unknown label mode: {mode}")


def complete_fim(
        base_url: str,
        model: str,
        prefix: str,
        suffix: str,
        *,
        max_tokens: int = 96,
        temperature: float = 0.2,
        timeout: float = 180.0,
        api_style: str = DEFAULT_API_STYLE,
) -> str:
    """Call a teacher for a FIM middle.

    api_style:
      ollama_infill — POST /api/generate with prompt+suffix (Codestral native FIM)
      completions — POST /v1/completions with granite FIM tokens (vLLM tab-fim)
      chat — POST /v1/chat/completions fill instruction (gpt-oss / non-FIM)
    """
    base = base_url.rstrip("/")
    style = (api_style or DEFAULT_API_STYLE).strip().lower()

    if style == "ollama_infill":
        body: dict[str, Any] = {
                "model": model,
                "prompt": prefix,
                "suffix": suffix,
                "stream": False,
                "keep_alive": "30m",
                "options": {
                        "num_predict": max_tokens,
                        "temperature": temperature,
                        "stop": list(_CODESTRAL_STOP),
                },
        }
        url = f"{base}/api/generate"
    elif style == "chat":
        user = (
                "Fill in the missing code between PREFIX and SUFFIX. "
                "Reply with only the missing code, no markdown fences.\n\n"
                f"PREFIX:\n{prefix}\n\nSUFFIX:\n{suffix}\n"
        )
        body = {
                "model": model,
                "messages": [
                        {"role": "system", "content": "You are a code completion engine."},
                        {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
                "temperature": temperature,
        }
        url = f"{base}/v1/chat/completions"
    else:
        body = {
                "model": model,
                "prompt": build_fim_prompt(prefix, suffix),
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stop": DEFAULT_STOP,
        }
        url = f"{base}/v1/completions"

    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {url}: {detail}") from exc

    if style == "ollama_infill":
        return clean_completion(payload.get("response") or "")
    if style == "chat":
        choices = payload.get("choices") or [{}]
        msg = (choices[0].get("message") or {}).get("content") or ""
        return clean_completion(msg)
    text = ((payload.get("choices") or [{}])[0].get("text") or "")
    return clean_completion(text)


def default_teacher_url() -> str:
    return os.getenv("TAB_TEACHER_URL", DEFAULT_TEACHER_URL).rstrip("/")


def default_teacher_model() -> str:
    return os.getenv("TAB_TEACHER_MODEL", DEFAULT_TEACHER_MODEL)


def default_api_style() -> str:
    return os.getenv("TAB_TEACHER_API_STYLE", DEFAULT_API_STYLE)


def distill_quality_report(
        pairs: list[tuple[str, str]],
) -> dict[str, Any]:
    """Score teacher vs ground-truth pairs (diagnostics only)."""
    scores = score_pairs(pairs)
    return {
            "scores": scores.as_dict(),
            "gate": aggregate_gate_score(scores),
    }
