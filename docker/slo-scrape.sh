#!/usr/bin/env bash
# Record one G6 SLO sample. No kubectl, no video gen, no ollama stop.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC="${ROOT}/docker/slo.json"
RECORD=""
OFFLINE=0
STAMP="$(date '+%Y-%m-%dT%H:%M:%S%z')"

usage() {
  cat <<'EOF'
Record one operator SLO sample (G6).

  docker/slo-scrape.sh [--offline] [--record DIR|FILE]

Does not call kubectl, does not start video generation, and does not
unload pinned models. Missing loopback endpoints are skip, not fail.
Window start is the spec start date; this script does not invent history.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --offline) OFFLINE=1; shift ;;
    --record)
      RECORD="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

python3 - "$SPEC" "$STAMP" "$OFFLINE" "$RECORD" <<'PY'
import json, os, sys, time, urllib.request
from datetime import datetime, date
from pathlib import Path

spec_path, stamp, offline, record = sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4]
spec = json.loads(Path(spec_path).read_text(encoding="utf-8"))
window = spec.get("window") or {}
targets = spec.get("targets") or []
samples = []

def parse_ts(raw: str):
    s = (raw or "").strip()
    if not s:
        return None
    if len(s) >= 6 and s[-3] == ":" and (s[-6] in "+-"):
        s = s[:-3] + s[-2:]
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        try:
            return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None

def complete_history_days(jsonl: Path, window_start: str, now_stamp: str) -> int:
    """Calendar dates >= window start and strictly before today. Not invented."""
    now = parse_ts(now_stamp)
    win = parse_ts(str(window_start).replace("+02:00", "+0200"))
    today = now.date() if now else date.today()
    wdate = win.date() if win else today
    found = set()
    if jsonl.is_file():
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = parse_ts(str(rec.get("ts") or ""))
            if not ts:
                continue
            d = ts.date()
            if d >= wdate and d < today:
                found.add(d)
    return len(found)

def probe_http(url: str, timeout=2.0) -> dict:
    t0 = time.monotonic()
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = getattr(resp, "status", 200)
            resp.read(256)
        return {
            "ok": 200 <= code < 400,
            "status": code,
            "latency_s": round(time.monotonic() - t0, 3),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": type(exc).__name__,
            "latency_s": round(time.monotonic() - t0, 3),
        }

for t in targets:
    rec = {
        "id": t["id"],
        "indicator": t.get("indicator"),
        "objective": t.get("objective", t.get("objective_s")),
        "status": "skip",
        "detail": None,
    }
    kind = t.get("scrape")
    if kind == "skip" or t.get("indicator") == "expected_unavailable":
        rec["status"] = "expected_skip"
        rec["detail"] = t.get("description")
    elif kind == "http":
        url = os.environ.get(str(t.get("env_url") or ""), "").strip()
        if offline or not url:
            rec["status"] = "skip"
            rec["detail"] = "no URL or --offline"
        else:
            probe = probe_http(url.rstrip("/") + str(t.get("path") or "/health"))
            rec["detail"] = probe
            rec["status"] = "ok" if probe.get("ok") else (
                "skip" if t.get("skip_if_down") else "fail"
            )
    elif kind == "restore-report":
        root = Path(spec_path).resolve().parents[1]
        hits = sorted(root.glob("data/spockify/restore-*.json"))
        if hits:
            rec["status"] = "ok"
            rec["detail"] = {"report": str(hits[-1])}
        else:
            rec["status"] = "not_measured"
            rec["detail"] = "no restore report in this tree"
    elif kind == "isolation-unit":
        rec["status"] = "contract"
        rec["detail"] = "assertIsolationReady throws IsolationRequiredError (harness unit)"
    elif kind in ("sbom-signed", "sbom-unsigned"):
        rec["status"] = "contract"
        rec["detail"] = "docker/sbom.sh CycloneDX + docker/verify-sbom.sh (see G7)"
    else:
        rec["status"] = "skip"
        rec["detail"] = f"unknown scrape {kind}"
    samples.append(rec)

record_path = Path(record) if record else None
if record_path is not None:
    if record_path.exists() and record_path.is_dir() or str(record).endswith(os.sep):
        record_path.mkdir(parents=True, exist_ok=True)
        record_path = record_path / "slo-samples.jsonl"
    else:
        record_path.parent.mkdir(parents=True, exist_ok=True)
history_days = (
    complete_history_days(
        record_path,
        str(window.get("start") or ""),
        stamp,
    )
    if record_path is not None
    else 0
)
# Spec may still say 0; the sample reports complete calendar days actually on disk.
doc = {
    "ts": stamp,
    "kind": "g6-slo-sample",
    "window_start": window.get("start"),
    "history_days_available": history_days,
    "invented_history": False,
    "offline": offline,
    "samples": samples,
}
print(json.dumps(doc, indent=2))
if record_path is not None:
    with record_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(doc) + "\n")
    print(f"recorded {record_path}", file=sys.stderr)
PY
