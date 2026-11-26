"""Director render → live sprite-grid → slice → Wan FLF (+ optional VACE / lips).

C-010: persist the video id before treating dispatch as committed. Approved
shots are not resubmitted. Dialogue uses existing XTTS + LatentSync with an
honest narration/mux fallback. This is hobby/family use, not commercial GA.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Optional

import cartoon_pipeline
import series_prod
from cartoon_audio import DEFAULT_CHARACTER_CLASS, DialoguePlanError, dialogue_plan
from cartoon_director import DirectorError, public_scene
from cartoon_store import CartoonStore, StoreError

LOG = logging.getLogger("spockify.cartoon.dispatch")

HOBBY_STYLE = (
    "clean 2D cartoon cel animation for a children's family cartoon, "
    "friendly characters, bright colors, no violence, no adult content, "
    "crisp line art, readable silhouettes, consistent character sheet"
)

RunShot = Callable[..., Awaitable[dict[str, Any]]]
ChainDialogue = Callable[..., Awaitable[dict[str, Any]]]


class DispatchError(DirectorError):
    pass


def _call(fn):
    try:
        return fn()
    except StoreError as exc:
        raise DispatchError(str(exc), exc.status_code) from exc
    except DialoguePlanError as exc:
        raise DispatchError(str(exc), exc.status_code) from exc


def _first_video_id(result: dict[str, Any]) -> Optional[str]:
    videos = result.get("videos") or []
    if videos and isinstance(videos[0], dict) and videos[0].get("id"):
        return str(videos[0]["id"])
    if result.get("id") and str(result.get("status") or "").startswith("video"):
        return str(result["id"])
    return None


def _plate_bytes(
    value: Any,
) -> Optional[tuple[bytes, str]]:
    """Accept (bytes, mime) tuples only — never invent PuLID / look-still lock."""
    if value is None:
        return None
    if isinstance(value, tuple) and value and isinstance(value[0], (bytes, bytearray)):
        data = bytes(value[0])
        if not data:
            return None
        mime = str(value[1] if len(value) > 1 else "image/png") or "image/png"
        return (data, mime)
    return None


async def default_run_shot(
    *,
    prompt: str,
    seconds: Optional[str | float | int] = 2,
    run_edit: bool = False,
    grid: str = "2x2",
    pair_mode: str = "first_last",
    style: Optional[str] = None,
    video_size: Optional[str] = None,
    character_plate: Optional[tuple[bytes, str]] = None,
    background: Optional[tuple[bytes, str]] = None,
) -> dict[str, Any]:
    plate = _plate_bytes(character_plate)
    bg = _plate_bytes(background)
    # Short-beat default is the proven GB10 canvas (768x704). Full 1280x720
    # Wan FLF has stalled mid-sample (~78%) through the 2400s poll on Spark;
    # callers may still pass 1280x720 explicitly.
    return await cartoon_pipeline.run_cartoon(
        prompt=prompt,
        grid=grid or "2x2",
        style=(style or "").strip() or HOBBY_STYLE,
        pair_mode=pair_mode or "first_last",
        seconds=2 if seconds is None else seconds,
        video_size=video_size or cartoon_pipeline.SHORT_BEAT_VIDEO_SIZE,
        run_edit=bool(run_edit),
        include_tiles=False,
        include_grid=False,
        commercial_export=False,
        character_plate=plate,
        background=bg,
    )


async def default_chain_dialogue(
    *,
    flf_id: str,
    text: str,
    speaker_id: str,
    character_class: str,
    lip_sync: Optional[bool],
) -> dict[str, Any]:
    """Wait for the FLF plate, then XTTS + LatentSync. Fall back honestly."""
    plan = dialogue_plan(
        text=text,
        character_class=character_class,
        lip_sync=lip_sync,
        speaker_id=speaker_id,
    )
    out: dict[str, Any] = {
        "lipsync_mode": plan["lipsync_mode"],
        "production_ready": False,
        "gpu_executed": False,
        "reason": plan["reason"],
        "vo_id": None,
        "video_id": None,
    }
    try:
        vo = await series_prod.synthesize_vo(text=text, speaker_id=speaker_id)
        out["vo_id"] = vo.get("id")
        out["vo_engine"] = vo.get("engine")
    except Exception as exc:  # noqa: BLE001
        LOG.warning("cartoon dialogue VO failed: %s", exc)
        out["lipsync_mode"] = "narration"
        out["reason"] = f"xtts_failed:{exc}"
        return out

    try:
        await cartoon_pipeline._wait_flf_bytes(flf_id)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("cartoon dialogue waiting on FLF %s failed: %s", flf_id, exc)
        out["lipsync_mode"] = "narration"
        out["reason"] = f"flf_unavailable:{exc}"
        return out

    mode = plan["lipsync_mode"]
    if mode == "latentsync":
        try:
            job = await series_prod.enqueue_mux(
                video_id=flf_id,
                vo=str(vo.get("id")),
                lip_sync=True,
            )
            out["video_id"] = job.get("id")
            out["gpu_executed"] = True
            out["reason"] = "queued_latentsync_after_flf"
            out["production_ready"] = False
            return out
        except Exception as exc:  # noqa: BLE001
            LOG.warning("LatentSync failed for %s, falling back: %s", flf_id, exc)
            mode = "mux"
            out["reason"] = f"latentsync_failed:{exc}"

    if mode == "mux":
        try:
            job = await series_prod.enqueue_mux(
                video_id=flf_id,
                vo=str(vo.get("id")),
                lip_sync=False,
            )
            out["video_id"] = job.get("id")
            out["lipsync_mode"] = "mux"
            out["gpu_executed"] = False
            if not str(out.get("reason") or "").startswith("latentsync_failed"):
                out["reason"] = "queued_mux_after_flf"
            return out
        except Exception as exc:  # noqa: BLE001
            LOG.warning("mux fallback failed for %s: %s", flf_id, exc)
            out["lipsync_mode"] = "narration"
            out["reason"] = f"mux_failed:{exc}"
            return out

    out["lipsync_mode"] = "narration"
    if not out.get("reason"):
        out["reason"] = "narration_only"
    return out


def _spawn_dialogue(
    *,
    store_factory: Callable[[], CartoonStore],
    owner: str,
    shot_id: str,
    flf_id: str,
    text: str,
    speaker_id: str,
    character_class: str,
    lip_sync: Optional[bool],
    chain: ChainDialogue,
) -> None:
    async def _job() -> None:
        store = store_factory()
        try:
            result = await chain(
                flf_id=flf_id,
                text=text,
                speaker_id=speaker_id,
                character_class=character_class,
                lip_sync=lip_sync,
            )
            store.bind_lipsync(
                shot_id,
                owner,
                video_id=str(result.get("video_id") or "") or None,
                mode=str(result.get("lipsync_mode") or "narration"),
                reason=str(result.get("reason") or "queued"),
            )
        except Exception as exc:  # noqa: BLE001
            LOG.warning("dialogue chain for shot %s failed: %s", shot_id, exc)
            try:
                store.bind_lipsync(
                    shot_id,
                    owner,
                    video_id=None,
                    mode="narration",
                    reason=f"dialogue_chain_failed:{exc}",
                )
            except Exception:  # noqa: BLE001
                LOG.warning("could not record dialogue fallback for %s", shot_id)
        finally:
            store.close()

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        LOG.warning("no running loop; dialogue after FLF was not spawned")
        return
    loop.create_task(_job())


async def render_scene(
    store: CartoonStore,
    owner: str,
    scene_id: str,
    body: dict[str, Any],
    *,
    run_shot: Optional[RunShot] = None,
    chain_dialogue: Optional[ChainDialogue] = None,
    spawn_dialogue: bool = True,
    store_factory: Optional[Callable[[], CartoonStore]] = None,
) -> dict[str, Any]:
    """Enqueue FLF for pending shots. Skip approved siblings."""
    if body.get("commercial_export") is True or body.get("commercial_use") is True:
        raise DispatchError("commercial export is blocked", 403)
    if body.get("counsel_signed") is True:
        raise DispatchError("counsel_signed cannot be true", 403)

    view = _call(lambda: store.scene_view(scene_id, owner))
    shot_filter = str(body.get("shot_id") or "").strip() or None
    runner = run_shot or default_run_shot
    chain = chain_dialogue or default_chain_dialogue
    seconds = body.get("seconds") if body.get("seconds") is not None else 2
    run_edit = bool(body.get("run_edit"))
    grid = str(body.get("grid") or "2x2")
    pair_mode = str(body.get("pair_mode") or "first_last")
    style = body.get("style")
    video_size = body.get("video_size") or cartoon_pipeline.SHORT_BEAT_VIDEO_SIZE
    default_dialogue = str(body.get("dialogue") or "").strip()
    lip_sync = body.get("lip_sync", None)
    default_speaker = str(body.get("speaker_id") or "doc")
    character_plate = _plate_bytes(body.get("character_plate"))
    background = _plate_bytes(body.get("background"))
    # Identity for the Qwen sprite step: real image bytes → qwen-reference.
    # Never claim PuLID / look-still on this director path.
    expected_identity = cartoon_pipeline.identity_lock_report(
        [
            label
            for label, plate in (
                ("character_plate", character_plate),
                ("background", background),
            )
            if plate
        ]
    )

    siblings_before = {
        item["id"]: (item.get("approval"), item.get("artifact_sha256"), item.get("video_id"))
        for item in view["shots"]
    }
    dispatched: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for shot in view["shots"]:
        if shot_filter and shot["id"] != shot_filter:
            skipped.append(
                {
                    "shot_id": shot["id"],
                    "order": shot["order"],
                    "reason": "not_selected",
                    "approval": shot.get("approval"),
                    "video_id": shot.get("video_id"),
                }
            )
            continue
        if shot.get("approval") == "approved":
            skipped.append(
                {
                    "shot_id": shot["id"],
                    "order": shot["order"],
                    "reason": "approved",
                    "approval": "approved",
                    "video_id": shot.get("video_id"),
                }
            )
            continue
        stages = list(shot.get("stages") or [])
        queued = next((stage for stage in stages if stage.get("state") == "QUEUED"), None)
        reuse = next(
            (
                stage
                for stage in stages
                if stage.get("state") in {"LEASED", "RUNNING"}
                and stage.get("video_id")
                and stage.get("dispatch_committed")
            ),
            None,
        )
        if queued is None and reuse is not None:
            dispatched.append(
                {
                    "shot_id": shot["id"],
                    "order": shot["order"],
                    "stage_id": reuse["id"],
                    "video_id": reuse.get("video_id"),
                    "reused": True,
                    "poll": f"/v1/videos/{reuse.get('video_id')}",
                }
            )
            continue
        if queued is None:
            skipped.append(
                {
                    "shot_id": shot["id"],
                    "order": shot["order"],
                    "reason": "no_queued_stage",
                    "approval": shot.get("approval"),
                    "video_id": shot.get("video_id"),
                }
            )
            continue

        attempt = _call(lambda stage_id=queued["id"]: store.begin_attempt(stage_id, owner))
        try:
            result = await runner(
                prompt=str(shot.get("prompt") or ""),
                seconds=seconds,
                run_edit=run_edit,
                grid=grid,
                pair_mode=pair_mode,
                style=style,
                video_size=video_size,
                character_plate=character_plate,
                background=background,
            )
        except cartoon_pipeline.CartoonError as exc:
            _call(lambda: store.fail_stage(queued["id"], owner, "comfy_transient"))
            raise DispatchError(str(exc), exc.status_code) from exc
        except Exception as exc:  # noqa: BLE001
            _call(lambda: store.fail_stage(queued["id"], owner, "comfy_transient"))
            raise DispatchError(f"cartoon dispatch failed: {exc}", 502) from exc

        video_id = _first_video_id(result)
        if not video_id:
            _call(lambda: store.fail_stage(queued["id"], owner, "validation"))
            raise DispatchError("cartoon pipeline returned no video id", 502)

        # Prefer the runner's identity report; fall back to the plates we sent.
        shot_identity = {
            "identity_lock": result.get("identity_lock") or expected_identity["identity_lock"],
            "identity_conditioned": bool(
                result.get("identity_conditioned")
                if "identity_conditioned" in result
                else expected_identity["identity_conditioned"]
            ),
            "identity_images": list(
                result.get("identity_images")
                if result.get("identity_images") is not None
                else expected_identity["identity_images"]
            ),
        }
        if character_plate or background:
            # Fail closed: plates were attached — never report pulid / edit-only.
            if shot_identity["identity_lock"] in {"pulid", "look-still", "none", None}:
                raise DispatchError(
                    "identity_lock must be qwen-reference when character_plate/"
                    "background are attached (got "
                    f"{shot_identity['identity_lock']!r})",
                    500,
                )
            if shot_identity["identity_lock"] != "qwen-reference":
                shot_identity["identity_lock"] = "qwen-reference"
                shot_identity["identity_conditioned"] = True
                shot_identity["identity_images"] = list(
                    expected_identity["identity_images"]
                )

        _call(
            lambda: store.bind_dispatch(
                queued["id"],
                owner,
                attempt_id=attempt["attempt_id"],
                lease_token=attempt["lease_token"],
                video_id=video_id,
                comfy_prompt_id=str(result.get("id") or video_id),
            )
        )

        spoken = str(shot.get("dialogue") or default_dialogue or "").strip()
        dialogue_meta: Optional[dict[str, Any]] = None
        if spoken:
            try:
                plan = dialogue_plan(
                    text=spoken,
                    character_class=shot.get("character_class") or view.get("character_class") or DEFAULT_CHARACTER_CLASS,
                    lip_sync=lip_sync,
                    speaker_id=str(shot.get("speaker_id") or default_speaker),
                )
            except DialoguePlanError as exc:
                raise DispatchError(str(exc), exc.status_code) from exc
            _call(
                lambda: store.bind_lipsync(
                    shot["id"],
                    owner,
                    video_id=None,
                    mode=plan["lipsync_mode"],
                    reason="queued_after_flf",
                )
            )
            dialogue_meta = {
                "lipsync_mode": plan["lipsync_mode"],
                "status": "queued_after_flf",
                "production_ready": False,
                "gpu_executed": False,
                "reason": "queued_after_flf",
            }
            if spawn_dialogue:
                _spawn_dialogue(
                    store_factory=store_factory or (lambda: CartoonStore(store.path)),
                    owner=owner,
                    shot_id=shot["id"],
                    flf_id=video_id,
                    text=spoken,
                    speaker_id=str(shot.get("speaker_id") or default_speaker),
                    character_class=str(
                        shot.get("character_class")
                        or view.get("character_class")
                        or DEFAULT_CHARACTER_CLASS
                    ),
                    lip_sync=lip_sync,
                    chain=chain,
                )

        row = {
            "shot_id": shot["id"],
            "order": shot["order"],
            "stage_id": queued["id"],
            "video_id": video_id,
            "reused": False,
            "poll": f"/v1/videos/{video_id}",
            "cartoon_run_id": result.get("id"),
            "dialogue": dialogue_meta,
        }
        row.update(shot_identity)
        dispatched.append(row)

    after = _call(lambda: store.scene_view(scene_id, owner))
    for item in after["shots"]:
        if shot_filter and item["id"] == shot_filter:
            continue
        if shot_filter and item["id"] != shot_filter:
            approval, digest, video_id = siblings_before[item["id"]]
            if (item.get("approval"), item.get("artifact_sha256"), item.get("video_id")) != (
                approval,
                digest,
                video_id,
            ):
                raise DispatchError("render touched another shot", 500)
        elif item.get("approval") == "approved":
            approval, digest, video_id = siblings_before[item["id"]]
            if (item.get("approval"), item.get("artifact_sha256"), item.get("video_id")) != (
                approval,
                digest,
                video_id,
            ):
                raise DispatchError("render touched an approved shot", 500)

    payload = public_scene(after, gpu_executed=bool(dispatched))
    payload["dispatched"] = dispatched
    payload["skipped"] = skipped
    payload["status"] = "videos_queued" if dispatched else after.get("run_state")
    payload["poll"] = [row["poll"] for row in dispatched if row.get("poll")]
    payload.update(expected_identity)
    if character_plate or background:
        # Top-level identity must match the plates Frank attached.
        payload["identity_lock"] = "qwen-reference"
        payload["identity_conditioned"] = True
        payload["identity_images"] = list(expected_identity["identity_images"])
    return payload
