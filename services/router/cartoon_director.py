"""Additive cartoon director API. Legacy POST /v1/cartoon stays prompt-only unless ids are sent."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Optional

from cartoon_audio import (
    DEFAULT_CHARACTER_CLASS,
    DEFAULT_CHARACTER_LABEL,
    DialoguePlanError,
    dialogue_plan,
    normalize_class,
)
from cartoon_store import CartoonStore, StoreError

_OWNER_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
_DEFAULT_STATE = "/var/lib/spockify/cartoon/state.sqlite"


class DirectorError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def open_store() -> CartoonStore:
    path = Path(os.environ.get("SPOCKIFY_CARTOON_STATE", _DEFAULT_STATE))
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise DirectorError(f"cartoon state dir unavailable: {exc}", 503) from exc
    return CartoonStore(path)


def owner_from_authorization(
    authorization: Optional[str],
    *,
    requested_owner: Optional[str],
    master_key: str,
) -> str:
    if not authorization:
        raise DirectorError("Missing API key", 401)
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise DirectorError("Missing API key", 401)
    derived = "key_" + hashlib.sha256(token.encode()).hexdigest()[:24]
    if requested_owner:
        if not _OWNER_RE.match(requested_owner):
            raise DirectorError("invalid owner", 400)
        if requested_owner != derived:
            if master_key and token == master_key:
                return requested_owner
            raise DirectorError("owner does not match key", 403)
    return requested_owner or derived


def _guard(body: dict[str, Any]) -> None:
    if body.get("commercial_export") is True or body.get("commercial_use") is True:
        raise DirectorError("commercial export is blocked", 403)
    if body.get("counsel_signed") is True:
        raise DirectorError("counsel_signed cannot be true", 403)


def _call(fn):
    try:
        return fn()
    except StoreError as exc:
        raise DirectorError(str(exc), exc.status_code) from exc
    except DialoguePlanError as exc:
        raise DirectorError(str(exc), exc.status_code) from exc


def public_scene(view: dict[str, Any], *, gpu_executed: Optional[bool] = None) -> dict[str, Any]:
    mouth = view.get("character_class") or DEFAULT_CHARACTER_CLASS
    view = dict(view)
    view["character_label"] = (
        DEFAULT_CHARACTER_LABEL if mouth == DEFAULT_CHARACTER_CLASS else "nonhuman mouth"
    )
    view["reversible_default"] = mouth == DEFAULT_CHARACTER_CLASS
    view["production_ready"] = False
    view["usage"] = "hobby_family"
    if gpu_executed is not None:
        view["gpu_executed"] = bool(gpu_executed)
    else:
        view["gpu_executed"] = bool(view.get("gpu_executed"))
    return view


def create_project(store: CartoonStore, owner: str, body: dict[str, Any]) -> dict[str, Any]:
    _guard(body)
    project = _call(
        lambda: store.create_project(
            owner,
            str(body.get("title") or "Untitled"),
            retention=str(body.get("retention") or "research"),
        )
    )
    project["commercial_export"] = False
    project["counsel_signed"] = False
    project["timing"] = "not_estimated"
    return project


def plan_scene(store: CartoonStore, owner: str, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _guard(body)
    try:
        shot_count = int(body.get("shot_count") if body.get("shot_count") is not None else 3)
    except (TypeError, ValueError) as exc:
        raise DirectorError("shot_count must be 1..4", 400) from exc
    view = _call(
        lambda: store.plan_scene(
            owner,
            project_id,
            str(body.get("brief") or ""),
            shot_count=shot_count,
            profile=str(body.get("profile") or "draft"),
            character_class=str(body.get("character_class") or DEFAULT_CHARACTER_CLASS),
            idempotency_key=str(body.get("idempotency_key") or ""),
        )
    )
    return public_scene(view)


def set_profile(store: CartoonStore, owner: str, scene_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _guard(body)
    return public_scene(_call(lambda: store.set_profile(scene_id, owner, str(body.get("profile") or ""))))


def edit_shot(store: CartoonStore, owner: str, shot_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _guard(body)
    transition = body.get("transition_after", None)
    return public_scene(
        _call(
            lambda: store.update_shot_prompt(
                shot_id,
                owner,
                str(body.get("prompt") or ""),
                transition_after=transition,
                dialogue=body.get("dialogue"),
                speaker_id=body.get("speaker_id"),
            )
        )
    )


def approve_shot(store: CartoonStore, owner: str, shot_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _guard(body)
    return public_scene(_call(lambda: store.approve_shot(shot_id, owner)))


def regen_shot(store: CartoonStore, owner: str, shot_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _guard(body)
    return public_scene(_call(lambda: store.regen_shot(shot_id, owner)))


def cancel_run(store: CartoonStore, owner: str, run_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _guard(body)
    return public_scene(_call(lambda: store.request_cancel(run_id, owner)))


def get_scene(store: CartoonStore, owner: str, scene_id: str) -> dict[str, Any]:
    return public_scene(_call(lambda: store.scene_view(scene_id, owner)))


def get_scene_by_key(store: CartoonStore, owner: str, idempotency_key: str) -> dict[str, Any]:
    view = _call(lambda: store.scene_by_key(owner, idempotency_key))
    if view is None:
        raise DirectorError("scene not found", 404)
    return public_scene(view)


def get_run(store: CartoonStore, owner: str, run_id: str) -> dict[str, Any]:
    return public_scene(_call(lambda: store.get_run(run_id, owner)))


def get_artifact(store: CartoonStore, owner: str, artifact_id: str) -> dict[str, Any]:
    return _call(lambda: store.get_artifact(artifact_id, owner))


def plan_dialogue(body: dict[str, Any]) -> dict[str, Any]:
    _guard(body)
    return _call(
        lambda: dialogue_plan(
            text=str(body.get("text") or ""),
            character_class=body.get("character_class"),
            lip_sync=body.get("lip_sync", None),
            speaker_id=str(body.get("speaker_id") or "doc"),
        )
    )


def bind_legacy_request(store: CartoonStore, owner: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Validate optional pack ids. Omitted ids do not touch storage."""
    _guard(fields)
    version = fields.get("schema_version")
    if version not in (None, "", "1.0", "cartoon-director/1"):
        raise DirectorError("unsupported schema_version", 400)
    linked: dict[str, Any] = {}
    for key, kind in (
        ("character_pack_id", "character_pack"),
        ("style_pack_id", "style_pack"),
    ):
        pack_id = fields.get(key)
        if not pack_id:
            continue
        pack = _call(lambda pack_id=pack_id: store.get_pack(str(pack_id), owner))
        if pack["kind"] != kind:
            raise DirectorError(f"{key} has the wrong pack kind", 400)
        linked[key] = pack["id"]
    if fields.get("profile") not in (None, "", "draft", "final"):
        raise DirectorError("profile must be draft or final", 400)
    if fields.get("scene_id"):
        view = _call(lambda: store.scene_view(str(fields["scene_id"]), owner))
        linked["scene_id"] = view["scene_id"]
        linked["project_id"] = view["project_id"]
    elif fields.get("project_id"):
        project = _call(lambda: store.get_project(str(fields["project_id"]), owner))
        linked["project_id"] = project["id"]
    if fields.get("character_class"):
        try:
            linked["character_class"] = normalize_class(str(fields["character_class"]))
        except DialoguePlanError as exc:
            raise DirectorError(str(exc), exc.status_code) from exc
    if linked or fields.get("profile"):
        linked["schema_version"] = "cartoon-director/1"
        linked["commercial_export"] = False
        linked["counsel_signed"] = False
        linked["commercial_use"] = False
        if fields.get("profile"):
            linked["profile"] = str(fields["profile"])
    return linked


def remember_pack(store: CartoonStore, owner: str, kind: str, document: dict[str, Any]) -> None:
    _call(lambda: store.save_pack(owner, kind, str(document["id"]), json.dumps(document, sort_keys=True)))


async def render_scene(
    store: CartoonStore,
    owner: str,
    scene_id: str,
    body: dict[str, Any],
    **kwargs: Any,
) -> dict[str, Any]:
    """Enqueue the live sprite → slice → Wan FLF path for pending shots."""
    # Imported lazily: cartoon_dispatch imports public_scene from this module.
    import cartoon_dispatch

    return await cartoon_dispatch.render_scene(store, owner, scene_id, body, **kwargs)
