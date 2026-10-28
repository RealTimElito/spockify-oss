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


class SkillCreateRequest(BaseModel):
    """Create one drop-in pack. parameters is accepted only so it can be refused."""

    id: str
    title: str
    body: str
    category: str = ""
    tags: list[str] | str = ""
    replace: bool = False
    parameters: Any = None


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


# Format lock: packages/spockify-harness/src/skillFile.ts (writeDropInSkill).
# The router cannot import that package. Keep title/category/tags and the
# `<skills dir>/<id>/SKILL.md` path the same. Do not add a parameters schema.
SKILL_INDEX_NOTE = (
    "Indexed on the next skill list or search, or on the next session start."
)
_MAX_SKILL_BODY = 200_000


class SkillWriteError(ValueError):
    """Rejected skill id, body, or overwrite."""


def _one_line(value: str, label: str) -> str:
    text = re.sub(r"[\r\n]+", " ", value or "").strip()
    if not text:
        raise SkillWriteError(f"{label} is empty")
    return text


def assert_skill_id(raw: str) -> str:
    """Refuse path escape and a `.skill.md` filename."""
    skill_id = (raw or "").strip()
    if (
        not skill_id
        or skill_id in (".", "..")
        or ".." in skill_id
        or "/" in skill_id
        or "\\" in skill_id
        or any(ord(ch) < 32 for ch in skill_id)
        or any(ch.isspace() for ch in skill_id)
    ):
        raise SkillWriteError("id escapes the skills directory")
    lower = skill_id.lower()
    if ".skill.md" in lower or lower.endswith(".md") or lower == "skill.md":
        raise SkillWriteError(
            "refusing to write a .skill.md file; pass a plain id and this tool writes SKILL.md"
        )
    return skill_id


def _normalize_tags(tags: Any) -> list[str]:
    if tags is None:
        return []
    parts = tags if isinstance(tags, list) else str(tags).split(",")
    out: list[str] = []
    for part in parts:
        text = str(part).strip().strip("\"'")
        if not text or "\n" in text or "\r" in text:
            continue
        if text not in out:
            out.append(text)
    return out


def _ensure_heading(body: str, title: str) -> str:
    text = (body or "").lstrip("\ufeff").replace("\r\n", "\n")
    if re.search(r"(?m)^#{1,6}\s+\S", text):
        return text if text.endswith("\n") else text + "\n"
    trimmed = text.lstrip("\n")
    rest = trimmed if (not trimmed or trimmed.endswith("\n")) else trimmed + "\n"
    return f"# {title}\n\n{rest}"


def render_skill_markdown(
    *,
    title: str,
    body: str,
    category: str = "",
    tags: Any = None,
) -> str:
    """Frontmatter the loaders read: title, and category/tags only when set."""
    title_line = _one_line(title, "title")
    lines = ["---", f"title: {title_line}"]
    cat = re.sub(r"[\r\n]+", " ", category or "").strip()
    if cat:
        lines.append(f"category: {cat}")
    tag_list = _normalize_tags(tags)
    if tag_list:
        lines.append("tags: " + ", ".join(tag_list))
    lines.extend(["---", ""])
    return "\n".join(lines) + _ensure_heading(body, title_line)


def write_drop_in_skill(
    *,
    skills_dir: Path,
    skill_id: str,
    title: str,
    body: str,
    category: str = "",
    tags: Any = None,
    replace: bool = False,
    parameters: Any = None,
) -> dict[str, str]:
    """Write `<skills_dir>/<id>/SKILL.md` only. Does not touch a user workspace."""
    if parameters not in (None, "", {}, []):
        raise SkillWriteError(
            "refusing a parameters schema; skill files use title, category, and tags only"
        )
    if not isinstance(body, str) or "\x00" in body:
        raise SkillWriteError("body must be text")
    if len(body) > _MAX_SKILL_BODY:
        raise SkillWriteError("body is too large")
    if not body.strip():
        raise SkillWriteError("body is empty")
    sid = assert_skill_id(skill_id)
    markdown = render_skill_markdown(
        title=title, body=body, category=category, tags=tags
    )
    root = skills_dir.resolve()
    dest_dir = (root / sid).resolve()
    if dest_dir.parent != root:
        raise SkillWriteError("id escapes the skills directory")
    dest = dest_dir / "SKILL.md"
    if dest.is_file() and not replace:
        raise SkillWriteError(
            f"skill already exists: {dest} (pass replace=true to overwrite)"
        )
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest.write_text(markdown, encoding="utf-8")
    return {"path": str(dest), "note": SKILL_INDEX_NOTE}


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
