"""Homelab ops metrics for Spockify status pane (Wave 9.10)."""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Any, Optional

LOG = logging.getLogger("spockify.router.ops")

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/var/lib/spockify"))


def disk_under_storage_root(root: Optional[Path] = None) -> dict[str, Any]:
    path = root or STORAGE_ROOT
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    try:
        usage = shutil.disk_usage(str(path if path.exists() else path.parent))
        return {
            "ok": True,
            "path": str(path),
            "total_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
            "used_pct": round(100.0 * usage.used / usage.total, 1) if usage.total else None,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "path": str(path), "error": str(exc)}


def agent_queue_depth(runs_dir: Optional[Path] = None, active_count: int = 0) -> dict[str, Any]:
    """Approximate queue: in-memory active + durable run files."""
    from parallel_agents import AGENT_RUNS_DIR, list_runs

    base = runs_dir or AGENT_RUNS_DIR
    try:
        runs = list_runs(100)
    except Exception:  # noqa: BLE001
        runs = []
    running = [
        r
        for r in runs
        if (r.get("status") or "").lower() in ("running", "synthesizing", "pending", "queued")
    ]
    return {
        "active_in_memory": active_count,
        "durable_running": len(running),
        "durable_total": len(runs),
        "runs_dir": str(base),
        "depth": max(active_count, len(running)),
    }


def hpa_pod_hints() -> dict[str, Any]:
    """Static/operator hints — no kube API required in router pod."""
    return {
        "note": (
            "OpenWebUI RollingUpdate maxUnavailable=0; router similarly. "
            "Scale via MicroK8s HPA or kubectl scale when GPU free."
        ),
        "suggested_checks": [
            "microk8s kubectl -n spockify get pods,hpa",
            "microk8s kubectl -n spockify top pods 2>/dev/null || true",
            f"df -h {STORAGE_ROOT}",
        ],
        "rolling_update": {"maxUnavailable": 0, "maxSurge": 1},
        "disable_schema_update": True,
    }


def load_average() -> dict[str, Any]:
    try:
        load1, load5, load15 = os.getloadavg()
        return {"ok": True, "load1": load1, "load5": load5, "load15": load15}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def ops_snapshot(*, active_agent_runs: int = 0) -> dict[str, Any]:
    return {
        "disk": disk_under_storage_root(),
        "queue": agent_queue_depth(active_count=active_agent_runs),
        "load": load_average(),
        "hpa": hpa_pod_hints(),
        "storage_root": str(STORAGE_ROOT),
    }
