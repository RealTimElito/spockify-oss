"""Spectacle arena — live model debates (Wave 10.10).

Models debate with on-screen votes, citation slots, and a heuristic judge.
Extends eval-board popcorn UX.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.spectacle")

_STORAGE = Path(os.getenv("STORAGE_ROOT", "/tmp/spockify"))
SPECTACLE_DIR = Path(os.getenv("SPECTACLE_DIR", str(_STORAGE / "spectacle")))

WorkerChatFn = Callable[..., Awaitable[dict[str, Any]]]


class DebateRequest(BaseModel):
    topic: str
    models: list[str] = Field(default_factory=lambda: ["gemma4-12b", "llama3.2-3b"])
    rounds: int = 2
    citations: list[str] = Field(default_factory=list)


class VoteRequest(BaseModel):
    debate_id: str
    model: str
    voter_id: Optional[str] = None


def _ensure_dir() -> Path:
    SPECTACLE_DIR.mkdir(parents=True, exist_ok=True)
    return SPECTACLE_DIR


def _heuristic_reply(model: str, topic: str, round_i: int, stance: str) -> str:
    return (
        f"[{model} · round {round_i + 1} · {stance}] "
        f"On «{topic[:120]}»: I argue that {stance} is stronger because "
        f"local inference keeps latency low and data private. "
        f"(Spectacle MVP — stub turn without live LLM.)"
    )


def _judge(turns: list[dict[str, Any]], votes: dict[str, int]) -> dict[str, Any]:
    if votes:
        winner = max(votes.items(), key=lambda kv: kv[1])[0]
        margin = sorted(votes.values(), reverse=True)
        score = margin[0] - (margin[1] if len(margin) > 1 else 0)
    else:
        # Prefer longer substantive turns.
        by_model: dict[str, int] = {}
        for t in turns:
            m = str(t.get("model") or "")
            by_model[m] = by_model.get(m, 0) + len(str(t.get("text") or ""))
        winner = max(by_model, key=by_model.get) if by_model else "draw"
        score = 0
    return {
        "winner": winner,
        "vote_margin": score,
        "summary": (
            f"Judge: {winner} edges the debate on votes/substance. "
            "Popcorn UX — not a calibrated Elo arena."
        ),
    }


async def run_debate(
    req: DebateRequest,
    *,
    worker_chat: Optional[WorkerChatFn] = None,
) -> dict[str, Any]:
    topic = (req.topic or "").strip()
    if not topic:
        return {"ok": False, "error": "topic required"}
    models = [m.strip() for m in (req.models or []) if m.strip()][:4]
    if len(models) < 2:
        models = ["gemma4-12b", "llama3.2-3b"]
    rounds = max(1, min(int(req.rounds or 2), 4))
    debate_id = uuid.uuid4().hex[:12]
    turns: list[dict[str, Any]] = []
    stances = ["pro", "con", "nuance", "wild-card"]

    for r in range(rounds):
        for i, model in enumerate(models):
            stance = stances[i % len(stances)]
            text = ""
            if worker_chat is not None:
                try:
                    messages = [
                        {
                            "role": "system",
                            "content": (
                                f"You are debating. Stance={stance}. "
                                "Be concise (≤120 words). Cite facts if possible."
                            ),
                        },
                        {
                            "role": "user",
                            "content": f"Debate topic: {topic}\nRound {r + 1}.",
                        },
                    ]
                    # worker_chat signature varies; best-effort.
                    result = await worker_chat(None, model, messages)
                    choices = result.get("choices") if isinstance(result, dict) else None
                    if choices:
                        text = (
                            choices[0].get("message", {}).get("content")
                            or choices[0].get("text")
                            or ""
                        )
                except Exception as exc:  # noqa: BLE001
                    LOG.warning("spectacle chat failed %s: %s", model, exc)
            if not text:
                text = _heuristic_reply(model, topic, r, stance)
            turns.append(
                {
                    "round": r + 1,
                    "model": model,
                    "stance": stance,
                    "text": text[:2000],
                    "ts": time.time(),
                }
            )

    votes = {m: 0 for m in models}
    debate = {
        "id": debate_id,
        "topic": topic,
        "models": models,
        "rounds": rounds,
        "turns": turns,
        "votes": votes,
        "citations": list(req.citations or [])[:12],
        "judge": _judge(turns, votes),
        "status": "live",
        "created_at": time.time(),
        "updated_at": time.time(),
        "note": "Spectacle MVP — popcorn debate; cast votes via POST /spectacle/vote",
    }
    path = _ensure_dir() / f"{debate_id}.json"
    path.write_text(json.dumps(debate, indent=2), encoding="utf-8")
    return {"ok": True, "debate": debate}


def vote(req: VoteRequest) -> dict[str, Any]:
    path = _ensure_dir() / f"{req.debate_id}.json"
    if not path.is_file():
        return {"ok": False, "error": "debate not found"}
    try:
        debate = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"ok": False, "error": "corrupt debate"}
    model = (req.model or "").strip()
    if model not in (debate.get("models") or []):
        return {"ok": False, "error": "model not in debate"}
    votes = dict(debate.get("votes") or {})
    votes[model] = int(votes.get(model) or 0) + 1
    debate["votes"] = votes
    debate["judge"] = _judge(debate.get("turns") or [], votes)
    debate["updated_at"] = time.time()
    path.write_text(json.dumps(debate, indent=2), encoding="utf-8")
    return {"ok": True, "debate": debate}


def get_debate(debate_id: str) -> Optional[dict[str, Any]]:
    path = _ensure_dir() / f"{debate_id}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def list_debates(limit: int = 20) -> list[dict[str, Any]]:
    root = _ensure_dir()
    out: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
        if len(out) >= limit:
            break
    return out
