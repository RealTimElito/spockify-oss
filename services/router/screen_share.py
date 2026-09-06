"""Screen share → agent (Wave 10.1).

Accept JPEG/PNG frames from browser getDisplayMedia, store under
SCREEN_SHARE_DIR, produce narration + Playwright action hints.
"""

from __future__ import annotations

import base64
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.screen_share")

_STORAGE = Path(os.getenv("STORAGE_ROOT", "/tmp/spockify"))
SCREEN_SHARE_DIR = Path(
    os.getenv("SCREEN_SHARE_DIR", str(_STORAGE / "screen-share"))
)
SCREEN_SHARE_MAX_FRAMES = int(os.getenv("SCREEN_SHARE_MAX_FRAMES", "6"))


class ScreenFrame(BaseModel):
    image_b64: str
    mime: str = "image/jpeg"
    note: str = ""


class ScreenShareRequest(BaseModel):
    frames: list[ScreenFrame] = Field(default_factory=list)
    chat_id: Optional[str] = None
    user_id: Optional[str] = None
    prompt: str = "Describe what you see and suggest next browser actions."
    drive_playwright: bool = False


def _ensure_dir() -> Path:
    SCREEN_SHARE_DIR.mkdir(parents=True, exist_ok=True)
    return SCREEN_SHARE_DIR


def _decode_frame(frame: ScreenFrame) -> bytes:
    raw = frame.image_b64.strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    return base64.b64decode(raw)


def _heuristic_narration(n_frames: int, prompt: str, sizes: list[int]) -> str:
    avg = int(sum(sizes) / max(1, len(sizes)))
    return (
        f"Screen share session: {n_frames} frame(s) received "
        f"(avg {avg} bytes). Prompt: {prompt[:200] or '(none)'}. "
        "VLM caption deferred — heuristic summary only. "
        "UI appears active; suggest confirming the visible primary action."
    )


def _suggest_actions(narration: str) -> list[dict[str, str]]:
    return [
        {
            "action": "navigate",
            "hint": "Confirm the current URL matches the shared tab before driving.",
        },
        {
            "action": "click",
            "selector": "button, a, [role=button]",
            "hint": "Click the primary CTA visible in the shared frame (confirm first).",
        },
        {
            "action": "type",
            "selector": "input, textarea",
            "hint": "Fill an obvious form field if the share shows a text input.",
        },
    ]


async def ingest_frames(
    req: ScreenShareRequest,
    *,
    vlm_caption: Optional[str] = None,
) -> dict[str, Any]:
    """Persist frames and return live status + narration + action hints."""
    frames = (req.frames or [])[:SCREEN_SHARE_MAX_FRAMES]
    if not frames:
        return {"ok": False, "error": "frames required", "status": "idle"}

    session_id = uuid.uuid4().hex[:12]
    root = _ensure_dir() / session_id
    root.mkdir(parents=True, exist_ok=True)
    sizes: list[int] = []
    saved: list[str] = []
    for i, frame in enumerate(frames):
        try:
            data = _decode_frame(frame)
        except Exception as exc:  # noqa: BLE001
            LOG.warning("bad frame %s: %s", i, exc)
            continue
        ext = "jpg" if "jpeg" in (frame.mime or "") else "png"
        path = root / f"frame_{i:02d}.{ext}"
        path.write_bytes(data)
        sizes.append(len(data))
        saved.append(str(path))

    if not saved:
        return {"ok": False, "error": "no valid frames", "status": "error"}

    narration = (vlm_caption or "").strip() or _heuristic_narration(
        len(saved), req.prompt, sizes
    )
    actions = _suggest_actions(narration)
    meta = {
        "id": session_id,
        "chat_id": req.chat_id,
        "user_id": req.user_id,
        "frames": saved,
        "frame_count": len(saved),
        "narration": narration,
        "suggested_actions": actions,
        "drive_playwright": bool(req.drive_playwright),
        "created_at": time.time(),
        "status": "ready",
        "note": (
            "MVP: frames stored; VLM optional. "
            "Playwright drive requires confirm + allowlist (Wave 9)."
        ),
    }
    (root / "meta.json").write_text(
        __import__("json").dumps(meta, indent=2), encoding="utf-8"
    )
    return {
        "ok": True,
        "session_id": session_id,
        "status": "ready",
        "frame_count": len(saved),
        "narration": narration,
        "suggested_actions": actions,
        "live_status": f"Screen share: {len(saved)} frame(s) · narrating",
        "note": meta["note"],
    }


def list_sessions(limit: int = 20) -> list[dict[str, Any]]:
    import json

    root = _ensure_dir()
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        meta_path = path / "meta.json"
        if not meta_path.is_file():
            continue
        try:
            out.append(json.loads(meta_path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
        if len(out) >= limit:
            break
    return out
