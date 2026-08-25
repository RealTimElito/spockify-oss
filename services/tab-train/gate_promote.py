#!/usr/bin/env python3
"""Challenger load → eval vs champion (or tab-fim) → promote or unload.

Keeps the serving name stable: challenger loads as ``{name}-challenger``,
wins the gate, then replaces ``name`` and updates champions.json.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tab_train.champion_lib import (  # noqa: E402
        champion_baseline,
        challenger_name,
        record_champion,
        slot_for_adapter,
)
from tab_train.notify import notify as notify_outcome  # noqa: E402
from tab_train.promote_lib import (  # noqa: E402
        copy_adapter,
        list_vllm_models,
        load_lora_adapter,
        load_pointer,
        save_pointer,
        unload_lora_adapter,
)

LOG = logging.getLogger("tab_train.gate_promote")


def _webhook_job(source: str) -> str:
    return os.getenv("TAB_TRAIN_JOB", "").strip() or source or "gate_promote"


def _run_eval(
        candidate: str,
        baseline: str,
        *,
        vllm_url: str,
        heldout: Optional[Path],
        heldout_limit: int,
        max_drop: float,
        out: Optional[Path],
) -> tuple[bool, dict[str, Any]]:
    cmd = [
            sys.executable,
            str(Path(__file__).resolve().parent / "eval_tab.py"),
            "--candidate", candidate,
            "--baseline", baseline,
            "--vllm-url", vllm_url,
            "--max-drop", str(max_drop),
    ]
    if heldout:
        cmd.extend(["--heldout", str(heldout), "--heldout-limit", str(heldout_limit)])
    if out:
        cmd.extend(["--out", str(out)])
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.stdout:
        print(proc.stdout, end="")
    if proc.stderr:
        print(proc.stderr, end="", file=sys.stderr)
    report: dict[str, Any] = {}
    if out and out.is_file():
        try:
            report = json.loads(out.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            report = {}
    return proc.returncode == 0, report


def _safe_unload(name: str) -> None:
    try:
        unload_lora_adapter(name)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("unload %s failed: %s", name, exc)


def gate_promote(
        src: Path,
        name: str,
        *,
        seed: bool = False,
        workspace_id: Optional[str] = None,
        source: str = "",
        vllm_url: Optional[str] = None,
        heldout: Optional[Path] = None,
        heldout_limit: int = 50,
        max_drop: float = 0.03,
        eval_out: Optional[Path] = None,
        dry_run: bool = False,
        skip_challenger: bool = False,
) -> int:
    """Return 0 on promote, 1 on gate failure / load error."""
    url = (vllm_url or os.getenv("TAB_VLLM_URL")
           or os.getenv("GHOST_VLLM_BASE_URL")
           or "http://127.0.0.1:30820")
    slot = slot_for_adapter(name, seed=seed)
    baseline = champion_baseline(slot, fallback="tab-fim")
    # If baseline is the same name we are replacing, use tab-fim (cannot A/B
    # the same loaded id). Challenger path avoids this when skip_challenger=False.
    chal = name if skip_challenger else challenger_name(name)
    if baseline == name and not skip_challenger:
        # Prefer scoring against previous champion under stable name vs base
        # when we load challenger separately — baseline stays the live champion.
        pass
    elif baseline == chal:
        baseline = "tab-fim"

    if dry_run:
        LOG.info(
                "dry-run gate_promote src=%s name=%s chal=%s baseline=%s seed=%s",
                src, name, chal, baseline, seed,
        )
        return 0

    dest = copy_adapter(src, chal if not skip_challenger else name)
    LOG.info("on-disk challenger/adapter at %s", dest)

    if not skip_challenger:
        # Also stage final path so a crash mid-promote leaves weights on disk.
        copy_adapter(src, name)

    try:
        load_lora_adapter(chal)
    except Exception as exc:  # noqa: BLE001
        LOG.error("load %s failed: %s", chal, exc)
        return 1

    models = list_vllm_models()
    if chal not in models:
        LOG.error("adapter %s not in /v1/models: %s", chal, models)
        _safe_unload(chal)
        return 1

    # If champion baseline is not loaded, fall back to base model.
    if baseline != "tab-fim" and baseline not in models:
        LOG.warning("champion %s not loaded; baseline → tab-fim", baseline)
        baseline = "tab-fim"

    ok, report = _run_eval(
            chal,
            baseline,
            vllm_url=url,
            heldout=heldout,
            heldout_limit=heldout_limit,
            max_drop=max_drop,
            out=eval_out,
    )
    if not ok:
        LOG.error("gate failed for %s vs %s — unloading challenger", chal, baseline)
        scores = report if isinstance(report, dict) else {}
        notify_outcome(
                _webhook_job(source),
                "eval_failed",
                detail=f"{name} vs {baseline}",
                adapter=name,
                scores=scores or None,
        )
        if not skip_challenger:
            _safe_unload(chal)
        else:
            _safe_unload(name)
        return 1

    gate_score = None
    cand = report.get("candidate") if isinstance(report, dict) else None
    if isinstance(cand, dict):
        gate_score = cand.get("gate")

    if not skip_challenger:
        # Hot-swap production name, drop challenger slot.
        try:
            load_lora_adapter(name)
        except Exception as exc:  # noqa: BLE001
            LOG.error("load champion name %s failed: %s", name, exc)
            _safe_unload(chal)
            return 1
        _safe_unload(chal)
        models = list_vllm_models()
        if name not in models:
            LOG.error("champion %s missing after swap: %s", name, models)
            return 1

    ptr = load_pointer()
    if seed:
        ptr["seed"] = name
    if workspace_id:
        ptr.setdefault("adapters", {})[workspace_id] = name
    ptr.setdefault("adapters", {})[name] = name
    save_pointer(ptr)

    record_champion(
            name,
            gate_score=gate_score if isinstance(gate_score, (int, float)) else None,
            source=source,
            seed=seed,
            baseline=baseline,
    )
    LOG.info("promoted champion name=%s slot=%s gate=%s", name, slot, gate_score)
    scores: dict[str, Any] = {}
    if isinstance(gate_score, (int, float)):
        scores["gate"] = gate_score
    if isinstance(report, dict):
        scores.update({k: v for k, v in report.items() if k != "candidate"})
        if isinstance(cand, dict):
            scores["candidate"] = cand
    notify_outcome(
            _webhook_job(source),
            "promoted",
            detail=f"slot={slot} baseline={baseline}",
            adapter=name,
            scores=scores or None,
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--workspace-id", default=None)
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--source", default="", help="seed|sft|kto|distill|…")
    parser.add_argument("--vllm-url", default=None)
    parser.add_argument("--heldout", type=Path, default=None)
    parser.add_argument("--heldout-limit", type=int, default=50)
    parser.add_argument("--max-drop", type=float, default=0.03)
    parser.add_argument("--eval-out", type=Path, default=None)
    parser.add_argument(
            "--skip-challenger",
            action="store_true",
            help="Load directly as --name (legacy; no A/B id)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    return gate_promote(
            args.src,
            args.name,
            seed=args.seed,
            workspace_id=args.workspace_id,
            source=args.source,
            vllm_url=args.vllm_url,
            heldout=args.heldout,
            heldout_limit=args.heldout_limit,
            max_drop=args.max_drop,
            eval_out=args.eval_out,
            dry_run=args.dry_run,
            skip_challenger=args.skip_challenger,
    )


if __name__ == "__main__":
    raise SystemExit(main())
