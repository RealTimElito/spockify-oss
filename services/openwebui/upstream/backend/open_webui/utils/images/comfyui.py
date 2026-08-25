import json
import logging
import random
import urllib.parse
from collections.abc import Awaitable, Callable
from typing import Optional

import aiohttp
from open_webui.env import AIOHTTP_CLIENT_SESSION_SSL
from open_webui.utils.session_pool import get_session
from pydantic import BaseModel

log = logging.getLogger(__name__)

default_headers = {'User-Agent': 'Mozilla/5.0'}

ProgressCallback = Callable[[str], Awaitable[None]]


class ComfyUIUnavailableError(Exception):
    """Raised when ComfyUI cannot be reached or returns no usable output."""


async def queue_prompt(prompt, client_id, base_url, api_key):
    log.info('queue_prompt')
    p = {'prompt': prompt, 'client_id': client_id}
    log.debug(f'queue_prompt data: {p}')
    try:
        session = await get_session()
        async with session.post(
            f'{base_url}/prompt',
            json=p,
            headers={**default_headers, 'Authorization': f'Bearer {api_key}'},
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
        ) as r:
            r.raise_for_status()
            return await r.json()
    except aiohttp.ClientConnectorError as e:
        raise ComfyUIUnavailableError(
            f'ComfyUI is unreachable at {base_url}. Is the comfyui deployment running?'
        ) from e
    except aiohttp.ClientResponseError as e:
        raise ComfyUIUnavailableError(
            f'ComfyUI rejected the prompt ({e.status}): {e.message}'
        ) from e
    except Exception as e:
        log.exception(f'Error while queuing prompt: {e}')
        raise


