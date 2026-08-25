"""vLLM LoRA promote helpers + workspace pointer file."""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Optional

import urllib.error
import urllib.request

LOG = logging.getLogger("tab_train.promote")

DEFAULT_LORAS_DIR = "/var/lib/spockify/vllm-tab/hf-cache/loras"
DEFAULT_POINTER = "workspace_adapters.json"
DEFAULT_VLLM_URL = "http://127.0.0.1:30820"


def loras_dir() -> Path:
    return Path(os.getenv("TAB_LORAS_DIR", DEFAULT_LORAS_DIR))


def pointer_path() -> Path:
    override = os.getenv("TAB_ADAPTER_POINTER", "").strip()
    if override:
        return Path(override)
    return loras_dir() / DEFAULT_POINTER


def load_pointer() -> dict[str, Any]:
    path = pointer_path()
    if not path.is_file():
        return {"adapters": {}, "seed": None}
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        return {"adapters": {}, "seed": None}
    data.setdefault("adapters", {})
    data.setdefault("seed", None)
    return data


def save_pointer(data: dict[str, Any]) -> None:
    path = pointer_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")
    tmp.replace(path)


def copy_adapter(src: Path, name: str, dest_root: Optional[Path] = None) -> Path:
    """Copy a PEFT adapter directory into the vLLM loras layout."""
    root = dest_root or loras_dir()
    dest = root / name
    if not src.is_dir():
        raise FileNotFoundError(f"adapter src missing: {src}")
    required = ("adapter_config.json",)
    for req in required:
        if not (src / req).is_file():
            raise FileNotFoundError(f"missing {req} in {src}")
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)
    LOG.info("copied adapter %s -> %s", src, dest)
    return dest


def vllm_base_url() -> str:
    return os.getenv("TAB_VLLM_URL", os.getenv("GHOST_VLLM_BASE_URL", DEFAULT_VLLM_URL)).rstrip("/")


def _post_json(url: str, body: dict[str, Any], timeout: float = 120.0) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8").strip()
            if not raw:
                return {}
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                # vLLM load/unload_lora often returns plain text e.g. "Success: ..."
                return {"ok": True, "message": raw}
            return parsed if isinstance(parsed, dict) else {"ok": True, "data": parsed}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {url}: {detail}") from exc


def load_lora_adapter(
        name: str,
        *,
        lora_path: Optional[str] = None,
        load_inplace: bool = True,
) -> dict[str, Any]:
    """Hot-swap load into vLLM. Container path defaults to HF loras mount."""
    path = lora_path or f"/root/.cache/huggingface/loras/{name}"
    body = {
            "lora_name": name,
            "lora_path": path,
    }
    # vLLM 0.19 accepts load_inplace on some builds; harmless if ignored upstream.
    if load_inplace:
        body["load_inplace"] = True
    url = f"{vllm_base_url()}/v1/load_lora_adapter"
    LOG.info("load_lora_adapter name=%s path=%s", name, path)
    return _post_json(url, body)


def unload_lora_adapter(name: str) -> dict[str, Any]:
    url = f"{vllm_base_url()}/v1/unload_lora_adapter"
    LOG.info("unload_lora_adapter name=%s", name)
    return _post_json(url, {"lora_name": name})


def list_vllm_models() -> list[str]:
    url = f"{vllm_base_url()}/v1/models"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return [m.get("id") for m in payload.get("data") or [] if m.get("id")]
