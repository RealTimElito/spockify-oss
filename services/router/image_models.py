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

from open_jealousy import (
    ILLUSTRIOUS_ID,
    extra_video_rows,
    illustrious_catalog_row,
    is_illustrious_alias,
    is_illustrious_file,
    open_jealousy_catalog,
)

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
    "qwen_image_2.1_vae_bf16.safetensors",
    "qwen2.1",
    "qwen-2.1",
    "qwen2.1-image",
    "qwen-2.1-image",
    "qwen-image21",
    "hf.co/abiray/qwen-image-2.1-turbo-gguf",
    "hf.co/abiray/qwen-image-2.1-turbo-gguf:latest",
}

# CheckpointLoaderSimple image graph. Video checkpoints use a different graph.
_VIDEO_MARKERS = (
    "ltxv",
    "ltx-video",
    "ltx_video",
    "ltx-2.5",
    "ltx_2.5",
    "minimax",
    "wan2.2",
    "wan2_2",
    "wan_",
)

DEFAULT_VIDEO_ID = "ltxv-2b-0.9.8-distilled-fp8.safetensors"

# Split-pack video models (UNETLoader + companions). Not image picker rows.
MINIMAX_H3_ID = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
MINIMAX_H3_CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
MINIMAX_H3_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"
MINIMAX_H3_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
# Official Comfy lightning LoRA for local 768p canvas (4 steps).
MINIMAX_H3_TURBO_LORA = (
    "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
)

LTX25_FAST_ID = "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
LTX25_PRO_ID = "ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors"
LTX25_CLIP = "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors"
LTX25_VAE = "ltx-2.5-video-vae-conv-bf16.safetensors"
LTX25_AUDIO_VAE = "ltx-2.5-audio-vae-bf16.safetensors"
LTX25_SPATIAL_UPSCALER = "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors"
LTX25_LAYOUT_LORA = "ltx-2.5-22b-ic-lora-layout-to-render-1.0.safetensors"
# Union Control IC-LoRA: structure-following v2v from a depth/canny/pose control
# clip (same distilled Fast base + spatial upscaler as Layout).
LTX25_UNION_CONTROL_LORA = "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors"
# Catalog / API id for the IC-LoRA path (attaches to distilled Fast base).
LTX25_LAYOUT_ID = "ltx-2.5-layout-to-render"
LTX25_UNION_CONTROL_ID = "ltx-2.5-union-control"
# Episode A-camera (silent Layout 1920x1088). DEFAULT_VIDEO_ID stays the LTX 2B
# checkpoint so empty catalogs and explicit 2B clients keep working.
EPISODE_A_CAMERA_ID = LTX25_LAYOUT_ID
# Relative to SPOCKIFY_IMAGE_MODELS_ROOT (hostPath /var/lib/spockify/comfyui).
# Fast/Pro share the distilled two-stage graph; Pro swaps the UNET to the dev
# transformer in Comfy. Built-in Templates: video_ltx2_5_t2v / video_ltx2_5_i2v.
LTX25_T2V_TEMPLATE = (
    "custom_nodes/ComfyUI-LTXVideo/example_workflows/2.5/"
    "LTX-2.5_T2V_I2V_Two_Stage_Distilled.json"
)
LTX25_LAYOUT_TEMPLATE = (
    "custom_nodes/ComfyUI-LTXVideo/example_workflows/2.5/"
    "LTX-2.5_ICLoRA_Layout_To_Render_Two_Stage_Distilled.json"
)
LTX25_UNION_CONTROL_TEMPLATE = (
    "custom_nodes/ComfyUI-LTXVideo/example_workflows/2.5/"
    "LTX-2.5_ICLoRA_Union_Control_Distilled.json"
)
# Non-conv video VAE used by the two-stage IC-LoRA graphs (Layout / Union).
LTX25_VIDEO_VAE_BF16 = "ltx-2.5-video-vae-bf16.safetensors"

# Wan 2.2 (Comfy-Org/Wan_2.2_ComfyUI_Repackaged). Native UNETLoader — no
# WanVideoWrapper. MoE T2V-A14B needs high+low experts; TI2V-5B is one UNET.
# Catalog id for MoE is logical (like layout-to-render); 5B uses the file name.
WAN22_T2V_ID = "wan2.2-t2v-a14b"
WAN22_T2V_HIGH = "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors"
WAN22_T2V_LOW = "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors"
# Wan 2.2 I2V-A14B — strongest local first-frame I2V (MoE high+low fp8).
WAN22_I2V_ID = "wan2.2-i2v-a14b"
WAN22_I2V_HIGH = "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
WAN22_I2V_LOW = "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
WAN22_TI2V_5B_ID = "wan2.2_ti2v_5B_fp16.safetensors"
WAN22_CLIP = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
WAN21_VAE = "wan_2.1_vae.safetensors"
WAN22_VAE = "wan2.2_vae.safetensors"
# Wan 2.1 FLF2V — honest first+last-frame substitute (Wan 2.7 has no local weights).
WAN21_FLF_ID = "wan2.1-flf2v"
WAN21_FLF_UNET = "wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors"
WAN21_CLIP_VISION = "clip_vision_h.safetensors"
# Wan 2.1 VACE 1.3B — motion-coherent V2V restyle (not Qwen; not Qwen-Video-Edit).
WAN21_VACE_ID = "wan2.1-vace-1.3b"
WAN21_VACE_UNET = "wan2.1_vace_1.3B_fp16.safetensors"
WAN22_T2V_LORA_HIGH = "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors"
WAN22_T2V_LORA_LOW = "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors"
WAN22_T2V_TEMPLATE = "workflows/video_wan2_2_14B_t2v.json"
WAN22_TI2V_TEMPLATE = "workflows/video_wan2_2_5B_ti2v.json"
WAN22_I2V_TEMPLATE = "workflows/video_wan2_2_14B_i2v.json"

