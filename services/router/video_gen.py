"""OpenAI-compatible text-to-video via ComfyUI LTX.

Public ``POST /v1/videos`` is served by the router, same as ``/v1/images``.
The handler returns a job id before Comfy wakes. ``GET /v1/videos/{id}``
polls; ``GET /v1/videos/{id}/content`` is the mp4.

The gateway cold catalog (``/__gateway/image-models``) names the checkpoint
without scaling the GPU deploy. Queuing a prompt, or uploading an
``input_reference`` image, is what wakes Comfy.
"""

from __future__ import annotations

import asyncio
import base64
import copy
import inspect
import json
import logging
import os
import random
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Mapping, Optional

import httpx

from image_gen import (
    COMFYUI_URL,
    ImageGenError,
    _download_image,
    _queue_prompt,
    _wait_history,
)
from image_models import (
    DEFAULT_VIDEO_ID,
    LTX25_CLIP,
    LTX25_FAST_ID,
    LTX25_LAYOUT_ID,
    LTX25_LAYOUT_LORA,
    LTX25_PRO_ID,
    LTX25_UNION_CONTROL_ID,
    LTX25_UNION_CONTROL_LORA,
    LTX25_SPATIAL_UPSCALER,
    LTX25_VAE,
    MINIMAX_H3_AUDIO_VAE,
    MINIMAX_H3_CLIP,
    MINIMAX_H3_ID,
    MINIMAX_H3_VAE,
    MINIMAX_MAX_LONG_EDGE,
    MINIMAX_MAX_PIXELS,
    MINIMAX_MAX_SHORT_EDGE,
    WAN21_VAE,
    WAN22_CLIP,
    WAN22_TI2V_5B_ID,
    WAN22_T2V_HIGH,
    WAN22_T2V_ID,
    WAN22_T2V_LOW,
    WAN22_VAE,
    UnknownImageModel,
    resolve_video_model,
    video_limits_for,
)

LOG = logging.getLogger("spockify.video_gen")

DEFAULT_WIDTH = 704
DEFAULT_HEIGHT = 480
DEFAULT_STEPS = 8
DEFAULT_LENGTH = 65  # 8*8+1, ~2.7s at 24fps
MAX_SECONDS = 10.0
MINIMAX_MAX_SECONDS = 15.0
WAN22_MAX_SECONDS = 5.0
MINIMAX_DEFAULT_WIDTH = 1920
MINIMAX_DEFAULT_HEIGHT = 1088
MINIMAX_DEFAULT_LENGTH = 124  # ~5s on the 17k+5 grid
MINIMAX_DEFAULT_STEPS = 20
WAN22_T2V_DEFAULT_WIDTH = 832
WAN22_T2V_DEFAULT_HEIGHT = 480
WAN22_TI2V_DEFAULT_WIDTH = 1280
WAN22_TI2V_DEFAULT_HEIGHT = 704
WAN22_DEFAULT_LENGTH = 81  # ~5s @ 16fps / common Wan template length

# Two-stage Layout-To-Render graph (distilled transformer + spatial upscaler).
# Validated on Spark: 960x544 ~168s, 1920x1088@24fps ~562s, peak ~64Gi.
# The two-stage template uses the non-conv video VAE (not LTX25_VAE conv).
LTX25_VIDEO_VAE_BF16 = "ltx-2.5-video-vae-bf16.safetensors"
# Fixed sigma schedules from the official distilled template (8-step stage 1,
# 3-step stage 2). `steps` is ignored for the layout two-stage graph.
LTX25_LAYOUT_SIGMAS_S1 = (
    "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
)
LTX25_LAYOUT_SIGMAS_S2 = "0.909375, 0.725, 0.421875, 0.0"

# In-process + disk-backed jobs under SPOCKIFY_VIDEO_STORE (hostPath).
# Survives router image rolls so clients can keep polling job ids.
_CLIPS: dict[str, dict[str, Any]] = {}
_CLIP_LIMIT = 24
_TASKS: set[asyncio.Task[None]] = set()
_JOB_TASKS: dict[str, asyncio.Task[None]] = {}
# One Comfy video render at a time (shared GPU). Jobs stay queued until the lock.
_RENDER_LOCK = asyncio.Lock()
_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_MAX_CLAY_BYTES = 64 * 1024 * 1024
_VIDEO_STORE = Path(
    os.environ.get("SPOCKIFY_VIDEO_STORE", "/var/lib/spockify/video-jobs")
)
_STORE_LOADED = False
# Image gen keeps IMAGE_GEN_POLL_TIMEOUT (1500s). Video, especially 15s H3+audio,
# needs a longer history-poll budget; timeout then POSTs /interrupt so the GPU
# is not left running an orphan that wedges later 4s jobs.
# 15s H3 @ 1344x768 (prompt dad48cf4, 2026-10-16) was still sampling at 3600s
# (4/20 steps, ~900s/it after 15min init). 7200s would still die around 8/20;
# 6h covers 20 steps plus VAE/audio decode.
VIDEO_POLL_TIMEOUT_S = float(os.getenv("VIDEO_GEN_POLL_TIMEOUT", "2400"))
VIDEO_H3_POLL_TIMEOUT_S = float(os.getenv("VIDEO_GEN_H3_POLL_TIMEOUT", "21600"))


