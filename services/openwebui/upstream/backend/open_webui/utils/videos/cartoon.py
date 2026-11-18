"""Cartoon pipeline client: router POST /v1/cartoon (sprite → slice → FLF)."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import Any, Callable, Optional

from open_webui.env import (
    AIOHTTP_CLIENT_SESSION_SSL,
    COMFYUI_VIDEO_API_KEY,
    VIDEO_GEN_TIMEOUT_SECONDS,
)
from open_webui.utils.images.comfyui import ComfyUIUnavailableError
from open_webui.utils.session_pool import get_session

log = logging.getLogger(__name__)

_SPOCKIFY_ROUTER_URL = (
    os.environ.get('SPOCKIFY_ROUTER_URL')
    or 'http://spockify-router.spockify.svc.cluster.local:4100'
).rstrip('/')


def cartoon_configured() -> bool:
    return bool(_SPOCKIFY_ROUTER_URL)


def _router_headers() -> dict[str, str]:
    api_key = (
        (os.environ.get('OPENAI_API_KEY') or '').strip()
        or (COMFYUI_VIDEO_API_KEY or '').strip()
    )
    if not api_key:
        raise ComfyUIUnavailableError(
            'Cartoon path needs OPENAI_API_KEY (LiteLLM master/virtual key)'
        )
    return {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }


async def plan_cartoon_scene_via_router(
    *,
    brief: str,
    shot_count: Any = 3,
    profile: str = 'draft',
    character_class: str = 'cel_human',
    owner: str = 'chat',
) -> dict[str, Any]:
    """CPU scene plan. Failure must not block the legacy sprite path."""
    try:
        count = int(shot_count)
    except (TypeError, ValueError):
        count = 3
    headers = _router_headers()
    headers['X-Cartoon-Owner'] = owner
    session = await get_session()
    async with session.post(
        f'{_SPOCKIFY_ROUTER_URL}/v1/cartoon/projects',
        json={'title': 'Chat scene', 'retention': 'research'},
        headers=headers,
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as resp:
        text = await resp.text()
        if resp.status >= 400:
            raise ComfyUIUnavailableError(f'Scene project failed ({resp.status})')
        project = json.loads(text)
    key = f'chat:{owner}:{count}:{profile}:{character_class}:{brief}'[:180]
    async with session.get(
        f'{_SPOCKIFY_ROUTER_URL}/v1/cartoon/scenes/lookup',
        params={'idempotency_key': key},
        headers=headers,
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as existing:
        if existing.status == 200:
            return json.loads(await existing.text())
        if existing.status not in (404,):
            detail = (await existing.text())[:240]
            raise ComfyUIUnavailableError(f'Scene lookup failed ({existing.status}): {detail}')
    async with session.post(
        f"{_SPOCKIFY_ROUTER_URL}/v1/cartoon/projects/{project['id']}/scenes",
        json={
            'brief': brief,
            'shot_count': count,
            'profile': profile,
            'character_class': character_class,
            'idempotency_key': key,
        },
        headers=headers,
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as resp:
        text = await resp.text()
        if resp.status >= 400:
            raise ComfyUIUnavailableError(f'Scene plan failed ({resp.status})')
        return json.loads(text)


async def render_cartoon_scene_via_router(
    *,
    scene_id: str,
    owner: str = 'chat',
    seconds: float = 2,
    run_edit: bool = False,
    dialogue: str | None = None,
    lip_sync: bool = True,
    on_progress: Optional[Callable] = None,
) -> dict[str, Any]:
    """POST /v1/cartoon/scenes/{id}/render and poll returned video ids."""
    headers = _router_headers()
    headers['X-Cartoon-Owner'] = owner
    session = await get_session()
    if on_progress:
        try:
            await on_progress('Dispatching director render…')
        except Exception:
            pass
    body: dict[str, Any] = {
        'seconds': seconds,
        'run_edit': bool(run_edit),
        'lip_sync': bool(lip_sync),
    }
    if dialogue:
        body['dialogue'] = dialogue
    async with session.post(
        f'{_SPOCKIFY_ROUTER_URL}/v1/cartoon/scenes/{scene_id}/render',
        json=body,
        headers=headers,
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as resp:
        text = await resp.text()
        if resp.status >= 400:
            raise ComfyUIUnavailableError(
                f'Director render rejected ({resp.status}): {text[:400]}'
            )
        meta = json.loads(text)

    videos_meta = [
        {'id': row.get('video_id')}
        for row in (meta.get('dispatched') or [])
        if row.get('video_id')
    ]
    clips: list[dict[str, Any]] = []
    deadline = asyncio.get_event_loop().time() + float(VIDEO_GEN_TIMEOUT_SECONDS)
    for job in videos_meta:
        video_id = job.get('id')
        if not video_id:
            continue
        if on_progress:
            try:
                await on_progress(f'Animating FLF clip {video_id}…')
            except Exception:
                pass
        while asyncio.get_event_loop().time() < deadline:
            async with session.get(
                f'{_SPOCKIFY_ROUTER_URL}/v1/videos/{video_id}',
                headers=headers,
                ssl=AIOHTTP_CLIENT_SESSION_SSL,
            ) as poll:
                poll_text = await poll.text()
                if poll.status >= 400:
                    raise ComfyUIUnavailableError(
                        f'Video poll failed ({poll.status}): {poll_text[:300]}'
                    )
                status_body = json.loads(poll_text)
            status = (status_body.get('status') or '').lower()
            if status == 'completed':
                break
            if status in {'failed', 'cancelled'}:
                err = status_body.get('error') or {}
                message = err.get('message') if isinstance(err, dict) else str(err)
                raise ComfyUIUnavailableError(message or f'FLF {status}')
            await asyncio.sleep(2.0)
        else:
            raise ComfyUIUnavailableError('Cartoon FLF timed out')

        async with session.get(
            f'{_SPOCKIFY_ROUTER_URL}/v1/videos/{video_id}/content',
            headers=headers,
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
        ) as content:
            if content.status >= 400:
                raise ComfyUIUnavailableError(
                    f'Video content failed ({content.status})'
                )
            mp4 = await content.read()
        clips.append({'id': video_id, 'bytes': mp4, 'mime': 'video/mp4'})

    return {
        'id': meta.get('run_id') or meta.get('scene_id'),
        'grid': None,
        'grid_image': None,
        'keyframes': [],
        'clips': clips,
        'video_edit': None,
        'raw': meta,
        'director': True,
    }


async def run_cartoon_via_router(
    *,
    prompt: str,
    grid: str = '2x2',
    pair_mode: str = 'first_last',
    style: str | None = None,
    seconds: float = 2,
    video_size: str = '1280x720',
    on_progress: Optional[Callable] = None,
) -> dict[str, Any]:
    """POST /v1/cartoon, poll FLF jobs, return grid/keyframes/mp4 bytes."""
    api_key = (
        (os.environ.get('OPENAI_API_KEY') or '').strip()
        or (COMFYUI_VIDEO_API_KEY or '').strip()
    )
    if not api_key:
        raise ComfyUIUnavailableError(
            'Cartoon path needs OPENAI_API_KEY (LiteLLM master/virtual key)'
        )
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    body: dict[str, Any] = {
        'prompt': prompt,
        'grid': grid,
        'pair_mode': pair_mode,
        'seconds': seconds,
        'video_size': video_size,
        'include_tiles': True,
        'include_grid': True,
        'run_edit': False,
    }
    if style:
        body['style'] = style

    session = await get_session()
    if on_progress:
        try:
            await on_progress('Generating Qwen sprite grid…')
        except Exception:
            pass
    async with session.post(
        f'{_SPOCKIFY_ROUTER_URL}/v1/cartoon',
        json=body,
        headers=headers,
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as resp:
        text = await resp.text()
        if resp.status >= 400:
            raise ComfyUIUnavailableError(
                f'Cartoon API rejected request ({resp.status}): {text[:400]}'
            )
        try:
            meta = json.loads(text)
        except Exception as exc:
            raise ComfyUIUnavailableError(
                'Cartoon API returned non-JSON response'
            ) from exc

    videos_meta = meta.get('videos') or []
    clips: list[dict[str, Any]] = []
    deadline = asyncio.get_event_loop().time() + float(VIDEO_GEN_TIMEOUT_SECONDS)
    for job in videos_meta:
        video_id = job.get('id')
        if not video_id:
            continue
        if on_progress:
            try:
                await on_progress(f'Animating FLF clip {video_id}…')
            except Exception:
                pass
        while asyncio.get_event_loop().time() < deadline:
            async with session.get(
                f'{_SPOCKIFY_ROUTER_URL}/v1/videos/{video_id}',
                headers=headers,
                ssl=AIOHTTP_CLIENT_SESSION_SSL,
            ) as poll:
                poll_text = await poll.text()
                if poll.status >= 400:
                    raise ComfyUIUnavailableError(
                        f'Video poll failed ({poll.status}): {poll_text[:300]}'
                    )
                status_body = json.loads(poll_text)
            status = (status_body.get('status') or '').lower()
            if status == 'completed':
                break
            if status == 'failed':
                err = status_body.get('error') or {}
                message = err.get('message') if isinstance(err, dict) else str(err)
                raise ComfyUIUnavailableError(message or 'FLF generation failed')
            await asyncio.sleep(2.0)
        else:
            raise ComfyUIUnavailableError('Cartoon FLF timed out')

        async with session.get(
            f'{_SPOCKIFY_ROUTER_URL}/v1/videos/{video_id}/content',
            headers=headers,
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
        ) as content:
            if content.status >= 400:
                raise ComfyUIUnavailableError(
                    f'Video content failed ({content.status})'
                )
            mp4 = await content.read()
        clips.append({'id': video_id, 'bytes': mp4, 'mime': 'video/mp4'})

    return {
        'id': meta.get('id'),
        'grid': meta.get('grid'),
        'grid_image': meta.get('grid_image'),
        'keyframes': meta.get('keyframes') or [],
        'clips': clips,
        'video_edit': meta.get('video_edit'),
        'raw': meta,
    }


def b64_to_bytes(row: dict[str, Any] | None) -> bytes | None:
    if not row or not row.get('b64_json'):
        return None
    try:
        return base64.b64decode(row['b64_json'])
    except Exception:
        return None
