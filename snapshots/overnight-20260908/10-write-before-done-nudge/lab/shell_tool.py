"""Allowlisted workspace shell for lab executors (benign inspect/test only)."""

from __future__ import annotations

import re
import shlex
import subprocess
from dataclasses import dataclass

# First token must be one of these (or a path to an allowlisted basename).
_ALLOWED_BIN = frozenset(
    {
        "ls",
        "find",
        "rg",
        "grep",
        "egrep",
        "fgrep",
        "cat",
        "head",
        "tail",
        "wc",
        "stat",
        "file",
        "pwd",
        "git",
        "pytest",
        "python",
        "python3",
        "npm",
        "make",
        "sed",
        "awk",
        "sort",
        "uniq",
        "diff",
        "tree",
        "realpath",
        "basename",
        "dirname",
        "test",
        "[",
        "true",
        "echo",
    }
)

_DENY_RE = re.compile(
    r"(?i)(\bspockify\b|\brm\b|\bmv\b|\bchmod\b|\bchown\b|\bsudo\b|"
    r"\bcurl\b|\bwget\b|\bssh\b|\bnc\b|\bpython\s+-c\b|\bpython3\s+-c\b|"
    r">\s*/|\bmkfs\b|\bdd\b|\bkill\b|\breboot\b|\bshutdown\b)"
)

_RUN_LINE_RE = re.compile(r"(?m)^\s*RUN:\s*(.+?)\s*$")
_RUN_FENCE_RE = re.compile(r"```(?:run|shell)\s*\n([\s\S]*?)```", re.IGNORECASE)
# Multi-line workspace writes without shell pipes:
# WRITE: relative/path.py
# ```
# contents
# ```
_WRITE_RE = re.compile(
    r"(?ms)^\s*WRITE:\s*([^\s\n]+)\s*\n```(?:[\w+-]*)?\n([\s\S]*?)```"
)


@dataclass
class ShellResult:
    command: str
    ok: bool
    output: str
    error: str = ""


@dataclass
class WriteResult:
    path: str
    ok: bool
    bytes_written: int = 0
    error: str = ""


def extract_run_commands(text: str) -> list[str]:
    """Pull RUN: lines and ```run/shell fences from model text.

    Ignores RUN lines that appear after a DONE / COMPLETED marker so a finished
    reply cannot keep spawning shell (and accidentally undo a fix).
    """
    raw = text or ""
    # Truncate at first DONE line for command extraction.
    done_m = re.search(
        r"(?im)^\s*(?:DONE|COMPLETED(?:\s+WORK)?)\s*[-—:]",
        raw,
    )
    if done_m:
        raw = raw[: done_m.start()]
    cmds: list[str] = []
    for m in _RUN_LINE_RE.finditer(raw):
        cmd = m.group(1).strip()
        if cmd:
            cmds.append(cmd)
    for m in _RUN_FENCE_RE.finditer(raw):
        block = m.group(1).strip()
        for line in block.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            cmds.append(line)
    # De-dupe preserving order.
    seen: set[str] = set()
    out: list[str] = []
    for c in cmds:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def extract_writes(text: str) -> list[tuple[str, str]]:
    """Pull WRITE: path + fenced body pairs (before DONE, same as RUN)."""
    raw = text or ""
    done_m = re.search(
        r"(?im)^\s*(?:DONE|COMPLETED(?:\s+WORK)?)\s*[-—:]",
        raw,
    )
    if done_m:
        raw = raw[: done_m.start()]
    return [(m.group(1).strip(), m.group(2)) for m in _WRITE_RE.finditer(raw)]


def _safe_relpath(path: str, cwd: str) -> str | None:
    """Return resolved path under cwd, or None if unsafe."""
    from pathlib import Path

    rel = (path or "").strip()
    if not rel or rel.startswith("/") or ".." in Path(rel).parts:
        return None
    base = Path(cwd).resolve()
    target = (base / rel).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    return str(target)


