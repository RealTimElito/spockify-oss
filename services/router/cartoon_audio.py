"""Dialogue plan for cartoon shots. CPU-only. Does not call XTTS or LatentSync.

The human-mouth class is an engineering default, not a quality pass and not a license.
"""

from __future__ import annotations

from typing import Any, Optional

DEFAULT_CHARACTER_CLASS = "cel_human"
DEFAULT_CHARACTER_LABEL = "simple human-mouth cartoon character"
HUMAN_MOUTH_CLASSES = frozenset({DEFAULT_CHARACTER_CLASS})
NONHUMAN_CLASSES = frozenset({"nonhuman"})
KNOWN_CLASSES = HUMAN_MOUTH_CLASSES | NONHUMAN_CLASSES


class DialoguePlanError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def normalize_class(character_class: Optional[str]) -> str:
    text = (character_class or "").strip() or DEFAULT_CHARACTER_CLASS
    if text not in KNOWN_CLASSES:
        raise DialoguePlanError(
            "character_class must be cel_human or nonhuman",
            400,
        )
    return text


def dialogue_plan(
    *,
    text: str,
    character_class: Optional[str] = None,
    lip_sync: Optional[bool] = None,
    speaker_id: str = "doc",
) -> dict[str, Any]:
    """Return the existing speech/lipsync/mux request without executing it.

    lip_sync defaults to true. Human mouths name the LatentSync path.
    lip_sync false is a bare mux. Nonhuman mouths are narration, or blocked
    when lip sync was requested. production_ready stays false.
    """
    spoken = (text or "").strip()
    if not spoken:
        raise DialoguePlanError("text is required", 400)
    if len(spoken) > 4000:
        raise DialoguePlanError("text exceeds admission limit", 400)
    speaker = (speaker_id or "").strip() or "doc"
    if len(speaker) > 80:
        raise DialoguePlanError("speaker_id exceeds admission limit", 400)

    mouth = normalize_class(character_class)
    want_lips = True if lip_sync is None else bool(lip_sync)
    label = (
        DEFAULT_CHARACTER_LABEL
        if mouth == DEFAULT_CHARACTER_CLASS
        else "nonhuman mouth (not a LatentSync claim)"
    )

    if mouth in HUMAN_MOUTH_CLASSES and want_lips:
        mode = "latentsync"
        reason = "wired_to_xtts_latentsync_not_executed"
        routes = {
            "speech": "/v1/audio/speech",
            "lipsync": "/v1/videos/lipsync",
        }
        request: Optional[dict[str, Any]] = {
            "speech": {"text": spoken, "speaker_id": speaker},
            "lipsync": {"lip_sync": True},
        }
    elif mouth in HUMAN_MOUTH_CLASSES:
        mode = "mux"
        reason = "lip_sync_false_bare_mux"
        routes = {
            "speech": "/v1/audio/speech",
            "mux": "/v1/series/mux",
        }
        request = {
            "speech": {"text": spoken, "speaker_id": speaker},
            "mux": {"lip_sync": False},
        }
    elif want_lips:
        mode = "blocked"
        reason = "nonhuman_mouth_unsupported_for_latentsync"
        routes = {}
        request = None
    else:
        mode = "narration"
        reason = "nonhuman_mouth_narration_only"
        routes = {"speech": "/v1/audio/speech"}
        request = {
            "speech": {"text": spoken, "speaker_id": speaker},
            "narration": True,
        }

    plan = {
        "schema_version": "cartoon-director/1",
        "character_class": mouth,
        "character_label": label,
        "reversible_default": mouth == DEFAULT_CHARACTER_CLASS,
        "lipsync_mode": mode,
        "lip_sync": mode == "latentsync",
        "production_ready": False,
        "gpu_executed": False,
        "timing": "not_estimated",
        "counsel_signed": False,
        "commercial_use": False,
        "commercial_export": False,
        "routes": routes,
        "request": request,
        "reason": reason,
    }
    if mode == "blocked":
        raise DialoguePlanError(reason, 422)
    return plan