async def get_image(filename, subfolder, folder_type, base_url, api_key):
    log.info('get_image')
    data = {'filename': filename, 'subfolder': subfolder, 'type': folder_type}
    url_values = urllib.parse.urlencode(data)
    session = await get_session()
    async with session.get(
        f'{base_url}/view?{url_values}',
        headers={**default_headers, 'Authorization': f'Bearer {api_key}'},
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as r:
        r.raise_for_status()
        return await r.read()


def get_image_url(filename, subfolder, folder_type, base_url):
    log.info('get_image')
    data = {'filename': filename, 'subfolder': subfolder, 'type': folder_type}
    url_values = urllib.parse.urlencode(data)
    return f'{base_url}/view?{url_values}'


async def get_history(prompt_id, base_url, api_key):
    log.info('get_history')
    session = await get_session()
    async with session.get(
        f'{base_url}/history/{prompt_id}',
        headers={**default_headers, 'Authorization': f'Bearer {api_key}'},
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as r:
        r.raise_for_status()
        return await r.json()


async def _emit_progress(on_progress: Optional[ProgressCallback], description: str):
    if on_progress:
        try:
            await on_progress(description)
        except Exception as e:
            log.debug('Image progress callback failed: %s', e)


# class_type values whose ComfyUI history output stores results under the
# 'images' key (true for still images *and* video/webm savers — SaveVideo's
# PreviewVideo.as_dict() also emits {'images': [...], 'animated': (True,)}).
_OUTPUT_NODE_CLASS_TYPES = ('SaveImage', 'PreviewImage', 'SaveVideo', 'SaveWEBM')


async def _ws_get_images(
    ws,
    workflow,
    client_id,
    base_url,
    api_key,
    on_progress: Optional[ProgressCallback] = None,
    label: str = 'image',
):
    """Queue a prompt and wait on *ws* for ComfyUI to finish executing it.

    Returns a dict of ``{'data': [{'url': ...}, ...]}``. *label* only affects
    the human-readable progress text ("Generating image…" vs "Generating
    video…") — the wait/poll/download logic is identical for both.
    """
    queued = await queue_prompt(workflow, client_id, base_url, api_key)
    prompt_id = queued.get('prompt_id')
    if not prompt_id:
        raise ComfyUIUnavailableError('ComfyUI did not return a prompt_id')

    await _emit_progress(on_progress, f'Generating {label}…')
    output_images = []
    last_pct = -1
    ws_closed = False

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.TEXT:
            message = json.loads(msg.data)
            msg_type = message.get('type')
            data = message.get('data') or {}

            if msg_type == 'progress':
                value = data.get('value')
                maximum = data.get('max') or data.get('maximum')
                if isinstance(value, (int, float)) and isinstance(maximum, (int, float)) and maximum > 0:
                    pct = int(100 * float(value) / float(maximum))
                    # Throttle UI updates to ~10% steps.
                    if pct >= last_pct + 10 or pct >= 100:
                        last_pct = pct
                        await _emit_progress(on_progress, f'Generating {label}… {pct}%')
            elif msg_type == 'executing':
                if data.get('node') is None and data.get('prompt_id') == prompt_id:
                    break  # Execution is done
                # Avoid spamming status on every node; percent updates cover progress.
            elif msg_type == 'execution_error' and data.get('prompt_id') == prompt_id:
                err = data.get('exception_message') or data.get('message') or 'workflow error'
                raise ComfyUIUnavailableError(f'ComfyUI execution failed: {err}')
        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
            log.error(f'WebSocket closed unexpectedly: {msg.type}')
            ws_closed = True
            break
        # binary messages (previews) are silently skipped

    history_resp = await get_history(prompt_id, base_url, api_key)
    if prompt_id not in history_resp:
        if ws_closed:
            raise ComfyUIUnavailableError(
                f'ComfyUI connection closed before the {label} finished. '
                'Check that ComfyUI is running and has enough GPU memory.'
            )
        raise ComfyUIUnavailableError(
            'ComfyUI finished without history for this prompt. The workflow may have failed.'
        )

    history = history_resp[prompt_id]
    for node_id in history.get('outputs', {}):
        node_output = history['outputs'][node_id]
        if node_id in workflow and workflow[node_id].get('class_type') in _OUTPUT_NODE_CLASS_TYPES:
            if 'images' in node_output:
                for image in node_output['images']:
                    url = get_image_url(image['filename'], image['subfolder'], image['type'], base_url)
                    output_images.append({'url': url})

    if not output_images:
        raise ComfyUIUnavailableError(
            f'ComfyUI produced no {label} output. Check the workflow and model files.'
        )

    return {'data': output_images}


async def comfyui_upload_image(image_file_item, base_url, api_key):
    url = f'{base_url}/api/upload/image'
    headers = {}

    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'

    _, (filename, file_bytes, mime_type) = image_file_item

    form = aiohttp.FormData()
    form.add_field('image', file_bytes, filename=filename, content_type=mime_type)
    form.add_field('type', 'input')  # required by ComfyUI

    session = await get_session()
    try:
        async with session.post(url, data=form, headers=headers, ssl=AIOHTTP_CLIENT_SESSION_SSL) as resp:
            resp.raise_for_status()
            return await resp.json()
    except aiohttp.ClientConnectorError as e:
        raise ComfyUIUnavailableError(
            f'ComfyUI is unreachable at {base_url}. Is the comfyui deployment running?'
        ) from e


class ComfyUINodeInput(BaseModel):
    type: Optional[str] = None
    node_ids: list[str] = []
    key: Optional[str] = 'text'
    value: Optional[str] = None


class ComfyUIWorkflow(BaseModel):
    workflow: str
    nodes: list[ComfyUINodeInput]


class ComfyUICreateImageForm(BaseModel):
    workflow: ComfyUIWorkflow

    prompt: str
    negative_prompt: Optional[str] = None
    width: int
    height: int
    n: int = 1

    steps: Optional[int] = None
    seed: Optional[int] = None


def _apply_workflow_nodes(workflow, nodes, model, payload):
    """Mutate *workflow* dict in-place based on typed node definitions."""
    for node in nodes:
        if node.type:
            if node.type == 'model':
                for node_id in node.node_ids:
                    workflow[node_id]['inputs'][node.key] = model
            elif node.type == 'prompt':
                for node_id in node.node_ids:
                    workflow[node_id]['inputs'][node.key if node.key else 'text'] = payload.prompt
            elif node.type == 'negative_prompt':
                for node_id in node.node_ids:
                    workflow[node_id]['inputs'][node.key if node.key else 'text'] = payload.negative_prompt
            elif node.type == 'image':
                if isinstance(payload.image, list):
                    for idx, node_id in enumerate(node.node_ids):
                        if idx < len(payload.image):
                            workflow[node_id]['inputs'][node.key] = payload.image[idx]
                else:
                    for node_id in node.node_ids:
                        workflow[node_id]['inputs'][node.key] = payload.image
            elif node.type == 'width':
                for node_id in node.node_ids:
                    workflow[node_id]['inputs'][node.key if node.key else 'width'] = payload.width
            elif node.type == 'height':
                for node_id in node.node_ids:
                    workflow[node_id]['inputs'][node.key if node.key else 'height'] = payload.height
            elif node.type == 'n':
                for node_id in node.node_ids:
                    workflow[node_id]['inputs'][node.key if node.key else 'batch_size'] = payload.n
            elif node.type == 'steps':
                for node_id in node.node_ids:
                    workflow[node_id]['inputs'][node.key if node.key else 'steps'] = payload.steps
            elif node.type == 'seed':
                seed = payload.seed if payload.seed else random.randint(0, 1125899906842624)
                for node_id in node.node_ids:
                    workflow[node_id]['inputs'][node.key] = seed
            elif node.type == 'length':
                # Video frame count (EmptyLTXVLatentVideo.length). No-op for
                # image payloads, which never carry this attribute.
                length = getattr(payload, 'length', None)
                if length is not None:
                    for node_id in node.node_ids:
                        workflow[node_id]['inputs'][node.key if node.key else 'length'] = length
        else:
            for node_id in node.node_ids:
                workflow[node_id]['inputs'][node.key] = node.value


async def comfyui_create_image(
    model: str,
    payload: ComfyUICreateImageForm,
    client_id,
    base_url,
    api_key,
    on_progress: Optional[ProgressCallback] = None,
):
    ws_url = base_url.replace('http://', 'ws://').replace('https://', 'wss://')
    if not payload.workflow.workflow:
        raise ComfyUIUnavailableError('ComfyUI workflow is not configured (COMFYUI_WORKFLOW empty)')
    workflow = json.loads(payload.workflow.workflow)
    _apply_workflow_nodes(workflow, payload.workflow.nodes, model, payload)

    headers = {'Authorization': f'Bearer {api_key}'}
    session = await get_session()

    await _emit_progress(on_progress, 'Connecting to image engine…')
    try:
        async with session.ws_connect(
            f'{ws_url}/ws?clientId={client_id}',
            headers=headers,
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
        ) as ws:
            log.info('WebSocket connection established.')
            log.info('Sending workflow to WebSocket server.')
            log.debug(f'Workflow: {workflow}')
            images = await _ws_get_images(
                ws, workflow, client_id, base_url, api_key, on_progress=on_progress
            )
    except ComfyUIUnavailableError:
        raise
    except aiohttp.ClientConnectorError as e:
        raise ComfyUIUnavailableError(
            f'ComfyUI is unreachable at {base_url}. Is the comfyui deployment running?'
        ) from e
    except aiohttp.WSServerHandshakeError as e:
        log.exception(f'Failed to connect to WebSocket server: {e}')
        raise ComfyUIUnavailableError(
            f'Could not open ComfyUI WebSocket at {base_url}: {e}'
        ) from e
    except Exception as e:
        log.exception(f'Error during image generation: {e}')
        raise

    return images


class ComfyUIEditImageForm(BaseModel):
    workflow: ComfyUIWorkflow

    image: str | list[str]
    prompt: str
    width: Optional[int] = None
    height: Optional[int] = None
    n: Optional[int] = None

    steps: Optional[int] = None
    seed: Optional[int] = None


async def comfyui_edit_image(
    model: str,
    payload: ComfyUIEditImageForm,
    client_id,
    base_url,
    api_key,
    on_progress: Optional[ProgressCallback] = None,
):
    ws_url = base_url.replace('http://', 'ws://').replace('https://', 'wss://')
    if not payload.workflow.workflow:
        raise ComfyUIUnavailableError('ComfyUI workflow is not configured (COMFYUI_WORKFLOW empty)')
    workflow = json.loads(payload.workflow.workflow)
    _apply_workflow_nodes(workflow, payload.workflow.nodes, model, payload)

    headers = {'Authorization': f'Bearer {api_key}'}
    session = await get_session()

    await _emit_progress(on_progress, 'Connecting to image engine…')
    try:
        async with session.ws_connect(
            f'{ws_url}/ws?clientId={client_id}',
            headers=headers,
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
        ) as ws:
            log.info('WebSocket connection established.')
            log.info('Sending workflow to WebSocket server.')
            log.debug(f'Workflow: {workflow}')
            images = await _ws_get_images(
                ws, workflow, client_id, base_url, api_key, on_progress=on_progress
            )
    except ComfyUIUnavailableError:
        raise
    except aiohttp.ClientConnectorError as e:
        raise ComfyUIUnavailableError(
            f'ComfyUI is unreachable at {base_url}. Is the comfyui deployment running?'
        ) from e
    except aiohttp.WSServerHandshakeError as e:
        log.exception(f'Failed to connect to WebSocket server: {e}')
        raise ComfyUIUnavailableError(
            f'Could not open ComfyUI WebSocket at {base_url}: {e}'
        ) from e
    except Exception as e:
        log.exception(f'Error during image editing: {e}')
        raise

    return images


class ComfyUICreateVideoForm(BaseModel):
    """Text-to-video or image-to-video request (LTX-Video).

    Mirrors ComfyUICreateImageForm / ComfyUIEditImageForm. When *image* is set
    (ComfyUI input filename from /api/upload/image), the I2V workflow's LoadImage
    node is filled via the typed ``image`` workflow-node mapping.
    """

    workflow: ComfyUIWorkflow

    prompt: str
    negative_prompt: Optional[str] = None
    image: Optional[str | list[str]] = None
    width: int
    height: int
    length: int = 65  # frame count (~2.7s at 24fps for the default workflow)
    n: int = 1

    steps: Optional[int] = None
    seed: Optional[int] = None


async def comfyui_create_video(
    model: str,
    payload: ComfyUICreateVideoForm,
    client_id,
    base_url,
    api_key,
    on_progress: Optional[ProgressCallback] = None,
    receive_timeout: Optional[float] = None,
):
    """Queue an LTX-Video T2V/I2V workflow and wait for the mp4.

    Identical shape to comfyui_create_image — same queue/poll/download path,
    just pointed at a video workflow (CreateVideo -> SaveVideo terminal nodes
    instead of VAEDecode -> SaveImage) and with 'Generating video…' progress
    text so the chat UI sets honest expectations about the longer wait.

    *receive_timeout* overrides the per-message websocket read timeout (None
    means "wait indefinitely between messages", aiohttp's own default) —
    video generation runs several minutes on shared GPU hardware, meaningfully
    longer than image generation, so the caller passes a generous explicit
    bound (VIDEO_GEN_TIMEOUT_SECONDS) instead of relying on the shared
    session's default total-request timeout, which is sized for quick image
    generations.
    """
    ws_url = base_url.replace('http://', 'ws://').replace('https://', 'wss://')
    if not payload.workflow.workflow:
        raise ComfyUIUnavailableError(
            'ComfyUI video workflow is not configured (COMFYUI_VIDEO_WORKFLOW empty)'
        )
    workflow = json.loads(payload.workflow.workflow)
    _apply_workflow_nodes(workflow, payload.workflow.nodes, model, payload)

    headers = {'Authorization': f'Bearer {api_key}'}
    session = await get_session()

    await _emit_progress(on_progress, 'Connecting to video engine…')
    try:
        async with session.ws_connect(
            f'{ws_url}/ws?clientId={client_id}',
            headers=headers,
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
            receive_timeout=receive_timeout,
        ) as ws:
            log.info('WebSocket connection established.')
            log.info('Sending video workflow to WebSocket server.')
            log.debug(f'Workflow: {workflow}')
            videos = await _ws_get_images(
                ws, workflow, client_id, base_url, api_key, on_progress=on_progress, label='video'
            )
    except ComfyUIUnavailableError:
        raise
    except aiohttp.ClientConnectorError as e:
        raise ComfyUIUnavailableError(
            f'ComfyUI is unreachable at {base_url}. Is the comfyui deployment running?'
        ) from e
    except aiohttp.WSServerHandshakeError as e:
        log.exception(f'Failed to connect to WebSocket server: {e}')
        raise ComfyUIUnavailableError(
            f'Could not open ComfyUI WebSocket at {base_url}: {e}'
        ) from e
    except Exception as e:
        log.exception(f'Error during video generation: {e}')
        raise

    return videos
