"""Write /var/lib/spockify/tab-train/status.json for ops visibility."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

LOG = logging.getLogger("tab_train.status")

DEFAULT_STATUS = "/var/lib/spockify/tab-train/status.json"


def status_path() -> Path:
    override = os.getenv("TAB_TRAIN_STATUS", "").strip()
    return Path(override or DEFAULT_STATUS)


def champion_snapshot() -> dict[str, Any]:
    """Embed current champions in status (best-effort; no raise)."""
    try:
        from .champion_lib import load_champions
        data = load_champions()
        slots = data.get("slots") or {}
        summary = {
                k: {
                        "name": (v or {}).get("name"),
                        "gate_score": (v or {}).get("gate_score"),
                        "source": (v or {}).get("source"),
                        "promoted_at": (v or {}).get("promoted_at"),
                }
                for k, v in slots.items()
                if isinstance(v, dict)
        }
        return {
                "champions": summary,
                "champion_updated_at": data.get("updated_at"),
        }
    except Exception as exc:  # noqa: BLE001
        return {"champions_error": str(exc)}


def write_status(
        job: str,
        *,
        outcome: str,
        detail: str = "",
        extra: Optional[dict[str, Any]] = None,
) -> Path:
    path = status_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
            "job": job,
            "outcome": outcome,
            "detail": detail,
            "ts": datetime.now(timezone.utc).isoformat(),
            "hostname": os.getenv("HOSTNAME", ""),
    }
    payload.update(champion_snapshot())
    skip_webhook = False
    skip_email = False
    notify_adapter: Optional[str] = None
    notify_scores: Optional[dict[str, Any]] = None
    if extra:
        skip_webhook = bool(extra.pop("_skip_webhook", False))
        skip_email = bool(extra.pop("_skip_email", False))
        if skip_webhook and outcome in ("promoted", "eval_failed"):
            skip_email = True
        raw_adapter = extra.pop("adapter", None)
        if isinstance(raw_adapter, str) and raw_adapter.strip():
            notify_adapter = raw_adapter.strip()
        raw_scores = extra.pop("scores", None)
        if isinstance(raw_scores, dict):
            notify_scores = raw_scores
        payload.update(extra)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    LOG.info("status %s → %s (%s)", job, outcome, path)
    if not skip_webhook or not skip_email:
        try:
            from .notify import notify as notify_outcome

            wh_extra = dict(extra) if extra else None
            notify_outcome(
                    job,
                    outcome,
                    detail=detail,
                    adapter=notify_adapter,
                    scores=notify_scores,
                    extra=wh_extra,
                    skip_webhook=skip_webhook,
                    skip_email=skip_email,
            )
        except Exception as exc:  # noqa: BLE001
            LOG.warning("notify skipped: %s", exc)
    return path
