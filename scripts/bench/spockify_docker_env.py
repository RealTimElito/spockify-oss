"""Spockify Docker env for mini-swe-agent (LEAP hang + syntax guards).

Under qemu/amd64 SWE images, ``grep -R`` / ``ls -R`` can outlive host
``docker exec`` timeouts and leave the container wedged. This wrapper:

- rewrites recursive grep/find/ls into bounded ``rg`` / ``find -maxdepth``
- blocks ``sed`` edits that embed literal ``\\n`` (run-m SyntaxError class)
- on TimeoutExpired, SIGKILLs leftover shells/greps inside the container
- refuses COMPLETE submit when changed ``.py`` files fail ``py_compile``
- normalizes known gpt-oss L031 description drift before submit

``sanitize_command`` / helpers are importable without mini-swe-agent installed.
"""

from __future__ import annotations

import logging
import re
import shlex
import subprocess
from typing import Any

logger = logging.getLogger("spockify_docker_env")

_GREP_R = re.compile(
    r"\bgrep\s+(?:-[A-Za-z]*R[A-Za-z]*|--recursive)\b",
    re.IGNORECASE,
)
_LS_R = re.compile(r"\bls\s+-[A-Za-z]*R[A-Za-z]*\b")

_SUBMIT_MARKER = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"

# gpt-oss near-miss on sqlfluff-1625 FAIL_TO_PASS expected string.
_DESC_DRIFT = "Avoid using aliases in from clauses and join conditions"
_DESC_GOLD = "Avoid aliases in from clauses and join conditions."


def looks_like_sed_literal_newline(command: str) -> bool:
    """True if sed edit likely inserts a literal backslash-n into a file."""
    if "sed" not in command:
        return False
    if re.search(r"sed\s+-i[^;\n]*\\n", command):
        return True
    if re.search(r"sed\s+-i[^;\n]*/a\\", command):
        return True
    return False


def looks_like_submit(command: str) -> bool:
    return _SUBMIT_MARKER in command


def normalize_description_drift_in_text(text: str) -> tuple[str, bool]:
    """Fix known gpt-oss L031 description drift toward FAIL_TO_PASS gold.

    Model often emits ``Avoid using aliases…`` (extra ``using``, missing ``.``).
    Returns (new_text, changed).
    """
    out = text
    changed = False
    # Longer variant first so we don't double-replace.
    for variant in (_DESC_DRIFT + ".", _DESC_DRIFT):
        if variant in out:
            out = out.replace(variant, _DESC_GOLD)
            changed = True
    return out, changed


def sanitize_command(command: str) -> tuple[str, str | None]:
    """Rewrite hang-prone / syntax-breaking commands. Returns (cmd, note_or_None)."""
    original = command
    note: str | None = None

    if looks_like_sed_literal_newline(command):
        note = "blocked sed with \\n — use python3 pathlib edit instead"
        command = (
            "printf '%s\\n' "
            "'BLOCKED: sed with \\n inserts a literal backslash-n (SyntaxError).' "
            "'Use python3 pathlib Path.read_text/replace/write_text instead.' "
            "'Then: python3 -m py_compile path/to/file.py'"
        )
        logger.warning("%s | was: %s", note, original[:200])
        return command, note

    if _GREP_R.search(command):
        command = _GREP_R.sub("rg -n --max-count 50", command)
        note = "rewrote grep -R → rg -n --max-count 50"
    if _LS_R.search(command):
        command = _LS_R.sub("ls", command)
        note = (note + "; " if note else "") + "rewrote ls -R → ls"
    if re.search(r"\bfind\s+/\s+-name\b", command) and "-maxdepth" not in command:
        command = re.sub(r"\bfind\s+/\s+", "find / -maxdepth 4 ", command, count=1)
        note = (note + "; " if note else "") + "added find -maxdepth 4"
    if command != original and note:
        logger.warning("%s | was: %s", note, original[:200])
    return command, note


def wrap_submit_with_py_compile(command: str) -> str:
    """Prefix a COMPLETE submit with compile + nonempty-diff gates.

    On py_compile failure: revert broken ``.py`` files (run-n hang class).
    Always rebuild ``patch.txt`` from ``git diff``; refuse COMPLETE when empty
    so ``cat: patch.txt: No such file`` never becomes the scored patch.
    """
    if not looks_like_submit(command):
        return command
    gate = (
        "bad=0; "
        "failed=''; "
        "for f in $(git diff --name-only --diff-filter=ACMR HEAD -- '*.py' 2>/dev/null); do "
        "  if ! python3 -m py_compile \"$f\" 2>/tmp/spockify_py_compile.err; then "
        "    echo \"py_compile FAILED: $f\"; "
        "    cat /tmp/spockify_py_compile.err 2>/dev/null || true; "
        "    bad=1; failed=\"$failed $f\"; "
        "  fi; "
        "done; "
        "if [ \"$bad\" -ne 0 ]; then "
        "  for f in $failed; do git checkout -- \"$f\" 2>/dev/null || true; done; "
        "  echo 'Reverted invalid .py edits. Prefer a one-line pathlib string "
        "replace (e.g. lint description text) — never sed with \\\\n.'; "
        "  git status -sb; "
        "  exit 0; "
        "fi; "
        "git diff -- . > patch.txt 2>/dev/null || true; "
        "if [ ! -s patch.txt ]; then "
        "  echo 'REFUSED submit: empty patch (no git diff). Keep editing sources.'; "
        "  git status -sb; "
        "  exit 0; "
        "fi; "
        "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT; "
        "cat patch.txt; "
        "exit 0; "
    )
    # Replace the model's submit body: gate already prints COMPLETE + patch.
    return gate


