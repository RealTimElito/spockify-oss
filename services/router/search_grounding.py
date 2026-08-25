"""Fetch page excerpts for SearXNG hits to ground factual answers.

Snippets alone are often stale or truncated; quoting from fetched page text
reduces hallucinated citations.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
import socket
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

LOG = logging.getLogger("spockify.router.grounding")

GROUNDING_MAX_PAGES = int(os.getenv("SEARCH_GROUNDING_MAX_PAGES", "3"))
GROUNDING_MAX_CHARS = int(os.getenv("SEARCH_GROUNDING_MAX_CHARS", "3500"))
GROUNDING_TIMEOUT = float(os.getenv("SEARCH_GROUNDING_TIMEOUT", "10"))
GROUNDING_UA = "SpockifyRouter/0.4 (+https://spockify.eu; search-grounding)"

_SCRIPT_STYLE_RE = re.compile(
    r"<(?:script|style|noscript|iframe|svg)[^>]*>[\s\S]*?</(?:script|style|noscript|iframe|svg)>",
    re.IGNORECASE,
)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

_SKIP_HOST_SUFFIXES = (
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "pinterest.com",
    "linkedin.com",
    "reddit.com",
    "youtube.com",
    "youtu.be",
    "guce.yahoo.com",
    "consent.yahoo.com",
)

_STOP_TERMS = frozenset(
    {
        "the",
        "and",
        "for",
        "what",
        "who",
        "when",
        "where",
        "how",
        "does",
        "from",
        "with",
        "that",
        "this",
        "about",
        "please",
        "according",
    }
)

_QUOTE_WORTHY_RE = re.compile(
    r"(?i)\b(?:"
    r"according\s+to|quote|said|states?\s+that|claims?|"
    r"what\s+does|who\s+is|when\s+was|where\s+is|"
    r"documentation|docs\b|readme|release\s+notes|"
    r"latest\s+version|official|"
    r"news|headline|article|report|"
    r"define|definition|meaning\s+of"
    r")\b"
)


def wants_page_grounding(query: str) -> bool:
    """Heuristic: fetch full pages for factual / citation-heavy questions."""
    q = (query or "").strip()
    if len(q) < 8:
        return False
    if _QUOTE_WORTHY_RE.search(q):
        return True
    if "?" in q and len(q) > 20:
        return True
    return False


def _host_is_private(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return True
    return False


def _url_fetchable(url: str) -> bool:
    parsed = urlparse(url or "")
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host or _host_is_private(host):
        return False
    for suffix in _SKIP_HOST_SUFFIXES:
        if host == suffix or host.endswith("." + suffix):
            return False
    return True


def html_to_plain(html: str, max_len: int = GROUNDING_MAX_CHARS) -> str:
    cleaned = _SCRIPT_STYLE_RE.sub(" ", html or "")
    text = _TAG_RE.sub(" ", cleaned)
    text = _WS_RE.sub(" ", text).strip()
    # Cookie / consent interstitial — useless for grounding.
    lowered = text.lower()
    if (
        "cookie" in lowered
        and ("consent" in lowered or "integritets" in lowered or "privacy" in lowered)
        and len(text) < 4000
    ):
        if "guce" in lowered or "collectconsent" in lowered or "accept all" in lowered:
            return ""
    if len(text) > max_len:
        text = text[: max_len - 1].rstrip() + "…"
    return text


def extract_query_excerpts(
    text: str,
    query: str,
    *,
    window: int = 220,
    max_excerpts: int = 4,
) -> str:
    """Pull extractive snippets around query terms; fall back to page head."""
    if not text:
        return ""
    terms = [
        t.lower()
        for t in re.findall(r"[A-Za-z0-9]{3,}", query or "")
        if t.lower() not in _STOP_TERMS
    ]
    lowered = text.lower()
    spans: list[tuple[int, int]] = []
    seen: set[str] = set()
    for term in terms[:12]:
        start = 0
        while len(spans) < max_excerpts * 2:
            idx = lowered.find(term, start)
            if idx < 0:
                break
            a = max(0, idx - window // 2)
            b = min(len(text), idx + len(term) + window // 2)
            key = text[a:b].strip().lower()[:80]
            if key and key not in seen:
                seen.add(key)
                spans.append((a, b))
            start = idx + len(term)
            if start >= len(lowered):
                break
    if not spans:
        return text[: min(len(text), GROUNDING_MAX_CHARS)]

    spans.sort()
    merged: list[list[int]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1] + 40:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    parts = [text[a:b].strip() for a, b in merged[:max_excerpts]]
    joined = " … ".join(p for p in parts if p)
    if len(joined) > GROUNDING_MAX_CHARS:
        joined = joined[: GROUNDING_MAX_CHARS - 1].rstrip() + "…"
    return joined


async def fetch_page_excerpt(
    client: httpx.AsyncClient,
    url: str,
    query: str,
) -> str:
    if not _url_fetchable(url):
        return ""
    try:
        resp = await client.get(
            url,
            timeout=GROUNDING_TIMEOUT,
            follow_redirects=True,
            headers={
                "User-Agent": GROUNDING_UA,
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            },
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        LOG.info("grounding fetch failed %s: %s", url, exc)
        return ""
    final = str(resp.url)
    if not _url_fetchable(final):
        return ""
    ctype = (resp.headers.get("content-type") or "").lower()
    body = resp.text or ""
    if "html" in ctype or body.lstrip().startswith("<"):
        plain = html_to_plain(body)
    else:
        plain = _WS_RE.sub(" ", body).strip()[:GROUNDING_MAX_CHARS]
    return extract_query_excerpts(plain, query)


async def fetch_grounding_excerpts(
    client: httpx.AsyncClient,
    results: list[dict[str, Any]],
    query: str,
    *,
    max_pages: int = GROUNDING_MAX_PAGES,
) -> list[str]:
    """Fetch top result pages in parallel; return prompt lines."""
    urls: list[str] = []
    for r in results:
        url = (r.get("url") or "").strip()
        if url and url not in urls and _url_fetchable(url):
            urls.append(url)
        if len(urls) >= max_pages:
            break
    if not urls:
        return []

    async def _one(u: str) -> Optional[str]:
        excerpt = await fetch_page_excerpt(client, u, query)
        if not excerpt or len(excerpt) < 40:
            return None
        LOG.info("grounding enriched %s (%d chars)", u, len(excerpt))
        return f"Fetched page content from {u}:\n   {excerpt}\n"

    chunks = await asyncio.gather(*[_one(u) for u in urls])
    return [c for c in chunks if c]
