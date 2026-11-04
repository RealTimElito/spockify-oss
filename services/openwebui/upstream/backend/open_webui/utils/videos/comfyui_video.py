"""Text-to-video and image-to-video via ComfyUI + LTX-Video.

Mirrors open_webui.routers.images' ComfyUI create/edit paths (get_image_data /
upload_image / image_generations) but for mp4 output.

Kept as a small standalone module (env-configured, see open_webui.env)
rather than folded into the admin-panel PersistentConfig machinery in
routers/images.py — this is a fixed engine with T2V + I2V workflows, not a
multi-provider setting switchable in the UI like image generation.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import mimetypes
import os
import re
import uuid

from fastapi import Request, UploadFile

from open_webui.env import (
    AIOHTTP_CLIENT_SESSION_SSL,
    AIOHTTP_CLIENT_ALLOW_REDIRECTS,
    COMFYUI_VIDEO_API_KEY,
    COMFYUI_VIDEO_BASE_URL,
    COMFYUI_VIDEO_I2V_WORKFLOW,
    COMFYUI_VIDEO_I2V_WORKFLOW_NODES,
    COMFYUI_VIDEO_WORKFLOW,
    COMFYUI_VIDEO_WORKFLOW_NODES,
    VIDEO_GEN_TIMEOUT_SECONDS,
    VIDEO_GENERATION_MODEL,
    VIDEO_HEIGHT,
    VIDEO_LENGTH,
    VIDEO_STEPS,
    VIDEO_WIDTH,
)

# Prefer the router OpenAI Videos API so catalog models share one Comfy path.
_SPOCKIFY_ROUTER_URL = (
    os.environ.get('SPOCKIFY_ROUTER_URL')
    or 'http://spockify-router.spockify.svc.cluster.local:4100'
).rstrip('/')
_VIDEOS_VIA_ROUTER = os.environ.get('SPOCKIFY_VIDEOS_VIA_ROUTER', '1').strip().lower() not in {
    '0',
    'false',
    'no',
    'off',
}
from open_webui.routers.files import upload_file_handler
from open_webui.routers.images import _is_same_origin
from open_webui.models.chats import Chats
from open_webui.retrieval.web.utils import validate_url
from open_webui.utils.files import get_image_base64_from_file_id
from open_webui.utils.images.comfyui import (
    ComfyUICreateVideoForm,
    ComfyUIUnavailableError,
    ComfyUIWorkflow,
    comfyui_create_video,
    comfyui_upload_image,
)
from open_webui.utils.images.gpu_prep import prepare_gpu_for_image_gen
from open_webui.utils.session_pool import get_session
from open_webui.utils.video_options import frames_to_seconds
from open_webui.utils.videos.video_audio import maybe_add_video_narration

log = logging.getLogger(__name__)

# When the user says "animate this" / "make a video of this photo", the
# extracted subject is useless as an LTX prompt — use a mild motion cue.
_I2V_GENERIC_SUBJECT_RE = re.compile(
    r'(?i)^(this|that|it|the\s+(?:image|photo|picture|drawing|pic)|'
    r'(?:image|photo|picture|drawing|pic))\s*$'
)


def video_generation_configured() -> bool:
    if _VIDEOS_VIA_ROUTER and _SPOCKIFY_ROUTER_URL:
        return True
    return bool(COMFYUI_VIDEO_BASE_URL) and bool(COMFYUI_VIDEO_WORKFLOW)


def video_i2v_configured() -> bool:
    if _VIDEOS_VIA_ROUTER and _SPOCKIFY_ROUTER_URL:
        return True
    return bool(COMFYUI_VIDEO_BASE_URL) and bool(COMFYUI_VIDEO_I2V_WORKFLOW)


async def _router_video_bytes(
    *,
    prompt: str,
    model: str,
    seconds: float,
    size: str,
    input_reference: str | None,
    on_progress=None,
    fps: int | None = None,
    audio: bool | None = None,
    extend_from: str | None = None,
    clay_reference: str | None = None,
) -> tuple[bytes, str]:
    """POST /v1/videos on the Spockify router, poll, return (mp4 bytes, job id)."""
    api_key = (
        (os.environ.get('OPENAI_API_KEY') or '').strip()
        or (COMFYUI_VIDEO_API_KEY or '').strip()
    )
    if not api_key:
        raise ComfyUIUnavailableError(
            'Router video path needs OPENAI_API_KEY (LiteLLM master/virtual key)'
        )
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    body: dict = {
        'prompt': prompt,
        'model': model,
        'seconds': seconds,
        'size': size,
    }
    if input_reference:
        body['input_reference'] = input_reference
    if clay_reference:
        body['clay_reference'] = clay_reference
    if fps is not None:
        body['fps'] = int(fps)
    if audio is not None:
        body['audio'] = bool(audio)
    if extend_from:
        body['extend_from'] = str(extend_from)

    session = await get_session()
    async with session.post(
        f'{_SPOCKIFY_ROUTER_URL}/v1/videos',
        json=body,
        headers=headers,
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as resp:
        text = await resp.text()
        if resp.status >= 400:
            raise ComfyUIUnavailableError(
                f'Video API rejected request ({resp.status}): {text[:400]}'
            )
        try:
            meta = json.loads(text)
        except Exception as exc:
            raise ComfyUIUnavailableError(
                'Video API returned non-JSON enqueue response'
            ) from exc
    video_id = meta.get('id')
    if not video_id:
        raise ComfyUIUnavailableError('Video API returned no job id')

    deadline = asyncio.get_event_loop().time() + float(VIDEO_GEN_TIMEOUT_SECONDS)
    while asyncio.get_event_loop().time() < deadline:
        if on_progress:
            try:
                await on_progress('Generating video…')
            except Exception:
                pass
        async with session.get(
            f'{_SPOCKIFY_ROUTER_URL}/v1/videos/{video_id}',
            headers=headers,
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
        ) as poll:
            poll_text = await poll.text()
            if poll.status >= 400:
                raise ComfyUIUnavailableError(
                    f'Video API poll failed ({poll.status}): {poll_text[:300]}'
                )
            try:
                status_body = json.loads(poll_text)
            except Exception as exc:
                raise ComfyUIUnavailableError(
                    'Video API returned non-JSON status'
                ) from exc
        status = (status_body.get('status') or '').lower()
        if status == 'completed':
            break
        if status == 'failed':
            err = status_body.get('error') or {}
            message = err.get('message') if isinstance(err, dict) else str(err)
            raise ComfyUIUnavailableError(
                message or 'Video generation failed'
            )
        await asyncio.sleep(2.0)
    else:
        raise ComfyUIUnavailableError('Video generation timed out')

    async with session.get(
        f'{_SPOCKIFY_ROUTER_URL}/v1/videos/{video_id}/content',
        headers=headers,
        ssl=AIOHTTP_CLIENT_SESSION_SSL,
    ) as content:
        if content.status >= 400:
            raise ComfyUIUnavailableError(
                f'Video API content failed ({content.status})'
            )
        payload = await content.read()
    return payload, str(video_id)


def i2v_motion_prompt(extracted: str, fallback: str) -> str:
    """Prefer a concrete subject; fall back to a generic motion cue for I2V."""
    subject = (extracted or '').strip() or (fallback or '').strip()
    if not subject or _I2V_GENERIC_SUBJECT_RE.match(subject):
        return 'natural motion, subtle camera movement'
    return subject


async def get_video_data(url: str, headers=None, trusted_base_url: str | None = None):
    """Download generated video bytes from ComfyUI's /view endpoint."""
    try:
        if trusted_base_url and _is_same_origin(url, trusted_base_url):
            log.debug(f'Skipping URL validation for trusted backend: {url}')
        else:
            validate_url(url)
        session = await get_session()
        async with session.get(
            url,
            headers=headers,
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
        ) as r:
            r.raise_for_status()
            content_type = r.headers.get('content-type', '')
            if content_type.split('/')[0] == 'video' or content_type == 'application/octet-stream':
                return await r.read(), (content_type if content_type.split('/')[0] == 'video' else 'video/mp4')
            log.error(f'Url does not point to a video (content-type: {content_type}).')
            return None, None
    except Exception as e:
        log.exception(f'Error loading video data: {e}')
        return None, None


