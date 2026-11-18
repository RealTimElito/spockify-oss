"""SQLite Project → Scene → Shot → Attempt → Artifact store.

Survives process restart. The in-memory ProductionStore stays untouched.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import struct
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from cartoon_audio import DEFAULT_CHARACTER_CLASS, KNOWN_CLASSES

MAX_SHOTS = 4
MAX_QUEUED_RUNS = 8
MAX_MEDIA_BYTES = 32 * 1024 * 1024
MAX_BRIEF_CHARS = 4000
TRANSIENT_ERRORS = frozenset({"comfy_transient", "lease_lost", "worker_restart"})
MAX_AUTO_RETRY = 1
RETENTIONS = frozenset({"research", "transient", "approved"})


class StoreError(Exception):
    def __init__(self, message: str, code: str = "validation", status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or not data.startswith(b"\x89PNG\r\n\x1a\n") or data[12:16] != b"IHDR":
        raise StoreError("malformed png", "invalid_media", 400)
    width, height = struct.unpack(">II", data[16:24])
    if width < 1 or height < 1 or width > 8192 or height > 8192:
        raise StoreError("malformed png", "invalid_media", 400)
    return int(width), int(height)


def validate_media(data: bytes, mime: str, *, width: Optional[int] = None, height: Optional[int] = None) -> tuple[int, int]:
    if not isinstance(data, (bytes, bytearray)) or len(data) < 16:
        raise StoreError("invalid media", "invalid_media", 400)
    if len(data) > MAX_MEDIA_BYTES:
        raise StoreError("media exceeds admission limit", "admission", 400)
    blob = bytes(data)
    if mime == "image/png":
        parsed_w, parsed_h = _png_size(blob)
    elif mime == "image/jpeg":
        if not blob.startswith(b"\xff\xd8\xff"):
            raise StoreError("malformed jpeg", "invalid_media", 400)
        parsed_w, parsed_h = int(width or 0), int(height or 0)
        if parsed_w < 1 or parsed_h < 1:
            raise StoreError("jpeg requires width and height", "invalid_media", 400)
    elif mime == "video/mp4":
        if b"ftyp" not in blob[:32]:
            raise StoreError("malformed mp4", "invalid_media", 400)
        parsed_w, parsed_h = int(width or 0), int(height or 0)
        if parsed_w < 1 or parsed_h < 1:
            raise StoreError("mp4 requires width and height", "invalid_media", 400)
    else:
        raise StoreError("unsupported media type", "invalid_media", 400)
    if width is not None and int(width) != parsed_w:
        raise StoreError("media width does not match", "invalid_media", 400)
    if height is not None and int(height) != parsed_h:
        raise StoreError("media height does not match", "invalid_media", 400)
    return parsed_w, parsed_h


def split_brief(brief: str, shot_count: int) -> list[str]:
    import re

    text = brief.strip()
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    if not parts:
        parts = [text]
    return [(parts[index] if index < len(parts) else parts[-1])[:2000] for index in range(shot_count)]


class CartoonStore:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.blob_dir = self.path.parent / "artifacts"
        self.blob_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._migrate()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _migrate(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                title TEXT NOT NULL,
                retention TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scenes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                owner TEXT NOT NULL,
                brief TEXT NOT NULL,
                profile TEXT NOT NULL,
                character_class TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(owner, idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS shots (
                id TEXT PRIMARY KEY,
                scene_id TEXT NOT NULL,
                owner TEXT NOT NULL,
                ord INTEGER NOT NULL,
                prompt TEXT NOT NULL,
                transition_after TEXT,
                approval TEXT NOT NULL,
                artifact_id TEXT,
                character_class TEXT NOT NULL,
                dialogue TEXT,
                speaker_id TEXT,
                video_id TEXT,
                lipsync_video_id TEXT,
                lipsync_mode TEXT,
                lipsync_reason TEXT
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                scene_id TEXT NOT NULL,
                owner TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                state TEXT NOT NULL,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                UNIQUE(owner, idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS stages (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                shot_id TEXT NOT NULL,
                owner TEXT NOT NULL,
                kind TEXT NOT NULL,
                state TEXT NOT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                lease_token TEXT,
                error_class TEXT,
                video_id TEXT,
                comfy_prompt_id TEXT,
                dispatch_committed INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY,
                stage_id TEXT NOT NULL,
                owner TEXT NOT NULL,
                state TEXT NOT NULL,
                lease_token TEXT NOT NULL,
                video_id TEXT,
                comfy_prompt_id TEXT,
                dispatch_committed INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                attempt_id TEXT NOT NULL,
                owner TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                mime TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                byte_size INTEGER NOT NULL,
                published INTEGER NOT NULL,
                retention TEXT NOT NULL,
                blob_path TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner TEXT,
                kind TEXT NOT NULL,
                ref_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS packs (
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                kind TEXT NOT NULL,
                body TEXT NOT NULL
            );
            """
        )
        self._ensure_column("shots", "dialogue", "TEXT")
        self._ensure_column("shots", "speaker_id", "TEXT")
        self._ensure_column("shots", "video_id", "TEXT")
        self._ensure_column("shots", "lipsync_video_id", "TEXT")
        self._ensure_column("shots", "lipsync_mode", "TEXT")
        self._ensure_column("shots", "lipsync_reason", "TEXT")
        self._ensure_column("stages", "video_id", "TEXT")
        self._ensure_column("stages", "comfy_prompt_id", "TEXT")
        self._ensure_column("stages", "dispatch_committed", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("attempts", "video_id", "TEXT")
        self._ensure_column("attempts", "comfy_prompt_id", "TEXT")
        self._ensure_column("attempts", "dispatch_committed", "INTEGER NOT NULL DEFAULT 0")
        self._conn.commit()

    def _ensure_column(self, table: str, name: str, spec: str) -> None:
        allowed = {"shots", "stages", "attempts"}
        if table not in allowed:
            raise StoreError("unknown table", "validation", 500)
        rows = self._conn.execute(f"PRAGMA table_info({table})").fetchall()
        if any(row[1] == name for row in rows):
            return
        self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {spec}")

    def _event(self, owner: str, kind: str, ref_id: str) -> None:
        self._conn.execute(
            "INSERT INTO events (owner, kind, ref_id, created_at) VALUES (?, ?, ?, ?)",
            (owner, kind, ref_id, _now()),
        )

    def create_project(self, owner: str, title: str, *, retention: str = "research") -> dict[str, Any]:
        name = (title or "").strip()
        if not name or len(name) > 200:
            raise StoreError("title is required", "validation", 400)
        if retention not in RETENTIONS:
            raise StoreError("retention must be research, transient, or approved", "validation", 400)
        project_id = _id("prj")
        with self._lock:
            self._conn.execute(
                "INSERT INTO projects (id, owner, title, retention, created_at) VALUES (?, ?, ?, ?, ?)",
                (project_id, owner, name, retention, _now()),
            )
            self._event(owner, "project.created", project_id)
            self._conn.commit()
        return self.get_project(project_id, owner)

    def get_project(self, project_id: str, owner: str) -> dict[str, Any]:
        row = self._conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise StoreError("project not found", "not_found", 404)
        if row["owner"] != owner:
            raise StoreError("project owner mismatch", "ownership", 403)
        return {
            "id": row["id"],
            "owner": row["owner"],
            "title": row["title"],
            "retention": row["retention"],
            "created_at": row["created_at"],
        }

    def save_pack(self, owner: str, kind: str, pack_id: str, body: str) -> None:
        if kind not in {"character_pack", "style_pack", "reference_asset"}:
            raise StoreError("unknown pack kind", "validation", 400)
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO packs (id, owner, kind, body) VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET body = excluded.body
                WHERE packs.owner = excluded.owner
                """,
                (pack_id, owner, kind, body),
            )
            if self._conn.execute("SELECT changes()").fetchone()[0] == 0:
                existing = self._conn.execute("SELECT owner FROM packs WHERE id = ?", (pack_id,)).fetchone()
                if existing is not None and existing["owner"] != owner:
                    raise StoreError("pack owner mismatch", "ownership", 403)
            self._conn.commit()

    def get_pack(self, pack_id: str, owner: str) -> dict[str, Any]:
        row = self._conn.execute("SELECT * FROM packs WHERE id = ?", (pack_id,)).fetchone()
        if row is None:
            raise StoreError("pack not found", "not_found", 404)
        if row["owner"] != owner:
            raise StoreError("pack owner mismatch", "ownership", 403)
        return {"id": row["id"], "owner": row["owner"], "kind": row["kind"], "body": row["body"]}

    def plan_scene(
        self,
        owner: str,
        project_id: str,
        brief: str,
        *,
        shot_count: int = 3,
        profile: str = "draft",
        character_class: str = DEFAULT_CHARACTER_CLASS,
        idempotency_key: str,
    ) -> dict[str, Any]:
        self.get_project(project_id, owner)
        text = (brief or "").strip()
        if not text or len(text) > MAX_BRIEF_CHARS:
            raise StoreError("brief is required", "admission", 400)
        if not isinstance(shot_count, int) or shot_count < 1 or shot_count > MAX_SHOTS:
            raise StoreError("shot_count must be 1..4", "admission", 400)
        if profile not in {"draft", "final"}:
            raise StoreError("profile must be draft or final", "validation", 400)
        if character_class not in KNOWN_CLASSES:
            raise StoreError("character_class must be cel_human or nonhuman", "validation", 400)
        key = (idempotency_key or "").strip()
        if not key or len(key) > 200:
            raise StoreError("idempotency_key is required", "validation", 400)

        with self._lock:
            existing = self._conn.execute(
                "SELECT id FROM scenes WHERE owner = ? AND idempotency_key = ?",
                (owner, key),
            ).fetchone()
            if existing is not None:
                scene_id = existing["id"]
            else:
                queued = self._conn.execute(
                    """
                    SELECT COUNT(*) AS n FROM runs
                    WHERE owner = ? AND cancel_requested = 0 AND state NOT IN ('SUCCEEDED', 'FAILED_FINAL', 'CANCELLED', 'SUPERSEDED')
                    """,
                    (owner,),
                ).fetchone()["n"]
                if int(queued) >= MAX_QUEUED_RUNS:
                    raise StoreError("queued run admission limit", "admission", 429)
                scene_id = _id("scn")
                run_id = _id("run")
                prompts = split_brief(text, shot_count)
                self._conn.execute("BEGIN")
                try:
                    self._conn.execute(
                        """
                        INSERT INTO scenes (
                            id, project_id, owner, brief, profile, character_class, idempotency_key, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (scene_id, project_id, owner, text, profile, character_class, key, _now()),
                    )
                    self._conn.execute(
                        """
                        INSERT INTO runs (id, scene_id, owner, idempotency_key, state, cancel_requested, created_at)
                        VALUES (?, ?, ?, ?, 'QUEUED', 0, ?)
                        """,
                        (run_id, scene_id, owner, key, _now()),
                    )
                    for index, prompt in enumerate(prompts):
                        shot_id = _id("sht")
                        transition = "CUT" if index < shot_count - 1 else None
                        self._conn.execute(
                            """
                            INSERT INTO shots (
                                id, scene_id, owner, ord, prompt, transition_after, approval, artifact_id, character_class
                            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)
                            """,
                            (shot_id, scene_id, owner, index + 1, prompt, transition, character_class),
                        )
                        self._conn.execute(
                            """
                            INSERT INTO stages (
                                id, run_id, shot_id, owner, kind, state, retry_count, lease_token, error_class
                            ) VALUES (?, ?, ?, ?, 'render', 'QUEUED', 0, NULL, NULL)
                            """,
                            (_id("stg"), run_id, shot_id, owner),
                        )
                    self._event(owner, "scene.planned", scene_id)
                    self._conn.commit()
                except sqlite3.IntegrityError:
                    self._conn.rollback()
                    existing = self._conn.execute(
                        "SELECT id FROM scenes WHERE owner = ? AND idempotency_key = ?",
                        (owner, key),
                    ).fetchone()
                    if existing is None:
                        raise StoreError("duplicate submit conflict", "validation", 409) from None
                    scene_id = existing["id"]
                except Exception:
                    self._conn.rollback()
                    raise
        return self.scene_view(scene_id, owner)

    def scene_view(self, scene_id: str, owner: str) -> dict[str, Any]:
        scene = self._conn.execute("SELECT * FROM scenes WHERE id = ?", (scene_id,)).fetchone()
        if scene is None:
            raise StoreError("scene not found", "not_found", 404)
        if scene["owner"] != owner:
            raise StoreError("scene owner mismatch", "ownership", 403)
        shots = []
        for shot in self._conn.execute(
            "SELECT * FROM shots WHERE scene_id = ? ORDER BY ord",
            (scene_id,),
        ):
            stages = [
                {
                    "id": row["id"],
                    "kind": row["kind"],
                    "state": row["state"],
                    "retry_count": row["retry_count"],
                    "error_class": row["error_class"],
                    "video_id": row["video_id"],
                    "comfy_prompt_id": row["comfy_prompt_id"],
                    "dispatch_committed": bool(row["dispatch_committed"]),
                }
                for row in self._conn.execute(
                    "SELECT * FROM stages WHERE shot_id = ? ORDER BY id",
                    (shot["id"],),
                )
            ]
            artifact = None
            if shot["artifact_id"]:
                artifact = self._artifact_row(shot["artifact_id"], owner)
            shots.append(
                {
                    "id": shot["id"],
                    "order": shot["ord"],
                    "prompt": shot["prompt"],
                    "transition_after": shot["transition_after"],
                    "approval": shot["approval"],
                    "artifact_id": shot["artifact_id"],
                    "artifact_sha256": None if artifact is None else artifact["sha256"],
                    "character_class": shot["character_class"],
                    "dialogue": shot["dialogue"] or "",
                    "speaker_id": shot["speaker_id"] or "doc",
                    "video_id": shot["video_id"],
                    "lipsync_video_id": shot["lipsync_video_id"],
                    "lipsync_mode": shot["lipsync_mode"],
                    "lipsync_reason": shot["lipsync_reason"],
                    "poll": None if not shot["video_id"] else f"/v1/videos/{shot['video_id']}",
                    "stages": stages,
                }
            )
        run = self._conn.execute(
            "SELECT * FROM runs WHERE scene_id = ? ORDER BY created_at DESC LIMIT 1",
            (scene_id,),
        ).fetchone()
        return {
            "schema_version": "cartoon-director/1",
            "project_id": scene["project_id"],
            "scene_id": scene["id"],
            "brief": scene["brief"],
            "profile": scene["profile"],
            "character_class": scene["character_class"],
            "idempotency_key": scene["idempotency_key"],
            "run_id": None if run is None else run["id"],
            "run_state": None if run is None else run["state"],
            "cancel_requested": False if run is None else bool(run["cancel_requested"]),
            "timing": "not_estimated",
            "commercial_export": False,
            "counsel_signed": False,
            "commercial_use": False,
            "usage": "hobby_family",
            "gpu_executed": any(bool(item.get("video_id")) for item in shots),
            "shots": shots,
        }

    def scene_by_key(self, owner: str, idempotency_key: str) -> Optional[dict[str, Any]]:
        row = self._conn.execute(
            "SELECT id FROM scenes WHERE owner = ? AND idempotency_key = ?",
            (owner, idempotency_key),
        ).fetchone()
        if row is None:
            return None
        return self.scene_view(row["id"], owner)

    def set_profile(self, scene_id: str, owner: str, profile: str) -> dict[str, Any]:
        if profile not in {"draft", "final"}:
            raise StoreError("profile must be draft or final", "validation", 400)
        view = self.scene_view(scene_id, owner)
        with self._lock:
            self._conn.execute(
                "UPDATE scenes SET profile = ? WHERE id = ? AND owner = ?",
                (profile, scene_id, owner),
            )
            self._event(owner, "scene.profile", scene_id)
            self._conn.commit()
        updated = self.scene_view(scene_id, owner)
        for before, after in zip(view["shots"], updated["shots"]):
            if before["approval"] != after["approval"] or before["artifact_sha256"] != after["artifact_sha256"]:
                raise StoreError("profile change touched a shot", "validation", 500)
        return updated

    def update_shot_prompt(
        self,
        shot_id: str,
        owner: str,
        prompt: str,
        *,
        transition_after: Optional[str] = None,
        dialogue: Optional[str] = None,
        speaker_id: Optional[str] = None,
    ) -> dict[str, Any]:
        shot = self._shot(shot_id, owner)
        if shot["approval"] == "approved":
            raise StoreError("approved shot is immutable", "validation", 409)
        text = (prompt or "").strip()
        if not text or len(text) > 2000:
            raise StoreError("prompt is required", "validation", 400)
        transition = shot["transition_after"] if transition_after is None else transition_after
        if transition not in {None, "CUT"}:
            raise StoreError("transition must be CUT", "validation", 400)
        spoken = shot["dialogue"] if dialogue is None else str(dialogue).strip()
        if spoken and len(spoken) > 2000:
            raise StoreError("dialogue exceeds admission limit", "admission", 400)
        speaker = shot["speaker_id"] if speaker_id is None else str(speaker_id).strip() or "doc"
        if len(speaker) > 80:
            raise StoreError("speaker_id exceeds admission limit", "admission", 400)
        with self._lock:
            self._conn.execute(
                """
                UPDATE shots SET prompt = ?, transition_after = ?, dialogue = ?, speaker_id = ?
                WHERE id = ? AND owner = ?
                """,
                (text, transition, spoken or None, speaker, shot_id, owner),
            )
            self._event(owner, "shot.prompt", shot_id)
            self._conn.commit()
        return self.scene_view(shot["scene_id"], owner)

    def approve_shot(self, shot_id: str, owner: str) -> dict[str, Any]:
        shot = self._shot(shot_id, owner)
        if not shot["artifact_id"]:
            raise StoreError("shot has no published artifact", "validation", 409)
        artifact = self._artifact_row(shot["artifact_id"], owner)
        if not artifact["published"]:
            raise StoreError("shot has no published artifact", "validation", 409)
        with self._lock:
            self._conn.execute(
                "UPDATE shots SET approval = 'approved' WHERE id = ? AND owner = ?",
                (shot_id, owner),
            )
            self._event(owner, "shot.approved", shot_id)
            self._conn.commit()
        return self.scene_view(shot["scene_id"], owner)

    def regen_shot(self, shot_id: str, owner: str) -> dict[str, Any]:
        shot = self._shot(shot_id, owner)
        before = self.scene_view(shot["scene_id"], owner)
        siblings = {
            item["id"]: (item["approval"], item["artifact_sha256"], item["artifact_id"])
            for item in before["shots"]
            if item["id"] != shot_id
        }
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                self._conn.execute(
                    """
                    UPDATE stages SET state = 'SUPERSEDED'
                    WHERE shot_id = ? AND owner = ? AND state NOT IN ('SUCCEEDED', 'FAILED_FINAL', 'CANCELLED', 'SUPERSEDED')
                    """,
                    (shot_id, owner),
                )
                self._conn.execute(
                    """
                    UPDATE shots
                    SET approval = 'pending', video_id = NULL, lipsync_video_id = NULL,
                        lipsync_mode = NULL, lipsync_reason = NULL
                    WHERE id = ? AND owner = ?
                    """,
                    (shot_id, owner),
                )
                run_id = _id("run")
                self._conn.execute(
                    """
                    INSERT INTO runs (id, scene_id, owner, idempotency_key, state, cancel_requested, created_at)
                    VALUES (?, ?, ?, ?, 'QUEUED', 0, ?)
                    """,
                    (run_id, shot["scene_id"], owner, f"regen:{shot_id}:{uuid.uuid4().hex}", _now()),
                )
                self._conn.execute(
                    """
                    INSERT INTO stages (
                        id, run_id, shot_id, owner, kind, state, retry_count, lease_token, error_class
                    ) VALUES (?, ?, ?, ?, 'render', 'QUEUED', 0, NULL, NULL)
                    """,
                    (_id("stg"), run_id, shot_id, owner),
                )
                self._event(owner, "shot.regen", shot_id)
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
        after = self.scene_view(shot["scene_id"], owner)
        for item in after["shots"]:
            if item["id"] == shot_id:
                continue
            approval, digest, artifact_id = siblings[item["id"]]
            if (item["approval"], item["artifact_sha256"], item["artifact_id"]) != (approval, digest, artifact_id):
                raise StoreError("regen touched another shot", "validation", 500)
        return after

    def begin_attempt(self, stage_id: str, owner: str) -> dict[str, Any]:
        with self._lock:
            stage = self._conn.execute("SELECT * FROM stages WHERE id = ?", (stage_id,)).fetchone()
            if stage is None:
                raise StoreError("stage not found", "not_found", 404)
            if stage["owner"] != owner:
                raise StoreError("stage owner mismatch", "ownership", 403)
            if stage["state"] != "QUEUED":
                raise StoreError("stage is not queued", "validation", 409)
            run = self._conn.execute("SELECT * FROM runs WHERE id = ?", (stage["run_id"],)).fetchone()
            if run is None or run["owner"] != owner:
                raise StoreError("run owner mismatch", "ownership", 403)
            if run["cancel_requested"]:
                raise StoreError("run cancellation blocks a new attempt", "cancel_blocked", 409)
            token = uuid.uuid4().hex
            attempt_id = _id("att")
            self._conn.execute("BEGIN")
            try:
                changed = self._conn.execute(
                    """
                    UPDATE stages SET state = 'LEASED', lease_token = ?
                    WHERE id = ? AND state = 'QUEUED'
                    """,
                    (token, stage_id),
                ).rowcount
                if changed != 1:
                    self._conn.rollback()
                    raise StoreError("stage lease lost", "validation", 409)
                self._conn.execute(
                    """
                    INSERT INTO attempts (id, stage_id, owner, state, lease_token)
                    VALUES (?, ?, ?, 'LEASED', ?)
                    """,
                    (attempt_id, stage_id, owner, token),
                )
                self._conn.execute(
                    "UPDATE runs SET state = 'RUNNING' WHERE id = ?",
                    (stage["run_id"],),
                )
                self._event(owner, "attempt.began", attempt_id)
                self._conn.commit()
            except StoreError:
                raise
            except Exception:
                self._conn.rollback()
                raise
        return {"attempt_id": attempt_id, "stage_id": stage_id, "lease_token": token}

    def bind_dispatch(
        self,
        stage_id: str,
        owner: str,
        *,
        attempt_id: str,
        lease_token: str,
        video_id: str,
        comfy_prompt_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Persist the live video id, then mark dispatch committed in one transaction."""
        job_id = (video_id or "").strip()
        if not job_id:
            raise StoreError("video_id is required", "validation", 400)
        prompt_id = (comfy_prompt_id or job_id).strip()
        with self._lock:
            stage = self._conn.execute("SELECT * FROM stages WHERE id = ?", (stage_id,)).fetchone()
            if stage is None:
                raise StoreError("stage not found", "not_found", 404)
            if stage["owner"] != owner:
                raise StoreError("stage owner mismatch", "ownership", 403)
            attempt = self._conn.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
            if attempt is None or attempt["owner"] != owner:
                raise StoreError("attempt not found", "not_found", 404)
            if attempt["lease_token"] != lease_token or stage["lease_token"] != lease_token:
                raise StoreError("attempt lease mismatch", "ownership", 403)
            if stage["video_id"] not in (None, "", job_id):
                raise StoreError("video_id is immutable", "conflict", 409)
            scene_id = self._conn.execute(
                "SELECT scene_id FROM shots WHERE id = ?", (stage["shot_id"],)
            ).fetchone()["scene_id"]
            siblings = [
                (row["id"], row["video_id"], row["artifact_id"], row["approval"])
                for row in self._conn.execute(
                    "SELECT id, video_id, artifact_id, approval FROM shots WHERE scene_id = ? AND id != ? ORDER BY id",
                    (scene_id, stage["shot_id"]),
                )
            ]
            self._conn.execute("BEGIN")
            try:
                self._conn.execute(
                    """
                    UPDATE stages
                    SET state = 'RUNNING', video_id = ?, comfy_prompt_id = ?, dispatch_committed = 1
                    WHERE id = ?
                    """,
                    (job_id, prompt_id, stage_id),
                )
                self._conn.execute(
                    """
                    UPDATE attempts
                    SET state = 'RUNNING', video_id = ?, comfy_prompt_id = ?, dispatch_committed = 1
                    WHERE id = ?
                    """,
                    (job_id, prompt_id, attempt_id),
                )
                self._conn.execute(
                    "UPDATE shots SET video_id = ? WHERE id = ? AND owner = ?",
                    (job_id, stage["shot_id"], owner),
                )
                self._conn.execute(
                    "UPDATE runs SET state = 'RUNNING' WHERE id = ?",
                    (stage["run_id"],),
                )
                self._event(owner, "attempt.dispatch_committed", attempt_id)
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            after = [
                (row["id"], row["video_id"], row["artifact_id"], row["approval"])
                for row in self._conn.execute(
                    "SELECT id, video_id, artifact_id, approval FROM shots WHERE scene_id = ? AND id != ? ORDER BY id",
                    (scene_id, stage["shot_id"]),
                )
            ]
            if after != siblings:
                raise StoreError("dispatch touched another shot", "validation", 500)
        return {"stage_id": stage_id, "attempt_id": attempt_id, "video_id": job_id, "dispatch_committed": True}

    def bind_lipsync(
        self,
        shot_id: str,
        owner: str,
        *,
        video_id: Optional[str],
        mode: str,
        reason: str,
    ) -> dict[str, Any]:
        shot = self._shot(shot_id, owner)
        kind = (mode or "").strip() or "narration"
        note = (reason or "").strip() or "unspecified"
        job = (video_id or "").strip() or None
        with self._lock:
            self._conn.execute(
                """
                UPDATE shots
                SET lipsync_video_id = ?, lipsync_mode = ?, lipsync_reason = ?
                WHERE id = ? AND owner = ?
                """,
                (job, kind, note, shot_id, owner),
            )
            self._event(owner, "shot.lipsync", shot_id)
            self._conn.commit()
        return self.scene_view(shot["scene_id"], owner)

    def commit_artifact(
        self,
        attempt_id: str,
        owner: str,
        *,
        data: bytes,
        mime: str,
        lease_token: str,
        width: Optional[int] = None,
        height: Optional[int] = None,
        publish: bool = True,
        retention: str = "research",
    ) -> dict[str, Any]:
        if retention not in RETENTIONS:
            raise StoreError("retention must be research, transient, or approved", "validation", 400)
        parsed_w, parsed_h = validate_media(data, mime, width=width, height=height)
        digest = hashlib.sha256(data).hexdigest()
        with self._lock:
            attempt = self._conn.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
            if attempt is None:
                raise StoreError("attempt not found", "not_found", 404)
            if attempt["owner"] != owner or attempt["lease_token"] != lease_token:
                raise StoreError("attempt lease mismatch", "ownership", 403)
            stage = self._conn.execute("SELECT * FROM stages WHERE id = ?", (attempt["stage_id"],)).fetchone()
            if stage is None or stage["lease_token"] != lease_token:
                raise StoreError("stage lease mismatch", "validation", 409)
            run = self._conn.execute("SELECT * FROM runs WHERE id = ?", (stage["run_id"],)).fetchone()
            if run is None or run["owner"] != owner:
                raise StoreError("run owner mismatch", "ownership", 403)
            if publish and run["cancel_requested"]:
                raise StoreError("cancellation blocks publish", "cancel_blocked", 409)
            if publish and stage["state"] not in {"LEASED", "RUNNING", "VERIFYING"}:
                raise StoreError("stage cannot publish", "validation", 409)
            artifact_id = _id("art")
            final_path = self.blob_dir / artifact_id
            partial = self.blob_dir / f".{artifact_id}.partial"
            partial.write_bytes(data)
            os.replace(partial, final_path)
            self._conn.execute("BEGIN")
            try:
                self._conn.execute(
                    """
                    INSERT INTO artifacts (
                        id, attempt_id, owner, sha256, mime, width, height, byte_size,
                        published, retention, blob_path, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        artifact_id,
                        attempt_id,
                        owner,
                        digest,
                        mime,
                        parsed_w,
                        parsed_h,
                        len(data),
                        1 if publish else 0,
                        retention,
                        artifact_id,
                        _now(),
                    ),
                )
                if publish:
                    self._conn.execute(
                        "UPDATE stages SET state = 'SUCCEEDED' WHERE id = ?",
                        (stage["id"],),
                    )
                    self._conn.execute(
                        "UPDATE attempts SET state = 'SUCCEEDED' WHERE id = ?",
                        (attempt_id,),
                    )
                    self._conn.execute(
                        "UPDATE shots SET artifact_id = ? WHERE id = ? AND owner = ?",
                        (artifact_id, stage["shot_id"], owner),
                    )
                else:
                    self._conn.execute(
                        "UPDATE attempts SET state = 'HELD' WHERE id = ?",
                        (attempt_id,),
                    )
                self._event(owner, "artifact.commit", artifact_id)
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                final_path.unlink(missing_ok=True)
                raise
        return self.get_artifact(artifact_id, owner)

    def fail_stage(self, stage_id: str, owner: str, error_class: str) -> dict[str, Any]:
        kind = (error_class or "").strip() or "unknown"
        with self._lock:
            stage = self._conn.execute("SELECT * FROM stages WHERE id = ?", (stage_id,)).fetchone()
            if stage is None:
                raise StoreError("stage not found", "not_found", 404)
            if stage["owner"] != owner:
                raise StoreError("stage owner mismatch", "ownership", 403)
            retryable = kind in TRANSIENT_ERRORS and int(stage["retry_count"]) < MAX_AUTO_RETRY
            self._conn.execute("BEGIN")
            try:
                if retryable:
                    self._conn.execute(
                        """
                        UPDATE stages
                        SET state = 'QUEUED', retry_count = retry_count + 1, lease_token = NULL, error_class = ?
                        WHERE id = ?
                        """,
                        (kind, stage_id),
                    )
                else:
                    self._conn.execute(
                        "UPDATE stages SET state = 'FAILED_FINAL', error_class = ?, lease_token = NULL WHERE id = ?",
                        (kind, stage_id),
                    )
                    self._conn.execute(
                        "UPDATE runs SET state = 'FAILED_FINAL' WHERE id = ?",
                        (stage["run_id"],),
                    )
                self._event(owner, "stage.failed", stage_id)
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            shot = self._conn.execute("SELECT scene_id FROM shots WHERE id = ?", (stage["shot_id"],)).fetchone()
        return self.scene_view(shot["scene_id"], owner)

    def request_cancel(self, run_id: str, owner: str) -> dict[str, Any]:
        with self._lock:
            run = self._conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
            if run is None:
                raise StoreError("run not found", "not_found", 404)
            if run["owner"] != owner:
                raise StoreError("run owner mismatch", "ownership", 403)
            self._conn.execute(
                "UPDATE runs SET cancel_requested = 1, state = 'CANCEL_REQUESTED' WHERE id = ?",
                (run_id,),
            )
            self._event(owner, "run.cancel", run_id)
            self._conn.commit()
        return self.scene_view(run["scene_id"], owner)

    def get_run(self, run_id: str, owner: str) -> dict[str, Any]:
        run = self._conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if run is None:
            raise StoreError("run not found", "not_found", 404)
        if run["owner"] != owner:
            raise StoreError("run owner mismatch", "ownership", 403)
        view = self.scene_view(run["scene_id"], owner)
        view["run_id"] = run["id"]
        view["run_state"] = run["state"]
        view["cancel_requested"] = bool(run["cancel_requested"])
        return view

    def get_artifact(self, artifact_id: str, owner: str) -> dict[str, Any]:
        return self._artifact_row(artifact_id, owner)

    def _artifact_row(self, artifact_id: str, owner: str) -> dict[str, Any]:
        row = self._conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
        if row is None:
            raise StoreError("artifact not found", "not_found", 404)
        if row["owner"] != owner:
            raise StoreError("artifact owner mismatch", "ownership", 403)
        return {
            "id": row["id"],
            "owner": row["owner"],
            "sha256": row["sha256"],
            "mime": row["mime"],
            "width": row["width"],
            "height": row["height"],
            "byte_size": row["byte_size"],
            "published": bool(row["published"]),
            "retention": row["retention"],
            "created_at": row["created_at"],
            "timing": "not_estimated",
        }

    def _shot(self, shot_id: str, owner: str) -> sqlite3.Row:
        shot = self._conn.execute("SELECT * FROM shots WHERE id = ?", (shot_id,)).fetchone()
        if shot is None:
            raise StoreError("shot not found", "not_found", 404)
        if shot["owner"] != owner:
            raise StoreError("shot owner mismatch", "ownership", 403)
        return shot

    def artifact_count(self) -> int:
        return int(self._conn.execute("SELECT COUNT(*) AS n FROM artifacts").fetchone()["n"])
