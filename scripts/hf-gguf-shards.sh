#!/usr/bin/env bash
# Plan or download one Hugging Face GGUF quant (every shard, not every quant).
#
# Ollama 0.34.0 does not pull hf.co. Verified against the v0.34.0 tree:
# there is no Hugging Face blob downloader. Split files are registered with
# `ollama create` when the Modelfile FROM is the directory that holds every
# *-00001-of-0000N.gguf part (server/create.go merges them). FROM the first
# shard file alone does not load the rest.
#
#   scripts/hf-gguf-shards.sh --check --tag TAG          # 0 hf, 2 not hf
#   scripts/hf-gguf-shards.sh --dry-run --tag TAG        # shard names, no weights
#   scripts/hf-gguf-shards.sh --print-plan --tag TAG --plan-out FILE
#   scripts/hf-gguf-shards.sh --download --tag TAG --plan-out FILE
#
# Quant choice (also in add-model --help):
#   TAG=hf.co/org/repo:QUANT or .../QUANT selects that quant
#   (exact id, filename, or a hyphen suffix such as Q4_K_M → UD-Q4_K_M).
#   TAG=hf.co/org/repo with no quant selects the smallest complete quant
#   that is actually sharded (N>=2, all parts present, lowest total bytes).
#   One quant only. :cloud is refused.
#
# Shards land in ${STORAGE_ROOT}/ollama/hf-gguf/<org>/<repo>/<quant>/
# which Compose and the Spark ollama PVC mount at
# /root/.ollama/hf-gguf/<org>/<repo>/<quant>/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
PY="${ROOT}/scripts/hf_gguf_shards.py"
ROOT_DIR="${ROOT}"
# Caller exports win over .env so DRY_RUN=1 cannot be cleared underneath.
_keep_storage=0
_keep_listing=0
_keep_dry=0
if [[ "${STORAGE_ROOT+x}" == x ]]; then
  _caller_storage="${STORAGE_ROOT}"
  _keep_storage=1
fi
if [[ "${HF_GGUF_LISTING+x}" == x ]]; then
  _caller_listing="${HF_GGUF_LISTING}"
  _keep_listing=1
fi
if [[ "${DRY_RUN+x}" == x ]]; then
  _caller_dry="${DRY_RUN}"
  _keep_dry=1
fi
# shellcheck source=scripts/storage-defaults.sh
source "${ROOT}/scripts/storage-defaults.sh"
# Compose add-model sets HF_GGUF_COMPOSE=1 so shards use the compose volume
# (.env STORAGE_ROOT). Spark keeps storage-defaults (spark.env / PVC host path).
if [[ "${HF_GGUF_COMPOSE:-0}" == 1 && -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi
if [[ "${_keep_storage}" -eq 1 ]]; then STORAGE_ROOT="${_caller_storage}"; fi
if [[ "${_keep_listing}" -eq 1 ]]; then HF_GGUF_LISTING="${_caller_listing}"; fi
if [[ "${_keep_dry}" -eq 1 ]]; then DRY_RUN="${_caller_dry}"; fi

MODE=""
TAG="${TAG:-}"
PLAN_OUT=""

usage() {
  cat <<'EOF'
Usage: scripts/hf-gguf-shards.sh --check|--dry-run|--print-plan|--download --tag TAG

  --dry-run     Print the quant and shard filenames. Does not download.
  --download    Fetch that quant's shards into $STORAGE_ROOT/ollama/hf-gguf/.
  HF_GGUF_LISTING   Use this size<TAB>path file instead of the Hub API.
  DRY_RUN=1         --download is refused.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --check|--dry-run|--print-plan|--download) MODE="${1#--}" ;;
    --tag)
      TAG="${2:-}"
      shift
      ;;
    --tag=*) TAG="${1#--tag=}" ;;
    --plan-out)
      PLAN_OUT="${2:-}"
      shift
      ;;
    --plan-out=*) PLAN_OUT="${1#--plan-out=}" ;;
    TAG=*) TAG="${1#TAG=}" ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ -z "${MODE}" || -z "${TAG}" ]]; then
  usage
  exit 1
fi

export STORAGE_ROOT
export HF_GGUF_LISTING="${HF_GGUF_LISTING:-}"
export HF_GGUF_CONTAINER_ROOT="${HF_GGUF_CONTAINER_ROOT:-/root/.ollama/hf-gguf}"

run_py() {
  python3 "${PY}" "$1" --tag "${TAG}"
}

case "${MODE}" in
  check) run_py check ;;
  dry-run) run_py dry-run ;;
  print-plan)
    if [[ -n "${PLAN_OUT}" ]]; then
      run_py plan > "${PLAN_OUT}"
    else
      run_py plan
    fi
    ;;
  download)
    case "${DRY_RUN:-0}" in
      1|true|yes|YES)
        echo "error: refusing shard download because DRY_RUN is set" >&2
        exit 1
        ;;
    esac
    plan="$(mktemp)"
    run_py plan > "${plan}"
    # shellcheck disable=SC1090
    source "${plan}"
    mkdir -p "${HF_HOST_DIR}"
    for i in "${!HF_SHARD_NAMES[@]}"; do
      name="${HF_SHARD_NAMES[$i]}"
      url="${HF_SHARD_URLS[$i]}"
      size="${HF_SHARD_SIZES[$i]}"
      dest="${HF_HOST_DIR}/${name}"
      if [[ -f "${dest}" ]] && [[ "$(stat -c %s "${dest}")" == "${size}" ]]; then
        echo "skip (exists): ${name}"
        continue
      fi
      echo "download: ${name}"
      tmp="${dest}.partial"
      if [[ -f "${tmp}" ]]; then
        curl -fL --retry 3 --retry-delay 2 -C - -o "${tmp}" "${url}"
      else
        curl -fL --retry 3 --retry-delay 2 -o "${tmp}" "${url}"
      fi
      mv "${tmp}" "${dest}"
      got="$(stat -c %s "${dest}")"
      if [[ "${got}" != "${size}" ]]; then
        echo "error: ${name} is ${got} bytes, listing says ${size}" >&2
        exit 1
      fi
    done
    printf 'FROM %s\n' "${HF_FROM}" > "${HF_HOST_DIR}/Modelfile"
    if [[ -n "${PLAN_OUT}" ]]; then
      cp "${plan}" "${PLAN_OUT}"
    fi
    rm -f "${plan}"
    ;;
  *)
    echo "error: unknown mode ${MODE}" >&2
    exit 1
    ;;
esac
