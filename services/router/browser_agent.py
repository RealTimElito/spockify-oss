"""Allowlisted browser fetch for Spockify agents (Wave 8.1 / Wave 9.1).

Default: HTTP(S) GET → HTML → plain text. Playwright click/type when
PLAYWRIGHT_WS_URL is set, or local Chromium when PLAYWRIGHT_LOCAL=1.
Falls back to fetch if Playwright unavailable.
"""

from __future__ import annotations

import html
import ipaddress
import logging
import os
import re
import socket
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.browser")

BROWSER_ALLOWLIST = [
    d.strip().lower().lstrip(".")
    for d in os.getenv("BROWSER_ALLOWLIST", "").split(",")
    if d.strip()
]
BROWSER_REQUIRE_CONFIRM = os.getenv(
    "BROWSER_REQUIRE_CONFIRM",
    "1" if "*" in BROWSER_ALLOWLIST else "0",
).lower() in ("1", "true", "yes", "on")
BROWSER_MAX_CHARS = int(os.getenv("BROWSER_MAX_CHARS", "24000"))
BROWSER_TIMEOUT = float(os.getenv("BROWSER_TIMEOUT", "20"))
PLAYWRIGHT_WS_URL = (os.getenv("PLAYWRIGHT_WS_URL") or "").strip()
PLAYWRIGHT_LOCAL = os.getenv("PLAYWRIGHT_LOCAL", "0").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

_TAG_RE = re.compile(r"<[^>]+>", re.DOTALL)
_SCRIPT_RE = re.compile(
    r"<(script|style|noscript|iframe|svg)[^>]*>[\s\S]*?</\1>",
    re.IGNORECASE,
)
_TITLE_RE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.IGNORECASE)
_WS_RE = re.compile(r"[ \t]+\n")
_MULTI_NL = re.compile(r"\n{3,}")


class BrowserFetchRequest(BaseModel):
    url: str
    confirm: bool = False
    action: Optional[str] = None  # navigate | click | type (playwright only)
    selector: Optional[str] = None
    text: Optional[str] = None
    summarize: bool = False


def _host_allowed(host: str) -> bool:
    host = (host or "").lower().rstrip(".")
    if not host:
        return False
    if "*" in BROWSER_ALLOWLIST:
        return True
    if not BROWSER_ALLOWLIST:
        return False
    for entry in BROWSER_ALLOWLIST:
        if entry == "*":
            return True
        if host == entry or host.endswith("." + entry):
            return True
    return False


