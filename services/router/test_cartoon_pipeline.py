"""Cartoon sprite-grid → slice → FLF helpers (no live Comfy)."""

from __future__ import annotations

import base64
import os
import shutil
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

import cartoon_pipeline


def _have_ffmpeg() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _png(width: int, height: int, *, rgb: tuple[int, int, int] = (40, 120, 200)) -> bytes:
    """Minimal RGB PNG (solid color) for crop tests."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw_rows = b"".join(
        b"\x00" + bytes(rgb) * width for _ in range(height)
    )
    compressed = zlib.compress(raw_rows, 9)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )


def _ffmpeg_grid(path: Path, width: int = 256, height: int = 256) -> None:
    """Checker-ish solid grid via lavfi (each quadrant a different color)."""
    # 2x2 colored rectangles.
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        (
            f"color=c=0xE74C3C:s={width // 2}x{height // 2}[a];"
            f"color=c=0x3498DB:s={width // 2}x{height // 2}[b];"
            f"color=c=0x2ECC71:s={width // 2}x{height // 2}[c];"
            f"color=c=0xF1C40F:s={width // 2}x{height // 2}[d];"
            f"[a][b]hstack[top];[c][d]hstack[bot];[top][bot]vstack"
        ),
        "-frames:v",
        "1",
        str(path),
    ]
    proc = __import__("subprocess").run(cmd, check=False, capture_output=True)
    if proc.returncode != 0 or not path.is_file():
        raise RuntimeError(proc.stderr.decode("utf-8", "replace")[:240])


class CartoonPromptTests(unittest.TestCase):
    def test_sprite_prompt_mentions_grid_and_consistency(self) -> None:
        text = cartoon_pipeline.build_sprite_prompt(
            "a fox jumps over a log",
            grid="2x2",
            style="ink wash cartoon",
        )
        self.assertIn("2×2", text)
        self.assertIn("fox jumps", text)
        self.assertIn("ink wash cartoon", text)
        self.assertIn("Same character design", text)

    def test_normalize_grid_aliases(self) -> None:
        self.assertEqual(cartoon_pipeline.normalize_grid("2×2"), "2x2")
        self.assertEqual(cartoon_pipeline.normalize_grid("3"), "3x3")
        with self.assertRaises(cartoon_pipeline.CartoonError):
            cartoon_pipeline.normalize_grid("4x4")

    def test_pair_modes(self) -> None:
        tiles = [
            {"index": i, "row": 0, "col": i, "b64_json": "x", "mime": "image/png"}
            for i in range(4)
        ]
        fl = cartoon_pipeline.pair_tiles(tiles, pair_mode="first_last")
        self.assertEqual(len(fl), 1)
        self.assertEqual(fl[0][0]["index"], 0)
        self.assertEqual(fl[0][1]["index"], 3)
        adj = cartoon_pipeline.pair_tiles(tiles, pair_mode="adjacent")
        self.assertEqual(len(adj), 3)
        self.assertEqual(adj[0][0]["index"], 0)
        self.assertEqual(adj[0][1]["index"], 1)


@unittest.skipUnless(_have_ffmpeg(), "ffmpeg/ffprobe required")
class CartoonSliceTests(unittest.TestCase):
    def test_slice_2x2_deterministic_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "grid.png"
            _ffmpeg_grid(path, 256, 256)
            tiles = cartoon_pipeline.slice_grid(
                path.read_bytes(),
                cols=2,
                rows=2,
                gutter_ratio=0.0,
            )
        self.assertEqual(len(tiles), 4)
        self.assertEqual(tiles[0]["index"], 0)
        self.assertEqual(tiles[0]["row"], 0)
        self.assertEqual(tiles[0]["col"], 0)
        self.assertEqual(tiles[3]["row"], 1)
        self.assertEqual(tiles[3]["col"], 1)
        for tile in tiles:
            raw = base64.b64decode(tile["b64_json"])
            self.assertGreater(len(raw), 50)
            self.assertEqual(tile["width"], 128)
            self.assertEqual(tile["height"], 128)

    def test_slice_only_api(self) -> None:
        png = _png(128, 128)

        async def _run() -> dict:
            return await cartoon_pipeline.slice_only(image=png, grid="2x2", gutter_ratio=0.0)

        # Pure PNG may be tiny; use ffmpeg grid for reliability.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "g.png"
            _ffmpeg_grid(path, 200, 200)
            out = __import__("asyncio").run(
                cartoon_pipeline.slice_only(
                    image=path.read_bytes(),
                    grid="2x2",
                    gutter_ratio=0.0,
                )
            )
        self.assertEqual(out["tile_count"], 4)
        self.assertEqual(out["object"], "spockify.cartoon.slice")


class CartoonPolicyTests(unittest.TestCase):
    def test_policy_lists_four_stages(self) -> None:
        with mock.patch.object(
            cartoon_pipeline, "qwen_image_runnable", return_value=True
        ), mock.patch.object(
            cartoon_pipeline,
            "scan_open_jealousy",
            return_value={"flf_installed": True},
        ), mock.patch.object(
            cartoon_pipeline,
            "video_edit_status",
            return_value={
                "available": True,
                "ready": True,
                "reason": None,
                "candidates": [],
            },
        ):
            policy = cartoon_pipeline.catalog_policy()
        ids = [s["id"] for s in policy["pipeline"]]
        self.assertEqual(ids, ["sprite_grid", "slice", "flf", "video_edit"])
        edit = policy["pipeline"][3]
        self.assertTrue(edit["available"])
        self.assertTrue(edit["ready"])
        self.assertEqual(edit["model"], cartoon_pipeline.WAN21_VACE_ID)
        self.assertIn("candidates", edit)

    def test_run_cartoon_chains_mocked(self) -> None:
        fake_tiles = [
            {
                "index": i,
                "row": i // 2,
                "col": i % 2,
                "width": 64,
                "height": 64,
                "mime": "image/png",
                "b64_json": base64.b64encode(b"tile").decode("ascii"),
                "_bytes": b"tile",
            }
            for i in range(4)
        ]

        async def fake_grid(**kwargs):
            return {
                "grid": "2x2",
                "canvas": "1536x1536",
                "image_model": "qwen-image-2.1",
                "sprite_prompt": "sheet",
                "mime": "image/png",
                "b64_json": base64.b64encode(b"grid").decode("ascii"),
                "_bytes": b"grid",
            }

        async def fake_enqueue(**kwargs):
            return [{"id": "video_abc", "status": "queued", "model": "wan2.1-flf2v"}]

        with mock.patch.object(
            cartoon_pipeline, "generate_sprite_grid", side_effect=fake_grid
        ), mock.patch.object(
            cartoon_pipeline, "slice_grid", return_value=fake_tiles
        ), mock.patch.object(
            cartoon_pipeline, "enqueue_flf_pairs", side_effect=fake_enqueue
        ), mock.patch.object(
            cartoon_pipeline,
            "video_edit_status",
            return_value={
                "available": False,
                "reason": "missing",
                "candidates": [],
            },
        ):
            out = __import__("asyncio").run(
                cartoon_pipeline.run_cartoon(
                    prompt="hero waves",
                    grid="2x2",
                    pair_mode="first_last",
                    include_tiles=True,
                    include_grid=True,
                    run_edit=True,
                )
            )
        self.assertEqual(out["status"], "videos_queued")
        self.assertEqual(out["pipeline"], ["sprite_grid", "slice", "flf"])
        self.assertEqual(out["videos"][0]["id"], "video_abc")
        self.assertEqual(out["tile_count"], 4)
        self.assertFalse(out["video_edit"]["ran"])
        self.assertEqual(out["video_edit"]["status"], "skipped")

    def test_run_cartoon_edit_chained_when_vace_ready(self) -> None:
        fake_tiles = [
            {
                "index": i,
                "row": i // 2,
                "col": i % 2,
                "width": 64,
                "height": 64,
                "mime": "image/png",
                "b64_json": base64.b64encode(b"tile").decode("ascii"),
                "_bytes": b"tile",
            }
            for i in range(4)
        ]

        async def fake_grid(**kwargs):
            return {
                "grid": "2x2",
                "canvas": "1536x1536",
                "image_model": "qwen-image-2.1",
                "sprite_prompt": "sheet",
                "mime": "image/png",
                "b64_json": base64.b64encode(b"grid").decode("ascii"),
                "_bytes": b"grid",
            }

        async def fake_enqueue(**kwargs):
            return [{"id": "video_flf", "status": "queued", "model": "wan2.1-flf2v"}]

        with mock.patch.object(
            cartoon_pipeline, "generate_sprite_grid", side_effect=fake_grid
        ), mock.patch.object(
            cartoon_pipeline, "slice_grid", return_value=fake_tiles
        ), mock.patch.object(
            cartoon_pipeline, "enqueue_flf_pairs", side_effect=fake_enqueue
        ), mock.patch.object(
            cartoon_pipeline,
            "video_edit_status",
            return_value={
                "available": True,
                "ready": True,
                "reason": None,
                "candidates": [],
            },
        ):
            def _close_task(coro):
                if hasattr(coro, "close"):
                    coro.close()
                return mock.Mock()

            with mock.patch.object(
                cartoon_pipeline.asyncio, "create_task", side_effect=_close_task
            ) as create_task:
                out = __import__("asyncio").run(
                    cartoon_pipeline.run_cartoon(
                        prompt="hero waves",
                        grid="2x2",
                        pair_mode="first_last",
                        run_edit=True,
                    )
                )
        self.assertIn("video_edit", out["pipeline"])
        self.assertTrue(out["video_edit"]["ran"])
        self.assertEqual(out["video_edit"]["status"], "chained")
        self.assertEqual(out["video_edit"]["model"], cartoon_pipeline.WAN21_VACE_ID)
        self.assertIn("not Qwen", out["video_edit"]["vendor"])
        create_task.assert_called()

    def test_commercial_export_refused_before_generation(self) -> None:
        with mock.patch.object(
            cartoon_pipeline, "generate_sprite_grid"
        ) as generate:
            with self.assertRaises(cartoon_pipeline.CartoonError) as ctx:
                __import__("asyncio").run(
                    cartoon_pipeline.run_cartoon(
                        prompt="a fox hops",
                        commercial_export=True,
                    )
                )
            generate.assert_not_called()
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("license_commercial_blocked", str(ctx.exception))

    def test_commercial_export_rejects_unknown_token(self) -> None:
        with self.assertRaises(cartoon_pipeline.CartoonError) as ctx:
            __import__("asyncio").run(
                cartoon_pipeline.run_cartoon(
                    prompt="a fox hops",
                    commercial_export="maybe",
                )
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_filename_hit_does_not_mark_edit_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "diffusion_models").mkdir()
            (root / "diffusion_models" / "notes-vace.txt").write_text(
                "not a checkpoint",
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ, {"SPOCKIFY_IMAGE_MODELS_ROOT": tmp}
            ):
                status = cartoon_pipeline.video_edit_status()
                policy = cartoon_pipeline.catalog_policy()
        self.assertTrue(status["available"])
        self.assertFalse(status["ready"])
        edit = policy["pipeline"][3]
        self.assertFalse(edit["ready"])
        self.assertTrue(edit["available"])
        self.assertFalse(policy["commercial_export"])

    def test_run_edit_skips_when_not_ready(self) -> None:
        fake_tiles = [
            {
                "index": i,
                "row": i // 2,
                "col": i % 2,
                "width": 64,
                "height": 64,
                "mime": "image/png",
                "b64_json": base64.b64encode(b"tile").decode("ascii"),
                "_bytes": b"tile",
            }
            for i in range(4)
        ]

        async def fake_grid(**kwargs):
            return {
                "grid": "2x2",
                "canvas": "1536x1536",
                "image_model": "qwen-image-2.1",
                "sprite_prompt": "sheet",
                "mime": "image/png",
                "b64_json": base64.b64encode(b"grid").decode("ascii"),
                "_bytes": b"grid",
            }

        async def fake_enqueue(**kwargs):
            return [{"id": "video_flf", "status": "queued", "model": "wan2.1-flf2v"}]

        with mock.patch.object(
            cartoon_pipeline, "generate_sprite_grid", side_effect=fake_grid
        ), mock.patch.object(
            cartoon_pipeline, "slice_grid", return_value=fake_tiles
        ), mock.patch.object(
            cartoon_pipeline, "enqueue_flf_pairs", side_effect=fake_enqueue
        ), mock.patch.object(
            cartoon_pipeline,
            "video_edit_status",
            return_value={"available": True, "ready": False, "reason": "partial"},
        ):
            with mock.patch.object(
                cartoon_pipeline.asyncio, "create_task"
            ) as create_task:
                out = __import__("asyncio").run(
                    cartoon_pipeline.run_cartoon(
                        prompt="hero waves",
                        run_edit=True,
                    )
                )
        create_task.assert_not_called()
        self.assertNotIn("video_edit", out["pipeline"])
        self.assertEqual(out["video_edit"]["status"], "skipped")
        self.assertFalse(out["commercial_export"])
        self.assertEqual(out["frame_contract"]["frames"], 33)
        self.assertFalse(out["frame_contract"]["gpu_measured"])


if __name__ == "__main__":
    unittest.main()
