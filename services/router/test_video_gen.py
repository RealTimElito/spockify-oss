"""Video request shaping. Does not call ComfyUI."""

from __future__ import annotations

import asyncio
import copy
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import video_gen
from image_models import DEFAULT_VIDEO_ID, UnknownImageModel, resolve_video_model


def _isolate_video_store(testcase: unittest.TestCase) -> Path:
    """Point video store at a temp dir so tests do not load prod jobs."""
    root = Path(tempfile.mkdtemp(prefix="spockify-video-test-"))
    testcase.addCleanup(lambda: __import__("shutil").rmtree(root, ignore_errors=True))
    video_gen._CLIPS.clear()
    video_gen._JOB_TASKS.clear()
    video_gen._STORE_LOADED = False
    testcase.addCleanup(video_gen._CLIPS.clear)
    testcase.addCleanup(video_gen._JOB_TASKS.clear)
    prev_store = video_gen._VIDEO_STORE
    prev_loaded = video_gen._STORE_LOADED
    video_gen._VIDEO_STORE = root

    def _restore() -> None:
        video_gen._VIDEO_STORE = prev_store
        video_gen._STORE_LOADED = False
        video_gen._CLIPS.clear()

    testcase.addCleanup(_restore)
    return root

# 1x1 PNG.
_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class VideoRequestTests(unittest.TestCase):
    def test_default_model_when_catalog_empty(self) -> None:
        self.assertEqual(resolve_video_model(None, []), DEFAULT_VIDEO_ID)
        self.assertEqual(
            resolve_video_model(DEFAULT_VIDEO_ID, []),
            DEFAULT_VIDEO_ID,
        )

    def test_catalog_accepts_runnable_checkpoint(self) -> None:
        catalog = [
            {
                "id": DEFAULT_VIDEO_ID,
                "runnable": True,
                "missing": [],
            }
        ]
        self.assertEqual(resolve_video_model(DEFAULT_VIDEO_ID, catalog), DEFAULT_VIDEO_ID)
        with self.assertRaises(UnknownImageModel):
            resolve_video_model("sora-2", catalog)

    def test_snap_length_and_workflow(self) -> None:
        self.assertEqual(video_gen.snap_length(None), 65)
        self.assertEqual(video_gen.snap_length("1"), 25)
        workflow = copy.deepcopy(video_gen._WORKFLOW)
        video_gen.apply_workflow(
            workflow,
            prompt="a red cube",
            model=DEFAULT_VIDEO_ID,
            width=704,
            height=480,
            length=25,
            steps=8,
            seed=7,
            fps=16,
        )
        self.assertEqual(workflow["2"]["inputs"]["text"], "a red cube")
        self.assertEqual(workflow["1"]["inputs"]["ckpt_name"], DEFAULT_VIDEO_ID)
        self.assertEqual(workflow["5"]["inputs"]["length"], 25)
        self.assertEqual(workflow["9"]["inputs"]["noise_seed"], 7)
        self.assertEqual(workflow["4"]["inputs"]["frame_rate"], 16.0)
        self.assertEqual(workflow["11"]["inputs"]["fps"], 16.0)

    def test_fps_audio_extend_contracts(self) -> None:
        from image_models import MINIMAX_H3_ID, WAN22_T2V_ID

        self.assertEqual(video_gen.resolve_fps(None, model_name=DEFAULT_VIDEO_ID), (24, None))
        self.assertEqual(video_gen.resolve_fps(16, model_name=DEFAULT_VIDEO_ID), (16, None))
        # Unsupported fps snaps to nearest allowed (Wan 16-only).
        self.assertEqual(video_gen.resolve_fps(50, model_name=DEFAULT_VIDEO_ID), (24, 50))
        self.assertEqual(video_gen.resolve_fps(24, model_name=WAN22_T2V_ID), (16, 24))
        # 48fps is not in any local catalog (H3 is 24fps FLOW_AV; Layout unproven).
        self.assertEqual(video_gen.resolve_fps(48, model_name=DEFAULT_VIDEO_ID), (24, 48))
        self.assertEqual(video_gen.resolve_fps(48, model_name=MINIMAX_H3_ID), (24, 48))
        self.assertEqual(video_gen.resolve_fps(48, model_name=WAN22_T2V_ID), (16, 48))
        self.assertEqual(video_gen.resolve_audio(None, model_name=MINIMAX_H3_ID), (True, False))
        self.assertEqual(video_gen.resolve_audio(False, model_name=MINIMAX_H3_ID), (False, False))
        # Unsupported audio=true is ignored, not 400.
        self.assertEqual(video_gen.resolve_audio(True, model_name=DEFAULT_VIDEO_ID), (False, True))
        self.assertTrue(video_gen.extend_supported(DEFAULT_VIDEO_ID))
        self.assertFalse(video_gen.extend_supported(WAN22_T2V_ID))

        mm = copy.deepcopy(video_gen._MINIMAX_WORKFLOW)
        video_gen.apply_workflow(
            mm,
            prompt="cube",
            model=MINIMAX_H3_ID,
            width=704,
            height=480,
            length=39,
            steps=20,
            seed=1,
            fps=24,
            with_audio=False,
        )
        self.assertNotIn("12", mm)
        self.assertNotIn("audio", mm["13"]["inputs"])

        keep = copy.deepcopy(video_gen._MINIMAX_WORKFLOW)
        video_gen.apply_workflow(
            keep,
            prompt="cube",
            model=MINIMAX_H3_ID,
            width=704,
            height=480,
            length=39,
            steps=20,
            seed=1,
            fps=24,
            with_audio=True,
        )
        self.assertEqual(keep["12"]["class_type"], "VAEDecodeAudio")
        self.assertEqual(keep["13"]["inputs"]["audio"], ["12", 0])

    def test_video_poll_budget_above_image(self) -> None:
        from image_gen import POLL_TIMEOUT_S
        from image_models import MINIMAX_H3_ID

        self.assertGreaterEqual(video_gen.VIDEO_H3_POLL_TIMEOUT_S, 21600)
        self.assertGreaterEqual(video_gen.VIDEO_POLL_TIMEOUT_S, 2400)
        self.assertEqual(
            video_gen.video_poll_timeout_s(MINIMAX_H3_ID),
            video_gen.VIDEO_H3_POLL_TIMEOUT_S,
        )
        self.assertEqual(
            video_gen.video_poll_timeout_s(DEFAULT_VIDEO_ID),
            video_gen.VIDEO_POLL_TIMEOUT_S,
        )
        self.assertLess(POLL_TIMEOUT_S, video_gen.VIDEO_H3_POLL_TIMEOUT_S)

    def test_decode_multipart_image_bytes(self) -> None:
        jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
        data, mime = video_gen.decode_input_reference(jpeg)
        self.assertEqual(mime, "image/jpeg")
        self.assertEqual(data, jpeg)
        png, png_mime = video_gen.decode_input_reference(
            f"data:image/png;base64,{_PNG_B64}"
        )
        self.assertEqual(png_mime, "image/png")
        self.assertTrue(png.startswith(b"\x89PNG"))

    def test_minimax_seconds_and_size_limits(self) -> None:
        from image_models import MINIMAX_H3_ID

        self.assertGreater(
            video_gen.snap_length(15, model_name=MINIMAX_H3_ID),
            video_gen.snap_length(10, model_name=MINIMAX_H3_ID),
        )
        with self.assertRaises(video_gen.VideoGenError):
            video_gen.snap_length(16, model_name=MINIMAX_H3_ID)
        self.assertEqual(
            video_gen.parse_size("1344x768", model_name=MINIMAX_H3_ID),
            (1344, 768),
        )
        self.assertEqual(
            video_gen.parse_size("1920x1088", model_name=MINIMAX_H3_ID),
            (1920, 1088),
        )
        # 1920x1080 is not /32; nearest 1080p stand-in is 1920x1088.
        self.assertEqual(
            video_gen.parse_size("1920x1080", model_name=MINIMAX_H3_ID),
            (1920, 1088),
        )
        with self.assertRaises(video_gen.VideoGenError):
            video_gen.parse_size("2048x1152", model_name=MINIMAX_H3_ID)
        # 1280x720 is not /32; snap to 1280x704.
        self.assertEqual(
            video_gen.parse_size("1280x720", model_name=MINIMAX_H3_ID),
            (1280, 704),
        )

    def test_hd_size_and_fps_clamp(self) -> None:
        from image_models import (
            LTX25_LAYOUT_ID,
            LTX25_UNION_CONTROL_ID,
            MINIMAX_H3_ID,
            WAN22_TI2V_5B_ID,
            WAN22_T2V_ID,
            video_limits_for,
        )

        # Layout 1920x1080 is not /64; nearest 1080p stand-in is 1920x1088.
        self.assertEqual(
            video_gen.parse_size("1920x1080", model_name=LTX25_LAYOUT_ID),
            (1920, 1088),
        )
        # H3 1920x1080 is not /32; nearest 1080p stand-in is 1920x1088.
        self.assertEqual(
            video_gen.parse_size("1920x1080", model_name=MINIMAX_H3_ID),
            (1920, 1088),
        )
        self.assertEqual(
            video_gen.parse_size("1920x1088", model_name=LTX25_LAYOUT_ID),
            (1920, 1088),
        )
        self.assertEqual(
            video_gen.parse_size("1280x720", model_name=LTX25_LAYOUT_ID),
            (1280, 704),
        )
        self.assertEqual(
            video_gen.parse_size("1280x768", model_name=LTX25_LAYOUT_ID),
            (1280, 768),
        )
        # Catalog chips stay on-grid; 1280x720 / 1920x1080 are not advertised.
        layout = video_limits_for("ltx-2.5-layout-to-render")
        self.assertIn("1920x1088", layout["sizes"])
        self.assertIn("1280x704", layout["sizes"])
        self.assertIn("1280x768", layout["sizes"])
        self.assertNotIn("1280x720", layout["sizes"])
        self.assertNotIn("1920x1080", layout["sizes"])
        self.assertEqual(layout["fps"], [16, 24, 48])
        self.assertEqual(layout["default_fps"], 24)
        self.assertEqual(
            video_gen.resolve_fps(48, model_name=LTX25_LAYOUT_ID),
            (48, None),
        )
        self.assertEqual(
            video_gen.resolve_fps(None, model_name=LTX25_LAYOUT_ID),
            (24, None),
        )
        # 2s @ 48fps on 8n+1 is 97 frames (not a 24fps encode stamped 48).
        self.assertEqual(
            video_gen.snap_length(2, model_name=LTX25_LAYOUT_ID, fps=48),
            97,
        )
        self.assertEqual(
            video_gen.snap_length(2, model_name=LTX25_LAYOUT_ID, fps=24),
            49,
        )

        h3 = video_limits_for("minimax-h3")
        self.assertIn("1280x704", h3["sizes"])
        self.assertIn("1344x768", h3["sizes"])
        self.assertIn("1920x1088", h3["sizes"])
        self.assertNotIn("1280x720", h3["sizes"])
        self.assertNotIn("1920x1080", h3["sizes"])
        self.assertEqual(h3["default_size"], "1920x1088")
        self.assertNotIn(48, h3["fps"])
        # H3 1s @ catalog 24fps snaps to 17k+5 (39), not a 48-frame latent.
        self.assertEqual(
            video_gen.snap_length(1, model_name=MINIMAX_H3_ID, fps=24),
            39,
        )

        union = video_limits_for("ltx-2.5-union-control")
        self.assertIn("1920x1024", union["sizes"])
        self.assertIn("1280x768", union["sizes"])
        self.assertNotIn("1280x720", union["sizes"])
        self.assertEqual(union["fps"], [16, 24, 48])
        self.assertEqual(union["default_fps"], 24)
        self.assertEqual(
            video_gen.resolve_fps(48, model_name=LTX25_UNION_CONTROL_ID),
            (48, None),
        )

        # Wan TI2V 720p stand-in stays 1280x704 @ 16fps.
        self.assertEqual(
            video_gen.parse_size("1280x704", model_name=WAN22_TI2V_5B_ID),
            (1280, 704),
        )
        self.assertEqual(
            video_gen.parse_size("640x640", model_name=WAN22_T2V_ID),
            (640, 640),
        )
        self.assertEqual(video_gen.resolve_fps(48, model_name=WAN22_TI2V_5B_ID), (16, 48))

    def test_i2v_workflow_takes_uploaded_name(self) -> None:
        workflow = copy.deepcopy(video_gen._I2V_WORKFLOW)
        video_gen.apply_workflow(
            workflow,
            prompt="move the cube",
            model=DEFAULT_VIDEO_ID,
            width=704,
            height=480,
            length=25,
            steps=8,
            seed=3,
            image="video_abc.png",
        )
        self.assertEqual(workflow["5"]["class_type"], "LTXVImgToVideo")
        self.assertEqual(workflow["13"]["inputs"]["image"], "video_abc.png")
        self.assertEqual(workflow["5"]["inputs"]["length"], 25)

    def test_decode_png_data_url(self) -> None:
        data, mime = video_gen.decode_input_reference(f"data:image/png;base64,{_PNG_B64}")
        self.assertEqual(mime, "image/png")
        self.assertTrue(data.startswith(b"\x89PNG"))
        self.assertIsNone(video_gen.decode_input_reference(None))
        self.assertIsNone(video_gen.decode_input_reference("  "))
        with self.assertRaises(video_gen.VideoGenError):
            video_gen.decode_input_reference("not-an-image")

    def test_catalog_workflows_select(self) -> None:
        from image_models import (
            LTX25_FAST_ID,
            LTX25_LAYOUT_ID,
            WAN22_TI2V_5B_ID,
            WAN22_T2V_ID,
        )

        ltx = video_gen.select_workflow(LTX25_FAST_ID)
        self.assertEqual(ltx["1"]["class_type"], "UNETLoader")
        video_gen.apply_workflow(
            ltx,
            prompt="cube",
            model=LTX25_FAST_ID,
            width=704,
            height=480,
            length=25,
            steps=8,
            seed=1,
        )
        self.assertEqual(ltx["2"]["inputs"]["text"], "cube")

        layout = video_gen.select_workflow(LTX25_LAYOUT_ID, image="look.png")
        self.assertEqual(layout["iclora"]["class_type"], "LTXICLoRALoaderModelOnly")
        self.assertEqual(layout["upsamp"]["class_type"], "LTXVLatentUpsampler")
        with self.assertRaises(video_gen.VideoGenError):
            video_gen.apply_workflow(
                layout,
                prompt="street",
                model=LTX25_LAYOUT_ID,
                width=1920,
                height=1088,
                length=25,
                steps=8,
                seed=1,
                image=None,
            )
        video_gen.apply_workflow(
            layout,
            prompt="street",
            model=LTX25_LAYOUT_ID,
            width=1920,
            height=1088,
            length=25,
            steps=8,
            seed=1,
            image="look.png",
        )
        self.assertEqual(layout["look"]["inputs"]["image"], "look.png")
        self.assertEqual(layout["clay"]["inputs"]["image"], "look.png")
        # Two-stage: stage-1 latent runs at half the final size.
        self.assertEqual(layout["empty"]["inputs"]["width"], 960)
        self.assertEqual(layout["empty"]["inputs"]["height"], 544)

        # Dual-input: clay video swaps the clay node for LoadVideo + components.
        dual = video_gen.select_workflow(LTX25_LAYOUT_ID, image="look.png")
        video_gen.apply_workflow(
            dual,
            prompt="street",
            model=LTX25_LAYOUT_ID,
            width=1280,
            height=704,
            length=49,
            steps=8,
            seed=1,
            image="look.png",
            clay_video="clay.mp4",
        )
        self.assertEqual(dual["clay"]["class_type"], "LoadVideo")
        self.assertEqual(dual["clay"]["inputs"]["file"], "clay.mp4")
        self.assertEqual(dual["claycomp"]["class_type"], "GetVideoComponents")
        self.assertEqual(dual["g1a"]["inputs"]["image"], ["claycomp", 0])
        self.assertEqual(dual["g2a"]["inputs"]["image"], ["claycomp", 0])
        self.assertEqual(dual["look"]["inputs"]["image"], "look.png")

        # Union Control: one control guide per stage, control clip required.
        from image_models import LTX25_UNION_CONTROL_ID

        union = video_gen.select_workflow(LTX25_UNION_CONTROL_ID)
        self.assertEqual(union["iclora"]["class_type"], "LTXICLoRALoaderModelOnly")
        self.assertEqual(union["ctrl"]["class_type"], "LoadVideo")
        self.assertEqual(union["g1"]["inputs"]["image"], ["ctrlcomp", 0])
        with self.assertRaises(video_gen.VideoGenError):
            video_gen.apply_workflow(
                union,
                prompt="walk",
                model=LTX25_UNION_CONTROL_ID,
                width=1280,
                height=768,
                length=49,
                steps=8,
                seed=1,
                clay_video=None,
            )
        video_gen.apply_workflow(
            union,
            prompt="walk",
            model=LTX25_UNION_CONTROL_ID,
            width=1280,
            height=768,
            length=49,
            steps=8,
            seed=1,
            clay_video="ctrl.mp4",
        )
        self.assertEqual(union["ctrl"]["inputs"]["file"], "ctrl.mp4")
        self.assertEqual(union["pos_enc"]["inputs"]["text"], "walk")
        # Two-stage: stage-1 latent runs at half the final size.
        self.assertEqual(union["empty"]["inputs"]["width"], 640)
        self.assertEqual(union["empty"]["inputs"]["height"], 384)
        # /128 snapping for the IC-LoRA patchify (nearest, not floor).
        self.assertEqual(
            video_gen.parse_size("1280x768", model_name=LTX25_UNION_CONTROL_ID),
            (1280, 768),
        )
        self.assertEqual(
            video_gen.parse_size("1280x720", model_name=LTX25_UNION_CONTROL_ID),
            (1280, 768),
        )
        self.assertEqual(
            video_gen.parse_size("1920x1024", model_name=LTX25_UNION_CONTROL_ID),
            (1920, 1024),
        )
        self.assertEqual(
            video_gen.parse_size("1920x1080", model_name=LTX25_UNION_CONTROL_ID),
            (1920, 1024),
        )

        wan = video_gen.select_workflow(WAN22_T2V_ID)
        self.assertEqual(wan["96"]["class_type"], "KSamplerAdvanced")
        ti2v = video_gen.select_workflow(WAN22_TI2V_5B_ID, image="still.png")
        self.assertIn("56", ti2v)
        self.assertEqual(ti2v["55"]["class_type"], "Wan22ImageToVideoLatent")


