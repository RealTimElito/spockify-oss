"""Spockify admin status: Ollama loaded models, ComfyUI, free RAM/GPU."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import AsyncIterator
from typing import Any, Optional

import aiohttp
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field
from open_webui.env import IMAGE_GEN_OLLAMA_URL
from open_webui.utils.auth import get_admin_user, get_verified_user
from open_webui.utils.images.gpu_prep import prepare_gpu_for_image_gen
from open_webui.utils import spockify_cli_device as cli_device

log = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_COMFYUI_URL = 'http://comfyui.spockify.svc.cluster.local:8188'


def _comfyui_url(request: Request) -> str:
    configured = (getattr(request.app.state.config, 'COMFYUI_BASE_URL', None) or '').strip()
    return (configured or DEFAULT_COMFYUI_URL).rstrip('/')


def _ollama_url() -> str:
    return (IMAGE_GEN_OLLAMA_URL or 'http://ollama.spockify.svc.cluster.local:11434').rstrip(
        '/'
    )


def _read_meminfo_bytes() -> dict[str, Any]:
    total: Optional[int] = None
    available: Optional[int] = None
    try:
        with open('/proc/meminfo', encoding='utf-8') as fh:
            for line in fh:
                if line.startswith('MemTotal:'):
                    total = int(line.split()[1]) * 1024
                elif line.startswith('MemAvailable:'):
                    available = int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError) as exc:
        return {'ok': False, 'error': str(exc), 'source': 'proc_meminfo'}
    return {
        'ok': True,
        'source': 'proc_meminfo',
        'note': 'Pod/cgroup view; unified-memory hosts may differ from this reading.',
        'total_bytes': total,
        'available_bytes': available,
        'used_bytes': (total - available) if total is not None and available is not None else None,
        'free_bytes': available,
    }


def _normalize_ollama_ps(payload: dict[str, Any]) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    for item in payload.get('models') or []:
        if not isinstance(item, dict):
            continue
        models.append(
            {
                'name': item.get('name') or item.get('model') or '',
                'size_bytes': item.get('size'),
                'size_vram_bytes': item.get('size_vram'),
                'expires_at': item.get('expires_at'),
                'details': item.get('details') or {},
            }
        )
    return models


async def _probe_ollama(session: aiohttp.ClientSession) -> dict[str, Any]:
    url = _ollama_url()
    try:
        async with session.get(f'{url}/api/ps', timeout=aiohttp.ClientTimeout(total=8)) as resp:
            if resp.status >= 400:
                text = await resp.text()
                return {
                    'ok': False,
                    'up': False,
                    'url': url,
                    'loaded_models': [],
                    'loaded_count': 0,
                    'error': f'HTTP {resp.status}: {text[:200]}',
                }
            payload = await resp.json()
            models = _normalize_ollama_ps(payload)
            return {
                'ok': True,
                'up': True,
                'url': url,
                'loaded_models': models,
                'loaded_count': len(models),
                'total_size_vram_bytes': sum(int(m.get('size_vram_bytes') or 0) for m in models),
            }
    except Exception as exc:
        log.warning('spockify status ollama probe failed: %s', exc)
        return {
            'ok': False,
            'up': False,
            'url': url,
            'loaded_models': [],
            'loaded_count': 0,
            'error': str(exc),
        }


async def _probe_comfyui(session: aiohttp.ClientSession, base_url: str) -> dict[str, Any]:
    try:
        async with session.get(
            f'{base_url}/system_stats', timeout=aiohttp.ClientTimeout(total=8)
        ) as resp:
            if resp.status >= 400:
                async with session.get(
                    f'{base_url}/', timeout=aiohttp.ClientTimeout(total=5)
                ) as ping:
                    up = ping.status < 500
                    return {
                        'ok': up,
                        'up': up,
                        'url': base_url,
                        'status_code': ping.status,
                        'devices': [],
                        'error': None if up else f'HTTP {ping.status}',
                    }
            data = await resp.json()
            devices_out: list[dict[str, Any]] = []
            for device in data.get('devices') or []:
                if not isinstance(device, dict):
                    continue
                devices_out.append(
                    {
                        'name': device.get('name'),
                        'type': device.get('type'),
                        'index': device.get('index'),
                        'vram_total_bytes': device.get('vram_total'),
                        'vram_free_bytes': device.get('vram_free'),
                    }
                )
            return {
                'ok': True,
                'up': True,
                'url': base_url,
                'status_code': resp.status,
                'devices': devices_out,
                'system': data.get('system') or {},
            }
    except Exception as exc:
        log.warning('spockify status comfyui probe failed: %s', exc)
        return {
            'ok': False,
            'up': False,
            'url': base_url,
            'devices': [],
            'error': str(exc),
        }


@router.get('/status')
async def spockify_status(request: Request, user=Depends(get_admin_user)):
    """Admin-only cluster status: Ollama models, ComfyUI, free RAM/GPU."""
    import os

    async with aiohttp.ClientSession() as session:
        ollama = await _probe_ollama(session)
        comfyui = await _probe_comfyui(session, _comfyui_url(request))
        peers = await _probe_federation_peers(session)
        # Prefer router federation payload when reachable (same data source as ops).
        router_url = (
            os.environ.get('SPOCKIFY_ROUTER_URL')
            or 'http://spockify-router.spockify.svc.cluster.local:4100'
        ).rstrip('/')
        remote: dict[str, Any] = {}
        remote_federation: dict[str, Any] = {}
        remote_ops: dict[str, Any] = {}
        try:
            async with session.get(
                f'{router_url}/spockify/status', timeout=aiohttp.ClientTimeout(total=6)
            ) as resp:
                if resp.status < 400:
                    remote = await resp.json()
                    if isinstance(remote, dict):
                        if isinstance(remote.get('federation'), dict):
                            remote_federation = remote['federation']
                            peers = remote_federation.get('peers') or peers
                        if isinstance(remote.get('ops'), dict):
                            remote_ops = remote['ops']
        except Exception as exc:
            log.debug('router federation proxy skipped: %s', exc)
    memory = _read_meminfo_bytes()
    gpu: dict[str, Any] = {
        'source': None,
        'devices': [],
        'note': 'Unified-memory hosts share RAM/VRAM; prefer ComfyUI device stats when up.',
    }
    if comfyui.get('up') and comfyui.get('devices'):
        gpu['source'] = 'comfyui_system_stats'
        gpu['devices'] = comfyui['devices']
    elif ollama.get('up'):
        gpu['source'] = 'ollama_ps_vram'
        gpu['ollama_vram_bytes'] = ollama.get('total_size_vram_bytes', 0)
        gpu['note'] = 'ComfyUI down or no device stats; showing Ollama resident VRAM only.'
    return {
        'ok': True,
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'ollama': ollama,
        'comfyui': comfyui,
        'memory': memory,
        'gpu': gpu,
        'federation': {
            'mode': remote_federation.get('mode')
            if isinstance(remote_federation, dict)
            else 'stub',
            'peers': peers,
            'note': (
                (remote_federation.get('note') if isinstance(remote_federation, dict) else None)
                or (
                    'MVP stub — configure SPOCKIFY_FEDERATION_PEERS or FEDERATION_PEERS on the router. '
                    'No chat mesh yet; see docs/SPOCKIFY_FEDERATION.md.'
                )
            ),
        },
        'ops': remote_ops if isinstance(remote_ops, dict) else None,
        'connectors': remote.get('connectors') if isinstance(remote, dict) else None,
        'skills': remote.get('skills') if isinstance(remote, dict) else None,
        'eval_board': remote.get('eval_board') if isinstance(remote, dict) else None,
        'family_mode': remote.get('family_mode') if isinstance(remote, dict) else None,
        'browser': remote.get('browser') if isinstance(remote, dict) else None,
        'agents': remote.get('agents') if isinstance(remote, dict) else None,
        'wave': remote.get('wave') if isinstance(remote, dict) else None,
    }


async def _probe_federation_peers(session: aiohttp.ClientSession) -> list[dict[str, Any]]:
    import os
    import time

    raw = (
        os.environ.get('SPOCKIFY_FEDERATION_PEERS')
        or os.environ.get('FEDERATION_PEERS')
        or ''
    ).strip()
    peers: list[dict[str, Any]] = []
    for base in [p.strip() for p in raw.split(',') if p.strip()]:
        url = base.rstrip('/')
        entry: dict[str, Any] = {
            'url': url,
            'ok': False,
            'up': False,
            'latency_ms': None,
        }
        for path in ('/health', '/spockify/status', '/'):
            try:
                started = time.perf_counter()
                async with session.get(
                    f'{url}{path}', timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    entry['latency_ms'] = int((time.perf_counter() - started) * 1000)
                    entry['ok'] = resp.status < 500
                    entry['up'] = resp.status < 400
                    entry['status_code'] = resp.status
                    entry['probed_path'] = path
                    break
            except Exception as exc:
                entry['error'] = str(exc)
        peers.append(entry)
    return peers


@router.post('/unload-ollama')
async def unload_ollama_for_gpu(user=Depends(get_admin_user)):
    """Admin-only: unload Ollama models to free GPU memory (same as image-gen prep)."""
    unloaded = await prepare_gpu_for_image_gen(force=True)
    return {
        'ok': True,
        'unloaded': unloaded,
        'message': (
            f'Unloaded {unloaded} Ollama model(s).'
            if unloaded
            else 'No Ollama models were loaded (or unload disabled).'
        ),
        'note': (
            'Does not scale ComfyUI. For host training with ComfyUI down, '
            'run make free-gpu-for-training on the cluster host.'
        ),
    }


@router.get('/usage')
async def spockify_usage(user=Depends(get_admin_user)):
    """Admin-only read-only LiteLLM spend summary (SELECT only; no schema changes)."""
    import os
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    from open_webui.env import DATABASE_URL

    daily: list[dict[str, Any]] = []
    by_model: list[dict[str, Any]] = []
    totals: dict[str, Any] = {
        'spend': 0.0,
        'requests': 0,
        'prompt_tokens': 0,
        'completion_tokens': 0,
        'total_tokens': 0,
    }

    litellm_url = (os.environ.get('LITELLM_DATABASE_URL') or '').strip()
    if not litellm_url and DATABASE_URL:
        # Derive sibling DB name when LiteLLM was isolated to spockify_litellm.
        parsed = urlparse(DATABASE_URL)
        litellm_url = urlunparse(parsed._replace(path='/spockify_litellm'))

    engine = None
    try:
        engine = create_engine(litellm_url or DATABASE_URL, pool_pre_ping=True)
        with engine.connect() as conn:
            daily_rows = conn.execute(
                text(
                    '''
                    SELECT
                      date::text AS day,
                      COALESCE(SUM(spend), 0)::float AS spend,
                      COALESCE(SUM(api_requests), 0)::bigint AS requests,
                      COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
                      COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens
                    FROM "LiteLLM_DailyUserSpend"
                    GROUP BY date
                    ORDER BY date DESC
                    LIMIT 30
                    '''
                )
            ).mappings().all()
            daily = [dict(r) for r in daily_rows]

            model_rows = conn.execute(
                text(
                    '''
                    SELECT
                      COALESCE(model, model_group, 'unknown') AS model,
                      COUNT(*)::bigint AS requests,
                      COALESCE(SUM(spend), 0)::float AS spend,
                      COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
                      COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
                      COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
                    FROM "LiteLLM_SpendLogs"
                    GROUP BY 1
                    ORDER BY spend DESC NULLS LAST
                    LIMIT 40
                    '''
                )
            ).mappings().all()
            by_model = [dict(r) for r in model_rows]

            tot = conn.execute(
                text(
                    '''
                    SELECT
                      COALESCE(SUM(spend), 0)::float AS spend,
                      COUNT(*)::bigint AS requests,
                      COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
                      COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
                      COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
                    FROM "LiteLLM_SpendLogs"
                    '''
                )
            ).mappings().first()
            if tot:
                totals = dict(tot)
    except Exception as exc:
        log.warning('spockify usage query failed: %s', exc)
        return {
            'ok': False,
            'error': str(exc),
            'note': (
                'Read-only SELECT on LiteLLM_* tables failed. '
                'Expected DB spockify_litellm (or LITELLM_DATABASE_URL).'
            ),
            'totals': totals,
            'daily': [],
            'by_model': [],
            'checked_at': datetime.now(timezone.utc).isoformat(),
        }
    finally:
        if engine is not None:
            engine.dispose()

    return {
        'ok': True,
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'totals': totals,
        'daily': daily,
        'by_model': by_model,
        'database': 'spockify_litellm',
        'note': 'Read-only from LiteLLM_SpendLogs / LiteLLM_DailyUserSpend.',
    }


def _router_base() -> str:
    import os

    return (
        os.environ.get('SPOCKIFY_ROUTER_URL')
        or 'http://spockify-router.spockify.svc.cluster.local:4100'
    ).rstrip('/')


@router.get('/memory')
async def spockify_memory(request: Request, user=Depends(get_verified_user)):
    """Wave 6.1 — project summaries + router session digests for Memory browser.

    Scoped to the requesting user (folders by user_id; digests filtered by user_id).
    Optional ``q`` query filters projects/sessions client-side-friendly (case-insensitive).
    """
    from open_webui.models.folders import Folders
    from open_webui.models.chats import Chats

    q = (request.query_params.get('q') or '').strip().lower()

    folders = await Folders.get_folders_by_user_id(user.id)
    projects = []
    for folder in folders or []:
        data = folder.data or {}
        summary = (data.get('project_summary') or '').strip()
        projects.append(
            {
                'id': folder.id,
                'name': folder.name,
                'project_summary': summary,
                'has_summary': bool(summary),
                'updated_at': getattr(folder, 'updated_at', None),
            }
        )

    sessions: list[dict[str, Any]] = []
    router_ok = False
    router_error: Optional[str] = None
    try:
        async with aiohttp.ClientSession() as session:
            params = {}
            if user.role != 'admin':
                params['user_id'] = user.id
            async with session.get(
                f'{_router_base()}/spockify/memory/sessions',
                params=params,
                headers={'X-Spockify-User-Id': str(user.id)},
                timeout=aiohttp.ClientTimeout(total=6),
            ) as resp:
                if resp.status < 400:
                    payload = await resp.json()
                    router_ok = True
                    sessions = payload.get('sessions') or []
                    if user.role != 'admin':
                        sessions = [
                            s
                            for s in sessions
                            if not s.get('user_id') or str(s.get('user_id')) == str(user.id)
                        ]
                else:
                    router_error = f'HTTP {resp.status}'
    except Exception as exc:
        router_error = str(exc)

    # Mark digests whose fingerprint matches the user's most recent chat.
    last_digest_id: Optional[str] = None
    try:
        recent = await Chats.get_chat_list_by_user_id(user.id, include_archived=False, skip=0, limit=1)
        if recent:
            chat_row = recent[0]
            chat_id = getattr(chat_row, 'id', None) or (chat_row.get('id') if isinstance(chat_row, dict) else None)
            full = await Chats.get_chat_by_id_and_user_id(chat_id, user.id) if chat_id else None
            if full:
                history = (full.chat or {}).get('history') or {}
                messages_map = history.get('messages') or {}
                ordered = sorted(
                    messages_map.values(),
                    key=lambda m: m.get('timestamp') or 0,
                )
                bits: list[str] = []
                for msg in ordered[:6]:
                    role = str(msg.get('role') or '')
                    if role not in ('user', 'assistant'):
                        continue
                    content = msg.get('content')
                    if isinstance(content, list):
                        text = ' '.join(
                            str(p.get('text', ''))
                            for p in content
                            if isinstance(p, dict) and p.get('type') == 'text'
                        ).strip()
                    else:
                        text = str(content or '').strip()
                    if text:
                        bits.append(f'{role}:{text[:80]}')
                    if len(bits) >= 3:
                        break
                if bits:
                    import hashlib

                    raw = '|'.join(bits)
                    last_digest_id = hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]
    except Exception as exc:
        log.debug('memory last-chat fingerprint skipped: %s', exc)

    for s in sessions:
        s['used_in_last_chat'] = bool(
            last_digest_id and str(s.get('id') or '') == last_digest_id
        )

    if q:
        projects = [
            p
            for p in projects
            if q in (p.get('name') or '').lower()
            or q in (p.get('project_summary') or '').lower()
        ]
        sessions = [
            s
            for s in sessions
            if q in (s.get('preview') or '').lower()
            or q in (s.get('content') or '').lower()
            or q in str(s.get('id') or '').lower()
        ]

    return {
        'ok': True,
        'projects': projects,
        'sessions': sessions,
        'last_digest_id': last_digest_id,
        'router': {'ok': router_ok, 'error': router_error},
        'note': (
            'Project summaries live on folders. Session digests are router condensations '
            '(ephemeral across router restarts unless persisted on disk).'
        ),
    }


class ProjectSummaryForm(BaseModel):
    project_summary: str = ''


@router.post('/memory/projects/{folder_id}')
async def update_project_summary(
    folder_id: str,
    form_data: ProjectSummaryForm,
    user=Depends(get_verified_user),
):
    """Update or clear a project summary (own folders only)."""
    from open_webui.models.folders import FolderUpdateForm, Folders

    folder = await Folders.get_folder_by_id_and_user_id(folder_id, user.id)
    if not folder:
        raise HTTPException(status_code=404, detail='Project not found')
    data = dict(folder.data or {})
    summary = (form_data.project_summary or '').strip()[:2000]
    data['project_summary'] = summary
    updated = await Folders.update_folder_by_id_and_user_id(
        folder_id,
        user.id,
        FolderUpdateForm(data=data),
    )
    if not updated:
        raise HTTPException(status_code=500, detail='Failed to update project')
    return {
        'ok': True,
        'id': updated.id,
        'name': updated.name,
        'project_summary': (updated.data or {}).get('project_summary') or '',
    }


@router.delete('/memory/sessions/{digest_id}')
async def delete_session_digest(digest_id: str, user=Depends(get_verified_user)):
    """Proxy delete of a router session digest (own digests; admins any)."""
    headers = {'X-Spockify-User-Id': str(user.id)} if user.role != 'admin' else {}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.delete(
                f'{_router_base()}/spockify/memory/sessions/{digest_id}',
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=6),
            ) as resp:
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail='digest not found')
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                return await resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# --- Parallel agent runs (proxy to router) ---


def _user_headers(user) -> dict[str, str]:
    return {'X-Spockify-User-Id': str(user.id)}


def _run_owned_by(run: dict[str, Any], user) -> bool:
    if user.role == 'admin':
        return True
    owner = str(run.get('user_id') or '')
    # Legacy runs without user_id: only admin can see (avoid cross-user leak).
    if not owner:
        return False
    return owner == str(user.id)


async def _fetch_agent_run(run_id: str, user) -> dict[str, Any]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f'{_router_base()}/spockify/agents/runs/{run_id}',
                headers=_user_headers(user) if user.role != 'admin' else {},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail='run not found')
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                run = await resp.json()
                if not _run_owned_by(run, user):
                    raise HTTPException(status_code=404, detail='run not found')
                return run
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get('/agents/runs')
async def list_agent_runs(limit: int = 50, user=Depends(get_verified_user)):
    params: dict[str, Any] = {'limit': limit}
    headers = _user_headers(user)
    if user.role != 'admin':
        params['user_id'] = user.id
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f'{_router_base()}/spockify/agents/runs',
                params=params,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                payload = await resp.json()
                if user.role != 'admin' and isinstance(payload, dict):
                    runs = [
                        r
                        for r in (payload.get('runs') or [])
                        if _run_owned_by(r, user)
                    ]
                    payload = {**payload, 'runs': runs, 'count': len(runs)}
                return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get('/agents/runs/by-message/{message_id}')
async def get_agent_run_by_message(message_id: str, user=Depends(get_verified_user)):
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f'{_router_base()}/spockify/agents/runs/by-message/{message_id}',
                headers=_user_headers(user),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                return await resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get('/agents/runs/{run_id}')
async def get_agent_run(run_id: str, user=Depends(get_verified_user)):
    return await _fetch_agent_run(run_id, user)


class AgentRunCreateForm(BaseModel):
    parent_prompt: str
    model: Optional[str] = None
    workers: Optional[list[dict[str, Any]]] = None
    synthesize: bool = True


@router.post('/agents/runs')
async def create_agent_run(form_data: AgentRunCreateForm, user=Depends(get_verified_user)):
    payload = form_data.model_dump(exclude_none=True)
    payload['user_id'] = user.id
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f'{_router_base()}/spockify/agents/runs',
                json=payload,
                headers=_user_headers(user),
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                return await resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post('/agents/runs/{run_id}/cancel')
async def cancel_agent_run(run_id: str, user=Depends(get_verified_user)):
    await _fetch_agent_run(run_id, user)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f'{_router_base()}/spockify/agents/runs/{run_id}/cancel',
                headers=_user_headers(user),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail='run not found')
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                return await resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post('/agents/runs/{run_id}/workers/{worker_id}/cancel')
async def cancel_agent_worker(run_id: str, worker_id: str, user=Depends(get_verified_user)):
    await _fetch_agent_run(run_id, user)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f'{_router_base()}/spockify/agents/runs/{run_id}/workers/{worker_id}/cancel',
                headers=_user_headers(user),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail='not found')
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                return await resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get('/agents/runs/{run_id}/events')
async def agent_run_events(run_id: str, user=Depends(get_verified_user)):
    """Proxy router SSE for one agent run (IDE Agents panel live feed).

    Disconnect must not cancel the run — ownership check only, then stream.
    """
    await _fetch_agent_run(run_id, user)

    async def event_stream() -> AsyncIterator[bytes]:
        timeout = aiohttp.ClientTimeout(total=None, sock_read=120)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(
                    f'{_router_base()}/spockify/agents/runs/{run_id}/events',
                    headers=_user_headers(user),
                ) as resp:
                    if resp.status == 404:
                        yield b'data: {"type":"error","error":"run not found"}\n\n'
                        yield b'data: [DONE]\n\n'
                        return
                    if resp.status >= 400:
                        text = await resp.text()
                        err = json.dumps(
                            {'type': 'error', 'error': text[:300]},
                            separators=(',', ':'),
                        )
                        yield f'data: {err}\n\n'.encode()
                        yield b'data: [DONE]\n\n'
                        return
                    async for chunk in resp.content.iter_any():
                        if chunk:
                            yield chunk
        except Exception as exc:
            log.warning('agent run events proxy failed (%s): %s', run_id, exc)
            err = json.dumps(
                {'type': 'error', 'error': str(exc)[:300]},
                separators=(',', ':'),
            )
            yield f'data: {err}\n\n'.encode()
            yield b'data: [DONE]\n\n'

    return StreamingResponse(
        event_stream(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Spockify-Agents-Run': run_id,
        },
    )


class BrowserFetchForm(BaseModel):
    url: str
    confirm: bool = False
    action: Optional[str] = None
    selector: Optional[str] = None
    text: Optional[str] = None


@router.post('/browser/fetch')
async def browser_fetch(form_data: BrowserFetchForm, user=Depends(get_verified_user)):
    # Guests: read-only fetch (no Playwright click/type).
    if user.role == 'guest' and (form_data.action or '').strip().lower() not in (
        '',
        'fetch',
        'get',
        'read',
    ):
        raise HTTPException(
            status_code=403,
            detail='Guest role cannot use Playwright click/type actions',
        )
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f'{_router_base()}/spockify/browser/fetch',
                json=form_data.model_dump(exclude_none=True),
                timeout=aiohttp.ClientTimeout(total=45),
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                return await resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class WorkspaceDiffForm(BaseModel):
    filename: str = 'artifact.txt'
    content: str = ''
    old_content: str = ''


@router.post('/workspace/diff')
async def workspace_diff(form_data: WorkspaceDiffForm, user=Depends(get_verified_user)):
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f'{_router_base()}/spockify/workspace/diff',
                json=form_data.model_dump(),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise HTTPException(status_code=502, detail=text[:300])
                return await resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# --- Wave 6.3 voice clone profiles (private per-user on PVC) ---


def _voice_clone_dir(user_id: str) -> Path:
    from open_webui.env import DATA_DIR

    path = Path(DATA_DIR) / 'voice_clones' / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _voice_clone_profile_path(user_id: str) -> Path:
    return _voice_clone_dir(user_id) / 'profile.json'


def _load_voice_clone_profile(user_id: str) -> Optional[dict[str, Any]]:
    path = _voice_clone_profile_path(user_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def _suggest_edge_voice(sample_name: str, size_bytes: int) -> dict[str, str]:
    """Heuristic profile — maps sample cues to edge-tts Neural voice + mild rate/pitch."""
    name = (sample_name or '').lower()
    male_hints = ('male', 'man', 'mattias', 'guy', 'andrew', 'brian', 'dad', 'him')
    is_male = any(h in name for h in male_hints)
    if is_male:
        voice = 'en-US-AndrewMultilingualNeural'
        rate = '-2%'
        pitch = '-2Hz'
    else:
        voice = 'en-US-AvaMultilingualNeural'
        rate = '-3%'
        pitch = '+1Hz'
    # Tiny samples → slightly slower for clarity
    if size_bytes and size_bytes < 80_000:
        rate = '-5%'
    return {'edge_voice': voice, 'rate': rate, 'pitch': pitch}


@router.get('/voice-clone')
async def get_voice_clone(user=Depends(get_verified_user)):
    profile = _load_voice_clone_profile(user.id)
    if not profile:
        return {'ok': True, 'enabled': False, 'profile': None}
    safe = {
        k: profile.get(k)
        for k in (
            'label',
            'sample_name',
            'edge_voice',
            'rate',
            'pitch',
            'enabled',
            'saved_at',
            'bytes',
        )
    }
    return {'ok': True, 'enabled': bool(profile.get('enabled')), 'profile': safe}


@router.post('/voice-clone')
async def upload_voice_clone(
    user=Depends(get_verified_user),
    file: UploadFile = File(...),
    enabled: bool = Form(True),
    edge_voice: str = Form(''),
    rate: str = Form(''),
    pitch: str = Form(''),
    label: str = Form(''),
):
    """Store a private voice sample and build an edge-tts custom profile."""
    raw = await file.read()
    if not raw or len(raw) < 1000:
        raise HTTPException(status_code=400, detail='Sample too short')
    if len(raw) > 8_000_000:
        raise HTTPException(status_code=400, detail='Sample too large (max 8MB)')

    sample_name = (file.filename or 'sample.wav').replace('/', '_')[:120]
    label_clean = (label or sample_name.rsplit('.', 1)[0] or 'custom-voice')[:80]
    suggested = _suggest_edge_voice(sample_name, len(raw))
    voice = (edge_voice or '').strip() or suggested['edge_voice']
    if 'Neural' not in voice:
        voice = suggested['edge_voice']

    clone_dir = _voice_clone_dir(user.id)
    sample_path = clone_dir / 'sample.bin'
    sample_path.write_bytes(raw)

    profile = {
        'label': label_clean,
        'sample_name': sample_name,
        'sample_path': str(sample_path),
        'bytes': len(raw),
        'edge_voice': voice,
        'rate': (rate or '').strip() or suggested['rate'],
        'pitch': (pitch or '').strip() or suggested['pitch'],
        'enabled': bool(enabled),
        'saved_at': datetime.now(timezone.utc).isoformat(),
        'mode': 'edge-matched',
        'note': (
            'Custom voice profile for Call/read-aloud. '
            'Uses Coqui XTTS sidecar when XTTS_ENABLED + sample; else edge-tts Neural match.'
        ),
        'tts_engine': 'auto',
    }
    _voice_clone_profile_path(user.id).write_text(
        json.dumps(profile, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    return {
        'ok': True,
        'enabled': profile['enabled'],
        'profile': {
            k: profile[k]
            for k in (
                'label',
                'sample_name',
                'edge_voice',
                'rate',
                'pitch',
                'enabled',
                'saved_at',
                'bytes',
                'mode',
                'note',
            )
        },
    }


class VoiceCloneUpdateForm(BaseModel):
    enabled: Optional[bool] = None
    edge_voice: Optional[str] = None
    rate: Optional[str] = None
    pitch: Optional[str] = None
    label: Optional[str] = None


@router.patch('/voice-clone')
async def update_voice_clone(form_data: VoiceCloneUpdateForm, user=Depends(get_verified_user)):
    profile = _load_voice_clone_profile(user.id)
    if not profile:
        raise HTTPException(status_code=404, detail='No voice clone profile')
    if form_data.enabled is not None:
        profile['enabled'] = bool(form_data.enabled)
    if form_data.edge_voice and 'Neural' in form_data.edge_voice:
        profile['edge_voice'] = form_data.edge_voice.strip()
    if form_data.rate:
        profile['rate'] = form_data.rate.strip()
    if form_data.pitch:
        profile['pitch'] = form_data.pitch.strip()
    if form_data.label:
        profile['label'] = form_data.label.strip()[:80]
    profile['saved_at'] = datetime.now(timezone.utc).isoformat()
    _voice_clone_profile_path(user.id).write_text(
        json.dumps(profile, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    return {'ok': True, 'enabled': profile.get('enabled'), 'profile': profile}


@router.delete('/voice-clone')
async def delete_voice_clone(user=Depends(get_verified_user)):
    clone_dir = _voice_clone_dir(user.id)
    for path in clone_dir.glob('*'):
        try:
            path.unlink()
        except OSError:
            pass
    return {'ok': True}


# --- Wave 6.4 live share tokens ---


def _live_share_dir() -> Path:
    from open_webui.env import DATA_DIR

    path = Path(DATA_DIR) / 'spockify' / 'live_shares'
    path.mkdir(parents=True, exist_ok=True)
    return path


@router.post('/live/{chat_id}')
async def enable_live_share(
    chat_id: str,
    request: Request,
    user=Depends(get_verified_user),
):
    """Create/rotate a live share token for a chat (read-only viewers).

    Optional JSON body: ``{"ttl_seconds": 3600|86400}`` (1h / 24h). Omit for no expiry.
    """
    import secrets
    import time as _time

    from open_webui.internal.db import get_async_db_context
    from open_webui.models.chats import Chat, Chats

    chat = await Chats.get_chat_by_id_and_user_id(chat_id, user.id)
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')

    ttl_seconds: Optional[int] = None
    try:
        body = await request.json()
        if isinstance(body, dict) and body.get('ttl_seconds') is not None:
            ttl_seconds = int(body['ttl_seconds'])
    except Exception:
        ttl_seconds = None

    if ttl_seconds is not None and ttl_seconds not in (3600, 86400):
        # Allow only the UI presets (1h / 24h) to keep UX simple.
        if ttl_seconds <= 0:
            ttl_seconds = None
        elif ttl_seconds < 3600:
            ttl_seconds = 3600
        else:
            ttl_seconds = 86400

    token = secrets.token_urlsafe(18)
    meta = dict(chat.meta or {})
    old = meta.get('live_share_token')
    if old:
        old_path = _live_share_dir() / f'{old}.json'
        try:
            if old_path.is_file():
                old_path.unlink()
        except OSError:
            pass

    created = datetime.now(timezone.utc)
    expires_at = None
    if ttl_seconds:
        expires_at = (created.timestamp() + ttl_seconds)
        meta['live_share_expires_at'] = expires_at
    else:
        meta.pop('live_share_expires_at', None)

    meta['live_share_token'] = token
    meta['live_share_enabled'] = True

    async with get_async_db_context() as session:
        row = await session.get(Chat, chat_id)
        if not row or row.user_id != user.id:
            raise HTTPException(status_code=404, detail='Chat not found')
        row.meta = meta
        row.updated_at = int(_time.time())
        await session.commit()

    index = {
        'token': token,
        'chat_id': chat_id,
        'user_id': user.id,
        'created_at': created.isoformat(),
    }
    if expires_at is not None:
        index['expires_at'] = datetime.fromtimestamp(
            expires_at, tz=timezone.utc
        ).isoformat()
        index['ttl_seconds'] = ttl_seconds

    (_live_share_dir() / f'{token}.json').write_text(
        json.dumps(index),
        encoding='utf-8',
    )

    return {
        'ok': True,
        'token': token,
        'url_path': f'/live/{token}',
        'chat_id': chat_id,
        'expires_at': index.get('expires_at'),
        'ttl_seconds': ttl_seconds,
    }


@router.delete('/live/{chat_id}')
async def disable_live_share(chat_id: str, user=Depends(get_verified_user)):
    from open_webui.models.chats import Chats

    chat = await Chats.get_chat_by_id_and_user_id(chat_id, user.id)
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')
    meta = dict(chat.meta or {})
    token = meta.pop('live_share_token', None)
    meta['live_share_enabled'] = False
    try:
        from open_webui.internal.db import get_async_db_context
        from open_webui.models.chats import Chat
        import time as _time

        async with get_async_db_context() as session:
            row = await session.get(Chat, chat_id)
            if row and row.user_id == user.id:
                row.meta = meta
                row.updated_at = int(_time.time())
                await session.commit()
    except Exception as exc:
        log.warning('live share disable failed: %s', exc)
    if token:
        path = _live_share_dir() / f'{token}.json'
        try:
            path.unlink(missing_ok=True)
        except TypeError:
            if path.is_file():
                path.unlink()
        except OSError:
            pass
    return {'ok': True}


@router.get('/live/view/{token}')
async def view_live_share(token: str):
    """Read-only live chat payload for invitees (token is the share secret)."""
    from open_webui.models.chats import Chats

    index_path = _live_share_dir() / f'{token}.json'
    if not index_path.is_file():
        raise HTTPException(status_code=404, detail='Live link not found')
    try:
        index = json.loads(index_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        raise HTTPException(status_code=404, detail='Live link not found') from None

    expires_raw = index.get('expires_at')
    if expires_raw:
        try:
            exp = datetime.fromisoformat(str(expires_raw).replace('Z', '+00:00'))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > exp:
                raise HTTPException(status_code=410, detail='Live link expired')
        except HTTPException:
            raise
        except (TypeError, ValueError):
            pass

    chat_id = index.get('chat_id')
    chat = await Chats.get_chat_by_id(chat_id) if chat_id else None
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')
    meta = chat.meta or {}
    if not meta.get('live_share_enabled') or meta.get('live_share_token') != token:
        raise HTTPException(status_code=404, detail='Live link revoked')

    meta_exp = meta.get('live_share_expires_at')
    if meta_exp:
        try:
            if datetime.now(timezone.utc).timestamp() > float(meta_exp):
                raise HTTPException(status_code=410, detail='Live link expired')
        except HTTPException:
            raise
        except (TypeError, ValueError):
            pass

    history = (chat.chat or {}).get('history') or {}
    messages_map = history.get('messages') or {}
    # Flatten in approximate order by timestamp
    messages = []
    for mid, msg in messages_map.items():
        if not isinstance(msg, dict):
            continue
        messages.append(
            {
                'id': msg.get('id') or mid,
                'role': msg.get('role'),
                'content': msg.get('content') or '',
                'timestamp': msg.get('timestamp'),
                'done': msg.get('done', True),
            }
        )
    messages.sort(key=lambda m: (m.get('timestamp') or 0, m.get('id') or ''))

    return {
        'ok': True,
        'chat_id': chat.id,
        'title': (chat.chat or {}).get('title') or 'Live chat',
        'updated_at': chat.updated_at,
        'messages': messages,
        'read_only': True,
    }


# --- Wave 9 helpers / proxies -------------------------------------------------


async def _router_json(
    method: str,
    path: str,
    *,
    json_body: Any = None,
    timeout: float = 30,
    headers: Optional[dict[str, str]] = None,
) -> Any:
    url = f'{_router_base()}{path}'
    try:
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method,
                url,
                json=json_body,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                text = await resp.text()
                if resp.status >= 400:
                    raise HTTPException(
                        status_code=502 if resp.status >= 500 else resp.status,
                        detail=text[:400],
                    )
                if not text:
                    return {'ok': True}
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return {'ok': True, 'raw': text[:500]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _connectors_headers(user) -> dict[str, str]:
    return {'X-Spockify-User-Id': str(user.id)}


@router.get('/connectors')
async def get_connectors(user=Depends(get_verified_user)):
    """Authenticated user: only their own connectors (not admin-wide)."""
    return await _router_json(
        'GET',
        '/spockify/connectors',
        headers=_connectors_headers(user),
    )


class ConnectorsForm(BaseModel):
    connectors: list[dict[str, Any]] = []


@router.put('/connectors')
async def put_connectors(form_data: ConnectorsForm, user=Depends(get_verified_user)):
    """Authenticated user: update only their own connectors."""
    return await _router_json(
        'PUT',
        '/spockify/connectors',
        json_body=form_data.model_dump(),
        headers=_connectors_headers(user),
    )


@router.post('/connectors/migrate-legacy')
async def migrate_legacy_connectors(user=Depends(get_admin_user)):
    """Admin-only: claim legacy global connector files into this admin's folder."""
    return await _router_json(
        'POST',
        '/spockify/connectors/migrate-legacy',
        headers=_connectors_headers(user),
    )