_VIDEO_ALIASES = {
    "minimax-h3": MINIMAX_H3_ID,
    "minimax_h3": MINIMAX_H3_ID,
    "minimax-h3-2k": MINIMAX_H3_ID,
    "minimax_h3_2k": MINIMAX_H3_ID,
    "ltx-2.5-fast": LTX25_FAST_ID,
    "ltx-2.5-pro": LTX25_PRO_ID,
    "ltx25-fast": LTX25_FAST_ID,
    "ltx25-pro": LTX25_PRO_ID,
    "ltx-2.5-layout-to-render": LTX25_LAYOUT_ID,
    "ltx25-layout-to-render": LTX25_LAYOUT_ID,
    "layout-to-render": LTX25_LAYOUT_ID,
    "ltx-2.5-union-control": LTX25_UNION_CONTROL_ID,
    "ltx25-union-control": LTX25_UNION_CONTROL_ID,
    "union-control": LTX25_UNION_CONTROL_ID,
    "ltx-2.5-control": LTX25_UNION_CONTROL_ID,
    "wan2.2-t2v": WAN22_T2V_ID,
    "wan2.2-t2v-a14b": WAN22_T2V_ID,
    "wan22-t2v": WAN22_T2V_ID,
    "wan-2.2-t2v": WAN22_T2V_ID,
    WAN22_T2V_HIGH: WAN22_T2V_ID,
    "wan2.2-i2v": WAN22_I2V_ID,
    "wan2.2-i2v-a14b": WAN22_I2V_ID,
    "wan22-i2v": WAN22_I2V_ID,
    "wan22-i2v-a14b": WAN22_I2V_ID,
    "wan-2.2-i2v": WAN22_I2V_ID,
    WAN22_I2V_HIGH: WAN22_I2V_ID,
    WAN22_I2V_LOW: WAN22_I2V_ID,
    "wan2.2-ti2v-5b": WAN22_TI2V_5B_ID,
    "wan2.2-ti2v": WAN22_TI2V_5B_ID,
    "wan22-ti2v-5b": WAN22_TI2V_5B_ID,
    "wan-2.2-5b": WAN22_TI2V_5B_ID,
    "wan2.1-flf2v": WAN21_FLF_ID,
    "wan2.1-flf": WAN21_FLF_ID,
    "wan21-flf2v": WAN21_FLF_ID,
    "wan-flf2v": WAN21_FLF_ID,
    "flf2v": WAN21_FLF_ID,
    WAN21_FLF_UNET: WAN21_FLF_ID,
    "wan2.1-vace-1.3b": WAN21_VACE_ID,
    "wan2.1-vace": WAN21_VACE_ID,
    "wan21-vace-1.3b": WAN21_VACE_ID,
    "wan-vace": WAN21_VACE_ID,
    "vace-1.3b": WAN21_VACE_ID,
    "vace": WAN21_VACE_ID,
    WAN21_VACE_UNET: WAN21_VACE_ID,
}

# Composer Length / Resolution / FPS / audio / extend. Cold catalog so the UI
# is not forever hardcoded. MiniMax local open weights use Comfy's official
# 768-short-edge canvas (MAX_PIXELS=1344*768); no fake 1080p/2K picker rows.
_LTX_SIZES = ("704x480", "768x512", "512x768", "768x768", "640x384")
# Layout two-stage (upscaler x2): /64-aligned so the half-res stage-1 latent
# stays on the /32 grid. Headline is 1920x1088 @ 24fps (validated on Spark).
# 1280x720 is not /64 (snaps to 1280x704); 1280x768 is the taller HD-adjacent.
_LAYOUT_SIZES = (
    "1920x1088",
    "1280x768",
    "1280x704",
    "768x768",
    "768x512",
    "512x768",
    "704x448",
    "640x384",
)
# Union Control two-stage: the IC-LoRA patchify needs the half-res stage-1
# latent even on the /32 grid, so final dims must be /128-aligned.
_UNION_CONTROL_SIZES = (
    "1920x1024", "1280x768", "1024x1024", "896x512", "768x768", "640x384"
)
_MINIMAX_SIZES = (
    "1344x768",
    "1280x704",
    "1216x672",
    "960x544",
    "768x512",
    "704x480",
    "512x768",
)
# Wan 2.2 template defaults: 14B ~832x480 / 640²; 5B TI2V ~1280x704.
# No two-stage upscaler — do not advertise 1080p.
_WAN22_T2V_SIZES = ("832x480", "480x832", "640x640", "704x480")
_WAN22_I2V_SIZES = ("832x480", "480x832", "640x640", "704x480", "1280x704")
_WAN22_TI2V_SIZES = ("1280x704", "704x1280", "832x480", "704x480")
# Wan 2.1 FLF2V is a 720p model; small sizes look weak.
_WAN21_FLF_SIZES = ("1280x720", "720x1280", "832x480", "1280x704")
# VACE 1.3B is the small motion-coherent editor; keep canvases modest.
_WAN21_VACE_SIZES = ("832x480", "480x832", "640x640", "720x720", "704x480")
# Match comfy_extras.nodes_minimax_h3: BASE_SHORT_EDGE=768, MAX_PIXELS=1344*768.
MINIMAX_MAX_PIXELS = 1344 * 768
MINIMAX_MAX_SHORT_EDGE = 768
MINIMAX_MAX_LONG_EDGE = 1344

