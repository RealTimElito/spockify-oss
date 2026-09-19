"""Unit tests for gpt-oss / mini-swe content salvage (LEAP thrash fix)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

# Allow importing sibling module without installing as a package.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from spockify_docker_env import (  # noqa: E402
    looks_like_sed_literal_newline,
    looks_like_submit,
    normalize_description_drift_in_text,
    sanitize_command,
    wrap_submit_with_py_compile,
)
from spockify_litellm_model import (  # noqa: E402
    EMPTY_STOP_HARD_FINISH_CMD,
    EMPTY_STOP_RECOVERY_CMD,
    EMPTY_STOP_SUBMIT_CMD,
    TOOL_PARSE_RECOVERY_CMD,
    _bash_fence,
    _is_ollama_tool_parse_fail,
    _is_retry_storm_fail,
    coalesce_assistant_text,
)


class CoalesceAssistantTextTest(unittest.TestCase):
    def test_passthrough_bash_content(self) -> None:
        msg = SimpleNamespace(
            content="```bash\nls\n```",
            tool_calls=None,
            reasoning_content=None,
        )
        self.assertEqual(coalesce_assistant_text(msg), "```bash\nls\n```")

    def test_normalize_bare_fence(self) -> None:
        msg = SimpleNamespace(
            content="```\nls /testbed\n```",
            tool_calls=None,
            reasoning_content=None,
        )
        out = coalesce_assistant_text(msg)
        self.assertIn("```bash", out)
        self.assertIn("ls /testbed", out)

    def test_tool_call_container_exec(self) -> None:
        msg = SimpleNamespace(
            content="",
            tool_calls=[
                {
                    "function": {
                        "name": "container.exec",
                        "arguments": '{"cmd": ["bash", "-lc", "ls -R"]}',
                    }
                }
            ],
            reasoning_content="thinking only",
        )
        out = coalesce_assistant_text(msg)
        self.assertEqual(out, "```bash\nls -R\n```")

    def test_reasoning_fence_salvage(self) -> None:
        msg = SimpleNamespace(
            content="",
            tool_calls=None,
            reasoning_content="I will list files.\n```bash\nls\n```\n",
        )
        out = coalesce_assistant_text(msg)
        self.assertEqual(out, "```bash\nls\n```")

    def test_empty_stays_empty(self) -> None:
        msg = SimpleNamespace(content="", tool_calls=None, reasoning_content="just prose.")
        self.assertEqual(coalesce_assistant_text(msg), "")

    def test_empty_stop_recovery_fence(self) -> None:
        self.assertIn("git status", EMPTY_STOP_RECOVERY_CMD)
        self.assertEqual(
            _bash_fence(EMPTY_STOP_RECOVERY_CMD),
            f"```bash\n{EMPTY_STOP_RECOVERY_CMD}\n```",
        )

    def test_tool_parse_fail_detect(self) -> None:
        self.assertTrue(
            _is_ollama_tool_parse_fail(
                RuntimeError('error parsing tool call: raw=\'{"cmd":\', err=unexpected end of JSON input')
            )
        )
        self.assertFalse(_is_ollama_tool_parse_fail(RuntimeError("connection reset")))
        self.assertIn("sed", TOOL_PARSE_RECOVERY_CMD)

    def test_retry_storm_detect(self) -> None:
        self.assertTrue(
            _is_retry_storm_fail(RuntimeError("LiteLLM: InternalServerError status code 500"))
        )
        self.assertFalse(_is_retry_storm_fail(RuntimeError("connection reset")))
        self.assertIn("COMPLETE_TASK_AND_SUBMIT", EMPTY_STOP_SUBMIT_CMD)

    def test_sanitize_grep_r(self) -> None:
        cmd, note = sanitize_command("grep -R alias src/")
        self.assertIn("rg -n", cmd)
        self.assertIsNotNone(note)

    def test_sanitize_ls_r(self) -> None:
        cmd, note = sanitize_command("ls -laR /testbed")
        self.assertNotIn("-laR", cmd)
        self.assertIsNotNone(note)

    def test_block_sed_literal_newline(self) -> None:
        self.assertTrue(
            looks_like_sed_literal_newline(
                "sed -i 's/foo/foo\\n            bar/' src/x.py"
            )
        )
        cmd, note = sanitize_command(
            "sed -i '/alias_identifier_ref/a\\n            continue' src/x.py"
        )
        self.assertIn("BLOCKED", cmd)
        self.assertIsNotNone(note)

    def test_submit_wrap_adds_py_compile(self) -> None:
        raw = "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && cat patch.txt"
        self.assertTrue(looks_like_submit(raw))
        wrapped = wrap_submit_with_py_compile(raw)
        self.assertIn("py_compile", wrapped)
        self.assertIn("checkout", wrapped)
        self.assertIn("COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT", wrapped)
        self.assertIn("REFUSED submit: empty patch", wrapped)
        self.assertIn("git diff -- . > patch.txt", wrapped)

    def test_empty_stop_submit_gates_compile(self) -> None:
        self.assertIn("py_compile", EMPTY_STOP_SUBMIT_CMD)
        self.assertIn("COMPLETE_TASK_AND_SUBMIT", EMPTY_STOP_SUBMIT_CMD)
        self.assertIn("COMPLETE_TASK_AND_SUBMIT", EMPTY_STOP_HARD_FINISH_CMD)
        self.assertIn("git diff", EMPTY_STOP_HARD_FINISH_CMD)

    def test_normalize_description_drift(self) -> None:
        near = (
            'description="Avoid using aliases in from clauses and join conditions"'
        )
        gold = 'description="Avoid aliases in from clauses and join conditions."'
        out, changed = normalize_description_drift_in_text(near)
        self.assertTrue(changed)
        self.assertEqual(out, gold)
        out2, changed2 = normalize_description_drift_in_text(gold)
        self.assertFalse(changed2)
        self.assertEqual(out2, gold)


if __name__ == "__main__":
    unittest.main()
