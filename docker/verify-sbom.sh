#!/usr/bin/env bash
# Verify a cosign-signed CycloneDX SBOM (G7). Not SLSA provenance.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Verify a CycloneDX SBOM against its cosign sidecar bundle.

  docker/verify-sbom.sh [sbom.cdx.json]

Public key: COSIGN_PUB or docker/sbom-cosign.pub
Bundle:     <sbom>.cosign.bundle
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "verify-sbom: cosign binary not installed" >&2
  exit 2
fi

BOM="${1:-${ROOT}/docker/sbom.cdx.json}"
PUB="${COSIGN_PUB:-${ROOT}/docker/sbom-cosign.pub}"
BUNDLE="${BOM}.cosign.bundle"

if [[ ! -f "${BOM}" ]]; then
  echo "verify-sbom: missing ${BOM}" >&2
  exit 2
fi
if [[ ! -f "${PUB}" ]]; then
  echo "verify-sbom: missing public key ${PUB}" >&2
  exit 2
fi
if [[ ! -f "${BUNDLE}" ]]; then
  echo "verify-sbom: missing bundle ${BUNDLE}" >&2
  exit 2
fi

cosign verify-blob --key "${PUB}" --bundle "${BUNDLE}" \
  --insecure-ignore-tlog "${BOM}"
echo "verified ${BOM}" >&2
