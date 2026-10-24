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

    def test_aliases_remap_and_vae_is_not_a_picker_row(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, 'comfyui')
            os.makedirs(os.path.join(root, 'checkpoints'))
            os.makedirs(os.path.join(root, 'text_encoders'))
            open(os.path.join(root, 'checkpoints', catalog.FLUX_ID), 'w').close()
            open(os.path.join(root, 'checkpoints', catalog.QWEN_UNET_FILE), 'w').close()
            open(os.path.join(root, 'checkpoints', catalog.QWEN_VAE_FILE), 'w').close()
            open(
                os.path.join(root, 'text_encoders', catalog.QWEN_CLIP_FILES[0]),
                'w',
            ).close()
            os.environ['SPOCKIFY_IMAGE_MODELS_ROOT'] = root
            os.environ['SPOCKIFY_QWEN_IMAGE_GGUF'] = ''
            os.environ['COMFYUI_UNET_GGUF'] = '1'
            os.environ['COMFYUI_QWEN_IMAGE21'] = '1'
            ids = [item['id'] for item in catalog.list_runnable_image_models()]
            self.assertIn(catalog.QWEN_ID, ids)
            self.assertNotIn(catalog.QWEN_VAE_FILE, ids)
            self.assertEqual(catalog.resolve_image_model('qwen2.1'), catalog.QWEN_ID)
            self.assertEqual(
                catalog.resolve_image_model('Qwen-Image-2.1-turbo-GGUF'),
                catalog.QWEN_ID,
            )
            self.assertEqual(
                catalog.resolve_image_model(catalog.QWEN_VAE_FILE),
                catalog.QWEN_ID,
            )
            self.assertTrue(
                catalog.is_qwen_diffusion_chat_id(catalog.QWEN_OLLAMA_TAG)
            )
            self.assertFalse(catalog.is_qwen_diffusion_chat_id('qwen3.5-9b'))
            self.assertNotIn(catalog.QWEN_UNET_FILE, ids)
            self.assertTrue(catalog.is_qwen_diffusion_chat_id(catalog.QWEN_UNET_FILE))


if __name__ == '__main__':
    unittest.main()
