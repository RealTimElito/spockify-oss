#!/usr/bin/env python3
"""Same-slice OpenCode SWE row vs runHarness (sqlfluff__sqlfluff-1625).

Uses local gpt-oss-20b via LiteLLM OpenAI-compat provider (not free catalog tags).
Writes CARD under snapshots/opencode-swe-<stamp>/ and preds for swebench grade.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INSTANCE_ID = os.environ.get(
    "SPOCKIFY_OPENCODE_SWE_INSTANCE",
    os.environ.get("SPOCKIFY_HARNESS_SWE_INSTANCE", "sqlfluff__sqlfluff-1625"),
).strip()
PROMPT_DATASET = os.environ.get(
    "SPOCKIFY_OPENCODE_SWE_PROMPT_DATASET",
    os.environ.get("SPOCKIFY_HARNESS_SWE_PROMPT_DATASET", "princeton-nlp/SWE-bench"),
)
PROMPT_SPLIT = os.environ.get(
    "SPOCKIFY_OPENCODE_SWE_PROMPT_SPLIT",
    os.environ.get("SPOCKIFY_HARNESS_SWE_PROMPT_SPLIT", "dev"),
)
EVAL_DATASET = os.environ.get(
    "SPOCKIFY_OPENCODE_SWE_EVAL_DATASET",
    os.environ.get("SPOCKIFY_HARNESS_SWE_EVAL_DATASET", "SWE-bench/SWE-bench"),
)
EVAL_SPLIT = os.environ.get(
    "SPOCKIFY_OPENCODE_SWE_EVAL_SPLIT",
    os.environ.get("SPOCKIFY_HARNESS_SWE_EVAL_SPLIT", "dev"),
)
MODEL = os.environ.get("SPOCKIFY_BENCH_MODEL", "gpt-oss-20b")
OPENCODE_BIN = os.environ.get(
    "SPOCKIFY_OPENCODE_BIN",
    str(Path.home() / ".opencode" / "bin" / "opencode"),
)
PROVIDER_ID = "spockify-litellm"
# OpenCode model id = provider/model
OC_MODEL = f"{PROVIDER_ID}/{MODEL}"


def _load_instance() -> dict:
    from datasets import load_dataset

    ds = load_dataset(PROMPT_DATASET, split=PROMPT_SPLIT)
    for row in ds:
        if row["instance_id"] == INSTANCE_ID:
            return dict(row)
    raise SystemExit(f"missing {INSTANCE_ID}")


def _clone(repo: str, commit: str, dest: Path) -> None:
    if (dest / ".git").is_dir():
        subprocess.run(["git", "checkout", "--detach", commit], cwd=dest, check=True)
        subprocess.run(["git", "reset", "--hard"], cwd=dest, check=True)
        subprocess.run(["git", "clean", "-fd"], cwd=dest, check=True)
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", f"https://github.com/{repo}.git", str(dest)], check=True)
    subprocess.run(["git", "checkout", "--detach", commit], cwd=dest, check=True)


def _git_sha() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()


def _write_opencode_config(cfg_dir: Path, base_url: str, api_key: str) -> Path:
    cfg_dir.mkdir(parents=True, exist_ok=True)
    v1 = base_url.rstrip("/")
    if not v1.endswith("/v1"):
        v1 = f"{v1}/v1"
    # gpt-oss via OpenAI-compat often emits a fake tool named "assistant"; pin
    # instructions so the agent uses write/edit/bash only (real empty-patch fix).
    cfg = {
        "$schema": "https://opencode.ai/config.json",
        "model": OC_MODEL,
        "instructions": [
            "You are editing a git checkout. Use only real tools: read, write, edit, "
            "bash, glob, grep. Never call a tool named assistant or container.exec. "
            "Apply the fix with write/edit; verify with bash if needed; then stop.",
        ],
        "provider": {
            PROVIDER_ID: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Spockify LiteLLM",
                "options": {
                    "baseURL": v1,
                    "apiKey": api_key,
                },
                "models": {
                    MODEL: {
                        "name": MODEL,
                        "limit": {"context": 131072, "output": 16384},
                    }
                },
            }
        },
    }
    path = cfg_dir / "opencode.json"
    path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> int:
    venv_py = ROOT / ".venv-bench" / "bin" / "python"
    venv_root = ROOT / ".venv-bench"
    if venv_py.is_file() and Path(sys.prefix).resolve() != venv_root.resolve():
        os.execv(str(venv_py), [str(venv_py), str(Path(__file__).resolve()), *sys.argv[1:]])

    if not Path(OPENCODE_BIN).is_file():
        print(f"infra-fail: opencode missing at {OPENCODE_BIN}", file=sys.stderr)
        return 2

    stamp = time.strftime("%Y%m%d")
    run_id = os.environ.get("SPOCKIFY_OPENCODE_SWE_RUN_ID", "").strip() or stamp
    out_override = os.environ.get("SPOCKIFY_OPENCODE_SWE_OUT", "").strip()
    out = Path(out_override) if out_override else ROOT / "bench-out" / f"opencode-swe-{run_id}"
    card_override = os.environ.get("SPOCKIFY_OPENCODE_SWE_CARD_DIR", "").strip()
    card_dir = (
        Path(card_override)
        if card_override
        else ROOT / "snapshots" / f"opencode-swe-{run_id}"
    )
    out.mkdir(parents=True, exist_ok=True)
    card_dir.mkdir(parents=True, exist_ok=True)

    base = (
        os.environ.get("SPOCKIFY_BASE_URL")
        or os.environ.get("OPENAI_API_BASE")
        or "http://127.0.0.1:24001"
    ).rstrip("/")
    if base.endswith("/v1"):
        base = base[: -len("/v1")]
    key = (
        os.environ.get("SPOCKIFY_API_KEY")
        or os.environ.get("LITELLM_MASTER_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    )
    if not key:
        print("infra-fail: missing API key", file=sys.stderr)
        return 2

    cfg_path = _write_opencode_config(out / "opencode-config", base, key)
    sha = _git_sha()
    oc_ver = subprocess.run(
        [OPENCODE_BIN, "--version"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip() or "unknown"

    t0 = time.time()
    try:
        inst = _load_instance()
        work = out / "repo"
        _clone(inst["repo"], inst["base_commit"], work)
        prompt = (
            "Fix the bug described below in this repository. "
            "Edit files in-place with the write/edit tools (never a tool named "
            "assistant). Do not invent a new test suite. When done, stop.\n\n"
            + (inst.get("problem_statement") or "").strip()
        )
        (out / "prompt.txt").write_text(prompt, encoding="utf-8")
        log_path = out / "opencode.log"
        env = {
            **os.environ,
            "OPENCODE_CONFIG": str(cfg_path),
            "OPENAI_API_KEY": key,
            "OPENAI_BASE_URL": f"{base}/v1",
        }
        # Non-interactive one-shot. --auto matches harness yolo for fair tool use
        # (without it OpenCode may exit after read-only globs with an empty patch).
        # --dir pins the checkout (cwd alone was not enough for some OpenCode builds).
        cmd = [
            OPENCODE_BIN,
            "run",
            "--auto",
            "--dir",
            str(work),
            "--model",
            OC_MODEL,
            prompt,
        ]
        with log_path.open("w", encoding="utf-8") as log:
            log.write(f"# cmd={' '.join(cmd)}\n# cwd={work}\n")
            log.flush()
            proc = subprocess.run(
                cmd,
                cwd=work,
                env=env,
                check=False,
                capture_output=True,
                text=True,
                timeout=int(os.environ.get("SPOCKIFY_OPENCODE_WALL_SEC", "4500")),
            )
            log.write(proc.stdout or "")
            log.write("\n--- stderr ---\n")
            log.write(proc.stderr or "")
        if proc.returncode != 0 and not (work / ".git").is_dir():
            _card(
                card_dir / "CARD.md",
                outcome="infra-fail",
                detail=f"opencode exit {proc.returncode}",
                wall_s=int(time.time() - t0),
                sha=sha,
                oc_ver=oc_ver,
                traces=str(log_path),
            )
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
    except subprocess.TimeoutExpired:
        _card(
            card_dir / "CARD.md",
            outcome="infra-fail",
            detail="opencode wall clock timeout",
            wall_s=int(time.time() - t0),
            sha=sha,
            oc_ver=oc_ver,
            traces=str(out / "opencode.log"),
        )
        return 2
    except Exception as exc:
        _card(
            card_dir / "CARD.md",
            outcome="infra-fail",
            detail=str(exc)[:500],
            wall_s=int(time.time() - t0),
            sha=sha,
            oc_ver=oc_ver,
            traces=str(out / "opencode.log"),
        )
        print(f"infra-fail: {exc}", file=sys.stderr)
        return 2

    _card(
        card_dir / "CARD.md",
        outcome=outcome,
        detail=detail,
        wall_s=int(time.time() - t0),
        sha=sha,
        oc_ver=oc_ver,
        traces=str(out / "opencode.log"),
    )
    # Dual-harness freeze card (B-05).
    dual = card_dir / "B05-same-model.md"
    harness_hint = os.environ.get(
        "SPOCKIFY_B05_HARNESS_CARD",
        f"snapshots/harness-swe-runHarness-{run_id}/",
    )
    dual.write_text(
        "\n".join(
            [
                f"# B-05 same-model OpenCode — {INSTANCE_ID}",
                "",
                f"- Run id: `{run_id}`",
                f"- Model: `{MODEL}` (same tag both sides)",
                f"- Slice: `{INSTANCE_ID}` ({PROMPT_DATASET} / {PROMPT_SPLIT})",
                f"- OpenCode: `{oc_ver}` via `{PROVIDER_ID}` → `{base}`",
                f"- OpenCode outcome: **{outcome}** ({detail})",
                f"- Spockify harness card: `{harness_hint}`",
                f"- Commit: `{sha}`",
                "- Not a Lite board %. Not a superiority claim.",
                "- Historical sqlfluff pass@1=0 unchanged.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"{outcome} card={card_dir / 'CARD.md'}")
    return 0 if outcome != "infra-fail" else 2


def _eval(preds_path: Path, out: Path) -> tuple[str, str]:
    py = ROOT / ".venv-bench" / "bin" / "python"
    report_dir = out / "eval"
    report_dir.mkdir(parents=True, exist_ok=True)
    run_id = f"opencode-{time.strftime('%Y%m%d')}"
    cmd = [
        str(py),
        "-m",
        "swebench.harness.run_evaluation",
        "--dataset_name",
        EVAL_DATASET,
        "--split",
        EVAL_SPLIT,
        "--instance_ids",
        INSTANCE_ID,
        "--predictions_path",
        str(preds_path),
        "--max_workers",
        "1",
        "--run_id",
        run_id,
        "--report_dir",
        str(report_dir),
    ]
    proc = subprocess.run(cmd, cwd=out, check=False, capture_output=True, text=True)
    (out / "eval.log").write_text((proc.stdout or "") + "\n" + (proc.stderr or ""), encoding="utf-8")
    if proc.returncode != 0:
        return "infra-fail", f"eval exit {proc.returncode}: {(proc.stderr or '')[-300:]}"
    for path in report_dir.rglob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        if INSTANCE_ID in (data.get("resolved_ids") or []):
            return "resolved", "swebench report resolved"
        if INSTANCE_ID in (data.get("empty_patch_ids") or []):
            return "not-resolved", "empty_patch_ids"
        if INSTANCE_ID in (data.get("unresolved_ids") or []):
            return "not-resolved", "unresolved_ids"
    return "infra-fail", "no resolved flag in report"


def _card(
    path: Path,
    *,
    outcome: str,
    detail: str,
    wall_s: int,
    sha: str,
    oc_ver: str,
    traces: str,
) -> None:
    path.write_text(
        "\n".join(
            [
                f"# OpenCode SWE — {INSTANCE_ID}",
                "",
                f"- Outcome: **{outcome}**",
                f"- Detail: {detail}",
                f"- Harness: OpenCode `{oc_ver}`",
                f"- Model: `{MODEL}` via `{PROVIDER_ID}` (LiteLLM OpenAI-compat)",
                f"- Commit: `{sha}`",
                f"- Traces: `{traces}`",
                f"- Wall s: {wall_s}",
                "- Same-model row for B-05; not a board %.",
                "",
            ]
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
