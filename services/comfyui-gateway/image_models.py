"""Image models this stack can run without waking ComfyUI.

FLUX.1 schnell fp8 is an all-in-one checkpoint (CheckpointLoaderSimple).
Qwen-Image 2.1 turbo is a diffusion GGUF. Ollama cannot sample it. ComfyUI
needs UnetLoaderGGUF, a QwenImage21 runtime (TextEncodeQwenImage21), plus a
Qwen3-VL text encoder and the Qwen-Image 2.1 VAE. The UNet file alone is
not a runnable model.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

FLUX_ID = "flux1-schnell-fp8.safetensors"
QWEN_ID = "qwen-image-2.1"
QWEN_OLLAMA_TAG = "hf.co/Abiray/Qwen-Image-2.1-turbo-GGUF:latest"
QWEN_UNET_FILE = "qwen_image_2.1_turbo_Q3_K_M.gguf"
QWEN_VAE_FILE = "qwen_image_2.1_vae_bf16.safetensors"
# Any one of these is the Qwen3-VL-8B encoder Qwen-Image 2.1 expects.
QWEN_CLIP_FILES = (
    "qwen3vl_8b_int8_convrot.safetensors",
    "qwen3vl_8b_w4a8.safetensors",
    "qwen3vl_8b_fp8_scaled.safetensors",
)

# Ollama blob for the pulled tag. Not on the Comfy model mount.
_DEFAULT_OLLAMA_BLOB = (
    "/var/lib/spockify/ollama/models/blobs/"
    "sha256-9b232e8f55f669e8efd20f876986d3b56e08e04a46a9a2755522a93c2635ad73"
)

_QWEN_ALIASES = {
    "qwen-image-2.1",
    "qwen-image-2.1-turbo",
    "qwen-image-2.1-turbo-gguf",
    "qwen_image",
    "qwen_image_2.1_turbo_q3_k_m.gguf",
    "hf.co/abiray/qwen-image-2.1-turbo-gguf",
    "hf.co/abiray/qwen-image-2.1-turbo-gguf:latest",
}

# CheckpointLoaderSimple image graph. Video checkpoints use a different graph.
_VIDEO_MARKERS = ("ltxv", "ltx-video", "ltx_video")


class UnknownImageModel(ValueError):
    """Requested checkpoint is not runnable on this stack."""


def _env_on(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def unet_gguf_loader_enabled() -> bool:
    return _env_on("COMFYUI_UNET_GGUF")


def qwen_image21_runtime_enabled() -> bool:
    """True when this ComfyUI build has QwenImage21 and TextEncodeQwenImage21."""
    return _env_on("COMFYUI_QWEN_IMAGE21")


def models_root() -> Path | None:
    raw = os.getenv("SPOCKIFY_IMAGE_MODELS_ROOT", "").strip()
    if raw:
        path = Path(raw)
        return path if path.is_dir() else None
    default = Path("/var/lib/spockify/comfyui")
    return default if default.is_dir() else None


def _ollama_blob() -> Path | None:
    raw = os.getenv("SPOCKIFY_QWEN_IMAGE_GGUF", _DEFAULT_OLLAMA_BLOB).strip()
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_file() else None


def _mounted_names(root: Path | None) -> dict[str, str]:
    """Basenames Comfy can see: checkpoints/ and text_encoders/ only.

    Those are the subPaths mounted into the GPU pod. A VAE or GGUF that
    lives anywhere else is not loadable until it is placed there.
    """
    found: dict[str, str] = {}
    if root is None:
        return found
    for sub in ("checkpoints", "text_encoders"):
        directory = root / sub
        if not directory.is_dir():
            continue
        for path in directory.iterdir():
            if path.is_file() and not path.name.startswith("."):
                found[path.name] = sub
    return found


def _is_video_checkpoint(name: str) -> bool:
    low = name.lower()
    return any(marker in low for marker in _VIDEO_MARKERS)


def _is_image_checkpoint(name: str) -> bool:
    low = name.lower()
    if not low.endswith((".safetensors", ".ckpt", ".sft")):
        return False
    if low.endswith(".gguf"):
        return False
    return not _is_video_checkpoint(name)


def _checkpoint_title(name: str) -> str:
    if name == FLUX_ID:
        return "FLUX.1 schnell"
    stem = name.rsplit(".", 1)[0].replace("_", " ").replace("-", " ")
    return stem


def _qwen_unet_name(mounted: dict[str, str]) -> str | None:
    if QWEN_UNET_FILE in mounted and mounted[QWEN_UNET_FILE] == "checkpoints":
        return QWEN_UNET_FILE
    for name, sub in mounted.items():
        low = name.lower()
        if sub == "checkpoints" and low.endswith(".gguf") and "qwen" in low and "image" in low:
            return name
    return None


def _qwen_clip_name(mounted: dict[str, str]) -> str | None:
    for name in QWEN_CLIP_FILES:
        if mounted.get(name) == "text_encoders":
            return name
    return None


def _qwen_vae_name(mounted: dict[str, str]) -> str | None:
    # VAELoader also searches checkpoints (see the Comfy custom node).
    if mounted.get(QWEN_VAE_FILE) in {"checkpoints", "text_encoders"}:
        return QWEN_VAE_FILE
    return None


def qwen_status() -> dict[str, Any]:
    """What is missing before Qwen-Image 2.1 can be selected."""
    mounted = _mounted_names(models_root())
    unet = _qwen_unet_name(mounted)
    clip = _qwen_clip_name(mounted)
    vae = _qwen_vae_name(mounted)
    missing: list[str] = []
    if unet is None:
        blob = _ollama_blob()
        if blob is not None:
            missing.append(
                f"{QWEN_UNET_FILE} (GGUF UNet is only the Ollama blob "
                f"{blob.name}, not in Comfy checkpoints/)"
            )
        else:
            missing.append(QWEN_UNET_FILE)
    if clip is None:
        missing.append("text encoder (one of " + ", ".join(QWEN_CLIP_FILES) + ")")
    if vae is None:
        missing.append(QWEN_VAE_FILE)
    runtime_gaps: list[str] = []
    if not unet_gguf_loader_enabled():
        runtime_gaps.append("UnetLoaderGGUF")
    if not qwen_image21_runtime_enabled():
        runtime_gaps.append("QwenImage21/TextEncodeQwenImage21")
    included = not missing and not runtime_gaps
    reason_parts: list[str] = []
    if not included:
        reason_parts.append(
            "Ollama cannot generate from this diffusion GGUF."
        )
        if runtime_gaps:
            reason_parts.append(
                "ComfyUI runtime is missing " + " and ".join(runtime_gaps) + "."
            )
        if missing:
            reason_parts.append(
                "Missing companion weights: " + "; ".join(missing) + "."
            )
            reason_parts.append("A lone UNet GGUF is not enough.")
    return {
        "included": included,
        "unet": unet,
        "clip": clip,
        "vae": vae,
        "missing": missing,
        "runtime_gaps": runtime_gaps,
        "reason": " ".join(reason_parts),
    }


def qwen_image_runnable() -> bool:
    return bool(qwen_status()["included"])


def list_video_checkpoints() -> list[dict[str, Any]]:
    """Video checkpoints the LTX workflow can run. Not image-model choices."""
    mounted = _mounted_names(models_root())
    rows: list[dict[str, Any]] = []
    has_t5 = mounted.get("t5xxl_fp16.safetensors") == "text_encoders"
    for name, sub in sorted(mounted.items()):
        if sub != "checkpoints" or not _is_video_checkpoint(name):
            continue
        rows.append(
            {
                "id": name,
                "name": _checkpoint_title(name),
                "loader": "CheckpointLoaderSimple",
                "workflow": "ltx-video",
                "runnable": has_t5,
                "missing": [] if has_t5 else ["t5xxl_fp16.safetensors"],
            }
        )
    return rows


def list_runnable_image_models() -> list[dict[str, Any]]:
    root = models_root()
    mounted = _mounted_names(root)
    models: list[dict[str, Any]] = []
    saw_weights = any(
        name.lower().endswith((".safetensors", ".ckpt", ".sft", ".gguf"))
        for name in mounted
    )
    # An empty or missing model dir keeps the product default. Once real
    # weight files are visible, list FLUX only if that checkpoint is there.
    if not saw_weights or mounted.get(FLUX_ID) == "checkpoints":
        models.append(
            {
                "id": FLUX_ID,
                "name": "FLUX.1 schnell",
                "loader": "CheckpointLoaderSimple",
            }
        )
    for name, sub in sorted(mounted.items()):
        if sub != "checkpoints" or name == FLUX_ID:
            continue
        if not _is_image_checkpoint(name):
            continue
        models.append(
            {
                "id": name,
                "name": _checkpoint_title(name),
                "loader": "CheckpointLoaderSimple",
            }
        )
    status = qwen_status()
    if status["included"]:
        models.append(
            {
                "id": QWEN_ID,
                "name": "Qwen-Image 2.1",
                "loader": "UnetLoaderGGUF",
            }
        )
    return models


def is_qwen_image_alias(model: str | None) -> bool:
    raw = (model or "").strip().lower()
    if not raw:
        return False
    if raw in _QWEN_ALIASES:
        return True
    return "qwen-image" in raw or "qwen_image" in raw


def _qwen_unavailable_message() -> str:
    status = qwen_status()
    if status["reason"]:
        return "Qwen-Image 2.1 is not available. " + status["reason"]
    return "Qwen-Image 2.1 is not available."


def resolve_image_model(requested: str | None, configured: str | None = None) -> str:
    """Return a checkpoint id the current runtime can load."""
    runnable = {item["id"] for item in list_runnable_image_models()}
    raw = (requested or "").strip()
    if raw:
        if raw in runnable:
            return raw
        if is_qwen_image_alias(raw):
            raise UnknownImageModel(_qwen_unavailable_message())
        if _is_video_checkpoint(raw):
            raise UnknownImageModel(
                f"{raw} is a video checkpoint (LTX workflow), not an image model."
            )
        raise UnknownImageModel(f"Unknown image model: {raw}")
    configured_id = (configured or "").strip()
    if configured_id in runnable:
        return configured_id
    if FLUX_ID in runnable:
        return FLUX_ID
    if runnable:
        return sorted(runnable)[0]
    raise UnknownImageModel("No runnable image model is installed.")


def gguf_prompt_graph(model_id: str) -> dict[str, Any] | None:
    """Comfy API graph for a GGUF image model, or None for checkpoint models."""
    if model_id != QWEN_ID or not qwen_image_runnable():
        return None
    status = qwen_status()
    unet = status["unet"]
    clip = status["clip"]
    vae = status["vae"]
    workflow = {
        "1": {
            "inputs": {"unet_name": unet},
            "class_type": "UnetLoaderGGUF",
        },
        "2": {
            "inputs": {"clip_name": clip, "type": "qwen_image"},
            "class_type": "CLIPLoader",
        },
        "3": {
            "inputs": {"vae_name": vae},
            "class_type": "VAELoader",
        },
        "4": {
            "inputs": {
                "clip": ["2", 0],
                "prompt": "prompt",
                "negative_prompt": "",
                "resolution": 1024,
            },
            "class_type": "TextEncodeQwenImage21",
        },
        "5": {
            "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
            "class_type": "EmptyQwenImage21Latent",
        },
        "6": {
            "inputs": {
                "seed": 0,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["4", 1],
                "latent_image": ["5", 0],
            },
            "class_type": "KSampler",
        },
        "7": {
            "inputs": {"samples": ["6", 0], "vae": ["3", 0]},
            "class_type": "VAEDecode",
        },
        "8": {
            "inputs": {"filename_prefix": "spockify", "images": ["7", 0]},
            "class_type": "SaveImage",
        },
    }
    nodes = [
        {"type": "prompt", "node_ids": ["4"], "key": "prompt"},
        {"type": "negative_prompt", "node_ids": ["4"], "key": "negative_prompt"},
        {"type": "width", "node_ids": ["5"], "key": "width"},
        {"type": "height", "node_ids": ["5"], "key": "height"},
        {"type": "steps", "node_ids": ["6"], "key": "steps"},
        {"type": "seed", "node_ids": ["6"], "key": "seed"},
        {"type": "n", "node_ids": ["5"], "key": "batch_size"},
    ]
    return {"workflow": workflow, "nodes": nodes}


def image_model_catalog() -> dict[str, Any]:
    status = qwen_status()
    return {
        "models": list_runnable_image_models(),
        "video_checkpoints": list_video_checkpoints(),
        "qwen_image_2_1": {
            "included": status["included"],
            "missing": status["missing"],
            "runtime_gaps": status["runtime_gaps"],
            "reason": status["reason"],
        },
    }
