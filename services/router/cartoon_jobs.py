"""In-memory Project → Scene → Shot → Attempt → Artifact skeleton.

Additive groundwork for a later durable job engine. This store does not
start GPU work, does not talk to Comfy, and is not mounted on ``/v1/cartoon``.
Technical ``SUCCEEDED`` is not creative approval.
"""

from __future__ import annotations

import hashlib
import re
import time
import uuid
from typing import Any, Optional

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

TERMINAL_STATES = frozenset(
    {"SUCCEEDED", "FAILED_FINAL", "CANCELLED", "SUPERSEDED"}
)
_IN_FLIGHT = frozenset(
    {
        "CREATED",
        "VALIDATING",
        "QUEUED",
        "LEASED",
        "RUNNING",
        "VERIFYING",
        "FAILED_RETRYABLE",
        "CANCEL_REQUESTED",
        "BLOCKED",
    }
)
_TRANSITIONS: dict[str, frozenset[str]] = {
    "CREATED": frozenset(
        {"VALIDATING", "BLOCKED", "CANCEL_REQUESTED", "SUPERSEDED"}
    ),
    "VALIDATING": frozenset(
        {"QUEUED", "BLOCKED", "FAILED_FINAL", "CANCEL_REQUESTED"}
    ),
    "QUEUED": frozenset({"LEASED", "CANCEL_REQUESTED", "SUPERSEDED"}),
    "LEASED": frozenset({"RUNNING", "QUEUED", "CANCEL_REQUESTED"}),
    "RUNNING": frozenset(
        {"VERIFYING", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCEL_REQUESTED"}
    ),
    "VERIFYING": frozenset({"SUCCEEDED", "FAILED_RETRYABLE", "FAILED_FINAL"}),
    "FAILED_RETRYABLE": frozenset({"QUEUED", "FAILED_FINAL", "CANCEL_REQUESTED"}),
    "BLOCKED": frozenset({"QUEUED", "CANCELLED", "SUPERSEDED"}),
    "CANCEL_REQUESTED": frozenset({"CANCELLED"}),
    "SUCCEEDED": frozenset(),
    "FAILED_FINAL": frozenset(),
    "CANCELLED": frozenset(),
    "SUPERSEDED": frozenset(),
}
_ENQUEUE_STATES = frozenset({"QUEUED", "LEASED", "RUNNING"})
TRANSIENT_ERRORS = frozenset({"comfy_transient", "lease_lost", "worker_restart"})
NON_RETRYABLE_ERRORS = frozenset(
    {"invalid_character", "copyright", "license", "unsafe_media", "validation"}
)


class JobError(Exception):
    def __init__(self, message: str, code: str = "conflict") -> None:
        super().__init__(message)
        self.code = code


def classify_retry(error_class: str) -> str:
    """Unknown classes fail closed (no automatic retry)."""
    if error_class in TRANSIENT_ERRORS:
        return "retry"
    return "final"


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _copy(row: dict[str, Any]) -> dict[str, Any]:
    return dict(row)


class ProductionStore:
    """Single-process skeleton. A restart drops state; that is not recovery."""

    def __init__(self) -> None:
        self.projects: dict[str, dict[str, Any]] = {}
        self.scenes: dict[str, dict[str, Any]] = {}
        self.shots: dict[str, dict[str, Any]] = {}
        self.runs: dict[str, dict[str, Any]] = {}
        self.stages: dict[str, dict[str, Any]] = {}
        self.attempts: dict[str, dict[str, Any]] = {}
        self.artifacts: dict[str, dict[str, Any]] = {}
        self.idempotency: dict[str, str] = {}
        self.events: list[dict[str, Any]] = []

    def _event(self, kind: str, **payload: Any) -> None:
        self.events.append({"seq": len(self.events) + 1, "kind": kind, **payload})

    def _derive_run(self, run_id: str) -> None:
        run = self.runs[run_id]
        states = [
            stage["state"]
            for stage in self.stages.values()
            if stage["run_id"] == run_id
        ]
        cancel = bool(run.get("cancel_requested_at"))
        if not states:
            run["state"] = "CANCEL_REQUESTED" if cancel else "CREATED"
            return
        if cancel:
            if any(state in _IN_FLIGHT for state in states):
                run["state"] = "CANCEL_REQUESTED"
            else:
                run["state"] = "CANCELLED"
            return
        if all(state == "SUCCEEDED" for state in states):
            run["state"] = "SUCCEEDED"
            return
        terminalish = {"SUCCEEDED", "FAILED_FINAL", "SUPERSEDED", "CANCELLED"}
        if any(state == "FAILED_FINAL" for state in states) and all(
            state in terminalish for state in states
        ):
            run["state"] = "FAILED_FINAL"
            return
        for name in ("RUNNING", "LEASED", "QUEUED", "VERIFYING", "VALIDATING"):
            if any(state == name for state in states):
                run["state"] = name
                return
        run["state"] = states[0]

    def create_project(
        self,
        *,
        owner: str,
        title: str,
        style_pack_revision: Optional[str] = None,
    ) -> dict[str, Any]:
        if not owner.strip() or not title.strip():
            raise JobError("owner and title are required", "validation")
        row = {
            "id": _new_id("prj"),
            "owner": owner.strip(),
            "title": title.strip(),
            "style_pack_revision": style_pack_revision,
            "retention_class": "research",
            "created_at": time.time(),
        }
        self.projects[row["id"]] = row
        self._event("project.created", project_id=row["id"])
        return _copy(row)

    def create_scene(self, project_id: str, *, script: str = "") -> dict[str, Any]:
        if project_id not in self.projects:
            raise JobError("unknown project", "not_found")
        row = {
            "id": _new_id("scnrev"),
            "project_id": project_id,
            "script": script,
            "ordered_shot_ids": [],
            "etag": _new_id("etag"),
            "approved_at": None,
        }
        self.scenes[row["id"]] = row
        self._event("scene.created", scene_id=row["id"], project_id=project_id)
        return _copy(row)

    def create_shot(
        self,
        scene_id: str,
        *,
        order: int,
        **spec: Any,
    ) -> dict[str, Any]:
        scene = self.scenes.get(scene_id)
        if scene is None:
            raise JobError("unknown scene", "not_found")
        row = {
            "id": _new_id("shot"),
            "scene_revision_id": scene_id,
            "order": int(order),
            "spec": dict(spec),
            "approval": None,
        }
        self.shots[row["id"]] = row
        scene["ordered_shot_ids"].append(row["id"])
        self._event("shot.created", shot_id=row["id"], scene_id=scene_id)
        return _copy(row)

    def create_run(
        self,
        scene_revision_id: str,
        *,
        profile: str = "draft",
        requested_budget: Optional[float] = None,
    ) -> dict[str, Any]:
        if scene_revision_id not in self.scenes:
            raise JobError("unknown scene", "not_found")
        if profile not in {"draft", "final"}:
            raise JobError("profile must be draft or final", "validation")
        row = {
            "id": _new_id("run"),
            "scene_revision_id": scene_revision_id,
            "profile": profile,
            "requested_budget": requested_budget,
            "state": "CREATED",
            "cancel_requested_at": None,
        }
        self.runs[row["id"]] = row
        self._event("run.created", run_id=row["id"])
        return _copy(row)

    def add_stage(
        self,
        run_id: str,
        *,
        kind: str,
        shot_revision_id: Optional[str] = None,
        dependency_stage_ids: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        run = self.runs.get(run_id)
        if run is None:
            raise JobError("unknown run", "not_found")
        if run.get("cancel_requested_at"):
            raise JobError(
                "cancelled parent cannot enqueue",
                "cancel_blocked",
            )
        deps = list(dependency_stage_ids or [])
        for dep_id in deps:
            dep = self.stages.get(dep_id)
            if dep is None or dep["state"] != "SUCCEEDED":
                raise JobError(
                    "dependency is not validated SUCCEEDED",
                    "dependency",
                )
        if shot_revision_id is not None and shot_revision_id not in self.shots:
            raise JobError("unknown shot", "not_found")
        row = {
            "id": _new_id("stg"),
            "run_id": run_id,
            "shot_revision_id": shot_revision_id,
            "kind": kind,
            "dependency_stage_ids": deps,
            "state": "CREATED",
            "fencing_token": None,
            "error_class": None,
            "cancel_intent": False,
            "supersede_requested": False,
        }
        self.stages[row["id"]] = row
        self._derive_run(run_id)
        self._event(
            "stage.created",
            stage_id=row["id"],
            run_id=run_id,
            stage_kind=kind,
        )
        return _copy(row)

    def cas_transition(
        self,
        stage_id: str,
        expect: str,
        new: str,
        *,
        fencing_token: Optional[str] = None,
        error_class: Optional[str] = None,
    ) -> dict[str, Any]:
        stage = self.stages.get(stage_id)
        if stage is None:
            raise JobError("unknown stage", "not_found")
        if stage["state"] != expect:
            raise JobError(
                f"compare-and-swap failed: state is {stage['state']}",
                "cas",
            )
        allowed = _TRANSITIONS.get(expect, frozenset())
        if new not in allowed:
            raise JobError(
                f"illegal transition {expect} -> {new}",
                "transition",
            )
        run = self.runs[stage["run_id"]]
        if run.get("cancel_requested_at") and new in _ENQUEUE_STATES:
            raise JobError(
                "cancelled parent cannot enqueue",
                "cancel_blocked",
            )
        if new in TERMINAL_STATES and expect in TERMINAL_STATES:
            raise JobError("terminal state is monotonic", "transition")
        stage["state"] = new
        if fencing_token is not None:
            stage["fencing_token"] = fencing_token
        if error_class is not None:
            stage["error_class"] = error_class
        self._derive_run(stage["run_id"])
        self._event(
            "stage.transition",
            stage_id=stage_id,
            expect=expect,
            state=new,
        )
        return _copy(stage)

    def fail_stage(self, stage_id: str, error_class: str) -> dict[str, Any]:
        stage = self.stages.get(stage_id)
        if stage is None:
            raise JobError("unknown stage", "not_found")
        kind = classify_retry(error_class)
        target = "FAILED_RETRYABLE" if kind == "retry" else "FAILED_FINAL"
        if target not in _TRANSITIONS.get(stage["state"], frozenset()):
            if "FAILED_FINAL" in _TRANSITIONS.get(stage["state"], frozenset()):
                target = "FAILED_FINAL"
            else:
                raise JobError(
                    f"cannot fail stage from {stage['state']}",
                    "transition",
                )
        return self.cas_transition(
            stage_id,
            stage["state"],
            target,
            error_class=error_class,
        )

    def begin_attempt(
        self,
        stage_id: str,
        *,
        idempotency_key: str,
        input_digest: str,
        recipe_digest: str,
    ) -> dict[str, Any]:
        if not idempotency_key:
            raise JobError("idempotency_key is required", "validation")
        existing_id = self.idempotency.get(idempotency_key)
        if existing_id is not None:
            return _copy(self.attempts[existing_id])
        stage = self.stages.get(stage_id)
        if stage is None:
            raise JobError("unknown stage", "not_found")
        run = self.runs[stage["run_id"]]
        if run.get("cancel_requested_at"):
            raise JobError("cancelled parent cannot enqueue", "cancel_blocked")
        if stage["state"] != "LEASED":
            raise JobError("attempt requires a LEASED stage", "state")
        number = 1 + sum(
            1 for row in self.attempts.values() if row["stage_id"] == stage_id
        )
        row = {
            "id": _new_id("att"),
            "stage_id": stage_id,
            "number": number,
            "input_digest": input_digest,
            "recipe_digest": recipe_digest,
            "idempotency_key": idempotency_key,
            "lease_fence": stage.get("fencing_token"),
            "comfy_prompt_id": None,
            "dispatch_committed": False,
            "started_at": time.time(),
            "finished_at": None,
            "error_class": None,
        }
        self.attempts[row["id"]] = row
        self.idempotency[idempotency_key] = row["id"]
        self._event("attempt.started", attempt_id=row["id"], stage_id=stage_id)
        return _copy(row)

    def bind_prompt_id(self, attempt_id: str, prompt_id: str) -> dict[str, Any]:
        attempt = self.attempts.get(attempt_id)
        if attempt is None:
            raise JobError("unknown attempt", "not_found")
        if not str(prompt_id).strip():
            raise JobError("prompt_id is required", "validation")
        if attempt["comfy_prompt_id"] not in (None, prompt_id):
            raise JobError("prompt_id is immutable", "conflict")
        attempt["comfy_prompt_id"] = str(prompt_id)
        self._event("attempt.prompt_bound", attempt_id=attempt_id)
        return _copy(attempt)

    def mark_dispatch_committed(self, attempt_id: str) -> dict[str, Any]:
        attempt = self.attempts.get(attempt_id)
        if attempt is None:
            raise JobError("unknown attempt", "not_found")
        if not attempt.get("comfy_prompt_id"):
            raise JobError(
                "prompt_id must be persisted before dispatch is committed",
                "dispatch_window",
            )
        attempt["dispatch_committed"] = True
        self._event("attempt.dispatch_committed", attempt_id=attempt_id)
        return _copy(attempt)

    def commit_artifact(
        self,
        attempt_id: str,
        *,
        sha256: str,
        mime: str,
        width: int,
        height: int,
        fps_num: int,
        fps_den: int,
        frames: int,
        uri: str,
        publish: bool = False,
    ) -> dict[str, Any]:
        attempt = self.attempts.get(attempt_id)
        if attempt is None:
            raise JobError("unknown attempt", "not_found")
        digest = sha256.strip().lower()
        if not _SHA256_RE.fullmatch(digest):
            raise JobError("sha256 digest is required", "validation")
        if width <= 0 or height <= 0 or frames <= 0:
            raise JobError("geometry and frames must be positive", "validation")
        if fps_num <= 0 or fps_den <= 0:
            raise JobError("fps must be positive", "validation")
        if not uri.strip():
            raise JobError("uri is required", "validation")
        stage = self.stages[attempt["stage_id"]]
        run = self.runs[stage["run_id"]]
        if publish and run.get("cancel_requested_at"):
            raise JobError(
                "cancelled parent cannot publish",
                "cancel_blocked",
            )
        if publish and stage["state"] != "SUCCEEDED":
            raise JobError("publish requires SUCCEEDED", "validation")
        existing = self.artifacts.get(attempt_id)
        if existing is not None:
            if existing["sha256"] != digest:
                raise JobError("artifact is immutable", "conflict")
            return _copy(existing)
        row = {
            "id": _new_id("art"),
            "attempt_id": attempt_id,
            "sha256": digest,
            "mime": mime,
            "width": int(width),
            "height": int(height),
            "fps_num": int(fps_num),
            "fps_den": int(fps_den),
            "frames": int(frames),
            "uri": uri,
            "publish": bool(publish),
            "retention_class": "research",
            "committed_at": time.time(),
        }
        self.artifacts[attempt_id] = row
        self._event("artifact.committed", attempt_id=attempt_id, publish=bool(publish))
        return _copy(row)

    def request_cancel(self, run_id: str) -> dict[str, Any]:
        run = self.runs.get(run_id)
        if run is None:
            raise JobError("unknown run", "not_found")
        if run.get("cancel_requested_at") is None:
            run["cancel_requested_at"] = time.time()
        for stage in self.stages.values():
            if stage["run_id"] != run_id:
                continue
            if stage["state"] in TERMINAL_STATES:
                continue
            stage["cancel_intent"] = True
            if "CANCEL_REQUESTED" in _TRANSITIONS.get(stage["state"], frozenset()):
                stage["state"] = "CANCEL_REQUESTED"
        self._derive_run(run_id)
        self._event("run.cancel_requested", run_id=run_id)
        return _copy(run)

    def approve_shot(
        self,
        shot_id: str,
        attempt_id: str,
        *,
        reviewer: str,
        rubric: Optional[str] = None,
    ) -> dict[str, Any]:
        shot = self.shots.get(shot_id)
        attempt = self.attempts.get(attempt_id)
        if shot is None or attempt is None:
            raise JobError("unknown shot or attempt", "not_found")
        if not reviewer.strip():
            raise JobError("reviewer is required", "validation")
        stage = self.stages[attempt["stage_id"]]
        if stage["shot_revision_id"] != shot_id:
            raise JobError("attempt does not belong to this shot", "ownership")
        if stage["state"] != "SUCCEEDED":
            raise JobError(
                "technical success is required before approval",
                "approval",
            )
        artifact = self.artifacts.get(attempt_id)
        if artifact is None:
            raise JobError("committed artifact is required", "approval")
        run = self.runs[stage["run_id"]]
        if run.get("cancel_requested_at"):
            raise JobError("cancelled run cannot be approved", "cancel_blocked")
        approval = {
            "shot_revision_id": shot_id,
            "selected_attempt_id": attempt_id,
            "reviewer": reviewer.strip(),
            "rubric": rubric,
            "approved_at": time.time(),
        }
        shot["approval"] = approval
        self._event("shot.approved", shot_id=shot_id, attempt_id=attempt_id)
        return dict(approval)

    def supersede_open_stages_for_shot(self, shot_id: str) -> list[str]:
        """Mark open stages for one shot superseded. Other shots stay put."""
        if shot_id not in self.shots:
            raise JobError("unknown shot", "not_found")
        changed: list[str] = []
        for stage in self.stages.values():
            if stage.get("shot_revision_id") != shot_id:
                continue
            if stage["state"] in TERMINAL_STATES:
                continue
            if "SUPERSEDED" not in _TRANSITIONS.get(stage["state"], frozenset()):
                stage["supersede_requested"] = True
                continue
            stage["state"] = "SUPERSEDED"
            changed.append(stage["id"])
            self._event("stage.superseded", stage_id=stage["id"], shot_id=shot_id)
            self._derive_run(stage["run_id"])
        return changed

    def get_run(self, run_id: str) -> dict[str, Any]:
        return _copy(self.runs[run_id])

    def get_stage(self, stage_id: str) -> dict[str, Any]:
        return _copy(self.stages[stage_id])

    def get_shot(self, shot_id: str) -> dict[str, Any]:
        return _copy(self.shots[shot_id])


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()
