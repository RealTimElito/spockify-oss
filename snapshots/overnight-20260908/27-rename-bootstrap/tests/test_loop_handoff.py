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

    def test_gate_done_requires_pytest(self) -> None:
        from spockify_lab_agents.loop import Plan, gate_done_requires_pytest

        done = Plan(status="done", summary="claimed", tasks=[])
        blocked = gate_done_requires_pytest(
            done, "make pytest pass", history=[]
        )
        self.assertEqual(blocked.status, "continue")
        self.assertTrue(blocked.tasks)
        ok_hist = [
            {
                "completed_work": [
                    {"pytest_passed": True, "writes_ok": ["x.py"]}
                ]
            }
        ]
        allowed = gate_done_requires_pytest(
            done, "make pytest pass", ok_hist
        )
        self.assertEqual(allowed.status, "done")

    def test_workspace_paths_mentioned(self) -> None:
        from spockify_lab_agents.loop import workspace_paths_mentioned

        paths = workspace_paths_mentioned(
            "Fix config.json and tax.py; see ledger.py",
            "also test_ledger.py",
        )
        self.assertIn("config.json", paths)
        self.assertIn("tax.py", paths)
        self.assertIn("ledger.py", paths)

    def test_preseed_prefers_pytest_over_test_cat(self) -> None:
        import tempfile
        from pathlib import Path

        from spockify_lab_agents.loop import collect_preseed_commands

        with tempfile.TemporaryDirectory() as td:
            Path(td, "tax.py").write_text("x=1\n", encoding="utf-8")
            Path(td, "test_tax.py").write_text("def test_x():\n    assert True\n")
            cmds = collect_preseed_commands(
                "fix it",
                td,
                goal="Fix tax.py so pytest passes; see test_tax.py",
            )
            self.assertIn("cat tax.py", cmds)
            self.assertIn("pytest -q", cmds)
            self.assertNotIn("cat test_tax.py", cmds)

    def test_bootstrap_plan_from_goal(self) -> None:
        import tempfile
        from pathlib import Path

        from spockify_lab_agents.loop import bootstrap_plan_from_goal

        with tempfile.TemporaryDirectory() as td:
            Path(td, "a.py").write_text("x=1\n", encoding="utf-8")
            Path(td, "b.py").write_text("y=2\n", encoding="utf-8")
            p = bootstrap_plan_from_goal(
                "Fix a.py and b.py so pytest passes.",
                td,
            )
            self.assertIsNotNone(p)
            assert p is not None
            self.assertEqual(p.status, "continue")
            self.assertEqual(len(p.tasks), 1)
            self.assertIn("pytest", p.tasks[0].instructions.lower())

    def test_goal_needs_pytest_verify_not_propose(self) -> None:
        from spockify_lab_agents.loop import (
            bootstrap_plan_from_goal,
            goal_needs_pytest_verify,
        )

        self.assertTrue(
            goal_needs_pytest_verify("Fix tax.py so pytest passes.")
        )
        self.assertTrue(goal_needs_pytest_verify("RUN: pytest -q until green"))
        self.assertFalse(
            goal_needs_pytest_verify(
                "Propose a pytest for greeter.py; do not run tests."
            )
        )
        self.assertFalse(
            goal_needs_pytest_verify("Write API.md documenting greeter.py")
        )

    def test_bootstrap_skips_propose_pytest(self) -> None:
        import tempfile
        from pathlib import Path

        from spockify_lab_agents.loop import bootstrap_plan_from_goal

        with tempfile.TemporaryDirectory() as td:
            Path(td, "greeter.py").write_text("def g():\n    return 1\n")
            self.assertIsNone(
                bootstrap_plan_from_goal(
                    "Propose a pytest for greeter.py; do not run it.",
                    td,
                )
            )

    def test_bootstrap_docs_plan_from_goal(self) -> None:
        import tempfile
        from pathlib import Path

        from spockify_lab_agents.loop import bootstrap_docs_plan_from_goal

        with tempfile.TemporaryDirectory() as td:
            Path(td, "greeter.py").write_text("def greet():\n    return 'hi'\n")
            p = bootstrap_docs_plan_from_goal(
                "Write API.md documenting greeter.py public functions.",
                td,
            )
            self.assertIsNotNone(p)
            assert p is not None
            self.assertEqual(len(p.tasks), 1)
            self.assertIn("API.md", p.tasks[0].instructions)
            self.assertNotIn("pytest", p.tasks[0].instructions.lower())
            # Rename/edit without doc target must not docs-bootstrap.
            self.assertIsNone(
                bootstrap_docs_plan_from_goal(
                    "Rename old_name to bump in core.py and app.py.",
                    td,
                )
            )

    def test_bootstrap_rename_plan_from_goal(self) -> None:
        import tempfile
        from pathlib import Path

        from spockify_lab_agents.loop import bootstrap_rename_plan_from_goal

        with tempfile.TemporaryDirectory() as td:
            Path(td, "core.py").write_text("def old_name(x):\n    return x\n")
            Path(td, "app.py").write_text("from core import old_name\n")
            p = bootstrap_rename_plan_from_goal(
                "Rename the function old_name to bump in core.py and app.py.",
                td,
            )
            self.assertIsNotNone(p)
            assert p is not None
            self.assertIn("old_name", p.summary)
            self.assertIn("bump", p.summary)
            self.assertNotIn("pytest", p.tasks[0].instructions.lower())
            self.assertIsNone(
                bootstrap_rename_plan_from_goal(
                    "Write API.md documenting greeter.py",
                    td,
                )
            )

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
