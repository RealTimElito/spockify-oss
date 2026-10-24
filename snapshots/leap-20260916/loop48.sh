#!/usr/bin/env bash
# LEAP-LOOP-48H scheduler (LEAP-016). Do NOT arm on prod Spark GPUs.
# Twin/compose/amd64 sandbox only. See playbook §14.
# Set LEAP_SKIP_CANARY=1 / LEAP_SKIP_SWE=1 when a full Lite board already owns workers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${ROOT}/snapshots/leap-20260916"
STATE="${DIR}/loop48-state.json"
HOST_FLAG="${DIR}/HOST_FLAG"
LOCK="${DIR}/canary.lock"
HEARTBEAT="${DIR}/loop48-heartbeat.log"
START_TS="${LEAP_LOOP_START_TS:-}"
END_TS="${LEAP_LOOP_END_TS:-}"
SKIP_CANARY="${LEAP_SKIP_CANARY:-0}"
SKIP_SWE="${LEAP_SKIP_SWE:-1}"
# Seconds between slot checks
SLEEP_S="${LEAP_LOOP_SLEEP_S:-60}"

if [[ -z "$START_TS" || -z "$END_TS" ]]; then
  echo "Set LEAP_LOOP_START_TS and LEAP_LOOP_END_TS (unix epochs)." >&2
  echo "Refuse to default-start a 48h burn." >&2
  exit 2
fi

mkdir -p "$DIR" "${DIR}/cards" "${DIR}/redteam" "${DIR}/runs"
if [[ ! -f "$STATE" ]]; then
  python3 - "$STATE" <<'PY'
import json, sys
path = sys.argv[1]
json.dump({
  "next_due": {"C1": 0, "C2": 0, "C3": 0, "C4": 0, "C5": 0, "C7": 0},
  "inflight": None,
  "last_canary": None,
  "consecutive_red": 0,
  "host_flag": "UNKNOWN",
  "cycles": 0,
  "canary_green": 0,
  "canary_red": 0,
  "swe_attempted": 0,
}, open(path, "w"), indent=2)
print("init", path)
PY
fi

host_status() {
  head -1 "$HOST_FLAG" 2>/dev/null || echo "HOST-UNKNOWN"
}

due() {
  local slot="$1" every="$2" now="$3"
  python3 - "$STATE" "$slot" "$every" "$now" <<'PY'
import json, sys
path, slot, every, now = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
st = json.load(open(path))
nd = st.setdefault("next_due", {})
due_at = int(nd.get(slot, 0) or 0)
if now >= due_at:
    nd[slot] = now + every
    json.dump(st, open(path, "w"), indent=2)
    print("1")
else:
    print("0")
PY
}

bump() {
  python3 - "$STATE" "$1" "$2" <<'PY'
import json, sys
path, key, delta = sys.argv[1], sys.argv[2], int(sys.argv[3])
st = json.load(open(path))
st[key] = int(st.get(key, 0) or 0) + delta
json.dump(st, open(path, "w"), indent=2)
PY
}

set_field() {
  python3 - "$STATE" "$1" "$2" <<'PY'
import json, sys
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
st = json.load(open(path))
st[key] = val
json.dump(st, open(path, "w"), indent=2)
PY
}

write_closeout() {
  local report="${DIR}/loop48-report.md"
  python3 - "$STATE" "$report" "$START_TS" "$END_TS" <<'PY'
import json, sys, datetime
st = json.load(open(sys.argv[1]))
report, start, end = sys.argv[2], sys.argv[3], sys.argv[4]
ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
open(report, "w").write(
    f"# loop48 closeout\n\n"
    f"- closed_utc: {ts}\n"
    f"- start_ts: {start}\n"
    f"- end_ts: {end}\n"
    f"- cycles: {st.get('cycles')}\n"
    f"- canary_green: {st.get('canary_green')}\n"
    f"- canary_red: {st.get('canary_red')}\n"
    f"- swe_attempted: {st.get('swe_attempted')}\n"
    f"- last_canary: {st.get('last_canary')}\n"
    f"- consecutive_red: {st.get('consecutive_red')}\n"
    f"- host_flag: {st.get('host_flag')}\n"
    f"- inflight: {st.get('inflight')}\n"
    f"\nA11 public-safe: internal loop closed; no bare pass@1 claimed.\n"
)
print("wrote", report)
PY
}

echo "LEAP-LOOP-48H armed START=$START_TS END=$END_TS SKIP_CANARY=$SKIP_CANARY SKIP_SWE=$SKIP_SWE" | tee -a "$HEARTBEAT"

