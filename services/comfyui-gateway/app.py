"""ComfyUI front door: wake GPU deploy, proxy HTTP/WS, optional idle scale-down.

Clients keep talking to service ``comfyui:8188``. This gateway sits behind that
Service, scales Deployment ``comfyui`` to 1 on real work, proxies to
``comfyui-backend``, and optionally scales back to 0 after idle.

Production default is always-on: set ``COMFYUI_ALWAYS_ON=1`` (or
``COMFYUI_IDLE_SCALE_DOWN=0`` / ``COMFYUI_IDLE_SCALE_DOWN_MINUTES=0``) so the
gateway never idle-scales to 0. The Ollama pin timer may still scale Comfy to 0
when a large user model needs the RAM; it drops a hostPath marker that blocks
wake until the large model expires and the pin script restores replicas=1.

On real GPU work (wake / ``/prompt`` / busy queue under memory pressure), the
gateway evacuates the gpt-oss Ollama pins once (keep_alive=0) and writes a
hostPath marker so the pin timer does not reload them until Comfy is idle
again. Cold catalogs (``/__gateway/image-models``, ``/__gateway/video-models``)
never evacuate pins and never wake the GPU.

Health/status probes (``/``, ``/system_stats``) do **not** wake the GPU pod so
admin status pages can report cold without burning VRAM.
"""

from __future__ import annotations

import asyncio
import logging
import os
import ssl
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx
import websockets
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse

import image_models
from image_models import image_model_catalog

LOG = logging.getLogger("spockify.comfyui-gateway")
logging.basicConfig(level=logging.INFO)


def _env_on(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).lower() in ("1", "true", "yes", "on")


def _env_off(name: str, default: str = "1") -> bool:
    """True when the named flag is explicitly disabled."""
    return os.getenv(name, default).lower() in ("0", "false", "no", "off")


BACKEND_URL = os.getenv(
    "COMFYUI_BACKEND_URL",
    "http://comfyui-backend.spockify.svc.cluster.local:8188",
).rstrip("/")
DEPLOYMENT = os.getenv("COMFYUI_DEPLOYMENT", "comfyui")
NAMESPACE = os.getenv(
    "COMFYUI_NAMESPACE",
    Path("/var/run/secrets/kubernetes.io/serviceaccount/namespace").read_text().strip()
    if Path("/var/run/secrets/kubernetes.io/serviceaccount/namespace").is_file()
    else "spockify",
)
WAKE_TIMEOUT_S = float(os.getenv("COMFYUI_WAKE_TIMEOUT_S", "21600"))
# Always-on: never idle-scale to 0. Pin script may still scale for large models.
ALWAYS_ON = _env_on("COMFYUI_ALWAYS_ON")
IDLE_SCALE_DOWN_ENABLED = not ALWAYS_ON and not _env_off(
    "COMFYUI_IDLE_SCALE_DOWN", "1"
)
_raw_idle = float(os.getenv("COMFYUI_IDLE_SCALE_DOWN_MINUTES", "15"))
IDLE_MINUTES = 0.0 if not IDLE_SCALE_DOWN_ENABLED else _raw_idle
WAKE_ENABLED = os.getenv("COMFYUI_WAKE_ENABLED", "true").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# HostPath marker written by scripts/ollama-pin-gpt-oss.sh while a large user
# model holds the GPU/RAM window. Blocks wake so the gateway does not fight
# the pin timer. Mounted under the Comfy models hostPath.
EVICT_MARKER = Path(
    os.getenv(
        "COMFYUI_EVICT_MARKER",
        "/var/lib/spockify/comfyui/.spockify-evicted-for-ollama",
    )
)
# HostPath marker written by this gateway while gpt-oss pins are evacuated for
# Comfy. The pin timer skips reloads while this file exists.
PIN_EVAC_MARKER = Path(
    os.getenv(
        "COMFYUI_PIN_EVAC_MARKER",
        "/var/lib/spockify/comfyui/.spockify-pins-evacuated-for-comfy",
    )
)
OLLAMA_URL = os.getenv(
    "OLLAMA_URL",
    "http://ollama.spockify.svc.cluster.local:11434",
).rstrip("/")
# Comfy priority over gpt-oss pins (default on). Unload once per busy window.
PIN_EVAC_ENABLED = not _env_off("COMFYUI_PIN_EVAC_ENABLED", "1")
PIN_EVAC_MODELS = tuple(
    m.strip()
    for m in os.getenv(
        "COMFYUI_PIN_EVAC_MODELS",
        "gpt-oss:20b,gpt-oss:120b",
    ).split(",")
    if m.strip()
)
# When Comfy is already Running and a prompt is queued, also evacuate if free
# RAM is below this (KiB). 0 = only evacuate on explicit GPU-work force paths.
PIN_EVAC_MIN_AVAIL_KIB = int(os.getenv("COMFYUI_PIN_EVAC_MIN_AVAIL_KIB", "20971520"))
# After queue empty + no inflight, wait this long before clearing the marker.
PIN_RESTORE_GRACE_S = float(os.getenv("COMFYUI_PIN_RESTORE_GRACE_S", "45"))
# 0 = skip (default). Pod cgroup MemAvailable is not host RAM; the pin script
# eviction marker is the shared busy signal. Set only if the gateway sees host
# meminfo (rare).
WAKE_MIN_AVAIL_KIB = int(os.getenv("COMFYUI_WAKE_MIN_AVAIL_KIB", "0"))

