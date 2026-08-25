#!/usr/bin/env python3
"""Print eligible adapter names from telemetry summary.json (one per line)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("summary", type=Path)
    p.add_argument(
            "--kind",
            choices=["sft", "kto"],
            default="sft",
            help="eligible_sft or eligible_kto",
    )
    args = p.parse_args()
    if not args.summary.is_file():
        return 0
    try:
        data = json.loads(args.summary.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0
    key = "eligible_sft" if args.kind == "sft" else "eligible_kto"
    for name in data.get(key) or []:
        name = (name or "").strip()
        if name:
            print(name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
