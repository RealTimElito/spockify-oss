"""Refuse offensive / exploit intents. Lab harness is benign coding only."""

from __future__ import annotations

import re

# Surface-level gate — not a jailbreak bypass; blocks obvious attack asks.
_FORBIDDEN = re.compile(
    r"(?is)\b("
    r"exploit|payload|shellcode|buffer\s*overflow|privilege\s*escalat|"
    r"ransomware|keylogger|backdoor|c2\b|command\s*and\s*control|"
    r"unauthorized\s*access|sql\s*injection|xss\b|csrf\b|"
    r"phishing|credential\s*harvest|malware|rootkit|"
    r"attack\s*chain|offensive\s*cyber|weaponiz|"
    r"jailbreak|uncensor|abliterat.*attack|mythos\s*attack"
    r")\b"
)

_ALLOWED_LAB_CONTEXT = re.compile(
    r"(?is)\b(refactor|implement|fix|test|lint|docs?|readme|"
    r" typ[eo]|bug|feature|api|cli|ui|css|python|typescript|"
    r"javascript|go\b|rust|java|sql\s*schema|migrate|unit\s*test)\b"
)


def refuse_reason(task: str) -> str | None:
    """Return a short refuse message if *task* looks offensive; else None."""
    text = (task or "").strip()
    if not text:
        return "empty task"
    if _FORBIDDEN.search(text):
        return (
            "refusing: this lab harness is for benign coding only "
            "(no attack/exploit/offensive cyber)."
        )
    return None