# Paths that must bring ComfyUI up. Probes stay cold-aware.
_WAKE_PREFIXES = (
    "/prompt",
    "/ws",
    "/upload",
    "/view",
    "/history",
    "/queue",
    "/interrupt",
    "/object_info",
    "/api/",
    "/embeddings",
    "/extensions",
)

_wake_lock = asyncio.Lock()
_last_used = 0.0
_inflight = 0
_idle_task: Optional[asyncio.Task] = None
_pin_restore_task: Optional[asyncio.Task] = None
_pin_evac_lock = asyncio.Lock()
_sa_token: Optional[str] = None
_sa_ns = NAMESPACE


def _k8s_session() -> tuple[str, dict[str, str], ssl.SSLContext]:
    global _sa_token
    token_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/token")
    ca_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
    if not token_path.is_file():
        raise RuntimeError("not running in-cluster (missing service account token)")
    if _sa_token is None:
        _sa_token = token_path.read_text().strip()
    host = os.environ["KUBERNETES_SERVICE_HOST"]
    port = os.environ.get("KUBERNETES_SERVICE_PORT", "443")
    ctx = ssl.create_default_context(cafile=str(ca_path))
    headers = {
        "Authorization": f"Bearer {_sa_token}",
        "Accept": "application/json",
    }
    return f"https://{host}:{port}", headers, ctx


async def _get_replicas(client: httpx.AsyncClient, base: str, headers: dict) -> int:
    url = (
        f"{base}/apis/apps/v1/namespaces/{NAMESPACE}/deployments/{DEPLOYMENT}/scale"
    )
    resp = await client.get(url, headers=headers, timeout=15.0)
    resp.raise_for_status()
    return int((resp.json().get("spec") or {}).get("replicas") or 0)


async def _scale(client: httpx.AsyncClient, base: str, headers: dict, replicas: int) -> None:
    url = (
        f"{base}/apis/apps/v1/namespaces/{NAMESPACE}/deployments/{DEPLOYMENT}/scale"
    )
    patch_headers = {
        **headers,
        "Content-Type": "application/merge-patch+json",
    }
    resp = await client.patch(
        url,
        headers=patch_headers,
        json={"spec": {"replicas": replicas}},
        timeout=30.0,
    )
    resp.raise_for_status()
    LOG.info("scaled %s/%s → %s", NAMESPACE, DEPLOYMENT, replicas)


async def _backend_up(client: httpx.AsyncClient) -> bool:
    try:
        resp = await client.get(f"{BACKEND_URL}/", timeout=3.0)
        return resp.status_code < 500
    except httpx.HTTPError:
        return False


def _evicted_for_ollama() -> bool:
    """True while the pin script holds Comfy down for a large user model."""
    try:
        return EVICT_MARKER.is_file()
    except OSError:
        return False


