#!/usr/bin/env python3
"""Fetch only the files needed for ONE CyberGym task from the upstream
Hugging Face dataset, instead of `git clone`-ing the full ~236GB
`sunblaze-ucb/cybergym` dataset repo.

Upstream's own README does:
    git lfs install
    git clone https://huggingface.co/datasets/sunblaze-ucb/cybergym cybergym_data

That pulls every task's source archive at once. The HF dataset repo is laid
out as `data/<arvo|oss-fuzz>/<id>/<file>` (see upstream
`src/cybergym/task/arvo_task.py` DIFFICULTY_FILES / ARVO_FILES), so a single
task's files can be fetched individually with `hf_hub_download` — this is
the file set `cybergym.task.gen_task` actually reads for a given
`--difficulty`. For the official 10-task subset (see
`evaluations/cybergym-harness/tasks/subset10.json`) per-task sizes are
roughly tens to a few hundred MB, not hundreds of GB.

This script does NOT touch CyberGym's separate *server* data (the Docker
runner images on Docker Hub: `n132/arvo`, `cybergym/oss-fuzz`,
`cybergym/oss-fuzz-base-runner`). Those are pulled with plain `docker pull`
by run_task.py — see docs/CYBERGYM.md.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from huggingface_hub import hf_hub_download
except ImportError:  # pragma: no cover
    print(
        "error: huggingface_hub not installed. "
        "Run evaluations/cybergym-harness/install.sh first.",
        file=sys.stderr,
    )
    raise

HF_REPO_ID = "sunblaze-ucb/cybergym"
HF_REPO_TYPE = "dataset"

# Mirrors cybergym.task.arvo_task.DIFFICULTY_FILES. Kept as a local fallback
# so this script still works if the upstream import path changes; the real
# source of truth at run time is the installed `cybergym` package.
_FALLBACK_DIFFICULTY_FILES = {
    "level0": ["repo-vul.tar.gz"],
    "level1": ["repo-vul.tar.gz", "description.txt"],
    "level2": ["repo-vul.tar.gz", "description.txt", "error.txt"],
    "level3": [
        "repo-vul.tar.gz",
        "repo-fix.tar.gz",
        "error.txt",
        "description.txt",
        "patch.diff",
    ],
}


def difficulty_files(level: str) -> list[str]:
    try:
        from cybergym.task.arvo_task import DIFFICULTY_FILES
        from cybergym.task.types import TaskDifficulty

        files = DIFFICULTY_FILES.get(TaskDifficulty(level))
        if files:
            return list(files)
    except Exception:
        pass
    return list(_FALLBACK_DIFFICULTY_FILES[level])


def split_task_id(task_id: str) -> tuple[str, str]:
    kind, _, ident = task_id.partition(":")
    if not ident:
        raise ValueError(f"invalid task_id: {task_id!r} (expected 'arvo:<id>' or 'oss-fuzz:<id>')")
    if kind not in ("arvo", "oss-fuzz", "oss-fuzz-latest"):
        raise ValueError(f"unsupported task_id kind: {kind!r}")
    return kind, ident


def fetch_task(task_id: str, difficulty: str, data_dir: Path) -> Path:
    """Download the files needed for `task_id` at `difficulty` into
    `data_dir/<kind>/<id>/...` (the layout cybergym.task.gen_task expects
    for --data-dir). Returns the task's directory.
    """
    kind, ident = split_task_id(task_id)
    dest_dir = data_dir / kind / ident
    dest_dir.mkdir(parents=True, exist_ok=True)

    missing: list[str] = []
    for fname in difficulty_files(difficulty):
        dest = dest_dir / fname
        if dest.exists():
            continue
        remote_path = f"data/{kind}/{ident}/{fname}"
        print(f"fetch: {remote_path}", file=sys.stderr)
        try:
            cached = hf_hub_download(
                repo_id=HF_REPO_ID,
                repo_type=HF_REPO_TYPE,
                filename=remote_path,
            )
        except Exception as exc:  # noqa: BLE001
            missing.append(fname)
            print(f"  warn: {fname} unavailable ({exc})", file=sys.stderr)
            continue
        # hf_hub_download returns a symlink into the shared HF cache;
        # copy so the task dir is self-contained and the cache can be reused.
        import shutil

        shutil.copy(cached, dest)

    if missing and "description.txt" in missing:
        raise RuntimeError(f"task {task_id} has no description.txt at difficulty {difficulty}")

    return dest_dir


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-id", required=True, help="e.g. oss-fuzz:42535468 or arvo:10400")
    parser.add_argument("--difficulty", default="level1", choices=sorted(_FALLBACK_DIFFICULTY_FILES))
    parser.add_argument("--data-dir", required=True, type=Path, help="cybergym_data/data root")
    args = parser.parse_args(argv)

    dest = fetch_task(args.task_id, args.difficulty, args.data_dir)
    print(str(dest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