@router.get('/connectors/briefing')
async def get_connectors_briefing(user=Depends(get_verified_user)):
    """Briefing digest for the requesting user only."""
    return await _router_json(
        'GET',
        '/spockify/connectors/briefing',
        headers=_connectors_headers(user),
    )


@router.get('/connectors/calendar/events')
async def get_connectors_calendar_events(
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_verified_user),
):
    """ICS events for the authenticated user's calendar connector only."""
    from urllib.parse import urlencode

    qs = urlencode(
        {
            k: v
            for k, v in {
                'start': start or '',
                'end': end or '',
                'limit': str(limit),
            }.items()
            if v
        }
    )
    path = '/spockify/connectors/calendar/events' + (f'?{qs}' if qs else '')
    return await _router_json(
        'GET',
        path,
        headers=_connectors_headers(user),
        timeout=45,
    )


@router.post('/connectors/{kind}/test')
async def test_connector(kind: str, user=Depends(get_verified_user)):
    """Test calendar / email / Telegram for the current user only."""
    return await _router_json(
        'POST',
        f'/spockify/connectors/{kind}/test',
        headers=_connectors_headers(user),
        timeout=30,
    )


@router.get('/skills')
async def get_skills(user=Depends(get_verified_user)):
    return await _router_json('GET', '/spockify/skills')


