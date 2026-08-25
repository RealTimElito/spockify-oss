"""Lightweight coding workspace helpers (Wave 8.7).

MVP: build unified diffs from text, optional apply/branch under
WORKSPACE_GIT_ROOT, optional GitHub gist/PR stub when token present.
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.workspace")

WORKSPACE_GIT_ROOT = Path(os.getenv("WORKSPACE_GIT_ROOT", "").strip() or "")
GITHUB_TOKEN = (
    os.getenv("WORKSPACE_GITHUB_TOKEN") or os.getenv("GITHUB_TOKEN") or ""
).strip()


class DiffRequest(BaseModel):
    filename: str = "artifact.txt"
    content: str = ""
    old_content: str = ""
    message: str = "spockify workspace patch"


class ApplyPatchRequest(BaseModel):
    patch: str
    branch: Optional[str] = None
    commit_message: Optional[str] = None
    dry_run: bool = True


def content_to_unified_diff(
    *,
    filename: str,
    content: str,
    old_content: str = "",
) -> str:
    name = (filename or "artifact.txt").strip() or "artifact.txt"
    # Sanitize path segments.
    name = name.replace("..", "_").lstrip("/")
    old_lines = (old_content or "").splitlines()
    new_lines = (content or "").splitlines()
    import difflib

    diff = difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile=f"a/{name}",
        tofile=f"b/{name}",
        lineterm="",
    )
    body = "\n".join(diff)
    if not body.strip():
        # Still produce a create-file style patch when old is empty.
        if not old_content and content:
            lines = [f"+{ln}" for ln in new_lines]
            body = (
                f"--- /dev/null\n+++ b/{name}\n"
                f"@@ -0,0 +1,{len(new_lines)} @@\n" + "\n".join(lines)
            )
    return body + ("\n" if body and not body.endswith("\n") else "")


def workspace_status() -> dict[str, Any]:
    root_ok = bool(WORKSPACE_GIT_ROOT) and WORKSPACE_GIT_ROOT.is_dir()
    git_ok = False
    if root_ok:
        git_ok = (WORKSPACE_GIT_ROOT / ".git").is_dir()
    return {
        "git_root": str(WORKSPACE_GIT_ROOT) if WORKSPACE_GIT_ROOT else "",
        "git_root_ok": root_ok,
        "is_git_repo": git_ok,
        "github_token": bool(GITHUB_TOKEN),
        "note": (
            "Set WORKSPACE_GIT_ROOT to enable apply/branch; "
            "GITHUB_TOKEN optional for PR stub"
            if not root_ok
            else "workspace ready"
        ),
    }


def apply_patch(req: ApplyPatchRequest) -> dict[str, Any]:
    status = workspace_status()
    if not status["git_root_ok"]:
        return {
            "ok": False,
            "error": "WORKSPACE_GIT_ROOT not configured or missing",
            "status": status,
        }
    patch = req.patch or ""
    if not patch.strip():
        return {"ok": False, "error": "empty patch"}
    root = WORKSPACE_GIT_ROOT
    try:
        if req.branch:
            # Create/switch branch (best-effort).
            subprocess.run(
                ["git", "checkout", "-B", req.branch],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
        check = subprocess.run(
            ["git", "apply", "--check", "-"],
            cwd=root,
            input=patch,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if check.returncode != 0:
            return {
                "ok": False,
                "error": check.stderr.strip() or check.stdout.strip() or "patch check failed",
                "dry_run": req.dry_run,
            }
        if req.dry_run:
            return {"ok": True, "dry_run": True, "message": "patch applies cleanly"}
        apply = subprocess.run(
            ["git", "apply", "-"],
            cwd=root,
            input=patch,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if apply.returncode != 0:
            return {
                "ok": False,
                "error": apply.stderr.strip() or "apply failed",
                "dry_run": False,
            }
        if req.commit_message and status["is_git_repo"]:
            subprocess.run(["git", "add", "-A"], cwd=root, check=False, timeout=30)
            subprocess.run(
                ["git", "commit", "-m", req.commit_message],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
        return {"ok": True, "dry_run": False, "branch": req.branch, "message": "applied"}
    except Exception as exc:  # noqa: BLE001
        LOG.warning("apply_patch failed: %s", exc)
        return {"ok": False, "error": str(exc)}