_VIDEO_LIMITS: dict[str, dict[str, Any]] = {
    "ltx-video": {
        "max_seconds": 10,
        "seconds": [1, 3, 5, 10],
        "sizes": list(_LTX_SIZES),
        "resolutions": list(_LTX_SIZES),
        "default_seconds": 3,
        "default_size": "704x480",
        "fps": [16, 24],
        "default_fps": 24,
        "audio_supported": False,
        "default_audio": False,
        "audio_ignored": True,
        "extend_supported": True,
        "dual_input_only": False,
        "series_role": "scratch",
        "max_pixels": 768 * 768,
        "notes": (
            "LTX 2B distilled: 1/3/5/10s; sizes up to 768 edge; fps 16/24; "
            "extend via last-frame I2V. No native audio (episode VO is muxed)."
        ),
    },
    "ltx-2.5": {
        "max_seconds": 10,
        "seconds": [1, 3, 5, 10],
        "sizes": list(_LTX_SIZES),
        "resolutions": list(_LTX_SIZES),
        "default_seconds": 3,
        "default_size": "704x480",
        "fps": [16, 24],
        "default_fps": 24,
        # Audio VAE is on disk; full T2A graph not wired — episode audio is
        # XTTS VO mux and/or H3 scratch, not Layout/LTX native audio.
        "audio_supported": False,
        "default_audio": False,
        "audio_ignored": True,
        "audio_vae": LTX25_AUDIO_VAE,
        "audio_vae_wired": False,
        "extend_supported": True,
        "dual_input_only": False,
        "series_role": "scratch",
        "max_pixels": 768 * 768,
        "notes": (
            "LTX-2.5 Fast/Pro via /v1/videos (UNET + Gemma CLIP + video VAE). "
            "Composer: 1/3/5/10s, ≤768-edge sizes, fps 16/24, extend I2V. "
            "Not 4K/50fps. ltx-2.5-audio-vae-bf16 is on disk but unwired "
            "(audio_ignored); mux XTTS VO instead."
        ),
    },
    "minimax-h3": {
        "max_seconds": 15,
        "seconds": [1, 3, 5, 10, 15],
        "sizes": list(_MINIMAX_SIZES),
        "resolutions": list(_MINIMAX_SIZES),
        "default_seconds": 3,
        "default_size": "1344x768",
        "fps": [24],
        "default_fps": 24,
        "audio_supported": True,
        "default_audio": False,
        "audio_ignored": False,
        "extend_supported": True,
        "dual_input_only": False,
        "series_role": "atmos-scratch",
        "max_pixels": MINIMAX_MAX_PIXELS,
        "max_short_edge": MINIMAX_MAX_SHORT_EDGE,
        "max_long_edge": MINIMAX_MAX_LONG_EDGE,
        "notes": (
            "MiniMax H3 local: atmos/scratch only (not the episode A-camera). "
            "Official open-weights canvas is 1344x768 (768p; /32). "
            "720p stand-in is 1280x704 (/32; 1280x720 is not on-grid). "
            "No local 1080p/2K (hosted regenerate is API-only). "
            "Default 3s @ 24fps with 4-step turbo LoRA; FLOW_AV audio "
            "opt-in. Episode voice is XTTS mux. extend via first/last "
            "frame I2V."
        ),
    },
    "ltx-2.5-layout-to-render": {
        "max_seconds": 10,
        "seconds": [1, 3, 5, 10],
        "sizes": list(_LAYOUT_SIZES),
        "resolutions": list(_LAYOUT_SIZES),
        "default_seconds": 3,
        "default_size": "1920x1088",
        "fps": [16, 24, 48],
        "default_fps": 24,
        "audio_supported": False,
        "default_audio": False,
        "audio_ignored": True,
        "audio_vae": LTX25_AUDIO_VAE,
        "audio_vae_wired": False,
        "extend_supported": False,
        # API requires input_reference (look still); clay guide defaults to it.
        # Length/Resolution are catalog-driven, so this is not dual_input_only.
        "requires_reference": True,
        "dual_input_only": False,
        "series_role": "a-camera",
        "default_a_camera": True,
        "identity_lock": "look-still+clay+union",
        "identity_gap": (
            "PuLID/IP-Adapter/InstantID weights are not on disk. Recurring "
            "players lock via look-still, optional clay_reference, and Union "
            "Control. Do not claim face-id lock."
        ),
        "max_pixels": 1920 * 1088,
        "notes": (
            "A-camera for episode masters: Layout-To-Render silent 1920x1088 "
            "@ 24fps (1080p stand-in), 1280x704 (720p; 1280x720 is not /64). "
            "fps 16/24/48 (default 24). Length caps at 10s / 241 frames "
            "(~5s @ 48fps); longer episodes are ffmpeg concat/xfade, not a "
            "60s latent. Requires input_reference (look still); clay guide "
            "defaults to that still. Audio ignored (ltx-2.5-audio-vae-bf16 "
            "on disk, unwired). No Comfy extend."
        ),
    },
    "ltx-2.5-union-control": {
        "max_seconds": 10,
        "seconds": [1, 3, 5, 10],
        "sizes": list(_UNION_CONTROL_SIZES),
        "resolutions": list(_UNION_CONTROL_SIZES),
        "default_seconds": 3,
        "default_size": "1280x768",
        "fps": [16, 24, 48],
        "default_fps": 24,
        "audio_supported": False,
        "default_audio": False,
        "audio_ignored": True,
        "extend_supported": False,
        # API requires control_reference (a depth/canny/pose control clip).
        "requires_control": True,
        "dual_input_only": False,
        "series_role": "identity-control",
        "identity_lock": "control-clip",
        "identity_gap": (
            "PuLID/IP-Adapter weights are not on disk. Union Control is the "
            "live structure lock (depth/canny/pose clip)."
        ),
        "max_pixels": 1920 * 1024,
        "notes": (
            "Union Control IC-LoRA via /v1/videos, two-stage distilled + spatial "
            "upscaler: structure-following v2v up to 1920x1024 @ 24fps (/128; "
            "1080p stand-in). 720p stand-in is 1280x768 (1280x720 is not /128). "
            "fps 16/24/48 (default 24; same CreateVideo path as Layout). "
            "Requires control_reference (a pre-annotated depth/canny/pose "
            "clip); appearance from the prompt. Identity stand-in (no PuLID). "
            "No extend/audio."
        ),
    },
    "wan2.2-t2v": {
        "max_seconds": 5,
        "seconds": [1, 3, 5],
        "sizes": list(_WAN22_T2V_SIZES),
        "resolutions": list(_WAN22_T2V_SIZES),
        "default_seconds": 5,
        "default_size": "832x480",
        "fps": [16],
        "default_fps": 16,
        "audio_supported": False,
        "default_audio": False,
        "extend_supported": False,
        "dual_input_only": False,
        "max_pixels": 640 * 640,
        "lane": "wan",
        "notes": (
            "Wan 2.2 T2V-A14B fp8 MoE (high+low) via /v1/videos. "
            "Native ~16fps only; no I2V extend. Catalog max 832x480 / 640x640 "
            "(no 1080p; single-stage Hunyuan latent). Pins evacuate on Comfy GPU work. "
            "Wan 2.7 weights are not installed."
        ),
    },
    "wan2.2-i2v": {
        "max_seconds": 5,
        "seconds": [1, 3, 5],
        "sizes": list(_WAN22_I2V_SIZES),
        "resolutions": list(_WAN22_I2V_SIZES),
        "default_seconds": 5,
        "default_size": "832x480",
        "fps": [16],
        "default_fps": 16,
        "audio_supported": False,
        "default_audio": False,
        "extend_supported": True,
        "dual_input_only": False,
        "max_pixels": 1280 * 704,
        "i2v": True,
        "end_image_supported": False,
        "lane": "wan",
        "notes": (
            "Wan 2.2 I2V-A14B fp8 MoE (high+low) via /v1/videos. Strongest "
            "local first-frame I2V (preferred over TI2V-5B). Requires "
            "input_reference. For end_image/last_frame use wan2.1-flf2v. "
            "No local Wan 2.5/2.6/2.7 weights. Native ~16fps."
        ),
    },
    "wan2.2-ti2v-5b": {
        "max_seconds": 5,
        "seconds": [1, 3, 5],
        "sizes": list(_WAN22_TI2V_SIZES),
        "resolutions": list(_WAN22_TI2V_SIZES),
        "default_seconds": 5,
        "default_size": "1280x704",
        "fps": [16],
        "default_fps": 16,
        "audio_supported": False,
        "default_audio": False,
        "extend_supported": True,
        "dual_input_only": False,
        "max_pixels": 1280 * 704,
        "i2v": True,
        "end_image_supported": False,
        "lane": "wan",
        "notes": (
            "Wan 2.2 TI2V-5B via /v1/videos. Lighter action I2V fallback: "
            "prompt, seconds, size, optional input_reference first frame. "
            "Prefer wan2.2-i2v-a14b when installed. Catalog max 1280x704. "
            "For end_image/last_frame use wan2.1-flf2v. Native ~16fps."
        ),
    },
    "wan2.1-flf2v": {
        "max_seconds": 5,
        "seconds": [1, 3, 5],
        "sizes": list(_WAN21_FLF_SIZES),
        "resolutions": list(_WAN21_FLF_SIZES),
        "default_seconds": 2,
        "default_size": "1280x720",
        "fps": [16],
        "default_fps": 16,
        "audio_supported": False,
        "default_audio": False,
        "extend_supported": False,
        "dual_input_only": False,
        "max_pixels": 1280 * 720,
        "i2v": True,
        "end_image_supported": True,
        "video_edit_supported": False,
        "lane": "wan",
        "notes": (
            "Wan 2.1 FLF2V fp8 via /v1/videos. First+last frame "
            "(input_reference + end_image/last_frame) through "
            "WanFirstLastFrameToVideo. Honest substitute for Wan 2.7 "
            "(no local 2.7 weights). Prefer ~720p. "
            "Cartoon path: POST /v1/cartoon (Qwen sprite grid → slice → FLF). "
            "Latent restyle: wan2.1-vace-1.3b via POST /v1/cartoon/edit "
            "(Wan VACE — not Qwen)."
        ),
    },
    "wan2.1-vace-1.3b": {
        "max_seconds": 5,
        "seconds": [1, 2, 3, 5],
        "sizes": list(_WAN21_VACE_SIZES),
        "resolutions": list(_WAN21_VACE_SIZES),
        "default_seconds": 2,
        "default_size": "832x480",
        "fps": [16],
        "default_fps": 16,
        "audio_supported": False,
        "default_audio": False,
        "extend_supported": False,
        "dual_input_only": False,
        "max_pixels": 832 * 480,
        "i2v": False,
        "end_image_supported": False,
        "video_edit_supported": True,
        "control_video_required": True,
        "lane": "wan",
        "notes": (
            "Wan 2.1 VACE 1.3B motion-coherent video-to-video restyle "
            "(Alibaba Tongyi Wan — not Qwen, not Qwen-Video-Edit). "
            "POST /v1/cartoon/edit or /v1/videos with model=wan2.1-vace-1.3b "
            "and control_reference (source mp4). Cartoon run_edit=true chains "
            "after FLF clips complete."
        ),
    },
}


