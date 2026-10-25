"""Wave 10 unit tests — offline, no cluster required."""

from __future__ import annotations

import base64
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import dream_mode as dream_mod
import ghost_writer as ghost_mod
import home_brain as home_mod
import multiplayer as multi_mod
import parallel_agents as pagents
import screen_share as screen_mod
import spectacle as spectacle_mod
import voice_world as voice_mod


class ScreenShareTests(unittest.TestCase):
    def test_ingest_frames(self) -> None:
        png = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode("ascii")
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(screen_mod, "SCREEN_SHARE_DIR", Path(tmp)):
                import asyncio

                result = asyncio.get_event_loop().run_until_complete(
                    screen_mod.ingest_frames(
                        screen_mod.ScreenShareRequest(
                            frames=[
                                screen_mod.ScreenFrame(
                                    image_b64=png, mime="image/png"
                                )
                            ],
                            prompt="what is on screen?",
                        )
                    )
                )
                self.assertTrue(result["ok"])
                self.assertEqual(result["frame_count"], 1)
                self.assertIn("narration", result)


class HomeBrainTests(unittest.TestCase):
    def test_ingest_and_list(self) -> None:
        png = base64.b64encode(b"imgdata").decode("ascii")
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(home_mod, "HOME_BRAIN_DIR", Path(tmp)):
                import asyncio

                result = asyncio.get_event_loop().run_until_complete(
                    home_mod.ingest(
                        home_mod.HomeIngestRequest(
                            image_b64=png, user_id="u1", note="doorbell"
                        )
                    )
                )
                self.assertTrue(result["ok"])
                events = home_mod.list_events(user_id="u1")
                self.assertEqual(len(events), 1)
                self.assertIn("doorbell", events[0]["doorbell_next_step"].lower() or "frigate")


