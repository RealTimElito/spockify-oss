#!/usr/bin/env bash
# Fail-closed SBOM signing (G7). Never fake a signature. Not SLSA provenance.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Sign a CycloneDX SBOM with cosign if a real key is present.

  docker/sign-sbom.sh [sbom.cdx.json]

Refuses (exit 2) when COSIGN_KEY / COSIGN_KEY_PATH / discovered key
material is missing. Does not invent SLSA provenance.

Offline key-based signing (no Rekor): --tlog-upload=false.
Password: COSIGN_PASSWORD, or <key-prefix>.pass next to the key file.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

KEY="${COSIGN_KEY:-}"
KEY_PATH="${COSIGN_KEY_PATH:-}"
if [[ -z "${KEY}" && -z "${KEY_PATH}" ]]; then
  for cand in \
    "${ROOT}/cosign.key" \
    "${HOME}/.cosign/spockify-sbom.key" \
    "${HOME}/.cosign/cosign.key"; do
    if [[ -f "${cand}" ]]; then
      KEY_PATH="${cand}"
      break
    fi
  done
fi

if [[ -z "${KEY}" && -z "${KEY_PATH}" ]]; then
  echo "sign-sbom: no cosign key (COSIGN_KEY / COSIGN_KEY_PATH). Refusing to fake a signature. G7 stays unsigned." >&2
  exit 2
fi

if [[ -n "${KEY_PATH}" && ! -f "${KEY_PATH}" ]]; then
  echo "sign-sbom: COSIGN_KEY_PATH is not a file. Refusing to fake a signature." >&2
  exit 2
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "sign-sbom: cosign binary not installed. Refusing to fake a signature." >&2
  exit 2
fi

BOM="${1:-${ROOT}/docker/sbom.cdx.json}"
if [[ ! -f "${BOM}" ]]; then
  echo "sign-sbom: SBOM not found: ${BOM}" >&2
  exit 2
fi

if [[ -z "${COSIGN_PASSWORD:-}" && -n "${KEY_PATH}" ]]; then
  pass_file="${KEY_PATH%.key}.pass"
  if [[ -f "${pass_file}" ]]; then
    COSIGN_PASSWORD="$(cat "${pass_file}")"
    export COSIGN_PASSWORD
  fi
fi

BUNDLE="${BOM}.cosign.bundle"
export COSIGN_YES=1
# Key-based, no Rekor/Fulcio. Cosign 3 defaults to a TUF signing-config.
if [[ -n "${KEY_PATH}" ]]; then
  cosign sign-blob --key "${KEY_PATH}" --yes --use-signing-config=false \
    --bundle "${BUNDLE}" "${BOM}"
else
  cosign sign-blob --key env://COSIGN_KEY --yes --use-signing-config=false \
    --bundle "${BUNDLE}" "${BOM}"
fi
echo "signed ${BOM} -> ${BUNDLE}" >&2
