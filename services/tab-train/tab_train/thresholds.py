"""Tunable Tab-train thresholds (env / ConfigMap — no code edits needed)."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class TrainThresholds:
    """Skip thin datasets so CronJobs do not burn GPU."""

    min_sft: int = 32
    min_kto: int = 48
    min_global_sft: int = 64
    # Min distill SFT rows before freeing GPU for PEFT (CronJob / host train).
    min_distill: int = 64
    recent_days: int = 14
    # Treat adapters with max_steps <= this as the 1-step smoke stub.
    seed_smoke_max_steps: int = 1

    @classmethod
    def from_env(cls) -> "TrainThresholds":
        return cls(
                min_sft=_int_env("TAB_MIN_SFT", 32),
                min_kto=_int_env("TAB_MIN_KTO", 48),
                min_global_sft=_int_env("TAB_MIN_GLOBAL_SFT", 64),
                min_distill=_int_env("TAB_MIN_DISTILL", 64),
                recent_days=_int_env("TAB_RECENT_DAYS", 14),
                seed_smoke_max_steps=_int_env("TAB_SEED_SMOKE_MAX_STEPS", 1),
        )


def env_defaults_help() -> str:
    t = TrainThresholds()
    return (
            f"TAB_MIN_SFT={t.min_sft} TAB_MIN_KTO={t.min_kto} "
            f"TAB_MIN_GLOBAL_SFT={t.min_global_sft} TAB_MIN_DISTILL={t.min_distill} "
            f"TAB_RECENT_DAYS={t.recent_days} "
            f"TAB_SEED_SMOKE_MAX_STEPS={t.seed_smoke_max_steps}"
    )
