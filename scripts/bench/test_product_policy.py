#!/usr/bin/env python3
"""Unit tests for product policy + route regret offline scorer."""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ProductPolicyTest(unittest.TestCase):
    def test_rejects_abliterated_on_spark(self):
        from check_product_policy import check_tags

        self.assertTrue(check_tags(["devstral-abliterated"], "spark"))
        self.assertTrue(check_tags(["foo:cloud"], "spark"))
        self.assertFalse(check_tags(["gpt-oss-20b"], "spark"))

    def test_route_pack_size(self):
        pack = json.loads((ROOT / "packs/route-v1.json").read_text())
        n = len(pack["items"])
        self.assertGreaterEqual(n, 80)
        self.assertLessEqual(n, 120)

    def test_route_regret_cli(self):
        script = ROOT / "scripts/bench/route_regret.py"
        r = subprocess.run(
            [sys.executable, str(script), "--pack", str(ROOT / "packs/route-v1.json")],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertIn("POLICY-OK", r.stdout)


if __name__ == "__main__":
    # Allow importing sibling module
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    unittest.main()