class SkillsInjectForm(BaseModel):
    skill_ids: list[str] = []


@router.post('/skills/inject')
async def post_skills_inject(form_data: SkillsInjectForm, user=Depends(get_verified_user)):
    return await _router_json(
        'POST', '/spockify/skills/inject', json_body=form_data.model_dump()
    )


@router.get('/eval/sets')
async def get_eval_sets(user=Depends(get_admin_user)):
    return await _router_json('GET', '/spockify/eval/sets')


@router.post('/eval/sets')
async def post_eval_set(form_data: dict[str, Any], user=Depends(get_admin_user)):
    return await _router_json('POST', '/spockify/eval/sets', json_body=form_data)


@router.delete('/eval/sets/{set_id}')
async def delete_eval_set(set_id: str, user=Depends(get_admin_user)):
    return await _router_json('DELETE', f'/spockify/eval/sets/{set_id}')


@router.post('/eval/run')
async def post_eval_run(form_data: dict[str, Any], user=Depends(get_admin_user)):
    return await _router_json(
        'POST', '/spockify/eval/run', json_body=form_data, timeout=600
    )


@router.get('/eval/runs')
async def get_eval_runs(limit: int = 30, user=Depends(get_admin_user)):
    return await _router_json('GET', f'/spockify/eval/runs?limit={limit}')


