"""OpenAI-compatible image generation via ComfyUI FLUX (external API clients).

Used by POST /v1/images/generations on the Spockify router. Auth is the same
LiteLLM master key as chat. OpenWebUI's own /api/v1/images path is untouched.
"""

from __future__ import annotations

import asyncio
import base64
import copy
import json
import logging
import os
import random
import re
import uuid
from typing import Any, Optional

import httpx

from image_models import (
    ILLUSTRIOUS_ID,
    QWEN_ID,
    UnknownImageModel,
    gguf_prompt_graph,
    is_qwen_edit_alias,
    is_qwen_image_alias,
    resolve_image_model,
)
from open_jealousy import (
    GPU_LOCK,
    StuckWatch,
    build_illustrious_workflow,
    clamp_illustrious_size,
    control_requirement_error,
    identity_requirement_error,
    is_illustrious_alias,
    open_jealousy_catalog,
    pump_comfy_progress,
    resolve_lora,
    scan_open_jealousy,
)

LOG = logging.getLogger("spockify.image_gen")

COMFYUI_URL = os.getenv(
    "COMFYUI_URL", "http://comfyui.spockify.svc.cluster.local:8188"
).rstrip("/")
OLLAMA_URL = os.getenv(
    "OLLAMA_URL", "http://ollama.spockify.svc.cluster.local:11434"
).rstrip("/")
# Default off: Spark has ~128GB unified; unloading chat models just to free ~17GB
# for FLUX is usually unnecessary. OWUI keeps its own IMAGE_GEN_UNLOAD_OLLAMA=true.
IMAGE_GEN_UNLOAD_OLLAMA = os.getenv("IMAGE_GEN_UNLOAD_OLLAMA", "false").lower() in (
    "1",
    "true",
    "yes",
)
IMAGE_GENERATION_MODEL = os.getenv(
    "IMAGE_GENERATION_MODEL", "flux1-schnell-fp8.safetensors"
)
DEFAULT_IMAGE_SIZE = os.getenv("IMAGE_SIZE", "1024x1024")
DEFAULT_IMAGE_STEPS = int(os.getenv("IMAGE_STEPS", "4"))
WORKFLOW_PATH = os.getenv("COMFYUI_WORKFLOW_PATH", "/config/comfyui/workflow.json")
WORKFLOW_NODES_PATH = os.getenv(
    "COMFYUI_WORKFLOW_NODES_PATH", "/config/comfyui/workflow-nodes.json"
)
POLL_INTERVAL_S = float(os.getenv("IMAGE_GEN_POLL_INTERVAL", "0.75"))
# Cold Comfy wake plus a multi-GB checkpoint load can take many minutes.
POLL_TIMEOUT_S = float(os.getenv("IMAGE_GEN_POLL_TIMEOUT", "1500"))
# Discord attachments are often several MB; keep the Comfy upload bounded.
MAX_REFERENCE_BYTES = int(os.getenv("IMAGE_REFERENCE_MAX_BYTES", "8000000"))
_REFERENCE_MIMES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}