def apply_writes(writes: list[tuple[str, str]], *, cwd: str) -> list[WriteResult]:
    """Write fenced contents into workspace (create parents as needed)."""
    from pathlib import Path

    out: list[WriteResult] = []
    for rel, body in writes[:6]:
        target = _safe_relpath(rel, cwd)
        if not target:
            out.append(WriteResult(path=rel, ok=False, error="unsafe path"))
            continue
        if len(body) > 200_000:
            out.append(WriteResult(path=rel, ok=False, error="content too large"))
            continue
        try:
            p = Path(target)
            p.parent.mkdir(parents=True, exist_ok=True)
            data = body if body.endswith("\n") or body == "" else body + "\n"
            p.write_text(data, encoding="utf-8")
            out.append(
                WriteResult(path=rel, ok=True, bytes_written=len(data.encode("utf-8")))
            )
        except OSError as e:
            out.append(WriteResult(path=rel, ok=False, error=str(e)))
    return out

def _first_token(cmd: str) -> str:
    try:
        parts = shlex.split(cmd)
    except ValueError:
        return ""
    if not parts:
        return ""
    return parts[0].rsplit("/", 1)[-1]


def validate_command(cmd: str) -> str | None:
    """Return error string if command is not allowed."""
    raw = (cmd or "").strip()
    if not raw:
        return "empty command"
    if len(raw) > 500:
        return "command too long"
    if _DENY_RE.search(raw):
        return "command matches deny pattern"
    if "|" in raw or ";" in raw or "&&" in raw or "||" in raw or "`" in raw:
        # Keep the allowlist simple: no shell chaining / substitution.
        return "no pipes/chaining/substitution (one simple command)"
    bin_name = _first_token(raw)
    if bin_name not in _ALLOWED_BIN:
        return f"binary not allowlisted: {bin_name or '?'}"
    # git: only status/diff/log/show/branch
    if bin_name == "git":
        try:
            parts = shlex.split(raw)
        except ValueError:
            return "unparseable git command"
        sub = parts[1] if len(parts) > 1 else ""
        if sub not in {"status", "diff", "log", "show", "branch", "rev-parse"}:
            return f"git subcommand not allowed: {sub or '?'}"
    return None


def run_shell(cmd: str, *, cwd: str, timeout: float = 30.0) -> ShellResult:
    err = validate_command(cmd)
    if err:
        return ShellResult(command=cmd, ok=False, output="", error=err)
    try:
        parts = shlex.split(cmd)
    except ValueError as e:
        return ShellResult(command=cmd, ok=False, output="", error=f"parse: {e}")
    try:
        proc = subprocess.run(
            parts,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return ShellResult(command=cmd, ok=False, output="", error="timed out")
    except OSError as e:
        return ShellResult(command=cmd, ok=False, output="", error=str(e))
    blob = (proc.stdout or "") + (
        ("\n" + proc.stderr) if proc.stderr else ""
    )
    if len(blob) > 32000:
        blob = blob[:31980] + "\n…[truncated]"
    return ShellResult(
        command=cmd,
        ok=proc.returncode == 0,
        output=blob.strip() or "(no output)",
        error="" if proc.returncode == 0 else f"exit {proc.returncode}",
    )


def format_observations(results: list[ShellResult]) -> str:
    parts = ["SHELL OBSERVATIONS (authoritative — do not invent conflicting output):"]
    for r in results:
        status = "ok" if r.ok else f"FAILED ({r.error})"
        parts.append(f"$ {r.command}\n[{status}]\n{r.output}")
    parts.append(
        "Now write DONE / FINDINGS / ARTIFACTS using only these observations "
        "(plus any prior real observations). No invented file contents."
    )
    return "\n\n".join(parts)


def format_write_observations(results: list[WriteResult]) -> str:
    parts = ["WRITE OBSERVATIONS (files updated on disk):"]
    for r in results:
        if r.ok:
            parts.append(f"WRITE {r.path} → ok ({r.bytes_written} bytes)")
        else:
            parts.append(f"WRITE {r.path} → FAILED ({r.error})")
    parts.append(
        "Continue with RUN: pytest/verification if needed, then DONE / FINDINGS."
    )
    return "\n".join(parts)