@router.get('/eval/runs/{run_id}')
async def get_eval_run(run_id: str, user=Depends(get_admin_user)):
    return await _router_json('GET', f'/spockify/eval/runs/{run_id}')


@router.get('/family')
async def get_family(user=Depends(get_admin_user)):
    return await _router_json('GET', '/spockify/family')


@router.put('/family')
async def put_family(form_data: dict[str, Any], user=Depends(get_admin_user)):
    return await _router_json('PUT', '/spockify/family', json_body=form_data)


# --- W9.5 Notebook → podcast (two-voice edge-tts) ---


class PodcastForm(BaseModel):
    text: str
    title: str = 'Spockify podcast'
    voice_a: str = 'en-US-AvaMultilingualNeural'
    voice_b: str = 'en-US-AndrewMultilingualNeural'
    max_chars: int = 6000


def _split_podcast_script(text: str, max_chars: int = 6000) -> list[tuple[str, str]]:
    """Return list of (speaker, line) alternating A/B from paragraphs."""
    raw = (text or '').strip()[:max_chars]
    if not raw:
        return []
    paras = [p.strip() for p in raw.replace('\r\n', '\n').split('\n') if p.strip()]
    if len(paras) == 1:
        import re

        parts = re.split(r'(?<=[.!?])\s+', paras[0])
        paras = [p for p in parts if p.strip()] or paras
    lines: list[tuple[str, str]] = []
    for i, p in enumerate(paras):
        speaker = 'A' if i % 2 == 0 else 'B'
        lines.append((speaker, p[:800]))
    return lines[:40]


