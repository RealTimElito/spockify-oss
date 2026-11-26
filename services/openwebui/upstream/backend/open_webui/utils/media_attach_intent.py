"""Resolve this-turn image attach + prompt → I2V vs image edit.

Product rules (AGENTS.md):
- Txt2img when there is no this-turn attach.
- History pictures never force Flux img2img (or I2V).
- Edit only with a this-turn user attach.
- Clear motion/video language → image-to-video.
- Clear still-image edit language → img2img / edit.
- Ambiguous: honor the active composer toggle (video row → I2V,
  image row → edit). If neither toggle is on, do not auto-run gen
  (vision chat) — avoids surprising GPU jobs from vague prompts.
"""

from __future__ import annotations

import re
from typing import Literal

from open_webui.utils.image_intent import (
    get_images_from_last_user_message,
    user_message_requests_image_generation,
)
from open_webui.utils.video_intent import user_message_requests_video_generation

AttachMediaIntent = Literal['i2v', 'edit', 'none']

_HOWTO_RE = re.compile(
    r'(?i)^\s*(?:how\s+(?:do|can|to|would|should)|what\s+is|why\s+'
    r'|explain\b|teach\s+me\b)'
)

# Attach-gated motion / I2V cues (beyond explicit "generate a video").
_I2V_MOTION_RE = re.compile(
    r'(?ix)'
    r'(?:'
    r'\bmake\s+(?:it|this|her|him|them|the\s+(?:image|photo|picture|drawing))\s+'
    r'(?:move|walk|run|dance|fly|swim|talk|speak|blink|wave|nod|turn|spin)\b'
    r'|'
    r'\banimate\s+(?:it|this|the\s+(?:image|photo|picture|drawing)|me\s+this)\b'
    r'|'
    r'\bbring\s+(?:it|this|her|him|them)\s+to\s+life\b'
    r'|'
    r'\b(?:add|give\s+(?:it|this))\s+(?:some\s+)?(?:motion|movement|life)\b'
    r'|'
    r'\bcamera\s+(?:pan|zoom|dolly|orbit|tracking|push|pull|tilt|truck)\b'
    r'|'
    r'\b(?:slow\s+)?(?:pan|dolly|orbit)\s+(?:across|around|in|out|over)\b'
    r'|'
    r'\bturn\s+(?:it|this)\s+into\s+(?:an?\s+)?(?:video|clip|animation)\b'
    r'|'
    r'\b(?:make|create|render)\s+(?:me\s+|us\s+)?'
    r'(?:an?\s+)?(?:video|clip|animation)\s+(?:of\s+|from\s+)?(?:this|it)\b'
    r'|'
    r'\bimage[\s\-]?to[\s\-]?video\b'
    r'|'
    r'\bi2v\b'
    r')'
)

# Attach-gated still-image edit cues.
_IMAGE_EDIT_RE = re.compile(
    r'(?ix)'
    r'(?:'
    r'\b(?:change|replace|remove|erase|delete|swap|edit|restyle|recolor|'
    r'repaint|inpaint|retouch|upscale|enhance|crop)\b'
    r'|'
    r'\b(?:add|put)\s+(?:a|an|the|some)\b'
    r'|'
    r'\bmake\s+(?:it|this|her|him|them)\s+(?:look|be|more|less|into)\b'
    r'|'
    r'\bturn\s+(?:it|this)\s+into\b(?!\s+(?:an?\s+)?(?:video|clip|animation)\b)'
    r'|'
    r'\b(?:edit|modify|fix|update)\s+(?:this|the)\s+'
    r'(?:image|photo|picture|drawing)\b'
    r'|'
    r'\b(?:change|replace|remove|swap)\s+(?:the\s+)?'
    r'(?:background|sky|hair|clothes|clothing|outfit|color|colour)\b'
    r'|'
    r'\bimage[\s\-]?to[\s\-]?image\b'
    r'|'
    r'\bimg2img\b'
    r')'
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


def user_message_requests_i2v_motion(text: str | None) -> bool:
    """True for attach-context motion / animate-this cues (not howto)."""
    stripped = _normalize(text)
    if not stripped:
        return False
    if user_message_requests_video_generation(stripped):
        return True
    return _I2V_MOTION_RE.search(stripped) is not None


def user_message_requests_image_edit(text: str | None) -> bool:
    """True for attach-context still-image edit cues (not howto)."""
    stripped = _normalize(text)
    if not stripped:
        return False
    # Explicit create-an-image language still counts as edit when attached.
    if user_message_requests_image_generation(stripped):
        return True
    return _IMAGE_EDIT_RE.search(stripped) is not None


def messages_have_this_turn_image_attach(messages) -> bool:
    """True only for fresh this-turn user image files (history ignored)."""
    groups = get_images_from_last_user_message(messages)
    return any(bool(group) for group in groups)


def resolve_attach_media_intent(
    text: str | None,
    *,
    has_this_turn_attach: bool,
    video_toggle: bool = False,
    image_toggle: bool = False,
) -> AttachMediaIntent:
    """Pick I2V, image edit, or none for this-turn attach + prompt.

    Clear motion/video → i2v. Clear still edit → edit. When both match,
    prefer i2v (motion nouns are more specific). Ambiguous prompts honor
    the active composer row; with neither toggle on → none.
    """
    if not has_this_turn_attach:
        return 'none'

    wants_i2v = user_message_requests_i2v_motion(text)
    wants_edit = user_message_requests_image_edit(text)

    if wants_i2v and not wants_edit:
        return 'i2v'
    if wants_edit and not wants_i2v:
        return 'edit'
    if wants_i2v and wants_edit:
        # "turn this into a video" / "animate and change…" → video wins.
        return 'i2v'

    # Ambiguous: stay on whichever composer mode is already active.
    if video_toggle and not image_toggle:
        return 'i2v'
    if image_toggle and not video_toggle:
        return 'edit'
    if video_toggle and image_toggle:
        # Integrations menu normally clears the other; prefer video if both.
        return 'i2v'
    return 'none'
