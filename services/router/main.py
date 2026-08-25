"""Spockify router — session-aware routing, smart orchestrator, worker streaming.

Routing philosophy (spockify-auto):
1. Fast path first — patterns, math, greetings, obvious web/doc keywords (0 LLM calls).
2. Session coherence — sticky worker per thread topic (weather follow-ups stay on
   web-gemma + search); topic shifts (math after weather) break inheritance.
3. Smart orchestrator — ambiguous or doc/lookup intent; decides whether to search.
4. Web search gating — fast-path blocks math/greetings/pure code; orchestrator decides
   needs_web_search for everything else ambiguous; router injects SearXNG (not OpenWebUI).
5. web-gemma preferred for live facts; web-llama is fallback on empty responses.
"""

from __future__ import annotations

import asyncio
import difflib
import hashlib
import json
import logging
import os
import re
import time
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional, Union
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

import browser_agent as browser
import connectors as connectors_mod
import cost_hud
import critique as critique_mod
import dream_mode as dream_mod
import eval_board as eval_mod
import family_mode as family_mod
import ghost_fim
import ghost_telemetry
import ghost_writer as ghost_mod
import home_brain as home_mod
import image_gen
import multiplayer as multi_mod
import ops_pane as ops_mod
import parallel_agents as pagents
import screen_share as screen_mod
import search_grounding as grounding
import skills_packs as skills_mod
import spectacle as spectacle_mod
import stock_quotes as stocks
import voice_world as voice_mod
import workspace as workspace_mod

LOG = logging.getLogger("spockify.router")
logging.basicConfig(level=logging.INFO)

LITELLM_URL = os.getenv("LITELLM_URL", "http://litellm:4000/v1").rstrip("/")
LITELLM_API_KEY = os.getenv("LITELLM_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama.spockify.svc.cluster.local:11434").rstrip("/")
USE_DIRECT_OLLAMA = os.getenv("USE_DIRECT_OLLAMA", "true").lower() in ("1", "true", "yes")
COMFYUI_URL = os.getenv(
    "COMFYUI_URL", "http://comfyui.spockify.svc.cluster.local:8188"
).rstrip("/")
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://searxng:8080").rstrip("/")
ORCHESTRATOR_MODEL = os.getenv("ORCHESTRATOR_MODEL", "nemotron-nano-4b")
ORCHESTRATOR_FALLBACK = os.getenv("ORCHESTRATOR_FALLBACK", "llama3.2-3b")
ORCHESTRATOR_MAX_TOKENS = int(os.getenv("ORCHESTRATOR_MAX_TOKENS", "512"))
ROUTING_FAST_MODE = os.getenv("ROUTING_FAST_MODE", "true").lower() in ("1", "true", "yes")
ROUTING_TIMEOUT = float(os.getenv("ROUTING_TIMEOUT", "45"))
WORKER_TIMEOUT = float(os.getenv("WORKER_TIMEOUT", "180"))
CHAT_PIPELINE_ENABLED = os.getenv("CHAT_PIPELINE_ENABLED", "false").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
CHAT_PIPELINE_WORK_MODEL = os.getenv("CHAT_PIPELINE_WORK_MODEL", "gpt-oss-20b")
CHAT_PIPELINE_EXPLAIN_MODEL = os.getenv("CHAT_PIPELINE_EXPLAIN_MODEL", "gemma4-12b")
CHAT_PIPELINE_POST_PROCESS = os.getenv("CHAT_PIPELINE_POST_PROCESS", "true").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
CHAT_PIPELINE_HIDE_INTERMEDIATE = os.getenv(
    "CHAT_PIPELINE_HIDE_INTERMEDIATE", "true"
).lower() in ("1", "true", "yes", "on")
CHAT_PIPELINE_DEV_LOG = os.getenv("CHAT_PIPELINE_DEV_LOG", "false").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
PATTERN_CONFIDENCE_MIN = float(os.getenv("PATTERN_CONFIDENCE_MIN", "0.65"))
SEARCH_CONFIDENCE_MIN = float(os.getenv("SEARCH_CONFIDENCE_MIN", "0.8"))
ORCHESTRATOR_PROMPT_PATH = os.getenv(
    "ORCHESTRATOR_PROMPT_PATH", "/config/orchestrator-prompt.md"
)
ROUTING_RULES_PATH = os.getenv("ROUTING_RULES_PATH", "/config/routing-rules.json")
ROUTING_CACHE_TTL = int(os.getenv("ROUTING_CACHE_TTL", "300"))
ROUTING_CACHE_MAX = int(os.getenv("ROUTING_CACHE_MAX", "256"))
THREAD_PLAN_TTL = int(os.getenv("THREAD_PLAN_TTL", "3600"))
THREAD_PLAN_MAX = int(os.getenv("THREAD_PLAN_MAX", "512"))
SPOCKIFY_DISPLAY_MODEL = os.getenv("SPOCKIFY_DISPLAY_MODEL", "spockify-auto")
USE_COMPACT_ORCHESTRATOR_PROMPT = os.getenv(
    "USE_COMPACT_ORCHESTRATOR_PROMPT", "true"
).lower() in ("1", "true", "yes")
USE_LITELLM_ORCHESTRATOR = os.getenv(
    "USE_LITELLM_ORCHESTRATOR", "false"
).lower() in ("1", "true", "yes")
PREWARM_ON_STARTUP = os.getenv("PREWARM_ON_STARTUP", "true").lower() in (
    "1",
    "true",
    "yes",
)
PREWARM_MODELS = [
    m.strip()
    for m in os.getenv(
        "PREWARM_MODELS", "llama3.2-3b llama3.1-8b nemotron-nano-4b gemma4-12b"
    ).split()
    if m.strip()
]
# Tiny warm model for greetings / ultra-short acks (faster first token than gemma4).
FAST_CHAT_WORKER = os.getenv("FAST_CHAT_WORKER", "llama3.2-3b")
# Call / features.voice default worker: mid-size balance (TTFT vs spoken quality).
VOICE_CHAT_WORKER = os.getenv("VOICE_CHAT_WORKER", "llama3.1-8b")
# Voice web synthesis: same 8b family via web-llama (SearXNG still injected).
VOICE_WEB_WORKER = os.getenv("VOICE_WEB_WORKER", "web-llama")
FEDERATION_PEERS = [
    p.strip()
    for p in (
        os.getenv("SPOCKIFY_FEDERATION_PEERS") or os.getenv("FEDERATION_PEERS") or ""
    ).split(",")
    if p.strip()
]

COMPACT_ROUTING_PROMPT = """\
You are Spockify's router. Output a single JSON object only (no markdown).

Workers: gpt-oss-120b (code/agentic; fallback gpt-oss-20b then codestral), gemma4-12b (general chat/reasoning),
llama3.2-3b (fast math), web-codestral / web-gemma (live web facts; prefer web-gemma
for general lookup).

Required JSON fields:
  worker (model name), needs_web_search (bool), search_query (string if searching),
  task_type, confidence (0-1), reasoning (short). Optional: prompt_additions.

Use recent conversation for short follow-ups in the SAME topic (weather tweaks like
"per day", "and tomorrow?", "breakdown by day"; "code it", "yes go ahead"). Do NOT inherit
web/weather for topic shifts (arithmetic, greetings, unrelated coding).
Short reactions ("thanks", "cool", "Spännande!", "interesting") stay on llama3.2-3b —
never route them to gpt-oss-20b/codestral unless the user asked for code.

NEVER needs_web_search for: arithmetic, greetings, pure coding from training data
(e.g. "write fibonacci in python" with no doc lookup), trivial facts answerable without the web.

Set needs_web_search true for: documentation/API lookups, GitHub readme, latest
versions, release notes, CVEs, weather/forecasts (including "coming week", multi-day),
news, prices, sports — anything needing live web data."""

SEARCH_KEYWORDS = (
    "latest",
    "latest version",
    "documentation",
    "docs for",
    "api docs",
    "api reference",
    "read the manual",
    "manual for",
    "github",
    "gitlab",
    "changelog",
    "cve",
    "current version",
    "search web",
    "look up",
    "look up the",
    "check the documentation",
    "http://",
    "https://",
    "www.",
    "release notes",
    "weather",
    "forecast",
    "temperature",
    "news today",
    "headlines",
    "stock price",
    "share price",
    "stock quote",
    "trading at",
    "aktiekurs",
    "aktiepris",
    "börskurs",
    "exchange rate",
    "current events",
    "breaking news",
    "price of",
    "how much does",
    "crypto price",
    "bitcoin price",
    "who won",
    "election result",
    "flight status",
    # Swedish explicit lookup / live-info cues
    "sök efter",
    "slå upp",
    "kolla upp",
    "sök upp",
    "nyheter idag",
)

DOC_LOOKUP_PHRASES = (
    "documentation",
    "docs for",
    "api docs",
    "github",
    "gitlab",
    "read the manual",
    "look up",
    "latest version",
    "release notes",
    "check the",
)

LIVE_FACTS_KEYWORDS = (
    "weather",
    "forecast",
    "temperature",
    "rain",
    "snow",
    "humidity",
    "wind speed",
    "stock price",
    "share price",
    "stock quote",
    "trading at",
    "aktiekurs",
    "aktiepris",
    "börskurs",
    "exchange rate",
    "news today",
    "headlines",
    "sports score",
    "match result",
    "who won",
    "election result",
    "current president",
    "flight status",
    "current events",
    "breaking news",
    "price of",
    "how much does",
    "crypto price",
    "bitcoin price",
    "väder",
    "prognos",
    "nyheter",
    "temperatur",
    "regn",
)

CODE_KEYWORDS = (
    "code",
    "function",
    "class",
    "debug",
    "refactor",
    "implement",
    "python",
    "javascript",
    "typescript",
    "rust",
    "golang",
    "sql",
    "bug",
    "compile",
    "syntax",
    "unit test",
    "pull request",
)

CODER_MODEL_PREFIXES = (
    "gpt-oss-20b",
    "codestral",
    "web-codestral",
    "codellama",
    "codegemma",
)

CODER_SYSTEM_PROMPT = """\
You are Spockify's coding assistant. Write complete, runnable implementations when asked.

When the user asks for code, a build, or "do it for me", deliver full working code — not outlines, pseudocode, or step lists.
Never refuse to write code or say you cannot build or implement something.
If the user follows up after a high-level explanation, replace the outline with actual code.
Be careful and thorough: ground answers in the provided context; do not invent file paths or APIs.
Follow Google Python style for Python. Match existing project conventions. Prefer minimal focused diffs.
Do not suggest Chinese-origin models (DeepSeek, Qwen, etc.)."""

CODE_IMPLEMENTATION_PROMPT = """\
The user wants a complete implementation now. Write the full, runnable code.
Do not respond with plans, pseudocode, or "I can't provide the full code"."""

SPOCKIFY_PERSONA_PROMPT = """\
You are Spockify — a capable AI agent. Use a casual, modern tone.
Do not roleplay as a character. Do not use formal Vulcan-style greetings or Star Trek references.
Never mention model names, routing, workers, or infrastructure unless the user explicitly asks.
Help with whatever the user asks — weather, coding, general knowledge, and everyday questions.
Do not describe yourself as a platform, app, or product wrapper. Do not redirect users to \
platform-specific topics or refuse factual questions when you can answer them (including from \
web search context when provided).
Answer directly and be concise unless depth is requested."""

# IDE Generate Commit Message — replaces persona/coder systems (those invite narration).
COMMIT_MESSAGE_SYSTEM_PROMPT = """\
Write a git commit message in Conventional Commits format.
Reply with ONLY the commit message — no preamble, analysis, markdown, or quotes.

Format (exactly):
  type(optional-scope): imperative subject
  <blank line>
  optional short body (at most 2 lines)

Types: feat, fix, refactor, docs, test, chore, perf, build, ci, style.
Subject ≤72 chars, imperative mood ("add" not "added"), no trailing period.
One subject for the dominant why/intent of the whole change.

GOOD examples (emit this shape only):
  chore: tighten generate-commit-message prompts and bump IDE to 0.9.5
  feat(auth): add OAuth login for IDE sessions
  fix: prevent empty SCM commit message toast

BAD examples (never emit):
  We need to craft a commit message…
  The diff includes many updates:
  - Bump version…
  - Update generateCommitMessage.ts…
  Thus this commit is a feature…

Do NOT laundry-list files, paths, or version bumps.
Do NOT hedge types; do NOT write meta narration or bullet inventories.
When recent subjects are given, match their brevity."""

COMMIT_MESSAGE_REWRITE_SYSTEM_PROMPT = """\
Rewrite the draft into ONE Conventional Commits message.
Output ONLY: type(optional-scope): imperative subject
Optionally one blank line and at most 2 short body lines.
No preamble, bullets, analysis, markdown, or quotes.
If the draft laundry-lists files/versions, summarize the dominant intent instead.
Examples: chore: tighten commit-message generation | feat: add login | fix: handle empty diff"""

# Prefer a smaller format-following worker for SCM commit gen (override via env).
COMMIT_MESSAGE_WORKER = os.getenv("COMMIT_MESSAGE_WORKER", "gpt-oss-20b")
COMMIT_MESSAGE_MAX_TOKENS = int(os.getenv("COMMIT_MESSAGE_MAX_TOKENS", "80"))
COMMIT_MESSAGE_TEMPERATURE = float(os.getenv("COMMIT_MESSAGE_TEMPERATURE", "0"))

CODE_REQUEST_PHRASES = (
    "give me the code",
    "show me the code",
    "write the code",
    "full code",
    "complete code",
    "build it",
    "build the",
    "build for me",
    "implement it",
    "do it for me",
    "could you build",
    "can you build",
    "could you write",
    "can you write",
    "could you give me",
    "can you give me",
    "don't care if it's expensive",
    "dont care if its expensive",
)

OLLAMA_MODEL_MAP: dict[str, str] = {
    "nemotron-nano-4b": "nemotron-3-nano:4b",
    "llama3.2-3b": "llama3.2:3b",
    "llama3.2-1b": "llama3.2:1b",
    "llama3.1-8b": "llama3.1:8b",
    "codestral": "spockify-coder",
    "codestral-latest": "spockify-coder",
    "gemma4-12b": "gemma4:12b",
    "gemma4-26b": "gemma4:26b",
    "gemma3-4b": "gemma4:12b",
    "gemma3-12b": "gemma4:12b",
    "gemma3-27b": "gemma4:26b",
    "phi4": "phi4",
    "phi4-mini": "phi4-mini",
    "mistral-nemo": "mistral-nemo",
    # Keep hyphens in family name; naive replace("-", ":") yields invalid gpt:oss:20b.
    "gpt-oss-20b": "gpt-oss:20b",
    "gpt-oss-120b": "gpt-oss:120b",
    "web-codestral": "spockify-coder",
    "web-gemma": "gemma4:12b",
    "web-llama": "llama3.1:8b",
    "llama3.2-vision": "llama3.2-vision:11b",
    "llava-7b": "llava:7b",
    "llava-13b": "llava:13b",
    "llava-llama3": "llava-llama3",
    "granite-vision": "granite3.2-vision:2b",
    "mistral-small3.2": "mistral-small3.2:24b",
    "mistral-small3.1": "mistral-small3.1",
}

DEFAULT_WEB_WORKER = os.getenv("DEFAULT_WEB_WORKER", "web-gemma")
WEB_WORKER_FALLBACK = os.getenv("WEB_WORKER_FALLBACK", "web-llama")
DEFAULT_CHAT_WORKER = os.getenv("DEFAULT_CHAT_WORKER", "gemma4-12b")
DEFAULT_CHAT_FALLBACK = os.getenv("DEFAULT_CHAT_FALLBACK", "gemma4-12b")
# Models remapped to VOICE_CHAT_WORKER when Call/voice mode is active.
_VOICE_CHAT_REMAP = frozenset(
    {
        "gemma4-12b",
        "gemma3-12b",
        "gemma4-27b",
        "gemma3-27b",
        "spockify-chat",
        "mistral-nemo",
        "mistral-small",
        "phi4",
        "olmo2-7b",
        "granite",
    }
)
_VOICE_WEB_REMAP = frozenset({"web-gemma", "web-codestral"})
# Task types that keep their specialist worker even in voice mode.
_VOICE_KEEP_TASK_TYPES = frozenset(
    {
        "casual_chat",
        "code_generation",
        "code_review",
        "commit_message",
        "vision",
        "math_reasoning",
        "architecture",
        "deep_reasoning",
        "agentic_planning",
    }
)
DEFAULT_VISION_WORKER = os.getenv("DEFAULT_VISION_WORKER", "gemma4-26b")
# Gemma4 multimodal supports large ctx; keep a practical vision budget.
VISION_NUM_CTX = int(os.getenv("VISION_NUM_CTX", "16384"))
# Keep system + last N turns for vision so image+history fit the small ctx.
VISION_MAX_HISTORY_MESSAGES = int(os.getenv("VISION_MAX_HISTORY_MESSAGES", "4"))
# Multimodal fallback when primary vision worker overflows / fails.
VISION_FALLBACK_WORKER = os.getenv("VISION_FALLBACK_WORKER", "mistral-small3.2")
ROOM_RESEARCHER_WORKER = os.getenv("ROOM_RESEARCHER_WORKER", DEFAULT_CHAT_WORKER)
ROOM_CODER_WORKER = os.getenv("ROOM_CODER_WORKER", "gpt-oss-20b")
ROOM_CRITIC_WORKER = os.getenv("ROOM_CRITIC_WORKER", DEFAULT_CHAT_WORKER)
ROOM_MAX_TOKENS = int(os.getenv("ROOM_MAX_TOKENS", "1024"))
# Parallel agents — see parallel_agents.py / docs/SPOCKIFY_WAVE7_PLAN.md

WEB_SEARCH_SYSTEM_SUFFIX = (
    "You MUST synthesize a direct answer from the search results above. "
    "When temperatures, prices, dates, or other concrete values appear "
    "(including any 'Fetched from', 'Fetched page content', 'Live stock quote', "
    "or 'Live weather' sections), state them in your reply first.\n"
    "Never respond with only 'check this link', 'see SMHI', or similar when web "
    "search was performed — lead with the actual answer; cite URLs as "
    "supplementary sources.\n"
    "Grounding rules for quotations:\n"
    "- Only quote text that appears verbatim in the provided search snippets or "
    "fetched page content. Do NOT invent, paraphrase-as-quote, or embellish quotes.\n"
    "- Prefer extractive phrases from 'Fetched page content' over search snippets "
    "when they conflict.\n"
    "- When you quote or attribute a claim, include the source URL from the results.\n"
    "- If the provided sources do not contain enough text to support a quote, say so "
    "instead of fabricating one.\n"
    "Answer with concrete values only — ignore HTML/JS template placeholders "
    "(e.g. unreplaced {high} or similar markers). Never echo template syntax."
)

WEB_SEARCH_STOCK_SUFFIX = (
    "The user asked about a stock, share, or crypto price.\n"
    "CRITICAL: When a 'Live stock quote' block is present, your FIRST sentence MUST "
    "state the numeric price, currency, change %, symbol, and as-of time from that "
    "block. Treat those numbers as authoritative over search snippets.\n"
    "Do NOT reply with only exchange listings, ticker symbols, or 'check Yahoo / "
    "Google / MarketWatch' — the user wants the price shown in chat.\n"
    "Cite the Yahoo Finance URL after the numbers. Optional: one short context line "
    "from search results afterward."
)

WEB_SEARCH_CURRENT_WEATHER_SUFFIX = (
    "The user asked for temperature RIGHT NOW. Report ONLY the current observed reading "
    "as the primary answer, but you may note today's forecast high/low separately if "
    "found in the Live weather block.\n"
    "Do NOT substitute today's maximum, minimum, or evening forecast block for the "
    "current temperature.\n"
    "CRITICAL: When a 'Live weather' block is present, your FIRST sentence MUST copy "
    "the current temperature numbers from that block, including both °C and °F as written. "
    "Treat those numbers as authoritative over search snippets.\n"
    "Do NOT convert units yourself and do NOT relabel °C as °F (or vice versa). "
    "Snippets often mix Celsius and Fahrenheit — ignore conflicting snippet units."
)

WEB_SEARCH_WEATHER_SUFFIX = (
    "When reporting weather, clearly separate THREE distinct values with sources:\n"
    "(a) Current/observed temperature RIGHT NOW — from the Live weather block\n"
    "(b) Today's forecast HIGH — from the Live weather block\n"
    "(c) Tonight's forecast LOW — from the Live weather block\n"
    "CRITICAL: Copy °C and °F exactly as written in the Live weather block. "
    "Do NOT invent conversions or swap unit labels. Search snippets often mix units — "
    "trust the Live weather block over snippets.\n"
    "Never report today's max/min or evening forecast as the current temperature. "
    "Cite the source URL for each value."
)

WEB_SEARCH_VOICE_WEATHER_SUFFIX = (
    "Spoken weather: quote the numbers from the 'Live weather' block exactly. "
    "Do not invent Celsius/Fahrenheit conversions — both units are already in that "
    "block. Say the temperature in C and F in one short sentence."
)

WEB_SEARCH_TOMORROW_WEATHER_SUFFIX = (
    "The user asked for TOMORROW's weather forecast (not today's current temperature). "
    "Report tomorrow's forecast HIGH, LOW, and conditions (clouds, rain, wind) using "
    "the 'Live weather' block and search snippets.\n"
    "Copy °C and °F exactly as written — do not invent conversions.\n"
    "Lead with concrete tomorrow values — do NOT reply with only a link to SMHI or say "
    "tomorrow's forecast is unavailable when the Live weather block includes tomorrow high/low.\n"
    "Cite the source URL for each value."
)

WEB_SEARCH_FORECAST_DAY_SUFFIX = (
    "The user asked for a specific day's weather forecast ({day_label}), not the current "
    "observed temperature unless they also asked for 'now'.\n"
    "Report that day's forecast HIGH, LOW, and conditions using the 'Live weather' "
    "block and search snippets.\n"
    "Copy °C and °F exactly as written — do not invent conversions.\n"
    "Lead with concrete values — do NOT reply with only links when the Live weather block "
    "includes high/low temperatures.\n"
    "Cite the source URL for each value."
)

# Weather sites embed Go/Jinja placeholders like {{high}} in snippets; strip before prompt.
_TEMPLATE_MARKER_RE = re.compile(r"\{\{[^}]*\}\}")

ROUTING_CONTEXT_MAX_MESSAGES = int(os.getenv("ROUTING_CONTEXT_MAX_MESSAGES", "8"))

# Arithmetic / simple logic — never route to web search.
_MATH_RE = re.compile(
    r"(?:"
    r"what(?:'s|\s+is)\s+[\d.]+\s*[\+\-\*\/×÷]\s*[\d.]+"
    r"|(?:^|\s)[\d.]+\s*[\+\-\*\/×÷]\s*[\d.]+\s*[=\?]?"
    r"|how\s+much\s+is\s+[\d.]+\s*[\+\-\*\/×÷]"
    r"|calculate\s+[\d.]+\s*[\+\-\*\/×÷]"
    r"|(?:^|\s)[\d.]+\s*[\+\-\*\/×÷]\s*[\d.]+\s*$"
    r")",
    re.IGNORECASE,
)

_SIMPLE_LOGIC_RE = re.compile(
    r"(?:"
    r"true\s+or\s+false"
    r"|which\s+is\s+(?:bigger|larger|greater|smaller)"
    r"|odd\s+or\s+even"
    r")",
    re.IGNORECASE,
)

_GREETING_RE = re.compile(
    r"^(?:"
    r"hello|hi|hey|howdy|good\s+(?:morning|afternoon|evening|night)"
    r"|how\s+are\s+you|what(?:'s|\s+is)\s+up"
    r"|thanks?(?:\s+you)?|thank\s+you|thx|greetings"
    r")[\s!?.]*$",
    re.IGNORECASE,
)

_WEATHER_FOLLOW_UP_RE = re.compile(
    r"(?:"
    r"what\s+about\s+(?:tomorrow|today|tonight|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)"
    r"|(?:max|maximum|min|minimum|most)\s+(?:rain|snow|wind|temp|temperature|humidity)"
    r"|how\s+(?:hot|cold|warm|windy|rainy)"
    r"|(?:any|will\s+there\s+be)\s+(?:rain|snow)"
    r"|(?:per|each)\s+day"
    r"|day[\-\s]?by[\-\s]?day"
    r"|breakdown\s+by\s+day"
    r"|daily\s+breakdown"
    r"|and\s+(?:tomorrow|today|tonight)"
    # Swedish continuations in a weather thread
    r"|vad\s+om\s+(?:imorgon|i\s*morgon|idag|ikväll|övermorgon|overmorgon)"
    r"|hur\s+(?:varmt|kallt|varm|kall|blåsigt|regnigt)"
    r"|(?:något|nagot)\s+(?:regn|snö|sno)"
    r"|per\s+dag|varje\s+dag|dag\s+för\s+dag|dag\s+for\s+dag"
    r"|och\s+(?:imorgon|i\s*morgon|idag|ikväll|övermorgon|overmorgon)"
    r"|(?:^|[\s!?])(?:imorgon|i\s*morgon|idag|ikväll)[\?\.!]*$"
    r")",
    re.IGNORECASE,
)

# Short continuations after a prior web-search turn (news / facts / weather).
_WEB_FOLLOW_UP_RE = re.compile(
    r"(?:"
    r"^(?:and|also|what\s+about|how\s+about|och|hur\s+är\s+det\s+med|vad\s+om)\b"
    r"|(?:per|each)\s+day"
    r"|day[\-\s]?by[\-\s]?day"
    r"|per\s+dag|varje\s+dag"
    r"|^(?:more(?:\s+detail)?|go\s+deeper|expand)[\s!?.]*$"
    r"|^(?:mer|utveckla|fortsätt|fortsatt)[\s!?.]*$"
    r")",
    re.IGNORECASE,
)

_LOCATION_FOLLOW_UP_RE = re.compile(
    r"^(?:for|in|at)\s+[a-z][a-z\s\-']{1,40}[\?\.!]*$",
    re.IGNORECASE,
)

_AND_FOR_LOCATION_RE = re.compile(
    r"(?:^|\s)and\s+for\s+(.+?)[\?\.!]*$",
    re.IGNORECASE,
)

_BARE_WEATHER_WORDS = frozenset({"weather", "forecast", "temperature", "temp"})

_WEATHER_VERIFY_FOLLOW_UP_RE = re.compile(
    r"(?:"
    r"are\s+you\s+sure"
    r"|(?:double\s+)?check\s+again"
    r"|double[\-\s]?check"
    r"|(?:can\s+you\s+)?verify(?:\s+(?:that|it|again|please))?"
    r"|can\s+you\s+confirm"
    r"|look\s+again"
    r"|recheck"
    r")",
    re.IGNORECASE,
)

_TOMORROW_FOLLOW_UP_RE = re.compile(
    r"(?:"
    r"(?:what|how)\s+about\s+(?:for\s+)?tomorrow"
    r"|(?:and\s+)?for\s+tomorrow"
    r"|tomorrow(?:'s)?\s+(?:weather|forecast|high|low|temp|temperature|rain)"
    r"|(?:^|[\s!?])tomorrow[\?\.!]*$"
    r"|(?:vad\s+om|hur\s+blir\s+det|och)\s+(?:imorgon|i\s*morgon)"
    r"|(?:^|[\s!?])(?:imorgon|i\s*morgon)[\?\.!]*$"
    r"|imorgon(?:s)?\s+(?:väder|vader|prognos)"
    r")",
    re.IGNORECASE,
)

_CURRENT_WEATHER_RE = re.compile(
    r"(?:"
    r"right\s+now"
    r"|currently"
    r"|at\s+the\s+moment"
    r"|this\s+moment"
    r"|\batm\b"
    r"|what(?:'s|\s+is)\s+(?:the\s+)?(?:current\s+)?(?:temp|temperature)\b"
    r"|temperature\s+(?:in|at|for)\b"
    r"|\btemp(?:erature)?\s+(?:in|at|for)\b"
    r"|how\s+(?:hot|cold|warm|chilly)\b"
    r")",
    re.IGNORECASE,
)

_WEATHER_IN_PLACE_RE = re.compile(
    r"(?:weather|forecast|temperature|(?<!\w)temp(?!\w)|how(?:'s|\s+is)\s+it|"
    r"how\s+(?:hot|cold|warm))"
    r".{0,80}?\b(?:in|at|for|near)\s+"
    r"(?P<place>[A-Za-z]{2,}(?:[.'\-][A-Za-z0-9]+)*"
    r"(?:\s+[A-Za-z][A-Za-z0-9.'\-]*){0,3})",
    re.IGNORECASE,
)

_LOCATION_ALIASES: dict[str, str] = {
    "la": "los angeles",
    "l.a": "los angeles",
    "l.a.": "los angeles",
}

_PLACE_STOPWORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "my",
        "this",
        "that",
        "there",
        "here",
        "it",
        "today",
        "tomorrow",
        "tonight",
        "celsius",
        "fahrenheit",
        "degrees",
    }
)

_CURRENT_WEATHER_OBSERVATION_MARKERS = (
    " right now",
    "currently",
    "at the moment",
    "just nu",
    "observation",
    "observed",
    "measured",
    "live temperature",
    "current temperature",
    "aktuell",
    "temperatur just nu",
)

_FORECAST_ONLY_MARKERS = (
    " max ",
    " min ",
    "maximum",
    "minimum",
    "forecast high",
    "forecast low",
    "evening forecast",
    "daily high",
    "daily low",
    "high/low",
    "högsta",
    "lägsta",
    "prognos",
)

_FORECAST_HIGH_MARKERS = (
    " high ",
    " max ",
    "maximum",
    "forecast high",
    "daily high",
    "high of",
    "high:",
    "high/",
    "högsta",
    "high/low",
)

_HOURLY_FORECAST_MARKERS = (
    "hourly forecast",
    "hour-by-hour",
    "hour by hour",
    "timme för timme",
)

_HIGH_TEMP_RE = re.compile(
    r"(?:high|max|högsta|maximum)[^\d°]{0,24}(\d{1,2})\s*°",
    re.IGNORECASE,
)

_TEMPERATURE_VALUE_RE = re.compile(r"\d{1,2}\s*°\s*[cfCF]")

_WEATHER_FETCH_DOMAINS = (
    "smhi.se",
    "yr.no",
    "accuweather.com",
    "weather.com",
)

