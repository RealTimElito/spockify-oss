"""Tests for mid-thought SPAWN (phases A–C helpers)."""

from __future__ import annotations

import os
import unittest
from unittest import mock

import midthought_spawn as mt
import parallel_agents as pagents


class MidThoughtSpawnTest(unittest.TestCase):
    def test_parse_parent_spawn_quality_filter(self) -> None:
        text = (
            "Plan:\n"
            "SPAWN_CHILDREN:"
            '[{"name":"A","prompt":"Compare Flask vs FastAPI for a small API '
            'with auth and rate limits"},{"name":"x","prompt":"todo"}]\n'
        )
        specs = mt.parse_parent_spawn(text, max_children=3)
        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0].name, "A")
        self.assertTrue(mt.spawn_args_clear(specs))

    def test_parse_spawn_alias(self) -> None:
        text = (
            'SPAWN:[{"name":"Research","prompt":"Find current Kubernetes NodePort defaults '
            'and cite docs"}]'
        )
        specs = mt.parse_parent_spawn(text)
        self.assertEqual(len(specs), 1)
        cleaned = mt.strip_spawn_marker(text)
        self.assertNotIn("SPAWN:", cleaned)

    def test_spawn_marker_complete_partial(self) -> None:
        self.assertFalse(mt.spawn_marker_complete("SPAWN_CHILDREN:[{"))
        self.assertTrue(
            mt.spawn_marker_complete(
                'SPAWN_CHILDREN:[{"name":"A","prompt":"enough concrete work here please now"}]'
            )
        )

    def test_eligible_modes(self) -> None:
        self.assertTrue(mt.spawn_eligible("high"))
        self.assertTrue(mt.spawn_eligible("medium"))
        self.assertFalse(mt.spawn_eligible("off"))
        self.assertFalse(mt.spawn_eligible("low"))
        self.assertFalse(mt.spawn_eligible("heavy"))
        self.assertFalse(mt.spawn_eligible("high", voice_mode=True))
        self.assertFalse(mt.spawn_eligible("high", trivial=True))

    def test_caps_compose_vs_spark(self) -> None:
        with mock.patch.dict(os.environ, {"MIDTHOUGHT_SPAWN_MAX": ""}, clear=False):
            with mock.patch.object(mt, "_HOST_PROFILE", "compose"):
                with mock.patch.object(mt, "_SPAWN_MAX_OVERRIDE", ""):
                    self.assertEqual(mt.spawn_cap(), mt._SPAWN_MAX_COMPOSE)
            with mock.patch.object(mt, "_HOST_PROFILE", "spark"):
                with mock.patch.object(mt, "_SPAWN_MAX_OVERRIDE", ""):
                    self.assertEqual(mt.spawn_cap(), mt._SPAWN_MAX_SPARK)

    def test_done_digests(self) -> None:
        run = {
            "workers": [
                {
                    "name": "Explorer",
                    "status": "done",
                    "output": "Flask is lighter; FastAPI has OpenAPI.\nASK_USER: [\"Which auth?\"]",
                }
            ]
        }
        digests = mt.format_done_digests(run)
        self.assertIn("DONE — Explorer", digests)
        self.assertIn("ASK_USER", digests)
        msgs = mt.build_merge_messages(
            user_msg="compare frameworks",
            parent_segment="I will spawn workers.\nSPAWN_CHILDREN:[]",
            digests=digests,
        )
        blob = str(msgs)
        self.assertIn("COMPLETED WORK", blob)
        self.assertNotIn("SPAWN_CHILDREN", msgs[-1]["content"])

    def test_agents_meta_spawn_profile(self) -> None:
        body = pagents.AgentRunCreate(
            parent_prompt="x",
            workers=[
                pagents.AgentWorkerSpec(
                    name="A",
                    prompt="enough concrete research prompt here for quality",
                    model="gemma4-12b",
                )
            ],
            synthesize=False,
            profile=pagents.SPAWN_PROFILE,
        )
        run = pagents.create_run_record(body)
        frame = pagents.agents_meta_sse(run, thinking="high")
        self.assertIn(b"spockify_agents", frame)
        self.assertIn(b"Spawn", frame)


if __name__ == "__main__":
    unittest.main()
