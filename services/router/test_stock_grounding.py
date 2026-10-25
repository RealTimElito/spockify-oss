"""Unit tests for stock quotes + search grounding helpers."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock

import httpx

import search_grounding as grounding
import stock_quotes as stocks


class StockQuoteUnitTests(unittest.TestCase):
    def test_detects_stock_phrases(self) -> None:
        self.assertTrue(stocks.is_stock_lookup("What's the AAPL stock price?"))
        self.assertTrue(stocks.is_stock_lookup("Tesla share price"))
        self.assertTrue(stocks.is_stock_lookup("$NVDA quote"))
        self.assertTrue(stocks.is_stock_lookup("bitcoin price now"))
        self.assertTrue(stocks.is_stock_lookup("Vad är aktiekursen för Apple?"))

    def test_rejects_non_finance(self) -> None:
        self.assertFalse(stocks.is_stock_lookup("What's 10 + 10?"))
        self.assertFalse(stocks.is_stock_lookup("how much is a house in Stockholm"))
        self.assertFalse(stocks.is_stock_lookup("price of milk"))

    def test_extract_symbols(self) -> None:
        self.assertEqual(stocks.extract_stock_symbols("AAPL stock price"), ["AAPL"])
        self.assertIn("TSLA", stocks.extract_stock_symbols("Tesla share price"))
        self.assertIn("BTC-USD", stocks.extract_stock_symbols("bitcoin price"))
        self.assertIn("GOOGL", stocks.extract_stock_symbols("Google stock quote"))
        self.assertIn("SAAB-B.ST", stocks.extract_stock_symbols("Saab AB stock price"))
        # Swedish corp suffix must not become the ticker.
        self.assertNotIn("AB", stocks.extract_stock_symbols("Saab AB stock price"))

    def test_company_search_query(self) -> None:
        self.assertEqual(
            stocks.company_search_query("What is Saab AB trading at?"),
            "Saab AB",
        )
        self.assertIn("Saab", stocks.company_search_query("Saab AB stock price"))

    def test_pick_primary_prefers_stockholm(self) -> None:
        quotes = [
            {
                "symbol": "SDV1.F",
                "exchange": "FRA",
                "quoteType": "EQUITY",
                "score": 20005.0,
                "longname": "Saab AB (publ)",
            },
            {
                "symbol": "SAAB-B.ST",
                "exchange": "STO",
                "quoteType": "EQUITY",
                "score": 20002.0,
                "longname": "Saab AB (publ)",
            },
        ]
        self.assertEqual(
            stocks.pick_primary_quote(quotes, "Saab AB"),
            "SAAB-B.ST",
        )

    def test_format_quote_line(self) -> None:
        meta = {
            "symbol": "AAPL",
            "regularMarketPrice": 200.5,
            "currency": "USD",
            "longName": "Apple Inc.",
            "chartPreviousClose": 198.0,
            "regularMarketDayHigh": 201.0,
            "regularMarketDayLow": 199.0,
            "regularMarketTime": 1700000000,
        }
        line = stocks.format_quote_line(
            meta, source_url="https://finance.yahoo.com/quote/AAPL"
        )
        self.assertIn("Apple Inc.", line)
        self.assertIn("200.50", line)
        self.assertIn("USD", line)
        self.assertIn("finance.yahoo.com/quote/AAPL", line)
        self.assertIn("display these numbers", line)


class StockQuoteFetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_yahoo_quote_parses_meta(self) -> None:
        payload = {
            "chart": {
                "result": [
                    {
                        "meta": {
                            "symbol": "MSFT",
                            "regularMarketPrice": 420.1,
                            "currency": "USD",
                            "shortName": "Microsoft",
                            "chartPreviousClose": 418.0,
                            "regularMarketTime": 1700000000,
                        }
                    }
                ],
                "error": None,
            }
        }
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json.return_value = payload
        client = AsyncMock()
        client.get = AsyncMock(return_value=resp)
        meta = await stocks.fetch_yahoo_quote(client, "MSFT")
        assert meta is not None
        self.assertEqual(meta["symbol"], "MSFT")
        self.assertEqual(meta["regularMarketPrice"], 420.1)
        lines, sources = await stocks.fetch_stock_quote_lines(
            client, "MSFT stock price", symbols=["MSFT"]
        )
        self.assertEqual(len(lines), 1)
        self.assertIn("420.10", lines[0])
        self.assertEqual(sources[0]["source"]["url"], "https://finance.yahoo.com/quote/MSFT")

    async def test_resolve_unknown_company_via_yahoo_search(self) -> None:
        search_payload = {
            "quotes": [
                {
                    "symbol": "SDV1.F",
                    "exchange": "FRA",
                    "quoteType": "EQUITY",
                    "score": 20005.0,
                    "longname": "Saab AB (publ)",
                },
                {
                    "symbol": "SAAB-B.ST",
                    "exchange": "STO",
                    "quoteType": "EQUITY",
                    "score": 20002.0,
                    "longname": "Saab AB (publ)",
                },
            ]
        }
        chart_payload = {
            "chart": {
                "result": [
                    {
                        "meta": {
                            "symbol": "SAAB-B.ST",
                            "regularMarketPrice": 634.1,
                            "currency": "SEK",
                            "longName": "Saab AB (publ)",
                            "chartPreviousClose": 615.1,
                            "regularMarketTime": 1700000000,
                        }
                    }
                ],
                "error": None,
            }
        }

        async def _get(url, **kwargs):
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            if "finance/search" in str(url):
                resp.json.return_value = search_payload
            else:
                resp.json.return_value = chart_payload
            return resp

        client = AsyncMock()
        client.get = AsyncMock(side_effect=_get)
        # Force Yahoo search path: no static map hit for this fake name.
        lines, sources = await stocks.fetch_stock_quote_lines(
            client, "Acme Defense Corp stock price"
        )
        self.assertTrue(lines)
        self.assertIn("634.10", lines[0])
        self.assertIn("SEK", lines[0])
        self.assertIn("SAAB-B.ST", sources[0]["source"]["url"])


class GroundingUnitTests(unittest.TestCase):
    def test_wants_page_grounding(self) -> None:
        self.assertTrue(
            grounding.wants_page_grounding(
                "According to the official docs, what does the API return?"
            )
        )
        self.assertTrue(
            grounding.wants_page_grounding(
                "What is the latest version of Kubernetes release notes?"
            )
        )
        self.assertFalse(grounding.wants_page_grounding("hi"))

    def test_extract_query_excerpts(self) -> None:
        text = (
            "Intro fluff. The API returns a JSON object with a status field. "
            "More fluff later about unrelated topics and padding words."
        )
        excerpt = grounding.extract_query_excerpts(
            text, "what does the API return status"
        )
        self.assertIn("API returns", excerpt)

    def test_html_to_plain_strips_script(self) -> None:
        html = "<html><script>evil()</script><p>Hello world quote here</p></html>"
        plain = grounding.html_to_plain(html)
        self.assertNotIn("evil", plain)
        self.assertIn("Hello world", plain)

    def test_private_url_not_fetchable(self) -> None:
        self.assertFalse(grounding._url_fetchable("http://127.0.0.1/secret"))
        self.assertFalse(grounding._url_fetchable("https://facebook.com/x"))
        self.assertTrue(grounding._url_fetchable("https://example.com/article"))


class GroundingFetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_page_excerpt(self) -> None:
        html = (
            "<html><head><title>Docs</title></head><body>"
            "<p>The official guide says install with pip install spockify.</p>"
            "</body></html>"
        )
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.text = html
        resp.url = httpx.URL("https://example.com/docs")
        resp.headers = {"content-type": "text/html"}
        client = AsyncMock()
        client.get = AsyncMock(return_value=resp)
        excerpt = await grounding.fetch_page_excerpt(
            client,
            "https://example.com/docs",
            "what does the official guide say about install",
        )
        self.assertIn("pip install spockify", excerpt)


if __name__ == "__main__":
    unittest.main()
