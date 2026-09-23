"""On-demand ComfyUI front door: wake GPU deploy, proxy HTTP/WS, idle scale-down.

Clients keep talking to service ``comfyui:8188``. This gateway sits behind that
Service, scales Deployment ``comfyui`` to 1 on real work, proxies to
``comfyui-backend``, and optionally scales back to 0 after idle.

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

LOG = logging.getLogger("spockify.comfyui-gateway")
logging.basicConfig(level=logging.INFO)

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
WAKE_TIMEOUT_S = float(os.getenv("COMFYUI_WAKE_TIMEOUT_S", "600"))
IDLE_MINUTES = float(os.getenv("COMFYUI_IDLE_SCALE_DOWN_MINUTES", "15"))
WAKE_ENABLED = os.getenv("COMFYUI_WAKE_ENABLED", "true").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

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
_idle_task: Optional[asyncio.Task] = None
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


async def ensure_awake(*, reason: str) -> None:
    """Scale ComfyUI to 1 and wait until HTTP answers, or raise."""
    global _last_used
    _last_used = time.time()
    _schedule_idle()

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

            try:
                base, headers, ctx = _k8s_session()
            except Exception as exc:  # noqa: BLE001
                raise RuntimeError(f"ComfyUI wake failed (no k8s API): {exc}") from exc

            async with httpx.AsyncClient(verify=ctx) as k8s:
                desired = await _get_replicas(k8s, base, headers)
                if desired < 1:
                    LOG.info("waking ComfyUI for %s (was replicas=%s)", reason, desired)
                    await _scale(k8s, base, headers, 1)
                else:
                    LOG.info(
                        "waiting for ComfyUI HTTP (replicas=%s, reason=%s)",
                        desired,
                        reason,
                    )

            deadline = time.monotonic() + WAKE_TIMEOUT_S
            while time.monotonic() < deadline:
                if await _backend_up(client):
                    LOG.info("ComfyUI awake after wake (%s)", reason)
                    _last_used = time.time()
                    _schedule_idle()
                    return
                await asyncio.sleep(2.0)

            raise RuntimeError(
                f"ComfyUI did not become ready within {int(WAKE_TIMEOUT_S)}s "
                f"(warm timeout; GPU deploy may be stuck)"
            )


def _path_needs_wake(path: str) -> bool:
    if not path.startswith("/"):
        path = "/" + path
    if path in ("/", "/system_stats", "/__gateway/health", "/__gateway/status"):
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
            idle_for = time.time() - _last_used
            if idle_for < IDLE_MINUTES * 60:
                continue
            try:
                base, headers, ctx = _k8s_session()
            except Exception as exc:  # noqa: BLE001
                LOG.warning("idle scale-down skipped (no k8s): %s", exc)
                return
            async with httpx.AsyncClient(verify=ctx) as k8s:
                try:
                    desired = await _get_replicas(k8s, base, headers)
                    if desired <= 0:
                        return
                    # Re-check idle after lock-ish delay in case a request landed.
                    if time.time() - _last_used < IDLE_MINUTES * 60:
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
        "comfyui-gateway backend=%s wake=%s idle_min=%s timeout=%ss",
        BACKEND_URL,
        WAKE_ENABLED,
        IDLE_MINUTES,
        int(WAKE_TIMEOUT_S),
    )
    _schedule_idle()


@app.get("/__gateway/health")
async def gateway_health() -> dict:
    return {"ok": True, "service": "comfyui-gateway"}


@app.get("/__gateway/status")
async def gateway_status() -> dict:
    backend_up = False
    replicas = None
    async with httpx.AsyncClient() as client:
        backend_up = await _backend_up(client)
    try:
        base, headers, ctx = _k8s_session()
        async with httpx.AsyncClient(verify=ctx) as k8s:
            replicas = await _get_replicas(k8s, base, headers)
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": True,
            "backend_up": backend_up,
            "replicas": replicas,
            "wake_enabled": WAKE_ENABLED,
            "idle_minutes": IDLE_MINUTES,
            "last_used_age_s": (time.time() - _last_used) if _last_used else None,
            "k8s_error": str(exc),
        }
    return {
        "ok": True,
        "backend_up": backend_up,
        "replicas": replicas,
        "wake_enabled": WAKE_ENABLED,
        "idle_minutes": IDLE_MINUTES,
        "last_used_age_s": (time.time() - _last_used) if _last_used else None,
    }


async def _proxy_http(request: Request, path: str) -> Response:
    target = urljoin(BACKEND_URL + "/", path.lstrip("/"))
    if request.url.query:
        target = f"{target}?{request.url.query}"

    body = await request.body()
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "transfer-encoding", "connection")
    }
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
        return await _proxy_http(request, path)

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
            open_timeout=60,
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
