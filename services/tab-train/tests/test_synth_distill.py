#!/usr/bin/env python3
"""Unit tests for synthetic FIM + distill filters (no GPU / no network)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tab_train.distill_lib import (
    char_f1,
    clean_completion,
    is_bad_completion,
    select_label,
    strip_fim_artifacts,
)
from tab_train.synth_holes import generate_holes, punch_file
import random


class DistillFilterTests(unittest.TestCase):
    def test_clean_strips_fim_and_fences(self) -> None:
        raw = "```python\nreturn a + b\n```<|endoftext|>"
        self.assertEqual(clean_completion(raw).strip(), "return a + b")

    def test_strip_codestral_overgen(self) -> None:
        raw = " return a + b\n[INFIX]\ndef mul(a, b):\n    return a * b\n"
        self.assertEqual(strip_fim_artifacts(raw).strip(), "return a + b")
        self.assertEqual(clean_completion(raw).strip(), "return a + b")

    def test_bad_completion_reasons(self) -> None:
        self.assertEqual(is_bad_completion(""), "empty")
        self.assertEqual(is_bad_completion("x" * 900), "too_long")
        self.assertEqual(is_bad_completion("aaaaaaaaaaaaaaaaaaaaaaaa"), "char_repeat")
        self.assertIsNone(is_bad_completion("return a + b"))

    def test_select_label_modes(self) -> None:
        gt = "return a + b"
        tea = "return a+b"
        mid, tag = select_label(ground_truth=gt, teacher=tea, mode="ground_truth")
        self.assertEqual(mid, gt)
        mid, tag = select_label(
                ground_truth=gt, teacher=tea, mode="teacher_filtered", min_teacher_f1=0.2,
        )
        self.assertEqual(mid, tea)
        self.assertTrue(tag.startswith("teacher_f1="))
        mid, tag = select_label(
                ground_truth=gt, teacher="zzzz totally unrelated",
                mode="mix", min_teacher_f1=0.9,
        )
        self.assertEqual(mid, gt)
        self.assertEqual(tag, "fallback_gt")
        mid, tag = select_label(
                ground_truth=gt, teacher="", mode="teacher",
        )
        self.assertIsNone(mid)

    def test_char_f1_identical(self) -> None:
        self.assertAlmostEqual(char_f1("abc", "abc"), 1.0)


class SynthHoleTests(unittest.TestCase):
    def test_punch_simple_python(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "mod.py"
            src.write_text(
                    "\n".join([
                            "import os",
                            "",
                            "def add(a, b):",
                            "    return a + b",
                            "",
                            "def sub(a, b):",
                            "    return a - b",
                            "",
                            "def main():",
                            "    x = add(1, 2)",
                            "    print(x)",
                            "",
                    ]) + "\n",
                    encoding="utf-8",
            )
            holes = punch_file(src, root=root, rng=random.Random(0), holes_per_file=3)
            self.assertGreaterEqual(len(holes), 1)
            for h in holes:
                self.assertTrue(h.prefix)
                self.assertTrue(h.middle.strip())
                self.assertEqual(h.language, "python")
                # Reconstruct should contain middle once.
                full = h.prefix + h.middle + h.suffix
                self.assertIn(h.middle, full)

    def test_generate_respects_max(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for i in range(5):
                (root / f"f{i}.py").write_text(
                        "def f():\n    return %d\n\ndef g():\n    return %d\n\n"
                        % (i, i + 1),
                        encoding="utf-8",
                )
            holes = generate_holes([root], max_holes=3, holes_per_file=2, seed=1)
            self.assertLessEqual(len(holes), 3)


if __name__ == "__main__":
    unittest.main()
