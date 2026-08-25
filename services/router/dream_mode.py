"""Dream mode — overnight insight + draft patches (Wave 10.8).

Re-reads memory digests / project notes and proposes breakfast-ready insights
and draft unified diffs. Reuses scheduled-agents pattern at the API level.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.dream")

_STORAGE = Path(os.getenv("STORAGE_ROOT", "/tmp/spockify"))
DREAM_DIR = Path(os.getenv("DREAM_DIR", str(_STORAGE / "dream")))
MEMORY_DIR = Path(
    os.getenv("MEMORY_DIGESTS_DIR", str(_STORAGE / "memory-digests"))
)
PROJECTS_HINT = Path(os.getenv("DREAM_PROJECTS_DIR", str(_STORAGE / "projects")))


class DreamRunRequest(BaseModel):
    user_id: Optional[str] = None
    focus: str = ""
    max_insights: int = 5
    invent_patch: bool = True


def _ensure_dir() -> Path:
    DREAM_DIR.mkdir(parents=True, exist_ok=True)
    (DREAM_DIR / "runs").mkdir(parents=True, exist_ok=True)
    return DREAM_DIR


def _read_snippets(limit: int = 8) -> list[str]:
    snippets: list[str] = []
    for root in (MEMORY_DIR, PROJECTS_HINT, _STORAGE / "skills"):
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in (".md", ".txt", ".json", ".skill.json"):
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")[:1200]
            except OSError:
                continue
            if text.strip():
                snippets.append(f"[{path.name}] {text.strip()[:400]}")
            if len(snippets) >= limit:
                return snippets
    return snippets


def _draft_patch(focus: str) -> str:
    name = "dream_insight.md"
    body = (
        f"# Dream insight\n\nFocus: {focus or 'general'}\n\n"
        "- Review overnight notes.\n"
        "- Promote one insight into a Project task.\n"
    )
    lines = body.splitlines()
    return (
        f"--- /dev/null\n+++ b/{name}\n"
        f"@@ -0,0 +1,{len(lines)} @@\n"
        + "\n".join(f"+{ln}" for ln in lines)
        + "\n"
    )


def run_dream(req: DreamRunRequest) -> dict[str, Any]:
    _ensure_dir()
    snippets = _read_snippets()
    insights: list[str] = []
    if snippets:
        for i, snip in enumerate(snippets[: req.max_insights]):
            insights.append(
                f"Insight {i + 1}: Revisit material — {snip[:180].replace(chr(10), ' ')}"
            )
    else:
        insights = [
            "Insight 1: No memory/project digests found yet — seed Projects or wait for Wave 6 digests.",
            "Insight 2: Schedule this dream job via Automations (morning RRULE) like Wave 9 briefing.",
            f"Insight 3: Focus hint was '{req.focus or 'none'}' — add notes overnight for richer dreams.",
        ]
    if req.focus:
        insights.insert(
            0,
            f"Focus: {req.focus[:200]} — prioritize related memory hits at breakfast.",
        )
    insights = insights[: max(1, req.max_insights)]

    run_id = uuid.uuid4().hex[:12]
    patches: list[dict[str, str]] = []
    if req.invent_patch:
        patch = _draft_patch(req.focus)
        patch_path = DREAM_DIR / "runs" / f"{run_id}.patch"
        patch_path.write_text(patch, encoding="utf-8")
        patches.append({"filename": "dream_insight.md", "path": str(patch_path), "patch": patch})

    run = {
        "id": run_id,
        "user_id": req.user_id,
        "focus": req.focus,
        "insights": insights,
        "patches": patches,
        "snippet_count": len(snippets),
        "created_at": time.time(),
        "status": "ready",
        "note": (
            "Dream MVP: heuristic insights from on-disk digests/skills. "
            "Wire to SpockifyScheduledAgents overnight for breakfast delivery."
        ),
    }
    (DREAM_DIR / "runs" / f"{run_id}.json").write_text(
        json.dumps(run, indent=2), encoding="utf-8"
    )
    return run


def list_dreams(limit: int = 20, user_id: Optional[str] = None) -> list[dict[str, Any]]:
    root = _ensure_dir() / "runs"
    out: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if user_id and str(row.get("user_id") or "") not in ("", str(user_id)):
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return out


def get_dream(run_id: str) -> Optional[dict[str, Any]]:
    path = _ensure_dir() / "runs" / f"{run_id}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
