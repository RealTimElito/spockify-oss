#!/usr/bin/env bash
# Lightweight board health monitor. Logs progress; restarts only if process died.
set -euo pipefail
OUT="${1:-/workspace/spockify/bench-out/lite-full-20260917}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INTERVAL="${SPOCKIFY_BENCH_MONITOR_SEC:-120}"
LOG="${OUT}/monitor.log"

while true; do
  ts="$(date -Is)"
  preds=0
  nonempty=0
  bad=0
  if [[ -f "${OUT}/preds.json" ]]; then
    read -r preds nonempty bad < <(python3 - <<PY
import json
from pathlib import Path
d=json.loads(Path("${OUT}/preds.json").read_text())
non=0; bad=0
for v in d.values():
  p=(v.get("model_patch") or "")
  if p.strip().startswith("diff --git"):
    non+=1
  elif p.strip():
    bad+=1
  else:
    bad+=1
print(len(d), non, bad)
PY
)
  fi
  alive=0
  pgrep -f 'run_mini_swe swebench' >/dev/null && alive=1 || true
  cid="$(docker ps --filter name=minisweagent -q | head -1 || true)"
  free_g="$(df -BG / | awk 'NR==2 {gsub(/G/,"",$4); print $4}')"
  echo "$ts alive=$alive preds=$preds nonempty=$nonempty bad=$bad container=${cid:-none} free=${free_g}G" | tee -a "$LOG"

  # Auto-restart if dead and incomplete
  if [[ "$alive" -eq 0 && "$preds" -lt 300 ]]; then
    echo "$ts RESTART board (dead, preds=$preds)" | tee -a "$LOG"
    KEY="$(ssh -o BatchMode=yes -o ConnectTimeout=10 tim@example.local \
      "sudo microk8s kubectl -n spockify get secret spockify-secrets -o jsonpath='{.data.LITELLM_MASTER_KEY}' | base64 -d" 2>/dev/null || true)"
    if [[ -n "$KEY" ]]; then
      export LITELLM_MASTER_KEY="$KEY" SPOCKIFY_API_KEY="$KEY"
      export SPOCKIFY_BASE_URL=http://127.0.0.1:24001
      export SPOCKIFY_BENCH_OUTPUT="$OUT"
      export SPOCKIFY_BENCH_WALL_SEC=1209600
      export SPOCKIFY_BENCH_MIN_FREE_GB=35
      export SPOCKIFY_BENCH_PRUNE_EVERY_SEC=600
      export SPOCKIFY_BENCH_MODEL=gpt-oss-20b
      export SPOCKIFY_BENCH_WORKERS=1
      nohup bash "${ROOT}/scripts/bench/run_lite_board.sh" >>"${OUT}/nohup-board.out" 2>&1 &
    fi
  fi

  # Drop clearly bogus patches so resume retries them
  if [[ "$bad" -gt 0 ]]; then
    python3 - <<PY
import json
from pathlib import Path
p=Path("${OUT}/preds.json")
d=json.loads(p.read_text())
chg=False
for k,v in list(d.items()):
  patch=(v.get("model_patch") or "")
  if (not patch.strip().startswith("diff --git")) and patch.strip():
    print("drop_bad", k, repr(patch[:60]))
    del d[k]
    chg=True
if chg:
  p.write_text(json.dumps(d, indent=2))
PY
  fi

  # Keep Spark VRAM for gpt-oss:20b — stop any other loaded Ollama tags.
  ssh -o BatchMode=yes -o ConnectTimeout=8 tim@example.local bash -s <<'REMOTE' >>"${OUT}/gpu-guard.log" 2>&1 || true
KC='sudo microk8s kubectl -n spockify'
mapfile -t loaded < <($KC exec deploy/ollama -c ollama -- ollama ps 2>/dev/null | awk 'NR>1 {print $1}')
for m in "${loaded[@]:-}"; do
  [[ -z "$m" ]] && continue
  case "$m" in
    gpt-oss:20b|gpt-oss-20b) ;;
    *) echo "$(date -Is) stop $m"; $KC exec deploy/ollama -c ollama -- ollama stop "$m" || true ;;
  esac
done
REMOTE

  bash "${ROOT}/scripts/bench/prune_swe_images.sh" >>"${OUT}/prune.log" 2>&1 || true
  sleep "$INTERVAL"
done
