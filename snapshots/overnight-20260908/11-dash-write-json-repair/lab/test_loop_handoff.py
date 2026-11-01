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


class FirstTurnGuardTest(unittest.TestCase):
    def test_forces_inspect_when_done_empty(self) -> None:
        from spockify_lab_agents.loop import force_first_turn_plan, Plan

        p = force_first_turn_plan(
            Plan(status="done", summary="pretend done", tasks=[]),
            has_history=False,
        )
        self.assertEqual(p.status, "continue")
        self.assertEqual(len(p.tasks), 1)
        self.assertIn("shell", p.tasks[0].instructions.lower())

    def test_keeps_done_after_history(self) -> None:
        from spockify_lab_agents.loop import force_first_turn_plan, Plan

        p = force_first_turn_plan(
            Plan(status="done", summary="ok", tasks=[]),
            has_history=True,
        )
        self.assertEqual(p.status, "done")
        self.assertEqual(p.tasks, [])


    def test_repairs_invalid_json_escape(self) -> None:
        from spockify_lab_agents.loop import parse_plan

        # Model typo: \Then instead of \nThen — must still yield tasks.
        raw = (
            '{"status":"continue","summary":"verify","tasks":'
            '[{"id":"t2","title":"pytest",'
            '"instructions":"RUN: pytest -q\\Then summarize under FINDINGS."}]}'
        )
        p = parse_plan(raw)
        self.assertEqual(p.status, "continue")
        self.assertEqual(len(p.tasks), 1)
        self.assertIn("pytest -q", p.tasks[0].instructions)
        self.assertIn("Then summarize", p.tasks[0].instructions)

    def test_coerce_empty_continue_for_pytest_goal(self) -> None:
        from spockify_lab_agents.loop import Plan, coerce_empty_continue

        p = coerce_empty_continue(
            Plan(status="continue", summary="glitch", tasks=[]),
            "fix calc.py so pytest passes",
        )
        self.assertEqual(len(p.tasks), 1)
        self.assertIn("pytest", p.tasks[0].instructions.lower())

    def test_first_of_multiple_json_objects(self) -> None:
        from spockify_lab_agents.loop import parse_plan

        raw = (
            '{"status":"continue","summary":"inspect","tasks":'
            '[{"id":"t1","title":"ls","instructions":"RUN: ls"}]}\n'
            '{"status":"done","summary":"pretend done","tasks":[]}\n'
        )
        p = parse_plan(raw)
        self.assertEqual(p.status, "continue")
        self.assertEqual(len(p.tasks), 1)
        self.assertEqual(p.tasks[0].id, "t1")

    def test_run_ls_prose(self) -> None:
        from spockify_lab_agents.loop import enrich_task_instructions

        out = enrich_task_instructions("Run 'ls' to list files in the workspace")
        self.assertIn("RUN: ls", out)

    def test_preserves_existing_run(self) -> None:
        from spockify_lab_agents.loop import enrich_task_instructions

        raw = "RUN: cat hello.py\nSummarize the file"
        self.assertEqual(enrich_task_instructions(raw), raw)


if __name__ == "__main__":
    unittest.main()
