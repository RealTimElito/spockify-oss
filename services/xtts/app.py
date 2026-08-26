"""Minimal XTTS voice-clone TTS sidecar (Wave 9.9).

Loads Coqui XTTS on startup when XTTS_WARM_ON_STARTUP=1 (default) so clone
requests do not pay cold model load. Falls back to 503 if TTS is unavailable
so OpenWebUI can use edge-tts. Prefer CPU on cluster hosts when GPU is contended by
Ollama/ComfyUI.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

LOG = logging.getLogger("spockify.xtts")
logging.basicConfig(level=logging.INFO)

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/var/lib/spockify"))
XTTS_MODEL = os.getenv(
    "XTTS_MODEL",
    "tts_models/multilingual/multi-dataset/xtts_v2",
)
XTTS_DEVICE = (os.getenv("XTTS_DEVICE") or "cpu").strip().lower()
XTTS_MODEL_DIR = Path(
    os.getenv("XTTS_MODEL_PATH", str(STORAGE_ROOT / "xtts" / "models"))
)
XTTS_WARM_ON_STARTUP = os.getenv("XTTS_WARM_ON_STARTUP", "1").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# Soft touch so the process stays resident / GC does not unload (model stays in RAM).
try:
    XTTS_KEEPALIVE_SECONDS = max(0, int(os.getenv("XTTS_KEEPALIVE_SECONDS", "300")))
except ValueError:
    XTTS_KEEPALIVE_SECONDS = 300

_tts = None
_tts_lock = threading.Lock()
_tts_error: Optional[str] = None
_tts_loaded_at: Optional[float] = None
_keepalive_task: Optional[asyncio.Task] = None


def _load_tts():
    global _tts, _tts_error, _tts_loaded_at
    if _tts is not None:
        return _tts
    with _tts_lock:
        if _tts is not None:
            return _tts
        try:
            XTTS_MODEL_DIR.mkdir(parents=True, exist_ok=True)
            os.environ.setdefault("TTS_HOME", str(XTTS_MODEL_DIR))
            os.environ.setdefault("COQUI_TOS_AGREED", "1")
            from TTS.api import TTS  # type: ignore

            device = XTTS_DEVICE
            if device == "auto":
                try:
                    import torch

                    device = "cuda" if torch.cuda.is_available() else "cpu"
                except Exception:  # noqa: BLE001
                    device = "cpu"
            LOG.info("Loading XTTS model=%s device=%s", XTTS_MODEL, device)
            tts = TTS(XTTS_MODEL).to(device)
            _tts = tts
            _tts_error = None
            _tts_loaded_at = time.time()
            LOG.info("XTTS model loaded")
            return _tts
        except Exception as exc:  # noqa: BLE001
            _tts_error = str(exc)
            LOG.exception("XTTS load failed: %s", exc)
            raise


async def _warm_in_background() -> None:
    if not XTTS_WARM_ON_STARTUP:
        return
    try:
        await asyncio.to_thread(_load_tts)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("XTTS warm-on-startup failed (edge-tts fallback OK): %s", exc)


async def _keepalive_loop() -> None:
    """Touch the loaded model periodically so it stays hot in process memory."""
    if XTTS_KEEPALIVE_SECONDS <= 0:
        return
    while True:
        await asyncio.sleep(XTTS_KEEPALIVE_SECONDS)
        if _tts is None:
            try:
                await asyncio.to_thread(_load_tts)
            except Exception as exc:  # noqa: BLE001
                LOG.warning("XTTS keepalive reload failed: %s", exc)
            continue
        # Cheap touch — keep reference live; log for ops visibility.
        LOG.info(
            "XTTS keepalive ok loaded_for=%.0fs",
            time.time() - (_tts_loaded_at or time.time()),
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _keepalive_task
    asyncio.create_task(_warm_in_background())
    if XTTS_KEEPALIVE_SECONDS > 0:
        _keepalive_task = asyncio.create_task(_keepalive_loop())
    yield
    if _keepalive_task is not None:
        _keepalive_task.cancel()


app = FastAPI(title="Spockify XTTS", version="9.9", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": XTTS_MODEL,
        "device": XTTS_DEVICE,
        "loaded": _tts is not None,
        "loaded_at": _tts_loaded_at,
        "warm_on_startup": XTTS_WARM_ON_STARTUP,
        "error": _tts_error,
    }


@app.post("/warmup")
async def warmup():
    """Force-load the model (ops / post-deploy). Idempotent when already hot."""
    try:
        await asyncio.to_thread(_load_tts)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"XTTS unavailable: {exc}",
        ) from exc
    return {
        "ok": True,
        "loaded": True,
        "model": XTTS_MODEL,
        "device": XTTS_DEVICE,
        "loaded_at": _tts_loaded_at,
    }


@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    language: str = Form("en"),
    speaker_wav: UploadFile = File(...),
):
    raw_text = (text or "").strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="text required")
    if len(raw_text) > 2000:
        raw_text = raw_text[:1999] + "…"

    speaker_bytes = await speaker_wav.read()
    if not speaker_bytes or len(speaker_bytes) < 1000:
        raise HTTPException(status_code=400, detail="speaker sample too short")

    try:
        tts = _load_tts()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"XTTS unavailable: {exc}",
        ) from exc

    lang = (language or "en")[:8]
    with tempfile.TemporaryDirectory() as tmp:
        sample_path = Path(tmp) / "speaker.wav"
        out_path = Path(tmp) / "out.wav"
        sample_path.write_bytes(speaker_bytes)
        try:
            # Coqui API is sync / GPU-heavy — run in thread.
            def _run():
                tts.tts_to_file(
                    text=raw_text,
                    file_path=str(out_path),
                    speaker_wav=str(sample_path),
                    language=lang,
                )

            await asyncio.to_thread(_run)
        except Exception as exc:  # noqa: BLE001
            LOG.exception("XTTS synthesize failed: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if not out_path.is_file():
            raise HTTPException(status_code=500, detail="XTTS produced no audio")
        audio = out_path.read_bytes()

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"X-Spockify-TTS-Engine": "xtts"},
    )
