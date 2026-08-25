"""Parallel multi-agent runs + synthesis (in-process persistence).

Stretch: nested workers (depth cap), shared tools (search/browse), mesh endpoint
routing when peers are configured, run-state sync (Wave 8), and cancel/interrupt.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.agents")

AGENTS_MAX_WORKERS = int(os.getenv("AGENTS_MAX_WORKERS", "4"))
AGENTS_WORKER_TIMEOUT = float(os.getenv("AGENTS_WORKER_TIMEOUT", "120"))
AGENTS_SYNTH_TIMEOUT = float(os.getenv("AGENTS_SYNTH_TIMEOUT", "180"))
AGENTS_MAX_TOKENS = int(os.getenv("AGENTS_MAX_TOKENS", "1024"))
AGENTS_DEFAULT_MODEL = os.getenv("AGENTS_DEFAULT_MODEL", "gemma4-12b")
AGENTS_MAX_DEPTH = int(os.getenv("AGENTS_MAX_DEPTH", "2"))
AGENTS_MAX_NESTED_PER_WORKER = int(os.getenv("AGENTS_MAX_NESTED_PER_WORKER", "2"))
AGENTS_SHARED_TOOLS = [
    t.strip().lower()
    for t in os.getenv("AGENTS_SHARED_TOOLS", "search,browse").split(",")
    if t.strip()
]
# Comma URLs of peer router bases for worker offload (mesh MVP).
# Falls back to SPOCKIFY_FEDERATION_PEERS / FEDERATION_PEERS when unset.
_MESH_RAW = (
    os.getenv("AGENTS_MESH_ENDPOINTS")
    or os.getenv("SPOCKIFY_FEDERATION_PEERS")
    or os.getenv("FEDERATION_PEERS")
    or ""
)
AGENTS_MESH_ENDPOINTS = [p.strip().rstrip("/") for p in _MESH_RAW.split(",") if p.strip()]
AGENTS_MESH_ENABLED = os.getenv(
    "AGENTS_MESH_ENABLED",
    "1" if AGENTS_MESH_ENDPOINTS else "0",
).lower() in ("1", "true", "yes", "on")
AGENTS_MESH_SYNC = os.getenv(
    "AGENTS_MESH_SYNC",
    "1" if AGENTS_MESH_ENDPOINTS else "0",
).lower() in ("1", "true", "yes", "on")

AGENT_RUNS_DIR = Path(os.getenv("AGENT_RUNS_DIR", "/tmp/spockify-agent-runs"))

_AGENT_RUNS: dict[str, dict[str, Any]] = {}
_RUN_EVENTS: dict[str, list[dict[str, Any]]] = {}
_RUN_WAITERS: dict[str, list[asyncio.Queue]] = {}
_CANCEL_FLAGS: dict[str, asyncio.Event] = {}
_WORKER_CANCEL: dict[str, set[str]] = {}
_RUN_TASKS: dict[str, asyncio.Task] = {}
_MESH_RR = 0

WorkerChatFn = Callable[..., Awaitable[dict[str, Any]]]
# Optional shared tool: (client, query) -> text blob to inject.
SearchToolFn = Callable[..., Awaitable[str]]
BrowseToolFn = Callable[..., Awaitable[str]]
# Optional mesh chat: (client, endpoint, model, messages, **kwargs) -> completion dict.
MeshChatFn = Callable[..., Awaitable[dict[str, Any]]]
# Optional peer run-state sync: (run_public_view) -> None
MeshSyncFn = Callable[[dict[str, Any]], Awaitable[None]]

_MESH_SYNC_FN: Optional[MeshSyncFn] = None
_URL_IN_TEXT_RE = re.compile(r"https?://[^\s\]\)\"'<>]+", re.IGNORECASE)


def set_mesh_sync_fn(fn: Optional[MeshSyncFn]) -> None:
    global _MESH_SYNC_FN
    _MESH_SYNC_FN = fn

_SPAWN_JSON_RE = re.compile(
    r"SPAWN_CHILDREN\s*:\s*(\[[\s\S]*?\])",
    re.IGNORECASE,
)
_TERMINAL_STATUSES = frozenset({"done", "failed", "cancelled"})


class AgentWorkerSpec(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    model: Optional[str] = None
    prompt: str = ""
    tools: Optional[list[str]] = None
    children: Optional[list["AgentWorkerSpec"]] = None
    endpoint: Optional[str] = None  # mesh peer base URL override


AgentWorkerSpec.model_rebuild()


class AgentRunCreate(BaseModel):
    parent_prompt: str
    model: Optional[str] = None
    workers: Optional[list[AgentWorkerSpec]] = None
    synthesize: bool = True
    parent_chat_id: Optional[str] = None
    parent_message_id: Optional[str] = None
    depth: int = 0
    tools: Optional[list[str]] = None  # default tools for all workers
    user_id: Optional[str] = None  # owning OWUI user (per-user scoping)


_PARALLEL_INTENT_RE = re.compile(
    r"(?:"
    r"\b(?:spawn\s+agents?|parallel\s+agents?|research\s+in\s+parallel|"
    r"multi[- ]agent|fan[- ]out|several\s+agents?)\b"
    r"|/agents\b"
    r")",
    re.IGNORECASE,
)


def wants_parallel_agents(text: str) -> bool:
    return bool(_PARALLEL_INTENT_RE.search(text or ""))


def _utc_now() -> str:
    return datetime.now(tz=ZoneInfo("UTC")).isoformat()


def _resolve_worker_model(model: Optional[str]) -> str:
    name = (model or "").strip() or AGENTS_DEFAULT_MODEL
    lowered = name.lower()
    if "spockify-auto" in lowered or "spockify-agents" in lowered:
        return AGENTS_DEFAULT_MODEL
    if "spockify-room" in lowered:
        return AGENTS_DEFAULT_MODEL
    return name


def _effective_tools(
    worker_tools: Optional[list[str]],
    run_tools: Optional[list[str]],
) -> list[str]:
    if worker_tools is not None:
        return [t.strip().lower() for t in worker_tools if t and str(t).strip()]
    if run_tools is not None:
        return [t.strip().lower() for t in run_tools if t and str(t).strip()]
    return list(AGENTS_SHARED_TOOLS)


def _auto_plan_workers(parent_prompt: str, default_model: str) -> list[dict[str, Any]]:
    """Heuristic worker roles when the client does not supply an explicit list."""
    prompt = (parent_prompt or "").strip()
    base = _resolve_worker_model(default_model)
    templates = [
        (
            "explorer",
            "Explorer",
            (
                "You are Explorer. Map the problem space, key facts, and options. "
                "Be concrete and thorough; bullets OK. Prefer evidence over guesses. "
                "Do not write the final user-facing answer."
            ),
            ["search"],
        ),
        (
            "analyst",
            "Analyst",
            (
                "You are Analyst. Dig into trade-offs, risks, and evidence. "
                "Challenge weak assumptions. Do not write the final user-facing answer."
            ),
            ["search"],
        ),
        (
            "builder",
            "Builder",
            (
                "You are Builder. Propose a practical solution or steps (code/config OK). "
                "Prefer actionable detail. Do not write the final user-facing answer."
            ),
            [],
        ),
        (
            "skeptic",
            "Skeptic",
            (
                "You are Skeptic. Find gaps, failure modes, and missing edge cases. "
                "Do not write the final user-facing answer."
            ),
            [],
        ),
    ]
    # Shorter prompts → fewer workers to save latency/GPU.
    n = 2 if len(prompt) < 120 else 3 if len(prompt) < 400 else 4
    n = min(n, AGENTS_MAX_WORKERS, len(templates))
    workers: list[dict[str, Any]] = []
    for wid, name, system, tools in templates[:n]:
        workers.append(
            {
                "id": wid,
                "name": name,
                "model": base,
                "prompt": (
                    f"{system}\n\nUser request:\n{prompt}\n\n"
                    "Respond with your role's contribution only.\n"
                    "Optional: to spawn up to "
                    f"{AGENTS_MAX_NESTED_PER_WORKER} child workers (depth-capped), "
                    'end with SPAWN_CHILDREN:[{"name":"...","prompt":"..."}]'
                ),
                "tools": tools if tools else None,
                "children": None,
                "endpoint": None,
            }
        )
    return workers


def _normalize_workers(
    specs: Optional[list[AgentWorkerSpec]],
    parent_prompt: str,
    default_model: Optional[str],
    *,
    depth: int = 0,
) -> list[dict[str, Any]]:
    if not specs:
        return _auto_plan_workers(parent_prompt, default_model or AGENTS_DEFAULT_MODEL)
    out: list[dict[str, Any]] = []
    for i, spec in enumerate(specs[:AGENTS_MAX_WORKERS]):
        wid = (spec.id or f"w{i + 1}").strip() or f"w{i + 1}"
        name = (spec.name or wid).strip() or wid
        model = _resolve_worker_model(spec.model or default_model)
        prompt = (spec.prompt or "").strip() or (
            f"You are agent '{name}'. Work on this request independently.\n\n"
            f"User request:\n{parent_prompt}"
        )
        children = None
        if spec.children and depth + 1 < AGENTS_MAX_DEPTH:
            children = _normalize_workers(
                spec.children[:AGENTS_MAX_NESTED_PER_WORKER],
                parent_prompt,
                model,
                depth=depth + 1,
            )
        out.append(
            {
                "id": wid,
                "name": name,
                "model": model,
                "prompt": prompt,
                "tools": spec.tools,
                "children": children,
                "endpoint": (spec.endpoint or "").strip() or None,
            }
        )
    if not out:
        return _auto_plan_workers(parent_prompt, default_model or AGENTS_DEFAULT_MODEL)
    return out


def _empty_worker_state(spec: dict[str, Any], *, depth: int = 0) -> dict[str, Any]:
    return {
        "id": spec["id"],
        "name": spec["name"],
        "model": spec["model"],
        "prompt": spec["prompt"],
        "tools": spec.get("tools"),
        "status": "pending",
        "output": "",
        "preview": "",
        "error": None,
        "started_at": None,
        "finished_at": None,
        "depth": depth,
        "endpoint": spec.get("endpoint"),
        "mesh": False,
        "children": [],
        "tools_used": [],
    }


def _persist_run(run: dict[str, Any]) -> None:
    run_id = str(run["id"])
    _AGENT_RUNS[run_id] = run
    try:
        AGENT_RUNS_DIR.mkdir(parents=True, exist_ok=True)
        path = AGENT_RUNS_DIR / f"{run_id}.json"
        path.write_text(json.dumps(run, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        LOG.debug("agent run persist skipped: %s", exc)
    if AGENTS_MESH_SYNC and _MESH_SYNC_FN and AGENTS_MESH_ENDPOINTS:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_MESH_SYNC_FN(public_run_view(run)))
        except RuntimeError:
            pass


def ingest_synced_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Accept a peer run snapshot into local durable store (Wave 8.4)."""
    if not isinstance(payload, dict) or not payload.get("id"):
        raise ValueError("invalid run payload")
    run_id = str(payload["id"])
    existing = _load_run(run_id)
    # Prefer newer updated_at when both exist.
    if existing:
        if str(existing.get("updated_at") or "") >= str(payload.get("updated_at") or ""):
            return existing
    payload = dict(payload)
    payload["synced_from_peer"] = True
    _AGENT_RUNS[run_id] = payload
    try:
        AGENT_RUNS_DIR.mkdir(parents=True, exist_ok=True)
        path = AGENT_RUNS_DIR / f"{run_id}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        LOG.debug("synced run persist skipped: %s", exc)
    return payload


