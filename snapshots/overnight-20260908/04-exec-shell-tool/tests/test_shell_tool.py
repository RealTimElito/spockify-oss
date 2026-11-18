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
