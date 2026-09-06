"""Wave 9 unit smoke tests."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import browser_agent as browser
import connectors as connectors_mod
import eval_board as eval_mod
import family_mode as family_mod
import ops_pane as ops_mod
import skills_packs as skills_mod


class TestBrowserWave9(unittest.TestCase):
    def test_playwright_note_fetch_only(self) -> None:
        with mock.patch.object(browser, "PLAYWRIGHT_WS_URL", ""), mock.patch.object(
            browser, "PLAYWRIGHT_LOCAL", False
        ):
            note = browser.playwright_note()
            self.assertIn("fetch-only", note)
            self.assertFalse(browser.playwright_available())


class TestConnectors(unittest.TestCase):
    def test_list_and_save_per_user(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(connectors_mod, "CONNECTORS_DIR", Path(tmp)):
                with mock.patch.object(
                    connectors_mod, "bootstrap_from_env", lambda *a, **k: None
                ):
                    with mock.patch.object(
                        connectors_mod, "CONNECTORS_BOOTSTRAP_USER_ID", ""
                    ):
                        u1, u2 = "user-alice", "user-bob"
                        items = connectors_mod.list_connectors(u1)
                        self.assertEqual(len(items), 3)
                        connectors_mod.update_connectors(
                            connectors_mod.ConnectorsUpdate(
                                connectors=[
                                    connectors_mod.ConnectorConfig(
                                        kind="telegram",
                                        enabled=True,
                                        token="123:ABC",
                                        account="@bot",
                                    )
                                ]
                            ),
                            u1,
                        )
                        alice = connectors_mod.list_connectors(u1)
                        bob = connectors_mod.list_connectors(u2)
                        tg_a = next(c for c in alice if c["kind"] == "telegram")
                        tg_b = next(c for c in bob if c["kind"] == "telegram")
                        self.assertTrue(tg_a["configured"])
                        self.assertFalse(tg_b["configured"])
                        self.assertTrue(
                            (Path(tmp) / u1 / "telegram.json").is_file()
                        )
                        self.assertFalse(
                            (Path(tmp) / u2 / "telegram.json").is_file()
                        )

    def test_migrate_legacy_to_user(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.object(connectors_mod, "CONNECTORS_DIR", root):
                with mock.patch.object(
                    connectors_mod, "CONNECTORS_BOOTSTRAP_USER_ID", ""
                ):
                    (root / "calendar.json").write_text(
                        '{"kind":"calendar","enabled":true,"token":"https://example.com/a.ics"}',
                        encoding="utf-8",
                    )
                    result = connectors_mod.migrate_legacy_connectors("admin-1")
                    self.assertTrue(result["migrated"])
                    self.assertFalse((root / "calendar.json").is_file())
                    self.assertTrue(
                        (root / "admin-1" / "calendar.json").is_file()
                    )
                    cfg = connectors_mod.load_connector("calendar", "admin-1")
                    self.assertIn("example.com", cfg.token)
                    other = connectors_mod.load_connector("calendar", "other")
                    self.assertFalse(other.token)

    def test_parse_ics(self) -> None:
        raw = (
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\n"
            "UID:evt-1\n"
            "DTSTART:20260720T090000Z\n"
            "DTEND:20260720T100000Z\n"
            "SUMMARY:Hello\\, world\n"
            "LOCATION:Bridge\n"
            "END:VEVENT\nEND:VCALENDAR\n"
        )
        events = connectors_mod._parse_ics_events(raw, limit=5)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["title"], "Hello, world")
        self.assertEqual(events[0]["location"], "Bridge")
        self.assertIn("start_at", events[0])

    def test_calendar_events_per_user(self) -> None:
        raw = (
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\n"
            "DTSTART:20260720T090000Z\nSUMMARY:Secret Alice\n"
            "END:VEVENT\nEND:VCALENDAR\n"
        )

        async def _run() -> None:
            with tempfile.TemporaryDirectory() as tmp:
                with mock.patch.object(connectors_mod, "CONNECTORS_DIR", Path(tmp)):
                    with mock.patch.object(
                        connectors_mod, "bootstrap_from_env", lambda *a, **k: None
                    ):
                        connectors_mod.update_connectors(
                            connectors_mod.ConnectorsUpdate(
                                connectors=[
                                    connectors_mod.ConnectorConfig(
                                        kind="calendar",
                                        enabled=True,
                                        token="https://example.com/a.ics",
                                        label="Cal",
                                    )
                                ]
                            ),
                            "alice",
                        )
                        with mock.patch.object(
                            connectors_mod,
                            "_fetch_ics_text",
                            mock.AsyncMock(return_value=raw),
                        ):
                            alice = await connectors_mod.calendar_events("alice")
                            bob = await connectors_mod.calendar_events("bob")
                        self.assertTrue(alice.get("configured"))
                        self.assertEqual(alice["events"][0]["title"], "Secret Alice")
                        self.assertFalse(bob.get("configured"))
                        self.assertEqual(bob.get("events"), [])

        import asyncio

        asyncio.run(_run())

    def test_calendar_events_empty_feed_soft(self) -> None:
        """Empty ICS (no VEVENTs) should be ok with a soft note, not an error."""

        async def _run() -> None:
            with tempfile.TemporaryDirectory() as tmp:
                with mock.patch.object(connectors_mod, "CONNECTORS_DIR", Path(tmp)):
                    with mock.patch.object(
                        connectors_mod, "bootstrap_from_env", lambda *a, **k: None
                    ):
                        connectors_mod.update_connectors(
                            connectors_mod.ConnectorsUpdate(
                                connectors=[
                                    connectors_mod.ConnectorConfig(
                                        kind="calendar",
                                        enabled=True,
                                        token="https://example.com/empty.ics",
                                        label="Cal",
                                    )
                                ]
                            ),
                            "alice",
                        )
                        with mock.patch.object(
                            connectors_mod,
                            "_fetch_ics_text",
                            mock.AsyncMock(
                                return_value="BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n"
                            ),
                        ):
                            res = await connectors_mod.calendar_events("alice")
                        self.assertTrue(res.get("ok"))
                        self.assertEqual(res.get("events"), [])
                        self.assertIn("No events", res.get("note") or "")
                        self.assertNotIn("error", res)

        import asyncio

        asyncio.run(_run())


class TestSkills(unittest.TestCase):
    def test_discover_and_inject(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pack = root / "demo"
            pack.mkdir()
            (pack / "SKILL.md").write_text(
                "---\nname: Demo\ndescription: d\n---\nBe brief.\n",
                encoding="utf-8",
            )
            with mock.patch.object(skills_mod, "SKILLS_PACKS_DIR", root):
                packs = skills_mod.discover_packs()
                self.assertTrue(packs)
                msg = skills_mod.inject_skills_system_message([packs[0].id])
                self.assertIsNotNone(msg)
                self.assertIn("Be brief", msg["content"])


class TestEvalBoard(unittest.TestCase):
    def test_heuristic_and_set(self) -> None:
        score = eval_mod._heuristic_score("What is privacy?", "Local LLMs protect privacy.")
        self.assertGreater(score, 0.3)
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(eval_mod, "EVAL_BOARD_DIR", Path(tmp)):
                (Path(tmp) / "sets").mkdir(parents=True)
                (Path(tmp) / "runs").mkdir(parents=True)
                entry = eval_mod.save_prompt_set(
                    eval_mod.EvalPromptSet(
                        name="t",
                        prompts=[eval_mod.EvalPrompt(text="hi", label="hi")],
                        models=["llama3.2-3b"],
                    )
                )
                self.assertTrue(entry["id"])
                self.assertEqual(len(eval_mod.list_prompt_sets()), 1)


class TestFamilyMode(unittest.TestCase):
    def test_guest_blocked_model(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(family_mod, "FAMILY_MODE_DIR", Path(tmp)):
                family_mod.save_config(
                    family_mod.FamilyModeConfig(
                        enabled=True,
                        allowed_models=["spockify-auto"],
                        guest_token_cap=100,
                    )
                )
                ok, reason = family_mod.check_access(
                    role="guest", user_id="u1", model="codestral"
                )
                self.assertFalse(ok)
                self.assertIn("not allowed", reason)
                ok2, _ = family_mod.check_access(
                    role="guest", user_id="u1", model="spockify-auto"
                )
                self.assertTrue(ok2)


class TestOpsPane(unittest.TestCase):
    def test_disk(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            info = ops_mod.disk_under_storage_root(Path(tmp))
            self.assertTrue(info.get("ok"))
            self.assertGreater(info.get("total_bytes") or 0, 0)


if __name__ == "__main__":
    unittest.main()
