"""In-memory cartoon job skeleton. No GPU and no live /v1/cartoon calls."""

from __future__ import annotations

import unittest

import cartoon_contracts
import cartoon_jobs


def _world() -> tuple[
    cartoon_jobs.ProductionStore,
    str,
    str,
    str,
]:
    store = cartoon_jobs.ProductionStore()
    project = store.create_project(owner="creator", title="Pilot")
    scene = store.create_scene(project["id"], script="A fox waves.")
    shot = store.create_shot(scene["id"], order=1, characters=["fox"])
    return store, scene["id"], shot["id"], project["id"]


def _lease(store: cartoon_jobs.ProductionStore, stage_id: str, fence: str = "fence-1") -> None:
    store.cas_transition(stage_id, "CREATED", "VALIDATING")
    store.cas_transition(stage_id, "VALIDATING", "QUEUED")
    store.cas_transition(stage_id, "QUEUED", "LEASED", fencing_token=fence)


def _succeed(store: cartoon_jobs.ProductionStore, stage_id: str) -> None:
    if store.get_stage(stage_id)["state"] == "CREATED":
        _lease(store, stage_id)
    if store.get_stage(stage_id)["state"] == "LEASED":
        store.cas_transition(stage_id, "LEASED", "RUNNING")
    if store.get_stage(stage_id)["state"] == "RUNNING":
        store.cas_transition(stage_id, "RUNNING", "VERIFYING")
    if store.get_stage(stage_id)["state"] == "VERIFYING":
        store.cas_transition(stage_id, "VERIFYING", "SUCCEEDED")


