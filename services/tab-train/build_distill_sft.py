#!/usr/bin/env python3
"""Distill teacher FIM completions into student SFT JSONL.

Reads synthetic (or telemetry-shaped) holes with prefix/suffix[/middle],
calls a teacher (default: live vLLM tab-fim), filters, and writes the same
JSONL shape as build_seed_sft.py / train_sft_lora.py expect.

Label modes (--label):
  ground_truth      — no teacher calls; copy GT middle (synth SFT)
  teacher           — teacher middle only
  teacher_filtered  — teacher when similar to GT, else drop/fallback
  mix               — teacher when good+similar, else GT (default for distill)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tab_train.distill_lib import (  # noqa: E402
        complete_fim,
        default_api_style,
        default_teacher_model,
        default_teacher_url,
        distill_quality_report,
        select_label,
)
from tab_train.fim_format import build_fim_example  # noqa: E402

LOG = logging.getLogger("tab_train.distill_cli")


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--holes", type=Path, required=True, help="Input JSONL")
    parser.add_argument("--out", type=Path, required=True, help="Output SFT JSONL")
    parser.add_argument(
            "--label",
            choices=("ground_truth", "teacher", "teacher_filtered", "mix"),
            default="mix",
    )
    parser.add_argument("--teacher-url", default=None)
    parser.add_argument("--teacher-model", default=None)
    parser.add_argument(
            "--api-style",
            choices=("ollama_infill", "completions", "chat"),
            default=None,
            help="ollama_infill=Codestral native FIM (default); "
                 "completions=vLLM granite FIM; chat=gpt-oss-style",
    )
    parser.add_argument("--max-examples", type=int, default=0, help="0 = all")
    parser.add_argument("--max-tokens", type=int, default=96)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--min-teacher-f1", type=float, default=0.35)
    parser.add_argument("--also-text-field", action="store_true")
    parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Call teacher for at most --dry-run-n rows; print stats",
    )
    parser.add_argument("--dry-run-n", type=int, default=3)
    parser.add_argument("--sleep-ms", type=int, default=0, help="Throttle teacher")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    rows = _load_jsonl(args.holes)
    if args.max_examples and args.max_examples > 0:
        rows = rows[: args.max_examples]
    if args.dry_run:
        rows = rows[: args.dry_run_n]

    need_teacher = args.label != "ground_truth"
    teacher_url = (args.teacher_url or default_teacher_url()).rstrip("/")
    teacher_model = args.teacher_model or default_teacher_model()
    api_style = args.api_style or default_api_style()
    LOG.info(
            "rows=%s label=%s teacher=%s@%s style=%s",
            len(rows), args.label, teacher_model, teacher_url, api_style,
    )

    written: list[dict[str, Any]] = []
    reject_counts: dict[str, int] = {}
    label_counts: dict[str, int] = {}
    quality_pairs: list[tuple[str, str]] = []

    for i, row in enumerate(rows):
        prefix = str(row.get("prefix") or "")
        suffix = str(row.get("suffix") or "")
        gt = str(row.get("middle") or "")
        teacher_text: Optional[str] = None
        if need_teacher:
            try:
                teacher_text = complete_fim(
                        teacher_url,
                        teacher_model,
                        prefix,
                        suffix,
                        max_tokens=args.max_tokens,
                        temperature=args.temperature,
                        api_style=api_style,
                )
            except Exception as exc:  # noqa: BLE001
                LOG.warning("teacher fail id=%s: %s", row.get("id"), exc)
                reject_counts["teacher_error"] = reject_counts.get("teacher_error", 0) + 1
                if args.label == "teacher":
                    continue
                teacher_text = None
            if args.sleep_ms > 0:
                time.sleep(args.sleep_ms / 1000.0)

        middle, tag = select_label(
                ground_truth=gt,
                teacher=teacher_text,
                mode=args.label,
                min_teacher_f1=args.min_teacher_f1,
        )
        if middle is None:
            reject_counts[tag] = reject_counts.get(tag, 0) + 1
            continue
        label_counts[tag.split("=")[0]] = label_counts.get(tag.split("=")[0], 0) + 1
        if teacher_text is not None and gt:
            quality_pairs.append((teacher_text, gt))

        rec: dict[str, Any] = {
                "id": str(row.get("id") or f"distill-{i}"),
                "prefix": prefix[-8000:],
                "suffix": suffix[:4000],
                "middle": middle[:2000],
                "source": row.get("source") or "distill",
                "path": row.get("path"),
                "language": row.get("language"),
                "label_tag": tag,
                "teacher_model": teacher_model if need_teacher else None,
        }
        if args.also_text_field:
            rec["text"] = build_fim_example(rec["prefix"], rec["suffix"], rec["middle"])
        written.append(rec)

    report = {
            "n_in": len(rows),
            "n_out": len(written),
            "label": args.label,
            "teacher_model": teacher_model if need_teacher else None,
            "teacher_url": teacher_url if need_teacher else None,
            "label_counts": label_counts,
            "reject_counts": reject_counts,
            "teacher_vs_gt": (
                    distill_quality_report(quality_pairs) if quality_pairs else None
            ),
    }
    LOG.info("distill report %s", json.dumps(report))

    if args.dry_run:
        print(json.dumps({
                "report": report,
                "samples": [
                        {
                                "id": r["id"],
                                "label_tag": r["label_tag"],
                                "middle": r["middle"][:120],
                        }
                        for r in written[:5]
                ],
        }, indent=2))
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        for rec in written:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    meta_path = args.out.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    LOG.info("wrote %s examples -> %s", len(written), args.out)
    return 0 if written else 2


if __name__ == "__main__":
    raise SystemExit(main())
