"""Voice world — return-context notes (Wave 10.9).

Store 'remind me when I'm back' notes; surface on PWA/Call return via
visibility / wake / geo heuristics (MVP stubs).
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.voice_world")

_STORAGE = Path(os.getenv("STORAGE_ROOT", "/tmp/spockify"))
VOICE_WORLD_DIR = Path(
    os.getenv("VOICE_WORLD_DIR", str(_STORAGE / "voice-world"))
)


class VoiceNoteCreate(BaseModel):
    text: str
    user_id: str
    surface_on: str = "return"  # return | wake | always
    geo_hint: Optional[str] = None  # e.g. "home" stub


class VoiceReturnSignal(BaseModel):
    user_id: str
    reason: str = "visibility"  # visibility | wake | geo | call
    geo_hint: Optional[str] = None


def _ensure_dir() -> Path:
    VOICE_WORLD_DIR.mkdir(parents=True, exist_ok=True)
    return VOICE_WORLD_DIR


def _user_path(user_id: str) -> Path:
    safe = "".join(c for c in user_id if c.isalnum() or c in "-_")[:64] or "anon"
    return _ensure_dir() / f"{safe}.json"


def _load_user(user_id: str) -> dict[str, Any]:
    path = _user_path(user_id)
    if not path.is_file():
        return {"user_id": user_id, "notes": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"user_id": user_id, "notes": []}


def _save_user(data: dict[str, Any]) -> None:
    path = _user_path(str(data.get("user_id") or "anon"))
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def add_note(body: VoiceNoteCreate) -> dict[str, Any]:
    text = (body.text or "").strip()
    if not text:
        return {"ok": False, "error": "text required"}
    data = _load_user(body.user_id)
    note = {
        "id": uuid.uuid4().hex[:10],
        "text": text[:2000],
        "surface_on": body.surface_on or "return",
        "geo_hint": body.geo_hint,
        "created_at": time.time(),
        "surfaced_at": None,
        "done": False,
    }
    notes = list(data.get("notes") or [])
    notes.append(note)
    data["notes"] = notes[-100:]
    _save_user(data)
    return {"ok": True, "note": note}


def list_notes(user_id: str, *, include_done: bool = False) -> list[dict[str, Any]]:
    data = _load_user(user_id)
    notes = list(data.get("notes") or [])
    if not include_done:
        notes = [n for n in notes if not n.get("done")]
    return notes


def due_notes(signal: VoiceReturnSignal) -> dict[str, Any]:
    """Mark matching notes as due when user returns / wakes."""
    data = _load_user(signal.user_id)
    due: list[dict[str, Any]] = []
    now = time.time()
    for note in data.get("notes") or []:
        if note.get("done"):
            continue
        surface = (note.get("surface_on") or "return").lower()
        reason = (signal.reason or "visibility").lower()
        match = False
        if surface == "always":
            match = True
        elif surface == "return" and reason in ("visibility", "call", "geo", "return"):
            match = True
        elif surface == "wake" and reason in ("wake", "visibility"):
            match = True
        if note.get("geo_hint") and signal.geo_hint:
            if str(note["geo_hint"]).lower() != str(signal.geo_hint).lower():
                # geo mismatch — skip unless always
                if surface != "always":
                    match = False
        if match:
            note["surfaced_at"] = now
            note["done"] = True
            note["surface_reason"] = reason
            due.append(note)
    _save_user(data)
    return {
        "ok": True,
        "due": due,
        "count": len(due),
        "note": (
            "MVP heuristics: visibility/wake/geo stubs — not precise geofencing."
        ),
    }