class JobSkeletonTests(unittest.TestCase):
    def test_project_scene_shot_run_chain(self) -> None:
        store, scene_id, shot_id, project_id = _world()
        self.assertTrue(project_id.startswith("prj_"))
        run = store.create_run(scene_id, profile="draft", requested_budget=20)
        stage = store.add_stage(run["id"], kind="flf", shot_revision_id=shot_id)
        self.assertEqual(stage["state"], "CREATED")
        self.assertEqual(store.get_run(run["id"])["state"], "CREATED")

    def test_illegal_transition_and_cas_mismatch(self) -> None:
        store, scene_id, shot_id, _project = _world()
        run = store.create_run(scene_id, profile="draft")
        stage = store.add_stage(run["id"], kind="flf", shot_revision_id=shot_id)
        with self.assertRaises(cartoon_jobs.JobError) as ctx:
            store.cas_transition(stage["id"], "CREATED", "QUEUED")
        self.assertEqual(ctx.exception.code, "transition")
        store.cas_transition(stage["id"], "CREATED", "VALIDATING")
        with self.assertRaises(cartoon_jobs.JobError) as mismatch:
            store.cas_transition(stage["id"], "CREATED", "VALIDATING")
        self.assertEqual(mismatch.exception.code, "cas")

    def test_dependency_must_be_succeeded(self) -> None:
        store, scene_id, shot_id, _project = _world()
        run = store.create_run(scene_id, profile="final")
        first = store.add_stage(run["id"], kind="still", shot_revision_id=shot_id)
        with self.assertRaises(cartoon_jobs.JobError) as ctx:
            store.add_stage(
                run["id"],
                kind="flf",
                shot_revision_id=shot_id,
                dependency_stage_ids=[first["id"]],
            )
        self.assertEqual(ctx.exception.code, "dependency")
        _succeed(store, first["id"])
        second = store.add_stage(
            run["id"],
            kind="flf",
            shot_revision_id=shot_id,
            dependency_stage_ids=[first["id"]],
        )
        self.assertEqual(second["dependency_stage_ids"], [first["id"]])

    def test_idempotency_returns_the_same_attempt(self) -> None:
        store, scene_id, shot_id, _project = _world()
        run = store.create_run(scene_id, profile="draft")
        stage = store.add_stage(run["id"], kind="flf", shot_revision_id=shot_id)
        _lease(store, stage["id"])
        key = cartoon_contracts.idempotency_key("flf", shot_id, "rev1")
        first = store.begin_attempt(
            stage["id"],
            idempotency_key=key,
            input_digest="a" * 64,
            recipe_digest="b" * 64,
        )
        second = store.begin_attempt(
            stage["id"],
            idempotency_key=key,
            input_digest="c" * 64,
            recipe_digest="d" * 64,
        )
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(store.attempts), 1)
        self.assertEqual(first["lease_fence"], "fence-1")

    def test_dispatch_requires_prompt_id_first(self) -> None:
        store, scene_id, shot_id, _project = _world()
        run = store.create_run(scene_id, profile="draft")
        stage = store.add_stage(run["id"], kind="flf", shot_revision_id=shot_id)
        _lease(store, stage["id"])
        attempt = store.begin_attempt(
            stage["id"],
            idempotency_key="once",
            input_digest="a" * 64,
            recipe_digest="b" * 64,
        )
        with self.assertRaises(cartoon_jobs.JobError) as ctx:
            store.mark_dispatch_committed(attempt["id"])
        self.assertEqual(ctx.exception.code, "dispatch_window")
        store.bind_prompt_id(attempt["id"], "comfy-prompt-1")
        committed = store.mark_dispatch_committed(attempt["id"])
        self.assertTrue(committed["dispatch_committed"])

    def test_publish_rules_and_approval_are_separate(self) -> None:
        store, scene_id, shot_id, _project = _world()
        run = store.create_run(scene_id, profile="draft")
        stage = store.add_stage(run["id"], kind="flf", shot_revision_id=shot_id)
        _lease(store, stage["id"])
        attempt = store.begin_attempt(
            stage["id"],
            idempotency_key="art",
            input_digest="a" * 64,
            recipe_digest="b" * 64,
        )
        digest = cartoon_jobs.sha256_bytes(b"frame-bytes")
        with self.assertRaises(cartoon_jobs.JobError):
            store.commit_artifact(
                attempt["id"],
                sha256="nope",
                mime="video/mp4",
                width=64,
                height=64,
                fps_num=16,
                fps_den=1,
                frames=33,
                uri="memory://clip",
                publish=True,
            )
        with self.assertRaises(cartoon_jobs.JobError) as early:
            store.commit_artifact(
                attempt["id"],
                sha256=digest,
                mime="video/mp4",
                width=64,
                height=64,
                fps_num=16,
                fps_den=1,
                frames=33,
                uri="memory://clip",
                publish=True,
            )
        self.assertEqual(early.exception.code, "validation")
        audit = store.commit_artifact(
            attempt["id"],
            sha256=digest,
            mime="video/mp4",
            width=64,
            height=64,
            fps_num=16,
            fps_den=1,
            frames=33,
            uri="memory://clip",
            publish=False,
        )
        again = store.commit_artifact(
            attempt["id"],
            sha256=digest,
            mime="video/mp4",
            width=64,
            height=64,
            fps_num=16,
            fps_den=1,
            frames=33,
            uri="memory://clip",
            publish=False,
        )
        self.assertEqual(audit["id"], again["id"])
        with self.assertRaises(cartoon_jobs.JobError) as immutable:
            store.commit_artifact(
                attempt["id"],
                sha256="ab" * 32,
                mime="video/mp4",
                width=64,
                height=64,
                fps_num=16,
                fps_den=1,
                frames=33,
                uri="memory://other",
                publish=False,
            )
        self.assertEqual(immutable.exception.code, "conflict")
        store.cas_transition(stage["id"], "LEASED", "RUNNING")
        store.cas_transition(stage["id"], "RUNNING", "VERIFYING")
        store.cas_transition(stage["id"], "VERIFYING", "SUCCEEDED")
        self.assertEqual(store.get_run(run["id"])["state"], "SUCCEEDED")
        self.assertIsNone(store.get_shot(shot_id)["approval"])
        approval = store.approve_shot(
            shot_id,
            attempt["id"],
            reviewer="frank",
            rubric="identity",
        )
        self.assertEqual(approval["reviewer"], "frank")
        self.assertEqual(
            store.get_shot(shot_id)["approval"]["selected_attempt_id"],
            attempt["id"],
        )

    def test_cancel_blocks_new_work_and_publish(self) -> None:
        store, scene_id, shot_id, _project = _world()
        run = store.create_run(scene_id, profile="draft")
        stage = store.add_stage(run["id"], kind="flf", shot_revision_id=shot_id)
        _lease(store, stage["id"])
        store.cas_transition(stage["id"], "LEASED", "RUNNING")
        store.cas_transition(stage["id"], "RUNNING", "VERIFYING")
        store.request_cancel(run["id"])
        self.assertTrue(store.get_stage(stage["id"])["cancel_intent"])
        self.assertEqual(store.get_stage(stage["id"])["state"], "VERIFYING")
        with self.assertRaises(cartoon_jobs.JobError) as child:
            store.add_stage(run["id"], kind="mux", shot_revision_id=shot_id)
        self.assertEqual(child.exception.code, "cancel_blocked")
        store.cas_transition(stage["id"], "VERIFYING", "FAILED_RETRYABLE")
        with self.assertRaises(cartoon_jobs.JobError) as retry:
            store.cas_transition(stage["id"], "FAILED_RETRYABLE", "QUEUED")
        self.assertEqual(retry.exception.code, "cancel_blocked")
        other = store.create_run(scene_id, profile="draft")
        other_stage = store.add_stage(other["id"], kind="flf", shot_revision_id=shot_id)
        _lease(store, other_stage["id"])
        started = store.begin_attempt(
            other_stage["id"],
            idempotency_key="publish-me",
            input_digest="a" * 64,
            recipe_digest="b" * 64,
        )
        store.request_cancel(other["id"])
        with self.assertRaises(cartoon_jobs.JobError) as blocked:
            store.commit_artifact(
                started["id"],
                sha256=cartoon_jobs.sha256_bytes(b"late"),
                mime="video/mp4",
                width=16,
                height=16,
                fps_num=16,
                fps_den=1,
                frames=5,
                uri="memory://late",
                publish=True,
            )
        self.assertEqual(blocked.exception.code, "cancel_blocked")
        audit = store.commit_artifact(
            started["id"],
            sha256=cartoon_jobs.sha256_bytes(b"late"),
            mime="video/mp4",
            width=16,
            height=16,
            fps_num=16,
            fps_den=1,
            frames=5,
            uri="memory://late",
            publish=False,
        )
        self.assertFalse(audit["publish"])

    def test_retry_classification(self) -> None:
        self.assertEqual(cartoon_jobs.classify_retry("lease_lost"), "retry")
        self.assertEqual(cartoon_jobs.classify_retry("license"), "final")
        self.assertEqual(cartoon_jobs.classify_retry("mystery"), "final")
        store, scene_id, shot_id, _project = _world()
        run = store.create_run(scene_id, profile="draft")
        stage = store.add_stage(run["id"], kind="flf", shot_revision_id=shot_id)
        _lease(store, stage["id"])
        store.cas_transition(stage["id"], "LEASED", "RUNNING")
        failed = store.fail_stage(stage["id"], "license")
        self.assertEqual(failed["state"], "FAILED_FINAL")
        self.assertEqual(failed["error_class"], "license")

    def test_supersede_one_shot_leaves_the_other(self) -> None:
        store, scene_id, first_id, _project = _world()
        second = store.create_shot(scene_id, order=2, characters=["fox"])
        run = store.create_run(scene_id, profile="draft")
        keep = store.add_stage(run["id"], kind="flf", shot_revision_id=first_id)
        drop = store.add_stage(run["id"], kind="flf", shot_revision_id=second["id"])
        store.cas_transition(keep["id"], "CREATED", "VALIDATING")
        store.cas_transition(keep["id"], "VALIDATING", "QUEUED")
        store.cas_transition(drop["id"], "CREATED", "VALIDATING")
        store.cas_transition(drop["id"], "VALIDATING", "QUEUED")
        changed = store.supersede_open_stages_for_shot(second["id"])
        self.assertEqual(changed, [drop["id"]])
        self.assertEqual(store.get_stage(keep["id"])["state"], "QUEUED")
        self.assertEqual(store.get_stage(drop["id"])["state"], "SUPERSEDED")

    def test_event_sequence_is_monotonic(self) -> None:
        store, scene_id, shot_id, _project = _world()
        run = store.create_run(scene_id, profile="draft")
        store.add_stage(run["id"], kind="still", shot_revision_id=shot_id)
        seqs = [event["seq"] for event in store.events]
        self.assertEqual(seqs, list(range(1, len(seqs) + 1)))
        self.assertGreaterEqual(len(seqs), 4)


if __name__ == "__main__":
    unittest.main()
