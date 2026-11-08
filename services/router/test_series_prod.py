"""Series product layer: mux, loudnorm, catalog A-camera, timeline (ffmpeg)."""

from __future__ import annotations

import asyncio
import json
import shutil
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

import series_prod
import video_gen
from image_models import EPISODE_A_CAMERA_ID, MINIMAX_H3_ID, video_limits_for
from test_video_gen import _isolate_video_store


def _isolate_series_root(testcase: unittest.TestCase) -> Path:
    root = Path(tempfile.mkdtemp(prefix="spockify-series-test-"))
    testcase.addCleanup(lambda: shutil.rmtree(root, ignore_errors=True))
    prev = series_prod.SERIES_ROOT
    series_prod.SERIES_ROOT = root
    testcase.addCleanup(lambda: setattr(series_prod, "SERIES_ROOT", prev))
    return root


def _png_header(width: int, height: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IEND", b"")


def _have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _ffmpeg_clip(path: Path, seconds: float = 1.0, size: str = "64x48") -> None:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=black:s={size}:d={seconds}:r=24",
        "-pix_fmt",
        "yuv420p",
        str(path),
    ]
    proc = __import__("subprocess").run(cmd, check=False, capture_output=True)
    if proc.returncode != 0 or not path.is_file():
        raise RuntimeError(proc.stderr.decode("utf-8", "replace")[:200])


def _ffmpeg_wav(path: Path, seconds: float = 1.0, freq: int = 440) -> None:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"sine=frequency={freq}:duration={seconds}",
        str(path),
    ]
    proc = __import__("subprocess").run(cmd, check=False, capture_output=True)
    if proc.returncode != 0 or not path.is_file():
        raise RuntimeError(proc.stderr.decode("utf-8", "replace")[:200])


class CatalogPolicyTests(unittest.TestCase):
    def test_a_camera_is_silent_layout(self) -> None:
        policy = series_prod.catalog_policy()
        self.assertEqual(policy["a_camera"]["id"], EPISODE_A_CAMERA_ID)
        self.assertEqual(policy["a_camera"]["size"], "1920x1088")
        self.assertFalse(policy["a_camera"]["audio"])
        self.assertTrue(policy["a_camera"]["audio_ignored"])
        self.assertEqual(policy["atmos_scratch"]["id"], MINIMAX_H3_ID)
        self.assertFalse(policy["audio_vae"]["wired"])
        self.assertEqual(policy["audio_vae"]["file"], "ltx-2.5-audio-vae-bf16.safetensors")
        self.assertIn("unwired", policy["audio_vae"]["reason"])
        self.assertIn("PuLID", policy["identity_gap"])
        self.assertFalse(policy["identity_lock"]["pulid"])
        self.assertEqual(policy["identity_lock"]["mode"], "look-still")
        self.assertEqual(policy["longer_master"]["latent_max_seconds"], 10)
        self.assertIn("concat", policy["longer_master"]["note"].lower())
        self.assertIn("not a 60s latent", policy["longer_master"]["note"].lower())
        self.assertEqual(policy["a_camera"]["max_seconds"], 10)
        self.assertIn("frank", policy["speakers"])
        self.assertIn("tim", policy["speakers"])
        prod = policy["production"]
        self.assertEqual(prod["series"], "labrats")
        self.assertTrue(prod["frozen"])
        self.assertFalse(prod["lip_sync"])
        self.assertEqual(prod["xtts_device"], "cpu")
        self.assertEqual(prod["h3_role"], "atmos-scratch")
        dialogue = prod["paths"]["dialogue"]
        self.assertFalse(dialogue["lip_sync"])
        self.assertIn("not lip-sync", dialogue["claim"].lower())
        self.assertIn("mouths do not track", dialogue["claim"].lower())
        self.assertEqual(dialogue["method"], "silent-layout-plate-plus-ffmpeg-mux")
        voice = prod["paths"]["voice_factory"]
        self.assertEqual(voice["engine_when_stem"], "xtts")
        self.assertFalse(voice["edge_fallback_when_stem"])
        self.assertEqual(voice["xtts_down"], 503)
        self.assertIn("no automated timbre", voice["accept"].lower())
        plates = prod["paths"]["silent_plates"]
        self.assertEqual(plates["model"], EPISODE_A_CAMERA_ID)
        self.assertEqual(plates["not_model"], MINIMAX_H3_ID)
        self.assertFalse(plates["audio"])
        self.assertTrue(plates["audio_ignored"])
        self.assertIn("wav2lip", prod["out_of_scope"])
        layout = video_limits_for("ltx-2.5-layout-to-render")
        self.assertEqual(layout["series_role"], "a-camera")
        self.assertEqual(video_limits_for("minimax-h3")["series_role"], "atmos-scratch")

    def test_identity_lock_uses_clay_and_union(self) -> None:
        from image_models import identity_lock_status

        none = identity_lock_status()
        self.assertFalse(none["pulid"])
        self.assertEqual(none["mode"], "none")
        clay = identity_lock_status(look_still=True, clay=True)
        self.assertEqual(clay["uses"], ["clay", "look-still"])
        union = identity_lock_status(control=True)
        self.assertEqual(union["uses"], ["union"])


