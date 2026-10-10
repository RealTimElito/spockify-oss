"""Detect user prompts that should generate a video via ComfyUI / LTX-Video.

Mirrors image_intent.py's structure. Unlike images there is no "show me an
existing video" web-fetch path — video intent only ever means "generate one".
The regex intentionally requires an explicit video/clip/animation noun so it
never collides with the image-generation intent (which requires an
image/picture/photo/... noun) — both can be checked independently in the
same message without one shadowing the other.
"""

from __future__ import annotations

import re

# Explicit create/animate — ComfyUI / LTX-Video.
_VIDEO_GEN_INTENT_RE = re.compile(
    r'(?ix)'
    r'(?:'
    r'(?:^|\b)(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?'
    r'animate\s+(?:me\s+|us\s+)?(?:a|an|the|this|that)\b'
    r'|'
    r'\b(?:generate|create|make|render)\s+(?:me\s+|us\s+)?'
    r'(?:an?\s+)?(?:video|clip|animation)\b'
    r'(?!\s+(?:game|call|chat|conference|meeting|doorbell))'
    r'|'
    r'\btext[\s\-]?to[\s\-]?video\b'
    r'|'
    r'\bltx[\s\-]?v(?:ideo)?\b'
    r')'
)

# Strip the intent wrapper so ComfyUI gets the subject, not "generate a video of …".
_VIDEO_PROMPT_RE = re.compile(
    r'(?ix)^\s*(?:please\s+)?'
    r'(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?'
    r'(?:'
    r'(?:generate|create|make|render)\s+(?:me\s+|us\s+)?'
    r'(?:an?\s+)?(?:video|clip|animation)\s+(?:of\s+|showing\s+|with\s+|about\s+)?'
    r'|'
    r'animate\s+(?:me\s+|us\s+)?(?:a|an|the|this|that)\s+'
    r'|'
    r'text[\s\-]?to[\s\-]?video\s+(?:of\s+|showing\s+|with\s+|about\s+)?'
    r'|'
    r'ltx[\s\-]?v(?:ideo)?\s*(?::\s*|\s+of\s+)?'
    r')'
    r'(.+?)\s*$'
)

_HOWTO_RE = re.compile(
    r'(?i)^\s*(?:how\s+(?:do|can|to|would|should)|what\s+is|why\s+'
    r'|explain\b|teach\s+me\b)'
)


def _normalize(text: str | None) -> str | None:
    if not text or not isinstance(text, str):
        return None
    stripped = text.strip()
    if not stripped or len(stripped) > 4000:
        return None
    if _HOWTO_RE.match(stripped):
        return None
    return stripped


def user_message_requests_video_generation(text: str | None) -> bool:
    """True when the user wants ComfyUI/LTX-Video to generate a video clip."""
    stripped = _normalize(text)
    if not stripped:
        return False
    return _VIDEO_GEN_INTENT_RE.search(stripped) is not None


def extract_video_prompt(text: str | None) -> str:
    """Subject for LTX — 'generate a video of a red cube' → 'a red cube'."""
    stripped = (text or '').strip()
    if not stripped:
        return ''
    match = _VIDEO_PROMPT_RE.match(stripped)
    if match and match.group(1):
        subject = match.group(1).strip().rstrip('.!?')
        if subject:
            return subject
    return stripped
