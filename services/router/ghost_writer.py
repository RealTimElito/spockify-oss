"""Ghost writer — per-user workspace + AI IDE helpers (Wave 10.6 / Ghost IDE).

Virtual workspace files live under GHOST_DIR/{user_id}/. API responses expose
workspace-relative paths only (never STORAGE_ROOT / server absolute paths).

Modes:
  - suggest: side-panel refactor / chat answer
  - complete: short inline/tab ghost text
  - edit: Cmd/Ctrl+K selection rewrite

local_only (or GHOST_WRITER_LOCAL_ONLY) skips remote LLM.
Guest/family roles: workspace writable for family; guests read-only + local AI.
"""

from __future__ import annotations

import io
import logging
import mimetypes
import os
import re
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from pydantic import BaseModel, Field

import ghost_fim

LOG = logging.getLogger("spockify.router.ghost")

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/var/lib/spockify"))
GHOST_DIR = Path(os.getenv("GHOST_DIR", str(STORAGE_ROOT / "ghost")))
GHOST_WRITER_LOCAL_ONLY = os.getenv(
    "GHOST_WRITER_LOCAL_ONLY", "0"
).lower() in ("1", "true", "yes", "on")
GHOST_MAX_FILE_BYTES = int(os.getenv("GHOST_MAX_FILE_BYTES", str(512 * 1024)))
GHOST_MAX_FILES = int(os.getenv("GHOST_MAX_FILES", "200"))
# Prefer prewarmed coding model (gpt-oss-20b) over on-demand codestral/spockify-coder.
GHOST_COMPLETE_MODEL = (
    os.getenv("GHOST_COMPLETE_MODEL", "gpt-oss-20b").strip() or "gpt-oss-20b"
)
GHOST_COMPLETE_MAX_TOKENS = int(os.getenv("GHOST_COMPLETE_MAX_TOKENS", "48"))
GHOST_COMPLETE_TEMPERATURE = float(os.getenv("GHOST_COMPLETE_TEMPERATURE", "0.05"))
# FIM window around cursor (+ optional file-head / open-tab hints in `context`).
GHOST_COMPLETE_PREFIX_CHARS = int(os.getenv("GHOST_COMPLETE_PREFIX_CHARS", "4000"))
GHOST_COMPLETE_SUFFIX_CHARS = int(os.getenv("GHOST_COMPLETE_SUFFIX_CHARS", "1200"))
GHOST_COMPLETE_CONTEXT_CHARS = int(os.getenv("GHOST_COMPLETE_CONTEXT_CHARS", "1200"))

WorkerChatFn = Callable[..., Awaitable[dict[str, Any]]]

_LANG_BY_EXT = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".svelte": "html",
    ".rs": "rust",
    ".go": "go",
    ".sh": "shell",
    ".bash": "shell",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "ini",
    ".sql": "sql",
    ".txt": "plaintext",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".java": "java",
    ".kt": "kotlin",
    ".rb": "ruby",
    ".php": "php",
}


class GhostSuggestRequest(BaseModel):
    code: str = ""
    language: str = "python"
    instruction: str = "Suggest a concise improvement or completion."
    local_only: bool = False
    cursor_line: Optional[int] = None
    filename: str = "untitled"
    mode: str = "suggest"  # suggest | complete | edit | chat
    selection: str = ""
    prefix: str = ""
    suffix: str = ""
    # Optional extras for complete: file-head imports, open tab names (not whole repo).
    context: str = ""
    role: Optional[str] = None
    # --- Tab protocol v2 (all optional; v1 clients simply omit them) ---
    request_id: Optional[str] = None  # client uuid; generated server-side if absent
    workspace_id: Optional[str] = None
    rel_path: Optional[str] = None
    cursor_col: Optional[int] = None
    diff_history: list[ghost_fim.GhostDiffHistoryEntry] = Field(
        default_factory=list
    )
    context_items: list[ghost_fim.GhostContextItem] = Field(default_factory=list)
    linter_errors: list[ghost_fim.GhostLinterError] = Field(default_factory=list)
    trigger: Optional[str] = None  # typing|line_change|manual|linter|editor_change


