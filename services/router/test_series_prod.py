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


if __name__ == "__main__":
    unittest.main()
