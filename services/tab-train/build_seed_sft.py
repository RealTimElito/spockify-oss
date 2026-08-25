#!/usr/bin/env python3
"""Download + format open NEP/edit-prediction data into granite FIM JSONL.

Licenses (verify upstream if re-vendoring):
    - zed-industries/zeta          — Apache-2.0 (data; Zeta *weights* are Qwen-tied
                                                                      and banned by scripts/pull-models.sh — data OK)
    - continuedev/instinct-data    — Apache-2.0 (NES / next-edit pairs)

Caps examples for a first overnight run (default 100k).
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import re
import sys
from pathlib import Path
from typing import Any, Iterator, Optional

# Allow `python build_seed_sft.py` from this directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from tab_train.fim_format import build_fim_example  # noqa: E402

LOG = logging.getLogger("tab_train.seed")

DEFAULT_DATASETS = (
        "zed-industries/zeta",
        "continuedev/instinct-data",
)

_CURSOR_MARKERS = (
        "<|user_cursor|>",
        "<|cursor|>",
        "<cursor>",
        "█",
)


def _split_at_cursor(text: str) -> tuple[str, str]:
    for marker in _CURSOR_MARKERS:
        if marker in text:
            pre, _, post = text.partition(marker)
            return pre, post
    # Fallback: last non-empty line is "middle-ish"; keep as prefix-only.
    return text, ""


def _strip_zeta_wrappers(text: str) -> str:
    """Best-effort strip of Zeta SPM / merge markers; keep code body."""
    t = text or ""
    t = re.sub(r"<\[fim-(?:prefix|suffix|middle)\]>", "", t)
    t = re.sub(r"<{7} CURRENT\n?", "", t)
    t = re.sub(r"={7}\n?", "", t)
    t = re.sub(r">{7} UPDATED\n?", "", t)
    t = re.sub(r"<\|marker_\d+\|>", "", t)
    return t


def _from_zeta_row(row: dict[str, Any]) -> Optional[dict[str, str]]:
    """Map a Zeta SFT row into prefix/suffix/middle when possible."""
    # Observed shapes vary across zeta releases; tolerate several keys.
    prompt = row.get("prompt") or row.get("input") or row.get("events") or ""
    completion = (
            row.get("completion")
            or row.get("output")
            or row.get("response")
            or row.get("label")
            or ""
    )
    if isinstance(prompt, list):
        prompt = "\n".join(str(x) for x in prompt)
    if isinstance(completion, list):
        completion = "\n".join(str(x) for x in completion)
    prompt_s = _strip_zeta_wrappers(str(prompt))
    mid = _strip_zeta_wrappers(str(completion)).strip()
    if not mid:
        return None
    # Prefer explicit editable-region split; else treat prompt as prefix.
    if "<|user_cursor|>" in prompt_s or "<<<<<<< CURRENT" in str(prompt):
        # Rough: text before cursor = prefix, after = suffix inside region.
        body = prompt_s
        prefix, suffix = _split_at_cursor(body)
    else:
        prefix, suffix = prompt_s, ""
    if not prefix.strip() and not suffix.strip():
        return None
    return {
            "prefix": prefix[-8000:],
            "suffix": suffix[:4000],
            "middle": mid[:2000],
            "source": "zed-industries/zeta",
    }


def _from_instinct_row(row: dict[str, Any]) -> Optional[dict[str, str]]:
    """Map Instinct NES rows (context + next edit) into FIM-ish pairs."""
    # instinct-data is language-split; fields commonly include input/output or
    # messages. Keep tolerant.
    if "prefix" in row and "completion" in row:
        return {
                "prefix": str(row.get("prefix") or "")[-8000:],
                "suffix": str(row.get("suffix") or "")[:4000],
                "middle": str(row.get("completion") or row.get("middle") or "")[:2000],
                "source": "continuedev/instinct-data",
        }
    prompt = row.get("prompt") or row.get("input") or ""
    completion = row.get("completion") or row.get("output") or row.get("edit") or ""
    if isinstance(prompt, dict):
        prefix = str(prompt.get("prefix") or prompt.get("code") or "")
        suffix = str(prompt.get("suffix") or "")
    else:
        prefix, suffix = _split_at_cursor(_strip_zeta_wrappers(str(prompt)))
    mid = str(completion).strip()
    if not mid:
        # Diff-style: take added lines as middle when present.
        edit = row.get("next_edit") or row.get("diff") or ""
        added = [
                ln[1:] for ln in str(edit).splitlines()
                if ln.startswith("+") and not ln.startswith("+++")
        ]
        mid = "\n".join(added).strip()
    if not mid:
        return None
    return {
            "prefix": prefix[-8000:],
            "suffix": suffix[:4000],
            "middle": mid[:2000],
            "source": "continuedev/instinct-data",
    }


def _iter_hf_rows(dataset_id: str, split_hint: str = "train") -> Iterator[dict[str, Any]]:
    from datasets import load_dataset, get_dataset_config_names

    configs: list[Optional[str]] = [None]
    try:
        names = get_dataset_config_names(dataset_id)
        if names:
            configs = list(names)
    except Exception:  # noqa: BLE001 - hub layout varies
        configs = [None]

    for cfg in configs:
        try:
            if cfg is None:
                ds = load_dataset(dataset_id, split=split_hint)
            else:
                # Prefer train split when present.
                bundle = load_dataset(dataset_id, cfg)
                split = split_hint if split_hint in bundle else list(bundle.keys())[0]
                ds = bundle[split]
        except Exception as exc:  # noqa: BLE001
            LOG.warning("skip %s cfg=%s: %s", dataset_id, cfg, exc)
            continue
        LOG.info("loaded %s cfg=%s n=%s", dataset_id, cfg, len(ds))
        for row in ds:
            yield dict(row)


def convert_row(dataset_id: str, row: dict[str, Any]) -> Optional[dict[str, str]]:
    if "zeta" in dataset_id:
        return _from_zeta_row(row)
    if "instinct" in dataset_id:
        return _from_instinct_row(row)
    return _from_zeta_row(row) or _from_instinct_row(row)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
            "--out",
            type=Path,
            default=Path("data/seed_sft.jsonl"),
            help="Output JSONL path",
    )
    parser.add_argument("--max-examples", type=int, default=100_000)
    parser.add_argument(
            "--datasets",
            nargs="+",
            default=list(DEFAULT_DATASETS),
            help="HF dataset ids (Apache-licensed NEP/edit data)",
    )
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
            "--also-text-field",
            action="store_true",
            help="Also write a 'text' field with full FIM causal string",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    random.seed(args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)

    collected: list[dict[str, str]] = []
    for ds_id in args.datasets:
        LOG.info("dataset %s", ds_id)
        for row in _iter_hf_rows(ds_id):
            ex = convert_row(ds_id, row)
            if not ex or not (ex.get("middle") or "").strip():
                continue
            collected.append(ex)
            if len(collected) >= args.max_examples * 2:
                # Oversample then shuffle/cap so multi-dataset mix is fairer.
                break
        if len(collected) >= args.max_examples * 2:
            break

    random.shuffle(collected)
    collected = collected[: args.max_examples]
    LOG.info("writing %s examples -> %s", len(collected), args.out)

    with args.out.open("w", encoding="utf-8") as fh:
        for i, ex in enumerate(collected):
            rec: dict[str, Any] = {
                    "id": f"seed-{i}",
                    "prefix": ex["prefix"],
                    "suffix": ex["suffix"],
                    "middle": ex["middle"],
                    "source": ex.get("source"),
                    "license_note": (
                            "Apache-2.0 open edit-prediction data; base weights are "
                            "ibm-granite/granite-8b-code-base-128k (not Qwen/Zeta weights)"
                    ),
            }
            if args.also_text_field:
                rec["text"] = build_fim_example(ex["prefix"], ex["suffix"], ex["middle"])
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    meta = {
            "n": len(collected),
            "datasets": args.datasets,
            "max_examples": args.max_examples,
            "licenses": {
                    "zed-industries/zeta": "Apache-2.0 (dataset)",
                    "continuedev/instinct-data": "Apache-2.0 (dataset)",
                    "base_model": "ibm-granite/granite-8b-code-base-128k Apache-2.0",
            },
    }
    meta_path = args.out.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    LOG.info("meta %s", meta_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
