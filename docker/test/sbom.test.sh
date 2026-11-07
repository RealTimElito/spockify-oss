#!/usr/bin/env bash
# SBOM generator + fail-closed signing + committed-bundle verify (G7).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SBOM="${ROOT}/docker/sbom.sh"
SIGN="${ROOT}/docker/sign-sbom.sh"
VERIFY="${ROOT}/docker/verify-sbom.sh"
chmod +x "${SBOM}" "${SIGN}" "${VERIFY}"

# Isolated HOME so a developer ~/.cosign key does not skip the refuse path.
EMPTY_HOME="$(mktemp -d "${TMPDIR:-/tmp}/spockify-sbom-home.XXXX")"
cleanup_home() { rm -rf "${EMPTY_HOME}"; }
trap cleanup_home EXIT

if HOME="${EMPTY_HOME}" env -u COSIGN_KEY -u COSIGN_KEY_PATH -u COSIGN_PASSWORD \
  bash "${SIGN}" >/tmp/spockify-sign-sbom.out 2>/tmp/spockify-sign-sbom.err; then
  echo "sign-sbom must refuse without keys" >&2
  exit 1
fi
if ! grep -qi 'refusing to fake' /tmp/spockify-sign-sbom.err; then
  echo "sign-sbom missing refuse message" >&2
  cat /tmp/spockify-sign-sbom.err >&2 || true
  exit 1
fi

COMMITTED="${ROOT}/docker/sbom.cdx.json"
PUB="${ROOT}/docker/sbom-cosign.pub"
BUNDLE="${COMMITTED}.cosign.bundle"
if [[ ! -f "${COMMITTED}" || ! -f "${PUB}" || ! -f "${BUNDLE}" ]]; then
  echo "G7 committed artifacts missing (sbom.cdx.json + .cosign.bundle + sbom-cosign.pub)" >&2
  exit 1
fi
if grep -q 'BEGIN ENCRYPTED COSIGN PRIVATE KEY' "${PUB}" "${COMMITTED}" "${BUNDLE}"; then
  echo "private cosign key leaked into committed artifacts" >&2
  exit 1
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "cosign required to prove G7 signature verifies" >&2
  exit 1
fi
bash "${VERIFY}" "${COMMITTED}"
echo "committed SBOM signature: ok"

if ! npm sbom --help >/dev/null 2>&1; then
  echo "skip: npm sbom unavailable (sign refuse + verify still checked)"
  exit 0
fi

OUT="$(mktemp -d "${TMPDIR:-/tmp}/spockify-sbom-test.XXXX")"
trap 'rm -rf "${EMPTY_HOME}" "${OUT}"' EXIT
"${SBOM}" "${OUT}/sbom.cdx.json" >/dev/null
python3 - "${OUT}/sbom.cdx.json" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
assert doc.get("bomFormat") == "CycloneDX", doc.get("bomFormat")
assert isinstance(doc.get("components"), list)
assert len(doc["components"]) >= 1
note = (doc.get("metadata") or {}).get("note") or ""
assert "slsa" in note.lower()
assert "not slsa" in note.lower() or "not a signed slsa" in note.lower()
print("generated sbom components:", len(doc["components"]))
PY
echo "sbom tests: ok"