class WorkspaceWriteRequest(BaseModel):
    path: str
    content: str = ""


class WorkspaceMkdirRequest(BaseModel):
    path: str


class WorkspaceRenameRequest(BaseModel):
    from_path: str
    to_path: str


class WorkspaceDeleteRequest(BaseModel):
    path: str


def language_for_path(path: str) -> str:
    ext = Path(path or "").suffix.lower()
    return _LANG_BY_EXT.get(ext, "plaintext")


def _safe_user_id(user_id: str) -> str:
    raw = (user_id or "").strip()
    if not raw:
        raise ValueError("user_id required for ghost workspace")
    safe = "".join(c for c in raw if c.isalnum() or c in "-_.@")[:128]
    if not safe:
        raise ValueError("user_id invalid for ghost workspace")
    return safe


def _ensure_dir(path: Path, *, mode: int = 0o700) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, mode)
    except OSError:
        pass
    return path


def _user_root(user_id: str) -> Path:
    return _ensure_dir(GHOST_DIR / _safe_user_id(user_id))


def _normalize_rel(path: str) -> str:
    raw = (path or "").strip().replace("\\", "/")
    raw = raw.lstrip("/")
    if not raw or raw in (".",):
        return ""
    parts: list[str] = []
    for part in raw.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            raise ValueError("path traversal not allowed")
        if any(c in part for c in ("\x00",)):
            raise ValueError("invalid path character")
        parts.append(part[:180])
    return "/".join(parts)


def _resolve(user_id: str, rel: str) -> Path:
    root = _user_root(user_id).resolve()
    norm = _normalize_rel(rel)
    target = (root / norm).resolve() if norm else root
    if root != target and root not in target.parents:
        raise ValueError("path escapes workspace")
    return target


def _role_caps(role: Optional[str]) -> dict[str, Any]:
    r = (role or "").strip().lower()
    if r == "guest":
        return {
            "writable": False,
            "force_local_ai": True,
            "ai_allowed": True,
            "note": "Guest: workspace read-only; AI stays local-only.",
        }
    if r == "family":
        return {
            "writable": True,
            "force_local_ai": False,
            "ai_allowed": True,
            "note": "Family: workspace writable; remote AI subject to family caps.",
        }
    return {
        "writable": True,
        "force_local_ai": False,
        "ai_allowed": True,
        "note": "",
    }


def _public_node(rel: str, path: Path) -> dict[str, Any]:
    is_dir = path.is_dir()
    name = path.name if rel else "(workspace)"
    out: dict[str, Any] = {
        "path": rel,
        "name": name if rel else "/",
        "type": "dir" if is_dir else "file",
    }
    if not is_dir:
        try:
            out["size"] = path.stat().st_size
            out["mtime"] = int(path.stat().st_mtime)
        except OSError:
            out["size"] = 0
            out["mtime"] = 0
        out["language"] = language_for_path(rel)
    return out


def _walk_tree(user_id: str, limit: int = GHOST_MAX_FILES) -> list[dict[str, Any]]:
    root = _user_root(user_id)
    nodes: list[dict[str, Any]] = []
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        filenames.sort()
        base = Path(dirpath)
        rel_dir = str(base.relative_to(root)).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        for d in dirnames:
            if count >= limit:
                break
            rel = f"{rel_dir}/{d}" if rel_dir else d
            nodes.append(_public_node(rel, base / d))
            count += 1
        for f in filenames:
            if count >= limit:
                break
            rel = f"{rel_dir}/{f}" if rel_dir else f
            nodes.append(_public_node(rel, base / f))
            count += 1
        if count >= limit:
            break
    nodes.sort(key=lambda n: (0 if n["type"] == "dir" else 1, n["path"].lower()))
    return nodes


def workspace_list(user_id: str, *, role: Optional[str] = None) -> dict[str, Any]:
    caps = _role_caps(role)
    nodes = _walk_tree(user_id)
    return {
        "ok": True,
        "workspace": "My Ghost workspace",
        "writable": caps["writable"],
        "nodes": nodes,
        "count": len(nodes),
        "note": caps["note"] or "Private files under your account.",
    }


