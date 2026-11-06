"""Home brain — camera/image/webhook ingest (Wave 10.5).

MVP: upload image / URL / simple webhook → summary stored for chat/notifications.
Doorbell / Frigate RTSP is documented as next step (not implemented here).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.home_brain")

_STORAGE = Path(os.getenv("STORAGE_ROOT", "/tmp/spockify"))
HOME_BRAIN_DIR = Path(os.getenv("HOME_BRAIN_DIR", str(_STORAGE / "home-brain")))
HOME_BRAIN_WEBHOOK_SECRET = (
    os.getenv("HOME_BRAIN_WEBHOOK_SECRET") or ""
).strip()


class HomeIngestRequest(BaseModel):
    image_b64: Optional[str] = None
    image_url: Optional[str] = None
    mime: str = "image/jpeg"
    note: str = ""
    user_id: Optional[str] = None
    source: str = "upload"


class HomeWebhookRequest(BaseModel):
    event: str = "motion"
    image_b64: Optional[str] = None
    image_url: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    user_id: Optional[str] = None


def _ensure_dir() -> Path:
    HOME_BRAIN_DIR.mkdir(parents=True, exist_ok=True)
    (HOME_BRAIN_DIR / "events").mkdir(parents=True, exist_ok=True)
    return HOME_BRAIN_DIR


def verify_webhook_signature(body: bytes, signature: Optional[str]) -> bool:
    if not HOME_BRAIN_WEBHOOK_SECRET:
        return True  # open MVP when secret unset
    if not signature:
        return False
    expected = hmac.new(
        HOME_BRAIN_WEBHOOK_SECRET.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    sig = signature.removeprefix("sha256=").strip()
    return hmac.compare_digest(expected, sig)


def _heuristic_summary(source: str, note: str, nbytes: int) -> str:
    return (
        f"Home brain alert ({source}): ingested {nbytes} bytes. "
        f"{note[:240] or 'No operator note.'} "
        "Local VLM summary pending — treat as motion/presence cue. "
        "Next step: wire Frigate/doorbell RTSP into this same ingest path."
    )


async def _fetch_url_bytes(url: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "image/jpeg").split(";")[0]
        return resp.content, ctype


async def ingest(req: HomeIngestRequest) -> dict[str, Any]:
    _ensure_dir()
    data = b""
    mime = req.mime or "image/jpeg"
    if req.image_b64:
        raw = req.image_b64.strip()
        if "," in raw and raw.lower().startswith("data:"):
            raw = raw.split(",", 1)[1]
        data = base64.b64decode(raw)
    elif req.image_url:
        try:
            data, mime = await _fetch_url_bytes(req.image_url.strip())
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"fetch failed: {exc}"}
    else:
        return {"ok": False, "error": "image_b64 or image_url required"}

    event_id = uuid.uuid4().hex[:12]
    ext = "jpg" if "jpeg" in mime or "jpg" in mime else "png"
    img_path = HOME_BRAIN_DIR / "events" / f"{event_id}.{ext}"
    img_path.write_bytes(data)
    summary = _heuristic_summary(req.source, req.note, len(data))
    event = {
        "id": event_id,
        "user_id": req.user_id,
        "source": req.source,
        "mime": mime,
        "bytes": len(data),
        "path": str(img_path),
        "note": req.note,
        "summary": summary,
        "created_at": time.time(),
        "doorbell_next_step": (
            "Point Frigate/doorbell webhook at POST /spockify/home/webhook "
            "with optional HOME_BRAIN_WEBHOOK_SECRET."
        ),
    }
    (HOME_BRAIN_DIR / "events" / f"{event_id}.json").write_text(
        json.dumps(event, indent=2), encoding="utf-8"
    )
    return {"ok": True, "event": event}


async def webhook_ingest(
    req: HomeWebhookRequest,
    *,
    raw_body: bytes = b"",
    signature: Optional[str] = None,
) -> dict[str, Any]:
    if not verify_webhook_signature(raw_body or b"{}", signature):
        return {"ok": False, "error": "invalid webhook signature"}
    return await ingest(
        HomeIngestRequest(
            image_b64=req.image_b64,
            image_url=req.image_url,
            note=req.event or "webhook",
            user_id=req.user_id,
            source=f"webhook:{req.event or 'event'}",
        )
    )


def list_events(limit: int = 30, user_id: Optional[str] = None) -> list[dict[str, Any]]:
    root = _ensure_dir() / "events"
    out: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            ev = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if user_id and ev.get("user_id") and ev.get("user_id") != user_id:
            continue
        out.append(ev)
        if len(out) >= limit:
            break
    return out
