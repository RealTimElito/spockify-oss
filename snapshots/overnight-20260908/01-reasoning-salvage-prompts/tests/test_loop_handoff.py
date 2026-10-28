"""Unit tests for lab orch↔exec handoff helpers."""

from __future__ import annotations

import unittest

from spockify_lab_agents.loop import (
    ExecResult,
    Task,
    build_exec_digest,
    parse_plan,
    usable_reply,
)


class UsableReplyTest(unittest.TestCase):
    def test_prefers_content(self) -> None:
        self.assertEqual(
            usable_reply('{"status":"done","summary":"ok","tasks":[]}', "noise"),
            '{"status":"done","summary":"ok","tasks":[]}',
        )

    def test_salvages_plan_json_from_reasoning(self) -> None:
        reasoning = (
            "Let me think about the goal...\n"
            'Eventually: {"status":"continue","summary":"inspect","tasks":'
            '[{"id":"t1","title":"list","instructions":"run ls -la"}]}\n'
        )
        out = usable_reply("", reasoning)
        plan = parse_plan(out)
        self.assertEqual(plan.status, "continue")
        self.assertEqual(len(plan.tasks), 1)
        self.assertEqual(plan.tasks[0].id, "t1")

    def test_salvages_done_from_reasoning(self) -> None:
        reasoning = (
            "thinking...\n"
            "DONE — listed files\n"
            "FINDINGS: hello.py present\n"
            "ARTIFACTS: ls -la\n"
        )
        out = usable_reply("", reasoning)
        self.assertIn("DONE —", out)


class DigestTest(unittest.TestCase):
    def test_extracts_findings_section(self) -> None:
        task = Task(id="t1", title="inspect", instructions="look around")
        r = ExecResult(
            task=task,
            worker=1,
            output=(
                "DONE — found greeting helper\n"
                "FINDINGS: greet() returns hello\n"
                "more detail about hello.py\n"
                "ARTIFACTS: hello.py:1-4\n"
            ),
        )
        d = build_exec_digest(r)
        self.assertEqual(d["status"], "DONE")
        self.assertIn("greet()", d["findings_digest"])
        self.assertIn("hello.py:1-4", d.get("artifacts", ""))

    def test_empty_content_promoted_from_reasoning(self) -> None:
        task = Task(id="t1", title="inspect", instructions="look")
        r = ExecResult(
            task=task,
            worker=1,
            output="",
            reasoning="DONE — ok\nFINDINGS: only in reasoning\n",
        )
        # Callers should pass usable_reply into output; digest also salvages.
        r.output = usable_reply(r.output, r.reasoning)
        r.reasoning = ""
        d = build_exec_digest(r)
        self.assertIn("only in reasoning", d["findings_digest"])


if __name__ == "__main__":
    unittest.main()
