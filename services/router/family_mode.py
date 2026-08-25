"""Family / guest mode caps (Wave 9.8).

Scoped roles with limited models, daily token caps, and no admin tools.
Config under FAMILY_MODE_DIR; enforcement helpers for router + OWUI.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.family")

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/var/lib/spockify"))
FAMILY_MODE_DIR = Path(os.getenv("FAMILY_MODE_DIR", str(STORAGE_ROOT / "family-mode")))
FAMILY_MODE_ENABLED = os.getenv("FAMILY_MODE_ENABLED", "0").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
FAMILY_ALLOWED_MODELS = [
    m.strip()
    for m in os.getenv(
        "FAMILY_ALLOWED_MODELS", "spockify-auto,llama3.2-3b,gemma4-12b"
    ).split(",")
    if m.strip()
]
FAMILY_TOKEN_CAP = int(os.getenv("FAMILY_TOKEN_CAP", "200000"))
FAMILY_GUEST_TOKEN_CAP = int(os.getenv("FAMILY_GUEST_TOKEN_CAP", "50000"))
FAMILY_BLOCKED_TOOLS = [
    t.strip()
    for t in os.getenv(
        "FAMILY_BLOCKED_TOOLS", "admin,pipelines,databases,workspace_apply"
    ).split(",")
    if t.strip()
]


class FamilyModeConfig(BaseModel):
    enabled: bool = False
    allowed_models: list[str] = Field(default_factory=lambda: list(FAMILY_ALLOWED_MODELS))
    family_token_cap: int = FAMILY_TOKEN_CAP
    guest_token_cap: int = FAMILY_GUEST_TOKEN_CAP
    blocked_tools: list[str] = Field(default_factory=lambda: list(FAMILY_BLOCKED_TOOLS))
    notes: str = (
        "guest/family roles: limited models + daily token caps; no admin tools."
    )


def _ensure_dir() -> Path:
    FAMILY_MODE_DIR.mkdir(parents=True, exist_ok=True)
    return FAMILY_MODE_DIR


def _config_path() -> Path:
    return _ensure_dir() / "config.json"


def _usage_path() -> Path:
    return _ensure_dir() / "usage.json"


def load_config() -> FamilyModeConfig:
    path = _config_path()
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return FamilyModeConfig.model_validate(data)
        except Exception as exc:  # noqa: BLE001
            LOG.warning("family config load failed: %s", exc)
    cfg = FamilyModeConfig(enabled=FAMILY_MODE_ENABLED)
    return cfg


def save_config(cfg: FamilyModeConfig) -> FamilyModeConfig:
    _config_path().write_text(cfg.model_dump_json(indent=2), encoding="utf-8")
    return cfg


def _load_usage() -> dict[str, Any]:
    path = _usage_path()
    if not path.is_file():
        return {"day": str(date.today()), "users": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"day": str(date.today()), "users": {}}
    if data.get("day") != str(date.today()):
        return {"day": str(date.today()), "users": {}}
    return data


def _save_usage(data: dict[str, Any]) -> None:
    _usage_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def record_tokens(user_id: str, tokens: int) -> dict[str, Any]:
    data = _load_usage()
    users = data.setdefault("users", {})
    slot = users.setdefault(user_id, {"tokens": 0})
    slot["tokens"] = int(slot.get("tokens") or 0) + max(0, int(tokens))
    _save_usage(data)
    return slot


def get_usage(user_id: str) -> int:
    data = _load_usage()
    return int(((data.get("users") or {}).get(user_id) or {}).get("tokens") or 0)


def is_scoped_role(role: Optional[str]) -> bool:
    return (role or "").lower() in ("guest", "family")


def token_cap_for(role: Optional[str], cfg: Optional[FamilyModeConfig] = None) -> int:
    cfg = cfg or load_config()
    r = (role or "").lower()
    if r == "guest":
        return cfg.guest_token_cap
    if r == "family":
        return cfg.family_token_cap
    return 0


def check_access(
    *,
    role: Optional[str],
    user_id: str,
    model: Optional[str] = None,
    tool: Optional[str] = None,
) -> tuple[bool, str]:
    """Return (ok, reason). Admins/users unrestricted unless role is guest/family."""
    cfg = load_config()
    if not cfg.enabled or not is_scoped_role(role):
        return True, ""
    r = (role or "").lower()
    if tool and tool.lower() in {t.lower() for t in cfg.blocked_tools}:
        return False, f"tool '{tool}' blocked for {r} role"
    if tool and tool.lower() in ("admin", "settings"):
        return False, f"admin tools blocked for {r} role"
    if model:
        allowed = {m.lower() for m in cfg.allowed_models}
        # Allow bare names and litellm prefixes.
        m = (model or "").lower()
        short = m.split("/")[-1]
        if m not in allowed and short not in allowed:
            return False, f"model '{model}' not allowed for {r} role"
    used = get_usage(user_id)
    cap = token_cap_for(r, cfg)
    if cap and used >= cap:
        return False, f"daily token cap reached ({used}/{cap}) for {r}"
    return True, ""


def filter_models(models: list[str], role: Optional[str]) -> list[str]:
    cfg = load_config()
    if not cfg.enabled or not is_scoped_role(role):
        return models
    allowed = {m.lower() for m in cfg.allowed_models}
    out = []
    for m in models:
        short = m.split("/")[-1].lower()
        if m.lower() in allowed or short in allowed:
            out.append(m)
    return out


def family_status() -> dict[str, Any]:
    cfg = load_config()
    usage = _load_usage()
    return {
        "enabled": cfg.enabled,
        "allowed_models": cfg.allowed_models,
        "family_token_cap": cfg.family_token_cap,
        "guest_token_cap": cfg.guest_token_cap,
        "blocked_tools": cfg.blocked_tools,
        "usage_day": usage.get("day"),
        "users_tracked": len(usage.get("users") or {}),
        "notes": cfg.notes,
        "checked_at": datetime.now(tz=timezone.utc).isoformat(),
    }
