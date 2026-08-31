"""Unit tests for context-aware spockify-auto routing."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock

import model_catalog
from main import (
    ChatMessage,
    CODER_SYSTEM_PROMPT,
    CODE_IMPLEMENTATION_PROMPT,
    COMMIT_MESSAGE_WORKER,
    DEFAULT_CHAT_WORKER,
    DEFAULT_WEB_WORKER,
    ROOM_CODER_WORKER,
    RoutingDecision,
    _apply_user_search_mode,
    _apply_voice_mode,
    _coder_worker_system_messages,
    _commit_message_route,
    _content_text,
    _context_aware_route,
    _explicit_search_intent,
    _finalize_routing,
    _gate_web_search,
    _gemma_thinking_disabled,
    _heuristic_route,
    _is_commit_message_request,
    _is_follow_up,
    _is_math_query,
    _is_pure_code_request,
    _is_topic_shift,
    _is_weather_lookup,
    _load_routing_rules,
    _needs_orchestrator,
    _normalize_ollama_ps,
    _ollama_chat_body,
    _ollama_sse_delta,
    _ollama_supports_thinking,
    _parse_routing,
    _read_meminfo_bytes,
    _resolve_routing,
    _resolve_worker_model,
    _response_headers,
    _sanitize_search_text,
    _search_mode_from_headers,
    _search_mode_from_messages,
    _to_ollama_model,
    _truncate_searx_query,
    _voice_mode_from_headers,
    _voice_mode_from_messages,
    _web_search_blocked,
    _web_search_header,
    _wants_code_implementation,
)


class FollowUpDetectionTests(unittest.TestCase):
    def test_follow_up_phrases(self) -> None:
        for phrase in (
            "Do it for me?",
            "do it",
            "implement that",
            "yes please",
            "go ahead",
            "please write it",
            "can you do it",
            "just do it",
        ):
            with self.subTest(phrase=phrase):
                self.assertTrue(_is_follow_up(phrase))

    def test_not_follow_up(self) -> None:
        self.assertFalse(
            _is_follow_up("How do I code the best tetris game ever?")
        )
        self.assertFalse(_is_follow_up("Hey there!"))

    def test_could_you_build_follow_up(self) -> None:
        self.assertTrue(_is_follow_up("Could you build it for me?"))

    def test_give_me_the_code_follow_up(self) -> None:
        self.assertTrue(_is_follow_up("Could you give me the code?"))
        self.assertTrue(_wants_code_implementation("give me the code"))


class WebSearchGatingTests(unittest.TestCase):
    def test_greeting_blocks_search(self) -> None:
        self.assertTrue(_web_search_blocked("Hey!"))
        decision = _heuristic_route("Hey!", None)
        assert decision is not None
        gated = _gate_web_search("Hey!", decision)
        self.assertFalse(gated.needs_web_search)

    def test_math_blocks_search(self) -> None:
        self.assertTrue(_web_search_blocked("10+10"))
        decision = _heuristic_route("10+10", None)
        assert decision is not None
        self.assertFalse(decision.needs_web_search)

    def test_weather_stockholm_tomorrow_searches(self) -> None:
        decision = _heuristic_route("Weather Stockholm tomorrow", None)
        assert decision is not None
        self.assertTrue(decision.needs_web_search)
        self.assertEqual(decision.selected_model, DEFAULT_WEB_WORKER)

    def test_response_headers(self) -> None:
        decision = RoutingDecision(
            selected_model=DEFAULT_WEB_WORKER,
            needs_web_search=True,
            routing_path="heuristic",
        )
        headers = _response_headers(DEFAULT_WEB_WORKER, decision)
        self.assertEqual(headers["X-Spockify-Web-Search"], "true")
        self.assertEqual(headers["X-Spockify-Worker"], DEFAULT_WEB_WORKER)

        no_search = decision.model_copy(update={"needs_web_search": False})
        self.assertEqual(
            _response_headers("llama3.2-3b", no_search)["X-Spockify-Web-Search"],
            "false",
        )

    def test_web_search_header_helper(self) -> None:
        self.assertEqual(_web_search_header(True), "true")
        self.assertEqual(_web_search_header(False), "false")


class UserSearchModeTests(unittest.TestCase):
    def test_off_disables_search(self) -> None:
        decision = RoutingDecision(
            selected_model=DEFAULT_WEB_WORKER,
            needs_web_search=True,
            task_type="web_search",
            search_query="weather Stockholm",
            confidence=0.9,
            reasoning="weather",
            routing_path="heuristic",
        )
        gated = _apply_user_search_mode(
            "What's the weather in Stockholm?", decision, "off"
        )
        self.assertFalse(gated.needs_web_search)
        self.assertIsNone(gated.search_query)
        self.assertFalse(gated.selected_model.startswith("web-"))

    def test_on_forces_search(self) -> None:
        decision = RoutingDecision(
            selected_model="llama3.2-3b",
            needs_web_search=False,
            task_type="general",
            confidence=0.5,
            reasoning="chitchat",
            routing_path="heuristic",
        )
        gated = _apply_user_search_mode(
            "What's the weather in Stockholm tomorrow?", decision, "on"
        )
        self.assertTrue(gated.needs_web_search)
        self.assertEqual(gated.task_type, "web_search")

    def test_on_still_blocks_math(self) -> None:
        decision = RoutingDecision(
            selected_model="llama3.2-3b",
            needs_web_search=False,
            task_type="math",
            confidence=0.95,
            reasoning="math",
            routing_path="math",
        )
        gated = _apply_user_search_mode("10+10", decision, "on")
        self.assertFalse(gated.needs_web_search)

    def test_auto_unchanged(self) -> None:
        decision = RoutingDecision(
            selected_model=DEFAULT_WEB_WORKER,
            needs_web_search=True,
            task_type="web_search",
            confidence=0.9,
            reasoning="weather",
            routing_path="heuristic",
        )
        gated = _apply_user_search_mode(
            "What's the weather in Stockholm?", decision, "auto"
        )
        self.assertTrue(gated.needs_web_search)
        self.assertEqual(gated.selected_model, DEFAULT_WEB_WORKER)

    def test_marker_extraction_and_strip(self) -> None:
        messages = [
            ChatMessage(role="system", content="[spockify_search_mode:off]"),
            ChatMessage(role="user", content="Weather in Oslo?"),
        ]
        mode, cleaned = _search_mode_from_messages(messages)
        self.assertEqual(mode, "off")
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0].role, "user")
        self.assertEqual(_content_text(cleaned[0].content), "Weather in Oslo?")

    def test_header_helper(self) -> None:
        self.assertEqual(
            _search_mode_from_headers({"X-Spockify-Search-Mode": "ON"}), "on"
        )
        self.assertEqual(
            _search_mode_from_headers({"x-spockify-search-mode": "off"}), "off"
        )
        self.assertIsNone(_search_mode_from_headers({}))

    def test_citation_annotation_sse_shape(self) -> None:
        from main import _citation_annotation_sse, _citation_sources_from_results
        import json

        sources = _citation_sources_from_results(
            [{"title": "SMHI", "url": "https://www.smhi.se/", "content": "forecast"}]
        )
        raw = _citation_annotation_sse(sources)
        self.assertTrue(raw.startswith(b"data:"))
        payload = json.loads(raw[5:].strip())
        ann = payload["choices"][0]["delta"]["annotations"]
        self.assertEqual(ann[0]["type"], "url_citation")
        self.assertEqual(ann[0]["url_citation"]["url"], "https://www.smhi.se/")
        self.assertEqual(_citation_annotation_sse([]), b"")

    def test_github_docs_fast_path_search(self) -> None:
        query = "Check the documentation of requests on GitHub"
        self.assertTrue(_explicit_search_intent(query))
        decision = _heuristic_route(query, None)
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertTrue(decision.needs_web_search)
        self.assertEqual(decision.selected_model, DEFAULT_WEB_WORKER)
        gated = _gate_web_search(query, decision)
        self.assertTrue(gated.needs_web_search)

    def test_fibonacci_no_search(self) -> None:
        query = "write fibonacci in python"
        self.assertTrue(_is_pure_code_request(query))
        decision = _heuristic_route(query, None)
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")
        self.assertFalse(decision.needs_web_search)
        gated = _gate_web_search(query, decision)
        self.assertFalse(gated.needs_web_search)

    def test_weather_fast_path_search(self) -> None:
        query = "What's the weather in Stockholm?"
        decision = _heuristic_route(query, None)
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertTrue(decision.needs_web_search)
        self.assertEqual(decision.selected_model, DEFAULT_WEB_WORKER)

    def test_orchestrator_search_decision_trusted(self) -> None:
        query = "Explain the asyncio timeout API changes"
        decision = RoutingDecision(
            selected_model="web-gemma",
            needs_web_search=True,
            search_query="asyncio timeout API changes",
            confidence=0.55,
            routing_path="orchestrator",
        )
        gated = _gate_web_search(query, decision)
        self.assertTrue(gated.needs_web_search)
        self.assertEqual(gated.search_query, "asyncio timeout API changes")

    def test_orchestrator_no_search_for_fibonacci(self) -> None:
        query = "write fibonacci in python"
        raw = (
            '{"worker": "codestral", "needs_web_search": false, '
            '"task_type": "code_generation", "confidence": 0.9}'
        )
        decision = _parse_routing(raw)
        gated = _gate_web_search(query, decision)
        self.assertFalse(gated.needs_web_search)

    def test_ambiguous_routes_to_orchestrator(self) -> None:
        query = "Explain how httpx timeouts work"
        msgs = [ChatMessage(role="user", content=query)]
        self.assertFalse(_is_pure_code_request(query))
        self.assertFalse(_explicit_search_intent(query))
        self.assertTrue(_needs_orchestrator(query, msgs, None))


class TetrisConversationTests(unittest.TestCase):
    def _tetris_thread(self, latest: str) -> list[ChatMessage]:
        return [
            ChatMessage(role="user", content="Hey there!"),
            ChatMessage(role="assistant", content="Hello! How can I help?"),
            ChatMessage(role="user", content="How are you?"),
            ChatMessage(
                role="assistant",
                content="I'm doing well, thanks for asking.",
            ),
            ChatMessage(
                role="user",
                content="How do I code the best tetris game ever?",
            ),
            ChatMessage(
                role="assistant",
                content=(
                    "Start with a grid, piece shapes, collision detection, "
                    "and line clears."
                ),
            ),
            ChatMessage(role="user", content=latest),
        ]

    def test_coding_question_routes_codestral(self) -> None:
        content = "How do I code the best tetris game ever?"
        msgs = self._tetris_thread(content)[:-1]
        msgs.append(ChatMessage(role="user", content=content))
        decision = _heuristic_route(msgs[-1].content, msgs)
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")
        self.assertEqual(decision.task_type, "code_generation")

    def test_do_it_for_me_inherits_codestral(self) -> None:
        msgs = self._tetris_thread("Do it for me?")
        decision = _context_aware_route(msgs, "Do it for me?")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")
        self.assertEqual(decision.routing_path, "context_follow_up")
        self.assertIn("follow-up", decision.reasoning)

    def test_could_you_build_inherits_codestral(self) -> None:
        msgs = self._tetris_thread("Could you build it for me?")
        decision = _context_aware_route(msgs, "Could you build it for me?")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")

    def test_give_me_the_code_inherits_codestral(self) -> None:
        msgs = self._tetris_thread("Could you give me the code?")
        decision = _context_aware_route(msgs, "Could you give me the code?")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")

    def test_heuristic_skips_casual_for_coding_follow_up(self) -> None:
        msgs = self._tetris_thread("Do it for me?")
        decision = _heuristic_route("Do it for me?", msgs)
        self.assertIsNone(decision)

    def test_casual_greeting_stays_casual(self) -> None:
        from main import FAST_CHAT_WORKER

        msgs = [ChatMessage(role="user", content="Hey!")]
        decision = _heuristic_route("Hey!", msgs)
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, FAST_CHAT_WORKER)
        self.assertFalse(decision.needs_web_search)

    def test_weather_routes_web_search(self) -> None:
        decision = _heuristic_route("weather in Stockholm", None)
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, DEFAULT_WEB_WORKER)
        self.assertTrue(decision.needs_web_search)
        self.assertEqual(decision.task_type, "web_search")

    def test_thanks_after_coding_stays_acknowledgment_path(self) -> None:
        msgs = self._tetris_thread("Thanks!")
        decision = _context_aware_route(msgs, "Thanks!")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertNotEqual(decision.selected_model, "codestral")
        self.assertEqual(decision.task_type, "casual_chat")
        self.assertFalse(decision.needs_web_search)

    def test_swedish_ack_after_history_not_codestral(self) -> None:
        """'Spännande!' must not sticky-route to coding via keyword false positives."""
        from main import (
            _is_acknowledgment,
            _infer_domain_from_context,
            _thread_plan_get,
            _thread_plan_put,
            RoutingDecision as RD,
        )

        self.assertTrue(_is_acknowledgment("Spännande!"))
        self.assertTrue(_is_acknowledgment("Intressant"))
        prior = [
            ChatMessage(role="user", content="What happened with the Berlin Wall?"),
            ChatMessage(
                role="assistant",
                content=(
                    "Many things happened in 1989. It was a classic cold war symbol "
                    "and a turning point for Europe."
                ),
            ),
        ]
        self.assertIsNone(_infer_domain_from_context(prior))
        msgs = prior + [ChatMessage(role="user", content="Spännande!")]
        decision = _context_aware_route(msgs, "Spännande!")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertNotEqual(decision.selected_model, "codestral")
        self.assertEqual(decision.task_type, "casual_chat")

        _thread_plan_put(
            "berlin-chat",
            RD(
                selected_model="codestral",
                task_type="code_generation",
                confidence=0.9,
                routing_path="heuristic",
            ),
        )
        self.assertIsNone(
            _thread_plan_get("berlin-chat", "Spännande!", msgs)
        )

    def test_coding_thread_still_stickies_on_do_it(self) -> None:
        from main import _thread_plan_get, _thread_plan_put, RoutingDecision as RD

        msgs = self._tetris_thread("Do it for me?")
        _thread_plan_put(
            "tetris-chat",
            RD(
                selected_model="codestral",
                task_type="code_generation",
                confidence=0.9,
                routing_path="heuristic",
            ),
        )
        inherited = _thread_plan_get("tetris-chat", "Do it for me?", msgs)
        self.assertIsNotNone(inherited)
        assert inherited is not None
        self.assertEqual(inherited.selected_model, "codestral")


class CoderWorkerPromptTests(unittest.TestCase):
    def test_codestral_maps_to_spockify_coder(self) -> None:
        self.assertEqual(_to_ollama_model("codestral"), "spockify-coder")
        self.assertEqual(_to_ollama_model("web-codestral"), "spockify-coder")

    def test_gpt_oss_keeps_family_hyphen(self) -> None:
        # Full replace("-", ":") incorrectly yields gpt:oss:20b (Ollama 400).
        self.assertEqual(_to_ollama_model("gpt-oss-20b"), "gpt-oss:20b")
        self.assertEqual(_to_ollama_model("gpt-oss-120b"), "gpt-oss:120b")

    def test_single_hyphen_tag_still_maps(self) -> None:
        self.assertEqual(_to_ollama_model("llama3.2-3b"), "llama3.2:3b")
        self.assertEqual(_to_ollama_model("gemma4-12b"), "gemma4:12b")
        self.assertEqual(_to_ollama_model("gemma4-31b"), "gemma4:31b")
        self.assertEqual(_to_ollama_model("qwen3.5-9b"), "qwen3.5:9b")
        self.assertEqual(_to_ollama_model("qwen3.6-27b"), "qwen3.6:27b")
        self.assertEqual(_to_ollama_model("qwen3.6-35b"), "qwen3.6:35b")
        self.assertEqual(
            _to_ollama_model("qwen3.6-coder-27b"), "qwen3.6:27b-coding"
        )
        self.assertEqual(_to_ollama_model("magistral"), "magistral")
        self.assertEqual(_to_ollama_model("devstral-small-2"), "devstral-small-2")
        self.assertEqual(_to_ollama_model("ministral-3-14b"), "ministral-3:14b")

    def test_coder_system_prompt_on_code_worker(self) -> None:
        msgs = _coder_worker_system_messages("codestral", "Do it for me?")
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0]["content"], CODER_SYSTEM_PROMPT)
        self.assertEqual(msgs[1]["content"], CODE_IMPLEMENTATION_PROMPT)

    def test_coder_system_prompt_skips_chat_worker(self) -> None:
        self.assertEqual(_coder_worker_system_messages("llama3.2-3b", "Do it"), [])


class ResolveRoutingIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_tetris_follow_up_end_to_end(self) -> None:
        msgs = [
            ChatMessage(role="user", content="Hey there!"),
            ChatMessage(role="assistant", content="Hello!"),
            ChatMessage(role="user", content="How are you?"),
            ChatMessage(role="assistant", content="Great!"),
            ChatMessage(
                role="user",
                content="How do I code the best tetris game ever?",
            ),
            ChatMessage(role="assistant", content="Use a grid and tetrominoes."),
            ChatMessage(role="user", content="Do it for me?"),
        ]
        rules = _load_routing_rules()
        client = AsyncMock()
        decision = await _resolve_routing(
            client, "Do it for me?", rules, msgs
        )
        self.assertEqual(decision.selected_model, "codestral")
        self.assertIn("context", decision.routing_path)
        client.post.assert_not_called()


class WeatherThreadTests(unittest.TestCase):
    def _weather_thread(self, latest: str) -> list[ChatMessage]:
        return [
            ChatMessage(role="user", content="What's the weather in London?"),
            ChatMessage(
                role="assistant",
                content="London today: 14°C, partly cloudy, light rain later.",
            ),
            ChatMessage(role="user", content=latest),
        ]

    def test_weather_follow_up_stays_web_gemma(self) -> None:
        for follow_up in ("For Stockholm?", "max rain tomorrow?", "what about tomorrow?"):
            with self.subTest(follow_up=follow_up):
                msgs = self._weather_thread(follow_up)
                decision = _context_aware_route(msgs, follow_up)
                self.assertIsNotNone(decision)
                assert decision is not None
                self.assertEqual(decision.selected_model, DEFAULT_WEB_WORKER)
                self.assertTrue(decision.needs_web_search)
                self.assertIn("sticky", decision.routing_path)

    def test_math_after_weather_is_topic_shift(self) -> None:
        msgs = self._weather_thread("What's 10 + 10?")
        self.assertTrue(_is_topic_shift("What's 10 + 10?", msgs[:-1]))
        decision = _context_aware_route(msgs, "What's 10 + 10?")
        self.assertIsNone(decision)

    def test_math_routes_without_web_search(self) -> None:
        decision = _heuristic_route("What's 10 + 10?", None)
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "llama3.2-3b")
        self.assertFalse(decision.needs_web_search)
        gated = _gate_web_search("What's 10 + 10?", decision)
        self.assertFalse(gated.needs_web_search)

    def test_web_gemma_stays_web_gemma_when_searching(self) -> None:
        decision = RoutingDecision(
            selected_model="web-gemma",
            needs_web_search=True,
            task_type="web_search",
        )
        self.assertEqual(_resolve_worker_model(decision), "web-gemma")

    def test_general_search_defaults_to_web_gemma(self) -> None:
        decision = RoutingDecision(
            selected_model="gemma4-12b",
            needs_web_search=True,
            task_type="general",
        )
        self.assertEqual(_resolve_worker_model(decision), DEFAULT_WEB_WORKER)


class WeatherGroundingTests(unittest.TestCase):
    def test_format_temp_includes_correct_fahrenheit(self) -> None:
        from main import _c_to_f, _format_temp_c

        self.assertAlmostEqual(_c_to_f(18.0), 64.4, places=4)
        formatted = _format_temp_c(18.0)
        self.assertIn("18.0°C", formatted)
        self.assertIn("64.4°F", formatted)
        self.assertNotIn("18.0°F", formatted)

    def test_la_temperature_query_resolves_los_angeles(self) -> None:
        from main import (
            _extract_target_location,
            _wants_current_weather_data,
            _weather_place_from_text,
        )

        query = "What's the temperature in LA?"
        msgs = [ChatMessage(role="user", content=query)]
        self.assertEqual(_weather_place_from_text(query), "LA")
        loc = _extract_target_location(msgs, query)
        assert loc is not None
        self.assertEqual(loc["city"], "Los Angeles")
        self.assertTrue(_wants_current_weather_data(query, msgs))

    def test_los_angeles_temperature_query_resolves(self) -> None:
        from main import _extract_target_location, _wants_current_weather_data

        query = "What's the temperature in Los Angeles?"
        msgs = [ChatMessage(role="user", content=query)]
        loc = _extract_target_location(msgs, query)
        assert loc is not None
        self.assertEqual(loc["city"], "Los Angeles")
        self.assertTrue(_wants_current_weather_data(query, msgs))

    def test_bare_la_without_weather_is_not_a_city(self) -> None:
        from main import _extract_target_location, _resolve_location_candidate

        self.assertIsNone(_resolve_location_candidate("LA", context="see la table"))
        loc = _extract_target_location(
            [ChatMessage(role="user", content="see LA")],
            "see LA",
        )
        self.assertIsNone(loc)

    def test_weather_suffix_forbids_unit_invention(self) -> None:
        from main import (
            WEB_SEARCH_CURRENT_WEATHER_SUFFIX,
            WEB_SEARCH_VOICE_WEATHER_SUFFIX,
            WEB_SEARCH_WEATHER_SUFFIX,
        )

        for suffix in (
            WEB_SEARCH_CURRENT_WEATHER_SUFFIX,
            WEB_SEARCH_WEATHER_SUFFIX,
            WEB_SEARCH_VOICE_WEATHER_SUFFIX,
        ):
            lowered = suffix.lower()
            self.assertTrue(
                "convert" in lowered or "conversions" in lowered,
                suffix,
            )


class WeatherApiEnrichmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_fahrenheit_snippets_still_fetch_open_meteo(self) -> None:
        from unittest.mock import MagicMock

        from main import _enrich_weather_search_if_needed

        query = "What's the temperature in LA?"
        msgs = [ChatMessage(role="user", content=query)]
        results = [
            {
                "title": "LA weather",
                "url": "https://weather.com/los-angeles",
                "content": "Currently 64°F in Los Angeles",
            }
        ]
        current_payload = {
            "current": {
                "temperature_2m": 18.0,
                "weather_code": 1,
                "time": "2026-08-14T03:00",
            }
        }
        daily_payload = {
            "daily": {
                "temperature_2m_max": [24.0],
                "temperature_2m_min": [16.0],
                "weathercode": [1],
                "time": ["2026-08-14"],
            }
        }

        async def fake_get(url, **_kwargs):
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            if "current=temperature_2m" in str(url):
                resp.json.return_value = current_payload
            else:
                resp.json.return_value = daily_payload
            return resp

        client = AsyncMock()
        client.get = fake_get
        _, extra = await _enrich_weather_search_if_needed(
            client, results, [query], msgs, query
        )
        joined = "\n".join(extra)
        self.assertIn("18.0°C", joined)
        self.assertIn("64.4°F", joined)
        self.assertIn("open-meteo", joined.lower())
        self.assertNotIn("18.0°F", joined)


class SearchSanitizationTests(unittest.TestCase):
    def test_strips_weather_template_markers(self) -> None:
        raw = "High {{high}}°C low {{low}} with rain"
        cleaned = _sanitize_search_text(raw)
        self.assertNotIn("{{", cleaned)
        self.assertNotIn("}}", cleaned)
        self.assertIn("rain", cleaned)


class GemmaThinkingTests(unittest.TestCase):
    def test_ollama_supports_thinking_families(self) -> None:
        self.assertTrue(_ollama_supports_thinking("gemma4-12b"))
        self.assertTrue(_ollama_supports_thinking("gemma4-26b"))
        self.assertTrue(_ollama_supports_thinking("gemma4-31b"))
        self.assertTrue(_ollama_supports_thinking("web-gemma"))
        self.assertTrue(_ollama_supports_thinking("gpt-oss-20b"))
        self.assertTrue(_ollama_supports_thinking("gpt-oss-120b"))
        self.assertTrue(_ollama_supports_thinking("nemotron-nano-4b"))
        self.assertTrue(_ollama_supports_thinking("nemotron-3-nano"))
        self.assertTrue(_ollama_supports_thinking("nemotron-nano-30b"))
        self.assertTrue(_ollama_supports_thinking("qwen3.5-9b"))
        self.assertTrue(_ollama_supports_thinking("qwen3.6-27b"))
        self.assertTrue(_ollama_supports_thinking("qwen3.6-35b"))
        self.assertTrue(_ollama_supports_thinking("qwen3.6-coder-27b"))
        self.assertFalse(_ollama_supports_thinking("llama3.2-3b"))
        self.assertFalse(_ollama_supports_thinking("llama3.1-8b"))
        self.assertFalse(_ollama_supports_thinking("llama3.3-70b"))
        self.assertFalse(_ollama_supports_thinking("codestral"))
        self.assertFalse(_ollama_supports_thinking("web-llama"))
        self.assertFalse(_ollama_supports_thinking("web-codestral"))
        self.assertTrue(_ollama_supports_thinking("magistral"))
        self.assertFalse(_ollama_supports_thinking("devstral-small-2"))
        self.assertFalse(_ollama_supports_thinking("ministral-3-14b"))

    def test_gemma_models_disable_thinking(self) -> None:
        self.assertTrue(_gemma_thinking_disabled("web-gemma"))
        self.assertTrue(_gemma_thinking_disabled("gemma4-12b"))
        self.assertFalse(_gemma_thinking_disabled("web-llama"))
        self.assertFalse(_gemma_thinking_disabled("codestral"))

    def test_ollama_chat_body_think_true_overrides_gemma_default(self) -> None:
        body = _ollama_chat_body(
            "gemma4-12b",
            [{"role": "user", "content": "hi"}],
            stream=True,
            think=True,
        )
        self.assertEqual(body["think"], "medium")

    def test_ollama_chat_body_think_true_for_gpt_oss(self) -> None:
        body = _ollama_chat_body(
            "gpt-oss-20b",
            [{"role": "user", "content": "hi"}],
            stream=True,
            think=True,
        )
        self.assertEqual(body["think"], "medium")
        body_120b = _ollama_chat_body(
            "gpt-oss-120b",
            [{"role": "user", "content": "hi"}],
            stream=True,
            think=True,
        )
        self.assertEqual(body_120b["think"], "medium")

    def test_ollama_chat_body_gpt_oss_high_sends_string_high(self) -> None:
        body = _ollama_chat_body(
            "gpt-oss-20b",
            [{"role": "user", "content": "hi"}],
            stream=True,
            think="high",
        )
        self.assertEqual(body["think"], "high")
        body_120b = _ollama_chat_body(
            "gpt-oss-120b",
            [{"role": "user", "content": "design a lock-free queue"}],
            stream=True,
            think="high",
        )
        self.assertEqual(body_120b["think"], "high")

    def test_ollama_chat_body_llama_never_gets_think(self) -> None:
        for mode in (True, False, "low", "high", "heavy"):
            body = _ollama_chat_body(
                "llama3.2-3b",
                [{"role": "user", "content": "hi"}],
                stream=True,
                think=mode,
            )
            self.assertNotIn("think", body, mode)
            body_8b = _ollama_chat_body(
                "llama3.1-8b",
                [{"role": "user", "content": "hi"}],
                stream=True,
                think=mode,
            )
            self.assertNotIn("think", body_8b, mode)

    def test_ollama_chat_body_think_true_for_nemotron(self) -> None:
        body = _ollama_chat_body(
            "nemotron-nano-4b",
            [{"role": "user", "content": "hi"}],
            stream=True,
            think=True,
        )
        self.assertEqual(body["think"], "medium")

    def test_ollama_chat_body_think_true_for_qwen(self) -> None:
        for model in ("qwen3.5-9b", "qwen3.6-27b", "qwen3.6-35b"):
            body = _ollama_chat_body(
                model,
                [{"role": "user", "content": "hi"}],
                stream=True,
                think=True,
            )
            self.assertEqual(body["think"], "medium", model)

    def test_ollama_chat_body_think_true_omitted_for_llama(self) -> None:
        body = _ollama_chat_body(
            "llama3.2-3b",
            [{"role": "user", "content": "hi"}],
            stream=True,
            think=True,
        )
        self.assertNotIn("think", body)

    def test_ollama_chat_body_think_true_omitted_for_codestral(self) -> None:
        body = _ollama_chat_body(
            "codestral",
            [{"role": "user", "content": "hi"}],
            stream=True,
            think=True,
        )
        self.assertNotIn("think", body)

    def test_ollama_chat_body_think_false_for_gemma_default(self) -> None:
        body = _ollama_chat_body(
            "gemma4-12b",
            [{"role": "user", "content": "hi"}],
            stream=True,
        )
        self.assertFalse(body["think"])

    def test_ollama_sse_delta_forwards_thinking_as_reasoning_content(self) -> None:
        delta = _ollama_sse_delta(
            {"role": "assistant", "content": "", "thinking": "Let me think."},
            first=True,
        )
        self.assertEqual(delta.get("reasoning_content"), "Let me think.")
        self.assertNotIn("content", delta)
        self.assertEqual(delta.get("role"), "assistant")

    def test_ollama_sse_delta_keeps_content_and_thinking(self) -> None:
        delta = _ollama_sse_delta(
            {"content": "Hello", "thinking": "short thought"},
            first=False,
        )
        self.assertEqual(delta["content"], "Hello")
        self.assertEqual(delta["reasoning_content"], "short thought")
        self.assertNotIn("role", delta)


class MathDetectionTests(unittest.TestCase):
    def test_math_queries(self) -> None:
        for q in ("What's 10 + 10?", "10 + 10", "how much is 5 * 3?"):
            with self.subTest(q=q):
                self.assertTrue(_is_math_query(q))

    def test_not_math(self) -> None:
        self.assertFalse(_is_math_query("What's the weather in London?"))
        self.assertFalse(_is_math_query("For Stockholm?"))

    def test_code_diff_with_arithmetic_not_math(self) -> None:
        diff = (
            "Diff scope: staged changes (index).\n\n"
            "Diff:\n```diff\n"
            "+++ b/foo.py\n"
            "+    temp = 1 + 2 * 3\n"
            "```\n\n"
            "Write the commit message now."
        )
        self.assertFalse(_is_math_query(diff))


class CommitMessageRoutingTests(unittest.IsolatedAsyncioTestCase):
    def _commit_payload(self, diff_body: str) -> tuple[str, list[ChatMessage]]:
        system = (
            "You write git commit messages in Conventional Commits style. "
            "Output ONLY the commit message."
        )
        user = (
            "Diff scope: staged changes (index).\n\n"
            f"Diff:\n```diff\n{diff_body}\n```\n\n"
            "Write the commit message now."
        )
        messages = [
            ChatMessage(role="system", content=system),
            ChatMessage(role="user", content=user),
        ]
        return user, messages

    def test_detects_ide_commit_prompt(self) -> None:
        user, messages = self._commit_payload("+ print(1)\n")
        self.assertTrue(_is_commit_message_request(user, messages))
        self.assertTrue(_web_search_blocked(user))

    def test_temp_in_diff_is_not_weather(self) -> None:
        user, messages = self._commit_payload(
            "+++ b/foo.py\n+    temp = 1\n+    template = 'x'\n"
        )
        self.assertFalse(_is_weather_lookup(user, messages))

    def test_heuristic_commit_message_no_search(self) -> None:
        user, messages = self._commit_payload(
            "+++ b/main.py\n+    temp = 1 + 2\n+    # weather helper\n"
            + ("+ filler\n" * 500)
        )
        decision = _heuristic_route(user, messages)
        assert decision is not None
        self.assertEqual(decision.task_type, "commit_message")
        self.assertFalse(decision.needs_web_search)
        self.assertEqual(decision.selected_model, COMMIT_MESSAGE_WORKER)

    async def test_resolve_large_diff_does_not_web_search(self) -> None:
        # Regression: previously math+weather false positives sent the whole
        # diff as a SearXNG ?q= and httpx raised URL component 'query' too long.
        diff = (
            "+++ b/services/router/main.py\n"
            "+ def attempt_retry():\n"
            "+     temp = 1 + 2 * 3\n"
            "+     # weather forecast temperature template\n"
            + ("+     x = 1\n" * 3000)
        )
        user, messages = self._commit_payload(diff)
        rules = _load_routing_rules()
        client = AsyncMock()
        decision = await _resolve_routing(client, user, rules, messages)
        self.assertEqual(decision.task_type, "commit_message")
        self.assertFalse(decision.needs_web_search)
        self.assertFalse(decision.selected_model.startswith("web-"))
        self.assertIn("commit", decision.routing_path)
        client.post.assert_not_called()

    def test_finalize_strips_web_from_commit_payload(self) -> None:
        user, messages = self._commit_payload("+ hello\n")
        bad = RoutingDecision(
            selected_model=DEFAULT_WEB_WORKER,
            task_type="web_search",
            needs_web_search=True,
            search_query=user,
            confidence=0.9,
            routing_path="pattern_math_weather",
        )
        fixed = _finalize_routing(user, messages, bad)
        self.assertFalse(fixed.needs_web_search)
        self.assertIsNone(fixed.search_query)
        self.assertEqual(fixed.task_type, "commit_message")
        self.assertEqual(fixed.selected_model, COMMIT_MESSAGE_WORKER)
        self.assertIn("Conventional Commits", fixed.prompt_additions)

    def test_commit_route_has_system_addon(self) -> None:
        decision = _commit_message_route()
        self.assertEqual(decision.task_type, "commit_message")
        self.assertEqual(decision.selected_model, COMMIT_MESSAGE_WORKER)
        self.assertIn("laundry-list", decision.prompt_additions.lower())
        self.assertIn("Conventional Commits", decision.prompt_additions)
        self.assertIn("GOOD examples", decision.prompt_additions)

    async def test_build_worker_messages_skips_persona_for_commit(self) -> None:
        from main import (
            COMMIT_MESSAGE_SYSTEM_PROMPT,
            ChatCompletionRequest,
            SPOCKIFY_PERSONA_PROMPT,
            _build_worker_messages,
        )

        user, messages = self._commit_payload("+ print(1)\n")
        req = ChatCompletionRequest(
            model="spockify-auto",
            messages=messages,
        )
        client = AsyncMock()
        built, sources = await _build_worker_messages(
            client,
            req,
            _commit_message_route(),
            user,
            COMMIT_MESSAGE_WORKER,
        )
        self.assertEqual(sources, [])
        system_texts = [m["content"] for m in built if m.get("role") == "system"]
        self.assertEqual(len(system_texts), 1)
        self.assertTrue(
            any(COMMIT_MESSAGE_SYSTEM_PROMPT[:40] in t for t in system_texts)
        )
        self.assertFalse(any(SPOCKIFY_PERSONA_PROMPT[:40] in t for t in system_texts))
        # Client system prompt must not be forwarded (dilutes instructions).
        self.assertFalse(
            any("Conventional Commits style" in t for t in system_texts)
        )
        client.post.assert_not_called()

    def test_clean_commit_message_rewrites_laundry_list(self) -> None:
        from main import (
            _clean_commit_message,
            _is_valid_conventional_commit,
            _looks_like_commit_narration,
        )

        raw = (
            "We need to craft a commit message summarizing the change. "
            "The diff includes many updates:\n\n"
            "- Bump version from 0.9.3 to 0.9.4 across product overlay.\n"
            "- Update generateCommitMessage.ts max_tokens reduction.\n"
            "- Extend COMMIT_MESSAGE_SYSTEM constant with more detailed instructions.\n"
        )
        self.assertTrue(_looks_like_commit_narration(raw))
        cleaned = _clean_commit_message(raw)
        self.assertTrue(_is_valid_conventional_commit(cleaned))
        self.assertNotIn("We need to craft", cleaned)
        self.assertFalse(cleaned.lstrip().startswith("-"))
        self.assertRegex(
            cleaned.splitlines()[0],
            r"^(feat|fix|refactor|docs|test|chore|perf|build|ci|style)"
            r"(\([^)]+\))?!?:\s+\S",
        )

    def test_clean_commit_message_keeps_good_subject(self) -> None:
        from main import _clean_commit_message, _is_valid_conventional_commit

        good = "chore: tighten generate-commit-message prompts"
        self.assertEqual(_clean_commit_message(good), good)
        self.assertTrue(_is_valid_conventional_commit(good))

    def test_truncate_searx_query(self) -> None:
        long_q = "x" * 2000
        truncated = _truncate_searx_query(long_q, limit=50)
        self.assertLessEqual(len(truncated), 50)
        self.assertTrue(truncated.endswith("…"))


class WeatherThreadIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_weather_then_math_end_to_end(self) -> None:
        weather_msgs = [
            ChatMessage(role="user", content="What's the weather in London?"),
            ChatMessage(role="assistant", content="14°C, cloudy."),
            ChatMessage(role="user", content="For Stockholm?"),
        ]
        rules = _load_routing_rules()
        client = AsyncMock()
        weather_decision = await _resolve_routing(
            client, "For Stockholm?", rules, weather_msgs
        )
        self.assertEqual(weather_decision.selected_model, DEFAULT_WEB_WORKER)
        self.assertTrue(weather_decision.needs_web_search)
        self.assertIn("sticky", weather_decision.routing_path)

        math_msgs = weather_msgs + [
            ChatMessage(role="assistant", content="Stockholm: 8°C, rain."),
            ChatMessage(role="user", content="What's 10 + 10?"),
        ]
        math_decision = await _resolve_routing(
            client, "What's 10 + 10?", rules, math_msgs
        )
        self.assertEqual(math_decision.selected_model, "llama3.2-3b")
        self.assertFalse(math_decision.needs_web_search)
        self.assertNotEqual(math_decision.routing_path, "context_sticky_weather")
        client.post.assert_not_called()


class VisionRoutingTests(unittest.IsolatedAsyncioTestCase):
    def test_content_text_from_multimodal(self) -> None:
        from main import _content_text

        content = [
            {"type": "text", "text": "What does it say in this image?"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
        ]
        self.assertEqual(_content_text(content), "What does it say in this image?")

    def test_messages_have_images(self) -> None:
        from main import _messages_have_images

        self.assertFalse(
            _messages_have_images([ChatMessage(role="user", content="hello")])
        )
        self.assertTrue(
            _messages_have_images(
                [
                    ChatMessage(
                        role="user",
                        content=[
                            {"type": "text", "text": "What does it say?"},
                            {
                                "type": "image_url",
                                "image_url": {"url": "data:image/png;base64,abc"},
                            },
                        ],
                    )
                ]
            )
        )

    def test_vision_route_selects_gemma4_26b(self) -> None:
        from main import _resolve_worker_model, _to_ollama_model, _vision_route

        decision = _vision_route()
        self.assertEqual(decision.selected_model, "gemma4-26b")
        self.assertEqual(decision.routing_path, "vision")
        self.assertFalse(decision.needs_web_search)
        self.assertEqual(_resolve_worker_model(decision), "gemma4-26b")
        self.assertEqual(_to_ollama_model(decision.selected_model), "gemma4:26b")

    def test_trim_vision_messages_keeps_latest_image(self) -> None:
        from main import _message_has_images_api, _trim_vision_messages

        msgs = [
            {"role": "system", "content": "You are Spockify."},
            {"role": "user", "content": "earlier question " + ("x" * 500)},
            {"role": "assistant", "content": "earlier answer " + ("y" * 500)},
            {"role": "user", "content": "more history"},
            {"role": "assistant", "content": "more reply"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "what is this?"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png;base64,abc"},
                    },
                ],
            },
        ]
        out = _trim_vision_messages(msgs, max_history=4)
        self.assertEqual(out[0]["role"], "system")
        self.assertTrue(any(_message_has_images_api(m) for m in out))
        # Older text turns may remain, but total nonsystem capped.
        nonsystem = [m for m in out if m.get("role") != "system"]
        self.assertLessEqual(len(nonsystem), 4)
        self.assertIn("what is this?", str(nonsystem[-1].get("content")))

    def test_trim_vision_aggressive_keeps_one_user(self) -> None:
        from main import _trim_vision_messages

        msgs = [
            {"role": "system", "content": "persona"},
            {"role": "system", "content": "extra"},
            {"role": "user", "content": "old"},
            {"role": "assistant", "content": "old reply"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png;base64,abc"},
                    },
                ],
            },
        ]
        out = _trim_vision_messages(msgs, aggressive=True)
        nonsystem = [m for m in out if m.get("role") != "system"]
        self.assertEqual(len(nonsystem), 1)
        self.assertEqual(len([m for m in out if m.get("role") == "system"]), 1)

    def test_ollama_options_includes_num_ctx(self) -> None:
        from main import _ollama_options, _vision_chat_kwargs

        opts = _ollama_options(num_ctx=8192, temperature=0.2)
        self.assertEqual(opts["num_ctx"], 8192)
        self.assertEqual(opts["temperature"], 0.2)
        vk = _vision_chat_kwargs("gemma4-26b", temperature=0.1)
        self.assertEqual(vk["num_ctx"], 16384)
        self.assertEqual(vk["temperature"], 0.1)
        vk_llava = _vision_chat_kwargs("llava-llama3", temperature=0.1)
        self.assertEqual(vk_llava["num_ctx"], 16384)

    def test_is_exceed_context_error(self) -> None:
        from main import _is_exceed_context_error

        self.assertTrue(
            _is_exceed_context_error(
                Exception(
                    "request (5437 tokens) exceeds available context size "
                    "(4096 tokens) exceed_context_size_error"
                )
            )
        )
        self.assertFalse(_is_exceed_context_error(Exception("connection reset")))

    def test_vision_thread_sticky_followup(self) -> None:
        from main import (
            _thread_plans,
            _thread_plan_put,
            _vision_route,
            _vision_thread_sticky,
        )

        thread_id = "vision-sticky-test"
        _thread_plans.pop(thread_id, None)
        _thread_plan_put(thread_id, _vision_route())
        sticky = _vision_thread_sticky(
            thread_id,
            "What color is the car?",
            [
                ChatMessage(role="user", content="see image"),
                ChatMessage(role="assistant", content="A red car."),
                ChatMessage(role="user", content="What color is the car?"),
            ],
        )
        self.assertIsNotNone(sticky)
        assert sticky is not None
        self.assertEqual(sticky.task_type, "vision")
        self.assertEqual(sticky.routing_path, "thread_plan:vision")
        _thread_plans.pop(thread_id, None)

    def test_session_summary_condenses_old_turns(self) -> None:
        from main import _apply_session_memory, SESSION_KEEP_RECENT

        msgs = [
            {"role": "user", "content": f"turn {i} " + ("x" * 50)}
            for i in range(20)
        ]
        out = _apply_session_memory(msgs)
        self.assertEqual(out[0]["role"], "system")
        self.assertIn("Session memory", out[0]["content"])
        self.assertEqual(len(out), 1 + SESSION_KEEP_RECENT)

    def test_normalize_messages_for_ollama(self) -> None:
        from main import _normalize_messages_for_ollama

        out = _normalize_messages_for_ollama(
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Read this sign"},
                        {
                            "type": "image_url",
                            "image_url": {"url": "data:image/jpeg;base64,QUJD"},
                        },
                    ],
                }
            ]
        )
        self.assertEqual(out[0]["content"], "Read this sign")
        self.assertEqual(out[0]["images"], ["QUJD"])

    async def test_multimodal_request_accepted_not_422(self) -> None:
        from unittest.mock import patch

        from httpx import ASGITransport, AsyncClient as HttpxAsyncClient

        from main import app, _vision_route

        decision = _vision_route()

        async def mock_worker_stream(*_args, **_kwargs):
            yield b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
            yield b"data: [DONE]\n\n"

        with (
            patch("main._resolve_routing", new_callable=AsyncMock, return_value=decision),
            patch("main._stream_worker_with_preamble", return_value=mock_worker_stream()),
        ):
            transport = ASGITransport(app=app)
            async with HttpxAsyncClient(transport=transport, base_url="http://test") as ac:
                async with ac.stream(
                    "POST",
                    "/v1/chat/completions",
                    json={
                        "model": "spockify-auto",
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "What does it say in this image?",
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": "data:image/png;base64,iVBORw0KGgo="
                                        },
                                    },
                                ],
                            }
                        ],
                        "stream": True,
                    },
                ) as resp:
                    self.assertEqual(resp.status_code, 200)
                    body = b"".join([chunk async for chunk in resp.aiter_bytes()])

        self.assertIn(b"gemma4-26b", body)
        self.assertIn(b"[DONE]", body)


class CodestralStickyQaTests(unittest.TestCase):
    def test_yes_after_codestral_question_stays_codestral(self) -> None:
        messages = [
            ChatMessage(role="user", content="Refactor the auth module"),
            ChatMessage(
                role="assistant",
                content="I can refactor auth.py. Should I proceed?",
            ),
            ChatMessage(role="user", content="yes"),
        ]
        decision = _context_aware_route(messages, "yes")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")
        self.assertFalse(decision.needs_web_search)
        self.assertIn("codestral", decision.routing_path)

    def test_english_and_swedish_affirmations_after_refactor_ask(self) -> None:
        prior = [
            ChatMessage(role="user", content="Refactor the auth module"),
            ChatMessage(
                role="assistant",
                content="Should I refactor auth.py?",
            ),
        ]
        for reply in ("yes", "ja", "gör det"):
            with self.subTest(reply=reply):
                messages = prior + [ChatMessage(role="user", content=reply)]
                decision = _context_aware_route(messages, reply)
                self.assertIsNotNone(decision, reply)
                assert decision is not None
                self.assertEqual(decision.selected_model, "codestral", reply)
                self.assertEqual(
                    decision.routing_path, "context_sticky_codestral_qa", reply
                )
                self.assertFalse(decision.needs_web_search)

    def test_bare_should_i_proceed_inherits_coding_thread(self) -> None:
        """Confirmation without code fences still stickies after a coding turn."""
        messages = [
            ChatMessage(role="user", content="Write a Python fibonacci function"),
            ChatMessage(
                role="assistant",
                content="```python\ndef fib(n): return n\n```\nShould I proceed?",
            ),
            ChatMessage(role="user", content="yes"),
        ]
        # Strip code from last ask: only "Should I proceed?"
        messages[1] = ChatMessage(
            role="assistant",
            content="Should I proceed?",
        )
        decision = _context_aware_route(messages, "yes")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")
        self.assertEqual(decision.routing_path, "context_sticky_codestral_qa")

    def test_swedish_go_ahead_after_codestral_question(self) -> None:
        messages = [
            ChatMessage(role="user", content="Bygg en tetris"),
            ChatMessage(
                role="assistant",
                content="```python\nprint('hi')\n```\nSka jag skriva hela spelet?",
            ),
            ChatMessage(role="user", content="gör det"),
        ]
        decision = _context_aware_route(messages, "gör det")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")

    def test_file_reply_after_which_file(self) -> None:
        messages = [
            ChatMessage(role="user", content="Fix the bug"),
            ChatMessage(
                role="assistant",
                content="I can patch it. Which file should I edit?",
            ),
            ChatMessage(role="user", content="main.py"),
        ]
        decision = _context_aware_route(messages, "main.py")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.selected_model, "codestral")

    def test_spannande_after_history_chat_stays_chat(self) -> None:
        messages = [
            ChatMessage(role="user", content="Tell me about the Berlin Wall"),
            ChatMessage(
                role="assistant",
                content="The Berlin Wall stood from 1961 to 1989.",
            ),
            ChatMessage(role="user", content="Spännande!"),
        ]
        decision = _context_aware_route(messages, "Spännande!")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertNotEqual(decision.selected_model, "codestral")
        self.assertFalse(decision.needs_web_search)
        self.assertEqual(decision.task_type, "casual_chat")

    def test_chat_should_i_tell_more_not_codestral(self) -> None:
        """Non-coding 'Should I…?' must not steal Phase 2 ack / chat path."""
        messages = [
            ChatMessage(role="user", content="Tell me about the Berlin Wall"),
            ChatMessage(
                role="assistant",
                content="It fell in 1989. Should I tell you more?",
            ),
            ChatMessage(role="user", content="yes"),
        ]
        decision = _context_aware_route(messages, "yes")
        self.assertTrue(
            decision is None or decision.selected_model != "codestral",
            decision,
        )


class SearchHeuristicTests(unittest.TestCase):
    def test_today_alone_not_search_intent(self) -> None:
        self.assertFalse(_explicit_search_intent("What are we doing today?"))

    def test_weather_still_search_intent(self) -> None:
        self.assertTrue(_explicit_search_intent("Weather in Stockholm tomorrow"))

    def test_chitchat_blocks_search(self) -> None:
        self.assertTrue(_web_search_blocked("Spännande!"))
        self.assertTrue(_web_search_blocked("cool"))

    def test_english_acks_skip_search(self) -> None:
        from main import _is_acknowledgment, _needs_orchestrator

        for phrase in ("thanks", "thank you", "ty", "ok", "okay", "cool", "np"):
            with self.subTest(phrase=phrase):
                self.assertTrue(
                    _is_acknowledgment(phrase) or phrase.startswith("thank"),
                    phrase,
                )
                self.assertTrue(_web_search_blocked(phrase), phrase)
                decision = _heuristic_route(phrase, None)
                self.assertIsNotNone(decision, phrase)
                assert decision is not None
                self.assertFalse(decision.needs_web_search)
                self.assertIn("heuristic", decision.routing_path)
                gated = _gate_web_search(phrase, decision)
                self.assertFalse(gated.needs_web_search)
                self.assertFalse(
                    _needs_orchestrator(
                        phrase,
                        [ChatMessage(role="user", content=phrase)],
                        decision,
                    )
                )

    def test_swedish_acks_skip_search(self) -> None:
        from main import _is_acknowledgment, _needs_orchestrator

        for phrase in ("Spännande!", "tack", "okej", "ty", "jättebra", "mm"):
            with self.subTest(phrase=phrase):
                self.assertTrue(_is_acknowledgment(phrase), phrase)
                self.assertTrue(_web_search_blocked(phrase), phrase)
                decision = _heuristic_route(phrase, None)
                self.assertIsNotNone(decision, phrase)
                assert decision is not None
                self.assertFalse(decision.needs_web_search)
                self.assertEqual(decision.routing_path, "heuristic_ack")
                self.assertEqual(decision.selected_model, "llama3.2-3b")
                self.assertFalse(
                    _needs_orchestrator(
                        phrase,
                        [ChatMessage(role="user", content=phrase)],
                        decision,
                    )
                )
    def test_news_and_lookup_keep_search(self) -> None:
        for phrase in (
            "breaking news today",
            "look up asyncio timeout",
            "slå upp Python 3.13 release notes",
            "weather Stockholm",
            "väder Stockholm",
        ):
            with self.subTest(phrase=phrase):
                decision = _heuristic_route(phrase, None)
                self.assertIsNotNone(decision, phrase)
                assert decision is not None
                gated = _gate_web_search(phrase, decision)
                self.assertTrue(gated.needs_web_search, phrase)

    def test_sticky_web_english_after_weather(self) -> None:
        from main import _needs_orchestrator

        prior = [
            ChatMessage(role="user", content="weather Stockholm"),
            ChatMessage(role="assistant", content="Stockholm is 12°C and cloudy."),
        ]
        for follow_up in ("and tomorrow?", "and per day?", "what about tomorrow?"):
            with self.subTest(follow_up=follow_up):
                msgs = prior + [ChatMessage(role="user", content=follow_up)]
                decision = _context_aware_route(msgs, follow_up)
                self.assertIsNotNone(decision)
                assert decision is not None
                self.assertTrue(decision.needs_web_search)
                self.assertIn("sticky", decision.routing_path)
                self.assertFalse(_needs_orchestrator(follow_up, msgs, decision))

    def test_sticky_web_swedish_after_weather(self) -> None:
        from main import _needs_orchestrator

        prior = [
            ChatMessage(role="user", content="väder Stockholm"),
            ChatMessage(role="assistant", content="Stockholm: 12°C, molnigt."),
        ]
        for follow_up in ("och imorgon?", "och idag?", "per dag?"):
            with self.subTest(follow_up=follow_up):
                msgs = prior + [ChatMessage(role="user", content=follow_up)]
                decision = _context_aware_route(msgs, follow_up)
                self.assertIsNotNone(decision, follow_up)
                assert decision is not None
                self.assertTrue(decision.needs_web_search, follow_up)
                self.assertIn("sticky", decision.routing_path)
                self.assertFalse(_needs_orchestrator(follow_up, msgs, decision))

    def test_ack_after_weather_skips_search(self) -> None:
        msgs = [
            ChatMessage(role="user", content="weather Stockholm"),
            ChatMessage(role="assistant", content="12°C cloudy."),
            ChatMessage(role="user", content="Spännande!"),
        ]
        decision = _context_aware_route(msgs, "Spännande!")
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertFalse(decision.needs_web_search)
        self.assertEqual(decision.task_type, "casual_chat")

    def test_sticky_web_after_news_lookup(self) -> None:
        prior = [
            ChatMessage(role="user", content="look up breaking news today"),
            ChatMessage(role="assistant", content="Here are today's headlines…"),
        ]
        follow_up = "and what about Europe?"
        msgs = prior + [ChatMessage(role="user", content=follow_up)]
        decision = _context_aware_route(msgs, follow_up)
        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertTrue(decision.needs_web_search)
        self.assertEqual(decision.routing_path, "context_sticky_web")


class SpockifyStatusHelpersTests(unittest.TestCase):
    def test_normalize_ollama_ps(self) -> None:
        models = _normalize_ollama_ps(
            {
                "models": [
                    {"name": "gemma4:12b", "size": 100, "size_vram": 80},
                    {"model": "nemotron", "size_vram": 40},
                ]
            }
        )
        self.assertEqual(len(models), 2)
        self.assertEqual(models[0]["name"], "gemma4:12b")
        self.assertEqual(models[0]["size_vram_bytes"], 80)
        self.assertEqual(models[1]["name"], "nemotron")

    def test_read_meminfo_bytes(self) -> None:
        info = _read_meminfo_bytes()
        self.assertTrue(info.get("ok"))
        self.assertIsInstance(info.get("total_bytes"), int)
        self.assertGreater(info["total_bytes"], 0)


class VoiceModeRoutingTests(unittest.TestCase):
    def test_voice_remaps_default_chat_to_8b(self) -> None:
        from main import VOICE_CHAT_WORKER, _apply_voice_mode

        decision = RoutingDecision(
            selected_model=DEFAULT_CHAT_WORKER,
            task_type="general",
            confidence=0.9,
            reasoning="default",
            routing_path="default",
        )
        patched = _apply_voice_mode(decision, True)
        self.assertEqual(patched.selected_model, VOICE_CHAT_WORKER)
        self.assertFalse(patched.needs_web_search)

    def test_voice_keeps_greeting_on_fast_chat(self) -> None:
        from main import FAST_CHAT_WORKER, _apply_voice_mode

        decision = RoutingDecision(
            selected_model=FAST_CHAT_WORKER,
            task_type="casual_chat",
            confidence=0.9,
            reasoning="greeting",
            routing_path="heuristic",
        )
        patched = _apply_voice_mode(decision, True)
        self.assertEqual(patched.selected_model, FAST_CHAT_WORKER)

    def test_voice_upgrades_pattern_casual_to_8b(self) -> None:
        from main import FAST_CHAT_WORKER, VOICE_CHAT_WORKER, _apply_voice_mode

        # Pattern "good morning" can false-positive inside longer prompts.
        decision = RoutingDecision(
            selected_model=FAST_CHAT_WORKER,
            task_type="casual_chat",
            confidence=0.92,
            reasoning="pattern match: casual_chat",
            routing_path="pattern",
        )
        patched = _apply_voice_mode(decision, True)
        self.assertEqual(patched.selected_model, VOICE_CHAT_WORKER)

    def test_voice_web_prefers_web_llama(self) -> None:
        from main import VOICE_WEB_WORKER, _apply_voice_mode

        decision = RoutingDecision(
            selected_model=DEFAULT_WEB_WORKER,
            task_type="web_search",
            needs_web_search=True,
            search_query="AAPL stock price",
            confidence=0.9,
            reasoning="stock",
            routing_path="heuristic",
        )
        patched = _apply_voice_mode(decision, True)
        self.assertEqual(patched.selected_model, VOICE_WEB_WORKER)
        self.assertTrue(patched.needs_web_search)

    def test_voice_off_leaves_gemma(self) -> None:
        from main import _apply_voice_mode

        decision = RoutingDecision(
            selected_model=DEFAULT_CHAT_WORKER,
            task_type="general",
            confidence=0.9,
            reasoning="default",
            routing_path="default",
        )
        patched = _apply_voice_mode(decision, False)
        self.assertEqual(patched.selected_model, DEFAULT_CHAT_WORKER)

    def test_voice_marker_stripped_from_messages(self) -> None:
        from main import _voice_mode_from_messages

        msgs = [
            ChatMessage(role="system", content="[spockify_voice:1]"),
            ChatMessage(role="user", content="hello"),
        ]
        found, cleaned = _voice_mode_from_messages(msgs)
        self.assertTrue(found)
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0].role, "user")

    def test_voice_weather_suffix_tells_worker_not_to_convert(self) -> None:
        from main import WEB_SEARCH_VOICE_WEATHER_SUFFIX

        lowered = WEB_SEARCH_VOICE_WEATHER_SUFFIX.lower()
        self.assertIn("live weather", lowered)
        self.assertIn("celsius", lowered)
        self.assertIn("fahrenheit", lowered)


class UncertaintyRsiTests(unittest.TestCase):
    def test_low_confidence_factual_escalates_to_search(self) -> None:
        from main import _apply_uncertainty_policy

        decision = RoutingDecision(
            selected_model="llama3.2-3b",
            task_type="general",
            confidence=0.4,
            reasoning="guess",
            routing_path="default",
        )
        out = _apply_uncertainty_policy(
            "What is the latest version of Kubernetes?",
            [],
            decision,
        )
        self.assertTrue(out.needs_web_search)
        self.assertTrue(out.selected_model.startswith("web-"))
        self.assertIn("rsi", out.reasoning)

    def test_reasoning_bumps_to_quality_gemma(self) -> None:
        from main import QUALITY_CHAT_WORKER, _apply_uncertainty_policy

        decision = RoutingDecision(
            selected_model="llama3.1-8b",
            task_type="reasoning",
            confidence=0.8,
            reasoning="pattern",
            routing_path="pattern",
        )
        out = _apply_uncertainty_policy("Compare Redis and Memcached for caching", [], decision)
        self.assertEqual(out.selected_model, QUALITY_CHAT_WORKER)
        self.assertIn("Hard-task mode", out.prompt_additions)

    def test_greeting_stays_tiny(self) -> None:
        from main import _apply_uncertainty_policy

        decision = RoutingDecision(
            selected_model="llama3.2-3b",
            task_type="casual_chat",
            confidence=0.9,
            reasoning="greeting",
            routing_path="heuristic",
        )
        out = _apply_uncertainty_policy("hello", [], decision)
        self.assertEqual(out.selected_model, "llama3.2-3b")
        self.assertFalse(out.needs_web_search)

    def test_persona_is_present_and_cites(self) -> None:
        from main import SPOCKIFY_PERSONA_PROMPT

        lowered = SPOCKIFY_PERSONA_PROMPT.lower()
        self.assertIn("rsi", lowered)
        self.assertIn("confidently wrong", lowered)
        self.assertIn("sources:", lowered)
        self.assertIn("ask", lowered)
        self.assertNotIn("claude", lowered)
        self.assertNotIn("grok", lowered)

    def test_antigravity_recency_forces_search(self) -> None:
        from main import _apply_uncertainty_policy, _looks_recency_news

        msg = (
            "Hey there! What were the biggest changes in Antigravity "
            "from a couple of days ago?"
        )
        self.assertTrue(_looks_recency_news(msg))
        decision = RoutingDecision(
            selected_model="gemma4-12b",
            task_type="general",
            confidence=0.9,
            reasoning="default chat",
            routing_path="default",
        )
        out = _apply_uncertainty_policy(msg, [], decision)
        self.assertTrue(out.needs_web_search)
        self.assertTrue(out.selected_model.startswith("web-"))
        self.assertIn("recency", out.reasoning)


class ThinkingModeTests(unittest.TestCase):
    def test_model_alias_wins(self) -> None:
        from main import _resolve_thinking_mode

        # Explicit heavy alias overrides a conflicting body/header.
        self.assertEqual(
            _resolve_thinking_mode(
                model="spockify-heavy",
                body_mode="low",
                header_mode="low",
                marker_mode=None,
            ),
            "heavy",
        )

    def test_auto_model_defers_to_body(self) -> None:
        from main import _resolve_thinking_mode

        # spockify-auto is NOT an explicit alias, so the chip (body) decides.
        self.assertEqual(
            _resolve_thinking_mode(
                model="spockify-auto",
                body_mode="heavy",
                header_mode=None,
                marker_mode=None,
            ),
            "heavy",
        )

    def test_precedence_body_over_header_over_marker(self) -> None:
        from main import _resolve_thinking_mode

        self.assertEqual(
            _resolve_thinking_mode(
                model="spockify-auto",
                body_mode="low",
                header_mode="heavy",
                marker_mode="medium",
            ),
            "low",
        )
        self.assertEqual(
            _resolve_thinking_mode(
                model="spockify-auto",
                body_mode=None,
                header_mode="heavy",
                marker_mode="low",
            ),
            "heavy",
        )
        self.assertEqual(
            _resolve_thinking_mode(
                model="spockify-auto",
                body_mode="light",
                header_mode=None,
                marker_mode=None,
            ),
            "low",
        )
        self.assertEqual(
            _resolve_thinking_mode(
                model="spockify-high",
                body_mode="medium",
                header_mode=None,
                marker_mode=None,
            ),
            "high",
        )

    def test_default_is_medium_when_unset(self) -> None:
        from main import DEFAULT_THINKING_MODE, _resolve_thinking_mode

        self.assertEqual(
            _resolve_thinking_mode(
                model="spockify-auto",
                body_mode=None,
                header_mode=None,
                marker_mode=None,
            ),
            DEFAULT_THINKING_MODE,
        )
        self.assertEqual(DEFAULT_THINKING_MODE, "medium")

    def test_marker_stripped_from_messages(self) -> None:
        from main import _thinking_mode_from_messages

        msgs = [
            ChatMessage(role="system", content="[spockify_thinking:heavy]"),
            ChatMessage(role="user", content="do the thing"),
        ]
        found, cleaned = _thinking_mode_from_messages(msgs)
        self.assertEqual(found, "heavy")
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0].role, "user")

    def test_message_id_marker_stripped_from_messages(self) -> None:
        from main import _message_id_from_messages

        mid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        msgs = [
            ChatMessage(role="system", content=f"[spockify_message_id:{mid}]"),
            ChatMessage(role="user", content="do the thing"),
        ]
        found, cleaned = _message_id_from_messages(msgs)
        self.assertEqual(found, mid)
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0].role, "user")

    def test_header_reader(self) -> None:
        from main import _thinking_mode_from_headers

        self.assertEqual(
            _thinking_mode_from_headers({"X-Spockify-Thinking": "Heavy"}), "heavy"
        )
        self.assertIsNone(_thinking_mode_from_headers({"x-other": "1"}))

    def test_light_biases_general_chat_to_fast_worker(self) -> None:
        from main import LIGHT_CHAT_WORKER, QUALITY_CHAT_WORKER, _apply_thinking_mode

        decision = RoutingDecision(
            selected_model=QUALITY_CHAT_WORKER,
            task_type="reasoning",
            confidence=0.9,
            reasoning="quality gemma",
            routing_path="pattern",
        )
        out = _apply_thinking_mode(decision, "low", "explain closures briefly")
        # Quality Gemma 31b remaps to 12b on Low; leftover quality with no
        # remap still falls through to LIGHT_CHAT_WORKER.
        expected = model_catalog.light_remap(QUALITY_CHAT_WORKER) or LIGHT_CHAT_WORKER
        self.assertEqual(out.selected_model, expected)

    def test_light_keeps_specialists(self) -> None:
        from main import _apply_thinking_mode

        decision = RoutingDecision(
            selected_model="gpt-oss-120b",
            task_type="code_generation",
            confidence=0.9,
            reasoning="code",
            routing_path="pattern",
        )
        out = _apply_thinking_mode(decision, "low", "write a parser in rust")
        self.assertEqual(out.selected_model, "gpt-oss-120b")

    def test_light_keeps_web_search(self) -> None:
        from main import _apply_thinking_mode

        decision = RoutingDecision(
            selected_model="web-gemma",
            task_type="web_search",
            needs_web_search=True,
            confidence=0.9,
            reasoning="live facts",
            routing_path="pattern",
        )
        out = _apply_thinking_mode(decision, "low", "latest k8s version")
        self.assertEqual(out.selected_model, "web-gemma")
        self.assertTrue(out.needs_web_search)

    def test_medium_is_noop(self) -> None:
        from main import DEFAULT_CHAT_WORKER, _apply_thinking_mode

        decision = RoutingDecision(
            selected_model=DEFAULT_CHAT_WORKER,
            task_type="general",
            confidence=0.9,
            reasoning="default",
            routing_path="default",
        )
        out = _apply_thinking_mode(decision, "medium", "hey")
        self.assertEqual(out.selected_model, DEFAULT_CHAT_WORKER)

    def test_light_remaps_qwen36_to_qwen35(self) -> None:
        from main import MULTILINGUAL_CHAT_WORKER, _apply_thinking_mode

        decision = RoutingDecision(
            selected_model="qwen3.6-35b",
            task_type="multilingual_chat",
            confidence=0.86,
            reasoning="non-Latin script",
            routing_path="heuristic_multilingual",
        )
        out = _apply_thinking_mode(decision, "low", "请详细解释这段古文的含义")
        self.assertEqual(out.selected_model, MULTILINGUAL_CHAT_WORKER)

    def test_think_off_keeps_llama_on_medium(self) -> None:
        from main import LIGHT_CHAT_WORKER, _apply_thinking_mode

        decision = RoutingDecision(
            selected_model=LIGHT_CHAT_WORKER,
            task_type="general",
            confidence=0.8,
            reasoning="fast",
            routing_path="heuristic",
        )
        out = _apply_thinking_mode(decision, "off", "explain closures")
        self.assertEqual(out.selected_model, LIGHT_CHAT_WORKER)

    def test_think_on_medium_remaps_llama_general_to_gemma(self) -> None:
        from main import DEFAULT_CHAT_WORKER, LIGHT_CHAT_WORKER, _apply_thinking_mode

        decision = RoutingDecision(
            selected_model=LIGHT_CHAT_WORKER,
            task_type="general",
            confidence=0.8,
            reasoning="fast",
            routing_path="heuristic",
        )
        out = _apply_thinking_mode(
            decision, "medium", "explain closures", think_enabled=True
        )
        self.assertEqual(out.selected_model, DEFAULT_CHAT_WORKER)

    def test_think_on_keeps_greeting_on_tiny_llama(self) -> None:
        from main import FAST_CHAT_WORKER, _apply_thinking_mode

        decision = RoutingDecision(
            selected_model=FAST_CHAT_WORKER,
            task_type="casual_chat",
            confidence=0.92,
            reasoning="greeting",
            routing_path="heuristic_ack",
        )
        out = _apply_thinking_mode(decision, "medium", "hey", think_enabled=True)
        self.assertEqual(out.selected_model, FAST_CHAT_WORKER)

    def test_wants_model_think_respects_off(self) -> None:
        from main import _think_payload_for_worker, _wants_model_think

        self.assertFalse(_wants_model_think("off", True))
        self.assertFalse(_wants_model_think("medium", False))
        self.assertTrue(_wants_model_think("low", True))
        self.assertTrue(_wants_model_think("medium", True))
        self.assertTrue(_wants_model_think("high", True))
        self.assertTrue(_wants_model_think("heavy", True))
        self.assertEqual(_think_payload_for_worker("gpt-oss-20b", "high"), "high")
        self.assertEqual(_think_payload_for_worker("gpt-oss-20b", "heavy"), "high")
        self.assertEqual(_think_payload_for_worker("gemma4-12b", "low"), "low")
        self.assertIsNone(_think_payload_for_worker("llama3.2-3b", "high"))
        self.assertIsNone(_think_payload_for_worker("codestral", "low"))
        self.assertIsNone(_think_payload_for_worker("gpt-oss-20b", "off"))
        body = _ollama_chat_body(
            "qwen3.5-9b",
            [{"role": "user", "content": "hi"}],
            stream=False,
            think=False,
        )
        self.assertIs(body["think"], False)
        gemma_off = _ollama_chat_body(
            "gemma4-12b",
            [{"role": "user", "content": "hi"}],
            stream=False,
            think=False,
        )
        self.assertIs(gemma_off["think"], False)

    def test_think_enabled_header_and_marker(self) -> None:
        from main import (
            _resolve_thinking_enabled,
            _thinking_enabled_from_headers,
            _thinking_enabled_from_messages,
        )

        self.assertFalse(
            _thinking_enabled_from_headers({"X-Spockify-Think-Enabled": "0"})
        )
        self.assertTrue(
            _thinking_enabled_from_headers({"X-Spockify-Think-Enabled": "1"})
        )
        msgs = [
            ChatMessage(role="system", content="[spockify_think:off]"),
            ChatMessage(role="user", content="hi"),
        ]
        found, cleaned = _thinking_enabled_from_messages(msgs)
        self.assertFalse(found)
        self.assertEqual(len(cleaned), 1)
        self.assertFalse(
            _resolve_thinking_enabled(
                body_flag=None, header_flag=None, marker_flag=False
            )
        )
        self.assertTrue(
            _resolve_thinking_enabled(
                body_flag=True, header_flag=False, marker_flag=False
            )
        )


class ModelCatalogTests(unittest.TestCase):
    def test_catalog_covers_local_chat_aliases(self) -> None:
        required = (
            "llama3.2-3b",
            "llama3.1-8b",
            "llama3.3-70b",
            "gemma4-12b",
            "gemma4-26b",
            "gemma4-31b",
            "gpt-oss-20b",
            "gpt-oss-120b",
            "codestral",
            "qwen3.5-9b",
            "qwen3.6-27b",
            "qwen3.6-35b",
            "qwen3.6-coder-27b",
            "web-gemma",
            "web-llama",
            "web-codestral",
            "mathstral",
            "nemotron-nano-4b",
            "magistral",
            "devstral-small-2",
            "ministral-3-14b",
        )
        for alias in required:
            row = model_catalog.get_model(alias)
            self.assertIsNotNone(row, alias)
            self.assertEqual(row.alias, alias)

    def test_qwen_think_and_light_remap(self) -> None:
        self.assertTrue(model_catalog.supports_thinking("qwen3.5-9b"))
        self.assertEqual(model_catalog.thinking_api_kind("qwen3.5-9b"), "effort")
        self.assertEqual(model_catalog.thinking_api_kind("gpt-oss-20b"), "effort")
        self.assertEqual(model_catalog.thinking_api_kind("llama3.2-3b"), "none")
        self.assertEqual(model_catalog.light_remap("qwen3.6-35b"), "qwen3.5-9b")
        self.assertEqual(model_catalog.light_remap("gemma4-31b"), "gemma4-12b")
        self.assertIsNone(model_catalog.light_remap("qwen3.6-coder-27b"))
        coder = model_catalog.get_model("qwen3.6-coder-27b")
        self.assertIsNotNone(coder)
        self.assertEqual(coder.ollama_name, "qwen3.6:27b-coding")
        self.assertIn("code", coder.strengths)
        self.assertIn("builder", coder.heavy_roles)
        self.assertEqual(
            model_catalog.get_model("gemma4-31b").vram_class, "large"
        )
        self.assertEqual(
            model_catalog.get_model("qwen3.6-27b-coding").alias,
            "qwen3.6-coder-27b",
        )
        self.assertIn("analyst", model_catalog.get_model("qwen3.5-9b").heavy_roles)
        self.assertEqual(model_catalog.normalize_thinking_mode("light"), "low")
        self.assertEqual(model_catalog.ollama_think_value("gpt-oss-20b", "high"), "high")
        self.assertIsNone(model_catalog.ollama_think_value("llama3.1-8b", "high"))

    def test_heavy_plan_english_vs_cjk(self) -> None:
        en = model_catalog.plan_heavy_models("Design a resilient job queue")
        self.assertEqual(en, list(model_catalog.DEFAULT_HEAVY_MODELS))
        self.assertNotIn("gemma4-31b", en)
        self.assertEqual(en[2], "gemma4-26b")
        short = model_catalog.plan_heavy_models("请用中文解释一下什么是递归")
        self.assertEqual(short[0], "gpt-oss-20b")
        self.assertEqual(short[1], "qwen3.5-9b")
        self.assertEqual(short[2], "gemma4-26b")
        long_msg = "请详细比较微服务和单体架构的权衡" * 20
        self.assertGreaterEqual(len(long_msg), 240)
        long_plan = model_catalog.plan_heavy_models(long_msg)
        self.assertEqual(long_plan[1], "qwen3.6-35b")
        self.assertEqual(long_plan[2], "qwen3.6-35b")

    def test_orchestrator_catalog_lists_all_aliases(self) -> None:
        text = model_catalog.orchestrator_catalog_text()
        for alias in (
            "qwen3.5-9b",
            "llama3.2-3b",
            "gpt-oss-120b",
            "codestral",
            "gemma4-31b",
            "qwen3.6-coder-27b",
            "magistral",
            "devstral-small-2",
            "ministral-3-14b",
        ):
            self.assertIn(alias, text)
        self.assertIn("none", text)
        self.assertIn("effort", text)
        off = model_catalog.thinking_policy_text(thinking_mode="off")
        self.assertIn("Off", off)
        low = model_catalog.thinking_policy_text(thinking_mode="low")
        self.assertIn("Low", low)
        high = model_catalog.thinking_policy_text(thinking_mode="high")
        self.assertIn("High", high)
        on = model_catalog.thinking_policy_text(thinking_mode="medium")
        self.assertIn("Medium", on)
        heavy = model_catalog.thinking_policy_text(thinking_mode="heavy")
        self.assertIn("ASK FIRST", heavy)
        self.assertIn("Skeptic", heavy)
        self.assertIn("gpt-oss-120b", heavy)

    def test_mistral_new_models_think_and_map(self) -> None:
        self.assertEqual(model_catalog.thinking_api_kind("magistral"), "boolean")
        self.assertEqual(model_catalog.thinking_api_kind("magistral:24b"), "boolean")
        self.assertTrue(model_catalog.ollama_think_value("magistral", "high") is True)
        self.assertIs(model_catalog.ollama_think_value("magistral", "off"), False)
        self.assertEqual(model_catalog.thinking_api_kind("devstral-small-2"), "none")
        self.assertIsNone(model_catalog.ollama_think_value("devstral-small-2", "high"))
        self.assertEqual(model_catalog.thinking_api_kind("ministral-3-14b"), "none")
        self.assertEqual(
            model_catalog.get_model("ministral-3:14b").alias, "ministral-3-14b"
        )
        self.assertIn("code", model_catalog.get_model("devstral-small-2").strengths)
        self.assertNotIn("builder", model_catalog.get_model("devstral-small-2").heavy_roles)

    def test_sanitize_heavy_models_caps_xlarge(self) -> None:
        out = model_catalog.sanitize_heavy_models(
            ["gpt-oss-120b", "gpt-oss-120b", "gemma4-31b", "llama3.3-70b"],
            "write a rust parser",
        )
        xlarge = [
            a
            for a in out
            if model_catalog.get_model(a)
            and model_catalog.get_model(a).vram_class == "xlarge"
        ]
        self.assertEqual(len(xlarge), 1)
        self.assertEqual(out[0], "gpt-oss-120b")

    def test_sanitize_heavy_models_unknown_falls_back(self) -> None:
        out = model_catalog.sanitize_heavy_models(
            ["not-a-model", "gemma4-12b", "gemma4-26b", "gemma4-12b"],
            "Design a resilient job queue",
        )
        self.assertEqual(out[0], "gpt-oss-20b")
        self.assertEqual(out[1], "gemma4-12b")

    def test_routing_prompt_includes_catalog(self) -> None:
        from main import _routing_system_prompt

        prompt = _routing_system_prompt(think_enabled=True, thinking_mode="medium")
        self.assertIn("qwen3.6-35b", prompt)
        self.assertIn("llama3.2-3b", prompt)
        self.assertIn("think", prompt.lower())


class QwenMultilingualRoutingTests(unittest.TestCase):
    def test_short_chinese_routes_to_qwen35(self) -> None:
        from main import MULTILINGUAL_CHAT_WORKER

        decision = _heuristic_route("请用中文解释一下什么是递归", None)
        assert decision is not None
        self.assertEqual(decision.selected_model, MULTILINGUAL_CHAT_WORKER)
        self.assertEqual(decision.task_type, "multilingual_chat")
        self.assertEqual(decision.routing_path, "heuristic_multilingual")

    def test_long_chinese_routes_to_qwen36(self) -> None:
        from main import MULTILINGUAL_QUALITY_WORKER

        msg = (
            "请详细比较一下微服务架构和单体架构在团队规模、部署复杂度、"
            "数据一致性、运维成本和故障隔离方面的权衡，并给出一个适合"
            "中型电商团队的建议。还需要说明迁移步骤、常见失败原因、"
            "灰度发布策略、以及如何评估是否值得拆分。请结合库存、支付"
            "和履约三个核心域分别说明边界，并列出每个阶段的验收标准。"
            "最后补充对人员和技能结构的要求，以及半年内的风险清单。"
            "如果选择继续拆分，请按季度列出里程碑，并说明每个里程碑"
            "需要的观测指标、回滚条件和组织调整。如果选择暂不拆分，"
            "也请给出模块化单体的落地步骤和两年内的复核条件。"
        )
        decision = _heuristic_route(msg, None)
        assert decision is not None
        self.assertEqual(decision.selected_model, MULTILINGUAL_QUALITY_WORKER)
        self.assertGreaterEqual(len(msg), 240)

    def test_chinese_code_request_stays_on_coder(self) -> None:
        decision = _heuristic_route("请用 python 写一个函数计算斐波那契", None)
        assert decision is not None
        self.assertEqual(decision.selected_model, ROOM_CODER_WORKER)
        self.assertEqual(decision.task_type, "code_generation")

    def test_english_stays_off_qwen(self) -> None:
        decision = _heuristic_route("Hey, explain closures briefly", None)
        if decision is not None:
            self.assertFalse(decision.selected_model.startswith("qwen"))


class ExplicitModelRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_talk_to_qwen_please(self) -> None:
        user = "Can you let me talk to Qwen please?"
        rules = _load_routing_rules()
        client = AsyncMock()
        decision = await _resolve_routing(
            client, user, rules, [ChatMessage(role="user", content=user)]
        )
        self.assertTrue(
            decision.selected_model.startswith("qwen"),
            decision.selected_model,
        )
        self.assertEqual(decision.selected_model, "qwen3.5-9b")
        self.assertEqual(decision.routing_path, "explicit_model")
        client.post.assert_not_called()

    async def test_talk_to_qwen_mid_conversation(self) -> None:
        user = "Can you let me talk to Qwen please?"
        msgs = [
            ChatMessage(role="user", content="Hey, explain closures briefly"),
            ChatMessage(role="assistant", content="A closure captures variables."),
            ChatMessage(role="user", content=user),
        ]
        client = AsyncMock()
        decision = await _resolve_routing(
            client, user, _load_routing_rules(), msgs
        )
        self.assertTrue(decision.selected_model.startswith("qwen"))
        self.assertEqual(decision.routing_path, "explicit_model")
        client.post.assert_not_called()

    def test_catalog_explicit_families(self) -> None:
        self.assertEqual(
            model_catalog.resolve_explicit_model_request(
                "Can you let me talk to Qwen please?"
            ),
            "qwen3.5-9b",
        )
        self.assertEqual(
            model_catalog.resolve_explicit_model_request("use gpt-oss"),
            "gpt-oss-120b",
        )
        self.assertEqual(
            model_catalog.resolve_explicit_model_request("switch to gemma"),
            "gemma4-12b",
        )
        self.assertEqual(
            model_catalog.resolve_explicit_model_request("use magistral"),
            "magistral",
        )
        self.assertEqual(
            model_catalog.resolve_explicit_model_request("use qwen coder"),
            "qwen3.6-coder-27b",
        )
        self.assertIsNone(
            model_catalog.resolve_explicit_model_request("What is Qwen?")
        )
        self.assertIsNone(
            model_catalog.resolve_explicit_model_request("Hey, explain closures briefly")
        )

    def test_heuristic_talk_to_qwen(self) -> None:
        decision = _heuristic_route("talk to Qwen please", None)
        assert decision is not None
        self.assertTrue(decision.selected_model.startswith("qwen"))
        self.assertEqual(decision.task_type, "explicit_model")
        self.assertEqual(
            decision.prompt_additions,
            "You are local qwen3.5-9b on Spockify (on-device). Help the user.",
        )
        self.assertNotIn("Alibaba", decision.prompt_additions)
        self.assertNotIn("never claim", decision.prompt_additions.lower())

    async def test_use_gpt_oss_skips_orchestrator(self) -> None:
        user = "use gpt-oss"
        client = AsyncMock()
        decision = await _resolve_routing(
            client, user, _load_routing_rules(), [ChatMessage(role="user", content=user)]
        )
        self.assertEqual(decision.selected_model, "gpt-oss-120b")
        self.assertEqual(decision.routing_path, "explicit_model")
        client.post.assert_not_called()

    def test_talk_to_qwen_think_omitted_or_false(self) -> None:
        from main import (
            _is_trivial_worker_turn,
            _think_payload_for_turn,
        )

        user = "talk to Qwen please"
        decision = _heuristic_route(user, None)
        assert decision is not None
        self.assertTrue(_is_trivial_worker_turn(user, decision))
        self.assertFalse(
            _think_payload_for_turn("qwen3.5-9b", "high", user, decision)
        )
        self.assertFalse(
            _think_payload_for_turn("qwen3.5-9b", "heavy", user, decision)
        )
        gpt = _heuristic_route("use gpt-oss", None)
        assert gpt is not None
        self.assertEqual(
            _think_payload_for_turn("gpt-oss-120b", "heavy", "use gpt-oss", gpt),
            "low",
        )

    def test_language_probe_is_trivial(self) -> None:
        from main import _is_language_probe, _is_trivial_worker_turn

        self.assertTrue(_is_language_probe("say something in Chinese"))
        self.assertTrue(_is_language_probe("say hi in Chinese"))
        self.assertTrue(_is_trivial_worker_turn("say something in Chinese"))
        self.assertFalse(
            _is_language_probe(
                "Write a 2000 word essay in Chinese about Qing history"
            )
        )

    async def test_worker_messages_no_identity_sandwich(self) -> None:
        from main import (
            ChatCompletionRequest,
            SPOCKIFY_PERSONA_PROMPT,
            _build_worker_messages,
        )

        user = "talk to Qwen please"
        decision = _heuristic_route(user, None)
        assert decision is not None
        req = ChatCompletionRequest(
            model="spockify-auto",
            messages=[ChatMessage(role="user", content=user)],
        )
        built, _sources = await _build_worker_messages(
            AsyncMock(), req, decision, user, "qwen3.5-9b"
        )
        systems = [
            str(m.get("content") or "")
            for m in built
            if m.get("role") == "system"
        ]
        blob = "\n".join(systems).lower()
        self.assertEqual(len(systems), 1)
        self.assertIn("local qwen3.5-9b", blob)
        self.assertNotIn("never claim", blob)
        self.assertNotIn("alibaba", blob)
        self.assertNotIn("impersonat", blob)
        self.assertFalse(any(SPOCKIFY_PERSONA_PROMPT[:40] in t for t in systems))
        self.assertFalse(
            "never claim qwen" in blob and "you are local qwen" in blob
        )

    async def test_named_qwen_factual_gets_search_not_persona(self) -> None:
        from unittest.mock import patch

        from main import (
            ChatCompletionRequest,
            SPOCKIFY_PERSONA_PROMPT,
            _build_worker_messages,
        )

        user = "talk to Qwen then explain who won the 2026 eurovision"
        decision = _heuristic_route(user, None)
        assert decision is not None
        self.assertTrue(decision.needs_web_search)
        req = ChatCompletionRequest(
            model="spockify-auto",
            messages=[ChatMessage(role="user", content=user)],
        )
        fake_block = (
            "Web search results for: who won the 2026 eurovision\n"
            "1. Eurovision\n   https://eurovision.tv/winner\n   Winner announced.\n"
        )
        fake_sources = [
            {
                "source": {
                    "name": "Eurovision",
                    "url": "https://eurovision.tv/winner",
                }
            }
        ]
        with patch(
            "main._searxng_search",
            new=AsyncMock(return_value=(fake_block, fake_sources)),
        ):
            built, sources = await _build_worker_messages(
                AsyncMock(), req, decision, user, "qwen3.5-9b"
            )
        systems = [
            str(m.get("content") or "")
            for m in built
            if m.get("role") == "system"
        ]
        blob = "\n".join(systems).lower()
        self.assertTrue(any("local qwen3.5-9b" in t.lower() for t in systems))
        self.assertTrue(any("eurovision.tv" in t.lower() for t in systems))
        self.assertTrue(any("sources:" in t.lower() for t in systems))
        self.assertFalse(any(SPOCKIFY_PERSONA_PROMPT[:40] in t for t in systems))
        self.assertNotIn("never claim", blob)
        self.assertNotIn("alibaba", blob)
        self.assertTrue(sources)

    def test_needs_orchestrator_skips_named_and_cjk(self) -> None:
        qwen_msgs = [ChatMessage(role="user", content="talk to Qwen please")]
        self.assertFalse(_needs_orchestrator("talk to Qwen please", qwen_msgs, None))
        hello = [ChatMessage(role="user", content="hello")]
        self.assertFalse(_needs_orchestrator("hello", hello, None))
        cjk = [ChatMessage(role="user", content="请用中文解释一下什么是递归")]
        self.assertFalse(
            _needs_orchestrator("请用中文解释一下什么是递归", cjk, None)
        )
        gpt = [ChatMessage(role="user", content="use gpt-oss")]
        self.assertFalse(_needs_orchestrator("use gpt-oss", gpt, None))

    def test_persona_has_no_identity_debate(self) -> None:
        from main import SPOCKIFY_PERSONA_PROMPT

        lowered = SPOCKIFY_PERSONA_PROMPT.lower()
        self.assertNotIn("alibaba", lowered)
        self.assertNotIn("tongyi", lowered)
        self.assertNotIn("never claim", lowered)
        self.assertNotIn("cannot switch", lowered)
        self.assertNotIn("claude", lowered)
        self.assertNotIn("grok", lowered)
        self.assertIn("rsi", lowered)
        self.assertIn("sources:", lowered)


class TrustSearchAskTests(unittest.TestCase):
    def test_greeting_still_skips_orchestrator(self) -> None:
        hello = [ChatMessage(role="user", content="hello")]
        self.assertFalse(_needs_orchestrator("hello", hello, None))
        decision = _heuristic_route("hello", None)
        assert decision is not None
        self.assertFalse(decision.needs_web_search)
        gated = _gate_web_search("hello", decision)
        self.assertFalse(gated.needs_web_search)

    def test_eurovision_who_won_searches(self) -> None:
        from main import _apply_uncertainty_policy, _task_needs_web_search

        query = "who won the 2026 eurovision"
        self.assertTrue(_task_needs_web_search(query))
        decision = _heuristic_route(query, None)
        assert decision is not None
        self.assertTrue(decision.needs_web_search)
        gated = _gate_web_search(query, decision)
        self.assertTrue(gated.needs_web_search)
        self.assertFalse(
            _needs_orchestrator(query, [ChatMessage(role="user", content=query)], decision)
        )
        high_conf = RoutingDecision(
            selected_model="gemma4-12b",
            task_type="general",
            confidence=0.9,
            reasoning="default chat",
            routing_path="default",
        )
        out = _apply_uncertainty_policy(query, [], high_conf)
        self.assertTrue(out.needs_web_search)

    def test_talk_to_qwen_then_factual_still_searches(self) -> None:
        from main import _is_trivial_worker_turn, _resolve_worker_model

        user = "talk to Qwen then explain who won the 2026 eurovision"
        decision = _heuristic_route(user, None)
        assert decision is not None
        self.assertTrue(decision.selected_model.startswith("qwen"))
        self.assertTrue(decision.needs_web_search)
        self.assertFalse(_is_trivial_worker_turn(user, decision))
        self.assertEqual(_resolve_worker_model(decision), decision.selected_model)
        self.assertFalse(
            _needs_orchestrator(user, [ChatMessage(role="user", content=user)], decision)
        )
        gated = _gate_web_search(user, decision)
        self.assertTrue(gated.needs_web_search)
        self.assertTrue(gated.selected_model.startswith("qwen"))

    def test_web_suffix_requires_real_sources(self) -> None:
        from main import WEB_SEARCH_SYSTEM_SUFFIX

        lowered = WEB_SEARCH_SYSTEM_SUFFIX.lower()
        self.assertIn("sources:", lowered)
        self.assertIn("never invent", lowered)
        self.assertIn("could not verify", lowered)

    def test_strip_thinking_process_keeps_answer(self) -> None:
        from main import _maybe_strip_thinking_leak

        dumped = (
            "Thinking Process: I am Qwen, an Alibaba model.\n"
            "Final Answer: Stockholm is the capital of Sweden."
        )
        out = _maybe_strip_thinking_leak(dumped, trivial=False)
        self.assertIn("Stockholm", out)
        self.assertNotIn("Alibaba", out)
        self.assertNotIn("Thinking Process", out)


if __name__ == "__main__":
    unittest.main()
