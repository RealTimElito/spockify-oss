#!/usr/bin/env bash
# Full SWE-bench Lite board (test split, ~300) with disk prune + resume.
# Host: Spock amd64 Docker + Spark LiteLLM (port-forward). Twin down OK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${SPOCKIFY_BENCH_OUTPUT:-${ROOT}/bench-out/lite-full-$(date +%Y%m%d)}"
MODEL="${SPOCKIFY_BENCH_MODEL:-gpt-oss-20b}"
BASE_URL="${SPOCKIFY_BASE_URL:-http://127.0.0.1:24001}"
WORKERS="${SPOCKIFY_BENCH_WORKERS:-1}"
SNAP="${ROOT}/snapshots/bench-results-$(date +%Y%m%d)"
LOG="${OUT}/board.log"
PRUNE_EVERY_SEC="${SPOCKIFY_BENCH_PRUNE_EVERY_SEC:-300}"

mkdir -p "$OUT" "$SNAP"

# Resolve Spark LiteLLM key if unset.
if [[ -z "${LITELLM_MASTER_KEY:-${SPOCKIFY_API_KEY:-}}" ]]; then
  if KEY="$(ssh -o BatchMode=yes -o ConnectTimeout=10 tim@example.local \
    "sudo microk8s kubectl -n spockify get secret spockify-secrets -o jsonpath='{.data.LITELLM_MASTER_KEY}' | base64 -d" \
    2>/dev/null)" && [[ -n "$KEY" ]]; then
    export LITELLM_MASTER_KEY="$KEY"
    export SPOCKIFY_API_KEY="$KEY"
  fi
fi

# Ensure PF to Spark LiteLLM.
if ! curl -sfS -o /dev/null --connect-timeout 2 \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-x}" \
  "${BASE_URL}/v1/models" 2>/dev/null; then
  echo "warn: ${BASE_URL} not reachable; attempting ssh PF :24001" >&2
  ssh -o BatchMode=yes -f -N -L 24001:127.0.0.1:4000 tim@example.local \
    "sleep 864000" 2>/dev/null || true
  # Prefer kubectl PF on Spark if local tunnel to litellm svc needed.
  ssh -o BatchMode=yes tim@example.local bash -s <<'REMOTE' || true
pkill -f 'port-forward.*litellm.*4000' 2>/dev/null || true
nohup sudo microk8s kubectl -n spockify port-forward --address 127.0.0.1 \
  svc/litellm 4000:4000 >/tmp/pf-litellm.log 2>&1 &
sleep 2
REMOTE
fi

{
  echo "=== lite board start $(date -Is) ==="
  echo "out=$OUT model=$MODEL workers=$WORKERS base=$BASE_URL"
  echo "split=test slice=all"
} | tee -a "$LOG"

# Disk prune watchdog (background).
(
  while true; do
    bash "${ROOT}/scripts/bench/prune_swe_images.sh" >>"${OUT}/prune.log" 2>&1 || true
    # Progress snapshot for RESULTS
    if [[ -f "${OUT}/preds.json" ]]; then
      python3 - <<PY >>"${OUT}/progress.jsonl" 2>/dev/null || true
import json, time, pathlib
p = pathlib.Path("${OUT}/preds.json")
d = json.loads(p.read_text()) if p.exists() else {}
n = len(d)
nonempty = sum(1 for v in d.values() if (v.get("model_patch") or "").strip())
print(json.dumps({"ts": time.time(), "preds": n, "nonempty_patches": nonempty}))
PY
    fi
    sleep "$PRUNE_EVERY_SEC"
  done
) &
PRUNE_PID=$!
trap 'kill $PRUNE_PID 2>/dev/null || true' EXIT

export SPOCKIFY_BENCH_SPLIT=test
export SPOCKIFY_BENCH_WALL_SEC="${SPOCKIFY_BENCH_WALL_SEC:-1209600}"
export SPOCKIFY_BASE_URL="$BASE_URL"

# Full board — resume skips existing preds.json keys.
set +e
"${ROOT}/scripts/run-swebench.sh" swe \
  --install \
  --subset lite \
  --split test \
  --slice all \
  --workers "$WORKERS" \
  --model "$MODEL" \
  --base-url "$BASE_URL" \
  --output "$OUT" \
  2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}
set -e

kill "$PRUNE_PID" 2>/dev/null || true
bash "${ROOT}/scripts/bench/prune_swe_images.sh" >>"${OUT}/prune.log" 2>&1 || true

echo "=== lite board agent exit rc=$RC $(date -Is) ===" | tee -a "$LOG"

# Honest exit-status tallies from latest yaml if present.
python3 - <<PY | tee -a "$LOG"
import json, pathlib, glob, yaml
out = pathlib.Path("${OUT}")
preds = {}
pf = out / "preds.json"
if pf.exists():
    preds = json.loads(pf.read_text())
print(f"preds={len(preds)}")
nonempty = sum(1 for v in preds.values() if (v.get("model_patch") or "").strip())
print(f"nonempty_patches={nonempty}")
# exit statuses
ys = sorted(out.glob("exit_statuses_*.yaml"))
if ys:
    data = yaml.safe_load(ys[-1].read_text()) or {}
    # file may be mapping instance->status or status->list
    print("exit_file", ys[-1].name)
    if isinstance(data, dict):
        from collections import Counter
        if data and isinstance(next(iter(data.values())), list):
            for k, v in data.items():
                print(f"status {k}: {len(v)}")
        else:
            c = Counter(data.values())
            for k, n in c.most_common():
                print(f"status {k}: {n}")
PY

exit "$RC"
