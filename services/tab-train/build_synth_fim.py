#!/usr/bin/env python3
"""Punch synthetic FIM holes from local repos → granite-ready JSONL.

Does not call a teacher; middles are ground truth from source. Feed the
output into build_distill_sft.py and/or train_sft_lora.py.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tab_train.fim_format import build_fim_example  # noqa: E402
from tab_train.synth_holes import DEFAULT_EXTS, generate_holes  # noqa: E402

LOG = logging.getLogger("tab_train.synth")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
            "--roots",
            nargs="+",
            type=Path,
            required=True,
            help="Repo roots or files to punch holes in",
    )
    parser.add_argument(
            "--out",
            type=Path,
            default=Path("data/synth_fim.jsonl"),
    )
    parser.add_argument("--max-holes", type=int, default=5000)
    parser.add_argument("--holes-per-file", type=int, default=2)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
            "--exts",
            nargs="+",
            default=None,
            help="Override extensions (e.g. .py .ts)",
    )
    parser.add_argument(
            "--also-text-field",
            action="store_true",
            help="Write full FIM causal 'text' field for SFT",
    )
    parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print counts only; do not write JSONL",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    roots = [p for p in args.roots if p.exists()]
    if not roots:
        LOG.error("no existing roots in %s", args.roots)
        return 2

    exts = frozenset(args.exts) if args.exts else DEFAULT_EXTS
    holes = generate_holes(
            roots,
            max_holes=args.max_holes,
            holes_per_file=args.holes_per_file,
            seed=args.seed,
            exts=exts,
    )
    LOG.info("punched %s holes from %s roots", len(holes), len(roots))
    if args.dry_run:
        by_lang: dict[str, int] = {}
        by_strat: dict[str, int] = {}
        for h in holes:
            by_lang[h.language] = by_lang.get(h.language, 0) + 1
            by_strat[h.strategy] = by_strat.get(h.strategy, 0) + 1
        print(json.dumps({
                "n": len(holes),
                "by_language": by_lang,
                "by_strategy": by_strat,
                "sample_ids": [h.id for h in holes[:5]],
        }, indent=2))
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        for h in holes:
            rec: dict[str, Any] = h.as_dict()
            if args.also_text_field:
                rec["text"] = build_fim_example(h.prefix, h.suffix, h.middle)
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    meta = {
            "n": len(holes),
            "roots": [str(p) for p in roots],
            "max_holes": args.max_holes,
            "holes_per_file": args.holes_per_file,
            "seed": args.seed,
    }
    meta_path = args.out.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    LOG.info("wrote %s (+ meta %s)", args.out, meta_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
