"""Per-turn video Model / Length / Resolution for ComfyUI LTX + friends.

Length chips map to OpenAI ``seconds`` (router ``snap_length``). Chat still
injects frame counts into EmptyLTXVLatentVideo / LTXVImgToVideo (8n+1 @ 24fps).
Default 65 frames (~2.7s) matches VIDEO_LENGTH when the chip is ``3``.
"""

from __future__ import annotations

from open_webui.utils.images.catalog import DEFAULT_VIDEO_ID

# Matches LTXVConditioning.frame_rate / CreateVideo.fps in both ConfigMaps.
VIDEO_FPS = 24

DEFAULT_VIDEO_MODEL = DEFAULT_VIDEO_ID
DEFAULT_SECONDS = '3'
DEFAULT_SIZE = '704x480'

# Composer Length → API seconds string (includes MiniMax 15s).
SECONDS_CHOICES = frozenset({'1', '3', '5', '10', '15'})

# Legacy duration chips → seconds (localStorage / older clients).
_LEGACY_DURATION_TO_SECONDS = {
    'short': '1',
    'default': '3',
    'long': '10',
}

# Duration chips → EmptyLTXVLatentVideo.length (kept for tests / fallback).
# MiniMax uses its own 17k+5 grid in the router; chat path still maps chips here.
DURATION_LENGTHS: dict[str, int] = {
    'short': 25,  # ~1.0s at 24fps (8*3+1)
    'default': 65,  # ~2.7s at 24fps (8*8+1)
    'long': 241,  # ~10.0s at 24fps (8*30+1)
    '1': 25,
    '3': 65,
    '5': 121,  # 8*15+1 ≈ 5.0s
    '10': 241,
    '15': 361,  # 8*45+1 ≈ 15.0s (LTX-style; MiniMax snaps in router)
}

DEFAULT_DURATION = 'default'

SIZE_CHOICES = frozenset({'704x480', '768x512', '512x768', '1344x768'})


def normalize_seconds(value: str | None) -> str:
    raw = (value or DEFAULT_SECONDS).strip().lower()
    if raw in _LEGACY_DURATION_TO_SECONDS:
        return _LEGACY_DURATION_TO_SECONDS[raw]
    return raw if raw in SECONDS_CHOICES else DEFAULT_SECONDS


def normalize_duration(value: str | None) -> str:
    """Map a chip id to a known duration/seconds key."""
    key = (value or DEFAULT_DURATION).strip().lower()
    if key in DURATION_LENGTHS:
        return key
    return DEFAULT_DURATION


def normalize_size(value: str | None) -> str:
    raw = (value or DEFAULT_SIZE).strip().lower()
    if raw in SIZE_CHOICES:
        return raw
    if 'x' in raw:
        try:
            w_s, h_s = raw.split('x', 1)
            int(w_s)
            int(h_s)
            return raw
        except ValueError:
            pass
    return DEFAULT_SIZE


def parse_size(size: str | None) -> tuple[int, int]:
    """Return width, height for a size chip (WxH)."""
    raw = normalize_size(size)
    w_s, h_s = raw.split('x', 1)
    return int(w_s), int(h_s)


def seconds_to_frames(seconds: str | float | int | None, fallback: int | None = None) -> int:
    """Map API-style seconds to an LTX 8n+1 frame count @ 24fps.

    Known composer chips (``1``/``3``/``5``/``10``) use fixed lengths that match
    the baked Spark default (65 for ``~3s``). Other numeric values snap like
    router ``snap_length``.
    """
    if seconds is None or (isinstance(seconds, str) and not seconds.strip()):
        if fallback is not None:
            return int(fallback)
        return DURATION_LENGTHS['3']
    if isinstance(seconds, str):
        key = seconds.strip().lower()
        if key in _LEGACY_DURATION_TO_SECONDS:
            key = _LEGACY_DURATION_TO_SECONDS[key]
        if key in DURATION_LENGTHS:
            return DURATION_LENGTHS[key]
    try:
        sec = float(seconds)
    except (TypeError, ValueError):
        key = normalize_seconds(str(seconds) if seconds is not None else None)
        return DURATION_LENGTHS.get(key, DURATION_LENGTHS['3'])
    if sec <= 0:
        if fallback is not None:
            return int(fallback)
        return DURATION_LENGTHS['3']
    # Exact chip values stay on the product table (3 → 65, not snap 73).
    as_int = str(int(sec)) if float(sec).is_integer() else None
    if as_int and as_int in DURATION_LENGTHS:
        return DURATION_LENGTHS[as_int]
    frames = int(round(sec * VIDEO_FPS))
    groups = max(1, round((frames - 1) / 8))
    return max(17, min(8 * groups + 1, 241))


def resolve_video_length(duration: str | None, fallback: int | None = None) -> int:
    """Map a duration/seconds chip id to frame count.

    When *duration* is missing/unknown and *fallback* is set (e.g. VIDEO_LENGTH
    env), use that so deploy defaults stay authoritative without a chip.
    """
    if duration is None or (isinstance(duration, str) and not duration.strip()):
        if fallback is not None:
            return int(fallback)
        return DURATION_LENGTHS[DEFAULT_DURATION]
    key = duration.strip().lower()
    if key in _LEGACY_DURATION_TO_SECONDS:
        key = _LEGACY_DURATION_TO_SECONDS[key]
    if key not in DURATION_LENGTHS:
        # Numeric seconds string from the new chips.
        if key.replace('.', '', 1).isdigit():
            return seconds_to_frames(key, fallback=fallback)
        if fallback is not None:
            return int(fallback)
        return DURATION_LENGTHS[DEFAULT_DURATION]
    return DURATION_LENGTHS[key]


def frames_to_seconds(length: int, fps: int = VIDEO_FPS) -> float:
    if fps <= 0:
        return 0.0
    return length / float(fps)


def normalize_video_model(value: str | None) -> str:
    raw = (value or '').strip()
    return raw if raw else DEFAULT_VIDEO_MODEL
