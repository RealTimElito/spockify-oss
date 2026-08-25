"""Synthetic FIM eval suite + held-out telemetry scoring helpers."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Optional

from .fim_format import build_fim_prompt

# Small fixed suite — language-diverse, short middles. Used as a regression
# canary so a bad adapter cannot promote on telemetry alone.
SYNTHETIC_FIM: list[dict[str, str]] = [
    {
            "id": "py_def",
            "prefix": "def add(a, b):\n    ",
            "suffix": "\n\ndef sub(a, b):\n    return a - b\n",
            "middle": "return a + b",
    },
    {
            "id": "py_import",
            "prefix": "import os\nimport sys\n",
            "suffix": "\n\ndef main():\n    pass\n",
            "middle": "from pathlib import Path",
    },
    {
            "id": "ts_fn",
            "prefix": "export function greet(name: string): string {\n  ",
            "suffix": "\n}\n",
            "middle": "return `hello ${name}`",
    },
    {
            "id": "go_err",
            "prefix": "if err != nil {\n\t",
            "suffix": "\n}\n",
            "middle": "return err",
    },
    {
            "id": "rs_let",
            "prefix": "fn answer() -> i32 {\n    let x = ",
            "suffix": ";\n    x\n}\n",
            "middle": "42",
    },
    {
            "id": "sh_echo",
            "prefix": "#!/usr/bin/env bash\nset -euo pipefail\n",
            "suffix": "\n",
            "middle": 'echo "ok"',
    },
    {
            "id": "sql_select",
            "prefix": "SELECT id, name\nFROM users\nWHERE ",
            "suffix": "\nORDER BY id;\n",
            "middle": "active = true",
    },
    {
            "id": "java_ret",
            "prefix": "public int size() {\n    ",
            "suffix": "\n}\n",
            "middle": "return items.size();",
    },
]


@dataclass
class EvalScores:
    exact_match: float
    prefix_match: float
    char_f1: float
    n: int

    def as_dict(self) -> dict[str, Any]:
        return {
                "exact_match": self.exact_match,
                "prefix_match": self.prefix_match,
                "char_f1": self.char_f1,
                "n": self.n,
        }


def _char_f1(pred: str, gold: str) -> float:
    if not pred and not gold:
        return 1.0
    if not pred or not gold:
        return 0.0
    # Multiset overlap on characters (cheap proxy for edit quality).
    from collections import Counter

    cp, cg = Counter(pred), Counter(gold)
    overlap = sum((cp & cg).values())
    if overlap == 0:
        return 0.0
    prec = overlap / max(len(pred), 1)
    rec = overlap / max(len(gold), 1)
    return 2 * prec * rec / max(prec + rec, 1e-9)


def score_pairs(
        pairs: list[tuple[str, str]],
        *,
        prefix_chars: int = 16,
) -> EvalScores:
    if not pairs:
        return EvalScores(0.0, 0.0, 0.0, 0)
    exact = 0
    pref = 0
    f1s: list[float] = []
    for pred, gold in pairs:
        p = (pred or "").strip()
        g = (gold or "").strip()
        if p == g:
            exact += 1
        if g and p.startswith(g[: min(prefix_chars, len(g))]):
            pref += 1
        f1s.append(_char_f1(p, g))
    n = len(pairs)
    return EvalScores(
            exact_match=exact / n,
            prefix_match=pref / n,
            char_f1=sum(f1s) / n,
            n=n,
    )


def aggregate_gate_score(scores: EvalScores) -> float:
    """Single scalar for promote gate (higher is better)."""
    return 0.5 * scores.char_f1 + 0.3 * scores.prefix_match + 0.2 * scores.exact_match


def regresses(
        current: float,
        baseline: float,
        *,
        max_drop: float = 0.03,
) -> bool:
    """True when current is worse than baseline by more than max_drop."""
    if math.isnan(current) or math.isnan(baseline):
        return True
    return current + max_drop < baseline


def load_jsonl(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def heldout_pairs_from_sft_jsonl(
        path: str,
        *,
        limit: Optional[int] = 200,
) -> list[dict[str, str]]:
    """Expect rows with prefix/suffix/middle (or text already FIM-formatted)."""
    rows = load_jsonl(path)
    out: list[dict[str, str]] = []
    for row in rows:
        if "prefix" in row and "middle" in row:
            out.append({
                    "id": str(row.get("id") or len(out)),
                    "prefix": row.get("prefix") or "",
                    "suffix": row.get("suffix") or "",
                    "middle": row.get("middle") or "",
            })
        if limit is not None and len(out) >= limit:
            break
    return out


def make_prompt(ex: dict[str, str]) -> str:
    return build_fim_prompt(ex.get("prefix") or "", ex.get("suffix") or "")
