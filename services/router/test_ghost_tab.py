"""Ghost Tab v2 unit tests — FIM prompts, suppression, fate. Offline."""

from __future__ import annotations

import asyncio
import unittest
import uuid
from unittest import mock

import ghost_fim
import ghost_telemetry
import ghost_writer as ghost_mod


def tearDownModule() -> None:
    # asyncio.run() unsets the policy loop; older test modules in this suite
    # still rely on asyncio.get_event_loop(), so leave a fresh one behind.
    asyncio.set_event_loop(asyncio.new_event_loop())


class FimPromptBuilderTests(unittest.TestCase):
    def test_style_for_model(self) -> None:
        self.assertEqual(
            ghost_fim.fim_style_for_model("starcoder2-7b"), "starcoder"
        )
        self.assertEqual(
            ghost_fim.fim_style_for_model("codegemma:7b"), "codegemma"
        )
        self.assertEqual(
            ghost_fim.fim_style_for_model("codestral:22b"), "codestral"
        )
        self.assertEqual(
            ghost_fim.fim_style_for_model("Mistral-FIM"), "codestral"
        )
        # Unknown models default to starcoder-style sentinels.
        self.assertEqual(ghost_fim.fim_style_for_model("mystery"), "starcoder")

    def test_starcoder_prompt(self) -> None:
        prompt = ghost_fim.build_fim_prompt("starcoder2", "PRE", "SUF")
        self.assertEqual(prompt, "<fim_prefix>PRE<fim_suffix>SUF<fim_middle>")

    def test_codegemma_prompt(self) -> None:
        prompt = ghost_fim.build_fim_prompt("codegemma", "PRE", "SUF")
        self.assertEqual(
            prompt, "<|fim_prefix|>PRE<|fim_suffix|>SUF<|fim_middle|>"
        )

    def test_codestral_prompt_suffix_first(self) -> None:
        prompt = ghost_fim.build_fim_prompt("codestral:22b", "PRE", "SUF")
        self.assertEqual(prompt, "[SUFFIX]SUF[PREFIX] PRE")

    def test_stop_tokens_match_style(self) -> None:
        self.assertIn("<fim_middle>", ghost_fim.fim_stop_tokens("starcoder2"))
        self.assertIn("[SUFFIX]", ghost_fim.fim_stop_tokens("codestral"))

    def test_strip_fim_artifacts(self) -> None:
        self.assertEqual(
            ghost_fim.strip_fim_artifacts("a + b\n[/PREFIX]junk"), "a + b\n"
        )
        self.assertEqual(
            ghost_fim.strip_fim_artifacts("x<|fim_suffix|>y"), "x"
        )
        self.assertEqual(ghost_fim.strip_fim_artifacts("clean()"), "clean()")


class ContextBlockTests(unittest.TestCase):
    def test_sections_commented_for_language(self) -> None:
        block = ghost_fim.build_context_block(
            "python",
            [ghost_fim.GhostDiffHistoryEntry(
                file="a.py", diffs=["@@ -1 +1 @@\n-old\n+new"],
                timestamps=[1])],
            [ghost_fim.GhostContextItem(
                path="b.py", symbol="f", contents="def f(): pass",
                score=0.9)],
            [ghost_fim.GhostLinterError(
                path="a.py", message="undefined name", line=3,
                severity="error")],
        )
        self.assertIn("# === recent edits", block)
        self.assertIn("# === related code", block)
        self.assertIn("# === current linter errors", block)
        self.assertIn("# b.py :: f", block)
        self.assertIn("# a.py:3 [error] undefined name", block)
        for line in block.splitlines():
            self.assertTrue(line.startswith("#"), line)

    def test_diff_budget_keeps_newest(self) -> None:
        old = ghost_fim.GhostDiffHistoryEntry(
            file="old.py", diffs=["-" + "x" * 3000], timestamps=[1]
        )
        new = ghost_fim.GhostDiffHistoryEntry(
            file="new.py", diffs=["+recent_change"], timestamps=[2]
        )
        text = ghost_fim._diff_history_text([old, new], budget=2000)
        self.assertIn("new.py", text)
        self.assertNotIn("old.py", text)
        self.assertLessEqual(len(text), 2000)

    def test_context_items_budget_and_score_order(self) -> None:
        items = [
            ghost_fim.GhostContextItem(
                path=f"f{i}.py", contents="y" * 700, score=i / 10
            )
            for i in range(5)
        ]
        text = ghost_fim._context_items_text(items, budget=1500)
        self.assertLessEqual(len(text), 1500)
        self.assertIn("f4.py", text)  # highest score included first
        self.assertNotIn("f0.py", text)

    def test_linter_budget(self) -> None:
        errors = [
            ghost_fim.GhostLinterError(
                path="a.py", message="m" * 200, line=i, severity="error"
            )
            for i in range(10)
        ]
        text = ghost_fim._linter_text(errors, budget=600)
        self.assertLessEqual(len(text), 600)