class ListVideosTests(unittest.TestCase):
    def setUp(self) -> None:
        _isolate_video_store(self)

    def test_list_videos_newest_first_truncates_prompt(self) -> None:
        video_gen._remember(
            "video_old",
            {
                "meta": {
                    "id": "video_old",
                    "status": "completed",
                    "created_at": 10,
                    "prompt": "x" * 100,
                    "progress": 100,
                },
                "mp4": None,
            },
        )
        video_gen._remember(
            "video_new",
            {
                "meta": {
                    "id": "video_new",
                    "status": "queued",
                    "created_at": 20,
                    "prompt": "short",
                    "progress": 0,
                },
                "mp4": None,
            },
        )
        rows = video_gen.list_videos(prompt_limit=20)
        self.assertEqual([row["id"] for row in rows], ["video_new", "video_old"])
        self.assertEqual(rows[0]["prompt"], "short")
        self.assertTrue(rows[1]["prompt"].endswith("..."))
        self.assertLessEqual(len(rows[1]["prompt"]), 20)


class EnqueueTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        _isolate_video_store(self)

    async def test_enqueue_returns_queued_without_comfy(self) -> None:
        queued = {"hit": False}

        async def catalog(_client):
            return [{"id": DEFAULT_VIDEO_ID, "runnable": True, "missing": []}]

        async def generate_job(*_args, **_kwargs):
            return

        async def queue_prompt(*_args, **_kwargs):
            queued["hit"] = True
            raise AssertionError("Comfy was called from enqueue")

        with (
            mock.patch.object(video_gen, "_catalog", catalog),
            mock.patch.object(video_gen, "_generate_job", generate_job),
            mock.patch.object(video_gen, "_queue_prompt", queue_prompt),
        ):
            meta = await video_gen.enqueue_video(
                prompt="a red cube on a table",
                seconds=1,
            )
        self.assertEqual(meta["status"], "queued")
        self.assertEqual(meta["model"], DEFAULT_VIDEO_ID)
        self.assertTrue(meta["id"].startswith("video_"))
        self.assertNotIn("b64_json", meta)
        self.assertFalse(queued["hit"])
        stored = video_gen.get_video(meta["id"])
        self.assertEqual(stored["status"], "queued")
        with self.assertRaises(video_gen.VideoGenError) as ctx:
            video_gen.get_video_bytes(meta["id"])
        self.assertEqual(ctx.exception.status_code, 409)
        if video_gen._TASKS:
            await asyncio.gather(*list(video_gen._TASKS))

    async def test_union_control_reference_routing(self) -> None:
        import base64

        from image_models import DEFAULT_VIDEO_ID, LTX25_UNION_CONTROL_ID

        # Minimal fake mp4 (ftyp box at offset 4, padded over the size floor).
        mp4 = base64.b64encode(
            b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 56
        ).decode()

        async def catalog(_client):
            return [
                {"id": DEFAULT_VIDEO_ID, "runnable": True, "missing": []},
                {
                    "id": LTX25_UNION_CONTROL_ID,
                    "runnable": True,
                    "api_ready": True,
                    "missing": [],
                    "aliases": ["union-control"],
                },
            ]

        async def generate_job(*_args, **_kwargs):
            return

        with (
            mock.patch.object(video_gen, "_catalog", catalog),
            mock.patch.object(video_gen, "_generate_job", generate_job),
        ):
            # control_reference on a non-union model is rejected.
            with self.assertRaises(video_gen.VideoGenError) as ctx:
                await video_gen.enqueue_video(
                    prompt="cube", control_reference=mp4
                )
            self.assertEqual(ctx.exception.status_code, 400)

            # Union control without a control clip is rejected.
            with self.assertRaises(video_gen.VideoGenError) as ctx:
                await video_gen.enqueue_video(
                    prompt="cube", model=LTX25_UNION_CONTROL_ID
                )
            self.assertEqual(ctx.exception.status_code, 400)

            # With a control clip it queues and flags control_reference.
            meta = await video_gen.enqueue_video(
                prompt="a walking character",
                model=LTX25_UNION_CONTROL_ID,
                control_reference=mp4,
                seconds=1,
            )
        self.assertEqual(meta["status"], "queued")
        self.assertEqual(meta["model"], LTX25_UNION_CONTROL_ID)
        self.assertTrue(meta.get("control_reference"))
        self.assertNotIn("clay_reference", meta)
        if video_gen._TASKS:
            await asyncio.gather(*list(video_gen._TASKS))


