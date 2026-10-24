"""LabRats series product layer: speakers, VO stems, SFX, assets, mux, timeline.

CPU/ffmpeg/XTTS only. Timeline and mux jobs never enqueue Comfy. Episode
picture stays Layout-To-Render silent; H3 is atmos/scratch; VO is XTTS
(with edge-tts fallback) muxed after the fact.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import struct
import subprocess
import tempfile
import time
import uuid
import wave
from pathlib import Path
from typing import Any, Optional

import httpx

import video_gen
from image_models import (
    LTX25_AUDIO_VAE,
    LTX25_LAYOUT_ID,
    MINIMAX_H3_ID,
    identity_lock_status,
    video_limits_for,
)

LOG = logging.getLogger("spockify.series")

SERIES_ROOT = Path(
    os.environ.get("SPOCKIFY_SERIES_ROOT", "/var/lib/spockify/series")
)
XTTS_URL = os.environ.get(
    "XTTS_URL", "http://xtts.spockify.svc.cluster.local:8020"
).rstrip("/")
TARGET_LUFS = -14.0
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_FFMPEG_FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")

SFX_VERSION = 2
SFX_RATE = 16000
SFX_SLOTS: dict[str, dict[str, Any]] = {
    "nexo_beep": {"label": "Nexo beep (original)", "duration_s": 0.22},
    "engines": {"label": "Engines (original)", "duration_s": 0.80},
    "crowd": {"label": "Crowd (original)", "duration_s": 0.90},
    "stall": {"label": "Stall (original)", "duration_s": 0.55},
}

SPEAKER_ROSTER: dict[str, dict[str, Any]] = {
    "doc": {
        "label": "Doc",
        "edge_voice": "en-US-GuyNeural",
        "language": "en",
        "role": "narrator",
    },
    "frank": {
        "label": "Frank",
        "edge_voice": "en-US-DavisNeural",
        "language": "en",
        "role": "cast",
    },
    "tim": {
        "label": "Tim",
        "edge_voice": "en-GB-RyanNeural",
        "language": "en",
        "role": "cast",
    },
    "nexo": {
        "label": "Nexo",
        "edge_voice": "en-US-JasonNeural",
        "language": "en",
        "role": "cast",
    },
    "pit": {
        "label": "Pit",
        "edge_voice": "en-US-TonyNeural",
        "language": "en",
        "role": "cast",
    },
}

IDENTITY_GAP = (
    "PuLID/IP-Adapter/InstantID weights are not installed. Recurring players "
    "lock via look-still (Layout input_reference), optional clay_reference, "
    "and Union Control (control_reference). Do not claim face-id lock."
)
LATENT_MASTER_SECONDS = 10


class SeriesError(video_gen.VideoGenError):
    """Series ingest / mux / VO failure."""


def _ffmpeg_bin() -> str:
    return os.environ.get("FFMPEG", "ffmpeg")


def _ffprobe_bin() -> str:
    return os.environ.get("FFPROBE", "ffprobe")


def series_root() -> Path:
    root = SERIES_ROOT
    root.mkdir(parents=True, exist_ok=True)
    return root


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_placeholder_wav(
    path: Path, freq_hz: float, duration_s: float = 0.25, *, amp: int = 8000
) -> None:
    """PCM tone helper for tests / VO fallback. Not a licensed SFX pack."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rate = SFX_RATE
    n_frames = max(1, int(rate * duration_s))
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        frames = b"".join(
            struct.pack(
                "<h",
                int(amp * math.sin(2.0 * math.pi * freq_hz * i / rate)),
            )
            for i in range(n_frames)
        )
        handle.writeframes(frames)


def _pcm_wav(path: Path, samples: list[int], *, rate: int = SFX_RATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"".join(struct.pack("<h", max(-32767, min(32767, s))) for s in samples))


def _lcg_noise(n: int, seed: int) -> list[float]:
    x = seed & 0x7FFFFFFF
    out: list[float] = []
    for _ in range(n):
        x = (1103515245 * x + 12345) & 0x7FFFFFFF
        out.append((x / 0x7FFFFFFF) * 2.0 - 1.0)
    return out


def _synth_sfx_python(path: Path, slot: str, duration_s: float) -> None:
    """Original PCM stand-ins: beep / rumble / crowd / dying-engine, not 1-sample."""
    rate = SFX_RATE
    n = max(int(rate * duration_s), 1600)
    samples: list[int] = []
    if slot == "nexo_beep":
        for i in range(n):
            t = i / rate
            freq = 880.0 if t < duration_s * 0.55 else 1320.0
            env = min(1.0, i / (rate * 0.012), (n - i) / (rate * 0.04))
            samples.append(int(22000 * env * math.sin(2 * math.pi * freq * t)))
    elif slot == "engines":
        noise = _lcg_noise(n, 0xE061)
        acc = 0.0
        for i, nse in enumerate(noise):
            t = i / rate
            acc = 0.97 * acc + 0.03 * nse
            pulse = math.sin(2 * math.pi * 88.0 * t) + 0.35 * math.sin(2 * math.pi * 176.0 * t)
            samples.append(int(18000 * (0.55 * acc + 0.45 * pulse)))
    elif slot == "crowd":
        noise = _lcg_noise(n, 0xC20D)
        prev = 0.0
        for i, nse in enumerate(noise):
            t = i / rate
            hp = nse - prev
            prev = nse
            trem = 0.55 + 0.45 * math.sin(2 * math.pi * 7.0 * t)
            samples.append(int(14000 * hp * trem))
    else:
        noise = _lcg_noise(n, 0x57A1)
        acc = 0.0
        for i, nse in enumerate(noise):
            t = i / rate
            acc = 0.95 * acc + 0.05 * nse
            drop = max(0.05, 1.0 - t / max(duration_s, 0.01))
            freq = 210.0 * drop + 40.0
            env = drop ** 1.6
            tone = math.sin(2 * math.pi * freq * t)
            samples.append(int(20000 * env * (0.7 * tone + 0.3 * acc)))
    _pcm_wav(path, samples, rate=rate)


