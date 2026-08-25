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
import uuid
from typing import Any, Optional

import httpx

LOG = logging.getLogger("spockify.image_gen")

COMFYUI_URL = os.getenv(
    "COMFYUI_URL", "http://comfyui.spockify.svc.cluster.local:8188"
).rstrip("/")
OLLAMA_URL = os.getenv(
    "OLLAMA_URL", "http://ollama.spockify.svc.cluster.local:11434"
).rstrip("/")
# Default off: on large unified-memory hosts, unloading chat models just to free ~17GB
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
POLL_TIMEOUT_S = float(os.getenv("IMAGE_GEN_POLL_TIMEOUT", "180"))

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


def _parse_size(size: Optional[str]) -> tuple[int, int]:
    raw = (size or DEFAULT_IMAGE_SIZE).lower().strip()
    if "x" not in raw:
        return 1024, 1024
    w_s, h_s = raw.split("x", 1)
    try:
        width, height = int(w_s), int(h_s)
    except ValueError as exc:
        raise ImageGenError(f"Invalid size: {size}", 400) from exc
    # Keep within reasonable bounds for FLUX schnell on shared GPU.
    width = max(256, min(width, 1536))
    height = max(256, min(height, 1536))
    return width, height


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
    client: httpx.AsyncClient, workflow: dict[str, Any], client_id: str
) -> str:
    resp = await client.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow, "client_id": client_id},
        timeout=30.0,
    )
    if resp.status_code >= 400:
        raise ImageGenError(
            f"ComfyUI rejected prompt ({resp.status_code}): {resp.text[:300]}",
            502,
        )
    data = resp.json()
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise ImageGenError("ComfyUI did not return a prompt_id", 502)
    return str(prompt_id)


async def _wait_history(
    client: httpx.AsyncClient, prompt_id: str
) -> dict[str, Any]:
    deadline = asyncio.get_event_loop().time() + POLL_TIMEOUT_S
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=15.0)
        if resp.status_code >= 400:
            raise ImageGenError(
                f"ComfyUI history failed ({resp.status_code}): {resp.text[:200]}",
                502,
            )
        hist = resp.json() or {}
        if prompt_id in hist:
            return hist[prompt_id]
        await asyncio.sleep(POLL_INTERVAL_S)
    raise ImageGenError("ComfyUI image generation timed out", 504)


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


async def generate_images(
    *,
    prompt: str,
    size: Optional[str] = None,
    n: int = 1,
    model: Optional[str] = None,
    steps: Optional[int] = None,
) -> dict[str, Any]:
    """Generate images and return OpenAI-shaped ``{created, data:[{b64_json}]}``."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise ImageGenError("prompt is required", 400)
    if len(prompt) > 4000:
        raise ImageGenError("prompt too long (max 4000 chars)", 400)

    n = max(1, min(int(n or 1), 1))  # FLUX batch >1 is heavy on shared GPU
    width, height = _parse_size(size)
    model_name = (model or IMAGE_GENERATION_MODEL).strip() or IMAGE_GENERATION_MODEL
    step_count = int(steps) if steps is not None else DEFAULT_IMAGE_STEPS
    step_count = max(1, min(step_count, 30))
    seed = random.randint(0, 1125899906842624)

    workflow, nodes = _load_workflow()
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

        prompt_id = await _queue_prompt(client, workflow, client_id)
        history = await _wait_history(client, prompt_id)
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
        "data": [{"b64_json": b64} for b64 in images_b64[:n]],
    }