def _is_private_host(host: str) -> bool:
    """Block SSRF to private/link-local/metadata addresses."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
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


def validate_browse_url(url: str, *, confirm: bool = False) -> tuple[bool, str]:
    raw = (url or "").strip()
    if not raw:
        return False, "url required"
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        return False, "only http(s) allowed"
    if not parsed.hostname:
        return False, "missing host"
    host = parsed.hostname.lower()
    if _is_private_host(host):
        return False, "private or local addresses blocked"
    if not _host_allowed(host):
        return False, f"host not in BROWSER_ALLOWLIST: {host}"
    if BROWSER_REQUIRE_CONFIRM and "*" in BROWSER_ALLOWLIST and not confirm:
        return False, "confirm=true required for open allowlist (*)"
    return True, ""


def html_to_text(raw_html: str) -> tuple[str, str]:
    title = ""
    m = _TITLE_RE.search(raw_html or "")
    if m:
        title = html.unescape(_TAG_RE.sub("", m.group(1))).strip()
    cleaned = _SCRIPT_RE.sub(" ", raw_html or "")
    text = _TAG_RE.sub(" ", cleaned)
    text = html.unescape(text)
    text = _WS_RE.sub("\n", text)
    text = _MULTI_NL.sub("\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    if len(text) > BROWSER_MAX_CHARS:
        text = text[: BROWSER_MAX_CHARS - 1] + "…"
    return title, text


async def fetch_page(
    client: httpx.AsyncClient,
    url: str,
    *,
    confirm: bool = False,
) -> dict[str, Any]:
    ok, err = validate_browse_url(url, confirm=confirm)
    if not ok:
        return {"ok": False, "error": err, "url": url, "actions": []}

    try:
        resp = await client.get(
            url,
            follow_redirects=True,
            timeout=BROWSER_TIMEOUT,
            headers={
                "User-Agent": "SpockifyBrowserAgent/8 (+https://spockify.local; read-only)",
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            },
        )
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        LOG.warning("browser fetch failed %s: %s", url, exc)
        return {"ok": False, "error": str(exc), "url": url, "actions": ["navigate"]}

    final_url = str(resp.url)
    # Re-validate redirect target host.
    ok2, err2 = validate_browse_url(final_url, confirm=confirm)
    if not ok2:
        return {"ok": False, "error": f"redirect blocked: {err2}", "url": final_url}

    ctype = (resp.headers.get("content-type") or "").lower()
    body = resp.text or ""
    if "html" in ctype or body.lstrip().startswith("<"):
        title, text = html_to_text(body)
    else:
        title = ""
        text = body[:BROWSER_MAX_CHARS]
        if len(body) > BROWSER_MAX_CHARS:
            text = text[:-1] + "…"

    return {
        "ok": True,
        "url": final_url,
        "title": title,
        "text": text,
        "chars": len(text),
        "actions": ["navigate", "fetch_text"],
        "playwright": playwright_available(),
        "note": playwright_note(),
    }


def playwright_available() -> bool:
    if PLAYWRIGHT_WS_URL:
        return True
    if not PLAYWRIGHT_LOCAL:
        return False
    try:
        import playwright  # noqa: F401

        return True
    except ImportError:
        return False


def playwright_note() -> str:
    if PLAYWRIGHT_WS_URL:
        return "Playwright click/type via PLAYWRIGHT_WS_URL"
    if PLAYWRIGHT_LOCAL:
        return "Playwright local Chromium enabled (PLAYWRIGHT_LOCAL=1)"
    return "fetch-only; set PLAYWRIGHT_WS_URL or PLAYWRIGHT_LOCAL=1 for click/type"


async def maybe_playwright_action(req: BrowserFetchRequest) -> Optional[dict[str, Any]]:
    """Best-effort Playwright (remote WS or local). Returns None to fall back to fetch."""
    if not PLAYWRIGHT_WS_URL and not PLAYWRIGHT_LOCAL:
        return None
    action = (req.action or "navigate").lower()
    if action not in ("navigate", "click", "type"):
        return {"ok": False, "error": f"unsupported action: {action}"}
    try:
        from playwright.async_api import async_playwright  # type: ignore
    except ImportError:
        if req.action and req.action != "navigate":
            return {
                "ok": False,
                "error": "playwright package not installed; falling back unavailable for click/type",
                "deferred": True,
                "fallback": "fetch",
            }
        return None
    ok, err = validate_browse_url(req.url, confirm=req.confirm)
    if not ok:
        return {"ok": False, "error": err}
    try:
        async with async_playwright() as p:
            browser = None
            close_browser = False
            if PLAYWRIGHT_WS_URL:
                # Prefer CDP; fall back to connect for Playwright server URLs.
                try:
                    browser = await p.chromium.connect_over_cdp(PLAYWRIGHT_WS_URL)
                except Exception:
                    browser = await p.chromium.connect(PLAYWRIGHT_WS_URL)
                close_browser = True
            else:
                browser = await p.chromium.launch(headless=True)
                close_browser = True
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto(
                req.url,
                wait_until="domcontentloaded",
                timeout=int(BROWSER_TIMEOUT * 1000),
            )
            if action == "click" and req.selector:
                await page.click(req.selector, timeout=10000)
            elif action == "type" and req.selector and req.text is not None:
                await page.fill(req.selector, req.text)
            content = await page.content()
            title = await page.title()
            _, text = html_to_text(content)
            if close_browser:
                await browser.close()
            return {
                "ok": True,
                "url": req.url,
                "title": title,
                "text": text,
                "chars": len(text),
                "actions": [action],
                "playwright": True,
                "mode": "ws" if PLAYWRIGHT_WS_URL else "local",
            }
    except Exception as exc:  # noqa: BLE001
        LOG.warning("playwright action failed: %s", exc)
        # Signal caller to fall back to fetch for navigate; click/type soft-fail.
        if action == "navigate" or not req.action:
            return None
        return {
            "ok": False,
            "error": str(exc),
            "playwright": True,
            "fallback": "fetch",
        }


def browser_limits_note() -> str:
    allow = ",".join(BROWSER_ALLOWLIST) or "(empty — all hosts denied)"
    return (
        f"allowlist={allow}; confirm={BROWSER_REQUIRE_CONFIRM}; "
        f"playwright={playwright_note()}"
    )


async def browse_tool(client: httpx.AsyncClient, query: str) -> str:
    """Shared-tool adapter: query is a URL or 'URL | confirm'."""
    raw = (query or "").strip()
    confirm = False
    if "|" in raw:
        url_part, _, rest = raw.partition("|")
        url = url_part.strip()
        confirm = "confirm" in rest.lower()
    else:
        # First token that looks like a URL.
        parts = raw.split()
        url = parts[0] if parts else raw
        confirm = "confirm" in raw.lower()
    if not url.startswith("http"):
        # Treat as search-like: not a URL.
        return f"browse tool expects an http(s) URL, got: {raw[:120]}"
    result = await fetch_page(client, url, confirm=confirm)
    if not result.get("ok"):
        return f"browse failed: {result.get('error')}"
    title = result.get("title") or ""
    text = result.get("text") or ""
    header = f"Fetched: {result.get('url')}"
    if title:
        header += f"\nTitle: {title}"
    return f"{header}\n\n{text}"
