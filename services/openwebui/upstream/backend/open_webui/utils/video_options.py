"""Per-turn video length options for ComfyUI LTX-Video (T2V / I2V).

LTX graphs use fixed fps=24 (LTXVConditioning.frame_rate + CreateVideo.fps).
Frame counts follow the common 8n+1 constraint used by EmptyLTXVLatentVideo /
LTXVImgToVideo. Default 65 matches the baked workflow + VIDEO_LENGTH env.
"""

from __future__ import annotations

# Matches LTXVConditioning.frame_rate / CreateVideo.fps in both ConfigMaps.
VIDEO_FPS = 24

# Duration chips → EmptyLTXVLatentVideo.length / LTXVImgToVideo.length.
DURATION_LENGTHS: dict[str, int] = {
    'short': 25,  # ~1.0s at 24fps (8*3+1)
    'default': 65,  # ~2.7s at 24fps (8*8+1) — current cluster default
    'long': 241,  # ~10.0s at 24fps (8*30+1); nearest 8n+1 to 24*10
}

DEFAULT_DURATION = 'default'


def normalize_duration(value: str | None) -> str:
    key = (value or DEFAULT_DURATION).strip().lower()
    return key if key in DURATION_LENGTHS else DEFAULT_DURATION


def resolve_video_length(duration: str | None, fallback: int | None = None) -> int:
    """Map a duration chip id to frame count.

    When *duration* is missing/unknown and *fallback* is set (e.g. VIDEO_LENGTH
    env), use that so deploy defaults stay authoritative without a chip.
    """
    if duration is None or (isinstance(duration, str) and not duration.strip()):
        if fallback is not None:
            return int(fallback)
        return DURATION_LENGTHS[DEFAULT_DURATION]
    key = duration.strip().lower()
    if key not in DURATION_LENGTHS:
        if fallback is not None:
            return int(fallback)
        return DURATION_LENGTHS[DEFAULT_DURATION]
    return DURATION_LENGTHS[key]


def frames_to_seconds(length: int, fps: int = VIDEO_FPS) -> float:
    if fps <= 0:
        return 0.0
    return length / float(fps)