while true; do
  now="$(date +%s)"
  hs="$(host_status)"
  set_field host_flag "$hs"
  bump cycles 1

  if (( now >= END_TS )); then
    echo "END_TS reached; write closeout and exit 0" | tee -a "$HEARTBEAT"
    write_closeout
    exit 0
  fi

  # C3 Heartbeat every 30 min (also log each wake)
  if [[ "$(due C3 1800 "$now")" == "1" ]]; then
    echo "LOOP-ALIVE ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) host_flag=$hs last_canary=$(python3 -c 'import json;print(json.load(open("'"$STATE"'")).get("last_canary"))') blocked_by=${hs}" | tee -a "$HEARTBEAT"
  else
    echo "LOOP-ALIVE ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) host_flag=$hs" >> "$HEARTBEAT"
  fi

  # Freeze C4/C6 after two consecutive canary reds
  freeze=0
  reds="$(python3 -c 'import json;print(json.load(open("'"$STATE"'")).get("consecutive_red",0))')"
  if (( reds >= 2 )); then
    freeze=1
  fi

  # C1 Canary every 90 min
  if [[ "$SKIP_CANARY" != "1" && "$(due C1 5400 "$now")" == "1" ]]; then
    if [[ -f "$LOCK" ]]; then
      echo "C1 skip: canary.lock present" | tee -a "$HEARTBEAT"
    else
      touch "$LOCK"
      set +e
      SPOCKIFY_BASE_URL="${SPOCKIFY_BASE_URL:-http://127.0.0.1:24001}" \
        "$ROOT/scripts/canary_gate.sh" loop48
      rc=$?
      set -e
      rm -f "$LOCK"
      if [[ $rc -eq 0 ]]; then
        bump canary_green 1
        set_field consecutive_red 0
        set_field last_canary GREEN
        echo "C1 CANARY-GREEN" | tee -a "$HEARTBEAT"
      else
        bump canary_red 1
        python3 - "$STATE" <<'PY'
import json, sys
p = sys.argv[1]
st = json.load(open(p))
st["consecutive_red"] = int(st.get("consecutive_red", 0) or 0) + 1
st["last_canary"] = "RED"
json.dump(st, open(p, "w"), indent=2)
PY
        echo "C1 CANARY-RED rc=$rc" | tee -a "$HEARTBEAT"
      fi
    fi
  fi

  # C2 Trace flush every 90 min
  if [[ "$(due C2 5400 "$now")" == "1" ]]; then
    if [[ -x "$ROOT/scripts/bench/validate_trace_jsonl.py" || -f "$ROOT/scripts/bench/validate_trace_jsonl.py" ]]; then
      set +e
      find "$DIR/runs" -name '*.jsonl' -print0 2>/dev/null \
        | xargs -0 -r -n1 python3 "$ROOT/scripts/bench/validate_trace_jsonl.py" >> "$HEARTBEAT" 2>&1
      set -e
      echo "C2 trace flush done" | tee -a "$HEARTBEAT"
    fi
  fi

  # C4 Floor pack every 6h — skip if fixtures missing or freeze
  if [[ $freeze -eq 0 && "$(due C4 21600 "$now")" == "1" ]]; then
    if [[ -d "$DIR/fixtures/floor_shop" ]]; then
      echo "C4 floor pack placeholder (fixtures present)" | tee -a "$HEARTBEAT"
    else
      echo "C4 skip: floor fixtures absent" | tee -a "$HEARTBEAT"
    fi
  fi

  # C5 Red-team sample every 8h
  if [[ "$(due C5 28800 "$now")" == "1" ]]; then
    echo "C5 red-team sample: see redteam/FIXTURE_MAP.md tips 07/50/53/58" | tee -a "$HEARTBEAT"
  fi

  # C6 SWE — only if HOST-GREEN, not frozen, not skipped, no inflight
  if [[ $freeze -eq 0 && "$SKIP_SWE" != "1" && "$hs" == HOST-GREEN* ]]; then
    inflight="$(python3 -c 'import json;print(json.load(open("'"$STATE"'")).get("inflight") or "")')"
    if [[ -z "$inflight" ]]; then
      echo "C6 would start one Lite instance (not auto-started without LEAP_SWE_CMD)" | tee -a "$HEARTBEAT"
      # Require explicit LEAP_SWE_CMD to avoid colliding with an external board.
      if [[ -n "${LEAP_SWE_CMD:-}" ]]; then
        set_field inflight "swe-one"
        bump swe_attempted 1
        set +e
        bash -c "$LEAP_SWE_CMD"
        set -e
        set_field inflight ""
      fi
    fi
  fi

  # C7 Card drip every 12h
  if [[ "$(due C7 43200 "$now")" == "1" ]]; then
    echo "C7 card drip: append finished instance rows only" | tee -a "$HEARTBEAT"
  fi

  # LiteLLM unreachable → probe-only (still heartbeat)
  if [[ "$hs" == HOST-BLOCK* || "$hs" == INFRA-BLOCK* ]]; then
    echo "INFRA-BLOCK mode: heartbeat + probe only" | tee -a "$HEARTBEAT"
  fi

  sleep "$SLEEP_S"
done
