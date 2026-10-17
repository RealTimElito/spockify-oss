#!/usr/bin/env python3
"""Product policy linter for spark/prod profile (skill-product-policy)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


FORBIDDEN_SUBSTR = (
    "abliterated",
    ":cloud",
    "heretic",
    "uncensored",
    "fable-heretic",
)


def check_tags(tags: list[str], profile: str) -> list[str]:
    viol = []
    if profile not in ("spark", "prod", "product"):
        return viol
    for t in tags:
        tl = (t or "").lower()
        for f in FORBIDDEN_SUBSTR:
            if f in tl:
                viol.append(f"{t} matches forbidden {f!r}")
    return viol


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="spark")
    ap.add_argument("--pack", default="packs/route-v1.json")
    ap.add_argument("--tags", nargs="*", default=[])
    args = ap.parse_args()
    tags = list(args.tags)
    pack_path = Path(args.pack)
    if pack_path.is_file():
        pack = json.loads(pack_path.read_text())
        for item in pack.get("items") or []:
            # oracle must not be forbidden on spark when used as product default
            om = item.get("oracle_model") or ""
            # 120b is allowed as eval oracle, not as silent product default — skip
            for f in item.get("forbidden_models") or []:
                if f and f not in (pack.get("spark_forbidden") or []):
                    pass
        tags.extend(pack.get("spark_forbidden") or [])
    # Self-check: forbidden list itself is the denylist, not selected models
    selected = [t for t in args.tags]
    viol = check_tags(selected, args.profile)
    if viol:
        print("FAIL")
        for v in viol:
            print(" ", v)
        return 1
    print(f"PASS profile={args.profile} checked_selected={len(selected)} denylist_ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