def workspace_read(user_id: str, path: str) -> dict[str, Any]:
    rel = _normalize_rel(path)
    if not rel:
        raise ValueError("path required")
    target = _resolve(user_id, rel)
    if not target.is_file():
        raise FileNotFoundError("file not found")
    size = target.stat().st_size
    if size > GHOST_MAX_FILE_BYTES:
        raise ValueError(f"file too large (max {GHOST_MAX_FILE_BYTES} bytes)")
    content = target.read_text(encoding="utf-8", errors="replace")
    return {
        "ok": True,
        "path": rel,
        "content": content,
        "language": language_for_path(rel),
        "size": size,
    }


def workspace_write(
    user_id: str,
    path: str,
    content: str,
    *,
    role: Optional[str] = None,
) -> dict[str, Any]:
    caps = _role_caps(role)
    if not caps["writable"]:
        raise PermissionError("workspace is read-only for this role")
    rel = _normalize_rel(path)
    if not rel:
        raise ValueError("path required")
    if len(content.encode("utf-8")) > GHOST_MAX_FILE_BYTES:
        raise ValueError(f"content too large (max {GHOST_MAX_FILE_BYTES} bytes)")
    existing = _walk_tree(user_id)
    target = _resolve(user_id, rel)
    if not target.exists() and len(existing) >= GHOST_MAX_FILES:
        raise ValueError(f"workspace file limit ({GHOST_MAX_FILES})")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass
    return {
        "ok": True,
        "path": rel,
        "language": language_for_path(rel),
        "size": target.stat().st_size,
    }


def workspace_mkdir(
    user_id: str,
    path: str,
    *,
    role: Optional[str] = None,
) -> dict[str, Any]:
    caps = _role_caps(role)
    if not caps["writable"]:
        raise PermissionError("workspace is read-only for this role")
    rel = _normalize_rel(path)
    if not rel:
        raise ValueError("path required")
    target = _resolve(user_id, rel)
    target.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": rel, "type": "dir"}


def workspace_rename(
    user_id: str,
    from_path: str,
    to_path: str,
    *,
    role: Optional[str] = None,
) -> dict[str, Any]:
    caps = _role_caps(role)
    if not caps["writable"]:
        raise PermissionError("workspace is read-only for this role")
    src_rel = _normalize_rel(from_path)
    dst_rel = _normalize_rel(to_path)
    if not src_rel or not dst_rel:
        raise ValueError("from_path and to_path required")
    src = _resolve(user_id, src_rel)
    dst = _resolve(user_id, dst_rel)
    if not src.exists():
        raise FileNotFoundError("source not found")
    if dst.exists():
        raise FileExistsError("destination already exists")
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return {"ok": True, "from_path": src_rel, "to_path": dst_rel}


def workspace_delete(
    user_id: str,
    path: str,
    *,
    role: Optional[str] = None,
) -> dict[str, Any]:
    caps = _role_caps(role)
    if not caps["writable"]:
        raise PermissionError("workspace is read-only for this role")
    rel = _normalize_rel(path)
    if not rel:
        raise ValueError("path required")
    target = _resolve(user_id, rel)
    if not target.exists():
        raise FileNotFoundError("not found")
    if target.is_dir():
        # Only empty dirs for safety.
        if any(target.iterdir()):
            raise ValueError("directory not empty")
        target.rmdir()
    else:
        target.unlink()
    return {"ok": True, "path": rel, "deleted": True}


def _safe_download_name(name: str, *, fallback: str = "download") -> str:
    raw = (name or "").strip().replace("\\", "/").split("/")[-1]
    safe = "".join(c for c in raw if c.isalnum() or c in "._- ")[:180].strip()
    return safe or fallback


