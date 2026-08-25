#!/usr/bin/env python3
"""Build per-workspace SFT + KTO datasets from Postgres tab_events.

Schema is owned by services/router/ghost_telemetry.py — do not invent columns.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tab_train.filters import (  # noqa: E402
        dedupe_by_prefix,
        is_junk_event,
        kto_label,
)
from tab_train.fim_format import build_fim_example, sft_target_text  # noqa: E402
from tab_train.names import workspace_adapter_name  # noqa: E402
from tab_train.thresholds import TrainThresholds  # noqa: E402

LOG = logging.getLogger("tab_train.telemetry")

_SELECT_SQL = """
SELECT
    request_id::text AS request_id,
    ts,
    workspace_id,
    rel_path,
    language,
    "trigger",
    model,
    prefix,
    suffix,
    suggestion,
    mode,
    latency_ms,
    suppress_reason,
    seen,
    fate,
    fate_ts,
    partial_accept_chars,
    settled_text
FROM tab_events
WHERE fate IS NOT NULL
    AND fate <> 'ignored'
    AND ($1::timestamptz IS NULL OR ts >= $1::timestamptz)
ORDER BY ts ASC
"""


def _fetch_rows(database_url: str, since: Optional[str]) -> list[dict[str, Any]]:
    try:
        import psycopg
    except ImportError:
        import psycopg2 as psycopg  # type: ignore

    rows: list[dict[str, Any]] = []
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL, (since,))
            cols = [d[0] for d in cur.description]
            for tup in cur.fetchall():
                row = dict(zip(cols, tup))
                for key in ("ts", "fate_ts"):
                    if row.get(key) is not None:
                        row[key] = str(row[key])
                if row.get("request_id") is not None:
                    row["request_id"] = str(row["request_id"])
                rows.append(row)
    return rows


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")


def _count_fates(rows: list[dict[str, Any]]) -> dict[str, int]:
    out = {"accepted": 0, "rejected": 0, "partial": 0, "other": 0}
    for row in rows:
        fate = (row.get("fate") or "").strip()
        if fate in out:
            out[fate] += 1
        else:
            out["other"] += 1
    return out


def build_for_workspace(
        workspace_id: str,
        rows: list[dict[str, Any]],
        out_dir: Path,
        *,
        also_text: bool,
) -> dict[str, int]:
    adapter = workspace_adapter_name(workspace_id)
    clean = [r for r in rows if not is_junk_event(r)]
    clean = dedupe_by_prefix(clean)

    sft: list[dict[str, Any]] = []
    kto: list[dict[str, Any]] = []
    for row in clean:
        target = sft_target_text(row)
        if target:
            rec = {
                    "id": row.get("request_id"),
                    "workspace_id": workspace_id,
                    "adapter": adapter,
                    "prefix": row.get("prefix") or "",
                    "suffix": row.get("suffix") or "",
                    "middle": target,
                    "fate": row.get("fate"),
                    "rel_path": row.get("rel_path"),
                    "language": row.get("language"),
            }
            if also_text:
                rec["text"] = build_fim_example(rec["prefix"], rec["suffix"], rec["middle"])
            sft.append(rec)

        label = kto_label(row)
        if label is None:
            continue
        prompt = build_fim_example(
                row.get("prefix") or "",
                row.get("suffix") or "",
                "",
        )
        completion = (row.get("suggestion") or "").strip()
        if not completion:
            continue
        kto.append({
                "id": row.get("request_id"),
                "workspace_id": workspace_id,
                "adapter": adapter,
                "prompt": prompt,
                "completion": completion,
                "label": bool(label),
                "fate": row.get("fate"),
                "seen": bool(row.get("seen")),
        })

    ws_dir = out_dir / adapter
    _write_jsonl(ws_dir / "sft.jsonl", sft)
    _write_jsonl(ws_dir / "kto.jsonl", kto)
    fates = _count_fates(clean)
    meta = {
            "workspace_id": workspace_id,
            "adapter": adapter,
            "n_sft": len(sft),
            "n_kto": len(kto),
            "n_raw": len(rows),
            "n_accepted": fates["accepted"],
            "n_rejected": fates["rejected"],
    }
    (ws_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return {
            "sft": len(sft),
            "kto": len(kto),
            "accepted": fates["accepted"],
            "rejected": fates["rejected"],
    }


def eligible_summary(
        workspaces: dict[str, dict[str, Any]],
        *,
        thr: TrainThresholds,
        tab_global_sft: int = 0,
) -> dict[str, Any]:
    """Decide which adapters clear train thresholds (pure; unit-tested)."""
    eligible_sft: list[str] = []
    eligible_kto: list[str] = []
    skipped: list[dict[str, Any]] = []
    for wid, info in sorted(workspaces.items()):
        adapter = info["adapter"]
        n_sft = int(info.get("sft") or 0)
        n_kto = int(info.get("kto") or 0)
        n_acc = int(info.get("accepted") or 0)
        if n_sft >= thr.min_sft and n_acc >= thr.min_sft:
            eligible_sft.append(adapter)
        else:
            skipped.append({
                    "adapter": adapter,
                    "reason": "below_min_sft",
                    "sft": n_sft,
                    "accepted": n_acc,
                    "min_sft": thr.min_sft,
            })
        if n_kto >= thr.min_kto:
            eligible_kto.append(adapter)
        elif n_kto > 0:
            skipped.append({
                    "adapter": adapter,
                    "reason": "below_min_kto",
                    "kto": n_kto,
                    "min_kto": thr.min_kto,
            })

    include_global = tab_global_sft >= thr.min_global_sft
    if include_global and "tab-global" not in eligible_sft:
        eligible_sft.append("tab-global")
    elif tab_global_sft > 0 and not include_global:
        skipped.append({
                "adapter": "tab-global",
                "reason": "below_min_global_sft",
                "sft": tab_global_sft,
                "min_global_sft": thr.min_global_sft,
        })

    return {
            "eligible_sft": eligible_sft,
            "eligible_kto": eligible_kto,
            "skipped": skipped,
            "thresholds": {
                    "min_sft": thr.min_sft,
                    "min_kto": thr.min_kto,
                    "min_global_sft": thr.min_global_sft,
                    "recent_days": thr.recent_days,
            },
    }


def main() -> int:
    thr = TrainThresholds.from_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
            "--database-url",
            default=os.getenv("DATABASE_URL", ""),
            help="Postgres URL (default: DATABASE_URL)",
    )
    parser.add_argument("--out", type=Path, default=Path("data/telemetry"))
    parser.add_argument(
            "--since",
            default=None,
            help="ISO timestamptz lower bound (default: now - TAB_RECENT_DAYS)",
    )
    parser.add_argument("--min-sft", type=int, default=thr.min_sft)
    parser.add_argument("--min-kto", type=int, default=thr.min_kto)
    parser.add_argument("--min-global-sft", type=int, default=thr.min_global_sft)
    parser.add_argument("--recent-days", type=int, default=thr.recent_days)
    parser.add_argument("--also-text-field", action="store_true")
    parser.add_argument(
            "--combined",
            action="store_true",
            help="Also write tab-global combined SFT when enough accepts",
    )
    parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Build summary only from --summary-in (no DB); for tests",
    )
    parser.add_argument("--summary-in", type=Path, default=None)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    thr = TrainThresholds(
            min_sft=args.min_sft,
            min_kto=args.min_kto,
            min_global_sft=args.min_global_sft,
            recent_days=args.recent_days,
    )

    if args.dry_run and args.summary_in:
        raw = json.loads(args.summary_in.read_text(encoding="utf-8"))
        summary = eligible_summary(
                raw.get("workspaces") or {},
                thr=thr,
                tab_global_sft=int(raw.get("tab_global_sft") or 0),
        )
        summary["workspaces"] = raw.get("workspaces") or {}
        summary["tab_global_sft"] = int(raw.get("tab_global_sft") or 0)
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "summary.json").write_text(
                json.dumps(summary, indent=2) + "\n", encoding="utf-8"
        )
        LOG.info(
                "dry-run eligible_sft=%s eligible_kto=%s skipped=%s",
                summary["eligible_sft"],
                summary["eligible_kto"],
                len(summary["skipped"]),
        )
        return 0

    if not args.database_url:
        LOG.error("DATABASE_URL / --database-url required")
        return 2

    since = args.since
    if not since and args.recent_days > 0:
        since = (
                datetime.now(timezone.utc) - timedelta(days=args.recent_days)
        ).isoformat()
        LOG.info("using since=%s (recent_days=%s)", since, args.recent_days)

    rows = _fetch_rows(args.database_url, since)
    LOG.info("fetched %s fate rows", len(rows))

    by_ws: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        wid = (row.get("workspace_id") or "").strip() or "_none_"
        by_ws[wid].append(row)

    workspaces: dict[str, dict[str, Any]] = {}
    for wid, ws_rows in sorted(by_ws.items()):
        counts = build_for_workspace(
                wid, ws_rows, args.out, also_text=args.also_text_field
        )
        adapter = workspace_adapter_name(wid)
        workspaces[wid] = {"adapter": adapter, **counts}
        LOG.info(
                "workspace=%s adapter=%s sft=%s kto=%s accepted=%s",
                wid, adapter, counts["sft"], counts["kto"], counts["accepted"],
        )

    tab_global_sft = 0
    if args.combined:
        clean = dedupe_by_prefix([r for r in rows if not is_junk_event(r)])
        all_sft_rows: list[dict[str, Any]] = []
        for row in clean:
            target = sft_target_text(row)
            if not target:
                continue
            rec = {
                    "id": row.get("request_id"),
                    "workspace_id": row.get("workspace_id"),
                    "adapter": "tab-global",
                    "prefix": row.get("prefix") or "",
                    "suffix": row.get("suffix") or "",
                    "middle": target,
            }
            if args.also_text_field:
                rec["text"] = build_fim_example(rec["prefix"], rec["suffix"], rec["middle"])
            all_sft_rows.append(rec)
        _write_jsonl(args.out / "tab-global" / "sft.jsonl", all_sft_rows)
        tab_global_sft = len(all_sft_rows)

    summary = eligible_summary(
            workspaces, thr=thr, tab_global_sft=tab_global_sft
    )
    summary["workspaces"] = workspaces
    summary["tab_global_sft"] = tab_global_sft
    summary["since"] = since
    summary["n_rows"] = len(rows)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "summary.json").write_text(
            json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    LOG.info(
            "summary %s eligible_sft=%s eligible_kto=%s",
            args.out / "summary.json",
            summary["eligible_sft"],
            summary["eligible_kto"],
    )
    if not summary["eligible_sft"] and not summary["eligible_kto"]:
        LOG.info(
                "SKIP: no adapters above thresholds "
                "(min_sft=%s min_kto=%s min_global_sft=%s)",
                thr.min_sft, thr.min_kto, thr.min_global_sft,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
