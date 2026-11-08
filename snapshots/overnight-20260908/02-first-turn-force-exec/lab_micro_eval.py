#!/usr/bin/env python3
"""Twin lab micro-eval: one small closed-loop goal, score handoff quality.

Usage (from repo root):
  export SPOCKIFY_BASE_URL=http://10.0.0.10:30400
  export LITELLM_MASTER_KEY=…
  python3 snapshots/overnight-20260908/scripts/lab_micro_eval.py [--tag NAME]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "packages" / "spockify-lab-agents"))

from spockify_lab_agents.llm import LabLlm, resolve_api_key, resolve_base_url  # noqa: E402
from spockify_lab_agents.loop import (  # noqa: E402
    ClosedLoop,
    _DONE_LINE_RE,
)


GOAL = """\
In this fixture workspace, inspect the files with shell (ls, cat) and:
1) Summarize what hello.py does in one short paragraph.
2) Propose a minimal pytest for greet() (do NOT write files unless asked —
   put the test draft under ARTIFACTS).
Prefer shell for inspection. Do not run `spockify lab`. Finish when digests
cover both items.
"""


def score_log(text: str) -> dict:
    nested = "spockify lab" in text.lower() and "never" not in text.lower()
    # crude: flag if exec suggested nested lab without forbid context
    nested_hit = any(
        line.strip().startswith(("run ", "`spockify lab", "spockify lab"))
        for line in text.lower().splitlines()
        if "spockify lab" in line and "never" not in line and "forbid" not in line
    )
    done_lines = len(_DONE_LINE_RE.findall(text))
    rounds = text.count("· plan")
    reviews = text.count("· review")
    stops = text.count("decision: stop (done)")
    continues = text.count("decision: continue")
    return {
        "done_lines": done_lines,
        "plan_phases": rounds,
        "review_phases": reviews,
        "stops": stops,
        "continues": continues,
        "nested_lab_suspect": nested_hit or nested,
        "has_findings": "FINDINGS" in text or "findings_digest" in text,
        "handoff_banner": "handoff (DONE digests)" in text,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="run")
    ap.add_argument("--orch", default="lab-orchestrator")
    ap.add_argument("--exec", default="lab-executor")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-rounds", type=int, default=3)
    ap.add_argument("--cwd", default="")
    args = ap.parse_args()

    fixture = (
        REPO
        / "snapshots"
        / "overnight-20260908"
        / "fixtures"
        / "hello_pkg"
    )
    cwd = args.cwd or str(fixture)
    out_dir = REPO / "snapshots" / "overnight-20260908" / "runs"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    log_path = out_dir / f"{stamp}-{args.tag}.log"
    meta_path = out_dir / f"{stamp}-{args.tag}.json"

    lines: list[str] = []

    def log(msg: str) -> None:
        print(msg, flush=True)
        lines.append(msg)

    base = resolve_base_url(os.environ.get("SPOCKIFY_BASE_URL"))
    key = resolve_api_key()
    if not key:
        print("error: no API key (LITELLM_MASTER_KEY / credentials)", file=sys.stderr)
        return 2

    log(f"micro-eval tag={args.tag} base={base} orch={args.orch} exec={args.exec}")
    log(f"cwd={cwd}")
    t0 = time.monotonic()
    llm = LabLlm(base, key, timeout=360.0)
    loop = ClosedLoop(
        llm,
        orch=args.orch,
        exec_model=args.exec,
        workers=args.workers,
        max_rounds=args.max_rounds,
        cwd=cwd,
        log=log,
    )
    code = loop.run(GOAL)
    wall = time.monotonic() - t0
    blob = "\n".join(lines)
    metrics = score_log(blob)
    metrics.update(
        {
            "exit_code": code,
            "wall_s": round(wall, 1),
            "tag": args.tag,
            "orch": args.orch,
            "exec": args.exec,
            "workers": args.workers,
            "max_rounds": args.max_rounds,
        }
    )
    # Quality score 0–10 (heuristic for overnight compare).
    score = 0
    if metrics["handoff_banner"]:
        score += 2
    if metrics["done_lines"] >= 1:
        score += 2
    if metrics["has_findings"]:
        score += 1
    # Stopping without any exec handoff is a false win for inspection goals.
    if metrics["stops"] >= 1 and metrics["handoff_banner"]:
        score += 3
    elif metrics["stops"] >= 1 and not metrics["handoff_banner"]:
        score -= 2  # orch skipped executors
        metrics["orch_skipped_exec"] = True
    if metrics["continues"] <= 1:
        score += 1
    if not metrics["nested_lab_suspect"]:
        score += 1
    metrics["quality_score"] = max(0, score)

    log_path.write_text(blob + "\n", encoding="utf-8")
    meta_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    log(f"metrics: {json.dumps(metrics)}")
    log(f"wrote {log_path}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