def workspace_download_file(user_id: str, path: str) -> dict[str, Any]:
    """Bytes for a workspace file. Guests may download files they can read.

    Response never includes server absolute paths — only the workspace-relative
    path and basename for Content-Disposition.
    """
    rel = _normalize_rel(path)
    if not rel:
        raise ValueError("path required")
    target = _resolve(user_id, rel)
    if not target.is_file():
        raise FileNotFoundError("file not found")
    size = target.stat().st_size
    if size > GHOST_MAX_FILE_BYTES:
        raise ValueError(f"file too large (max {GHOST_MAX_FILE_BYTES} bytes)")
    data = target.read_bytes()
    filename = _safe_download_name(Path(rel).name, fallback="file")
    media_type, _ = mimetypes.guess_type(filename)
    return {
        "ok": True,
        "path": rel,
        "filename": filename,
        "media_type": media_type or "application/octet-stream",
        "content": data,
        "size": size,
    }


def workspace_download_zip(user_id: str) -> dict[str, Any]:
    """Zip the user's private Ghost workspace (relative paths only inside archive)."""
    root = _user_root(user_id).resolve()
    buf = io.BytesIO()
    added = 0
    total_bytes = 0
    max_zip_bytes = GHOST_MAX_FILE_BYTES * min(GHOST_MAX_FILES, 50)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames.sort()
            filenames.sort()
            base = Path(dirpath)
            for name in filenames:
                if added >= GHOST_MAX_FILES:
                    break
                full = base / name
                if not full.is_file():
                    continue
                try:
                    size = full.stat().st_size
                except OSError:
                    continue
                if size > GHOST_MAX_FILE_BYTES:
                    continue
                if total_bytes + size > max_zip_bytes:
                    break
                rel = str(full.relative_to(root)).replace("\\", "/")
                # Zip members must stay workspace-relative (no user_id / abs paths).
                zf.writestr(rel, full.read_bytes())
                added += 1
                total_bytes += size
            if added >= GHOST_MAX_FILES or total_bytes >= max_zip_bytes:
                break
        if added == 0:
            zf.writestr(
                "README.txt",
                "Empty Ghost workspace.\nCreate a file in the IDE, then download again.\n",
            )
    return {
        "ok": True,
        "filename": "ghost-workspace.zip",
        "media_type": "application/zip",
        "content": buf.getvalue(),
        "count": added,
    }


def seed_welcome_if_empty(user_id: str) -> None:
    """Create a welcome file when the workspace has never been used."""
    root = _user_root(user_id)
    if any(root.iterdir()):
        return
    welcome = root / "welcome.py"
    welcome.write_text(
        "# Ghost AI IDE\n"
        "# Your private workspace — files stay in your account.\n"
        "# Tip: start typing for tab completions; select code and press Ctrl/Cmd+K.\n\n"
        "def hello():\n"
        '    return "spockify"\n',
        encoding="utf-8",
    )
    try:
        os.chmod(welcome, 0o600)
    except OSError:
        pass


def _fast_complete_heuristic(req: GhostSuggestRequest) -> Optional[dict[str, Any]]:
    """High-confidence local inserts (no network). Used before LLM on remote path."""
    prefix = req.prefix or req.code or ""
    suffix = req.suffix or ""
    lang = (req.language or "text").lower()
    line = prefix.rsplit("\n", 1)[-1] if prefix else ""
    stripped = line.rstrip()
    after = suffix.split("\n", 1)[0] if suffix else ""

    # Missing trailing comma before next object key
    if (
        not after.strip()
        and not re.search(r",\s*$", stripped)
        and re.search(
            r":\s*(?:-?\d+(?:\.\d+)?|\"[^\"]*\"|'[^']*'|true|false|null|"
            r"[A-Za-z_][\w.]*)\s*$",
            stripped,
        )
    ):
        next_line = ""
        if suffix:
            m = re.match(r"\s*\n\s*(\S[^\n]*)", suffix)
            if m:
                next_line = m.group(1).strip()
        if next_line and (
            re.match(r"^[A-Za-z_$'\"`][\w$.'\"`-]*\s*:", next_line)
            or re.match(r"^['\"][^'\"]+['\"]\s*:", next_line)
        ):
            return _complete_local(",", "missing-comma")

    # Sequential numbers after `key: `
    key_await = re.match(
        r"^(\s*)([A-Za-z_$][\w$]*|[\"'][^\"']+[\"'])\s*:\s*$", line
    )
    if key_await and not after.strip():
        block = _nearest_object_block(prefix)
        if block:
            nums = [
                int(m.group(1))
                for m in re.finditer(
                    r":\s*(-?\d+)\s*,?\s*(?://[^\n]*)?$", block, re.M
                )
            ]
            if len(nums) >= 2:
                step = nums[-1] - nums[-2]
                if step != 0:
                    return _complete_local(str(nums[-1] + step), "seq-number")
            elif len(nums) == 1:
                return _complete_local(str(nums[0] + 1), "seq-number")

    # Close unbalanced brackets / quotes on this line when suffix is empty-ish
    if not after.strip():
        closer = _suggest_closer(stripped)
        if closer:
            return _complete_local(closer, "close-bracket")

    # High-confidence structural closers / starters only (avoid stealing LLM fills).
    if lang in ("python", "py", "python3"):
        if stripped.endswith("def ") or stripped == "def":
            return _complete_local("name():\n    pass", "py-def")
        if re.search(r"\bprint\s*\(\s*$", stripped):
            return _complete_local(")", "py-print")
    elif lang in (
        "typescript",
        "javascript",
        "typescriptreact",
        "javascriptreact",
        "ts",
        "js",
        "tsx",
        "jsx",
    ):
        if stripped.endswith("console.log("):
            return _complete_local(")", "js-log")

    return None


