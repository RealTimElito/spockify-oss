"""Open Jealousy catalog, graphs, and stuck-job rule. No Comfy and no GPU."""

from __future__ import annotations

import asyncio
import os
import tempfile
import unittest

import image_gen
import image_models
import open_jealousy
import video_gen


_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
    b"\x00\x00\x00\x03\x00\x01\x00\x05\xfe\xd4\xef\x00\x00\x00\x00IEND\xaeB`\x82"
)


class CatalogTests(unittest.TestCase):
    def tearDown(self) -> None:
        os.environ.pop("SPOCKIFY_IMAGE_MODELS_ROOT", None)

    def test_illustrious_absent_until_the_checkpoint_exists(self) -> None:
        with self.assertRaises(image_models.UnknownImageModel):
            image_models.resolve_image_model("illustrious-xl")
        self.assertIsNone(open_jealousy.illustrious_catalog_row())

    def test_illustrious_row_and_lora_slot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ckpt = os.path.join(tmp, "checkpoints")
            loras = os.path.join(tmp, "loras")
            os.makedirs(ckpt)
            os.makedirs(loras)
            open(os.path.join(ckpt, "illustriousXL_v01.safetensors"), "w").close()
            open(os.path.join(loras, "doc.safetensors"), "w").close()
            os.environ["SPOCKIFY_IMAGE_MODELS_ROOT"] = tmp
            ids = [item["id"] for item in image_models.list_runnable_image_models()]
            self.assertIn(open_jealousy.ILLUSTRIOUS_ID, ids)
            self.assertNotIn("illustriousXL_v01.safetensors", ids)
            self.assertEqual(
                image_models.resolve_image_model("Illustrious-XL"),
                open_jealousy.ILLUSTRIOUS_ID,
            )
            scan = open_jealousy.scan_open_jealousy()
            style = scan["style_lora"]
            self.assertEqual(style["id"], "frank-cafe")
            self.assertFalse(style["installed"])
            doc = open_jealousy.resolve_lora("doc", scan)
            self.assertEqual(doc["file"], "doc.safetensors")
            with self.assertRaises(ValueError) as ctx:
                open_jealousy.resolve_lora("frank-cafe", scan)
            self.assertIn("Frank café", str(ctx.exception))

    def test_wan_end_frame_is_rejected_without_flf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["SPOCKIFY_IMAGE_MODELS_ROOT"] = tmp
            with self.assertRaises(video_gen.VideoGenError) as ctx:
                asyncio.run(
                    video_gen.enqueue_video(
                        prompt="a cel walk",
                        model="wan2.2-ti2v-5b",
                        end_image=_PNG,
                    )
                )
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertIn("FLF2V", str(ctx.exception))

    def test_flf_workflow_wires_end_image(self) -> None:
        workflow = video_gen.select_workflow(
            image_models.WAN21_FLF_ID, image="start.png"
        )
        workflow["_spockify_end_image"] = "end.png"
        video_gen.apply_workflow(
            workflow,
            prompt="walk to the door",
            model=image_models.WAN21_FLF_ID,
            width=1280,
            height=720,
            length=33,
            steps=20,
            seed=1,
            image="start.png",
        )
        self.assertEqual(workflow["52"]["inputs"]["image"], "start.png")
        self.assertEqual(workflow["72"]["inputs"]["image"], "end.png")
        self.assertEqual(workflow["83"]["class_type"], "WanFirstLastFrameToVideo")
        self.assertNotIn("_spockify_end_image", workflow)

    def test_talk_alias_points_at_the_dedicated_route(self) -> None:
        with self.assertRaises(video_gen.VideoGenError) as ctx:
            asyncio.run(
                video_gen.enqueue_video(prompt="hello", model="liveportrait")
            )
        self.assertIn("/v1/videos/talking-head", str(ctx.exception))