@router.post('/podcast')
async def generate_podcast(form_data: PodcastForm, user=Depends(get_verified_user)):
    """Generate a two-voice MP3 briefing from knowledge/notebook text."""
    import io

    from fastapi.responses import Response

    lines = _split_podcast_script(form_data.text, form_data.max_chars)
    if not lines:
        raise HTTPException(status_code=400, detail='text required')

    try:
        import edge_tts
    except ImportError as exc:
        raise HTTPException(status_code=503, detail='edge-tts not installed') from exc

    intro = (
        f'Welcome to {form_data.title}. '
        'This is a Spockify two-voice briefing generated from your notes.'
    )
    chunks: list[bytes] = []

    async def _synth(voice: str, text: str) -> bytes:
        communicate = edge_tts.Communicate(text, voice)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                buf.write(chunk['data'])
        return buf.getvalue()

    chunks.append(await _synth(form_data.voice_a, intro))
    for speaker, line in lines:
        voice = form_data.voice_a if speaker == 'A' else form_data.voice_b
        prefix = 'Host: ' if speaker == 'A' else 'Analyst: '
        chunks.append(await _synth(voice, prefix + line))

    audio = b''.join(chunks)
    return Response(
        content=audio,
        media_type='audio/mpeg',
        headers={
            'Content-Disposition': (
                f'attachment; filename="spockify-podcast-{user.id[:8]}.mp3"'
            )
        },
    )


# --- W9.6 Chat vault (Fernet at-rest for vault-flagged chats) ---


def _vault_derive_key(passphrase: str, salt: bytes) -> bytes:
    import base64

    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=200_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode('utf-8')))


class VaultLockForm(BaseModel):
    chat_id: str
    passphrase: str
    lock: bool = True


@router.post('/vault/lock')
async def vault_lock_chat(form_data: VaultLockForm, user=Depends(get_verified_user)):
    """Encrypt or decrypt vault-flagged chat content with a user passphrase.

    Threat model: server sees plaintext while unlocked/in-session. Protects
    idle DB dumps and casual access — not a hostile operator.
    """
    import base64
    import os
    import time as _time

    from cryptography.fernet import Fernet, InvalidToken
    from open_webui.internal.db import get_async_db_context
    from open_webui.models.chats import Chat, Chats

    if not (form_data.passphrase or '').strip():
        raise HTTPException(status_code=400, detail='passphrase required')

    chat = await Chats.get_chat_by_id_and_user_id(form_data.chat_id, user.id)
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')

    meta = dict(chat.meta or {})
    chat_blob = dict(chat.chat or {})

    if form_data.lock:
        if meta.get('vault_locked'):
            return {'ok': True, 'locked': True, 'note': 'already locked'}
        salt = os.urandom(16)
        key = _vault_derive_key(form_data.passphrase, salt)
        f = Fernet(key)
        plaintext = json.dumps(chat_blob).encode('utf-8')
        token = f.encrypt(plaintext)
        locked_chat = {
            'title': chat_blob.get('title') or 'Locked chat',
            'history': {'messages': {}, 'currentId': None},
            'vault': True,
        }
        meta['vault'] = True
        meta['vault_locked'] = True
        meta['vault_salt'] = base64.b64encode(salt).decode('ascii')
        meta['vault_ciphertext'] = token.decode('ascii')
        meta['vault_note'] = (
            'Encrypted at rest with Fernet(PBKDF2). '
            'Server sees plaintext while unlocked.'
        )
        async with get_async_db_context() as session:
            row = await session.get(Chat, form_data.chat_id)
            if not row or row.user_id != user.id:
                raise HTTPException(status_code=404, detail='Chat not found')
            row.chat = locked_chat
            row.meta = meta
            row.updated_at = int(_time.time())
            await session.commit()
        return {'ok': True, 'locked': True, 'threat_model': meta['vault_note']}

    if not meta.get('vault_locked'):
        return {'ok': True, 'locked': False, 'note': 'already unlocked'}
    salt_b64 = meta.get('vault_salt') or ''
    cipher = meta.get('vault_ciphertext') or ''
    if not salt_b64 or not cipher:
        raise HTTPException(status_code=400, detail='vault metadata missing')
    try:
        salt = base64.b64decode(salt_b64.encode('ascii'))
        key = _vault_derive_key(form_data.passphrase, salt)
        f = Fernet(key)
        plaintext = f.decrypt(cipher.encode('ascii'))
        restored = json.loads(plaintext.decode('utf-8'))
    except (InvalidToken, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=403, detail='wrong passphrase or corrupt vault'
        ) from exc

    meta['vault_locked'] = False
    meta.pop('vault_ciphertext', None)
    async with get_async_db_context() as session:
        row = await session.get(Chat, form_data.chat_id)
        if not row or row.user_id != user.id:
            raise HTTPException(status_code=404, detail='Chat not found')
        row.chat = restored
        row.meta = meta
        row.updated_at = int(_time.time())
        await session.commit()
    return {
        'ok': True,
        'locked': False,
        'threat_model': (
            'Unlocked in this session — server can read plaintext until you lock again.'
        ),
    }


@router.get('/vault/{chat_id}')
async def vault_status(chat_id: str, user=Depends(get_verified_user)):
    from open_webui.models.chats import Chats

    chat = await Chats.get_chat_by_id_and_user_id(chat_id, user.id)
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')
    meta = chat.meta or {}
    return {
        'ok': True,
        'vault': bool(meta.get('vault')),
        'locked': bool(meta.get('vault_locked')),
        'note': meta.get('vault_note'),
    }


# --- W9.9 XTTS best-effort augment for voice clone ---


@router.post('/voice-clone/xtts-check')
async def xtts_check(user=Depends(get_verified_user)):
    """Probe XTTS sidecar (preferred) or in-process Coqui; document fallback."""
    import os

    import httpx

    enabled = os.environ.get('XTTS_ENABLED', '0').lower() in ('1', 'true', 'yes', 'on')
    xtts_url = (os.environ.get('XTTS_URL') or '').strip().rstrip('/')
    model_path = (os.environ.get('XTTS_MODEL_PATH') or '').strip()
    available = False
    engine = 'edge-tts'
    note = 'XTTS disabled; using edge-tts custom profile (Wave 6/9).'
    sidecar = None
    if enabled and xtts_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f'{xtts_url}/health')
                sidecar = resp.json() if resp.status_code < 400 else {'ok': False}
            if sidecar.get('ok'):
                available = True
                engine = 'xtts'
                note = (
                    f"XTTS sidecar healthy ({xtts_url}); "
                    f"device={sidecar.get('device')}; "
                    'Call/read-aloud uses real clone when profile enabled.'
                )
                if sidecar.get('error'):
                    note += f" load_error={sidecar.get('error')}"
            else:
                note = f'XTTS sidecar unhealthy at {xtts_url}; falling back to edge-tts.'
        except Exception as exc:  # noqa: BLE001
            note = f'XTTS sidecar unreachable ({exc}); falling back to edge-tts.'
    elif enabled:
        try:
            import TTS  # type: ignore  # noqa: F401

            available = True
            engine = 'xtts'
            note = (
                'Coqui TTS importable in-process — prefer XTTS_URL sidecar.'
            )
            if model_path and not Path(model_path).exists():
                note += f' Model path missing: {model_path}'
                available = False
                engine = 'edge-tts'
        except Exception as exc:  # noqa: BLE001
            note = f'XTTS requested but unavailable ({exc}); falling back to edge-tts.'
    profile = _load_voice_clone_profile(user.id) or {}
    if profile:
        profile = dict(profile)
        profile['tts_engine'] = engine if available else 'edge-tts'
        profile['xtts_available'] = available
        profile['xtts_note'] = note
        _voice_clone_profile_path(user.id).write_text(
            json.dumps(profile, indent=2), encoding='utf-8'
        )
    return {
        'ok': True,
        'xtts_enabled_env': enabled,
        'xtts_url': xtts_url or None,
        'available': available,
        'engine': engine if available else 'edge-tts',
        'note': note,
        'model_path': model_path or None,
        'sidecar': sidecar,
    }