def _complete_local(insert: str, reason: str) -> dict[str, Any]:
    return {
        "ok": True,
        "suggestion": insert,
        "insert_text": insert,
        "mode": "local",
        "kind": "complete",
        "note": f"Local ghost completion ({reason}).",
        "latency_ms": 0,
        "reason": reason,
    }


def _suggest_closer(stripped: str) -> str:
    """Return closing chars for unbalanced openers on the line (high confidence)."""
    pairs = {"(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`"}
    stack: list[str] = []
    i = 0
    while i < len(stripped):
        ch = stripped[i]
        if ch == "\\" and i + 1 < len(stripped):
            i += 2
            continue
        if stack and stack[-1] in ("\"", "'", "`"):
            if ch == stack[-1]:
                stack.pop()
            i += 1
            continue
        if ch in ("\"", "'", "`"):
            stack.append(ch)
        elif ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            if stack and pairs.get(stack[-1]) == ch:
                stack.pop()
        i += 1
    if not stack:
        return ""
    # Only close simple trailing openers (avoid inventing whole blocks)
    closers = "".join(pairs[c] for c in reversed(stack) if c in pairs)
    if len(closers) > 4:
        return ""
    return closers


def _nearest_object_block(prefix: str) -> Optional[str]:
    depth = 0
    start = -1
    for i in range(len(prefix) - 1, -1, -1):
        ch = prefix[i]
        if ch == "}":
            depth += 1
        elif ch == "{":
            if depth == 0:
                start = i
                break
            depth -= 1
    if start < 0:
        return None
    return prefix[start:]


