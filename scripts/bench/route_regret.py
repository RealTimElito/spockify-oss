#!/usr/bin/env python3
"""Offline route-pack regret table (LEAP A9 / skill-route-regret).

Does not call live auto by default — simulates always-20b / always-120b-high
and checks spark forbidden tags. Live auto can be plugged later without
starving an in-flight SWE board.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def _norm(tag: str) -> str:
    return (tag or "").strip().lower()


def _violates(pick: str, forbidden: list[str]) -> bool:
    p = _norm(pick)
    for f in forbidden:
        f = _norm(f)
        if not f:
            continue
        if f in p or p.endswith(f) or f in p.replace("_", "-"):
            return True
    return False


def _policy_pick(policy: str, item: dict[str, Any]) -> str:
    if policy == "always-20b":
        return "gpt-oss-20b"
    if policy == "always-120b-high":
        return "gpt-oss:120b"
    if policy == "lab-orch-default":
        # orch default stays 20b for canaries; hard bucket escalates in sim
        return "gpt-oss:120b" if item.get("bucket") == "hard" else "gpt-oss-20b"
    if policy == "auto":
        # Naive offline stand-in: family tab→codestral; hard→120b; else 20b.
        # Not a claim that product auto matches this — baseline for regret UI.
        fam = item.get("family") or ""
        if fam == "tab-fim":
            return "codestral"
        if item.get("bucket") == "hard":
            return "gpt-oss:120b"
        return "gpt-oss-20b"
    raise ValueError(f"unknown policy {policy}")


def _cost_units(model: str) -> float:
    m = _norm(model)
    if "120b" in m:
        return 6.0
    if "codestral" in m:
        return 1.5
    return 1.0


def score_pack(pack: dict[str, Any]) -> dict[str, Any]:
    items = pack.get("items") or []
    spark_forbidden = list(pack.get("spark_forbidden") or ["abliterated", ":cloud"])
    policies = list(pack.get("policies") or ["always-20b", "always-120b-high", "auto", "lab-orch-default"])
    report: dict[str, Any] = {"pack": pack.get("id"), "n": len(items), "policies": {}}

    for policy in policies:
        family_ok = 0
        family_n = 0
        by_bucket = defaultdict(lambda: {"n": 0, "match_oracle_model": 0})
        regret = 0.0
        violations = 0
        esc_tp = esc_fp = esc_fn = 0

        for item in items:
            oracle = item.get("oracle_model") or "gpt-oss-20b"
            pick = _policy_pick(policy, item)
            # Sev-0 spark violations = abliterated/:cloud only.
            # Per-item forbidden_models grade auto regret, not blunt baselines.
            if _violates(pick, spark_forbidden):
                violations += 1
            item_forbidden = list(item.get("forbidden_models") or [])
            _ = item_forbidden  # reserved for live-auto grader

            bucket = item.get("bucket") or "easy"
            by_bucket[bucket]["n"] += 1
            # Model match (ignore think for offline)
            if _norm(pick).split(":")[0] == _norm(oracle).split(":")[0] or (
                "120b" in _norm(pick) and "120b" in _norm(oracle)
            ) or (_norm(pick) == _norm(oracle)):
                by_bucket[bucket]["match_oracle_model"] += 1
                match = True
            else:
                match = False

            # Family accuracy: tab must be codestral; chat/code not codestral
            fam = item.get("family") or ""
            family_n += 1
            if fam == "tab-fim":
                family_ok += int("codestral" in _norm(pick))
            elif fam in ("chat", "code-repair", "repo-repair"):
                family_ok += int("codestral" not in _norm(pick))
            else:
                family_ok += 1

            regret += _cost_units(pick) - _cost_units(oracle)

            # Escalation: picking 120b when oracle is 20b = FP; missing 120b when oracle 120b = FN
            pick_big = "120b" in _norm(pick)
            need_big = "120b" in _norm(oracle)
            if pick_big and need_big:
                esc_tp += 1
            elif pick_big and not need_big:
                esc_fp += 1
            elif need_big and not pick_big:
                esc_fn += 1

            _ = match  # reserved for future pass simulation

        prec = esc_tp / (esc_tp + esc_fp) if (esc_tp + esc_fp) else 1.0
        rec = esc_tp / (esc_tp + esc_fn) if (esc_tp + esc_fn) else 1.0
        report["policies"][policy] = {
            "family_accuracy": round(family_ok / family_n, 4) if family_n else 0.0,
            "regret_cost_units": round(regret, 2),
            "violations": violations,
            "escalation_precision": round(prec, 4),
            "escalation_recall": round(rec, 4),
            "buckets": {
                b: {
                    "n": v["n"],
                    "oracle_model_match_rate": round(v["match_oracle_model"] / v["n"], 4) if v["n"] else 0.0,
                }
                for b, v in sorted(by_bucket.items())
            },
        }
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pack", default="packs/route-v1.json")
    ap.add_argument("--json", action="store_true", help="print JSON only")
    ap.add_argument("--out", default="", help="optional write path")
    args = ap.parse_args()
    path = Path(args.pack)
    if not path.is_file():
        print(f"missing pack: {path}", file=sys.stderr)
        return 2
    pack = json.loads(path.read_text())
    report = score_pack(pack)
    text = json.dumps(report, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n")
    if args.json:
        print(text)
    else:
        print(f"route regret — pack={report['pack']} n={report['n']}")
        for pol, row in report["policies"].items():
            print(
                f"  {pol}: family_acc={row['family_accuracy']} "
                f"regret={row['regret_cost_units']} "
                f"violations={row['violations']} "
                f"esc_p={row['escalation_precision']} esc_r={row['escalation_recall']}"
            )
            for b, br in row["buckets"].items():
                print(f"    bucket {b}: n={br['n']} oracle_match={br['oracle_model_match_rate']}")
        # Spark gate: any policy that can pick forbidden must show 0 violations in sim
        bad = [p for p, r in report["policies"].items() if r["violations"] > 0]
        if bad:
            print(f"POLICY-VIOLATIONS: {bad}", file=sys.stderr)
            return 1
        print("POLICY-OK violations=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