async def upload_video(request, video_data, content_type, metadata, user, db=None):
    if video_data is None or content_type is None:
        raise ValueError('Failed to retrieve video data from the generation backend')
    video_format = mimetypes.guess_extension(content_type) or '.mp4'
    file = UploadFile(
        file=io.BytesIO(video_data),
        filename=f'generated-video{video_format}',
        headers={'content-type': content_type},
    )
    file_item = await upload_file_handler(
        request,
        file=file,
        metadata=metadata,
        process=False,
        user=user,
    )

    if file_item and file_item.id:
        chat_id = metadata.get('chat_id')
        message_id = metadata.get('message_id')
        if chat_id and message_id:
            await Chats.insert_chat_files(
                chat_id=chat_id,
                message_id=message_id,
                file_ids=[file_item.id],
                user_id=user.id,
                db=db,
            )

    url = request.app.url_path_for('get_file_content_by_id', id=file_item.id)
    return file_item, url


async def _load_chat_image_as_data_uri(image_ref: str, user) -> str:
    """Resolve a chat attachment URL/file id to a data: URI."""
    if image_ref.startswith('data:'):
        return image_ref

    if image_ref.startswith('http://') or image_ref.startswith('https://'):
        validate_url(image_ref)
        session = await get_session()
        async with session.get(
            image_ref,
            ssl=AIOHTTP_CLIENT_SESSION_SSL,
            allow_redirects=AIOHTTP_CLIENT_ALLOW_REDIRECTS,
        ) as r:
            r.raise_for_status()
            image_data = base64.b64encode(await r.read()).decode('utf-8')
            return f'data:{r.headers["content-type"]};base64,{image_data}'

    file_id = image_ref
    if image_ref.startswith('/api/v1/files'):
        file_id = image_ref.split('/api/v1/files/')[1].split('/content')[0]

    data_uri = await get_image_base64_from_file_id(file_id, user)
    if not data_uri:
        raise ValueError(f'Could not load chat image: {image_ref!r}')
    return data_uri