def video_generation_disabled() -> bool:
    """True when POST /v1/videos should 503 instead of enqueueing."""
    # Re-enable: unset SPOCKIFY_VIDEO_DISABLED or set to 0.
    return os.environ.get("SPOCKIFY_VIDEO_DISABLED", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


# Same graph as k8s/comfyui-ltxvideo-configmap.yaml. Embedded because the
# router pod does not mount that ConfigMap.
_WORKFLOW: dict[str, Any] = {
    "1": {
        "inputs": {"ckpt_name": DEFAULT_VIDEO_ID},
        "class_type": "CheckpointLoaderSimple",
    },
    "0": {
        "inputs": {"clip_name": "t5xxl_fp16.safetensors", "type": "ltxv"},
        "class_type": "CLIPLoader",
    },
    "2": {
        "inputs": {"text": "prompt", "clip": ["0", 0]},
        "class_type": "CLIPTextEncode",
    },
    "3": {
        "inputs": {
            "text": "worst quality, inconsistent motion, blurry, jittery, distorted",
            "clip": ["0", 0],
        },
        "class_type": "CLIPTextEncode",
    },
    "4": {
        "inputs": {"positive": ["2", 0], "negative": ["3", 0], "frame_rate": 24},
        "class_type": "LTXVConditioning",
    },
    "5": {
        "inputs": {
            "width": DEFAULT_WIDTH,
            "height": DEFAULT_HEIGHT,
            "length": DEFAULT_LENGTH,
            "batch_size": 1,
        },
        "class_type": "EmptyLTXVLatentVideo",
    },
    "6": {
        "inputs": {
            "model": ["1", 0],
            "max_shift": 2.05,
            "base_shift": 0.95,
            "latent": ["5", 0],
        },
        "class_type": "ModelSamplingLTXV",
    },
    "7": {
        "inputs": {
            "steps": DEFAULT_STEPS,
            "max_shift": 2.05,
            "base_shift": 0.95,
            "stretch": True,
            "terminal": 0.1,
            "latent": ["5", 0],
        },
        "class_type": "LTXVScheduler",
    },
    "8": {
        "inputs": {"sampler_name": "euler"},
        "class_type": "KSamplerSelect",
    },
    "9": {
        "inputs": {
            "model": ["6", 0],
            "add_noise": True,
            "noise_seed": 0,
            "cfg": 1,
            "positive": ["4", 0],
            "negative": ["4", 1],
            "sampler": ["8", 0],
            "sigmas": ["7", 0],
            "latent_image": ["5", 0],
        },
        "class_type": "SamplerCustom",
    },
    "10": {
        "inputs": {"samples": ["9", 0], "vae": ["1", 2]},
        "class_type": "VAEDecode",
    },
    "11": {
        "inputs": {"images": ["10", 0], "fps": 24},
        "class_type": "CreateVideo",
    },
    "12": {
        "inputs": {
            "video": ["11", 0],
            "filename_prefix": "spockify-video/spockify",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}

_NODES: list[dict[str, Any]] = [
    {"type": "prompt", "node_ids": ["2"], "key": "text"},
    {"type": "model", "node_ids": ["1"], "key": "ckpt_name"},
    {"type": "width", "node_ids": ["5"], "key": "width"},
    {"type": "height", "node_ids": ["5"], "key": "height"},
    {"type": "length", "node_ids": ["5"], "key": "length"},
    {"type": "steps", "node_ids": ["7"], "key": "steps"},
    {"type": "seed", "node_ids": ["9"], "key": "noise_seed"},
]

# Same graph as k8s/comfyui-ltxvideo-i2v-configmap.yaml (LTXVImgToVideo).
_I2V_WORKFLOW: dict[str, Any] = {
    "1": {
        "inputs": {"ckpt_name": DEFAULT_VIDEO_ID},
        "class_type": "CheckpointLoaderSimple",
    },
    "0": {
        "inputs": {"clip_name": "t5xxl_fp16.safetensors", "type": "ltxv"},
        "class_type": "CLIPLoader",
    },
    "2": {
        "inputs": {"text": "prompt", "clip": ["0", 0]},
        "class_type": "CLIPTextEncode",
    },
    "3": {
        "inputs": {
            "text": "worst quality, inconsistent motion, blurry, jittery, distorted",
            "clip": ["0", 0],
        },
        "class_type": "CLIPTextEncode",
    },
    "13": {
        "inputs": {"image": "input.png"},
        "class_type": "LoadImage",
    },
    "14": {
        "inputs": {"image": ["13", 0], "img_compression": 35},
        "class_type": "LTXVPreprocess",
    },
    "5": {
        "inputs": {
            "positive": ["2", 0],
            "negative": ["3", 0],
            "vae": ["1", 2],
            "image": ["14", 0],
            "width": DEFAULT_WIDTH,
            "height": DEFAULT_HEIGHT,
            "length": DEFAULT_LENGTH,
            "batch_size": 1,
            "strength": 1.0,
        },
        "class_type": "LTXVImgToVideo",
    },
    "4": {
        "inputs": {
            "positive": ["5", 0],
            "negative": ["5", 1],
            "frame_rate": 24,
        },
        "class_type": "LTXVConditioning",
    },
    "6": {
        "inputs": {
            "model": ["1", 0],
            "max_shift": 2.05,
            "base_shift": 0.95,
            "latent": ["5", 2],
        },
        "class_type": "ModelSamplingLTXV",
    },
    "7": {
        "inputs": {
            "steps": DEFAULT_STEPS,
            "max_shift": 2.05,
            "base_shift": 0.95,
            "stretch": True,
            "terminal": 0.1,
            "latent": ["5", 2],
        },
        "class_type": "LTXVScheduler",
    },
    "8": {
        "inputs": {"sampler_name": "euler"},
        "class_type": "KSamplerSelect",
    },
    "9": {
        "inputs": {
            "model": ["6", 0],
            "add_noise": True,
            "noise_seed": 0,
            "cfg": 1,
            "positive": ["4", 0],
            "negative": ["4", 1],
            "sampler": ["8", 0],
            "sigmas": ["7", 0],
            "latent_image": ["5", 2],
        },
        "class_type": "SamplerCustom",
    },
    "10": {
        "inputs": {"samples": ["9", 0], "vae": ["1", 2]},
        "class_type": "VAEDecode",
    },
    "11": {
        "inputs": {"images": ["10", 0], "fps": 24},
        "class_type": "CreateVideo",
    },
    "12": {
        "inputs": {
            "video": ["11", 0],
            "filename_prefix": "spockify-video/spockify-i2v",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}

_I2V_NODES: list[dict[str, Any]] = [
    {"type": "prompt", "node_ids": ["2"], "key": "text"},
    {"type": "model", "node_ids": ["1"], "key": "ckpt_name"},
    {"type": "image", "node_ids": ["13"], "key": "image"},
    {"type": "width", "node_ids": ["5"], "key": "width"},
    {"type": "height", "node_ids": ["5"], "key": "height"},
    {"type": "length", "node_ids": ["5"], "key": "length"},
    {"type": "steps", "node_ids": ["7"], "key": "steps"},
    {"type": "seed", "node_ids": ["9"], "key": "noise_seed"},
]

# MiniMax H3 T2V/I2V (MiniMaxH3ImageToVideo; optional first_frame).
_MINIMAX_WORKFLOW: dict[str, Any] = {
    "1": {
        "inputs": {"unet_name": MINIMAX_H3_ID, "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "2": {
        "inputs": {
            "clip_name": MINIMAX_H3_CLIP,
            "type": "minimax",
            "device": "default",
        },
        "class_type": "CLIPLoader",
    },
    "3": {
        "inputs": {"vae_name": MINIMAX_H3_VAE},
        "class_type": "VAELoader",
    },
    "4": {
        "inputs": {"vae_name": MINIMAX_H3_AUDIO_VAE},
        "class_type": "VAELoader",
    },
    "5": {
        "inputs": {
            "clip": ["2", 0],
            "vae": ["3", 0],
            "prompt": "prompt",
            "width": MINIMAX_DEFAULT_WIDTH,
            "height": MINIMAX_DEFAULT_HEIGHT,
            "length": MINIMAX_DEFAULT_LENGTH,
        },
        "class_type": "MiniMaxH3ImageToVideo",
    },
    "6": {
        "inputs": {"noise_seed": 0},
        "class_type": "RandomNoise",
    },
    "7": {
        "inputs": {"sampler_name": "res_multistep"},
        "class_type": "KSamplerSelect",
    },
    "8": {
        "inputs": {
            "model": ["1", 0],
            "scheduler": "simple",
            "steps": MINIMAX_DEFAULT_STEPS,
            "denoise": 1.0,
        },
        "class_type": "BasicScheduler",
    },
    "9": {
        "inputs": {"model": ["1", 0], "conditioning": ["5", 0]},
        "class_type": "BasicGuider",
    },
    "10": {
        "inputs": {
            "noise": ["6", 0],
            "guider": ["9", 0],
            "sampler": ["7", 0],
            "sigmas": ["8", 0],
            "latent_image": ["5", 1],
        },
        "class_type": "SamplerCustomAdvanced",
    },
    "11": {
        "inputs": {"samples": ["10", 0], "vae": ["3", 0]},
        "class_type": "VAEDecode",
    },
    "12": {
        "inputs": {"samples": ["10", 0], "vae": ["4", 0]},
        "class_type": "VAEDecodeAudio",
    },
    "13": {
        "inputs": {"images": ["11", 0], "audio": ["12", 0], "fps": 24},
        "class_type": "CreateVideo",
    },
    "14": {
        "inputs": {
            "video": ["13", 0],
            "filename_prefix": "spockify-video/minimax-h3",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}

_MINIMAX_I2V_WORKFLOW: dict[str, Any] = copy.deepcopy(_MINIMAX_WORKFLOW)
_MINIMAX_I2V_WORKFLOW["15"] = {
    "inputs": {"image": "input.png"},
    "class_type": "LoadImage",
}
_MINIMAX_I2V_WORKFLOW["5"]["inputs"]["first_frame"] = ["15", 0]

# LTX-2.5 Fast/Pro: UNET + Gemma CLIP (type=ltxv) + video VAE. Same sampler
# shape as the LTX 2B API graph; validated against prod Comfy object_info.
_LTX25_WORKFLOW: dict[str, Any] = {
    "1": {
        "inputs": {"unet_name": LTX25_FAST_ID, "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "0": {
        "inputs": {
            "clip_name": LTX25_CLIP,
            "type": "ltxv",
            "device": "default",
        },
        "class_type": "CLIPLoader",
    },
    "v": {
        "inputs": {"vae_name": LTX25_VAE},
        "class_type": "VAELoader",
    },
    "2": {
        "inputs": {"text": "prompt", "clip": ["0", 0]},
        "class_type": "CLIPTextEncode",
    },
    "3": {
        "inputs": {
            "text": "worst quality, inconsistent motion, blurry, jittery, distorted",
            "clip": ["0", 0],
        },
        "class_type": "CLIPTextEncode",
    },
    "4": {
        "inputs": {"positive": ["2", 0], "negative": ["3", 0], "frame_rate": 24},
        "class_type": "LTXVConditioning",
    },
    "5": {
        "inputs": {
            "width": DEFAULT_WIDTH,
            "height": DEFAULT_HEIGHT,
            "length": DEFAULT_LENGTH,
            "batch_size": 1,
        },
        "class_type": "EmptyLTXVLatentVideo",
    },
    "6": {
        "inputs": {
            "model": ["1", 0],
            "max_shift": 2.05,
            "base_shift": 0.95,
            "latent": ["5", 0],
        },
        "class_type": "ModelSamplingLTXV",
    },
    "7": {
        "inputs": {
            "steps": DEFAULT_STEPS,
            "max_shift": 2.05,
            "base_shift": 0.95,
            "stretch": True,
            "terminal": 0.1,
            "latent": ["5", 0],
        },
        "class_type": "LTXVScheduler",
    },
    "8": {
        "inputs": {"sampler_name": "euler"},
        "class_type": "KSamplerSelect",
    },
    "9": {
        "inputs": {
            "model": ["6", 0],
            "add_noise": True,
            "noise_seed": 0,
            "cfg": 1,
            "positive": ["4", 0],
            "negative": ["4", 1],
            "sampler": ["8", 0],
            "sigmas": ["7", 0],
            "latent_image": ["5", 0],
        },
        "class_type": "SamplerCustom",
    },
    "10": {
        "inputs": {"samples": ["9", 0], "vae": ["v", 0]},
        "class_type": "VAEDecode",
    },
    "11": {
        "inputs": {"images": ["10", 0], "fps": 24},
        "class_type": "CreateVideo",
    },
    "12": {
        "inputs": {
            "video": ["11", 0],
            "filename_prefix": "spockify-video/ltx25",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}

_LTX25_I2V_WORKFLOW: dict[str, Any] = {
    "1": {
        "inputs": {"unet_name": LTX25_FAST_ID, "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "0": {
        "inputs": {
            "clip_name": LTX25_CLIP,
            "type": "ltxv",
            "device": "default",
        },
        "class_type": "CLIPLoader",
    },
    "v": {
        "inputs": {"vae_name": LTX25_VAE},
        "class_type": "VAELoader",
    },
    "2": {
        "inputs": {"text": "prompt", "clip": ["0", 0]},
        "class_type": "CLIPTextEncode",
    },
    "3": {
        "inputs": {
            "text": "worst quality, inconsistent motion, blurry, jittery, distorted",
            "clip": ["0", 0],
        },
        "class_type": "CLIPTextEncode",
    },
    "13": {
        "inputs": {"image": "input.png"},
        "class_type": "LoadImage",
    },
    "4": {
        "inputs": {"positive": ["2", 0], "negative": ["3", 0], "frame_rate": 24},
        "class_type": "LTXVConditioning",
    },
    "5": {
        "inputs": {
            "positive": ["4", 0],
            "negative": ["4", 1],
            "vae": ["v", 0],
            "image": ["13", 0],
            "width": DEFAULT_WIDTH,
            "height": DEFAULT_HEIGHT,
            "length": DEFAULT_LENGTH,
            "batch_size": 1,
            "strength": 1.0,
        },
        "class_type": "LTXVImgToVideo",
    },
    "6": {
        "inputs": {
            "model": ["1", 0],
            "max_shift": 2.05,
            "base_shift": 0.95,
            "latent": ["5", 2],
        },
        "class_type": "ModelSamplingLTXV",
    },
    "7": {
        "inputs": {
            "steps": DEFAULT_STEPS,
            "max_shift": 2.05,
            "base_shift": 0.95,
            "stretch": True,
            "terminal": 0.1,
            "latent": ["5", 2],
        },
        "class_type": "LTXVScheduler",
    },
    "8": {
        "inputs": {"sampler_name": "euler"},
        "class_type": "KSamplerSelect",
    },
    "9": {
        "inputs": {
            "model": ["6", 0],
            "add_noise": True,
            "noise_seed": 0,
            "cfg": 1,
            "positive": ["5", 0],
            "negative": ["5", 1],
            "sampler": ["8", 0],
            "sigmas": ["7", 0],
            "latent_image": ["5", 2],
        },
        "class_type": "SamplerCustom",
    },
    "10": {
        "inputs": {"samples": ["9", 0], "vae": ["v", 0]},
        "class_type": "VAEDecode",
    },
    "11": {
        "inputs": {"images": ["10", 0], "fps": 24},
        "class_type": "CreateVideo",
    },
    "12": {
        "inputs": {
            "video": ["11", 0],
            "filename_prefix": "spockify-video/ltx25-i2v",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}

# Layout-To-Render IC-LoRA. Look still required; clay = RepeatImageBatch(look).
def _layout_guide(
    src_pos: list[Any],
    src_neg: list[Any],
    latent: list[Any],
    image: list[Any],
    frame_idx: int,
    crop: str,
) -> dict[str, Any]:
    """One LTXAddVideoICLoRAGuide node (template widget defaults)."""
    return {
        "class_type": "LTXAddVideoICLoRAGuide",
        "inputs": {
            "positive": src_pos,
            "negative": src_neg,
            "vae": ["vvae", 0],
            "latent": latent,
            "image": image,
            "frame_idx": frame_idx,
            "strength": 1.0,
            "latent_downscale_factor": ["iclora", 1],
            "crop": crop,
            "use_tiled_encode": False,
            "tile_size": 256,
            "tile_overlap": 64,
        },
    }


# Two-stage distilled Layout-To-Render: sample at half res (8 steps) → latent
# spatial upscaler x2 → re-add IC-LoRA guides → refine (3 steps) → tiled decode.
# Mirrors LTX-2.5_ICLoRA_Layout_To_Render_Two_Stage_Distilled.json, flattened
# for the Comfy /prompt API. Stage-1 dims are set to half the final size in
# apply_workflow so the x2 upscaler lands on the requested resolution.
_LAYOUT_WORKFLOW: dict[str, Any] = {
    # ---- models ----
    "unet": {
        "inputs": {"unet_name": LTX25_FAST_ID, "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "iclora": {
        "inputs": {
            "model": ["unet", 0],
            "lora_name": LTX25_LAYOUT_LORA,
            "strength_model": 1.0,
        },
        "class_type": "LTXICLoRALoaderModelOnly",
    },
    "clip": {
        "inputs": {"clip_name": LTX25_CLIP, "type": "ltxv", "device": "default"},
        "class_type": "CLIPLoader",
    },
    "vvae": {
        "inputs": {"vae_name": LTX25_VIDEO_VAE_BF16},
        "class_type": "VAELoader",
    },
    "ups": {
        "inputs": {"model_name": LTX25_SPATIAL_UPSCALER},
        "class_type": "LatentUpscaleModelLoader",
    },
    # ---- conditioning ----
    "pos_enc": {
        "inputs": {"text": "prompt", "clip": ["clip", 0]},
        "class_type": "CLIPTextEncode",
    },
    "neg_enc": {
        "inputs": {
            "text": "worst quality, inconsistent motion, blurry, jittery, distorted",
            "clip": ["clip", 0],
        },
        "class_type": "CLIPTextEncode",
    },
    "cond": {
        "inputs": {
            "positive": ["pos_enc", 0],
            "negative": ["neg_enc", 0],
            "frame_rate": 24,
        },
        "class_type": "LTXVConditioning",
    },
    # ---- reference images (clay layout + look still) ----
    "clay": {"inputs": {"image": "input.png"}, "class_type": "LoadImage"},
    "look": {"inputs": {"image": "input.png"}, "class_type": "LoadImage"},
    # ---- stage 1: preprocess (half-res latent + guides) ----
    "empty": {
        "inputs": {
            "width": DEFAULT_WIDTH,
            "height": DEFAULT_HEIGHT,
            "length": DEFAULT_LENGTH,
            "batch_size": 1,
        },
        "class_type": "EmptyLTXVLatentVideo",
    },
    "g1a": _layout_guide(["cond", 0], ["cond", 1], ["empty", 0], ["clay", 0], 0,
                         "disabled"),
    "g1b": _layout_guide(["g1a", 0], ["g1a", 1], ["g1a", 2], ["look", 0], -1,
                         "center"),
    # ---- stage 1: sample (8 steps) ----
    "noise1": {"inputs": {"noise_seed": 0}, "class_type": "RandomNoise"},
    "guider1": {
        "inputs": {
            "model": ["iclora", 0],
            "positive": ["g1b", 0],
            "negative": ["g1b", 1],
            "cfg": 1.0,
        },
        "class_type": "CFGGuider",
    },
    "samp": {
        "inputs": {"sampler_name": "euler_ancestral"},
        "class_type": "KSamplerSelect",
    },
    "sig1": {
        "inputs": {"sigmas": LTX25_LAYOUT_SIGMAS_S1},
        "class_type": "ManualSigmas",
    },
    "sca1": {
        "inputs": {
            "noise": ["noise1", 0],
            "guider": ["guider1", 0],
            "sampler": ["samp", 0],
            "sigmas": ["sig1", 0],
            "latent_image": ["g1b", 2],
        },
        "class_type": "SamplerCustomAdvanced",
    },
    "crop1": {
        "inputs": {
            "positive": ["g1b", 0],
            "negative": ["g1b", 1],
            "latent": ["sca1", 0],
        },
        "class_type": "LTXVCropGuides",
    },
    # ---- stage 2: upscale x2 + re-sample (3 steps) ----
    "upsamp": {
        "inputs": {
            "samples": ["crop1", 2],
            "upscale_model": ["ups", 0],
            "vae": ["vvae", 0],
        },
        "class_type": "LTXVLatentUpsampler",
    },
    "g2a": _layout_guide(["cond", 0], ["cond", 1], ["upsamp", 0], ["clay", 0], 0,
                         "disabled"),
    "g2b": _layout_guide(["g2a", 0], ["g2a", 1], ["g2a", 2], ["look", 0], -1,
                         "center"),
    "noise2": {"inputs": {"noise_seed": 0}, "class_type": "RandomNoise"},
    "guider2": {
        "inputs": {
            "model": ["iclora", 0],
            "positive": ["g2b", 0],
            "negative": ["g2b", 1],
            "cfg": 1.0,
        },
        "class_type": "CFGGuider",
    },
    "sig2": {
        "inputs": {"sigmas": LTX25_LAYOUT_SIGMAS_S2},
        "class_type": "ManualSigmas",
    },
    "sca2": {
        "inputs": {
            "noise": ["noise2", 0],
            "guider": ["guider2", 0],
            "sampler": ["samp", 0],
            "sigmas": ["sig2", 0],
            "latent_image": ["g2b", 2],
        },
        "class_type": "SamplerCustomAdvanced",
    },
    "crop2": {
        "inputs": {
            "positive": ["g2b", 0],
            "negative": ["g2b", 1],
            "latent": ["sca2", 0],
        },
        "class_type": "LTXVCropGuides",
    },
    # ---- decode ----
    "dec": {
        "inputs": {
            "samples": ["crop2", 2],
            "vae": ["vvae", 0],
            "tile_size": 512,
            "overlap": 64,
            "temporal_size": 128,
            "temporal_overlap": 32,
        },
        "class_type": "VAEDecodeTiled",
    },
    "mkv": {
        "inputs": {"images": ["dec", 0], "fps": 24},
        "class_type": "CreateVideo",
    },
    "save": {
        "inputs": {
            "video": ["mkv", 0],
            "filename_prefix": "spockify-video/layout-to-render",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}

# Union Control IC-LoRA: structure-following v2v. One control guide per stage
# (the control clip is a depth/canny/pose annotation); appearance comes from
# the prompt. Same two-stage distilled ladder as Layout, single guide, and the
# union-control LoRA. The IC-LoRA patchify needs the half-res stage-1 latent
# even on the /32 grid, so parse_size snaps final dims to /128.
def _control_guide(
    src_pos: list[Any],
    src_neg: list[Any],
    latent: list[Any],
    image: list[Any],
) -> dict[str, Any]:
    """One LTXAddVideoICLoRAGuide for the control clip (frame_idx=0)."""
    return {
        "class_type": "LTXAddVideoICLoRAGuide",
        "inputs": {
            "positive": src_pos,
            "negative": src_neg,
            "vae": ["vvae", 0],
            "latent": latent,
            "image": image,
            "frame_idx": 0,
            "strength": 1.0,
            "latent_downscale_factor": ["iclora", 1],
            "crop": "disabled",
            "use_tiled_encode": False,
            "tile_size": 256,
            "tile_overlap": 64,
        },
    }


_CTRL_IMG = ["ctrlcomp", 0]
_UNION_CONTROL_WORKFLOW: dict[str, Any] = {
    # ---- models ----
    "unet": {
        "inputs": {"unet_name": LTX25_FAST_ID, "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "iclora": {
        "inputs": {
            "model": ["unet", 0],
            "lora_name": LTX25_UNION_CONTROL_LORA,
            "strength_model": 1.0,
        },
        "class_type": "LTXICLoRALoaderModelOnly",
    },
    "clip": {
        "inputs": {"clip_name": LTX25_CLIP, "type": "ltxv", "device": "default"},
        "class_type": "CLIPLoader",
    },
    "vvae": {
        "inputs": {"vae_name": LTX25_VIDEO_VAE_BF16},
        "class_type": "VAELoader",
    },
    "ups": {
        "inputs": {"model_name": LTX25_SPATIAL_UPSCALER},
        "class_type": "LatentUpscaleModelLoader",
    },
    # ---- conditioning ----
    "pos_enc": {
        "inputs": {"text": "prompt", "clip": ["clip", 0]},
        "class_type": "CLIPTextEncode",
    },
    "neg_enc": {
        "inputs": {
            "text": "worst quality, inconsistent motion, blurry, jittery, distorted",
            "clip": ["clip", 0],
        },
        "class_type": "CLIPTextEncode",
    },
    "cond": {
        "inputs": {
            "positive": ["pos_enc", 0],
            "negative": ["neg_enc", 0],
            "frame_rate": 24,
        },
        "class_type": "LTXVConditioning",
    },
    # ---- control clip (depth / canny / pose frames) ----
    "ctrl": {"inputs": {"file": "input.mp4"}, "class_type": "LoadVideo"},
    "ctrlcomp": {
        "inputs": {"video": ["ctrl", 0]},
        "class_type": "GetVideoComponents",
    },
    # ---- stage 1: half-res latent + guide, sample (8 steps) ----
    "empty": {
        "inputs": {
            "width": DEFAULT_WIDTH,
            "height": DEFAULT_HEIGHT,
            "length": DEFAULT_LENGTH,
            "batch_size": 1,
        },
        "class_type": "EmptyLTXVLatentVideo",
    },
    "g1": _control_guide(["cond", 0], ["cond", 1], ["empty", 0], _CTRL_IMG),
    "noise1": {"inputs": {"noise_seed": 0}, "class_type": "RandomNoise"},
    "guider1": {
        "inputs": {
            "model": ["iclora", 0],
            "positive": ["g1", 0],
            "negative": ["g1", 1],
            "cfg": 1.0,
        },
        "class_type": "CFGGuider",
    },
    "samp": {
        "inputs": {"sampler_name": "euler_ancestral"},
        "class_type": "KSamplerSelect",
    },
    "sig1": {
        "inputs": {"sigmas": LTX25_LAYOUT_SIGMAS_S1},
        "class_type": "ManualSigmas",
    },
    "sca1": {
        "inputs": {
            "noise": ["noise1", 0],
            "guider": ["guider1", 0],
            "sampler": ["samp", 0],
            "sigmas": ["sig1", 0],
            "latent_image": ["g1", 2],
        },
        "class_type": "SamplerCustomAdvanced",
    },
    "crop1": {
        "inputs": {
            "positive": ["g1", 0],
            "negative": ["g1", 1],
            "latent": ["sca1", 0],
        },
        "class_type": "LTXVCropGuides",
    },
    # ---- stage 2: upscale x2 + re-sample (3 steps) ----
    "upsamp": {
        "inputs": {
            "samples": ["crop1", 2],
            "upscale_model": ["ups", 0],
            "vae": ["vvae", 0],
        },
        "class_type": "LTXVLatentUpsampler",
    },
    "g2": _control_guide(["cond", 0], ["cond", 1], ["upsamp", 0], _CTRL_IMG),
    "noise2": {"inputs": {"noise_seed": 0}, "class_type": "RandomNoise"},
    "guider2": {
        "inputs": {
            "model": ["iclora", 0],
            "positive": ["g2", 0],
            "negative": ["g2", 1],
            "cfg": 1.0,
        },
        "class_type": "CFGGuider",
    },
    "sig2": {
        "inputs": {"sigmas": LTX25_LAYOUT_SIGMAS_S2},
        "class_type": "ManualSigmas",
    },
    "sca2": {
        "inputs": {
            "noise": ["noise2", 0],
            "guider": ["guider2", 0],
            "sampler": ["samp", 0],
            "sigmas": ["sig2", 0],
            "latent_image": ["g2", 2],
        },
        "class_type": "SamplerCustomAdvanced",
    },
    "crop2": {
        "inputs": {
            "positive": ["g2", 0],
            "negative": ["g2", 1],
            "latent": ["sca2", 0],
        },
        "class_type": "LTXVCropGuides",
    },
    # ---- decode ----
    "dec": {
        "inputs": {
            "samples": ["crop2", 2],
            "vae": ["vvae", 0],
            "tile_size": 512,
            "overlap": 64,
            "temporal_size": 128,
            "temporal_overlap": 32,
        },
        "class_type": "VAEDecodeTiled",
    },
    "mkv": {
        "inputs": {"images": ["dec", 0], "fps": 24},
        "class_type": "CreateVideo",
    },
    "save": {
        "inputs": {
            "video": ["mkv", 0],
            "filename_prefix": "spockify-video/union-control",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}


_WAN_NEG = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，"
    "整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，"
    "画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，"
    "静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走"
)

# Wan 2.2 T2V-A14B MoE (high then low KSamplerAdvanced).
_WAN22_T2V_WORKFLOW: dict[str, Any] = {
    "101": {
        "inputs": {"unet_name": WAN22_T2V_HIGH, "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "102": {
        "inputs": {"unet_name": WAN22_T2V_LOW, "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "93": {
        "inputs": {"model": ["101", 0], "shift": 8.0},
        "class_type": "ModelSamplingSD3",
    },
    "94": {
        "inputs": {"model": ["102", 0], "shift": 8.0},
        "class_type": "ModelSamplingSD3",
    },
    "90": {
        "inputs": {
            "clip_name": WAN22_CLIP,
            "type": "wan",
            "device": "default",
        },
        "class_type": "CLIPLoader",
    },
    "92": {
        "inputs": {"vae_name": WAN21_VAE},
        "class_type": "VAELoader",
    },
    "99": {
        "inputs": {"text": "prompt", "clip": ["90", 0]},
        "class_type": "CLIPTextEncode",
    },
    "91": {
        "inputs": {"text": _WAN_NEG, "clip": ["90", 0]},
        "class_type": "CLIPTextEncode",
    },
    "95": {
        "inputs": {
            "width": WAN22_T2V_DEFAULT_WIDTH,
            "height": WAN22_T2V_DEFAULT_HEIGHT,
            "length": WAN22_DEFAULT_LENGTH,
            "batch_size": 1,
        },
        "class_type": "EmptyHunyuanLatentVideo",
    },
    "96": {
        "inputs": {
            "model": ["93", 0],
            "add_noise": "enable",
            "noise_seed": 0,
            "steps": 20,
            "cfg": 3.5,
            "sampler_name": "euler",
            "scheduler": "simple",
            "positive": ["99", 0],
            "negative": ["91", 0],
            "latent_image": ["95", 0],
            "start_at_step": 0,
            "end_at_step": 10,
            "return_with_leftover_noise": "enable",
        },
        "class_type": "KSamplerAdvanced",
    },
    "97": {
        "inputs": {
            "model": ["94", 0],
            "add_noise": "disable",
            "noise_seed": 0,
            "steps": 20,
            "cfg": 3.5,
            "sampler_name": "euler",
            "scheduler": "simple",
            "positive": ["99", 0],
            "negative": ["91", 0],
            "latent_image": ["96", 0],
            "start_at_step": 10,
            "end_at_step": 10000,
            "return_with_leftover_noise": "disable",
        },
        "class_type": "KSamplerAdvanced",
    },
    "98": {
        "inputs": {"samples": ["97", 0], "vae": ["92", 0]},
        "class_type": "VAEDecode",
    },
    "88": {
        "inputs": {"images": ["98", 0], "fps": 16},
        "class_type": "CreateVideo",
    },
    "80": {
        "inputs": {
            "video": ["88", 0],
            "filename_prefix": "spockify-video/wan22-t2v",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}

_WAN22_TI2V_WORKFLOW: dict[str, Any] = {
    "37": {
        "inputs": {"unet_name": WAN22_TI2V_5B_ID, "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "38": {
        "inputs": {
            "clip_name": WAN22_CLIP,
            "type": "wan",
            "device": "default",
        },
        "class_type": "CLIPLoader",
    },
    "39": {
        "inputs": {"vae_name": WAN22_VAE},
        "class_type": "VAELoader",
    },
    "6": {
        "inputs": {"text": "prompt", "clip": ["38", 0]},
        "class_type": "CLIPTextEncode",
    },
    "7": {
        "inputs": {"text": _WAN_NEG, "clip": ["38", 0]},
        "class_type": "CLIPTextEncode",
    },
    "48": {
        "inputs": {"model": ["37", 0], "shift": 8.0},
        "class_type": "ModelSamplingSD3",
    },
    "55": {
        "inputs": {
            "vae": ["39", 0],
            "width": WAN22_TI2V_DEFAULT_WIDTH,
            "height": WAN22_TI2V_DEFAULT_HEIGHT,
            "length": WAN22_DEFAULT_LENGTH,
            "batch_size": 1,
        },
        "class_type": "Wan22ImageToVideoLatent",
    },
    "3": {
        "inputs": {
            "model": ["48", 0],
            "seed": 0,
            "steps": 20,
            "cfg": 5.0,
            "sampler_name": "uni_pc",
            "scheduler": "simple",
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["55", 0],
            "denoise": 1.0,
        },
        "class_type": "KSampler",
    },
    "8": {
        "inputs": {"samples": ["3", 0], "vae": ["39", 0]},
        "class_type": "VAEDecode",
    },
    "57": {
        "inputs": {"images": ["8", 0], "fps": 16},
        "class_type": "CreateVideo",
    },
    "58": {
        "inputs": {
            "video": ["57", 0],
            "filename_prefix": "spockify-video/wan22-ti2v",
            "format": "mp4",
            "codec": "auto",
        },
        "class_type": "SaveVideo",
    },
}

_WAN22_TI2V_I2V_WORKFLOW: dict[str, Any] = copy.deepcopy(_WAN22_TI2V_WORKFLOW)
_WAN22_TI2V_I2V_WORKFLOW["56"] = {
    "inputs": {"image": "input.png"},
    "class_type": "LoadImage",
}
_WAN22_TI2V_I2V_WORKFLOW["55"]["inputs"]["start_image"] = ["56", 0]


class VideoGenError(ImageGenError):
    """Video request rejected or ComfyUI failed. status_code is for HTTP."""


def _workflow_kind(model_name: str) -> str:
    if model_name == MINIMAX_H3_ID:
        return "minimax-h3"
    if model_name == LTX25_LAYOUT_ID:
        return "ltx-2.5-layout-to-render"
    if model_name == LTX25_UNION_CONTROL_ID:
        return "ltx-2.5-union-control"
    if model_name in {LTX25_FAST_ID, LTX25_PRO_ID}:
        return "ltx-2.5"
    if model_name == WAN22_T2V_ID:
        return "wan2.2-t2v"
    if model_name == WAN22_TI2V_5B_ID:
        return "wan2.2-ti2v-5b"
    return "ltx-video"


def video_poll_timeout_s(model_name: str | None = None) -> float:
    """History-poll budget for one Comfy video job. Independent of image gen."""
    if _workflow_kind(model_name or DEFAULT_VIDEO_ID) == "minimax-h3":
        return VIDEO_H3_POLL_TIMEOUT_S
    return VIDEO_POLL_TIMEOUT_S


def _limits_for_model(model_name: str | None) -> dict[str, Any]:
    return video_limits_for(_workflow_kind(model_name or DEFAULT_VIDEO_ID))


def resolve_fps(
    fps: Optional[str | float | int],
    *,
    model_name: str | None = None,
) -> tuple[int, Optional[int]]:
    """Return ``(fps_used, fps_requested_if_snapped)``.

    Unsupported fps values snap to the nearest catalog-allowed rate so
    clients that always send 24 still work on Wan (16-only). Invalid
    non-numeric fps still 400s.
    """
    limits = _limits_for_model(model_name)
    allowed = [int(x) for x in (limits.get("fps") or [24])]
    default = int(limits.get("default_fps") or allowed[0] or 24)
    if fps is None or fps == "":
        return default, None
    try:
        value = int(round(float(fps)))
    except (TypeError, ValueError) as exc:
        raise VideoGenError(f"Invalid fps: {fps}", 400) from exc
    if value in allowed:
        return value, None
    nearest = min(allowed, key=lambda item: (abs(item - value), item))
    LOG.info(
        "fps %s not in %s for %s; snapping to %s",
        value,
        allowed,
        _workflow_kind(model_name or DEFAULT_VIDEO_ID),
        nearest,
    )
    return nearest, value


def resolve_audio(
    audio: Optional[bool],
    *,
    model_name: str | None = None,
) -> tuple[bool, bool]:
    """Return ``(audio_used, audio_ignored)``.

    Unsupported ``audio=true`` is coerced off (not 400) so mixed-model
    clients keep working; meta records the ignore.
    """
    limits = _limits_for_model(model_name)
    supported = bool(limits.get("audio_supported"))
    default = bool(limits.get("default_audio")) if supported else False
    if audio is None:
        return default, False
    want = bool(audio)
    if want and not supported:
        LOG.info(
            "audio=true ignored for %s (audio_supported=false)",
            _workflow_kind(model_name or DEFAULT_VIDEO_ID),
        )
        return False, True
    return (want if supported else False), False


def extend_supported(model_name: str | None) -> bool:
    return bool(_limits_for_model(model_name).get("extend_supported"))


def snap_length(
    seconds: Optional[str | float | int],
    *,
    model_name: str | None = None,
    fps: Optional[int] = None,
) -> int:
    """Map OpenAI ``seconds`` to a frame count for the selected video model."""
    kind = _workflow_kind(model_name or DEFAULT_VIDEO_ID)
    if fps is not None:
        rate = int(fps)
    else:
        rate, _ = resolve_fps(None, model_name=model_name)
    if seconds is None or seconds == "":
        if kind == "minimax-h3":
            return MINIMAX_DEFAULT_LENGTH
        if kind in {"wan2.2-t2v", "wan2.2-ti2v-5b"}:
            return WAN22_DEFAULT_LENGTH
        return DEFAULT_LENGTH
    try:
        sec = float(seconds)
    except (TypeError, ValueError) as exc:
        raise VideoGenError(f"Invalid seconds: {seconds}", 400) from exc
    if kind == "minimax-h3":
        max_sec = MINIMAX_MAX_SECONDS
    elif kind in {"wan2.2-t2v", "wan2.2-ti2v-5b"}:
        max_sec = WAN22_MAX_SECONDS
    else:
        max_sec = MAX_SECONDS
    if sec <= 0 or sec > max_sec:
        raise VideoGenError(f"seconds must be between 0 and {int(max_sec)}", 400)
    if kind == "minimax-h3":
        # Official grid: 17k+5 (5, 22, 39, …).
        frames = max(5, int(round(sec * rate)))
        return frames + (5 - (frames % 17)) % 17
    if kind in {"wan2.2-t2v", "wan2.2-ti2v-5b"}:
        # Wan templates commonly use 4n+1 @ ~16fps.
        frames = max(5, int(round(sec * rate)))
        return frames + (1 - (frames % 4)) % 4
    frames = int(round(sec * rate))
    groups = max(1, round((frames - 1) / 8))
    return max(17, min(8 * groups + 1, 241))


def _align_dim(value: int, multiple: int, lo: int, hi: int) -> int:
    """Snap *value* to the nearest *multiple* inside ``[lo, hi]``.

    Used so 1920x1080 lands on Layout's 1920x1088 (not floor 1024) and
    1280x720 lands on the closest on-grid HD stand-in.
    """
    lo_al = ((lo + multiple - 1) // multiple) * multiple
    hi_al = (hi // multiple) * multiple
    if hi_al < lo_al:
        return lo_al
    snapped = int(round(value / float(multiple))) * multiple
    return max(lo_al, min(snapped, hi_al))


def parse_size(
    size: Optional[str],
    *,
    model_name: str | None = None,
) -> tuple[int, int]:
    kind = _workflow_kind(model_name or DEFAULT_VIDEO_ID)
    raw = (size or "").lower().strip()
    if "x" not in raw:
        if kind == "minimax-h3":
            return MINIMAX_DEFAULT_WIDTH, MINIMAX_DEFAULT_HEIGHT
        if kind == "wan2.2-t2v":
            return WAN22_T2V_DEFAULT_WIDTH, WAN22_T2V_DEFAULT_HEIGHT
        if kind == "wan2.2-ti2v-5b":
            return WAN22_TI2V_DEFAULT_WIDTH, WAN22_TI2V_DEFAULT_HEIGHT
        if kind == "ltx-2.5-layout-to-render":
            return 1280, 704
        if kind == "ltx-2.5-union-control":
            return 1280, 768
        return DEFAULT_WIDTH, DEFAULT_HEIGHT
    w_s, h_s = raw.split("x", 1)
    try:
        width, height = int(w_s), int(h_s)
    except ValueError as exc:
        raise VideoGenError(f"Invalid size: {size}", 400) from exc
    if width < 256 or height < 256:
        raise VideoGenError(f"size too small: {size}", 400)
    # MiniMax local 1080p stand-in 1920x1088 (/32). 1920x1080 snaps to it.
    # Reject fake 2K / oversize (2048x1152).
    if kind == "minimax-h3":
        short_edge = min(width, height)
        long_edge = max(width, height)
        if short_edge > MINIMAX_MAX_SHORT_EDGE or long_edge > MINIMAX_MAX_LONG_EDGE:
            raise VideoGenError(
                f"size {width}x{height} exceeds MiniMax H3 local max "
                f"{MINIMAX_MAX_LONG_EDGE}x{MINIMAX_MAX_SHORT_EDGE}",
                400,
            )
        if width * height > MINIMAX_MAX_PIXELS:
            raise VideoGenError(
                f"size {width}x{height} exceeds MiniMax H3 max pixels "
                f"{MINIMAX_MAX_PIXELS}",
                400,
            )
        width = _align_dim(width, 32, 256, MINIMAX_MAX_LONG_EDGE)
        height = _align_dim(height, 32, 256, MINIMAX_MAX_LONG_EDGE)
        if min(width, height) > MINIMAX_MAX_SHORT_EDGE:
            raise VideoGenError(
                f"size {width}x{height} exceeds MiniMax H3 local max "
                f"{MINIMAX_MAX_LONG_EDGE}x{MINIMAX_MAX_SHORT_EDGE}",
                400,
            )
        return width, height
    if kind == "wan2.2-t2v":
        # Catalog includes 640x640 (409600 px), slightly above 832x480.
        if width * height > 640 * 640:
            raise VideoGenError(
                f"size {width}x{height} exceeds Wan 2.2 T2V catalog max 640x640",
                400,
            )
        width = _align_dim(width, 32, 256, 832)
        height = _align_dim(height, 32, 256, 832)
        return width, height
    if kind == "wan2.2-ti2v-5b":
        if width * height > 1280 * 704:
            raise VideoGenError(
                f"size {width}x{height} exceeds Wan 2.2 TI2V-5B catalog max 1280x704",
                400,
            )
        width = _align_dim(width, 32, 256, 1280)
        height = _align_dim(height, 32, 256, 1280)
        return width, height
    if kind == "ltx-2.5-layout-to-render":
        # Two-stage upscaler x2: cap at 1920x1088 and snap to nearest /64 so
        # 1920x1080 becomes 1920x1088 (not floor 1024). Half-res stage-1
        # stays on the /32 grid.
        width = _align_dim(width, 64, 256, 1920)
        height = _align_dim(height, 64, 256, 1088)
        if width < 256 or height < 256:
            raise VideoGenError(f"Invalid size after align: {size}", 400)
        return width, height
    if kind == "ltx-2.5-union-control":
        # Two-stage upscaler x2, but the Union Control IC-LoRA patchify needs
        # the half-res stage-1 latent even on the /32 grid, so snap to /128.
        # 1280x720 → 1280x768 (nearest HD-ish); 1920x1080 → 1920x1024.
        width = _align_dim(width, 128, 256, 1920)
        height = _align_dim(height, 128, 256, 1024)
        if width < 256 or height < 256:
            raise VideoGenError(f"Invalid size after align: {size}", 400)
        return width, height
    width = _align_dim(width, 32, 256, 768)
    height = _align_dim(height, 32, 256, 768)
    if width < 256 or height < 256:
        raise VideoGenError(f"Invalid size after align: {size}", 400)
    return width, height


def decode_input_reference(
    raw: Optional[str | bytes],
) -> Optional[tuple[bytes, str]]:
    """Decode a look-still from a data URL, raw base64, or uploaded file bytes.

    Returns ``(bytes, mime)`` or ``None`` when the field is empty.
    Multipart file uploads pass raw jpeg/png/webp/gif bytes (not base64).
    """
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        data = bytes(raw)
        if not data:
            return None
        if len(data) < 32 or len(data) > _MAX_IMAGE_BYTES:
            raise VideoGenError("input_reference is empty or larger than 12MB", 400)
        return data, _sniff_image_mime(data)
    text = str(raw).strip()
    if not text:
        return None
    if text.startswith("data:"):
        header, sep, b64 = text.partition(",")
        if not sep or "base64" not in header.lower():
            raise VideoGenError(
                "input_reference must be a base64 data URL or raw base64",
                400,
            )
        try:
            data = base64.b64decode(b64, validate=False)
        except Exception as exc:
            raise VideoGenError("input_reference is not valid base64", 400) from exc
    else:
        try:
            data = base64.b64decode(text, validate=False)
        except Exception as exc:
            raise VideoGenError("input_reference is not valid base64", 400) from exc
    if len(data) < 32 or len(data) > _MAX_IMAGE_BYTES:
        raise VideoGenError("input_reference is empty or larger than 12MB", 400)
    return data, _sniff_image_mime(data)


def _sniff_image_mime(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    raise VideoGenError("input_reference must be png, jpeg, webp, or gif", 400)


def decode_clay_reference(
    raw: Optional[str | bytes],
    *,
    field: str = "clay_reference",
) -> Optional[tuple[bytes, str]]:
    """Decode a clay/control video from a data URL, raw base64, or file bytes.

    Returns ``(bytes, mime)`` or ``None`` when the field is empty. The clay
    guide drives motion/layout for Layout-To-Render; it is a short video, not
    a still (the look reference stays ``input_reference``).
    """
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        data = bytes(raw)
        if not data:
            return None
        if len(data) < 64 or len(data) > _MAX_CLAY_BYTES:
            raise VideoGenError(f"{field} is empty or larger than 64MB", 400)
        return data, _sniff_video_mime(data, field=field)
    text = str(raw).strip()
    if not text:
        return None
    if text.startswith("data:"):
        _, sep, b64 = text.partition(",")
        if not sep:
            raise VideoGenError(
                f"{field} must be a base64 data URL or raw base64", 400
            )
        text = b64
    try:
        data = base64.b64decode(text, validate=False)
    except Exception as exc:
        raise VideoGenError(f"{field} is not valid base64", 400) from exc
    if len(data) < 64 or len(data) > _MAX_CLAY_BYTES:
        raise VideoGenError(f"{field} is empty or larger than 64MB", 400)
    return data, _sniff_video_mime(data, field=field)


def _sniff_video_mime(data: bytes, *, field: str = "clay_reference") -> str:
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "video/mp4"
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    raise VideoGenError(f"{field} must be an mp4 or webm video", 400)


def _parse_optional_bool(raw: Any, *, field: str = "audio") -> Optional[bool]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in ("1", "true", "yes", "on"):
        return True
    if text in ("0", "false", "no", "off"):
        return False
    raise VideoGenError(f"Invalid {field} flag: {raw}", 400)


async def _read_form_value(value: Any) -> Optional[str | bytes]:
    """Return upload bytes or a text field; empty becomes None."""
    if value is None:
        return None
    read = getattr(value, "read", None)
    filename = getattr(value, "filename", None)
    if callable(read) and filename is not None:
        data = read()
        if inspect.isawaitable(data):
            data = await data
        if not data:
            return None
        if isinstance(data, str):
            data = data.encode("utf-8")
        return bytes(data)
    text = str(value).strip()
    return text or None


def kwargs_from_video_json(payload: Any) -> dict[str, Any]:
    """Map a JSON body onto ``enqueue_video`` kwargs."""
    if not isinstance(payload, dict):
        raise VideoGenError("JSON body must be an object", 400)
    audio = payload.get("audio")
    if audio is None:
        audio = payload.get("with_audio")
    return {
        "prompt": payload.get("prompt"),
        "model": payload.get("model"),
        "seconds": payload.get("seconds"),
        "size": payload.get("size"),
        "input_reference": payload.get("input_reference"),
        "clay_reference": payload.get("clay_reference"),
        "control_reference": payload.get("control_reference"),
        "fps": payload.get("fps"),
        "audio": audio,
        "extend_from": payload.get("extend_from"),
    }


async def kwargs_from_video_form(form: Mapping[str, Any]) -> dict[str, Any]:
    """Map multipart / urlencoded fields onto ``enqueue_video`` kwargs."""
    audio_raw = form.get("audio")
    if audio_raw is None:
        audio_raw = form.get("with_audio")
    prompt_val = form.get("prompt")
    if hasattr(prompt_val, "filename"):
        prompt_val = await _read_form_value(prompt_val)
        if isinstance(prompt_val, bytes):
            prompt_val = prompt_val.decode("utf-8", "replace")
    return {
        "prompt": prompt_val,
        "model": form.get("model") or None,
        "seconds": form.get("seconds") or None,
        "size": form.get("size") or None,
        "input_reference": await _read_form_value(form.get("input_reference")),
        "clay_reference": await _read_form_value(form.get("clay_reference")),
        "control_reference": await _read_form_value(form.get("control_reference")),
        "fps": form.get("fps") or None,
        "audio": _parse_optional_bool(audio_raw),
        "extend_from": form.get("extend_from") or None,
    }


async def request_kwargs_from_http(request: Any) -> dict[str, Any]:
    """Parse POST /v1/videos as JSON or multipart. JSON data-URLs still work."""
    ctype = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in ctype or "application/x-www-form-urlencoded" in ctype:
        form = await request.form()
        try:
            return await kwargs_from_video_form(form)
        finally:
            closer = getattr(form, "aclose", None) or getattr(form, "close", None)
            if closer:
                result = closer()
                if inspect.isawaitable(result):
                    await result
    try:
        payload = await request.json()
    except Exception as exc:
        raise VideoGenError(
            "body must be application/json or multipart/form-data",
            400,
        ) from exc
    return kwargs_from_video_json(payload)


def _apply_fps(workflow: dict[str, Any], fps: int) -> None:
    """Set CreateVideo.fps and LTXVConditioning.frame_rate when present."""
    for node in workflow.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        class_type = node.get("class_type")
        if class_type == "CreateVideo" and "fps" in inputs:
            inputs["fps"] = float(fps)
        if class_type == "LTXVConditioning" and "frame_rate" in inputs:
            inputs["frame_rate"] = float(fps)


def _strip_minimax_audio(workflow: dict[str, Any]) -> None:
    """Drop audio VAE decode so CreateVideo exports video-only."""
    workflow.pop("4", None)
    workflow.pop("12", None)
    create = workflow.get("13")
    if isinstance(create, dict) and create.get("class_type") == "CreateVideo":
        inputs = create.setdefault("inputs", {})
        inputs.pop("audio", None)
        inputs["images"] = ["11", 0]


def apply_workflow(
    workflow: dict[str, Any],
    *,
    prompt: str,
    model: str,
    width: int,
    height: int,
    length: int,
    steps: int,
    seed: int,
    image: Optional[str] = None,
    clay_video: Optional[str] = None,
    fps: int = 24,
    with_audio: bool = True,
) -> None:
    kind = _workflow_kind(model)
    if kind == "minimax-h3":
        workflow["5"]["inputs"]["prompt"] = prompt
        workflow["5"]["inputs"]["width"] = width
        workflow["5"]["inputs"]["height"] = height
        workflow["5"]["inputs"]["length"] = length
        workflow["1"]["inputs"]["unet_name"] = model
        workflow["8"]["inputs"]["steps"] = steps
        workflow["6"]["inputs"]["noise_seed"] = seed
        if image is not None and "15" in workflow:
            workflow["15"]["inputs"]["image"] = image
        if not with_audio:
            _strip_minimax_audio(workflow)
        _apply_fps(workflow, fps)
        return
    if kind == "ltx-2.5":
        workflow["1"]["inputs"]["unet_name"] = model
        workflow["2"]["inputs"]["text"] = prompt
        workflow["7"]["inputs"]["steps"] = steps
        workflow["9"]["inputs"]["noise_seed"] = seed
        if image is not None and "13" in workflow:
            workflow["13"]["inputs"]["image"] = image
            workflow["5"]["inputs"]["width"] = width
            workflow["5"]["inputs"]["height"] = height
            workflow["5"]["inputs"]["length"] = length
        else:
            workflow["5"]["inputs"]["width"] = width
            workflow["5"]["inputs"]["height"] = height
            workflow["5"]["inputs"]["length"] = length
        _apply_fps(workflow, fps)
        return
    if kind == "ltx-2.5-layout-to-render":
        if image is None:
            raise VideoGenError(
                "ltx-2.5-layout-to-render requires input_reference "
                "(look-still image; clay guide defaults to it)",
                400,
            )
        # Two-stage: sample at half res, upscaler x2 lands on the final size.
        # Stage-1 dims are /32 because parse_size returns layout sizes on /64.
        w1 = max(32, (width // 2) - (width // 2) % 32)
        h1 = max(32, (height // 2) - (height // 2) % 32)
        workflow["look"]["inputs"]["image"] = image
        if clay_video is not None:
            # Dual-input: clay guide frames come from an uploaded video. Swap
            # the clay LoadImage for LoadVideo + GetVideoComponents and point
            # the stage-1/2 guides at the decoded frames.
            workflow["clay"] = {
                "inputs": {"file": clay_video},
                "class_type": "LoadVideo",
            }
            workflow["claycomp"] = {
                "inputs": {"video": ["clay", 0]},
                "class_type": "GetVideoComponents",
            }
            workflow["g1a"]["inputs"]["image"] = ["claycomp", 0]
            workflow["g2a"]["inputs"]["image"] = ["claycomp", 0]
        else:
            # Single-input: the clay layout guide reuses the look still.
            workflow["clay"]["inputs"]["image"] = image
        workflow["pos_enc"]["inputs"]["text"] = prompt
        workflow["empty"]["inputs"]["width"] = w1
        workflow["empty"]["inputs"]["height"] = h1
        workflow["empty"]["inputs"]["length"] = length
        workflow["noise1"]["inputs"]["noise_seed"] = seed
        workflow["noise2"]["inputs"]["noise_seed"] = seed
        _apply_fps(workflow, fps)
        return
    if kind == "ltx-2.5-union-control":
        if clay_video is None:
            raise VideoGenError(
                "ltx-2.5-union-control requires control_reference "
                "(a depth/canny/pose control clip)",
                400,
            )
        # Two-stage: sample at half res, upscaler x2 lands on the final size.
        # parse_size returns /128 sizes so the half-res stage-1 latent is even
        # on the /32 grid (the IC-LoRA patchify needs even dims).
        w1 = max(32, (width // 2) - (width // 2) % 32)
        h1 = max(32, (height // 2) - (height // 2) % 32)
        workflow["ctrl"]["inputs"]["file"] = clay_video
        workflow["pos_enc"]["inputs"]["text"] = prompt
        workflow["empty"]["inputs"]["width"] = w1
        workflow["empty"]["inputs"]["height"] = h1
        workflow["empty"]["inputs"]["length"] = length
        workflow["noise1"]["inputs"]["noise_seed"] = seed
        workflow["noise2"]["inputs"]["noise_seed"] = seed
        _apply_fps(workflow, fps)
        return
    if kind == "wan2.2-t2v":
        workflow["99"]["inputs"]["text"] = prompt
        workflow["95"]["inputs"]["width"] = width
        workflow["95"]["inputs"]["height"] = height
        workflow["95"]["inputs"]["length"] = length
        workflow["96"]["inputs"]["noise_seed"] = seed
        workflow["96"]["inputs"]["steps"] = max(4, steps)
        workflow["97"]["inputs"]["steps"] = max(4, steps)
        split = max(1, int(workflow["96"]["inputs"]["steps"]) // 2)
        workflow["96"]["inputs"]["end_at_step"] = split
        workflow["97"]["inputs"]["start_at_step"] = split
        _apply_fps(workflow, fps)
        return
    if kind == "wan2.2-ti2v-5b":
        workflow["6"]["inputs"]["text"] = prompt
        workflow["55"]["inputs"]["width"] = width
        workflow["55"]["inputs"]["height"] = height
        workflow["55"]["inputs"]["length"] = length
        workflow["3"]["inputs"]["seed"] = seed
        workflow["3"]["inputs"]["steps"] = max(4, steps)
        if image is not None and "56" in workflow:
            workflow["56"]["inputs"]["image"] = image
        _apply_fps(workflow, fps)
        return
    nodes = _I2V_NODES if image else _NODES
    payload = {
        "prompt": prompt,
        "model": model,
        "width": width,
        "height": height,
        "length": length,
        "steps": steps,
        "seed": seed,
    }
    if image is not None:
        payload["image"] = image
    for node in nodes:
        value = payload[node["type"]]
        key = node["key"]
        for node_id in node["node_ids"]:
            workflow[node_id]["inputs"][key] = value
    _apply_fps(workflow, fps)


def select_workflow(
    model_name: str,
    *,
    image: Optional[str] = None,
) -> dict[str, Any]:
    """Return a deep-copied Comfy API graph for *model_name*."""
    kind = _workflow_kind(model_name)
    if kind == "minimax-h3":
        return copy.deepcopy(_MINIMAX_I2V_WORKFLOW if image else _MINIMAX_WORKFLOW)
    if kind == "ltx-2.5-layout-to-render":
        return copy.deepcopy(_LAYOUT_WORKFLOW)
    if kind == "ltx-2.5-union-control":
        return copy.deepcopy(_UNION_CONTROL_WORKFLOW)
    if kind == "ltx-2.5":
        return copy.deepcopy(_LTX25_I2V_WORKFLOW if image else _LTX25_WORKFLOW)
    if kind == "wan2.2-t2v":
        return copy.deepcopy(_WAN22_T2V_WORKFLOW)
    if kind == "wan2.2-ti2v-5b":
        return copy.deepcopy(
            _WAN22_TI2V_I2V_WORKFLOW if image else _WAN22_TI2V_WORKFLOW
        )
    return copy.deepcopy(_I2V_WORKFLOW if image else _WORKFLOW)


def _job_dir(video_id: str) -> Path:
    return _VIDEO_STORE / video_id


def _persist_job(video_id: str, record: dict[str, Any]) -> None:
    """Write meta (+ mp4/last_frame when present) under the hostPath store."""
    try:
        root = _job_dir(video_id)
        root.mkdir(parents=True, exist_ok=True)
        meta = dict(record.get("meta") or {})
        (root / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        mp4 = record.get("mp4")
        if isinstance(mp4, (bytes, bytearray)) and mp4:
            (root / "clip.mp4").write_bytes(bytes(mp4))
        frame = record.get("last_frame")
        if isinstance(frame, (bytes, bytearray)) and frame:
            (root / "last.jpg").write_bytes(bytes(frame))
    except Exception as exc:
        LOG.warning("video store persist failed for %s: %s", video_id, exc)


def _purge_job_dir(video_id: str) -> None:
    path = _job_dir(video_id)
    if path.is_dir():
        try:
            shutil.rmtree(path)
        except Exception as exc:
            LOG.warning("video store purge failed for %s: %s", video_id, exc)


def _load_job_from_disk(video_id: str) -> dict[str, Any] | None:
    root = _job_dir(video_id)
    meta_path = root / "meta.json"
    if not meta_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(meta, dict):
        return None
    record: dict[str, Any] = {"meta": meta, "mp4": None}
    mp4_path = root / "clip.mp4"
    if mp4_path.is_file():
        try:
            record["mp4"] = mp4_path.read_bytes()
        except Exception:
            pass
    frame_path = root / "last.jpg"
    if frame_path.is_file():
        try:
            record["last_frame"] = frame_path.read_bytes()
        except Exception:
            pass
    return record


def _ensure_store_loaded() -> None:
    global _STORE_LOADED
    if _STORE_LOADED:
        return
    _STORE_LOADED = True
    try:
        _VIDEO_STORE.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        LOG.warning("video store mkdir failed: %s", exc)
        return
    loaded = 0
    try:
        for child in sorted(_VIDEO_STORE.iterdir(), key=lambda p: p.stat().st_mtime):
            if not child.is_dir() or not child.name.startswith("video_"):
                continue
            if child.name in _CLIPS:
                continue
            record = _load_job_from_disk(child.name)
            if record:
                _CLIPS[child.name] = record
                loaded += 1
    except Exception as exc:
        LOG.warning("video store load failed: %s", exc)
        return
    if loaded:
        LOG.info("video store loaded %s job(s) from %s", loaded, _VIDEO_STORE)


def _remember(video_id: str, record: dict[str, Any]) -> None:
    _ensure_store_loaded()
    _CLIPS[video_id] = record
    _persist_job(video_id, record)
    finished = [
        key
        for key, rec in _CLIPS.items()
        if rec.get("meta", {}).get("status") in ("completed", "failed", "cancelled")
    ]
    finished.sort(key=lambda key: int((_CLIPS[key].get("meta") or {}).get("created_at") or 0))
    while len(_CLIPS) > _CLIP_LIMIT and finished:
        evicted = finished.pop(0)
        _CLIPS.pop(evicted, None)
        _purge_job_dir(evicted)


def get_video(video_id: str) -> dict[str, Any]:
    _ensure_store_loaded()
    record = _CLIPS.get(video_id)
    if not record:
        record = _load_job_from_disk(video_id)
        if record:
            _CLIPS[video_id] = record
    if not record:
        raise VideoGenError("Video not found", 404)
    return record["meta"]


def list_videos(*, prompt_limit: int = 80) -> list[dict[str, Any]]:
    """Return video metas (newest first). No mp4 bytes."""
    _ensure_store_loaded()
    rows: list[dict[str, Any]] = []
    for record in _CLIPS.values():
        meta = dict(record.get("meta") or {})
        prompt = meta.get("prompt")
        if isinstance(prompt, str) and prompt_limit > 0 and len(prompt) > prompt_limit:
            meta["prompt"] = prompt[: max(0, prompt_limit - 3)] + "..."
        rows.append(meta)
    rows.sort(key=lambda item: int(item.get("created_at") or 0), reverse=True)
    return rows


def get_video_bytes(video_id: str) -> bytes:
    _ensure_store_loaded()
    record = _CLIPS.get(video_id)
    if not record:
        record = _load_job_from_disk(video_id)
        if record:
            _CLIPS[video_id] = record
    if not record:
        raise VideoGenError("Video not found", 404)
    status = (record.get("meta") or {}).get("status")
    payload = record.get("mp4")
    if not payload:
        disk = _job_dir(video_id) / "clip.mp4"
        if disk.is_file():
            payload = disk.read_bytes()
            record["mp4"] = payload
    if status != "completed" or not payload:
        if status == "failed":
            err = (record.get("meta") or {}).get("error") or {}
            message = err.get("message") if isinstance(err, dict) else str(err)
            raise VideoGenError(message or "Video generation failed", 409)
        raise VideoGenError(f"Video is {status or 'queued'}", 409)
    return payload


def _media_files(history: dict[str, Any], workflow: dict[str, Any]) -> list[dict[str, Any]]:
    status = history.get("status") or {}
    if status.get("status_str") == "error":
        messages = status.get("messages") or []
        detail = ""
        if messages:
            detail = str(messages[-1])[:300]
        raise VideoGenError(detail or "ComfyUI video workflow failed", 502)
    files: list[dict[str, Any]] = []
    outputs = history.get("outputs") or {}
    for node_id, node_out in outputs.items():
        if not isinstance(node_out, dict):
            continue
        class_type = (workflow.get(node_id) or {}).get("class_type")
        if class_type not in ("SaveVideo", "SaveWEBM"):
            continue
        for key in ("videos", "gifs", "images"):
            for item in node_out.get(key) or []:
                if isinstance(item, dict) and item.get("filename"):
                    files.append(item)
    return files


async def _catalog(client: httpx.AsyncClient) -> list[dict[str, Any]] | None:
    """Cold gateway list. Does not scale the GPU deployment."""
    try:
        resp = await client.get(
            f"{COMFYUI_URL}/__gateway/image-models",
            timeout=8.0,
        )
    except httpx.HTTPError as exc:
        LOG.warning("video catalog unreachable: %s", exc)
        return None
    if resp.status_code >= 400:
        return None
    try:
        rows = resp.json().get("video_checkpoints")
    except Exception:
        return None
    if not isinstance(rows, list):
        return None
    return rows


def _image_ext(mime: str) -> str:
    return {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
    }.get(mime, "png")


def _video_ext(mime: str) -> str:
    return {"video/mp4": "mp4", "video/webm": "webm"}.get(mime, "mp4")


async def _upload_input_video(
    client: httpx.AsyncClient,
    data: bytes,
    mime: str,
    video_id: str,
    *,
    timeout_s: float,
) -> str:
    """Upload a clay video to Comfy input/. Comfy /upload/image takes video."""
    filename = f"{video_id}-clay.{_video_ext(mime)}"
    try:
        resp = await client.post(
            f"{COMFYUI_URL}/upload/image",
            data={"type": "input"},
            files={"image": (filename, data, mime)},
            timeout=timeout_s,
        )
    except httpx.HTTPError as exc:
        raise VideoGenError(f"ComfyUI clay upload failed: {exc}", 503) from exc
    if resp.status_code >= 400:
        raise VideoGenError(
            f"ComfyUI rejected clay video ({resp.status_code}): {resp.text[:300]}",
            502,
        )
    try:
        name = resp.json().get("name")
    except Exception as exc:
        raise VideoGenError("ComfyUI clay upload returned no filename", 502) from exc
    if not name:
        raise VideoGenError("ComfyUI clay upload returned no filename", 502)
    return str(name)


async def _upload_input_image(
    client: httpx.AsyncClient,
    data: bytes,
    mime: str,
    video_id: str,
    *,
    timeout_s: float,
) -> str:
    """Upload a screenshot to Comfy input/. This request wakes the GPU pod."""
    filename = f"{video_id}.{_image_ext(mime)}"
    try:
        resp = await client.post(
            f"{COMFYUI_URL}/upload/image",
            data={"type": "input"},
            files={"image": (filename, data, mime)},
            timeout=timeout_s,
        )
    except httpx.HTTPError as exc:
        raise VideoGenError(f"ComfyUI image upload failed: {exc}", 503) from exc
    if resp.status_code >= 400:
        raise VideoGenError(
            f"ComfyUI rejected image ({resp.status_code}): {resp.text[:300]}",
            502,
        )
    try:
        name = resp.json().get("name")
    except Exception as exc:
        raise VideoGenError("ComfyUI image upload returned no filename", 502) from exc
    if not name:
        raise VideoGenError("ComfyUI image upload returned no filename", 502)
    return str(name)


def _extract_last_frame_jpeg(mp4: bytes) -> bytes:
    """Grab the last frame of an mp4 as JPEG (needs ffmpeg in the image)."""
    ffmpeg = os.environ.get("FFMPEG_BIN") or "ffmpeg"
    with tempfile.TemporaryDirectory(prefix="spockify-video-") as tmp:
        src = os.path.join(tmp, "clip.mp4")
        dst = os.path.join(tmp, "last.jpg")
        with open(src, "wb") as handle:
            handle.write(mp4)
        cmd = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-sseof",
            "-0.15",
            "-i",
            src,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            dst,
        ]
        try:
            proc = subprocess.run(
                cmd,
                check=False,
                capture_output=True,
                timeout=60,
            )
        except FileNotFoundError as exc:
            raise VideoGenError(
                "extend_from needs ffmpeg in the router image "
                "(or pass input_reference as the last frame)",
                503,
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise VideoGenError("ffmpeg timed out extracting last frame", 504) from exc
        if proc.returncode != 0 or not os.path.isfile(dst):
            detail = (proc.stderr or b"").decode("utf-8", "replace")[:200]
            raise VideoGenError(
                f"could not extract last frame for extend: {detail or 'ffmpeg failed'}",
                502,
            )
        with open(dst, "rb") as handle:
            data = handle.read()
    if len(data) < 32:
        raise VideoGenError("extend last-frame extract was empty", 502)
    return data


def last_frame_from_video_id(video_id: str) -> tuple[bytes, str]:
    """Return (jpeg_bytes, mime) from a completed clip (memory or disk store)."""
    _ensure_store_loaded()
    record = _CLIPS.get(video_id)
    if not record:
        record = _load_job_from_disk(video_id)
        if record:
            _CLIPS[video_id] = record
    if not record:
        raise VideoGenError(
            f"extend_from video not found: {video_id} "
            "(completed jobs live under /var/lib/spockify/video-jobs; "
            "missing id means it never completed or was purged)",
            404,
        )
    meta = record.get("meta") or {}
    status = meta.get("status")
    if status != "completed":
        raise VideoGenError(
            f"extend_from video is {status or 'unknown'}; need a completed clip",
            409,
        )
    cached = record.get("last_frame")
    if isinstance(cached, (bytes, bytearray)) and len(cached) > 32:
        return bytes(cached), "image/jpeg"
    mp4 = record.get("mp4")
    if not isinstance(mp4, (bytes, bytearray)) or len(mp4) < 32:
        raise VideoGenError("extend_from video has no mp4 bytes", 409)
    frame = _extract_last_frame_jpeg(bytes(mp4))
    record["last_frame"] = frame
    return frame, "image/jpeg"


def _http_error_message(
    exc: BaseException, *, timeout_s: Optional[float] = None
) -> str:
    """Map empty ReadTimeout / connect errors to actionable text."""
    text = str(exc).strip() or type(exc).__name__
    lower = text.lower()
    budget = int(timeout_s if timeout_s is not None else VIDEO_POLL_TIMEOUT_S)
    if isinstance(exc, httpx.ReadTimeout) or "readtimeout" in lower:
        return (
            "ComfyUI read timed out while waiting for the video render "
            f"(poll budget {budget}s). Interrupted the GPU job; "
            "check GET /v1/videos or `make show-jobs`."
        )
    if isinstance(exc, httpx.ConnectTimeout) or "connecttimeout" in lower:
        return "ComfyUI gateway connect timed out (GPU wake may be slow)"
    if isinstance(exc, httpx.TimeoutException) or "timeout" in lower:
        return f"ComfyUI request timed out: {text[:240]}"
    return text[:400]


async def interrupt_comfy(
    client: Optional[httpx.AsyncClient] = None,
    prompt_id: Optional[str] = None,
) -> None:
    """Stop the running Comfy prompt and drop it from the pending queue."""
    close = False
    if client is None:
        client = httpx.AsyncClient()
        close = True
    try:
        try:
            await client.post(f"{COMFYUI_URL}/interrupt", timeout=15.0)
        except Exception as exc:
            LOG.warning("Comfy /interrupt failed: %s", exc)
        if prompt_id:
            try:
                await client.post(
                    f"{COMFYUI_URL}/queue",
                    json={"delete": [prompt_id]},
                    timeout=15.0,
                )
            except Exception as exc:
                LOG.warning("Comfy queue delete %s failed: %s", prompt_id, exc)
    finally:
        if close:
            await client.aclose()


def _job_cancelled(video_id: str) -> bool:
    record = _CLIPS.get(video_id)
    if not record:
        return False
    return (record.get("meta") or {}).get("status") in ("cancelled", "failed")


def _bind_job_task(video_id: str, task: asyncio.Task[None]) -> None:
    _TASKS.add(task)
    _JOB_TASKS[video_id] = task

    def _done(done: asyncio.Task[None]) -> None:
        _TASKS.discard(done)
        if _JOB_TASKS.get(video_id) is done:
            _JOB_TASKS.pop(video_id, None)

    task.add_done_callback(_done)


async def _render(
    *,
    prompt: str,
    model_name: str,
    width: int,
    height: int,
    length: int,
    image: Optional[tuple[bytes, str]],
    clay: Optional[tuple[bytes, str]] = None,
    video_id: str,
    fps: int = 24,
    with_audio: bool = True,
) -> bytes:
    kind = _workflow_kind(model_name)
    if kind == "minimax-h3":
        steps = MINIMAX_DEFAULT_STEPS
    elif kind in {"wan2.2-t2v", "wan2.2-ti2v-5b"}:
        steps = 20
    else:
        steps = DEFAULT_STEPS
    seed = random.randint(0, 1125899906842624)
    timeout_s = video_poll_timeout_s(model_name)
    prompt_id: Optional[str] = None
    record = _CLIPS.get(video_id)
    try:
        async with httpx.AsyncClient() as client:
            image_name = None
            if image is not None:
                image_name = await _upload_input_image(
                    client, image[0], image[1], video_id, timeout_s=timeout_s
                )
            clay_name = None
            if clay is not None:
                clay_name = await _upload_input_video(
                    client, clay[0], clay[1], video_id, timeout_s=timeout_s
                )
            workflow = select_workflow(model_name, image=image_name)
            apply_workflow(
                workflow,
                prompt=prompt,
                model=model_name,
                width=width,
                height=height,
                length=length,
                steps=steps,
                seed=seed,
                image=image_name,
                clay_video=clay_name,
                fps=fps,
                with_audio=with_audio,
            )
            # /prompt (and /upload/image above) wakes the GPU replica.
            # gpt-oss pins stay loaded.
            prompt_id = await _queue_prompt(
                client, workflow, str(uuid.uuid4()), timeout_s=timeout_s
            )
            if record is not None:
                record["prompt_id"] = prompt_id
            try:
                history = await _wait_history(
                    client, prompt_id, timeout_s=timeout_s
                )
            except BaseException:
                await interrupt_comfy(client, prompt_id)
                raise
            files = _media_files(history, workflow)
            if not files:
                raise VideoGenError("ComfyUI produced no video output", 502)
            media = files[0]
            return await _download_image(
                client,
                media["filename"],
                media.get("subfolder") or "",
                media.get("type") or "output",
            )
    except asyncio.CancelledError:
        await interrupt_comfy(prompt_id=prompt_id)
        raise
    except VideoGenError:
        raise
    except ImageGenError as exc:
        # _wait_history / _queue_prompt raise ImageGenError (parent of VideoGenError).
        msg = str(exc)
        if "timed out" in msg.lower():
            msg = _http_error_message(httpx.ReadTimeout(msg), timeout_s=timeout_s)
        raise VideoGenError(msg, getattr(exc, "status_code", 502) or 502) from exc
    except httpx.HTTPError as exc:
        raise VideoGenError(
            _http_error_message(exc, timeout_s=timeout_s), 504
        ) from exc


async def _generate_job(
    video_id: str,
    *,
    prompt: str,
    model_name: str,
    width: int,
    height: int,
    length: int,
    image: Optional[tuple[bytes, str]],
    clay: Optional[tuple[bytes, str]] = None,
    fps: int = 24,
    with_audio: bool = True,
) -> None:
    record = _CLIPS.get(video_id)
    if not record:
        return
    meta = record["meta"]
    if _job_cancelled(video_id):
        return
    raw: Optional[bytes] = None
    try:
        async with _RENDER_LOCK:
            if _job_cancelled(video_id):
                return
            meta["status"] = "in_progress"
            meta["progress"] = 10
            _persist_job(video_id, record)
            raw = await _render(
                prompt=prompt,
                model_name=model_name,
                width=width,
                height=height,
                length=length,
                image=image,
                clay=clay,
                video_id=video_id,
                fps=fps,
                with_audio=with_audio,
            )
    except asyncio.CancelledError:
        if meta.get("status") not in ("cancelled", "failed"):
            meta["status"] = "cancelled"
            meta["error"] = {"message": "cancelled"}
            _persist_job(video_id, record)
        raise
    except VideoGenError as exc:
        if meta.get("status") == "cancelled":
            return
        LOG.warning("video %s failed: %s", video_id, exc)
        meta["status"] = "failed"
        meta["error"] = {"message": str(exc)}
        _persist_job(video_id, record)
        return
    except Exception as exc:
        if meta.get("status") == "cancelled":
            return
        LOG.exception("video %s failed", video_id)
        meta["status"] = "failed"
        meta["error"] = {
            "message": _http_error_message(
                exc, timeout_s=video_poll_timeout_s(model_name)
            )
        }
        _persist_job(video_id, record)
        return
    if raw is None or _job_cancelled(video_id):
        return
    record["mp4"] = raw
    try:
        record["last_frame"] = _extract_last_frame_jpeg(raw)
    except Exception as exc:
        LOG.info("video %s last-frame cache skipped: %s", video_id, exc)
    meta["status"] = "completed"
    meta["progress"] = 100
    _persist_job(video_id, record)


async def cancel_video(video_id: str) -> dict[str, Any]:
    """Mark a job cancelled, stop its asyncio task, and interrupt Comfy.

    Does not acquire the render lock (cancel must not deadlock behind a
    running job). Interrupt only if this job has a prompt_id / is rendering.
    """
    _ensure_store_loaded()
    record = _CLIPS.get(video_id)
    if not record:
        record = _load_job_from_disk(video_id)
        if record:
            _CLIPS[video_id] = record
    if not record:
        raise VideoGenError("Video not found", 404)
    meta = record["meta"]
    status = meta.get("status")
    if status == "completed":
        raise VideoGenError("Video already completed", 409)
    if status in ("cancelled", "failed"):
        return dict(meta)
    meta["status"] = "cancelled"
    meta["error"] = {"message": "cancelled by client"}
    _persist_job(video_id, record)
    prompt_id = record.get("prompt_id")
    if status == "in_progress" or prompt_id:
        await interrupt_comfy(prompt_id=prompt_id if isinstance(prompt_id, str) else None)
    task = _JOB_TASKS.get(video_id)
    if task is not None and not task.done():
        task.cancel()
    return dict(meta)


async def enqueue_video(
    *,
    prompt: str,
    model: Optional[str] = None,
    seconds: Optional[str | float | int] = None,
    size: Optional[str] = None,
    input_reference: Optional[str | bytes] = None,
    clay_reference: Optional[str | bytes] = None,
    control_reference: Optional[str | bytes] = None,
    fps: Optional[str | float | int] = None,
    audio: Optional[bool] = None,
    extend_from: Optional[str] = None,
) -> dict[str, Any]:
    """Validate and return a queued video job. Generation continues after return."""
    if video_generation_disabled():
        raise VideoGenError(
            "Video generation temporarily disabled for maintenance",
            503,
        )
    prompt = (prompt or "").strip()
    if not prompt:
        raise VideoGenError("prompt is required", 400)
    if len(prompt) > 4000:
        raise VideoGenError("prompt too long (max 4000 chars)", 400)

    image = decode_input_reference(input_reference)
    clay = decode_clay_reference(clay_reference, field="clay_reference")
    control = decode_clay_reference(control_reference, field="control_reference")

    async with httpx.AsyncClient() as client:
        catalog = await _catalog(client)
    try:
        model_name = resolve_video_model(model, catalog)
    except UnknownImageModel as exc:
        raise VideoGenError(str(exc), 400) from exc

    rate, fps_snapped_from = resolve_fps(fps, model_name=model_name)
    with_audio, audio_ignored = resolve_audio(audio, model_name=model_name)
    extend_id = (extend_from or "").strip()
    if extend_id:
        if not extend_supported(model_name):
            raise VideoGenError(
                f"model {model_name} does not support extend "
                "(extend_supported=false in cold catalog)",
                400,
            )
        if image is None:
            image = last_frame_from_video_id(extend_id)

    length = snap_length(seconds, model_name=model_name, fps=rate)
    width, height = parse_size(size, model_name=model_name)
    if _workflow_kind(model_name) == "ltx-2.5-layout-to-render" and image is None:
        raise VideoGenError(
            "ltx-2.5-layout-to-render requires input_reference "
            "(look-still image). Clay guide is synthesized from that still "
            "when no separate clay video is provided.",
            400,
        )
    if clay is not None and _workflow_kind(model_name) != "ltx-2.5-layout-to-render":
        raise VideoGenError(
            "clay_reference only applies to ltx-2.5-layout-to-render",
            400,
        )
    if control is not None and _workflow_kind(model_name) != "ltx-2.5-union-control":
        raise VideoGenError(
            "control_reference only applies to ltx-2.5-union-control",
            400,
        )
    if _workflow_kind(model_name) == "ltx-2.5-union-control":
        if control is None:
            raise VideoGenError(
                "ltx-2.5-union-control requires control_reference "
                "(a depth/canny/pose control clip)",
                400,
            )
        # The control clip rides the same video channel as the clay guide.
        clay = control

    video_id = "video_" + uuid.uuid4().hex
    meta = {
        "id": video_id,
        "object": "video",
        "created_at": int(time.time()),
        "status": "queued",
        "model": model_name,
        "progress": 0,
        "seconds": str(max(1, int(round(length / float(rate))))),
        "size": f"{width}x{height}",
        "fps": rate,
        "audio": with_audio,
        "prompt": prompt,
        "poll_timeout_s": int(video_poll_timeout_s(model_name)),
    }
    if fps_snapped_from is not None:
        meta["fps_requested"] = fps_snapped_from
        meta["fps_snapped"] = True
    if audio_ignored:
        meta["audio_requested"] = True
        meta["audio_ignored"] = True
    if extend_id:
        meta["extend_from"] = extend_id
    if clay is not None:
        if _workflow_kind(model_name) == "ltx-2.5-union-control":
            meta["control_reference"] = True
        else:
            meta["clay_reference"] = True
    _remember(video_id, {"meta": meta, "mp4": None})
    body = dict(meta)
    task = asyncio.create_task(
        _generate_job(
            video_id,
            prompt=prompt,
            model_name=model_name,
            width=width,
            height=height,
            length=length,
            image=image,
            clay=clay,
            fps=rate,
            with_audio=with_audio,
        )
    )
    _bind_job_task(video_id, task)
    return body
