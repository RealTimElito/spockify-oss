"""Unit tests for parallel multi-agent orchestration (incl. stretch)."""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock

import parallel_agents as pagents


class ParallelAgentsTests(unittest.TestCase):
    def setUp(self) -> None:
        pagents._AGENT_RUNS.clear()
        pagents._RUN_EVENTS.clear()
        pagents._CANCEL_FLAGS.clear()
        pagents._WORKER_CANCEL.clear()
        pagents._RUN_TASKS.clear()

    def test_wants_parallel_agents(self) -> None:
        self.assertTrue(pagents.wants_parallel_agents("Please spawn agents to research this"))
        self.assertTrue(pagents.wants_parallel_agents("/agents compare flask vs fastapi"))
        self.assertTrue(pagents.wants_parallel_agents("research in parallel please"))
        self.assertFalse(pagents.wants_parallel_agents("just say hello"))

    def test_auto_plan_caps_at_max(self) -> None:
        workers = pagents._auto_plan_workers("x" * 500, "gemma4-12b")
        self.assertLessEqual(len(workers), pagents.AGENTS_MAX_WORKERS)
        self.assertGreaterEqual(len(workers), 2)
        self.assertEqual(workers[0]["model"], "gemma4-12b")

    def test_normalize_explicit_workers(self) -> None:
        specs = [
            pagents.AgentWorkerSpec(id="a", name="Alpha", prompt="do A", model="codestral"),
            pagents.AgentWorkerSpec(id="b", name="Beta", prompt="do B"),
        ]
        out = pagents._normalize_workers(specs, "parent", "spockify-auto")
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["model"], "codestral")
        self.assertEqual(out[1]["model"], pagents.AGENTS_DEFAULT_MODEL)

    def test_normalize_nested_children(self) -> None:
        specs = [
            pagents.AgentWorkerSpec(
                id="parent",
                name="Parent",
                prompt="top",
                children=[
                    pagents.AgentWorkerSpec(id="c1", name="Child", prompt="nested work"),
                ],
            )
        ]
        out = pagents._normalize_workers(specs, "parent prompt", "gemma4-12b", depth=0)
        self.assertIsNotNone(out[0]["children"])
        self.assertEqual(out[0]["children"][0]["id"], "c1")

    def test_create_and_execute_run_partial_failure(self) -> None:
        async def _run() -> None:
            body = pagents.AgentRunCreate(
                parent_prompt="Compare two approaches",
                model="gemma4-12b",
                workers=[
                    pagents.AgentWorkerSpec(id="ok", name="OK", prompt="succeed"),
                    pagents.AgentWorkerSpec(id="bad", name="Bad", prompt="fail"),
                ],
                synthesize=True,
            )
            run = pagents.create_run_record(body)
            self.assertEqual(run["status"], "pending")
            self.assertEqual(len(run["workers"]), 2)

            async def fake_worker_chat(client, model, messages, **kwargs):
                user = messages[-1]["content"]
                if "fail" in user:
                    raise RuntimeError("boom")
                return {
                    "choices": [
                        {"message": {"content": f"answer from {model}: ok"}}
                    ]
                }

            final = await pagents.execute_run(
                run, client=object(), worker_chat=fake_worker_chat
            )
            self.assertEqual(final["status"], "done")
            statuses = {w["id"]: w["status"] for w in final["workers"]}
            self.assertEqual(statuses["ok"], "done")
            self.assertEqual(statuses["bad"], "failed")
            self.assertTrue(final.get("synthesis"))

            loaded = pagents.get_run(str(final["id"]))
            self.assertIsNotNone(loaded)
            view = pagents.public_run_view(loaded)  # type: ignore[arg-type]
            self.assertEqual(view["status"], "done")
            self.assertEqual(len(view["workers"]), 2)

        asyncio.run(_run())

    def test_cancel_run(self) -> None:
        async def _run() -> None:
            body = pagents.AgentRunCreate(
                parent_prompt="slow work",
                workers=[
                    pagents.AgentWorkerSpec(id="w1", name="W1", prompt="go"),
                ],
            )
            run = pagents.create_run_record(body)
            gate = asyncio.Event()

            async def slow_chat(client, model, messages, **kwargs):
                gate.set()
                await asyncio.sleep(5)
                return {"choices": [{"message": {"content": "late"}}]}

            task = asyncio.create_task(
                pagents.execute_run(run, client=object(), worker_chat=slow_chat)
            )
            pagents.register_run_task(str(run["id"]), task)
            await gate.wait()
            cancelled = pagents.request_cancel(str(run["id"]))
            self.assertIsNotNone(cancelled)
            self.assertEqual(cancelled["status"], "cancelled")  # type: ignore[index]
            try:
                await asyncio.wait_for(task, timeout=2)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            final = pagents.get_run(str(run["id"]))
            self.assertEqual(final["status"], "cancelled")  # type: ignore[index]

        asyncio.run(_run())

    def test_nested_children_execute(self) -> None:
        async def _run() -> None:
            body = pagents.AgentRunCreate(
                parent_prompt="parent task",
                workers=[
                    pagents.AgentWorkerSpec(
                        id="p",
                        name="Parent",
                        prompt="do parent SPAWN_CHILDREN:[]",
                        children=[
                            pagents.AgentWorkerSpec(
                                id="c1", name="Child", prompt="child work"
                            )
                        ],
                    )
                ],
                synthesize=False,
            )
            run = pagents.create_run_record(body)

            async def fake_chat(client, model, messages, **kwargs):
                user = messages[-1]["content"]
                return {
                    "choices": [
                        {"message": {"content": f"out:{user[:40]}"}}
                    ]
                }

            final = await pagents.execute_run(
                run, client=object(), worker_chat=fake_chat
            )
            self.assertEqual(final["status"], "done")
            parent = final["workers"][0]
            self.assertEqual(parent["status"], "done")
            self.assertTrue(parent.get("children"))
            self.assertEqual(parent["children"][0]["status"], "done")
            self.assertIn("Nested workers", parent["output"])

        asyncio.run(_run())

    def test_shared_search_tool(self) -> None:
        async def _run() -> None:
            body = pagents.AgentRunCreate(
                parent_prompt="What is the weather trend in Lisbon?",
                workers=[
                    pagents.AgentWorkerSpec(
                        id="e",
                        name="Explorer",
                        prompt="research Lisbon weather",
                        tools=["search"],
                    )
                ],
                synthesize=False,
            )
            run = pagents.create_run_record(body)
            search_calls: list[str] = []

            async def fake_search(client, query: str) -> str:
                search_calls.append(query)
                return "Web search results for: Lisbon\n1. Sunny\n"

            async def fake_chat(client, model, messages, **kwargs):
                content = messages[-1]["content"]
                self.assertIn("Shared tool context", content)
                return {"choices": [{"message": {"content": "Lisbon is mild"}}]}

            final = await pagents.execute_run(
                run,
                client=object(),
                worker_chat=fake_chat,
                search_tool=fake_search,
            )
            self.assertEqual(final["status"], "done")
            self.assertTrue(search_calls)
            self.assertIn("search", final["workers"][0].get("tools_used") or [])

        asyncio.run(_run())

    def test_parse_spawn_children(self) -> None:
        text = 'Hello\nSPAWN_CHILDREN:[{"name":"A","prompt":"do A"},{"name":"B","prompt":"do B"}]\n'
        kids = pagents._parse_spawn_children(text)
        self.assertEqual(len(kids), 2)
        self.assertEqual(kids[0]["name"], "A")
        cleaned = pagents._strip_spawn_marker(text)
        self.assertNotIn("SPAWN_CHILDREN", cleaned)

    def test_is_agents_model(self) -> None:
        self.assertTrue(pagents.is_agents_model("spockify-agents"))
        self.assertTrue(pagents.is_agents_model("openai/spockify-agents"))
        self.assertFalse(pagents.is_agents_model("spockify-auto"))
        self.assertFalse(pagents.is_agents_model("spockify-room"))

    def test_plan_heavy_workers_full_role_set(self) -> None:
        specs = pagents.plan_heavy_workers("Design a resilient job queue")
        # Always the full role set (capped at AGENTS_MAX_WORKERS), not length-scaled.
        self.assertEqual(len(specs), min(4, pagents.AGENTS_MAX_WORKERS))
        names = [s.name for s in specs]
        self.assertIn("Explorer", names)
        self.assertIn("Skeptic", names)

    def test_plan_heavy_workers_round_robins_models(self) -> None:
        specs = pagents.plan_heavy_workers(
            "hi", models=["model-a", "model-b"]
        )
        models = [s.model for s in specs]
        self.assertEqual(models[0], "model-a")
        self.assertEqual(models[1], "model-b")
        self.assertEqual(models[2], "model-a")

    def test_heavy_run_uses_per_run_budgets(self) -> None:
        async def _run() -> None:
            body = pagents.AgentRunCreate(
                parent_prompt="deep question",
                model="gemma4-26b",
                workers=pagents.plan_heavy_workers("deep question"),
                synthesize=True,
                profile="heavy",
                worker_timeout=222.0,
                synth_timeout=222.0,
                max_tokens=4096,
                synth_max_tokens=4096,
                synth_model="gemma4-26b",
            )
            run = pagents.create_run_record(body)
            self.assertEqual(run["profile"], "heavy")
            self.assertEqual(pagents._cfg_worker_timeout(run), 222.0)
            self.assertEqual(pagents._cfg_worker_max_tokens(run), 4096)
            self.assertEqual(pagents._cfg_synth_timeout(run), 222.0)
            self.assertEqual(pagents._cfg_synth_max_tokens(run), 4096)

            seen_tokens: list[int] = []

            async def fake_chat(client, model, messages, **kwargs):
                seen_tokens.append(int(kwargs.get("max_tokens") or 0))
                return {"choices": [{"message": {"content": f"ok {model}"}}]}

            final = await pagents.execute_run(
                run, client=object(), worker_chat=fake_chat
            )
            self.assertEqual(final["status"], "done")
            # Every worker + synth call should have used the raised heavy budget.
            self.assertTrue(seen_tokens)
            self.assertTrue(all(t == 4096 for t in seen_tokens))

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
