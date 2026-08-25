"""Champion / challenger registry for Tab LoRA adapters.

Serves the "always deploy the best model" half of the loop: train jobs write
challengers; eval gates promote into this file; vLLM restart reloads champions.
Training itself stays scheduled (one GPU shared with chat/voice).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .promote_lib import loras_dir

LOG = logging.getLogger("tab_train.champion")

DEFAULT_CHAMPION = "champions.json"
SEED_SLOT = "seed"


def champion_path() -> Path:
    override = os.getenv("TAB_CHAMPION_PATH", "").strip()
    if override:
        return Path(override)
    return loras_dir() / DEFAULT_CHAMPION


def _empty() -> dict[str, Any]:
    return {"slots": {}, "updated_at": None}


def load_champions() -> dict[str, Any]:
    path = champion_path()
    if not path.is_file():
        return _empty()
    try:
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        LOG.warning("champion file unreadable %s: %s", path, exc)
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    data.setdefault("slots", {})
    if not isinstance(data["slots"], dict):
        data["slots"] = {}
    return data


def save_champions(data: dict[str, Any]) -> Path:
    path = champion_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    data.setdefault("slots", {})
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")
    tmp.replace(path)
    return path


def slot_for_adapter(name: str, *, seed: bool = False) -> str:
    """Map adapter name to a champion slot key."""
    if seed or name == "tab-seed":
        return SEED_SLOT
    return name


def get_champion(slot: str) -> Optional[dict[str, Any]]:
    slots = load_champions().get("slots") or {}
    entry = slots.get(slot)
    return entry if isinstance(entry, dict) else None


def champion_baseline(slot: str, *, fallback: str = "tab-fim") -> str:
    """vLLM model id to score against (loaded champion name, else base)."""
    entry = get_champion(slot)
    if not entry:
        return fallback
    name = (entry.get("name") or "").strip()
    return name or fallback


def record_champion(
        name: str,
        *,
        gate_score: Optional[float] = None,
        source: str = "",
        seed: bool = False,
        baseline: str = "tab-fim",
        extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Mark ``name`` as champion for its slot after a successful gate."""
    slot = slot_for_adapter(name, seed=seed)
    data = load_champions()
    entry: dict[str, Any] = {
            "name": name,
            "slot": slot,
            "gate_score": gate_score,
            "baseline": baseline,
            "source": source,
            "promoted_at": datetime.now(timezone.utc).isoformat(),
            "path": str(loras_dir() / name),
    }
    if extra:
        entry.update(extra)
    data.setdefault("slots", {})[slot] = entry
    save_champions(data)
    LOG.info("champion slot=%s name=%s gate=%s", slot, name, gate_score)
    return entry


def list_champion_names() -> list[str]:
    """Distinct adapter names that should be loaded after vLLM restart."""
    names: list[str] = []
    seen: set[str] = set()
    for entry in (load_champions().get("slots") or {}).values():
        if not isinstance(entry, dict):
            continue
        name = (entry.get("name") or "").strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def challenger_name(name: str) -> str:
    return f"{name}-challenger"