def video_limits_for(workflow: str | None) -> dict[str, Any]:
    """Return composer limits for a catalog workflow kind."""
    key = (workflow or "ltx-video").strip()
    return dict(_VIDEO_LIMITS.get(key) or _VIDEO_LIMITS["ltx-video"])


def identity_adapters_on_disk() -> dict[str, bool]:
    """Cheap directory-name scan. Never calls Comfy ``/object_info``."""
    hits = {
        "pulid": False,
        "ip_adapter": False,
        "insightface": False,
        "instantid": False,
    }
    root = models_root()
    if root is None:
        return hits
    for sub in (
        "custom_nodes",
        "loras",
        "ipadapter",
        "ip-adapter",
        "pulid",
        "insightface",
        "instantid",
    ):
        folder = root / sub
        if not folder.is_dir():
            continue
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        blob = " ".join(names).lower().replace("_", "-")
        if "pulid" in blob:
            hits["pulid"] = True
        if "ip-adapter" in blob or "ipadapter" in blob:
            hits["ip_adapter"] = True
        if "insightface" in blob:
            hits["insightface"] = True
        if "instantid" in blob or "instant-id" in blob:
            hits["instantid"] = True
    return hits


def identity_lock_status(
    *,
    look_still: bool = False,
    clay: bool = False,
    control: bool = False,
) -> dict[str, Any]:
    """Resolved identity lock. No fake PuLID when weights are absent."""
    adapters = identity_adapters_on_disk()
    pulid = bool(
        adapters.get("pulid")
        or adapters.get("ip_adapter")
        or adapters.get("instantid")
    )
    uses: list[str] = []
    if pulid:
        uses.append("pulid")
    if control:
        uses.append("union")
    if clay:
        uses.append("clay")
    if look_still:
        uses.append("look-still")
    if pulid:
        mode = "pulid"
        note = "Face-id lock via on-disk PuLID/IP-Adapter/InstantID."
    else:
        mode = "+".join(uses) if uses else "none"
        note = (
            "PuLID/IP-Adapter/InstantID weights are not installed. Recurring "
            "players lock via look-still (Layout input_reference), optional "
            "clay_reference, and Union Control (control_reference)."
        )
    return {
        "pulid": pulid,
        "ip_adapter": bool(adapters.get("ip_adapter")),
        "instantid": bool(adapters.get("instantid")),
        "insightface": bool(adapters.get("insightface")),
        "mode": mode,
        "uses": uses,
        "note": note,
    }


