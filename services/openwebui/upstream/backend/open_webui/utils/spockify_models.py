"""Prefix-tolerant Spockify router model ids (LiteLLM/OWUI prefixes)."""

from __future__ import annotations

SPOCKIFY_ROUTER_MODELS = frozenset(
    {
        'spockify-auto',
        'spockify-agents',
        'spockify-light',
        'spockify-medium',
        'spockify-high',
        'spockify-heavy',
        'spockify-off',
        'spockify-low',
    }
)


def spockify_model_suffix(model_id: str | None) -> str:
    raw = str(model_id or '').strip().lower()
    if not raw:
        return ''
    sep = max(raw.rfind('/'), raw.rfind('.'))
    if sep >= 0:
        return raw[sep + 1 :]
    return raw


def is_spockify_router_model(model_id: str | None) -> bool:
    return spockify_model_suffix(model_id) in SPOCKIFY_ROUTER_MODELS