def _local_suggest(req: GhostSuggestRequest) -> dict[str, Any]:
    mode = (req.mode or "suggest").lower()
    code = req.code or ""
    lang = (req.language or "text").lower()
    selection = req.selection or ""

    if mode == "complete":
        fast = _fast_complete_heuristic(req)
        if fast:
            return fast
        # No placeholder ghosts (… / ;) — empty is better than noise.
        return {
            "ok": True,
            "suggestion": "",
            "insert_text": "",
            "mode": "local",
            "kind": "complete",
            "note": "Local ghost completion (no remote LLM / no heuristic match).",
            "latency_ms": 0,
        }

    if mode == "edit":
        base = selection or code
        tips = []
        if lang in ("python", "py"):
            tips.append(base.replace("pass", "raise NotImplementedError()") if "pass" in base else base)
            if tips[0] == base:
                tips[0] = f"# Edited locally\n{base}"
        else:
            tips.append(f"/* edited locally */\n{base}")
        return {
            "ok": True,
            "suggestion": tips[0],
            "mode": "local",
            "kind": "edit",
            "note": "Local edit MVP — enable remote AI for real rewrites.",
            "latency_ms": 0,
        }

    tips: list[str] = []
    if not code.strip() and not selection.strip():
        tips.append("// Start typing — Ghost will whisper completions here.")
    src = selection or code
    if lang in ("python", "py"):
        if "TODO" in src or "pass" in src:
            tips.append("# Consider replacing pass/TODO with a real implementation.")
        if "print(" in src and "logging" not in src:
            tips.append("# Prefer logging over print in library code.")
        if re.search(r"except\s*:", src):
            tips.append("# Avoid bare except; catch specific exceptions.")
        if "def " in src and '"""' not in src and "'''" not in src:
            tips.append("# Add a short docstring to public functions.")
    elif lang in ("typescript", "javascript", "ts", "js"):
        if "any" in src:
            tips.append("// Prefer a narrower type than any.")
        if "console.log" in src:
            tips.append("// Remove debug console.log before shipping.")
    elif lang in ("svelte", "html"):
        tips.append("<!-- Keep Ghost pane local-friendly; avoid leaking secrets. -->")

    if req.instruction and mode in ("chat", "suggest"):
        tips.append(f"// Re: {req.instruction[:120]}")

    if not tips:
        tips.append(
            f"// Ghost local MVP: no remote LLM. "
            f"File={req.filename}; lines={src.count(chr(10)) + 1}."
        )
    suggestion = "\n".join(tips)
    return {
        "ok": True,
        "suggestion": suggestion,
        "mode": "local",
        "kind": mode,
        "note": "Monaco AI IDE MVP — not a Void/VS Code fork. Set local_only=false for LLM.",
        "latency_ms": 0,
    }


async def _remote_chat(
    worker_chat: WorkerChatFn,
    *,
    system: str,
    user: str,
    model: str = "codestral",
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
) -> str:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    kwargs: dict[str, Any] = {}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if temperature is not None:
        kwargs["temperature"] = temperature
    result = await worker_chat(None, model, messages, **kwargs)
    text = ""
    if isinstance(result, dict):
        choices = result.get("choices") or []
        if choices:
            text = (
                choices[0].get("message", {}).get("content")
                or choices[0].get("text")
                or ""
            )
    return (text or "").strip()


def ensure_request_id(req: GhostSuggestRequest) -> str:
    """Return a valid uuid request id, generating one when absent/invalid."""
    rid = (req.request_id or "").strip()
    if rid:
        try:
            uuid.UUID(rid)
        except ValueError:
            rid = ""
    if not rid:
        rid = str(uuid.uuid4())
    req.request_id = rid
    return rid


def _cursor_line(req: GhostSuggestRequest) -> int:
    if req.cursor_line is not None:
        return int(req.cursor_line)
    return (req.prefix or req.code or "").count("\n")


def _finish_complete(
    req: GhostSuggestRequest,
    text: str,
    *,
    model: str,
    note: str,
    t0: float,
    confidence: Optional[float] = None,
) -> dict[str, Any]:
    """Tab v2 response for mode=complete (suppression applied server-side).

    Keeps the v1 mirrors (suggestion/kind/note) so old IDE builds — which read
    insert_text || suggestion and only log mode/kind — keep working.
    """
    rid = ensure_request_id(req)
    line = _cursor_line(req)
    rel_path = req.rel_path or req.filename or ""
    reason = ghost_fim.suppress_reason(
        text,
        suffix=req.suffix or "",
        diff_history=req.diff_history,
        workspace_id=req.workspace_id or "",
        rel_path=rel_path,
        line=line,
    )
    if reason:
        text = ""
        note = f"Suppressed ({reason})."
    elif text:
        # Track for the recently-rejected LRU (fed by /spockify/ghost/fate).
        ghost_fim.RECENT_REQUESTS.remember(
            rid,
            workspace_id=req.workspace_id or "",
            rel_path=rel_path,
            line=line,
            suggestion=text,
        )
    out: dict[str, Any] = {
        "ok": True,
        "request_id": rid,
        # v2: mode is insert|edit. Edit-prediction model not shipped yet, so
        # mode stays "insert"; the edit field is wired for when it exists.
        "mode": "insert",
        "insert_text": text,
        "edit": None,
        "model": model,
        "latency_ms": int((time.monotonic() - t0) * 1000),
        "suggestion": text,
        "kind": "complete",
        "note": note,
    }
    if confidence is not None:
        out["confidence"] = confidence
    if reason:
        out["suppress_reason"] = reason
    return out