def _synth_sfx_ffmpeg(path: Path, slot: str, duration_s: float) -> bool:
    """ffmpeg lavfi originals. Not Nexo/commercial beds."""
    dur = f"{duration_s:.3f}"
    try:
        if slot == "nexo_beep":
            proc = _run_ffmpeg(
                [
                    "-f",
                    "lavfi",
                    "-i",
                    f"sine=frequency=880:duration={dur},afade=t=in:st=0:d=0.01,"
                    f"afade=t=out:st={max(0.0, duration_s - 0.04):.3f}:d=0.04",
                    "-ar",
                    str(SFX_RATE),
                    "-ac",
                    "1",
                    str(path),
                ]
            )
        elif slot == "engines":
            proc = _run_ffmpeg(
                [
                    "-f",
                    "lavfi",
                    "-i",
                    f"sine=frequency=88:duration={dur}",
                    "-f",
                    "lavfi",
                    "-i",
                    f"anoisesrc=color=brown:duration={dur}:amplitude=0.55",
                    "-filter_complex",
                    "[0:a]volume=0.4[a0];[1:a]lowpass=f=220,volume=2.2[a1];"
                    "[a0][a1]amix=inputs=2:duration=first,alimiter=limit=0.9",
                    "-ar",
                    str(SFX_RATE),
                    "-ac",
                    "1",
                    str(path),
                ]
            )
        elif slot == "crowd":
            proc = _run_ffmpeg(
                [
                    "-f",
                    "lavfi",
                    "-i",
                    f"anoisesrc=color=pink:duration={dur}:amplitude=0.7",
                    "-af",
                    "bandpass=f=1100:width_type=h:w=1600,tremolo=f=7:d=0.65,volume=2.4",
                    "-ar",
                    str(SFX_RATE),
                    "-ac",
                    "1",
                    str(path),
                ]
            )
        else:
            proc = _run_ffmpeg(
                [
                    "-f",
                    "lavfi",
                    "-i",
                    f"sine=frequency=200:duration={dur}",
                    "-f",
                    "lavfi",
                    "-i",
                    f"anoisesrc=color=brown:duration={dur}:amplitude=0.45",
                    "-filter_complex",
                    "[0:a]asetrate=16000*0.55,aresample=16000,afade=t=out:st=0.08:d=0.47[a0];"
                    "[1:a]lowpass=f=280,afade=t=out:st=0.15:d=0.4[a1];"
                    "[a0][a1]amix=inputs=2:duration=first",
                    "-ar",
                    str(SFX_RATE),
                    "-ac",
                    "1",
                    str(path),
                ]
            )
    except SeriesError:
        return False
    return proc.returncode == 0 and path.is_file() and path.stat().st_size > 256


