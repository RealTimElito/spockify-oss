"""Detect whether tab-seed is still the 1-step smoke stub."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

from tab_train.thresholds import TrainThresholds

LOG = logging.getLogger("tab_train.seed_gate")

DEFAULT_LORAS = "/var/lib/spockify/vllm-tab/hf-cache/loras"
DEFAULT_MARKER = "/var/lib/spockify/tab-train/REAL_SEED_DONE"


def _loras_dir() -> Path:
    return Path(os.getenv("TAB_LORAS_DIR", DEFAULT_LORAS))


def _marker_path() -> Path:
    override = os.getenv("TAB_REAL_SEED_MARKER", "").strip()
    return Path(override or DEFAULT_MARKER)


def read_adapter_meta(adapter_dir: Path) -> dict[str, Any]:
    meta_path = adapter_dir / "tab_train_meta.json"
    if not meta_path.is_file():
        return {}
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        LOG.warning("unreadable meta %s: %s", meta_path, exc)
        return {}
    return data if isinstance(data, dict) else {}


def is_smoke_stub(
        adapter_dir: Path,
        *,
        thresholds: Optional[TrainThresholds] = None,
) -> bool:
    """True when adapter looks like the overnight-smoke (max_steps tiny)."""
    thr = thresholds or TrainThresholds.from_env()
    if not adapter_dir.is_dir():
        # Missing adapter → needs a real seed.
        return True
    meta = read_adapter_meta(adapter_dir)
    if not meta:
        # No meta (pre-meta smoke) — treat as stub if very small weight file.
        weight = adapter_dir / "adapter_model.safetensors"
        if weight.is_file() and weight.stat().st_size < 5_000_000:
            return True
        # Unknown but present — do not re-train overnight blindly.
        return False
    max_steps = meta.get("max_steps")
    n_examples = meta.get("n_examples")
    try:
        if max_steps is not None and int(max_steps) > 0:
            if int(max_steps) <= thr.seed_smoke_max_steps:
                return True
    except (TypeError, ValueError):
        pass
    try:
        if n_examples is not None and int(n_examples) <= 128 and (
                max_steps is None or int(max_steps or 0) <= thr.seed_smoke_max_steps
        ):
            # Tiny corpus + no/low step cap ⇒ still smoke.
            if max_steps is not None and int(max_steps) > 0:
                return True
    except (TypeError, ValueError):
        pass
    return False


def needs_real_seed(
        *,
        loras_dir: Optional[Path] = None,
        thresholds: Optional[TrainThresholds] = None,
) -> bool:
    """True once: smoke stub present (or missing) and REAL_SEED_DONE absent."""
    if _marker_path().is_file():
        LOG.info("REAL_SEED_DONE marker present — seed job no-ops")
        return False
    root = loras_dir or _loras_dir()
    seed_dir = root / "tab-seed"
    stub = is_smoke_stub(seed_dir, thresholds=thresholds)
    if stub:
        LOG.info("needs_real_seed=true (tab-seed is smoke stub or missing)")
    else:
        LOG.info("needs_real_seed=false (tab-seed looks real)")
    return stub


def write_real_seed_marker() -> Path:
    path = _marker_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("ok\n", encoding="utf-8")
    LOG.info("wrote %s", path)
    return path


def main() -> int:
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
            "action",
            choices=["check", "mark-done"],
            help="check exits 0 if needs seed, 1 if no-op; mark-done writes marker",
    )
    args = p.parse_args()
    if args.action == "mark-done":
        write_real_seed_marker()
        return 0
    return 0 if needs_real_seed() else 1


if __name__ == "__main__":
    raise SystemExit(main())