def _load_run(run_id: str) -> Optional[dict[str, Any]]:
    if run_id in _AGENT_RUNS:
        return _AGENT_RUNS[run_id]
    path = AGENT_RUNS_DIR / f"{run_id}.json"
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("id"):
                _AGENT_RUNS[run_id] = data
                return data
    except (OSError, json.JSONDecodeError, TypeError):
        return None
    return None


def list_runs(limit: int = 50, user_id: Optional[str] = None) -> list[dict[str, Any]]:
    merged = dict(_AGENT_RUNS)
    try:
        if AGENT_RUNS_DIR.is_dir():
            for path in AGENT_RUNS_DIR.glob("*.json"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(data, dict) and data.get("id"):
                        merged[str(data["id"])] = data
                except (OSError, json.JSONDecodeError, TypeError):
                    continue
    except OSError:
        pass
    rows = list(merged.values())
    if user_id:
        uid = str(user_id)
        rows = [r for r in rows if str(r.get("user_id") or "") == uid]
    return sorted(
        rows,
        key=lambda d: str(d.get("updated_at") or ""),
        reverse=True,
    )[: max(1, min(limit, 200))]


def get_run(run_id: str) -> Optional[dict[str, Any]]:
    return _load_run(run_id)


def _preview(text: str, n: int = 160) -> str:
    flat = " ".join((text or "").split())
    if len(flat) <= n:
        return flat
    return flat[: n - 1] + "…"


def _emit(run_id: str, event: dict[str, Any]) -> None:
    event = {**event, "ts": _utc_now(), "run_id": run_id}
    _RUN_EVENTS.setdefault(run_id, []).append(event)
    for q in list(_RUN_WAITERS.get(run_id, [])):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


def _cancel_event(run_id: str) -> asyncio.Event:
    if run_id not in _CANCEL_FLAGS:
        _CANCEL_FLAGS[run_id] = asyncio.Event()
    return _CANCEL_FLAGS[run_id]


def is_cancelled(run_id: str, worker_id: Optional[str] = None) -> bool:
    ev = _CANCEL_FLAGS.get(run_id)
    if ev and ev.is_set():
        return True
    if worker_id and worker_id in _WORKER_CANCEL.get(run_id, set()):
        return True
    return False


def request_cancel(
    run_id: str,
    *,
    worker_id: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Cancel a whole run, or mark one worker cancelled (others continue)."""
    run = _load_run(run_id)
    if not run:
        return None
    if run.get("status") in _TERMINAL_STATUSES:
        return run

    if worker_id:
        _WORKER_CANCEL.setdefault(run_id, set()).add(worker_id)
        for w in run.get("workers") or []:
            if w.get("id") != worker_id:
                continue
            if w.get("status") in ("pending", "running"):
                w["status"] = "cancelled"
                w["error"] = "cancelled by user"
                w["output"] = w.get("output") or f"[{w.get('name')} cancelled]"
                w["preview"] = _preview(str(w["output"]))
                w["finished_at"] = _utc_now()
        run["updated_at"] = _utc_now()
        _persist_run(run)
        _emit(
            run_id,
            {
                "type": "worker_status",
                "worker_id": worker_id,
                "status": "cancelled",
                "run": public_run_view(run),
            },
        )
        return run

    _cancel_event(run_id).set()
    for w in run.get("workers") or []:
        if w.get("status") in ("pending", "running"):
            w["status"] = "cancelled"
            w["error"] = "cancelled by user"
            if not w.get("output"):
                w["output"] = f"[{w.get('name')} cancelled]"
            w["preview"] = _preview(str(w.get("output") or ""))
            w["finished_at"] = _utc_now()
    run["status"] = "cancelled"
    run["error"] = "cancelled by user"
    if not run.get("synthesis"):
        done_chunks = [
            f"### {w.get('name')}\n{w.get('output')}"
            for w in run.get("workers") or []
            if w.get("status") == "done" and w.get("output")
        ]
        run["synthesis"] = (
            "\n\n".join(done_chunks)
            if done_chunks
            else "Run cancelled before synthesis."
        )
    run["finished_at"] = _utc_now()
    run["updated_at"] = run["finished_at"]
    _persist_run(run)
    _emit(
        run_id,
        {"type": "run_status", "status": "cancelled", "run": public_run_view(run)},
    )
    task = _RUN_TASKS.get(run_id)
    if task and not task.done():
        task.cancel()
    return run


def register_run_task(run_id: str, task: asyncio.Task) -> None:
    _RUN_TASKS[run_id] = task

    def _clear(t: asyncio.Task) -> None:
        if _RUN_TASKS.get(run_id) is t:
            _RUN_TASKS.pop(run_id, None)

    task.add_done_callback(_clear)


def public_run_view(run: dict[str, Any]) -> dict[str, Any]:
    """Slim view for SSE / OWUI cards."""

    def _duration_ms(w: dict[str, Any]) -> Optional[int]:
        started = w.get("started_at")
        finished = w.get("finished_at")
        if not started or not finished:
            return w.get("duration_ms")
        try:
            from datetime import datetime as _dt

            a = _dt.fromisoformat(str(started).replace("Z", "+00:00"))
            b = _dt.fromisoformat(str(finished).replace("Z", "+00:00"))
            return max(0, int((b - a).total_seconds() * 1000))
        except (TypeError, ValueError):
            return w.get("duration_ms")

    def _worker_view(w: dict[str, Any]) -> dict[str, Any]:
        children = [_worker_view(c) for c in (w.get("children") or [])]
        out = str(w.get("output") or "")
        # Rough mid-run token estimate from output chars when usage missing.
        est_tokens = int(w.get("completion_tokens") or 0) or max(0, len(out) // 4)
        status = w.get("status")
        preview = w.get("preview") or _preview(out)
        # IDE client historically read `state`/`result`; emit both names so
        # older and newer extensions show live worker progress.
        return {
            "id": w.get("id"),
            "name": w.get("name"),
            "model": w.get("model"),
            "prompt": w.get("prompt"),
            "status": status,
            "state": status,
            "preview": preview,
            "output": out,
            "result": out or preview,
            "error": w.get("error"),
            "depth": w.get("depth", 0),
            "mesh": bool(w.get("mesh")),
            "endpoint": w.get("endpoint"),
            "tools_used": w.get("tools_used") or [],
            "started_at": w.get("started_at"),
            "finished_at": w.get("finished_at"),
            "duration_ms": _duration_ms(w),
            "completion_tokens": est_tokens,
            "children": children,
        }

    workers = [_worker_view(w) for w in (run.get("workers") or [])]
    total_tok = sum(int(w.get("completion_tokens") or 0) for w in workers)
    try:
        from cost_hud import estimate_cost_usd

        cost_usd = estimate_cost_usd(0, total_tok)
    except Exception:  # noqa: BLE001
        cost_usd = round((total_tok / 1000.0) * 0.0002, 6)
    created = run.get("created_at")
    latency_ms = 0
    try:
        if created:
            from datetime import datetime as _dt

            a = _dt.fromisoformat(str(created).replace("Z", "+00:00"))
            latency_ms = max(
                0, int((datetime.now(tz=ZoneInfo("UTC")) - a).total_seconds() * 1000)
            )
    except (TypeError, ValueError):
        latency_ms = 0

    return {
        "id": run.get("id"),
        "status": run.get("status"),
        "parent_prompt": run.get("parent_prompt"),
        "model": run.get("model"),
        "depth": run.get("depth", 0),
        "user_id": run.get("user_id"),
        "workers": workers,
        "synthesis": run.get("synthesis") or "",
        "error": run.get("error"),
        "mesh_enabled": bool(run.get("mesh_enabled")),
        "synced_from_peer": bool(run.get("synced_from_peer")),
        "forked_from": run.get("forked_from"),
        "created_at": run.get("created_at"),
        "updated_at": run.get("updated_at"),
        "finished_at": run.get("finished_at"),
        "hud": {
            "worker": "agents",
            "model": "spockify-agents",
            "latency_ms": latency_ms,
            "prompt_tokens": 0,
            "completion_tokens": total_tok,
            "total_tokens": total_tok,
            "cost_usd": cost_usd,
            "cost_note": "rough mid-run estimate",
        },
    }


def agents_meta_sse(run: dict[str, Any]) -> bytes:
    """OpenWebUI middleware picks selected_model_id + spockify_agents."""
    view = public_run_view(run)
    payload = {
        "selected_model_id": "spockify-agents",
        "worker": "agents",
        "spockify_agents": view,
        "spockify_hud": view.get("hud") or {},
        "event": {
            "type": "status",
            "data": {
                "action": "routing",
                "description": f"Parallel agents ({run.get('status')})",
                "done": run.get("status") in _TERMINAL_STATUSES,
            },
        },
    }
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode()


def create_run_record(body: AgentRunCreate) -> dict[str, Any]:
    run_id = uuid.uuid4().hex[:16]
    default_model = body.model or AGENTS_DEFAULT_MODEL
    depth = max(0, min(int(body.depth or 0), AGENTS_MAX_DEPTH - 1))
    specs = _normalize_workers(
        body.workers, body.parent_prompt, default_model, depth=depth
    )
    now = _utc_now()
    run: dict[str, Any] = {
        "id": run_id,
        "status": "pending",
        "parent_prompt": body.parent_prompt,
        "model": default_model,
        "synthesize": bool(body.synthesize),
        "parent_chat_id": body.parent_chat_id,
        "parent_message_id": body.parent_message_id,
        "depth": depth,
        "tools": body.tools,
        "user_id": (body.user_id or "").strip() or None,
        "mesh_enabled": AGENTS_MESH_ENABLED and bool(AGENTS_MESH_ENDPOINTS),
        "workers": [_empty_worker_state(s, depth=depth) for s in specs],
        "worker_specs": specs,
        "synthesis": "",
        "error": None,
        "created_at": now,
        "updated_at": now,
        "finished_at": None,
    }
    _cancel_event(run_id)  # ensure exists, clear
    _CANCEL_FLAGS[run_id].clear()
    _WORKER_CANCEL.pop(run_id, None)
    _persist_run(run)
    _emit(run_id, {"type": "run_created", "status": "pending", "run": public_run_view(run)})
    return run


class AgentForkRequest(BaseModel):
    worker_id: str
    prompt_override: Optional[str] = None
    what_if: Optional[str] = None
    synthesize: bool = True


def _find_worker(workers: list[dict[str, Any]], worker_id: str) -> Optional[dict[str, Any]]:
    for w in workers or []:
        if str(w.get("id")) == str(worker_id):
            return w
        found = _find_worker(w.get("children") or [], worker_id)
        if found:
            return found
    return None


def fork_run_from_worker(run_id: str, body: AgentForkRequest) -> dict[str, Any]:
    """Time-travel fork: new run from a worker mid-state (Wave 10.4).

    Copies the worker's prompt/output snapshot into a fresh single-worker run
    with an optional "what if…" override. Does not clone GPU memory.
    """
    src = get_run(run_id)
    if not src:
        raise ValueError("run not found")
    worker = _find_worker(src.get("workers") or [], body.worker_id)
    if not worker:
        raise ValueError(f"worker not found: {body.worker_id}")

    base_prompt = (worker.get("prompt") or src.get("parent_prompt") or "").strip()
    prior_out = (worker.get("output") or worker.get("preview") or "").strip()
    what_if = (body.what_if or body.prompt_override or "").strip()
    parent_prompt = base_prompt
    if prior_out:
        parent_prompt += f"\n\n[Fork mid-state output]\n{prior_out[:3000]}"
    if what_if:
        parent_prompt += f"\n\n[What if…]\n{what_if}"

    fork_body = AgentRunCreate(
        parent_prompt=parent_prompt,
        model=worker.get("model") or src.get("model"),
        workers=[
            AgentWorkerSpec(
                id=None,
                name=f"fork-{worker.get('name') or body.worker_id}",
                model=worker.get("model"),
                prompt=parent_prompt,
                tools=worker.get("tools"),
            )
        ],
        synthesize=bool(body.synthesize),
        parent_chat_id=src.get("parent_chat_id"),
        parent_message_id=src.get("parent_message_id"),
        depth=0,
        tools=src.get("tools"),
        user_id=src.get("user_id"),
    )
    run = create_run_record(fork_body)
    run["forked_from"] = {
        "run_id": run_id,
        "worker_id": body.worker_id,
        "what_if": what_if or None,
    }
    run["updated_at"] = _utc_now()
    _persist_run(run)
    _emit(
        run["id"],
        {
            "type": "fork_created",
            "status": "pending",
            "forked_from": run["forked_from"],
            "run": public_run_view(run),
        },
    )
    return run


def _pick_mesh_endpoint(worker: dict[str, Any], index: int) -> Optional[str]:
    if worker.get("endpoint"):
        return str(worker["endpoint"]).rstrip("/")
    if not AGENTS_MESH_ENABLED or not AGENTS_MESH_ENDPOINTS:
        return None
    # Leave index 0 local; alternate remaining workers onto peers.
    if index == 0:
        return None
    global _MESH_RR
    endpoint = AGENTS_MESH_ENDPOINTS[_MESH_RR % len(AGENTS_MESH_ENDPOINTS)]
    _MESH_RR += 1
    return endpoint


def _parse_spawn_children(text: str) -> list[dict[str, Any]]:
    match = _SPAWN_JSON_RE.search(text or "")
    if not match:
        return []
    try:
        raw = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for i, item in enumerate(raw[:AGENTS_MAX_NESTED_PER_WORKER]):
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or "").strip()
        if not prompt:
            continue
        name = str(item.get("name") or f"child-{i + 1}").strip() or f"child-{i + 1}"
        wid = str(item.get("id") or f"c{i + 1}").strip() or f"c{i + 1}"
        out.append(
            {
                "id": wid,
                "name": name,
                "model": _resolve_worker_model(item.get("model")),
                "prompt": prompt,
                "tools": item.get("tools"),
                "children": None,
                "endpoint": None,
            }
        )
    return out


def _strip_spawn_marker(text: str) -> str:
    return _SPAWN_JSON_RE.sub("", text or "").rstrip()


async def _maybe_search_context(
    *,
    client: Any,
    search_tool: Optional[SearchToolFn],
    query: str,
    tools: list[str],
    browse_tool: Optional[BrowseToolFn] = None,
    run_id: Optional[str] = None,
    worker_id: Optional[str] = None,
) -> tuple[str, list[str]]:
    """Run shared search/browse tools for a worker's context.

    When `run_id` is given, emits `tool_start`/`tool_result` SSE events
    (consumed by `/spockify/agents/runs/{id}/events`) around each call so
    the IDE's Agents view can show live "Searching…"/"Browsing <url>…"
    activity instead of only learning about it once the worker finishes.
    """
    used: list[str] = []
    blobs: list[str] = []
    if "search" in tools and search_tool:
        q = (query or "").strip()
        if len(q) >= 8:
            if run_id:
                _emit(
                    run_id,
                    {
                        "type": "tool_start",
                        "worker_id": worker_id,
                        "tool": "search",
                        "query": q[:200],
                    },
                )
            try:
                blob = await asyncio.wait_for(search_tool(client, q[:400]), timeout=20.0)
                ok = bool(blob) and "No search results" not in blob
                if ok:
                    used.append("search")
                    blobs.append(blob.strip())
                if run_id:
                    _emit(
                        run_id,
                        {
                            "type": "tool_result",
                            "worker_id": worker_id,
                            "tool": "search",
                            "ok": ok,
                            "preview": _preview(blob or ""),
                        },
                    )
            except Exception as exc:  # noqa: BLE001
                LOG.warning("shared search tool failed: %s", exc)
                if run_id:
                    _emit(
                        run_id,
                        {
                            "type": "tool_result",
                            "worker_id": worker_id,
                            "tool": "search",
                            "ok": False,
                            "error": str(exc),
                        },
                    )
    if "browse" in tools and browse_tool:
        urls = _URL_IN_TEXT_RE.findall(query or "")
        for url in urls[:2]:
            if run_id:
                _emit(
                    run_id,
                    {
                        "type": "tool_start",
                        "worker_id": worker_id,
                        "tool": "browse",
                        "url": url,
                    },
                )
            try:
                blob = await asyncio.wait_for(
                    browse_tool(client, f"{url}|confirm"), timeout=25.0
                )
                ok = bool(blob) and "browse failed" not in blob.lower()
                if ok:
                    used.append("browse")
                    blobs.append(blob.strip())
                if run_id:
                    _emit(
                        run_id,
                        {
                            "type": "tool_result",
                            "worker_id": worker_id,
                            "tool": "browse",
                            "ok": ok,
                            "url": url,
                            "preview": _preview(blob or ""),
                        },
                    )
            except Exception as exc:  # noqa: BLE001
                LOG.warning("shared browse tool failed: %s", exc)
                if run_id:
                    _emit(
                        run_id,
                        {
                            "type": "tool_result",
                            "worker_id": worker_id,
                            "tool": "browse",
                            "ok": False,
                            "url": url,
                            "error": str(exc),
                        },
                    )
    return "\n\n".join(blobs), used


async def _chat_with_optional_mesh(
    *,
    client: Any,
    worker_chat: WorkerChatFn,
    mesh_chat: Optional[MeshChatFn],
    endpoint: Optional[str],
    model: str,
    messages: list[dict[str, Any]],
    **kwargs: Any,
) -> tuple[dict[str, Any], bool]:
    if endpoint and mesh_chat:
        try:
            result = await mesh_chat(
                client, endpoint, model, messages, **kwargs
            )
            return result, True
        except Exception as exc:  # noqa: BLE001
            LOG.warning("mesh chat failed (%s), falling back local: %s", endpoint, exc)
    result = await worker_chat(client, model, messages, **kwargs)
    return result, False


async def _run_child_workers(
    *,
    client: Any,
    worker_chat: WorkerChatFn,
    mesh_chat: Optional[MeshChatFn],
    search_tool: Optional[SearchToolFn],
    browse_tool: Optional[BrowseToolFn] = None,
    parent_run: dict[str, Any],
    parent_worker: dict[str, Any],
    child_specs: list[dict[str, Any]],
    depth: int,
) -> list[dict[str, Any]]:
    """Run nested workers under a parent worker; returns child state list."""
    run_id = str(parent_run["id"])
    children = [_empty_worker_state(s, depth=depth) for s in child_specs]
    parent_worker["children"] = children
    sem = asyncio.Semaphore(min(AGENTS_MAX_NESTED_PER_WORKER, AGENTS_MAX_WORKERS))

    async def _one(i: int) -> None:
        child = children[i]
        spec = child_specs[i]
        if is_cancelled(run_id, parent_worker.get("id")):
            child["status"] = "cancelled"
            child["error"] = "cancelled by user"
            child["output"] = f"[{child['name']} cancelled]"
            child["preview"] = child["output"]
            child["finished_at"] = _utc_now()
            return
        async with sem:
            child["status"] = "running"
            child["started_at"] = _utc_now()
            _persist_run(parent_run)
            _emit(
                run_id,
                {
                    "type": "worker_status",
                    "worker_id": parent_worker.get("id"),
                    "child_id": child["id"],
                    "status": "running",
                    "run": public_run_view(parent_run),
                },
            )
            tools = _effective_tools(spec.get("tools"), parent_run.get("tools"))
            search_blob, used = await _maybe_search_context(
                client=client,
                search_tool=search_tool,
                browse_tool=browse_tool,
                query=spec["prompt"],
                tools=tools,
                run_id=run_id,
                worker_id=child["id"],
            )
            child["tools_used"] = used
            user_content = spec["prompt"]
            if search_blob:
                user_content = (
                    f"Shared tool context:\n{search_blob}\n\n"
                    f"Your task:\n{spec['prompt']}"
                )
            messages = [
                {
                    "role": "system",
                    "content": (
                        f"You are nested Spockify agent '{child['name']}' "
                        f"(depth {depth}). Stay concise."
                    ),
                },
                {"role": "user", "content": user_content},
            ]
            endpoint = _pick_mesh_endpoint(child, i)
            try:
                result, used_mesh = await asyncio.wait_for(
                    _chat_with_optional_mesh(
                        client=client,
                        worker_chat=worker_chat,
                        mesh_chat=mesh_chat,
                        endpoint=endpoint,
                        model=spec["model"],
                        messages=messages,
                        temperature=0.4,
                        max_tokens=AGENTS_MAX_TOKENS,
                    ),
                    timeout=AGENTS_WORKER_TIMEOUT,
                )
                child["mesh"] = used_mesh
                child["endpoint"] = endpoint if used_mesh else None
                try:
                    text = (result["choices"][0]["message"]["content"] or "").strip()
                except (KeyError, IndexError, TypeError):
                    text = ""
                if not text:
                    text = f"[{child['name']} produced no content]"
                child["output"] = text
                child["preview"] = _preview(text)
                child["status"] = "done"
            except asyncio.CancelledError:
                child["status"] = "cancelled"
                child["error"] = "cancelled"
                child["output"] = f"[{child['name']} cancelled]"
                child["preview"] = child["output"]
            except asyncio.TimeoutError:
                child["status"] = "failed"
                child["error"] = f"timeout after {AGENTS_WORKER_TIMEOUT}s"
                child["output"] = f"[{child['name']} timed out]"
                child["preview"] = child["output"]
            except Exception as exc:  # noqa: BLE001
                child["status"] = "failed"
                child["error"] = str(exc)
                child["output"] = f"[{child['name']} failed: {exc}]"
                child["preview"] = _preview(child["output"])
            child["finished_at"] = _utc_now()
            _persist_run(parent_run)
            _emit(
                run_id,
                {
                    "type": "worker_status",
                    "worker_id": parent_worker.get("id"),
                    "child_id": child["id"],
                    "status": child["status"],
                    "run": public_run_view(parent_run),
                },
            )

    await asyncio.gather(*[_one(i) for i in range(len(children))])
    return children


async def _run_one_worker(
    *,
    client: Any,
    worker_chat: WorkerChatFn,
    mesh_chat: Optional[MeshChatFn],
    search_tool: Optional[SearchToolFn],
    browse_tool: Optional[BrowseToolFn] = None,
    run: dict[str, Any],
    index: int,
    sem: asyncio.Semaphore,
) -> None:
    run_id = str(run["id"])
    worker = run["workers"][index]
    spec = run["worker_specs"][index]
    depth = int(run.get("depth") or 0)

    if is_cancelled(run_id, worker.get("id")):
        worker["status"] = "cancelled"
        worker["error"] = "cancelled by user"
        worker["output"] = f"[{worker['name']} cancelled]"
        worker["preview"] = worker["output"]
        worker["finished_at"] = _utc_now()
        _persist_run(run)
        return

    async with sem:
        if is_cancelled(run_id, worker.get("id")):
            worker["status"] = "cancelled"
            worker["error"] = "cancelled by user"
            worker["output"] = f"[{worker['name']} cancelled]"
            worker["preview"] = worker["output"]
            worker["finished_at"] = _utc_now()
            _persist_run(run)
            return

        worker["status"] = "running"
        worker["started_at"] = _utc_now()
        run["updated_at"] = worker["started_at"]
        _persist_run(run)
        _emit(
            run_id,
            {
                "type": "worker_status",
                "worker_id": worker["id"],
                "status": "running",
                "run": public_run_view(run),
            },
        )

        tools = _effective_tools(spec.get("tools"), run.get("tools"))
        search_blob, used = await _maybe_search_context(
            client=client,
            search_tool=search_tool,
            browse_tool=browse_tool,
            query=f"{run.get('parent_prompt', '')}\n{spec['prompt']}",
            tools=tools,
            run_id=run_id,
            worker_id=worker["id"],
        )
        worker["tools_used"] = used

        user_content = spec["prompt"]
        if search_blob:
            user_content = (
                f"Shared tool context:\n{search_blob}\n\n"
                f"Your task:\n{spec['prompt']}"
            )

        nest_hint = ""
        if depth + 1 < AGENTS_MAX_DEPTH:
            nest_hint = (
                f"\nYou may spawn up to {AGENTS_MAX_NESTED_PER_WORKER} child workers "
                'by ending with SPAWN_CHILDREN:[{"name":"...","prompt":"..."}]'
            )

        messages = [
            {
                "role": "system",
                "content": (
                    f"You are Spockify parallel agent '{worker['name']}'. "
                    "Stay in role. Be concise and useful."
                    + nest_hint
                ),
            },
            {"role": "user", "content": user_content},
        ]
        endpoint = _pick_mesh_endpoint(worker, index)
        try:
            result, used_mesh = await asyncio.wait_for(
                _chat_with_optional_mesh(
                    client=client,
                    worker_chat=worker_chat,
                    mesh_chat=mesh_chat,
                    endpoint=endpoint,
                    model=spec["model"],
                    messages=messages,
                    temperature=0.4,
                    max_tokens=AGENTS_MAX_TOKENS,
                ),
                timeout=AGENTS_WORKER_TIMEOUT,
            )
            worker["mesh"] = used_mesh
            worker["endpoint"] = endpoint if used_mesh else None
            try:
                text = (result["choices"][0]["message"]["content"] or "").strip()
            except (KeyError, IndexError, TypeError):
                text = ""
            if not text:
                text = f"[{worker['name']} produced no content]"

            if is_cancelled(run_id, worker.get("id")):
                worker["status"] = "cancelled"
                worker["error"] = "cancelled by user"
                worker["output"] = _strip_spawn_marker(text) or f"[{worker['name']} cancelled]"
                worker["preview"] = _preview(worker["output"])
            else:
                # Nested: explicit children on spec, or SPAWN_CHILDREN marker.
                child_specs = list(spec.get("children") or [])
                if not child_specs and depth + 1 < AGENTS_MAX_DEPTH:
                    child_specs = _parse_spawn_children(text)
                text_clean = _strip_spawn_marker(text)

                if child_specs and depth + 1 < AGENTS_MAX_DEPTH:
                    children = await _run_child_workers(
                        client=client,
                        worker_chat=worker_chat,
                        mesh_chat=mesh_chat,
                        search_tool=search_tool,
                        browse_tool=browse_tool,
                        parent_run=run,
                        parent_worker=worker,
                        child_specs=child_specs[:AGENTS_MAX_NESTED_PER_WORKER],
                        depth=depth + 1,
                    )
                    child_parts = [
                        f"#### {c.get('name')} ({c.get('status')})\n{c.get('output')}"
                        for c in children
                    ]
                    if child_parts:
                        text_clean = (
                            text_clean
                            + "\n\n--- Nested workers ---\n\n"
                            + "\n\n".join(child_parts)
                        )

                worker["output"] = text_clean
                worker["preview"] = _preview(text_clean)
                worker["status"] = "done"
        except asyncio.CancelledError:
            worker["status"] = "cancelled"
            worker["error"] = "cancelled"
            worker["output"] = worker.get("output") or f"[{worker['name']} cancelled]"
            worker["preview"] = _preview(str(worker["output"]))
        except asyncio.TimeoutError:
            worker["status"] = "failed"
            worker["error"] = f"timeout after {AGENTS_WORKER_TIMEOUT}s"
            worker["output"] = f"[{worker['name']} timed out]"
            worker["preview"] = worker["output"]
            LOG.warning("agent worker %s timed out", worker["id"])
        except Exception as exc:  # noqa: BLE001 — surface to run state
            worker["status"] = "failed"
            worker["error"] = str(exc)
            worker["output"] = f"[{worker['name']} failed: {exc}]"
            worker["preview"] = _preview(worker["output"])
            LOG.exception("agent worker %s failed", worker["id"])
        worker["finished_at"] = _utc_now()
        run["updated_at"] = worker["finished_at"]
        _persist_run(run)
        _emit(
            run_id,
            {
                "type": "worker_status",
                "worker_id": worker["id"],
                "status": worker["status"],
                "run": public_run_view(run),
            },
        )


async def _synthesize(
    *,
    client: Any,
    worker_chat: WorkerChatFn,
    run: dict[str, Any],
) -> str:
    model = _resolve_worker_model(run.get("model"))
    parts: list[str] = []
    failed = 0
    cancelled = 0
    for w in run.get("workers") or []:
        status = w.get("status")
        if status == "failed":
            failed += 1
        if status == "cancelled":
            cancelled += 1
        child_note = ""
        kids = w.get("children") or []
        if kids:
            child_note = "\nNested:\n" + "\n".join(
                f"- {c.get('name')} ({c.get('status')}): {_preview(str(c.get('output') or ''), 200)}"
                for c in kids
            )
        parts.append(
            f"### {w.get('name')} ({status})\n{w.get('output') or '(empty)'}{child_note}"
        )
    note = ""
    if failed or cancelled:
        note = (
            f"\nNote: {failed} worker(s) failed, {cancelled} cancelled. "
            "Acknowledge gaps briefly and synthesize from successful outputs.\n"
        )
    messages = [
        {
            "role": "system",
            "content": (
                "You are Spockify's synthesizer. Merge parallel agent outputs into one "
                "coherent, user-facing answer. Prefer clarity over repeating every point. "
                "Do not invent facts the workers did not support."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Original user request:\n{run.get('parent_prompt')}\n\n"
                f"Parallel agent outputs:\n\n" + "\n\n".join(parts) + note
                + "\n\nWrite the final answer for the user."
            ),
        },
    ]
    result = await asyncio.wait_for(
        worker_chat(
            client,
            model,
            messages,
            temperature=0.3,
            max_tokens=AGENTS_MAX_TOKENS * 2,
        ),
        timeout=AGENTS_SYNTH_TIMEOUT,
    )
    try:
        return (result["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError):
        return ""


async def execute_run(
    run: dict[str, Any],
    *,
    client: Any,
    worker_chat: WorkerChatFn,
    mesh_chat: Optional[MeshChatFn] = None,
    search_tool: Optional[SearchToolFn] = None,
    browse_tool: Optional[BrowseToolFn] = None,
) -> dict[str, Any]:
    run_id = str(run["id"])
    run["status"] = "running"
    run["updated_at"] = _utc_now()
    _persist_run(run)
    _emit(run_id, {"type": "run_status", "status": "running", "run": public_run_view(run)})

    try:
        sem = asyncio.Semaphore(AGENTS_MAX_WORKERS)
        await asyncio.gather(
            *[
                _run_one_worker(
                    client=client,
                    worker_chat=worker_chat,
                    mesh_chat=mesh_chat,
                    search_tool=search_tool,
                    browse_tool=browse_tool,
                    run=run,
                    index=i,
                    sem=sem,
                )
                for i in range(len(run["workers"]))
            ]
        )
    except asyncio.CancelledError:
        request_cancel(run_id)
        return run

    if is_cancelled(run_id):
        # request_cancel may already have finalized; ensure terminal.
        current = _load_run(run_id) or run
        if current.get("status") not in _TERMINAL_STATUSES:
            request_cancel(run_id)
        return _load_run(run_id) or run

    any_ok = any(w.get("status") == "done" for w in run["workers"])
    if run.get("synthesize") and any_ok:
        if is_cancelled(run_id):
            request_cancel(run_id)
            return _load_run(run_id) or run
        run["status"] = "synthesizing"
        run["updated_at"] = _utc_now()
        _persist_run(run)
        _emit(
            run_id,
            {
                "type": "run_status",
                "status": "synthesizing",
                "run": public_run_view(run),
            },
        )
        try:
            synthesis = await _synthesize(
                client=client, worker_chat=worker_chat, run=run
            )
            if is_cancelled(run_id):
                request_cancel(run_id)
                return _load_run(run_id) or run
            run["synthesis"] = synthesis or "(synthesis empty)"
        except asyncio.CancelledError:
            request_cancel(run_id)
            return _load_run(run_id) or run
        except Exception as exc:  # noqa: BLE001
            LOG.exception("synthesis failed for %s", run_id)
            chunks = [
                f"### {w.get('name')}\n{w.get('output')}"
                for w in run["workers"]
                if w.get("status") == "done" and w.get("output")
            ]
            run["synthesis"] = "\n\n".join(chunks) or f"[synthesis failed: {exc}]"
            run["error"] = f"synthesis: {exc}"
    elif not any_ok:
        if all(w.get("status") == "cancelled" for w in run["workers"]):
            run["status"] = "cancelled"
            run["error"] = "cancelled by user"
            run["synthesis"] = "Run cancelled before synthesis."
        else:
            run["status"] = "failed"
            run["error"] = "all workers failed"
            run["synthesis"] = "All parallel agents failed; no synthesis available."
        run["finished_at"] = _utc_now()
        run["updated_at"] = run["finished_at"]
        _persist_run(run)
        _emit(
            run_id,
            {
                "type": "run_status",
                "status": run["status"],
                "run": public_run_view(run),
            },
        )
        return run
    else:
        # synthesize=false — concatenate.
        run["synthesis"] = "\n\n".join(
            f"### {w.get('name')}\n{w.get('output')}" for w in run["workers"]
        )

    run["status"] = "done"
    run["finished_at"] = _utc_now()
    run["updated_at"] = run["finished_at"]
    _persist_run(run)
    _emit(run_id, {"type": "run_status", "status": "done", "run": public_run_view(run)})
    return run


async def stream_run_events(run_id: str) -> AsyncIterator[dict[str, Any]]:
    """Yield historical then live events until terminal status."""
    run = _load_run(run_id)
    if not run:
        yield {"type": "error", "error": "run not found", "run_id": run_id}
        return
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _RUN_WAITERS.setdefault(run_id, []).append(q)
    try:
        for ev in list(_RUN_EVENTS.get(run_id, [])):
            yield ev
        while True:
            current = _load_run(run_id)
            if current and current.get("status") in _TERMINAL_STATUSES:
                while True:
                    try:
                        yield q.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                yield {
                    "type": "run_status",
                    "status": current.get("status"),
                    "run": public_run_view(current),
                    "ts": _utc_now(),
                    "run_id": run_id,
                }
                return
            try:
                ev = await asyncio.wait_for(q.get(), timeout=1.0)
                yield ev
            except asyncio.TimeoutError:
                yield {
                    "type": "heartbeat",
                    "status": (current or {}).get("status"),
                    "ts": _utc_now(),
                    "run_id": run_id,
                }
    finally:
        waiters = _RUN_WAITERS.get(run_id, [])
        if q in waiters:
            waiters.remove(q)


def is_agents_model(model: Optional[str]) -> bool:
    name = (model or "").lower()
    return "spockify-agents" in name or name.endswith("/spockify-agents")


def content_sse_delta(text: str, *, model: str = "spockify-agents", finish: bool = False) -> bytes:
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {"content": text} if text else {},
                "finish_reason": "stop" if finish else None,
            }
        ],
    }
    if finish and not text:
        chunk["choices"][0]["delta"] = {}
    return f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n".encode()


def mesh_limits_note() -> str:
    """Document what mesh MVP does / does not do."""
    return (
        "Mesh MVP (Wave 7–8): workers may offload chat completions to peers; "
        "run JSON snapshots sync when AGENTS_MESH_SYNC=1. "
        "No shared SSE / chat identity. Local fallback on peer failure. "
        f"Peers={len(AGENTS_MESH_ENDPOINTS)}; enabled={AGENTS_MESH_ENABLED}; "
        f"sync={AGENTS_MESH_SYNC}."
    )
