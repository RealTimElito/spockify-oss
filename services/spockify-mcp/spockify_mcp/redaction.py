"""Redact secrets from command output before returning to agents."""

from __future__ import annotations

import re

# Order matters: longer / more specific patterns first.
_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)(authorization:\s*bearer\s+)\S+", re.MULTILINE), r"\1[REDACTED]"),
    (re.compile(r"(?i)(api[_-]?key\s*[:=]\s*)\S+", re.MULTILINE), r"\1[REDACTED]"),
    (re.compile(r"(?i)(token\s*[:=]\s*)\S+", re.MULTILINE), r"\1[REDACTED]"),
    (re.compile(r"(?i)(password\s*[:=]\s*)\S+", re.MULTILINE), r"\1[REDACTED]"),
    (re.compile(r"(?i)(secret\s*[:=]\s*)\S+", re.MULTILINE), r"\1[REDACTED]"),
    (re.compile(r"(?i)(LITELLM_MASTER_KEY\s*[:=]\s*)\S+", re.MULTILINE), r"\1[REDACTED]"),
    (re.compile(r"(?i)(sk-[a-zA-Z0-9]{20,})"), "[REDACTED]"),
    (re.compile(r"(?i)(Bearer\s+)[A-Za-z0-9._\-+/=]{8,}"), r"\1[REDACTED]"),
    # base64-ish secret data lines from kubectl get secret -o yaml (rough heuristic)
    (
        re.compile(r"(?m)^(\s+[a-zA-Z0-9_.-]+:\s+)[A-Za-z0-9+/=]{24,}\s*$"),
        r"\1[REDACTED]",
    ),
)


def redact(text: str) -> str:
    """Return text with likely secrets masked."""
    if not text:
        return text
    out = text
    for pattern, repl in _PATTERNS:
        out = pattern.sub(repl, out)
    return out
