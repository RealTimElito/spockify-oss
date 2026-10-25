"""Live stock / crypto quotes via Yahoo Finance chart API (no API key).

Used by the router to enrich SearXNG results so answers lead with real prices
instead of stale search snippets.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote as url_quote

import httpx

LOG = logging.getLogger("spockify.router.stock")

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
YAHOO_UA = (
    "Mozilla/5.0 (compatible; SpockifyRouter/0.4; +https://spockify.eu)"
)

# Common company / product names → Yahoo tickers (US + a few ETFs / crypto).
COMPANY_TO_TICKER: dict[str, str] = {
    "apple": "AAPL",
    "microsoft": "MSFT",
    "google": "GOOGL",
    "alphabet": "GOOGL",
    "amazon": "AMZN",
    "meta": "META",
    "facebook": "META",
    "nvidia": "NVDA",
    "tesla": "TSLA",
    "netflix": "NFLX",
    "intel": "INTC",
    "amd": "AMD",
    "broadcom": "AVGO",
    "oracle": "ORCL",
    "salesforce": "CRM",
    "adobe": "ADBE",
    "paypal": "PYPL",
    "uber": "UBER",
    "airbnb": "ABNB",
    "spotify": "SPOT",
    "shopify": "SHOP",
    "coinbase": "COIN",
    "berkshire": "BRK-B",
    "jpmorgan": "JPM",
    "jp morgan": "JPM",
    "visa": "V",
    "mastercard": "MA",
    "walmart": "WMT",
    "costco": "COST",
    "disney": "DIS",
    "coca cola": "KO",
    "coca-cola": "KO",
    "pepsi": "PEP",
    "nike": "NKE",
    "boeing": "BA",
    "lockheed": "LMT",
    "exxon": "XOM",
    "chevron": "CVX",
    "shell": "SHEL",
    "spotify ab": "SPOT",
    "ericsson": "ERIC",
    "volvo": "VOLV-B.ST",
    "investor ab": "INVE-B.ST",
    "saab": "SAAB-B.ST",
    "saab ab": "SAAB-B.ST",
    "saab b": "SAAB-B.ST",
    "hexagon": "HEXA-B.ST",
    "atlas copco": "ATCO-A.ST",
    "assa abloy": "ASSA-B.ST",
    "h&m": "HM-B.ST",
    "hennes mauritz": "HM-B.ST",
    "bitcoin": "BTC-USD",
    "btc": "BTC-USD",
    "ethereum": "ETH-USD",
    "eth": "ETH-USD",
    "solana": "SOL-USD",
    "dogecoin": "DOGE-USD",
    "doge": "DOGE-USD",
    "sp500": "^GSPC",
    "s&p 500": "^GSPC",
    "s&p500": "^GSPC",
    "dow": "^DJI",
    "nasdaq": "^IXIC",
}

STOCK_INTENT_KEYWORDS = (
    "stock price",
    "share price",
    "stock quote",
    "stock ticker",
    "aktiekurs",
    "aktiepris",
    "börskurs",
    "crypto price",
    "cryptocurrency price",
    "bitcoin price",
    "ethereum price",
    "trading at",
    "market cap",
    "nasdaq:",
    "nyse:",
)

# Phrases stripped when building a Yahoo company-name search query.
_SEARCH_STRIP_PHRASES = (
    "stock price",
    "share price",
    "stock quote",
    "crypto price",
    "cryptocurrency price",
    "market cap",
    "trading at",
    "aktiekursen för",
    "aktiekursen",
    "aktiepris",
    "börskurs",
    "what's the",
    "whats the",
    "what is the",
    "what is",
    "what's",
    "how much is",
    "how much does",
    "current price of",
    "price of",
    "price for",
    "quote for",
    "ticker for",
    "kursen för",
    "kursen",
    "please",
    "today",
    "right now",
    "now",
)

_TICKER_RE = re.compile(
    r"(?:\$|ticker\s+|symbol\s+)?\b([A-Z]{1,5}(?:-[A-Z]{1,4})?(?:\.[A-Z]{1,3})?)\b"
)
_BARE_TICKER_HINT_RE = re.compile(
    r"(?i)\b(?:stock|share|ticker|quote|price|kurs|aktie|crypto|bitcoin|btc|eth)\b"
)

# Words that look like tickers but are not (incl. corp suffixes like Swedish AB).
_TICKER_STOPWORDS = frozenset(
    {
        "A",
        "I",
        "AM",
        "PM",
        "USD",
        "EUR",
        "SEK",
        "GBP",
        "THE",
        "AND",
        "FOR",
        "WHAT",
        "IS",
        "HOW",
        "MUCH",
        "NOW",
        "TODAY",
        "PRICE",
        "STOCK",
        "SHARE",
        "QUOTE",
        "MARKET",
        "NYSE",
        "CEO",
        "IPO",
        "ETF",
        "API",
        "HTTP",
        "HTTPS",
        "WWW",
        "JSON",
        "AI",
        "IT",
        "TV",
        "US",
        "UK",
        "EU",
        "AB",
        "ASA",
        "AG",
        "SA",
        "NV",
        "SE",
        "PLC",
        "INC",
        "LTD",
        "LLC",
        "CORP",
        "CO",
        "OY",
        "AS",
        "BV",
        "GMBH",
        "SER",
    }
)

# Prefer home / primary listings over secondary (esp. German OTC mirrors).
_PREFERRED_EXCHANGES = frozenset(
    {
        "NMS",
        "NGM",
        "NYQ",
        "NAS",
        "ASE",
        "PCX",
        "BTS",
        "NYSE",
        "NASDAQ",
        "STO",
        "CPH",
        "HEL",
        "OSL",
        "LSE",
        "LON",
        "PAR",
        "AMS",
        "TOR",
        "TSX",
        "HKG",
        "TYO",
        "CCC",  # crypto
    }
)
_SECONDARY_SUFFIXES = (
    ".F",
    ".DE",
    ".MU",
    ".SG",
    ".DU",
    ".HM",
    ".BE",
    ".HA",
    ".STU",
    ".IL",  # IOB London secondary
)


def is_stock_lookup(text: str) -> bool:
    lowered = (text or "").lower()
    if any(k in lowered for k in STOCK_INTENT_KEYWORDS):
        return True
    if re.search(
        r"(?i)\b(stock|share|aktie|crypto)\b.*\b(price|kurs|quote|värde)\b",
        lowered,
    ):
        return True
    if re.search(
        r"(?i)\b(price|kurs|quote)\b.*\b(stock|share|aktie|bitcoin|ethereum)\b",
        lowered,
    ):
        return True
    # "$AAPL" or "AAPL stock"
    if re.search(r"\$[A-Z]{1,5}\b", text or ""):
        return True
    if re.search(r"(?i)\b[A-Z]{1,5}\b\s+(?:stock|share|price|quote|kurs)\b", text or ""):
        return True
    # "price of Apple" / "how much is Tesla stock" via company map + price intent
    price_intent = any(
        w in lowered
        for w in (
            "price",
            "kurs",
            "quote",
            "worth",
            "trading",
            "stock",
            "share",
            "aktie",
            "how much",
        )
    )
    if price_intent:
        for name in COMPANY_TO_TICKER:
            if re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", lowered):
                return True
    return False


def company_search_query(text: str) -> str:
    """Strip finance filler words; keep the likely company / ticker phrase."""
    q = (text or "").strip()
    if not q:
        return ""
    lowered = q
    for phrase in sorted(_SEARCH_STRIP_PHRASES, key=len, reverse=True):
        lowered = re.sub(rf"(?i)\b{re.escape(phrase)}\b", " ", lowered)
    lowered = re.sub(r"[?!.:,;]+", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip(" \t\"'")
    # Drop lone corp-suffix leftovers if that is all that remains with a name.
    return lowered[:120]


def extract_stock_symbols(text: str, *, limit: int = 4) -> list[str]:
    """Resolve tickers from $TICKER, company names, or bare symbols near price intent."""
    if not text:
        return []
    found: list[str] = []
    seen: set[str] = set()

    def _add(sym: str) -> None:
        sym = (sym or "").strip().upper()
        if not sym or sym in seen or sym in _TICKER_STOPWORDS:
            return
        seen.add(sym)
        found.append(sym)

    lowered = text.lower()
    # Longer company names first so "coca cola" / "saab ab" win over shorter keys.
    for name, ticker in sorted(COMPANY_TO_TICKER.items(), key=lambda x: -len(x[0])):
        if re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", lowered):
            _add(ticker)
            if len(found) >= limit:
                return found

    # Explicit $TICKER
    for m in re.finditer(r"\$([A-Za-z]{1,5}(?:-[A-Za-z]{1,4})?(?:\.[A-Za-z]{1,3})?)", text):
        _add(m.group(1))
        if len(found) >= limit:
            return found

    # Bare tickers only when the message looks finance-related.
    if _BARE_TICKER_HINT_RE.search(text) or found:
        for m in _TICKER_RE.finditer(text):
            cand = m.group(1).upper()
            if cand in _TICKER_STOPWORDS:
                continue
            # Prefer all-caps tokens that appeared as such in the source.
            raw = m.group(1)
            if raw != raw.upper() and len(raw) <= 2:
                continue
            if len(cand) < 2 and cand not in ("V",):
                continue
            _add(cand)
            if len(found) >= limit:
                break

    return found[:limit]


def _listing_rank(quote: dict[str, Any], search_q: str) -> tuple[int, float, int]:
    """Lower tuple sorts first. Prefer primary exchanges over German mirrors."""
    symbol = (quote.get("symbol") or "").upper()
    exchange = (quote.get("exchange") or "").upper()
    score = float(quote.get("score") or 0)
    qtype = (quote.get("quoteType") or "").upper()
    longname = (quote.get("longname") or quote.get("shortname") or "").lower()
    search_l = (search_q or "").lower()

    tier = 50
    if qtype in ("EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX"):
        tier = 10
    elif qtype in ("OPTION", "FUTURE"):
        tier = 90

    if exchange in _PREFERRED_EXCHANGES or symbol.endswith(".ST"):
        tier -= 5
    if any(symbol.endswith(suf) for suf in _SECONDARY_SUFFIXES):
        tier += 40
    # Stockholm B-share often the main listing for Swedish industrials.
    if symbol.endswith("-B.ST") or symbol.endswith("-A.ST"):
        tier -= 3
    # Boost when company name tokens appear in Yahoo longname.
    tokens = [t for t in re.findall(r"[a-z0-9]{2,}", search_l) if t not in _TICKER_STOPWORDS]
    if tokens and longname:
        hits = sum(1 for t in tokens if t in longname)
        tier -= min(hits, 3)

    # Higher Yahoo score is better → negate for ascending sort.
    return (tier, -score, len(symbol))


def pick_primary_quote(quotes: list[dict[str, Any]], search_q: str) -> Optional[str]:
    equities = [
        q
        for q in quotes
        if (q.get("symbol") or "").strip()
        and (q.get("quoteType") or "").upper()
        in ("EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX", "MUTUALFUND", "")
    ]
    if not equities:
        equities = [q for q in quotes if (q.get("symbol") or "").strip()]
    if not equities:
        return None
    equities.sort(key=lambda q: _listing_rank(q, search_q))
    return (equities[0].get("symbol") or "").strip().upper() or None


async def resolve_ticker_via_yahoo(
    client: httpx.AsyncClient,
    query: str,
) -> Optional[str]:
    """Resolve a company-name query to a Yahoo symbol via finance search."""
    search_q = company_search_query(query)
    if len(search_q) < 2:
        return None
    try:
        resp = await client.get(
            YAHOO_SEARCH_URL,
            params={
                "q": search_q,
                "quotesCount": 8,
                "newsCount": 0,
                "listsCount": 0,
            },
            timeout=10.0,
            headers={"User-Agent": YAHOO_UA, "Accept": "application/json"},
        )
        resp.raise_for_status()
        payload = resp.json()
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
        LOG.warning("Yahoo symbol search failed for %r: %s", search_q, exc)
        return None
    quotes = payload.get("quotes") or []
    symbol = pick_primary_quote(quotes, search_q)
    if symbol:
        LOG.info("yahoo search %r → %s", search_q, symbol)
    return symbol


def _format_change(price: float, prev: Optional[float]) -> str:
    if prev is None or prev == 0:
        return ""
    delta = price - prev
    pct = (delta / prev) * 100.0
    sign = "+" if delta >= 0 else ""
    return f", {sign}{delta:.2f} ({sign}{pct:.2f}%)"


def format_quote_line(meta: dict[str, Any], *, source_url: str) -> str:
    symbol = meta.get("symbol") or "?"
    price = meta.get("regularMarketPrice")
    if price is None:
        return ""
    try:
        price_f = float(price)
    except (TypeError, ValueError):
        return ""
    currency = meta.get("currency") or ""
    name = meta.get("longName") or meta.get("shortName") or symbol
    prev = meta.get("chartPreviousClose")
    try:
        prev_f = float(prev) if prev is not None else None
    except (TypeError, ValueError):
        prev_f = None
    change = _format_change(price_f, prev_f)
    day_high = meta.get("regularMarketDayHigh")
    day_low = meta.get("regularMarketDayLow")
    range_bit = ""
    try:
        if day_high is not None and day_low is not None:
            range_bit = f", day range {float(day_low):.2f}–{float(day_high):.2f}"
    except (TypeError, ValueError):
        range_bit = ""
    when = ""
    ts = meta.get("regularMarketTime")
    if isinstance(ts, (int, float)) and ts > 0:
        # Guard absurd future timestamps from bad upstream data.
        try:
            when_dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            if when_dt.year >= 2000 and when_dt.year <= datetime.now(timezone.utc).year + 1:
                when = f" (as of {when_dt.strftime('%Y-%m-%d %H:%M UTC')})"
        except (OverflowError, OSError, ValueError):
            when = ""
    # Leading bullets make the numbers hard to miss in the system prompt.
    return (
        f"• {name} ({symbol}): {price_f:.2f} {currency}{change}{range_bit}{when}\n"
        f"  Yahoo Finance live quote — display these numbers in your reply. "
        f"Source: {source_url}"
    )


async def fetch_yahoo_quote(
    client: httpx.AsyncClient,
    symbol: str,
) -> Optional[dict[str, Any]]:
    """Return chart meta for a Yahoo Finance symbol, or None on failure."""
    sym = (symbol or "").strip().upper()
    if not sym:
        return None
    url = YAHOO_CHART_URL.format(symbol=url_quote(sym, safe="^.-"))
    try:
        resp = await client.get(
            url,
            params={"interval": "1d", "range": "5d"},
            timeout=10.0,
            headers={"User-Agent": YAHOO_UA, "Accept": "application/json"},
        )
        resp.raise_for_status()
        payload = resp.json()
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
        LOG.warning("Yahoo quote failed for %s: %s", sym, exc)
        return None
    chart = (payload or {}).get("chart") or {}
    if chart.get("error"):
        LOG.info("Yahoo chart error for %s: %s", sym, chart.get("error"))
        return None
    results = chart.get("result") or []
    if not results:
        return None
    meta = results[0].get("meta") or {}
    if meta.get("regularMarketPrice") is None:
        return None
    meta["_source_url"] = f"https://finance.yahoo.com/quote/{url_quote(sym, safe='^.-')}"
    return meta


async def fetch_stock_quote_lines(
    client: httpx.AsyncClient,
    query: str,
    *,
    symbols: Optional[list[str]] = None,
    limit: int = 3,
) -> tuple[list[str], list[dict[str, Any]]]:
    """Fetch live quotes; return prompt lines + OpenWebUI citation sources."""
    tickers = list(symbols) if symbols is not None else extract_stock_symbols(query, limit=limit)
    # Company names (Saab AB, etc.) often miss the static map — resolve via Yahoo.
    if not tickers and is_stock_lookup(query):
        resolved = await resolve_ticker_via_yahoo(client, query)
        if resolved:
            tickers = [resolved]
    elif tickers and is_stock_lookup(query):
        # If we only matched a weak/corp-suffix false positive earlier, still search.
        # (extract already filters stopwords; keep Yahoo as backup when chart fails.)
        pass

    if not tickers:
        return [], []

    lines: list[str] = []
    sources: list[dict[str, Any]] = []
    for sym in tickers[:limit]:
        meta = await fetch_yahoo_quote(client, sym)
        if not meta and symbols is None:
            # Mapped/bare ticker may be wrong (e.g. rare collisions) — try search.
            resolved = await resolve_ticker_via_yahoo(client, query)
            if resolved and resolved not in tickers:
                meta = await fetch_yahoo_quote(client, resolved)
                sym = resolved or sym
        if not meta:
            continue
        source_url = meta.pop("_source_url", f"https://finance.yahoo.com/quote/{sym}")
        line = format_quote_line(meta, source_url=source_url)
        if not line:
            continue
        lines.append(line)
        name = meta.get("longName") or meta.get("shortName") or sym
        price = meta.get("regularMarketPrice")
        currency = meta.get("currency") or ""
        change = ""
        prev = meta.get("chartPreviousClose")
        try:
            if prev is not None and price is not None:
                change = _format_change(float(price), float(prev))
        except (TypeError, ValueError):
            change = ""
        snippet = f"{name} ({sym}): {price} {currency}{change}".strip()
        sources.append(
            {
                "source": {"name": f"{name} — Yahoo Finance", "url": source_url},
                "document": [snippet],
                "metadata": [{"source": source_url, "name": f"{name} ({sym})"}],
            }
        )
        LOG.info("stock quote %s=%s %s", sym, price, currency)

    # Still no chart hits — one last Yahoo search + quote attempt.
    if not lines and is_stock_lookup(query) and symbols is None:
        resolved = await resolve_ticker_via_yahoo(client, query)
        if resolved:
            meta = await fetch_yahoo_quote(client, resolved)
            if meta:
                source_url = meta.pop(
                    "_source_url", f"https://finance.yahoo.com/quote/{resolved}"
                )
                line = format_quote_line(meta, source_url=source_url)
                if line:
                    lines.append(line)
                    name = meta.get("longName") or meta.get("shortName") or resolved
                    price = meta.get("regularMarketPrice")
                    currency = meta.get("currency") or ""
                    sources.append(
                        {
                            "source": {
                                "name": f"{name} — Yahoo Finance",
                                "url": source_url,
                            },
                            "document": [f"{name} ({resolved}): {price} {currency}"],
                            "metadata": [
                                {
                                    "source": source_url,
                                    "name": f"{name} ({resolved})",
                                }
                            ],
                        }
                    )

    return lines, sources
