"""Detect user prompts that should show a web photo or generate an image."""

from __future__ import annotations

import re

# Explicit create/draw — ComfyUI / Flux.
_IMAGE_GEN_INTENT_RE = re.compile(
    r'(?ix)'
    r'(?:'
    r'(?:^|\b)(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?'
    r'(?:draw|paint|sketch)\s+me\b'
    r'|'
    r'(?:^|\b)(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?'
    r'(?:draw|paint|sketch|illustrate)\s+(?:a|an|the|some|this|that)\s+'
    r'(?!conclusion|distinction|attention|inspiration|from\b|near\b|close\b|back\b)'
    r'|'
    r'\b(?:generate|create|make|render)\s+(?:me\s+|us\s+)?'
    r'(?:an?\s+)?(?:image|picture|photo|illustration|drawing|painting|artwork)\b'
    r'|'
    r'\b(?:generate|create|make)\s+(?:me\s+|us\s+)?(?:an?\s+)?'
    r'(?:logo|icon|poster|banner|thumbnail)\b'
    r'|'
    r'\btext[\s\-]?to[\s\-]?image\b'
    r'|'
    r'\b(?:using|with|via)\s+(?:dall-?e|flux|stable\s*diffusion|comfyui)\b'
    r'|'
    r'\b(?:generate|create|make)\s+(?:me\s+|us\s+)?(?:an?\s+)?'
    r'(?:image\s+)?variation\b'
    r')'
)

# Determiners before image nouns (includes "another").
_IMG_DET = r'(?:an?\s+|the\s+|some\s+|another\s+|one\s+more\s+)?'

# "Show me a picture of …" / "another image of …" — fetch/embed a real web photo.
_WEB_IMAGE_INTENT_RE = re.compile(
    r'(?ix)'
    r'(?:'
    r'(?:^|\b)(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?'
    r'(?:show|display|send)\s+(?:me\s+|us\s+)?'
    + _IMG_DET
    + r'(?:image|picture|photo|illustration|drawing|painting|artwork|one)\b'
    r'|'
    r'\b(?:i\s+(?:want|need|would\s+like)|i\'d\s+like)\s+(?:to\s+see\s+)?'
    + _IMG_DET
    + r'(?:image|picture|photo|illustration|drawing|painting|artwork)\b'
    r'|'
    r'\b(?:find|get|fetch)\s+(?:me\s+|us\s+)?'
    + _IMG_DET
    + r'(?:image|picture|photo)\b'
    r'|'
    # Bare follow-ups after a prior photo turn.
    r'\banother\s+(?:image|picture|photo)\b'
    r'|'
    r'^(?:another\s+one|one\s+more)(?:\s+please)?[\s?.!]*$'
    r'|'
    r'\bmake\s+another\s+(?:one\s+)?like\s+this\b'
    r')'
)

_WEB_IMAGE_QUERY_RE = re.compile(
    r'(?ix)'
    r'(?:'
    r'(?:show|display|send|find|get|fetch)\s+(?:me\s+|us\s+)?'
    + _IMG_DET
    + r'(?:image|picture|photo|illustration|drawing|painting|artwork)\s+'
    r'(?:of\s+|showing\s+|with\s+)?'
    r'|'
    r'(?:i\s+(?:want|need|would\s+like)|i\'d\s+like)\s+(?:to\s+see\s+)?'
    + _IMG_DET
    + r'(?:image|picture|photo|illustration|drawing|painting|artwork)\s+'
    r'(?:of\s+|showing\s+|with\s+)?'
    r'|'
    r'another\s+(?:image|picture|photo)\s+(?:of\s+|showing\s+|with\s+)?'
    r')'
    r'(.+?)\s*$'
)

# "Show me another one?" / "another one" — subject comes from prior turn.
_VAGUE_ANOTHER_RE = re.compile(
    r'(?ix)^\s*(?:please\s+)?'
    r'(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?'
    r'(?:'
    r'(?:show|display|send|find|get|fetch)\s+(?:me\s+|us\s+)?'
    r'(?:another|one\s+more)(?:\s+one)?(?:\s+please)?'
    r'|'
    r'(?:another\s+one|one\s+more)(?:\s+please)?'
    r'|'
    r'make\s+another\s+(?:one\s+)?like\s+this(?:\s*[:.]?\s*.*)?'
    r')'
    r'[\s?.!]*$'
)

_MAKE_ANOTHER_LIKE_THIS_QUERY_RE = re.compile(
    r'(?ix)^\s*(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?'
    r'make\s+another\s+(?:one\s+)?like\s+this\s*[:.]?\s*(.+?)\s*$'
)

_PHOTO_ACK_SUBJECT_RE = re.compile(
    r"(?i)Here's a photo of\s+(.+?)\.?\s*$"
)

_IMAGE_TOOL_ACTION_RE = re.compile(
    r'(?i)(?:text2im|dalle|generate_image|image_generation|txt2img)'
)

# Malformed ReAct blobs that fail json.loads still leak into chat.
_AGENT_IMAGE_JSON_HINT_RE = re.compile(
    r'(?is)["\']?action["\']?\s*:\s*["\'][^"\']*'
    r'(?:text2im|dalle|generate_image|image_generation|txt2img)'
)

