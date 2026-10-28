"""Tests for allowlisted lab shell tool."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from spockify_lab_agents.shell_tool import (
    extract_run_commands,
    run_shell,
    validate_command,
)


class ShellToolTest(unittest.TestCase):
    def test_extract_run_lines(self) -> None:
        text = "thinking\nRUN: ls -la\nRUN: cat hello.py\nDONE — x\n"
        self.assertEqual(
            extract_run_commands(text),
            ["ls -la", "cat hello.py"],
        )

    def test_ignores_run_after_done(self) -> None:
        text = (
            "RUN: pytest -q\n"
            "DONE — fixed\n"
            "FINDINGS: ok\n"
            "RUN: sed -i 's/+/ -/' mathy.py\n"
        )
        self.assertEqual(extract_run_commands(text), ["pytest -q"])

    def test_strips_trailing_run_parenthetical(self) -> None:
        text = "RUN: pytest -q (verification)\nDONE — ok\n"
        self.assertEqual(extract_run_commands(text), ["pytest -q"])

    def test_write_extract_and_apply(self) -> None:
        import tempfile
        from pathlib import Path

        from spockify_lab_agents.shell_tool import apply_writes, extract_writes

        text = (
            "WRITE: foo.py\n"
            "```python\n"
            "x = 1\n"
            "```\n"
            "DONE — wrote foo\n"
            "WRITE: evil.py\n"
            "```\n"
            "nope\n"
            "```\n"
        )
        writes = extract_writes(text)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], "foo.py")
        with tempfile.TemporaryDirectory() as td:
            res = apply_writes(writes, cwd=td)
            self.assertTrue(res[0].ok)
            self.assertEqual(Path(td, "foo.py").read_text(), "x = 1\n")
            bad = apply_writes([("../x", "no")], cwd=td)
            self.assertFalse(bad[0].ok)

    def test_write_dash_block(self) -> None:
        from spockify_lab_agents.shell_tool import apply_writes, extract_writes

        text = (
            "WRITE: foo.py\n"
            "---\n"
            "x = 2\n"
            "---\n"
            "RUN: pytest -q\n"
            "DONE — ok\n"
        )
        writes = extract_writes(text)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], "foo.py")
        self.assertEqual(writes[0][1], "x = 2")
        with tempfile.TemporaryDirectory() as td:
            res = apply_writes(writes, cwd=td)
            self.assertTrue(res[0].ok)
            self.assertEqual(Path(td, "foo.py").read_text(), "x = 2\n")

    def test_write_salvage_after_done(self) -> None:
        from spockify_lab_agents.shell_tool import (
            extract_pytest_after_done,
            extract_writes,
        )

        text = (
            "DONE — fixed\n"
            "FINDINGS: ok\n"
            "ARTIFACTS:\n"
            "WRITE: foo.py\n"
            "```\n"
            "y = 3\n"
            "```\n"
            "RUN: pytest -q\n"
        )
        writes = extract_writes(text)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], "foo.py")
        self.assertEqual(extract_pytest_after_done(text), ["pytest -q"])

    def test_write_embedded_in_fence(self) -> None:
        from spockify_lab_agents.shell_tool import (
            extract_pytest_after_done,
            extract_writes,
        )

        text = (
            "RUN: cat test_x.py\n"
            "DONE — fixed\n"
            "ARTIFACTS:\n"
            "```\n"
            "WRITE: config.json\n"
            '{\n    "tax_bps": 800\n}\n'
            "```\n"
            "```\n"
            "WRITE: tax.py\n"
            "def apply_tax(cents, bps):\n"
            "    return cents + cents * bps // 10000\n"
            "```\n"
            "RUN: pytest -q\n"
        )
        writes = extract_writes(text)
        self.assertEqual(len(writes), 2)
        paths = {w[0] for w in writes}
        self.assertEqual(paths, {"config.json", "tax.py"})
        self.assertIn("tax_bps", writes[0][1])
        self.assertEqual(extract_pytest_after_done(text), ["pytest -q"])

    def test_write_bare_json_body(self) -> None:
        from spockify_lab_agents.shell_tool import extract_writes

        text = (
            "DONE — fixed config\n"
            "WRITE: config.json\n"
            '{\n    "tax_bps": 800,\n    "currency": "USD"\n}\n'
            "RUN: pytest -q\n"
        )
        writes = extract_writes(text)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], "config.json")
        self.assertIn("800", writes[0][1])

    def test_block_test_path_writes(self) -> None:
        import tempfile
        from pathlib import Path

        from spockify_lab_agents.shell_tool import apply_writes

        with tempfile.TemporaryDirectory() as td:
            Path(td, "test_x.py").write_text("def test_x():\n    assert True\n")
            res = apply_writes(
                [("test_x.py", "def test_x():\n    assert False\n")],
                cwd=td,
                block_tests=True,
            )
            self.assertFalse(res[0].ok)
            self.assertIn("blocked", res[0].error)
            self.assertIn("assert True", Path(td, "test_x.py").read_text())

    def test_reject_empty_write_body(self) -> None:
        import tempfile
        from pathlib import Path

        from spockify_lab_agents.shell_tool import apply_writes

        with tempfile.TemporaryDirectory() as td:
            Path(td, "a.py").write_text("x = 1\n", encoding="utf-8")
            res = apply_writes([("a.py", "  \n")], cwd=td)
            self.assertFalse(res[0].ok)
            self.assertIn("empty", res[0].error)
            self.assertEqual(Path(td, "a.py").read_text(), "x = 1\n")

    def test_write_unchanged_skips_rewrite(self) -> None:
        from spockify_lab_agents.shell_tool import apply_writes

        with tempfile.TemporaryDirectory() as td:
            Path(td, "a.py").write_text("x = 1\n", encoding="utf-8")
            res = apply_writes([("a.py", "x = 1\n")], cwd=td)
            self.assertTrue(res[0].ok)
            self.assertEqual(res[0].error, "unchanged")
            self.assertEqual(res[0].bytes_written, 0)

    def test_write_double_fence_recovers_body(self) -> None:
        from spockify_lab_agents.shell_tool import extract_writes

        text = (
            "WRITE: rate.py\n"
            "```\n"
            "```python\n"
            "x = 1\n"
            "```\n"
            "DONE — ok\n"
        )
        writes = extract_writes(text)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], "rate.py")
        self.assertIn("x = 1", writes[0][1])

    def test_write_rejects_unified_diff(self) -> None:
        from spockify_lab_agents.shell_tool import apply_writes

        with tempfile.TemporaryDirectory() as td:
            Path(td, "a.py").write_text("x = 1\n", encoding="utf-8")
            body = (
                "diff --git a/a.py b/a.py\n"
                "--- a/a.py\n"
                "+++ b/a.py\n"
                "@@ -1 +1 @@\n"
                "-x = 1\n"
                "+x = 2\n"
            )
            res = apply_writes([("a.py", body)], cwd=td)
            self.assertFalse(res[0].ok)
            self.assertIn("diff", res[0].error.lower())
            self.assertEqual(Path(td, "a.py").read_text(), "x = 1\n")

    def test_write_inside_python_fence_with_run(self) -> None:
        from spockify_lab_agents.shell_tool import extract_writes

        text = (
            "```python\n"
            "RUN: cat test_rate.py\n"
            "WRITE: rate.py\n"
            '"""\n'
            "x = 1\n"
            '"""\n'
            "RUN: pytest -q\n"
            "```\n"
            "DONE — fixed\n"
        )
        writes = extract_writes(text)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], "rate.py")
        self.assertIn("x = 1", writes[0][1])

    def test_deny_spockify_and_pipes(self) -> None:
        self.assertIsNotNone(validate_command("spockify lab"))
        self.assertIsNotNone(validate_command("ls | wc"))
        self.assertIsNone(validate_command("ls -la"))
        self.assertIsNone(validate_command("cat hello.py"))

    def test_run_ls(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            Path(td, "a.txt").write_text("hi\n", encoding="utf-8")
            r = run_shell("ls", cwd=td)
            self.assertTrue(r.ok)
            self.assertIn("a.txt", r.output)


if __name__ == "__main__":
    unittest.main()
