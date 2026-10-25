#!/usr/bin/env bash
# Evaluate SWE-bench Lite preds with official harness (Docker on Spock).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREDS="${1:?usage: eval_lite_preds.sh PREDS.json [RUN_ID] [OUT_DIR]}"
RUN_ID="${2:-spockify-lite-$(date +%Y%m%d)}"
OUT_DIR="${3:-$(dirname "$PREDS")/eval-${RUN_ID}}"
PY="${ROOT}/.venv-bench/bin/python"

mkdir -p "$OUT_DIR"
export PATH="${ROOT}/.venv-bench/bin:${PATH}"

echo "preds=$PREDS run_id=$RUN_ID out=$OUT_DIR"
# Official harness; workers=1 for stability / disk.
"$PY" -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --split test \
  --predictions_path "$PREDS" \
  --max_workers 1 \
  --run_id "$RUN_ID" \
  --timeout 1800 \
  2>&1 | tee "${OUT_DIR}/eval.log"

# Copy report if present under ./logs or similar.
find . -maxdepth 4 -name "*${RUN_ID}*" \( -name '*.json' -o -name '*.jsonl' \) \
  2>/dev/null | head -40 | tee "${OUT_DIR}/artifacts.txt" || true
