"""Telemetry filtering + dedupe for Tab training datasets."""

from __future__ import annotations

import hashlib
from typing import Any, Iterable, Optional


def _norm_ws(text: str) -> str:
    return " ".join((text or "").split())


def prefix_fingerprint(prefix: str, *, n: int = 512) -> str:
    """Near-identical prefix key (first N normalized chars)."""
    blob = _norm_ws(prefix)[:n]
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def is_junk_event(
    row: dict[str, Any],
    *,
    max_latency_ms: Optional[int] = 30_000,
) -> bool:
    """Drop empty / suppressed / outlier rows before SFT or KTO."""
    if row.get("suppress_reason"):
        return True
    suggestion = (row.get("suggestion") or "").strip()
    if not suggestion:
        return True
    fate = (row.get("fate") or "").strip()
    if fate == "ignored":
        return True
    if max_latency_ms is not None:
        lat = row.get("latency_ms")
        if lat is not None and int(lat) > max_latency_ms:
            return True
    return False


def dedupe_by_prefix(
    rows: Iterable[dict[str, Any]],
    *,
    keep: str = "newest",
) -> list[dict[str, Any]]:
    """Keep one row per near-identical prefix fingerprint."""
    best: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for row in rows:
        fp = prefix_fingerprint(row.get("prefix") or "")
        prev = best.get(fp)
        if prev is None:
            best[fp] = row
            order.append(fp)
            continue
        if keep == "newest":
            prev_ts = prev.get("fate_ts") or prev.get("ts") or ""
            cur_ts = row.get("fate_ts") or row.get("ts") or ""
            if str(cur_ts) >= str(prev_ts):
                best[fp] = row
        else:
            best[fp] = row
    return [best[fp] for fp in order]


def kto_label(row: dict[str, Any]) -> Optional[bool]:
    """KTO desirability: accepted=True, rejected+seen=False, else skip."""
    fate = (row.get("fate") or "").strip()
    if fate == "accepted":
        return True
    if fate == "rejected" and bool(row.get("seen")):
        return False
    return None
