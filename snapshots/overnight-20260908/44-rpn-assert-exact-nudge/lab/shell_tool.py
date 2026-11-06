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
# Also accept --- body --- (models often use that in task instructions).
# Double-open fence (empty ``` then ```lang) — common model glitch.
_WRITE_DOUBLE_FENCE_RE = re.compile(
    r"(?ms)^\s*WRITE:\s*([^\s\n]+)\s*\n\s*```\s*\n\s*```(?:[\w+-]*)?\n([\s\S]*?)```"
)
_WRITE_FENCE_RE = re.compile(
    r"(?ms)^\s*WRITE:\s*([^\s\n]+)\s*\n\s*```(?:[\w+-]*)?\n([\s\S]*?)```"
)
_WRITE_DASH_RE = re.compile(
    r"(?ms)^\s*WRITE:\s*([^\s\n]+)\s*\n---\s*\n([\s\S]*?)\n---\s*(?=\n|$)"
)
# Models often put WRITE inside the fence:
# ```
# WRITE: path
# body
# ```
_WRITE_EMBEDDED_FENCE_RE = re.compile(
    r"(?ms)```(?:[\w+-]*)?\n\s*WRITE:\s*([^\s\n]+)\s*\n([\s\S]*?)```"
)
# Bare JSON / brace body after WRITE: (no fence) — common for .json configs.
_WRITE_BRACE_RE = re.compile(
    r"(?ms)^\s*WRITE:\s*([^\s\n]+)\s*\n(\{(?:[^{}]|\{[^{}]*\})*\})\s*"
    r"(?=\n\s*(?:WRITE:|RUN:|DONE|COMPLETED|FINDINGS|ARTIFACTS|```)|$)"
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


def _clean_run_command(cmd: str) -> str:
    """Strip trailing prose like 'pytest -q (verification)'."""
    c = (cmd or "").strip()
    c = re.sub(r"\s*\([^)]*\)\s*$", "", c).strip()
    return c


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
        cmd = _clean_run_command(m.group(1))
        if cmd:
            cmds.append(cmd)
    for m in _RUN_FENCE_RE.finditer(raw):
        block = m.group(1).strip()
        for line in block.splitlines():
            line = _clean_run_command(line)
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


def _looks_like_unified_diff(body: str) -> bool:
    """True when WRITE body is a patch rather than a full file."""
    s = (body or "").lstrip()
    if s.startswith("diff --git"):
        return True
    if re.search(r"(?m)^---\s+\S+", body or "") and re.search(
        r"(?m)^\+\+\+\s+\S+", body or ""
    ):
        return True
    return False


def _extract_write_pairs(raw: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for cre in (
        _WRITE_DOUBLE_FENCE_RE,
        _WRITE_FENCE_RE,
        _WRITE_DASH_RE,
        _WRITE_EMBEDDED_FENCE_RE,
        _WRITE_BRACE_RE,
    ):
        for m in cre.finditer(raw):
            path = m.group(1).strip()
            body = m.group(2)
            if not path or path in seen:
                continue
            if not (body or "").strip():
                continue
            seen.add(path)
            out.append((path, body))
    return out


def extract_writes(text: str) -> list[tuple[str, str]]:
    """Pull WRITE: path + fenced/--- body pairs.

    Prefer blocks before DONE (same as RUN). If none, salvage WRITE blocks that
    appear after DONE / under ARTIFACTS — models often put the real file there.
    (RUN after DONE stays ignored to avoid undo-after-fix.)
    """
    raw = text or ""
    done_m = re.search(
        r"(?im)^\s*(?:DONE|COMPLETED(?:\s+WORK)?)\s*[-—:]",
        raw,
    )
    before = raw[: done_m.start()] if done_m else raw
    out = _extract_write_pairs(before)
    if out or not done_m:
        return out
    return _extract_write_pairs(raw[done_m.start() :])


def extract_pytest_after_done(text: str) -> list[str]:
    """If WRITE was only after DONE, still allow a trailing RUN: pytest."""
    raw = text or ""
    done_m = re.search(
        r"(?im)^\s*(?:DONE|COMPLETED(?:\s+WORK)?)\s*[-—:]",
        raw,
    )
    if not done_m:
        return []
    after = raw[done_m.start() :]
    cmds: list[str] = []
    for m in re.finditer(r"(?im)^\s*RUN:\s*(pytest\b.*\S)\s*$", after):
        cmd = _clean_run_command(m.group(1))
        if cmd and cmd not in cmds:
            cmds.append(cmd)
    return cmds

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


def is_test_relpath(path: str) -> bool:
    """True for test_*.py / *_test.py style paths."""
    from pathlib import Path

    name = Path(path or "").name
    return name.startswith("test_") or name.endswith("_test.py")


def apply_writes(
    writes: list[tuple[str, str]],
    *,
    cwd: str,
    block_tests: bool = False,
) -> list[WriteResult]:
    """Write fenced contents into workspace (create parents as needed)."""
    from pathlib import Path

    out: list[WriteResult] = []
    for rel, body in writes[:6]:
        if block_tests and is_test_relpath(rel):
            out.append(
                WriteResult(
                    path=rel,
                    ok=False,
                    error="test path blocked — edit implementation sources instead",
                )
            )
            continue
        target = _safe_relpath(rel, cwd)
        if not target:
            out.append(WriteResult(path=rel, ok=False, error="unsafe path"))
            continue
        if len(body) > 200_000:
            out.append(WriteResult(path=rel, ok=False, error="content too large"))
            continue
        # Reject empty / whitespace-only bodies (models sometimes emit WRITE
        # with a closed fence and wipe the file).
        if not (body or "").strip():
            out.append(
                WriteResult(
                    path=rel,
                    ok=False,
                    error="empty body ignored — re-emit WRITE with full contents",
                )
            )
            continue
        if _looks_like_unified_diff(body):
            out.append(
                WriteResult(
                    path=rel,
                    ok=False,
                    error="diff rejected — WRITE full file contents, not a patch",
                )
            )
            continue
        try:
            p = Path(target)
            p.parent.mkdir(parents=True, exist_ok=True)
            data = body if body.endswith("\n") or body == "" else body + "\n"
            if p.is_file() and p.read_text(encoding="utf-8") == data:
                out.append(
                    WriteResult(path=rel, ok=True, bytes_written=0, error="unchanged")
                )
                continue
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
        if r.ok and r.error == "unchanged":
            parts.append(f"WRITE {r.path} → unchanged (already on disk)")
        elif r.ok:
            parts.append(f"WRITE {r.path} → ok ({r.bytes_written} bytes)")
        else:
            parts.append(f"WRITE {r.path} → FAILED ({r.error})")
    parts.append(
        "Continue with RUN: pytest/verification if needed, then DONE / FINDINGS."
    )
    return "\n".join(parts)
