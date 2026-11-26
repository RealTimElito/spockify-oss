"""Pure helpers for LatentSync face gaps and short process errors.

Imported by the Comfy node and by latentsync_entry. No torch, no Comfy.
"""

from __future__ import annotations

from typing import Sequence, TypeVar

T = TypeVar("T")

# yuv420p rejects odd width or height (1085x1450). Floor by one pixel.
# This is a crop, not an upscale.
EVEN_YUV420_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2"

_CKPT_NOISE = (
    "inference_ckpt_path",
    "checkpoints/latentsync_unet.pt",
)


def fill_missed_faces(slots: Sequence[T | None]) -> tuple[list[T], int, int]:
    """Reuse the nearest detected face for frames the detector missed.

    Earlier frames keep the last good detection. Leading misses, before any
    detection, reuse the first detection. A clip with no detection at all
    still fails, and the message does not mention the checkpoint path.
    """
    total = len(slots)
    filled: list[T | None] = []
    last: T | None = None
    hits = 0
    carried = 0
    leading = 0
    for item in slots:
        if item is None:
            if last is None:
                leading += 1
                filled.append(None)
            else:
                filled.append(last)
                carried += 1
            continue
        last = item
        hits += 1
        filled.append(item)
    if hits == 0:
        raise RuntimeError(
            f"Face not detected in any of {total} frames. "
            "The checkpoint loaded; this plate has no detectable face."
        )
    if leading:
        first = next(item for item in filled if item is not None)
        for index in range(leading):
            filled[index] = first
            carried += 1
    ready = [item for item in filled if item is not None]
    return ready, hits, carried


def failure_detail(
    stderr: str | None,
    stdout: str | None,
    code: int,
    *,
    prefix: str,
) -> str:
    """One line a job meta can store without looking like a missing checkpoint.

    Process argv echoes ``checkpoints/latentsync_unet.pt``. A 300-character
    prefix of that command hid ``Face not detected`` and odd-dimension ffmpeg
    errors. Prefer those lines. Otherwise keep the tail, not the argv head.
    """
    lines = [
        line.strip()
        for line in f"{stderr or ''}\n{stdout or ''}".splitlines()
        if line.strip()
    ]
    preferred: list[str] = []
    for line in lines:
        low = line.lower()
        if (
            "face not detected" in low
            or "not divisible by 2" in low
            or "width not divisible" in low
            or "height not divisible" in low
            or low.startswith("runtimeerror")
            or low.startswith("error")
        ):
            preferred.append(line)
    if preferred:
        return _clip(f"{prefix}: {preferred[-1]}")
    useful = [
        line
        for line in lines
        if not any(token in line for token in _CKPT_NOISE)
    ]
    tail = (useful or lines)[-4:]
    if not tail:
        return f"{prefix}: exit {code}"
    return _clip(f"{prefix}: " + " | ".join(tail))


def _clip(text: str, limit: int = 700) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[-limit:]


def install_face_carry_forward() -> bool:
    """Patch LipsyncPipeline so one missed frame does not abort the clip."""
    try:
        from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline
    except Exception as exc:
        print(f"Face carry-forward not installed: {exc}", flush=True)
        return False
    current = LipsyncPipeline.affine_transform_video
    if getattr(current, "_spockify_carry", False):
        return True

    def affine_transform_video(self, video_frames):
        import torch

        slots = []
        for frame in video_frames:
            try:
                slots.append(self.image_processor.affine_transform(frame))
            except RuntimeError as exc:
                if "face not detected" not in str(exc).lower():
                    raise
                slots.append(None)
        filled, hits, carried = fill_missed_faces(slots)
        if carried:
            print(
                f"Face carry-forward: detected {hits}/{len(slots)} frames; "
                f"reused a detected face on {carried} frame(s).",
                flush=True,
            )
        faces, boxes, affines = zip(*filled)
        return torch.stack(list(faces)), list(boxes), list(affines)

    affine_transform_video._spockify_carry = True  # type: ignore[attr-defined]
    LipsyncPipeline.affine_transform_video = affine_transform_video
    return True