# --- Wave 10 proxies + local video brief ---


@router.post('/screen/frames')
async def post_screen_frames(form_data: dict[str, Any], user=Depends(get_verified_user)):
    return await _router_json('POST', '/spockify/screen/frames', json_body=form_data)


@router.get('/screen/sessions')
async def get_screen_sessions(limit: int = 20, user=Depends(get_verified_user)):
    return await _router_json('GET', f'/spockify/screen/sessions?limit={limit}')


@router.post('/agents/runs/{run_id}/fork')
async def post_agent_fork(run_id: str, form_data: dict[str, Any], user=Depends(get_verified_user)):
    await _fetch_agent_run(run_id, user)
    return await _router_json(
        'POST',
        f'/spockify/agents/runs/{run_id}/fork',
        json_body=form_data,
        headers=_user_headers(user),
    )


@router.post('/home/ingest')
async def post_home_ingest(form_data: dict[str, Any], user=Depends(get_verified_user)):
    body = dict(form_data or {})
    body['user_id'] = user.id  # never trust client-supplied user_id
    return await _router_json(
        'POST',
        '/spockify/home/ingest',
        json_body=body,
        headers=_user_headers(user),
    )


@router.get('/home/events')
async def get_home_events(limit: int = 30, user=Depends(get_verified_user)):
    return await _router_json(
        'GET',
        f'/spockify/home/events?limit={limit}',
        headers=_user_headers(user),
    )


@router.post('/ghost/suggest')
async def post_ghost_suggest(form_data: dict[str, Any], user=Depends(get_verified_user)):
    body = dict(form_data or {})
    if not body.get('role'):
        body['role'] = getattr(user, 'role', None) or 'user'
    return await _router_json(
        'POST',
        '/spockify/ghost/suggest',
        json_body=body,
        headers={
            **_user_headers(user),
            'X-Spockify-Role': str(getattr(user, 'role', '') or 'user'),
        },
        timeout=60,
    )


@router.post('/ghost/fate')
async def post_ghost_fate(form_data: dict[str, Any], user=Depends(get_verified_user)):
    """Tab v2 fate telemetry (accepted/rejected/partial/ignored) -> router."""
    return await _router_json(
        'POST',
        '/spockify/ghost/fate',
        json_body=dict(form_data or {}),
        headers=_ghost_headers(user),
        timeout=15,
    )


def _ghost_headers(user) -> dict[str, str]:
    return {
        **_user_headers(user),
        'X-Spockify-Role': str(getattr(user, 'role', '') or 'user'),
    }


@router.get('/ghost/workspace')
async def get_ghost_workspace(user=Depends(get_verified_user)):
    return await _router_json(
        'GET', '/spockify/ghost/workspace', headers=_ghost_headers(user)
    )


@router.get('/ghost/workspace/file')
async def get_ghost_workspace_file(path: str, user=Depends(get_verified_user)):
    from urllib.parse import quote

    return await _router_json(
        'GET',
        f'/spockify/ghost/workspace/file?path={quote(path, safe="")}',
        headers=_ghost_headers(user),
    )


@router.put('/ghost/workspace/file')
async def put_ghost_workspace_file(form_data: dict[str, Any], user=Depends(get_verified_user)):
    return await _router_json(
        'PUT',
        '/spockify/ghost/workspace/file',
        json_body=form_data,
        headers=_ghost_headers(user),
    )


@router.post('/ghost/workspace/mkdir')
async def post_ghost_workspace_mkdir(form_data: dict[str, Any], user=Depends(get_verified_user)):
    return await _router_json(
        'POST',
        '/spockify/ghost/workspace/mkdir',
        json_body=form_data,
        headers=_ghost_headers(user),
    )


@router.post('/ghost/workspace/rename')
async def post_ghost_workspace_rename(form_data: dict[str, Any], user=Depends(get_verified_user)):
    return await _router_json(
        'POST',
        '/spockify/ghost/workspace/rename',
        json_body=form_data,
        headers=_ghost_headers(user),
    )


@router.delete('/ghost/workspace/file')
async def delete_ghost_workspace_file(path: str, user=Depends(get_verified_user)):
    from urllib.parse import quote

    return await _router_json(
        'DELETE',
        f'/spockify/ghost/workspace/file?path={quote(path, safe="")}',
        headers=_ghost_headers(user),
    )


async def _router_bytes(
    method: str,
    path: str,
    *,
    timeout: float = 60,
    headers: Optional[dict[str, str]] = None,
):
    """Proxy binary router responses (downloads), preserving Content-Disposition."""
    from fastapi.responses import Response

    url = f'{_router_base()}{path}'
    try:
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method,
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                body = await resp.read()
                if resp.status >= 400:
                    detail = body[:400].decode('utf-8', errors='replace')
                    raise HTTPException(
                        status_code=502 if resp.status >= 500 else resp.status,
                        detail=detail,
                    )
                out_headers: dict[str, str] = {'Cache-Control': 'no-store'}
                cd = resp.headers.get('Content-Disposition')
                if cd:
                    out_headers['Content-Disposition'] = cd
                media = resp.headers.get('Content-Type') or 'application/octet-stream'
                return Response(content=body, media_type=media, headers=out_headers)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get('/ghost/workspace/download')
async def download_ghost_workspace_file(path: str, user=Depends(get_verified_user)):
    from urllib.parse import quote

    return await _router_bytes(
        'GET',
        f'/spockify/ghost/workspace/download?path={quote(path, safe="")}',
        headers=_ghost_headers(user),
    )


@router.get('/ghost/workspace/download.zip')
async def download_ghost_workspace_zip(user=Depends(get_verified_user)):
    return await _router_bytes(
        'GET',
        '/spockify/ghost/workspace/download.zip',
        headers=_ghost_headers(user),
        timeout=120,
    )


@router.post('/rooms')
async def post_room(form_data: dict[str, Any], user=Depends(get_verified_user)):
    body = dict(form_data or {})
    body['owner_id'] = user.id
    return await _router_json(
        'POST', '/spockify/rooms', json_body=body, headers=_user_headers(user)
    )


@router.get('/rooms')
async def get_rooms(user=Depends(get_verified_user)):
    return await _router_json('GET', '/spockify/rooms', headers=_user_headers(user))


@router.get('/rooms/{room_id}')
async def get_room(room_id: str, request: Request, user=Depends(get_verified_user)):
    headers = _user_headers(user)
    invite = request.headers.get('X-Invite-Token')
    if invite:
        headers['X-Invite-Token'] = invite
    return await _router_json('GET', f'/spockify/rooms/{room_id}', headers=headers)


@router.post('/rooms/{room_id}/join')
async def post_room_join(room_id: str, form_data: dict[str, Any], user=Depends(get_verified_user)):
    body = dict(form_data or {})
    body['user_id'] = user.id
    return await _router_json(
        'POST', f'/spockify/rooms/{room_id}/join', json_body=body, headers=_user_headers(user)
    )


@router.post('/rooms/{room_id}/messages')
async def post_room_message(
    room_id: str,
    form_data: dict[str, Any],
    request: Request,
    user=Depends(get_verified_user),
):
    invite = request.headers.get('X-Invite-Token')
    headers = _user_headers(user)
    if invite:
        headers['X-Invite-Token'] = invite
    body = dict(form_data or {})
    body['author_id'] = user.id
    return await _router_json(
        'POST',
        f'/spockify/rooms/{room_id}/messages',
        json_body=body,
        headers=headers,
    )


@router.post('/dream/run')
async def post_dream_run(form_data: dict[str, Any], user=Depends(get_verified_user)):
    body = dict(form_data or {})
    body['user_id'] = user.id
    return await _router_json(
        'POST', '/spockify/dream/run', json_body=body, headers=_user_headers(user)
    )


@router.get('/dream/runs')
async def get_dream_runs(user=Depends(get_verified_user)):
    return await _router_json('GET', '/spockify/dream/runs', headers=_user_headers(user))


@router.post('/voice-world/notes')
async def post_voice_note(form_data: dict[str, Any], user=Depends(get_verified_user)):
    body = dict(form_data or {})
    body['user_id'] = user.id
    return await _router_json('POST', '/spockify/voice-world/notes', json_body=body)


@router.get('/voice-world/notes')
async def get_voice_notes(user_id: str = '', user=Depends(get_verified_user)):
    # Non-admins can only read their own notes (ignore query spoofing).
    uid = user.id if user.role != 'admin' else (user_id or user.id)
    return await _router_json('GET', f'/spockify/voice-world/notes?user_id={uid}')


@router.post('/voice-world/return')
async def post_voice_return(form_data: dict[str, Any], user=Depends(get_verified_user)):
    body = dict(form_data or {})
    body['user_id'] = user.id
    return await _router_json('POST', '/spockify/voice-world/return', json_body=body)