def _attach_video_limits(row: dict[str, Any]) -> dict[str, Any]:
    """Merge Length/Resolution ads onto a video catalog row."""
    limits = video_limits_for(str(row.get("workflow") or "ltx-video"))
    # Keep an existing notes string; append limits note only when absent.
    existing_notes = (row.get("notes") or "").strip()
    limit_notes = (limits.get("notes") or "").strip()
    merged = {**row, **limits}
    if existing_notes and limit_notes and limit_notes not in existing_notes:
        merged["notes"] = f"{existing_notes} {limit_notes}"
    elif existing_notes:
        merged["notes"] = existing_notes
    return merged


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
    """Basenames Comfy can see under mounted model subPaths.

    checkpoints/ and text_encoders/ are always mounted. diffusion_models/,
    vae/, and loras/ are mounted on Spark for split video packs.
    """
    found: dict[str, str] = {}
    if root is None:
        return found
    for sub in (
        "checkpoints",
        "text_encoders",
        "diffusion_models",
        "vae",
        "loras",
        "latent_upscale_models",
    ):
        directory = root / sub
        if not directory.is_dir():
            continue
        for path in directory.iterdir():
            if path.is_file() and not path.name.startswith(".") and not path.name.endswith(
                ".partial"
            ):
                found[path.name] = sub
    return found


def _is_video_checkpoint(name: str) -> bool:
    low = name.lower()
    if name in {
        MINIMAX_H3_ID,
        LTX25_FAST_ID,
        LTX25_PRO_ID,
        WAN22_T2V_ID,
        WAN22_T2V_HIGH,
        WAN22_T2V_LOW,
        WAN22_TI2V_5B_ID,
        WAN21_FLF_ID,
        WAN21_FLF_UNET,
        WAN21_VACE_ID,
        WAN21_VACE_UNET,
    }:
        return True
    return any(marker in low for marker in _VIDEO_MARKERS)


def _missing_companions(mounted: dict[str, str], required: dict[str, str]) -> list[str]:
    """Return basenames that are absent or in the wrong folder."""
    missing: list[str] = []
    for name, sub in required.items():
        if mounted.get(name) != sub:
            missing.append(name)
    return missing


def _minimax_h3_row(mounted: dict[str, str]) -> dict[str, Any] | None:
    if mounted.get(MINIMAX_H3_ID) != "diffusion_models":
        return None
    missing = _missing_companions(
        mounted,
        {
            MINIMAX_H3_CLIP: "text_encoders",
            MINIMAX_H3_VAE: "vae",
            MINIMAX_H3_AUDIO_VAE: "vae",
        },
    )
    return _attach_video_limits(
        {
            "id": MINIMAX_H3_ID,
            "name": "MiniMax H3 (atmos/scratch)",
            "loader": "UNETLoader",
            "workflow": "minimax-h3",
            "runnable": not missing,
            "api_ready": not missing,
            "missing": missing,
            "aliases": ["minimax-h3", "minimax-h3-2k"],
            "notes": (
                "Native open weights up to 1344x768 (official 768p canvas). "
                "Hosted 2K regenerate is API-only."
            ),
        }
    )


def _template_path(rel: str) -> Path | None:
    """Absolute path under the Comfy models hostPath, if present."""
    root = models_root()
    if root is None:
        return None
    path = root / rel
    return path if path.is_file() else None


def _ltx25_row(
    mounted: dict[str, str],
    *,
    model_id: str,
    title: str,
    alias: str,
) -> dict[str, Any] | None:
    if mounted.get(model_id) != "diffusion_models":
        return None
    missing = _missing_companions(
        mounted,
        {
            LTX25_CLIP: "text_encoders",
            LTX25_VAE: "vae",
            LTX25_AUDIO_VAE: "vae",
        },
    )
    template = _template_path(LTX25_T2V_TEMPLATE)
    if template is None:
        missing = [*missing, LTX25_T2V_TEMPLATE]
    ready = not missing
    return _attach_video_limits(
        {
            "id": model_id,
            "name": title,
            "loader": "UNETLoader",
            "workflow": "ltx-2.5",
            "runnable": ready,
            "api_ready": ready,
            "missing": missing,
            "template": LTX25_T2V_TEMPLATE if template is not None else None,
            "comfy_template": "video_ltx2_5_t2v",
            "aliases": [alias],
            "notes": (
                "LTX-2.5 int8 ConvRot. Fast=distilled, Pro=dev (same graph, swap UNET). "
                "POST /v1/videos, or Comfy Templates → LTX-2.5 Text/Image to Video."
            ),
        }
    )


