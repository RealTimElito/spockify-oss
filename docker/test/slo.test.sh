#!/usr/bin/env bash
# G6 scrape path (offline). No cluster, no video.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRAPE="${ROOT}/docker/slo-scrape.sh"
chmod +x "${SCRAPE}"

OUT="$(mktemp -d "${TMPDIR:-/tmp}/spockify-slo-test.XXXX")"
trap 'rm -rf "${OUT}"' EXIT

"${SCRAPE}" --offline --record "${OUT}" >"${OUT}/stdout.json"
python3 - "${OUT}" <<'PY'
import json, sys
from pathlib import Path
out = Path(sys.argv[1])
doc = json.loads((out / "stdout.json").read_text())
assert doc["kind"] == "g6-slo-sample"
assert doc["invented_history"] is False
assert doc["history_days_available"] == 0
assert str(doc["window_start"]).startswith("2026-10-17")
ids = [s["id"] for s in doc["samples"]]
assert "slo.local.chat_health" in ids
assert "slo.video.enabled" in ids
video = next(s for s in doc["samples"] if s["id"] == "slo.video.enabled")
assert video["status"] == "expected_skip"
lines = (out / "slo-samples.jsonl").read_text().strip().splitlines()
assert len(lines) == 1
again = json.loads(lines[0])
assert again["window_start"] == doc["window_start"]
print("slo samples:", ids)
PY
echo "slo tests: ok"