async def _complete_via_chat(
    req: GhostSuggestRequest,
    worker_chat: WorkerChatFn,
    prefix: str,
    suffix: str,
    extra: str,
) -> str:
    """Legacy pseudo-FIM via chat prompting (gpt-oss) — last-resort fallback."""
    system = (
        "You are a fill-in-the-middle code completion engine. "
        "Return ONLY the exact text to insert between PREFIX and SUFFIX. "
        "No markdown, no fences, no quotes, no explanation. "
        "Use CONTEXT (imports / nearby tabs) only as hints. "
        "Prefer 1 line; at most 2–3 short lines. Stop early."
    )
    ctx_block = f"<CONTEXT>\n{extra}\n</CONTEXT>\n" if extra.strip() else ""
    user = (
        f"Language: {req.language}\nFilename: {req.filename}\n"
        f"{ctx_block}"
        f"<PREFIX>\n{prefix}\n</PREFIX>\n"
        f"<SUFFIX>\n{suffix}\n</SUFFIX>\n"
        "Insert:"
    )
    return await _remote_chat(
        worker_chat,
        system=system,
        user=user,
        model=GHOST_COMPLETE_MODEL,
        max_tokens=GHOST_COMPLETE_MAX_TOKENS,
        temperature=GHOST_COMPLETE_TEMPERATURE,
    )


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        lines = t.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        t = "\n".join(lines).strip()
    return t


