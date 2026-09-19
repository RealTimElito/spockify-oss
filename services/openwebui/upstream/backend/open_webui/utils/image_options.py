"""Per-turn image aspect / style options for ComfyUI Flux generation."""

from __future__ import annotations

# Aspect chips → EmptyLatentImage width×height (near 1024² Flux sweet spot).
ASPECT_SIZES: dict[str, str] = {
    'square': '1024x1024',
    'wide': '1344x768',
    'tall': '768x1344',
}

# Style chips → prompt suffix (text2img; no separate img2img workflow).
STYLE_SUFFIXES: dict[str, str] = {
    'photo': ', photorealistic photograph, natural lighting, detailed',
    'illustration': ', digital illustration, stylized artwork, clean lines',
}


def normalize_aspect(value: str | None) -> str:
    key = (value or 'square').strip().lower()
    return key if key in ASPECT_SIZES else 'square'


def normalize_style(value: str | None) -> str:
    key = (value or '').strip().lower()
    if key in ('', 'none', 'default'):
        return ''
    return key if key in STYLE_SUFFIXES else ''


def resolve_image_size(aspect: str | None) -> str:
    return ASPECT_SIZES[normalize_aspect(aspect)]


def apply_style_to_prompt(prompt: str, style: str | None) -> str:
    """Append a style suffix once; skip if already present."""
    text = (prompt or '').strip()
    style_key = normalize_style(style)
    if not text or not style_key:
        return text
    suffix = STYLE_SUFFIXES[style_key]
    if suffix.lstrip(', ').lower() in text.lower():
        return text
    return f'{text}{suffix}'