_HOWTO_RE = re.compile(
    r'(?i)^\s*(?:how\s+(?:do|can|to|would|should)|what\s+is|why\s+|explain\b|teach\s+me\b)'
)

_TRAILING_PUNCT_RE = re.compile(r'[\s?.!,;:]+$')


def _normalize(text: str | None) -> str | None:
    if not text or not isinstance(text, str):
        return None
    stripped = text.strip()
    if not stripped or len(stripped) > 4000:
        return None
    if _HOWTO_RE.match(stripped):
        return None
    return stripped


def _message_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and part.get('type') in (None, 'text'):
                text = part.get('text')
                if isinstance(text, str):
                    parts.append(text)
        return '\n'.join(parts)
    return ''


def user_message_requests_image_generation(text: str | None) -> bool:
    """True when the user wants Flux/ComfyUI to create an image."""
    stripped = _normalize(text)
    if not stripped:
        return False
    return _IMAGE_GEN_INTENT_RE.search(stripped) is not None


def user_message_requests_web_image(text: str | None) -> bool:
    """True when the user wants an existing photo shown inline (not generated)."""
    stripped = _normalize(text)
    if not stripped:
        return False
    # Draw/generate / "make another like this" wins when both could apply.
    if _IMAGE_GEN_INTENT_RE.search(stripped):
        return False
    return _WEB_IMAGE_INTENT_RE.search(stripped) is not None


def is_vague_web_image_followup(text: str | None) -> bool:
    """True for 'another one' / 'show me another' without a new subject."""
    stripped = _normalize(text)
    if not stripped:
        return False
    if _IMAGE_GEN_INTENT_RE.search(stripped):
        return False
    return _VAGUE_ANOTHER_RE.match(stripped) is not None


def extract_web_image_query(text: str | None) -> str:
    """Pull the subject from 'show me a picture of X' (fallback: full message)."""
    stripped = (text or '').strip()
    if not stripped:
        return ''
    if is_vague_web_image_followup(stripped):
        like_this = _MAKE_ANOTHER_LIKE_THIS_QUERY_RE.match(stripped)
        if like_this:
            query = _TRAILING_PUNCT_RE.sub('', like_this.group(1).strip())
            if query:
                return query
        return ''
    match = _WEB_IMAGE_QUERY_RE.search(stripped)
    if match:
        query = _TRAILING_PUNCT_RE.sub('', match.group(1).strip())
        if query and query.lower() not in ('one', 'another', 'another one'):
            return query
    return _TRAILING_PUNCT_RE.sub('', stripped)


def previous_web_image_subject(messages: list | None) -> str:
    """Recover subject from earlier photo / show-me turns in the chat."""
    if not messages:
        return ''
    prior = messages[:-1] if len(messages) > 1 else messages
    for msg in reversed(prior):
        if not isinstance(msg, dict):
            continue
        text = _message_text(msg.get('content')).strip()
        if not text:
            continue
        role = msg.get('role')
        if role == 'assistant':
            ack = _PHOTO_ACK_SUBJECT_RE.search(text)
            if ack:
                return _TRAILING_PUNCT_RE.sub('', ack.group(1).strip())
            continue
        if role != 'user':
            continue
        if is_vague_web_image_followup(text):
            continue
        if user_message_requests_web_image(text):
            query = extract_web_image_query(text)
            if query:
                return query
        if user_message_requests_image_generation(text):
            # Variation of a prior Flux subject can still seed a photo search.
            query = extract_web_image_query(text)
            if query and query.lower() != text.lower().rstrip('.!?'):
                return query
            cleaned = _IMAGE_GEN_INTENT_RE.sub('', text).strip()
            cleaned = _TRAILING_PUNCT_RE.sub('', cleaned)
            if cleaned:
                return cleaned
    return ''


def count_prior_web_photo_acks(messages: list | None) -> int:
    """How many assistant turns already showed an embedded web photo."""
    if not messages:
        return 0
    count = 0
    for msg in messages:
        if not isinstance(msg, dict) or msg.get('role') != 'assistant':
            continue
        text = _message_text(msg.get('content')).strip()
        if text and _PHOTO_ACK_SUBJECT_RE.search(text):
            count += 1
    return count


def resolve_web_image_query(text: str | None, messages: list | None = None) -> str:
    """Subject for SearXNG: explicit query, else prior-turn subject for follow-ups."""
    if is_vague_web_image_followup(text):
        return previous_web_image_subject(messages) or ''
    query = extract_web_image_query(text)
    if query:
        return query
    return previous_web_image_subject(messages) or ''


def is_image_tool_action(action: str | None) -> bool:
    """True for leaked ReAct/tool actions that mean text-to-image."""
    if not action:
        return False
    return _IMAGE_TOOL_ACTION_RE.search(str(action)) is not None


def text_looks_like_image_agent_json(text: str | None) -> bool:
    """Heuristic for dalle/text2im ReAct JSON even when json.loads fails."""
    if not text or not isinstance(text, str):
        return False
    stripped = text.strip()
    if '{' not in stripped:
        return False
    if _AGENT_IMAGE_JSON_HINT_RE.search(stripped):
        return True
    lower = stripped.lower()
    return 'action' in lower and (
        'dalle' in lower or 'text2im' in lower or 'generate_image' in lower
    )
