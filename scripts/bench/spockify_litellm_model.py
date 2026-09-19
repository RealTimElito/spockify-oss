"""Spockify LiteLLM model for mini-swe-agent (LEAP empty-content fix).

gpt-oss via Ollama/LiteLLM often returns:
  - empty ``content`` with native ``tool_calls`` (e.g. container.exec), or
  - actionable text only in ``reasoning_content``, or
  - truncated native tool-call JSON that makes Ollama 500.

mini-swe-agent 1.14 only parses ``content`` for a single ```bash fence.
This adapter coalesces those shapes into that contract and soft-fails
Ollama tool-parse errors into a recovery bash observation.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger("spockify_litellm_model")

_FENCE_RE = re.compile(r"```(?:bash)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)

# Escalate empty-stop after this many consecutive empty salvages.
# Keep low: with a nonempty tree diff, conditional submit finishes the run;
# without a diff, the same command only nudges another edit.
_EMPTY_STOP_SUBMIT_AFTER = 2
# After this many submit-injection attempts still not finishing (context thrash),
# hard-COMPLETE with whatever diff exists so the instance ends scored.
_EMPTY_STOP_HARD_AFTER = 4


def _cmd_from_tool_call(tc: dict[str, Any]) -> str | None:
    """Best-effort shell command from an OpenAI-style tool call."""
    fn = tc.get("function") or {}
    name = (fn.get("name") or "").strip()
    raw_args = fn.get("arguments") or ""
    try:
        args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
    except json.JSONDecodeError:
        args = {}
    if not isinstance(args, dict):
        args = {}

    cmd = args.get("cmd") or args.get("command") or args.get("code")
    if isinstance(cmd, list):
        if len(cmd) >= 3 and str(cmd[0]).endswith("bash") and cmd[1] in {"-lc", "-c"}:
            return str(cmd[2]).strip()
        return " ".join(str(x) for x in cmd).strip() or None
    if isinstance(cmd, str) and cmd.strip():
        return cmd.strip()

    for key in ("script", "input", "query"):
        val = args.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()

    if name and raw_args and isinstance(raw_args, str) and not args:
        return raw_args.strip() or None
    return None


def _bash_fence(cmd: str) -> str:
    return f"```bash\n{cmd.strip()}\n```"


# When gpt-oss finish=stop with empty content (reasoning-only / truncated),
# inject a cheap status command so mini-swe does not FormatError-thrash.
EMPTY_STOP_RECOVERY_CMD = "git status -sb; git diff --stat"

# After repeated empties, force patch+submit so the run finishes scored
# instead of looping forever (LEAP-021 run g/i hang class).
# Only submit when a tree diff exists; otherwise nudge another edit.
# First stdout line MUST be COMPLETE when submitting (mini-swe has_finished).
EMPTY_STOP_SUBMIT_CMD = (
    "if git diff --quiet; then "
    "git status -sb; "
    "echo 'No diff yet — if wording/message is wrong, pathlib-replace the "
    "description= string only; never sed with \\\\n'; "
    "else "
    "bad=0; failed=''; "
    "for f in $(git diff --name-only --diff-filter=ACMR HEAD -- '*.py' 2>/dev/null); do "
    "  if ! python3 -m py_compile \"$f\" 2>/tmp/spockify_py_compile.err; then "
    "    echo \"py_compile FAILED: $f\"; cat /tmp/spockify_py_compile.err; "
    "    bad=1; failed=\"$failed $f\"; "
    "  fi; "
    "done; "
    "if [ \"$bad\" -ne 0 ]; then "
    "  for f in $failed; do git checkout -- \"$f\" 2>/dev/null || true; done; "
    "  echo 'Reverted invalid .py. Prefer one-line string replace of lint "
    "description text via python3 pathlib.'; "
    "  git status -sb; "
    "else "
    "  git diff -- . > patch.txt; "
    "  if [ ! -s patch.txt ]; then "
    "    echo 'Empty patch after rebuild — keep editing.'; git status -sb; "
    "  else "
    "    echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && cat patch.txt; "
    "  fi; "
    "fi; "
    "fi"
)

# Last-resort finish when empty-stop submit loops under a full 16k context.
# Always prints COMPLETE first so mini-swe ends the instance (empty patch OK).
EMPTY_STOP_HARD_FINISH_CMD = (
    "git diff -- . > patch.txt 2>/dev/null || true; "
    "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT; "
    "if [ -s patch.txt ]; then cat patch.txt; fi"
)

# Ollama sometimes 500s when gpt-oss emits a truncated native tool-call JSON
# (apply_patch etc.) despite tool_choice=none. Soft-fail into a short sed nudge.
TOOL_PARSE_RECOVERY_CMD = (
    "git status -sb; git diff --stat; "
    "echo 'Edit with python3 pathlib replace — never sed with \\\\n or apply_patch'"
)


def _is_ollama_tool_parse_fail(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "error parsing tool call" in msg
        or "unexpected end of json input" in msg
        or ("tool call" in msg and "json" in msg)
    )


def _is_retry_storm_fail(exc: BaseException) -> bool:
    """Soft-fail LiteLLM/Ollama 500 storms that previously hung ESTAB retries."""
    if _is_ollama_tool_parse_fail(exc):
        return True
    msg = str(exc).lower()
    return (
        "internal server error" in msg
        or ("status code" in msg and "500" in msg)
        or ("litellm" in msg and "500" in msg)
    )


def coalesce_assistant_text(message: Any) -> str:
    """Return mini-swe-usable assistant text from a chat completion message."""
    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    content = (content or "").strip()
    if content:
        if "```bash" not in content and "```" in content:
            content = re.sub(
                r"```(?!bash)([^\n]*)\n",
                "```bash\n",
                content,
                count=1,
            )
        return content

    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls is None and isinstance(message, dict):
        tool_calls = message.get("tool_calls")
    if tool_calls:
        cmds: list[str] = []
        for tc in tool_calls:
            if hasattr(tc, "model_dump"):
                tc_d = tc.model_dump()
            elif isinstance(tc, dict):
                tc_d = tc
            else:
                fn = getattr(tc, "function", None)
                tc_d = {
                    "function": {
                        "name": getattr(fn, "name", None),
                        "arguments": getattr(fn, "arguments", None),
                    }
                }
            cmd = _cmd_from_tool_call(tc_d)
            if cmd:
                cmds.append(cmd)
        if len(cmds) == 1:
            logger.info("salvaged tool_call -> bash fence")
            return _bash_fence(cmds[0])
        if len(cmds) > 1:
            logger.warning("multiple tool_calls; using first of %d", len(cmds))
            return _bash_fence(cmds[0])

    reasoning = getattr(message, "reasoning_content", None)
    if reasoning is None and isinstance(message, dict):
        reasoning = message.get("reasoning_content") or message.get("reasoning")
    reasoning = (reasoning or "").strip()
    if reasoning:
        fences = _FENCE_RE.findall(reasoning)
        if len(fences) >= 1:
            logger.info("salvaged fence from reasoning_content")
            return _bash_fence(fences[-1].strip())
        # Inline `cmd` mentions in reasoning.
        ticks = re.findall(r"`([^`\n]{2,200})`", reasoning)
        for cand in reversed(ticks):
            c = cand.strip()
            if re.match(
                r"^(ls|cd|cat|rg|grep|find|sed|awk|python|pytest|git|echo|tee|mkdir)\b",
                c,
            ):
                logger.info("salvaged inline-tick command from reasoning")
                return _bash_fence(c)
        for line in reversed(reasoning.splitlines()):
            line = line.strip()
            if not line or line.endswith(".") or len(line) > 400:
                continue
            for prefix in ("$", "#", "-", "*"):
                if line.startswith(prefix):
                    line = line[1:].strip()
            if re.match(
                r"^(ls|cd|cat|rg|grep|find|sed|awk|python|pytest|git|echo|tee|mkdir)\b",
                line,
            ):
                logger.info("salvaged shell-ish line from reasoning")
                return _bash_fence(line)

    return ""


class SpockifyLitellmModel:
    """Factory that returns a LitellmModel subclass with content salvage.

    Lazy so coalesce_assistant_text unit tests need no mini-swe install.
    """

    def __new__(cls, *args, **kwargs):
        import litellm
        from minisweagent.models.litellm_model import LitellmModel

        class _Impl(LitellmModel):
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                self._empty_stop_streak = 0
                self._empty_stop_submit_attempts = 0

            def _query(self, messages: list[dict[str, str]], **kwargs):
                # Bypass parent tenacity: Ollama tool-parse 500s would otherwise
                # burn ~10 exponential retries on the same broken generation.
                return litellm.completion(
                    model=self.config.model_name,
                    messages=messages,
                    **(self.config.model_kwargs | kwargs),
                )

            def query(self, messages: list[dict[str, str]], **kw) -> dict:
                if self.config.set_cache_control:
                    from minisweagent.models.utils.cache_control import (
                        set_cache_control,
                    )

                    messages = set_cache_control(
                        messages, mode=self.config.set_cache_control
                    )
                # Keep prompt under Ollama 16k: drop oldest tool turns when huge.
                if len(messages) > 40:
                    head, tail = messages[:2], messages[-30:]
                    messages = head + [
                        {
                            "role": "user",
                            "content": (
                                "[earlier steps omitted to free context — "
                                "finish the fix and submit via COMPLETE]"
                            ),
                        }
                    ] + tail
                try:
                    response = self._query(messages, **kw)
                except Exception as e:  # noqa: BLE001 — soft-fail 500 storms
                    if _is_retry_storm_fail(e):
                        logger.warning(
                            "llm 500/tool-parse soft-fail for %s; recovery bash",
                            self.config.model_name,
                        )
                        self.n_calls += 1
                        self._empty_stop_streak += 1
                        return {
                            "content": _bash_fence(TOOL_PARSE_RECOVERY_CMD),
                            "extra": {"error": str(e)[:2000]},
                        }
                    raise
                try:
                    cost = litellm.cost_calculator.completion_cost(response)
                except Exception as e:  # noqa: BLE001 — local OSS tags often unmapped
                    logger.warning(
                        "Cost calc failed for %s: %s; using cost=0",
                        self.config.model_name,
                        e,
                    )
                    cost = 0.0
                self.n_calls += 1
                assert cost >= 0.0, f"Cost is negative: {cost}"
                self.cost += cost
                from minisweagent.models import GLOBAL_MODEL_STATS

                GLOBAL_MODEL_STATS.add(cost)

                message = response.choices[0].message  # type: ignore[index]
                finish = getattr(
                    response.choices[0], "finish_reason", None
                )  # type: ignore[index]
                content = coalesce_assistant_text(message)
                if not content:
                    self._empty_stop_streak += 1
                    logger.warning(
                        "empty salvage for %s (finish=%s streak=%d); injecting recovery",
                        self.config.model_name,
                        finish,
                        self._empty_stop_streak,
                    )
                    if self._empty_stop_streak >= _EMPTY_STOP_SUBMIT_AFTER:
                        self._empty_stop_submit_attempts += 1
                        if (
                            self._empty_stop_submit_attempts
                            >= _EMPTY_STOP_HARD_AFTER
                        ):
                            logger.warning(
                                "empty-stop hard-finish after %d submit attempts",
                                self._empty_stop_submit_attempts,
                            )
                            content = _bash_fence(EMPTY_STOP_HARD_FINISH_CMD)
                        else:
                            content = _bash_fence(EMPTY_STOP_SUBMIT_CMD)
                    else:
                        content = _bash_fence(EMPTY_STOP_RECOVERY_CMD)
                else:
                    self._empty_stop_streak = 0
                return {
                    "content": content,
                    "extra": {"response": response.model_dump()},
                }

        return _Impl(*args, **kwargs)
