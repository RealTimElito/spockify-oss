"""Cursor-style skill / prompt packs for Spockify (Wave 9.4).

Scans SKILLS_PACKS_DIR (and optional project subfolders) for SKILL.md or
*.skill.json. Router injects selected pack bodies into system context.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.skills")

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/var/lib/spockify"))
SKILLS_PACKS_DIR = Path(os.getenv("SKILLS_PACKS_DIR", str(STORAGE_ROOT / "skills")))
SKILL_MAX_CHARS = int(os.getenv("SKILL_MAX_CHARS", "12000"))


class SkillPackMeta(BaseModel):
    id: str
    name: str
    description: str = ""
    path: str = ""
    source: str = "file"  # file | json
    chars: int = 0


class SkillAttachRequest(BaseModel):
    skill_ids: list[str] = Field(default_factory=list)


def _ensure_dir() -> Path:
    SKILLS_PACKS_DIR.mkdir(parents=True, exist_ok=True)
    return SKILLS_PACKS_DIR


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", (name or "").strip().lower()).strip("-")
    return s[:64] or "skill"


def _read_skill_md(path: Path) -> tuple[str, str, str]:
    """Return (name, description, body)."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    name = path.parent.name if path.name.upper() == "SKILL.MD" else path.stem
    description = ""
    body = raw
    # Optional YAML frontmatter
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            fm = parts[1]
            body = parts[2].lstrip("\n")
            for line in fm.splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    k = k.strip().lower()
                    v = v.strip().strip("\"'")
                    if k in ("name", "title"):
                        name = v or name
                    elif k in ("description", "desc"):
                        description = v
    if len(body) > SKILL_MAX_CHARS:
        body = body[: SKILL_MAX_CHARS - 1] + "…"
    return name, description, body


def _read_skill_json(path: Path) -> tuple[str, str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    name = str(data.get("name") or path.stem)
    description = str(data.get("description") or "")
    body = str(data.get("body") or data.get("prompt") or data.get("content") or "")
    if len(body) > SKILL_MAX_CHARS:
        body = body[: SKILL_MAX_CHARS - 1] + "…"
    return name, description, body


def discover_packs(extra_roots: Optional[list[Path]] = None) -> list[SkillPackMeta]:
    roots = [_ensure_dir()]
    if extra_roots:
        roots.extend(extra_roots)
    found: dict[str, SkillPackMeta] = {}
    for root in roots:
        if not root.is_dir():
            continue
        # SKILL.md in subdirs (Cursor-style)
        for skill_md in root.rglob("SKILL.md"):
            try:
                name, desc, body = _read_skill_md(skill_md)
                sid = _slug(f"{skill_md.parent.name}-{name}")
                found[sid] = SkillPackMeta(
                    id=sid,
                    name=name,
                    description=desc,
                    path=str(skill_md),
                    source="file",
                    chars=len(body),
                )
            except Exception as exc:  # noqa: BLE001
                LOG.warning("skill md read failed %s: %s", skill_md, exc)
        for skill_md in root.rglob("skill.md"):
            if skill_md.name == "SKILL.md":
                continue
            try:
                name, desc, body = _read_skill_md(skill_md)
                sid = _slug(f"{skill_md.parent.name}-{name}")
                found[sid] = SkillPackMeta(
                    id=sid,
                    name=name,
                    description=desc,
                    path=str(skill_md),
                    source="file",
                    chars=len(body),
                )
            except Exception as exc:  # noqa: BLE001
                LOG.warning("skill md read failed %s: %s", skill_md, exc)
        for jf in root.rglob("*.skill.json"):
            try:
                name, desc, body = _read_skill_json(jf)
                sid = _slug(jf.stem.replace(".skill", "") or name)
                found[sid] = SkillPackMeta(
                    id=sid,
                    name=name,
                    description=desc,
                    path=str(jf),
                    source="json",
                    chars=len(body),
                )
            except Exception as exc:  # noqa: BLE001
                LOG.warning("skill json read failed %s: %s", jf, exc)
    return sorted(found.values(), key=lambda p: p.name.lower())


def load_pack_body(skill_id: str) -> Optional[str]:
    for pack in discover_packs():
        if pack.id != skill_id:
            continue
        path = Path(pack.path)
        if not path.is_file():
            return None
        try:
            if path.suffix == ".json":
                _, _, body = _read_skill_json(path)
            else:
                _, _, body = _read_skill_md(path)
            return body
        except Exception as exc:  # noqa: BLE001
            LOG.warning("load pack %s failed: %s", skill_id, exc)
            return None
    return None


def inject_skills_system_message(skill_ids: list[str]) -> Optional[dict[str, str]]:
    """Build a system message for selected skill packs."""
    chunks: list[str] = []
    for sid in skill_ids or []:
        body = load_pack_body(sid)
        if not body:
            continue
        chunks.append(f"### Skill pack `{sid}`\n{body}")
    if not chunks:
        return None
    content = (
        "Spockify skill packs (follow these instructions for this chat):\n\n"
        + "\n\n".join(chunks)
    )
    if len(content) > SKILL_MAX_CHARS * 2:
        content = content[: SKILL_MAX_CHARS * 2 - 1] + "…"
    return {"role": "system", "content": content}


def skills_status() -> dict[str, Any]:
    packs = discover_packs()
    return {
        "dir": str(SKILLS_PACKS_DIR),
        "count": len(packs),
        "packs": [p.model_dump() for p in packs[:50]],
    }


def ensure_example_pack() -> None:
    """Drop a tiny example pack if the skills dir is empty."""
    root = _ensure_dir()
    if any(root.iterdir()):
        return
    example = root / "concise-answers"
    example.mkdir(parents=True, exist_ok=True)
    (example / "SKILL.md").write_text(
        "---\nname: Concise answers\ndescription: Prefer short, direct replies\n---\n"
        "Be concise. Prefer bullet points. Avoid fluff.\n",
        encoding="utf-8",
    )
