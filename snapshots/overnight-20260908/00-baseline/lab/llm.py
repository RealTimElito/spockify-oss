"""Minimal OpenAI-compatible chat client (stdlib only)."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable


# Prefer env / on-box detection. Laptop → twin: set SPOCKIFY_BASE_URL.
DEFAULT_LAB_BASE = "http://127.0.0.1:30400"
DEFAULT_ORCH = "lab-orchestrator"
DEFAULT_EXEC = "lab-executor"

OnText = Callable[[str], None]
OnTick = Callable[[float], None]


def _owui_to_litellm(url: str) -> str:
    """Map Open WebUI ports to LiteLLM /v1 on the same host."""
    raw = url.strip().rstrip("/")
    for owui, litellm in (
        (":30080", ":30400"),
        (":3080", ":4000"),
    ):
        if owui in raw:
            return raw.replace(owui, litellm, 1)
    return raw


def resolve_base_url(explicit: str | None = None) -> str:
    for cand in (
        explicit,
        os.environ.get("SPOCKIFY_LAB_BASE_URL"),
        os.environ.get("SPOCKIFY_BASE_URL"),
        os.environ.get("LITELLM_BASE_URL"),
        os.environ.get("OPENAI_BASE_URL"),
    ):
        if cand and cand.strip():
            return _owui_to_litellm(cand.strip())
    # On-box twin: NodePort on loopback
    if os.path.exists("/home/lab/agentHub") or os.environ.get("SPOCKIFY_LAB_TWIN"):
        return "http://127.0.0.1:30400"
    twin_host = (os.environ.get("SPOCKIFY_LAB_HOST") or "").strip()
    if twin_host:
        return f"http://{twin_host}:30400"
    return DEFAULT_LAB_BASE


def resolve_api_key(explicit: str | None = None) -> str:
    for cand in (
        explicit,
        os.environ.get("LITELLM_MASTER_KEY"),
        os.environ.get("SPOCKIFY_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    ):
        if cand and cand.strip():
            return cand.strip()
    # Device login creds from Spockify CLI (~/.config/spockify/credentials.json).
    try:
        from pathlib import Path

        cred_path = Path.home() / ".config" / "spockify" / "credentials.json"
        if cred_path.is_file():
            data = json.loads(cred_path.read_text(encoding="utf-8"))
            token = (data.get("accessToken") or "").strip()
            if token:
                return token
    except Exception:
        pass
    # Twin convenience: read from microk8s secret (never printed by callers).
    try:
        import subprocess
        import base64

        out = subprocess.check_output(
            [
                "microk8s",
                "kubectl",
                "-n",
                "spockify",
                "get",
                "secret",
                "spockify-secrets",
                "-o",
                "jsonpath={.data.LITELLM_MASTER_KEY}",
            ],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=15,
        ).strip()
        if out:
            return base64.b64decode(out).decode("utf-8").strip()
    except Exception:
        pass
    return ""


class LabLlmError(RuntimeError):
    pass


@dataclass
class ChatResult:
    content: str
    reasoning: str = ""


class WaitSpinner:
    """TTY spinner shown until the first model token arrives."""

    _FRAMES = ("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")

    def __init__(self, label: str) -> None:
        self.label = label
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._enabled = sys.stderr.isatty()
        self._started = time.monotonic()

    def start(self) -> None:
        if not self._enabled:
            print(f"  … {self.label}", file=sys.stderr, flush=True)
            return
        self._started = time.monotonic()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        i = 0
        while not self._stop.wait(0.08):
            elapsed = time.monotonic() - self._started
            frame = self._FRAMES[i % len(self._FRAMES)]
            msg = f"\r  {frame} {self.label}  {elapsed:0.1f}s   "
            sys.stderr.write(msg)
            sys.stderr.flush()
            i += 1

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None
        if self._enabled:
            sys.stderr.write("\r\x1b[2K")
            sys.stderr.flush()


def _delta_text(delta: dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = delta.get(k)
        if isinstance(v, str) and v:
            return v
    return ""


def _message_reasoning(msg: dict[str, Any]) -> str:
    for k in ("reasoning_content", "reasoning", "thinking", "reasoning_text"):
        v = msg.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


class LabLlm:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 300.0,
        cancel: threading.Event | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        # Wall-clock budget for a single completion (stream or blocking).
        # Streaming token trickle must not evade this by resetting per-read.
        self.timeout = timeout
        self._cancel = cancel

    def _headers(self, *, stream: bool = False) -> dict[str, str]:
        h = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
            "X-Spockify-Client": "lab-agents",
        }
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, headers=self._headers(), method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:800]
            raise LabLlmError(f"HTTP {e.code} {url}: {detail}") from e
        except urllib.error.URLError as e:
            raise LabLlmError(f"unreachable {url}: {e}") from e
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise LabLlmError(f"bad JSON from {url}: {raw[:400]}") from e

    def _get(self, path: str) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=min(60.0, self.timeout)) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:800]
            raise LabLlmError(f"HTTP {e.code} {url}: {detail}") from e
        except urllib.error.URLError as e:
            raise LabLlmError(f"unreachable {url}: {e}") from e
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise LabLlmError(f"bad JSON from {url}: {raw[:400]}") from e

    def list_models(self) -> list[str]:
        data = self._get("/v1/models")
        items = data.get("data") or []
        ids = []
        for m in items:
            mid = m.get("id") or m.get("model") or ""
            if mid:
                ids.append(str(mid))
        return sorted(set(ids))

    def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = 4096,
    ) -> str:
        return self.chat_result(
            model, messages, temperature=temperature, max_tokens=max_tokens
        ).content

    def _raise_if_cancelled(self) -> None:
        if self._cancel is not None and self._cancel.is_set():
            raise LabLlmError("cancelled")

    def chat_result(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = 4096,
        stream: bool = True,
        on_content: OnText | None = None,
        on_reasoning: OnText | None = None,
        wait_label: str | None = None,
        show_spinner: bool = True,
    ) -> ChatResult:
        """Chat completion; streams when possible, with optional live callbacks."""
        self._raise_if_cancelled()
        if stream:
            try:
                return self._chat_stream(
                    model,
                    messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    on_content=on_content,
                    on_reasoning=on_reasoning,
                    wait_label=wait_label,
                    show_spinner=show_spinner,
                )
            except LabLlmError as e:
                # Fall back to non-stream if the endpoint rejects SSE.
                msg = str(e).lower()
                if "cancelled" in msg or "timed out" in msg:
                    raise
                pass
        return self._chat_blocking(
            model,
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            on_content=on_content,
            on_reasoning=on_reasoning,
            wait_label=wait_label,
            show_spinner=show_spinner,
        )

    def _chat_blocking(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int | None,
        on_content: OnText | None,
        on_reasoning: OnText | None,
        wait_label: str | None,
        show_spinner: bool = True,
    ) -> ChatResult:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        spinner = (
            WaitSpinner(wait_label or f"waiting for {model}")
            if show_spinner
            else None
        )
        if spinner:
            spinner.start()
        try:
            data = self._post("/v1/chat/completions", body)
        finally:
            if spinner:
                spinner.stop()
        try:
            msg = data["choices"][0]["message"]
            content = (msg.get("content") or "").strip()
            reasoning = _message_reasoning(msg)
        except (KeyError, IndexError, TypeError) as e:
            raise LabLlmError(f"unexpected completion shape: {data!r}"[:500]) from e
        if reasoning and on_reasoning:
            on_reasoning(reasoning)
        if content and on_content:
            on_content(content)
        return ChatResult(content=content, reasoning=reasoning)

    def _chat_stream(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int | None,
        on_content: OnText | None,
        on_reasoning: OnText | None,
        wait_label: str | None,
        show_spinner: bool = True,
    ) -> ChatResult:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        url = f"{self.base_url}/v1/chat/completions"
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, headers=self._headers(stream=True), method="POST"
        )
        spinner = (
            WaitSpinner(wait_label or f"waiting for {model}")
            if show_spinner
            else None
        )
        if spinner:
            spinner.start()
        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        saw_token = False
        # Per-read socket timeout; wall-clock budget is self.timeout overall.
        # Slow token trickle must not evade the wall clock forever.
        socket_timeout = min(60.0, max(5.0, float(self.timeout)))
        deadline = time.monotonic() + float(self.timeout)
        try:
            with urllib.request.urlopen(req, timeout=socket_timeout) as resp:
                while True:
                    self._raise_if_cancelled()
                    if time.monotonic() > deadline:
                        raise LabLlmError(
                            f"timed out after {self.timeout:0.0f}s streaming {model}"
                        )
                    try:
                        raw_line = resp.readline()
                    except TimeoutError as e:
                        if time.monotonic() > deadline:
                            raise LabLlmError(
                                f"timed out after {self.timeout:0.0f}s "
                                f"streaming {model}"
                            ) from e
                        # Idle gap under wall budget — keep waiting.
                        continue
                    if not raw_line:
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    if line.startswith(":"):
                        # SSE comment / keepalive
                        continue
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    # Some providers put the full message on the final chunk.
                    msg = choices[0].get("message") or {}

                    rpiece = _delta_text(
                        delta,
                        "reasoning_content",
                        "reasoning",
                        "thinking",
                        "reasoning_text",
                    )
                    if not rpiece and msg:
                        rpiece = _message_reasoning(msg)
                    cpiece = _delta_text(delta, "content")
                    if not cpiece and isinstance(msg.get("content"), str):
                        cpiece = msg["content"]

                    if rpiece or cpiece:
                        if not saw_token:
                            if spinner:
                                spinner.stop()
                            saw_token = True
                    if rpiece:
                        reasoning_parts.append(rpiece)
                        if on_reasoning:
                            on_reasoning(rpiece)
                    if cpiece:
                        content_parts.append(cpiece)
                        if on_content:
                            on_content(cpiece)
        except LabLlmError:
            if spinner:
                spinner.stop()
            raise
        except urllib.error.HTTPError as e:
            if spinner:
                spinner.stop()
            detail = e.read().decode("utf-8", errors="replace")[:800]
            raise LabLlmError(f"HTTP {e.code} {url}: {detail}") from e
        except urllib.error.URLError as e:
            if spinner:
                spinner.stop()
            raise LabLlmError(f"unreachable {url}: {e}") from e
        finally:
            if spinner:
                spinner.stop()

        content = "".join(content_parts).strip()
        reasoning = "".join(reasoning_parts).strip()
        if not content and not reasoning:
            raise LabLlmError(f"empty stream from {url}")
        return ChatResult(content=content, reasoning=reasoning)