class MultiplayerTests(unittest.TestCase):
    def test_room_join_and_post(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(multi_mod, "MULTIPLAYER_DIR", Path(tmp)):
                room = multi_mod.create_room(
                    multi_mod.RoomCreate(title="t", owner_id="owner")
                )
                token = room["invite_token"]
                joined = multi_mod.join_room(
                    room["id"], user_id="guest", invite_token=token
                )
                self.assertTrue(joined["ok"])
                posted = multi_mod.post_message(
                    room["id"],
                    multi_mod.RoomMessage(text="hello", author_id="guest"),
                    user_id="guest",
                )
                self.assertTrue(posted["ok"])
                self.assertEqual(posted["message"]["text"], "hello")


class DreamTests(unittest.TestCase):
    def test_dream_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(dream_mod, "DREAM_DIR", Path(tmp)):
                with mock.patch.object(dream_mod, "MEMORY_DIR", Path(tmp) / "mem"):
                    with mock.patch.object(
                        dream_mod, "PROJECTS_HINT", Path(tmp) / "proj"
                    ):
                        run = dream_mod.run_dream(
                            dream_mod.DreamRunRequest(focus="shipping", max_insights=3)
                        )
                        self.assertTrue(run["insights"])
                        self.assertTrue(run["patches"])


class VoiceWorldTests(unittest.TestCase):
    def test_return_surfaces_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(voice_mod, "VOICE_WORLD_DIR", Path(tmp)):
                add = voice_mod.add_note(
                    voice_mod.VoiceNoteCreate(
                        text="remind me when I'm back",
                        user_id="u1",
                        surface_on="return",
                    )
                )
                self.assertTrue(add["ok"])
                due = voice_mod.due_notes(
                    voice_mod.VoiceReturnSignal(user_id="u1", reason="visibility")
                )
                self.assertEqual(due["count"], 1)


class GhostTests(unittest.TestCase):
    def test_local_suggest(self) -> None:
        import asyncio

        out = asyncio.get_event_loop().run_until_complete(
            ghost_mod.suggest(
                ghost_mod.GhostSuggestRequest(
                    code="def foo():\n    pass\n",
                    language="python",
                    local_only=True,
                )
            )
        )
        self.assertTrue(out["ok"])
        self.assertEqual(out["mode"], "local")
        self.assertIn("Monaco", out["note"])

    def test_local_complete(self) -> None:
        import asyncio

        out = asyncio.get_event_loop().run_until_complete(
            ghost_mod.suggest(
                ghost_mod.GhostSuggestRequest(
                    mode="complete",
                    prefix="def ",
                    language="python",
                    local_only=True,
                )
            )
        )
        self.assertTrue(out["ok"])
        self.assertEqual(out["kind"], "complete")
        self.assertTrue(out.get("insert_text") or out.get("suggestion"))

    def test_fast_complete_before_llm(self) -> None:
        import asyncio

        called = {"n": 0}

        async def boom(_c, _model, _messages, **_kwargs):
            called["n"] += 1
            raise AssertionError("LLM should not be called for local heuristic")

        out = asyncio.get_event_loop().run_until_complete(
            ghost_mod.suggest(
                ghost_mod.GhostSuggestRequest(
                    mode="complete",
                    prefix="{\n  a: 8100,\n  b: 8101,\n  c: ",
                    suffix="\n}\n",
                    language="typescript",
                    local_only=False,
                ),
                worker_chat=boom,
            )
        )
        self.assertEqual(called["n"], 0)
        self.assertEqual(out.get("insert_text"), "8102")
        self.assertEqual(out.get("mode"), "local")

    def test_remote_complete_uses_fast_model_kwargs(self) -> None:
        import asyncio

        seen: dict = {}

        async def capture(_c, model, _messages, **kwargs):
            seen["model"] = model
            seen["kwargs"] = kwargs
            return {
                "choices": [{"message": {"content": "x = 1"}}],
            }

        out = asyncio.get_event_loop().run_until_complete(
            ghost_mod.suggest(
                ghost_mod.GhostSuggestRequest(
                    mode="complete",
                    prefix="const x = ",
                    suffix="\n",
                    language="typescript",
                    local_only=False,
                ),
                worker_chat=capture,
            )
        )
        self.assertEqual(seen.get("model"), ghost_mod.GHOST_COMPLETE_MODEL)
        self.assertEqual(
            seen.get("kwargs", {}).get("max_tokens"),
            ghost_mod.GHOST_COMPLETE_MAX_TOKENS,
        )
        self.assertEqual(out.get("insert_text"), "x = 1")
        self.assertEqual(out.get("model"), ghost_mod.GHOST_COMPLETE_MODEL)

    def test_remote_complete_uses_context_and_larger_fim(self) -> None:
        import asyncio

        seen: dict = {}

        async def capture(_c, model, messages, **kwargs):
            seen["model"] = model
            seen["user"] = messages[1]["content"]
            return {
                "choices": [{"message": {"content": "bar"}}],
            }

        out = asyncio.get_event_loop().run_until_complete(
            ghost_mod.suggest(
                ghost_mod.GhostSuggestRequest(
                    mode="complete",
                    prefix="x" * 5000,
                    suffix="y" * 2000,
                    context="FILE_HEAD:\nimport foo\n\nOPEN_TABS: a.ts",
                    language="typescript",
                    local_only=False,
                ),
                worker_chat=capture,
            )
        )
        user = seen.get("user") or ""
        self.assertIn("<CONTEXT>", user)
        self.assertIn("FILE_HEAD:", user)
        m = re.search(r"<PREFIX>\n(.*)\n</PREFIX>", user, re.S)
        self.assertIsNotNone(m)
        self.assertLessEqual(
            len(m.group(1)),
            ghost_mod.GHOST_COMPLETE_PREFIX_CHARS,
        )
        self.assertEqual(out.get("insert_text"), "bar")

    def test_remote_complete_empty_does_not_inject_ellipsis(self) -> None:
        import asyncio

        async def empty(_c, _model, _messages, **_kwargs):
            return {"choices": [{"message": {"content": ""}}]}

        out = asyncio.get_event_loop().run_until_complete(
            ghost_mod.suggest(
                ghost_mod.GhostSuggestRequest(
                    mode="complete",
                    prefix="const x = ",
                    suffix="\n",
                    language="typescript",
                    local_only=False,
                ),
                worker_chat=empty,
            )
        )
        self.assertEqual(out.get("insert_text"), "")
        self.assertEqual(out.get("mode"), "remote")
        self.assertNotIn("…", out.get("suggestion") or "")

    def test_workspace_crud_isolated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(ghost_mod, "GHOST_DIR", Path(tmp)):
                ghost_mod.seed_welcome_if_empty("u1")
                listed = ghost_mod.workspace_list("u1")
                self.assertTrue(listed["ok"])
                self.assertTrue(any(n["path"] == "welcome.py" for n in listed["nodes"]))
                # u2 cannot see u1 files
                ghost_mod.seed_welcome_if_empty("u2")
                u2 = ghost_mod.workspace_list("u2")
                ghost_mod.workspace_write("u1", "secret.py", "x = 1")
                u2_paths = {n["path"] for n in ghost_mod.workspace_list("u2")["nodes"]}
                self.assertNotIn("secret.py", u2_paths)
                read = ghost_mod.workspace_read("u1", "secret.py")
                self.assertEqual(read["content"], "x = 1")
                # guest read-only
                with self.assertRaises(PermissionError):
                    ghost_mod.workspace_write(
                        "u1", "nope.py", "bad", role="guest"
                    )
                # no absolute paths in public response
                blob = str(listed)
                self.assertNotIn(tmp, blob)
                self.assertNotIn("/var/lib", blob)

    def test_workspace_download_file_and_zip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(ghost_mod, "GHOST_DIR", Path(tmp)):
                ghost_mod.workspace_write("u1", "src/hello.py", "print(1)\n")
                ghost_mod.workspace_write("u1", "notes.txt", "hi\n")
                # Guests can download readable files (no writable check).
                one = ghost_mod.workspace_download_file("u1", "src/hello.py")
                self.assertEqual(one["filename"], "hello.py")
                self.assertEqual(one["content"], b"print(1)\n")
                self.assertEqual(one["path"], "src/hello.py")
                self.assertNotIn(tmp, one["path"])
                self.assertNotIn(tmp, one["filename"])
                zipped = ghost_mod.workspace_download_zip("u1")
                self.assertEqual(zipped["filename"], "ghost-workspace.zip")
                self.assertGreaterEqual(zipped["count"], 2)
                import zipfile
                import io

                with zipfile.ZipFile(io.BytesIO(zipped["content"])) as zf:
                    names = set(zf.namelist())
                self.assertIn("src/hello.py", names)
                self.assertIn("notes.txt", names)
                # Archive members must not embed server paths / user root.
                for name in names:
                    self.assertFalse(name.startswith("/"))
                    self.assertNotIn(tmp, name)
                    self.assertNotIn("u1/", name)
                # Isolation: u2 zip does not include u1 files.
                ghost_mod.seed_welcome_if_empty("u2")
                z2 = ghost_mod.workspace_download_zip("u2")
                with zipfile.ZipFile(io.BytesIO(z2["content"])) as zf:
                    names2 = set(zf.namelist())
                self.assertNotIn("src/hello.py", names2)

    def test_guest_forces_local_ai(self) -> None:
        import asyncio

        out = asyncio.get_event_loop().run_until_complete(
            ghost_mod.suggest(
                ghost_mod.GhostSuggestRequest(
                    mode="complete",
                    prefix="x = ",
                    language="python",
                    local_only=False,
                    role="guest",
                ),
                worker_chat=None,
            )
        )
        self.assertEqual(out["mode"], "local")
        self.assertIn("local", (out.get("note") or "").lower())


class SpectacleTests(unittest.TestCase):
    def test_debate_and_vote(self) -> None:
        import asyncio

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(spectacle_mod, "SPECTACLE_DIR", Path(tmp)):
                result = asyncio.get_event_loop().run_until_complete(
                    spectacle_mod.run_debate(
                        spectacle_mod.DebateRequest(
                            topic="Local LLMs vs cloud",
                            models=["a", "b"],
                            rounds=1,
                        )
                    )
                )
                self.assertTrue(result["ok"])
                debate_id = result["debate"]["id"]
                voted = spectacle_mod.vote(
                    spectacle_mod.VoteRequest(debate_id=debate_id, model="a")
                )
                self.assertEqual(voted["debate"]["votes"]["a"], 1)


class ForkTests(unittest.TestCase):
    def test_fork_from_worker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(pagents, "AGENT_RUNS_DIR", Path(tmp)):
                run = pagents.create_run_record(
                    pagents.AgentRunCreate(
                        parent_prompt="research X",
                        workers=[
                            pagents.AgentWorkerSpec(
                                id="w1", name="Explorer", prompt="explore X"
                            )
                        ],
                        synthesize=False,
                    )
                )
                run["workers"][0]["output"] = "mid-state finding"
                pagents._persist_run(run)
                forked = pagents.fork_run_from_worker(
                    run["id"],
                    pagents.AgentForkRequest(
                        worker_id="w1", what_if="what if we used Rust?"
                    ),
                )
                self.assertIn("forked_from", forked)
                self.assertIn("what if", forked["parent_prompt"].lower())


if __name__ == "__main__":
    unittest.main()
