#!/usr/bin/env python3
"""Validate Spockify bench JSONL against schema-trace.v1.json (LEAP-001)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REQUIRED = (
    "ts",
    "ticket",
    "sha",
    "host",
    "role",
    "model",
    "think",
    "tools",
    "writes",
    "pytest",
    "rounds",
    "wall_s",
    "tokens",
    "stop_reason",
    "infra_fail",
    "instance_id",
)
STOP_REASONS = frozenset(
    {"early-stop", "max-rounds", "timeout", "user", "sandbox", "infra"}
)
ROLES = frozenset({"orch", "exec", "router", "swe"})


def validate_obj(obj: object, line_no: int) -> list[str]:
    errs: list[str] = []
    if not isinstance(obj, dict):
        return [f"L{line_no}: not an object"]
    for k in REQUIRED:
        if k not in obj:
            errs.append(f"L{line_no}: missing {k}")
    model = obj.get("model")
    if model is None or (isinstance(model, str) and not model.strip()):
        errs.append(f"L{line_no}: model empty")
    if "think" not in obj:
        errs.append(f"L{line_no}: think missing")
    if "wall_s" not in obj or not isinstance(obj.get("wall_s"), (int, float)):
        errs.append(f"L{line_no}: wall_s missing or not numeric")
    sr = obj.get("stop_reason")
    if sr is not None and sr not in STOP_REASONS:
        errs.append(f"L{line_no}: bad stop_reason {sr!r}")
    role = obj.get("role")
    if role is not None and role not in ROLES:
        errs.append(f"L{line_no}: bad role {role!r}")
    pytest = obj.get("pytest")
    if pytest is not None:
        if not isinstance(pytest, dict):
            errs.append(f"L{line_no}: pytest not object")
        else:
            for pk in ("n_pass", "n_fail", "tail"):
                if pk not in pytest:
                    errs.append(f"L{line_no}: pytest missing {pk}")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="+", type=Path, help="JSONL files")
    ap.add_argument(
        "--schema",
        type=Path,
        default=Path(__file__).with_name("schema-trace.v1.json"),
    )
    args = ap.parse_args()
    if not args.schema.is_file():
        print(f"error: schema missing: {args.schema}", file=sys.stderr)
        return 2

    all_errs: list[str] = []
    n_ok = 0
    n_lines = 0
    for path in args.paths:
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            n_lines += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                all_errs.append(f"{path}:L{i}: JSON {e}")
                continue
            errs = validate_obj(obj, i)
            if errs:
                all_errs.extend(f"{path}:{e}" for e in errs)
            else:
                n_ok += 1

    if all_errs:
        for e in all_errs[:50]:
            print(e, file=sys.stderr)
        if len(all_errs) > 50:
            print(f"... {len(all_errs) - 50} more", file=sys.stderr)
        print(f"REJECT {n_ok}/{n_lines} accepted", file=sys.stderr)
        return 1
    print(f"ACCEPT {n_ok}/{n_lines} turns ({args.schema.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
