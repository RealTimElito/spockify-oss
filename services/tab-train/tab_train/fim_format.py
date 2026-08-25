"""Granite / StarCoder-style FIM formatting for Tab training."""

from __future__ import annotations

from typing import Any, Optional

FIM_PREFIX = "<fim_prefix>"
FIM_SUFFIX = "<fim_suffix>"
FIM_MIDDLE = "<fim_middle>"
EOS = "<|endoftext|>"


def build_fim_prompt(prefix: str, suffix: str) -> str:
    """Prompt only (no middle); used at inference and as SFT prompt prefix."""
    return f"{FIM_PREFIX}{prefix or ''}{FIM_SUFFIX}{suffix or ''}{FIM_MIDDLE}"


def build_fim_example(prefix: str, suffix: str, middle: str) -> str:
    """Full causal LM training string: prompt + completion + EOS."""
    mid = middle or ""
    return f"{build_fim_prompt(prefix, suffix)}{mid}{EOS}"


def partial_is_high_quality(
    suggestion: str,
    settled_text: Optional[str],
    *,
    min_ratio: float = 0.85,
) -> bool:
    """True when settled_text is nearly the suggestion (high-quality partial)."""
    sug = (suggestion or "").strip()
    settled = (settled_text or "").strip()
    if not sug or not settled:
        return False
    if settled == sug:
        return True
    if sug.startswith(settled) or settled.startswith(sug):
        shorter, longer = (
            (settled, sug) if len(settled) <= len(sug) else (sug, settled)
        )
        return (len(shorter) / max(len(longer), 1)) >= min_ratio
    n = 0
    for a, b in zip(sug, settled):
        if a != b:
            break
        n += 1
    return (n / max(len(sug), 1)) >= min_ratio


def sft_target_text(row: dict[str, Any]) -> Optional[str]:
    """Pick the completion target for an accepted/partial telemetry row."""
    fate = (row.get("fate") or "").strip()
    suggestion = (row.get("suggestion") or "").strip()
    settled = (row.get("settled_text") or "").strip()
    if fate == "accepted":
        return settled or suggestion or None
    if fate == "partial" and partial_is_high_quality(suggestion, settled):
        return settled or suggestion
    return None