def _ltx25_layout_lora_row(mounted: dict[str, str]) -> dict[str, Any] | None:
    """IC-LoRA Layout-To-Render. Requires distilled (Fast) base + LoRA + upscaler."""
    has_lora = mounted.get(LTX25_LAYOUT_LORA) == "loras"
    if not has_lora and mounted.get(LTX25_FAST_ID) != "diffusion_models":
        return None
    missing = _missing_companions(
        mounted,
        {
            LTX25_FAST_ID: "diffusion_models",
            LTX25_CLIP: "text_encoders",
            LTX25_VAE: "vae",
            LTX25_AUDIO_VAE: "vae",
            LTX25_SPATIAL_UPSCALER: "latent_upscale_models",
            LTX25_LAYOUT_LORA: "loras",
        },
    )
    if not has_lora and missing == [
        LTX25_FAST_ID,
        LTX25_CLIP,
        LTX25_VAE,
        LTX25_AUDIO_VAE,
        LTX25_SPATIAL_UPSCALER,
        LTX25_LAYOUT_LORA,
    ]:
        return None
    # Surface the row once the LoRA file is present so the API can explain
    # missing Fast-base companions.
    if not has_lora:
        return None
    template = _template_path(LTX25_LAYOUT_TEMPLATE)
    if template is None:
        missing = [*missing, LTX25_LAYOUT_TEMPLATE]
    ready = not missing
    return _attach_video_limits(
        {
            "id": LTX25_LAYOUT_ID,
            "name": "LTX-2.5 Layout-To-Render (A-camera)",
            "loader": "LTXICLoRALoaderModelOnly",
            "workflow": "ltx-2.5-layout-to-render",
            "runnable": ready,
            "api_ready": ready,
            "missing": missing,
            "template": LTX25_LAYOUT_TEMPLATE if template is not None else None,
            "base": LTX25_FAST_ID,
            "lora": LTX25_LAYOUT_LORA,
            "aliases": [
                "ltx-2.5-layout-to-render",
                "layout-to-render",
            ],
            "notes": (
                "IC-LoRA on LTX-2.5 Fast (distilled int8), strength 1.0. "
                "POST /v1/videos with input_reference look still; clay guide "
                "defaults to a static repeat of that still."
            ),
        }
    )


def _ltx25_union_control_row(mounted: dict[str, str]) -> dict[str, Any] | None:
    """Union Control IC-LoRA. Requires distilled (Fast) base + LoRA + upscaler."""
    if mounted.get(LTX25_UNION_CONTROL_LORA) != "loras":
        return None
    missing = _missing_companions(
        mounted,
        {
            LTX25_FAST_ID: "diffusion_models",
            LTX25_CLIP: "text_encoders",
            LTX25_VIDEO_VAE_BF16: "vae",
            LTX25_SPATIAL_UPSCALER: "latent_upscale_models",
            LTX25_UNION_CONTROL_LORA: "loras",
        },
    )
    template = _template_path(LTX25_UNION_CONTROL_TEMPLATE)
    if template is None:
        missing = [*missing, LTX25_UNION_CONTROL_TEMPLATE]
    ready = not missing
    return _attach_video_limits(
        {
            "id": LTX25_UNION_CONTROL_ID,
            "name": "LTX-2.5 Union Control (identity)",
            "loader": "LTXICLoRALoaderModelOnly",
            "workflow": "ltx-2.5-union-control",
            "runnable": ready,
            "api_ready": ready,
            "missing": missing,
            "template": LTX25_UNION_CONTROL_TEMPLATE if template is not None else None,
            "base": LTX25_FAST_ID,
            "lora": LTX25_UNION_CONTROL_LORA,
            "aliases": [
                "ltx-2.5-union-control",
                "union-control",
            ],
            "notes": (
                "IC-LoRA on LTX-2.5 Fast (distilled int8), strength 1.0. "
                "POST /v1/videos with control_reference (depth/canny/pose clip); "
                "appearance from the prompt. On-box annotators not installed."
            ),
        }
    )


def _wan22_t2v_row(mounted: dict[str, str]) -> dict[str, Any] | None:
    """Wan 2.2 T2V-A14B fp8 MoE (high + low experts)."""
    if mounted.get(WAN22_T2V_HIGH) != "diffusion_models":
        return None
    missing = _missing_companions(
        mounted,
        {
            WAN22_T2V_HIGH: "diffusion_models",
            WAN22_T2V_LOW: "diffusion_models",
            WAN22_CLIP: "text_encoders",
            WAN21_VAE: "vae",
        },
    )
    template = _template_path(WAN22_T2V_TEMPLATE)
    if template is None:
        missing = [*missing, WAN22_T2V_TEMPLATE]
    ready = not missing
    return _attach_video_limits(
        {
            "id": WAN22_T2V_ID,
            "name": "Wan 2.2 T2V-A14B",
            "loader": "UNETLoader",
            "workflow": "wan2.2-t2v",
            "runnable": ready,
            "api_ready": ready,
            "missing": missing,
            "high": WAN22_T2V_HIGH,
            "low": WAN22_T2V_LOW,
            "template": WAN22_T2V_TEMPLATE if template is not None else None,
            "comfy_template": "video_wan2_2_14B_t2v",
            "aliases": [
                "wan2.2-t2v",
                "wan2.2-t2v-a14b",
                "wan22-t2v",
            ],
            "notes": (
                "Wan 2.2 T2V-A14B fp8 MoE (high+low) + umt5 fp8 + wan_2.1_vae. "
                "POST /v1/videos (20-step dual KSamplerAdvanced)."
            ),
        }
    )


def _wan22_i2v_row(mounted: dict[str, str]) -> dict[str, Any] | None:
    """Wan 2.2 I2V-A14B fp8 MoE — preferred local first-frame I2V."""
    if mounted.get(WAN22_I2V_HIGH) != "diffusion_models":
        return None
    missing = _missing_companions(
        mounted,
        {
            WAN22_I2V_HIGH: "diffusion_models",
            WAN22_I2V_LOW: "diffusion_models",
            WAN22_CLIP: "text_encoders",
            WAN21_VAE: "vae",
        },
    )
    ready = not missing
    return _attach_video_limits(
        {
            "id": WAN22_I2V_ID,
            "name": "Wan 2.2 I2V-A14B",
            "loader": "UNETLoader",
            "workflow": "wan2.2-i2v",
            "runnable": ready,
            "api_ready": ready,
            "missing": missing,
            "high": WAN22_I2V_HIGH,
            "low": WAN22_I2V_LOW,
            "comfy_template": "video_wan2_2_14B_i2v",
            "aliases": [
                "wan2.2-i2v",
                "wan2.2-i2v-a14b",
                "wan22-i2v",
                "wan22-i2v-a14b",
            ],
            "notes": (
                "Wan 2.2 I2V-A14B fp8 MoE (high+low) + umt5 fp8 + wan_2.1_vae. "
                "POST /v1/videos with input_reference (first frame). Strongest "
                "local Wan I2V; preferred over TI2V-5B. No Wan 2.5/2.6/2.7 weights."
            ),
        }
    )


