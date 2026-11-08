#!/usr/bin/env bash
# CycloneDX SBOM for the coding kernel and CLI (B-10). No image pull, no
# cluster APIs. This is an inventory; sign with docker/sign-sbom.sh (G7).
# Cosign sidecar is not SLSA provenance.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-}"
STAMP="$(date '+%Y%m%dT%H%M%S%z')"

usage() {
  cat <<'EOF'
Generate a CycloneDX JSON SBOM from the local npm packages.

  docker/sbom.sh [output-file-or-dir]

Uses `npm sbom` (npm 10.2+) when available. Does not scan container images
and does not claim a signed SLSA provenance. Pin images separately with
docker/record-image-digests.sh.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "sbom: npm is required" >&2
  exit 1
fi

if ! npm sbom --help >/dev/null 2>&1; then
  echo "sbom: npm sbom is unavailable (need npm 10.2+). Install a current npm." >&2
  exit 1
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/spockify-sbom.${STAMP}.XXXX")"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

# File: packages only — skip node_modules trees that are not installed.
PKGS=(
  packages/spockify-harness
  packages/spockify-cli
  packages/spockify-ide-client
)

MERGED="${WORKDIR}/sbom.cdx.json"
{
  echo '{'
  echo '  "bomFormat": "CycloneDX",'
  echo '  "specVersion": "1.5",'
  echo "  \"serialNumber\": \"urn:uuid:spockify-sbom-${STAMP}\","
  echo "  \"metadata\": { \"timestamp\": \"$(date -Iseconds)\", \"tools\": [{\"name\":\"npm-sbom\"}] },"
  echo '  "components": ['
} >"${MERGED}.head"

FIRST=1
COMPONENTS="${WORKDIR}/components.jsonl"
: >"${COMPONENTS}"

for pkg in "${PKGS[@]}"; do
  dir="${ROOT}/${pkg}"
  if [[ ! -f "${dir}/package.json" ]]; then
    continue
  fi
  if [[ ! -d "${dir}/node_modules" ]]; then
    echo "sbom: skip ${pkg} (no node_modules; npm install first for a full graph)" >&2
  fi
  raw="${WORKDIR}/$(basename "${pkg}").json"
  if ! (cd "${dir}" && npm sbom --sbom-format cyclonedx >"${raw}" 2>"${WORKDIR}/err"); then
    echo "sbom: npm sbom failed for ${pkg}" >&2
    cat "${WORKDIR}/err" >&2 || true
    exit 1
  fi
  python3 - "${raw}" "${COMPONENTS}" "${pkg}" <<'PY'
import json, sys
path, out, pkg = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(path))
comps = data.get("components") or []
# Always include the package itself.
name = None
version = None
try:
    meta = json.load(open(path)).get("metadata", {}).get("component") or {}
    name = meta.get("name")
    version = meta.get("version")
except Exception:
    pass
if name:
    comps = [{"name": name, "version": version, "type": "library", "group": pkg}] + comps
with open(out, "a") as fh:
    for c in comps:
        n = c.get("name")
        if not n:
            continue
        rec = {
            "type": c.get("type") or "library",
            "name": n,
            "version": c.get("version"),
            "purl": c.get("purl"),
            "source_package": pkg,
        }
        fh.write(json.dumps(rec) + "\n")
PY
done

python3 - "${COMPONENTS}" "${MERGED}" "${STAMP}" <<'PY'
import json, sys
src, dest, stamp = sys.argv[1], sys.argv[2], sys.argv[3]
seen = set()
comps = []
with open(src) as fh:
    for line in fh:
        rec = json.loads(line)
        key = (rec.get("name"), rec.get("version"), rec.get("purl"))
        if key in seen:
            continue
        seen.add(key)
        item = {k: v for k, v in rec.items() if v is not None and k != "source_package"}
        comps.append(item)
doc = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.5",
    "serialNumber": f"urn:uuid:spockify-kernel-cli-{stamp}",
    "version": 1,
    "metadata": {
        "timestamp": stamp,
        "tools": [{"name": "npm-sbom", "vendor": "npm"}],
        "component": {
            "type": "application",
            "name": "spockify-kernel-cli",
            "version": "local-tree",
        },
        "note": "CycloneDX inventory of local npm packages. Cosign signature is a sidecar bundle (docker/sign-sbom.sh), not SLSA provenance. Image pins are separate (docker/record-image-digests.sh).",
    },
    "components": comps,
}
with open(dest, "w") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
print(f"components: {len(comps)}", file=sys.stderr)
PY

if [[ -z "${OUT}" ]]; then
  cat "${MERGED}"
  exit 0
fi
if [[ -d "${OUT}" ]]; then
  OUT="${OUT}/sbom-${STAMP}.cdx.json"
fi
cp "${MERGED}" "${OUT}"
echo "wrote ${OUT}" >&2