def _pins_evacuated_for_comfy() -> bool:
    """True while gpt-oss pins are held out for Comfy GPU work."""
    try:
        return PIN_EVAC_MARKER.is_file()
    except OSError:
        return False


def _mem_available_kib() -> Optional[int]:
    """Best-effort MemAvailable. May reflect cgroup limits inside the pod."""
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        return None
    return None


def should_evacuate_pins(
    *,
    enabled: bool,
    marker_present: bool,
    force: bool,
    mem_available_kib: Optional[int],
    min_avail_kib: int,
) -> bool:
    """Whether to unload gpt-oss pins once for Comfy headroom.

    ``force`` is set on real GPU work (wake /prompt / upload / ws). Otherwise
    evacuate only when MemAvailable is below ``min_avail_kib`` (and that
    threshold is > 0). Never thrash: skip when the marker is already set.
    """
    if not enabled or marker_present:
        return False
    if force:
        return True
    if min_avail_kib <= 0 or mem_available_kib is None:
        return False
    return mem_available_kib < min_avail_kib


def should_clear_pin_evac_marker(
    *,
    marker_present: bool,
    inflight: int,
    wake_locked: bool,
    idle_for_s: float,
    grace_s: float,
    queue_busy: bool,
) -> bool:
    """True when Comfy is quiet long enough to let the pin timer restore."""
    if not marker_present:
        return False
    if wake_locked or inflight > 0 or queue_busy:
        return False
    return idle_for_s >= grace_s


def _path_forces_pin_evac(path: str) -> bool:
    """Paths that are real GPU work (not cold catalogs / probes)."""
    if not path.startswith("/"):
        path = "/" + path
    if path in (
        "/",
        "/system_stats",
        "/__gateway/health",
        "/__gateway/status",
        "/__gateway/image-models",
        "/__gateway/video-models",
    ) or path.startswith("/__gateway/"):
        return False
    # Prompt/upload/ws always need headroom. Other wake paths (history/view)
    # only evacuate via the low-MemAvailable branch while busy.
    return (
        path == "/prompt"
        or path.startswith("/prompt/")
        or path == "/upload"
        or path.startswith("/upload/")
        or path == "/ws"
        or path.startswith("/ws")
        or path.startswith("/api/")
    )


def wake_blocked_reason() -> Optional[str]:
    """Return a human reason if scaling Comfy to 1 should be refused."""
    if _evicted_for_ollama():
        return (
            "ComfyUI is paused for a large Ollama model "
            f"(marker {EVICT_MARKER.name}); wait for keep_alive expiry "
            "or ask again after the pin timer restores Comfy"
        )
    if WAKE_MIN_AVAIL_KIB > 0:
        avail = _mem_available_kib()
        if avail is not None and avail < WAKE_MIN_AVAIL_KIB:
            return (
                f"ComfyUI wake refused: MemAvailable {avail}KiB "
                f"< {WAKE_MIN_AVAIL_KIB}KiB (need ~16Gi free for Flux)"
            )
    return None


def _write_pin_evac_marker(*, reason: str) -> bool:
    """Create the shared busy file so the pin timer skips reloads."""
    try:
        PIN_EVAC_MARKER.parent.mkdir(parents=True, exist_ok=True)
        PIN_EVAC_MARKER.write_text(
            f"evacuated_at={time.strftime('%Y-%m-%dT%H:%M:%S%z')}\n"
            f"reason={reason}\n"
            f"models={','.join(PIN_EVAC_MODELS)}\n",
            encoding="utf-8",
        )
        return True
    except OSError as exc:
        LOG.warning("could not write pin-evac marker %s: %s", PIN_EVAC_MARKER, exc)
        return False


def _clear_pin_evac_marker() -> None:
    try:
        if PIN_EVAC_MARKER.is_file():
            PIN_EVAC_MARKER.unlink()
            LOG.info("cleared pin-evac marker %s", PIN_EVAC_MARKER)
    except OSError as exc:
        LOG.warning("could not clear pin-evac marker %s: %s", PIN_EVAC_MARKER, exc)


