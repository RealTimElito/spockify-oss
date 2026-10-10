#!/usr/bin/env python3
"""One SWE-bench instance on runHarness (lab-kernel-stdio). Not mini-SWE.

Instance: sqlfluff__sqlfluff-1625 (historical Lite 0:1). workers=1.
Does not edit serving knobs or the historical pass@1=0 row.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INSTANCE_ID = "sqlfluff__sqlfluff-1625"
DATASET = "princeton-nlp/SWE-bench"
SPLIT = "dev"
MODEL = os.environ.get("SPOCKIFY_BENCH_MODEL", "gpt-oss-20b")
MAX_TURNS = int(os.environ.get("SPOCKIFY_HARNESS_SWE_MAX_TURNS", "48"))

sys.path.insert(0, str(ROOT / "packages" / "spockify-lab-agents"))
from spockify_lab_agents.kernel_bridge import run_kernel_tools  # noqa: E402


def _load_instance() -> dict:
    from datasets import load_dataset

    ds = load_dataset(DATASET, split=SPLIT)
    for row in ds:
        if row["instance_id"] == INSTANCE_ID:
            return dict(row)
    raise SystemExit(f"missing {INSTANCE_ID} in {DATASET} {SPLIT}")


def _clone(repo: str, commit: str, dest: Path) -> None:
    if (dest / ".git").is_dir():
        subprocess.run(["git", "checkout", "--detach", commit], cwd=dest, check=True)
        subprocess.run(["git", "reset", "--hard"], cwd=dest, check=True)
        subprocess.run(["git", "clean", "-fd"], cwd=dest, check=True)
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://github.com/{repo}.git"
    subprocess.run(["git", "clone", url, str(dest)], check=True)
    subprocess.run(["git", "checkout", "--detach", commit], cwd=dest, check=True)


def main() -> int:
    venv_py = ROOT / ".venv-bench" / "bin" / "python"
    venv_root = ROOT / ".venv-bench"
    if venv_py.is_file() and Path(sys.prefix).resolve() != venv_root.resolve():
        os.execv(str(venv_py), [str(venv_py), str(Path(__file__).resolve()), *sys.argv[1:]])
    stamp = time.strftime("%Y%m%d")
    out = ROOT / "bench-out" / f"harness-swe-runHarness-{stamp}"
    card_dir = ROOT / "snapshots" / f"harness-swe-runHarness-{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    card_dir.mkdir(parents=True, exist_ok=True)
    log_path = out / "events.jsonl"
    card_path = card_dir / "CARD.md"

    t0 = time.time()
    try:
        inst = _load_instance()
        work = out / "repo"
        _clone(inst["repo"], inst["base_commit"], work)
        prompt = (
            "Fix the bug described below in this repository. "
            "Use the tools. Do not invent a new test suite.\n\n"
            + (inst.get("problem_statement") or "").strip()
        )
        os.environ.setdefault("SPOCKIFY_BASE_URL", "http://127.0.0.1:24001")
        os.environ["SPOCKIFY_HARNESS"] = "spockify"
        n_events = 0
        saw_error = ""
        saw_done = False
        with log_path.open("w", encoding="utf-8") as log:
            for ev in run_kernel_tools(
                prompt=prompt,
                cwd=str(work),
                model=MODEL,
                kind="general",
                max_turns=MAX_TURNS,
            ):
                n_events += 1
                log.write(json.dumps(ev) + "\n")
                log.flush()
                op = ev.get("op") or ev.get("type")
                if op == "error":
                    saw_error = str(ev.get("message") or ev.get("error") or "kernel error")
                if op == "done":
                    saw_done = True
        if saw_error and not saw_done:
            _write_card(
                card_path,
                outcome="infra-fail",
                detail=saw_error[:500],
                wall_s=int(time.time() - t0),
                events=n_events,
            )
            print(f"infra-fail: {saw_error}", file=sys.stderr)
            return 2
        diff = subprocess.run(
            ["git", "diff"],
            cwd=work,
            check=False,
            capture_output=True,
            text=True,
        ).stdout
        preds = {
            INSTANCE_ID: {
                "model_name_or_path": MODEL,
                "instance_id": INSTANCE_ID,
                "model_patch": diff,
            }
        }
        preds_path = out / "preds.json"
        preds_path.write_text(json.dumps(preds, indent=2) + "\n", encoding="utf-8")
        outcome, detail = _eval(preds_path, out)
    except Exception as exc:  # infra, not a fake resolve
        _write_card(
            card_path,
            outcome="infra-fail",
            detail=str(exc)[:500],
            wall_s=int(time.time() - t0),
            events=0,
        )
        print(f"infra-fail: {exc}", file=sys.stderr)
        return 2

    _write_card(
        card_path,
        outcome=outcome,
        detail=detail,
        wall_s=int(time.time() - t0),
        events=n_events,
    )
    print(f"{outcome} card={card_path}")
    return 0 if outcome != "infra-fail" else 2


def _eval(preds_path: Path, out: Path) -> tuple[str, str]:
    py = ROOT / ".venv-bench" / "bin" / "python"
    if not py.is_file():
        return "infra-fail", "missing .venv-bench"
    report_dir = out / "eval"
    report_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(py),
        "-m",
        "swebench.harness.run_evaluation",
        "--dataset_name",
        DATASET,
        "--split",
        SPLIT,
        "--instance_ids",
        INSTANCE_ID,
        "--predictions_path",
        str(preds_path),
        "--max_workers",
        "1",
        "--run_id",
        "harness-runHarness",
        "--report_dir",
        str(report_dir),
    ]
    proc = subprocess.run(cmd, cwd=out, check=False, capture_output=True, text=True)
    (out / "eval.log").write_text((proc.stdout or "") + "\n" + (proc.stderr or ""), encoding="utf-8")
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-400:]
        return "infra-fail", f"eval exit {proc.returncode}: {tail}"
    resolved = _read_resolved(report_dir)
    if resolved is True:
        return "resolved", "swebench report resolved"
    if resolved is False:
        return "not-resolved", "swebench report not resolved"
    return "infra-fail", "eval finished without a resolved flag"


def _read_resolved(report_dir: Path) -> bool | None:
    for path in report_dir.rglob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        if data.get("resolved_ids") and INSTANCE_ID in data["resolved_ids"]:
            return True
        if INSTANCE_ID in (data.get("empty_patch_ids") or []):
            return False
        if INSTANCE_ID in (data.get("unresolved_ids") or []):
            return False
        if INSTANCE_ID in (data.get("infra_failure_ids") or []):
            return None
    return None


def _write_card(
    path: Path,
    *,
    outcome: str,
    detail: str,
    wall_s: int,
    events: int,
) -> None:
    sha = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    text = "\n".join(
        [
            f"# runHarness SWE — {INSTANCE_ID}",
            "",
            f"- Outcome: **{outcome}**",
            f"- Detail: {detail}",
            f"- Driver: `@spockify/harness` `runHarness` via `lab-kernel-stdio` (not mini-SWE)",
            f"- Model: `{MODEL}`",
            f"- Workers: 1",
            f"- Max turns: {MAX_TURNS}",
            f"- Host: {os.uname().nodename}",
            f"- Commit: `{sha}`",
            f"- Wall s: {wall_s}",
            f"- Events: {events}",
            "- Phase 5 stays Partial (one instance is not the default scored driver).",
            "- Historical Lite pass@1=0 row is unchanged.",
            "",
        ]
    )
    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
