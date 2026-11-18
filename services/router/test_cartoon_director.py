"""CPU tests for the durable cartoon director store. No GPU, no network."""

from __future__ import annotations

import struct
import tempfile
import unittest
import zlib
from pathlib import Path

import cartoon_audio
import cartoon_director
import cartoon_store


def tiny_png(width: int = 1, height: int = 1, rgb: tuple[int, int, int] = (0, 128, 255)) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "state.sqlite"
        self.store = cartoon_store.CartoonStore(self.path)
        self.owner = "owner-a"

    def tearDown(self) -> None:
        self.store.close()
        self._tmp.cleanup()

    def _plan(self, key: str = "plan-1", shots: int = 3) -> dict:
        project = self.store.create_project(self.owner, "Canary")
        return self.store.plan_scene(
            self.owner,
            project["id"],
            "Wide shot. Close on the mouth. Hold the pose.",
            shot_count=shots,
            profile="draft",
            character_class="cel_human",
            idempotency_key=key,
        )

    def _stage(self, view: dict, order: int) -> dict:
        shot = next(item for item in view["shots"] if item["order"] == order)
        return shot["stages"][-1]

    def _publish(self, view: dict, order: int) -> dict:
        stage = self._stage(view, order)
        attempt = self.store.begin_attempt(stage["id"], self.owner)
        return self.store.commit_artifact(
            attempt["attempt_id"],
            self.owner,
            data=tiny_png(order, 1, (order, 10, 20)),
            mime="image/png",
            lease_token=attempt["lease_token"],
            width=order,
            height=1,
        )

    def test_restart_keeps_the_scene(self) -> None:
        view = self._plan()
        shot_ids = [shot["id"] for shot in view["shots"]]
        self.store.close()
        reopened = cartoon_store.CartoonStore(self.path)
        try:
            again = reopened.scene_view(view["scene_id"], self.owner)
        finally:
            reopened.close()
            self.store = cartoon_store.CartoonStore(self.path)
        self.assertEqual([shot["id"] for shot in again["shots"]], shot_ids)
        self.assertEqual(again["profile"], "draft")
        self.assertEqual(again["character_class"], "cel_human")

    def test_duplicate_submit_returns_the_same_scene(self) -> None:
        project = self.store.create_project(self.owner, "Canary")
        kwargs = dict(
            shot_count=3,
            profile="draft",
            character_class="cel_human",
            idempotency_key="same-key",
        )
        first = self.store.plan_scene(self.owner, project["id"], "One. Two. Three.", **kwargs)
        second = self.store.plan_scene(self.owner, project["id"], "One. Two. Three.", **kwargs)
        self.assertEqual(first["scene_id"], second["scene_id"])
        self.assertEqual(len(second["shots"]), 3)
        self.assertEqual([shot["transition_after"] for shot in second["shots"]], ["CUT", "CUT", None])

    def test_cancel_blocks_publish_and_invalid_media_is_rejected(self) -> None:
        view = self._plan()
        stage = self._stage(view, 1)
        attempt = self.store.begin_attempt(stage["id"], self.owner)
        self.store.request_cancel(view["run_id"], self.owner)
        before = self.store.artifact_count()
        with self.assertRaises(cartoon_store.StoreError) as cancelled:
            self.store.commit_artifact(
                attempt["attempt_id"],
                self.owner,
                data=tiny_png(),
                mime="image/png",
                lease_token=attempt["lease_token"],
            )
        self.assertEqual(cancelled.exception.code, "cancel_blocked")
        held = self.store.commit_artifact(
            attempt["attempt_id"],
            self.owner,
            data=tiny_png(),
            mime="image/png",
            lease_token=attempt["lease_token"],
            publish=False,
        )
        self.assertFalse(held["published"])
        with self.assertRaises(cartoon_store.StoreError) as malformed:
            self.store.commit_artifact(
                attempt["attempt_id"],
                self.owner,
                data=b"this is not a png file",
                mime="image/png",
                lease_token=attempt["lease_token"],
                publish=False,
            )
        self.assertEqual(malformed.exception.code, "invalid_media")
        self.assertEqual(self.store.artifact_count(), before + 1)
        shot = next(item for item in self.store.scene_view(view["scene_id"], self.owner)["shots"] if item["order"] == 1)
        self.assertNotEqual(shot["stages"][0]["state"], "SUCCEEDED")

    def test_retry_is_bounded_to_one_stage(self) -> None:
        view = self._plan()
        first = self._stage(view, 1)
        second = self._stage(view, 2)
        retried = self.store.fail_stage(first["id"], self.owner, "comfy_transient")
        shot1 = next(item for item in retried["shots"] if item["order"] == 1)
        shot2 = next(item for item in retried["shots"] if item["order"] == 2)
        self.assertEqual(shot1["stages"][0]["state"], "QUEUED")
        self.assertEqual(shot1["stages"][0]["retry_count"], 1)
        self.assertEqual(shot2["stages"][0]["id"], second["id"])
        self.assertEqual(shot2["stages"][0]["state"], "QUEUED")
        self.assertEqual(shot2["stages"][0]["retry_count"], 0)
        final = self.store.fail_stage(first["id"], self.owner, "comfy_transient")
        shot1 = next(item for item in final["shots"] if item["order"] == 1)
        shot2 = next(item for item in final["shots"] if item["order"] == 2)
        self.assertEqual(shot1["stages"][0]["state"], "FAILED_FINAL")
        self.assertEqual(shot2["stages"][0]["state"], "QUEUED")
        licensed = self.store.fail_stage(second["id"], self.owner, "license")
        shot2 = next(item for item in licensed["shots"] if item["order"] == 2)
        self.assertEqual(shot2["stages"][0]["state"], "FAILED_FINAL")
        self.assertEqual(shot2["stages"][0]["retry_count"], 0)

    def test_regen_shot_three_keeps_approved_siblings(self) -> None:
        view = self._plan()
        first = self._publish(view, 1)
        second = self._publish(self.store.scene_view(view["scene_id"], self.owner), 2)
        self.store.approve_shot(view["shots"][0]["id"], self.owner)
        self.store.approve_shot(view["shots"][1]["id"], self.owner)
        before = self.store.scene_view(view["scene_id"], self.owner)
        regenerated = self.store.regen_shot(view["shots"][2]["id"], self.owner)
        kept = {shot["order"]: shot for shot in regenerated["shots"]}
        self.assertEqual(kept[1]["approval"], "approved")
        self.assertEqual(kept[2]["approval"], "approved")
        self.assertEqual(kept[1]["artifact_sha256"], first["sha256"])
        self.assertEqual(kept[2]["artifact_sha256"], second["sha256"])
        self.assertEqual(kept[1]["artifact_id"], before["shots"][0]["artifact_id"])
        self.assertEqual(kept[2]["artifact_id"], before["shots"][1]["artifact_id"])
        self.assertEqual(kept[3]["approval"], "pending")
        states = [stage["state"] for stage in kept[3]["stages"]]
        self.assertIn("SUPERSEDED", states)
        self.assertIn("QUEUED", states)
        with self.assertRaises(cartoon_store.StoreError) as locked:
            self.store.update_shot_prompt(view["shots"][0]["id"], self.owner, "rewrite shot 1")
        self.assertEqual(locked.exception.status_code, 409)

    def test_other_owner_cannot_read_artifact(self) -> None:
        view = self._plan()
        artifact = self._publish(view, 1)
        with self.assertRaises(cartoon_store.StoreError) as ctx:
            self.store.get_artifact(artifact["id"], "owner-b")
        self.assertEqual(ctx.exception.code, "ownership")
        self.assertNotIn("blob", str(ctx.exception).lower())

    def test_admission_limits(self) -> None:
        project = self.store.create_project(self.owner, "Canary", retention="research")
        with self.assertRaises(cartoon_store.StoreError) as shots:
            self.store.plan_scene(
                self.owner,
                project["id"],
                "Too many.",
                shot_count=5,
                idempotency_key="too-many",
            )
        self.assertEqual(shots.exception.code, "admission")
        for index in range(cartoon_store.MAX_QUEUED_RUNS):
            self.store.plan_scene(
                self.owner,
                project["id"],
                f"Beat {index}.",
                shot_count=1,
                idempotency_key=f"queued-{index}",
            )
        with self.assertRaises(cartoon_store.StoreError) as queued:
            self.store.plan_scene(
                self.owner,
                project["id"],
                "One more.",
                shot_count=1,
                idempotency_key="queued-overflow",
            )
        self.assertEqual(queued.exception.status_code, 429)


class DirectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.store = cartoon_store.CartoonStore(Path(self._tmp.name) / "state.sqlite")

    def tearDown(self) -> None:
        self.store.close()
        self._tmp.cleanup()

    def test_dialogue_modes_are_honest(self) -> None:
        human = cartoon_director.plan_dialogue({"text": "Hello there."})
        self.assertEqual(human["lipsync_mode"], "latentsync")
        self.assertTrue(human["lip_sync"])
        self.assertFalse(human["production_ready"])
        self.assertFalse(human["gpu_executed"])
        self.assertEqual(human["timing"], "not_estimated")
        self.assertFalse(human["counsel_signed"])
        self.assertEqual(human["routes"]["lipsync"], "/v1/videos/lipsync")
        self.assertEqual(human["request"]["speech"]["speaker_id"], "doc")
        bare = cartoon_director.plan_dialogue({"text": "Hello.", "lip_sync": False})
        self.assertEqual(bare["lipsync_mode"], "mux")
        self.assertFalse(bare["request"]["mux"]["lip_sync"])
        narration = cartoon_director.plan_dialogue(
            {"text": "A paw taps the table.", "character_class": "nonhuman", "lip_sync": False}
        )
        self.assertEqual(narration["lipsync_mode"], "narration")
        self.assertFalse(narration["production_ready"])
        with self.assertRaises(cartoon_director.DirectorError) as blocked:
            cartoon_director.plan_dialogue(
                {"text": "Roar.", "character_class": "nonhuman", "lip_sync": True}
            )
        self.assertEqual(blocked.exception.status_code, 422)

    def test_legacy_pack_link_is_optional(self) -> None:
        self.assertEqual(cartoon_director.bind_legacy_request(self.store, "owner-a", {}), {})
        self.store.save_pack("owner-a", "character_pack", "chr_1", "{\"id\":\"chr_1\"}")
        linked = cartoon_director.bind_legacy_request(
            self.store,
            "owner-a",
            {"character_pack_id": "chr_1", "profile": "draft", "character_class": "cel_human"},
        )
        self.assertEqual(linked["character_pack_id"], "chr_1")
        self.assertFalse(linked["commercial_export"])
        with self.assertRaises(cartoon_director.DirectorError) as missing:
            cartoon_director.bind_legacy_request(
                self.store, "owner-a", {"character_pack_id": "missing"}
            )
        self.assertEqual(missing.exception.status_code, 404)
        with self.assertRaises(cartoon_director.DirectorError) as other:
            cartoon_director.bind_legacy_request(
                self.store, "owner-b", {"character_pack_id": "chr_1"}
            )
        self.assertEqual(other.exception.status_code, 403)
        with self.assertRaises(cartoon_director.DirectorError) as commercial:
            cartoon_director.plan_dialogue({"text": "No.", "commercial_export": True})
        self.assertEqual(commercial.exception.status_code, 403)

    def test_owner_override_requires_the_master_key(self) -> None:
        master = cartoon_director.owner_from_authorization(
            "Bearer master-secret",
            requested_owner="user_123",
            master_key="master-secret",
        )
        self.assertEqual(master, "user_123")
        with self.assertRaises(cartoon_director.DirectorError) as ctx:
            cartoon_director.owner_from_authorization(
                "Bearer someone-else",
                requested_owner="user_123",
                master_key="master-secret",
            )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_audio_default_class_constant(self) -> None:
        self.assertEqual(cartoon_audio.DEFAULT_CHARACTER_CLASS, "cel_human")
        self.assertIn("human-mouth", cartoon_audio.DEFAULT_CHARACTER_LABEL)


class DispatchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.store = cartoon_store.CartoonStore(Path(self._tmp.name) / "state.sqlite")
        self.owner = "owner-a"

    def tearDown(self) -> None:
        self.store.close()
        self._tmp.cleanup()

    def _plan(self, key: str = "plan-dispatch", shots: int = 3) -> dict:
        project = self.store.create_project(self.owner, "Hobby")
        return self.store.plan_scene(
            self.owner,
            project["id"],
            "A kid fox waves from a stump. The fox hops once. The fox sits and smiles.",
            shot_count=shots,
            profile="draft",
            character_class="cel_human",
            idempotency_key=key,
        )

    def _publish(self, view: dict, order: int) -> dict:
        shot = next(item for item in view["shots"] if item["order"] == order)
        stage = shot["stages"][-1]
        attempt = self.store.begin_attempt(stage["id"], self.owner)
        return self.store.commit_artifact(
            attempt["attempt_id"],
            self.owner,
            data=tiny_png(order, 1, (order, 10, 20)),
            mime="image/png",
            lease_token=attempt["lease_token"],
            width=order,
            height=1,
        )

    async def _fake_run(self, **kwargs) -> dict:
        self.runs.append(kwargs)
        n = len(self.runs)
        return {
            "id": f"cartoon_{n}",
            "status": "videos_queued",
            "videos": [{"id": f"video_{n}", "status": "queued"}],
        }

    async def test_render_queues_a_video_id(self) -> None:
        self.runs = []
        view = self._plan(shots=1)
        result = await cartoon_director.render_scene(
            self.store,
            self.owner,
            view["scene_id"],
            {"seconds": 2},
            run_shot=self._fake_run,
            spawn_dialogue=False,
        )
        self.assertTrue(result["gpu_executed"])
        self.assertFalse(result["production_ready"])
        self.assertEqual(result["usage"], "hobby_family")
        self.assertEqual(len(result["dispatched"]), 1)
        self.assertEqual(result["dispatched"][0]["video_id"], "video_1")
        self.assertEqual(result["shots"][0]["video_id"], "video_1")
        self.assertTrue(result["shots"][0]["stages"][-1]["dispatch_committed"])
        self.assertEqual(result["poll"], ["/v1/videos/video_1"])
        self.assertEqual(self.runs[0]["seconds"], 2)

    async def test_second_render_reuses_the_video_id(self) -> None:
        self.runs = []
        view = self._plan(shots=1, key="reuse-1")
        first = await cartoon_director.render_scene(
            self.store,
            self.owner,
            view["scene_id"],
            {},
            run_shot=self._fake_run,
            spawn_dialogue=False,
        )
        second = await cartoon_director.render_scene(
            self.store,
            self.owner,
            view["scene_id"],
            {},
            run_shot=self._fake_run,
            spawn_dialogue=False,
        )
        self.assertEqual(len(self.runs), 1)
        self.assertTrue(second["dispatched"][0]["reused"])
        self.assertEqual(second["dispatched"][0]["video_id"], first["dispatched"][0]["video_id"])

    async def test_approved_shots_are_not_resubmitted(self) -> None:
        self.runs = []
        view = self._plan(key="keep-12")
        self._publish(view, 1)
        self._publish(self.store.scene_view(view["scene_id"], self.owner), 2)
        self.store.approve_shot(view["shots"][0]["id"], self.owner)
        self.store.approve_shot(view["shots"][1]["id"], self.owner)
        before = self.store.scene_view(view["scene_id"], self.owner)
        rendered = await cartoon_director.render_scene(
            self.store,
            self.owner,
            view["scene_id"],
            {},
            run_shot=self._fake_run,
            spawn_dialogue=False,
        )
        self.assertEqual(len(self.runs), 1)
        kept = {shot["order"]: shot for shot in rendered["shots"]}
        self.assertEqual(kept[1]["approval"], "approved")
        self.assertEqual(kept[2]["approval"], "approved")
        self.assertEqual(kept[1]["artifact_sha256"], before["shots"][0]["artifact_sha256"])
        self.assertEqual(kept[2]["artifact_sha256"], before["shots"][1]["artifact_sha256"])
        self.assertEqual(kept[3]["video_id"], "video_1")
        self.assertIsNone(kept[1]["video_id"])
        skipped = {row["order"]: row["reason"] for row in rendered["skipped"]}
        self.assertEqual(skipped[1], "approved")
        self.assertEqual(skipped[2], "approved")

    async def test_regen_shot_three_then_render_keeps_one_and_two(self) -> None:
        self.runs = []
        view = self._plan(key="regen-3")
        first = self._publish(view, 1)
        second = self._publish(self.store.scene_view(view["scene_id"], self.owner), 2)
        self.store.approve_shot(view["shots"][0]["id"], self.owner)
        self.store.approve_shot(view["shots"][1]["id"], self.owner)
        await cartoon_director.render_scene(
            self.store,
            self.owner,
            view["scene_id"],
            {},
            run_shot=self._fake_run,
            spawn_dialogue=False,
        )
        regenerated = self.store.regen_shot(view["shots"][2]["id"], self.owner)
        self.assertIsNone(regenerated["shots"][2]["video_id"])
        again = await cartoon_director.render_scene(
            self.store,
            self.owner,
            view["scene_id"],
            {"shot_id": view["shots"][2]["id"]},
            run_shot=self._fake_run,
            spawn_dialogue=False,
        )
        kept = {shot["order"]: shot for shot in again["shots"]}
        self.assertEqual(kept[1]["approval"], "approved")
        self.assertEqual(kept[2]["approval"], "approved")
        self.assertEqual(kept[1]["artifact_sha256"], first["sha256"])
        self.assertEqual(kept[2]["artifact_sha256"], second["sha256"])
        self.assertEqual(kept[3]["video_id"], "video_2")
        self.assertEqual(len(self.runs), 2)

    async def test_dialogue_is_planned_not_claimed_ready(self) -> None:
        self.runs = []
        view = self._plan(shots=1, key="talk-1")
        result = await cartoon_director.render_scene(
            self.store,
            self.owner,
            view["scene_id"],
            {"dialogue": "Hi, I am a friendly fox.", "lip_sync": True},
            run_shot=self._fake_run,
            spawn_dialogue=False,
        )
        row = result["dispatched"][0]
        self.assertEqual(row["dialogue"]["lipsync_mode"], "latentsync")
        self.assertEqual(row["dialogue"]["status"], "queued_after_flf")
        self.assertFalse(row["dialogue"]["production_ready"])
        self.assertFalse(row["dialogue"]["gpu_executed"])
        self.assertEqual(result["shots"][0]["lipsync_mode"], "latentsync")
        self.assertEqual(result["shots"][0]["lipsync_reason"], "queued_after_flf")

    async def test_render_commercial_export_is_403(self) -> None:
        self.runs = []
        view = self._plan(shots=1, key="blocked")
        with self.assertRaises(cartoon_director.DirectorError) as ctx:
            await cartoon_director.render_scene(
                self.store,
                self.owner,
                view["scene_id"],
                {"commercial_export": True},
                run_shot=self._fake_run,
                spawn_dialogue=False,
            )
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(self.runs, [])


if __name__ == "__main__":
    unittest.main()
