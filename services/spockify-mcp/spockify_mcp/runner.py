"""Shared tool implementations — subprocess wrappers with timeout and redaction."""

from __future__ import annotations

import shlex
import subprocess
from dataclasses import dataclass
from enum import Enum
from typing import Callable
from urllib import error, request

from spockify_mcp.config import Settings
from spockify_mcp.redaction import redact


class LogService(str, Enum):
    """Kubernetes log label targets in the spockify namespace."""

    OPENWEBUI = "openwebui"
    ROUTER = "router"
    OLLAMA = "ollama"
    VLLM = "vllm"
    LITELLM = "litellm"


SERVICE_LABELS: dict[LogService, str] = {
    LogService.OPENWEBUI: "app=openwebui",
    LogService.ROUTER: "app=spockify-router",
    LogService.OLLAMA: "app=ollama",
    LogService.VLLM: "app=vllm",
    LogService.LITELLM: "app=litellm",
}

MAX_LOG_LINES = 500


@dataclass
class CommandResult:
    """Captured subprocess result."""

    stdout: str
    stderr: str
    returncode: int
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and not self.timed_out

    def text(self) -> str:
        parts: list[str] = []
        if self.stdout.strip():
            parts.append(self.stdout.rstrip())
        if self.stderr.strip():
            parts.append(f"[stderr]\n{self.stderr.rstrip()}")
        if self.timed_out:
            parts.append("[timed out]")
        if not parts:
            return "(no output)"
        body = "\n".join(parts)
        if not self.ok:
            body = f"[exit {self.returncode}]\n{body}"
        return redact(body)


def run_command(
    argv: list[str],
    *,
    cwd: str | None = None,
    timeout_s: int = 120,
    env: dict[str, str] | None = None,
) -> CommandResult:
    """Run argv with timeout; never raises."""
    try:
        proc = subprocess.run(
            argv,
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
        return CommandResult(
            stdout=proc.stdout or "",
            stderr=proc.stderr or "",
            returncode=proc.returncode,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode() if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        return CommandResult(
            stdout=stdout,
            stderr=stderr,
            returncode=124,
            timed_out=True,
        )
    except OSError as exc:
        return CommandResult(stdout="", stderr=str(exc), returncode=127)


def _make_env(settings: Settings) -> dict[str, str]:
    import os

    env = os.environ.copy()
    env.setdefault("NAMESPACE", settings.namespace)
    env.setdefault("KUBECTL", " ".join(settings.kubectl))
    env.setdefault("SPARK_HOST", settings.spark_host)
    env.setdefault("DEST_HOST", settings.spark_host)
    return env


def cluster_status(settings: Settings | None = None) -> str:
    """Run `make status` in agentHub (local or via SSH on cluster)."""
    cfg = settings or Settings.load()
    make_argv = ["make", "status"]
    env = _make_env(cfg)
    remote = cfg.remote_shell_prefix()
    if remote:
        root = str(cfg.agenthub_root)
        cmd = " ".join(shlex.quote(a) for a in make_argv)
        argv = remote + [f"cd {shlex.quote(root)} && {cmd}"]
        result = run_command(argv, timeout_s=cfg.default_timeout_s, env=env)
    else:
        result = run_command(
            make_argv,
            cwd=str(cfg.agenthub_root),
            timeout_s=cfg.default_timeout_s,
            env=env,
        )
    return result.text()


def tab_train_status(settings: Settings | None = None) -> str:
    """Tab-train CronJobs, jobs, status.json, champions."""
    cfg = settings or Settings.load()
    script = cfg.agenthub_root / "scripts" / "tab-train-status.sh"
    if script.is_file():
        argv = ["bash", str(script)]
        result = run_command(
            argv,
            cwd=str(cfg.agenthub_root),
            timeout_s=cfg.default_timeout_s,
            env=_make_env(cfg),
        )
        if result.ok or result.stdout.strip():
            return result.text()
    make_argv = ["make", "tab-train-status"]
    result = run_command(
        make_argv,
        cwd=str(cfg.agenthub_root),
        timeout_s=cfg.default_timeout_s,
        env=_make_env(cfg),
    )
    return result.text()


def tail_logs(
    service: LogService,
    lines: int = 100,
    settings: Settings | None = None,
) -> str:
    """Tail kubectl logs for a known Spockify service (max 500 lines)."""
    if not isinstance(service, LogService):
        try:
            service = LogService(str(service).lower())
        except ValueError as exc:
            allowed = ", ".join(s.value for s in LogService)
            raise ValueError(f"service must be one of: {allowed}") from exc
    line_count = max(1, min(int(lines), MAX_LOG_LINES))
    cfg = settings or Settings.load()
    label = SERVICE_LABELS[service]
    kubectl = cfg.kubectl_argv()
    argv = kubectl + [
        "logs",
        "-n",
        cfg.namespace,
        "-l",
        label,
        f"--tail={line_count}",
    ]
    result = run_command(argv, timeout_s=min(cfg.default_timeout_s, 60))
    return result.text()


def _fetch_url(url: str, timeout_s: int = 15) -> tuple[int | None, str]:
    try:
        req = request.Request(url, headers={"Accept": "application/json, text/plain, */*"})
        with request.urlopen(req, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return exc.code, body
    except error.URLError as exc:
        return None, str(exc.reason)
    except OSError as exc:
        return None, str(exc)


def health(settings: Settings | None = None) -> str:
    """Probe router /health and /spockify/status."""
    cfg = settings or Settings.load()
    base = cfg.router_health_url.rstrip("/")
    sections: list[str] = [f"router_base: {base}"]

    for path in ("/health", "/spockify/status"):
        url = f"{base}{path}"
        status, body = _fetch_url(url)
        if status is None:
            remote = cfg.remote_shell_prefix()
            if remote:
                curl_argv = remote + [
                    f"curl -sfS -m 15 {shlex.quote(url)} || "
                    f"curl -sS -m 15 -w '\\nHTTP %{{http_code}}' {shlex.quote(url)}"
                ]
                result = run_command(curl_argv, timeout_s=30)
                sections.append(f"=== {path} (via ssh) ===\n{result.text()}")
                continue
            sections.append(f"=== {path} ===\n(unreachable: {body})")
            continue
        snippet = body if len(body) <= 8000 else body[:8000] + "\n…[truncated]"
        sections.append(f"=== {path} (HTTP {status}) ===\n{redact(snippet)}")

    return "\n\n".join(sections)


def preflight(settings: Settings | None = None) -> str:
    """Run make preflight-deploy."""
    cfg = settings or Settings.load()
    timeout = max(cfg.default_timeout_s, 300)
    make_argv = ["make", "preflight-deploy"]
    env = _make_env(cfg)
    remote = cfg.remote_shell_prefix()
    if remote:
        root = str(cfg.agenthub_root)
        cmd = " ".join(shlex.quote(a) for a in make_argv)
        argv = remote + [f"cd {shlex.quote(root)} && {cmd}"]
        result = run_command(argv, timeout_s=timeout, env=env)
    else:
        result = run_command(
            make_argv,
            cwd=str(cfg.agenthub_root),
            timeout_s=timeout,
            env=env,
        )
    return result.text()


# Type alias for tool dispatch in tests.
ToolFn = Callable[..., str]
