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
from spockify_lab_agents.loop import ClosedLoop, _DONE_LINE_RE  # noqa: E402


GOAL = """\
In this fixture workspace, inspect the files with shell (ls, cat) and:
1) Summarize what hello.py does in one short paragraph.
2) Propose a minimal pytest for greet() (do NOT write files unless asked —
   put the test draft under ARTIFACTS).
Prefer shell for inspection. Do not run `spockify lab`. Finish when digests
cover both items.
"""


class _Tee:
    """Mirror writes to the real stream and an in-memory buffer."""

    def __init__(self, real) -> None:
        self.real = real
        self.buf: list[str] = []

    def write(self, s: str) -> int:
        self.buf.append(s)
        return self.real.write(s)

    def flush(self) -> None:
        self.real.flush()

    def text(self) -> str:
        return "".join(self.buf)


def score_log(text: str) -> dict:
    nested_hit = any(
        "spockify lab" in line
        and "never" not in line
        and "forbid" not in line
        and "do not run" not in line
        for line in text.lower().splitlines()
    )
    return {
        "done_lines": len(_DONE_LINE_RE.findall(text)),
        "plan_phases": text.count("· plan"),
        "review_phases": text.count("· review"),
        "stops": text.count("decision: stop (done)"),
        "continues": text.count("decision: continue"),
        "nested_lab_suspect": nested_hit,
        "has_findings": "FINDINGS" in text,
        "handoff_banner": "handoff (DONE digests)" in text,
        "forced_first_turn": "forcing continue + default inspect" in text,
    }


def quality_score(metrics: dict) -> int:
    score = 0
    if metrics["handoff_banner"]:
        score += 2
    if metrics["done_lines"] >= 1:
        score += 2
    if metrics["has_findings"]:
        score += 1
    if metrics["stops"] >= 1 and metrics["handoff_banner"]:
        score += 3
    elif metrics["stops"] >= 1 and not metrics["handoff_banner"]:
        score -= 2
        metrics["orch_skipped_exec"] = True
    if metrics["continues"] <= 1:
        score += 1
    if not metrics["nested_lab_suspect"]:
        score += 1
    return max(0, score)


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
        REPO / "snapshots" / "overnight-20260908" / "fixtures" / "hello_pkg"
    )
    cwd = args.cwd or str(fixture)
    out_dir = REPO / "snapshots" / "overnight-20260908" / "runs"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    log_path = out_dir / f"{stamp}-{args.tag}.log"
    meta_path = out_dir / f"{stamp}-{args.tag}.json"

    tee_out = _Tee(sys.stdout)
    tee_err = _Tee(sys.stderr)
    sys.stdout = tee_out  # type: ignore[assignment]
    sys.stderr = tee_err  # type: ignore[assignment]

    def log(msg: str) -> None:
        print(msg, flush=True)

    base = resolve_base_url(os.environ.get("SPOCKIFY_BASE_URL"))
    key = resolve_api_key()
    if not key:
        sys.stdout = tee_out.real  # type: ignore[assignment]
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
    try:
        code = loop.run(GOAL)
    finally:
        sys.stdout = tee_out.real  # type: ignore[assignment]
        sys.stderr = tee_err.real  # type: ignore[assignment]

    wall = time.monotonic() - t0
    blob = tee_out.text() + tee_err.text()
    log_path.write_text(blob, encoding="utf-8")
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
            "quality_score": quality_score(metrics),
        }
    )
    meta_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(f"metrics: {json.dumps(metrics)}", flush=True)
    print(f"wrote {log_path}", flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
