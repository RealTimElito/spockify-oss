"""
title: Spockify Web Search
author: spockify
version: 0.1.0
description: OpenWebUI function — queries SearXNG JSON API (in-cluster or dev compose).
required_open_webui_version: 0.3.0
"""

import json
import os
from typing import Optional
from urllib.parse import quote_plus

import requests
from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        searxng_base_url: str = Field(
            default=os.getenv(
                "SEARXNG_BASE_URL",
                "http://searxng.spockify.svc.cluster.local:8080",
            ),
            description="SearXNG base URL (no trailing path)",
        )
        max_results: int = Field(default=5, ge=1, le=20)

    def __init__(self):
        self.valves = self.Valves()

    def web_search(
        self,
        query: str,
        max_results: Optional[int] = None,
        __user__: dict = None,
    ) -> str:
        """
        Search the web for documentation, library versions, and current information.
        :param query: Search terms.
        :param max_results: Number of results (default from valves).
        """
        limit = max_results or self.valves.max_results
        url = (
            f"{self.valves.searxng_base_url.rstrip('/')}/search"
            f"?q={quote_plus(query)}&format=json"
        )
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])[:limit]
        if not results:
            return json.dumps({"query": query, "results": [], "message": "No results"})
        slim = [
            {
                "title": r.get("title"),
                "url": r.get("url"),
                "snippet": r.get("content") or r.get("snippet", ""),
            }
            for r in results
        ]
        return json.dumps({"query": query, "results": slim}, indent=2)