class GraphTests(unittest.TestCase):
    def test_illustrious_graph_chains_lora_and_control(self) -> None:
        graph = open_jealousy.build_illustrious_workflow(
            ckpt="illustriousXL_v01.safetensors",
            prompt="doc at the counter",
            negative="blurry",
            width=1024,
            height=1024,
            steps=28,
            seed=1,
            loras=[{"file": "doc.safetensors", "strength": 0.8}],
            control="openpose",
            control_image="pose.png",
            control_union=True,
        )
        self.assertEqual(graph["4"]["inputs"]["ckpt_name"], "illustriousXL_v01.safetensors")
        self.assertEqual(graph["20"]["class_type"], "LoraLoader")
        self.assertEqual(graph["3"]["inputs"]["cfg"], 6.0)
        self.assertEqual(graph["3"]["inputs"]["steps"], 28)
        self.assertEqual(graph["33"]["class_type"], "ControlNetApplyAdvanced")
        self.assertEqual(graph["34"]["inputs"]["type"], "openpose")
        self.assertEqual(graph["6"]["inputs"]["clip"], ["20", 1])

    def test_faceid_nodes(self) -> None:
        graph = open_jealousy.build_illustrious_workflow(
            ckpt="illustriousXL_v01.safetensors",
            prompt="frank",
            negative="",
            width=832,
            height=1216,
            steps=20,
            seed=2,
            identity="faceid",
            identity_image="face.png",
        )
        self.assertEqual(graph["42"]["class_type"], "IPAdapterFaceID")
        self.assertEqual(graph["3"]["inputs"]["model"], ["42", 0])

    def test_size_clamp(self) -> None:
        self.assertEqual(open_jealousy.clamp_illustrious_size(2048, 2048), (1216, 1216))

    def test_lips_and_talk_graphs(self) -> None:
        lips = open_jealousy.build_lipsync_workflow(video="a.mp4", audio="b.wav")
        self.assertEqual(lips["1"]["class_type"], "SpockifyLatentSync")
        talk = open_jealousy.build_talking_head_workflow(
            image="still.png", audio="vo.wav", prompt="hi"
        )
        self.assertEqual(talk["1"]["class_type"], "SpockifyTalkingHead")


class StuckTests(unittest.TestCase):
    def test_low_progress_without_change_is_stuck(self) -> None:
        watch = open_jealousy.StuckWatch("stills")
        watch.observe(value=2, maximum=20)
        watch.window_s = 0
        watch.last_move -= 1
        self.assertTrue(watch.observe(value=2, maximum=20))
        self.assertIn("10%", watch.reason)

    def test_moving_progress_is_not_stuck(self) -> None:
        watch = open_jealousy.StuckWatch("ltx")
        watch.window_s = 0
        self.assertFalse(watch.observe(value=1, maximum=20))
        self.assertFalse(watch.observe(value=8, maximum=20))
        self.assertGreater(watch.display, 10)

    def test_mid_progress_freeze_is_stuck(self) -> None:
        """Wan FLF ~78%/2400s no-MP4: mid-sample freeze must interrupt."""
        watch = open_jealousy.StuckWatch("wan")
        watch.window_s = 0
        # display ≈ 78 → raw ≈ 0.80
        watch.observe(value=16, maximum=20)
        watch.last_move -= 100
        self.assertTrue(watch.observe(value=16, maximum=20))
        self.assertIn("frozen", watch.reason)

    def test_mid_progress_ws_silence_is_stuck(self) -> None:
        watch = open_jealousy.StuckWatch("wan")
        watch.window_s = 0
        watch.observe(value=16, maximum=20)
        watch.last_move -= 100
        self.assertTrue(watch.observe(value=None, maximum=None))
        self.assertIn("frozen", watch.reason)

    def test_decode_phase_silence_does_not_fail(self) -> None:
        """Near-complete sampler (raw≥0.98) may be silent during VAE decode."""
        watch = open_jealousy.StuckWatch("wan")
        watch.window_s = 0
        watch.observe(value=20, maximum=20)
        watch.last_move -= 100
        self.assertFalse(watch.observe(value=None, maximum=None))
        self.assertFalse(watch.stuck)


class PolicyTests(unittest.TestCase):
    def test_frozen_dialogue_uses_latentsync(self) -> None:
        import series_prod

        policy = series_prod.catalog_policy()
        self.assertTrue(policy["production"]["lip_sync"])
        self.assertTrue(policy["production"]["paths"]["dialogue"]["lip_sync"])
        self.assertTrue(policy["open_jealousy"]["lip_sync_in_scope"])
        self.assertTrue(policy["open_jealousy"]["frozen_dialogue_lip_sync"])
        self.assertFalse(policy["open_jealousy"]["frozen_dialogue_unchanged"])
        self.assertIn("wav2lip", policy["production"]["out_of_scope"])
        self.assertNotIn("latentsync", policy["production"]["out_of_scope"])


class ImageRejectTests(unittest.TestCase):
    def test_missing_cafe_lora_is_400(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "checkpoints"))
            open(
                os.path.join(tmp, "checkpoints", "illustriousXL_v01.safetensors"),
                "w",
            ).close()
            os.environ["SPOCKIFY_IMAGE_MODELS_ROOT"] = tmp
            try:
                with self.assertRaises(image_gen.ImageGenError) as ctx:
                    asyncio.run(
                        image_gen.generate_images(
                            prompt="café counter",
                            model="illustrious-xl",
                            style_lora="frank-cafe",
                        )
                    )
                self.assertEqual(ctx.exception.status_code, 400)
                self.assertIn("Frank café", str(ctx.exception))
            finally:
                os.environ.pop("SPOCKIFY_IMAGE_MODELS_ROOT", None)


if __name__ == "__main__":
    unittest.main()