def _wan22_ti2v_5b_row(mounted: dict[str, str]) -> dict[str, Any] | None:
    """Wan 2.2 TI2V-5B (text+image → video, single UNET)."""
    if mounted.get(WAN22_TI2V_5B_ID) != "diffusion_models":
        return None
    missing = _missing_companions(
        mounted,
        {
            WAN22_TI2V_5B_ID: "diffusion_models",
            WAN22_CLIP: "text_encoders",
            WAN22_VAE: "vae",
        },
    )
    template = _template_path(WAN22_TI2V_TEMPLATE)
    if template is None:
        missing = [*missing, WAN22_TI2V_TEMPLATE]
    ready = not missing
    return _attach_video_limits(
        {
            "id": WAN22_TI2V_5B_ID,
            "name": "Wan 2.2 TI2V-5B",
            "loader": "UNETLoader",
            "workflow": "wan2.2-ti2v-5b",
            "runnable": ready,
            "api_ready": ready,
            "missing": missing,
            "template": WAN22_TI2V_TEMPLATE if template is not None else None,
            "comfy_template": "video_wan2_2_5B_ti2v",
            "aliases": [
                "wan2.2-ti2v-5b",
                "wan2.2-ti2v",
                "wan22-ti2v-5b",
                "wan-2.2-5b",
            ],
            "notes": (
                "Wan 2.2 TI2V-5B. UNET + umt5 fp8 + wan2.2_vae. "
                "Lighter I2V fallback (prefer wan2.2-i2v-a14b). "
                "For end_image/last_frame use wan2.1-flf2v."
            ),
        }
    )


def _clip_vision_ready(root: Path | None) -> bool:
    if root is None:
        return False
    for path in (
        root / "loras" / "_oj" / "clip_vision" / WAN21_CLIP_VISION,
        root / "clip_vision" / WAN21_CLIP_VISION,
    ):
        if path.is_file() and path.stat().st_size > 1_000_000:
            return True
    return False


def _wan21_flf_row(mounted: dict[str, str]) -> dict[str, Any] | None:
    """Wan 2.1 FLF2V — first+last frame (not Wan 2.7)."""
    if mounted.get(WAN21_FLF_UNET) != "diffusion_models":
        return None
    missing = _missing_companions(
        mounted,
        {
            WAN21_FLF_UNET: "diffusion_models",
            WAN22_CLIP: "text_encoders",
            WAN21_VAE: "vae",
        },
    )
    if not _clip_vision_ready(models_root()):
        missing = [*missing, WAN21_CLIP_VISION]
    ready = not missing
    return _attach_video_limits(
        {
            "id": WAN21_FLF_ID,
            "name": "Wan 2.1 FLF2V (first+last frame)",
            "loader": "UNETLoader",
            "workflow": "wan2.1-flf2v",
            "runnable": ready,
            "api_ready": ready,
            "missing": missing,
            "unet": WAN21_FLF_UNET,
            "comfy_template": "wan2.1_flf2v_720_f16",
            "aliases": [
                "wan2.1-flf2v",
                "wan2.1-flf",
                "wan21-flf2v",
                "wan-flf2v",
                "flf2v",
            ],
            "notes": (
                "Wan 2.1 FLF2V fp8 + umt5 + wan_2.1_vae + clip_vision_h. "
                "POST /v1/videos with input_reference and end_image/last_frame. "
                "Labeled honestly — not Wan 2.7 (no local 2.7 weights)."
            ),
        }
    )


def _wan21_vace_row(mounted: dict[str, str]) -> dict[str, Any] | None:
    """Wan 2.1 VACE 1.3B — motion-coherent V2V (not Qwen)."""
    if mounted.get(WAN21_VACE_UNET) != "diffusion_models":
        return None
    missing = _missing_companions(
        mounted,
        {
            WAN21_VACE_UNET: "diffusion_models",
            WAN22_CLIP: "text_encoders",
            WAN21_VAE: "vae",
        },
    )
    ready = not missing
    return _attach_video_limits(
        {
            "id": WAN21_VACE_ID,
            "name": "Wan 2.1 VACE 1.3B (video edit / V2V)",
            "loader": "UNETLoader",
            "workflow": "wan2.1-vace-1.3b",
            "runnable": ready,
            "api_ready": ready,
            "missing": missing,
            "unet": WAN21_VACE_UNET,
            "comfy_template": "video_wan_vace_v2v",
            "vendor": "Wan (Alibaba Tongyi) — not Qwen",
            "aliases": [
                "wan2.1-vace-1.3b",
                "wan2.1-vace",
                "wan21-vace-1.3b",
                "wan-vace",
                "vace-1.3b",
                "vace",
            ],
            "notes": (
                "Wan 2.1 VACE 1.3B fp16 + umt5 + wan_2.1_vae. "
                "Motion-coherent latent V2V restyle via WanVaceToVideo. "
                "Honest label: Wan VACE, not Qwen-Video-Edit."
            ),
        }
    )