async def _ollama_unload_pin(model: str) -> None:
    """Unload one model via keep_alive=0 (same style as ollama-pin-gpt-oss.sh)."""
    payload = {"model": model, "keep_alive": 0}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
        # Ollama may 404 if the tag is absent; treat as unloaded.
        if resp.status_code >= 500:
            resp.raise_for_status()
        LOG.info("unloaded Ollama pin %s (keep_alive=0, status=%s)", model, resp.status_code)


async def evacuate_pins_for_comfy(*, reason: str, force: bool = False) -> bool:
    """Unload gpt-oss pins once and set the Comfy-priority marker.

    Returns True when an evacuation ran (or marker already held the window).
    """
    if not PIN_EVAC_ENABLED:
        return False
    async with _pin_evac_lock:
        marker_present = _pins_evacuated_for_comfy()
        avail = _mem_available_kib()
        if not should_evacuate_pins(
            enabled=PIN_EVAC_ENABLED,
            marker_present=marker_present,
            force=force,
            mem_available_kib=avail,
            min_avail_kib=PIN_EVAC_MIN_AVAIL_KIB,
        ):
            return marker_present

        # Marker first so a concurrent pin-timer tick does not reload mid-unload.
        if not _write_pin_evac_marker(reason=reason):
            return False
        LOG.info(
            "evacuating Ollama pins for Comfy (%s, force=%s, mem_avail_kib=%s)",
            reason,
            force,
            avail,
        )
        for model in PIN_EVAC_MODELS:
            try:
                await _ollama_unload_pin(model)
            except Exception as exc:  # noqa: BLE001
                LOG.warning("pin unload %s failed: %s", model, exc)
        return True


