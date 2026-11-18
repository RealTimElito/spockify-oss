"""Open Jealousy stack: Illustrious stills, identity/control, Wan I2V notes,
talking-head / lip-sync lanes, and serialized GPU ops.

Cold catalog scans only. Never calls Comfy ``/object_info``.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Optional

ILLUSTRIOUS_ID = "illustrious-xl"
STYLE_LORA_ID = "frank-cafe"
TALK_ID = "liveportrait"
LIPS_ID = "latentsync"
TALK_ALIASES = {
    "liveportrait",
    "live-portrait",
    "talking-head",
    "talking_head",
    "hallo",
    "longcat",
    "longcat-video-avatar",
}
LIPS_ALIASES = {"latentsync", "latent-sync", "musetalk", "muse-talk", "lips", "lipsync"}

# Wan22ImageToVideoLatent has start_image only. First+last frame uses
# WanFirstLastFrameToVideo + Wan 2.1 FLF2V (not Wan 2.7 — no local 2.7 weights).
END_IMAGE_REASON = (
    "end_image/last_frame needs Wan 2.1 FLF2V "
    "(model=wan2.1-flf2v / wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors). "
    "Wan 2.2 TI2V-5B is start_image only. Wan 2.7 weights are not available "
    "locally (API-only from Alibaba)."
)

WAN27_NOTE = (
    "Wan 2.7 has no local weights. Closest first+last-frame stack is "
    "Wan 2.1 FLF2V (catalog id wan2.1-flf2v). Primary first-frame I2V "
    "stays Wan 2.2 TI2V-5B. T2V-A14B stays text-to-video."
)

# Progress stuck near the start of a sample. Per-lane minutes: H3/Layout
# LTX and H3 steps sit low for a long time, so that lane waits longer than stills.
_STUCK_MINUTES = {
    "stills": 8.0,
    "talk": 12.0,
    "lips": 12.0,
    "wan": 20.0,
    "h3": 35.0,
    "ltx": 35.0,
}
_STUCK_LOW = 0.15  # raw Comfy value/max at or under this counts as "~10%"

# One Comfy GPU. Image stills and video lanes share this lock.
GPU_LOCK = asyncio.Lock()

_ILLUSTRIOUS_ALIASES = {
    "illustrious",
    "illustrious-xl",
    "illustriousxl",
    "illustrious-xl-v1",
    "illustrious-xl-v0.1",
    "onoma-illustrious",
}

_VIDEO_LORA_PREFIXES = ("ltx", "wan", "lightx2v")
_STYLE_LORA_NAMES = {
    "frank-cafe.safetensors",
    "frank_cafe.safetensors",
    "frankcafe.safetensors",
}


def models_root() -> Path | None:
    raw = os.getenv("SPOCKIFY_IMAGE_MODELS_ROOT", "").strip()
    if raw:
        path = Path(raw)
        return path if path.is_dir() else None
    default = Path("/var/lib/spockify/comfyui")
    return default if default.is_dir() else None


def stuck_minutes(lane: str) -> float:
    raw = os.getenv("OPEN_JEALOUSY_STUCK_MINUTES", "").strip()
    if raw:
        try:
            return max(1.0, float(raw))
        except ValueError:
            pass
    return _STUCK_MINUTES.get(lane, 12.0)


def lane_for_workflow(kind: str) -> str:
    if kind in {
        "wan2.2-t2v",
        "wan2.2-i2v",
        "wan2.2-ti2v-5b",
        "wan2.1-flf2v",
        "wan2.1-vace-1.3b",
    }:
        return "wan"
    if kind == "minimax-h3":
        return "h3"
    if kind in {"talking-head"}:
        return "talk"
    if kind in {"lipsync"}:
        return "lips"
    if kind in {"image", "stills"}:
        return "stills"
    return "ltx"


def is_illustrious_alias(model: str | None) -> bool:
    raw = (model or "").strip().lower()
    if not raw:
        return False
    if raw in _ILLUSTRIOUS_ALIASES:
        return True
    return "illustrious" in raw


def is_illustrious_file(name: str) -> bool:
    low = name.lower()
    return "illustrious" in low and low.endswith((".safetensors", ".ckpt", ".sft"))


def is_talk_alias(model: str | None) -> bool:
    return (model or "").strip().lower() in TALK_ALIASES


def is_lips_alias(model: str | None) -> bool:
    return (model or "").strip().lower() in LIPS_ALIASES


def _walk_names(root: Path, *, max_depth: int = 4) -> list[str]:
    found: list[str] = []
    if not root.is_dir():
        return found
    base = root.resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath).resolve()
        try:
            depth = len(current.relative_to(base).parts)
        except ValueError:
            depth = 0
        if depth >= max_depth:
            dirnames[:] = []
        for name in filenames:
            found.append(name)
        # Keep directory names too (insightface packs are folders).
        for name in list(dirnames):
            found.append(name + "/")
    return found


def _read_manifest(root: Path | None) -> dict[str, Any]:
    if root is None:
        return {}
    path = root / "loras" / "_oj" / "manifest.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _nodes(manifest: dict[str, Any]) -> dict[str, bool]:
    raw = manifest.get("nodes")
    if not isinstance(raw, dict):
        return {}
    return {str(key): bool(value) for key, value in raw.items()}


def scan_open_jealousy(root: Path | None = None) -> dict[str, Any]:
    """Disk scan for Illustrious, LoRAs, identity, control, talk, and lips."""
    root = models_root() if root is None else root
    names: list[str] = []
    illustrious_file = ""
    if root is not None:
        names = _walk_names(root)
        ckpt = root / "checkpoints"
        if ckpt.is_dir():
            for path in sorted(ckpt.iterdir()):
                if path.is_file() and is_illustrious_file(path.name):
                    illustrious_file = path.name
                    break
    blob = " ".join(names).lower()
    manifest = _read_manifest(root)
    nodes = _nodes(manifest)

    def has(*needles: str) -> bool:
        return any(needle in blob for needle in needles)

    def has_file(*needles: str) -> bool:
        # Directory names (insightface packs) end with "/". An empty folder
        # we created must not count as installed weights.
        return any(
            needle in name and not name.endswith("/")
            for name in names
            for needle in needles
        )

    control_union = has("union") and has("control") or "controlnet-union" in blob or "union-sdxl" in blob
    control_openpose = has("openpose") or control_union
    control_depth = has("depth") and ("control" in blob or "union" in blob) or control_union
    # "depth" appears in many unrelated names; prefer explicit control/union hits.
    if not control_union and "openpose" not in blob and "lineart" not in blob and "line_art" not in blob:
        control_depth = "depth" in blob and ("controlnet" in blob or "control_net" in blob or "/depth" in blob)
    control_lineart = has("lineart", "line_art") or control_union
    faceid = has("faceid", "ip-adapter-faceid", "ipadapter")
    instantid = has_file("instantid", "instant-id")
    pulid = "pulid" in blob
    insight = has("insightface", "antelopev2", "buffalo_l")
    eva = has("eva02", "evaclip", "eva_clip", "clip_vit_large")
    latentsync_w = has_file("latentsync", "latent_sync")
    liveportrait_w = has_file("liveportrait", "live_portrait")
    hallo_w = "hallo" in blob
    longcat_w = "longcat" in blob

    loras = _list_loras(root)
    style = next((row for row in loras if row.get("role") == "style"), None)
    return {
        "illustrious_file": illustrious_file,
        "illustrious_installed": bool(illustrious_file),
        "loras": loras,
        "style_lora": style
        or {
            "id": STYLE_LORA_ID,
            "file": "frank-cafe.safetensors",
            "role": "style",
            "installed": False,
            "note": (
                "Series style slot. Drop frank-cafe.safetensors into the "
                "Comfy loras directory. No café weights are shipped."
            ),
        },
        "control": {
            "openpose": bool(control_openpose),
            "depth": bool(control_depth),
            "lineart": bool(control_lineart),
            "union": bool(control_union),
        },
        "identity": {
            "ipadapter_faceid": bool(faceid),
            "instantid": bool(instantid),
            "pulid": bool(pulid and eva),
            "pulid_weights": bool(pulid),
            "eva_clip": bool(eva),
            "insightface": bool(insight),
        },
        "talk": {
            "liveportrait_weights": bool(liveportrait_w),
            "hallo_weights": bool(hallo_w),
            "longcat_weights": bool(longcat_w),
        },
        "lips": {
            "latentsync_weights": bool(latentsync_w),
            "musetalk_weights": "musetalk" in blob,
        },
        "nodes": nodes,
        "wan_27_installed": "wan2.7" in blob or "wan2_7" in blob or "wan-2.7" in blob,
        "flf_installed": has("flf2v", "wan2.1_i2v", "wan2.2_i2v"),
    }


def _list_loras(root: Path | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if root is None:
        return rows
    folder = root / "loras"
    if not folder.is_dir():
        return rows
    for path in sorted(folder.iterdir()):
        if not path.is_file():
            continue
        low = path.name.lower()
        if not low.endswith((".safetensors", ".pt")):
            continue
        if low.startswith(_VIDEO_LORA_PREFIXES):
            continue
        role = "style" if low in _STYLE_LORA_NAMES or low.replace("_", "-") in _STYLE_LORA_NAMES else "character"
        lora_id = STYLE_LORA_ID if role == "style" else path.stem
        rows.append(
            {
                "id": lora_id,
                "file": path.name,
                "role": role,
                "installed": True,
            }
        )
    if not any(row.get("role") == "style" for row in rows):
        rows.append(
            {
                "id": STYLE_LORA_ID,
                "file": "frank-cafe.safetensors",
                "role": "style",
                "installed": False,
                "note": (
                    "Series style slot. Drop frank-cafe.safetensors into loras/. "
                    "No café weights are shipped."
                ),
            }
        )
    return rows


def illustrious_catalog_row(scan: dict[str, Any] | None = None) -> dict[str, Any] | None:
    scan = scan_open_jealousy() if scan is None else scan
    if not scan.get("illustrious_installed"):
        return None
    return {
        "id": ILLUSTRIOUS_ID,
        "name": "Illustrious-XL",
        "loader": "CheckpointLoaderSimple",
        "checkpoint": scan.get("illustrious_file"),
        "resolutions": ["1k"],
        "family": "sdxl",
        "notes": (
            "Illustrious-XL cel stills on POST /v1/images/generations. "
            "Optional loras[] (per-character) and style_lora=frank-cafe. "
            "Long edge clamps to 1216."
        ),
    }


def open_jealousy_catalog(scan: dict[str, Any] | None = None) -> dict[str, Any]:
    scan = scan_open_jealousy() if scan is None else scan
    nodes = scan.get("nodes") or {}
    identity = scan.get("identity") or {}
    control = scan.get("control") or {}
    paths = bool(nodes.get("paths"))
    faceid_ready = bool(
        identity.get("ipadapter_faceid")
        and identity.get("insightface")
        and nodes.get("ipadapter")
        and paths
    )
    instant_ready = bool(
        identity.get("instantid") and identity.get("insightface") and nodes.get("instantid") and paths
    )
    pulid_ready = bool(identity.get("pulid") and identity.get("insightface") and nodes.get("pulid") and paths)
    control_ready = bool(
        paths and (control.get("union") or control.get("openpose") or control.get("depth") or control.get("lineart"))
    )
    lips_ready = bool(scan.get("lips", {}).get("latentsync_weights") and nodes.get("latentsync"))
    muse_ready = bool(scan.get("lips", {}).get("musetalk_weights") and nodes.get("musetalk"))
    talk_ready = bool(
        nodes.get("talking_head")
        and (
            lips_ready
            or muse_ready
            or (scan.get("talk", {}).get("liveportrait_weights") and nodes.get("liveportrait"))
            or (scan.get("talk", {}).get("hallo_weights") and nodes.get("hallo"))
        )
    )
    return {
        "illustrious": {
            "id": ILLUSTRIOUS_ID,
            "installed": bool(scan.get("illustrious_installed")),
            "checkpoint": scan.get("illustrious_file") or None,
            "endpoint": "POST /v1/images/generations",
            "max_edge": 1216,
        },
        "loras": scan.get("loras") or [],
        "style_lora": scan.get("style_lora"),
        "identity": {
            **identity,
            "faceid_ready": faceid_ready,
            "instantid_ready": instant_ready,
            "pulid_ready": pulid_ready,
            "options": ["faceid", "instantid", "pulid"],
        },
        "control": {
            **control,
            "ready": control_ready,
            "options": ["openpose", "depth", "lineart"],
            "preprocessor": bool(nodes.get("controlnet_aux")),
        },
        "wan": {
            "primary_i2v": "wan2.2-i2v-a14b",
            "primary_i2v_file": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
            "fallback_i2v": "wan2.2_ti2v_5B_fp16.safetensors",
            "first_frame": "input_reference",
            "end_image_model": "wan2.1-flf2v",
            "end_image_supported": bool(scan.get("flf_installed")),
            "end_image_reason": None if scan.get("flf_installed") else END_IMAGE_REASON,
            "wan_27_installed": bool(scan.get("wan_27_installed")),
            "wan_27_note": WAN27_NOTE,
            "flf_substitute": (
                "Wan 2.1 FLF2V fp8 — honest first+last-frame stand-in; "
                "not Wan 2.7."
            ),
        },
        "talking_head": {
            "id": TALK_ID,
            "endpoint": "POST /v1/videos/talking-head",
            "inputs": ["input_reference", "audio|vo", "prompt?"],
            "ready": talk_ready,
            "engine": _talk_engine(scan, nodes, lips_ready, muse_ready),
            "skipped": _talk_skipped(scan),
        },
        "lipsync": {
            "id": LIPS_ID,
            "endpoint": "POST /v1/videos/lipsync",
            "inputs": ["video_id|plate", "audio|vo"],
            "ready": lips_ready or muse_ready,
            "engine": "latentsync" if lips_ready else ("musetalk" if muse_ready else None),
            "prefer": "latentsync",
            "in_scope": True,
            "note": (
                "LabRats frozen dialogue path: silent Layout plate + "
                "finished XTTS wav → LatentSync mp4 (also the default for "
                "POST /v1/videos/mux when vo is set). Bare ffmpeg mux needs "
                "lip_sync=false."
            ),
        },
        "ops": {
            "gpu_workers": 1,
            "affinity": "serialized",
            "lanes": ["stills", "wan", "talk", "lips", "h3", "ltx"],
            "stuck_minutes": {lane: stuck_minutes(lane) for lane in _STUCK_MINUTES},
            "stuck_rule": (
                "Comfy step ratio stays at or under 15% without changing for "
                "the lane window → fail the job, interrupt, POST /free."
            ),
            "cancel": "interrupt + POST /free + release the single GPU lock",
            "note": (
                "One Comfy GPU replica. Lane is a queue tag. Jobs serialize "
                "on one lock because a second GPU replica does not fit this host."
            ),
        },
    }


def _talk_engine(scan: dict[str, Any], nodes: dict[str, bool], lips_ready: bool, muse_ready: bool) -> str | None:
    talk = scan.get("talk") or {}
    if talk.get("liveportrait_weights") and nodes.get("liveportrait"):
        return "liveportrait"
    if talk.get("hallo_weights") and nodes.get("hallo"):
        return "hallo"
    if talk.get("longcat_weights") and nodes.get("longcat"):
        return "longcat"
    if lips_ready:
        return "latentsync-still"
    if muse_ready:
        return "musetalk-still"
    return None


def _talk_skipped(scan: dict[str, Any]) -> list[str]:
    talk = scan.get("talk") or {}
    skipped = []
    if not talk.get("longcat_weights"):
        skipped.append("LongCat-Video-Avatar weights are not installed")
    if not talk.get("hallo_weights"):
        skipped.append("Hallo weights are not installed")
    if not talk.get("liveportrait_weights"):
        skipped.append("LivePortrait weights are not installed")
    if not scan.get("wan_27_installed"):
        skipped.append(WAN27_NOTE)
    return skipped


def extra_video_rows(scan: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Talk + lips catalog rows. Not runnable until weights and the node manifest agree."""
    catalog = open_jealousy_catalog(scan)
    talk = catalog["talking_head"]
    lips = catalog["lipsync"]
    talk_missing = [] if talk["ready"] else ["talking-head runtime or weights"]
    lips_missing = [] if lips["ready"] else ["latentsync weights + runtime (MuseTalk fallback not installed)"]
    return [
        {
            "id": TALK_ID,
            "name": "Talking head",
            "loader": "SpockifyTalkingHead",
            "workflow": "talking-head",
            "runnable": bool(talk["ready"]),
            "api_ready": bool(talk["ready"]),
            "missing": talk_missing,
            "lane": "talk",
            "aliases": sorted(TALK_ALIASES),
            "max_seconds": 15,
            "seconds": [4, 8, 15],
            "sizes": ["768x768", "832x480", "512x512"],
            "default_seconds": 8,
            "default_size": "768x768",
            "fps": [25],
            "default_fps": 25,
            "audio_supported": True,
            "default_audio": True,
            "extend_supported": False,
            "notes": (
                "POST /v1/videos/talking-head with a locked still and an XTTS wav. "
                + (
                    f"Engine {talk['engine']}."
                    if talk.get("engine")
                    else "No LivePortrait, Hallo, or LongCat weights on disk. "
                    "A LatentSync still-hold is used when lipsync is ready."
                )
            ),
        },
        {
            "id": LIPS_ID,
            "name": "LatentSync lips",
            "loader": "SpockifyLatentSync",
            "workflow": "lipsync",
            "runnable": bool(lips["ready"]),
            "api_ready": bool(lips["ready"]),
            "missing": lips_missing,
            "lane": "lips",
            "aliases": sorted(LIPS_ALIASES),
            "max_seconds": 30,
            "seconds": [4, 8, 15, 30],
            "sizes": ["1280x704", "768x768"],
            "default_seconds": 8,
            "default_size": "1280x704",
            "fps": [25],
            "default_fps": 25,
            "audio_supported": True,
            "default_audio": True,
            "extend_supported": False,
            "notes": (
                "POST /v1/videos/lipsync (and default POST /v1/videos/mux with vo). "
                "Silent Layout plate + final XTTS wav → lip-locked mp4. "
                "LatentSync preferred; MuseTalk is the fallback if only those weights exist."
            ),
        },
    ]


