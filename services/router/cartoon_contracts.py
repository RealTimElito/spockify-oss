"""Cartoon production contracts that do not schedule GPU work.

Rights, frame geometry, scrubbed policy fixtures, and feasibility sheets.
Commercial export stays fail-closed until a signed clearance exists.
This module does not call Comfy, Ollama, or a weight store.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, Optional

PRIVATE_TOKEN_RE = re.compile(
    r"data\.local|158\.174\.132\.155|192\.168\.|/var/lib/spockify/workspace|"
    r"Spockify|tankesmedjansweden\.com",
    re.IGNORECASE,
)

LICENSE_RESEARCH_ONLY = "RESEARCH_ONLY"
LICENSE_UNCLASSIFIED = "UNCLASSIFIED"
LICENSE_NOT_AVAILABLE = "NOT_AVAILABLE"
RIGHTS_UNSIGNED = "UNSIGNED"
INSTALLED_UNVERIFIED = "UNVERIFIED"

# Published-license classification cited by Cartoon Production Blueprint v1
# §4.1 and references R2/R3. The license files were not re-downloaded and
# counsel has not signed this record.
_CLASSIFICATION_BASIS = (
    "blueprint_v1_2026-11-16_R2_R3_not_refetched_not_counsel_signed"
)


def _record(
    *,
    registry_id: str,
    declared_use: str,
    license_scope: str,
    restrictions: str,
    upstream_source: str = "",
    license_name: str = "",
    license_url: str = "",
    commercial_ready: bool = False,
    installed: str = INSTALLED_UNVERIFIED,
    technical_ready: str = "UNVERIFIED",
) -> dict[str, Any]:
    return {
        "registry_id": registry_id,
        "upstream_source": upstream_source,
        "weight_sha256": None,
        "license_name": license_name,
        "license_url": license_url,
        "license_text_digest": None,
        "declared_use": declared_use,
        "restrictions": restrictions,
        "approved_deployment_scopes": (
            ["research"] if license_scope == LICENSE_RESEARCH_ONLY else []
        ),
        "license_scope": license_scope,
        "commercial_ready": commercial_ready,
        "rights_approval": RIGHTS_UNSIGNED,
        "installed": installed,
        "technical_ready": technical_ready,
        "approval_owner": None,
        "approval_date": None,
        "classification_basis": _CLASSIFICATION_BASIS,
    }


def model_records() -> list[dict[str, Any]]:
    """Draft registry. Digests and install flags are intentionally empty."""
    return [
        _record(
            registry_id="qwen-image-2.1",
            upstream_source="https://github.com/QwenLM/Qwen-Image-2.1",
            license_name="Qwen Research License Agreement",
            license_url="https://github.com/QwenLM/Qwen-Image-2.1/blob/main/LICENSE",
            declared_use="still and reference-conditioned image",
            restrictions=(
                "Published terms cited by the blueprint grant non-commercial "
                "use and require a separate commercial license. Not counsel-signed."
            ),
            license_scope=LICENSE_RESEARCH_ONLY,
        ),
        _record(
            registry_id="coqui-xtts-v2",
            upstream_source="https://huggingface.co/coqui/XTTS-v2",
            license_name="Coqui Public Model License 1.0.0",
            license_url="https://huggingface.co/coqui/XTTS-v2/blob/v2.0.3/LICENSE.txt",
            declared_use="voice clone / speech synthesis",
            restrictions=(
                "Published CPML cited by the blueprint permits non-commercial "
                "use of the model and outputs. Do not clone a voice without "
                "permission. Not counsel-signed."
            ),
            license_scope=LICENSE_RESEARCH_ONLY,
        ),
        _record(
            registry_id="wan2.1-flf2v",
            declared_use="first/last-frame motion",
            restrictions="License text was not reviewed in this session.",
            license_scope=LICENSE_UNCLASSIFIED,
        ),
        _record(
            registry_id="wan2.1-vace-1.3b",
            declared_use="optional latent video restyle",
            restrictions="License text was not reviewed in this session.",
            license_scope=LICENSE_UNCLASSIFIED,
        ),
        _record(
            registry_id="wan2.2-i2v-a14b",
            declared_use="single-still image-to-video",
            restrictions="License text was not reviewed in this session.",
            license_scope=LICENSE_UNCLASSIFIED,
        ),
        _record(
            registry_id="illustrious-xl",
            declared_use="Open Jealousy stills; not the default cartoon cel path",
            restrictions=(
                "Exact weight license was not reviewed. Do not treat adapters "
                "as cleared."
            ),
            license_scope=LICENSE_UNCLASSIFIED,
        ),
        _record(
            registry_id="latentsync",
            declared_use="experimental lip sync on supported faces only",
            restrictions=(
                "Morphology compatibility on cartoon faces is untested. "
                "License text was not reviewed in this session."
            ),
            license_scope=LICENSE_UNCLASSIFIED,
        ),
        _record(
            registry_id="minimax-h3",
            declared_use="optional atmosphere / scratch, not dialogue mouths",
            restrictions="License text was not reviewed in this session.",
            license_scope=LICENSE_UNCLASSIFIED,
        ),
        _record(
            registry_id="qwen-video-edit",
            declared_use="instruction video edit",
            restrictions="Not installed. Do not delete other checkpoints to make room.",
            license_scope=LICENSE_NOT_AVAILABLE,
            installed="NOT_AVAILABLE",
            technical_ready="NOT_AVAILABLE",
        ),
    ]


def model_registry_draft() -> dict[str, Any]:
    return {
        "object": "spockify.cartoon.model_registry_draft",
        "status": "DRAFT_UNSIGNED",
        "commercial_export": False,
        "weight_digests": "not_captured",
        "production_disk_scan": "not_run",
        "models": model_records(),
    }


def policy_rights_block() -> dict[str, Any]:
    """Server-side rights view. commercial_export is hard-false."""
    return {
        "commercial_export": False,
        "fail_closed": True,
        "reason_codes": [
            "license_unsigned",
            "qwen-image-2.1:RESEARCH_ONLY",
            "xtts-v2:RESEARCH_ONLY",
            "weights_digest_unverified",
            "unclassified_checkpoints_blocked",
        ],
        "models": [
            {
                "id": row["registry_id"],
                "license_scope": row["license_scope"],
                "commercial_ready": False,
                "rights_approval": row["rights_approval"],
                "installed": row["installed"],
            }
            for row in model_records()
        ],
    }


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in {"", "0", "false", "no", "off"}:
        return False
    if text in {"1", "true", "yes", "on"}:
        return True
    raise ValueError("commercial_export must be a boolean")


def commercial_block_reason(flag: bool) -> Optional[str]:
    if not flag:
        return None
    return (
        "commercial_export refused: reason=license_commercial_blocked. "
        "Qwen-Image-2.1 and XTTS-v2 are RESEARCH_ONLY / COMMERCIAL_BLOCKED "
        "until a signed clearance or a license-cleared substitute. "
        "Unclassified checkpoints also block commercial export."
    )


def map_wan_flf_frames(
    requested_seconds: float,
    fps_num: int = 16,
    fps_den: int = 1,
) -> dict[str, Any]:
    """Map a requested duration onto Wan's 4n+1 frame count.

    Matches ``video_gen.snap_length`` for ``wan2.1-flf2v`` / VACE.
    ``sample_span_seconds`` is frames/fps, not a probed container duration
    and not a measured GPU render.
    """
    sec = float(requested_seconds)
    if fps_num <= 0 or fps_den <= 0:
        raise ValueError("fps_num and fps_den must be positive")
    if sec <= 0:
        raise ValueError("requested_seconds must be positive")
    rate = fps_num / float(fps_den)
    raw = max(5, int(round(sec * rate)))
    frames = raw + (1 - (raw % 4)) % 4
    sample_span = frames * fps_den / float(fps_num)
    return {
        "rule": "4n+1",
        "model": "wan2.1-flf2v",
        "requested_seconds": sec,
        "fps_num": int(fps_num),
        "fps_den": int(fps_den),
        "frames": int(frames),
        "sample_span_seconds": sample_span,
        "requested_seconds_exact": sample_span == sec,
        "gpu_measured": False,
    }


def frame_contract_public() -> dict[str, Any]:
    return {
        "status": "CPU_CONTRACT_ONLY",
        "gpu_measured": False,
        "default_profile": map_wan_flf_frames(2, fps_num=16, fps_den=1),
        "note": (
            "Maps requested seconds to a 4n+1 frame count and the sample span. "
            "Not a measured render and not a container-duration guarantee."
        ),
    }


def planning_budgets() -> dict[str, Any]:
    """Roadmap order-of-magnitude numbers. Not measurements and not SLOs."""
    return {
        "object": "spockify.cartoon.planning_budgets",
        "status": "UNVERIFIED",
        "measured": False,
        "source": "CARTOON_PIPELINE_ROADMAP.md order-of-magnitude notes",
        "entries": [
            {"stage": "sprite_grid", "warm_hint": "30-90s", "measured": False},
            {"stage": "slice", "warm_hint": "<2s", "measured": False},
            {"stage": "flf_2s_720p", "warm_hint": "2-8min", "measured": False},
            {"stage": "vace", "warm_hint": "1-5min", "measured": False},
            {"stage": "latentsync_short", "warm_hint": "1-4min", "measured": False},
            {"stage": "timeline_mux", "warm_hint": "<30s", "measured": False},
        ],
    }


def scrub_policy(policy: dict[str, Any]) -> dict[str, Any]:
    """Drop private tokens and absolute install paths from a policy snapshot."""

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            cleaned: dict[str, Any] = {}
            for key, value in node.items():
                if key == "installed_files" and isinstance(value, list):
                    cleaned[key] = [Path(str(item)).name for item in value]
                else:
                    cleaned[key] = walk(value)
            return cleaned
        if isinstance(node, list):
            return [walk(item) for item in node]
        if isinstance(node, str):
            return PRIVATE_TOKEN_RE.sub("[redacted]", node)
        return node

    cleaned = walk(policy)
    cleaned["fixture"] = {
        "kind": "cold_policy_schema",
        "gpu": False,
        "comfy_object_info": False,
        "production_weight_digests": "not_captured",
    }
    return cleaned


def contains_private_token(text: str) -> bool:
    return PRIVATE_TOKEN_RE.search(text) is not None


IDENTITY_ANGLES: tuple[str, ...] = (
    "front",
    "three_quarter_left",
    "three_quarter_right",
    "profile_left",
    "profile_right",
    "back",
    "high_angle",
    "low_angle",
    "close_up",
    "full_body",
)

LIPSYNC_ARCHETYPES: tuple[str, ...] = (
    "static_talking_head",
    "three_quarter",
    "profile",
    "animal_muzzle",
    "small_face",
    "occlusion",
    "turning_head",
    "two_speaker",
)


def identity_feasibility_sheet() -> dict[str, Any]:
    """C-006 scaffold. No scores until a scheduled GPU study exists."""
    return {
        "ticket": "C-006",
        "object": "spockify.cartoon.identity_feasibility",
        "status": "PLANNED",
        "gpu_executed": False,
        "scores_recorded": False,
        "angles": [
            {"id": angle, "status": "UNTESTED", "seeds": [], "score": None}
            for angle in IDENTITY_ANGLES
        ],
        "acceptance": (
            "Blind scorecard, clips, seeds, and reference manifests are "
            "required before any pass claim."
        ),
    }


def lipsync_feasibility_matrix() -> dict[str, Any]:
    """C-007 scaffold. Cartoon mouth compatibility is unproven."""
    return {
        "ticket": "C-007",
        "object": "spockify.cartoon.lipsync_matrix",
        "status": "PLANNED",
        "gpu_executed": False,
        "fallback_decision": "OPEN",
        "market_lip_sync": False,
        "archetypes": [
            {
                "id": name,
                "status": "UNTESTED",
                "detector": None,
                "fallback": None,
            }
            for name in LIPSYNC_ARCHETYPES
        ],
        "note": (
            "LatentSync on stylized, animal, profile, and occluded mouths "
            "is a failure domain. Narration-only and viseme rigs stay open. "
            "This sheet is not an implementation of either path."
        ),
    }


def idempotency_key(*parts: str) -> str:
    material = "\x1f".join(parts)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
