#!/usr/bin/env bash
# Lint mini-SWE template contract (LEAP-007): require {{task}}, ban problem_statement.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMPL="${ROOT}/scripts/bench/spockify-swebench.yaml.tmpl"
if [[ ! -f "$TMPL" ]]; then
  echo "FAIL: missing $TMPL" >&2
  exit 2
fi
if ! grep -q '{{task}}' "$TMPL"; then
  echo "FAIL: template missing {{task}}" >&2
  exit 1
fi
if grep -q '{{problem_statement}}' "$TMPL"; then
  echo "FAIL: template still uses {{problem_statement}} (want {{task}})" >&2
  exit 1
fi
echo "PASS: $TMPL uses {{task}}"
