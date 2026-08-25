#!/usr/bin/env python3
"""Reload champion (+ pointer) LoRAs into vLLM after restart.

Idempotent: skips names already present in /v1/models. Safe to run from
scale_helper restore, a CronJob, or manually after node reboot.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tab_train.champion_lib import list_champion_names  # noqa: E402
from tab_train.promote_lib import (  # noqa: E402
        list_vllm_models,
        load_lora_adapter,
        load_pointer,
        loras_dir,
)
from tab_train.status_lib import write_status  # noqa: E402

LOG = logging.getLogger("tab_train.reload")


def names_to_reload(*, include_pointer: bool = True) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for name in list_champion_names():
        if name not in seen:
            seen.add(name)
            names.append(name)
    if include_pointer:
        ptr = load_pointer()
        seed = ptr.get("seed")
        if isinstance(seed, str) and seed.strip() and seed not in seen:
            seen.add(seed)
            names.append(seed)
        adapters = ptr.get("adapters") or {}
        if isinstance(adapters, dict):
            for val in adapters.values():
                if isinstance(val, str) and val.strip() and val not in seen:
                    seen.add(val)
                    names.append(val)
    return names


def wait_vllm(timeout: float = 300.0, poll: float = 3.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            list_vllm_models()
            return True
        except Exception:  # noqa: BLE001
            time.sleep(poll)
    return False


def reload_all(
        *,
        include_pointer: bool = True,
        wait: bool = True,
        timeout: float = 300.0,
        write_job_status: bool = False,
) -> int:
    if wait and not wait_vllm(timeout=timeout):
        LOG.error("vLLM not reachable within %.0fs", timeout)
        if write_job_status:
            write_status("ensure-loras", outcome="error", detail="vllm_unreachable")
        return 1

    try:
        loaded = set(list_vllm_models())
    except Exception as exc:  # noqa: BLE001
        LOG.error("list models failed: %s", exc)
        if write_job_status:
            write_status("ensure-loras", outcome="error", detail=str(exc))
        return 1

    wanted = names_to_reload(include_pointer=include_pointer)
    if not wanted:
        # Fall back to on-disk tab-seed if present (first boot / no champions yet).
        seed_dir = loras_dir() / "tab-seed"
        if seed_dir.is_dir() and (seed_dir / "adapter_config.json").is_file():
            wanted = ["tab-seed"]
        else:
            LOG.info("nothing to reload (no champions/pointer/tab-seed)")
            if write_job_status:
                write_status("ensure-loras", outcome="ok", detail="nothing_to_load")
            return 0

    ok: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []
    root = loras_dir()
    for name in wanted:
        if name in loaded or name == "tab-fim":
            skipped.append(name)
            continue
        adapter = root / name
        if not adapter.is_dir() or not (adapter / "adapter_config.json").is_file():
            LOG.warning("skip %s — missing on disk under %s", name, root)
            failed.append(name)
            continue
        try:
            load_lora_adapter(name)
            ok.append(name)
            loaded.add(name)
            LOG.info("reloaded %s", name)
        except Exception as exc:  # noqa: BLE001
            LOG.error("reload %s failed: %s", name, exc)
            failed.append(name)

    detail = f"loaded={ok or ['none']} skipped={skipped or ['none']} failed={failed or ['none']}"
    LOG.info(detail)
    if write_job_status:
        write_status(
                "ensure-loras",
                outcome="ok" if not failed else "partial",
                detail=detail,
                extra={"champions": list_champion_names(), "reloaded": ok},
        )
    return 1 if failed and not ok else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-pointer", action="store_true", help="Champions only")
    parser.add_argument("--no-wait", action="store_true")
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument(
            "--status",
            action="store_true",
            help="Write tab-train status.json",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    return reload_all(
            include_pointer=not args.no_pointer,
            wait=not args.no_wait,
            timeout=args.timeout,
            write_job_status=args.status,
    )


if __name__ == "__main__":
    raise SystemExit(main())
