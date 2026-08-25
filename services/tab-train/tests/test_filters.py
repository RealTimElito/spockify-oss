#!/usr/bin/env python3
"""Unit tests for Tab training filters / FIM / thresholds / seed gate (no GPU)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from build_from_telemetry import eligible_summary
from tab_train.filters import dedupe_by_prefix, is_junk_event, kto_label
from tab_train.fim_format import (
    build_fim_example,
    partial_is_high_quality,
    sft_target_text,
)
from tab_train.names import workspace_adapter_name
from tab_train.seed_gate import is_smoke_stub, needs_real_seed, write_real_seed_marker
from tab_train.thresholds import TrainThresholds


class FilterTests(unittest.TestCase):
    def test_junk_empty_and_suppressed(self) -> None:
        self.assertTrue(is_junk_event({"suggestion": "", "fate": "accepted"}))
        self.assertTrue(
            is_junk_event({
                "suggestion": "x",
                "fate": "accepted",
                "suppress_reason": "duplicate_suffix",
            })
        )
        self.assertTrue(is_junk_event({"suggestion": "x", "fate": "ignored"}))
        self.assertFalse(is_junk_event({"suggestion": "x", "fate": "accepted"}))

    def test_latency_outlier(self) -> None:
        self.assertTrue(
            is_junk_event(
                {"suggestion": "x", "fate": "accepted", "latency_ms": 99_999},
                max_latency_ms=30_000,
            )
        )

    def test_dedupe_keeps_newest(self) -> None:
        rows = [
            {"prefix": "abc  def", "suggestion": "1", "fate_ts": "2026-01-01"},
            {"prefix": "abc def", "suggestion": "2", "fate_ts": "2026-02-01"},
        ]
        out = dedupe_by_prefix(rows)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["suggestion"], "2")

    def test_kto_labels(self) -> None:
        self.assertTrue(kto_label({"fate": "accepted"}))
        self.assertFalse(kto_label({"fate": "rejected", "seen": True}))
        self.assertIsNone(kto_label({"fate": "rejected", "seen": False}))
        self.assertIsNone(kto_label({"fate": "ignored"}))
        self.assertIsNone(kto_label({"fate": "partial"}))


class FimTests(unittest.TestCase):
    def test_fim_example(self) -> None:
        text = build_fim_example("pre", "suf", "mid")
        self.assertIn("<fim_prefix>pre", text)
        self.assertIn("<fim_suffix>suf", text)
        self.assertIn("<fim_middle>mid", text)

    def test_partial_quality(self) -> None:
        self.assertTrue(partial_is_high_quality("hello world", "hello world"))
        self.assertTrue(partial_is_high_quality("hello world", "hello worl"))
        self.assertFalse(partial_is_high_quality("hello world!!!", "hello world"))
        self.assertFalse(partial_is_high_quality("hello world", "goodbye"))

    def test_sft_target(self) -> None:
        self.assertEqual(
            sft_target_text({
                "fate": "accepted",
                "suggestion": "a",
                "settled_text": "b",
            }),
            "b",
        )
        self.assertEqual(
            sft_target_text({
                "fate": "partial",
                "suggestion": "hello world",
                "settled_text": "hello world",
            }),
            "hello world",
        )
        self.assertIsNone(
            sft_target_text({
                "fate": "partial",
                "suggestion": "aaa",
                "settled_text": "zzz",
            })
        )


class NamesTests(unittest.TestCase):
    def test_stable_hash(self) -> None:
        a = workspace_adapter_name("file:///home/you/proj")
        b = workspace_adapter_name("file:///home/you/proj")
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("tab-"))
        self.assertEqual(workspace_adapter_name(""), "tab-global")


class ThresholdTests(unittest.TestCase):
    def test_env_defaults_include_distill(self) -> None:
        help_text = __import__(
                "tab_train.thresholds", fromlist=["env_defaults_help"]
        ).env_defaults_help()
        self.assertIn("TAB_MIN_DISTILL=", help_text)
        self.assertEqual(TrainThresholds().min_distill, 64)

    def test_below_threshold_skips(self) -> None:
        thr = TrainThresholds(min_sft=32, min_kto=48, min_global_sft=64)
        workspaces = {
            "ws-thin": {
                "adapter": "tab-aaaa",
                "sft": 10,
                "kto": 5,
                "accepted": 10,
            },
        }
        summary = eligible_summary(workspaces, thr=thr, tab_global_sft=20)
        self.assertEqual(summary["eligible_sft"], [])
        self.assertEqual(summary["eligible_kto"], [])
        reasons = {s["reason"] for s in summary["skipped"]}
        self.assertIn("below_min_sft", reasons)
        self.assertIn("below_min_global_sft", reasons)

    def test_eligible_when_enough(self) -> None:
        thr = TrainThresholds(min_sft=32, min_kto=48, min_global_sft=64)
        adapter = workspace_adapter_name("file:///big")
        workspaces = {
            "file:///big": {
                "adapter": adapter,
                "sft": 40,
                "kto": 50,
                "accepted": 40,
            },
        }
        summary = eligible_summary(workspaces, thr=thr, tab_global_sft=80)
        self.assertIn(adapter, summary["eligible_sft"])
        self.assertIn("tab-global", summary["eligible_sft"])
        self.assertIn(adapter, summary["eligible_kto"])

    def test_accepted_gate_blocks_thin_accepts(self) -> None:
        thr = TrainThresholds(min_sft=32, min_kto=48)
        summary = eligible_summary(
            {
                "ws": {
                    "adapter": "tab-bbbb",
                    "sft": 40,
                    "kto": 0,
                    "accepted": 5,
                },
            },
            thr=thr,
        )
        self.assertEqual(summary["eligible_sft"], [])


class SeedGateTests(unittest.TestCase):
    def test_smoke_stub_from_meta(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "tab-seed"
            d.mkdir()
            (d / "tab_train_meta.json").write_text(
                json.dumps({
                    "adapter_name": "tab-seed",
                    "max_steps": 1,
                    "n_examples": 64,
                }),
                encoding="utf-8",
            )
            self.assertTrue(is_smoke_stub(d))

    def test_real_seed_not_stub(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "tab-seed"
            d.mkdir()
            (d / "tab_train_meta.json").write_text(
                json.dumps({
                    "adapter_name": "tab-seed",
                    "max_steps": -1,
                    "n_examples": 50000,
                }),
                encoding="utf-8",
            )
            self.assertFalse(is_smoke_stub(d))

    def test_needs_real_seed_respects_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            loras = Path(tmp) / "loras"
            seed = loras / "tab-seed"
            seed.mkdir(parents=True)
            (seed / "tab_train_meta.json").write_text(
                json.dumps({"max_steps": 1, "n_examples": 64}),
                encoding="utf-8",
            )
            marker = Path(tmp) / "REAL_SEED_DONE"
            import os
            os.environ["TAB_LORAS_DIR"] = str(loras)
            os.environ["TAB_REAL_SEED_MARKER"] = str(marker)
            try:
                self.assertTrue(needs_real_seed(loras_dir=loras))
                write_real_seed_marker()
                self.assertTrue(marker.is_file())
                self.assertFalse(needs_real_seed(loras_dir=loras))
            finally:
                os.environ.pop("TAB_LORAS_DIR", None)
                os.environ.pop("TAB_REAL_SEED_MARKER", None)


if __name__ == "__main__":
    unittest.main()