def resolve_lora(requested: str, scan: dict[str, Any] | None = None) -> dict[str, Any]:
    scan = scan_open_jealousy() if scan is None else scan
    raw = (requested or "").strip()
    if not raw:
        raise ValueError("lora id is empty")
    key = raw.lower().replace("_", "-")
    for row in scan.get("loras") or []:
        if not row.get("installed"):
            continue
        if key in {str(row.get("id") or "").lower(), str(row.get("file") or "").lower(), STYLE_LORA_ID if row.get("role") == "style" else ""}:
            return row
        if key == STYLE_LORA_ID and row.get("role") == "style":
            return row
    if key in {STYLE_LORA_ID, "frankcafe", "frank-cafe"}:
        raise ValueError(
            "Frank café style LoRA is not installed. "
            "Place frank-cafe.safetensors in the Comfy loras directory."
        )
    installed = ", ".join(
        str(row.get("id")) for row in (scan.get("loras") or []) if row.get("installed")
    ) or "(none)"
    raise ValueError(f"Unknown LoRA: {raw}. Installed: {installed}.")


def clamp_illustrious_size(width: int, height: int) -> tuple[int, int]:
    """SDXL long edge 1216, snapped to /8."""

    def snap(value: int) -> int:
        edge = max(256, min(int(value), 1216))
        return max(256, (edge // 8) * 8)

    width, height = snap(width), snap(height)
    long_edge = max(width, height)
    if long_edge <= 1216:
        return width, height
    scale = 1216 / float(long_edge)
    return snap(int(width * scale)), snap(int(height * scale))


def build_illustrious_workflow(
    *,
    ckpt: str,
    prompt: str,
    negative: str,
    width: int,
    height: int,
    steps: int,
    seed: int,
    loras: list[dict[str, Any]] | None = None,
    identity: str | None = None,
    identity_image: str | None = None,
    control: str | None = None,
    control_image: str | None = None,
    control_strength: float = 0.7,
    control_union: bool = False,
    preprocessor: bool = False,
) -> dict[str, Any]:
    """Stock SDXL graph plus optional LoRA, FaceID/InstantID/PuLID, and ControlNet."""
    model_ref: list[Any] = ["4", 0]
    clip_ref: list[Any] = ["4", 1]
    workflow: dict[str, Any] = {
        "4": {
            "inputs": {"ckpt_name": ckpt},
            "class_type": "CheckpointLoaderSimple",
        },
        "6": {
            "inputs": {"text": prompt, "clip": clip_ref},
            "class_type": "CLIPTextEncode",
        },
        "7": {
            "inputs": {"text": negative, "clip": clip_ref},
            "class_type": "CLIPTextEncode",
        },
        "5": {
            "inputs": {"width": width, "height": height, "batch_size": 1},
            "class_type": "EmptyLatentImage",
        },
        "3": {
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": 6.0,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 1,
                "model": model_ref,
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
            "class_type": "KSampler",
        },
        "8": {
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
            "class_type": "VAEDecode",
        },
        "9": {
            "inputs": {"filename_prefix": "spockify/illustrious", "images": ["8", 0]},
            "class_type": "SaveImage",
        },
    }
    for index, lora in enumerate(loras or []):
        node_id = str(20 + index)
        workflow[node_id] = {
            "inputs": {
                "lora_name": lora["file"],
                "strength_model": float(lora.get("strength") or 0.8),
                "strength_clip": float(lora.get("strength") or 0.8),
                "model": model_ref,
                "clip": clip_ref,
            },
            "class_type": "LoraLoader",
        }
        model_ref = [node_id, 0]
        clip_ref = [node_id, 1]
    workflow["6"]["inputs"]["clip"] = clip_ref
    workflow["7"]["inputs"]["clip"] = clip_ref
    workflow["3"]["inputs"]["model"] = model_ref

    positive: list[Any] = ["6", 0]
    negative_ref: list[Any] = ["7", 0]
    kind = (identity or "").strip().lower()
    if kind in {"faceid", "ipadapter", "ip-adapter", "ip-adapter-faceid-plus"} and identity_image:
        workflow["40"] = {"inputs": {"image": identity_image}, "class_type": "LoadImage"}
        workflow["41"] = {
            "inputs": {
                "model": model_ref,
                "preset": "FACEID PLUS V2",
                "lora_strength": 0.6,
                "provider": "CUDA",
            },
            "class_type": "IPAdapterUnifiedLoaderFaceID",
        }
        workflow["42"] = {
            "inputs": {
                "model": ["41", 0],
                "ipadapter": ["41", 1],
                "image": ["40", 0],
                "weight": 0.85,
                "weight_faceidv2": 0.85,
                "weight_type": "linear",
                "combine_embeds": "concat",
                "start_at": 0.0,
                "end_at": 1.0,
                "embeds_scaling": "V only",
            },
            "class_type": "IPAdapterFaceID",
        }
        model_ref = ["42", 0]
        workflow["3"]["inputs"]["model"] = model_ref
    elif kind == "instantid" and identity_image:
        workflow["40"] = {"inputs": {"image": identity_image}, "class_type": "LoadImage"}
        workflow["43"] = {
            "inputs": {"instantid_file": "ip-adapter.bin"},
            "class_type": "InstantIDModelLoader",
        }
        workflow["44"] = {
            "inputs": {"provider": "CUDA"},
            "class_type": "InstantIDFaceAnalysis",
        }
        workflow["45"] = {
            "inputs": {"control_net_name": "instantid-controlnet.safetensors"},
            "class_type": "ControlNetLoader",
        }
        workflow["46"] = {
            "inputs": {
                "instantid": ["43", 0],
                "insightface": ["44", 0],
                "control_net": ["45", 0],
                "image": ["40", 0],
                "model": model_ref,
                "positive": positive,
                "negative": negative_ref,
                "weight": 0.8,
                "start_at": 0.0,
                "end_at": 1.0,
                "noise": 0.0,
            },
            "class_type": "ApplyInstantID",
        }
        model_ref = ["46", 0]
        positive = ["46", 1]
        negative_ref = ["46", 2]
        workflow["3"]["inputs"]["model"] = model_ref
    elif kind == "pulid" and identity_image:
        workflow["40"] = {"inputs": {"image": identity_image}, "class_type": "LoadImage"}
        workflow["47"] = {
            "inputs": {"pulid_file": "pulid_v1.1.safetensors"},
            "class_type": "PulidModelLoader",
        }
        workflow["48"] = {"inputs": {}, "class_type": "PulidEvaClipLoader"}
        workflow["49"] = {"inputs": {"provider": "CUDA"}, "class_type": "PulidInsightFaceLoader"}
        workflow["50"] = {
            "inputs": {
                "model": model_ref,
                "pulid": ["47", 0],
                "eva_clip": ["48", 0],
                "face_analysis": ["49", 0],
                "image": ["40", 0],
                "weight": 0.8,
                "method": "fidelity",
                "start_at": 0.0,
                "end_at": 1.0,
            },
            "class_type": "ApplyPulid",
        }
        model_ref = ["50", 0]
        workflow["3"]["inputs"]["model"] = model_ref

    if control and control_image:
        mode = control.strip().lower()
        workflow["30"] = {"inputs": {"image": control_image}, "class_type": "LoadImage"}
        control_name = "union-sdxl.safetensors" if control_union else f"control-{mode}.safetensors"
        workflow["31"] = {
            "inputs": {"control_net_name": control_name},
            "class_type": "ControlNetLoader",
        }
        control_ref: list[Any] = ["31", 0]
        if control_union:
            workflow["34"] = {
                "inputs": {"control_net": control_ref, "type": mode},
                "class_type": "SetUnionControlNetType",
            }
            control_ref = ["34", 0]
        image_ref: list[Any] = ["30", 0]
        if preprocessor:
            pre = {
                "openpose": "OpenposePreprocessor",
                "depth": "DepthAnythingPreprocessor",
                "lineart": "LineArtPreprocessor",
            }.get(mode, "OpenposePreprocessor")
            workflow["32"] = {
                "inputs": {"image": ["30", 0], "resolution": max(width, height)},
                "class_type": pre,
            }
            image_ref = ["32", 0]
        workflow["33"] = {
            "inputs": {
                "positive": positive,
                "negative": negative_ref,
                "control_net": control_ref,
                "image": image_ref,
                "strength": float(control_strength),
                "start_percent": 0.0,
                "end_percent": 0.85,
            },
            "class_type": "ControlNetApplyAdvanced",
        }
        workflow["3"]["inputs"]["positive"] = ["33", 0]
        workflow["3"]["inputs"]["negative"] = ["33", 1]
    elif positive != ["6", 0]:
        workflow["3"]["inputs"]["positive"] = positive
        workflow["3"]["inputs"]["negative"] = negative_ref
    return workflow


def build_lipsync_workflow(*, video: str, audio: str) -> dict[str, Any]:
    return {
        "1": {
            "inputs": {"video": video, "audio": audio},
            "class_type": "SpockifyLatentSync",
        },
        "2": {
            "inputs": {
                "video": ["1", 0],
                "filename_prefix": "spockify-video/lipsync",
                "format": "mp4",
                "codec": "auto",
            },
            "class_type": "SaveVideo",
        },
    }


def build_talking_head_workflow(*, image: str, audio: str, prompt: str) -> dict[str, Any]:
    return {
        "1": {
            "inputs": {"image": image, "audio": audio, "prompt": prompt or ""},
            "class_type": "SpockifyTalkingHead",
        },
        "2": {
            "inputs": {
                "video": ["1", 0],
                "filename_prefix": "spockify-video/talking-head",
                "format": "mp4",
                "codec": "auto",
            },
            "class_type": "SaveVideo",
        },
    }


def identity_requirement_error(kind: str, catalog: dict[str, Any] | None = None) -> str | None:
    catalog = open_jealousy_catalog() if catalog is None else catalog
    identity = catalog.get("identity") or {}
    key = (kind or "").strip().lower()
    if key in {"", "none"}:
        return None
    if key in {"faceid", "ipadapter", "ip-adapter", "ip-adapter-faceid-plus"}:
        if identity.get("faceid_ready"):
            return None
        return (
            "IP-Adapter FaceID Plus is not ready (needs the FaceID weights, "
            "InsightFace, the IP-Adapter custom node, and the Open Jealousy path node)."
        )
    if key == "instantid":
        if identity.get("instantid_ready"):
            return None
        return "InstantID is not ready (weights, InsightFace, and the InstantID node)."
    if key == "pulid":
        if identity.get("pulid_ready"):
            return None
        return (
            "PuLID is not ready (pulid weights, EVA-CLIP, InsightFace, and the PuLID node)."
        )
    return f"Unknown identity mode: {kind}. Use faceid, instantid, or pulid."


def control_requirement_error(kind: str, catalog: dict[str, Any] | None = None) -> str | None:
    catalog = open_jealousy_catalog() if catalog is None else catalog
    key = (kind or "").strip().lower()
    if key in {"", "none"}:
        return None
    if key not in {"openpose", "depth", "lineart"}:
        return "control must be openpose, depth, or lineart."
    control = catalog.get("control") or {}
    if not control.get("ready"):
        return (
            "ControlNet weights are not ready. Install a Union SDXL ControlNet "
            "(or OpenPose, Depth, and Lineart) and the Open Jealousy path node."
        )
    if not control.get(key) and not control.get("union"):
        return f"No {key} ControlNet weights on disk."
    return None


class StuckWatch:
    """Track Comfy step ratio. Fire when it sits at or under ~15% without moving."""

    def __init__(self, lane: str) -> None:
        self.lane = lane
        self.window_s = stuck_minutes(lane) * 60.0
        self.started = time.monotonic()
        self.last_move = self.started
        self.raw: Optional[float] = None
        self.display = 10
        self.reason = ""
        self.stuck = False

    def observe(self, *, value: int | None, maximum: int | None) -> bool:
        now = time.monotonic()
        if value is None or not maximum:
            # A sample that has already moved past ~15% is not the 10% freeze.
            if self.raw is not None and self.raw > _STUCK_LOW:
                return False
            if now - self.last_move >= self.window_s:
                self.stuck = True
                self.reason = (
                    f"{self.lane} job stayed near 10% for {int(self.window_s // 60)} min "
                    "without a Comfy step change"
                )
                return True
            return False
        raw = max(0.0, min(1.0, float(value) / float(maximum)))
        if self.raw is None or abs(raw - self.raw) >= 0.02:
            self.raw = raw
            self.last_move = now
            # Keep 100 for the history-complete path. Sampling tops out at 95.
            self.display = max(10, min(95, int(round(10 + 85 * raw))))
            return False
        self.raw = raw
        if raw <= _STUCK_LOW and now - self.last_move >= self.window_s:
            self.stuck = True
            self.reason = (
                f"{self.lane} job progress frozen at {int(round(raw * 100))}% "
                f"for {int(self.window_s // 60)} min"
            )
            return True
        return False


def ops_summary() -> dict[str, Any]:
    return open_jealousy_catalog()["ops"]


async def free_comfy(client: Any, base_url: str) -> None:
    """Ask Comfy to unload models and return GPU memory. Best-effort."""
    try:
        await client.post(
            f"{base_url.rstrip('/')}/free",
            json={"unload_models": True, "free_memory": True},
            timeout=20.0,
        )
    except Exception:
        return


async def pump_comfy_progress(base_url: str, client_id: str, watch: StuckWatch) -> None:
    """Read Comfy ``/ws`` progress for *client_id* until the watch fires or the task is cancelled."""
    url = base_url.rstrip("/")
    if url.startswith("https://"):
        ws_url = "wss://" + url[len("https://") :]
    elif url.startswith("http://"):
        ws_url = "ws://" + url[len("http://") :]
    else:
        ws_url = "ws://" + url
    uri = f"{ws_url}/ws?clientId={client_id}"
    try:
        import websockets
    except ImportError:
        websockets = None  # type: ignore
    if websockets is None:
        while not watch.stuck:
            watch.observe(value=None, maximum=None)
            await asyncio.sleep(5)
        return
    try:
        async with websockets.connect(uri, open_timeout=10, ping_interval=20) as ws:
            while not watch.stuck:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    if watch.observe(value=None, maximum=None):
                        return
                    continue
                if isinstance(raw, bytes):
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict) or payload.get("type") != "progress":
                    if watch.observe(value=None, maximum=None):
                        return
                    continue
                data = payload.get("data") or {}
                if watch.observe(
                    value=data.get("value"),
                    maximum=data.get("max"),
                ):
                    return
    except asyncio.CancelledError:
        raise
    except Exception:
        while not watch.stuck:
            if watch.observe(value=None, maximum=None):
                return
            await asyncio.sleep(5)