def _is_image_checkpoint(name: str) -> bool:
    low = name.lower()
    if not low.endswith((".safetensors", ".ckpt", ".sft")):
        return False
    if low.endswith(".gguf"):
        return False
    # VAE / text-encoder companions are not CheckpointLoaderSimple models.
    if name == QWEN_VAE_FILE or name in QWEN_CLIP_FILES or "vae" in low:
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
    """Video weights the stack can run. Not image-model picker rows."""
    mounted = _mounted_names(models_root())
    rows: list[dict[str, Any]] = []
    has_t5 = mounted.get("t5xxl_fp16.safetensors") == "text_encoders"
    for name, sub in sorted(mounted.items()):
        if sub != "checkpoints" or not _is_video_checkpoint(name):
            continue
        # Split packs live under diffusion_models/; ignore accidental copies.
        if name in {
            MINIMAX_H3_ID,
            LTX25_FAST_ID,
            LTX25_PRO_ID,
            WAN22_T2V_HIGH,
            WAN22_T2V_LOW,
            WAN22_I2V_HIGH,
            WAN22_I2V_LOW,
            WAN22_TI2V_5B_ID,
            WAN21_FLF_UNET,
            WAN21_VACE_UNET,
        }:
            continue
        rows.append(
            _attach_video_limits(
                {
                    "id": name,
                    "name": _checkpoint_title(name),
                    "loader": "CheckpointLoaderSimple",
                    "workflow": "ltx-video",
                    "runnable": has_t5,
                    "missing": [] if has_t5 else ["t5xxl_fp16.safetensors"],
                }
            )
        )
    for row in (
        _minimax_h3_row(mounted),
        _ltx25_row(
            mounted,
            model_id=LTX25_FAST_ID,
            title="LTX-2.5 Fast",
            alias="ltx-2.5-fast",
        ),
        _ltx25_row(
            mounted,
            model_id=LTX25_PRO_ID,
            title="LTX-2.5 Pro",
            alias="ltx-2.5-pro",
        ),
        _ltx25_layout_lora_row(mounted),
        _ltx25_union_control_row(mounted),
        _wan22_t2v_row(mounted),
        _wan22_i2v_row(mounted),
        _wan22_ti2v_5b_row(mounted),
        _wan21_flf_row(mounted),
        _wan21_vace_row(mounted),
    ):
        if row is not None:
            rows.append(row)
    rows.extend(extra_video_rows())
    return rows


def resolve_video_model(
    requested: str | None,
    catalog: list[dict[str, Any]] | None = None,
) -> str:
    """Return a video model id the workflow layer can load.

    *catalog* is the gateway cold ``video_checkpoints`` list when available.
    """
    rows = list_video_checkpoints() if catalog is None else catalog
    runnable = {
        str(row.get("id"))
        for row in rows
        if row.get("runnable", True) and row.get("api_ready", True)
    }
    known = {str(row.get("id")) for row in rows}
    alias_map = dict(_VIDEO_ALIASES)
    for row in rows:
        for alias in row.get("aliases") or []:
            alias_map[str(alias)] = str(row.get("id"))
    raw = (requested or "").strip()
    if raw in alias_map:
        raw = alias_map[raw]
    if not raw:
        picked = default_video_model_id(rows)
        if not rows or picked in runnable:
            return picked
        raise UnknownImageModel(
            "No runnable video checkpoint is installed. "
            + str((rows[0].get("missing") if rows else "") or "")
        )
    if raw in runnable:
        return raw
    if rows and raw in known:
        row = next((item for item in rows if item.get("id") == raw), {}) or {}
        missing = row.get("missing") or []
        if row.get("runnable", True) and not row.get("api_ready", True):
            raise UnknownImageModel(
                f"{raw} is installed but not wired for /v1/videos yet"
                + (f" (missing {missing})" if missing else "")
                + "."
            )
        raise UnknownImageModel(
            f"{raw} is not runnable"
            + (f" (missing {missing})" if missing else "")
            + "."
        )
    if not rows and (_is_video_checkpoint(raw) or raw == DEFAULT_VIDEO_ID):
        return raw
    installed = ", ".join(sorted(runnable) or [DEFAULT_VIDEO_ID])
    raise UnknownImageModel(f"Unknown video model: {raw}. Installed: {installed}.")


def default_video_model_id(
    catalog: list[dict[str, Any]] | None = None,
) -> str:
    """Episode A-camera (Layout silent) when runnable; else LTX 2B fallback."""
    rows = list_video_checkpoints() if catalog is None else catalog
    runnable = {
        str(row.get("id"))
        for row in rows
        if row.get("runnable", True) and row.get("api_ready", True)
    }
    if EPISODE_A_CAMERA_ID in runnable:
        return EPISODE_A_CAMERA_ID
    if not rows or DEFAULT_VIDEO_ID in runnable:
        return DEFAULT_VIDEO_ID
    for row in rows:
        rid = str(row.get("id") or "")
        if rid and row.get("runnable", True) and row.get("api_ready", True):
            return rid
    return DEFAULT_VIDEO_ID


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
                "resolutions": ["1k"],
            }
        )
    for name, sub in sorted(mounted.items()):
        if sub != "checkpoints" or name == FLUX_ID:
            continue
        if not _is_image_checkpoint(name):
            continue
        if is_illustrious_file(name):
            continue
        models.append(
            {
                "id": name,
                "name": _checkpoint_title(name),
                "loader": "CheckpointLoaderSimple",
                "resolutions": ["1k"],
            }
        )
    status = qwen_status()
    if status["included"]:
        models.append(
            {
                "id": QWEN_ID,
                "name": "Qwen-Image 2.1",
                "loader": "UnetLoaderGGUF",
                "resolutions": ["1k", "2k"],
            }
        )
    illustrious = illustrious_catalog_row()
    if illustrious is not None:
        models.append(illustrious)
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
        # Aliases first so a companion file listed as a checkpoint still maps
        # to the GGUF graph instead of CheckpointLoaderSimple.
        if is_qwen_image_alias(raw):
            if QWEN_ID in runnable:
                return QWEN_ID
            raise UnknownImageModel(_qwen_unavailable_message())
        if is_illustrious_alias(raw):
            if ILLUSTRIOUS_ID in runnable:
                return ILLUSTRIOUS_ID
            raise UnknownImageModel(
                "Illustrious-XL is not installed. Place an Illustrious-XL "
                "safetensors checkpoint in the Comfy checkpoints directory."
            )
        if raw in runnable:
            return raw
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
        {"type": "resolution", "node_ids": ["4"], "key": "resolution"},
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
        "open_jealousy": open_jealousy_catalog(),
    }