class _MemFile:
    def __init__(self, data: bytes, filename: str = "look.jpg") -> None:
        self.filename = filename
        self._data = data

    async def read(self) -> bytes:
        return self._data


class MultipartAndCancelTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        _isolate_video_store(self)

    async def test_form_look_still_bytes(self) -> None:
        jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
        form = {
            "prompt": "labrats plaza",
            "input_reference": _MemFile(jpeg),
            "audio": "true",
        }
        kwargs = await video_gen.kwargs_from_video_form(form)
        self.assertEqual(kwargs["prompt"], "labrats plaza")
        self.assertTrue(kwargs["audio"])
        data, mime = video_gen.decode_input_reference(kwargs["input_reference"])
        self.assertEqual(mime, "image/jpeg")
        self.assertEqual(data[:3], b"\xff\xd8\xff")

    async def test_multipart_endpoint_does_not_500(self) -> None:
        app = FastAPI()

        @app.post("/v1/videos")
        async def create(request: Request):
            try:
                kwargs = await video_gen.request_kwargs_from_http(request)
                image = video_gen.decode_input_reference(kwargs.get("input_reference"))
            except video_gen.VideoGenError as exc:
                return {"ok": False, "status": exc.status_code, "error": str(exc)}
            return {
                "ok": True,
                "prompt": kwargs.get("prompt"),
                "mime": None if image is None else image[1],
                "nbytes": 0 if image is None else len(image[0]),
            }

        jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
        client = TestClient(app)
        resp = client.post(
            "/v1/videos",
            data={"prompt": "look still plaza", "seconds": "4"},
            files={"input_reference": ("look.jpg", jpeg, "image/jpeg")},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["mime"], "image/jpeg")
        json_resp = client.post(
            "/v1/videos",
            json={
                "prompt": "json still",
                "input_reference": f"data:image/png;base64,{_PNG_B64}",
            },
        )
        self.assertEqual(json_resp.status_code, 200, json_resp.text)
        self.assertEqual(json_resp.json()["mime"], "image/png")

    async def test_cancel_queued_job(self) -> None:
        started = asyncio.Event()
        released = asyncio.Event()

        async def catalog(_client):
            return [{"id": DEFAULT_VIDEO_ID, "runnable": True, "missing": []}]

        async def stuck_render(**_kwargs):
            started.set()
            await released.wait()
            return b"not-used"

        interrupts = []

        async def capture_interrupt(client=None, prompt_id=None):
            interrupts.append(prompt_id)

        with (
            mock.patch.object(video_gen, "_catalog", catalog),
            mock.patch.object(video_gen, "_render", stuck_render),
            mock.patch.object(video_gen, "interrupt_comfy", capture_interrupt),
        ):
            meta = await video_gen.enqueue_video(prompt="a red cube", seconds=1)
            await asyncio.wait_for(started.wait(), timeout=2)
            cancelled = await video_gen.cancel_video(meta["id"])
            self.assertEqual(cancelled["status"], "cancelled")
            released.set()
            if video_gen._TASKS:
                await asyncio.gather(*list(video_gen._TASKS), return_exceptions=True)
        stored = video_gen.get_video(meta["id"])
        self.assertEqual(stored["status"], "cancelled")
        self.assertTrue(interrupts)

    async def test_serialize_one_render_at_a_time(self) -> None:
        running = 0
        max_running = 0

        async def catalog(_client):
            return [{"id": DEFAULT_VIDEO_ID, "runnable": True, "missing": []}]

        async def slow_render(**_kwargs):
            nonlocal running, max_running
            running += 1
            max_running = max(max_running, running)
            await asyncio.sleep(0.05)
            running -= 1
            return b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64

        with (
            mock.patch.object(video_gen, "_catalog", catalog),
            mock.patch.object(video_gen, "_render", slow_render),
            mock.patch.object(video_gen, "_extract_last_frame_jpeg", lambda _mp4: b"x" * 40),
        ):
            first = await video_gen.enqueue_video(prompt="cube one", seconds=1)
            second = await video_gen.enqueue_video(prompt="cube two", seconds=1)
            if video_gen._TASKS:
                await asyncio.gather(*list(video_gen._TASKS))
        self.assertEqual(max_running, 1)
        self.assertEqual(video_gen.get_video(first["id"])["status"], "completed")
        self.assertEqual(video_gen.get_video(second["id"])["status"], "completed")

    async def test_wait_timeout_interrupts_comfy(self) -> None:
        hits = []

        async def wait_timeout(*_args, **_kwargs):
            raise video_gen.ImageGenError("timed out after 1s", 504)

        async def queue_ok(*_args, **_kwargs):
            return "pid-1"

        async def capture(client=None, prompt_id=None):
            hits.append(prompt_id)

        with (
            mock.patch.object(video_gen, "_wait_history", wait_timeout),
            mock.patch.object(video_gen, "_queue_prompt", queue_ok),
            mock.patch.object(video_gen, "interrupt_comfy", capture),
        ):
            with self.assertRaises(video_gen.VideoGenError) as ctx:
                await video_gen._render(
                    prompt="cube",
                    model_name=DEFAULT_VIDEO_ID,
                    width=704,
                    height=480,
                    length=25,
                    image=None,
                    video_id="video_test",
                )
        self.assertEqual(hits, ["pid-1"])
        self.assertEqual(ctx.exception.status_code, 504)
        self.assertIn("poll budget 2400", str(ctx.exception))


class VideoDisabledFlagTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        _isolate_video_store(self)

    def test_flag_reads_env(self) -> None:
        with mock.patch.dict(os.environ, {"SPOCKIFY_VIDEO_DISABLED": "1"}):
            self.assertTrue(video_gen.video_generation_disabled())
        with mock.patch.dict(os.environ, {"SPOCKIFY_VIDEO_DISABLED": "0"}):
            self.assertFalse(video_gen.video_generation_disabled())
        with mock.patch.dict(os.environ):
            os.environ.pop("SPOCKIFY_VIDEO_DISABLED", None)
            self.assertFalse(video_gen.video_generation_disabled())

    async def test_enqueue_returns_503_when_disabled(self) -> None:
        catalog = mock.AsyncMock()
        with (
            mock.patch.dict(os.environ, {"SPOCKIFY_VIDEO_DISABLED": "1"}),
            mock.patch.object(video_gen, "_catalog", catalog),
        ):
            with self.assertRaises(video_gen.VideoGenError) as ctx:
                await video_gen.enqueue_video(prompt="a red cube")
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertIn("temporarily disabled for maintenance", str(ctx.exception))
        catalog.assert_not_called()

    async def test_json_and_multipart_503_before_enqueue(self) -> None:
        enqueued = []
        app = FastAPI()

        @app.post("/v1/videos")
        async def create(request: Request):
            try:
                if video_gen.video_generation_disabled():
                    raise video_gen.VideoGenError(
                        "Video generation temporarily disabled for maintenance",
                        503,
                    )
                kwargs = await video_gen.request_kwargs_from_http(request)
                enqueued.append(kwargs)
                return {"id": "should-not"}
            except video_gen.VideoGenError as exc:
                raise HTTPException(
                    status_code=exc.status_code, detail=str(exc)
                ) from exc

        client = TestClient(app)
        jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
        with mock.patch.dict(os.environ, {"SPOCKIFY_VIDEO_DISABLED": "1"}):
            json_resp = client.post("/v1/videos", json={"prompt": "json still"})
            mp_resp = client.post(
                "/v1/videos",
                data={"prompt": "look still plaza", "seconds": "4"},
                files={"input_reference": ("look.jpg", jpeg, "image/jpeg")},
            )
        self.assertEqual(json_resp.status_code, 503, json_resp.text)
        self.assertIn("temporarily disabled", json_resp.json()["detail"])
        self.assertEqual(mp_resp.status_code, 503, mp_resp.text)
        self.assertIn("temporarily disabled", mp_resp.json()["detail"])
        self.assertEqual(enqueued, [])