class AssetIngestTests(unittest.TestCase):
    def setUp(self) -> None:
        _isolate_series_root(self)

    def test_look_still_rejects_off_grid(self) -> None:
        with self.assertRaises(series_prod.SeriesError) as ctx:
            series_prod.ingest_asset(
                kind="look-still",
                asset_id="doc-plaza",
                data=_png_header(1920, 1080),
                filename="look.png",
                grids=["layout"],
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_look_still_accepts_layout_grid(self) -> None:
        row = series_prod.ingest_asset(
            kind="look-still",
            asset_id="doc-plaza",
            data=_png_header(1920, 1088),
            filename="look.png",
            grids=["layout"],
        )
        self.assertEqual(row["width"], 1920)
        self.assertEqual(row["height"], 1088)
        self.assertIn("layout", row["legal_for"])
        self.assertIn("input_reference", row["feeds"] or "")


class SpeakerAndSfxTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        _isolate_series_root(self)

    def test_sfx_placeholders_and_slots(self) -> None:
        import wave

        registry = series_prod.ensure_sfx_store()
        payloads = set()
        for slot in ("nexo_beep", "engines", "crowd", "stall"):
            self.assertIn(slot, registry["slots"])
            path = Path(registry["slots"][slot]["path"])
            self.assertTrue(path.is_file())
            self.assertGreater(path.stat().st_size, 512)
            with wave.open(str(path), "r") as handle:
                self.assertGreater(handle.getnframes(), 1000)
                self.assertEqual(handle.getsampwidth(), 2)
            payloads.add(path.read_bytes())
        self.assertEqual(len(payloads), 4)

    def test_stall_decays(self) -> None:
        import array
        import wave

        series_prod.ensure_sfx_store()
        path = series_prod.sfx_path("stall")
        with wave.open(str(path), "r") as handle:
            frames = array.array("h")
            frames.frombytes(handle.readframes(handle.getnframes()))
        n = len(frames)
        self.assertGreater(n, 1000)
        head = sum(abs(x) for x in frames[: n // 5]) / max(1, n // 5)
        tail = sum(abs(x) for x in frames[-n // 5 :]) / max(1, n // 5)
        self.assertGreater(head, tail)

    def test_doc_speaker_without_clone(self) -> None:
        doc = series_prod.speaker_record("doc")
        self.assertEqual(doc["id"], "doc")
        self.assertFalse(doc["clone_ready"])
        self.assertIsNone(doc["clone_wav"])
        self.assertEqual(doc["edge_voice"], "en-US-GuyNeural")

    def test_labrats_roster_empty_slots(self) -> None:
        store = series_prod.ensure_speaker_store()
        for speaker_id in ("doc", "frank", "tim", "nexo", "pit"):
            row = store["speakers"][speaker_id]
            self.assertFalse(row["clone_ready"])
            self.assertIsNone(row["clone_wav"])
        wav = series_prod.series_root() / "clone.wav"
        series_prod.write_placeholder_wav(wav, 220, 0.4, amp=12000)
        extra = series_prod.ingest_speaker_sample("announcer", wav.read_bytes())
        self.assertEqual(extra["id"], "announcer")
        self.assertTrue(extra["clone_ready"])
        self.assertFalse(series_prod.speaker_record("doc")["clone_ready"])

    async def test_vo_falls_back_to_edge_tts(self) -> None:
        async def fake_edge(text: str, voice: str) -> bytes:
            self.assertEqual(voice, "en-US-GuyNeural")
            path = series_prod.series_root() / "tmp.wav"
            series_prod.write_placeholder_wav(path, 440, 0.2)
            return path.read_bytes()

        with mock.patch.object(series_prod, "_edge_tts_synthesize", fake_edge):
            meta = await series_prod.synthesize_vo(text="Welcome to the race.", speaker_id="doc")
        self.assertEqual(meta["engine"], "edge-tts")
        self.assertEqual(meta["speaker_id"], "doc")
        self.assertTrue(meta["id"].startswith("vo_"))
        wav = series_prod.vo_bytes(meta["id"])
        self.assertGreater(len(wav), 64)

    async def test_clone_stem_does_not_fall_back_when_xtts_down(self) -> None:
        wav = series_prod.series_root() / "clone.wav"
        series_prod.write_placeholder_wav(wav, 220, 0.4, amp=12000)
        series_prod.ingest_speaker_sample("frank", wav.read_bytes())

        async def boom(*_args, **_kwargs):
            raise series_prod.SeriesError("XTTS unreachable: down", 503)

        with mock.patch.object(series_prod, "_xtts_synthesize", boom):
            edge = mock.AsyncMock()
            with mock.patch.object(series_prod, "_edge_tts_synthesize", edge):
                with self.assertRaises(series_prod.SeriesError) as ctx:
                    await series_prod.synthesize_vo(
                        text="I can fix it!", speaker_id="frank"
                    )
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertIn("XTTS", str(ctx.exception))
        edge.assert_not_called()

    async def test_clone_path_uses_ingested_stem(self) -> None:
        wav = series_prod.series_root() / "clone.wav"
        series_prod.write_placeholder_wav(wav, 220, 0.4, amp=12000)
        stem = wav.read_bytes()
        series_prod.ingest_speaker_sample("frank", stem)
        seen: dict[str, object] = {}

        async def fake_xtts(text: str, speaker_wav: Path, language: str) -> bytes:
            seen["text"] = text
            seen["language"] = language
            seen["wav"] = Path(speaker_wav).read_bytes()
            seen["name"] = Path(speaker_wav).name
            out = series_prod.series_root() / "xtts-out.wav"
            series_prod.write_placeholder_wav(out, 330, 0.3, amp=8000)
            return out.read_bytes()

        edge = mock.AsyncMock()
        with mock.patch.object(series_prod, "_xtts_synthesize", fake_xtts):
            with mock.patch.object(series_prod, "_edge_tts_synthesize", edge):
                meta = await series_prod.synthesize_vo(
                    text="I can fix it!", speaker_id="frank"
                )
        self.assertEqual(meta["engine"], "xtts")
        self.assertEqual(meta["speaker_id"], "frank")
        self.assertEqual(seen["text"], "I can fix it!")
        self.assertEqual(seen["wav"], stem)
        self.assertEqual(seen["name"], "frank.wav")
        edge.assert_not_called()


@unittest.skipUnless(_have_ffmpeg(), "ffmpeg/ffprobe required")
class MuxLoudnormTests(unittest.TestCase):
    def setUp(self) -> None:
        _isolate_series_root(self)
        _isolate_video_store(self)

    def test_mux_silent_plus_vo_and_sfx_loudnorm(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="mux-"))
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        clip = tmp / "silent.mp4"
        vo = tmp / "vo.wav"
        dest = tmp / "out.mp4"
        _ffmpeg_clip(clip, 1.0)
        _ffmpeg_wav(vo, 1.0)
        series_prod.ensure_sfx_store()
        info = series_prod.mux_vo_sfx(
            clip,
            dest,
            vo_path=vo,
            sfx=[{"slot": "nexo_beep", "at": 0.1}],
            lufs=-14.0,
        )
        self.assertTrue(dest.is_file())
        self.assertTrue(info["vo"])
        self.assertEqual(info["lufs"], -14.0)
        probe = __import__("subprocess").run(
            [
                "ffmpeg",
                "-hide_banner",
                "-i",
                str(dest),
                "-af",
                "loudnorm=print_format=json",
                "-f",
                "null",
                "-",
            ],
            check=False,
            capture_output=True,
            timeout=60,
        )
        text = (probe.stderr or b"").decode("utf-8", "replace")
        start = text.rfind("{")
        end = text.rfind("}")
        self.assertGreater(start, -1)
        stats = json.loads(text[start : end + 1])
        measured = float(stats.get("input_i") or stats.get("output_i") or 0)
        self.assertGreater(measured, -40.0)
        self.assertLess(measured, -5.0)
        self.assertEqual(series_prod.audio_stream_count(clip), 0)
        self.assertEqual(series_prod.audio_stream_count(dest), 1)

    def test_mux_strips_picture_audio_and_keeps_vo(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="mux-strip-"))
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        noisy = tmp / "noisy.mp4"
        vo = tmp / "vo.wav"
        dest = tmp / "out.mp4"
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x48:d=1:r=24",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=1",
            "-shortest",
            "-pix_fmt",
            "yuv420p",
            str(noisy),
        ]
        proc = __import__("subprocess").run(cmd, check=False, capture_output=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        _ffmpeg_wav(vo, 1.0, freq=220)
        self.assertEqual(series_prod.audio_stream_count(noisy), 1)
        series_prod.mux_vo_sfx(noisy, dest, vo_path=vo, music_path=None, lufs=-14.0)
        # Picture audio is not kept beside the VO.
        self.assertEqual(series_prod.audio_stream_count(dest), 1)
        policy = series_prod.catalog_policy()["production"]["paths"]["dialogue"]
        self.assertFalse(policy["lip_sync"])
        self.assertIn("not lip-sync", policy["claim"])

    def test_longer_master_concat_two_clips(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="master-"))
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        a = tmp / "a.mp4"
        b = tmp / "b.mp4"
        dest = tmp / "master.mp4"
        _ffmpeg_clip(a, 1.0)
        _ffmpeg_clip(b, 1.0)
        series_prod.stitch_clips([a, b], dest, overlap_s=0.0)
        self.assertTrue(dest.is_file())
        dur = series_prod.media_duration_s(dest)
        self.assertGreater(dur, 1.8)
        self.assertLess(dur, 2.4)

    def test_xfade_two_clips(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="xfade-"))
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        a = tmp / "a.mp4"
        b = tmp / "b.mp4"
        dest = tmp / "out.mp4"
        _ffmpeg_clip(a, 1.0)
        _ffmpeg_clip(b, 1.0)
        series_prod.stitch_clips([a, b], dest, overlap_s=0.25)
        self.assertTrue(dest.is_file())
        dur = series_prod.media_duration_s(dest)
        self.assertGreater(dur, 1.4)
        self.assertLess(dur, 2.2)


@unittest.skipUnless(_have_ffmpeg(), "ffmpeg/ffprobe required")
class TimelineJobTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        _isolate_series_root(self)
        store = _isolate_video_store(self)
        clip = store / "video_src" / "clip.mp4"
        clip.parent.mkdir(parents=True)
        _ffmpeg_clip(clip, 0.6)
        video_gen._remember(
            "video_src",
            {
                "meta": {
                    "id": "video_src",
                    "status": "completed",
                    "created_at": 1,
                    "progress": 100,
                    "worker": "comfy",
                },
                "mp4": clip.read_bytes(),
            },
        )
        vo = series_prod.series_root() / "vo" / "vo_test" / "vo.wav"
        vo.parent.mkdir(parents=True, exist_ok=True)
        _ffmpeg_wav(vo, 0.6)
        series_prod._write_json(
            vo.parent / "meta.json",
            {"id": "vo_test", "path": str(vo), "status": "completed"},
        )

    async def test_timeline_happy_path_ffmpeg_worker(self) -> None:
        interrupts: list[object] = []

        async def capture_interrupt(client=None, prompt_id=None):
            interrupts.append(prompt_id)

        with mock.patch.object(video_gen, "interrupt_comfy", capture_interrupt):
            meta = series_prod.enqueue_timeline(
                clips=["video_src"],
                vo="vo_test",
                sfx=[{"slot": "nexo_beep", "at": 0.0}],
                overlap_s=0.0,
            )
            self.assertEqual(meta["worker"], "ffmpeg")
            self.assertEqual(meta["status"], "queued")
            if video_gen._TASKS:
                await asyncio.gather(*list(video_gen._TASKS))
            done = video_gen.get_video(meta["id"])
            self.assertEqual(done["status"], "completed")
            payload = video_gen.get_video_bytes(meta["id"])
            self.assertGreater(len(payload), 32)
            self.assertEqual(interrupts, [])

    async def test_enqueue_mux_records_vo_without_lipsync_claim(self) -> None:
        meta = series_prod.enqueue_mux(video_id="video_src", vo="vo_test")
        self.assertEqual(meta["worker"], "ffmpeg")
        self.assertFalse(meta["lip_sync"])
        self.assertEqual(meta["performance"], "silent-layout-plate-plus-ffmpeg-mux")
        self.assertEqual(meta["picture_audio"], "stripped")
        self.assertIn("not lip-sync", meta["claim"].lower())
        self.assertIn("mouths do not track", meta["claim"].lower())
        if video_gen._TASKS:
            await asyncio.gather(*list(video_gen._TASKS))
        done = video_gen.get_video(meta["id"])
        self.assertEqual(done["status"], "completed")
        self.assertFalse(done["lip_sync"])
        out = series_prod.series_root() / "muxed.mp4"
        out.write_bytes(video_gen.get_video_bytes(meta["id"]))
        self.assertEqual(series_prod.audio_stream_count(out), 1)

    async def test_cancel_ffmpeg_does_not_interrupt_comfy(self) -> None:
        interrupts: list[object] = []

        async def capture_interrupt(client=None, prompt_id=None):
            interrupts.append(prompt_id)

        job_id = series_prod._new_ffmpeg_job("series-timeline", "idle")
        record = video_gen._CLIPS[job_id]
        record["meta"]["status"] = "in_progress"
        video_gen._persist_job(job_id, record)
        with mock.patch.object(video_gen, "interrupt_comfy", capture_interrupt):
            cancelled = await video_gen.cancel_video(job_id)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(interrupts, [])


class SilentPlateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        _isolate_video_store(self)

    def test_layout_plate_strips_audio_h3_can_keep_it(self) -> None:
        workflow = video_gen.select_workflow(EPISODE_A_CAMERA_ID, image="look.png")
        workflow["baked"] = {"inputs": {}, "class_type": "VAEDecodeAudio"}
        workflow["mkv"]["inputs"]["audio"] = ["baked", 0]
        video_gen.apply_workflow(
            workflow,
            prompt="Frank crosses the garage",
            model=EPISODE_A_CAMERA_ID,
            width=1920,
            height=1088,
            length=25,
            steps=8,
            seed=1,
            image="look.png",
            fps=24,
            with_audio=True,
        )
        kinds = {
            node.get("class_type")
            for node in workflow.values()
            if isinstance(node, dict)
        }
        self.assertNotIn("VAEDecodeAudio", kinds)
        for node in workflow.values():
            if isinstance(node, dict) and node.get("class_type") == "CreateVideo":
                self.assertNotIn("audio", node.get("inputs") or {})
        self.assertEqual(
            video_gen.resolve_audio(True, model_name=EPISODE_A_CAMERA_ID),
            (False, True),
        )
        self.assertEqual(
            video_gen.resolve_audio(None, model_name=MINIMAX_H3_ID),
            (True, False),
        )
        h3 = video_gen.select_workflow(MINIMAX_H3_ID)
        video_gen.apply_workflow(
            h3,
            prompt="scratch atmos bed",
            model=MINIMAX_H3_ID,
            width=704,
            height=480,
            length=39,
            steps=8,
            seed=1,
            fps=24,
            with_audio=True,
        )
        h3_kinds = {
            node.get("class_type")
            for node in h3.values()
            if isinstance(node, dict)
        }
        self.assertIn("VAEDecodeAudio", h3_kinds)

    async def test_enqueued_plate_is_silent_layout_not_h3(self) -> None:
        import base64

        png = base64.b64encode(_png_header(64, 64)).decode("ascii")
        seen: dict[str, object] = {}

        async def catalog(_client):
            return [
                {
                    "id": EPISODE_A_CAMERA_ID,
                    "runnable": True,
                    "api_ready": True,
                    "missing": [],
                },
                {
                    "id": MINIMAX_H3_ID,
                    "runnable": True,
                    "api_ready": True,
                    "missing": [],
                },
            ]

        async def generate_job(*_args, **kwargs):
            seen.update(kwargs)

        with (
            mock.patch.object(video_gen, "_catalog", catalog),
            mock.patch.object(video_gen, "_generate_job", generate_job),
        ):
            meta = await video_gen.enqueue_video(
                prompt="Frank crosses the garage, no dialogue",
                model=EPISODE_A_CAMERA_ID,
                size="1920x1088",
                seconds=1,
                audio=True,
                input_reference=png,
            )
            if video_gen._TASKS:
                await asyncio.gather(*list(video_gen._TASKS))
        self.assertEqual(meta["model"], EPISODE_A_CAMERA_ID)
        self.assertNotEqual(meta["model"], MINIMAX_H3_ID)
        self.assertFalse(meta["audio"])
        self.assertTrue(meta["audio_ignored"])
        self.assertEqual(meta["size"], "1920x1088")
        self.assertFalse(seen["with_audio"])
        self.assertEqual(seen["model_name"], EPISODE_A_CAMERA_ID)


if __name__ == "__main__":
    unittest.main()
