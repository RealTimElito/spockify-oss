"""Cartoon pipeline: Qwen Image sprite grid → slice → Wan FLF → Wan VACE edit.

Stages (first-class):
  1. sprite_grid  — Qwen-Image contact sheet (2×2 or 3×3) on one canvas
  2. slice        — deterministic equal-tile crop, L→R then T→B
  3. flf          — adjacent or first/last tiles → Wan 2.1 FLF2V
  4. video_edit   — Wan 2.1 VACE 1.3B motion-coherent V2V restyle (not Qwen)

LabRats LatentSync dialogue and MiniMax H3 atmos paths are untouched.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import cartoon_contracts
import cartoon_packs
import image_gen
import video_gen
from image_models import (
    QWEN_ID,
    WAN21_FLF_ID,
    WAN21_VACE_ID,
    WAN21_VACE_UNET,
    qwen_image_runnable,
)
from open_jealousy import scan_open_jealousy

LOG = logging.getLogger("spockify.cartoon")

CARTOON_ROOT = Path(
    os.environ.get("SPOCKIFY_CARTOON_ROOT", "/var/lib/spockify/cartoon")
)

# Contact-sheet canvases sized for multi-panel consistency (Qwen up to 2K).
GRID_PRESETS: dict[str, dict[str, Any]] = {
    "2x2": {
        "cols": 2,
        "rows": 2,
        "canvas": "1536x1536",
        "panels": 4,
        "label": "2×2 contact sheet",
    },
    "3x3": {
        "cols": 3,
        "rows": 3,
        "canvas": "1536x1536",
        "panels": 9,
        "label": "3×3 contact sheet",
    },
}

PAIR_MODES = ("first_last", "adjacent")

# Proven short-beat Wan FLF canvas on Spark GB10. Full 1280x720 is still the
# catalog native for Wan, but 2s FLF at that size has stalled mid-sample
# (~78%) through the 2400s poll; completed hobby beats used 768x704. This is
# not a relabel of 720p — size_native stays whatever Comfy actually sampled.
SHORT_BEAT_VIDEO_SIZE = "768x704"

# Honest edit candidates — VACE is the installable path on ~60 GiB free.
VIDEO_EDIT_CANDIDATES: list[dict[str, Any]] = [
    {
        "id": WAN21_VACE_ID,
        "name": "Wan 2.1 VACE 1.3B",
        "approx_gb": 4.1,
        "vendor": "Alibaba Tongyi Wan (not Qwen)",
        "notes": (
            "Open-weight motion-coherent V2V / restyle via Comfy WanVaceToVideo. "
            "Preferred when disk is tight. Do not brand as Qwen."
        ),
    },
    {
        "id": "qwen-video-edit",
        "name": "Qwen-Video-Edit",
        "approx_gb": 55,
        "vendor": "Qwen-Image-Edit DiT on Wan 2.1 latents",
        "notes": (
            "True instruction latent video edit (yunpeng1998/Qwen-Video-Edit). "
            "Needs ~55 GiB base weights plus checkpoints — still too large to "
            "install without wiping LabRats/Open Jealousy models."
        ),
    },
]

_STYLE_DEFAULT = (
    "clean 2D cartoon cel animation, flat colors, crisp line art, "
    "readable silhouettes, consistent character sheet"
)


class CartoonError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _have_ffmpeg() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def normalize_grid(raw: Optional[str]) -> str:
    key = (raw or "2x2").strip().lower().replace("×", "x")
    key = re.sub(r"\s+", "", key)
    if key in {"2", "four", "2by2"}:
        key = "2x2"
    if key in {"3", "nine", "3by3"}:
        key = "3x3"
    if key not in GRID_PRESETS:
        raise CartoonError(
            f"Unsupported grid {raw!r}. Use 2x2 or 3x3.",
            400,
        )
    return key


def normalize_pair_mode(raw: Optional[str]) -> str:
    mode = (raw or "first_last").strip().lower().replace("-", "_")
    if mode in {"firstlast", "ends", "flf"}:
        mode = "first_last"
    if mode in {"adj", "sequence", "chain"}:
        mode = "adjacent"
    if mode not in PAIR_MODES:
        raise CartoonError(
            f"Unsupported pair_mode {raw!r}. Use first_last or adjacent.",
            400,
        )
    return mode


def build_sprite_prompt(
    prompt: str,
    *,
    grid: str = "2x2",
    style: Optional[str] = None,
) -> str:
    """Dedicated contact-sheet prompt so Qwen keeps one character across tiles."""
    grid_key = normalize_grid(grid)
    preset = GRID_PRESETS[grid_key]
    cols = int(preset["cols"])
    rows = int(preset["rows"])
    n = int(preset["panels"])
    style_text = (style or "").strip() or _STYLE_DEFAULT
    subject = (prompt or "").strip()
    if not subject:
        raise CartoonError("prompt is required", 400)
    if len(subject) > 3500:
        raise CartoonError("prompt too long (max 3500 chars)", 400)
    return (
        f"Create a single-canvas {cols}×{rows} cartoon contact sheet "
        f"(sprite / frame grid) with exactly {n} equal rectangular panels "
        f"arranged left-to-right, top-to-bottom. "
        f"Thin clean gutters or panel borders; no overlapping panels. "
        f"Same character design, colors, line weight, and proportions in every panel. "
        f"Sequential poses telling one short action beat "
        f"(panel 1 top-left through panel {n} bottom-right). "
        f"Subject / action: {subject}. "
        f"Style: {style_text}. "
        f"No text, captions, watermarks, UI chrome, or logos."
    )


def canvas_for_grid(grid: str = "2x2") -> str:
    return str(GRID_PRESETS[normalize_grid(grid)]["canvas"])


def video_edit_status() -> dict[str, Any]:
    """Cold status — disk scan only, no Comfy wake."""
    root = Path(os.environ.get("SPOCKIFY_IMAGE_MODELS_ROOT", "/var/lib/spockify/comfyui"))
    hits: list[str] = []
    vace_ready = False
    if root.is_dir():
        for path in root.rglob("*"):
            name = path.name.lower()
            if not path.is_file():
                continue
            if path.name.endswith(".partial"):
                continue
            if (
                "vace" in name
                or "qwen-video-edit" in name
                or "qwen_video_edit" in name
            ):
                hits.append(str(path.relative_to(root)))
            if path.name == WAN21_VACE_UNET or name == WAN21_VACE_UNET.lower():
                vace_ready = path.stat().st_size > 1_000_000_000
    # Prefer explicit VACE unet + companions when the catalog row is ready.
    try:
        from image_models import list_video_checkpoints

        for row in list_video_checkpoints():
            if row.get("id") == WAN21_VACE_ID and row.get("runnable"):
                vace_ready = True
                break
    except Exception as exc:  # pragma: no cover - catalog optional at import
        LOG.debug("video edit catalog scan skipped: %s", exc)
    available = bool(vace_ready or hits)
    active = WAN21_VACE_ID if vace_ready else None
    return {
        "available": available,
        "supported": available,
        "ready": bool(vace_ready),
        "id": "video_edit",
        "model": active,
        "vendor": "Wan VACE (not Qwen)" if vace_ready else None,
        "installed_files": hits[:20],
        "reason": (
            None
            if available
            else (
                "No Qwen-Video-Edit or Wan2.1-VACE weights/nodes on disk. "
                "Keyframe→FLF ships without restyle; install a candidate when "
                "disk allows (prefer VACE-1.3B ~4 GiB — not Qwen-branded)."
            )
        ),
        "candidates": list(VIDEO_EDIT_CANDIDATES),
    }


def identity_lock_report(
    image_labels: list[str],
    *,
    pack_ids: bool = False,
) -> dict[str, Any]:
    """Say whether the sprite grid actually saw reference images.

    Pack ids are metadata only (no pixels). A prompt-only grid is
    ``edit-only`` so clients are not told a lock ran.
    """
    labels = [str(item) for item in image_labels if item]
    if labels:
        return {
            "identity_lock": "qwen-reference",
            "identity_conditioned": True,
            "identity_images": labels,
            "identity_lock_detail": (
                "The Qwen sprite-grid step received these images as "
                "encoder references (images.image_1, then images.image_2). "
                "Pack ids are not pixels."
            ),
        }
    detail = (
        "Identity lock is edit-only on this call: the sprite grid was "
        "prompt-only. Upload character_plate and background "
        "(POST /v1/cartoon multipart, or POST /v1/images/edits). "
        "Pack ids do not condition the grid."
    )
    if pack_ids:
        detail = (
            "character_pack_id / style_pack_id do not contain image bytes, "
            "so they were not sent to Qwen. " + detail
        )
    return {
        "identity_lock": "edit-only",
        "identity_conditioned": False,
        "identity_images": [],
        "identity_lock_detail": detail,
    }


def _guard_commercial_export(commercial_export: Any) -> None:
    try:
        flag = cartoon_contracts.as_bool(commercial_export)
    except ValueError as exc:
        raise CartoonError(str(exc), 400) from exc
    blocked = cartoon_contracts.commercial_block_reason(flag)
    if blocked:
        raise CartoonError(blocked, 403)


def catalog_policy() -> dict[str, Any]:
    """Cold cartoon contract for clients / OWUI (+ menu)."""
    oj = scan_open_jealousy()
    qwen_ok = bool(qwen_image_runnable())
    flf_ok = bool(oj.get("flf_installed"))
    edit = video_edit_status()
    policy = {
        "object": "spockify.cartoon.policy",
        "pipeline": [
            {
                "id": "sprite_grid",
                "name": "Qwen Image sprite / contact sheet",
                "model": QWEN_ID,
                "ready": qwen_ok,
                "grids": list(GRID_PRESETS.keys()),
                "canvases": {k: v["canvas"] for k, v in GRID_PRESETS.items()},
            },
            {
                "id": "slice",
                "name": "Deterministic grid crop",
                "ready": True,
                "order": "left-to-right, top-to-bottom",
            },
            {
                "id": "flf",
                "name": "Wan 2.1 FLF2V first→last (or adjacent pairs)",
                "model": WAN21_FLF_ID,
                "ready": flf_ok,
                "pair_modes": list(PAIR_MODES),
            },
            {
                "id": "video_edit",
                "name": "Wan 2.1 VACE 1.3B motion-coherent V2V",
                "model": WAN21_VACE_ID,
                "ready": bool(edit.get("ready")),
                "available": bool(edit.get("available")),
                "vendor": "Wan (not Qwen)",
                "reason": edit.get("reason"),
                "candidates": edit.get("candidates"),
            },
        ],
        "defaults": {
            "grid": "2x2",
            "pair_mode": "first_last",
            "image_model": QWEN_ID,
            "video_model": WAN21_FLF_ID,
            "edit_model": WAN21_VACE_ID,
            "seconds": 2,
            "size": "1280x720",
            "edit_size": "832x480",
        },
        "notes": (
            "Cartoon path is sprite-grid → slice → FLF → optional Wan VACE edit. "
            "Director POST /v1/cartoon/scenes/{id}/render dispatches that same path. "
            "H3 stays atmos; LabRats LatentSync dialogue is unchanged. "
            "Video edit is Wan VACE 1.3B — not Qwen-Video-Edit. "
            "Identity lock conditions the Qwen step only when character_plate "
            "and/or background images are attached. Pack ids alone are edit-only. "
            "Hobby/family use only. commercial_export is false until a signed "
            "license clearance."
        ),
        "identity_lock": {
            "when_images_attached": "qwen-reference",
            "when_prompt_only": "edit-only",
            "fields": ["character_plate", "background"],
            "edit_route": "POST /v1/images/edits",
        },
    }
    rights = cartoon_contracts.policy_rights_block()
    policy["commercial_export"] = rights["commercial_export"]
    policy["rights"] = rights
    policy["frame_contract"] = cartoon_contracts.frame_contract_public()
    policy["packs"] = cartoon_packs.packs_policy_block()
    policy["usage"] = "hobby_family"
    return policy


def _probe_size(path: Path) -> tuple[int, int]:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
        str(path),
    ]
    proc = subprocess.run(cmd, check=False, capture_output=True)
    if proc.returncode != 0:
        raise CartoonError(
            f"ffprobe failed: {proc.stderr.decode('utf-8', 'replace')[:200]}",
            500,
        )
    raw = proc.stdout.decode("utf-8", "replace").strip()
    try:
        w_s, h_s = raw.split("x", 1)
        return int(w_s), int(h_s)
    except (ValueError, AttributeError) as exc:
        raise CartoonError(f"Could not read image size ({raw!r})", 500) from exc


def _crop_tile(
    src: Path,
    dest: Path,
    *,
    x: int,
    y: int,
    w: int,
    h: int,
) -> None:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(src),
        "-vf",
        f"crop={w}:{h}:{x}:{y}",
        "-frames:v",
        "1",
        str(dest),
    ]
    proc = subprocess.run(cmd, check=False, capture_output=True)
    if proc.returncode != 0 or not dest.is_file():
        raise CartoonError(
            f"tile crop failed: {proc.stderr.decode('utf-8', 'replace')[:240]}",
            500,
        )


def slice_grid(
    image_bytes: bytes,
    *,
    cols: int,
    rows: int,
    gutter_ratio: float = 0.0,
) -> list[dict[str, Any]]:
    """Split a contact sheet into ordered keyframes (L→R, T→B).

    ``gutter_ratio`` is an optional fraction of each cell reserved as margin
    on every side (0 = flush equal tiles). Deterministic integer math only.
    """
    if not _have_ffmpeg():
        raise CartoonError("ffmpeg/ffprobe required for grid slice", 500)
    if cols < 1 or rows < 1 or cols > 8 or rows > 8:
        raise CartoonError("cols/rows must be 1..8", 400)
    if gutter_ratio < 0 or gutter_ratio >= 0.45:
        raise CartoonError("gutter_ratio must be in [0, 0.45)", 400)

    suffix = ".png"
    if image_bytes[:3] == b"\xff\xd8\xff":
        suffix = ".jpg"
    elif image_bytes[:4] == b"RIFF":
        suffix = ".webp"

    with tempfile.TemporaryDirectory(prefix="spockify-cartoon-") as tmp:
        root = Path(tmp)
        src = root / f"grid{suffix}"
        src.write_bytes(image_bytes)
        width, height = _probe_size(src)
        cell_w = width // cols
        cell_h = height // rows
        if cell_w < 32 or cell_h < 32:
            raise CartoonError(
                f"Grid cells too small ({cell_w}x{cell_h}) from {width}x{height}",
                400,
            )
        pad_x = int(cell_w * gutter_ratio)
        pad_y = int(cell_h * gutter_ratio)
        tile_w = max(16, cell_w - 2 * pad_x)
        tile_h = max(16, cell_h - 2 * pad_y)
        # Keep even dims for downstream video encoders.
        tile_w -= tile_w % 2
        tile_h -= tile_h % 2

        tiles: list[dict[str, Any]] = []
        for row in range(rows):
            for col in range(cols):
                idx = row * cols + col
                x = col * cell_w + pad_x
                y = row * cell_h + pad_y
                # Clamp so crop stays inside the image.
                if x + tile_w > width:
                    x = max(0, width - tile_w)
                if y + tile_h > height:
                    y = max(0, height - tile_h)
                dest = root / f"tile_{idx:02d}.png"
                _crop_tile(src, dest, x=x, y=y, w=tile_w, h=tile_h)
                raw = dest.read_bytes()
                tiles.append(
                    {
                        "index": idx,
                        "row": row,
                        "col": col,
                        "width": tile_w,
                        "height": tile_h,
                        "mime": "image/png",
                        "b64_json": base64.b64encode(raw).decode("ascii"),
                        "_bytes": raw,
                    }
                )
        return tiles


def pair_tiles(
    tiles: list[dict[str, Any]],
    *,
    pair_mode: str = "first_last",
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    mode = normalize_pair_mode(pair_mode)
    if len(tiles) < 2:
        raise CartoonError("Need at least 2 tiles for FLF", 400)
    if mode == "first_last":
        return [(tiles[0], tiles[-1])]
    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for i in range(len(tiles) - 1):
        pairs.append((tiles[i], tiles[i + 1]))
    return pairs


def _b64_data_url(tile: dict[str, Any]) -> str:
    mime = tile.get("mime") or "image/png"
    return f"data:{mime};base64,{tile['b64_json']}"


def _public_tile(tile: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": tile["index"],
        "row": tile["row"],
        "col": tile["col"],
        "width": tile["width"],
        "height": tile["height"],
        "mime": tile["mime"],
        "b64_json": tile["b64_json"],
    }


async def generate_sprite_grid(
    *,
    prompt: str,
    grid: str = "2x2",
    style: Optional[str] = None,
    size: Optional[str] = None,
    image_model: Optional[str] = None,
    character_plate: Optional[tuple[bytes, str]] = None,
    background: Optional[tuple[bytes, str]] = None,
) -> dict[str, Any]:
    if not qwen_image_runnable():
        raise CartoonError(
            "Qwen-Image 2.1 is not runnable on this host "
            "(missing UNet/VAE/CLIP or QwenImage21 runtime).",
            503,
        )
    grid_key = normalize_grid(grid)
    canvas = size or canvas_for_grid(grid_key)
    sprite_prompt = build_sprite_prompt(prompt, grid=grid_key, style=style)
    model = (image_model or QWEN_ID).strip() or QWEN_ID
    refs: list[tuple[bytes, str]] = []
    labels: list[str] = []
    if character_plate and character_plate[0]:
        refs.append(character_plate)
        labels.append("character_plate")
    if background and background[0]:
        refs.append(background)
        labels.append("background")
    result = await image_gen.generate_images(
        prompt=sprite_prompt,
        size=canvas,
        n=1,
        model=model,
        references=refs or None,
        reference_labels=labels or None,
    )
    data = (result.get("data") or [])
    if not data or not data[0].get("b64_json"):
        raise CartoonError("Qwen Image returned no grid image", 502)
    b64 = data[0]["b64_json"]
    raw = base64.b64decode(b64)
    return {
        "grid": grid_key,
        "canvas": result.get("size") or canvas,
        "image_model": model,
        "sprite_prompt": sprite_prompt,
        "mime": "image/png",
        "b64_json": b64,
        "_bytes": raw,
        "identity_images": labels,
    }


async def enqueue_flf_pairs(
    *,
    pairs: list[tuple[dict[str, Any], dict[str, Any]]],
    motion_prompt: str,
    seconds: Optional[str | float | int] = 2,
    size: Optional[str] = "1280x720",
    video_model: Optional[str] = None,
) -> list[dict[str, Any]]:
    oj = scan_open_jealousy()
    if not oj.get("flf_installed"):
        raise CartoonError(
            f"Wan FLF weights missing (need model={WAN21_FLF_ID}).",
            503,
        )
    model = (video_model or WAN21_FLF_ID).strip() or WAN21_FLF_ID
    jobs: list[dict[str, Any]] = []
    for start, end in pairs:
        motion = (
            f"{motion_prompt.strip()}. "
            f"Animate smoothly from keyframe {start['index']} "
            f"to keyframe {end['index']}, keep character identity."
        )
        job = await video_gen.enqueue_video(
            prompt=motion[:4000],
            model=model,
            seconds=seconds,
            size=size,
            input_reference=_b64_data_url(start),
            end_image=_b64_data_url(end),
        )
        echoed = {
            "id": job.get("id"),
            "status": job.get("status"),
            "model": job.get("model") or model,
            "start_index": start["index"],
            "end_index": end["index"],
            "object": job.get("object"),
        }
        for key in (
            "size",
            "size_native",
            "size_delivered",
            "size_delivery",
            "fps",
            "fps_native",
            "fps_delivered",
            "fps_delivery",
        ):
            if job.get(key) is not None:
                echoed[key] = job.get(key)
        jobs.append(echoed)
    return jobs


async def enqueue_vace_edit(
    *,
    prompt: str,
    control_video: bytes,
    seconds: Optional[str | float | int] = 2,
    size: Optional[str] = "832x480",
    source_video_id: Optional[str] = None,
) -> dict[str, Any]:
    """Queue Wan VACE 1.3B V2V restyle for an existing clip."""
    edit = video_edit_status()
    if not edit.get("ready"):
        raise CartoonError(
            edit.get("reason")
            or "Wan VACE weights are not ready",
            501,
        )
    if not control_video:
        raise CartoonError("control video bytes required", 400)
    restyle = (prompt or "").strip()
    if not restyle:
        raise CartoonError("prompt is required for video edit", 400)
    job = await video_gen.enqueue_video(
        prompt=restyle[:4000],
        model=WAN21_VACE_ID,
        seconds=seconds,
        size=size or "832x480",
        control_reference=control_video,
    )
    return {
        "object": "spockify.cartoon.edit",
        "id": job.get("id"),
        "status": job.get("status"),
        "model": job.get("model") or WAN21_VACE_ID,
        "vendor": "Wan VACE (not Qwen)",
        "source_video_id": source_video_id,
        "poll": f"/v1/videos/{job.get('id')}" if job.get("id") else None,
        "available": True,
        "ran": True,
        "commercial_export": False,
    }


async def _wait_flf_bytes(video_id: str, *, timeout_s: float = 3600.0) -> bytes:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        meta = video_gen.get_video(video_id)
        status = (meta.get("status") or "").lower()
        if status == "completed":
            return video_gen.get_video_bytes(video_id)
        if status in {"failed", "cancelled"}:
            err = (meta.get("error") or {}).get("message") or status
            raise CartoonError(f"FLF source {video_id} {status}: {err}", 502)
        await asyncio.sleep(2.0)
    raise CartoonError(f"Timed out waiting for FLF source {video_id}", 504)


async def _chain_vace_after_flf(
    *,
    flf_id: str,
    prompt: str,
    seconds: Optional[str | float | int],
    size: Optional[str],
) -> None:
    try:
        raw = await _wait_flf_bytes(flf_id)
        await enqueue_vace_edit(
            prompt=prompt,
            control_video=raw,
            seconds=seconds,
            size=size,
            source_video_id=flf_id,
        )
    except Exception as exc:
        LOG.warning("VACE chain after %s failed: %s", flf_id, exc)


async def run_video_edit(
    *,
    prompt: str,
    video: Optional[bytes] = None,
    video_id: Optional[str] = None,
    seconds: Optional[str | float | int] = 2,
    size: Optional[str] = "832x480",
    commercial_export: Any = False,
) -> dict[str, Any]:
    """POST /v1/cartoon/edit — restyle an existing clip with Wan VACE."""
    _guard_commercial_export(commercial_export)
    edit = video_edit_status()
    if not edit.get("ready"):
        raise CartoonError(
            edit.get("reason")
            or "Wan VACE weights missing — video edit returns 501 until installed",
            501,
        )
    source_id = (video_id or "").strip() or None
    raw = video
    if raw is None and source_id:
        try:
            raw = video_gen.get_video_bytes(source_id)
        except Exception as exc:
            raise CartoonError(
                f"Could not load source video {source_id}: {exc}",
                400,
            ) from exc
    if not raw:
        raise CartoonError(
            "Provide multipart/file video, JSON b64_json, or video_id of a "
            "completed clip",
            400,
        )
    return await enqueue_vace_edit(
        prompt=prompt,
        control_video=raw,
        seconds=seconds,
        size=size,
        source_video_id=source_id,
    )


async def run_cartoon(
    *,
    prompt: str,
    grid: str = "2x2",
    style: Optional[str] = None,
    pair_mode: str = "first_last",
    canvas_size: Optional[str] = None,
    video_size: Optional[str] = None,
    seconds: Optional[str | float | int] = 2,
    image_model: Optional[str] = None,
    video_model: Optional[str] = None,
    include_tiles: bool = True,
    include_grid: bool = True,
    run_edit: bool = False,
    gutter_ratio: float = 0.02,
    grid_image: Optional[bytes] = None,
    edit_size: Optional[str] = "832x480",
    commercial_export: Any = False,
    character_plate: Optional[tuple[bytes, str]] = None,
    background: Optional[tuple[bytes, str]] = None,
    pack_ids: bool = False,
) -> dict[str, Any]:
    """Full sprite-grid → slice → FLF (+ optional Wan VACE edit) pipeline."""
    _guard_commercial_export(commercial_export)
    started = time.time()
    grid_key = normalize_grid(grid)
    preset = GRID_PRESETS[grid_key]
    mode = normalize_pair_mode(pair_mode)
    run_id = f"cartoon_{uuid.uuid4().hex[:12]}"
    video_size = (video_size or "").strip() or SHORT_BEAT_VIDEO_SIZE

    if grid_image is not None:
        sheet = {
            "grid": grid_key,
            "canvas": canvas_size or canvas_for_grid(grid_key),
            "image_model": "upload",
            "sprite_prompt": None,
            "mime": "image/png",
            "b64_json": base64.b64encode(grid_image).decode("ascii"),
            "_bytes": grid_image,
            "identity_images": [],
        }
    else:
        sheet = await generate_sprite_grid(
            prompt=prompt,
            grid=grid_key,
            style=style,
            size=canvas_size,
            image_model=image_model,
            character_plate=character_plate,
            background=background,
        )

    tiles = slice_grid(
        sheet["_bytes"],
        cols=int(preset["cols"]),
        rows=int(preset["rows"]),
        gutter_ratio=gutter_ratio,
    )
    pairs = pair_tiles(tiles, pair_mode=mode)
    videos = await enqueue_flf_pairs(
        pairs=pairs,
        motion_prompt=prompt,
        seconds=seconds,
        size=video_size,
        video_model=video_model,
    )

    edit = video_edit_status()
    edit_result: dict[str, Any] = {
        "requested": bool(run_edit),
        "ran": False,
        "available": bool(edit.get("available")),
        "ready": bool(edit.get("ready")),
        "model": WAN21_VACE_ID if edit.get("ready") else None,
        "vendor": "Wan VACE (not Qwen)" if edit.get("ready") else None,
        "reason": edit.get("reason"),
        "candidates": edit.get("candidates"),
    }
    if run_edit and not edit.get("ready"):
        edit_result["status"] = "skipped"
        if edit.get("available"):
            edit_result["detail"] = (
                "video_edit is not ready — FLF clips returned without restyle. "
                "A filename hit is not a runnable Wan VACE checkpoint."
            )
        else:
            edit_result["detail"] = (
                "video_edit weights missing — FLF clips returned without restyle"
            )
    elif run_edit and edit.get("ready"):
        # Chain VACE after each FLF clip completes (async; does not block HTTP).
        flf_ids = [str(v.get("id")) for v in videos if v.get("id")]
        for flf_id in flf_ids:
            asyncio.create_task(
                _chain_vace_after_flf(
                    flf_id=flf_id,
                    prompt=(
                        f"{prompt.strip()}. Restyle motion-coherent cartoon cel, "
                        "keep identity and timing from the source clip."
                    ),
                    seconds=seconds,
                    size=edit_size or "832x480",
                )
            )
        edit_result["ran"] = True
        edit_result["status"] = "chained"
        edit_result["depends_on"] = flf_ids
        edit_result["detail"] = (
            "Wan VACE 1.3B restyle will queue after each FLF clip completes "
            "(not Qwen). Poll FLF ids first, then list /v1/videos for edit jobs."
        )

    # Persist a small run card (optional; best-effort).
    try:
        CARTOON_ROOT.mkdir(parents=True, exist_ok=True)
        card = {
            "id": run_id,
            "grid": grid_key,
            "pair_mode": mode,
            "video_ids": [v.get("id") for v in videos],
            "run_edit": bool(run_edit),
            "created": int(time.time()),
        }
        (CARTOON_ROOT / f"{run_id}.json").write_text(
            json.dumps(card, indent=2),
            encoding="utf-8",
        )
    except OSError as exc:
        LOG.warning("cartoon run card not written: %s", exc)

    pipeline = ["sprite_grid", "slice", "flf"]
    if run_edit and edit.get("ready"):
        pipeline.append("video_edit")

    out: dict[str, Any] = {
        "object": "spockify.cartoon.run",
        "id": run_id,
        "status": "videos_queued",
        "pipeline": pipeline,
        "grid": grid_key,
        "pair_mode": mode,
        "canvas": sheet.get("canvas"),
        "image_model": sheet.get("image_model"),
        "video_model": video_model or WAN21_FLF_ID,
        "sprite_prompt": sheet.get("sprite_prompt"),
        "tile_count": len(tiles),
        "videos": videos,
        "video_edit": edit_result,
        "elapsed_ms": int((time.time() - started) * 1000),
        "poll": [f"/v1/videos/{v.get('id')}" for v in videos if v.get("id")],
        "commercial_export": False,
    }
    out.update(
        identity_lock_report(
            list(sheet.get("identity_images") or []),
            pack_ids=pack_ids,
        )
    )
    try:
        out["frame_contract"] = cartoon_contracts.map_wan_flf_frames(
            2 if seconds is None else float(seconds)
        )
    except (TypeError, ValueError):
        out["frame_contract"] = None
    if include_grid:
        out["grid_image"] = {
            "mime": sheet.get("mime") or "image/png",
            "b64_json": sheet["b64_json"],
        }
    if include_tiles:
        out["keyframes"] = [_public_tile(t) for t in tiles]
    return out


async def slice_only(
    *,
    image: bytes,
    grid: str = "2x2",
    gutter_ratio: float = 0.02,
) -> dict[str, Any]:
    grid_key = normalize_grid(grid)
    preset = GRID_PRESETS[grid_key]
    tiles = slice_grid(
        image,
        cols=int(preset["cols"]),
        rows=int(preset["rows"]),
        gutter_ratio=gutter_ratio,
    )
    return {
        "object": "spockify.cartoon.slice",
        "grid": grid_key,
        "tile_count": len(tiles),
        "keyframes": [_public_tile(t) for t in tiles],
    }
