"""Runnable image catalog. Listing must not imply a ComfyUI wake."""

from __future__ import annotations

import os
import unittest

from open_webui.utils.images import catalog


class ImageCatalogTests(unittest.TestCase):
    def tearDown(self) -> None:
        for key in (
            'COMFYUI_UNET_GGUF',
            'COMFYUI_QWEN_IMAGE21',
            'SPOCKIFY_IMAGE_MODELS_ROOT',
            'SPOCKIFY_QWEN_IMAGE_GGUF',
        ):
            os.environ.pop(key, None)

    def test_only_flux(self) -> None:
        ids = [item['id'] for item in catalog.list_runnable_image_models()]
        self.assertEqual(ids, [catalog.FLUX_ID])
        self.assertFalse(catalog.qwen_image_runnable())

    def test_qwen_tag_rejected(self) -> None:
        with self.assertRaises(catalog.UnknownImageModel):
            catalog.resolve_image_model(catalog.QWEN_OLLAMA_TAG)

    def test_loader_flag_alone_does_not_list_qwen(self) -> None:
        os.environ['COMFYUI_UNET_GGUF'] = '1'
        os.environ['COMFYUI_QWEN_IMAGE21'] = '1'
        self.assertFalse(catalog.qwen_image_runnable())
        missing = ' '.join(catalog.qwen_status()['missing'])
        self.assertIn(catalog.QWEN_VAE_FILE, missing)
        self.assertIn('qwen3vl_8b_fp8_scaled.safetensors', missing)


if __name__ == '__main__':
    unittest.main()
