#!/usr/bin/env bash
# G8 self-host rehearsal. Not a customer pilot.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
pass() { printf 'ok  %s\n' "$1"; }
bad() { printf 'not ok  %s\n' "$1"; fail=1; }

echo "g8-pilot-rehearsal: self-host only; not a customer 30-day pilot"

chmod +x \
  "${ROOT}/docker/check-production-secrets.sh" \
  "${ROOT}/docker/restore-drill.sh" \
  "${ROOT}/docker/slo-scrape.sh" \
  "${ROOT}/docker/sbom.sh" \
  "${ROOT}/docker/sign-sbom.sh" \
  "${ROOT}/docker/verify-sbom.sh" \
  "${ROOT}/docker/test/production-profile.test.sh" \
  "${ROOT}/docker/test/canary-pack.test.sh" \
  2>/dev/null || true

if bash "${ROOT}/docker/test/production-profile.test.sh"; then
  pass "production-profile"
else
  bad "production-profile"
fi

if bash "${ROOT}/docker/slo-scrape.sh" --offline >/tmp/spockify-slo-rehearsal.json; then
  if python3 - <<'PY'
import json
doc = json.load(open("/tmp/spockify-slo-rehearsal.json"))
assert doc.get("invented_history") is False
assert doc.get("history_days_available") == 0
assert doc.get("window_start", "").startswith("2026-10-17")
assert any(s.get("id") == "slo.video.disabled" and s.get("status") == "expected_skip" for s in doc.get("samples") or [])
print("slo sample ids:", [s.get("id") for s in doc.get("samples") or []])
PY
  then
    pass "slo-scrape offline"
  else
    bad "slo-scrape offline assertions"
  fi
else
  bad "slo-scrape offline"
fi

if bash "${ROOT}/docker/test/canary-pack.test.sh"; then
  pass "canary calc max_rounds=1"
else
  bad "canary calc max_rounds=1"
fi

if npm sbom --help >/dev/null 2>&1; then
  if bash "${ROOT}/docker/test/sbom.test.sh"; then
    pass "signed sbom verify"
  else
    bad "signed sbom verify"
  fi
else
  echo "skip sbom generate (npm sbom unavailable); verify still runs below"
  if bash "${ROOT}/docker/test/sbom.test.sh"; then
    pass "signed sbom verify"
  else
    bad "signed sbom verify"
  fi
fi

EMPTY_HOME="$(mktemp -d "${TMPDIR:-/tmp}/spockify-rehearsal-home.XXXX")"
if HOME="${EMPTY_HOME}" env -u COSIGN_KEY -u COSIGN_KEY_PATH -u COSIGN_PASSWORD \
  bash "${ROOT}/docker/sign-sbom.sh" >/tmp/spockify-sign.out 2>/tmp/spockify-sign.err; then
  rm -rf "${EMPTY_HOME}"
  bad "sign-sbom must refuse without keys"
else
  rm -rf "${EMPTY_HOME}"
  if grep -qi 'refusing to fake' /tmp/spockify-sign.err; then
    pass "sign-sbom refuse without keys"
  else
    bad "sign-sbom refuse message"
    cat /tmp/spockify-sign.err >&2 || true
  fi
fi

if [[ "${fail}" -ne 0 ]]; then
  echo "g8-pilot-rehearsal: failed (still not a customer pilot)" >&2
  exit 1
fi
echo "g8-pilot-rehearsal: local checks ok; G8 customer pilot remains red"
