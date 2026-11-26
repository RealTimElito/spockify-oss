"""CPU contracts for cartoon rights, frames, fixtures, and OSS doc safety."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import cartoon_contracts
import cartoon_pipeline
import video_gen

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "docs" / "cartoon-production" / "fixtures"
PRIVATE = cartoon_contracts.PRIVATE_TOKEN_RE


def _have_ffmpeg() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


class RightsAndFrameTests(unittest.TestCase):
    def test_registry_blocks_commercial_export(self) -> None:
        draft = cartoon_contracts.model_registry_draft()
        self.assertFalse(draft["commercial_export"])
        self.assertEqual(draft["status"], "DRAFT_UNSIGNED")
        self.assertEqual(draft["weight_digests"], "not_captured")
        scopes = {row["registry_id"]: row["license_scope"] for row in draft["models"]}
        self.assertEqual(scopes["qwen-image-2.1"], "RESEARCH_ONLY")
        self.assertEqual(scopes["coqui-xtts-v2"], "RESEARCH_ONLY")
        self.assertEqual(scopes["qwen-video-edit"], "NOT_AVAILABLE")
        self.assertTrue(all(row["weight_sha256"] is None for row in draft["models"]))
        self.assertTrue(all(row["rights_approval"] == "UNSIGNED" for row in draft["models"]))
        self.assertFalse(any(row["commercial_ready"] for row in draft["models"]))

    def test_policy_rights_fail_closed(self) -> None:
        block = cartoon_contracts.policy_rights_block()
        self.assertFalse(block["commercial_export"])
        self.assertIn("qwen-image-2.1:RESEARCH_ONLY", block["reason_codes"])
        self.assertIn("xtts-v2:RESEARCH_ONLY", block["reason_codes"])

    def test_wan_flf_default_is_33_frames(self) -> None:
        mapped = cartoon_contracts.map_wan_flf_frames(2, fps_num=16, fps_den=1)
        self.assertEqual(mapped["frames"], 33)
        self.assertEqual(mapped["frames"] % 4, 1)
        self.assertAlmostEqual(mapped["sample_span_seconds"], 2.0625)
        self.assertFalse(mapped["requested_seconds_exact"])
        self.assertFalse(mapped["gpu_measured"])

    def test_snap_length_matches_4n1_for_flf_and_vace(self) -> None:
        for seconds in (1, 2, 3, 5, 1.3125):
            mapped = cartoon_contracts.map_wan_flf_frames(seconds)
            self.assertEqual(mapped["frames"] % 4, 1)
            for model in ("wan2.1-flf2v", "wan2.1-vace-1.3b"):
                snapped = video_gen.snap_length(seconds, model_name=model, fps=16)
                self.assertEqual(snapped, mapped["frames"], msg=f"{model} {seconds}")
        self.assertEqual(
            video_gen.snap_length(1.3125, model_name="wan2.1-flf2v", fps=16),
            21,
        )

    def test_planning_budgets_are_not_measurements(self) -> None:
        budgets = cartoon_contracts.planning_budgets()
        self.assertFalse(budgets["measured"])
        self.assertEqual(budgets["status"], "UNVERIFIED")
        self.assertTrue(budgets["entries"])
        self.assertTrue(all(row["measured"] is False for row in budgets["entries"]))

    def test_checked_in_fixtures_match_code(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(
                os.environ, {"SPOCKIFY_IMAGE_MODELS_ROOT": tmp}
            ):
                policy = cartoon_pipeline.catalog_policy()
        scrubbed = cartoon_contracts.scrub_policy(policy)
        blob = json.dumps(scrubbed)
        self.assertIsNone(PRIVATE.search(blob))
        self.assertFalse(scrubbed["commercial_export"])
        self.assertEqual(
            [stage["id"] for stage in scrubbed["pipeline"]],
            ["sprite_grid", "slice", "flf", "video_edit"],
        )
        self.assertFalse(scrubbed["frame_contract"]["gpu_measured"])
        self.assertEqual(
            json.loads((FIXTURES / "cold_policy_scrubbed.json").read_text()),
            scrubbed,
        )
        self.assertEqual(
            json.loads((FIXTURES / "model_registry_draft.json").read_text()),
            cartoon_contracts.model_registry_draft(),
        )
        self.assertEqual(
            json.loads((FIXTURES / "frame_contract_wan21_flf.json").read_text()),
            cartoon_contracts.frame_contract_public(),
        )
        self.assertEqual(
            json.loads((FIXTURES / "planning_budgets.json").read_text()),
            cartoon_contracts.planning_budgets(),
        )


class FeasibilitySheetTests(unittest.TestCase):
    def test_c006_ten_angles_untested(self) -> None:
        sheet = cartoon_contracts.identity_feasibility_sheet()
        self.assertEqual(sheet["ticket"], "C-006")
        self.assertEqual(sheet["status"], "PLANNED")
        self.assertFalse(sheet["gpu_executed"])
        self.assertFalse(sheet["scores_recorded"])
        self.assertEqual(len(sheet["angles"]), 10)
        self.assertTrue(all(row["status"] == "UNTESTED" for row in sheet["angles"]))
        self.assertTrue(all(row["score"] is None for row in sheet["angles"]))
        self.assertEqual(
            json.loads((FIXTURES / "identity_feasibility_c006.json").read_text()),
            sheet,
        )

    def test_c007_lipsync_matrix_untested(self) -> None:
        matrix = cartoon_contracts.lipsync_feasibility_matrix()
        self.assertEqual(matrix["ticket"], "C-007")
        self.assertEqual(matrix["status"], "PLANNED")
        self.assertFalse(matrix["gpu_executed"])
        self.assertEqual(matrix["fallback_decision"], "OPEN")
        self.assertFalse(matrix["market_lip_sync"])
        self.assertGreaterEqual(len(matrix["archetypes"]), 8)
        self.assertTrue(all(row["status"] == "UNTESTED" for row in matrix["archetypes"]))
        self.assertEqual(
            json.loads((FIXTURES / "lipsync_matrix_c007.json").read_text()),
            matrix,
        )


class OssDocTests(unittest.TestCase):
    def test_export_keep_list_has_cartoon_docs_not_tracker(self) -> None:
        script = (REPO / "scripts" / "export-oss.sh").read_text(encoding="utf-8")
        self.assertIn("docs/CARTOON_PIPELINE.md", script)
        self.assertIn("docs/CARTOON_PIPELINE_ROADMAP.md", script)
        self.assertNotIn("docs/cartoon-production", script)
        labrats = (REPO / "docs" / "LABRATS_PRODUCTION.md").read_text(encoding="utf-8")
        self.assertNotIn("staged until VACE", labrats)
        self.assertIn("wan2.1-vace-1.3b", labrats)

    def test_cartoon_docs_have_no_private_tokens(self) -> None:
        paths = [
            REPO / "docs" / "CARTOON_PIPELINE.md",
            REPO / "docs" / "CARTOON_PIPELINE_ROADMAP.md",
            REPO / "docs" / "LABRATS_PRODUCTION.md",
        ]
        paths.extend((REPO / "docs" / "cartoon-production").rglob("*.md"))
        paths.extend((REPO / "docs" / "cartoon-production").rglob("*.json"))
        checked = 0
        for path in paths:
            text = path.read_text(encoding="utf-8")
            self.assertIsNone(
                PRIVATE.search(text),
                msg=f"private token in {path}",
            )
            checked += 1
        self.assertGreaterEqual(checked, 6)


@unittest.skipUnless(_have_ffmpeg(), "ffmpeg/ffprobe required")
class SyntheticFrameProbeTests(unittest.TestCase):
    def test_lavfi_33_frame_clip_matches_contract_count(self) -> None:
        mapped = cartoon_contracts.map_wan_flf_frames(2)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "contract.mp4"
            proc = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=64x64:r=16",
                    "-frames:v",
                    "33",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(path),
                ],
                check=False,
                capture_output=True,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-count_frames",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height,nb_read_frames,avg_frame_rate",
                    "-of",
                    "json",
                    str(path),
                ],
                check=False,
                capture_output=True,
            )
            self.assertEqual(probe.returncode, 0, probe.stderr.decode("utf-8", "replace"))
            stream = json.loads(probe.stdout.decode("utf-8"))["streams"][0]
        self.assertEqual(int(stream["nb_read_frames"]), mapped["frames"])
        self.assertEqual(int(stream["width"]), 64)
        self.assertEqual(int(stream["height"]), 64)
        self.assertTrue(str(stream["avg_frame_rate"]).startswith("16"))


if __name__ == "__main__":
    unittest.main()
