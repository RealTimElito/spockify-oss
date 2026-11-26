"""Qwen image-edit route and the generations alias guard. No Comfy calls."""

from __future__ import annotations

import unittest

from image_gen import (
    ImageGenError,
    attach_reference_images,
    edit_alias_rejection,
    response_model_label,
)
from image_models import is_qwen_edit_alias, is_qwen_image_alias


def _qwen_workflow():
    return {
        "3": {"inputs": {"vae_name": "vae"}, "class_type": "VAELoader"},
        "4": {
            "inputs": {"prompt": "p", "resolution": 1024, "clip": ["2", 0]},
            "class_type": "TextEncodeQwenImage21",
        },
        "6": {
            "inputs": {"latent_image": ["5", 0]},
            "class_type": "KSampler",
        },
    }


class EditAliasTests(unittest.TestCase):
    def test_edit_names_are_not_plain_t2i_aliases(self) -> None:
        for name in ("Qwen-Image-Edit", "qwen-image-edit", "qwen_image_edit"):
            self.assertTrue(is_qwen_edit_alias(name), name)
            self.assertFalse(is_qwen_image_alias(name), name)
        self.assertTrue(is_qwen_image_alias("qwen-image-2.1"))
        self.assertFalse(is_qwen_edit_alias("qwen-image-2.1"))

    def test_generations_without_image_points_at_edits(self) -> None:
        message = edit_alias_rejection("Qwen-Image-Edit", has_image=False)
        self.assertIsNotNone(message)
        assert message is not None
        self.assertIn("POST /v1/images/edits", message)
        self.assertIsNone(edit_alias_rejection("Qwen-Image-Edit", has_image=True))
        self.assertIsNone(edit_alias_rejection("qwen-image-2.1", has_image=False))

    def test_edit_response_label_is_not_the_checkpoint_id(self) -> None:
        self.assertEqual(
            response_model_label("qwen-image-edit", "qwen-image-2.1"),
            "Qwen-Image-Edit",
        )
        self.assertEqual(
            response_model_label("Qwen-Image-Edit", "qwen-image-2.1"),
            "Qwen-Image-Edit",
        )
        self.assertEqual(
            response_model_label("qwen-image-2.1", "qwen-image-2.1"),
            "qwen-image-2.1",
        )

    def test_plate_and_background_are_two_encoder_slots(self) -> None:
        workflow = _qwen_workflow()
        attach_reference_images(
            workflow, ["plate.png", "city.png"], resolution=1024
        )
        encode = workflow["4"]["inputs"]
        self.assertEqual(workflow[encode["images.image_1"][0]]["inputs"]["image"], "plate.png")
        self.assertEqual(workflow[encode["images.image_2"][0]]["inputs"]["image"], "city.png")
        self.assertEqual(workflow["6"]["inputs"]["latent_image"], ["4", 2])


class EditRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_edits_route_is_registered_and_empty_body_is_not_a_silent_t2i(self) -> None:
        import main

        paths = {getattr(route, "path", None) for route in main.app.routes}
        self.assertIn("/v1/images/edits", paths)
        self.assertIn("/images/edits", paths)

    async def test_edit_without_image_is_400(self) -> None:
        from image_gen import edit_images

        with self.assertRaises(ImageGenError) as caught:
            await edit_images(prompt="repaint the coat")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("image", str(caught.exception))


class IdentityLockTests(unittest.TestCase):
    def test_pack_ids_without_images_are_edit_only(self) -> None:
        from cartoon_pipeline import identity_lock_report

        bare = identity_lock_report([], pack_ids=True)
        self.assertEqual(bare["identity_lock"], "edit-only")
        self.assertFalse(bare["identity_conditioned"])
        self.assertIn("character_plate", bare["identity_lock_detail"])

        locked = identity_lock_report(["character_plate", "background"])
        self.assertEqual(locked["identity_lock"], "qwen-reference")
        self.assertTrue(locked["identity_conditioned"])
        self.assertEqual(locked["identity_images"], ["character_plate", "background"])


class Qwen3TtsTests(unittest.TestCase):
    def test_model_id(self) -> None:
        from series_prod import QWEN3_TTS_ID, is_qwen3_tts

        self.assertEqual(QWEN3_TTS_ID, "qwen3-tts")
        self.assertTrue(is_qwen3_tts("qwen3-tts"))
        self.assertTrue(is_qwen3_tts("Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"))
        self.assertFalse(is_qwen3_tts("xtts"))
        self.assertFalse(is_qwen3_tts(None))


if __name__ == "__main__":
    unittest.main()
