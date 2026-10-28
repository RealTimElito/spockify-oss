"""Simple continuous eval / arena board (Wave 9.7).

Saved prompt sets run against selected models; store scores + latency under
EVAL_BOARD_DIR.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.eval")

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/var/lib/spockify"))
EVAL_BOARD_DIR = Path(os.getenv("EVAL_BOARD_DIR", str(STORAGE_ROOT / "eval-board")))
EVAL_DEFAULT_MODELS = [
    m.strip()
    for m in os.getenv(
        "EVAL_DEFAULT_MODELS", "llama3.2-3b,gemma4-12b,spockify-auto"
    ).split(",")
    if m.strip()
]


class EvalPrompt(BaseModel):
    id: str = ""
    text: str
    label: str = ""


class EvalPromptSet(BaseModel):
    id: str = ""
    name: str
    prompts: list[EvalPrompt] = Field(default_factory=list)
    models: list[str] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class EvalRunRequest(BaseModel):
    set_id: str
    models: list[str] = Field(default_factory=list)
    judge: str = "heuristic"  # heuristic | length


class EvalScore(BaseModel):
    prompt_id: str
    model: str
    score: float
    latency_ms: float
    preview: str = ""
    error: str = ""


WorkerChatFn = Callable[..., Awaitable[dict[str, Any]]]


def _ensure_dir() -> Path:
    EVAL_BOARD_DIR.mkdir(parents=True, exist_ok=True)
    (EVAL_BOARD_DIR / "sets").mkdir(parents=True, exist_ok=True)
    (EVAL_BOARD_DIR / "runs").mkdir(parents=True, exist_ok=True)
    return EVAL_BOARD_DIR


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _set_path(set_id: str) -> Path:
    return _ensure_dir() / "sets" / f"{set_id}.json"


def list_prompt_sets() -> list[dict[str, Any]]:
    _ensure_dir()
    out: list[dict[str, Any]] = []
    for path in sorted((EVAL_BOARD_DIR / "sets").glob("*.json")):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:  # noqa: BLE001
            LOG.warning("eval set read failed %s: %s", path, exc)
    return out


def get_prompt_set(set_id: str) -> Optional[dict[str, Any]]:
    path = _set_path(set_id)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_prompt_set(body: EvalPromptSet) -> dict[str, Any]:
    _ensure_dir()
    sid = body.id or str(uuid.uuid4())[:12]
    prompts = []
    for p in body.prompts:
        prompts.append(
            {
                "id": p.id or str(uuid.uuid4())[:8],
                "text": p.text,
                "label": p.label or p.text[:40],
            }
        )
    entry = {
        "id": sid,
        "name": body.name or "Untitled set",
        "prompts": prompts,
        "models": body.models or list(EVAL_DEFAULT_MODELS),
        "created_at": body.created_at or _now(),
        "updated_at": _now(),
    }
    _set_path(sid).write_text(json.dumps(entry, indent=2), encoding="utf-8")
    return entry


def delete_prompt_set(set_id: str) -> bool:
    path = _set_path(set_id)
    if path.is_file():
        path.unlink()
        return True
    return False


def _heuristic_score(prompt: str, answer: str) -> float:
    """Simple non-LLM judge: non-empty, reasonable length, little repetition."""
    a = (answer or "").strip()
    if not a:
        return 0.0
    score = 0.4
    n = len(a)
    if 40 <= n <= 4000:
        score += 0.3
    elif n > 20:
        score += 0.15
    # Prefer answers that echo a keyword from the prompt.
    words = [w.lower() for w in re_words(prompt) if len(w) > 4][:8]
    hits = sum(1 for w in words if w in a.lower())
    if words:
        score += 0.3 * min(1.0, hits / max(1, len(words) * 0.5))
    return round(min(1.0, score), 3)


def re_words(text: str) -> list[str]:
    import re

    return re.findall(r"[A-Za-z0-9_]+", text or "")


async def run_eval(
    req: EvalRunRequest,
    *,
    worker_chat: WorkerChatFn,
) -> dict[str, Any]:
    ps = get_prompt_set(req.set_id)
    if not ps:
        raise ValueError("prompt set not found")
    models = req.models or ps.get("models") or EVAL_DEFAULT_MODELS
    scores: list[dict[str, Any]] = []
    for prompt in ps.get("prompts") or []:
        pid = prompt.get("id") or ""
        text = prompt.get("text") or ""
        for model in models:
            t0 = time.perf_counter()
            err = ""
            answer = ""
            try:
                data = await worker_chat(
                    None,
                    model,
                    [{"role": "user", "content": text}],
                    max_tokens=512,
                    temperature=0.2,
                )
                if isinstance(data, dict):
                    choices = data.get("choices") or []
                    if choices:
                        answer = (
                            (choices[0].get("message") or {}).get("content") or ""
                        )
            except Exception as exc:  # noqa: BLE001
                err = str(exc)
            latency = (time.perf_counter() - t0) * 1000
            score = 0.0 if err else _heuristic_score(text, answer)
            scores.append(
                {
                    "prompt_id": pid,
                    "prompt_label": prompt.get("label") or text[:40],
                    "model": model,
                    "score": score,
                    "latency_ms": round(latency, 1),
                    "preview": (answer or err)[:240],
                    "error": err,
                }
            )

    by_model: dict[str, dict[str, Any]] = {}
    for s in scores:
        m = s["model"]
        slot = by_model.setdefault(
            m, {"model": m, "scores": [], "latencies": [], "errors": 0}
        )
        if s.get("error"):
            slot["errors"] += 1
        else:
            slot["scores"].append(s["score"])
            slot["latencies"].append(s["latency_ms"])
    leaderboard = []
    for m, slot in by_model.items():
        sc = slot["scores"]
        lt = slot["latencies"]
        leaderboard.append(
            {
                "model": m,
                "avg_score": round(sum(sc) / len(sc), 3) if sc else 0.0,
                "avg_latency_ms": round(sum(lt) / len(lt), 1) if lt else 0.0,
                "n": len(sc) + slot["errors"],
                "errors": slot["errors"],
            }
        )
    leaderboard.sort(key=lambda x: (-x["avg_score"], x["avg_latency_ms"]))

    run = {
        "id": str(uuid.uuid4())[:12],
        "set_id": req.set_id,
        "set_name": ps.get("name"),
        "judge": req.judge,
        "created_at": _now(),
        "scores": scores,
        "leaderboard": leaderboard,
    }
    path = _ensure_dir() / "runs" / f"{run['id']}.json"
    path.write_text(json.dumps(run, indent=2), encoding="utf-8")
    return run


def list_runs(limit: int = 30) -> list[dict[str, Any]]:
    _ensure_dir()
    runs = []
    paths = sorted(
        (EVAL_BOARD_DIR / "runs").glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for path in paths[:limit]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            runs.append(
                {
                    "id": data.get("id"),
                    "set_id": data.get("set_id"),
                    "set_name": data.get("set_name"),
                    "created_at": data.get("created_at"),
                    "leaderboard": data.get("leaderboard") or [],
                }
            )
        except Exception as exc:  # noqa: BLE001
            LOG.warning("eval run read failed %s: %s", path, exc)
    return runs


def get_run(run_id: str) -> Optional[dict[str, Any]]:
    path = _ensure_dir() / "runs" / f"{run_id}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_default_set() -> None:
    if list_prompt_sets():
        return
    save_prompt_set(
        EvalPromptSet(
            name="Spockify smoke prompts",
            prompts=[
                EvalPrompt(text="What is 17 * 19?", label="math"),
                EvalPrompt(
                    text="Write a Python one-liner to reverse a string.",
                    label="code",
                ),
                EvalPrompt(
                    text="Summarize why local LLMs matter for privacy in two sentences.",
                    label="chat",
                ),
            ],
            models=list(EVAL_DEFAULT_MODELS),
        )
    )


def eval_status() -> dict[str, Any]:
    return {
        "dir": str(EVAL_BOARD_DIR),
        "sets": len(list_prompt_sets()),
        "runs": len(list((EVAL_BOARD_DIR / "runs").glob("*.json")))
        if (EVAL_BOARD_DIR / "runs").is_dir()
        else 0,
        "default_models": EVAL_DEFAULT_MODELS,
    }
