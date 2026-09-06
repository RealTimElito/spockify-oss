"""Writable multiplayer rooms (Wave 10.7).

Two+ humans + agents in one live session (not read-only /live share).
Auth via user id membership or invite token.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.multiplayer")

_STORAGE = Path(os.getenv("STORAGE_ROOT", "/tmp/spockify"))
MULTIPLAYER_DIR = Path(os.getenv("MULTIPLAYER_DIR", str(_STORAGE / "multiplayer")))


class RoomCreate(BaseModel):
    title: str = "Spockify room"
    owner_id: str
    invite_enabled: bool = True


class RoomMessage(BaseModel):
    text: str
    role: str = "user"  # user | agent | system
    author_id: Optional[str] = None
    author_name: Optional[str] = None


def _ensure_dir() -> Path:
    MULTIPLAYER_DIR.mkdir(parents=True, exist_ok=True)
    return MULTIPLAYER_DIR


def _room_path(room_id: str) -> Path:
    return _ensure_dir() / f"{room_id}.json"


def _load(room_id: str) -> Optional[dict[str, Any]]:
    path = _room_path(room_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _save(room: dict[str, Any]) -> None:
    path = _room_path(str(room["id"]))
    path.write_text(json.dumps(room, indent=2), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def create_room(body: RoomCreate) -> dict[str, Any]:
    room_id = uuid.uuid4().hex[:12]
    invite = secrets.token_urlsafe(16) if body.invite_enabled else None
    now = time.time()
    room = {
        "id": room_id,
        "title": (body.title or "Spockify room").strip()[:120],
        "owner_id": body.owner_id,
        "invite_token": invite,
        "members": [body.owner_id],
        "messages": [
            {
                "id": uuid.uuid4().hex[:8],
                "role": "system",
                "text": "Writable multiplayer room (Wave 10.7). Not read-only /live.",
                "author_id": "system",
                "ts": now,
            }
        ],
        "created_at": now,
        "updated_at": now,
        "writable": True,
    }
    _save(room)
    return room


def public_room(room: dict[str, Any], *, include_invite: bool = False) -> dict[str, Any]:
    out = {
        "id": room.get("id"),
        "title": room.get("title"),
        "owner_id": room.get("owner_id"),
        "members": room.get("members") or [],
        "messages": room.get("messages") or [],
        "writable": True,
        "created_at": room.get("created_at"),
        "updated_at": room.get("updated_at"),
        "message_count": len(room.get("messages") or []),
    }
    if include_invite:
        out["invite_token"] = room.get("invite_token")
    return out


def join_room(
    room_id: str,
    *,
    user_id: str,
    invite_token: Optional[str] = None,
) -> dict[str, Any]:
    room = _load(room_id)
    if not room:
        return {"ok": False, "error": "room not found"}
    members = list(room.get("members") or [])
    if user_id in members or user_id == room.get("owner_id"):
        return {"ok": True, "room": public_room(room)}
    token = room.get("invite_token")
    if token and invite_token and secrets.compare_digest(str(token), str(invite_token)):
        members.append(user_id)
        room["members"] = members
        room["updated_at"] = time.time()
        _save(room)
        return {"ok": True, "room": public_room(room)}
    return {"ok": False, "error": "invite token required or invalid"}


def post_message(
    room_id: str,
    msg: RoomMessage,
    *,
    user_id: Optional[str] = None,
    invite_token: Optional[str] = None,
) -> dict[str, Any]:
    room = _load(room_id)
    if not room:
        return {"ok": False, "error": "room not found"}
    uid = user_id or msg.author_id or "anon"
    members = set(room.get("members") or [])
    token_ok = bool(
        room.get("invite_token")
        and invite_token
        and secrets.compare_digest(str(room["invite_token"]), str(invite_token))
    )
    if uid not in members and uid != room.get("owner_id") and not token_ok:
        return {"ok": False, "error": "not a member; join with invite token"}
    if uid not in members:
        members.add(uid)
        room["members"] = list(members)
    text = (msg.text or "").strip()
    if not text:
        return {"ok": False, "error": "text required"}
    entry = {
        "id": uuid.uuid4().hex[:8],
        "role": msg.role or "user",
        "text": text[:4000],
        "author_id": uid,
        "author_name": msg.author_name,
        "ts": time.time(),
    }
    messages = list(room.get("messages") or [])
    messages.append(entry)
    room["messages"] = messages[-200:]
    room["updated_at"] = time.time()
    _save(room)
    return {"ok": True, "message": entry, "room": public_room(room)}


def get_room(room_id: str) -> Optional[dict[str, Any]]:
    room = _load(room_id)
    return public_room(room) if room else None


def get_room_raw(room_id: str) -> Optional[dict[str, Any]]:
    return _load(room_id)


def list_rooms(limit: int = 30, user_id: Optional[str] = None) -> list[dict[str, Any]]:
    root = _ensure_dir()
    out: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            room = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if user_id:
            members = [str(m) for m in (room.get("members") or [])]
            if str(user_id) not in members and str(room.get("owner_id") or "") != str(user_id):
                continue
        out.append(public_room(room, include_invite=(str(room.get("owner_id") or "") == str(user_id or ""))))
        if len(out) >= limit:
            break
    return out


def user_can_access_room(
    room: dict[str, Any],
    *,
    user_id: Optional[str] = None,
    invite_token: Optional[str] = None,
) -> bool:
    if not room:
        return False
    uid = (user_id or "").strip()
    members = [str(m) for m in (room.get("members") or [])]
    if uid and (uid in members or str(room.get("owner_id") or "") == uid):
        return True
    tok = (invite_token or "").strip()
    if tok and tok == str(room.get("invite_token") or ""):
        return True
    return False