@router.post('/spectacle/debate')
async def post_spectacle_debate(form_data: dict[str, Any], user=Depends(get_verified_user)):
    body = dict(form_data or {})
    body.setdefault('started_by', user.id)
    return await _router_json(
        'POST', '/spockify/spectacle/debate', json_body=body, timeout=300
    )


@router.post('/spectacle/vote')
async def post_spectacle_vote(form_data: dict[str, Any], user=Depends(get_verified_user)):
    return await _router_json('POST', '/spockify/spectacle/vote', json_body=form_data)


@router.get('/spectacle/debates')
async def get_spectacle_debates(user=Depends(get_verified_user)):
    return await _router_json('GET', '/spockify/spectacle/debates')


class BriefingVideoForm(BaseModel):
    text: str
    title: str = 'Spockify morning brief'
    voice_a: str = 'en-US-AvaMultilingualNeural'
    voice_b: str = 'en-US-AndrewMultilingualNeural'
    max_chars: int = 4000
    max_slides: int = 8


@router.post('/briefing/video')
async def generate_briefing_video(form_data: BriefingVideoForm, user=Depends(get_verified_user)):
    """W10.3 — slide script + two-voice audio package (WebVTT-ish JSON + MP3).

    Returns application/zip with slides.json + briefing.mp3 for client mux,
    or audio/mpeg fallback. Honest MVP: downloadable audio+slides bundle.
    """
    import io
    import zipfile

    from fastapi.responses import Response

    lines = _split_podcast_script(form_data.text, form_data.max_chars)
    if not lines:
        raise HTTPException(status_code=400, detail='text required')

    try:
        import edge_tts
    except ImportError as exc:
        raise HTTPException(status_code=503, detail='edge-tts not installed') from exc

    slides = []
    for i, (speaker, line) in enumerate(lines[: form_data.max_slides]):
        slides.append(
            {
                'index': i,
                'speaker': speaker,
                'title': f'Slide {i + 1}',
                'text': line[:400],
                'broll_note': 'Flux B-roll optional when ComfyUI free',
            }
        )

    async def _synth(voice: str, text: str) -> bytes:
        communicate = edge_tts.Communicate(text, voice)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                buf.write(chunk['data'])
        return buf.getvalue()

    chunks: list[bytes] = [
        await _synth(
            form_data.voice_a,
            f'Good morning. This is {form_data.title}, your Spockify world model brief.',
        )
    ]
    for speaker, line in lines[: form_data.max_slides]:
        voice = form_data.voice_a if speaker == 'A' else form_data.voice_b
        chunks.append(await _synth(voice, line))
    audio = b''.join(chunks)

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            'slides.json',
            json.dumps(
                {
                    'title': form_data.title,
                    'slides': slides,
                    'format': 'spockify-world-brief-v1',
                    'note': 'Mux slides + briefing.mp3 in client for video; Flux B-roll stub.',
                },
                indent=2,
            ),
        )
        zf.writestr('briefing.mp3', audio)
        zf.writestr(
            'README.txt',
            'Spockify Wave 10.3 world model brief.\n'
            'Play briefing.mp3 while advancing slides.json titles.\n'
            'Optional: generate Flux B-roll per slide when GPU free.\n',
        )
    return Response(
        content=zip_buf.getvalue(),
        media_type='application/zip',
        headers={
            'Content-Disposition': (
                f'attachment; filename="spockify-brief-{user.id[:8]}.zip"'
            )
        },
    )


# ---------------------------------------------------------------------------
# IDE settings sync (Phase 6) — additive; never stores API keys / secrets.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# IDE AppImage / .deb auto-update metadata (Phase 7 packaging feed)
# ---------------------------------------------------------------------------
#
# Version rule (MUST match extensions/spockify client updater):
# - `spockifyIdeVersion` / `appImageVersion` / `version` = extension package.json
#   version (e.g. 0.6.21). That is the ONLY axis the client compares.
# - `productVersion` = code-oss / in-app product.json version (1.129.x); display only,
#   not compared, and NOT used in download filenames.
# - Public artifact names / downloadUrl / debDownloadUrl use spockifyIdeVersion:
#     Spockify-IDE-{spockifyIdeVersion}-x86_64.AppImage
#     Spockify-IDE_{spockifyIdeVersion}_amd64.deb
#     Spockify-IDE-{spockifyIdeVersion}-darwin-{x64|arm64}.zip
#     Spockify-IDE-{spockifyIdeVersion}-win32-{x64|arm64}.zip
# - When shipping a new AppImage/.deb: bump extension version, rebuild, update SHAs here.
# - Additive `deb*` / `darwin` / `win32` fields are for marketing + multi-OS clients;
#   Linux AppImage clients ignore unknown keys.
#
_IDE_APPIMAGE_SPOCKIFY_VERSION = '0.9.15'
_IDE_APPIMAGE_PRODUCT_VERSION = '1.129.1'
# 2026-07-23: extension 0.8.7 — map router worker status→state so Agents UI
# leaves queued; kick poll from tool create; completion toast + chat summary;
# shell/ping prompts run local terminal_run workers; hide raw create_agent_run JSON.
_IDE_APPIMAGE_LATEST_SHA256_X86_64 = (
    'b7bc783beb0378864d8eb5ba17cc1f6fa48bd6f5617e27c8ecfdf5d79f799434'
)
# Debian package (amd64) — same product tree as the x86_64 AppImage.
_IDE_DEB_LATEST_SHA256_AMD64 = (
    'ea6dc8b47bc238a19018caa61843341078c8201e0545cb04f367774e430d87f4'
)
# Published arches only — aarch64 returns 404 until an artifact is hosted.
_IDE_APPIMAGE_PUBLISHED = {
    'x86_64': _IDE_APPIMAGE_LATEST_SHA256_X86_64,
}
_IDE_DEB_PUBLISHED = {
    'x86_64': _IDE_DEB_LATEST_SHA256_AMD64,
}
# Optional macOS / Windows zip SHAs (unsigned until signing lands).
# Keys: x64 | arm64. Empty maps omit darwin/win32 from latest.json.
# Consts (_IDE_DARWIN_LATEST_SHA256_*, _IDE_WIN32_LATEST_SHA256_*) are inserted
# by bump-spockify-ide-version.sh --sha256-darwin-* / --sha256-win32-*.
_IDE_DARWIN_PUBLISHED: dict[str, str] = {}
_IDE_WIN32_PUBLISHED: dict[str, str] = {}


def _ide_appimage_download_url(spockify_version: str, arch: str) -> str:
    # Extension uses `downloadUrl` for direct AppImage fetch (secondary CTA).
    # Primary update CTA opens `releaseNotesUrl` (releases page: AppImage + .deb).
    # Artifact naming matches apps/spockify-ide/scripts/build-appimage.sh
    # (Spockify extension version, not code-oss productVersion).
    # Served from static nginx at /downloads/ (also aliased at site root).
    name = f'Spockify-IDE-{spockify_version}-{arch}.AppImage'
    return f'https://spockify.eu/downloads/{name}'


_IDE_RELEASE_NOTES_URL = 'https://spockify.eu/ide/releases.html'


