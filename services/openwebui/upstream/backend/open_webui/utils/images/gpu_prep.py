"""Free GPU VRAM before ComfyUI FLUX on a shared GPU with Ollama."""

from __future__ import annotations

import asyncio
import json
import logging

from open_webui.env import IMAGE_GEN_OLLAMA_URL, IMAGE_GEN_UNLOAD_OLLAMA
from open_webui.utils.session_pool import get_session

log = logging.getLogger(__name__)


async def prepare_gpu_for_image_gen(*, force: bool = False) -> int:
    """Unload Ollama models so ComfyUI FLUX has enough VRAM.

    Returns the number of models unloaded (0 if disabled or none loaded).
    """
    if not force and not IMAGE_GEN_UNLOAD_OLLAMA:
        return 0
    unloaded = 0
    try:
        session = await get_session()
        async with session.get(f'{IMAGE_GEN_OLLAMA_URL}/api/ps') as response:
            if not response.ok:
                log.warning('Could not list Ollama models before image gen: %s', response.status)
                return 0
            loaded = (await response.json()).get('models', [])
        for model_info in loaded:
            model_name = model_info.get('name') or model_info.get('model')
            if not model_name:
                continue
            payload = json.dumps({'model': model_name, 'keep_alive': 0, 'prompt': ''})
            async with session.post(
                f'{IMAGE_GEN_OLLAMA_URL}/api/generate',
                data=payload,
                headers={'Content-Type': 'application/json'},
            ) as response:
                if response.ok:
                    unloaded += 1
                    log.info('Unloaded Ollama model for image gen: %s', model_name)
                else:
                    log.warning(
                        'Failed to unload Ollama model %s: %s',
                        model_name,
                        await response.text(),
                    )
        if unloaded:
            await asyncio.sleep(2)
    except Exception as e:
        log.warning('Could not unload Ollama models before image gen: %s', e)
    return unloaded
