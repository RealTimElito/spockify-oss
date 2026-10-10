"""Runnable image-model catalog. Does not touch ComfyUI or Ollama."""

from __future__ import annotations

import os
import unittest

import image_models


class ImageModelCatalogTests(unittest.TestCase):
    def tearDown(self) -> None:
        for key in (
            "COMFYUI_UNET_GGUF",
            "COMFYUI_QWEN_IMAGE21",
            "SPOCKIFY_IMAGE_MODELS_ROOT",
            "SPOCKIFY_QWEN_IMAGE_GGUF",
        ):
            os.environ.pop(key, None)

    def test_flux_is_listed_qwen_is_not(self) -> None:
        ids = [item["id"] for item in image_models.list_runnable_image_models()]
        self.assertEqual(ids, [image_models.FLUX_ID])
        catalog = image_models.image_model_catalog()
        self.assertFalse(catalog["qwen_image_2_1"]["included"])
        self.assertIn("UnetLoaderGGUF", catalog["qwen_image_2_1"]["reason"])
        self.assertIn("Ollama", catalog["qwen_image_2_1"]["reason"])

    def test_ollama_qwen_tag_is_rejected(self) -> None:
        with self.assertRaises(image_models.UnknownImageModel) as ctx:
            image_models.resolve_image_model(image_models.QWEN_OLLAMA_TAG)
        self.assertIn("Ollama", str(ctx.exception))

    def test_explicit_flux_and_default(self) -> None:
        self.assertEqual(
            image_models.resolve_image_model(image_models.FLUX_ID),
            image_models.FLUX_ID,
        )
        self.assertEqual(image_models.resolve_image_model(None), image_models.FLUX_ID)
        self.assertEqual(
            image_models.resolve_image_model("", "not-a-checkpoint"),
            image_models.FLUX_ID,
        )

    def test_generate_rejects_qwen_before_comfy(self) -> None:
        import asyncio

        import image_gen

        with self.assertRaises(image_gen.ImageGenError) as ctx:
            asyncio.run(
                image_gen.generate_images(
                    prompt="a red cube",
                    model=image_models.QWEN_OLLAMA_TAG,
                )
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_gguf_flag_without_companions_still_omits_qwen(self) -> None:
        os.environ["COMFYUI_UNET_GGUF"] = "1"
        os.environ["COMFYUI_QWEN_IMAGE21"] = "1"
        self.assertFalse(image_models.qwen_image_runnable())
        status = image_models.qwen_status()
        self.assertIn(image_models.QWEN_VAE_FILE, " ".join(status["missing"]))
        self.assertIn("qwen3vl_8b_int8_convrot.safetensors", " ".join(status["missing"]))
        ids = [item["id"] for item in image_models.list_runnable_image_models()]
        self.assertNotIn("qwen-image-2.1", ids)

    def test_qwen_listed_only_with_runtime_and_companions(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "comfyui")
            os.makedirs(os.path.join(root, "checkpoints"))
            os.makedirs(os.path.join(root, "text_encoders"))
            open(os.path.join(root, "checkpoints", image_models.FLUX_ID), "w").close()
            open(os.path.join(root, "checkpoints", image_models.QWEN_UNET_FILE), "w").close()
            open(
                os.path.join(root, "checkpoints", "ltxv-2b-0.9.8-distilled-fp8.safetensors"),
                "w",
            ).close()
            open(os.path.join(root, "checkpoints", "sd_xl_base_1.0.safetensors"), "w").close()
            open(os.path.join(root, "text_encoders", "t5xxl_fp16.safetensors"), "w").close()
            os.environ["SPOCKIFY_IMAGE_MODELS_ROOT"] = root
            os.environ["SPOCKIFY_QWEN_IMAGE_GGUF"] = ""
            os.environ["COMFYUI_UNET_GGUF"] = "1"
            os.environ["COMFYUI_QWEN_IMAGE21"] = "1"
            ids = [item["id"] for item in image_models.list_runnable_image_models()]
            self.assertIn(image_models.FLUX_ID, ids)
            self.assertIn("sd_xl_base_1.0.safetensors", ids)
            self.assertNotIn("qwen-image-2.1", ids)
            self.assertNotIn("ltxv-2b-0.9.8-distilled-fp8.safetensors", ids)
            video = image_models.list_video_checkpoints()
            self.assertEqual(video[0]["id"], "ltxv-2b-0.9.8-distilled-fp8.safetensors")
            self.assertTrue(video[0]["runnable"])
            self.assertIn(image_models.QWEN_VAE_FILE, image_models.qwen_status()["reason"])

            open(
                os.path.join(root, "checkpoints", image_models.QWEN_VAE_FILE),
                "w",
            ).close()
            open(
                os.path.join(root, "text_encoders", image_models.QWEN_CLIP_FILES[0]),
                "w",
            ).close()
            self.assertTrue(image_models.qwen_image_runnable())
            ids = [item["id"] for item in image_models.list_runnable_image_models()]
            self.assertIn("qwen-image-2.1", ids)
            graph = image_models.gguf_prompt_graph("qwen-image-2.1")
            self.assertIsNotNone(graph)
            loaders = {node["class_type"] for node in graph["workflow"].values()}
            self.assertIn("UnetLoaderGGUF", loaders)
            self.assertIn("TextEncodeQwenImage21", loaders)
            self.assertIn("VAELoader", loaders)
            self.assertNotIn("CheckpointLoaderSimple", loaders)
            self.assertEqual(graph["workflow"]["6"]["inputs"]["cfg"], 1.0)
            self.assertIsNone(image_models.gguf_prompt_graph(image_models.FLUX_ID))

    def test_ltx_tag_rejected_as_image_model(self) -> None:
        with self.assertRaises(image_models.UnknownImageModel) as ctx:
            image_models.resolve_image_model("ltxv-2b-0.9.8-distilled-fp8.safetensors")
        self.assertIn("video", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