def _data_uri_to_upload_item(data_uri: str):
    header, encoded = data_uri.split(',', 1)
    mime_type = header.split(';')[0].lstrip('data:')
    return (
        'image',
        (
            f'{uuid.uuid4()}.png',
            io.BytesIO(base64.b64decode(encoded)),
            mime_type if mime_type else 'image/png',
        ),
    )


async def _upload_chat_image_to_comfyui(image_ref: str, user) -> str:
    """Upload a chat attachment to ComfyUI input/; return the input filename."""
    data_uri = await _load_chat_image_as_data_uri(image_ref, user)
    file_item = _data_uri_to_upload_item(data_uri)
    res = await comfyui_upload_image(
        file_item,
        COMFYUI_VIDEO_BASE_URL,
        COMFYUI_VIDEO_API_KEY,
    )
    return res.get('name', file_item[1][0])


async def video_generations(
    request: Request,
    prompt: str,
    metadata: dict | None = None,
    user=None,
    on_progress=None,
    prepare_gpu: bool = True,
    image: str | None = None,
    length: int | None = None,
    narration: str | None = None,
    model: str | None = None,
    width: int | None = None,
    height: int | None = None,
    fps: int | None = None,
    audio: bool | None = None,
    extend_from: str | None = None,
    clay_reference: str | None = None,
):
    """Generate a single video clip and return [{'url': ..., 'content_type': ...}].

    When *image* is a chat attachment URL/file id, runs the I2V workflow
    (upload → LoadImage → LTXVImgToVideo). Otherwise runs text-to-video.

    *length* is the LTX frame count (injected into EmptyLTXVLatentVideo /
    LTXVImgToVideo). Defaults to VIDEO_LENGTH (65 ≈ 2.7s at 24fps).

    *model* / *width* / *height* override VIDEO_GENERATION_MODEL / VIDEO_WIDTH /
    VIDEO_HEIGHT when the composer Model / Resolution pickers are set.

    *narration* is optional TTS source text (defaults to *prompt*). After a
    successful silent LTX mp4 download, edge-tts + ffmpeg may mux brief audio
    when ENABLE_VIDEO_AUDIO is on; failures keep the silent clip.
    """
    use_i2v = bool(image)
    if use_i2v and not video_i2v_configured():
        raise ComfyUIUnavailableError(
            'Image-to-video is not configured (COMFYUI_VIDEO_I2V_WORKFLOW empty).'
        )
    if not use_i2v and not video_generation_configured():
        raise ComfyUIUnavailableError(
            'Video generation is not configured (COMFYUI_VIDEO_BASE_URL / '
            'COMFYUI_VIDEO_WORKFLOW env vars are empty).'
        )

    metadata = metadata or {}
    frame_count = int(length) if length is not None else VIDEO_LENGTH
    if frame_count < 1:
        frame_count = VIDEO_LENGTH
    ckpt = (model or '').strip() or VIDEO_GENERATION_MODEL
    out_w = int(width) if width is not None else VIDEO_WIDTH
    out_h = int(height) if height is not None else VIDEO_HEIGHT
    if out_w < 256:
        out_w = VIDEO_WIDTH
    if out_h < 256:
        out_h = VIDEO_HEIGHT

    if prepare_gpu:
        if on_progress:
            try:
                await on_progress('Preparing GPU…')
            except Exception:
                pass
        await prepare_gpu_for_image_gen()

    # Shared path with curl / OpenAI clients: router → gateway → Comfy.
    if _VIDEOS_VIA_ROUTER and _SPOCKIFY_ROUTER_URL:
        input_ref = None
        if use_i2v and image:
            if on_progress:
                try:
                    await on_progress('Uploading image to video engine…')
                except Exception:
                    pass
            input_ref = await _load_chat_image_as_data_uri(image, user)
        seconds = max(1.0, float(frames_to_seconds(frame_count)))
        video_data, router_video_id = await _router_video_bytes(
            prompt=prompt,
            model=ckpt,
            seconds=seconds,
            size=f'{out_w}x{out_h}',
            input_reference=input_ref,
            on_progress=on_progress,
            fps=fps,
            audio=audio,
            extend_from=extend_from,
            clay_reference=clay_reference,
        )
        content_type = 'video/mp4'
        duration_s = frames_to_seconds(frame_count)
        # Native MiniMax FLOW_AV already has a soundtrack; skip edge-tts mux.
        if audio:
            audio_added = False
            log.info('native model audio requested; skipping edge-tts narration mux')
        else:
            if on_progress:
                try:
                    await on_progress('Adding narration…')
                except Exception:
                    pass
            video_data, audio_added = await maybe_add_video_narration(
                video_data,
                narration=(narration if narration is not None else prompt),
                duration_seconds=duration_s,
            )
            if audio_added:
                log.info('video audio muxed duration=%.2fs', duration_s)
            else:
                log.info('video audio skipped or failed; attaching silent mp4')
        _, url = await upload_video(
            request,
            video_data,
            content_type,
            {
                'prompt': prompt,
                'model': ckpt,
                'width': out_w,
                'height': out_h,
                'length': frame_count,
                'router_video_id': router_video_id,
                **metadata,
            },
            user,
        )
        return [
            {
                'url': url,
                'content_type': content_type,
                'router_video_id': router_video_id,
            }
        ]

    workflow_json = COMFYUI_VIDEO_I2V_WORKFLOW if use_i2v else COMFYUI_VIDEO_WORKFLOW
    nodes_raw = (
        COMFYUI_VIDEO_I2V_WORKFLOW_NODES if use_i2v else COMFYUI_VIDEO_WORKFLOW_NODES
    )
    try:
        nodes = json.loads(nodes_raw)
    except Exception:
        nodes = []

    comfyui_image_name = None
    if use_i2v:
        if on_progress:
            try:
                await on_progress('Uploading image to video engine…')
            except Exception:
                pass
        comfyui_image_name = await _upload_chat_image_to_comfyui(image, user)

    form_data = ComfyUICreateVideoForm(
        workflow=ComfyUIWorkflow(workflow=workflow_json, nodes=nodes),
        prompt=prompt,
        image=comfyui_image_name,
        width=out_w,
        height=out_h,
        length=frame_count,
        steps=VIDEO_STEPS,
    )

    res = await comfyui_create_video(
        ckpt,
        form_data,
        str(uuid.uuid4()),
        COMFYUI_VIDEO_BASE_URL,
        COMFYUI_VIDEO_API_KEY,
        on_progress=on_progress,
        receive_timeout=float(VIDEO_GEN_TIMEOUT_SECONDS),
    )
    if res is None or not isinstance(res, dict) or not res.get('data'):
        raise ComfyUIUnavailableError(
            'ComfyUI returned no video data (backend unreachable or workflow failed)'
        )

    videos = []
    for video in res['data']:
        headers = None
        if COMFYUI_VIDEO_API_KEY:
            headers = {'Authorization': f'Bearer {COMFYUI_VIDEO_API_KEY}'}

        video_data, content_type = await get_video_data(
            video['url'],
            headers,
            trusted_base_url=COMFYUI_VIDEO_BASE_URL,
        )
        if video_data is None:
            raise ComfyUIUnavailableError('Failed to download generated video from ComfyUI')

        if on_progress:
            try:
                await on_progress('Adding narration…')
            except Exception:
                pass
        duration_s = frames_to_seconds(frame_count)
        video_data, audio_added = await maybe_add_video_narration(
            video_data,
            narration=(narration if narration is not None else prompt),
            duration_seconds=duration_s,
        )
        if audio_added:
            log.info('video audio muxed duration=%.2fs', duration_s)
        else:
            log.info('video audio skipped or failed; attaching silent mp4')

        _, url = await upload_video(
            request,
            video_data,
            content_type,
            {**form_data.model_dump(exclude_none=True), **metadata},
            user,
        )
        videos.append({'url': url, 'content_type': content_type})

    return videos
