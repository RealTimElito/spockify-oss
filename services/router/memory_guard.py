"""Unified-memory guardrails — avoid GPU/RAM exhaustion hangs."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

LOG = logging.getLogger("spockify-router.memory_guard")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama.spockify.svc.cluster.local:11434").rstrip(
    "/"
)

# Minimum MemAvailable before heavy parallel agents (bytes). ~16Gi default.
HEAVY_MIN_AVAILABLE_BYTES = int(
    os.getenv("HEAVY_MIN_AVAILABLE_BYTES", str(16 * 1024**3))
)
# Ollama VRAM sum above this triggers unload-before-heavy (~85Gi).
HEAVY_MAX_OLLAMA_VRAM_BYTES = int(
    os.getenv("HEAVY_MAX_OLLAMA_VRAM_BYTES", str(85 * 1024**3))
)
# Cron / auto-unload when host MemAvailable drops below this (~10Gi).
CRITICAL_AVAILABLE_BYTES = int(
    os.getenv("MEMORY_GUARD_CRITICAL_BYTES", str(10 * 1024**3))
)
# Unload these name fragments first (largest models).
UNLOAD_MODEL_PRIORITY = [
    p.strip()
    for p in os.getenv(
        "MEMORY_GUARD_UNLOAD_PRIORITY",
        "gpt-oss:120b,qwen3.6:35b,qwen3.6:27b-coding,qwen3.6:27b,"
        "gemma4:31b,gemma4:26b,gemma4:12b,gpt-oss:20b",
    ).split(",")
    if p.strip()
]


def read_meminfo_bytes(path: str = "/proc/meminfo") -> dict[str, Any]:
    """Read MemTotal/MemAvailable from meminfo (host or cgroup)."""
    total: Optional[int] = None
    available: Optional[int] = None
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    available = int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError) as exc:
        return {"ok": False, "error": str(exc), "source": path}
    return {
        "ok": True,
        "source": path,
        "total_bytes": total,
        "available_bytes": available,
        "used_bytes": (total - available) if total is not None and available is not None else None,
    }


def normalize_ollama_ps(payload: dict[str, Any]) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    for item in payload.get("models") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("model") or "")
        models.append(
            {
                "name": name,
                "size_vram_bytes": int(item.get("size_vram") or 0),
            }
        )
    return models


async def probe_ollama_vram(client: httpx.AsyncClient) -> dict[str, Any]:
    try:
        resp = await client.get(f"{OLLAMA_URL}/api/ps", timeout=8.0)
        resp.raise_for_status()
        models = normalize_ollama_ps(resp.json())
        total_vram = sum(m["size_vram_bytes"] for m in models)
        return {
            "ok": True,
            "loaded_models": models,
            "loaded_count": len(models),
            "total_vram_bytes": total_vram,
        }
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        return {
            "ok": False,
            "loaded_models": [],
            "loaded_count": 0,
            "total_vram_bytes": 0,
            "error": str(exc),
        }


def memory_pressure_level(
    mem: dict[str, Any],
    ollama: dict[str, Any],
) -> str:
    """Return ok | warn | critical."""
    avail = mem.get("available_bytes")
    if isinstance(avail, int) and avail < CRITICAL_AVAILABLE_BYTES:
        return "critical"
    vram = int(ollama.get("total_vram_bytes") or 0)
    if vram > HEAVY_MAX_OLLAMA_VRAM_BYTES:
        return "warn"
    if isinstance(avail, int) and avail < HEAVY_MIN_AVAILABLE_BYTES:
        return "warn"
    return "ok"


async def unload_ollama_model(
    client: httpx.AsyncClient, model_name: str
) -> bool:
    try:
        resp = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": model_name, "keep_alive": 0, "prompt": ""},
            timeout=60.0,
        )
        if resp.status_code < 400:
            LOG.info("memory_guard unloaded ollama model %s", model_name)
            return True
        LOG.warning(
            "memory_guard failed to unload %s: %s",
            model_name,
            resp.text[:200],
        )
    except httpx.HTTPError as exc:
        LOG.warning("memory_guard unload error for %s: %s", model_name, exc)
    return False


def _models_to_unload(loaded: list[dict[str, Any]]) -> list[str]:
    names = [m["name"] for m in loaded if m.get("name")]
    ordered: list[str] = []
    for frag in UNLOAD_MODEL_PRIORITY:
        for name in names:
            if frag in name and name not in ordered:
                ordered.append(name)
    for name in names:
        if name not in ordered:
            ordered.append(name)
    return ordered


async def free_headroom(
    client: httpx.AsyncClient,
    *,
    target_vram_bytes: Optional[int] = None,
    min_available_bytes: Optional[int] = None,
) -> dict[str, Any]:
    """Unload Ollama models until headroom targets are met (best effort)."""
    target_vram = target_vram_bytes if target_vram_bytes is not None else HEAVY_MAX_OLLAMA_VRAM_BYTES
    min_avail = (
        min_available_bytes
        if min_available_bytes is not None
        else HEAVY_MIN_AVAILABLE_BYTES
    )
    mem = read_meminfo_bytes()
    ollama = await probe_ollama_vram(client)
    unloaded: list[str] = []
    level = memory_pressure_level(mem, ollama)

    while level in ("warn", "critical"):
        loaded = ollama.get("loaded_models") or []
        if not loaded:
            break
        candidates = _models_to_unload(loaded)
        # Keep ghost 20b until last on critical-only path.
        if level == "warn":
            candidates = [c for c in candidates if "gpt-oss:20b" not in c] or candidates
        next_model = candidates[0] if candidates else None
        if not next_model:
            break
        if await unload_ollama_model(client, next_model):
            unloaded.append(next_model)
        else:
            break
        mem = read_meminfo_bytes()
        ollama = await probe_ollama_vram(client)
        level = memory_pressure_level(mem, ollama)
        avail = mem.get("available_bytes")
        vram = int(ollama.get("total_vram_bytes") or 0)
        if (
            isinstance(avail, int)
            and avail >= min_avail
            and vram <= target_vram
            and level == "ok"
        ):
            break

    return {
        "level": memory_pressure_level(mem, ollama),
        "unloaded": unloaded,
        "mem": mem,
        "ollama": ollama,
    }


async def heavy_mode_allowed(client: httpx.AsyncClient) -> tuple[bool, str, dict[str, Any]]:
    """Return (allowed, reason, snapshot). May unload models first."""
    snapshot = await free_headroom(client)
    level = snapshot.get("level", "ok")
    mem = snapshot.get("mem") or {}
    avail = mem.get("available_bytes")
    if level == "critical":
        return (
            False,
            "Host memory is critically low; use Medium/Light or retry in a minute.",
            snapshot,
        )
    if isinstance(avail, int) and avail < HEAVY_MIN_AVAILABLE_BYTES:
        return (
            False,
            f"Only {avail // (1024**3)}GiB free — Heavy needs ~{HEAVY_MIN_AVAILABLE_BYTES // (1024**3)}GiB headroom.",
            snapshot,
        )
    return True, "", snapshot
