#!/usr/bin/env python3
"""Offline Tab eval gate: synthetic FIM suite + optional held-out SFT JSONL.

Compares a candidate adapter (via vLLM model name) against a baseline
(base tab-fim or previous adapter). Exit 0 = safe to promote.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tab_train.eval_lib import (  # noqa: E402
        SYNTHETIC_FIM,
        aggregate_gate_score,
        heldout_pairs_from_sft_jsonl,
        make_prompt,
        regresses,
        score_pairs,
)

LOG = logging.getLogger("tab_train.eval")


def _complete(
        base_url: str,
        model: str,
        prompt: str,
        *,
        max_tokens: int = 64,
        temperature: float = 0.0,
) -> str:
    body = json.dumps({
            "model": model,
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stop": ["<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<|endoftext|>"],
    }).encode("utf-8")
    req = urllib.request.Request(
            f"{base_url.rstrip('/')}/v1/completions",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return ((data.get("choices") or [{}])[0].get("text") or "").strip()


def _eval_model(
        base_url: str,
        model: str,
        examples: list[dict[str, str]],
) -> dict[str, Any]:
    pairs: list[tuple[str, str]] = []
    details: list[dict[str, Any]] = []
    for ex in examples:
        prompt = make_prompt(ex)
        pred = _complete(base_url, model, prompt)
        gold = (ex.get("middle") or "").strip()
        pairs.append((pred, gold))
        details.append({"id": ex.get("id"), "pred": pred, "gold": gold})
    scores = score_pairs(pairs)
    return {
            "model": model,
            "scores": scores.as_dict(),
            "gate": aggregate_gate_score(scores),
            "details": details,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
            "--vllm-url",
            default=os.getenv("TAB_VLLM_URL", "http://127.0.0.1:30820"),
    )
    parser.add_argument("--candidate", required=True, help="vLLM model / LoRA name")
    parser.add_argument(
            "--baseline",
            default="tab-fim",
            help="Baseline model name (previous adapter or tab-fim)",
    )
    parser.add_argument("--heldout", type=Path, default=None, help="Optional SFT JSONL")
    parser.add_argument("--heldout-limit", type=int, default=50)
    parser.add_argument("--max-drop", type=float, default=0.03)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument(
            "--skip-baseline",
            action="store_true",
            help="Only score candidate (write report; always exit 0)",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    examples = list(SYNTHETIC_FIM)
    if args.heldout and args.heldout.is_file():
        examples.extend(
                heldout_pairs_from_sft_jsonl(str(args.heldout), limit=args.heldout_limit)
        )
    LOG.info("eval n=%s candidate=%s baseline=%s", len(examples), args.candidate, args.baseline)

    cand = _eval_model(args.vllm_url, args.candidate, examples)
    report: dict[str, Any] = {"candidate": cand, "max_drop": args.max_drop}
    ok = True
    if not args.skip_baseline:
        base = _eval_model(args.vllm_url, args.baseline, examples)
        report["baseline"] = base
        if regresses(cand["gate"], base["gate"], max_drop=args.max_drop):
            ok = False
            LOG.error(
                    "REGRESS candidate_gate=%.4f baseline_gate=%.4f max_drop=%.4f",
                    cand["gate"], base["gate"], args.max_drop,
            )
        else:
            LOG.info(
                    "PASS candidate_gate=%.4f baseline_gate=%.4f",
                    cand["gate"], base["gate"],
            )
    else:
        LOG.info("candidate_gate=%.4f (baseline skipped)", cand["gate"])

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
