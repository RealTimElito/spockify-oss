"""Rough cost / latency helpers for Spockify HUD (Wave 8.2)."""

from __future__ import annotations

import os
from typing import Any, Optional

# USD per 1K tokens for rough local-inference estimate (not billable).
_DEFAULT_COST = float(os.getenv("SPOCKIFY_COST_PER_1K_TOKENS", "0.0002"))


def estimate_cost_usd(
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    *,
    per_1k: Optional[float] = None,
) -> float:
    rate = _DEFAULT_COST if per_1k is None else per_1k
    total = max(0, int(prompt_tokens)) + max(0, int(completion_tokens))
    return round((total / 1000.0) * rate, 6)


def extract_usage_tokens(usage: Optional[dict[str, Any]]) -> tuple[int, int]:
    if not isinstance(usage, dict):
        return 0, 0
    prompt = int(
        usage.get("prompt_tokens")
        or usage.get("prompt_eval_count")
        or usage.get("input_tokens")
        or 0
    )
    completion = int(
        usage.get("completion_tokens")
        or usage.get("eval_count")
        or usage.get("output_tokens")
        or 0
    )
    return prompt, completion


def build_hud(
    *,
    worker: str,
    latency_ms: int,
    usage: Optional[dict[str, Any]] = None,
    model: Optional[str] = None,
) -> dict[str, Any]:
    prompt_t, completion_t = extract_usage_tokens(usage)
    cost = estimate_cost_usd(prompt_t, completion_t)
    return {
        "worker": worker,
        "model": model or worker,
        "latency_ms": max(0, int(latency_ms)),
        "prompt_tokens": prompt_t,
        "completion_tokens": completion_t,
        "total_tokens": prompt_t + completion_t,
        "cost_usd": cost,
        "cost_note": "rough local estimate",
    }


def hud_headers(hud: dict[str, Any]) -> dict[str, str]:
    return {
        "X-Spockify-Latency-Ms": str(hud.get("latency_ms", 0)),
        "X-Spockify-Tokens-Prompt": str(hud.get("prompt_tokens", 0)),
        "X-Spockify-Tokens-Completion": str(hud.get("completion_tokens", 0)),
        "X-Spockify-Cost-Usd": str(hud.get("cost_usd", 0)),
        "X-Spockify-Hud-Model": str(hud.get("model") or hud.get("worker") or "")[
            :120
        ],
    }