class SuppressionTests(unittest.TestCase):
    def test_duplicates_suffix(self) -> None:
        self.assertTrue(
            ghost_fim.duplicates_suffix("return x\n", "\nreturn x\nprint(1)")
        )
        self.assertTrue(
            ghost_fim.duplicates_suffix(
                "a = 1\nb = 2", "\na = 1\nb = 2\nrest"
            )
        )
        self.assertFalse(
            ghost_fim.duplicates_suffix("return y", "\nreturn x")
        )
        self.assertFalse(ghost_fim.duplicates_suffix("return x", ""))

    def test_reverts_deletion(self) -> None:
        history = [
            ghost_fim.GhostDiffHistoryEntry(
                file="a.py",
                diffs=[
                    "@@ -1,3 +1,2 @@\n context\n-deleted_line = 1\n"
                    "-other_deleted()\n+kept = 2"
                ],
                timestamps=[1],
            )
        ]
        self.assertTrue(
            ghost_fim.reverts_deletion("deleted_line = 1", history)
        )
        self.assertTrue(
            ghost_fim.reverts_deletion(
                "deleted_line = 1\nother_deleted()", history
            )
        )
        self.assertFalse(ghost_fim.reverts_deletion("brand_new()", history))
        # "---" file headers are not deletions.
        self.assertFalse(ghost_fim.reverts_deletion("a.py", history))

    def test_rejected_lru(self) -> None:
        lru = ghost_fim.RejectedLru(maxsize=2)
        lru.add("ws", "a.py", 10, "foo()")
        self.assertTrue(lru.contains("ws", "a.py", 10, "foo()"))
        self.assertFalse(lru.contains("ws", "a.py", 11, "foo()"))
        lru.add("ws", "b.py", 1, "x")
        lru.add("ws", "c.py", 2, "y")  # evicts a.py entry
        self.assertFalse(lru.contains("ws", "a.py", 10, "foo()"))

    def test_note_fate_feeds_rejected_lru(self) -> None:
        rid = str(uuid.uuid4())
        ghost_fim.RECENT_REQUESTS.remember(
            rid, workspace_id="ws", rel_path="a.py", line=5,
            suggestion="bad()",
        )
        ghost_fim.note_fate(rid, "accepted")
        self.assertFalse(ghost_fim.REJECTED.contains("ws", "a.py", 5, "bad()"))
        ghost_fim.note_fate(rid, "rejected")
        self.assertTrue(ghost_fim.REJECTED.contains("ws", "a.py", 5, "bad()"))
        self.assertIsNone(ghost_fim.suppress_reason(
            "fine()", suffix="", diff_history=[], workspace_id="ws",
            rel_path="a.py", line=5,
        ))
        self.assertEqual(
            ghost_fim.suppress_reason(
                "bad()", suffix="", diff_history=[], workspace_id="ws",
                rel_path="a.py", line=5,
            ),
            "recently_rejected",
        )