def synthesize_sfx_slot(path: Path, slot: str, duration_s: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if _synth_sfx_ffmpeg(path, slot, duration_s):
        return
    _synth_sfx_python(path, slot, duration_s)


def _synth_music_bed_python(path: Path, duration_s: float = 2.0) -> None:
    rate = SFX_RATE
    n = max(int(rate * duration_s), 2000)
    freqs = (130.81, 164.81, 196.00)
    samples: list[int] = []
    for i in range(n):
        t = i / rate
        env = min(1.0, t / 0.25, (duration_s - t) / 0.35)
        mix = sum(math.sin(2 * math.pi * f * t) for f in freqs) / len(freqs)
        samples.append(int(7000 * env * mix))
    _pcm_wav(path, samples, rate=rate)


def ensure_sfx_store() -> dict[str, Any]:
    """Create original short SFX placeholders if missing or still v1 stubs."""
    root = series_root() / "sfx"
    root.mkdir(parents=True, exist_ok=True)
    registry_path = root / "registry.json"
    registry = _read_json(registry_path, {})
    if not isinstance(registry, dict):
        registry = {}
    slots = dict(registry.get("slots") or {})
    stale = int(registry.get("version") or 0) < SFX_VERSION
    for slot, spec in SFX_SLOTS.items():
        wav_path = root / f"{slot}.wav"
        row = dict(slots.get(slot) or {})
        ingested = bool(row.get("placeholder") is False) and wav_path.is_file()
        too_small = (not wav_path.is_file()) or wav_path.stat().st_size < 512
        if not ingested and (stale or too_small):
            synthesize_sfx_slot(wav_path, slot, float(spec["duration_s"]))
            row["placeholder"] = True
        slots[slot] = {
            "id": slot,
            "label": spec["label"],
            "path": str(wav_path),
            "placeholder": bool(row.get("placeholder", True)),
            "ingest": "replace the placeholder wav via POST /v1/series/sfx/{id}",
            "license": "original-synth",
        }
    registry = {
        "object": "series.sfx",
        "root": str(root),
        "version": SFX_VERSION,
        "slots": slots,
        "note": (
            "Original ffmpeg/PCM placeholders (beep/engine/crowd/stall). "
            "Ingest real stems; do not pirate Nexo/commercial beds."
        ),
    }
    _write_json(registry_path, registry)
    return registry


def sfx_path(slot: str) -> Path:
    ensure_sfx_store()
    key = (slot or "").strip().lower()
    if key not in SFX_SLOTS:
        raise SeriesError(f"unknown sfx slot: {slot}", 400)
    path = series_root() / "sfx" / f"{key}.wav"
    if not path.is_file():
        raise SeriesError(f"sfx file missing: {key}", 404)
    return path


def _speaker_row(
    speaker_id: str,
    spec: dict[str, Any],
    wav_path: Path,
    existing: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    row = dict(existing or {})
    clone_ok = wav_path.is_file() and wav_path.stat().st_size > 1000
    row.update(
        {
            "id": speaker_id,
            "label": spec.get("label") or speaker_id,
            "edge_voice": spec.get("edge_voice") or "en-US-GuyNeural",
            "language": spec.get("language") or "en",
            "role": spec.get("role") or "cast",
            "clone_wav": str(wav_path) if clone_ok else None,
            "clone_ready": clone_ok,
        }
    )
    return row


def ensure_speaker_store() -> dict[str, Any]:
    root = series_root() / "speakers"
    root.mkdir(parents=True, exist_ok=True)
    registry_path = root / "registry.json"
    registry = _read_json(registry_path, {})
    if not isinstance(registry, dict):
        registry = {}
    speakers = dict(registry.get("speakers") or {})
    for speaker_id, spec in SPEAKER_ROSTER.items():
        wav_path = root / f"{speaker_id}.wav"
        speakers[speaker_id] = _speaker_row(
            speaker_id, spec, wav_path, speakers.get(speaker_id)
        )
    for wav_path in sorted(root.glob("*.wav")):
        key = wav_path.stem.strip().lower()
        if not _SLUG_RE.match(key) or key in speakers:
            continue
        speakers[key] = _speaker_row(
            key,
            {
                "label": key.replace("-", " ").replace("_", " ").title(),
                "edge_voice": "en-US-GuyNeural",
                "language": "en",
                "role": "cast",
            },
            wav_path,
            speakers.get(key),
        )
    registry = {
        "object": "series.speakers",
        "root": str(root),
        "speakers": speakers,
        "note": (
            "LabRats roster slots (doc/frank/tim/nexo/pit). XTTS uses "
            "clone_wav only after POST /v1/series/speakers/{id}/sample. "
            "Doc stays edge-tts until a real clone wav is ingested — "
            "no invented Doc voice."
        ),
    }
    _write_json(registry_path, registry)
    return registry


def speaker_record(speaker_id: str) -> dict[str, Any]:
    roster = ensure_speaker_store()
    key = (speaker_id or "").strip().lower()
    row = (roster.get("speakers") or {}).get(key)
    if not row:
        raise SeriesError(f"unknown speaker_id: {speaker_id}", 404)
    return dict(row)


def ingest_speaker_sample(speaker_id: str, wav_bytes: bytes) -> dict[str, Any]:
    if not _SLUG_RE.match((speaker_id or "").strip().lower()):
        raise SeriesError("speaker_id must be a lowercase slug", 400)
    if not wav_bytes or len(wav_bytes) < 1000:
        raise SeriesError("speaker sample too short", 400)
    if wav_bytes[:4] not in (b"RIFF", b"fLaC", b"OggS") and wav_bytes[:2] != b"\xff\xfb":
        if wav_bytes[:4] != b"RIFF":
            LOG.info("speaker sample is not RIFF wav; storing anyway")
    key = speaker_id.strip().lower()
    if key not in SPEAKER_ROSTER:
        SPEAKER_ROSTER[key] = {
            "label": key,
            "edge_voice": "en-US-GuyNeural",
            "language": "en",
            "role": "cast",
        }
    path = series_root() / "speakers" / f"{key}.wav"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(wav_bytes)
    return speaker_record(key)


def ingest_sfx(slot: str, wav_bytes: bytes) -> dict[str, Any]:
    key = (slot or "").strip().lower()
    if key not in SFX_SLOTS:
        raise SeriesError(f"unknown sfx slot: {slot}", 400)
    if not wav_bytes or len(wav_bytes) < 64:
        raise SeriesError("sfx wav too short", 400)
    path = series_root() / "sfx" / f"{key}.wav"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(wav_bytes)
    registry = ensure_sfx_store()
    registry["slots"][key]["placeholder"] = False
    _write_json(series_root() / "sfx" / "registry.json", registry)
    return registry["slots"][key]


def music_bed_path() -> Optional[Path]:
    path = series_root() / "music" / "bed.wav"
    if path.is_file() and path.stat().st_size > 64:
        return path
    return None


def ensure_music_bed() -> dict[str, Any]:
    """Tiny original pad if no ingested bed exists. Not a commercial stem."""
    root = series_root() / "music"
    root.mkdir(parents=True, exist_ok=True)
    path = root / "bed.wav"
    placeholder = True
    if not path.is_file() or path.stat().st_size < 512:
        if not _synth_music_bed_ffmpeg(path):
            _synth_music_bed_python(path)
        placeholder = True
    else:
        placeholder = path.stat().st_size < 80_000
    return {
        "path": str(path),
        "placeholder": placeholder,
        "ingest": "replace via series/music/bed.wav (ingest-only for real beds)",
        "license": "original-synth",
    }


def _synth_music_bed_ffmpeg(path: Path) -> bool:
    try:
        proc = _run_ffmpeg(
            [
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=130.81:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=164.81:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=196:duration=2",
                "-filter_complex",
                "amix=inputs=3:duration=first,afade=t=in:d=0.25,afade=t=out:st=1.6:d=0.4,volume=0.35",
                "-ar",
                str(SFX_RATE),
                "-ac",
                "1",
                str(path),
            ]
        )
    except SeriesError:
        return False
    return proc.returncode == 0 and path.is_file() and path.stat().st_size > 256


def _run_ffmpeg(args: list[str], *, timeout_s: float = 120) -> subprocess.CompletedProcess:
    cmd = [_ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-y", *args]
    try:
        return subprocess.run(
            cmd, check=False, capture_output=True, timeout=timeout_s
        )
    except FileNotFoundError as exc:
        raise SeriesError("ffmpeg is required for mux/timeline", 503) from exc
    except subprocess.TimeoutExpired as exc:
        raise SeriesError("ffmpeg timed out", 504) from exc


def media_duration_s(path: Path) -> float:
    cmd = [
        _ffprobe_bin(),
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        str(path),
    ]
    try:
        proc = subprocess.run(cmd, check=False, capture_output=True, timeout=30)
    except FileNotFoundError as exc:
        raise SeriesError("ffprobe is required", 503) from exc
    if proc.returncode != 0:
        detail = (proc.stderr or b"").decode("utf-8", "replace")[:200]
        raise SeriesError(f"ffprobe failed: {detail or 'unknown'}", 502)
    try:
        return max(0.0, float((proc.stdout or b"0").decode().strip() or "0"))
    except ValueError as exc:
        raise SeriesError("ffprobe duration was not a number", 502) from exc


def media_size(path: Path) -> tuple[int, int]:
    cmd = [
        _ffprobe_bin(),
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        str(path),
    ]
    try:
        proc = subprocess.run(cmd, check=False, capture_output=True, timeout=30)
    except FileNotFoundError as exc:
        raise SeriesError("ffprobe is required", 503) from exc
    raw = (proc.stdout or b"").decode("utf-8", "replace").strip()
    if proc.returncode != 0 or "x" not in raw.replace(",", "x"):
        raise SeriesError("could not read media dimensions", 400)
    parts = raw.replace("x", ",").split(",")
    try:
        return int(parts[0]), int(parts[1])
    except (ValueError, IndexError) as exc:
        raise SeriesError(f"bad dimensions: {raw}", 400) from exc


def image_size(data: bytes) -> tuple[int, int]:
    """Read width/height from PNG, JPEG, or GIF without waking a GPU."""
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        w, h = struct.unpack("<HH", data[6:10])
        return int(w), int(h)
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3):
                h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                return int(w), int(h)
            if marker == 0xD8 or marker == 0xD9:
                i += 2
                continue
            if i + 3 >= len(data):
                break
            length = struct.unpack(">H", data[i + 2 : i + 4])[0]
            i += 2 + length
    raise SeriesError("look-still must be PNG, JPEG, or GIF", 400)


def legal_grids() -> dict[str, Any]:
    layout = video_limits_for("ltx-2.5-layout-to-render")
    h3 = video_limits_for("minimax-h3")
    return {
        "layout": {
            "align": 64,
            "sizes": list(layout.get("sizes") or []),
            "default_size": layout.get("default_size"),
            "model": LTX25_LAYOUT_ID,
        },
        "h3": {
            "align": 32,
            "length_grid": "17k+5",
            "sizes": list(h3.get("sizes") or []),
            "default_size": h3.get("default_size"),
            "model": MINIMAX_H3_ID,
        },
    }


def validate_asset_dims(
    width: int, height: int, *, grids: Optional[list[str]] = None
) -> dict[str, Any]:
    allowed = {item.strip().lower() for item in (grids or ["layout", "h3"]) if item}
    if not allowed:
        allowed = {"layout", "h3"}
    specs = legal_grids()
    size = f"{width}x{height}"
    hits: list[str] = []
    nearest: dict[str, str] = {}
    for name in ("layout", "h3"):
        if name not in allowed:
            continue
        catalog_sizes = [str(s) for s in (specs[name].get("sizes") or [])]
        if size in catalog_sizes:
            hits.append(name)
            continue
        align = int(specs[name]["align"])
        snapped = f"{width - (width % align)}x{height - (height % align)}"
        nearest[name] = snapped if snapped in catalog_sizes else (
            catalog_sizes[0] if catalog_sizes else snapped
        )
    if not hits:
        raise SeriesError(
            f"illegal size {size}; nearest legal grids: {nearest}",
            400,
        )
    return {"width": width, "height": height, "legal_for": hits, "nearest": nearest}


def ensure_asset_store() -> dict[str, Any]:
    root = series_root() / "assets"
    root.mkdir(parents=True, exist_ok=True)
    registry_path = root / "registry.json"
    registry = _read_json(registry_path, {})
    if not isinstance(registry, dict):
        registry = {}
    registry.setdefault("object", "series.assets")
    registry.setdefault("root", str(root))
    registry.setdefault("assets", {})
    registry["grids"] = legal_grids()
    registry["identity_gap"] = IDENTITY_GAP
    registry["identity_lock"] = identity_lock_status(look_still=True)
    _write_json(registry_path, registry)
    return registry


def ingest_asset(
    *,
    kind: str,
    asset_id: str,
    data: bytes,
    filename: str = "look.jpg",
    grids: Optional[list[str]] = None,
) -> dict[str, Any]:
    kind_key = (kind or "").strip().lower()
    if kind_key not in {"character", "location", "look-still", "look_still"}:
        raise SeriesError("kind must be character, location, or look-still", 400)
    if kind_key == "look_still":
        kind_key = "look-still"
    slug = (asset_id or "").strip().lower()
    if not _SLUG_RE.match(slug):
        raise SeriesError("asset id must be a lowercase slug", 400)
    if not data or len(data) < 32:
        raise SeriesError("asset file too small", 400)
    width, height = image_size(data)
    legal = validate_asset_dims(width, height, grids=grids)
    root = series_root() / "assets" / slug
    root.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename or "look.jpg").suffix.lower() or ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        suffix = ".jpg"
    dest = root / f"source{suffix}"
    dest.write_bytes(data)
    row = {
        "id": slug,
        "kind": kind_key,
        "path": str(dest),
        "width": width,
        "height": height,
        "legal_for": legal["legal_for"],
        "feeds": "ltx-2.5-layout-to-render input_reference" if kind_key == "look-still" else None,
        "created_at": int(time.time()),
    }
    registry = ensure_asset_store()
    assets = dict(registry.get("assets") or {})
    assets[slug] = row
    registry["assets"] = assets
    _write_json(series_root() / "assets" / "registry.json", registry)
    _write_json(root / "meta.json", row)
    return row


def get_asset(asset_id: str) -> dict[str, Any]:
    registry = ensure_asset_store()
    row = (registry.get("assets") or {}).get((asset_id or "").strip().lower())
    if not row:
        raise SeriesError(f"asset not found: {asset_id}", 404)
    return dict(row)


def asset_bytes(asset_id: str) -> tuple[bytes, str]:
    row = get_asset(asset_id)
    path = Path(str(row["path"]))
    if not path.is_file():
        raise SeriesError("asset file missing", 404)
    suffix = path.suffix.lower()
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(suffix, "application/octet-stream")
    return path.read_bytes(), mime


async def _xtts_synthesize(text: str, speaker_wav: Path, language: str) -> bytes:
    url = f"{XTTS_URL}/synthesize"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            with speaker_wav.open("rb") as handle:
                resp = await client.post(
                    url,
                    data={"text": text, "language": language},
                    files={
                        "speaker_wav": (
                            speaker_wav.name,
                            handle,
                            "audio/wav",
                        )
                    },
                )
    except httpx.HTTPError as exc:
        raise SeriesError(f"XTTS unreachable: {exc}", 503) from exc
    if resp.status_code >= 400:
        raise SeriesError(
            f"XTTS synthesize failed ({resp.status_code}): {resp.text[:200]}",
            503,
        )
    if not resp.content or len(resp.content) < 64:
        raise SeriesError("XTTS produced no audio", 502)
    return resp.content


async def _edge_tts_synthesize(text: str, voice: str) -> bytes:
    try:
        import edge_tts
    except ImportError as exc:
        raise SeriesError("edge-tts is not installed", 503) from exc

    communicate = edge_tts.Communicate(text, voice)
    chunks: list[bytes] = []
    async for item in communicate.stream():
        if item.get("type") == "audio":
            chunks.append(item["data"])
    payload = b"".join(chunks)
    if not payload:
        raise SeriesError("edge-tts produced no audio", 502)
    # edge-tts yields mp3; wrap to wav via ffmpeg when possible.
    if payload[:4] == b"RIFF":
        return payload
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.mp3"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(payload)
        proc = _run_ffmpeg(["-i", str(src), str(dst)])
        if proc.returncode != 0 or not dst.is_file():
            return payload
        return dst.read_bytes()


def _vo_dir(stem_id: str) -> Path:
    path = series_root() / "vo" / stem_id
    path.mkdir(parents=True, exist_ok=True)
    return path


async def synthesize_vo(
    *,
    text: str,
    speaker_id: str = "doc",
    language: Optional[str] = None,
) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise SeriesError("text is required", 400)
    if len(raw) > 4000:
        raw = raw[:3999] + "…"
    speaker = speaker_record(speaker_id)
    lang = (language or speaker.get("language") or "en")[:8]
    engine = "edge-tts"
    audio: Optional[bytes] = None
    clone = speaker.get("clone_wav")
    clone_path = Path(clone) if clone else None
    if clone_path is not None and clone_path.is_file():
        try:
            audio = await _xtts_synthesize(raw, clone_path, lang)
            engine = "xtts"
        except SeriesError as exc:
            LOG.warning("XTTS clone failed for %s; edge-tts fallback: %s", speaker_id, exc)
    if audio is None:
        audio = await _edge_tts_synthesize(raw, str(speaker.get("edge_voice") or "en-US-GuyNeural"))
        engine = "edge-tts"
    stem_id = "vo_" + uuid.uuid4().hex
    root = _vo_dir(stem_id)
    wav_path = root / "vo.wav"
    wav_path.write_bytes(audio)
    meta = {
        "id": stem_id,
        "object": "audio.speech",
        "created_at": int(time.time()),
        "status": "completed",
        "speaker_id": speaker["id"],
        "engine": engine,
        "language": lang,
        "text": raw,
        "path": str(wav_path),
        "bytes": len(audio),
    }
    _write_json(root / "meta.json", meta)
    return meta


def get_vo(stem_id: str) -> dict[str, Any]:
    root = series_root() / "vo" / (stem_id or "")
    meta_path = root / "meta.json"
    if not meta_path.is_file():
        raise SeriesError(f"VO stem not found: {stem_id}", 404)
    meta = _read_json(meta_path, None)
    if not isinstance(meta, dict):
        raise SeriesError("corrupt VO stem", 502)
    return meta


def vo_bytes(stem_id: str) -> bytes:
    meta = get_vo(stem_id)
    path = Path(str(meta.get("path") or ""))
    if not path.is_file():
        path = series_root() / "vo" / stem_id / "vo.wav"
    if not path.is_file():
        raise SeriesError("VO wav missing", 404)
    return path.read_bytes()


def resolve_clip_mp4(video_id: str) -> Path:
    try:
        video_gen.get_video(video_id)
        disk = video_gen._job_dir(video_id) / "clip.mp4"
        if disk.is_file():
            return disk
        stored = video_gen.get_video_bytes(video_id)
        disk.parent.mkdir(parents=True, exist_ok=True)
        disk.write_bytes(stored)
        return disk
    except video_gen.VideoGenError as exc:
        raise SeriesError(str(exc), exc.status_code) from exc


def resolve_audio_path(ref: str) -> Path:
    raw = (ref or "").strip()
    if not raw:
        raise SeriesError("audio ref is empty", 400)
    if raw.startswith("sfx:"):
        return sfx_path(raw.split(":", 1)[1])
    if raw.startswith("vo_") or raw.startswith("vo:"):
        stem = raw.split(":", 1)[-1]
        meta = get_vo(stem)
        path = Path(str(meta.get("path") or ""))
        if path.is_file():
            return path
        raise SeriesError(f"VO stem missing: {stem}", 404)
    candidate = Path(raw)
    if candidate.is_file():
        # Stay inside series / video store.
        series = series_root().resolve()
        store = video_gen._VIDEO_STORE.resolve()
        resolved = candidate.resolve()
        if series in resolved.parents or store in resolved.parents or resolved.parent in {series, store}:
            return resolved
        raise SeriesError("audio path is outside the series store", 400)
    if Path(raw).name != raw:
        raise SeriesError("audio ref must be a stem id, sfx:slot, or store path", 400)
    return sfx_path(raw)


def stitch_clips(
    clip_paths: list[Path],
    dest: Path,
    *,
    overlap_s: float = 0.5,
) -> None:
    if not clip_paths:
        raise SeriesError("at least one clip is required", 400)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if len(clip_paths) == 1:
        proc = _run_ffmpeg(["-i", str(clip_paths[0]), "-c", "copy", str(dest)])
        if proc.returncode != 0 or not dest.is_file():
            raise SeriesError("ffmpeg copy failed", 502)
        return
    overlap = max(0.0, float(overlap_s or 0.0))
    if overlap <= 0:
        with tempfile.TemporaryDirectory() as tmp:
            lst = Path(tmp) / "concat.txt"
            lst.write_text(
                "".join(
                    f"file '{path.resolve().as_posix()}'\n" for path in clip_paths
                ),
                encoding="utf-8",
            )
            proc = _run_ffmpeg(
                ["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(dest)]
            )
            if proc.returncode != 0 or not dest.is_file():
                # Re-encode fallback when codecs differ.
                proc = _run_ffmpeg(
                    [
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(lst),
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        "-an",
                        str(dest),
                    ]
                )
            if proc.returncode != 0 or not dest.is_file():
                detail = (proc.stderr or b"").decode("utf-8", "replace")[:200]
                raise SeriesError(f"ffmpeg concat failed: {detail}", 502)
        return
    current = clip_paths[0]
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for index, nxt in enumerate(clip_paths[1:], start=1):
            out = dest if index == len(clip_paths) - 1 else tmp_path / f"xfade_{index}.mp4"
            dur = media_duration_s(current)
            offset = max(0.0, dur - overlap)
            graph = (
                f"[0:v][1:v]xfade=transition=fade:duration={overlap:.3f}:"
                f"offset={offset:.3f}[v]"
            )
            proc = _run_ffmpeg(
                [
                    "-i",
                    str(current),
                    "-i",
                    str(nxt),
                    "-filter_complex",
                    graph,
                    "-map",
                    "[v]",
                    "-an",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(out),
                ]
            )
            if proc.returncode != 0 or not out.is_file():
                detail = (proc.stderr or b"").decode("utf-8", "replace")[:200]
                raise SeriesError(f"ffmpeg xfade failed: {detail}", 502)
            current = out
        if current != dest:
            dest.write_bytes(current.read_bytes())


def _apply_titles(src: Path, dest: Path, titles: list[dict[str, Any]]) -> bool:
    if not titles or not _FFMPEG_FONT.is_file():
        return False
    chain = "[0:v]"
    filters: list[str] = []
    last = "0:v"
    applied = False
    for i, title in enumerate(titles):
        text = str(title.get("text") or "").replace("\\", "\\\\").replace("'", r"\'")
        if not text:
            continue
        start = max(0.0, float(title.get("at") or 0.0))
        dur = max(0.2, float(title.get("duration") or 2.0))
        out = f"t{i}"
        src_label = chain if i == 0 else f"[{last}]"
        filters.append(
            f"{src_label}drawtext=fontfile={_FFMPEG_FONT}:text='{text}':"
            f"fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-80:"
            f"enable='between(t,{start},{start + dur})'[{out}]"
        )
        last = out
        applied = True
    if not applied:
        return False
    proc = _run_ffmpeg(
        [
            "-i",
            str(src),
            "-filter_complex",
            ";".join(filters),
            "-map",
            f"[{last}]",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(dest),
        ]
    )
    if proc.returncode != 0 or not dest.is_file():
        detail = (proc.stderr or b"").decode("utf-8", "replace")[:200]
        LOG.warning("titles skipped: %s", detail)
        return False
    return True


def mux_vo_sfx(
    silent_mp4: Path,
    dest: Path,
    *,
    vo_path: Optional[Path] = None,
    sfx: Optional[list[dict[str, Any]]] = None,
    music_path: Optional[Path] = None,
    titles: Optional[list[dict[str, Any]]] = None,
    lufs: float = TARGET_LUFS,
    duck: bool = True,
) -> dict[str, Any]:
    """Mux silent picture + VO + SFX (+ optional music bed) and loudnorm."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    sfx_cues = list(sfx or [])
    if music_path is None:
        music_path = music_bed_path()
    music_used = bool(music_path and music_path.is_file())
    title_rows = list(titles or [])

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        picture = tmp / "picture.mp4"
        titles_applied = _apply_titles(silent_mp4, picture, title_rows)
        if not titles_applied:
            picture = silent_mp4

        mix_wav = tmp / "mix.wav"
        inputs: list[str] = []
        filters: list[str] = []
        delayed: list[str] = []
        idx = 0
        vo_label = None
        if vo_path is not None and vo_path.is_file():
            inputs += ["-i", str(vo_path)]
            vo_label = "a_vo"
            filters.append(
                f"[{idx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[{vo_label}]"
            )
            delayed.append(vo_label)
            idx += 1
        for cue in sfx_cues:
            slot = str(cue.get("slot") or cue.get("id") or "")
            path = sfx_path(slot)
            delay_ms = int(max(0.0, float(cue.get("at") or 0.0)) * 1000)
            inputs += ["-i", str(path)]
            lab = f"a_sfx_{idx}"
            filters.append(
                f"[{idx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,"
                f"adelay={delay_ms}|{delay_ms}[{lab}]"
            )
            delayed.append(lab)
            idx += 1
        if music_used:
            inputs += ["-i", str(music_path)]
            lab = "a_bed"
            if duck and vo_label:
                filters.append(
                    f"[{idx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bedraw];"
                    f"[bedraw][{vo_label}]sidechaincompress=threshold=0.05:ratio=8:attack=50:release=300[{lab}]"
                )
            else:
                filters.append(
                    f"[{idx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.18[{lab}]"
                )
            delayed.append(lab)
            idx += 1

        if delayed:
            if len(delayed) == 1:
                mixed = delayed[0]
            else:
                ins = "".join(f"[{lab}]" for lab in delayed)
                filters.append(
                    f"{ins}amix=inputs={len(delayed)}:normalize=0:duration=longest[a_mix]"
                )
                mixed = "a_mix"
            filters.append(f"[{mixed}]loudnorm=I={lufs:.1f}:TP=-1.5:LRA=11[a_out]")
            proc = _run_ffmpeg(
                [
                    *inputs,
                    "-filter_complex",
                    ";".join(filters),
                    "-map",
                    "[a_out]",
                    str(mix_wav),
                ]
            )
            if proc.returncode != 0 or not mix_wav.is_file():
                detail = (proc.stderr or b"").decode("utf-8", "replace")[:300]
                raise SeriesError(f"ffmpeg audio mix failed: {detail}", 502)
            proc = _run_ffmpeg(
                [
                    "-i",
                    str(picture),
                    "-i",
                    str(mix_wav),
                    "-map",
                    "0:v",
                    "-map",
                    "1:a",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    str(dest),
                ],
                timeout_s=300,
            )
        else:
            proc = _run_ffmpeg(
                [
                    "-i",
                    str(picture),
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-an",
                    str(dest),
                ]
            )
        if proc.returncode != 0 or not dest.is_file():
            detail = (proc.stderr or b"").decode("utf-8", "replace")[:300]
            raise SeriesError(f"ffmpeg mux failed: {detail}", 502)

    return {
        "vo": vo_path is not None,
        "sfx": [str(c.get("slot") or "") for c in sfx_cues],
        "music_bed": music_used,
        "titles_applied": titles_applied,
        "lufs": lufs,
    }


def _new_ffmpeg_job(kind: str, prompt: str, extra: Optional[dict[str, Any]] = None) -> str:
    video_id = "video_" + uuid.uuid4().hex
    meta = {
        "id": video_id,
        "object": "video",
        "created_at": int(time.time()),
        "status": "queued",
        "model": kind,
        "progress": 0,
        "prompt": prompt,
        "worker": "ffmpeg",
        "audio": True,
    }
    if extra:
        meta.update(extra)
    video_gen._remember(video_id, {"meta": meta, "mp4": None})
    return video_id


async def _run_ffmpeg_job(video_id: str, runner) -> None:
    record = video_gen._CLIPS.get(video_id)
    if not record:
        return
    meta = record["meta"]
    if video_gen._job_cancelled(video_id):
        return
    try:
        meta["status"] = "in_progress"
        meta["progress"] = 10
        video_gen._persist_job(video_id, record)
        dest = video_gen._job_dir(video_id) / "clip.mp4"
        await asyncio.to_thread(runner, dest)
        if video_gen._job_cancelled(video_id):
            return
        if not dest.is_file():
            raise SeriesError("ffmpeg produced no mp4", 502)
        raw = dest.read_bytes()
        record["mp4"] = raw
        meta["status"] = "completed"
        meta["progress"] = 100
        video_gen._persist_job(video_id, record)
    except asyncio.CancelledError:
        if meta.get("status") not in ("cancelled", "failed"):
            meta["status"] = "cancelled"
            meta["error"] = {"message": "cancelled"}
            video_gen._persist_job(video_id, record)
        raise
    except Exception as exc:  # noqa: BLE001
        if meta.get("status") == "cancelled":
            return
        LOG.warning("series job %s failed: %s", video_id, exc)
        meta["status"] = "failed"
        meta["error"] = {"message": str(exc)}
        video_gen._persist_job(video_id, record)


def enqueue_mux(
    *,
    video_id: str,
    vo: Optional[str] = None,
    sfx: Optional[list[dict[str, Any]]] = None,
    music_bed: Optional[str] = None,
    titles: Optional[list[dict[str, Any]]] = None,
    lufs: float = TARGET_LUFS,
) -> dict[str, Any]:
    clip = resolve_clip_mp4(video_id)
    vo_path = Path(get_vo(vo)["path"]) if vo else None
    music_path = Path(music_bed) if music_bed else None
    if music_bed and not (music_path and music_path.is_file()):
        music_path = music_bed_path()
    job_id = _new_ffmpeg_job(
        "series-mux",
        f"mux {video_id}",
        {
            "source_video": video_id,
            "vo": vo,
            "sfx": sfx or [],
            "lufs": lufs,
        },
    )

    def _run(dest: Path) -> None:
        mux_vo_sfx(
            clip,
            dest,
            vo_path=vo_path,
            sfx=sfx,
            music_path=music_path if music_path and music_path.is_file() else None,
            titles=titles,
            lufs=lufs,
        )

    task = asyncio.create_task(_run_ffmpeg_job(job_id, _run))
    video_gen._bind_job_task(job_id, task)
    return video_gen.get_video(job_id)


def enqueue_extend_stitch(
    *,
    clips: list[str],
    overlap_s: float = 0.5,
    vo: Optional[str] = None,
    sfx: Optional[list[dict[str, Any]]] = None,
    lufs: float = TARGET_LUFS,
) -> dict[str, Any]:
    if not clips or len(clips) < 2:
        raise SeriesError("extend stitch needs at least two clip ids", 400)
    paths = [resolve_clip_mp4(item) for item in clips]
    job_id = _new_ffmpeg_job(
        "series-extend",
        f"xfade {','.join(clips)}",
        {"clips": clips, "overlap_s": overlap_s, "worker": "ffmpeg"},
    )

    def _run(dest: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            silent = Path(tmp) / "silent.mp4"
            stitch_clips(paths, silent, overlap_s=overlap_s)
            vo_path = Path(get_vo(vo)["path"]) if vo else None
            mux_vo_sfx(silent, dest, vo_path=vo_path, sfx=sfx, lufs=lufs)

    task = asyncio.create_task(_run_ffmpeg_job(job_id, _run))
    video_gen._bind_job_task(job_id, task)
    return video_gen.get_video(job_id)


def enqueue_timeline(
    *,
    clips: list[str],
    vo: Optional[str] = None,
    vo_text: Optional[str] = None,
    speaker_id: str = "doc",
    sfx: Optional[list[dict[str, Any]]] = None,
    titles: Optional[list[dict[str, Any]]] = None,
    overlap_s: float = 0.5,
    music_bed: Optional[str] = None,
    lufs: float = TARGET_LUFS,
) -> dict[str, Any]:
    if not clips:
        raise SeriesError("clips is required", 400)
    paths = [resolve_clip_mp4(item) for item in clips]
    job_id = _new_ffmpeg_job(
        "series-timeline",
        f"timeline {len(clips)} clips",
        {
            "clips": clips,
            "overlap_s": overlap_s,
            "lufs": lufs,
            "sfx": sfx or [],
            "titles": titles or [],
        },
    )

    async def _job() -> None:
        stem = vo
        if vo_text and not stem:
            meta = await synthesize_vo(text=vo_text, speaker_id=speaker_id)
            stem = meta["id"]
            record = video_gen._CLIPS.get(job_id)
            if record:
                record["meta"]["vo"] = stem
                video_gen._persist_job(job_id, record)

        def _run(dest: Path) -> None:
            with tempfile.TemporaryDirectory() as tmp:
                silent = Path(tmp) / "silent.mp4"
                stitch_clips(paths, silent, overlap_s=overlap_s if len(paths) > 1 else 0.0)
                vo_path = Path(get_vo(stem)["path"]) if stem else None
                music_path = Path(music_bed) if music_bed else music_bed_path()
                mux_vo_sfx(
                    silent,
                    dest,
                    vo_path=vo_path,
                    sfx=sfx,
                    music_path=music_path if music_path and music_path.is_file() else None,
                    titles=titles,
                    lufs=lufs,
                )

        await _run_ffmpeg_job(job_id, _run)

    task = asyncio.create_task(_job())
    video_gen._bind_job_task(job_id, task)
    return video_gen.get_video(job_id)


def catalog_policy() -> dict[str, Any]:
    layout = video_limits_for("ltx-2.5-layout-to-render")
    h3 = video_limits_for("minimax-h3")
    lock = identity_lock_status(look_still=True)
    return {
        "a_camera": {
            "id": LTX25_LAYOUT_ID,
            "size": layout.get("default_size"),
            "audio": False,
            "audio_ignored": True,
            "max_seconds": layout.get("max_seconds") or LATENT_MASTER_SECONDS,
            "series_role": layout.get("series_role"),
            "identity_lock": lock,
            "identity_gap": layout.get("identity_gap") or IDENTITY_GAP,
        },
        "atmos_scratch": {
            "id": MINIMAX_H3_ID,
            "series_role": h3.get("series_role"),
            "audio_supported": True,
            "max_seconds": h3.get("max_seconds"),
        },
        "audio_vae": {
            "file": LTX25_AUDIO_VAE,
            "wired": False,
            "reason": (
                "ltx-2.5-audio-vae-bf16 is on disk; unwired. A-camera stays "
                "silent. Episode VO is XTTS mux (H3 is atmos/scratch only)."
            ),
        },
        "identity_lock": lock,
        "identity_gap": IDENTITY_GAP,
        "longer_master": {
            "latent_max_seconds": LATENT_MASTER_SECONDS,
            "path": "POST /v1/videos/timeline",
            "note": (
                "Keep 10s Layout latents. Concat/xfade 10s A-camera "
                "clips for longer masters. Not a 60s latent."
            ),
        },
        "target_lufs": TARGET_LUFS,
        "speakers": list(SPEAKER_ROSTER),
    }
