"""Single source of truth for local the host chat models.

Imported by the router, parallel-agent planner, and tests. Keep aliases in
sync with OLLAMA_MODEL_MAP / pull-models.sh the host + Qwen sets.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional, Union

# Ollama think= payload: string levels, boolean on/off, or omit entirely.
THINKING_API_EFFORT = "effort"
THINKING_API_BOOLEAN = "boolean"
THINKING_API_NONE = "none"
THINKING_APIS = frozenset(
    {THINKING_API_EFFORT, THINKING_API_BOOLEAN, THINKING_API_NONE}
)
EFFORT_LEVELS = frozenset({"low", "medium", "high"})
# User chip: Off | Low | Medium | High | Heavy (Heavy = high + ensemble).
THINKING_MODES = frozenset({"off", "low", "medium", "high", "heavy"})
_LEGACY_MODE_MAP = {
    "light": "low",
    "think-off": "off",
    "think_off": "off",
    "disabled": "off",
    "none": "off",
}

# CJK + Hiragana/Katakana + Hangul + Arabic. Enough hits ⇒ Qwen specialist.
_NON_LATIN_SCRIPT_RE = re.compile(
    r"[\u0600-\u06ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff"
    r"\uac00-\ud7af\uf900-\ufaff]"
)
_NON_LATIN_SCRIPT_MIN = 4
_LONG_CJK_CHARS = 240

# Role order matches parallel_agents._ROLE_TEMPLATES / OWUI HEAVY_ENSEMBLE_PLAN.
HEAVY_ROLE_ORDER: tuple[str, ...] = ("explorer", "analyst", "builder", "skeptic")
DEFAULT_HEAVY_MODELS: tuple[str, ...] = (
    "gpt-oss-20b",
    "gemma4-12b",
    "gemma4-26b",
    "gemma4-12b",
)


@dataclass(frozen=True)
class ChatModel:
    """One local chat / vision / web worker the orchestrator may pick."""

    alias: str
    ollama_name: str
    family: str
    vram_class: str  # tiny | small | medium | large | xlarge
    strengths: tuple[str, ...]
    supports_thinking: bool
    thinking_api: str = THINKING_API_NONE  # effort | boolean | none
    light_remap: Optional[str] = None
    heavy_roles: tuple[str, ...] = ()
    notes: str = ""
    web_alias: bool = False


# Local chat models actually pulled on the host (plus web-* wrappers).
# Do not list cloud-only / excluded families (DeepSeek, Kimi cloud).
_MODELS: tuple[ChatModel, ...] = (
    ChatModel(
        alias="llama3.2-3b",
        ollama_name="llama3.2:3b",
        family="llama",
        vram_class="tiny",
        strengths=("speed", "greetings", "acks"),
        supports_thinking=False,
        notes="Greetings / tiny ack only. No think=.",
    ),
    ChatModel(
        alias="llama3.1-8b",
        ollama_name="llama3.1:8b",
        family="llama",
        vram_class="small",
        strengths=("speed", "voice", "summaries"),
        supports_thinking=False,
        notes="Light / voice worker. No think=.",
    ),
    ChatModel(
        alias="llama3.3-70b",
        ollama_name="llama3.3:70b",
        family="llama",
        vram_class="xlarge",
        strengths=("english_chat", "deep_chat"),
        supports_thinking=False,
        notes="Large English chat. No think=. Sequential load.",
    ),
    ChatModel(
        alias="gemma4-12b",
        ollama_name="gemma4:12b",
        family="gemma",
        vram_class="small",
        strengths=("english_chat", "reasoning", "speed"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        heavy_roles=("analyst", "skeptic"),
        notes="Default English chat. think=low|medium|high.",
    ),
    ChatModel(
        alias="gemma4-26b",
        ollama_name="gemma4:26b",
        family="gemma",
        vram_class="medium",
        strengths=("english_chat", "reasoning", "analysis", "vision"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        heavy_roles=("builder",),
        notes="Gemini-class analysis + default vision. think=low|medium|high.",
    ),
    ChatModel(
        alias="gemma4-31b",
        ollama_name="gemma4:31b",
        family="gemma",
        vram_class="large",
        strengths=("english_chat", "reasoning", "analysis"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        light_remap="gemma4-12b",
        heavy_roles=("analyst", "builder"),
        notes=(
            "Dense 31B English/reasoning. think=low|medium|high. "
            "Low remaps to 12b. Heavy may pick this for one English slot."
        ),
    ),
    ChatModel(
        alias="gpt-oss-20b",
        ollama_name="gpt-oss:20b",
        family="gpt-oss",
        vram_class="medium",
        strengths=("code", "reasoning", "speed"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        heavy_roles=("explorer",),
        notes="Fast code / Heavy Explorer. think=low|medium|high (bool ignored).",
    ),
    ChatModel(
        alias="gpt-oss-120b",
        ollama_name="gpt-oss:120b",
        family="gpt-oss",
        vram_class="xlarge",
        strengths=("code", "architecture", "deep_reasoning", "agentic"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        heavy_roles=("builder",),
        notes=(
            "Primary quality code / deep work. think=low|medium|high. "
            "Heavy: at most one slot (usually Builder)."
        ),
    ),
    ChatModel(
        alias="codestral",
        ollama_name="spockify-coder",
        family="codestral",
        vram_class="medium",
        strengths=("code",),
        supports_thinking=False,
        notes="Code alternative. No think=.",
    ),
    ChatModel(
        alias="qwen3.5-9b",
        ollama_name="qwen3.5:9b",
        family="qwen",
        vram_class="small",
        strengths=("cjk", "arabic", "hangul", "multilingual", "reasoning", "speed"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        heavy_roles=("analyst", "skeptic"),
        notes="Short CJK / Arabic / Hangul. think=low|medium|high.",
    ),
    ChatModel(
        alias="qwen3.6-27b",
        ollama_name="qwen3.6:27b",
        family="qwen",
        vram_class="medium",
        strengths=("cjk", "arabic", "hangul", "multilingual", "reasoning"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        light_remap="qwen3.5-9b",
        heavy_roles=("analyst",),
        notes="Mid Qwen3.6. Low remaps to 9b. think=low|medium|high.",
    ),
    ChatModel(
        alias="qwen3.6-35b",
        ollama_name="qwen3.6:35b",
        family="qwen",
        vram_class="large",
        strengths=("cjk", "arabic", "hangul", "multilingual", "reasoning"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        light_remap="qwen3.5-9b",
        heavy_roles=("analyst", "builder"),
        notes="Hard / long CJK. Low remaps to 9b. think=low|medium|high.",
    ),
    ChatModel(
        alias="qwen3.6-coder-27b",
        ollama_name="qwen3.6:27b-coding",
        family="qwen",
        vram_class="medium",
        strengths=("code",),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        heavy_roles=("builder",),
        notes=(
            "On-demand Qwen3.6 27B coding specialist. think=low|medium|high. "
            "Not the default English code route (gpt-oss-120b). "
            "Heavy may pick this for the Builder slot."
        ),
    ),
    ChatModel(
        alias="nemotron-nano-4b",
        ollama_name="nemotron-3-nano:4b",
        family="nemotron",
        vram_class="tiny",
        strengths=("routing", "speed"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        notes="Orchestrator / routing. think=low|medium|high.",
    ),
    ChatModel(
        alias="nemotron-mini",
        ollama_name="nemotron-mini",
        family="nemotron",
        vram_class="tiny",
        strengths=("speed", "agentic"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
    ),
    ChatModel(
        alias="nemotron-nano-30b",
        ollama_name="nemotron-3-nano:30b",
        family="nemotron",
        vram_class="large",
        strengths=("reasoning", "agentic"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        notes="Not prewarmed.",
    ),
    ChatModel(
        alias="nemotron-70b",
        ollama_name="nemotron",
        family="nemotron",
        vram_class="xlarge",
        strengths=("reasoning", "agentic"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        notes="Llama-3.1-Nemotron-70B. Sequential load.",
    ),
    ChatModel(
        alias="mathstral",
        ollama_name="mathstral",
        family="mistral",
        vram_class="small",
        strengths=("math",),
        supports_thinking=False,
        notes="Proofs / equations.",
    ),
    ChatModel(
        alias="mistral-nemo",
        ollama_name="mistral-nemo",
        family="mistral",
        vram_class="small",
        strengths=("english_chat",),
        supports_thinking=False,
    ),
    ChatModel(
        alias="mistral-small3.1",
        ollama_name="mistral-small3.1",
        family="mistral",
        vram_class="medium",
        strengths=("english_chat",),
        supports_thinking=False,
    ),
    ChatModel(
        alias="mistral-small3.2",
        ollama_name="mistral-small3.2:24b",
        family="mistral",
        vram_class="medium",
        strengths=("vision", "english_chat"),
        supports_thinking=False,
        notes="Vision fallback.",
    ),
    ChatModel(
        alias="magistral",
        ollama_name="magistral",
        family="mistral",
        vram_class="medium",
        strengths=("reasoning", "english_chat", "multilingual"),
        supports_thinking=True,
        thinking_api=THINKING_API_BOOLEAN,
        notes=(
            "Mistral Magistral 24B reasoning. think=true|false (never effort "
            "strings). On-demand, not prewarmed."
        ),
    ),
    ChatModel(
        alias="devstral-small-2",
        ollama_name="devstral-small-2",
        family="mistral",
        vram_class="medium",
        strengths=("code", "agentic", "vision"),
        supports_thinking=False,
        notes=(
            "Devstral Small 2 24B agentic coder (on-demand). No think=. "
            "Not the default English code route (gpt-oss-120b)."
        ),
    ),
    ChatModel(
        alias="ministral-3-14b",
        ollama_name="ministral-3:14b",
        family="mistral",
        vram_class="small",
        strengths=("english_chat", "vision", "speed"),
        supports_thinking=False,
        notes="Ministral 3 14B compact instruct+vision. No think=. On-demand.",
    ),
    ChatModel(
        alias="phi4",
        ollama_name="phi4",
        family="phi",
        vram_class="small",
        strengths=("stem", "english_chat"),
        supports_thinking=False,
    ),
    ChatModel(
        alias="phi4-mini",
        ollama_name="phi4-mini",
        family="phi",
        vram_class="tiny",
        strengths=("speed", "stem"),
        supports_thinking=False,
    ),
    ChatModel(
        alias="web-gemma",
        ollama_name="gemma4:12b",
        family="gemma",
        vram_class="small",
        strengths=("web_search", "english_chat", "reasoning"),
        supports_thinking=True,
        thinking_api=THINKING_API_EFFORT,
        web_alias=True,
        notes="Live facts + search. think=low|medium|high.",
    ),
    ChatModel(
        alias="web-codestral",
        ollama_name="spockify-coder",
        family="codestral",
        vram_class="medium",
        strengths=("web_search", "code"),
        supports_thinking=False,
        web_alias=True,
        notes="Docs + code with search. No think=.",
    ),
    ChatModel(
        alias="web-llama",
        ollama_name="llama3.1:8b",
        family="llama",
        vram_class="small",
        strengths=("web_search", "voice", "speed"),
        supports_thinking=False,
        web_alias=True,
        notes="Faster spoken synthesis after search. No think=.",
    ),
    ChatModel(
        alias="llava-llama3",
        ollama_name="llava-llama3",
        family="llava",
        vram_class="small",
        strengths=("vision",),
        supports_thinking=False,
    ),
    ChatModel(
        alias="llava-7b",
        ollama_name="llava:7b",
        family="llava",
        vram_class="small",
        strengths=("vision",),
        supports_thinking=False,
    ),
    ChatModel(
        alias="llava-13b",
        ollama_name="llava:13b",
        family="llava",
        vram_class="small",
        strengths=("vision",),
        supports_thinking=False,
    ),
)

MODELS: dict[str, ChatModel] = {m.alias: m for m in _MODELS}

# Extra aliases that resolve to a catalog entry (legacy / remap names).
_ALIAS_REDIRECT: dict[str, str] = {
    "gemma4-27b": "gemma4-26b",
    "gemma3-12b": "gemma4-12b",
    "gemma3-27b": "gemma4-26b",
    "gemma3-4b": "gemma4-12b",
    "qwen3.6-27b-coding": "qwen3.6-coder-27b",
    "qwen3.6-coder": "qwen3.6-coder-27b",
    "codestral-latest": "codestral",
    "codestral-22b": "codestral",
    "nemotron-3-nano": "nemotron-nano-4b",
    "nemotron-3-nano-4b": "nemotron-nano-4b",
    "spockify-chat": "llama3.2-3b",
    "spockify-coder": "codestral",
    "magistral-24b": "magistral",
    "devstral-small-2:24b": "devstral-small-2",
    "devstral-small2": "devstral-small-2",
    "ministral-3:14b": "ministral-3-14b",
    "ministral-14b": "ministral-3-14b",
}

# Family-name fallback when the alias is unknown (Ollama tag or wrapper).
_THINKING_FAMILIES = frozenset({"gemma", "gpt-oss", "nemotron", "qwen", "kimi"})
_EFFORT_FAMILIES = frozenset({"gemma", "gpt-oss", "nemotron", "qwen", "kimi"})
_NO_THINK_FAMILIES = frozenset({"llama", "codestral", "mistral", "phi", "llava"})


def looks_non_latin_script(text: str) -> bool:
    """True when the prompt is substantially CJK, Hangul, or Arabic."""
    if not text:
        return False
    return len(_NON_LATIN_SCRIPT_RE.findall(text)) >= _NON_LATIN_SCRIPT_MIN


# User asked to talk to / use / switch to a named family (Auto must honor this).
_EXPLICIT_INTENT = (
    r"(?:(?:please|pls|kindly)\s+)?"
    r"(?:(?:can|could|would|will)\s+(?:you|i)\s+)?"
    r"(?:(?:just|please|pls)\s+)?"
    r"(?:let\s+me\s+)?"
    r"(?:"
    r"talk\s+to|speak\s+(?:to|with)|chat\s+(?:with|to)|"
    r"switch\s+to|change\s+to|swap\s+to|route\s+to|"
    r"i\s+want\s+(?:to\s+)?(?:talk\s+to|speak\s+(?:to|with)|use|chat\s+with)|"
    r"i'?d\s+like\s+to\s+(?:talk\s+to|use|chat\s+with)|"
    r"use|using"
    r")"
)
# Questions *about* a model are not a switch request.
_ABOUT_MODEL_RE = re.compile(
    r"(?i)^\s*(?:how\s+(?:do\s+i|can\s+i|to)|what\s+(?:is|are)|what'?s|"
    r"tell\s+me\s+about|who\s+is|explain|compare)\b"
)
# Longest family token first. Empty alias → pick Qwen size from the prompt.
_EXPLICIT_FAMILY_SPECS: tuple[tuple[str, str], ...] = (
    (r"qwen3?\.?6[\s\-]?coder(?:[\s\-]?27b)?|qwen[\s\-]?coder", "qwen3.6-coder-27b"),
    (r"qwen3?\.?6[\s\-]?35b", "qwen3.6-35b"),
    (r"qwen3?\.?6[\s\-]?27b", "qwen3.6-27b"),
    (r"qwen3?\.?5(?:[\s\-]?9b)?", "qwen3.5-9b"),
    (r"qwen3?\.?6", ""),
    (r"qwen", ""),
    (r"gpt[\s\-]?oss[\s\-]?120b", "gpt-oss-120b"),
    (r"gpt[\s\-]?oss[\s\-]?20b", "gpt-oss-20b"),
    (r"gpt[\s\-]?oss", "gpt-oss-120b"),
    (r"gemma4?[\s\-]?31b", "gemma4-31b"),
    (r"gemma4?[\s\-]?26b", "gemma4-26b"),
    (r"gemma4?[\s\-]?12b", "gemma4-12b"),
    (r"gemma4?|gemma", "gemma4-12b"),
    (r"magistral(?:[\s\-]?24b)?", "magistral"),
    (r"llama\s*3\.2[\s\-:]*8b", "llama3.1-8b"),
    (r"llama3?\.?3(?:[\s\-]?70b)?", "llama3.3-70b"),
    (r"llama3?\.?1(?:[\s\-]?8b)?", "llama3.1-8b"),
    (r"llama3?\.?2(?:[\s\-]?3b)?", "llama3.2-3b"),
    (r"llama", "llama3.1-8b"),
    (r"nemotron(?:[\s\-]?70b)?", "nemotron-70b"),
    (r"codestral", "codestral"),
    (r"mathstral", "mathstral"),
    (r"devstral(?:[\s\-]?small(?:[\s\-]?2)?)?", "devstral-small-2"),
    (r"ministral(?:[\s\-]?3)?(?:[\s\-]?14b)?", "ministral-3-14b"),
    (r"phi4[\s\-]?mini", "phi4-mini"),
    (r"phi4|\bphi\b", "phi4"),
    (r"mistral[\s\-]?nemo", "mistral-nemo"),
    (r"mistral", "mistral-nemo"),
)
_EXPLICIT_MATCHERS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (
        re.compile(
            rf"(?i)(?:{_EXPLICIT_INTENT})\s+(?:the\s+)?(?:local\s+)?"
            rf"(?:{pat})\b"
        ),
        alias,
    )
    for pat, alias in _EXPLICIT_FAMILY_SPECS
)
_FAMILY_DISPLAY = {
    "qwen": "Qwen",
    "gpt-oss": "gpt-oss",
    "gemma": "Gemma",
    "llama": "Llama",
    "nemotron": "Nemotron",
    "codestral": "Codestral",
    "mistral": "Mistral",
    "phi": "Phi",
    "llava": "LLaVA",
}


def resolve_explicit_model_request(user_msg: str) -> Optional[str]:
    """Alias if the user asked to talk to / use / switch to a named family.

    Mid-conversation switches count. Questions about a model do not.
    Qwen: 9b short/general, 35b long CJK, coder-27b if they said coder.
    """
    text = (user_msg or "").strip()
    if not text or _ABOUT_MODEL_RE.search(text):
        return None
    for cre, alias in _EXPLICIT_MATCHERS:
        if not cre.search(text):
            continue
        if alias:
            return alias
        if looks_non_latin_script(text) and len(text) >= _LONG_CJK_CHARS:
            return "qwen3.6-35b"
        return "qwen3.5-9b"
    return None


def leftover_after_explicit_request(user_msg: str) -> str:
    """User text remaining after stripping a named-family switch phrase.

    Empty (or a please/thanks filler) means the turn is only a model switch.
    """
    text = (user_msg or "").strip()
    if not text:
        return ""
    for cre, _alias in _EXPLICIT_MATCHERS:
        text = cre.sub(" ", text)
    text = re.sub(
        r"(?i)\b(?:please|pls|kindly|thanks|thank you|now|just)\b",
        " ",
        text,
    )
    return re.sub(r"\s+", " ", text).strip(" \t\r\n.,!?;:-")


def family_display_name(alias: str) -> str:
    """Short user-facing family label (Qwen, Gemma, …)."""
    raw = (alias or "").strip().lower()
    if "magistral" in raw:
        return "Magistral"
    row = get_model(alias)
    family = row.family if row is not None else raw.split("-", 1)[0]
    return _FAMILY_DISPLAY.get(family, family or alias)


def _canonical_alias(name: str) -> str:
    raw = (name or "").strip().lower()
    if not raw:
        return ""
    if raw in MODELS:
        return raw
    if raw in _ALIAS_REDIRECT:
        return _ALIAS_REDIRECT[raw]
    # gpt-oss:20b / gemma4:12b → gpt-oss-20b / gemma4-12b
    hyphen = raw.replace(":", "-")
    if hyphen in MODELS:
        return hyphen
    if hyphen in _ALIAS_REDIRECT:
        return _ALIAS_REDIRECT[hyphen]
    return raw


def get_model(name: str) -> Optional[ChatModel]:
    """Return the catalog row for an alias or Ollama tag, if known."""
    return MODELS.get(_canonical_alias(name))


def all_models() -> tuple[ChatModel, ...]:
    return _MODELS


def thinking_api_kind(name: str) -> str:
    """Ollama think= API: effort (low|medium|high), boolean, or none.

    Catalog first. Unknown Gemma/Qwen/Nemotron/gpt-oss tags get effort.
    llama / codestral / mistral / phi / llava are none (never send think=).
    Magistral is boolean; the substring 'mistral' must not steal it.
    """
    row = get_model(name)
    if row is not None:
        api = (row.thinking_api or "").strip().lower()
        if api in THINKING_APIS:
            return api
        return THINKING_API_EFFORT if row.supports_thinking else THINKING_API_NONE
    lowered = (name or "").strip().lower()
    # "mistral" is a substring of "magistral".
    if "magistral" in lowered:
        return THINKING_API_BOOLEAN
    if any(fam in lowered for fam in _NO_THINK_FAMILIES):
        if "nemotron" in lowered or "gemma" in lowered:
            return THINKING_API_EFFORT
        return THINKING_API_NONE
    if any(fam in lowered for fam in _EFFORT_FAMILIES):
        return THINKING_API_EFFORT
    if any(fam in lowered for fam in _THINKING_FAMILIES):
        return THINKING_API_BOOLEAN
    return THINKING_API_NONE


def supports_thinking(name: str) -> bool:
    """Whether this worker accepts any think= payload (effort or boolean)."""
    return thinking_api_kind(name) != THINKING_API_NONE


def normalize_thinking_mode(raw: Optional[str]) -> str:
    """Map a client/legacy value to off|low|medium|high|heavy."""
    mode = (raw or "").strip().lower()
    if mode in _LEGACY_MODE_MAP:
        return _LEGACY_MODE_MAP[mode]
    if mode in THINKING_MODES:
        return mode
    return ""


def user_effort_level(thinking_mode: str) -> Optional[str]:
    """low|medium|high for Ollama effort, or None when the chip is Off."""
    mode = normalize_thinking_mode(thinking_mode) or "medium"
    if mode == "off":
        return None
    if mode == "heavy":
        return "high"
    if mode in EFFORT_LEVELS:
        return mode
    return "medium"


def ollama_think_value(
    name: str, thinking_mode: str
) -> Optional[Union[bool, str]]:
    """Value for Ollama think=, or None to omit the field.

    Off: never send think= (boolean models get False so Gemma actually
    disables default thinking). Low/Medium/High/Heavy: string effort when
    the model advertises it; True for boolean-only; omit for none.
    """
    api = thinking_api_kind(name)
    if api == THINKING_API_NONE:
        return None
    mode = normalize_thinking_mode(thinking_mode) or "medium"
    if mode == "off":
        # gpt-oss ignores boolean and defaults to medium if omitted.
        # Gemma/Qwen/Nemotron default to thinking unless think=false.
        lowered = (name or "").strip().lower()
        if "gpt-oss" in lowered:
            return None
        return False
    effort = user_effort_level(mode) or "medium"
    if api == THINKING_API_EFFORT:
        return effort
    return True


def apply_think_to_body(body: dict[str, Any], name: str, think: Any) -> None:
    """Set body['think'] from a caller value, never for none-API models.

    Accepts a chip mode string, an effort string, True/False, or None.
    """
    api = thinking_api_kind(name)
    if api == THINKING_API_NONE:
        body.pop("think", None)
        return
    if think is None:
        value = ollama_think_value(name, "off")
        if value is None:
            body.pop("think", None)
        else:
            body["think"] = value
        return
    if isinstance(think, str):
        lowered = think.strip().lower()
        if lowered in THINKING_MODES or lowered in _LEGACY_MODE_MAP:
            value = ollama_think_value(name, lowered)
        elif lowered in EFFORT_LEVELS:
            value = lowered if api == THINKING_API_EFFORT else True
        elif lowered in ("off", "false", "no", "0"):
            value = ollama_think_value(name, "off")
        else:
            value = ollama_think_value(name, "medium")
        if value is None:
            body.pop("think", None)
        else:
            body["think"] = value
        return
    if think is True:
        body["think"] = (
            "medium" if api == THINKING_API_EFFORT else True
        )
        return
    if think is False:
        # Gemma/Qwen/Nemotron default-on unless think=false. gpt-oss ignores
        # boolean and defaults to medium — callers must pass None or "low".
        lowered = (name or "").strip().lower()
        if "gpt-oss" in lowered:
            body.pop("think", None)
            return
        body["think"] = False
        return
    body.pop("think", None)


def light_remap(name: str) -> Optional[str]:
    """Smaller same-family worker for Off/Low, if the catalog says so."""
    row = get_model(name)
    return row.light_remap if row else None


def thinking_capable_aliases() -> tuple[str, ...]:
    return tuple(m.alias for m in _MODELS if m.supports_thinking)


def heavy_eligible(name: str, role: str) -> bool:
    row = get_model(name)
    if row is None:
        return False
    return role in row.heavy_roles


def plan_heavy_models(user_msg: str) -> list[str]:
    """Default English Heavy pool; swap Analyst/Skeptic to Qwen on CJK.

    Explorer stays gpt-oss-20b (code/search). Builder stays gemma4-26b
    unless the turn is long CJK — then Builder becomes qwen3.6-35b.
    """
    pool = list(DEFAULT_HEAVY_MODELS)
    if not looks_non_latin_script(user_msg):
        return pool
    long_ask = len(user_msg or "") >= _LONG_CJK_CHARS
    qwen = "qwen3.6-35b" if long_ask else "qwen3.5-9b"
    # Explorer (0) stays gpt-oss-20b. Analyst (1) + Skeptic (3) → Qwen.
    pool[1] = qwen
    pool[3] = qwen
    if long_ask:
        pool[2] = "qwen3.6-35b"
    return pool


_HEAVY_TOOLS = frozenset({"search", "browse"})
_VRAM_RANK = {"tiny": 0, "small": 1, "medium": 2, "large": 3, "xlarge": 4}


def sanitize_heavy_tools(raw: Any) -> Optional[list[str]]:
    """Return search/browse list, empty list for none, or None to keep defaults."""
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        return None
    out: list[str] = []
    for item in raw:
        name = str(item or "").strip().lower()
        if name in _HEAVY_TOOLS and name not in out:
            out.append(name)
    return out


def sanitize_heavy_models(chosen: list[str], user_msg: str) -> list[str]:
    """Catalog aliases only; max one xlarge; CJK still prefers Qwen."""
    fallback = plan_heavy_models(user_msg) or list(DEFAULT_HEAVY_MODELS)
    n = len(chosen) if chosen else len(fallback)
    out: list[str] = []
    for i in range(n):
        raw = chosen[i] if i < len(chosen) else ""
        alias = _canonical_alias(raw)
        if alias not in MODELS:
            alias = fallback[i % len(fallback)]
        out.append(alias)

    if looks_non_latin_script(user_msg):
        qplan = plan_heavy_models(user_msg)
        for i, alias in enumerate(out):
            if i >= len(qplan):
                break
            want = get_model(qplan[i])
            have = get_model(alias)
            if want is None or want.family != "qwen":
                continue
            if have is not None and have.family == "qwen":
                continue
            # Keep gpt-oss on Explorer/Builder for CJK code asks.
            if i in (0, 2) and have is not None and have.family == "gpt-oss":
                continue
            out[i] = qplan[i]

    xlarge_i = [
        i
        for i, alias in enumerate(out)
        if (get_model(alias) and get_model(alias).vram_class == "xlarge")
    ]
    for i in xlarge_i[1:]:
        replacement = fallback[i % len(fallback)]
        row = get_model(replacement)
        if row is not None and row.vram_class == "xlarge":
            replacement = "gpt-oss-20b"
        out[i] = replacement
    if xlarge_i:
        keep = xlarge_i[0]
        cjk = looks_non_latin_script(user_msg)
        demote = "qwen3.5-9b" if cjk else "gemma4-12b"
        for i, alias in enumerate(out):
            if i == keep:
                continue
            row = get_model(alias)
            if row is not None and _VRAM_RANK.get(row.vram_class, 0) >= 3:
                out[i] = demote
    return out


def orchestrator_catalog_short() -> str:
    """Tiny worker list for the compact orchestrator prompt."""
    return (
        "Pick only: gpt-oss-120b (code), gpt-oss-20b, codestral (code, no think=), "
        "gemma4-12b (default EN), gemma4-26b, gemma4-31b (hard EN), "
        "llama3.2-3b (greetings, no think=), llama3.1-8b, web-gemma (live facts), "
        "qwen3.5-9b (short CJK), qwen3.6-35b (long CJK), qwen3.6-coder-27b, "
        "mathstral, magistral, nemotron-nano-4b. Named family → that worker now. "
        "JSON only; never write an identity essay."
    )


def orchestrator_catalog_text() -> str:
    """Compact worker table for the orchestrator system prompt."""
    lines = [
        "Local workers (alias · family · VRAM · think-api · strengths):",
    ]
    for m in _MODELS:
        api = thinking_api_kind(m.alias)
        strengths = ",".join(m.strengths)
        roles = f" heavy={','.join(m.heavy_roles)}" if m.heavy_roles else ""
        light = f" low→{m.light_remap}" if m.light_remap else ""
        lines.append(
            f"- {m.alias} · {m.family} · {m.vram_class} · {api} · "
            f"{strengths}{roles}{light}"
        )
    lines.append(
        "English chat → gemma4-12b (quality gemma4-31b, fallback gemma4-26b). "
        "Code → gpt-oss-120b (fallback gpt-oss-20b / codestral; "
        "on-demand qwen3.6-coder-27b / devstral-small-2). "
        "Mistral reasoning → magistral. Compact Mistral chat/vision → "
        "ministral-3-14b. "
        "Short CJK/Arabic/Hangul → qwen3.5-9b; long CJK (≥240 chars) → qwen3.6-35b. "
        "Do not use Qwen for English-only chat or for code UNLESS the user "
        "asked to talk to / use / switch to that family — then honor it "
        "(qwen3.5-9b short, qwen3.6-35b long CJK, qwen3.6-coder-27b if coder). "
        "Named-model asks (talk to Qwen, use gpt-oss, switch to gemma, use "
        "magistral) → that family immediately, including mid-conversation. "
        "JSON route only; never write an identity essay. "
        "Do not steal default English code from gpt-oss-120b. "
        "Greetings → llama3.2-3b. Live facts → web-gemma. "
        "Never DeepSeek / Kimi cloud. "
        "think-api=effort accepts think=low|medium|high; boolean is on/off "
        "(magistral); none never gets think= "
        "(llama/codestral/devstral/ministral/mathstral/phi/llava)."
    )
    return "\n".join(lines)


def thinking_policy_text(
    *,
    thinking_mode: str,
    think_enabled: bool = True,
) -> str:
    """Extra orchestrator constraint for this turn (Off/Low/Medium/High/Heavy)."""
    mode = normalize_thinking_mode(thinking_mode)
    if not think_enabled:
        mode = "off"
    if mode == "off":
        return (
            "Thinking chip is Off. Never require think=. You may pick any "
            "worker including llama / codestral / mathstral. Prefer fast/cheap "
            "for greetings and acks. A leftover think-capable model is OK; "
            "the router will omit think=."
        )
    if mode == "low":
        return (
            "Thinking effort cap is Low. Prefer a fast/cheap worker. "
            "llama / codestral are fine. Remap qwen3.6-* to qwen3.5-9b. "
            "You may pick think-capable models; the router sends think=low "
            "(or boolean true). Do not raise effort."
        )
    if mode == "high":
        return (
            "Thinking effort cap is High (single worker, not the ensemble). "
            "Prefer the best think-capable worker for the query "
            "(gemma / gpt-oss / nemotron / qwen / magistral). Ask when "
            "intent or private details are missing; search public facts. "
            "Do not pick llama for "
            "High unless it is a leftover specialist. You may LOWER effort "
            "to medium or low for a simple greeting/ack — put that in "
            "reasoning as effort=low|medium. Otherwise assume high. "
            "CJK/Arabic/Hangul → Qwen (9b short, 35b long)."
        )
    if mode == "heavy":
        return (
            "Thinking is Heavy: high effort + 4-agent ensemble. Do not lower. "
            "ASK FIRST: if the query needs user intent, a choice, or private "
            "details, fill ask_user and do not plan workers yet. Do not ask "
            "for facts web search can get — those need tools=[\"search\"]. "
            "If ask_user is empty, plan Explorer/Analyst/Builder (wave 1, "
            "parallel) then Skeptic (wave 2, critiques their outputs). "
            "Pick models/tools/skill per role from the catalog. Max one "
            "gpt-oss-120b. CJK → Qwen. Code → gpt-oss or qwen3.6-coder-27b. "
            "English chat → Gemma (12b/26b/31b). Router omits think= for "
            "llama/codestral/devstral."
        )
    return (
        "Thinking effort cap is Medium (default auto path). Prefer "
        "think-capable workers (gemma / gpt-oss / nemotron / qwen / "
        "magistral) for real questions. Ask when intent or private details "
        "are missing; search public facts (do not ask instead of search). "
        "llama / codestral / devstral are "
        "OK for greetings and code-alt; the router will not send them "
        "think=. You may LOWER "
        "effort to low for a simple greeting/ack — put that in reasoning "
        "as effort=low. Do not raise above medium. "
        "CJK/Arabic/Hangul → Qwen (9b short, 35b long)."
    )
