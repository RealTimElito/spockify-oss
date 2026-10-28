#!/usr/bin/env bash
# Lock canary calc at max_rounds=1. Do not loosen.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACK="${ROOT}/packs/canary-v1.json"
python3 - "${PACK}" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
evals = {e["id"]: e for e in doc.get("evals") or []}
assert "calc" in evals, sorted(evals)
calc = evals["calc"]
assert calc.get("max_rounds") == 1, calc
assert calc.get("family") == "pytest-fix"
print("canary calc max_rounds=1")
PY
echo "canary-pack tests: ok"
