#!/usr/bin/env python3
"""Unit tests for FAIL_TO_PASS smoke path mapping (no LiteLLM / no GPU)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import run_harness_swe_one as swe


class UnittestStyleToLabelTest(unittest.TestCase):
    def test_django_11422_name(self) -> None:
        raw = (
            "test_main_module_is_resolved "
            "(utils_tests.test_autoreload.TestIterModulesAndFiles)"
        )
        self.assertEqual(
            swe._unittest_style_to_label(raw),
            "utils_tests.test_autoreload.TestIterModulesAndFiles."
            "test_main_module_is_resolved",
        )

    def test_non_unittest_returns_none(self) -> None:
        self.assertIsNone(swe._unittest_style_to_label("tests/foo.py::test_bar"))
        self.assertIsNone(swe._unittest_style_to_label(""))


class MapFailToPassArgvTest(unittest.TestCase):
    def test_django_uses_runtests_and_venv_python(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "tests").mkdir()
            (work / "tests" / "runtests.py").write_text("# stub\n", encoding="utf-8")
            py = work / ".venv" / "bin" / "python"
            py.parent.mkdir(parents=True)
            py.write_text("#!/bin/true\n", encoding="utf-8")
            cmd, mode = swe._map_fail_to_pass_argv(
                work,
                [
                    "test_main_module_is_resolved "
                    "(utils_tests.test_autoreload.TestIterModulesAndFiles)"
                ],
                py,
            )
            self.assertEqual(mode, "django-runtests")
            self.assertEqual(cmd[0], str(py))
            self.assertEqual(cmd[1], str(work / "tests" / "runtests.py"))
            self.assertIn("--settings=test_sqlite", cmd)
            self.assertIn(
                "utils_tests.test_autoreload.TestIterModulesAndFiles."
                "test_main_module_is_resolved",
                cmd,
            )

    def test_non_django_uses_pytest_k(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            py = Path("/tmp/fake-venv-python")
            cmd, mode = swe._map_fail_to_pass_argv(
                work,
                ["test_foo (pkg.mod.Class)"],
                py,
            )
            self.assertEqual(mode, "pytest")
            self.assertEqual(cmd[:4], [str(py), "-m", "pytest", "-q"])
            self.assertIn("-k", cmd)
            self.assertIn("test_foo", cmd)


class SmokeExecutedFailureTest(unittest.TestCase):
    def test_ran_failed_with_import_error_is_real_fail(self) -> None:
        out = (
            "Ran 1 test in 0.001s\n\n"
            "FAILED (errors=1)\n"
            "ModuleNotFoundError: No module named 'transaction'\n"
        )
        self.assertTrue(swe._smoke_executed_failure(out, 1))

    def test_collection_import_error_without_ran_is_not_executed(self) -> None:
        out = "ERROR collecting tests\nImportError: No module named 'oyaml'\n"
        self.assertFalse(swe._smoke_executed_failure(out, 2))

    def test_smoke_import_error_after_ran_continues_not_skip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            venv_py = work / ".venv" / "bin" / "python"
            with mock.patch.object(swe, "_ensure_smoke_venv", return_value=venv_py):
                with mock.patch.object(
                    swe,
                    "_map_fail_to_pass_argv",
                    return_value=(["false"], "django-runtests"),
                ):
                    with mock.patch.object(swe.subprocess, "run") as run:
                        run.return_value = mock.Mock(
                            returncode=1,
                            stdout=(
                                "Ran 1 test in 0.0s\n"
                                "FAILED (errors=1)\n"
                                "ModuleNotFoundError: No module named 'transaction'\n"
                            ),
                            stderr="",
                        )
                        ok, out = swe._smoke_fail_to_pass(
                            work,
                            [
                                "test_circular_reference "
                                "(backends.base.test_creation.TestDeserializeDbFromString)"
                            ],
                        )
        self.assertIs(ok, False)
        self.assertIn("ModuleNotFoundError", out)
        self.assertNotIn("smoke skipped", out)


class SmokeRefusesHostPythonTest(unittest.TestCase):
    def test_no_venv_skips_without_host_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            with mock.patch.object(swe, "_ensure_smoke_venv", return_value=None):
                ok, out = swe._smoke_fail_to_pass(work, ["test_a (m.C)"])
            self.assertIsNone(ok)
            self.assertIn("no repo .venv", out)


class SmokeTracebackSnippetsTest(unittest.TestCase):
    def test_includes_cited_test_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            target = work / "tests" / "syndication_tests" / "tests.py"
            target.parent.mkdir(parents=True)
            target.write_text(
                "\n".join(
                    [
                        "class SyndicationFeedTest:",
                        "    def test_rss2_feed(self):",
                        "        self.assertChildNodeContent(items[0], {",
                        "            'comments': '/blog/1/comments',",
                        "        })",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            smoke = (
                f'File "{target}", line 3, in test_rss2_feed\n'
                "    self.assertChildNodeContent(items[0], {\n"
                "IndexError: list index out of range\n"
            )
            snip = swe._smoke_traceback_source_snippets(work, smoke)
            self.assertIn("tests/syndication_tests/tests.py:3", snip)
            self.assertIn("'comments': '/blog/1/comments'", snip)
            self.assertIn(">> 3:", snip)

    def test_skips_paths_outside_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            smoke = 'File "/usr/lib/python3.12/unittest/case.py", line 90, in run\n'
            self.assertEqual(swe._smoke_traceback_source_snippets(work, smoke), "")


class SmokeContinuePromptTest(unittest.TestCase):
    def test_requires_apply_patch_and_embeds_snippets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            target = work / "tests" / "syndication_tests" / "tests.py"
            target.parent.mkdir(parents=True)
            target.write_text(
                "x\ny\nself.assertChildNodeContent(items[0], {'comments': 'c'})\n",
                encoding="utf-8",
            )
            smoke = (
                f'File "{target}", line 3, in test_rss2_feed\n'
                "IndexError: list index out of range\n"
            )
            prompt = swe._smoke_continue_prompt(
                work,
                ["test_rss2_feed (syndication_tests.tests.SyndicationFeedTest)"],
                smoke,
            )
            self.assertIn("MUST call apply_patch", prompt)
            self.assertIn("'comments': 'c'", prompt)
            self.assertIn("tests/syndication_tests/tests.py", prompt)


class NoEditContinueGateTest(unittest.TestCase):
    def test_is_edit_tool_names(self) -> None:
        self.assertTrue(swe._is_edit_tool("apply_patch"))
        self.assertTrue(swe._is_edit_tool("repo_browser.apply_patch"))
        self.assertTrue(swe._is_edit_tool("edit_file"))
        self.assertTrue(swe._is_edit_tool("write_file"))
        self.assertFalse(swe._is_edit_tool("read"))
        self.assertFalse(swe._is_edit_tool("glob_file_search"))
        self.assertFalse(swe._is_edit_tool(None))

    def test_needs_gate_on_zero_edits_or_unchanged_diff(self) -> None:
        self.assertTrue(
            swe._needs_no_edit_continue(
                edit_starts=0, diff_before="a", diff_after="a"
            )
        )
        self.assertTrue(
            swe._needs_no_edit_continue(
                edit_starts=0, diff_before="a", diff_after="b"
            )
        )
        self.assertTrue(
            swe._needs_no_edit_continue(
                edit_starts=2, diff_before="a", diff_after="a"
            )
        )
        self.assertFalse(
            swe._needs_no_edit_continue(
                edit_starts=1, diff_before="a", diff_after="b"
            )
        )

    def test_no_edit_prompt_requires_apply_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            prompt = swe._no_edit_continue_prompt(
                work,
                ["test_x (pkg.mod.Cls)"],
                "FAILED\n",
            )
            self.assertIn("MUST call apply_patch", prompt)
            self.assertIn("0 apply_patch", prompt)


class FailToPassHintTest(unittest.TestCase):
    def test_django_hint_mentions_runtests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "tests").mkdir()
            (work / "tests" / "runtests.py").write_text("#\n", encoding="utf-8")
            hint = swe._fail_to_pass_hint(
                work,
                work / ".venv" / "bin" / "python",
                [
                    "test_main_module_is_resolved "
                    "(utils_tests.test_autoreload.TestIterModulesAndFiles)"
                ],
            )
            self.assertIn("tests/runtests.py", hint)
            self.assertIn("test_sqlite", hint)
            self.assertIn("host conda", hint.lower())

    def test_path_hint_maps_django_fail_to_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            target = work / "tests" / "model_fields" / "tests.py"
            target.parent.mkdir(parents=True)
            target.write_text("# stub\n", encoding="utf-8")
            paths = swe._fail_to_pass_test_paths(
                work,
                [
                    "test_overriding_inherited_FIELD_display "
                    "(model_fields.tests.GetFieldDisplayTests)"
                ],
            )
            self.assertEqual(paths, ["tests/model_fields/tests.py"])
            hint = swe._fail_to_pass_path_hint(
                work,
                [
                    "test_overriding_inherited_FIELD_display "
                    "(model_fields.tests.GetFieldDisplayTests)"
                ],
            )
            self.assertIn("tests/model_fields/tests.py", hint)
            self.assertIn("production", hint.lower())


class ApplyTestPatchTest(unittest.TestCase):
    def _git_repo_with_file(self, work: Path, rel: str, body: str) -> Path:
        subprocess = __import__("subprocess")
        subprocess.run(["git", "init"], cwd=work, check=True, capture_output=True)
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit",
             "--allow-empty", "-m", "init"],
            cwd=work,
            check=True,
            capture_output=True,
        )
        target = work / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
        subprocess.run(["git", "add", rel], cwd=work, check=True)
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit",
             "-m", "add"],
            cwd=work,
            check=True,
            capture_output=True,
        )
        return target

    def test_applies_and_commits_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            target = self._git_repo_with_file(
                work, "tests/t.py", "def a():\n    return 1\n"
            )
            patch = (
                "diff --git a/tests/t.py b/tests/t.py\n"
                "--- a/tests/t.py\n"
                "+++ b/tests/t.py\n"
                "@@ -1,2 +1,3 @@\n"
                " def a():\n"
                "     return 1\n"
                "+def b():\n"
                "+\n"
            )
            self.assertTrue(swe._apply_test_patch(work, patch))
            self.assertIn("def b():", target.read_text(encoding="utf-8"))
            log = __import__("subprocess").run(
                ["git", "log", "-1", "--pretty=%s"],
                cwd=work,
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            self.assertIn("test_patch baseline", log)

    def test_preserves_trailing_blank_context_line(self) -> None:
        """13315: .strip() dropped final ' \\n' context → corrupt patch at line N."""
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            # File ends with blank line (matches trailing " \\n" context in patch).
            target = self._git_repo_with_file(
                work,
                "tests/t.py",
                "def a():\n    return 1\n\n",
            )
            # Hunk ends with space-prefixed blank context (must not be stripped).
            patch = (
                "diff --git a/tests/t.py b/tests/t.py\n"
                "--- a/tests/t.py\n"
                "+++ b/tests/t.py\n"
                "@@ -1,3 +1,4 @@\n"
                " def a():\n"
                "     return 1\n"
                "+def b():\n"
                " \n"
            )
            self.assertTrue(patch.endswith(" \n"))
            self.assertFalse(swe._apply_test_patch(work, patch.strip()))
            # Reset tree after failed apply attempt left no commit.
            __import__("subprocess").run(
                ["git", "checkout", "--", "."], cwd=work, check=True, capture_output=True
            )
            self.assertTrue(swe._apply_test_patch(work, patch))
            self.assertIn("def b():", target.read_text(encoding="utf-8"))


class SmokeMissingFailToPassTest(unittest.TestCase):
    def _smoke_with_out(self, out: str, tests: list[str]):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "tests").mkdir()
            (work / "tests" / "runtests.py").write_text("#\n", encoding="utf-8")
            venv_py = work / ".venv" / "bin" / "python"
            venv_py.parent.mkdir(parents=True)
            venv_py.write_text("#!/bin/true\n", encoding="utf-8")
            venv_py.chmod(0o755)
            with mock.patch.object(swe, "_ensure_smoke_venv", return_value=venv_py):
                with mock.patch.object(
                    swe.subprocess,
                    "run",
                    return_value=mock.Mock(returncode=1, stdout=out, stderr=""),
                ):
                    return swe._smoke_fail_to_pass(work, tests)

    def test_missing_test_method_is_infra_skip_not_fail(self) -> None:
        """13315: loader _FailedTest + Ran N must not look like model smoke fail."""
        out = (
            "Testing against Django\n"
            "E\n"
            "ERROR: test_limit_choices_to_no_duplicates "
            "(unittest.loader._FailedTest.test_limit_choices_to_no_duplicates)\n"
            "AttributeError: type object 'LimitChoicesToTests' has no attribute "
            "'test_limit_choices_to_no_duplicates'\n"
            "Ran 1 test in 0.001s\n"
            "FAILED (errors=1)\n"
        )
        ok, msg = self._smoke_with_out(
            out,
            [
                "test_limit_choices_to_no_duplicates "
                "(model_forms.tests.LimitChoicesToTests)"
            ],
        )
        self.assertIsNone(ok)
        self.assertIn("missing FAIL_TO_PASS", msg)

    def test_mixed_failedtest_and_assertion_is_real_fail(self) -> None:
        """13321: docstring F2P titles → _FailedTest, but asserts must continue."""
        out = (
            "ERROR: Falsey values (unittest.loader._FailedTest.Falsey values)\n"
            "AssertionError: {} != {'a test key': 'a test value'}\n"
            "Ran 355 tests in 0.085s\n"
            "FAILED (failures=9, errors=13)\n"
        )
        ok, msg = self._smoke_with_out(
            out,
            ["test_decode_legacy (sessions_tests.tests.CookieSessionTests)"],
        )
        self.assertIs(ok, False)
        self.assertNotIn("missing FAIL_TO_PASS", msg)


if __name__ == "__main__":
    unittest.main()