_HTML_SCRIPT_STYLE_RE = re.compile(
    r"<(?:script|style)[^>]*>.*?</(?:script|style)>",
    re.DOTALL | re.IGNORECASE,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")

_WEATHER_SERVICE_KEYWORDS = (
    "smhi",
    "yr.no",
    "yr no",
    "accuweather",
    "weather.com",
    "openweathermap",
)

_EXPLICIT_LOOKUP_RE = re.compile(
    r"(?:"
    r"check\s+(?:smhi|yr\.?no|the\s+weather|weather)"
    r"|(?:look\s+up|look\s+at|go\s+to)\s+(?:smhi|yr\.?no|the\s+weather|weather)"
    r"|check\s+\w+(?:\s+\w+)?\s+for\s+me"
    r")",
    re.IGNORECASE,
)

_KNOWN_LOCATIONS: dict[str, tuple[str, str, str]] = {
    "stockholm": ("Stockholm", "Sweden", "SMHI"),
    "gothenburg": ("Gothenburg", "Sweden", "SMHI"),
    "goteborg": ("Gothenburg", "Sweden", "SMHI"),
    "malmö": ("Malmö", "Sweden", "SMHI"),
    "malmo": ("Malmö", "Sweden", "SMHI"),
    "uppsala": ("Uppsala", "Sweden", "SMHI"),
    "london": ("London", "United Kingdom", ""),
    "los angeles": ("Los Angeles", "United States", ""),
    "california": ("California", "United States", ""),
    "amsterdam": ("Amsterdam", "Netherlands", ""),
    "oslo": ("Oslo", "Norway", "yr.no"),
    "copenhagen": ("Copenhagen", "Denmark", ""),
    "helsinki": ("Helsinki", "Finland", ""),
}

# SMHI open-data station IDs for latest-hour air temperature (parameter 1).
_SMHI_STATION_IDS: dict[str, str] = {
    "Stockholm": "98230",
    "Gothenburg": "71420",
    "Malmö": "52350",
    "Uppsala": "97530",
}

_SMHI_METOBS_URL = (
    "https://opendata-download-metobs.smhi.se/api/version/1.0"
    "/parameter/1/station/{station_id}/period/latest-hour/data.json"
)

_SMHI_FORECAST_URL = (
    "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1"
    "/geotype/point/lon/{lon}/lat/{lat}/data.json"
)

_SMHI_WEATHER_SYMBOLS: dict[int, str] = {
    1: "clear sky",
    2: "nearly clear sky",
    3: "variable cloudiness",
    4: "halfclear sky",
    5: "cloudy sky",
    6: "overcast",
    18: "light rain showers",
    19: "moderate rain showers",
    20: "heavy rain showers",
    21: "thunder",
}

_WMO_WEATHER_CODES: dict[int, str] = {
    0: "clear",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "foggy",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    71: "slight snow",
    73: "moderate snow",
    75: "heavy snow",
    80: "slight rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    95: "thunderstorm",
}

_CITY_COORDS: dict[str, tuple[float, float]] = {
    "Stockholm": (59.33, 18.07),
    "Gothenburg": (57.72, 11.99),
    "Malmö": (55.60, 13.00),
    "Uppsala": (59.86, 17.64),
    "London": (51.51, -0.13),
    "Los Angeles": (34.05, -118.24),
    "Amsterdam": (52.37, 4.90),
    "Oslo": (59.91, 10.75),
    "Copenhagen": (55.68, 12.57),
    "Helsinki": (60.17, 24.94),
}

_OPEN_METEO_GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"

_WEEKDAY_NAMES: dict[str, int] = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_SWEDEN_COUNTRY_NAMES = frozenset({"sweden", "sverige"})

_LOCATION_NAME_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _KNOWN_LOCATIONS) + r")\b",
    re.IGNORECASE,
)

_PREFERRED_WEATHER_DOMAINS: tuple[tuple[str, int], ...] = (
    ("smhi.se", 12),
    ("yr.no", 10),
    ("accuweather.com", 8),
)

_PREFERRED_FINANCE_DOMAINS: tuple[tuple[str, int], ...] = (
    ("finance.yahoo.com", 14),
    ("yahoo.com/quote", 12),
    ("marketwatch.com", 8),
    ("bloomberg.com", 7),
    ("reuters.com", 7),
    ("cnbc.com", 6),
    ("investing.com", 6),
    ("nasdaq.com", 6),
)

_DEPRIORITIZE_URL_PATTERNS = (
    "instagram.com",
    "facebook.com",
    "pinterest.com",
    "tiktok.com",
)

_WRONG_GEO_FOR: dict[str, tuple[str, ...]] = {
    "stockholm": ("amsterdam", "netherlands", "holland"),
    "sweden": ("amsterdam", "netherlands", "holland"),
    "gothenburg": ("amsterdam", "netherlands"),
    "malmö": ("amsterdam", "netherlands"),
    "malmo": ("amsterdam", "netherlands"),
}

_FOLLOW_UP_RE = re.compile(
    r"^(?:"
    r"do\s+(?:it|that|this)(?:\s+for\s+me)?"
    r"|implement\s+(?:it|that|this|them)"
    r"|(?:please\s+)?(?:write|build|make|create|code)\s+(?:it|that|this|them|the\s+\w+)"
    r"|go\s+ahead(?:\s+please)?"
    r"|yes(?:\s+please)?"
    r"|sure(?:\s+please)?"
    r"|ok(?:ay)?(?:\s+please)?"
    r"|please\s+(?:do|write|implement|build|make|create|code)"
    r"|(?:can|could)\s+you\s+(?:do|write|implement|build|make|code|give\s+me\s+the\s+code)(?:\s+(?:it|that|this|them))?(?:\s+for\s+me)?"
    r"|(?:give|show)\s+me\s+the\s+code"
    r"|just\s+do\s+it"
    r"|i\s+don'?t\s+care\s+if\s+it'?s\s+expensive"
    r")[\s!?.]*$",
    re.IGNORECASE,
)

_ACK_RE = re.compile(
    r"^(?:"
    r"thanks?|thank\s+you|thx|ty|got\s+it|cool|nice|great|awesome|perfect|wow|neat|sweet|"
    r"interesting|fascinating|amazing|love\s+it|makes\s+sense|fair\s+enough|"
    r"np|no\s+problem|cheers|k|kk|yep|yup|mhm|huh|okay|"
    # Swedish conversational reactions / short affirmations
    r"spännande|intressant|fascinerande|häftigt|coolt|nice|bra|fint|toppen|perfekt|"
    r"absolut|precis|exakt|jaså|jaha|aja|aha|mm+|okej|ok|ja|japp|visst|klart|"
    r"tack|tackar|tack\s+så\s+mycket|kul|roligt|spännande\s+nog|jättebra|super|"
    r"ajdå|aj då|ojoj|nämen|nähä"
    r")[\s!?.]*$",
    re.IGNORECASE,
)

# Affirmations / go-ahead replies that should stick to a coding Q&A turn.
_CODING_AFFIRM_RE = re.compile(
    r"^(?:"
    r"yes|yep|yeah|yup|sure|ok|okay|do\s+it|go\s+ahead|please\s+do|"
    r"ja|japp|jo|absolut|visst|klart|gör\s+det|kör|kör\s+på|varsågod|"
    r"yes\s+please|ja\s+tack|gärna"
    r")[\s!?.]*$",
    re.IGNORECASE,
)

_FILE_PATH_REPLY_RE = re.compile(
    r"^(?:[\w./\-]+\.(?:py|ts|tsx|js|jsx|go|rs|java|kt|swift|c|cc|cpp|h|hpp|rb|php|sh|css|html|vue|svelte|md|json|yaml|yml|toml))"
    r"[\s!?.]*$",
    re.IGNORECASE,
)

_CODING_QUESTION_HINTS = (
    "should i",
    "shall i",
    "want me to",
    "would you like me",
    "which file",
    "which function",
    "which module",
    "confirm",
    "before i",
    "refactor",
    "implement",
    "ska jag",
    "vill du att",
    "vilken fil",
    "vilken funktion",
    "bekräfta",
    "innan jag",
)

CODE_CONTEXT_KEYWORDS = CODE_KEYWORDS + (
    "tetris",
    "game",
    "program",
    "software",
    "developer",
    "coding",
    "algorithm",
    "app",
    "application",
    "script",
    "library",
    "module",
    "component",
    "frontend",
    "backend",
)

REASONING_KEYWORDS = ("analyze", "compare", "evaluate", "plan", "trade-off", "tradeoff")
ARCHITECTURE_KEYWORDS = ("architecture", "system design", "design doc")

app = FastAPI(title="Spockify Router", version="0.3.0")


def _openai_error(message: str, error_type: str, code: str, status: int) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "message": message,
                "type": error_type,
                "param": None,
                "code": code,
            }
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return _openai_error(str(exc.detail), "invalid_request_error", str(exc.status_code), exc.status_code)


@app.exception_handler(httpx.HTTPError)
async def upstream_http_error_handler(_request: Request, exc: httpx.HTTPError) -> JSONResponse:
    LOG.error("upstream HTTP error: %s", exc)
    return _openai_error(f"Upstream request failed: {exc}", "api_error", "upstream_error", 502)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    LOG.exception("unhandled router error: %s", exc)
    return _openai_error("Internal router error", "internal_error", "internal_error", 500)


MessageContent = Union[str, list[dict[str, Any]]]


class ChatMessage(BaseModel):
    role: str
    content: MessageContent


def _content_text(content: MessageContent) -> str:
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for part in content:
        if isinstance(part, dict) and part.get("type") == "text":
            parts.append(str(part.get("text", "")))
    return " ".join(parts).strip()


def _content_has_image(content: MessageContent) -> bool:
    if isinstance(content, str):
        return False
    return any(
        isinstance(part, dict) and part.get("type") == "image_url" for part in content
    )


def _messages_have_images(messages: list[ChatMessage]) -> bool:
    return any(_content_has_image(m.content) for m in messages)


def _message_to_api(msg: ChatMessage) -> dict[str, Any]:
    return {"role": msg.role, "content": msg.content}


class ChatCompletionRequest(BaseModel):
    model: str = "spockify-auto"
    messages: list[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = None
    stream: bool = False
    # Wave 9.4 — optional skill pack ids (also accepted via X-Spockify-Skills header).
    skill_ids: list[str] = Field(default_factory=list)
    # Wave 9.8 — optional role hint from OWUI (guest/family/user/admin).
    spockify_role: Optional[str] = None
    spockify_user_id: Optional[str] = None
    # Optional in-turn multi-model chat pipeline toggles (IDE path).
    spockify_pipeline_enabled: Optional[bool] = None
    spockify_pipeline_work_model: Optional[str] = None
    spockify_pipeline_explain_model: Optional[str] = None
    spockify_pipeline_post_process: Optional[bool] = None
    spockify_pipeline_hide_intermediate: Optional[bool] = None
    spockify_pipeline_dev_log: Optional[bool] = None


class ImageGenerationRequest(BaseModel):
    """OpenAI Images API subset for ComfyUI FLUX."""

    prompt: str
    model: Optional[str] = None
    n: Optional[int] = 1
    size: Optional[str] = None
    steps: Optional[int] = None
    response_format: Optional[str] = "b64_json"


class RoutingDecision(BaseModel):
    selected_model: str = DEFAULT_CHAT_WORKER
    task_type: str = "general"
    needs_web_search: bool = False
    search_query: Optional[str] = None
    confidence: float = 0.5
    reasoning: str = ""
    prompt_additions: str = ""
    routing_path: str = "orchestrator"


def _vision_route() -> RoutingDecision:
    return RoutingDecision(
        selected_model=DEFAULT_VISION_WORKER,
        task_type="vision",
        needs_web_search=False,
        confidence=0.98,
        reasoning="image input requires vision model",
        routing_path="vision",
    )


def _is_vision_decision(decision: "RoutingDecision") -> bool:
    if decision.task_type == "vision":
        return True
    path = decision.routing_path.removeprefix("cache:").removeprefix("thread_plan:")
    return path == "vision" or path.endswith(":vision")


def _vision_thread_sticky(
    thread_id: Optional[str],
    user_msg: str,
    messages: list[ChatMessage],
) -> Optional[RoutingDecision]:
    """Keep vision worker for text follow-ups after an image turn.

    OpenWebUI often strips prior image parts from later requests; the thread
    plan is the stickiness signal. Skip greetings/acks and clear topic shifts.
    """
    if not thread_id or THREAD_PLAN_TTL <= 0:
        return None
    if _is_acknowledgment(user_msg) or _is_greeting(user_msg):
        return None
    prior = _prior_messages(messages)
    if prior and _is_topic_shift(user_msg, prior):
        entry = _thread_plans.get(thread_id)
        if entry:
            _thread_plans.pop(thread_id, None)
        return None
    entry = _thread_plans.get(thread_id)
    if not entry:
        return None
    expiry, plan = entry
    if time.monotonic() > expiry:
        _thread_plans.pop(thread_id, None)
        return None
    if not _is_vision_decision(plan):
        return None
    sticky = plan.model_copy(deep=True)
    sticky.selected_model = DEFAULT_VISION_WORKER
    sticky.task_type = "vision"
    sticky.needs_web_search = False
    sticky.search_query = None
    sticky.routing_path = "thread_plan:vision"
    sticky.reasoning = f"vision sticky; {sticky.reasoning}".strip()
    sticky.confidence = max(sticky.confidence, 0.9)
    return sticky


_routing_cache: dict[str, tuple[float, "RoutingDecision"]] = {}
_thread_plans: dict[str, tuple[float, "RoutingDecision"]] = {}

# Rolling session memory: condense older turns for the worker context only
# (no DB writes). Keep recent turns verbatim.
SESSION_SUMMARY_THRESHOLD = int(os.getenv("SESSION_SUMMARY_THRESHOLD", "14"))
SESSION_KEEP_RECENT = int(os.getenv("SESSION_KEEP_RECENT", "8"))
SESSION_SUMMARY_MAX_LINES = int(os.getenv("SESSION_SUMMARY_MAX_LINES", "24"))


def _cache_key(user_msg: str, context_fingerprint: str = "") -> str:
    normalized = re.sub(r"\s+", " ", user_msg.strip().lower())
    payload = f"{normalized}|{context_fingerprint}" if context_fingerprint else normalized
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


def _context_fingerprint(messages: list[ChatMessage]) -> str:
    if len(messages) <= 1:
        return ""
    user_msg = _user_text(messages)
    if _is_topic_shift(user_msg, _prior_messages(messages)):
        return ""
    prior = messages[:-1] if messages[-1].role == "user" else messages
    text = " ".join(_content_text(m.content)[:200] for m in prior[-ROUTING_CONTEXT_MAX_MESSAGES:])
    normalized = re.sub(r"\s+", " ", text.strip().lower())[:800]
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def _cache_get(user_msg: str, context_fingerprint: str = "") -> Optional[RoutingDecision]:
    if ROUTING_CACHE_TTL <= 0:
        return None
    key = _cache_key(user_msg, context_fingerprint)
    entry = _routing_cache.get(key)
    if not entry:
        return None
    expiry, decision = entry
    if time.monotonic() > expiry:
        _routing_cache.pop(key, None)
        return None
    cached = decision.model_copy(deep=True)
    cached.routing_path = f"cache:{cached.routing_path}"
    return cached


def _cache_put(
    user_msg: str, decision: RoutingDecision, context_fingerprint: str = ""
) -> None:
    if ROUTING_CACHE_TTL <= 0 or decision.routing_path.startswith("cache:"):
        return
    key = _cache_key(user_msg, context_fingerprint)
    if len(_routing_cache) >= ROUTING_CACHE_MAX:
        oldest = min(_routing_cache, key=lambda k: _routing_cache[k][0])
        _routing_cache.pop(oldest, None)
    _routing_cache[key] = (time.monotonic() + ROUTING_CACHE_TTL, decision.model_copy(deep=True))


def _thread_id_from_headers(headers: Any) -> Optional[str]:
    """OpenWebUI / LiteLLM may pass chat id for sticky routing."""
    if headers is None:
        return None
    lookup = headers
    if hasattr(headers, "items"):
        lookup = {k.lower(): v for k, v in headers.items()}
    for key in (
        "x-openwebui-chat-id",
        "x-chat-id",
        "openwebui-chat-id",
        "x-conversation-id",
        "x-request-id",
    ):
        val = lookup.get(key)
        if val and str(val).strip():
            return str(val).strip()
    return None


def _thread_plan_get(
    thread_id: Optional[str],
    user_msg: str,
    messages: list[ChatMessage],
) -> Optional[RoutingDecision]:
    if not thread_id or THREAD_PLAN_TTL <= 0:
        return None
    prior = _prior_messages(messages)
    # Answers to a coding worker's question always stick to codestral.
    sticky_coder = _codestral_sticky_reply(user_msg, prior)
    if sticky_coder is not None:
        return sticky_coder
    # Short thanks / reactions must not inherit a prior coding worker — unless
    # that worker just asked a question (handled above).
    if _is_acknowledgment(user_msg) or _is_greeting(user_msg):
        return None
    entry = _thread_plans.get(thread_id)
    if not entry:
        return None
    expiry, plan = entry
    if time.monotonic() > expiry:
        _thread_plans.pop(thread_id, None)
        return None
    if prior and _is_topic_shift(user_msg, prior):
        _thread_plans.pop(thread_id, None)
        return None
    # Conversational follow-ups should not stay stuck on a coding worker unless
    # the user is explicitly asking to continue implementation.
    if _is_coder_worker(plan.selected_model) and not (
        _is_follow_up(user_msg) or _wants_code_implementation(user_msg)
    ):
        if not _any_keyword(user_msg, CODE_KEYWORDS):
            return None
    inherited = plan.model_copy(deep=True)
    inherited.routing_path = f"thread_plan:{inherited.routing_path.removeprefix('thread_plan:')}"
    inherited.reasoning = f"thread inherits {inherited.reasoning}".strip()
    inherited.confidence = max(inherited.confidence, 0.85)
    if _web_search_blocked(user_msg):
        inherited.needs_web_search = False
        inherited.search_query = None
    elif inherited.needs_web_search:
        inherited.search_query = _sticky_search_query(user_msg, prior, messages)
    return inherited


def _thread_plan_put(
    thread_id: Optional[str],
    decision: RoutingDecision,
) -> None:
    if not thread_id or THREAD_PLAN_TTL <= 0:
        return
    path = decision.routing_path.removeprefix("cache:").removeprefix("thread_plan:")
    if path.startswith("default") and decision.confidence < 0.6:
        return
    if len(_thread_plans) >= THREAD_PLAN_MAX:
        oldest = min(_thread_plans, key=lambda k: _thread_plans[k][0])
        _thread_plans.pop(oldest, None)
    _thread_plans[thread_id] = (
        time.monotonic() + THREAD_PLAN_TTL,
        decision.model_copy(deep=True),
    )


def _store_routing_plan(
    thread_id: Optional[str],
    user_msg: str,
    decision: RoutingDecision,
    context_fingerprint: str,
) -> None:
    _cache_put(user_msg, decision, context_fingerprint)
    _thread_plan_put(thread_id, decision)


def _routing_status_message(decision: RoutingDecision, user_msg: str = "") -> str:
    """Brief user-facing status before tokens (Gemini/Cursor-style)."""
    combined = f"{user_msg} {decision.search_query or ''}".lower()
    if decision.task_type == "vision":
        return "Analyzing image…"
    if decision.needs_web_search:
        if any(
            k in combined
            for k in (
                "weather",
                "forecast",
                "temperature",
                "smhi",
                "rain",
                "snow",
            )
        ):
            return "Checking weather…"
        if stocks.is_stock_lookup(combined) or any(
            k in combined
            for k in (
                "stock",
                "share price",
                "ticker",
                "aktiekurs",
                "bitcoin",
                "crypto",
            )
        ):
            return "Checking stock prices…"
        if any(k in combined for k in ("documentation", "docs", "github", "api")):
            return "Looking up documentation…"
        return "Searching the web…"
    if decision.task_type in ("code_generation", "code_review") or _is_coder_worker(
        decision.selected_model
    ):
        return "Writing code…"
    if decision.task_type in ("architecture", "reasoning", "agentic_planning"):
        return "Thinking deeply…"
    if decision.task_type in ("casual_chat", "math", "fast_chat"):
        return "Thinking…"
    return "Thinking…"


def _openwebui_status_event(
    description: str,
    *,
    done: bool = False,
    worker: str = "",
    web_search: bool = False,
) -> dict[str, Any]:
    """OpenWebUI status SSE frame; keep Spockify as the visible model."""
    event: dict[str, Any] = {
        "selected_model_id": SPOCKIFY_DISPLAY_MODEL,
        "event": {
            "type": "status",
            "data": {
                "action": "routing",
                "description": description,
                "done": done,
            },
        },
    }
    if worker:
        event["worker"] = worker
        event["web_search"] = web_search
    return event


def _status_sse(
    description: str,
    *,
    done: bool = False,
    worker: str = "",
    web_search: bool = False,
) -> bytes:
    payload = json.dumps(
        _openwebui_status_event(
            description, done=done, worker=worker, web_search=web_search
        ),
        separators=(",", ":"),
    )
    return f"data: {payload}\n\n".encode()


def _stream_error_sse(message: str) -> bytes:
    """Emit a terminal SSE error chunk so upstream proxies do not see a bare disconnect."""
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": SPOCKIFY_DISPLAY_MODEL,
        "choices": [
            {
                "index": 0,
                "delta": {"role": "assistant", "content": f"\n\n[Router error: {message}]"},
                "finish_reason": "stop",
            }
        ],
    }
    return f"data: {json.dumps(chunk, separators=(',', ':'))}\n\ndata: [DONE]\n\n".encode()