# Fallback if ConfigMap mount is missing (same as comfyui-flux-workflow).
_FALLBACK_WORKFLOW: dict[str, Any] = {
    "3": {
        "inputs": {
            "seed": 0,
            "steps": 4,
            "cfg": 1,
            "sampler_name": "euler",
            "scheduler": "simple",
            "denoise": 1,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
        "class_type": "KSampler",
    },
    "4": {
        "inputs": {"ckpt_name": "flux1-schnell-fp8.safetensors"},
        "class_type": "CheckpointLoaderSimple",
    },
    "5": {
        "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
        "class_type": "EmptyLatentImage",
    },
    "6": {
        "inputs": {"text": "prompt", "clip": ["4", 1]},
        "class_type": "CLIPTextEncode",
    },
    "7": {
        "inputs": {"text": "", "clip": ["4", 1]},
        "class_type": "CLIPTextEncode",
    },
    "8": {
        "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        "class_type": "VAEDecode",
    },
    "9": {
        "inputs": {"filename_prefix": "spockify", "images": ["8", 0]},
        "class_type": "SaveImage",
    },
}

_FALLBACK_NODES: list[dict[str, Any]] = [
    {"type": "prompt", "node_ids": ["6"], "key": "text"},
    {"type": "model", "node_ids": ["4"], "key": "ckpt_name"},
    {"type": "width", "node_ids": ["5"], "key": "width"},
    {"type": "height", "node_ids": ["5"], "key": "height"},
    {"type": "steps", "node_ids": ["3"], "key": "steps"},
    {"type": "seed", "node_ids": ["3"], "key": "seed"},
]


class ImageGenError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _load_json_file(path: str) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _load_workflow() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        workflow = _load_json_file(WORKFLOW_PATH)
        nodes = _load_json_file(WORKFLOW_NODES_PATH)
        if isinstance(workflow, dict) and isinstance(nodes, list):
            return workflow, nodes
    except Exception as exc:
        LOG.warning("ComfyUI workflow mount missing/invalid (%s); using built-in FLUX.", exc)
    return copy.deepcopy(_FALLBACK_WORKFLOW), copy.deepcopy(_FALLBACK_NODES)


def _parse_size(size: Optional[str], *, max_edge: int = 1536) -> tuple[int, int]:
    raw = (size or DEFAULT_IMAGE_SIZE).lower().strip()
    if "x" not in raw:
        return 1024, 1024
    w_s, h_s = raw.split("x", 1)
    try:
        width, height = int(w_s), int(h_s)
    except ValueError as exc:
        raise ImageGenError(f"Invalid size: {size}", 400) from exc
    limit = max(256, min(int(max_edge), 2048))

    def snap(value: int) -> int:
        edge = max(256, min(int(value), limit))
        return max(256, (edge // 16) * 16)

    return snap(width), snap(height)


def _apply_nodes(
    workflow: dict[str, Any],
    nodes: list[dict[str, Any]],
    *,
    prompt: str,
    model: str,
    width: int,
    height: int,
    steps: int,
    seed: int,
    n: int,
) -> None:
    payload = {
        "prompt": prompt,
        "model": model,
        "width": width,
        "height": height,
        "steps": steps,
        "seed": seed,
        "n": n,
    }
    for node in nodes:
        ntype = node.get("type")
        node_ids = node.get("node_ids") or []
        key = node.get("key") or "text"
        if not ntype:
            for node_id in node_ids:
                if node_id in workflow:
                    workflow[node_id]["inputs"][key] = node.get("value")
            continue
        value = payload.get(ntype if ntype != "model" else "model")
        if ntype == "model":
            value = model
        elif ntype == "prompt":
            value = prompt
        elif ntype == "width":
            value = width
        elif ntype == "height":
            value = height
        elif ntype == "resolution":
            value = max(256, min(2048, (max(width, height) // 16) * 16))
        elif ntype == "steps":
            value = steps
        elif ntype == "seed":
            value = seed
        elif ntype == "n":
            value = n
        else:
            continue
        for node_id in node_ids:
            if node_id in workflow:
                workflow[node_id]["inputs"][key] = value


def _snap_resolution(width: int, height: int, *, max_edge: int = 2048) -> int:
    """Qwen reference resize wants a multiple of 16, up to 2K."""
    edge = max(int(width), int(height))
    snapped = int(round(edge / 16.0) * 16)
    return max(256, min(int(max_edge), snapped))


def decode_reference_image(raw: str) -> tuple[bytes, str]:
    """Accept a data URL or raw base64. Returns (bytes, mime)."""
    text = (raw or "").strip()
    if not text:
        raise ImageGenError("reference image is empty", 400)
    mime = "image/png"
    if text.lower().startswith("data:"):
        header, sep, payload = text.partition(",")
        if not sep or not payload.strip():
            raise ImageGenError("reference image data URL is invalid", 400)
        mime = header[5:].split(";", 1)[0].strip().lower() or mime
        text = payload
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in _REFERENCE_MIMES:
        raise ImageGenError("reference image must be png, jpeg, webp, or gif", 400)
    text = re.sub(r"\s+", "", text)
    try:
        data = base64.b64decode(text, validate=False)
    except Exception as exc:
        raise ImageGenError("reference image is not valid base64", 400) from exc
    if not data:
        raise ImageGenError("reference image is empty", 400)
    if len(data) > MAX_REFERENCE_BYTES:
        raise ImageGenError("reference image is too large (max 8MB)", 400)
    return data, mime


EDIT_RESPONSE_MODEL = "Qwen-Image-Edit"


def response_model_label(requested: str | None, resolved: str) -> str:
    """Edit calls say Qwen-Image-Edit. The 2.1 id is the checkpoint, not the label."""
    if is_qwen_edit_alias(requested):
        return EDIT_RESPONSE_MODEL
    return resolved


def edit_alias_rejection(model: str | None, *, has_image: bool) -> str | None:
    """400 text when a generations call names Qwen-Image-Edit without an image."""
    if not is_qwen_edit_alias(model) or has_image:
        return None
    return (
        "Qwen-Image-Edit does not run as text-to-image. "
        "POST /v1/images/edits with prompt and image. "
        "Optional multipart fields character_plate and background are real "
        "image inputs on that route (and on POST /v1/cartoon)."
    )


def attach_reference_images(
    workflow: dict[str, Any],
    uploaded_names: list[str],
    *,
    resolution: int,
) -> None:
    """Point Qwen-Image 2.1 at uploaded references (text encoder + VAE latents).

    Slot order is images.image_1, images.image_2, … The sampler must use the
    encoder's latent output. A different empty latent shifts the edit.
    """
    names = [name for name in uploaded_names if name]
    if not names:
        raise ImageGenError("reference image is empty", 400)
    encode_id = None
    vae_id = None
    sampler_id = None
    for node_id, node in workflow.items():
        ctype = node.get("class_type")
        if ctype == "TextEncodeQwenImage21":
            encode_id = node_id
        elif ctype == "VAELoader":
            vae_id = node_id
        elif ctype == "KSampler":
            sampler_id = node_id
    if not encode_id or not vae_id or not sampler_id:
        raise ImageGenError(
            "This image model can't take a reference image.",
            400,
        )
    encode = workflow[encode_id]["inputs"]
    next_id = 90
    for index, uploaded_name in enumerate(names, start=1):
        while str(next_id) in workflow:
            next_id += 1
        load_id = str(next_id)
        workflow[load_id] = {
            "inputs": {"image": uploaded_name},
            "class_type": "LoadImage",
        }
        encode[f"images.image_{index}"] = [load_id, 0]
        next_id += 1
    encode["vae"] = [vae_id, 0]
    encode["resolution"] = int(resolution)
    workflow[sampler_id]["inputs"]["latent_image"] = [encode_id, 2]


def attach_reference_image(workflow: dict[str, Any], uploaded_name: str, *, resolution: int) -> None:
    """Single-reference wrapper around :func:`attach_reference_images`."""
    attach_reference_images(workflow, [uploaded_name], resolution=resolution)


async def _upload_reference_image(
    client: httpx.AsyncClient, data: bytes, mime: str
) -> str:
    filename = f"ref-{uuid.uuid4().hex}.{_REFERENCE_MIMES.get(mime, 'png')}"
    try:
        resp = await client.post(
            f"{COMFYUI_URL}/upload/image",
            data={"type": "input", "overwrite": "true"},
            files={"image": (filename, data, mime)},
            timeout=60.0,
        )
    except httpx.HTTPError as exc:
        raise ImageGenError(f"ComfyUI image upload failed: {exc}", 503) from exc
    if resp.status_code >= 400:
        raise ImageGenError(
            f"ComfyUI rejected the reference image ({resp.status_code})",
            502,
        )
    try:
        name = resp.json().get("name")
    except Exception as exc:
        raise ImageGenError("ComfyUI image upload returned no filename", 502) from exc
    if not name:
        raise ImageGenError("ComfyUI image upload returned no filename", 502)
    return str(name)


async def prepare_gpu_for_image_gen(client: httpx.AsyncClient) -> int:
    """Unload resident Ollama models so ComfyUI FLUX has VRAM."""
    if not IMAGE_GEN_UNLOAD_OLLAMA:
        return 0
    unloaded = 0
    try:
        resp = await client.get(f"{OLLAMA_URL}/api/ps", timeout=8.0)
        if resp.status_code >= 400:
            LOG.warning("Could not list Ollama models before image gen: %s", resp.status_code)
            return 0
        loaded = resp.json().get("models") or []
        for model_info in loaded:
            model_name = model_info.get("name") or model_info.get("model")
            if not model_name:
                continue
            unload = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": model_name, "keep_alive": 0, "prompt": ""},
                timeout=30.0,
            )
            if unload.status_code < 400:
                unloaded += 1
                LOG.info("Unloaded Ollama model for image gen: %s", model_name)
            else:
                LOG.warning(
                    "Failed to unload Ollama model %s: %s",
                    model_name,
                    unload.text[:200],
                )
        if unloaded:
            await asyncio.sleep(2)
    except Exception as exc:
        LOG.warning("Could not unload Ollama models before image gen: %s", exc)
    return unloaded


async def _queue_prompt(
    client: httpx.AsyncClient,
    workflow: dict[str, Any],
    client_id: str,
    *,
    timeout_s: Optional[float] = None,
) -> str:
    timeout = POLL_TIMEOUT_S if timeout_s is None else float(timeout_s)
    resp = await client.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow, "client_id": client_id},
        timeout=timeout,
    )
    if resp.status_code >= 400:
        detail = (resp.text or "").strip()
        try:
            payload = resp.json()
            err = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(err, dict):
                detail = (
                    err.get("message")
                    or err.get("type")
                    or detail
                )
                extras = err.get("details") or err.get("extra_info")
                if extras:
                    detail = f"{detail}: {extras}"
            elif isinstance(err, str) and err.strip():
                detail = err.strip()
            node_errors = (
                payload.get("node_errors") if isinstance(payload, dict) else None
            )
            if isinstance(node_errors, dict) and node_errors:
                detail = f"{detail}; node_errors={str(node_errors)[:240]}"
        except Exception:
            pass
        raise ImageGenError(
            f"ComfyUI rejected prompt ({resp.status_code}): {detail[:400]}",
            502,
        )
    data = resp.json()
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise ImageGenError("ComfyUI did not return a prompt_id", 502)
    return str(prompt_id)


async def _wait_history(
    client: httpx.AsyncClient,
    prompt_id: str,
    *,
    timeout_s: Optional[float] = None,
    lane: Optional[str] = None,
    client_id: Optional[str] = None,
    on_progress: Any = None,
) -> dict[str, Any]:
    budget = POLL_TIMEOUT_S if timeout_s is None else float(timeout_s)
    # Absolute ceiling: only soft-extend while steps are still moving.
    # A longer poll alone is not a speed fix for stalled Wan beats.
    hard_cap = budget * 1.5
    deadline = asyncio.get_event_loop().time() + budget
    hard_deadline = asyncio.get_event_loop().time() + hard_cap
    watch: StuckWatch | None = StuckWatch(lane) if lane else None
    pump: asyncio.Task[None] | None = None
    if watch is not None and client_id:
        pump = asyncio.create_task(pump_comfy_progress(COMFYUI_URL, client_id, watch))
    try:
        while True:
            now = asyncio.get_event_loop().time()
            if watch is not None and watch.stuck:
                raise ImageGenError(watch.reason, 504)
            if now >= deadline:
                # Still progressing (or in decode) → soft-extend once chunks.
                if (
                    watch is not None
                    and now < hard_deadline
                    and (
                        watch.recently_moved(180.0)
                        or (watch.raw is not None and watch.raw >= StuckWatch._DECODE_RAW)
                    )
                ):
                    deadline = min(hard_deadline, now + 180.0)
                else:
                    break
            resp = await client.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=15.0)
            if resp.status_code >= 400:
                raise ImageGenError(
                    f"ComfyUI history failed ({resp.status_code}): {resp.text[:200]}",
                    502,
                )
            hist = resp.json() or {}
            if prompt_id in hist:
                return hist[prompt_id]
            if watch is not None and on_progress is not None:
                on_progress(watch.display)
            await asyncio.sleep(POLL_INTERVAL_S)
    finally:
        if pump is not None:
            pump.cancel()
    raise ImageGenError(
        f"ComfyUI image generation timed out after {int(budget)}s",
        504,
    )


async def _download_image(
    client: httpx.AsyncClient, filename: str, subfolder: str, folder_type: str
) -> bytes:
    params = {"filename": filename, "subfolder": subfolder, "type": folder_type}
    resp = await client.get(f"{COMFYUI_URL}/view", params=params, timeout=60.0)
    if resp.status_code >= 400:
        raise ImageGenError(
            f"ComfyUI image download failed ({resp.status_code})",
            502,
        )
    return resp.content


def _lora_specs(loras: Optional[list[dict[str, Any]]], style_lora: Optional[str]) -> list[dict[str, Any]]:
    scan = scan_open_jealousy()
    specs: list[dict[str, Any]] = []
    for item in loras or []:
        if not isinstance(item, dict):
            raise ImageGenError("loras entries must be objects", 400)
        try:
            row = resolve_lora(str(item.get("id") or item.get("name") or ""), scan)
        except ValueError as exc:
            raise ImageGenError(str(exc), 400) from exc
        try:
            strength = float(item.get("strength") if item.get("strength") is not None else 0.8)
        except (TypeError, ValueError) as exc:
            raise ImageGenError("lora strength must be a number", 400) from exc
        strength = max(0.0, min(strength, 1.5))
        specs.append({"file": row["file"], "strength": strength})
    if (style_lora or "").strip():
        try:
            row = resolve_lora(style_lora or "", scan)
        except ValueError as exc:
            raise ImageGenError(str(exc), 400) from exc
        specs.append({"file": row["file"], "strength": 0.65})
    return specs


async def generate_images(
    *,
    prompt: str,
    size: Optional[str] = None,
    n: int = 1,
    model: Optional[str] = None,
    steps: Optional[int] = None,
    image: Optional[str] = None,
    negative_prompt: Optional[str] = None,
    loras: Optional[list[dict[str, Any]]] = None,
    style_lora: Optional[str] = None,
    identity: Optional[str] = None,
    identity_image: Optional[str] = None,
    control: Optional[str] = None,
    control_image: Optional[str] = None,
    control_strength: Optional[float] = None,
    references: Optional[list[tuple[bytes, str]]] = None,
    reference_labels: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Generate images and return OpenAI-shaped ``{created, data:[{b64_json}]}``."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise ImageGenError("prompt is required", 400)
    if len(prompt) > 4000:
        raise ImageGenError("prompt too long (max 4000 chars)", 400)

    n = max(1, min(int(n or 1), 1))  # FLUX batch >1 is heavy on shared GPU
    refs: list[tuple[bytes, str]] = []
    if (image or "").strip():
        refs.append(decode_reference_image(image))
    for item in references or []:
        if item and item[0]:
            refs.append(item)
    labels = [str(item) for item in (reference_labels or []) if item]
    rejection = edit_alias_rejection(model, has_image=bool(refs))
    if rejection:
        raise ImageGenError(rejection, 400)
    resolve_as = QWEN_ID if is_qwen_edit_alias(model) else model
    try:
        model_name = resolve_image_model(resolve_as, IMAGE_GENERATION_MODEL)
    except UnknownImageModel as exc:
        raise ImageGenError(str(exc), 400) from exc
    qwen = model_name == QWEN_ID or is_qwen_image_alias(model_name) or is_qwen_edit_alias(model)
    illustrious = model_name == ILLUSTRIOUS_ID or is_illustrious_alias(model_name)
    if illustrious and refs:
        raise ImageGenError(
            "Illustrious-XL uses identity_image and control_image. "
            "The image field is the Qwen edit reference.",
            400,
        )
    width, height = _parse_size(size, max_edge=2048 if qwen else (1216 if illustrious else 1536))
    if illustrious:
        width, height = clamp_illustrious_size(width, height)
    step_count = int(steps) if steps is not None else (28 if illustrious else DEFAULT_IMAGE_STEPS)
    step_count = max(1, min(step_count, 40 if illustrious else 30))
    seed = random.randint(0, 1125899906842624)

    gguf = None if illustrious else gguf_prompt_graph(model_name)
    if refs and gguf is None and not illustrious:
        try:
            model_name = resolve_image_model(QWEN_ID)
        except UnknownImageModel as exc:
            raise ImageGenError(
                "A reference image needs Qwen-Image, which is not available.",
                400,
            ) from exc
        gguf = gguf_prompt_graph(model_name)
        if gguf is None:
            raise ImageGenError(
                "A reference image needs Qwen-Image, which is not available.",
                400,
            )
    identity_upload = decode_reference_image(identity_image) if (identity_image or "").strip() else None
    control_upload = decode_reference_image(control_image) if (control_image or "").strip() else None
    if (identity or "").strip() and identity_upload is None:
        raise ImageGenError("identity_image is required when identity is set", 400)
    if (control or "").strip() and control_upload is None:
        raise ImageGenError("control_image is required when control is set", 400)
    if gguf is not None:
        # Distilled Qwen-Image 2.1 turbo: CFG stays 1 in the graph; 4–8 steps.
        step_count = max(4, min(step_count, 8))
        workflow = gguf["workflow"]
        nodes = gguf["nodes"]
    elif illustrious:
        scan = scan_open_jealousy()
        catalog = open_jealousy_catalog(scan)
        ident_err = identity_requirement_error(identity or "", catalog)
        if ident_err:
            raise ImageGenError(ident_err, 503)
        ctrl_err = control_requirement_error(control or "", catalog)
        if ctrl_err:
            raise ImageGenError(ctrl_err, 503)
        workflow = build_illustrious_workflow(
            ckpt=str(scan.get("illustrious_file") or ""),
            prompt=prompt,
            negative=(negative_prompt or "").strip()
            or "lowres, bad anatomy, bad hands, text, watermark, blurry",
            width=width,
            height=height,
            steps=step_count,
            seed=seed,
            loras=_lora_specs(loras, style_lora),
            identity=identity,
            identity_image="identity.png" if identity_upload else None,
            control=control,
            control_image="control.png" if control_upload else None,
            control_strength=float(control_strength if control_strength is not None else 0.7),
            control_union=bool((catalog.get("control") or {}).get("union")),
            preprocessor=bool((catalog.get("control") or {}).get("preprocessor")),
        )
        nodes = []
    else:
        workflow, nodes = _load_workflow()
    if nodes:
        _apply_nodes(
            workflow,
            nodes,
            prompt=prompt,
            model=model_name,
            width=width,
            height=height,
            steps=step_count,
            seed=seed,
            n=n,
        )

    client_id = str(uuid.uuid4())
    async with GPU_LOCK:
        result = await _generate_locked(
            workflow=workflow,
            references=refs,
            identity_upload=identity_upload,
            control_upload=control_upload,
            client_id=client_id,
            qwen=qwen,
            width=width,
            height=height,
            n=n,
            model_name=model_name,
            lane="stills",
        )
        result["model"] = response_model_label(model, model_name)
        if labels:
            result["reference_images"] = labels
        return result


async def _generate_locked(
    *,
    workflow: dict[str, Any],
    references: Optional[list[tuple[bytes, str]]] = None,
    identity_upload: Optional[tuple[bytes, str]],
    control_upload: Optional[tuple[bytes, str]],
    client_id: str,
    qwen: bool,
    width: int,
    height: int,
    n: int,
    model_name: str,
    lane: str,
) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        await prepare_gpu_for_image_gen(client)
        # Reachability check before queueing.
        try:
            ping = await client.get(f"{COMFYUI_URL}/", timeout=5.0)
            if ping.status_code >= 500:
                raise ImageGenError("ComfyUI is unavailable", 503)
        except httpx.HTTPError as exc:
            raise ImageGenError(
                f"ComfyUI is unreachable at {COMFYUI_URL}", 503
            ) from exc

        uploaded_names: list[str] = []
        for ref_bytes, ref_mime in references or []:
            uploaded_names.append(
                await _upload_reference_image(client, ref_bytes, ref_mime)
            )
        if uploaded_names:
            attach_reference_images(
                workflow,
                uploaded_names,
                resolution=_snap_resolution(width, height, max_edge=2048 if qwen else 1024),
            )
        if identity_upload is not None and "40" in workflow:
            uploaded = await _upload_reference_image(
                client, identity_upload[0], identity_upload[1]
            )
            workflow["40"]["inputs"]["image"] = uploaded
        if control_upload is not None and "30" in workflow:
            uploaded = await _upload_reference_image(
                client, control_upload[0], control_upload[1]
            )
            workflow["30"]["inputs"]["image"] = uploaded

        prompt_id = await _queue_prompt(client, workflow, client_id)
        try:
            history = await _wait_history(
                client, prompt_id, lane=lane, client_id=client_id
            )
        except ImageGenError:
            try:
                await client.post(f"{COMFYUI_URL}/interrupt", timeout=15.0)
                await client.post(
                    f"{COMFYUI_URL}/free",
                    json={"unload_models": True, "free_memory": True},
                    timeout=20.0,
                )
            except Exception:
                pass
            raise
        outputs = history.get("outputs") or {}

        images_b64: list[str] = []
        for node_id, node_out in outputs.items():
            if node_id in workflow and workflow[node_id].get("class_type") not in (
                "SaveImage",
                "PreviewImage",
            ):
                continue
            for image in node_out.get("images") or []:
                raw = await _download_image(
                    client,
                    image["filename"],
                    image.get("subfolder") or "",
                    image.get("type") or "output",
                )
                images_b64.append(base64.b64encode(raw).decode("ascii"))

        if not images_b64:
            # Some workflows omit class_type match — take any images in outputs.
            for node_out in outputs.values():
                for image in node_out.get("images") or []:
                    raw = await _download_image(
                        client,
                        image["filename"],
                        image.get("subfolder") or "",
                        image.get("type") or "output",
                    )
                    images_b64.append(base64.b64encode(raw).decode("ascii"))

        if not images_b64:
            raise ImageGenError("ComfyUI produced no image output", 502)

    import time

    return {
        "created": int(time.time()),
        "model": model_name,
        "size": f"{width}x{height}",
        "data": [{"b64_json": b64} for b64 in images_b64[:n]],
    }


def _as_reference(value: Any) -> tuple[bytes, str] | None:
    if value is None:
        return None
    if isinstance(value, tuple) and value and isinstance(value[0], (bytes, bytearray)):
        mime = str(value[1] if len(value) > 1 else "image/png")
        data = bytes(value[0])
        if not data:
            return None
        return data, mime
    if isinstance(value, str) and value.strip():
        return decode_reference_image(value)
    return None


async def edit_images(
    *,
    prompt: str,
    image: Any = None,
    character_plate: Any = None,
    background: Any = None,
    size: Optional[str] = None,
) -> dict[str, Any]:
    """Qwen-Image edit. ``image`` is the plate to change. Plate + background are extra refs.

    Always the Qwen-Image 2.1 reference graph (``images.image_1`` then
    ``images.image_2``). Sizes snap to a multiple of 16, max edge 2048.
    """
    refs: list[tuple[bytes, str]] = []
    labels: list[str] = []
    for label, value in (
        ("image", image),
        ("character_plate", character_plate),
        ("background", background),
    ):
        decoded = _as_reference(value)
        if decoded is None:
            continue
        refs.append(decoded)
        labels.append(label)
    if not refs:
        raise ImageGenError(
            "POST /v1/images/edits needs a real image. "
            "Send image, or character_plate plus optional background, with prompt.",
            400,
        )
    # Named edit alias plus a real image is the intentional edit route.
    return await generate_images(
        prompt=prompt,
        size=size,
        model="qwen-image-edit",
        references=refs,
        reference_labels=labels,
    )