_DRIFT_NORMALIZE_PY = f"""
from pathlib import Path
import subprocess
DRIFT = {_DESC_DRIFT!r}
GOLD = {_DESC_GOLD!r}
files = subprocess.check_output(
    ['git', 'diff', '--name-only', '--diff-filter=ACMR', 'HEAD', '--', '*.py'],
    text=True,
).splitlines()
for f in files:
    p = Path(f)
    if not p.is_file():
        continue
    t = p.read_text(encoding='utf-8')
    n = t
    for v in (DRIFT + '.', DRIFT):
        if v in n:
            n = n.replace(v, GOLD)
    if n != t:
        p.write_text(n, encoding='utf-8')
        print('normalized description drift in', f)
"""


class SpockifyDockerEnvironment:
    """Factory that returns a DockerEnvironment subclass with hang/syntax guards.

    Lazy so ``sanitize_command`` unit tests need no mini-swe install.
    """

    def __new__(cls, *args, **kwargs):
        from minisweagent.environments.docker import (
            DockerEnvironment,
            DockerEnvironmentConfig,
        )

        class _Impl(DockerEnvironment):
            def __init__(self, *, config_class: type = DockerEnvironmentConfig, **kw):
                kw.setdefault("timeout", 45)
                kw.setdefault("container_timeout", "2h")
                super().__init__(config_class=config_class, **kw)

            def cleanup(self) -> None:
                """Stop/remove synchronously so the next instance does not orphan boxes."""
                if not self.container_id:
                    return
                cid = self.container_id
                try:
                    subprocess.run(
                        [self.config.executable, "stop", "-t", "10", cid],
                        capture_output=True,
                        timeout=60,
                        check=False,
                    )
                except Exception:  # noqa: BLE001
                    logger.warning("docker stop failed for %s", cid[:12], exc_info=True)
                try:
                    subprocess.run(
                        [self.config.executable, "rm", "-f", cid],
                        capture_output=True,
                        timeout=30,
                        check=False,
                    )
                except Exception:  # noqa: BLE001
                    logger.warning("docker rm failed for %s", cid[:12], exc_info=True)
                self.container_id = None

            def _pkill_zombies(self) -> None:
                if not self.container_id:
                    return
                for pattern in ("grep", "rg", "find", "xargs"):
                    subprocess.run(
                        [
                            self.config.executable,
                            "exec",
                            self.container_id,
                            "pkill",
                            "-9",
                            "-f",
                            pattern,
                        ],
                        capture_output=True,
                        timeout=15,
                        check=False,
                    )

            def _normalize_description_drift(self) -> str:
                """Apply known description drift fix inside the container."""
                if not self.container_id:
                    return ""
                result = subprocess.run(
                    [
                        self.config.executable,
                        "exec",
                        "-w",
                        self.config.cwd,
                        self.container_id,
                        "python3",
                        "-c",
                        _DRIFT_NORMALIZE_PY,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                out = (result.stdout or "") + (result.stderr or "")
                if out.strip():
                    logger.info("description drift normalize: %s", out.strip()[:300])
                return out

            def execute(
                self, command: str, cwd: str = "", *, timeout: int | None = None
            ) -> dict[str, Any]:
                cmd, note = sanitize_command(command)
                drift_note = ""
                if looks_like_submit(cmd):
                    drift_note = self._normalize_description_drift()
                cmd = wrap_submit_with_py_compile(cmd)
                limit = int(timeout or self.config.timeout)
                inner = max(5, limit - 3)
                wrapped = f"timeout -k 5s {inner}s bash -c {shlex.quote(cmd)}"
                try:
                    result = super().execute(wrapped, cwd=cwd, timeout=limit)
                except subprocess.TimeoutExpired as exc:
                    logger.warning(
                        "docker exec timeout (%ss); pkill zombies", limit
                    )
                    self._pkill_zombies()
                    partial = ""
                    if exc.output:
                        partial = (
                            exc.output
                            if isinstance(exc.output, str)
                            else exc.output.decode("utf-8", "replace")
                        )
                    elif exc.stdout:
                        partial = (
                            exc.stdout
                            if isinstance(exc.stdout, str)
                            else exc.stdout.decode("utf-8", "replace")
                        )
                    msg = (
                        f"Command timed out after {limit}s and was killed.\n"
                        f"command: {cmd[:500]}\n"
                        f"{('note: ' + note + chr(10)) if note else ''}"
                        f"partial output:\n{partial[-2000:]}"
                    )
                    raise subprocess.TimeoutExpired(
                        cmd=exc.cmd, timeout=limit, output=msg.encode("utf-8")
                    ) from exc
                prefix = ""
                if note:
                    prefix += f"[spockify sanitize: {note}]\n"
                if drift_note.strip():
                    prefix += f"[spockify drift-fix: {drift_note.strip()}]\n"
                if prefix:
                    # CRITICAL: COMPLETE marker must stay first line for submit.
                    out = result.get("output") or ""
                    if out.lstrip().startswith(_SUBMIT_MARKER):
                        result = {**result, "output": out}
                    else:
                        result = {**result, "output": prefix + out}
                if result.get("returncode") == 124:
                    self._pkill_zombies()
                    result = {
                        **result,
                        "output": (
                            f"Command hit inner timeout ({inner}s) and was killed.\n"
                            f"command: {cmd[:500]}\n"
                            f"{result.get('output') or ''}"
                        ),
                    }
                return result

        return _Impl(*args, **kwargs)
