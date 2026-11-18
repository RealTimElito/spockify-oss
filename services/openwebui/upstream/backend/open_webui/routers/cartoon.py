"""Proxy the cartoon director routes. The browser never sees the router key."""

from __future__ import annotations

import json
import os
from typing import Any, Optional

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from open_webui.env import AIOHTTP_CLIENT_SESSION_SSL, COMFYUI_VIDEO_API_KEY
from open_webui.utils.auth import get_verified_user
from open_webui.utils.session_pool import get_session

router = APIRouter()

_ROUTER_URL = (
    os.environ.get("SPOCKIFY_ROUTER_URL")
    or "http://spockify-router.spockify.svc.cluster.local:4100"
).rstrip("/")


class PlanBody(BaseModel):
    brief: str
    shot_count: int = 3
    profile: str = "draft"
    character_class: str = "cel_human"
    idempotency_key: str
    title: str = "Scene"
    project_id: Optional[str] = None


class ShotBody(BaseModel):
    prompt: str
    transition_after: Optional[str] = None
    dialogue: Optional[str] = None
    speaker_id: Optional[str] = None


class RenderBody(BaseModel):
    shot_id: Optional[str] = None
    seconds: Optional[float] = 2
    run_edit: bool = False
    dialogue: Optional[str] = None
    speaker_id: str = "doc"
    lip_sync: Optional[bool] = True


class ProfileBody(BaseModel):
    profile: str


class DialogueBody(BaseModel):
    text: str
    character_class: Optional[str] = None
    lip_sync: Optional[bool] = None
    speaker_id: str = "doc"


def _headers(owner: str) -> dict[str, str]:
    api_key = (
        (os.environ.get("OPENAI_API_KEY") or "").strip()
        or (COMFYUI_VIDEO_API_KEY or "").strip()
    )
    if not api_key:
        raise HTTPException(status_code=503, detail="Cartoon director is not configured")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Cartoon-Owner": owner,
    }


async def _forward(method: str, path: str, owner: str, payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    session = await get_session()
    request = session.post if method == "POST" else session.get
    kwargs: dict[str, Any] = {
        "headers": _headers(owner),
        "ssl": AIOHTTP_CLIENT_SESSION_SSL,
    }
    if payload is not None:
        kwargs["json"] = payload
    try:
        async with request(f"{_ROUTER_URL}{path}", **kwargs) as resp:
            text = await resp.text()
            if resp.status >= 400:
                raise HTTPException(status_code=resp.status, detail=text[:500])
            try:
                data = json.loads(text)
            except Exception as exc:
                raise HTTPException(status_code=502, detail="Cartoon director returned non-JSON") from exc
    except aiohttp.ClientError as exc:
        raise HTTPException(status_code=502, detail="Cartoon director unreachable") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Cartoon director returned an unexpected body")
    return data


@router.post("/plan")
async def plan_scene(body: PlanBody, user=Depends(get_verified_user)) -> dict[str, Any]:
    project_id = body.project_id
    if not project_id:
        project = await _forward(
            "POST",
            "/v1/cartoon/projects",
            user.id,
            {"title": body.title, "retention": "research"},
        )
        project_id = project["id"]
    return await _forward(
        "POST",
        f"/v1/cartoon/projects/{project_id}/scenes",
        user.id,
        {
            "brief": body.brief,
            "shot_count": body.shot_count,
            "profile": body.profile,
            "character_class": body.character_class,
            "idempotency_key": body.idempotency_key,
        },
    )


@router.get("/scenes/{scene_id}")
async def get_scene(scene_id: str, user=Depends(get_verified_user)) -> dict[str, Any]:
    return await _forward("GET", f"/v1/cartoon/scenes/{scene_id}", user.id)


@router.post("/scenes/{scene_id}/profile")
async def set_profile(scene_id: str, body: ProfileBody, user=Depends(get_verified_user)) -> dict[str, Any]:
    return await _forward(
        "POST",
        f"/v1/cartoon/scenes/{scene_id}/profile",
        user.id,
        {"profile": body.profile},
    )


@router.post("/shots/{shot_id}")
async def edit_shot(shot_id: str, body: ShotBody, user=Depends(get_verified_user)) -> dict[str, Any]:
    payload: dict[str, Any] = {"prompt": body.prompt}
    if body.transition_after is not None:
        payload["transition_after"] = body.transition_after
    if body.dialogue is not None:
        payload["dialogue"] = body.dialogue
    if body.speaker_id is not None:
        payload["speaker_id"] = body.speaker_id
    return await _forward("POST", f"/v1/cartoon/shots/{shot_id}", user.id, payload)


@router.post("/shots/{shot_id}/approve")
async def approve_shot(shot_id: str, user=Depends(get_verified_user)) -> dict[str, Any]:
    return await _forward("POST", f"/v1/cartoon/shots/{shot_id}/approve", user.id, {})


@router.post("/shots/{shot_id}/regen")
async def regen_shot(shot_id: str, user=Depends(get_verified_user)) -> dict[str, Any]:
    return await _forward("POST", f"/v1/cartoon/shots/{shot_id}/regen", user.id, {})


@router.post("/dialogue")
async def dialogue(body: DialogueBody, user=Depends(get_verified_user)) -> dict[str, Any]:
    return await _forward("POST", "/v1/cartoon/dialogue", user.id, body.model_dump() if hasattr(body, "model_dump") else body.dict())


@router.post("/scenes/{scene_id}/render")
async def render_scene(scene_id: str, body: RenderBody, user=Depends(get_verified_user)) -> dict[str, Any]:
    payload = body.model_dump() if hasattr(body, "model_dump") else body.dict()
    return await _forward("POST", f"/v1/cartoon/scenes/{scene_id}/render", user.id, payload)
