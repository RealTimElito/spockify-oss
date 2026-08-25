#!/usr/bin/env python3
"""Copy gated adapter into vLLM loras dir, hot-swap load, update pointer."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tab_train.names import workspace_adapter_name  # noqa: E402
from tab_train.promote_lib import (  # noqa: E402
        copy_adapter,
        list_vllm_models,
        load_lora_adapter,
        load_pointer,
        save_pointer,
        unload_lora_adapter,
)

LOG = logging.getLogger("tab_train.promote")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, required=True, help="PEFT adapter dir")
    parser.add_argument("--name", required=True, help="LoRA name (e.g. tab-seed)")
    parser.add_argument("--workspace-id", default=None, help="Map workspace -> name")
    parser.add_argument("--seed", action="store_true", help="Mark as global seed adapter")
    parser.add_argument("--unload-previous", default=None, help="Unload this LoRA first")
    parser.add_argument("--skip-load", action="store_true", help="Copy+pointer only")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.workspace_id and args.name == "auto":
        args.name = workspace_adapter_name(args.workspace_id)

    if args.dry_run:
        LOG.info("dry-run would promote %s as %s", args.src, args.name)
        return 0

    dest = copy_adapter(args.src, args.name)
    LOG.info("on-disk adapter at %s", dest)

    if args.unload_previous:
        try:
            unload_lora_adapter(args.unload_previous)
        except Exception as exc:  # noqa: BLE001
            LOG.warning("unload %s failed: %s", args.unload_previous, exc)

    if not args.skip_load:
        load_lora_adapter(args.name)
        models = list_vllm_models()
        if args.name not in models:
            LOG.error("adapter %s not visible in /v1/models: %s", args.name, models)
            return 1
        LOG.info("loaded; models=%s", models)

    ptr = load_pointer()
    if args.seed:
        ptr["seed"] = args.name
    if args.workspace_id:
        ptr.setdefault("adapters", {})[args.workspace_id] = args.name
    ptr.setdefault("adapters", {})[args.name] = args.name
    save_pointer(ptr)
    LOG.info("pointer updated %s", ptr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