def _load_routing_rules() -> dict[str, Any]:
    try:
        with open(ROUTING_RULES_PATH, encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        return {}


def _explicit_search_intent(user_msg: str) -> bool:
    return _any_keyword(user_msg, SEARCH_KEYWORDS)


def _is_weather_service_lookup(user_msg: str) -> bool:
    lowered = user_msg.lower().strip().rstrip("/")
    return any(svc in lowered for svc in _WEATHER_SERVICE_KEYWORDS)


def _is_current_weather_query(text: str) -> bool:
    """User explicitly asks for temperature at this moment."""
    lowered = text.lower()
    if not _CURRENT_WEATHER_RE.search(lowered):
        return False
    weather_signals = (
        "weather",
        "temperature",
        "temp",
        "°",
        "degrees",
        "warm",
        "hot",
        "cold",
        "chilly",
        "humid",
        "windy",
        "rainy",
    )
    return _needs_live_facts(text) or any(s in lowered for s in weather_signals)


def _effective_user_query(
    query: str,
    messages: Optional[list[ChatMessage]] = None,
) -> str:
    """Latest user turn — avoids sticky anchor text polluting weather intent."""
    if messages:
        for msg in reversed(messages):
            if msg.role == "user":
                return _content_text(msg.content).strip()
    if " — " in query:
        return query.rsplit(" — ", 1)[-1].strip()
    return query.strip()


def _normalize_location_text(text: str) -> str:
    return re.sub(r"[^a-z0-9åäöü\s\-']", "", text.lower().strip())


def _fuzzy_location_key(text: str) -> Optional[str]:
    """Match typos like gothemburd → gothenburg against known locations."""
    cleaned = _normalize_location_text(text)
    if not cleaned or len(cleaned) < 3:
        return None
    if cleaned in _KNOWN_LOCATIONS:
        return cleaned
    keys = list(_KNOWN_LOCATIONS.keys())
    for key in keys:
        if key in cleaned or cleaned in key:
            return key
    matches = difflib.get_close_matches(cleaned, keys, n=1, cutoff=0.72)
    if matches:
        return matches[0]
    for token in cleaned.split():
        if len(token) < 4:
            continue
        token_matches = difflib.get_close_matches(token, keys, n=1, cutoff=0.75)
        if token_matches:
            return token_matches[0]
    return None


def _location_tuple_from_key(key: str) -> tuple[str, str, str]:
    return _KNOWN_LOCATIONS[key]


def _weather_context_text(
    text: str,
    messages: Optional[list[ChatMessage]] = None,
) -> str:
    parts = [text]
    if messages:
        parts.extend(_content_text(msg.content) for msg in messages if msg.role == "user")
    return " ".join(parts).lower()


def _strip_trailing_weather_modifiers(text: str) -> str:
    cleaned = _normalize_location_text(text)
    for pattern in (
        r"\s+right\s+now$",
        r"\s+currently$",
        r"\s+at\s+the\s+moment$",
        r"\s+atm$",
    ):
        cleaned = re.sub(pattern, "", cleaned).strip()
    return cleaned


def _c_to_f(temp_c: float) -> float:
    return temp_c * 9.0 / 5.0 + 32.0


def _format_temp_c(temp_c: float, *, decimals: int = 1) -> str:
    """Format °C with a correctly converted °F so the model never invents one."""
    temp_f = _c_to_f(temp_c)
    return f"{temp_c:.{decimals}f}°C ({temp_f:.{decimals}f}°F)"


def _has_geo_coords(resolved: Optional[dict[str, Any]]) -> bool:
    if not resolved:
        return False
    try:
        lat = float(resolved.get("lat"))
        lon = float(resolved.get("lon"))
    except (TypeError, ValueError):
        return False
    return abs(lat) > 0.01 or abs(lon) > 0.01


def _weather_place_from_text(text: str) -> Optional[str]:
    """Pull 'in LA' / 'in Los Angeles' from a weather/temperature question."""
    match = _WEATHER_IN_PLACE_RE.search((text or "").strip())
    if not match:
        return None
    place = (match.group("place") or "").strip().rstrip("?!.")
    place = re.split(r"\s*/\s*", place)[0].strip()
    for pattern in (
        r"\s+right\s+now$",
        r"\s+currently$",
        r"\s+at\s+the\s+moment$",
        r"\s+today$",
        r"\s+tomorrow$",
        r"\s+tonight$",
        r"\s+this\s+week$",
    ):
        place = re.sub(pattern, "", place, flags=re.IGNORECASE).strip()
    if not place:
        return None
    first = place.split()[0].lower().strip(".,")
    if first in _PLACE_STOPWORDS:
        return None
    return place


def _resolve_location_candidate(
    candidate: str,
    *,
    context: str = "",
) -> Optional[str]:
    """Resolve city key from free text, including LA in weather queries."""
    cleaned = _strip_trailing_weather_modifiers(candidate)
    if not cleaned:
        return None
    alias = _LOCATION_ALIASES.get(cleaned)
    if alias:
        ctx = context.lower()
        if (
            "california" in ctx
            or "los angeles" in ctx
            or "weather" in ctx
            or "forecast" in ctx
            or "temperature" in ctx
            or re.search(r"(?<!\w)temp(?!\w)", ctx)
        ):
            return alias
        return None
    if cleaned in _KNOWN_LOCATIONS:
        return cleaned
    fuzzy = _fuzzy_location_key(cleaned)
    if fuzzy:
        return fuzzy
    return _fuzzy_location_key(candidate)


def _parse_inline_location(
    text: str,
    *,
    context: str = "",
) -> Optional[tuple[str, str, str]]:
    """Extract a city from 'And for Gothenburg?' or bare 'Gothenburg.' / typos."""
    stripped = text.strip().rstrip(".?!")
    and_for = _AND_FOR_LOCATION_RE.search(stripped)
    if and_for:
        candidate = and_for.group(1).strip()
        key = _resolve_location_candidate(candidate, context=context)
        if key:
            return _location_tuple_from_key(key)
    if _LOCATION_FOLLOW_UP_RE.match(stripped):
        candidate = re.sub(r"^(?:for|in|at)\s+", "", stripped, flags=re.IGNORECASE)
        key = _resolve_location_candidate(candidate, context=context)
        if key:
            return _location_tuple_from_key(key)
    if len(stripped) <= 40 and not _is_math_query(stripped):
        key = _resolve_location_candidate(stripped, context=context)
        if key:
            return _location_tuple_from_key(key)
    return None


def _is_swedish_location(city: str, country: str) -> bool:
    if country.lower() in _SWEDEN_COUNTRY_NAMES:
        return True
    return city in _SMHI_STATION_IDS or city in _CITY_COORDS and city in (
        "Stockholm",
        "Gothenburg",
        "Malmö",
        "Uppsala",
    )


def _weather_source_for(city: str, country: str) -> str:
    if _is_swedish_location(city, country):
        return "SMHI"
    if country.lower() in ("norway", "norge") or city == "Oslo":
        return "yr.no"
    return ""


def _forecast_day_phrase(day_offset: int) -> str:
    if day_offset == 0:
        return "today"
    if day_offset == 1:
        return "tomorrow"
    if day_offset == 2:
        return "day after tomorrow"
    if day_offset == 7:
        return "next week"
    return f"in {day_offset} days"


def _weekday_day_offset(weekday_name: str, *, force_next: bool = False) -> int:
    target = _WEEKDAY_NAMES[weekday_name.lower()]
    today = datetime.now(ZoneInfo("Europe/Stockholm")).weekday()
    days_ahead = (target - today) % 7
    if force_next and days_ahead == 0:
        days_ahead = 7
    elif days_ahead == 0 and not force_next:
        days_ahead = 0
    return days_ahead


def _forecast_day_offset(
    text: str,
    messages: Optional[list[ChatMessage]] = None,
) -> Optional[int]:
    """Day offset for forecast enrichment (0=today, 1=tomorrow, etc.)."""
    user_q = _effective_user_query(text, messages)
    lowered = user_q.lower()
    prior = _prior_messages(messages) if messages else []
    in_weather = _prior_web_weather_context(prior) or _is_weather_lookup(
        user_q, None
    )

    if not in_weather and not any(
        k in lowered for k in ("weather", "forecast", "temperature", "temp")
    ):
        return None

    if re.search(r"\bday\s+after\s+tomorrow\b", lowered) or "overmorgon" in lowered or "övermorgon" in lowered:
        return 2
    if (
        "tomorrow" in lowered
        or "imorgon" in lowered
        or "i morgon" in lowered
        or _TOMORROW_FOLLOW_UP_RE.search(user_q)
    ):
        return 1
    if re.search(r"\b(?:today|idag)\b", lowered) and in_weather:
        return 0
    if re.search(r"\b(?:coming|this|the|next)\s+week\b", lowered) and (
        in_weather or any(k in lowered for k in ("forecast", "weather", "prognos"))
    ):
        return 7
    if re.search(r"\b(?:kommande|nästa|nasta)\s+vecka\b", lowered) and in_weather:
        return 7
    weekday_match = re.search(
        r"\b(?:on|this|next)\s+"
        r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        lowered,
    )
    if weekday_match and in_weather:
        name = weekday_match.group(1)
        force_next = "next" in weekday_match.group(0)
        return _weekday_day_offset(name, force_next=force_next)
    return None


def _wants_tomorrow_forecast(
    text: str,
    messages: Optional[list[ChatMessage]] = None,
) -> bool:
    """Tomorrow forecast follow-up in an existing weather thread."""
    return _forecast_day_offset(text, messages) == 1


def _has_weather_routing_intent(
    user_msg: str,
    messages: Optional[list[ChatMessage]] = None,
) -> bool:
    """Any weather query or sticky weather-thread follow-up."""
    if _is_weather_lookup(user_msg, messages):
        return True
    if not messages:
        return False
    prior = _prior_messages(messages)
    if not _prior_web_weather_context(prior):
        return False
    stripped = user_msg.strip().lower().rstrip(".?!")
    if stripped in _BARE_WEATHER_WORDS:
        return True
    if _is_weather_follow_up(user_msg, prior):
        return True
    if _parse_inline_location(user_msg):
        return True
    return False


def _ensure_weather_routing(
    user_msg: str,
    messages: list[ChatMessage],
    decision: RoutingDecision,
) -> RoutingDecision:
    """Never route weather to llama3.2-3b without search."""
    if _is_commit_message_request(user_msg, messages):
        return decision
    if not _has_weather_routing_intent(user_msg, messages):
        return decision
    patched = decision.model_copy(deep=True)
    patched.selected_model = DEFAULT_WEB_WORKER
    patched.needs_web_search = True
    patched.task_type = "web_search"
    patched.confidence = max(patched.confidence, 0.9)
    if not patched.search_query:
        patched.search_query = _refine_search_query(user_msg, messages)
    path = patched.routing_path.removeprefix("cache:").removeprefix("thread_plan:")
    if path.startswith("orchestrator") or path in ("default", "heuristic"):
        patched.routing_path = "weather_override"
    elif "weather" not in path:
        patched.routing_path = f"{path}_weather"
    if path.startswith("orchestrator"):
        patched.reasoning = f"weather override: {patched.reasoning}".strip()
    return patched


def _ensure_stock_routing(
    user_msg: str,
    messages: list[ChatMessage],
    decision: RoutingDecision,
) -> RoutingDecision:
    """Force web search for stock/crypto price asks so live quotes are injected."""
    if _is_commit_message_request(user_msg, messages):
        return decision
    if _has_weather_routing_intent(user_msg, messages):
        return decision
    if not stocks.is_stock_lookup(user_msg):
        return decision
    patched = decision.model_copy(deep=True)
    patched.selected_model = DEFAULT_WEB_WORKER
    patched.needs_web_search = True
    patched.task_type = "web_search"
    patched.confidence = max(patched.confidence, 0.9)
    if not patched.search_query:
        patched.search_query = _refine_search_query(user_msg, messages)
    path = patched.routing_path.removeprefix("cache:").removeprefix("thread_plan:")
    if path.startswith("orchestrator") or path in ("default", "heuristic"):
        patched.routing_path = "stock_override"
    elif "stock" not in path:
        patched.routing_path = f"{path}_stock"
    patched.reasoning = f"stock quote override: {patched.reasoning}".strip()
    return patched


def _finalize_routing(
    user_msg: str,
    messages: list[ChatMessage],
    decision: RoutingDecision,
) -> RoutingDecision:
    """Last-mile fixes: weather/stock intent, worker/web model mapping."""
    if _is_commit_message_request(user_msg, messages):
        patched = decision.model_copy(deep=True)
        patched.needs_web_search = False
        patched.search_query = None
        patched.task_type = "commit_message"
        # Always pin to the dedicated commit worker (not persona/chat/web).
        patched.selected_model = COMMIT_MESSAGE_WORKER
        if "commit" not in patched.routing_path:
            patched.routing_path = "pattern_commit_message"
        patched.prompt_additions = COMMIT_MESSAGE_SYSTEM_PROMPT
        return patched
    decision = _ensure_weather_routing(user_msg, messages, decision)
    decision = _ensure_stock_routing(user_msg, messages, decision)
    if decision.needs_web_search and not decision.selected_model.startswith("web-"):
        if (
            decision.selected_model.startswith("codestral")
            or decision.task_type.startswith("code")
        ):
            decision = decision.model_copy(deep=True)
            decision.selected_model = "web-codestral"
        elif decision.selected_model in (
            "llama3.2-3b",
            "llama3.1-8b",
            "spockify-chat",
            DEFAULT_CHAT_WORKER,
            DEFAULT_CHAT_FALLBACK,
            "gemma4-27b",
        ):
            decision = decision.model_copy(deep=True)
            decision.selected_model = DEFAULT_WEB_WORKER
    return decision


async def _geocode_city(
    client: httpx.AsyncClient,
    name: str,
    country_hint: str = "",
) -> Optional[dict[str, Any]]:
    """Resolve city globally via open-meteo geocoding API."""
    params: dict[str, Union[str, int]] = {
        "name": name,
        "count": 8,
        "language": "en",
        "format": "json",
    }
    try:
        resp = await client.get(
            _OPEN_METEO_GEO_URL,
            params=params,
            timeout=10.0,
            headers={"User-Agent": "SpockifyRouter/0.3.0 (geocode)"},
        )
        resp.raise_for_status()
        results = resp.json().get("results") or []
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        LOG.warning("geocoding failed for %r: %s", name, exc)
        return None
    if not results:
        return None

    hint = country_hint.lower()
    chosen = results[0]
    if hint:
        for row in results:
            country = (row.get("country") or "").lower()
            code = (row.get("country_code") or "").lower()
            if hint in country or hint == code:
                chosen = row
                break

    city = str(chosen.get("name") or name)
    country = str(chosen.get("country") or country_hint or "")
    lat = float(chosen["latitude"])
    lon = float(chosen["longitude"])
    source = _weather_source_for(city, country)
    loc: dict[str, Any] = {
        "city": city,
        "country": country,
        "lat": lat,
        "lon": lon,
    }
    if source:
        loc["weather_source"] = source
    _CITY_COORDS.setdefault(city, (lat, lon))
    return loc


async def _resolve_location_with_geocode(
    client: httpx.AsyncClient,
    location: dict[str, str],
) -> dict[str, Any]:
    """Ensure lat/lon via open-meteo when not in static table."""
    city = location["city"]
    if city in _CITY_COORDS:
        lat, lon = _CITY_COORDS[city]
        resolved: dict[str, Any] = {
            "city": city,
            "country": location.get("country", ""),
            "lat": lat,
            "lon": lon,
        }
        source = location.get("weather_source") or _weather_source_for(
            city, resolved["country"]
        )
        if source:
            resolved["weather_source"] = source
        return resolved
    geocoded = await _geocode_city(
        client, city, location.get("country", "")
    )
    if geocoded:
        return geocoded
    return {
        "city": city,
        "country": location.get("country", ""),
        "lat": 0.0,
        "lon": 0.0,
        **({"weather_source": location["weather_source"]} if location.get("weather_source") else {}),
    }


def _prior_current_weather_context(prior: list[ChatMessage]) -> bool:
    if not prior:
        return False
    for msg in reversed(prior):
        if msg.role == "user" and _is_current_weather_query(_content_text(msg.content)):
            return True
    return False


def _wants_current_weather_data(
    text: str,
    messages: Optional[list[ChatMessage]] = None,
) -> bool:
    """Fresh observed temperature — explicit 'now' or verify/recheck after current weather."""
    user_q = _effective_user_query(text, messages)
    if _wants_tomorrow_forecast(user_q, messages):
        return False
    if _is_current_weather_query(user_q):
        return True
    if _CURRENT_WEATHER_RE.search(user_q):
        prior = _prior_messages(messages) if messages else []
        if _prior_web_weather_context(prior):
            return True
    if _WEATHER_VERIFY_FOLLOW_UP_RE.search(user_q.strip()):
        prior = _prior_messages(messages) if messages else []
        if _prior_current_weather_context(prior) or _prior_web_weather_context(prior):
            return True
    return False


def _is_weather_lookup(
    text: str,
    messages: Optional[list[ChatMessage]] = None,
) -> bool:
    """Weather-related query (forecast or current)."""
    # IDE commit-message payloads often embed large diffs (weather code, templates,
    # "temp =" locals). Never treat those as weather lookups.
    if _is_commit_message_request(text, messages):
        return False
    lowered = text.lower().strip().rstrip(".?!")
    if lowered in _BARE_WEATHER_WORDS:
        if messages and _prior_web_weather_context(_prior_messages(messages)):
            return True
    # Do not match bare substring "temp" — it false-positives on template/attempt/
    # temporary/temp= in source diffs.
    if any(k in lowered for k in ("weather", "forecast", "temperature")):
        return True
    if re.search(r"(?<!\w)temp(?!\w)", lowered):
        return True
    if _parse_inline_location(text):
        return True
    if messages and _prior_web_weather_context(_prior_messages(messages)):
        if _is_weather_follow_up(text, _prior_messages(messages)):
            return True
    return False


def _explicit_lookup_intent(user_msg: str) -> bool:
    lowered = user_msg.lower().strip().rstrip("/")
    if _EXPLICIT_LOOKUP_RE.search(lowered):
        return True
    if _is_weather_service_lookup(lowered):
        return any(
            w in lowered for w in ("check", "look", "go to", "open", "visit", "see")
        )
    return False


def _has_doc_lookup_intent(user_msg: str) -> bool:
    lowered = user_msg.lower()
    return any(p in lowered for p in DOC_LOOKUP_PHRASES)


def _is_pure_code_request(user_msg: str) -> bool:
    """Coding from training data — no live docs/version lookup."""
    lowered = user_msg.lower()
    if _explicit_search_intent(user_msg) or _needs_live_facts(user_msg):
        return False
    if _has_doc_lookup_intent(user_msg):
        return False
    return _any_keyword(user_msg, CODE_KEYWORDS)


def _needs_live_facts(user_msg: str) -> bool:
    return _any_keyword(user_msg, LIVE_FACTS_KEYWORDS)


def _keyword_in_text(text: str, keyword: str) -> bool:
    """Word-boundary match — avoids 'app' in 'happened' / 'class' in 'classic'."""
    k = keyword.strip().lower()
    if not k:
        return False
    if " " in k:
        return k in text.lower()
    return bool(re.search(r"(?<!\w)" + re.escape(k) + r"(?!\w)", text, re.IGNORECASE))


def _any_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    return any(_keyword_in_text(text, k) for k in keywords)


def _assistant_suggests_code(content: str) -> bool:
    lowered = content.lower()
    return (
        "```" in content
        or "def " in content
        or "class " in content
        or "function " in lowered
        or "import " in content
    )


def _prior_coding_context(prior: list[ChatMessage]) -> bool:
    """True only when the thread is actually about coding (not keyword false positives)."""
    if not prior:
        return False
    recent = prior[-ROUTING_CONTEXT_MAX_MESSAGES:]
    for msg in reversed(recent):
        text = _content_text(msg.content)
        if msg.role == "assistant" and _assistant_suggests_code(text):
            return True
        if msg.role == "user" and _any_keyword(text, CODE_CONTEXT_KEYWORDS):
            return True
    return False


def _is_follow_up(user_msg: str) -> bool:
    return bool(_FOLLOW_UP_RE.match(user_msg.strip()))


def _is_acknowledgment(user_msg: str) -> bool:
    return bool(_ACK_RE.match(user_msg.strip()))


def _is_coding_affirmation(user_msg: str) -> bool:
    text = user_msg.strip()
    return bool(_CODING_AFFIRM_RE.match(text) or _FOLLOW_UP_RE.match(text))


def _is_file_path_reply(user_msg: str) -> bool:
    return bool(_FILE_PATH_REPLY_RE.match(user_msg.strip()))


def _assistant_posed_question(content: str) -> bool:
    """True when the assistant asked the user for confirmation or a detail."""
    text = content.strip()
    if not text:
        return False
    lowered = text.lower()
    if any(h in lowered for h in _CODING_QUESTION_HINTS):
        return True
    # Prefer the last substantive line (ignore trailing code fences).
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for line in reversed(lines):
        if line.startswith("```"):
            continue
        if line.endswith("?"):
            return True
        break
    return False


def _assistant_looks_like_coder(content: str) -> bool:
    """Heuristic: last assistant turn was a coding worker reply."""
    if _assistant_suggests_code(content):
        return True
    lowered = content.lower()
    coding_markers = (
        "```",
        "refactor",
        "implement",
        "function",
        "class ",
        "file",
        "module",
        "pull request",
        "unit test",
        "compile",
        "syntax",
        "vilken fil",
        "ska jag",
    )
    return any(m in lowered for m in coding_markers)


def _coding_awaiting_user_reply(prior: list[ChatMessage]) -> bool:
    """Last assistant asked a coding question / confirmation — stick to coder."""
    for msg in reversed(prior):
        if msg.role != "assistant":
            continue
        text = _content_text(msg.content)
        if not _assistant_posed_question(text):
            return False
        # Prefer code markers on the ask itself; else inherit coding thread context
        # so bare "Should I proceed?" still stickies after a coding turn.
        if _assistant_looks_like_coder(text):
            return True
        return _prior_coding_context(prior)
    return False


def _looks_like_detail_reply(user_msg: str) -> bool:
    """Short answer to a coding question (file name, choice, detail) — not a new topic."""
    text = user_msg.strip()
    if not text or len(text) > 80 or text.endswith("?"):
        return False
    if (
        _is_math_query(text)
        or _is_greeting(text)
        or _needs_live_facts(text)
        or _explicit_search_intent(text)
    ):
        return False
    return True


def _codestral_sticky_reply(
    user_msg: str,
    prior: list[ChatMessage],
) -> Optional[RoutingDecision]:
    """Force primary coder when user answers a coding worker's question."""
    if not _coding_awaiting_user_reply(prior):
        return None
    if _is_topic_shift(user_msg, prior) and not (
        _is_coding_affirmation(user_msg)
        or _is_file_path_reply(user_msg)
        or _is_follow_up(user_msg)
        or _is_acknowledgment(user_msg)
        or _wants_code_implementation(user_msg)
        or _any_keyword(user_msg, CODE_KEYWORDS)
        or _looks_like_detail_reply(user_msg)
    ):
        return None
    if (
        _is_coding_affirmation(user_msg)
        or _is_file_path_reply(user_msg)
        or _is_follow_up(user_msg)
        or _is_acknowledgment(user_msg)
        or _wants_code_implementation(user_msg)
        or _any_keyword(user_msg, CODE_KEYWORDS)
        or _looks_like_detail_reply(user_msg)
    ):
        return RoutingDecision(
            selected_model=ROOM_CODER_WORKER,
            task_type="code_generation",
            needs_web_search=False,
            confidence=0.94,
            reasoning=f"sticky: answer to {ROOM_CODER_WORKER} question",
            routing_path="context_sticky_codestral_qa",
        )
    return None


def _is_greeting(user_msg: str) -> bool:
    return bool(_GREETING_RE.match(user_msg.strip()))


def _is_math_query(user_msg: str) -> bool:
    text = user_msg.strip()
    if not text:
        return False
    # Diffs / long prompts often contain "1 + 2" in code — not arithmetic questions.
    if len(text) > 200:
        return False
    if _is_commit_message_request(text):
        return False
    if "```diff" in text or "diff scope:" in text.lower():
        return False
    if _MATH_RE.search(text):
        return True
    if _SIMPLE_LOGIC_RE.search(text):
        return True
    return False


def _is_commit_message_request(
    user_msg: str,
    messages: Optional[list[ChatMessage]] = None,
) -> bool:
    """True for Spockify IDE 'Generate Commit Message' chat/completions payloads."""
    parts: list[str] = [user_msg or ""]
    if messages:
        for msg in messages:
            if msg.role in ("system", "user"):
                parts.append(_content_text(msg.content))
    blob = "\n".join(parts).lower()
    if "write the commit message now" in blob:
        return True
    if "conventional commits" in blob and (
        "```diff" in blob or "diff scope:" in blob or "commit message" in blob
    ):
        return True
    if "diff scope:" in blob and "commit message" in blob:
        return True
    return False


def _commit_message_route() -> RoutingDecision:
    return RoutingDecision(
        selected_model=COMMIT_MESSAGE_WORKER,
        task_type="commit_message",
        needs_web_search=False,
        search_query=None,
        confidence=0.98,
        reasoning="IDE generate commit message — dedicated worker, no web search",
        routing_path="pattern_commit_message",
        prompt_additions=COMMIT_MESSAGE_SYSTEM_PROMPT,
    )


_CONVENTIONAL_SUBJECT_RE = re.compile(
    r"^(feat|fix|refactor|docs|test|chore|perf|build|ci|style)"
    r"(\([^)]+\))?!?:\s+\S"
)
_COMMIT_META_LINE_RE = re.compile(
    r"^(thus\b|this commit\b|this is (a |an )?(feature|fix|chore|refactor)|"
    r"could be\b|the changes?\b|changes include\b|summary\s*:|commit message\s*:|"
    r"we need to\b|i('ll| will)\b|let me\b|here('s| is)\b|the diff includes?\b|"
    r"overall intent\b|make it work\b)",
    re.IGNORECASE,
)
_COMMIT_BULLET_RE = re.compile(r"^\s*([-*•]|\d+[.)])\s+")


def _looks_like_commit_narration(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return True
    lines = [ln.rstrip() for ln in cleaned.splitlines()]
    first = (lines[0] if lines else "").strip()
    if not _CONVENTIONAL_SUBJECT_RE.match(first):
        return True
    bullets = sum(1 for ln in lines if _COMMIT_BULLET_RE.match(ln.strip()))
    if bullets >= 2:
        return True
    lower = cleaned.lower()
    if re.search(
        r"we need to craft|the diff includes|laundry.?list|overall intent:|changes:",
        lower,
    ):
        return True
    return False


def _rewrite_narration_to_conventional(raw: str) -> str:
    """Deterministic last-resort Conventional Commits subject from narration."""
    text = (raw or "").strip()
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    bullets = [
        _COMMIT_BULLET_RE.sub("", ln).strip()
        for ln in lines
        if _COMMIT_BULLET_RE.match(ln)
    ]
    blob = (" ".join(bullets) if bullets else text).lower()
    ctype = "chore"
    if re.search(r"\bfix\b|\bbug\b|\bprevent\b|\bhandle empty\b", blob):
        ctype = "fix"
    elif re.search(r"\bfeat\b|\badd\b|\bimplement\b|\bnew\b", blob) and not re.search(
        r"\bbump\b", blob
    ):
        ctype = "feat"
    elif re.search(r"\brefactor\b", blob):
        ctype = "refactor"
    elif re.search(r"\bdocs?\b|\breadme\b", blob):
        ctype = "docs"
    elif re.search(r"\btest\b|\bspec\b", blob):
        ctype = "test"
    to_ver = re.search(r"\bto\s+(\d+\.\d+\.\d+)\b", blob)
    all_vers = re.findall(r"\b(\d+\.\d+\.\d+)\b", blob)
    if to_ver:
        version = to_ver.group(1)
    elif len(all_vers) >= 2:
        version = all_vers[-1]
    elif all_vers:
        version = all_vers[0]
    else:
        version = None
    if re.search(r"\bversion\b|\bbump\b", blob) and re.search(
        r"\bcommit.?message\b|\bprompt\b|\bmax_tokens\b|\bscm\b", blob
    ):
        subject = (
            f"tighten commit-message generation and bump to {version}"
            if version
            else "tighten commit-message generation"
        )
    elif re.search(r"\bcommit.?message\b|\bprompt\b|\bmax_tokens\b", blob):
        subject = "tighten generate-commit-message prompts"
    elif re.search(r"\bversion\b|\bbump\b", blob) and version:
        subject = f"bump version to {version}"
    elif bullets:
        subject = re.sub(r"\.$", "", bullets[0])
        subject = re.sub(r"\s+across\b.*$", "", subject, flags=re.IGNORECASE)
        subject = re.sub(r"\s+in\b.*$", "", subject, flags=re.IGNORECASE)
        if len(subject) > 60:
            subject = re.sub(r"\s+\S*$", "", subject[:60]).rstrip()
    else:
        subject = "update project files"
    subject = re.sub(r"^[^a-z0-9]+", "", subject, flags=re.IGNORECASE).rstrip(".")
    subject = subject.strip() or "update project files"
    return f"{ctype}: {subject}"[:100]


def _clean_commit_message(raw: str) -> str:
    """Strip fences/meta and force Conventional Commits when the model narrates."""
    text = (raw or "").strip()
    if not text:
        return ""
    fence = re.search(r"^```(?:text|commit|markdown)?\s*([\s\S]*?)\s*```$", text, re.M)
    if fence and fence.group(1):
        text = fence.group(1).strip()
    text = re.sub(r"^(?:commit\s*message\s*:)\s*", "", text, flags=re.IGNORECASE)
    if "\n" not in text and len(text) >= 2 and text[0] in "\"'`" and text[-1] == text[0]:
        text = text[1:-1].strip()
    lines = [ln.rstrip() for ln in text.splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    subject_idx = next(
        (i for i, ln in enumerate(lines) if _CONVENTIONAL_SUBJECT_RE.match(ln.strip())),
        -1,
    )
    if subject_idx > 0:
        lines = lines[subject_idx:]
    while lines and _COMMIT_META_LINE_RE.match(lines[0].strip()):
        lines.pop(0)
        while lines and not lines[0].strip():
            lines.pop(0)
    if len(lines) > 2:
        out: list[str] = []
        blank_seen = False
        for line in lines:
            if not line.strip():
                if out:
                    blank_seen = True
                out.append(line)
                continue
            if blank_seen and (
                _COMMIT_META_LINE_RE.match(line.strip())
                or _COMMIT_BULLET_RE.match(line.strip())
            ):
                break
            non_empty = sum(1 for x in out if x.strip())
            if non_empty >= 3 and blank_seen:
                break
            out.append(line)
        lines = out
        while lines and not lines[-1].strip():
            lines.pop()
    result = "\n".join(lines).strip()
    if _looks_like_commit_narration(result):
        result = _rewrite_narration_to_conventional(raw)
    return result


def _is_valid_conventional_commit(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned or _looks_like_commit_narration(cleaned):
        return False
    first = cleaned.splitlines()[0].strip()
    return bool(_CONVENTIONAL_SUBJECT_RE.match(first))


async def _ensure_commit_message_content(
    client: httpx.AsyncClient,
    *,
    worker: str,
    raw: str,
    user_msg: str,
) -> str:
    """Sanitize model output; retry once with a strict rewrite if still narrating."""
    cleaned = _clean_commit_message(raw)
    if _is_valid_conventional_commit(cleaned):
        return cleaned
    LOG.info("commit-message: narration detected — rewrite pass worker=%s", worker)
    rewrite_messages = [
        {"role": "system", "content": COMMIT_MESSAGE_REWRITE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Draft (invalid — rewrite to Conventional Commits only):\n"
                f"```\n{(raw or cleaned).strip()[:2000]}\n```\n\n"
                "Diff context (for intent only):\n"
                f"```diff\n{(user_msg or '')[:8000]}\n```\n\n"
                "Reply with ONLY: type: subject (optional short body). "
                "No bullets or preamble."
            ),
        },
    ]
    try:
        result = await _worker_chat(
            client,
            worker,
            rewrite_messages,
            temperature=COMMIT_MESSAGE_TEMPERATURE,
            max_tokens=min(64, COMMIT_MESSAGE_MAX_TOKENS),
            stop=["\n- ", "\n* ", "\nWe need", "\nThe diff includes"],
        )
        rewritten = ""
        try:
            rewritten = str(result["choices"][0]["message"]["content"] or "")
        except (KeyError, IndexError, TypeError):
            rewritten = ""
        cleaned2 = _clean_commit_message(rewritten)
        if _is_valid_conventional_commit(cleaned2):
            return cleaned2
        if cleaned2:
            return cleaned2
    except Exception as exc:  # noqa: BLE001 — fall back to deterministic rewrite
        LOG.warning("commit-message rewrite pass failed: %s", exc)
    return cleaned or _rewrite_narration_to_conventional(raw)

def _prior_web_weather_context(prior: list[ChatMessage]) -> bool:
    if not prior:
        return False
    recent = prior[-ROUTING_CONTEXT_MAX_MESSAGES:]
    combined = " ".join(_content_text(msg.content) for msg in recent)
    return _any_keyword(combined, LIVE_FACTS_KEYWORDS)


def _prior_web_search_context(prior: list[ChatMessage]) -> bool:
    """True when a recent user turn asked for live facts / explicit web lookup."""
    if not prior:
        return False
    recent = prior[-ROUTING_CONTEXT_MAX_MESSAGES:]
    for msg in reversed(recent):
        if msg.role != "user":
            continue
        text = _content_text(msg.content)
        if (
            _explicit_search_intent(text)
            or _needs_live_facts(text)
            or _explicit_lookup_intent(text)
            or _is_weather_service_lookup(text)
        ):
            return True
    return False


def _is_weather_follow_up(user_msg: str, prior: list[ChatMessage]) -> bool:
    text = user_msg.strip()
    lowered = text.lower().rstrip("/.?!")
    if _explicit_lookup_intent(text) or _is_weather_service_lookup(text):
        if _prior_web_weather_context(prior) or _is_weather_service_lookup(text):
            return True
    if not _prior_web_weather_context(prior):
        return False
    if lowered in _BARE_WEATHER_WORDS or lowered in {"väder", "vader", "prognos"}:
        return True
    if _AND_FOR_LOCATION_RE.search(text) or _parse_inline_location(text):
        return True
    if _needs_live_facts(text):
        return True
    if _WEATHER_FOLLOW_UP_RE.search(lowered):
        return True
    if _WEATHER_VERIFY_FOLLOW_UP_RE.search(lowered):
        return True
    if _LOCATION_FOLLOW_UP_RE.match(text):
        return True
    if re.search(
        r"\b(tomorrow|today|tonight|next\s+week|coming\s+week|this\s+week|"
        r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
        r"imorgon|i\s*morgon|idag|ikväll|övermorgon|overmorgon|"
        r"nästa\s+vecka|nasta\s+vecka|kommande\s+vecka)\b",
        lowered,
    ):
        return True
    if re.search(
        r"\b(?:per|each)\s+day\b|day[\-\s]?by[\-\s]?day|breakdown\s+by\s+day|"
        r"per\s+dag|varje\s+dag|dag\s+för\s+dag",
        lowered,
    ):
        return True
    if len(text) <= 80 and not _is_math_query(text) and not _is_greeting(text):
        weather_hints = (
            "tomorrow",
            "today",
            "imorgon",
            "i morgon",
            "idag",
            "ikväll",
            "celsius",
            "fahrenheit",
            "degrees",
            "grader",
            "°",
            "per day",
            "each day",
            "day by day",
            "per dag",
            "varje dag",
        )
        if any(h in lowered for h in weather_hints):
            return True
    return False


def _is_web_follow_up(user_msg: str, prior: list[ChatMessage]) -> bool:
    """Follow-up that should stay on the web/search path without re-orchestrating."""
    if _web_search_blocked(user_msg) or _is_math_query(user_msg):
        return False
    if _is_weather_follow_up(user_msg, prior):
        return True
    if not _prior_web_search_context(prior):
        return False
    text = user_msg.strip()
    if _any_keyword(text, CODE_KEYWORDS) and not _explicit_search_intent(text):
        return False
    # Continuations only — not a brand-new question that happens to follow a search.
    if _WEB_FOLLOW_UP_RE.search(text):
        return True
    return False


def _is_topic_shift(user_msg: str, prior: list[ChatMessage]) -> bool:
    """New intent that must not inherit prior thread routing (e.g. math after weather)."""
    if _is_math_query(user_msg):
        return True
    if not prior:
        return False
    if _prior_web_weather_context(prior) and not _is_weather_follow_up(user_msg, prior):
        if _is_greeting(user_msg) or _is_acknowledgment(user_msg):
            return False
        if _any_keyword(user_msg, CODE_KEYWORDS):
            return True
        if len(user_msg.strip()) <= 120 and not _needs_live_facts(user_msg):
            if not _is_follow_up(user_msg):
                return True
    return False


def _extract_target_location(
    messages: list[ChatMessage],
    user_msg: str,
) -> Optional[dict[str, str]]:
    """Most recent geographic entity from user turns (city, country, weather_source)."""
    context = _weather_context_text(user_msg, messages)
    candidates: list[tuple[str, str, str]] = []
    for msg in messages:
        if msg.role != "user":
            continue
        for match in _LOCATION_NAME_RE.finditer(_content_text(msg.content)):
            key = match.group(1).lower()
            city, country, source = _KNOWN_LOCATIONS[key]
            candidates.append((city, country, source))
        inline = _parse_inline_location(_content_text(msg.content), context=context)
        if inline:
            candidates.append(inline)
    for match in _LOCATION_NAME_RE.finditer(user_msg):
        key = match.group(1).lower()
        city, country, source = _KNOWN_LOCATIONS[key]
        candidates.append((city, country, source))
    inline = _parse_inline_location(user_msg, context=context)
    if inline:
        candidates.append(inline)
    if _is_weather_lookup(user_msg, messages):
        place = _weather_place_from_text(user_msg)
        if place:
            key = _resolve_location_candidate(place, context=context)
            if key:
                candidates.append(_location_tuple_from_key(key))
            elif place.split()[0].lower() not in _PLACE_STOPWORDS:
                city_name = place.strip()
                source = _weather_source_for(city_name, "")
                candidates.append((city_name, "", source))
    if not candidates:
        return None
    city, country, source = candidates[-1]
    if not source:
        source = _weather_source_for(city, country)
    loc: dict[str, str] = {"city": city, "country": country}
    if source:
        loc["weather_source"] = source
    return loc


def _refine_search_query(
    query: str,
    messages: list[ChatMessage],
) -> str:
    """Append location + trusted weather source hints for geographic queries."""
    user_q = _effective_user_query(query, messages)
    location = _extract_target_location(messages, query)
    wants_current = _wants_current_weather_data(user_q, messages)
    day_offset = _forecast_day_offset(user_q, messages)

    if not location:
        if _is_weather_service_lookup(query):
            svc = next(
                (s for s in _WEATHER_SERVICE_KEYWORDS if s in query.lower()),
                "SMHI",
            )
            base = f"{query.strip()} {svc.upper() if svc == 'smhi' else svc} weather"
            if day_offset is not None:
                base = f"{base} forecast {_forecast_day_phrase(day_offset)}"
            elif wants_current and "current temperature" not in base.lower():
                base = f"{base} current temperature now"
            return base
        if day_offset is not None and "forecast" not in query.lower():
            return f"{query.strip()} weather forecast {_forecast_day_phrase(day_offset)}"
        if wants_current and "current temperature" not in query.lower():
            return f"{query.strip()} current temperature now"
        return query

    parts = [query.strip()]
    city = location["city"]
    country = location["country"]
    source = location.get("weather_source", "")

    if city.lower() not in query.lower():
        parts.append(city)
    if country.lower() not in query.lower():
        parts.append(country)
    if _is_weather_service_lookup(query) and source:
        parts.append(source)
    elif (
        _needs_live_facts(query)
        or "weather" in query.lower()
        or _prior_web_weather_context(messages)
    ):
        if source and source.lower() not in query.lower():
            parts.append(source)

    if day_offset is not None:
        phrase = _forecast_day_phrase(day_offset)
        joined = " ".join(parts).lower()
        if phrase not in joined and "forecast" not in joined:
            parts.append(f"weather forecast {phrase}")
        if source == "SMHI" and "smhi" not in joined:
            parts.append("smhi")
    elif wants_current:
        if "current temperature" not in query.lower():
            parts.append("current temperature now")
        if source == "SMHI" and "site:smhi.se" not in query.lower():
            parts.append("site:smhi.se observations")
    elif (
        _needs_live_facts(query)
        or "weather" in query.lower()
        or _prior_web_weather_context(messages)
    ):
        if "forecast" not in query.lower() and "high" not in query.lower():
            parts.append("forecast today high low")
        if source == "SMHI":
            if "accuweather" not in query.lower():
                parts.append("accuweather")

    return " ".join(parts)


def _weather_search_queries(
    query: str,
    messages: list[ChatMessage],
) -> list[str]:
    """Build SearXNG queries for weather; dual search for current + forecast high/low."""
    if not _is_weather_lookup(query, messages):
        return [_refine_search_query(query, messages)]

    user_q = _effective_user_query(query, messages)
    day_offset = _forecast_day_offset(user_q, messages)
    refined = _refine_search_query(query, messages)
    queries = [refined]
    location = _extract_target_location(messages, query)
    if not location:
        return queries

    city = location["city"]
    source = location.get("weather_source", "")
    src_tag = source if source else "weather"
    day_phrase = _forecast_day_phrase(day_offset) if day_offset is not None else "today"

    if day_offset is not None and day_offset >= 1:
        forecast_q = f"{city} weather forecast {day_phrase} high low"
        if source == "SMHI":
            forecast_q = f"{forecast_q} smhi"
        elif src_tag:
            forecast_q = f"{forecast_q} {src_tag.lower()} accuweather"
        extras = (forecast_q,)
    else:
        current_q = f"{city} current temperature now {src_tag} observations"
        forecast_q = (
            f"{city} weather forecast today high low "
            f"{src_tag.lower() if src_tag else 'smhi'} accuweather"
        )
        extras = (current_q, forecast_q)

    seen = {q.lower() for q in queries}
    for extra in extras:
        if extra.lower() not in seen:
            queries.append(extra)
            seen.add(extra.lower())

    if source == "SMHI":
        if day_offset is not None and day_offset >= 1:
            site_q = f"site:smhi.se {city} prognos {day_phrase}"
        else:
            site_q = f"site:smhi.se {city} temperatur just nu"
        if site_q.lower() not in seen:
            queries.append(site_q)

    return queries


def _sticky_search_query(
    user_msg: str,
    prior: list[ChatMessage],
    messages: Optional[list[ChatMessage]] = None,
) -> str:
    weather_msg: Optional[str] = None
    facts_msg: Optional[str] = None
    for msg in reversed(prior):
        if msg.role != "user":
            continue
        content = _content_text(msg.content).strip()
        if weather_msg is None and "weather" in content.lower():
            weather_msg = content
        if facts_msg is None and (
            _needs_live_facts(content) or _is_weather_service_lookup(content)
        ):
            facts_msg = content
    anchor = weather_msg or facts_msg
    all_msgs = messages if messages is not None else prior
    stripped = user_msg.strip().lower().rstrip(".?!")
    if stripped in _BARE_WEATHER_WORDS:
        location = _extract_target_location(all_msgs, user_msg)
        if location:
            city = location["city"]
            base = f"{city} weather forecast today high low"
            return _refine_search_query(base, all_msgs)
    base = f"{anchor} — {user_msg}" if anchor else user_msg
    refined = _refine_search_query(base, all_msgs)
    if _WEATHER_VERIFY_FOLLOW_UP_RE.search(user_msg.strip()):
        if "current temperature" not in refined.lower():
            refined = f"{refined} current temperature now"
        location = _extract_target_location(all_msgs, user_msg)
        if location and location.get("weather_source") == "SMHI":
            if "site:smhi.se" not in refined.lower():
                refined = f"{refined} site:smhi.se observations"
    else:
        day_offset = _forecast_day_offset(user_msg, all_msgs)
        if day_offset is not None:
            location = _extract_target_location(all_msgs, user_msg)
            city = location["city"] if location else ""
            src = (location or {}).get("weather_source", "SMHI")
            phrase = _forecast_day_phrase(day_offset)
            if city and city.lower() not in refined.lower():
                refined = f"{refined} {city}"
            if phrase not in refined.lower():
                refined = f"{refined} weather forecast {phrase}"
            if src == "SMHI" and "smhi" not in refined.lower():
                refined = f"{refined} smhi"
    return refined


def _math_route(user_msg: str) -> RoutingDecision:
    return RoutingDecision(
        selected_model="llama3.2-3b",
        task_type="math",
        needs_web_search=False,
        confidence=0.96,
        reasoning="arithmetic or simple logic — no web search",
        routing_path="pattern_math",
    )


def _web_search_blocked(user_msg: str) -> bool:
    if _is_commit_message_request(user_msg):
        return True
    if _is_math_query(user_msg):
        return True
    if _is_greeting(user_msg):
        return True
    if _is_acknowledgment(user_msg):
        return True
    if _is_pure_code_request(user_msg):
        return True
    return False


def _web_search_header(needs_search: bool) -> str:
    return "true" if needs_search else "false"


SEARCH_MODE_MARKER_RE = re.compile(
    r"\[spockify_search_mode:(auto|on|off)\]",
    re.IGNORECASE,
)
VOICE_MODE_MARKER_RE = re.compile(
    r"\[spockify_voice:(1|true|yes|on)\]",
    re.IGNORECASE,
)
VALID_SEARCH_MODES = frozenset({"auto", "on", "off"})


def _normalize_search_mode(raw: Optional[str]) -> str:
    mode = (raw or "auto").strip().lower()
    return mode if mode in VALID_SEARCH_MODES else "auto"


def _parse_bool_flag(raw: Optional[str]) -> bool:
    return str(raw or "").strip().lower() in ("1", "true", "yes", "on")


def _search_mode_from_headers(headers: Any) -> Optional[str]:
    if headers is None:
        return None
    lookup = headers
    if hasattr(headers, "items"):
        lookup = {k.lower(): v for k, v in headers.items()}
    for key in (
        "x-spockify-search-mode",
        "x-spockify-web-search-mode",
    ):
        val = lookup.get(key)
        if val and str(val).strip():
            return _normalize_search_mode(str(val))
    return None


def _voice_mode_from_headers(headers: Any) -> bool:
    if headers is None:
        return False
    lookup = headers
    if hasattr(headers, "items"):
        lookup = {k.lower(): v for k, v in headers.items()}
    for key in ("x-spockify-voice", "x-spockify-call"):
        if _parse_bool_flag(lookup.get(key)):
            return True
    return False


def _voice_mode_from_messages(
    messages: list[ChatMessage],
) -> tuple[bool, list[ChatMessage]]:
    """Extract optional Call/voice marker; strip it from messages."""
    found = False
    cleaned: list[ChatMessage] = []
    for msg in messages:
        text = _content_text(msg.content)
        match = VOICE_MODE_MARKER_RE.search(text)
        if match:
            found = True
            stripped = VOICE_MODE_MARKER_RE.sub("", text).strip()
            if msg.role == "system" and not stripped:
                continue
            if stripped != text:
                if isinstance(msg.content, str):
                    msg = msg.model_copy(update={"content": stripped})
                else:
                    new_parts: list[Any] = []
                    for part in msg.content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            part_text = VOICE_MODE_MARKER_RE.sub(
                                "", str(part.get("text", ""))
                            ).strip()
                            new_parts.append({**part, "text": part_text})
                        else:
                            new_parts.append(part)
                    msg = msg.model_copy(update={"content": new_parts})
        cleaned.append(msg)
    return found, cleaned


def _apply_voice_mode(
    decision: RoutingDecision,
    voice_mode: bool,
) -> RoutingDecision:
    """Prefer mid-size voice worker for Call; keep tools/web/code specialists."""
    if not voice_mode:
        return decision

    patched = decision.model_copy(deep=True)
    task = (patched.task_type or "").strip().lower()
    selected = (patched.selected_model or "").strip()
    path = (patched.routing_path or "").strip().lower()

    # Only true greeting/ack fast-paths stay on the tiny model.
    if selected == FAST_CHAT_WORKER and path in ("heuristic", "heuristic_ack"):
        return patched

    # Code / vision / math / commit keep their specialists.
    if task in _VOICE_KEEP_TASK_TYPES and selected in (
        ROOM_CODER_WORKER,
        COMMIT_MESSAGE_WORKER,
        DEFAULT_VISION_WORKER,
        "codestral",
        "gpt-oss-20b",
        "gpt-oss-120b",
        "mathstral",
    ):
        return patched

    if patched.needs_web_search or selected.startswith("web-"):
        # Prefer web-llama (llama3.1:8b) for faster spoken synthesis after SearXNG.
        if selected in _VOICE_WEB_REMAP or selected == DEFAULT_WEB_WORKER:
            patched.selected_model = VOICE_WEB_WORKER
            patched.reasoning = (
                f"{patched.reasoning}; voice→{VOICE_WEB_WORKER}".strip("; ")
            )
        return patched

    if selected in _VOICE_CHAT_REMAP or selected in (
        DEFAULT_CHAT_WORKER,
        DEFAULT_CHAT_FALLBACK,
        FAST_CHAT_WORKER,
    ):
        patched.selected_model = VOICE_CHAT_WORKER
        patched.reasoning = (
            f"{patched.reasoning}; voice→{VOICE_CHAT_WORKER}".strip("; ")
        )
        return patched

    # Pattern/orchestrator "general" / "fast_chat" / "reasoning" / casual without remap.
    if task in ("general", "fast_chat", "reasoning", "nvidia_chat", "casual_chat", ""):
        if not selected.startswith(("web-", "gpt-oss", "codestral", "llava")):
            patched.selected_model = VOICE_CHAT_WORKER
            patched.reasoning = (
                f"{patched.reasoning}; voice→{VOICE_CHAT_WORKER}".strip("; ")
            )
    return patched


def _search_mode_from_messages(
    messages: list[ChatMessage],
) -> tuple[Optional[str], list[ChatMessage]]:
    """Extract optional per-turn search mode marker; strip it from messages."""
    found: Optional[str] = None
    cleaned: list[ChatMessage] = []
    for msg in messages:
        text = _content_text(msg.content)
        match = SEARCH_MODE_MARKER_RE.search(text)
        if match:
            found = _normalize_search_mode(match.group(1))
            stripped = SEARCH_MODE_MARKER_RE.sub("", text).strip()
            if msg.role == "system" and not stripped:
                continue
            if stripped != text:
                if isinstance(msg.content, str):
                    msg = msg.model_copy(update={"content": stripped})
                else:
                    # Multimodal: strip marker from text parts only.
                    new_parts: list[Any] = []
                    for part in msg.content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            part_text = SEARCH_MODE_MARKER_RE.sub(
                                "", str(part.get("text", ""))
                            ).strip()
                            new_parts.append({**part, "text": part_text})
                        else:
                            new_parts.append(part)
                    msg = msg.model_copy(update={"content": new_parts})
        cleaned.append(msg)
    return found, cleaned


def _apply_user_search_mode(
    user_msg: str,
    decision: RoutingDecision,
    mode: str,
) -> RoutingDecision:
    """Honor per-turn search override: off never, on prefer, auto unchanged."""
    mode = _normalize_search_mode(mode)
    if mode == "auto":
        return decision

    patched = decision.model_copy(deep=True)
    if mode == "off":
        patched.needs_web_search = False
        patched.search_query = None
        if patched.selected_model.startswith("web-"):
            base = patched.selected_model.removeprefix("web-")
            if base in ("gemma", "gemma4-12b", "gemma4-27b", "gemma3-12b"):
                patched.selected_model = DEFAULT_CHAT_WORKER
            else:
                patched.selected_model = base
        patched.reasoning = f"search_mode=off; {patched.reasoning}".strip()
        return patched

    # mode == "on" — prefer search unless hard-blocked (math/greeting/ack/code)
    if _web_search_blocked(user_msg):
        patched.needs_web_search = False
        patched.search_query = None
        patched.reasoning = f"search_mode=on blocked; {patched.reasoning}".strip()
        return patched
    patched.needs_web_search = True
    if not patched.search_query:
        patched.search_query = user_msg
    if patched.task_type == "general":
        patched.task_type = "web_search"
    patched.reasoning = f"search_mode=on; {patched.reasoning}".strip()
    return patched


def _response_headers(
    worker: str,
    decision: RoutingDecision,
    hud: Optional[dict[str, Any]] = None,
) -> dict[str, str]:
    reason = (decision.reasoning or "").strip().replace("\n", " ")
    if len(reason) > 240:
        reason = reason[:237] + "…"
    headers = {
        "X-Spockify-Worker": worker,
        "X-Spockify-Routing-Path": decision.routing_path,
        "X-Spockify-Web-Search": _web_search_header(decision.needs_web_search),
    }
    if reason:
        # Latin-1 safe for HTTP headers (drop non-ascii).
        headers["X-Spockify-Reasoning"] = reason.encode("ascii", "ignore").decode(
            "ascii"
        ) or decision.routing_path
    if hud:
        headers.update(cost_hud.hud_headers(hud))
    return headers


def _hud_sse(hud: dict[str, Any], *, worker: str = "") -> bytes:
    payload: dict[str, Any] = {
        "selected_model_id": SPOCKIFY_DISPLAY_MODEL,
        "spockify_hud": hud,
        "worker": worker or hud.get("worker") or "",
    }
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode()


def _critique_sse(crit: dict[str, Any]) -> bytes:
    payload = {
        "selected_model_id": SPOCKIFY_DISPLAY_MODEL,
        "spockify_critique": crit,
    }
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode()


def _estimate_tokens_from_text(text: str) -> int:
    # Rough ~4 chars/token for local models when usage missing.
    return max(0, len(text or "") // 4)


def _is_coder_worker(worker: str) -> bool:
    name = worker.lower()
    return any(
        name == prefix or name.startswith(f"{prefix}-")
        for prefix in CODER_MODEL_PREFIXES
    )


def _wants_code_implementation(user_msg: str) -> bool:
    if _is_follow_up(user_msg):
        return True
    lowered = user_msg.lower().strip()
    return any(phrase in lowered for phrase in CODE_REQUEST_PHRASES)


def _coder_worker_system_messages(
    worker: str,
    user_msg: str,
) -> list[dict[str, str]]:
    if not _is_coder_worker(worker):
        return []
    messages: list[dict[str, str]] = [
        {"role": "system", "content": CODER_SYSTEM_PROMPT},
    ]
    if _wants_code_implementation(user_msg):
        messages.append(
            {"role": "system", "content": CODE_IMPLEMENTATION_PROMPT},
        )
    return messages


def _prior_messages(messages: list[ChatMessage]) -> list[ChatMessage]:
    if not messages:
        return []
    if messages[-1].role == "user":
        return messages[:-1]
    return messages


def _format_routing_context(
    messages: list[ChatMessage],
    max_messages: int = ROUTING_CONTEXT_MAX_MESSAGES,
) -> str:
    prior = _prior_messages(messages)
    if not prior:
        return ""
    lines: list[str] = []
    for msg in prior[-max_messages:]:
        text = _content_text(msg.content).strip()
        if len(text) > 400:
            text = text[:400] + "..."
        lines.append(f"{msg.role.capitalize()}: {text}")
    return "Recent conversation:\n" + "\n".join(lines)


def _infer_domain_from_context(prior: list[ChatMessage]) -> Optional[RoutingDecision]:
    if not prior:
        return None

    recent = prior[-ROUTING_CONTEXT_MAX_MESSAGES:]
    combined = " ".join(_content_text(msg.content) for msg in recent)

    for msg in reversed(recent):
        if msg.role == "user" and _explicit_search_intent(_content_text(msg.content)):
            model = (
                "web-codestral"
                if _any_keyword(combined, CODE_KEYWORDS)
                else DEFAULT_WEB_WORKER
            )
            return RoutingDecision(
                selected_model=model,
                task_type="web_search",
                needs_web_search=True,
                search_query=_content_text(msg.content),
                confidence=0.86,
                reasoning="prior turn requested web facts",
                routing_path="context",
            )

    if _prior_web_weather_context(recent):
        return RoutingDecision(
            selected_model=DEFAULT_WEB_WORKER,
            task_type="web_search",
            needs_web_search=True,
            confidence=0.85,
            reasoning="prior weather thread",
            routing_path="context",
        )

    if _prior_coding_context(recent):
        return RoutingDecision(
            selected_model=ROOM_CODER_WORKER,
            task_type="code_generation",
            confidence=0.88,
            reasoning="prior coding context",
            routing_path="context",
        )

    if _any_keyword(combined, ARCHITECTURE_KEYWORDS):
        return RoutingDecision(
            selected_model="gemma4-27b",
            task_type="architecture",
            confidence=0.84,
            reasoning="prior architecture discussion",
            routing_path="context",
        )

    if _any_keyword(combined, REASONING_KEYWORDS):
        return RoutingDecision(
            selected_model="gemma4-12b",
            task_type="reasoning",
            confidence=0.82,
            reasoning="prior reasoning task",
            routing_path="context",
        )

    casual_markers = (
        "hello",
        "hi ",
        "hey",
        "how are you",
        "good morning",
        "good evening",
        "what's up",
        "thanks",
        "thank you",
    )
    user_msgs = [_content_text(msg.content).lower() for msg in recent if msg.role == "user"]
    if user_msgs and all(any(m in text for m in casual_markers) for text in user_msgs):
        return RoutingDecision(
            selected_model=DEFAULT_CHAT_WORKER,
            task_type="casual_chat",
            confidence=0.8,
            reasoning="prior casual chat",
            routing_path="context",
        )

    return None


def _context_aware_route(
    messages: list[ChatMessage],
    user_msg: str,
) -> Optional[RoutingDecision]:
    prior = _prior_messages(messages)
    if not prior:
        return None

    sticky_coder = _codestral_sticky_reply(user_msg, prior)
    if sticky_coder is not None:
        return sticky_coder

    # Chat reactions ("Spännande!", "cool") after non-coding turns stay off coder.
    if _is_acknowledgment(user_msg):
        if _prior_coding_context(prior) and _is_coding_affirmation(user_msg):
            return RoutingDecision(
                selected_model=ROOM_CODER_WORKER,
                task_type="code_generation",
                needs_web_search=False,
                confidence=0.88,
                reasoning="sticky: coding affirmation",
                routing_path="context_sticky_codestral_ack",
            )
        return RoutingDecision(
            selected_model=DEFAULT_CHAT_WORKER,
            task_type="casual_chat",
            needs_web_search=False,
            confidence=0.9,
            reasoning="chat reaction — no search",
            routing_path="context_chitchat",
        )

    if _is_weather_follow_up(user_msg, prior):
        sticky_query = _sticky_search_query(user_msg, prior, messages)
        return RoutingDecision(
            selected_model=DEFAULT_WEB_WORKER,
            task_type="web_search",
            needs_web_search=True,
            search_query=sticky_query,
            confidence=0.9,
            reasoning="sticky: weather thread follow-up",
            routing_path="context_sticky_weather",
        )

    if _is_web_follow_up(user_msg, prior):
        sticky_query = _sticky_search_query(user_msg, prior, messages)
        model = (
            "web-codestral"
            if _any_keyword(
                " ".join(_content_text(m.content) for m in prior[-ROUTING_CONTEXT_MAX_MESSAGES:]),
                CODE_KEYWORDS,
            )
            else DEFAULT_WEB_WORKER
        )
        return RoutingDecision(
            selected_model=model,
            task_type="web_search",
            needs_web_search=True,
            search_query=sticky_query,
            confidence=0.88,
            reasoning="sticky: web search thread follow-up",
            routing_path="context_sticky_web",
        )

    if _is_topic_shift(user_msg, prior):
        return None

    is_follow_up = _is_follow_up(user_msg)
    ambiguous_short = (
        len(user_msg.strip()) <= 120
        and not _explicit_search_intent(user_msg)
        and not _any_keyword(user_msg, CODE_KEYWORDS)
        and not _is_math_query(user_msg)
    )
    if not is_follow_up and not ambiguous_short:
        return None

    decision = _infer_domain_from_context(prior)

    if decision is None and is_follow_up:
        for msg in reversed(prior):
            if msg.role == "assistant" and _assistant_suggests_code(_content_text(msg.content)):
                decision = RoutingDecision(
                    selected_model=ROOM_CODER_WORKER,
                    task_type="code_generation",
                    confidence=0.86,
                    reasoning="sticky: prior assistant code response",
                    routing_path="context_sticky",
                )
                break

    if decision is None:
        return None

    if decision.task_type == "casual_chat" and not is_follow_up:
        return None

    if is_follow_up:
        decision = decision.model_copy(deep=True)
        decision.routing_path = "context_follow_up"
        decision.reasoning = f"follow-up inherits {decision.reasoning}"
        decision.confidence = max(decision.confidence, 0.84)
        if decision.needs_web_search and not _web_search_blocked(user_msg):
            decision.search_query = _sticky_search_query(user_msg, prior, messages)
        else:
            decision.needs_web_search = False
            decision.search_query = None
    elif decision.needs_web_search and decision.task_type == "web_search":
        decision = decision.model_copy(deep=True)
        decision.routing_path = "context_sticky"
        decision.search_query = _sticky_search_query(user_msg, prior, messages)
    return decision


def _pattern_matches(lowered: str, pattern: str) -> bool:
    """Match routing patterns without substring false positives (e.g. hi in smhi)."""
    p = pattern.strip().lower()
    if not p:
        return False
    if len(p) <= 16 and re.fullmatch(r"[\w\s\-'/.:]+", p):
        escaped = re.escape(p).replace(r"\ ", r"\s+")
        return bool(re.search(r"(?<!\w)" + escaped + r"(?!\w)", lowered))
    return p in lowered


def _pattern_route(user_msg: str, rules: dict[str, Any]) -> Optional[RoutingDecision]:
    """Fast-path routing from explicit pattern matches only (not default_route)."""
    lowered = user_msg.lower()
    for route in rules.get("task_routes", []):
        if any(_pattern_matches(lowered, p) for p in route.get("patterns", [])):
            needs_web = route.get("task_type") == "web_search" or _explicit_search_intent(
                user_msg
            )
            return RoutingDecision(
                selected_model=route.get("model", DEFAULT_CHAT_WORKER),
                task_type=route.get("task_type", "general"),
                needs_web_search=needs_web,
                search_query=user_msg if needs_web else None,
                confidence=float(route.get("confidence", 0.85)),
                reasoning=f"pattern match: {route.get('task_type')}",
                prompt_additions=route.get("prompt_additions", ""),
                routing_path="pattern",
            )
    return None


def _heuristic_route(
    user_msg: str,
    messages: Optional[list[ChatMessage]] = None,
) -> Optional[RoutingDecision]:
    """Cheap local routing for obvious short requests before any LLM call."""
    lowered = user_msg.lower().strip()
    if not lowered:
        return None

    if _is_commit_message_request(user_msg, messages):
        return _commit_message_route()

    if _is_math_query(user_msg):
        return _math_route(user_msg)

    if _is_greeting(user_msg):
        return RoutingDecision(
            selected_model=FAST_CHAT_WORKER,
            task_type="casual_chat",
            confidence=0.9,
            reasoning="greeting — tiny warm model",
            routing_path="heuristic",
        )

    if _is_acknowledgment(user_msg):
        return RoutingDecision(
            selected_model=FAST_CHAT_WORKER,
            task_type="casual_chat",
            needs_web_search=False,
            confidence=0.92,
            reasoning="acknowledgment — tiny warm model",
            routing_path="heuristic_ack",
        )

    if (
        _explicit_lookup_intent(user_msg)
        or _explicit_search_intent(user_msg)
        or _needs_live_facts(user_msg)
        or stocks.is_stock_lookup(user_msg)
        or _is_weather_service_lookup(user_msg)
        or _has_weather_routing_intent(user_msg, messages)
    ):
        if _any_keyword(user_msg, CODE_KEYWORDS):
            model = "web-codestral"
        else:
            model = DEFAULT_WEB_WORKER
        search_q = user_msg
        if messages:
            search_q = _refine_search_query(user_msg, messages)
        reason = "live facts, lookup intent, or weather service"
        if stocks.is_stock_lookup(user_msg):
            reason = "stock/crypto price lookup"
        return RoutingDecision(
            selected_model=model,
            task_type="web_search",
            needs_web_search=True,
            search_query=search_q,
            confidence=0.85,
            reasoning=reason,
            routing_path="heuristic",
        )

    if _any_keyword(user_msg, CODE_KEYWORDS):
        return RoutingDecision(
            selected_model=ROOM_CODER_WORKER,
            task_type="code_generation",
            confidence=0.78,
            reasoning="code keywords",
            routing_path="heuristic",
        )

    # Short messages — only fast-path when context already implies a domain.
    if len(user_msg) <= 120:
        if messages and len(messages) > 1:
            prior = _prior_messages(messages)
            if _has_weather_routing_intent(user_msg, messages):
                search_q = _refine_search_query(user_msg, messages)
                return RoutingDecision(
                    selected_model=DEFAULT_WEB_WORKER,
                    task_type="web_search",
                    needs_web_search=True,
                    search_query=search_q,
                    confidence=0.88,
                    reasoning="weather thread or forecast follow-up",
                    routing_path="heuristic_weather",
                )
            if _is_topic_shift(user_msg, prior):
                return RoutingDecision(
                    selected_model=DEFAULT_CHAT_WORKER,
                    task_type="general",
                    confidence=0.8,
                    reasoning="topic shift — fresh chat path",
                    routing_path="heuristic",
                )
            if _is_follow_up(user_msg) or _infer_domain_from_context(prior) is not None:
                return None
        return None
    return None


def _gate_web_search(
    user_msg: str,
    decision: RoutingDecision,
    messages: Optional[list[ChatMessage]] = None,
) -> RoutingDecision:
    """Apply hard blocks; trust orchestrator for needs_web_search on ambiguous cases."""
    if _web_search_blocked(user_msg):
        decision = decision.model_copy(deep=True)
        decision.needs_web_search = False
        decision.search_query = None
        if decision.selected_model.startswith("web-"):
            base = decision.selected_model.removeprefix("web-")
            if base in ("gemma", "gemma4-12b", "gemma4-27b", "gemma3-12b"):
                decision.selected_model = DEFAULT_CHAT_WORKER
            else:
                decision.selected_model = base
        return decision

    path = decision.routing_path.removeprefix("cache:")
    if path.startswith("orchestrator"):
        if messages:
            decision = _ensure_weather_routing(user_msg, messages, decision)
            decision = _ensure_stock_routing(user_msg, messages, decision)
        return decision

    if not ROUTING_FAST_MODE:
        if messages:
            decision = _ensure_weather_routing(user_msg, messages, decision)
            decision = _ensure_stock_routing(user_msg, messages, decision)
        return decision
    if (
        _explicit_lookup_intent(user_msg)
        or _explicit_search_intent(user_msg)
        or _needs_live_facts(user_msg)
        or stocks.is_stock_lookup(user_msg)
        or _is_weather_service_lookup(user_msg)
        or _has_weather_routing_intent(user_msg, messages)
    ):
        if messages:
            decision = _ensure_weather_routing(user_msg, messages, decision)
            decision = _ensure_stock_routing(user_msg, messages, decision)
        return decision
    if decision.needs_web_search and decision.confidence >= SEARCH_CONFIDENCE_MIN:
        if messages:
            decision = _ensure_weather_routing(user_msg, messages, decision)
            decision = _ensure_stock_routing(user_msg, messages, decision)
        return decision
    if decision.needs_web_search:
        decision = decision.model_copy(deep=True)
        decision.needs_web_search = False
        decision.search_query = None
        if decision.selected_model.startswith("web-"):
            decision.selected_model = decision.selected_model.removeprefix("web-")
    if messages:
        decision = _ensure_weather_routing(user_msg, messages, decision)
        decision = _ensure_stock_routing(user_msg, messages, decision)
    return decision


def _needs_orchestrator(
    user_msg: str,
    messages: list[ChatMessage],
    decision: Optional[RoutingDecision],
) -> bool:
    """Use orchestrator for ambiguous routing and web-search decisions."""
    prior = _prior_messages(messages)
    if _coding_awaiting_user_reply(prior):
        return False
    if _is_acknowledgment(user_msg) or _is_greeting(user_msg):
        return False
    if prior and _is_web_follow_up(user_msg, prior):
        return False
    if decision is not None and decision.confidence >= PATTERN_CONFIDENCE_MIN:
        if (
            decision.needs_web_search
            or _explicit_search_intent(user_msg)
            or _explicit_lookup_intent(user_msg)
        ):
            return False
        if decision.routing_path.startswith(("pattern", "context", "heuristic")):
            return False
    if _is_math_query(user_msg) or _is_greeting(user_msg):
        return False
    if (
        _explicit_lookup_intent(user_msg)
        or _explicit_search_intent(user_msg)
        or _needs_live_facts(user_msg)
        or _is_weather_service_lookup(user_msg)
        or _has_weather_routing_intent(user_msg, messages)
    ):
        return False
    if _is_pure_code_request(user_msg):
        return False
    if prior and _is_topic_shift(user_msg, prior):
        return len(user_msg.strip()) > 120
    if prior and len(user_msg.strip()) <= 120:
        if _prior_web_weather_context(prior):
            if _has_weather_routing_intent(user_msg, messages):
                return False
            return True
        return False
    return decision is None or decision.confidence < PATTERN_CONFIDENCE_MIN


def _routing_system_prompt() -> str:
    if USE_COMPACT_ORCHESTRATOR_PROMPT:
        return COMPACT_ROUTING_PROMPT
    return _load_orchestrator_prompt()


def _load_orchestrator_prompt() -> str:
    try:
        with open(ORCHESTRATOR_PROMPT_PATH, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return (
            "You route Spockify requests. Output JSON only with selected_model, "
            "needs_web_search, search_query, task_type, confidence, reasoning."
        )


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


def _parse_routing(raw: str) -> RoutingDecision:
    try:
        data = _extract_json(raw)
        worker = data.get("worker") or data.get("selected_model", DEFAULT_CHAT_WORKER)
        return RoutingDecision(
            selected_model=worker,
            task_type=data.get("task_type", "general"),
            needs_web_search=bool(data.get("needs_web_search", False)),
            search_query=data.get("search_query"),
            confidence=float(data.get("confidence", 0.5)),
            reasoning=data.get("reasoning", ""),
            prompt_additions=data.get("prompt_additions", ""),
            routing_path="orchestrator",
        )
    except (json.JSONDecodeError, ValueError):
        lowered = raw.lower()
        needs = _explicit_search_intent(raw) and not _web_search_blocked(raw)
        model = "web-codestral" if "code" in lowered else DEFAULT_WEB_WORKER
        if not needs:
            model = ROOM_CODER_WORKER if "code" in lowered else DEFAULT_CHAT_WORKER
        return RoutingDecision(
            selected_model=model,
            needs_web_search=needs,
            search_query=None,
            reasoning="fallback heuristic",
            routing_path="orchestrator_fallback",
        )


def _litellm_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {LITELLM_API_KEY}"}


def _to_ollama_model(name: str) -> str:
    if name in OLLAMA_MODEL_MAP:
        return OLLAMA_MODEL_MAP[name]
    # Prefer last-hyphen → tag (gpt-oss-20b → gpt-oss:20b). Full replace
    # would produce invalid names like gpt:oss:20b that Ollama rejects with 400.
    if "-" in name and ":" not in name:
        base, _, tag = name.rpartition("-")
        if base and tag:
            return f"{base}:{tag}"
    return name


def _ollama_options(**kwargs: Any) -> dict[str, Any]:
    options: dict[str, Any] = {}
    if kwargs.get("max_tokens") is not None:
        options["num_predict"] = kwargs["max_tokens"]
    if kwargs.get("temperature") is not None:
        options["temperature"] = kwargs["temperature"]
    if kwargs.get("num_ctx") is not None:
        options["num_ctx"] = int(kwargs["num_ctx"])
    stop = kwargs.get("stop")
    if stop:
        options["stop"] = list(stop) if not isinstance(stop, list) else stop
    return options


def _is_vision_worker(model: str) -> bool:
    name = (model or "").lower()
    # Gemma 4/3 are multimodal, but only treat the vision-default worker (and
    # explicit vision tags) as vision workers so chat gemma4-12b is not trimmed.
    if name in ("gemma4-26b", "gemma4:26b", "gemma3-27b", "gemma3:27b"):
        return True
    return any(
        key in name
        for key in (
            "llava",
            "vision",
            "mistral-small3.1",
            "mistral-small3.2",
        )
    )


def _message_has_images_api(msg: dict[str, Any]) -> bool:
    content = msg.get("content")
    if isinstance(content, list):
        return any(
            isinstance(p, dict) and p.get("type") == "image_url" for p in content
        )
    images = msg.get("images")
    return isinstance(images, list) and len(images) > 0


def _estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    """Rough prompt size; images counted as a flat budget (CLIP tiles)."""
    total = 0
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    total += _estimate_tokens_from_text(str(part.get("text") or ""))
                elif part.get("type") == "image_url":
                    # LLaVA image tokens dominate; pad conservatively.
                    total += 1600
        else:
            total += _estimate_tokens_from_text(str(content or ""))
        images = msg.get("images")
        if isinstance(images, list):
            total += 1600 * len(images)
    return total


def _trim_vision_messages(
    messages: list[dict[str, Any]],
    *,
    max_history: int = VISION_MAX_HISTORY_MESSAGES,
    aggressive: bool = False,
) -> list[dict[str, Any]]:
    """Fit multimodal chat into a small vision context window.

    Keeps system prompts, the latest user turn (with images), and a short
    recent history. Strips images from older turns. Aggressive mode keeps
    only system + the last user message.
    """
    if not messages:
        return messages
    systems = [m for m in messages if m.get("role") == "system"]
    nonsystem = [m for m in messages if m.get("role") != "system"]
    if not nonsystem:
        return messages

    keep_n = 1 if aggressive else max(1, max_history)
    recent = nonsystem[-keep_n:]

    # Drop images from all but the newest message that still has them.
    last_image_idx = -1
    for i, msg in enumerate(recent):
        if _message_has_images_api(msg):
            last_image_idx = i
    trimmed: list[dict[str, Any]] = []
    for i, msg in enumerate(recent):
        if i == last_image_idx or last_image_idx < 0:
            trimmed.append(msg)
            continue
        content = msg.get("content")
        if isinstance(content, list):
            text = " ".join(
                str(p.get("text", ""))
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ).strip()
            trimmed.append(
                {
                    "role": msg.get("role", "user"),
                    "content": text or "[prior image turn]",
                }
            )
        else:
            copy = dict(msg)
            copy.pop("images", None)
            trimmed.append(copy)

    # Shorten long text parts on the latest user message.
    if trimmed:
        last = trimmed[-1]
        content = last.get("content")
        if isinstance(content, str) and len(content) > 2000:
            last = {**last, "content": content[:2000] + "…"}
            trimmed[-1] = last
        elif isinstance(content, list):
            new_parts: list[Any] = []
            for part in content:
                if (
                    isinstance(part, dict)
                    and part.get("type") == "text"
                    and len(str(part.get("text") or "")) > 2000
                ):
                    new_parts.append(
                        {
                            "type": "text",
                            "text": str(part.get("text") or "")[:2000] + "…",
                        }
                    )
                else:
                    new_parts.append(part)
            trimmed[-1] = {**last, "content": new_parts}

    # Prefer a short persona system over many injected systems when aggressive.
    if aggressive and systems:
        systems = systems[:1]
    elif len(systems) > 3:
        systems = systems[:1] + systems[-2:]

    return systems + trimmed


def _vision_chat_kwargs(model: str, **kwargs: Any) -> dict[str, Any]:
    """Inject num_ctx for vision workers unless the caller already set it."""
    out = dict(kwargs)
    if _is_vision_worker(model) and out.get("num_ctx") is None:
        out["num_ctx"] = VISION_NUM_CTX
    return out


def _is_exceed_context_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return (
        "exceed_context" in text
        or "exceeds available context" in text
        or ("context length" in text and "exceed" in text)
    )


def _ollama_model_name(model: str) -> str:
    return _to_ollama_model(model)


def _gemma_thinking_disabled(model: str) -> bool:
    """Gemma 4 defaults to thinking mode; without think=false content is often empty."""
    return "gemma" in _ollama_model_name(model).lower()


def _ollama_message_text(message: dict[str, Any]) -> str:
    content = str(message.get("content") or "").strip()
    if content:
        return content
    thinking = str(message.get("thinking") or "").strip()
    if thinking:
        LOG.warning("ollama returned empty content; using thinking field as fallback")
    return thinking


def _sanitize_ollama_image_b64(raw: str) -> str:
    """Normalize data-URL / base64 payloads for Ollama (padding + whitespace)."""
    data = (raw or "").strip()
    if not data:
        return data
    # Strip accidental whitespace/newlines that break Go's strict decoder.
    data = re.sub(r"\s+", "", data)
    # URL-safe → standard alphabet.
    data = data.replace("-", "+").replace("_", "/")
    pad = (-len(data)) % 4
    if pad:
        data += "=" * pad
    return data


def _normalize_messages_for_ollama(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert OpenAI multimodal parts to Ollama chat API shape."""
    normalized: list[dict[str, Any]] = []
    for msg in messages:
        content = msg.get("content")
        role = msg["role"]
        if isinstance(content, str):
            normalized.append({"role": role, "content": content})
            continue
        if isinstance(content, list):
            text_parts: list[str] = []
            images: list[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    text_parts.append(str(part.get("text", "")))
                elif part.get("type") == "image_url":
                    image_url = part.get("image_url", "")
                    url = (
                        image_url.get("url", "")
                        if isinstance(image_url, dict)
                        else str(image_url)
                    )
                    if url.startswith("data:") and "," in url:
                        images.append(_sanitize_ollama_image_b64(url.split(",", 1)[1]))
                    elif url:
                        # Remote URLs aren't supported by Ollama chat images; skip.
                        if url.startswith("http://") or url.startswith("https://"):
                            LOG.warning("Skipping remote image_url for Ollama (need data URL)")
                        else:
                            images.append(_sanitize_ollama_image_b64(url))
            ollama_msg: dict[str, Any] = {
                "role": role,
                "content": " ".join(text_parts).strip() or "Describe this image.",
            }
            if images:
                ollama_msg["images"] = images
            normalized.append(ollama_msg)
            continue
        normalized.append(msg)
    return normalized


def _ollama_chat_body(
    model: str,
    messages: list[dict[str, Any]],
    *,
    stream: bool,
    **kwargs: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": _ollama_model_name(model),
        "messages": _normalize_messages_for_ollama(messages),
        "stream": stream,
        "options": _ollama_options(**kwargs),
    }
    if _gemma_thinking_disabled(model):
        body["think"] = False
    return body


async def _raise_ollama_status(resp: httpx.Response, model: str) -> None:
    """Raise with Ollama error body so 400s are diagnosable in router logs."""
    if resp.is_success:
        return
    detail = (resp.text or "").strip()
    if len(detail) > 500:
        detail = detail[:500] + "…"
    mapped = _ollama_model_name(model)
    raise httpx.HTTPStatusError(
        f"Client error '{resp.status_code} {resp.reason_phrase}' for url "
        f"'{resp.request.url}' model={model!r} ollama_model={mapped!r}"
        + (f" body={detail}" if detail else ""),
        request=resp.request,
        response=resp,
    )


async def _ollama_chat_text(
    client: httpx.AsyncClient,
    model: str,
    messages: list[dict[str, Any]],
    timeout: float,
    **kwargs: Any,
) -> str:
    kwargs = _vision_chat_kwargs(model, **kwargs)
    body = _ollama_chat_body(model, messages, stream=False, **kwargs)
    resp = await client.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=timeout)
    await _raise_ollama_status(resp, model)
    return _ollama_message_text(resp.json()["message"])


async def _ollama_chat_stream(
    model: str,
    messages: list[dict[str, Any]],
    **kwargs: Any,
) -> AsyncIterator[bytes]:
    kwargs = _vision_chat_kwargs(model, **kwargs)
    req_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
    body = _ollama_chat_body(model, messages, stream=True, **kwargs)
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_URL}/api/chat",
            json=body,
            timeout=WORKER_TIMEOUT,
        ) as resp:
            # Must read body before raise so error text is available.
            if not resp.is_success:
                await resp.aread()
                await _raise_ollama_status(resp, model)
            first = True
            async for line in resp.aiter_lines():
                if not line:
                    continue
                data = json.loads(line)
                if data.get("done"):
                    yield b"data: [DONE]\n\n"
                    break
                content = data.get("message", {}).get("content", "")
                if not content and not first:
                    continue
                delta: dict[str, str] = {}
                if content:
                    delta["content"] = content
                if first:
                    delta["role"] = "assistant"
                    first = False
                if not delta:
                    continue
                chunk = {
                    "id": req_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "delta": delta}],
                }
                yield f"data: {json.dumps(chunk)}\n\n".encode()


async def _worker_chat_stream(
    model: str,
    messages: list[dict[str, Any]],
    **kwargs: Any,
) -> AsyncIterator[bytes]:
    msgs = messages
    if _is_vision_worker(model) or any(_message_has_images_api(m) for m in messages):
        msgs = _trim_vision_messages(messages)
        est = _estimate_messages_tokens(msgs)
        if est > max(1024, VISION_NUM_CTX - 512):
            msgs = _trim_vision_messages(messages, aggressive=True)
            LOG.info(
                "vision-trim aggressive model=%s est_tokens≈%s → %s",
                model,
                est,
                _estimate_messages_tokens(msgs),
            )
        else:
            LOG.info(
                "vision-trim model=%s msgs=%s→%s est_tokens≈%s num_ctx=%s",
                model,
                len(messages),
                len(msgs),
                est,
                VISION_NUM_CTX,
            )
    try:
        if USE_DIRECT_OLLAMA:
            async for chunk in _ollama_chat_stream(model, msgs, **kwargs):
                yield chunk
            return
        async for chunk in _litellm_chat_stream(model, msgs, **kwargs):
            yield chunk
    except httpx.HTTPStatusError as exc:
        if not _is_exceed_context_error(exc):
            raise
        LOG.warning(
            "vision exceed_context on %s; retrying aggressive trim / fallback",
            model,
        )
        tight = _trim_vision_messages(messages, aggressive=True)
        retry_model = model
        retry_kwargs = dict(kwargs)
        if _is_vision_worker(model):
            retry_kwargs["num_ctx"] = max(VISION_NUM_CTX, 8192)
        # Prefer alternate multimodal if still overflowing on the primary.
        fallback = (VISION_FALLBACK_WORKER or "").strip()
        if (
            fallback
            and fallback.lower() != model.lower()
            and (
                "llava" in model.lower()
                or "gemma4" in model.lower()
                or "gemma3" in model.lower()
            )
        ):
            retry_model = fallback
            retry_kwargs["num_ctx"] = max(VISION_NUM_CTX, 16384)
            LOG.info("vision fallback model=%s", retry_model)
        if USE_DIRECT_OLLAMA:
            async for chunk in _ollama_chat_stream(retry_model, tight, **retry_kwargs):
                yield chunk
            return
        async for chunk in _litellm_chat_stream(retry_model, tight, **retry_kwargs):
            yield chunk


async def _worker_chat(
    client: httpx.AsyncClient,
    model: str,
    messages: list[dict[str, Any]],
    **kwargs: Any,
) -> dict[str, Any]:
    msgs = messages
    if _is_vision_worker(model) or any(_message_has_images_api(m) for m in messages):
        msgs = _trim_vision_messages(messages)
        if _estimate_messages_tokens(msgs) > max(1024, VISION_NUM_CTX - 512):
            msgs = _trim_vision_messages(messages, aggressive=True)
    try:
        if USE_DIRECT_OLLAMA:
            content = await _ollama_chat_text(
                client, model, msgs, WORKER_TIMEOUT, **kwargs
            )
            return {
                "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": content}}
                ],
            }
        return await _litellm_chat(client, model, msgs, **kwargs)
    except httpx.HTTPStatusError as exc:
        if not _is_exceed_context_error(exc):
            raise
        LOG.warning(
            "vision exceed_context on %s; retrying aggressive trim / fallback",
            model,
        )
        tight = _trim_vision_messages(messages, aggressive=True)
        retry_model = model
        retry_kwargs = dict(kwargs)
        if _is_vision_worker(model):
            retry_kwargs["num_ctx"] = max(VISION_NUM_CTX, 8192)
        # Prefer alternate multimodal if still overflowing on the primary.
        fallback = (VISION_FALLBACK_WORKER or "").strip()
        if (
            fallback
            and fallback.lower() != model.lower()
            and (
                "llava" in model.lower()
                or "gemma4" in model.lower()
                or "gemma3" in model.lower()
            )
        ):
            retry_model = fallback
            retry_kwargs["num_ctx"] = max(VISION_NUM_CTX, 16384)
            LOG.info("vision fallback model=%s", retry_model)
        if USE_DIRECT_OLLAMA:
            content = await _ollama_chat_text(
                client, retry_model, tight, WORKER_TIMEOUT, **retry_kwargs
            )
            return {
                "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": retry_model,
                "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": content}}
                ],
            }
        return await _litellm_chat(client, retry_model, tight, **retry_kwargs)


async def _litellm_chat(
    client: httpx.AsyncClient,
    model: str,
    messages: list[dict[str, Any]],
    timeout: float = WORKER_TIMEOUT,
    **kwargs: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {"model": model, "messages": messages, **kwargs}
    resp = await client.post(
        f"{LITELLM_URL}/chat/completions",
        headers=_litellm_headers(),
        json=body,
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


async def _litellm_chat_stream(
    model: str,
    messages: list[dict[str, Any]],
    **kwargs: Any,
) -> AsyncIterator[bytes]:
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
        **kwargs,
    }
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            f"{LITELLM_URL}/chat/completions",
            headers=_litellm_headers(),
            json=body,
            timeout=WORKER_TIMEOUT,
        ) as resp:
            resp.raise_for_status()
            async for chunk in resp.aiter_bytes():
                yield chunk


def _routing_description(worker: str, decision: RoutingDecision) -> str:
    """Subtle attribution for expand/debug — not shown as primary bubble label."""
    status = _routing_status_message(decision)
    return f"{status.rstrip('…')} · via {worker}"


def _openwebui_attribution_event(
    worker: str,
    decision: RoutingDecision,
    user_msg: str = "",
    sources: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """OpenWebUI reads selected_model_id from the first SSE data frame."""
    status = _routing_status_message(decision, user_msg)
    event: dict[str, Any] = {
        "selected_model_id": SPOCKIFY_DISPLAY_MODEL,
        "worker": worker,
        "web_search": decision.needs_web_search,
        "routing_path": decision.routing_path,
        "reasoning": (decision.reasoning or "").strip(),
        "event": {
            "type": "status",
            "data": {
                "action": "routing",
                "description": status,
                "done": True,
            },
        },
    }
    if sources:
        event["sources"] = sources
    return event


def _parse_bool_header(value: Optional[str]) -> Optional[bool]:
    if value is None:
        return None
    v = value.strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return None


def _clean_visible_output(text: str) -> str:
    out = str(text or "")
    out = re.sub(r"<think>[\s\S]*?</think>", "", out, flags=re.IGNORECASE)
    out = re.sub(r"```tool[\s\S]*?```", "", out, flags=re.IGNORECASE)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _resolve_pipeline_options(
    req: ChatCompletionRequest, request: Request
) -> dict[str, Any]:
    enabled = req.spockify_pipeline_enabled
    if enabled is None:
        enabled = _parse_bool_header(request.headers.get("x-spockify-chat-pipeline"))
    if enabled is None:
        enabled = CHAT_PIPELINE_ENABLED
    work_model = (
        (req.spockify_pipeline_work_model or "").strip()
        or (request.headers.get("x-spockify-pipeline-work-model") or "").strip()
        or CHAT_PIPELINE_WORK_MODEL
    )
    explain_model = (
        (req.spockify_pipeline_explain_model or "").strip()
        or (request.headers.get("x-spockify-pipeline-explain-model") or "").strip()
        or CHAT_PIPELINE_EXPLAIN_MODEL
    )
    post_process = req.spockify_pipeline_post_process
    if post_process is None:
        post_process = _parse_bool_header(
            request.headers.get("x-spockify-pipeline-post-process")
        )
    if post_process is None:
        post_process = CHAT_PIPELINE_POST_PROCESS
    hide_intermediate = req.spockify_pipeline_hide_intermediate
    if hide_intermediate is None:
        hide_intermediate = _parse_bool_header(
            request.headers.get("x-spockify-pipeline-hide-intermediate")
        )
    if hide_intermediate is None:
        hide_intermediate = CHAT_PIPELINE_HIDE_INTERMEDIATE
    dev_log = req.spockify_pipeline_dev_log
    if dev_log is None:
        dev_log = _parse_bool_header(request.headers.get("x-spockify-pipeline-dev-log"))
    if dev_log is None:
        dev_log = CHAT_PIPELINE_DEV_LOG
    return {
        "enabled": bool(enabled),
        "work_model": work_model,
        "explain_model": explain_model,
        "post_process": bool(post_process),
        "hide_intermediate": bool(hide_intermediate),
        "dev_log": bool(dev_log),
    }


async def _run_multi_model_pipeline(
    client: httpx.AsyncClient,
    *,
    req: ChatCompletionRequest,
    worker_messages: list[dict[str, Any]],
    user_msg: str,
    pipeline: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    work_text, explain_model, meta_base = await _pipeline_work_phase(
        client,
        req=req,
        worker_messages=worker_messages,
        user_msg=user_msg,
        pipeline=pipeline,
    )
    explain_messages = _pipeline_explain_messages(user_msg, work_text)
    explain_result = await _worker_chat(
        client,
        explain_model,
        explain_messages,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )
    final_text = ""
    try:
        final_text = str(explain_result["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError):
        final_text = ""
    if pipeline.get("post_process"):
        final_text = _clean_visible_output(final_text)
    meta = {
        **meta_base,
        "explain_model": explain_model,
    }
    if pipeline.get("dev_log"):
        LOG.info(
            "chat pipeline work=%s explain=%s user=%s work_chars=%d final_chars=%d",
            meta.get("work_model"),
            explain_model,
            (user_msg or "")[:120],
            len(work_text),
            len(final_text),
        )
    return final_text, meta


async def _pipeline_work_phase(
    client: httpx.AsyncClient,
    *,
    req: ChatCompletionRequest,
    worker_messages: list[dict[str, Any]],
    user_msg: str,
    pipeline: dict[str, Any],
) -> tuple[str, str, dict[str, Any]]:
    """Run the hidden work/plan model; return notes + explain model id + meta."""
    work_model = str(pipeline.get("work_model") or CHAT_PIPELINE_WORK_MODEL)
    explain_model = str(pipeline.get("explain_model") or CHAT_PIPELINE_EXPLAIN_MODEL)
    work_system = (
        "You are a planning/implementation worker. Think through the task and produce "
        "concise execution notes and concrete answer material for another assistant."
    )
    work_messages = [{"role": "system", "content": work_system}] + worker_messages
    work_result = await _worker_chat(
        client,
        work_model,
        work_messages,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )
    work_text = ""
    try:
        work_text = str(work_result["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError):
        work_text = ""
    meta = {
        "enabled": True,
        "work_model": work_model,
        "explain_model": explain_model,
        "hide_intermediate": bool(pipeline.get("hide_intermediate")),
    }
    return work_text, explain_model, meta


def _pipeline_explain_messages(user_msg: str, work_text: str) -> list[dict[str, Any]]:
    explain_system = (
        "You are the user-facing assistant. Produce the final response only, based on "
        "the user request and worker notes. Do not expose hidden chain-of-thought."
    )
    explain_user = (
        f"User request:\n{user_msg}\n\n"
        f"Worker notes (internal):\n{work_text[:12000]}\n\n"
        "Return the final polished answer for the user."
    )
    return [
        {"role": "system", "content": explain_system},
        {"role": "user", "content": explain_user},
    ]


def _delta_content_from_sse_chunk(chunk: bytes) -> str:
    """Best-effort extract assistant delta text from an upstream SSE frame."""
    try:
        if not chunk.startswith(b"data:"):
            return ""
        raw = chunk[5:].strip()
        if not raw or raw == b"[DONE]":
            return ""
        data = json.loads(raw)
        if not isinstance(data, dict):
            return ""
        parts: list[str] = []
        for ch in data.get("choices") or []:
            delta = ch.get("delta") or {}
            piece = delta.get("content") or ""
            if piece:
                parts.append(piece)
            msg = ch.get("message") or {}
            mpiece = msg.get("content") or ""
            if mpiece:
                parts.append(mpiece)
        return "".join(parts)
    except (json.JSONDecodeError, TypeError, AttributeError):
        return ""


def _citation_sources_from_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """OpenWebUI citation chip payload from SearXNG hits."""
    sources: list[dict[str, Any]] = []
    for r in results:
        url = (r.get("url") or "").strip()
        if not url:
            continue
        title = _sanitize_search_text(r.get("title", "")) or url
        snippet = _sanitize_search_text(r.get("content") or r.get("snippet", "")) or title
        sources.append(
            {
                "source": {"name": title, "url": url},
                "document": [snippet],
                "metadata": [{"source": url, "name": title}],
            }
        )
    return sources


def _citation_annotation_sse(sources: list[dict[str, Any]]) -> bytes:
    """OpenAI-shaped SSE chunk with url_citation annotations.

    LiteLLM strips custom attribution frames and X-Spockify headers on stream.
    Delta annotations survive the proxy; OpenWebUI middleware turns them into
    source chips.
    """
    annotations: list[dict[str, Any]] = []
    for src in sources:
        info = src.get("source") or {}
        url = (info.get("url") or "").strip()
        if not url:
            continue
        title = (info.get("name") or url).strip()
        annotations.append(
            {
                "type": "url_citation",
                "url_citation": {"url": url, "title": title},
            }
        )
    if not annotations:
        return b""
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": SPOCKIFY_DISPLAY_MODEL,
        "choices": [
            {
                "index": 0,
                "delta": {"annotations": annotations},
                "finish_reason": None,
            }
        ],
    }
    return f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n".encode()


async def _rewrite_sse_model(
    stream: AsyncIterator[bytes],
    model: str,
) -> AsyncIterator[bytes]:
    """Force model attribution in OpenAI-compatible SSE chunks (LiteLLM may rewrite model)."""
    buffer = b""
    async for chunk in stream:
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            line = line.strip()
            if not line:
                continue
            if not line.startswith(b"data:"):
                yield line + b"\n\n"
                continue
            payload = line[5:].strip()
            if payload == b"[DONE]":
                yield b"data: [DONE]\n\n"
                continue
            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                yield line + b"\n\n"
                continue
            if isinstance(data, dict):
                data["model"] = SPOCKIFY_DISPLAY_MODEL
                yield f"data: {json.dumps(data, separators=(',', ':'))}\n\n".encode()
            else:
                yield line + b"\n\n"
    if buffer.strip():
        yield buffer


async def _stream_worker_with_preamble(
    worker: str,
    messages: list[dict[str, str]],
    decision: RoutingDecision,
    user_msg: str = "",
    *,
    skip_leading_status: bool = False,
    sources: Optional[list[dict[str, Any]]] = None,
    **kwargs: Any,
) -> AsyncIterator[bytes]:
    """Emit status + OpenWebUI attribution before worker tokens."""
    if not skip_leading_status:
        status = _routing_status_message(decision, user_msg)
        yield _status_sse(
            status, done=False, worker=worker, web_search=decision.needs_web_search
        )

    attribution = json.dumps(
        _openwebui_attribution_event(worker, decision, user_msg, sources=sources),
        separators=(",", ":"),
    )
    yield f"data: {attribution}\n\n".encode()

    # LiteLLM-safe path: annotations on an OpenAI chunk (custom frames are dropped).
    if sources:
        annotation_frame = _citation_annotation_sse(sources)
        if annotation_frame:
            yield annotation_frame

    meta = json.dumps(
        {
            "worker": worker,
            "routing_path": decision.routing_path,
            "search": decision.needs_web_search,
            "display_model": SPOCKIFY_DISPLAY_MODEL,
            "citations": len(sources or []),
        },
        separators=(",", ":"),
    )
    yield f": spockify-routing {meta}\n\n".encode()

    worker_stream = _worker_chat_stream(worker, messages, **kwargs)
    got_content = False
    async for chunk in _rewrite_sse_model(worker_stream, SPOCKIFY_DISPLAY_MODEL):
        if _sse_chunk_has_content(chunk):
            got_content = True
        yield chunk

    fallback = _web_worker_fallback(worker)
    if got_content or not fallback:
        return
    LOG.warning("worker %s returned empty stream, falling back to %s", worker, fallback)
    fallback_stream = _worker_chat_stream(fallback, messages, **kwargs)
    async for chunk in _rewrite_sse_model(fallback_stream, SPOCKIFY_DISPLAY_MODEL):
        yield chunk


def _score_search_result(
    result: dict[str, Any],
    target_location: Optional[dict[str, str]],
    *,
    current_weather: bool = False,
    dual_weather: bool = False,
    stock_lookup: bool = False,
) -> float:
    url = (result.get("url") or "").lower()
    title = (result.get("title") or "").lower()
    snippet = (result.get("content") or result.get("snippet") or "").lower()
    combined = f"{url} {title} {snippet}"
    score = 0.0

    for domain, boost in _PREFERRED_WEATHER_DOMAINS:
        if domain in url:
            score += boost

    if stock_lookup:
        for domain, boost in _PREFERRED_FINANCE_DOMAINS:
            if domain in url:
                score += boost
        if "finance.yahoo.com/quote" in url:
            score += 6.0

    for bad in _DEPRIORITIZE_URL_PATTERNS:
        if bad in url:
            score -= 25.0

    if target_location:
        city_key = target_location["city"].lower()
        wrong_geos = _WRONG_GEO_FOR.get(city_key, ())
        wrong_geos += _WRONG_GEO_FOR.get(target_location["country"].lower(), ())
        for wrong in wrong_geos:
            if wrong in combined:
                score -= 20.0
        if city_key in combined:
            score += 6.0
        country = target_location["country"].lower()
        if country in combined:
            score += 4.0
        source = target_location.get("weather_source", "").lower()
        if source and source in combined:
            score += 5.0

    if current_weather or dual_weather:
        for marker in _CURRENT_WEATHER_OBSERVATION_MARKERS:
            if marker in combined:
                score += 8.0
        if re.search(r"\b\d{1,2}:\d{2}\b", combined):
            score += 4.0
        if ("°c" in combined or "°f" in combined) and any(
            m in combined for m in ("now", "currently", "just nu", "observation", "aktuell")
        ):
            score += 6.0
        if "smhi.se" in url and any(
            m in combined for m in ("observation", "aktuell", "just nu", "temperatur")
        ):
            score += 10.0

    if dual_weather or not current_weather:
        for marker in _FORECAST_HIGH_MARKERS:
            if marker in combined:
                score += 5.0
        for marker in _HOURLY_FORECAST_MARKERS:
            if marker in combined:
                score += 5.0
        if _HIGH_TEMP_RE.search(combined):
            score += 6.0
        if re.search(r"\bhigh\s*/\s*low\b", combined):
            score += 4.0

    if current_weather and not dual_weather:
        for marker in _FORECAST_ONLY_MARKERS:
            if marker in combined:
                score -= 8.0
        if any(m in combined for m in ("evening forecast", "daily high", "daily low")):
            if not any(
                m in combined
                for m in ("currently", "just nu", "right now", "observation")
            ):
                score -= 10.0

    return score


def _rank_search_results(
    results: list[dict[str, Any]],
    target_location: Optional[dict[str, str]],
    limit: int,
    *,
    current_weather: bool = False,
    dual_weather: bool = False,
    stock_lookup: bool = False,
) -> list[dict[str, Any]]:
    if not results:
        return []
    if (
        not target_location
        and not current_weather
        and not dual_weather
        and not stock_lookup
    ):
        return results[:limit]
    scored = sorted(
        results,
        key=lambda r: _score_search_result(
            r,
            target_location,
            current_weather=current_weather,
            dual_weather=dual_weather,
            stock_lookup=stock_lookup,
        ),
        reverse=True,
    )
    return scored[:limit]


def _text_has_temperature_values(text: str) -> bool:
    return bool(_TEMPERATURE_VALUE_RE.search(text))


def _is_weather_fetch_url(url: str) -> bool:
    lowered = url.lower()
    return any(domain in lowered for domain in _WEATHER_FETCH_DOMAINS)


def _strip_html_to_text(html: str, max_len: int = 8000) -> str:
    cleaned = _HTML_SCRIPT_STYLE_RE.sub(" ", html)
    text = _HTML_TAG_RE.sub(" ", cleaned)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len]


def _extract_weather_clues(text: str, limit: int = 12) -> list[str]:
    """Pull temperature-bearing fragments from plain page text."""
    clues: list[str] = []
    seen: set[str] = set()
    for match in _TEMPERATURE_VALUE_RE.finditer(text):
        start = max(0, match.start() - 80)
        end = min(len(text), match.end() + 80)
        fragment = text[start:end].strip()
        if len(fragment) < 8:
            continue
        key = fragment.lower()[:60]
        if key in seen:
            continue
        seen.add(key)
        clues.append(fragment)
        if len(clues) >= limit:
            break
    return clues


async def _fetch_weather_page_text(
    client: httpx.AsyncClient,
    url: str,
) -> str:
    try:
        resp = await client.get(
            url,
            timeout=12.0,
            follow_redirects=True,
            headers={"User-Agent": "SpockifyRouter/0.3.0 (weather-fetch)"},
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        LOG.warning("weather page fetch failed %r: %s", url, exc)
        return ""
    plain = _strip_html_to_text(resp.text)
    clues = _extract_weather_clues(plain)
    if clues:
        return "; ".join(clues)
    idx = plain.find("°")
    if idx >= 0:
        start = max(0, idx - 120)
        end = min(len(plain), idx + 120)
        return plain[start:end].strip()
    return ""


async def _fetch_smhi_observation(
    client: httpx.AsyncClient,
    city: str,
) -> str:
    """Fetch live observed temperature from SMHI open-data API."""
    station_id = _SMHI_STATION_IDS.get(city)
    if not station_id:
        return ""
    url = _SMHI_METOBS_URL.format(station_id=station_id)
    try:
        resp = await client.get(
            url,
            timeout=10.0,
            headers={"User-Agent": "SpockifyRouter/0.3.0 (smhi-api)"},
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        LOG.warning("SMHI API failed for %s: %s", city, exc)
        return ""
    values = data.get("value") or []
    if not values:
        return ""
    temp = values[-1].get("value")
    station = data.get("station", {}).get("name", city)
    if temp is None:
        return ""
    try:
        temp_c = float(temp)
    except (TypeError, ValueError):
        return ""
    LOG.info("SMHI API %s station %s: %.1f°C", city, station_id, temp_c)
    return (
        f"• SMHI observation API ({station}): {_format_temp_c(temp_c)} currently "
        f"(latest hour). Source: {url}"
    )


async def _fetch_open_meteo_current(
    client: httpx.AsyncClient,
    city: str,
    *,
    lat: float,
    lon: float,
) -> str:
    """Live observed temperature via open-meteo current= endpoint."""
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,weather_code"
        "&timezone=auto"
    )
    try:
        resp = await client.get(
            url,
            timeout=10.0,
            headers={"User-Agent": "SpockifyRouter/0.3.0 (open-meteo-current)"},
        )
        resp.raise_for_status()
        current = resp.json().get("current") or {}
        temp = current.get("temperature_2m")
        if temp is None:
            return ""
        temp_c = float(temp)
        conditions = ""
        code = current.get("weather_code")
        if code is not None:
            conditions = _WMO_WEATHER_CODES.get(int(code), "")
        line = (
            f"• open-meteo live observation ({city}): "
            f"{_format_temp_c(temp_c)} currently"
        )
        if conditions:
            line = f"{line}, {conditions}"
        observed_at = current.get("time")
        if observed_at:
            line = f"{line} (observed {observed_at})"
        LOG.info("open-meteo current %s: %.1f°C", city, temp_c)
        return f"{line}. Source: {url}"
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError) as exc:
        LOG.warning("open-meteo current failed for %s: %s", city, exc)
        return ""


async def _fetch_live_weather_observations(
    client: httpx.AsyncClient,
    city: str,
    resolved: dict[str, Any],
) -> list[str]:
    """Fresh API readings for 'right now' — SMHI where available, then open-meteo."""
    lines: list[str] = []
    if resolved.get("weather_source") == "SMHI" and city:
        smhi_line = await _fetch_smhi_observation(client, city)
        if smhi_line:
            lines.append(smhi_line)
    if _has_geo_coords(resolved):
        meteo_line = await _fetch_open_meteo_current(
            client,
            city,
            lat=float(resolved["lat"]),
            lon=float(resolved["lon"]),
        )
        if meteo_line:
            lines.append(meteo_line)
    return lines


async def _fetch_daily_forecast(
    client: httpx.AsyncClient,
    city: str,
    *,
    day_offset: int = 0,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
) -> str:
    """Daily forecast high/low (and conditions) via open-meteo."""
    if lat is None or lon is None:
        coords = _CITY_COORDS.get(city)
        if not coords:
            return ""
        lat, lon = coords
    forecast_days = max(day_offset + 1, 2 if day_offset else 1)
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&daily=temperature_2m_max,temperature_2m_min,weathercode"
        f"&timezone=auto&forecast_days={forecast_days}"
    )
    try:
        resp = await client.get(
            url,
            timeout=10.0,
            headers={"User-Agent": "SpockifyRouter/0.3.0 (forecast)"},
        )
        resp.raise_for_status()
        daily = resp.json().get("daily") or {}
        highs = daily.get("temperature_2m_max") or []
        lows = daily.get("temperature_2m_min") or []
        codes = daily.get("weathercode") or []
        dates = daily.get("time") or []
        if len(highs) <= day_offset or len(lows) <= day_offset:
            return ""
        high, low = float(highs[day_offset]), float(lows[day_offset])
        conditions = ""
        if len(codes) > day_offset:
            conditions = _WMO_WEATHER_CODES.get(int(codes[day_offset]), "")
        if day_offset == 1:
            day_label = "Tomorrow's"
        elif day_offset == 0:
            day_label = "Today's"
        else:
            day_label = f"{_forecast_day_phrase(day_offset).capitalize()}'s"
        when = dates[day_offset] if len(dates) > day_offset else ""
        line = (
            f"• {day_label} forecast for {city}: high {_format_temp_c(high, decimals=0)}, "
            f"low {_format_temp_c(low, decimals=0)}"
        )
        if conditions:
            line = f"{line}, {conditions}"
        if when:
            line = f"{line} ({when})"
        return f"{line} (open-meteo)."
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError) as exc:
        LOG.warning("forecast API failed for %s: %s", city, exc)
        return ""


async def _fetch_today_high_low(
    client: httpx.AsyncClient,
    city: str,
) -> str:
    """Today's forecast high/low via open-meteo when SearXNG snippets lack them."""
    return await _fetch_daily_forecast(client, city, day_offset=0)


async def _fetch_smhi_forecast(
    client: httpx.AsyncClient,
    city: str,
    *,
    day_offset: int = 1,
) -> str:
    """Multi-day point forecast via SMHI SNOW1g API."""
    coords = _CITY_COORDS.get(city)
    if not coords:
        return ""
    lat, lon = coords
    url = _SMHI_FORECAST_URL.format(lon=f"{lon:.2f}", lat=f"{lat:.2f}")
    try:
        resp = await client.get(
            url,
            timeout=10.0,
            headers={"User-Agent": "SpockifyRouter/0.3.0 (smhi-forecast)"},
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        LOG.warning("SMHI forecast API failed for %s: %s", city, exc)
        return ""

    series = data.get("timeSeries") or []
    if not series:
        return ""

    tz = ZoneInfo("Europe/Stockholm")
    target_day = datetime.now(tz).date() + timedelta(days=day_offset)
    temps: list[float] = []
    symbols: list[int] = []
    for entry in series:
        raw_time = entry.get("time")
        if not raw_time:
            continue
        ts = datetime.fromisoformat(raw_time.replace("Z", "+00:00")).astimezone(tz)
        if ts.date() != target_day:
            continue
        point = entry.get("data") or {}
        temp = point.get("air_temperature")
        if temp is not None:
            try:
                temps.append(float(temp))
            except (TypeError, ValueError):
                pass
        symbol = point.get("symbol_code")
        if symbol is not None:
            try:
                symbols.append(int(symbol))
            except (TypeError, ValueError):
                pass

    if not temps:
        return ""

    high, low = max(temps), min(temps)
    day_label = "Tomorrow's" if day_offset == 1 else "Today's"
    conditions = ""
    if symbols:
        dominant = Counter(symbols).most_common(1)[0][0]
        conditions = _SMHI_WEATHER_SYMBOLS.get(dominant, f"symbol {dominant}")
    line = (
        f"• SMHI forecast API ({city}, {target_day.isoformat()}): "
        f"{day_label.lower()} high {_format_temp_c(high, decimals=0)}, "
        f"low {_format_temp_c(low, decimals=0)}"
    )
    if conditions:
        line = f"{line}, {conditions}"
    line = f"{line}. Source: {url}"
    LOG.info("SMHI forecast %s day+%d: %.0f/%.0f°C", city, day_offset, high, low)
    return line


def _snippets_have_forecast_high(results: list[dict[str, Any]]) -> bool:
    for r in results:
        text = _sanitize_search_text(r.get("content") or r.get("snippet") or "")
        if _HIGH_TEMP_RE.search(text) or "high" in text.lower() and "°" in text:
            return True
    return False


def _weather_fetch_priority(
    result: dict[str, Any],
    city: Optional[str],
) -> float:
    url = (result.get("url") or "").lower()
    score = 0.0
    if city and city.lower() in url:
        score += 20.0
    if "accuweather.com" in url:
        score += 12.0
    if "smhi.se" in url and "/vader" in url:
        score += 15.0
    if "observations" in url and city and city.lower() not in url:
        score -= 8.0
    return score


async def _fetch_weather_pages_for_results(
    client: httpx.AsyncClient,
    results: list[dict[str, Any]],
    *,
    max_pages: int = 3,
    skip_urls: Optional[set[str]] = None,
    city: Optional[str] = None,
) -> list[str]:
    """Fetch SMHI/AccuWeather pages when snippets lack temperature numbers."""
    extra_lines: list[str] = []
    fetched = set(skip_urls or ())
    ranked = sorted(
        results,
        key=lambda r: _weather_fetch_priority(r, city),
        reverse=True,
    )
    for r in ranked:
        url = r.get("url") or ""
        if not url or url in fetched or not _is_weather_fetch_url(url):
            continue
        fetched.add(url)
        page_text = await _fetch_weather_page_text(client, url)
        if page_text:
            extra_lines.append(f"Fetched from {url}:\n   {page_text}\n")
            LOG.info("weather fetch enriched %s (%d chars)", url, len(page_text))
        if len(fetched) >= max_pages:
            break
    return extra_lines


async def _enrich_weather_search_if_needed(
    client: httpx.AsyncClient,
    results: list[dict[str, Any]],
    search_queries: list[str],
    messages: list[ChatMessage],
    query: str,
    *,
    limit: int = 5,
    dual_weather: bool = False,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Fetch live weather APIs (open-meteo / SMHI). Snippets mix °C/°F and are not enough."""
    user_q = _effective_user_query(query, messages) if messages else query
    day_offset = _forecast_day_offset(user_q, messages)
    forecast_day_query = day_offset is not None
    wants_current = _wants_current_weather_data(user_q, messages)
    combined = " ".join(
        _sanitize_search_text(r.get("content") or r.get("snippet") or "")
        for r in results
    )
    location = _extract_target_location(messages or [], query)
    resolved: Optional[dict[str, Any]] = None
    if location:
        resolved = await _resolve_location_with_geocode(client, location)
    city = resolved["city"] if resolved else (location["city"] if location else None)
    extra_lines: list[str] = []

    if forecast_day_query:
        LOG.info(
            "forecast day+%s weather; enriching via APIs (results=%d)",
            day_offset,
            len(results),
        )
    else:
        LOG.info(
            "weather lookup; fetching live API observations city=%s results=%d",
            city,
            len(results),
        )

    fetch_current = (not forecast_day_query) or day_offset == 0 or wants_current
    if resolved and city and fetch_current:
        observation_lines = await _fetch_live_weather_observations(
            client, city, resolved
        )
        if observation_lines:
            extra_lines.extend(f"{line}\n" for line in observation_lines)

    if resolved and resolved.get("weather_source") == "SMHI" and city:
        if forecast_day_query and day_offset is not None and day_offset >= 1:
            smhi_forecast = await _fetch_smhi_forecast(
                client, city, day_offset=day_offset
            )
            if smhi_forecast:
                extra_lines.append(f"{smhi_forecast}\n")
        elif fetch_current and not any("SMHI observation" in line for line in extra_lines):
            smhi_line = await _fetch_smhi_observation(client, city)
            if smhi_line:
                extra_lines.append(f"{smhi_line}\n")

    if city and (
        forecast_day_query
        or fetch_current
        or dual_weather
        or not _snippets_have_forecast_high(results)
    ):
        if _has_geo_coords(resolved) or city in _CITY_COORDS:
            lat_arg = float(resolved["lat"]) if _has_geo_coords(resolved) else None
            lon_arg = float(resolved["lon"]) if _has_geo_coords(resolved) else None
            forecast_line = await _fetch_daily_forecast(
                client,
                city,
                day_offset=day_offset if day_offset is not None else 0,
                lat=lat_arg,
                lon=lon_arg,
            )
            if forecast_line:
                extra_lines.append(f"{forecast_line}\n")

    if extra_lines and _text_has_temperature_values("\n".join(extra_lines)):
        return results, extra_lines

    if _text_has_temperature_values(combined) and extra_lines:
        return results, extra_lines

    extra_lines.extend(
        await _fetch_weather_pages_for_results(client, results, city=city)
    )
    if extra_lines and _text_has_temperature_values("\n".join(extra_lines)):
        return results, extra_lines

    fallback_q: Optional[str] = None
    if location:
        city = location["city"]
        source = location.get("weather_source", "")
        if forecast_day_query and day_offset is not None:
            phrase = _forecast_day_phrase(day_offset)
            fallback_q = f"{city} weather forecast {phrase}"
            if source == "SMHI":
                fallback_q = f"{fallback_q} SMHI"
        elif source == "SMHI":
            fallback_q = f"{city} temperatur grader just nu SMHI"
        else:
            fallback_q = f"{city} current temperature degrees now"
    elif _is_weather_lookup(query, messages):
        fallback_q = f"{query.strip()} temperatur grader just nu"

    seen_queries = {q.lower() for q in search_queries}
    if fallback_q and fallback_q.lower() not in seen_queries:
        try:
            resp = await client.get(
                f"{SEARXNG_URL}/search",
                params={"q": fallback_q, "format": "json"},
                timeout=15.0,
            )
            resp.raise_for_status()
            seen_urls = {r.get("url") for r in results}
            new_results: list[dict[str, Any]] = []
            for r in resp.json().get("results", []):
                url = r.get("url")
                if url and url not in seen_urls:
                    new_results.append(r)
                    seen_urls.add(url)
            if new_results:
                LOG.info("fallback SearXNG %r added %d results", fallback_q, len(new_results))
                extra_lines.append(f"(fallback search: {fallback_q})\n")
                target = _extract_target_location(messages, query) if messages else None
                wants_current = _wants_current_weather_data(query, messages)
                merged = results + new_results
                results = _rank_search_results(
                    merged,
                    target,
                    limit,
                    current_weather=wants_current and not dual_weather,
                    dual_weather=dual_weather,
                )
                combined = " ".join(
                    _sanitize_search_text(r.get("content") or r.get("snippet") or "")
                    for r in results
                )
                if not _text_has_temperature_values(combined):
                    fetched = {
                        line.split("Fetched from ", 1)[1].split(":", 1)[0]
                        for line in extra_lines
                        if line.startswith("Fetched from ")
                    }
                    extra_lines.extend(
                        await _fetch_weather_pages_for_results(
                            client,
                            results,
                            max_pages=2,
                            skip_urls=fetched,
                            city=city,
                        )
                    )
        except httpx.HTTPError as exc:
            LOG.warning("fallback SearXNG failed %r: %s", fallback_q, exc)

    if not extra_lines:
        extra_lines = await _fetch_weather_pages_for_results(
            client, results, max_pages=3, city=city
        )

    return results, extra_lines


# SearXNG uses GET ?q=… — httpx rejects query components over ~64KiB.
MAX_SEARX_QUERY_CHARS = int(os.getenv("MAX_SEARX_QUERY_CHARS", "500"))


def _truncate_searx_query(query: str, limit: int = MAX_SEARX_QUERY_CHARS) -> str:
    q = (query or "").strip()
    if len(q) <= limit:
        return q
    return q[: max(0, limit - 1)].rstrip() + "…"


async def _searxng_search(
    client: httpx.AsyncClient,
    query: str,
    limit: int = 5,
    messages: Optional[list[ChatMessage]] = None,
) -> tuple[str, list[dict[str, Any]]]:
    msgs = messages or []
    user_q = _effective_user_query(query, msgs)
    wants_current = _wants_current_weather_data(user_q, msgs)
    day_offset = _forecast_day_offset(user_q, msgs)
    is_weather = _is_weather_lookup(query, msgs)
    is_stock = (not is_weather) and stocks.is_stock_lookup(user_q)
    search_queries = _weather_search_queries(query, msgs) if is_weather else [query]
    if is_stock and "stock" not in query.lower() and "share" not in query.lower():
        # Nudge SearXNG toward quote pages when the user only named a company.
        search_queries = [f"{query} stock price"]
    dual_weather = is_weather and len(search_queries) > 1 and day_offset is None
    target = _extract_target_location(msgs, query) if msgs else None

    raw_results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for search_q in search_queries:
        search_q = _truncate_searx_query(search_q)
        if not search_q:
            continue
        try:
            resp = await client.get(
                f"{SEARXNG_URL}/search",
                params={"q": search_q, "format": "json"},
                timeout=15.0,
            )
            resp.raise_for_status()
            for r in resp.json().get("results", []):
                url = r.get("url")
                if url and url not in seen_urls:
                    raw_results.append(r)
                    seen_urls.add(url)
        except (httpx.HTTPError, httpx.InvalidURL, ValueError) as exc:
            LOG.warning("SearXNG search failed for %r: %s", search_q[:80], exc)

    results = _rank_search_results(
        raw_results,
        target,
        limit,
        current_weather=wants_current and not dual_weather,
        dual_weather=dual_weather,
        stock_lookup=is_stock,
    )
    extra_lines: list[str] = []
    stock_sources: list[dict[str, Any]] = []
    if is_weather:
        results, extra_lines = await _enrich_weather_search_if_needed(
            client,
            results,
            search_queries,
            msgs,
            query,
            limit=limit,
            dual_weather=dual_weather,
        )
    elif is_stock:
        quote_lines, stock_sources = await stocks.fetch_stock_quote_lines(
            client, user_q
        )
        extra_lines.extend(quote_lines)

    # Fetch page text for factual / quote-sensitive questions (not weather).
    # Skip when live stock quotes already provide authoritative numbers — Yahoo
    # HTML often hits cookie consent walls that pollute the prompt.
    page_lines: list[str] = []
    if results and not is_weather and grounding.wants_page_grounding(user_q):
        if is_stock and extra_lines:
            page_lines = []
        else:
            page_lines = await grounding.fetch_grounding_excerpts(
                client, results, user_q
            )
    elif results and not is_weather and is_stock and not extra_lines:
        # Stock intent but quote API missed — still try page excerpts.
        page_lines = await grounding.fetch_grounding_excerpts(
            client, results, user_q
        )

    if not results and not extra_lines and not page_lines:
        return f"No search results for: {query}", []

    query_label = " | ".join(search_queries) if dual_weather else query
    lines: list[str] = []
    if is_weather and extra_lines:
        lines.append(
            "Live weather (AUTHORITATIVE — copy these numbers into your reply; "
            "do not convert °C/°F yourself; both units are already provided):\n"
        )
        lines.extend(extra_lines)
        lines.append(f"\nWeb search results for: {query_label}\n")
    elif is_stock and extra_lines:
        lines.append(
            "Live stock quote (AUTHORITATIVE — copy these numbers into your reply; "
            "do not tell the user to check external links instead):\n"
        )
        lines.extend(extra_lines)
        lines.append(f"\nWeb search results for: {query_label}\n")
    else:
        lines.append(f"Web search results for: {query_label}\n")

    for i, r in enumerate(results, 1):
        title = _sanitize_search_text(r.get("title", ""))
        url = r.get("url", "")
        snippet = _sanitize_search_text(r.get("content") or r.get("snippet", ""))
        lines.append(f"{i}. {title}\n   {url}\n   {snippet}\n")

    if page_lines:
        lines.append(
            "\nAdditional fetched page content (prefer for quotations):\n"
        )
        lines.extend(page_lines)

    sources = _citation_sources_from_results(results)
    if stock_sources:
        sources = stock_sources + sources
    return "\n".join(lines), sources


def _sanitize_search_text(text: str) -> str:
    """Remove template placeholders from web snippets (weather sites use {{high}}, etc.)."""
    if not text:
        return text
    cleaned = _TEMPLATE_MARKER_RE.sub("", text)
    return cleaned.replace("{{", "").replace("}}", "").strip()


def _sse_chunk_has_content(chunk: bytes) -> bool:
    for line in chunk.split(b"\n"):
        line = line.strip()
        if not line.startswith(b"data:"):
            continue
        payload = line[5:].strip()
        if payload in (b"", b"[DONE]"):
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        choices = data.get("choices") or []
        if not choices:
            continue
        delta = choices[0].get("delta") or {}
        if delta.get("content"):
            return True
    return False


def _response_content_empty(result: dict[str, Any]) -> bool:
    choices = result.get("choices") or []
    if not choices:
        return True
    content = (choices[0].get("message") or {}).get("content") or ""
    return not str(content).strip()


def _web_worker_fallback(worker: str) -> Optional[str]:
    if worker == DEFAULT_WEB_WORKER and WEB_WORKER_FALLBACK:
        return WEB_WORKER_FALLBACK
    return None


def _user_text(messages: list[ChatMessage]) -> str:
    for msg in reversed(messages):
        if msg.role == "user":
            return _content_text(msg.content)
    return _content_text(messages[-1].content) if messages else ""


def _check_auth(authorization: Optional[str]) -> None:
    if authorization and LITELLM_API_KEY:
        token = authorization.removeprefix("Bearer ").strip()
        if token != LITELLM_API_KEY:
            raise HTTPException(401, "Invalid API key")


async def _check_auth_api_key(authorization: Optional[str]) -> None:
    """Accept master key or any valid LiteLLM virtual key.

    Chat normally arrives via LiteLLM (which already auth'd the virtual key and
    forwards the master key). Direct public routes like /v1/images need to accept
    the same SPOCKIFY_API_KEY clients already use.
    """
    if not authorization:
        raise HTTPException(401, "Missing API key")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Missing API key")
    if LITELLM_API_KEY and token == LITELLM_API_KEY:
        return

    # Validate virtual keys against LiteLLM (same store as /v1 chat).
    litellm_root = LITELLM_URL
    if litellm_root.endswith("/v1"):
        litellm_root = litellm_root[: -len("/v1")]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{litellm_root}/key/info",
                headers={"Authorization": f"Bearer {token}"},
                timeout=8.0,
            )
        if resp.status_code < 400:
            return
    except Exception as exc:
        LOG.warning("LiteLLM key validation failed: %s", exc)
    raise HTTPException(401, "Invalid API key")


async def _call_orchestrator(
    client: httpx.AsyncClient,
    user_msg: str,
    model: str,
    messages: list[ChatMessage],
) -> RoutingDecision:
    context_block = _format_routing_context(messages)
    user_content = "Route this request. JSON only.\n\n"
    if context_block:
        user_content += f"{context_block}\n\n"
    user_content += f"Latest user message:\n{user_msg}"

    route_messages = [
        {"role": "system", "content": _routing_system_prompt()},
        {"role": "user", "content": user_content},
    ]
    try:
        use_direct = USE_DIRECT_OLLAMA and not USE_LITELLM_ORCHESTRATOR
        if use_direct:
            route_content = await _ollama_chat_text(
                client,
                model,
                route_messages,
                ROUTING_TIMEOUT,
                temperature=0.1,
                max_tokens=ORCHESTRATOR_MAX_TOKENS,
            )
        else:
            route_resp = await _litellm_chat(
                client,
                model,
                route_messages,
                timeout=ROUTING_TIMEOUT,
                temperature=0.1,
                max_tokens=ORCHESTRATOR_MAX_TOKENS,
            )
            route_content = route_resp["choices"][0]["message"]["content"]
        return _parse_routing(route_content)
    except httpx.HTTPError as exc:
        LOG.warning("orchestrator %s failed: %s", model, exc)
        raise


async def _resolve_routing(
    client: httpx.AsyncClient,
    user_msg: str,
    rules: dict[str, Any],
    messages: list[ChatMessage],
    thread_id: Optional[str] = None,
) -> RoutingDecision:
    if _messages_have_images(messages):
        decision = _finalize_routing(
            user_msg, messages, _gate_web_search(user_msg, _vision_route(), messages)
        )
        _store_routing_plan(thread_id, user_msg, decision, _context_fingerprint(messages))
        LOG.info(
            "vision-route model=%s path=%s",
            decision.selected_model,
            decision.routing_path,
        )
        return decision

    # Text follow-up after image: stick to vision before cache/heuristics.
    vision_sticky = _vision_thread_sticky(thread_id, user_msg, messages)
    if vision_sticky is not None:
        decision = _finalize_routing(
            user_msg, messages, _gate_web_search(user_msg, vision_sticky, messages)
        )
        _store_routing_plan(
            thread_id, user_msg, decision, _context_fingerprint(messages)
        )
        LOG.info(
            "vision-sticky model=%s path=%s thread=%s",
            decision.selected_model,
            decision.routing_path,
            (thread_id or "")[:12],
        )
        return decision

    ctx_fp = _context_fingerprint(messages)
    if _is_commit_message_request(user_msg, messages):
        decision = _finalize_routing(
            user_msg,
            messages,
            _gate_web_search(user_msg, _commit_message_route(), messages),
        )
        _store_routing_plan(thread_id, user_msg, decision, ctx_fp)
        LOG.info(
            "commit-message-route model=%s path=%s",
            decision.selected_model,
            decision.routing_path,
        )
        return decision

    cached = _cache_get(user_msg, ctx_fp)
    if cached is not None:
        LOG.info("cache-hit model=%s path=%s", cached.selected_model, cached.routing_path)
        return _finalize_routing(user_msg, messages, _gate_web_search(user_msg, cached, messages))

    if _is_math_query(user_msg):
        decision = _finalize_routing(
            user_msg, messages, _gate_web_search(user_msg, _math_route(user_msg), messages)
        )
        _store_routing_plan(thread_id, user_msg, decision, ctx_fp)
        return decision

    decision = None
    if len(messages) > 1:
        decision = _context_aware_route(messages, user_msg)
    if decision is None and thread_id:
        decision = _thread_plan_get(thread_id, user_msg, messages)
        if decision is not None:
            LOG.info(
                "thread-plan model=%s path=%s thread=%s",
                decision.selected_model,
                decision.routing_path,
                thread_id[:12],
            )
    if decision is None:
        decision = _pattern_route(user_msg, rules)
    if decision is None:
        decision = _heuristic_route(user_msg, messages)

    if decision is not None and decision.confidence >= PATTERN_CONFIDENCE_MIN:
        LOG.info(
            "fast-route path=%s model=%s conf=%.2f",
            decision.routing_path,
            decision.selected_model,
            decision.confidence,
        )
        decision = _finalize_routing(
            user_msg, messages, _gate_web_search(user_msg, decision, messages)
        )
        _store_routing_plan(thread_id, user_msg, decision, ctx_fp)
        return decision

    if not _needs_orchestrator(user_msg, messages, decision):
        if decision is not None:
            decision = _finalize_routing(
                user_msg, messages, _gate_web_search(user_msg, decision, messages)
            )
            _store_routing_plan(thread_id, user_msg, decision, ctx_fp)
            return decision

    for model in (ORCHESTRATOR_MODEL, ORCHESTRATOR_FALLBACK):
        try:
            decision = await _call_orchestrator(client, user_msg, model, messages)
            LOG.info(
                "orchestrator-route model=%s worker=%s conf=%.2f",
                model,
                decision.selected_model,
                decision.confidence,
            )
            decision = _finalize_routing(
                user_msg, messages, _gate_web_search(user_msg, decision, messages)
            )
            _store_routing_plan(thread_id, user_msg, decision, ctx_fp)
            return decision
        except httpx.HTTPError:
            continue

    default = rules.get("default_route", {})
    fallback = RoutingDecision(
        selected_model=default.get("model", DEFAULT_CHAT_WORKER),
        task_type="default",
        confidence=0.5,
        reasoning="orchestrator unavailable",
        routing_path="default",
    )
    return _finalize_routing(
        user_msg, messages, _gate_web_search(user_msg, fallback, messages)
    )


# Wave 6.1: browsable session digests (in-process + optional dir).
SESSION_DIGEST_DIR = Path(
    os.getenv("SESSION_DIGEST_DIR", "/tmp/spockify-session-memory")
)
_SESSION_DIGESTS: dict[str, dict[str, Any]] = {}


def _session_fingerprint(messages: list[dict[str, Any]]) -> str:
    """Stable-ish key from early user turns (not a chat_id — router is stateless)."""
    bits: list[str] = []
    for msg in messages[:6]:
        role = str(msg.get("role") or "")
        if role not in ("user", "assistant"):
            continue
        content = msg.get("content")
        if isinstance(content, list):
            text = " ".join(
                str(p.get("text", ""))
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ).strip()
        else:
            text = str(content or "").strip()
        if text:
            bits.append(f"{role}:{text[:80]}")
        if len(bits) >= 3:
            break
    raw = "|".join(bits) or f"len:{len(messages)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _store_session_digest(
    digest_id: str,
    content: str,
    message_count: int,
    user_id: Optional[str] = None,
) -> None:
    entry = {
        "id": digest_id,
        "content": content,
        "message_count": message_count,
        "user_id": (user_id or "").strip() or None,
        "updated_at": datetime.now(tz=ZoneInfo("UTC")).isoformat(),
    }
    _SESSION_DIGESTS[digest_id] = entry
    try:
        SESSION_DIGEST_DIR.mkdir(parents=True, exist_ok=True)
        path = SESSION_DIGEST_DIR / f"{digest_id}.json"
        path.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _load_session_digests(user_id: Optional[str] = None) -> list[dict[str, Any]]:
    merged = dict(_SESSION_DIGESTS)
    try:
        if SESSION_DIGEST_DIR.is_dir():
            for path in SESSION_DIGEST_DIR.glob("*.json"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(data, dict) and data.get("id"):
                        merged[str(data["id"])] = data
                except (OSError, json.JSONDecodeError, TypeError):
                    continue
    except OSError:
        pass
    rows = list(merged.values())
    if user_id:
        uid = str(user_id)
        rows = [
            d
            for d in rows
            if not d.get("user_id") or str(d.get("user_id")) == uid
        ]
    return sorted(
        rows,
        key=lambda d: str(d.get("updated_at") or ""),
        reverse=True,
    )


def _delete_session_digest(digest_id: str) -> bool:
    existed = digest_id in _SESSION_DIGESTS
    _SESSION_DIGESTS.pop(digest_id, None)
    path = SESSION_DIGEST_DIR / f"{digest_id}.json"
    try:
        if path.is_file():
            path.unlink()
            return True
    except OSError:
        pass
    return existed


def _session_summary_from_messages(
    messages: list[dict[str, Any]],
) -> Optional[dict[str, str]]:
    """Condense older turns into one system note (context only; no DB writes)."""
    if SESSION_SUMMARY_THRESHOLD <= 0 or SESSION_KEEP_RECENT <= 0:
        return None
    if len(messages) <= SESSION_SUMMARY_THRESHOLD:
        return None
    older = messages[:-SESSION_KEEP_RECENT]
    lines: list[str] = []
    for msg in older:
        role = str(msg.get("role") or "user")
        if role == "system":
            continue
        content = msg.get("content")
        if isinstance(content, list):
            text = " ".join(
                str(p.get("text", ""))
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ).strip()
            if any(
                isinstance(p, dict) and p.get("type") == "image_url" for p in content
            ):
                text = (text + " [image]").strip()
        else:
            text = str(content or "").strip()
        if not text:
            continue
        if len(text) > 220:
            text = text[:217] + "…"
        lines.append(f"- {role}: {text}")
    if not lines:
        return None
    trimmed = lines[-SESSION_SUMMARY_MAX_LINES:]
    return {
        "role": "system",
        "content": (
            "Session memory (earlier turns, condensed for context):\n"
            + "\n".join(trimmed)
        ),
    }


def _apply_session_memory(
    worker_messages: list[dict[str, Any]],
    user_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    summary = _session_summary_from_messages(worker_messages)
    if summary is None:
        return worker_messages
    digest_id = _session_fingerprint(worker_messages)
    _store_session_digest(
        digest_id,
        str(summary.get("content") or ""),
        len(worker_messages),
        user_id=user_id,
    )
    recent = worker_messages[-SESSION_KEEP_RECENT:]
    return [summary] + recent


async def _build_worker_messages(
    client: httpx.AsyncClient,
    req: ChatCompletionRequest,
    decision: RoutingDecision,
    user_msg: str,
    worker: str,
    *,
    voice_mode: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    # Commit-message: skip persona/coder/skills/session memory — they invite
    # laundry-list narration. Keep only user/assistant turns; inject our system.
    if decision.task_type == "commit_message" or _is_commit_message_request(
        user_msg, req.messages
    ):
        kept = [
            _message_to_api(m)
            for m in req.messages
            if m.role in ("user", "assistant")
        ]
        # Drop any prior assistant turns; commit gen is a single-shot prompt.
        kept = [m for m in kept if m.get("role") == "user"][-1:]
        prefix: list[dict[str, Any]] = [
            {"role": "system", "content": COMMIT_MESSAGE_SYSTEM_PROMPT},
        ]
        return prefix + kept, []

    worker_messages = _apply_session_memory(
        [_message_to_api(m) for m in req.messages],
        user_id=getattr(req, "spockify_user_id", None),
    )

    prefix = [
        {"role": "system", "content": SPOCKIFY_PERSONA_PROMPT},
    ]
    sources: list[dict[str, Any]] = []
    if decision.needs_web_search:
        query = _refine_search_query(decision.search_query or user_msg, req.messages)
        search_block, sources = await _searxng_search(client, query, messages=req.messages)
        suffix = WEB_SEARCH_SYSTEM_SUFFIX
        day_offset = _forecast_day_offset(user_msg, req.messages)
        if day_offset == 1:
            suffix = f"{WEB_SEARCH_TOMORROW_WEATHER_SUFFIX}\n\n{suffix}"
        elif day_offset is not None:
            day_label = _forecast_day_phrase(day_offset)
            forecast_suffix = WEB_SEARCH_FORECAST_DAY_SUFFIX.format(
                day_label=day_label
            )
            suffix = f"{forecast_suffix}\n\n{suffix}"
        elif _wants_current_weather_data(user_msg, req.messages):
            suffix = f"{WEB_SEARCH_CURRENT_WEATHER_SUFFIX}\n\n{suffix}"
        elif _is_weather_lookup(user_msg, req.messages):
            suffix = f"{WEB_SEARCH_WEATHER_SUFFIX}\n\n{suffix}"
        elif stocks.is_stock_lookup(user_msg):
            suffix = f"{WEB_SEARCH_STOCK_SUFFIX}\n\n{suffix}"
        if voice_mode and (
            _is_weather_lookup(user_msg, req.messages)
            or _wants_current_weather_data(user_msg, req.messages)
        ):
            suffix = f"{WEB_SEARCH_VOICE_WEATHER_SUFFIX}\n\n{suffix}"
        prefix.append(
            {
                "role": "system",
                "content": f"{search_block}\n\n{suffix}",
            },
        )
    prefix.extend(_coder_worker_system_messages(worker, user_msg))
    if decision.prompt_additions:
        prefix.append({"role": "system", "content": decision.prompt_additions})
    # Wave 9.4 skill packs attached on the request.
    if req.skill_ids:
        prefix = _inject_skills_into_prefix(prefix, list(req.skill_ids))
    return prefix + worker_messages, sources


def _skill_ids_from_request(req: ChatCompletionRequest, request: Request) -> list[str]:
    ids = list(req.skill_ids or [])
    hdr = (request.headers.get("x-spockify-skills") or "").strip()
    if hdr:
        ids.extend([p.strip() for p in hdr.split(",") if p.strip()])
    seen: set[str] = set()
    out: list[str] = []
    for sid in ids:
        if sid not in seen:
            seen.add(sid)
            out.append(sid)
    return out


def _inject_skills_into_prefix(
    prefix: list[dict[str, Any]], skill_ids: list[str]
) -> list[dict[str, Any]]:
    msg = skills_mod.inject_skills_system_message(skill_ids)
    if msg:
        return [msg] + prefix
    return prefix


def _resolve_worker_model(decision: RoutingDecision) -> str:
    """Map orchestrator choice to a concrete LiteLLM model name."""
    selected = decision.selected_model
    if decision.routing_path == "vision" or decision.task_type == "vision":
        return selected
    if decision.needs_web_search and not selected.startswith("web-"):
        if selected.startswith("codestral") or decision.task_type.startswith("code"):
            return "web-codestral"
        # Voice path may already have remapped to VOICE_WEB_WORKER.
        if selected == VOICE_CHAT_WORKER:
            return VOICE_WEB_WORKER
        return DEFAULT_WEB_WORKER
    return selected


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "fast_mode": str(ROUTING_FAST_MODE).lower(),
        "thread_plans": str(len(_thread_plans)),
    }


def _read_meminfo_bytes() -> dict[str, Any]:
    """Best-effort RAM from /proc/meminfo (pod/cgroup view on k8s)."""
    total: Optional[int] = None
    available: Optional[int] = None
    try:
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    available = int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError) as exc:
        return {"ok": False, "error": str(exc), "source": "proc_meminfo"}
    free = available
    used = (total - available) if total is not None and available is not None else None
    return {
        "ok": True,
        "source": "proc_meminfo",
        "note": "Pod/cgroup view; unified-memory hosts may differ from this reading.",
        "total_bytes": total,
        "available_bytes": available,
        "used_bytes": used,
        "free_bytes": free,
    }


def _normalize_ollama_ps(payload: dict[str, Any]) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    for item in payload.get("models") or []:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or item.get("model") or ""
        size = item.get("size")
        size_vram = item.get("size_vram")
        models.append(
            {
                "name": name,
                "size_bytes": size,
                "size_vram_bytes": size_vram,
                "expires_at": item.get("expires_at"),
                "details": item.get("details") or {},
            }
        )
    return models


async def _probe_ollama(client: httpx.AsyncClient) -> dict[str, Any]:
    try:
        resp = await client.get(f"{OLLAMA_URL}/api/ps", timeout=8.0)
        resp.raise_for_status()
        models = _normalize_ollama_ps(resp.json())
        return {
            "ok": True,
            "up": True,
            "url": OLLAMA_URL,
            "loaded_models": models,
            "loaded_count": len(models),
            "total_size_vram_bytes": sum(
                int(m["size_vram_bytes"] or 0) for m in models
            ),
        }
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        return {
            "ok": False,
            "up": False,
            "url": OLLAMA_URL,
            "loaded_models": [],
            "loaded_count": 0,
            "error": str(exc),
        }


async def _probe_comfyui(client: httpx.AsyncClient) -> dict[str, Any]:
    try:
        resp = await client.get(f"{COMFYUI_URL}/system_stats", timeout=8.0)
        if resp.status_code >= 400:
            # Older ComfyUI builds may lack system_stats; treat HTTP reachability as up.
            ping = await client.get(f"{COMFYUI_URL}/", timeout=5.0)
            up = ping.status_code < 500
            return {
                "ok": up,
                "up": up,
                "url": COMFYUI_URL,
                "status_code": ping.status_code,
                "devices": [],
                "error": None if up else f"HTTP {ping.status_code}",
            }
        data = resp.json()
        devices_out: list[dict[str, Any]] = []
        for device in data.get("devices") or []:
            if not isinstance(device, dict):
                continue
            devices_out.append(
                {
                    "name": device.get("name"),
                    "type": device.get("type"),
                    "index": device.get("index"),
                    "vram_total_bytes": device.get("vram_total"),
                    "vram_free_bytes": device.get("vram_free"),
                }
            )
        return {
            "ok": True,
            "up": True,
            "url": COMFYUI_URL,
            "status_code": resp.status_code,
            "devices": devices_out,
            "system": data.get("system") or {},
        }
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        return {
            "ok": False,
            "up": False,
            "url": COMFYUI_URL,
            "devices": [],
            "error": str(exc),
        }


async def _probe_federation_peers(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Best-effort health probes for configured federation peers (W4.9 / W5 stub)."""
    peers: list[dict[str, Any]] = []
    for base in FEDERATION_PEERS:
        url = base.rstrip("/")
        entry: dict[str, Any] = {
            "url": url,
            "ok": False,
            "up": False,
            "latency_ms": None,
        }
        for path in ("/health", "/spockify/status", "/"):
            try:
                started = time.perf_counter()
                resp = await client.get(f"{url}{path}", timeout=5.0)
                entry["latency_ms"] = int((time.perf_counter() - started) * 1000)
                entry["ok"] = resp.status_code < 500
                entry["up"] = resp.status_code < 400
                entry["status_code"] = resp.status_code
                entry["probed_path"] = path
                break
            except httpx.HTTPError as exc:
                entry["error"] = str(exc)
        peers.append(entry)
    return peers


@app.get("/spockify/status")
async def spockify_status() -> dict[str, Any]:
    """Read-only cluster health: Ollama loaded models, ComfyUI, free RAM/GPU."""
    async with httpx.AsyncClient() as client:
        ollama = await _probe_ollama(client)
        comfyui = await _probe_comfyui(client)
        peers = await _probe_federation_peers(client)
    memory = _read_meminfo_bytes()
    gpu: dict[str, Any] = {
        "source": None,
        "devices": [],
        "note": "Unified-memory hosts share RAM/VRAM; prefer ComfyUI device stats when up.",
    }
    if comfyui.get("up") and comfyui.get("devices"):
        gpu["source"] = "comfyui_system_stats"
        gpu["devices"] = comfyui["devices"]
    elif ollama.get("up"):
        gpu["source"] = "ollama_ps_vram"
        gpu["ollama_vram_bytes"] = ollama.get("total_size_vram_bytes", 0)
        gpu["note"] = (
            "ComfyUI down or no device stats; showing Ollama resident VRAM only."
        )
    return {
        "ok": True,
        "checked_at": datetime.now(tz=ZoneInfo("UTC")).isoformat(),
        "ollama": ollama,
        "comfyui": comfyui,
        "memory": memory,
        "gpu": gpu,
        "federation": {
            "mode": (
                "agents-mesh-sync"
                if pagents.AGENTS_MESH_ENABLED and pagents.AGENTS_MESH_SYNC
                else ("agents-mesh-mvp" if pagents.AGENTS_MESH_ENABLED else "stub")
            ),
            "peers": peers,
            "note": (
                pagents.mesh_limits_note()
                if pagents.AGENTS_MESH_ENABLED
                else (
                    "MVP stub — configure SPOCKIFY_FEDERATION_PEERS or FEDERATION_PEERS "
                    "(comma URLs). Parallel agents can offload workers when peers are set; "
                    "see docs/SPOCKIFY_FEDERATION.md."
                )
            ),
        },
        "agents": {
            "max_workers": pagents.AGENTS_MAX_WORKERS,
            "max_depth": pagents.AGENTS_MAX_DEPTH,
            "shared_tools": pagents.AGENTS_SHARED_TOOLS,
            "mesh_enabled": pagents.AGENTS_MESH_ENABLED,
            "mesh_sync": pagents.AGENTS_MESH_SYNC,
            "mesh_endpoints": pagents.AGENTS_MESH_ENDPOINTS,
            "mesh_note": pagents.mesh_limits_note(),
            "runs_dir": str(pagents.AGENT_RUNS_DIR),
        },
        "browser": {
            "allowlist": browser.BROWSER_ALLOWLIST,
            "require_confirm": browser.BROWSER_REQUIRE_CONFIRM,
            "playwright": browser.playwright_available(),
            "playwright_ws": bool(browser.PLAYWRIGHT_WS_URL),
            "playwright_local": browser.PLAYWRIGHT_LOCAL,
            "note": browser.browser_limits_note(),
        },
        "critique": {
            "enabled": critique_mod.CRITIQUE_ENABLED,
            "auto_chars": critique_mod.CRITIQUE_AUTO_CHARS,
        },
        "workspace": workspace_mod.workspace_status(),
        "session_memory": {
            "digest_count": len(_load_session_digests()),
            "note": "Wave 6 — condensed digests; see GET /spockify/memory/sessions",
        },
        "connectors": connectors_mod.connectors_status(),
        "skills": skills_mod.skills_status(),
        "eval_board": eval_mod.eval_status(),
        "family_mode": family_mod.family_status(),
        "ops": ops_mod.ops_snapshot(
            active_agent_runs=len(getattr(pagents, "_RUN_TASKS", {}) or {})
        ),
        "wave": 9,
    }


@app.get("/spockify/memory/sessions")
async def list_session_memory(
    user_id: Optional[str] = None,
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """List condensed session digests (Wave 6 memory browser)."""
    uid = (user_id or x_spockify_user_id or "").strip() or None
    digests = _load_session_digests(user_id=uid)
    return {
        "ok": True,
        "count": len(digests),
        "sessions": [
            {
                "id": d.get("id"),
                "user_id": d.get("user_id"),
                "updated_at": d.get("updated_at"),
                "message_count": d.get("message_count"),
                "preview": str(d.get("content") or "")[:400],
                "content": d.get("content"),
            }
            for d in digests[:100]
        ],
    }


@app.delete("/spockify/memory/sessions/{digest_id}")
async def delete_session_memory(
    digest_id: str,
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """Delete one session digest (optional ownership via X-Spockify-User-Id)."""
    digests = {str(d.get("id")): d for d in _load_session_digests()}
    entry = digests.get(digest_id)
    if not entry:
        raise HTTPException(status_code=404, detail="digest not found")
    uid = (x_spockify_user_id or "").strip()
    if uid and entry.get("user_id") and str(entry.get("user_id")) != uid:
        raise HTTPException(status_code=404, detail="digest not found")
    ok = _delete_session_digest(digest_id)
    if not ok:
        raise HTTPException(status_code=404, detail="digest not found")
    return {"ok": True, "id": digest_id}


def _is_room_model(model: Optional[str]) -> bool:
    name = (model or "").lower()
    return "spockify-room" in name or name.endswith("/spockify-room")


async def _agents_search_tool(client: httpx.AsyncClient, query: str) -> str:
    """Shared web-search tool for parallel workers (SearXNG)."""
    text, _sources = await _searxng_search(client, query, limit=4)
    return text


async def _agents_browse_tool(client: httpx.AsyncClient, query: str) -> str:
    """Shared browser fetch tool for parallel workers."""
    return await browser.browse_tool(client, query)


async def _agents_mesh_sync(run_view: dict[str, Any]) -> None:
    """Push run snapshot to mesh peers (best-effort, Wave 8.4)."""
    if not pagents.AGENTS_MESH_SYNC or not pagents.AGENTS_MESH_ENDPOINTS:
        return
    async with httpx.AsyncClient() as client:
        for base in pagents.AGENTS_MESH_ENDPOINTS:
            try:
                await client.post(
                    f"{base.rstrip('/')}/spockify/agents/runs/sync",
                    json={"run": run_view},
                    timeout=8.0,
                )
            except Exception as exc:  # noqa: BLE001
                LOG.debug("mesh sync to %s failed: %s", base, exc)


# Register mesh sync once at import/startup side-effect.
pagents.set_mesh_sync_fn(_agents_mesh_sync)


async def _agents_mesh_chat(
    client: httpx.AsyncClient,
    endpoint: str,
    model: str,
    messages: list[dict[str, Any]],
    **kwargs: Any,
) -> dict[str, Any]:
    """Offload one worker completion to a federation/mesh peer router."""
    base = endpoint.rstrip("/")
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        **kwargs,
    }
    headers = {"Content-Type": "application/json"}
    # Prefer peer OpenAI-compatible /v1; fall back to bare /chat/completions.
    last_exc: Optional[Exception] = None
    for path in ("/v1/chat/completions", "/chat/completions"):
        try:
            resp = await client.post(
                f"{base}{path}",
                headers=headers,
                json=body,
                timeout=min(pagents.AGENTS_WORKER_TIMEOUT, WORKER_TIMEOUT),
            )
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("choices"):
                return data
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            continue
    raise RuntimeError(f"mesh peer {base} failed: {last_exc}")


@app.post("/spockify/agents/runs")
async def create_agent_run(
    body: pagents.AgentRunCreate,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """Start a parallel multi-agent run (async execution)."""
    _check_auth(authorization)
    if not (body.parent_prompt or "").strip():
        raise HTTPException(status_code=400, detail="parent_prompt required")
    if x_spockify_user_id and not body.user_id:
        body.user_id = x_spockify_user_id
    run = pagents.create_run_record(body)

    async def _bg() -> None:
        async with httpx.AsyncClient() as client:
            await pagents.execute_run(
                run,
                client=client,
                worker_chat=_worker_chat,
                mesh_chat=_agents_mesh_chat,
                search_tool=_agents_search_tool,
                browse_tool=_agents_browse_tool,
            )

    task = asyncio.create_task(_bg())
    pagents.register_run_task(str(run["id"]), task)
    return pagents.public_run_view(run)


@app.get("/spockify/agents/runs")
async def list_agent_runs(
    limit: int = 50,
    user_id: Optional[str] = None,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    _check_auth(authorization)
    uid = (user_id or x_spockify_user_id or "").strip() or None
    runs = [pagents.public_run_view(r) for r in pagents.list_runs(limit, user_id=uid)]
    return {"ok": True, "runs": runs, "count": len(runs)}


@app.get("/spockify/agents/runs/{run_id}")
async def get_agent_run(
    run_id: str,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    _check_auth(authorization)
    run = pagents.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    uid = (x_spockify_user_id or "").strip()
    if uid and str(run.get("user_id") or "") not in ("", uid):
        raise HTTPException(status_code=404, detail="run not found")
    return pagents.public_run_view(run)


@app.post("/spockify/agents/runs/{run_id}/cancel")
async def cancel_agent_run(
    run_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Cancel a running (or synthesizing) multi-agent run."""
    _check_auth(authorization)
    run = pagents.request_cancel(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return {"ok": True, "run": pagents.public_run_view(run)}


@app.post("/spockify/agents/runs/{run_id}/fork")
async def agent_run_fork(
    run_id: str,
    body: pagents.AgentForkRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Time-travel fork from a worker mid-state (Wave 10.4)."""
    _check_auth(authorization)
    try:
        run = pagents.fork_run_from_worker(run_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "run": pagents.public_run_view(run)}


@app.post("/spockify/agents/runs/{run_id}/workers/{worker_id}/cancel")
async def cancel_agent_worker(
    run_id: str,
    worker_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Cancel one worker; siblings and synthesis may continue."""
    _check_auth(authorization)
    run = pagents.request_cancel(run_id, worker_id=worker_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return {"ok": True, "run": pagents.public_run_view(run)}


@app.post("/spockify/agents/runs/sync")
async def sync_agent_run(
    body: dict[str, Any],
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Ingest a peer run snapshot (Wave 8.4 mesh shared state MVP)."""
    _check_auth(authorization)
    payload = body.get("run") if isinstance(body.get("run"), dict) else body
    try:
        stored = pagents.ingest_synced_run(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "run": pagents.public_run_view(stored)}


@app.post("/spockify/browser/fetch")
async def browser_fetch(
    body: browser.BrowserFetchRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Allowlisted URL fetch / Playwright click-type (Wave 8.1 / 9.1)."""
    _check_auth(authorization)
    # Prefer Playwright for interactive actions; also try for navigate when enabled.
    if body.action or browser.playwright_available():
        pw = await browser.maybe_playwright_action(body)
        if pw is not None:
            if pw.get("ok") or body.action not in (None, "navigate"):
                return pw
            # Soft-fail navigate → fetch fallback below.
    async with httpx.AsyncClient() as client:
        result = await browser.fetch_page(client, body.url, confirm=body.confirm)
        if body.action and body.action != "navigate":
            result["note"] = (
                result.get("note") or ""
            ) + "; playwright unavailable — fetch-only fallback"
            result["fallback"] = "fetch"
        return result


def _connectors_user_id(
    x_spockify_user_id: Optional[str] = None,
) -> str:
    uid = (x_spockify_user_id or "").strip()
    if not uid:
        raise HTTPException(
            status_code=400,
            detail="X-Spockify-User-Id required for per-user connectors",
        )
    return uid


@app.get("/spockify/connectors")
async def get_connectors(
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """List the requesting user's connectors only (Wave 9.3 per-user)."""
    _check_auth(authorization)
    user_id = _connectors_user_id(x_spockify_user_id)
    return {
        "ok": True,
        "user_id": user_id,
        "connectors": connectors_mod.list_connectors(user_id),
    }


@app.put("/spockify/connectors")
async def put_connectors(
    body: connectors_mod.ConnectorsUpdate,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    _check_auth(authorization)
    user_id = _connectors_user_id(x_spockify_user_id)
    return {
        "ok": True,
        "user_id": user_id,
        "connectors": connectors_mod.update_connectors(body, user_id),
    }


@app.post("/spockify/connectors/migrate-legacy")
async def migrate_legacy_connectors(
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """Claim legacy global connector files into this user's folder (admin)."""
    _check_auth(authorization)
    user_id = _connectors_user_id(x_spockify_user_id)
    return connectors_mod.migrate_legacy_connectors(user_id)


@app.get("/spockify/connectors/briefing")
async def connectors_briefing(
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """Pull connector digest for the requesting user only."""
    _check_auth(authorization)
    user_id = _connectors_user_id(x_spockify_user_id)
    return await connectors_mod.briefing_context(user_id)


@app.get("/spockify/connectors/calendar/events")
async def connectors_calendar_events(
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 200,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """ICS events for the requesting user's calendar connector only."""
    _check_auth(authorization)
    user_id = _connectors_user_id(x_spockify_user_id)
    return await connectors_mod.calendar_events(
        user_id, start=start, end=end, limit=limit
    )


@app.post("/spockify/connectors/{kind}/test")
async def connectors_test(
    kind: str,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """Probe calendar / email / Telegram for the requesting user only."""
    _check_auth(authorization)
    user_id = _connectors_user_id(x_spockify_user_id)
    return await connectors_mod.test_connector(kind, user_id)


@app.get("/spockify/skills")
async def list_skills(
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Discover SKILL.md / JSON packs (Wave 9.4)."""
    _check_auth(authorization)
    skills_mod.ensure_example_pack()
    return {"ok": True, **skills_mod.skills_status()}


@app.post("/spockify/skills/inject")
async def inject_skills(
    body: skills_mod.SkillAttachRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Return system message for selected skill packs."""
    _check_auth(authorization)
    msg = skills_mod.inject_skills_system_message(body.skill_ids)
    return {"ok": True, "message": msg, "skill_ids": body.skill_ids}


@app.get("/spockify/eval/sets")
async def eval_list_sets(
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    eval_mod.ensure_default_set()
    return {"ok": True, "sets": eval_mod.list_prompt_sets()}


@app.post("/spockify/eval/sets")
async def eval_save_set(
    body: eval_mod.EvalPromptSet,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    return {"ok": True, "set": eval_mod.save_prompt_set(body)}


@app.delete("/spockify/eval/sets/{set_id}")
async def eval_delete_set(
    set_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    if not eval_mod.delete_prompt_set(set_id):
        raise HTTPException(status_code=404, detail="set not found")
    return {"ok": True, "id": set_id}


@app.post("/spockify/eval/run")
async def eval_run(
    body: eval_mod.EvalRunRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Run a prompt set against models (Wave 9.7)."""
    _check_auth(authorization)

    async def _chat(client, model, messages, **kwargs):
        async with httpx.AsyncClient() as c:
            return await _worker_chat(c, model, messages, **kwargs)

    try:
        run = await eval_mod.run_eval(body, worker_chat=_chat)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "run": run}


@app.get("/spockify/eval/runs")
async def eval_list_runs(
    limit: int = 30,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    return {"ok": True, "runs": eval_mod.list_runs(limit)}


@app.get("/spockify/eval/runs/{run_id}")
async def eval_get_run(
    run_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    run = eval_mod.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return {"ok": True, "run": run}


@app.get("/spockify/family")
async def get_family_mode(
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    return {"ok": True, **family_mod.family_status(), "config": family_mod.load_config().model_dump()}


@app.put("/spockify/family")
async def put_family_mode(
    body: family_mod.FamilyModeConfig,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    cfg = family_mod.save_config(body)
    return {"ok": True, "config": cfg.model_dump(), **family_mod.family_status()}


@app.post("/spockify/family/check")
async def family_check(
    body: dict[str, Any],
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """OWUI enforcement helper: check role/model/tool access."""
    _check_auth(authorization)
    ok, reason = family_mod.check_access(
        role=body.get("role"),
        user_id=str(body.get("user_id") or "anon"),
        model=body.get("model"),
        tool=body.get("tool"),
    )
    return {"ok": ok, "reason": reason}


@app.post("/spockify/workspace/diff")
async def workspace_diff(
    body: workspace_mod.DiffRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Build a unified diff from artifact content (Wave 8.7)."""
    _check_auth(authorization)
    patch = workspace_mod.content_to_unified_diff(
        filename=body.filename,
        content=body.content,
        old_content=body.old_content,
    )
    return {
        "ok": True,
        "filename": body.filename,
        "patch": patch,
        "workspace": workspace_mod.workspace_status(),
    }


@app.post("/spockify/workspace/apply")
async def workspace_apply(
    body: workspace_mod.ApplyPatchRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Optionally apply a patch under WORKSPACE_GIT_ROOT (default dry_run)."""
    _check_auth(authorization)
    return workspace_mod.apply_patch(body)


@app.get("/spockify/workspace/status")
async def workspace_status_endpoint(
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    return {"ok": True, **workspace_mod.workspace_status()}


# --- Wave 10 ---


@app.post("/spockify/screen/frames")
async def screen_share_frames(
    body: screen_mod.ScreenShareRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Ingest getDisplayMedia frames → narration + Playwright hints (W10.1)."""
    _check_auth(authorization)
    return await screen_mod.ingest_frames(body)


@app.get("/spockify/screen/sessions")
async def screen_share_sessions(
    limit: int = 20,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    return {"ok": True, "sessions": screen_mod.list_sessions(limit)}


@app.post("/spockify/home/ingest")
async def home_brain_ingest(
    body: home_mod.HomeIngestRequest,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    """Home brain image/URL ingest (W10.5)."""
    _check_auth(authorization)
    if x_spockify_user_id and not body.user_id:
        body.user_id = x_spockify_user_id
    return await home_mod.ingest(body)


@app.post("/spockify/home/webhook")
async def home_brain_webhook(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_hub_signature_256: Optional[str] = Header(None, alias="X-Hub-Signature-256"),
) -> dict[str, Any]:
    """Simple webhook for doorbell/motion → same ingest path."""
    # Auth optional when HOME_BRAIN_WEBHOOK_SECRET set (HMAC); else router auth.
    raw = await request.body()
    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="invalid JSON") from exc
    if home_mod.HOME_BRAIN_WEBHOOK_SECRET:
        if not home_mod.verify_webhook_signature(raw, x_hub_signature_256):
            raise HTTPException(status_code=401, detail="bad webhook signature")
    else:
        _check_auth(authorization)
    req = home_mod.HomeWebhookRequest(**payload)
    return await home_mod.webhook_ingest(
        req, raw_body=raw, signature=x_hub_signature_256
    )


@app.get("/spockify/home/events")
async def home_brain_events(
    limit: int = 30,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    _check_auth(authorization)
    return {
        "ok": True,
        "events": home_mod.list_events(limit, user_id=x_spockify_user_id),
        "doorbell_next_step": (
            "Point Frigate/doorbell at POST /spockify/home/webhook"
        ),
    }


def _ghost_user_id(x_spockify_user_id: Optional[str] = None) -> str:
    uid = (x_spockify_user_id or "").strip()
    if not uid:
        raise HTTPException(
            status_code=400,
            detail="X-Spockify-User-Id required for ghost workspace",
        )
    return uid


def _ghost_http_error(exc: Exception) -> None:
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(exc, FileNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, FileExistsError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


@app.get("/spockify/ghost/workspace")
async def ghost_workspace_list(
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
    x_spockify_role: Optional[str] = Header(None, alias="X-Spockify-Role"),
) -> dict[str, Any]:
    """List the requesting user's Ghost IDE workspace tree."""
    _check_auth(authorization)
    uid = _ghost_user_id(x_spockify_user_id)
    try:
        ghost_mod.seed_welcome_if_empty(uid)
        return ghost_mod.workspace_list(uid, role=x_spockify_role)
    except Exception as exc:  # noqa: BLE001
        _ghost_http_error(exc)
        raise


@app.get("/spockify/ghost/workspace/file")
async def ghost_workspace_read(
    path: str,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    _check_auth(authorization)
    uid = _ghost_user_id(x_spockify_user_id)
    try:
        return ghost_mod.workspace_read(uid, path)
    except Exception as exc:  # noqa: BLE001
        _ghost_http_error(exc)
        raise


@app.put("/spockify/ghost/workspace/file")
async def ghost_workspace_write(
    body: ghost_mod.WorkspaceWriteRequest,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
    x_spockify_role: Optional[str] = Header(None, alias="X-Spockify-Role"),
) -> dict[str, Any]:
    _check_auth(authorization)
    uid = _ghost_user_id(x_spockify_user_id)
    try:
        return ghost_mod.workspace_write(
            uid, body.path, body.content, role=x_spockify_role
        )
    except Exception as exc:  # noqa: BLE001
        _ghost_http_error(exc)
        raise


@app.post("/spockify/ghost/workspace/mkdir")
async def ghost_workspace_mkdir(
    body: ghost_mod.WorkspaceMkdirRequest,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
    x_spockify_role: Optional[str] = Header(None, alias="X-Spockify-Role"),
) -> dict[str, Any]:
    _check_auth(authorization)
    uid = _ghost_user_id(x_spockify_user_id)
    try:
        return ghost_mod.workspace_mkdir(uid, body.path, role=x_spockify_role)
    except Exception as exc:  # noqa: BLE001
        _ghost_http_error(exc)
        raise


@app.post("/spockify/ghost/workspace/rename")
async def ghost_workspace_rename(
    body: ghost_mod.WorkspaceRenameRequest,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
    x_spockify_role: Optional[str] = Header(None, alias="X-Spockify-Role"),
) -> dict[str, Any]:
    _check_auth(authorization)
    uid = _ghost_user_id(x_spockify_user_id)
    try:
        return ghost_mod.workspace_rename(
            uid, body.from_path, body.to_path, role=x_spockify_role
        )
    except Exception as exc:  # noqa: BLE001
        _ghost_http_error(exc)
        raise


@app.delete("/spockify/ghost/workspace/file")
async def ghost_workspace_delete(
    path: str,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
    x_spockify_role: Optional[str] = Header(None, alias="X-Spockify-Role"),
) -> dict[str, Any]:
    _check_auth(authorization)
    uid = _ghost_user_id(x_spockify_user_id)
    try:
        return ghost_mod.workspace_delete(uid, path, role=x_spockify_role)
    except Exception as exc:  # noqa: BLE001
        _ghost_http_error(exc)
        raise


@app.get("/spockify/ghost/workspace/download")
async def ghost_workspace_download_file(
    path: str,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> Response:
    """Download one workspace file (guests allowed if they can read it)."""
    _check_auth(authorization)
    uid = _ghost_user_id(x_spockify_user_id)
    try:
        payload = ghost_mod.workspace_download_file(uid, path)
    except Exception as exc:  # noqa: BLE001
        _ghost_http_error(exc)
        raise
    filename = payload["filename"]
    return Response(
        content=payload["content"],
        media_type=payload["media_type"],
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/spockify/ghost/workspace/download.zip")
async def ghost_workspace_download_zip(
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> Response:
    """Download the requesting user's Ghost workspace as a zip."""
    _check_auth(authorization)
    uid = _ghost_user_id(x_spockify_user_id)
    try:
        payload = ghost_mod.workspace_download_zip(uid)
    except Exception as exc:  # noqa: BLE001
        _ghost_http_error(exc)
        raise
    filename = payload["filename"]
    return Response(
        content=payload["content"],
        media_type=payload["media_type"],
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@app.post("/spockify/ghost/suggest")
async def ghost_suggest(
    body: ghost_mod.GhostSuggestRequest,
    authorization: Optional[str] = Header(None),
    x_spockify_role: Optional[str] = Header(None, alias="X-Spockify-Role"),
) -> dict[str, Any]:
    """Ghost AI: suggest / complete / edit / chat for the Monaco IDE.

    Tab protocol v2 (mode=complete): accepts request_id / workspace_id /
    rel_path / cursor_col / diff_history / context_items / linter_errors /
    trigger, responds with request_id + mode:"insert"|"edit" (+ optional
    edit / confidence / suppress_reason), and records a tab_events row for
    fate telemetry (see POST /spockify/ghost/fate).
    """
    _check_auth(authorization)
    if x_spockify_role and not body.role:
        body.role = x_spockify_role

    async def _chat(client, model, messages, **kwargs):
        async with httpx.AsyncClient() as c:
            return await _worker_chat(c, model, messages, **kwargs)

    result = await ghost_mod.suggest(body, worker_chat=_chat)

    if (body.mode or "").lower() == "complete" and result.get("request_id"):
        # Async training-substrate write — never blocks the completion.
        ghost_telemetry.record_suggest(
            {
                "request_id": result["request_id"],
                "workspace_id": body.workspace_id,
                "rel_path": body.rel_path or body.filename,
                "language": body.language,
                "trigger": body.trigger,
                "model": result.get("model"),
                "prefix": body.prefix,
                "suffix": body.suffix,
                "diff_history": [
                    d.model_dump() for d in body.diff_history
                ],
                "context_items": [
                    c.model_dump() for c in body.context_items
                ],
                "suggestion": result.get("insert_text")
                or result.get("suggestion"),
                "mode": result.get("mode"),
                "edit": result.get("edit"),
                "latency_ms": result.get("latency_ms"),
                "suppress_reason": result.get("suppress_reason"),
            }
        )
    return result


@app.post("/spockify/ghost/fate")
async def ghost_fate(
    body: ghost_telemetry.GhostFateRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Tab fate telemetry: accepted / rejected / partial / ignored.

    Feeds the recently-rejected suppression LRU and updates the matching
    tab_events row (fail-soft when the DB is unavailable).
    """
    _check_auth(authorization)
    ghost_fim.note_fate(body.request_id, body.fate)
    stored = await ghost_telemetry.record_fate(body)
    return {"ok": True, "request_id": body.request_id, "stored": stored}


@app.post("/spockify/rooms")
async def multiplayer_create_room(
    body: multi_mod.RoomCreate,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    room = multi_mod.create_room(body)
    return {
        "ok": True,
        "room": multi_mod.public_room(room, include_invite=True),
    }


@app.get("/spockify/rooms")
async def multiplayer_list_rooms(
    limit: int = 30,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    _check_auth(authorization)
    uid = (x_spockify_user_id or "").strip() or None
    return {"ok": True, "rooms": multi_mod.list_rooms(limit, user_id=uid)}


@app.get("/spockify/rooms/{room_id}")
async def multiplayer_get_room(
    room_id: str,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
    x_invite_token: Optional[str] = Header(None, alias="X-Invite-Token"),
) -> dict[str, Any]:
    _check_auth(authorization)
    raw = multi_mod.get_room_raw(room_id)
    if not raw:
        raise HTTPException(status_code=404, detail="room not found")
    if not multi_mod.user_can_access_room(
        raw,
        user_id=x_spockify_user_id,
        invite_token=x_invite_token,
    ):
        raise HTTPException(status_code=404, detail="room not found")
    include_invite = str(raw.get("owner_id") or "") == str(x_spockify_user_id or "")
    return {
        "ok": True,
        "room": multi_mod.public_room(raw, include_invite=include_invite),
    }


@app.post("/spockify/rooms/{room_id}/join")
async def multiplayer_join_room(
    room_id: str,
    body: dict[str, Any],
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    result = multi_mod.join_room(
        room_id,
        user_id=str(body.get("user_id") or ""),
        invite_token=body.get("invite_token"),
    )
    if not result.get("ok"):
        raise HTTPException(status_code=403, detail=result.get("error") or "join failed")
    return result


@app.post("/spockify/rooms/{room_id}/messages")
async def multiplayer_post_message(
    room_id: str,
    body: multi_mod.RoomMessage,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
    x_invite_token: Optional[str] = Header(None, alias="X-Invite-Token"),
) -> dict[str, Any]:
    _check_auth(authorization)
    result = multi_mod.post_message(
        room_id,
        body,
        user_id=x_spockify_user_id or body.author_id,
        invite_token=x_invite_token,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=403, detail=result.get("error") or "post failed")
    return result


@app.post("/spockify/dream/run")
async def dream_run(
    body: dream_mod.DreamRunRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Overnight dream insights + draft patches (W10.8)."""
    _check_auth(authorization)
    run = dream_mod.run_dream(body)
    return {"ok": True, "run": run}


@app.get("/spockify/dream/runs")
async def dream_list(
    limit: int = 20,
    authorization: Optional[str] = Header(None),
    x_spockify_user_id: Optional[str] = Header(None, alias="X-Spockify-User-Id"),
) -> dict[str, Any]:
    _check_auth(authorization)
    uid = (x_spockify_user_id or "").strip() or None
    return {"ok": True, "runs": dream_mod.list_dreams(limit, user_id=uid)}


@app.get("/spockify/dream/runs/{run_id}")
async def dream_get(
    run_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    run = dream_mod.get_dream(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="dream not found")
    return {"ok": True, "run": run}


@app.post("/spockify/voice-world/notes")
async def voice_world_add(
    body: voice_mod.VoiceNoteCreate,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    result = voice_mod.add_note(body)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@app.get("/spockify/voice-world/notes")
async def voice_world_list(
    user_id: str,
    include_done: bool = False,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    return {
        "ok": True,
        "notes": voice_mod.list_notes(user_id, include_done=include_done),
    }


@app.post("/spockify/voice-world/return")
async def voice_world_return(
    body: voice_mod.VoiceReturnSignal,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Surface due notes when user returns to PWA/Call (W10.9)."""
    _check_auth(authorization)
    return voice_mod.due_notes(body)


@app.post("/spockify/spectacle/debate")
async def spectacle_debate(
    body: spectacle_mod.DebateRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Popcorn model debate (W10.10)."""
    _check_auth(authorization)

    async def _chat(client, model, messages, **kwargs):
        async with httpx.AsyncClient() as c:
            return await _worker_chat(c, model, messages, **kwargs)

    return await spectacle_mod.run_debate(body, worker_chat=_chat)


@app.post("/spockify/spectacle/vote")
async def spectacle_vote(
    body: spectacle_mod.VoteRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    result = spectacle_mod.vote(body)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


@app.get("/spockify/spectacle/debates")
async def spectacle_list(
    limit: int = 20,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    return {"ok": True, "debates": spectacle_mod.list_debates(limit)}


@app.get("/spockify/spectacle/debates/{debate_id}")
async def spectacle_get(
    debate_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    _check_auth(authorization)
    debate = spectacle_mod.get_debate(debate_id)
    if not debate:
        raise HTTPException(status_code=404, detail="debate not found")
    return {"ok": True, "debate": debate}


@app.get("/spockify/agents/runs/{run_id}/events")
async def agent_run_events(
    run_id: str,
    authorization: Optional[str] = Header(None),
) -> StreamingResponse:
    _check_auth(authorization)
    if not pagents.get_run(run_id):
        raise HTTPException(status_code=404, detail="run not found")

    async def event_stream() -> AsyncIterator[bytes]:
        async for ev in pagents.stream_run_events(run_id):
            yield f"data: {json.dumps(ev, separators=(',', ':'))}\n\n".encode()
        yield b"data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Spockify-Agents-Run": run_id,
        },
    )


async def _stream_agents_completion(
    req: ChatCompletionRequest,
) -> AsyncIterator[bytes]:
    """Chat path: plan → parallel workers → synthesis (streamed).

    The background run is intentionally decoupled from the SSE consumer:
    idle proxies often drop quiet streams (~60s), and AbortController on the
    IDE/chat client cancels the generator. Cancelling workers on disconnect
    caused Explorer/Analyst to always end as ``cancelled`` with 0/N done.
    Heartbeats keep live clients alive; disconnect leaves the run running
    (same semantics as ``POST /spockify/agents/runs``).
    """
    user_msg = _user_text(req.messages)
    body = pagents.AgentRunCreate(
        parent_prompt=user_msg,
        model=req.model or "spockify-agents",
        synthesize=True,
        user_id=getattr(req, "spockify_user_id", None),
    )
    run = pagents.create_run_record(body)
    run_id = str(run["id"])
    yield _status_sse(
        f"Parallel agents: {len(run['workers'])} workers…",
        done=False,
        worker="agents",
    )
    yield pagents.agents_meta_sse(run)

    async def _run_job() -> None:
        async with httpx.AsyncClient() as client:
            await pagents.execute_run(
                run,
                client=client,
                worker_chat=_worker_chat,
                mesh_chat=_agents_mesh_chat,
                search_tool=_agents_search_tool,
                browse_tool=_agents_browse_tool,
            )

    task = asyncio.create_task(_run_job())
    pagents.register_run_task(run_id, task)
    last_status = ""
    last_worker_sig = ""
    last_emit = time.monotonic()
    # Proxies commonly idle-cut quiet SSE around 60s; keep well under that.
    heartbeat_s = 5.0
    try:
        while not task.done():
            current = pagents.get_run(run_id) or run
            status = str(current.get("status") or "")
            worker_sig = "|".join(
                f"{w.get('id')}:{w.get('status')}"
                for w in (current.get("workers") or [])
            )
            now = time.monotonic()
            changed = status != last_status or worker_sig != last_worker_sig
            due_heartbeat = (now - last_emit) >= heartbeat_s
            if changed or due_heartbeat:
                last_status = status
                last_worker_sig = worker_sig
                last_emit = now
                if changed:
                    yield _status_sse(
                        f"Parallel agents: {status}",
                        done=False,
                        worker="agents",
                    )
                else:
                    # SSE comment — ignored by clients, resets proxy idle timers.
                    yield b": agents-keepalive\n\n"
                yield pagents.agents_meta_sse(current)
            await asyncio.sleep(0.4)
        await task
    except asyncio.CancelledError:
        # Client gone / proxy idle — do NOT cancel the background run.
        LOG.info(
            "agents stream disconnected; run %s continues in background",
            run_id,
        )
        return
    except Exception as exc:
        LOG.exception("agents stream failed: %s", exc)
        yield _stream_error_sse(str(exc))
        return

    final = pagents.get_run(run_id) or run
    yield pagents.agents_meta_sse(final)

    for w in final.get("workers") or []:
        label = w.get("name") or w.get("id")
        status = w.get("status")
        mesh_tag = " · mesh" if w.get("mesh") else ""
        tools_tag = (
            f" · tools:{','.join(w.get('tools_used') or [])}"
            if w.get("tools_used")
            else ""
        )
        yield pagents.content_sse_delta(
            f"\n\n<details><summary>Agent: {label} ({status}{mesh_tag}{tools_tag})</summary>\n\n"
        )
        text = str(w.get("output") or "")
        step = 240
        for i in range(0, len(text), step):
            yield pagents.content_sse_delta(text[i : i + step])
        yield pagents.content_sse_delta("\n\n</details>\n")

    synthesis = str(final.get("synthesis") or "").strip()
    if synthesis:
        heading = (
            "\n\n### Synthesis (cancelled — partial)\n\n"
            if final.get("status") == "cancelled"
            else "\n\n### Synthesis\n\n"
        )
        yield pagents.content_sse_delta(heading)
        step = 240
        for i in range(0, len(synthesis), step):
            yield pagents.content_sse_delta(synthesis[i : i + step])

    yield pagents.content_sse_delta("", finish=True)
    yield b"data: [DONE]\n\n"


def _content_sse_delta(text: str, *, finish: bool = False) -> bytes:
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": "spockify-room",
        "choices": [
            {
                "index": 0,
                "delta": {"content": text} if text else {},
                "finish_reason": "stop" if finish else None,
            }
        ],
    }
    if finish and not text:
        chunk["choices"][0]["delta"] = {}
    return f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n".encode()


def _room_roles() -> list[tuple[str, str, str]]:
    """(label, worker, system_prompt)."""
    return [
        (
            "Researcher",
            ROOM_RESEARCHER_WORKER,
            (
                "You are the Researcher in a Spockify multi-agent room. "
                "Clarify the problem, list key facts/constraints, and propose an approach. "
                "Be concise (bullets OK). Do not write full final code unless asked."
            ),
        ),
        (
            "Coder",
            ROOM_CODER_WORKER,
            (
                "You are the Coder in a Spockify multi-agent room. "
                "Given the researcher's notes and the user request, produce a concrete solution "
                "(code, steps, or config). Prefer working snippets over prose."
            ),
        ),
        (
            "Critic",
            ROOM_CRITIC_WORKER,
            (
                "You are the Critic in a Spockify multi-agent room. "
                "Review Researcher + Coder output for bugs, gaps, and risks. "
                "End with a short FINAL ANSWER the user can use."
            ),
        ),
    ]


async def _room_role_text(
    client: httpx.AsyncClient,
    *,
    worker: str,
    system: str,
    user_msg: str,
    prior: str,
    temperature: Optional[float],
) -> str:
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": (
                f"User request:\n{user_msg}\n\n"
                f"Prior room turns:\n{prior or '(none yet)'}"
            ),
        },
    ]
    result = await _worker_chat(
        client,
        worker,
        messages,
        temperature=temperature if temperature is not None else 0.4,
        max_tokens=ROOM_MAX_TOKENS,
    )
    try:
        return (result["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError):
        return ""


async def _stream_room_completion(
    req: ChatCompletionRequest,
) -> AsyncIterator[bytes]:
    user_msg = _user_text(req.messages)
    yield _status_sse("Room: Researcher → Coder → Critic…", done=False, worker="room")
    yield (
        "data: "
        + json.dumps(
            {
                "selected_model_id": "spockify-room",
                "worker": "room",
                "event": {
                    "type": "status",
                    "data": {
                        "action": "routing",
                        "description": "Multi-agent room",
                        "done": True,
                    },
                },
            },
            separators=(",", ":"),
        )
        + "\n\n"
    ).encode()

    prior_parts: list[str] = []
    async with httpx.AsyncClient() as client:
        for label, worker, system in _room_roles():
            yield _status_sse(f"Room: {label} ({worker})…", done=False, worker=worker)
            yield _content_sse_delta(f"\n\n### {label}\n\n")
            prior = "\n\n".join(prior_parts)
            try:
                text = await _room_role_text(
                    client,
                    worker=worker,
                    system=system,
                    user_msg=user_msg,
                    prior=prior,
                    temperature=req.temperature,
                )
            except Exception as exc:
                LOG.exception("room role %s failed: %s", label, exc)
                text = f"[{label} failed: {exc}]"
            if not text:
                text = f"[{label} produced no content]"
            step = 240
            for i in range(0, len(text), step):
                yield _content_sse_delta(text[i : i + step])
            prior_parts.append(f"### {label}\n{text}")

    yield _content_sse_delta("", finish=True)
    yield b"data: [DONE]\n\n"


async def _prewarm_models() -> None:
    if not PREWARM_ON_STARTUP or not PREWARM_MODELS:
        return
    async with httpx.AsyncClient() as client:
        for model in PREWARM_MODELS:
            try:
                await _ollama_chat_text(
                    client,
                    model,
                    [{"role": "user", "content": "warm"}],
                    timeout=60.0,
                    max_tokens=1,
                    temperature=0.0,
                )
                LOG.info("prewarmed %s", model)
            except (httpx.HTTPError, KeyError) as exc:
                LOG.warning("prewarm %s failed: %s", model, exc)


async def _prewarm_models_background() -> None:
    """Prewarm without blocking uvicorn startup (/health must respond for probes)."""
    try:
        await _prewarm_models()
    except Exception:
        LOG.exception("background prewarm failed")


@app.on_event("startup")
async def startup_prewarm() -> None:
    if PREWARM_ON_STARTUP and PREWARM_MODELS:
        asyncio.create_task(_prewarm_models_background(), name="prewarm-models")


@app.on_event("startup")
async def startup_ghost_telemetry() -> None:
    # Fail-soft: tab completions keep working when Postgres is unavailable.
    await ghost_telemetry.init()


@app.on_event("shutdown")
async def shutdown_ghost_telemetry() -> None:
    await ghost_telemetry.close()


@app.post("/v1/chat/completions", response_model=None)
async def chat_completions(
    req: ChatCompletionRequest,
    request: Request,
    authorization: Optional[str] = Header(None),
) -> Union[dict[str, Any], StreamingResponse]:
    _check_auth(authorization)

    # Wave 9.4 — merge skill ids from header.
    req.skill_ids = _skill_ids_from_request(req, request)

    # Wave 9.8 — family/guest enforcement.
    role = (
        req.spockify_role
        or (request.headers.get("x-spockify-role") or "").strip()
        or None
    )
    user_id = (
        req.spockify_user_id
        or (request.headers.get("x-spockify-user-id") or "").strip()
        or "anon"
    )
    ok_fam, fam_reason = family_mod.check_access(
        role=role, user_id=user_id, model=req.model
    )
    if not ok_fam:
        raise HTTPException(status_code=403, detail=fam_reason or "family mode blocked")

    # W7 parallel multi-agent — skip normal auto routing.
    if pagents.is_agents_model(req.model):
        if req.stream:

            async def agents_stream() -> AsyncIterator[bytes]:
                try:
                    async for chunk in _stream_agents_completion(req):
                        yield chunk
                except Exception as exc:
                    LOG.exception("agents stream failed: %s", exc)
                    yield _stream_error_sse(str(exc))

            return StreamingResponse(
                agents_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Spockify-Worker": "agents",
                },
            )
        user_msg = _user_text(req.messages)
        body = pagents.AgentRunCreate(
            parent_prompt=user_msg,
            model=req.model or "spockify-agents",
            synthesize=True,
            user_id=getattr(req, "spockify_user_id", None),
        )
        run = pagents.create_run_record(body)
        async with httpx.AsyncClient() as client:
            final = await pagents.execute_run(
                run, client=client, worker_chat=_worker_chat
            )
        content = str(final.get("synthesis") or "")
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "spockify-agents",
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": content}}
            ],
            "spockify_worker": "agents",
            "spockify_agents": pagents.public_run_view(final),
        }

    # W4.3 multi-agent room — skip normal auto routing.
    if _is_room_model(req.model):
        if req.stream:

            async def room_stream() -> AsyncIterator[bytes]:
                try:
                    async for chunk in _stream_room_completion(req):
                        yield chunk
                except Exception as exc:
                    LOG.exception("room stream failed: %s", exc)
                    yield _stream_error_sse(str(exc))

            return StreamingResponse(
                room_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Spockify-Worker": "room",
                },
            )
        user_msg = _user_text(req.messages)
        parts: list[str] = []
        prior_parts: list[str] = []
        async with httpx.AsyncClient() as client:
            for label, worker, system in _room_roles():
                text = await _room_role_text(
                    client,
                    worker=worker,
                    system=system,
                    user_msg=user_msg,
                    prior="\n\n".join(prior_parts),
                    temperature=req.temperature,
                )
                block = f"### {label}\n\n{text or '[empty]'}"
                parts.append(block)
                prior_parts.append(block)
        content = "\n\n".join(parts)
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "spockify-room",
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": content}}
            ],
            "spockify_worker": "room",
        }

    header_mode = _search_mode_from_headers(request.headers)
    marker_mode, cleaned_messages = _search_mode_from_messages(req.messages)
    voice_from_msgs, cleaned_messages = _voice_mode_from_messages(cleaned_messages)
    req.messages = cleaned_messages
    search_mode = marker_mode or header_mode or "auto"
    voice_mode = voice_from_msgs or _voice_mode_from_headers(request.headers)

    user_msg = _user_text(req.messages)
    rules = _load_routing_rules()
    thread_id = _thread_id_from_headers(request.headers)

    async with httpx.AsyncClient() as client:
        decision = await _resolve_routing(
            client, user_msg, rules, req.messages, thread_id
        )
        decision = _apply_user_search_mode(user_msg, decision, search_mode)
        decision = _apply_voice_mode(decision, voice_mode)
        worker = _resolve_worker_model(decision)
        LOG.info(
            "route path=%s model=%s worker=%s search=%s mode=%s voice=%s stream=%s thread=%s",
            decision.routing_path,
            decision.selected_model,
            worker,
            decision.needs_web_search,
            search_mode,
            voice_mode,
            req.stream,
            (thread_id or "")[:12],
        )

        worker_messages, citation_sources = await _build_worker_messages(
            client, req, decision, user_msg, worker, voice_mode=voice_mode
        )
        is_commit = (
            decision.task_type == "commit_message"
            or _is_commit_message_request(user_msg, req.messages)
        )
        pipeline = _resolve_pipeline_options(req, request)
        pipeline_active = (
            (not is_commit)
            and pipeline.get("enabled")
            and worker not in ("agents", "room")
            and str(req.model or "").strip() not in ("spockify-room", "spockify-agents")
        )
        # Commit-message: force deterministic low-token decoding.
        call_temperature = req.temperature
        call_max_tokens = req.max_tokens
        call_stop: Optional[list[str]] = None
        if is_commit:
            call_temperature = COMMIT_MESSAGE_TEMPERATURE
            call_max_tokens = COMMIT_MESSAGE_MAX_TOKENS
            call_stop = ["\n- ", "\n* ", "\nWe need", "\nThe diff includes"]

        if req.stream:
            if pipeline_active:

                async def event_stream_pipeline() -> AsyncIterator[bytes]:
                    try:
                        yield _status_sse(
                            "Planning…", done=False, worker=pipeline["work_model"]
                        )
                        work_text, explain_model, pmeta = await _pipeline_work_phase(
                            client,
                            req=req,
                            worker_messages=worker_messages,
                            user_msg=user_msg,
                            pipeline=pipeline,
                        )
                        yield _status_sse(
                            "Polishing…", done=False, worker=explain_model
                        )
                        # Stream the user-facing refine/explain model live
                        # (hide_intermediate only suppresses the work-phase notes).
                        collected: list[str] = []
                        async for chunk in _worker_chat_stream(
                            explain_model,
                            _pipeline_explain_messages(user_msg, work_text),
                            temperature=req.temperature,
                            max_tokens=req.max_tokens,
                        ):
                            piece = _delta_content_from_sse_chunk(chunk)
                            if not piece:
                                continue
                            collected.append(piece)
                            yield _content_sse_delta(piece)
                        yield _content_sse_delta("", finish=True)
                        yield b"data: [DONE]\n\n"
                        if pmeta.get("enabled"):
                            LOG.info(
                                "pipeline stream complete work=%s explain=%s hide_intermediate=%s chars=%d",
                                pmeta.get("work_model"),
                                pmeta.get("explain_model"),
                                pmeta.get("hide_intermediate"),
                                len("".join(collected)),
                            )
                    except Exception as exc:
                        LOG.exception("pipeline stream failed: %s", exc)
                        yield _stream_error_sse(str(exc))

                return StreamingResponse(
                    event_stream_pipeline(),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                        **_response_headers(worker, decision),
                    },
                )

            async def event_stream() -> AsyncIterator[bytes]:
                t0 = time.perf_counter()
                collected: list[str] = []
                usage_acc: dict[str, Any] = {}
                try:
                    status = _routing_status_message(decision, user_msg)
                    yield _status_sse(
                        status,
                        done=False,
                        worker=worker,
                        web_search=decision.needs_web_search,
                    )
                    async for chunk in _stream_worker_with_preamble(
                        worker,
                        worker_messages,
                        decision,
                        user_msg,
                        skip_leading_status=True,
                        sources=citation_sources,
                        temperature=call_temperature,
                        max_tokens=call_max_tokens,
                        **({"stop": call_stop} if call_stop else {}),
                    ):
                        # Collect text + usage for HUD / critique (best-effort).
                        try:
                            if chunk.startswith(b"data:"):
                                raw = chunk[5:].strip()
                                if raw and raw != b"[DONE]":
                                    data = json.loads(raw)
                                    if isinstance(data, dict):
                                        if data.get("usage"):
                                            usage_acc.update(data["usage"])
                                        for ch in data.get("choices") or []:
                                            delta = ch.get("delta") or {}
                                            piece = delta.get("content") or ""
                                            if piece:
                                                collected.append(piece)
                        except (json.JSONDecodeError, TypeError, AttributeError):
                            pass
                        yield chunk

                    latency_ms = int((time.perf_counter() - t0) * 1000)
                    answer = "".join(collected)
                    prompt_t, completion_t = cost_hud.extract_usage_tokens(usage_acc)
                    if not prompt_t and not completion_t:
                        prompt_t = _estimate_tokens_from_text(user_msg)
                        completion_t = _estimate_tokens_from_text(answer)
                        usage_acc = {
                            "prompt_tokens": prompt_t,
                            "completion_tokens": completion_t,
                            "estimated": True,
                        }
                    hud = cost_hud.build_hud(
                        worker=worker,
                        latency_ms=latency_ms,
                        usage=usage_acc,
                        model=worker,
                    )
                    yield _hud_sse(hud, worker=worker)

                    critique_hdr = (request.headers.get("x-spockify-critique") or "").lower()
                    force_crit = critique_hdr in ("1", "true", "yes", "on")
                    if critique_mod.should_critique(answer, force=force_crit):
                        async with httpx.AsyncClient() as c2:
                            crit = await critique_mod.run_critique(
                                client=c2,
                                chat_fn=_worker_chat,
                                question=user_msg,
                                answer=answer,
                            )
                        yield _critique_sse(crit)
                except Exception as exc:
                    LOG.exception("stream failed: %s", exc)
                    yield _stream_error_sse(str(exc))

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    **_response_headers(worker, decision),
                },
            )

        if pipeline_active:
            final_text, pmeta = await _run_multi_model_pipeline(
                client,
                req=req,
                worker_messages=worker_messages,
                user_msg=user_msg,
                pipeline=pipeline,
            )
            result = {
                "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": SPOCKIFY_DISPLAY_MODEL,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": final_text}}],
                "selected_model_id": SPOCKIFY_DISPLAY_MODEL,
                "spockify_worker": str(pmeta.get("explain_model") or worker),
                "spockify_pipeline": pmeta,
            }
            if citation_sources:
                result["sources"] = citation_sources
            return JSONResponse(
                content=result,
                headers=_response_headers(worker, decision),
            )

        t0 = time.perf_counter()
        worker_kwargs: dict[str, Any] = {
            "temperature": call_temperature,
            "max_tokens": call_max_tokens,
        }
        if call_stop:
            worker_kwargs["stop"] = call_stop
        result = await _worker_chat(
            client,
            worker,
            worker_messages,
            **worker_kwargs,
        )
        fallback = _web_worker_fallback(worker)
        if fallback and _response_content_empty(result):
            LOG.warning(
                "worker %s returned empty body, falling back to %s", worker, fallback
            )
            result = await _worker_chat(
                client,
                fallback,
                worker_messages,
                **worker_kwargs,
            )
            worker = fallback
        if is_commit:
            try:
                raw_commit = str(result["choices"][0]["message"]["content"] or "")
            except (KeyError, IndexError, TypeError):
                raw_commit = ""
            sanitized = await _ensure_commit_message_content(
                client,
                worker=worker,
                raw=raw_commit,
                user_msg=user_msg,
            )
            if sanitized != raw_commit:
                LOG.info(
                    "commit-message sanitized chars=%d→%d",
                    len(raw_commit),
                    len(sanitized),
                )
            try:
                result["choices"][0]["message"]["content"] = sanitized
            except (KeyError, IndexError, TypeError):
                result["choices"] = [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": sanitized},
                    }
                ]
        latency_ms = int((time.perf_counter() - t0) * 1000)
        usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
        if not usage:
            try:
                ans = result["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError):
                ans = ""
            usage = {
                "prompt_tokens": _estimate_tokens_from_text(user_msg),
                "completion_tokens": _estimate_tokens_from_text(str(ans)),
                "estimated": True,
            }
            result["usage"] = usage
        hud = cost_hud.build_hud(
            worker=worker, latency_ms=latency_ms, usage=usage, model=worker
        )
        result["spockify_hud"] = hud
        critique_hdr = (request.headers.get("x-spockify-critique") or "").lower()
        force_crit = critique_hdr in ("1", "true", "yes", "on")
        try:
            ans_text = str(result["choices"][0]["message"]["content"] or "")
        except (KeyError, IndexError, TypeError):
            ans_text = ""
        if critique_mod.should_critique(ans_text, force=force_crit):
            result["spockify_critique"] = await critique_mod.run_critique(
                client=client,
                chat_fn=_worker_chat,
                question=user_msg,
                answer=ans_text,
            )
        result["model"] = SPOCKIFY_DISPLAY_MODEL
        result["selected_model_id"] = SPOCKIFY_DISPLAY_MODEL
        result["spockify_worker"] = worker
        if citation_sources:
            result["sources"] = citation_sources

        meta = {
            "orchestrator": ORCHESTRATOR_MODEL,
            "routing": decision.model_dump(),
            "worker_model": worker,
            "web_search_performed": decision.needs_web_search,
            "fast_mode": ROUTING_FAST_MODE,
            "thread_id": thread_id,
            "citation_count": len(citation_sources),
            "hud": hud,
        }
        if "spockify" not in result:
            result["spockify"] = meta
        else:
            result["spockify"].update(meta)
        return JSONResponse(
            content=result,
            headers=_response_headers(worker, decision, hud=hud),
        )


@app.post("/v1/images/generations")
@app.post("/images/generations")
async def images_generations(
    req: ImageGenerationRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """OpenAI-compatible image generation via ComfyUI FLUX.

    Authenticated with the same SPOCKIFY_API_KEY / LITELLM_MASTER_KEY as chat.
    Does not touch OpenWebUI's /api/v1/images path or IDE routes.
    """
    await _check_auth_api_key(authorization)
    try:
        return await image_gen.generate_images(
            prompt=req.prompt,
            size=req.size,
            n=req.n or 1,
            model=req.model,
            steps=req.steps,
        )
    except image_gen.ImageGenError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        LOG.exception("image generation failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Image generation failed: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=4100)
