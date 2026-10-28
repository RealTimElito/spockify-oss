#!/usr/bin/env bash
# LEAP-017: canary slot lock (90 min cadence helper). Does not start 48h loop.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${ROOT}/snapshots/leap-20260916"
LOCK="${DIR}/canary.lock"
mkdir -p "$DIR"

if [[ -z "${SPOCKIFY_BASE_URL:-}" ]]; then
  echo "CANARY-SKIP no SPOCKIFY_BASE_URL"
  exit 0
fi
if [[ ! -x "${ROOT}/scripts/canary_gate.sh" ]]; then
  echo "CANARY-SKIP missing canary_gate.sh"
  exit 0
fi

if [[ -f "$LOCK" ]]; then
  age=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
  if (( age < 5400 )); then
    echo "CANARY-SKIP locked age=${age}s (<90m)"
    exit 0
  fi
  echo "stale lock age=${age}s — taking slot"
fi

printf '%s\n' "pid=$$" "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$LOCK"
cleanup() { rm -f "$LOCK"; }
trap cleanup EXIT

"${ROOT}/scripts/canary_gate.sh" "slot-$(date +%H%M)"
