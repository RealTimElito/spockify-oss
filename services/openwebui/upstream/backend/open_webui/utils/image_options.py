"""Per-turn image aspect / style options for ComfyUI Flux generation."""

from __future__ import annotations

# Aspect chips → width×height. 1K is the Flux sweet spot. 2K is Qwen-Image 2.1
# (long edge 2048, multiples of 16 for EmptyQwenImage21Latent).
ASPECT_SIZES: dict[str, dict[str, str]] = {
    '1k': {
        'square': '1024x1024',
        'wide': '1344x768',
        'tall': '768x1344',
    },
    '2k': {
        'square': '2048x2048',
        'wide': '2048x1152',
        'tall': '1152x2048',
    },
}

# Style chips → prompt suffix (text2img; no separate img2img workflow).
STYLE_SUFFIXES: dict[str, str] = {
    'photo': ', photorealistic photograph, natural lighting, detailed',
    'illustration': ', digital illustration, stylized artwork, clean lines',
}


def normalize_aspect(value: str | None) -> str:
    key = (value or 'square').strip().lower()
    return key if key in ASPECT_SIZES['1k'] else 'square'


def normalize_resolution(value: str | None) -> str:
    key = (value or '1k').strip().lower()
    return key if key in ASPECT_SIZES else '1k'


def normalize_style(value: str | None) -> str:
    key = (value or '').strip().lower()
    if key in ('', 'none', 'default'):
        return ''
    return key if key in STYLE_SUFFIXES else ''


def resolve_image_size(aspect: str | None, resolution: str | None = None) -> str:
    tier = normalize_resolution(resolution)
    return ASPECT_SIZES[tier][normalize_aspect(aspect)]


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