def _ide_deb_arch(arch: str) -> str:
    return {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(arch, arch)


def _ide_deb_download_url(spockify_version: str, arch: str) -> str:
    # Artifact naming matches apps/spockify-ide/scripts/build-deb.sh.
    deb_arch = _ide_deb_arch(arch)
    name = f'Spockify-IDE_{spockify_version}_{deb_arch}.deb'
    return f'https://spockify.eu/downloads/{name}'


def _ide_zip_download_url(
    spockify_version: str, platform: str, arch: str
) -> str:
    # Artifact naming matches package-darwin.sh / package-win32.sh.
    name = f'Spockify-IDE-{spockify_version}-{platform}-{arch}.zip'
    return f'https://spockify.eu/downloads/{name}'


def _ide_desktop_zip_payload(
    platform: str, published: dict[str, str]
) -> dict[str, Any] | None:
    """Build additive darwin/win32 map for latest.json (None if empty)."""
    if not published:
        return None
    out: dict[str, Any] = {}
    for zip_arch, sha in published.items():
        if not sha:
            continue
        out[zip_arch] = {
            'downloadUrl': _ide_zip_download_url(
                _IDE_APPIMAGE_SPOCKIFY_VERSION, platform, zip_arch
            ),
            'sha256': sha,
            'arch': zip_arch,
            'signed': False,
            'label': 'unsigned zip',
        }
    return out or None


@router.get('/ide/appimage/latest.json')
async def ide_appimage_latest(arch: str) -> dict[str, Any]:
    """Return AppImage (+ optional .deb / desktop zips) updater metadata."""
    arch = (arch or '').strip()
    if arch not in ('x86_64', 'aarch64'):
        raise HTTPException(status_code=400, detail='arch must be x86_64 or aarch64')
    sha = _IDE_APPIMAGE_PUBLISHED.get(arch)
    if not sha:
        raise HTTPException(
            status_code=404,
            detail=f'No AppImage published for arch={arch}',
        )
    payload: dict[str, Any] = {
        'spockifyIdeVersion': _IDE_APPIMAGE_SPOCKIFY_VERSION,
        'appImageVersion': _IDE_APPIMAGE_SPOCKIFY_VERSION,
        'version': _IDE_APPIMAGE_SPOCKIFY_VERSION,
        'productVersion': _IDE_APPIMAGE_PRODUCT_VERSION,
        'downloadUrl': _ide_appimage_download_url(
            _IDE_APPIMAGE_SPOCKIFY_VERSION, arch
        ),
        'releaseNotesUrl': _IDE_RELEASE_NOTES_URL,
        'sha256': sha,
        'arch': arch,
    }
    # Additive fields — existing AppImage clients ignore unknown keys.
    deb_sha = _IDE_DEB_PUBLISHED.get(arch)
    if deb_sha:
        payload['debDownloadUrl'] = _ide_deb_download_url(
            _IDE_APPIMAGE_SPOCKIFY_VERSION, arch
        )
        payload['debSha256'] = deb_sha
        payload['debVersion'] = _IDE_APPIMAGE_SPOCKIFY_VERSION
        payload['debArch'] = _ide_deb_arch(arch)
    darwin = _ide_desktop_zip_payload('darwin', _IDE_DARWIN_PUBLISHED)
    if darwin:
        payload['darwin'] = darwin
    win32 = _ide_desktop_zip_payload('win32', _IDE_WIN32_PUBLISHED)
    if win32:
        payload['win32'] = win32
    return payload

class IdeSyncBody(BaseModel):
    payload: dict[str, Any]


def _ide_sync_dir() -> Path:
    from open_webui.env import DATA_DIR

    d = Path(DATA_DIR) / 'spockify_ide_sync'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ide_sync_path(user_id: str) -> Path:
    safe = ''.join(c if c.isalnum() or c in '-_' else '_' for c in str(user_id))[:128]
    return _ide_sync_dir() / f'{safe}.json'


def _ide_sync_etag(raw: bytes) -> str:
    import hashlib

    return '"' + hashlib.sha256(raw).hexdigest()[:32] + '"'


@router.get('/ide/sync')
async def ide_sync_get(
    request: Request,
    user=Depends(get_verified_user),
):
    """Pull IDE prefs/rules/memories blob (no secrets). Supports If-None-Match."""
    path = _ide_sync_path(user.id)
    if not path.is_file():
        return {'etag': None, 'payload': None}
    raw = path.read_bytes()
    etag = _ide_sync_etag(raw)
    inm = (request.headers.get('if-none-match') or '').strip()
    if inm and inm == etag:
        raise HTTPException(status_code=304, detail='Not Modified')
    try:
        payload = json.loads(raw.decode('utf-8'))
    except Exception:
        payload = None
    # Strip any accidental secret-like keys
    if isinstance(payload, dict):
        for bad in ('apiKey', 'api_key', 'token', 'password', 'secret'):
            payload.pop(bad, None)
            settings = payload.get('settings')
            if isinstance(settings, dict):
                settings.pop(bad, None)
    return {'etag': etag, 'payload': payload}


@router.put('/ide/sync')
async def ide_sync_put(
    request: Request,
    form_data: IdeSyncBody,
    user=Depends(get_verified_user),
):
    """Push IDE prefs blob. Rejects payloads that look like they contain secrets."""
    payload = dict(form_data.payload or {})
    for bad in ('apiKey', 'api_key', 'token', 'password', 'secret'):
        payload.pop(bad, None)
        settings = payload.get('settings')
        if isinstance(settings, dict):
            settings.pop(bad, None)
    blob = json.dumps(payload).lower()
    if 'sk-' in blob or 'bearer ' in blob:
        raise HTTPException(
            status_code=400,
            detail='Secrets must not be included in IDE sync payloads',
        )
    payload.setdefault('version', 1)
    payload['updatedAt'] = datetime.now(timezone.utc).isoformat()
    raw = json.dumps(payload, indent=2).encode('utf-8')
    if_match = (request.headers.get('if-match') or '').strip()
    path = _ide_sync_path(user.id)
    if if_match and path.is_file():
        current = _ide_sync_etag(path.read_bytes())
        if if_match != current:
            raise HTTPException(status_code=412, detail='ETag mismatch')
    path.write_bytes(raw)
    return {'ok': True, 'etag': _ide_sync_etag(raw)}


# ---------------------------------------------------------------------------
# IDE remote index metadata (Phase 6 / WS-P6-I) — additive; metadata only.
# Does NOT store chunk text, embeddings, or secrets. Local hybrid remains
# source of truth; this lets machines share fingerprint / status.
# ---------------------------------------------------------------------------

class IdeIndexBody(BaseModel):
    workspace_key: str
    payload: dict[str, Any]


def _ide_index_dir() -> Path:
    from open_webui.env import DATA_DIR

    d = Path(DATA_DIR) / 'spockify_ide_index'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ide_index_safe(s: str) -> str:
    return ''.join(c if c.isalnum() or c in '-_' else '_' for c in str(s))[:128]


def _ide_index_path(user_id: str, workspace_key: str) -> Path:
    return _ide_index_dir() / f'{_ide_index_safe(user_id)}__{_ide_index_safe(workspace_key)}.json'


def _ide_index_etag(raw: bytes) -> str:
    import hashlib

    return '"' + hashlib.sha256(raw).hexdigest()[:32] + '"'


_IDE_INDEX_MAX_BYTES = 64_000


@router.get('/ide/index')
async def ide_index_get(
    request: Request,
    workspace_key: str,
    user=Depends(get_verified_user),
):
    """Pull index metadata for a workspace fingerprint (no vectors/text)."""
    if not workspace_key or not workspace_key.strip():
        raise HTTPException(status_code=400, detail='workspace_key required')
    path = _ide_index_path(user.id, workspace_key.strip())
    if not path.is_file():
        return {'etag': None, 'payload': None, 'workspace_key': workspace_key.strip()}
    raw = path.read_bytes()
    etag = _ide_index_etag(raw)
    inm = (request.headers.get('if-none-match') or '').strip()
    if inm and inm == etag:
        raise HTTPException(status_code=304, detail='Not Modified')
    try:
        payload = json.loads(raw.decode('utf-8'))
    except Exception:
        payload = None
    return {
        'etag': etag,
        'payload': payload,
        'workspace_key': workspace_key.strip(),
    }


@router.put('/ide/index')
async def ide_index_put(
    request: Request,
    form_data: IdeIndexBody,
    user=Depends(get_verified_user),
):
    """Push index metadata. Rejects oversized / secret-like / vector payloads."""
    workspace_key = (form_data.workspace_key or '').strip()
    if not workspace_key:
        raise HTTPException(status_code=400, detail='workspace_key required')
    payload = dict(form_data.payload or {})
    # Hard reject accidental full-index dumps (before stripping)
    if any(k in payload for k in ('chunks', 'vectors', 'df')):
        raise HTTPException(
            status_code=400,
            detail='Full index dumps are not accepted — metadata only',
        )
    for bad in ('apiKey', 'api_key', 'token', 'password', 'secret'):
        payload.pop(bad, None)
    blob_lower = json.dumps(payload).lower()
    if 'sk-' in blob_lower or 'bearer ' in blob_lower:
        raise HTTPException(
            status_code=400,
            detail='Secrets must not be included in IDE index payloads',
        )
    payload.setdefault('version', 1)
    payload['workspaceKey'] = workspace_key
    payload['updatedAt'] = datetime.now(timezone.utc).isoformat()
    raw = json.dumps(payload, indent=2).encode('utf-8')
    if len(raw) > _IDE_INDEX_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f'Index metadata exceeds {_IDE_INDEX_MAX_BYTES} bytes',
        )
    if_match = (request.headers.get('if-match') or '').strip()
    path = _ide_index_path(user.id, workspace_key)
    if if_match and path.is_file():
        current = _ide_index_etag(path.read_bytes())
        if if_match != current:
            raise HTTPException(status_code=412, detail='ETag mismatch')
    path.write_bytes(raw)
    return {
        'ok': True,
        'etag': _ide_index_etag(raw),
        'workspace_key': workspace_key,
    }


# --- Spockify CLI device login (link + code) ---------------------------------


def _public_base(request: Request) -> str:
    proto = (
        request.headers.get('x-forwarded-proto')
        or request.url.scheme
        or 'https'
    ).split(',')[0].strip()
    host = (
        request.headers.get('x-forwarded-host')
        or request.headers.get('host')
        or 'spockify.eu'
    ).split(',')[0].strip()
    # Edge terminates TLS at the edge; inner hops may report http — force https for public host.
    if host.endswith('spockify.eu') and proto == 'http':
        proto = 'https'
    return f'{proto}://{host}'


class CliDeviceApproveForm(BaseModel):
    user_code: str = Field(..., min_length=4, max_length=16)


class CliDeviceTokenForm(BaseModel):
    device_code: str = Field(..., min_length=8)
    grant_type: str = 'urn:ietf:params:oauth:grant-type:device_code'


@router.post('/cli/device/code')
async def cli_device_code(request: Request):
    """Start CLI device login — no auth required."""
    return await cli_device.create_device_session(
        getattr(request.app.state, 'redis', None),
        public_base=_public_base(request),
    )


@router.get('/cli/activate', response_class=HTMLResponse)
async def cli_activate_page():
    """Browser page: enter user_code and approve while signed in."""
    return HTMLResponse(cli_device.ACTIVATE_HTML)


@router.post('/cli/device/approve')
async def cli_device_approve(
    request: Request,
    form_data: CliDeviceApproveForm,
    user=Depends(get_verified_user),
):
    try:
        return await cli_device.approve_device(
            getattr(request.app.state, 'redis', None),
            user_code=form_data.user_code,
            user_id=str(user.id),
            user_email=getattr(user, 'email', '') or '',
            user_name=getattr(user, 'name', '') or '',
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post('/cli/device/deny')
async def cli_device_deny(
    request: Request,
    form_data: CliDeviceApproveForm,
    user=Depends(get_verified_user),
):
    try:
        return await cli_device.deny_device(
            getattr(request.app.state, 'redis', None),
            form_data.user_code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/cli/device/token')
async def cli_device_token(request: Request, form_data: CliDeviceTokenForm):
    """Poll until approved; returns LiteLLM virtual key as access_token."""
    result = await cli_device.poll_token(
        getattr(request.app.state, 'redis', None),
        form_data.device_code,
    )
    if result.get('error') == 'authorization_pending':
        # 400 with error body — CLI treats as keep polling
        raise HTTPException(status_code=400, detail=result)
    if result.get('error'):
        raise HTTPException(status_code=400, detail=result)
    return result
