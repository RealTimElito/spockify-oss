"""POST Tab training outcomes to a Cursor Automations webhook (best-effort)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

from .status_lib import champion_snapshot

LOG = logging.getLogger("tab_train.notify_webhook")

_TIMEOUT_S = 15


def _webhook_config() -> tuple[str, str]:
    url = os.getenv("TAB_TRAIN_WEBHOOK_URL", "").strip()
    token = os.getenv("TAB_TRAIN_WEBHOOK_TOKEN", "").strip()
    return url, token


def notify(
        job: str,
        outcome: str,
        *,
        detail: str = "",
        adapter: Optional[str] = None,
        scores: Optional[dict[str, Any]] = None,
        extra: Optional[dict[str, Any]] = None,
) -> bool:
    """Send a training event. Returns True on HTTP 2xx. Never raises."""
    url, token = _webhook_config()
    if not url:
        return False

    payload: dict[str, Any] = {
            "job": job,
            "outcome": outcome,
            "detail": detail,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "hostname": os.getenv("HOSTNAME", ""),
    }
    if adapter:
        payload["adapter"] = adapter
    if scores:
        payload["scores"] = scores
    if extra:
        payload.update(extra)
    payload.update(champion_snapshot())

    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "tab-train/1"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            ok = 200 <= resp.status < 300
            if ok:
                LOG.info("webhook %s/%s → %s", job, outcome, resp.status)
            else:
                LOG.warning("webhook %s/%s unexpected status %s", job, outcome, resp.status)
            return ok
    except urllib.error.HTTPError as exc:
        LOG.warning("webhook %s/%s HTTP %s: %s", job, outcome, exc.code, exc.reason)
    except urllib.error.URLError as exc:
        LOG.warning("webhook %s/%s failed: %s", job, outcome, exc.reason)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("webhook %s/%s error: %s", job, outcome, exc)
    return False


def notify_started(job: str, *, detail: str = "") -> bool:
    return notify(job, "started", detail=detail)


def notify_job_failed(job: str, *, detail: str = "", exit_code: int = 1) -> bool:
    return notify(job, "failed", detail=detail or f"exit_code={exit_code}")