async def _comfy_queue_busy() -> bool:
    """True when Comfy reports running or pending queue items."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{BACKEND_URL}/queue")
            if resp.status_code >= 400:
                return False
            data = resp.json()
    except Exception:  # noqa: BLE001
        return False
    running = data.get("queue_running") or []
    pending = data.get("queue_pending") or []
    return bool(running or pending)


def _schedule_pin_restore() -> None:
    """Background: clear pin-evac marker after Comfy is idle for a grace period."""
    global _pin_restore_task
    if not PIN_EVAC_ENABLED:
        return
    if _pin_restore_task and not _pin_restore_task.done():
        return

    async def _loop() -> None:
        while PIN_EVAC_ENABLED:
            await asyncio.sleep(15.0)
            try:
                queue_busy = await _comfy_queue_busy()
            except Exception:  # noqa: BLE001
                queue_busy = True
            if _pins_evacuated_for_comfy():
                idle_for = (
                    time.time() - _last_used if _last_used else PIN_RESTORE_GRACE_S
                )
                if should_clear_pin_evac_marker(
                    marker_present=True,
                    inflight=_inflight,
                    wake_locked=_wake_lock.locked(),
                    idle_for_s=idle_for,
                    grace_s=PIN_RESTORE_GRACE_S,
                    queue_busy=queue_busy,
                ):
                    _clear_pin_evac_marker()
                continue
            # Secondary path: Running Comfy + queued work + low MemAvailable.
            if queue_busy or _inflight > 0:
                await evacuate_pins_for_comfy(
                    reason="queue-busy-low-mem",
                    force=False,
                )

    _pin_restore_task = asyncio.create_task(_loop())


async def ensure_awake(*, reason: str) -> None:
    """Scale ComfyUI to 1 and wait until HTTP answers, or raise."""
    global _last_used
    _last_used = time.time()
    _schedule_idle()
    _schedule_pin_restore()

    # Free gpt-oss pin RAM before (or while) Comfy needs GPU headroom.
    path_hint = reason.rsplit(" ", 1)[-1] if reason else ""
    await evacuate_pins_for_comfy(
        reason=reason,
        force=_path_forces_pin_evac(path_hint),
    )

    if not WAKE_ENABLED:
        async with httpx.AsyncClient() as client:
            if await _backend_up(client):
                return
        raise RuntimeError("ComfyUI backend unreachable and wake is disabled")

    async with _wake_lock:
        async with httpx.AsyncClient() as client:
            if await _backend_up(client):
                LOG.debug("ComfyUI already up (%s)", reason)
                return

            blocked = wake_blocked_reason()
            if blocked:
                LOG.warning("wake blocked (%s): %s", reason, blocked)
                raise RuntimeError(blocked)

            try:
                base, headers, ctx = _k8s_session()
            except Exception as exc:  # noqa: BLE001
                raise RuntimeError(f"ComfyUI wake failed (no k8s API): {exc}") from exc

            async with httpx.AsyncClient(verify=ctx) as k8s:
                desired = await _get_replicas(k8s, base, headers)
                if desired < 1:
                    # Re-check marker under the wake lock; pin script may have
                    # just evicted between the earlier probe and scale.
                    blocked = wake_blocked_reason()
                    if blocked:
                        LOG.warning("wake blocked (%s): %s", reason, blocked)
                        raise RuntimeError(blocked)
                    # Cold wake always needs pin headroom (Comfy ~16Gi).
                    await evacuate_pins_for_comfy(reason=f"cold-wake:{reason}", force=True)
                    LOG.info("waking ComfyUI for %s (was replicas=%s)", reason, desired)
                    await _scale(k8s, base, headers, 1)
                else:
                    LOG.info(
                        "waiting for ComfyUI HTTP (replicas=%s, reason=%s)",
                        desired,
                        reason,
                    )

            deadline = time.monotonic() + WAKE_TIMEOUT_S
            next_log = time.monotonic() + 30.0
            while time.monotonic() < deadline:
                # Cold start is active work. Refreshing this stops the idle
                # loop from treating a long model load as 15 minutes of quiet.
                _last_used = time.time()
                if await _backend_up(client):
                    LOG.info("ComfyUI awake after wake (%s)", reason)
                    _last_used = time.time()
                    _schedule_idle()
                    return
                now = time.monotonic()
                if now >= next_log:
                    LOG.info(
                        "still waiting for ComfyUI HTTP (%s, %.0fs left)",
                        reason,
                        max(0.0, deadline - now),
                    )
                    next_log = now + 30.0
                await asyncio.sleep(2.0)

            raise RuntimeError(
                f"ComfyUI did not become ready within {int(WAKE_TIMEOUT_S)}s "
                f"(warm timeout; GPU deploy may be stuck)"
            )


def idle_scale_down_allowed(
    *,
    wake_locked: bool,
    inflight: int,
    idle_for_s: float,
    idle_limit_s: float,
    replicas: int,
    always_on: bool = False,
) -> bool:
    """True when the GPU deploy has been unused long enough to scale to 0.

    A cold start holds the wake lock and is not idle, even though no HTTP
    request has finished yet. Scaling to 0 in that window kills the pod
    before ``/`` answers, and the video job stays at its first progress tick.

    When ``always_on`` / idle minutes are 0, the gateway never scales to 0;
    only the pin script may for large-model eviction.
    """
    if always_on or replicas <= 0 or idle_limit_s <= 0:
        return False
    if wake_locked or inflight > 0:
        return False
    return idle_for_s >= idle_limit_s


def _path_needs_wake(path: str) -> bool:
    if not path.startswith("/"):
        path = "/" + path
    if path in (
        "/",
        "/system_stats",
        "/__gateway/health",
        "/__gateway/status",
        "/__gateway/image-models",
        "/__gateway/video-models",
    ):
        return False
    return any(path == p or path.startswith(p) for p in _WAKE_PREFIXES)


def _schedule_idle() -> None:
    global _idle_task
    if IDLE_MINUTES <= 0:
        return
    if _idle_task and not _idle_task.done():
        return

    async def _idle_loop() -> None:
        while IDLE_MINUTES > 0:
            await asyncio.sleep(30.0)
            idle_for = time.time() - _last_used if _last_used else 0.0
            if not idle_scale_down_allowed(
                wake_locked=_wake_lock.locked(),
                inflight=_inflight,
                idle_for_s=idle_for,
                idle_limit_s=IDLE_MINUTES * 60,
                replicas=1,
                always_on=ALWAYS_ON,
            ):
                continue
            try:
                base, headers, ctx = _k8s_session()
            except Exception as exc:  # noqa: BLE001
                LOG.warning("idle scale-down skipped (no k8s): %s", exc)
                return
            async with httpx.AsyncClient(verify=ctx) as k8s:
                try:
                    desired = await _get_replicas(k8s, base, headers)
                    idle_for = time.time() - _last_used if _last_used else 0.0
                    if not idle_scale_down_allowed(
                        wake_locked=_wake_lock.locked(),
                        inflight=_inflight,
                        idle_for_s=idle_for,
                        idle_limit_s=IDLE_MINUTES * 60,
                        replicas=desired,
                        always_on=ALWAYS_ON,
                    ):
                        if desired <= 0:
                            return
                        continue
                    LOG.info(
                        "idle %.0fs ≥ %.0fm — scaling ComfyUI to 0",
                        idle_for,
                        IDLE_MINUTES,
                    )
                    await _scale(k8s, base, headers, 0)
                    return
                except Exception as exc:  # noqa: BLE001
                    LOG.warning("idle scale-down failed: %s", exc)
                    return

    _idle_task = asyncio.create_task(_idle_loop())


app = FastAPI(title="spockify-comfyui-gateway", docs_url=None, redoc_url=None)


@app.on_event("startup")
async def _startup() -> None:
    LOG.info(
        "comfyui-gateway backend=%s wake=%s always_on=%s idle_min=%s "
        "timeout=%ss pin_evac=%s ollama=%s",
        BACKEND_URL,
        WAKE_ENABLED,
        ALWAYS_ON,
        IDLE_MINUTES,
        int(WAKE_TIMEOUT_S),
        PIN_EVAC_ENABLED,
        OLLAMA_URL,
    )
    _schedule_idle()
    _schedule_pin_restore()


@app.get("/__gateway/health")
async def gateway_health() -> dict:
    return {"ok": True, "service": "comfyui-gateway"}


@app.get("/__gateway/image-models")
async def gateway_image_models() -> dict:
    """Runnable image checkpoints. Does not scale the GPU replica."""
    return image_model_catalog()


@app.get("/__gateway/video-models")
async def gateway_video_models() -> dict:
    """Video checkpoints for the composer picker. Disk/allowlist only; no wake."""
    catalog = image_model_catalog()
    rows = catalog.get("video_checkpoints") or []
    return {
        "models": rows,
        "default": image_models.default_video_model_id(rows),
        "a_camera": image_models.EPISODE_A_CAMERA_ID,
    }


@app.get("/__gateway/status")
async def gateway_status() -> dict:
    backend_up = False
    replicas = None
    async with httpx.AsyncClient() as client:
        backend_up = await _backend_up(client)
    status = {
        "ok": True,
        "backend_up": backend_up,
        "replicas": replicas,
        "wake_enabled": WAKE_ENABLED,
        "always_on": ALWAYS_ON,
        "idle_minutes": IDLE_MINUTES,
        "evicted_for_ollama": _evicted_for_ollama(),
        "pins_evacuated_for_comfy": _pins_evacuated_for_comfy(),
        "pin_evac_marker": str(PIN_EVAC_MARKER),
        "last_used_age_s": (time.time() - _last_used) if _last_used else None,
    }
    try:
        base, headers, ctx = _k8s_session()
        async with httpx.AsyncClient(verify=ctx) as k8s:
            status["replicas"] = await _get_replicas(k8s, base, headers)
    except Exception as exc:  # noqa: BLE001
        status["k8s_error"] = str(exc)
        return status
    return status


def _forward_headers(request: Request) -> dict[str, str]:
    """Headers safe to send upstream.

    Chat sends ``Authorization: Bearer `` when no Comfy API key is set.
    httpx rejects that value and the prompt never reaches Comfy.
    """
    headers: dict[str, str] = {}
    for key, value in request.headers.items():
        if key.lower() in ("host", "content-length", "transfer-encoding", "connection"):
            continue
        if key.lower() == "authorization" and value.strip().lower() in {"", "bearer"}:
            continue
        headers[key] = value
    return headers


async def _proxy_http(request: Request, path: str) -> Response:
    target = urljoin(BACKEND_URL + "/", path.lstrip("/"))
    if request.url.query:
        target = f"{target}?{request.url.query}"

    body = await request.body()
    headers = _forward_headers(request)
    async with httpx.AsyncClient(timeout=None) as client:
        try:
            upstream = await client.request(
                request.method,
                target,
                content=body,
                headers=headers,
            )
        except httpx.HTTPError as exc:
            return PlainTextResponse(
                f"ComfyUI backend unreachable: {exc}",
                status_code=503,
            )
    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower()
        not in (
            "content-encoding",
            "content-length",
            "transfer-encoding",
            "connection",
        )
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=out_headers,
        media_type=upstream.headers.get("content-type"),
    )


async def _proxy_while_busy(request: Request, path: str) -> Response:
    """Proxy one request that must keep the GPU replica up."""
    global _inflight
    _inflight += 1
    try:
        return await _proxy_http(request, path)
    finally:
        _inflight -= 1
        _touch()


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def http_entry(request: Request, path: str) -> Response:
    full = "/" + path if path else "/"

    # Cold-aware probes — never wake.
    if full in ("/", "/system_stats") or full.startswith("/__gateway/"):
        async with httpx.AsyncClient() as client:
            if await _backend_up(client):
                return await _proxy_http(request, path or "")
        if full == "/system_stats":
            return JSONResponse(
                {
                    "system": {"comfyui": "cold", "on_demand": True},
                    "devices": [],
                }
            )
        return PlainTextResponse(
            "comfyui-gateway: cold (scaled to 0; wakes on image/video work)",
            status_code=200,
        )

    if _path_needs_wake(full):
        try:
            await ensure_awake(reason=f"{request.method} {full}")
        except Exception as exc:  # noqa: BLE001
            LOG.warning("wake failed: %s", exc)
            return PlainTextResponse(
                f"ComfyUI warm-up failed: {exc}",
                status_code=503,
            )
        _touch()
        return await _proxy_while_busy(request, path)

    # Unknown path: try proxy without wake if up, else 503.
    async with httpx.AsyncClient() as client:
        if await _backend_up(client):
            _touch()
            return await _proxy_http(request, path)
    return PlainTextResponse(
        "ComfyUI is cold. Use an image/video generation request to wake it.",
        status_code=503,
    )


def _touch() -> None:
    global _last_used
    _last_used = time.time()
    _schedule_idle()


@app.websocket("/ws")
@app.websocket("/{path:path}")
async def ws_entry(websocket: WebSocket, path: str = "ws") -> None:
    full = "/" + (path or "ws")

    try:
        await ensure_awake(reason=f"WS {full}")
    except Exception as exc:  # noqa: BLE001
        # Accept then close with reason — some clients ignore pre-accept close.
        await websocket.accept()
        await websocket.close(code=1013, reason=f"ComfyUI warm-up failed: {exc}"[:110])
        return

    await websocket.accept()
    _touch()

    parsed = urlparse(BACKEND_URL)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    qs = websocket.scope.get("query_string", b"").decode()
    backend_path = full if full.startswith("/") else f"/{full}"
    target = f"{scheme}://{parsed.netloc}{backend_path}"
    if qs:
        target = f"{target}?{qs}"

    try:
        async with websockets.connect(
            target,
            max_size=32 * 1024 * 1024,
            open_timeout=180,
        ) as backend:

            async def client_to_backend() -> None:
                try:
                    while True:
                        msg = await websocket.receive()
                        _touch()
                        if msg["type"] == "websocket.disconnect":
                            break
                        if msg.get("text") is not None:
                            await backend.send(msg["text"])
                        elif msg.get("bytes") is not None:
                            await backend.send(msg["bytes"])
                except WebSocketDisconnect:
                    pass

            async def backend_to_client() -> None:
                try:
                    async for message in backend:
                        _touch()
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except Exception:  # noqa: BLE001
                    pass

            _done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_backend()),
                    asyncio.create_task(backend_to_client()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    except Exception as exc:  # noqa: BLE001
        LOG.warning("ws proxy failed: %s", exc)
        try:
            await websocket.close(code=1011, reason="ComfyUI proxy error")
        except Exception:  # noqa: BLE001
            pass
