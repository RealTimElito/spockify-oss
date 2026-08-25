"""Shared adapter naming: workspace_id -> tab-{hash}."""

from __future__ import annotations

import hashlib
import re

_ADAPTER_RE = re.compile(
        r"^tab-[a-f0-9]{8,16}$|^tab-seed$|^tab-global$|^tab-distill$"
        r"|^tab-.+-challenger$"
)


def workspace_adapter_name(workspace_id: str, *, hash_len: int = 12) -> str:
    """Deterministic LoRA name for a codebase/workspace.

    Must stay in sync with services/router/ghost_fim.py.
    """
    wid = (workspace_id or "").strip()
    if not wid:
        return "tab-global"
    digest = hashlib.sha256(wid.encode("utf-8")).hexdigest()[:hash_len]
    return f"tab-{digest}"


def is_tab_adapter_name(name: str) -> bool:
    return bool(_ADAPTER_RE.match((name or "").strip()))
