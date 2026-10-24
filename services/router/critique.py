"""Optional silent auto-critique / confidence pass (Wave 8.3)."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Awaitable, Callable, Optional

LOG = logging.getLogger("spockify.router.critique")

CRITIQUE_ENABLED = os.getenv("CRITIQUE_ENABLED", "0").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
CRITIQUE_AUTO_CHARS = int(os.getenv("CRITIQUE_AUTO_CHARS", "1200"))
CRITIQUE_MODEL = os.getenv("CRITIQUE_MODEL", "").strip()
CRITIQUE_MAX_TOKENS = int(os.getenv("CRITIQUE_MAX_TOKENS", "256"))

ChatFn = Callable[..., Awaitable[dict[str, Any]]]

_JSON_RE = re.compile(r"\{[\s\S]*\}")


def should_critique(
    answer: str,
    *,
    force: bool = False,
    enabled: Optional[bool] = None,
) -> bool:
    on = CRITIQUE_ENABLED if enabled is None else enabled
    if force:
        return True
    if not on:
        return False
    return len((answer or "").strip()) >= CRITIQUE_AUTO_CHARS


def _parse_critique(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    m = _JSON_RE.search(raw)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict):
                level = str(data.get("level") or data.get("confidence") or "medium").lower()
                if level not in ("high", "medium", "low"):
                    level = "medium"
                notes = str(data.get("notes") or data.get("flags") or "").strip()
                return {"level": level, "notes": notes[:800], "raw": raw[:1200]}
        except json.JSONDecodeError:
            pass
    lowered = raw.lower()
    if "low" in lowered or "uncertain" in lowered:
        level = "low"
    elif "high" in lowered or "confident" in lowered:
        level = "high"
    else:
        level = "medium"
    return {"level": level, "notes": raw[:800], "raw": raw[:1200]}


async def run_critique(
    *,
    client: Any,
    chat_fn: ChatFn,
    question: str,
    answer: str,
    model: Optional[str] = None,
) -> dict[str, Any]:
    """Second-pass critic. Returns {level, notes}."""
    worker = (model or CRITIQUE_MODEL or "").strip() or "llama3.2-3b"
    system = (
        "You are a silent confidence critic for Spockify. "
        "Given a user question and an assistant answer, flag uncertain or "
        "unsupported claims. Reply with ONLY JSON: "
        '{"level":"high|medium|low","notes":"short bullets"}'
    )
    user = (
        f"Question:\n{(question or '')[:2000]}\n\n"
        f"Answer:\n{(answer or '')[:6000]}\n"
    )
    try:
        result = await chat_fn(
            client,
            worker,
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=CRITIQUE_MAX_TOKENS,
            temperature=0.1,
        )
        content = ""
        choices = result.get("choices") or []
        if choices:
            msg = choices[0].get("message") or {}
            content = str(msg.get("content") or "")
        parsed = _parse_critique(content)
        parsed["model"] = worker
        return parsed
    except Exception as exc:  # noqa: BLE001
        LOG.warning("critique failed: %s", exc)
        return {
            "level": "medium",
            "notes": "critique unavailable",
            "error": str(exc),
            "model": worker,
        }