async def suggest(
    req: GhostSuggestRequest,
    *,
    worker_chat: Optional[WorkerChatFn] = None,
) -> dict[str, Any]:
    t0 = time.monotonic()
    caps = _role_caps(req.role)
    mode = (req.mode or "suggest").lower()
    local = (
        req.local_only
        or GHOST_WRITER_LOCAL_ONLY
        or caps["force_local_ai"]
        or worker_chat is None
    )
    if local:
        out = _local_suggest(req)
        out["latency_ms"] = int((time.monotonic() - t0) * 1000)
        if caps["force_local_ai"]:
            out["note"] = (out.get("note") or "") + " (role capped to local AI)"
        if mode == "complete":
            return _finish_complete(
                req,
                out.get("insert_text") or "",
                model="local",
                note=out.get("note") or "",
                t0=t0,
                confidence=0.9 if out.get("insert_text") else None,
            )
        return out

    try:
        if mode == "complete":
            # Instant local heuristics before any LLM hop.
            fast = _fast_complete_heuristic(req)
            if fast:
                return _finish_complete(
                    req,
                    fast.get("insert_text") or "",
                    model="local",
                    note=fast.get("note") or "",
                    t0=t0,
                    confidence=0.9,
                )

            prefix = (req.prefix or req.code or "")[-GHOST_COMPLETE_PREFIX_CHARS:]
            suffix = (req.suffix or "")[:GHOST_COMPLETE_SUFFIX_CHARS]
            extra = (req.context or "")[:GHOST_COMPLETE_CONTEXT_CHARS]
            # Trim request mirrors so remote path matches FIM budgets.
            req.prefix = prefix
            req.suffix = suffix
            req.context = extra

            # v2 context (diff history / retrieval / linter) becomes commented
            # blocks placed before the FIM window, under strict char budgets.
            ctx_parts: list[str] = []
            v2_block = ghost_fim.build_context_block(
                req.language, req.diff_history, req.context_items,
                req.linter_errors,
            )
            if v2_block:
                ctx_parts.append(v2_block)
            if extra.strip():
                ctx_parts.append(
                    ghost_fim.commented_block(extra, req.language)
                )
            fim_prefix = "\n".join(ctx_parts + [prefix]) if ctx_parts else prefix

            text: Optional[str] = None
            model_used = GHOST_COMPLETE_MODEL
            note = ""
            for backend in ghost_fim.backend_chain():
                try:
                    if backend == "vllm":
                        text, model_used = await ghost_fim.complete_vllm(
                            fim_prefix,
                            suffix,
                            # Per-workspace LoRA when loaded (tab-{hash} / tab-seed).
                            workspace_id=req.workspace_id,
                        )
                    elif backend == "ollama":
                        text, model_used = (
                            await ghost_fim.complete_ollama_infill(
                                fim_prefix, suffix
                            )
                        )
                    else:  # chat — legacy pseudo-FIM, last resort
                        chat_ctx = "\n".join(
                            filter(None, [v2_block, extra])
                        )
                        text = await _complete_via_chat(
                            req, worker_chat, prefix, suffix, chat_ctx
                        )
                        model_used = GHOST_COMPLETE_MODEL
                    note = f"Inline completion ({model_used} via {backend})"
                    break
                except Exception as exc:  # noqa: BLE001 - cascade to next
                    LOG.warning(
                        "ghost fim backend %s failed: %s", backend, exc
                    )
            if text is None:
                text = ""
                note = "Completion backends unavailable"

            text = ghost_fim.strip_fim_artifacts(text)
            text = _strip_fences(text)
            # Cap completion length for snappy UX.
            if len(text) > 240:
                text = text[:240]
            # Drop accidental prefix echo
            if text and prefix and text.startswith(prefix[-min(40, len(prefix)) :]):
                echo = prefix[-min(40, len(prefix)) :]
                text = text[len(echo) :]
            if not text:
                LOG.info(
                    "ghost complete empty model=%s prefix_len=%s suffix_len=%s ctx_len=%s",
                    model_used,
                    len(prefix),
                    len(suffix),
                    len(extra),
                )
                note = note or f"Empty completion ({model_used})"
            return _finish_complete(
                req, text, model=model_used, note=note, t0=t0
            )

        if mode == "edit":
            selection = (req.selection or "")[:6000]
            system = (
                "You rewrite the selected code per the user instruction. "
                "Return ONLY the replacement code — no markdown fences, no preamble."
            )
            user = (
                f"Language: {req.language}\nFilename: {req.filename}\n"
                f"Instruction: {req.instruction or 'Improve this code.'}\n\n"
                f"SELECTION:\n{selection}\n"
            )
            text = await _remote_chat(worker_chat, system=system, user=user)
            text = _strip_fences(text)
            if not text:
                return _local_suggest(req)
            return {
                "ok": True,
                "suggestion": text[:8000],
                "mode": "remote",
                "kind": "edit",
                "note": "Inline edit",
                "latency_ms": int((time.monotonic() - t0) * 1000),
            }

        # suggest / chat
        selection = (req.selection or "")[:6000]
        code_snip = selection or (req.code or "")[:6000]
        has_sel = bool(selection.strip())
        system = (
            "You are Ghost, the AI chat sidebar in Spockify's web IDE (Cursor-like). "
            "Answer briefly. When proposing a code change: "
            "(1) if the user selected code, return ONE fenced block with the full "
            "replacement for that selection; "
            "(2) otherwise prefer BEFORE/AFTER fenced blocks (labels BEFORE and AFTER) "
            "so the IDE can search-and-replace; "
            "(3) never describe an edit without including the code to apply."
        )
        user = (
            f"Language: {req.language}\nFilename: {req.filename}\n"
            f"HasSelection: {has_sel}\n"
            f"Instruction: {req.instruction}\n\n"
        )
        if has_sel:
            user += f"SELECTION:\n```\n{selection}\n```\n\nFILE (context):\n```\n{(req.code or '')[:4000]}\n```"
        else:
            user += f"FILE:\n```\n{code_snip}\n```"
        text = await _remote_chat(worker_chat, system=system, user=user)
        if not text:
            return _local_suggest(req)
        return {
            "ok": True,
            "suggestion": text[:4000],
            "mode": "remote",
            "kind": mode,
            "note": "Ghost AI panel — not a Void fork.",
            "latency_ms": int((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:  # noqa: BLE001
        LOG.warning("ghost suggest failed: %s", exc)
        out = _local_suggest(req)
        out["fallback_error"] = str(exc)
        out["latency_ms"] = int((time.monotonic() - t0) * 1000)
        return out
