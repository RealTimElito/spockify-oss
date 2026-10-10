"""Fetch a public web image (SearXNG) and store it for inline chat display."""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlparse

from open_webui.retrieval.web.utils import validate_url
from open_webui.routers.images import get_image_data, upload_image
from open_webui.utils.image_intent import count_prior_web_photo_acks
from open_webui.utils.session_pool import get_session

log = logging.getLogger(__name__)

# Prefer stock/photo CDNs that usually serve direct image bytes.
_PREFERRED_HOST_SUFFIXES = (
    'images.unsplash.com',
    'plus.unsplash.com',
    'images.pexels.com',
    'images.pixabay.com',
    'cdn.pixabay.com',
    'upload.wikimedia.org',
    'live.staticflickr.com',
    'farm66.staticflickr.com',
    'i.imgur.com',
)

_SKIP_HOST_HINTS = (
    'javascript:',
    'data:',
    'lucide-static',
    'icon',
    'favicon',
    'sprite',
    'logo.svg',
)

_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_MAX_CANDIDATES = 12


def _host_rank(url: str) -> int:
    try:
        host = (urlparse(url).hostname or '').lower()
    except Exception:
        return 100
    for idx, suffix in enumerate(_PREFERRED_HOST_SUFFIXES):
        if host == suffix or host.endswith('.' + suffix):
            return idx
    return 50


def _looks_like_image_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    lower = url.lower().strip()
    if not lower.startswith(('http://', 'https://')):
        return False
    if any(hint in lower for hint in _SKIP_HOST_HINTS):
        return False
    path = urlparse(lower).path
    if path.endswith(('.svg', '.ico', '.html', '.htm', '.php', '.asp')):
        return False
    return True


def _candidate_urls(item: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for key in ('img_src', 'thumbnail_src', 'thumbnail', 'url'):
        val = item.get(key)
        if isinstance(val, str) and val.strip():
            urls.append(val.strip())
    # Dedupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u not in seen and _looks_like_image_url(u):
            seen.add(u)
            out.append(u)
    return out


async def search_web_image_candidates(
    searxng_query_url: str,
    query: str,
    *,
    count: int = 8,
    pageno: int = 1,
) -> list[str]:
    """Return ranked direct image URLs from SearXNG image search."""
    if not query or not searxng_query_url:
        return []

    query_url = searxng_query_url
    if '<query>' in query_url:
        query_url = query_url.split('?')[0]

    params = {
        'q': query,
        'format': 'json',
        'categories': 'images',
        'pageno': max(1, int(pageno)),
        'safesearch': '1',
        'language': 'all',
        'image_proxy': 0,
    }
    headers = {
        'User-Agent': 'Spockify (https://github.com/open-webui/open-webui) image embed',
        'Accept': 'application/json',
    }

    session = await get_session()
    async with session.get(query_url, headers=headers, params=params) as response:
        response.raise_for_status()
        payload = await response.json()

    results = payload.get('results') or []
    scored: list[tuple[int, str]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        for url in _candidate_urls(item):
            scored.append((_host_rank(url), url))

    scored.sort(key=lambda pair: (pair[0], pair[1]))
    out: list[str] = []
    seen: set[str] = set()
    for _, url in scored:
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
        if len(out) >= max(count, _MAX_CANDIDATES):
            break
    return out


async def download_and_store_web_image(
    request,
    image_url: str,
    metadata: dict,
    user,
) -> str | None:
    """Download a public image URL and upload to OWUI files (same-origin URL)."""
    try:
        validate_url(image_url)
    except Exception as exc:
        log.debug('web image URL rejected: %s (%s)', image_url, exc)
        return None

    image_data, content_type = await get_image_data(image_url)
    if not image_data or not content_type:
        return None
    if len(image_data) > _MAX_IMAGE_BYTES:
        log.warning('web image too large (%s bytes): %s', len(image_data), image_url)
        return None
    if not str(content_type).startswith('image/'):
        return None
    # Skip tiny icons / broken payloads
    if len(image_data) < 2048:
        return None

    _, stored_url = await upload_image(
        request,
        image_data,
        content_type.split(';')[0].strip(),
        metadata,
        user,
    )
    return stored_url


async def fetch_embeddable_web_image(
    request,
    query: str,
    metadata: dict,
    user,
    *,
    searxng_query_url: str | None = None,
    messages: list | None = None,
) -> tuple[str | None, str | None]:
    """Search + download first workable image. Returns (stored_url, source_url)."""
    searx = (
        searxng_query_url
        or getattr(request.app.state.config, 'SEARXNG_QUERY_URL', None)
        or ''
    ).strip()
    if not searx:
        return None, None

    prior_photos = count_prior_web_photo_acks(messages)
    skip = max(0, prior_photos)
    pageno = 1 + (skip // 8)

    try:
        candidates = await search_web_image_candidates(
            searx, query, count=12, pageno=pageno
        )
    except Exception as exc:
        log.warning('SearXNG image search failed for %r: %s', query, exc)
        candidates = []

    if skip and candidates:
        offset = skip % 8
        if offset < len(candidates):
            candidates = candidates[offset:]
        elif pageno == 1:
            try:
                candidates = await search_web_image_candidates(
                    searx, query, count=12, pageno=2
                )
            except Exception as exc:
                log.warning('SearXNG image search page 2 failed for %r: %s', query, exc)
                candidates = []

    for source_url in candidates:
        try:
            stored = await download_and_store_web_image(
                request, source_url, metadata, user
            )
        except Exception as exc:
            log.debug('web image fetch failed for %s: %s', source_url, exc)
            continue
        if stored:
            return stored, source_url
    return None, None


_ALT_SANITIZE_RE = re.compile(r'[\[\]\(\)\n\r]+')


def web_image_assistant_ack(query: str, stored_url: str = '') -> str:
    """Text-only ack; image is shown once via the files attachment (Flux-style).

    stored_url is unused (kept for call-site compat). Do not embed markdown
    images here — ResponseMessage already renders message.files.
    """
    alt = _ALT_SANITIZE_RE.sub(' ', (query or 'photo').strip())[:80] or 'photo'
    return f"Here's a photo of {alt}."