class SuggestV2Tests(unittest.TestCase):
    """suggest(mode=complete) with the Ollama infill backend mocked."""

    @staticmethod
    async def _dummy_chat(client, model, messages, **kwargs):
        return {"choices": [{"message": {"content": ""}}]}

    def _suggest(self, req: ghost_mod.GhostSuggestRequest) -> dict:
        return asyncio.run(
            ghost_mod.suggest(req, worker_chat=self._dummy_chat)
        )

    def test_v2_response_shape_and_request_id_roundtrip(self) -> None:
        rid = str(uuid.uuid4())
        req = ghost_mod.GhostSuggestRequest(
            mode="complete",
            language="python",
            prefix="def add(a, b):\n    return a + ",
            suffix="\n",
            request_id=rid,
            workspace_id="ws1",
            rel_path="calc.py",
            cursor_line=1,
            cursor_col=15,
            trigger="typing",
        )
        with mock.patch.object(
            ghost_fim, "complete_ollama_infill",
            mock.AsyncMock(return_value=("b", "codestral:22b")),
        ):
            out = self._suggest(req)
        self.assertTrue(out["ok"])
        self.assertEqual(out["request_id"], rid)
        self.assertEqual(out["mode"], "insert")
        self.assertEqual(out["insert_text"], "b")
        self.assertEqual(out["suggestion"], "b")  # v1 mirror
        self.assertIsNone(out["edit"])
        self.assertEqual(out["model"], "codestral:22b")
        self.assertIn("latency_ms", out)
        self.assertNotIn("suppress_reason", out)

    def test_generates_request_id_when_absent(self) -> None:
        req = ghost_mod.GhostSuggestRequest(
            mode="complete", language="python",
            prefix="x = compute_", suffix="\n",
        )
        with mock.patch.object(
            ghost_fim, "complete_ollama_infill",
            mock.AsyncMock(return_value=("total()", "codestral:22b")),
        ):
            out = self._suggest(req)
        uuid.UUID(out["request_id"])  # raises when invalid

    def test_duplicate_suffix_suppressed(self) -> None:
        req = ghost_mod.GhostSuggestRequest(
            mode="complete", language="python",
            prefix="def add(a, b):\n    return a + ",
            suffix="b\n    return a + b\n",
        )
        with mock.patch.object(
            ghost_fim, "complete_ollama_infill",
            mock.AsyncMock(return_value=("b\n    return a + b",
                                         "codestral:22b")),
        ):
            out = self._suggest(req)
        self.assertEqual(out["insert_text"], "")
        self.assertEqual(out["suppress_reason"], "duplicates_suffix")

    def test_context_folded_into_fim_prefix(self) -> None:
        req = ghost_mod.GhostSuggestRequest(
            mode="complete", language="python",
            prefix="result = parse_", suffix="\n",
            context_items=[ghost_fim.GhostContextItem(
                path="util.py", symbol="parse_config",
                contents="def parse_config(path): ...", score=1.0,
            )],
        )
        captured: dict = {}

        async def fake_infill(prefix, suffix, **kwargs):
            captured["prefix"] = prefix
            return "config(path)", "codestral:22b"

        with mock.patch.object(
            ghost_fim, "complete_ollama_infill", fake_infill
        ):
            out = self._suggest(req)
        self.assertEqual(out["insert_text"], "config(path)")
        self.assertIn("# util.py :: parse_config", captured["prefix"])
        self.assertTrue(captured["prefix"].endswith("result = parse_"))

    def test_backend_failure_falls_back_to_chat(self) -> None:
        seen: dict = {}

        async def chat(client, model, messages, **kwargs):
            seen["model"] = model
            return {"choices": [{"message": {"content": "b + 1"}}]}

        req = ghost_mod.GhostSuggestRequest(
            mode="complete", language="python",
            prefix="y = a + ", suffix="\n",
        )
        with mock.patch.object(
            ghost_fim, "complete_ollama_infill",
            mock.AsyncMock(side_effect=RuntimeError("ollama down")),
        ):
            out = asyncio.run(ghost_mod.suggest(req, worker_chat=chat))
        self.assertEqual(out["insert_text"], "b + 1")
        self.assertEqual(seen["model"], ghost_mod.GHOST_COMPLETE_MODEL)


class FateEndpointTests(unittest.TestCase):
    def _post(self, path: str, payload: dict):
        from httpx import ASGITransport, AsyncClient

        from main import app

        async def run():
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport, base_url="http://router"
            ) as client:
                return await client.post(path, json=payload)

        return asyncio.run(run())

    def test_fate_ok_without_db(self) -> None:
        rid = str(uuid.uuid4())
        resp = self._post(
            "/spockify/ghost/fate",
            {"request_id": rid, "fate": "accepted", "seen": True},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["request_id"], rid)
        self.assertFalse(data["stored"])  # no DATABASE_URL in tests

    def test_fate_rejected_feeds_suppression(self) -> None:
        rid = str(uuid.uuid4())
        ghost_fim.RECENT_REQUESTS.remember(
            rid, workspace_id="wsX", rel_path="m.py", line=7,
            suggestion="oops()",
        )
        resp = self._post(
            "/spockify/ghost/fate",
            {
                "request_id": rid,
                "fate": "rejected",
                "seen": True,
                "client_ts": 1723360000000,
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(
            ghost_fim.REJECTED.contains("wsX", "m.py", 7, "oops()")
        )

    def test_fate_invalid_enum_rejected(self) -> None:
        resp = self._post(
            "/spockify/ghost/fate",
            {"request_id": str(uuid.uuid4()), "fate": "loved"},
        )
        self.assertEqual(resp.status_code, 422)


class TelemetryFailSoftTests(unittest.TestCase):
    def test_record_fate_without_db(self) -> None:
        req = ghost_telemetry.GhostFateRequest(
            request_id=str(uuid.uuid4()), fate="ignored"
        )
        self.assertFalse(asyncio.run(ghost_telemetry.record_fate(req)))

    def test_record_suggest_without_loop_or_db(self) -> None:
        # Must never raise, even with no running event loop.
        ghost_telemetry.record_suggest(
            {"request_id": str(uuid.uuid4()), "language": "python"}
        )

    def test_insert_row_skips_bad_request_id(self) -> None:
        asyncio.run(ghost_telemetry._insert_row({"request_id": "not-a-uuid"}))


if __name__ == "__main__":
    unittest.main()
