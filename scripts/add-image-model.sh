#!/usr/bin/env bash
# Download or register a ComfyUI image model into the catalog the chat
# Model control already reads. Not an Ollama/LiteLLM chat model.
#
# Usage:
#   make add-image-model TAG=flux1-schnell-fp8.safetensors
#   make add-image-model TAG=qwen-image-2.1
#   make add-image-model TAG=qwen-image-2.1 DRY_RUN=1
#   ./scripts/add-image-model.sh TAG=hf.co/Comfy-Org/flux1-schnell/flux1-schnell-fp8.safetensors
#
# Spark and Compose share this script. Weights land under
# ${STORAGE_ROOT}/comfyui/{checkpoints,text_encoders}. The running
# gateway and Open WebUI scan that directory; no image rebuild.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
ROOT_DIR="${ROOT}"
# shellcheck source=scripts/storage-defaults.sh
source "${ROOT}/scripts/storage-defaults.sh"

MODELS_ROOT="${MODELS_ROOT:-${STORAGE_ROOT}/comfyui}"
CKPT_DIR="${MODELS_ROOT}/checkpoints"
TE_DIR="${MODELS_ROOT}/text_encoders"
DRY_RUN="${DRY_RUN:-0}"
TAG="${TAG:-${MODEL:-}}"

FLUX_FILE="flux1-schnell-fp8.safetensors"
FLUX_URL="https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors"
QWEN_ID="qwen-image-2.1"
QWEN_UNET="qwen_image_2.1_turbo_Q3_K_M.gguf"
QWEN_VAE="qwen_image_2.1_vae_bf16.safetensors"
QWEN_CLIP="qwen3vl_8b_int8_convrot.safetensors"
QWEN_UNET_URL="https://huggingface.co/Abiray/Qwen-Image-2.1-turbo-GGUF/resolve/main/${QWEN_UNET}"
QWEN_VAE_URL="https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/${QWEN_VAE}"
QWEN_CLIP_URL="https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/${QWEN_CLIP}"
QWEN_CLIP_W4A8_URL="https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_w4a8.safetensors"
QWEN_CLIP_FP8_URL="https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_fp8_scaled.safetensors"
OLLAMA_BLOB="${SPOCKIFY_QWEN_IMAGE_GGUF:-/var/lib/spockify/ollama/models/blobs/sha256-9b232e8f55f669e8efd20f876986d3b56e08e04a46a9a2755522a93c2635ad73}"

usage() {
  cat <<'EOF'
Usage: make add-image-model TAG=<id-or-hf-tag> [DRY_RUN=1]
       ./scripts/add-image-model.sh TAG=<id-or-hf-tag> [DRY_RUN=1]

  Puts image weights where ComfyUI and the cold catalog already look.
  Does not add a LiteLLM row, does not ollama pull, and does not scale
  the Comfy GPU deployment.

  TAG / MODEL   Checkpoint id or Hugging Face tag. Examples:
                  flux1-schnell-fp8.safetensors
                  flux1-schnell
                  hf.co/Comfy-Org/flux1-schnell/flux1-schnell-fp8.safetensors
                  qwen-image-2.1
                  hf.co/Abiray/Qwen-Image-2.1-turbo-GGUF
                  hf.co/org/repo/some-checkpoint.safetensors
                  https://huggingface.co/org/repo/resolve/main/file.safetensors
  DRY_RUN=1     Print the plan and whether the catalog would list the
                model. Does not download.

  Qwen-Image 2.1 is a GGUF UNet plus a Qwen3-VL text encoder and
  qwen_image_2.1_vae_bf16.safetensors. The model id fetches all three.
  The catalog lists it only when every file is in place. LTX-Video tags
  are refused here (video workflow, not the image dropdown).

  Files land in:
    ${STORAGE_ROOT}/comfyui/checkpoints/      all-in-one safetensors, GGUF UNet, VAE
    ${STORAGE_ROOT}/comfyui/text_encoders/    Qwen3-VL text encoder

Env:
  STORAGE_ROOT / MODELS_ROOT   override the Comfy model root
  DRY_RUN=1                    plan only
EOF
}

for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    TAG=*) TAG="${arg#TAG=}" ;;
    MODEL=*) TAG="${arg#MODEL=}" ;;
    DRY_RUN=*) DRY_RUN="${arg#DRY_RUN=}" ;;
    STORAGE_ROOT=*) STORAGE_ROOT="${arg#STORAGE_ROOT=}" ;;
    MODELS_ROOT=*) MODELS_ROOT="${arg#MODELS_ROOT=}" ;;
    *)
      if [[ -z "${TAG}" && "${arg}" != *=* ]]; then
        TAG="${arg}"
      else
        echo "Unknown argument: ${arg}" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "${TAG}" ]]; then
  echo "error: TAG (or MODEL) is required." >&2
  usage
  exit 1
fi

case "${TAG}" in
  *abliterat*|*uncensor*|*unfiltered*|*heretic*|*Fable*|*fable*)
    echo "error: refusing abliterated/uncensored/heretic model tags." >&2
    exit 1
    ;;
esac

CKPT_DIR="${MODELS_ROOT}/checkpoints"
TE_DIR="${MODELS_ROOT}/text_encoders"

flag_on() {
  case "${1}" in
    1|true|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

DRY=0
flag_on "${DRY_RUN}" && DRY=1

low="$(printf '%s' "${TAG}" | tr '[:upper:]' '[:lower:]')"
low="${low%:latest}"

fetch_file() {
  local url="$1"
  local dest="$2"
  local label="$3"
  if [[ -f "${dest}" ]]; then
    echo "  skip (exists): ${label}"
    return 0
  fi
  if [[ "${DRY}" -eq 1 ]]; then
    echo "  would download: ${label}"
    echo "    ${url}"
    return 0
  fi
  mkdir -p "$(dirname "${dest}")"
  echo "  download: ${label}"
  curl -fL --retry 3 --continue-at - -o "${dest}.partial" "${url}"
  mv "${dest}.partial" "${dest}"
}

link_or_fetch_unet() {
  local dest="${CKPT_DIR}/${QWEN_UNET}"
  if [[ -f "${dest}" ]]; then
    echo "  skip (exists): ${QWEN_UNET}"
    return 0
  fi
  if [[ -f "${OLLAMA_BLOB}" ]]; then
    if [[ "${DRY}" -eq 1 ]]; then
      echo "  would hardlink Ollama blob -> checkpoints/${QWEN_UNET}"
      return 0
    fi
    mkdir -p "${CKPT_DIR}"
    ln "${OLLAMA_BLOB}" "${dest}"
    echo "  hardlinked Ollama blob -> checkpoints/${QWEN_UNET}"
    return 0
  fi
  fetch_file "${QWEN_UNET_URL}" "${dest}" "${QWEN_UNET}"
}

place_for_name() {
  local name="$1"
  case "${name}" in
    "${QWEN_CLIP}"|qwen3vl_8b_w4a8.safetensors|qwen3vl_8b_fp8_scaled.safetensors)
      printf '%s\n' "${TE_DIR}/${name}"
      ;;
    *)
      printf '%s\n' "${CKPT_DIR}/${name}"
      ;;
  esac
}

known_url_for() {
  local name="$1"
  case "${name}" in
    "${FLUX_FILE}") printf '%s\n' "${FLUX_URL}" ;;
    "${QWEN_UNET}") printf '%s\n' "${QWEN_UNET_URL}" ;;
    "${QWEN_VAE}") printf '%s\n' "${QWEN_VAE_URL}" ;;
    "${QWEN_CLIP}") printf '%s\n' "${QWEN_CLIP_URL}" ;;
    qwen3vl_8b_w4a8.safetensors) printf '%s\n' "${QWEN_CLIP_W4A8_URL}" ;;
    qwen3vl_8b_fp8_scaled.safetensors) printf '%s\n' "${QWEN_CLIP_FP8_URL}" ;;
    *) return 1 ;;
  esac
}

is_video_name() {
  local name
  name="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "${name}" in
    *ltxv*|*ltx-video*|*ltx_video*) return 0 ;;
    *) return 1 ;;
  esac
}

hf_file_url() {
  # hf.co/org/repo/path/file.ext -> huggingface resolve URL
  local rest="${1#hf.co/}"
  local org repo path
  org="${rest%%/*}"
  rest="${rest#*/}"
  repo="${rest%%/*}"
  path="${rest#*/}"
  if [[ -z "${org}" || -z "${repo}" || -z "${path}" || "${path}" == "${repo}" ]]; then
    return 1
  fi
  printf 'https://huggingface.co/%s/%s/resolve/main/%s\n' "${org}" "${repo}" "${path}"
}

EXPECT=""
ACTION=""

qwen_bundle() {
  EXPECT="${QWEN_ID}"
  ACTION="qwen-bundle"
  echo "==> Qwen-Image 2.1 (GGUF UNet + text encoder + VAE)"
  echo "    A lone UNet is not listed."
  link_or_fetch_unet
  local clip_dest="${TE_DIR}/${QWEN_CLIP}"
  local have_clip=""
  local alt
  for alt in "${QWEN_CLIP}" qwen3vl_8b_w4a8.safetensors qwen3vl_8b_fp8_scaled.safetensors; do
    if [[ -f "${TE_DIR}/${alt}" ]]; then
      have_clip="${alt}"
      break
    fi
  done
  if [[ -n "${have_clip}" ]]; then
    echo "  skip (exists): ${have_clip}"
  else
    fetch_file "${QWEN_CLIP_URL}" "${clip_dest}" "${QWEN_CLIP}"
  fi
  fetch_file "${QWEN_VAE_URL}" "${CKPT_DIR}/${QWEN_VAE}" "${QWEN_VAE}"
}

one_file() {
  local name="$1"
  local url="$2"
  if is_video_name "${name}"; then
    echo "error: ${name} is a video checkpoint. Use scripts/download-ltx-video-models.sh." >&2
    exit 1
  fi
  if [[ "${name}" == *.gguf && "${name}" != "${QWEN_UNET}" ]]; then
    echo "error: only ${QWEN_UNET} is wired. Use TAG=${QWEN_ID}." >&2
    exit 1
  fi
  EXPECT="${name}"
  ACTION="file"
  echo "==> ${name}"
  if [[ "${name}" == "${QWEN_UNET}" ]]; then
    link_or_fetch_unet
    return 0
  fi
  fetch_file "${url}" "$(place_for_name "${name}")" "${name}"
}

if is_video_name "${low}"; then
  echo "error: ${TAG} is a video checkpoint. Use scripts/download-ltx-video-models.sh." >&2
  exit 1
fi

case "${low}" in
  flux|flux1-schnell|flux1-schnell-fp8|"${FLUX_FILE}"|hf.co/comfy-org/flux1-schnell|comfy-org/flux1-schnell)
    one_file "${FLUX_FILE}" "${FLUX_URL}"
    ;;
  qwen-image-2.1|qwen-image-2.1-turbo|qwen-image-2.1-turbo-gguf|qwen_image|hf.co/abiray/qwen-image-2.1-turbo-gguf)
    qwen_bundle
    ;;
  "${QWEN_UNET}"|"${QWEN_VAE}"|"${QWEN_CLIP}"|qwen3vl_8b_w4a8.safetensors|qwen3vl_8b_fp8_scaled.safetensors)
    url="$(known_url_for "${low}" || true)"
    if [[ -z "${url}" ]]; then
      echo "error: no download URL for ${TAG}. Pass an https://huggingface.co/... URL." >&2
      exit 1
    fi
    one_file "${low}" "${url}"
    EXPECT="${QWEN_ID}"
    ;;
  hf.co/*)
    if [[ "${low}" != *.safetensors && "${low}" != *.ckpt && "${low}" != *.sft && "${low}" != *.gguf ]]; then
      echo "error: TAG=${TAG} is not a known image model or a weight filename." >&2
      usage
      exit 1
    fi
    raw="${TAG%:latest}"
    url="$(hf_file_url "${raw}")" || {
      echo "error: could not parse Hugging Face file tag ${TAG}" >&2
      exit 1
    }
    name="${raw##*/}"
    name_low="$(printf '%s' "${name}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${name_low}" == "${QWEN_UNET}" ]]; then
      qwen_bundle
    else
      one_file "${name}" "${url}"
    fi
    ;;
  https://*)
    name="${TAG%%\?*}"
    name="${name##*/}"
    name="$(printf '%s' "${name}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${name}" != *.safetensors && "${name}" != *.ckpt && "${name}" != *.sft && "${name}" != *.gguf ]]; then
      echo "error: URL does not end in a checkpoint or GGUF filename." >&2
      exit 1
    fi
    if [[ "${name}" == "${QWEN_UNET}" ]]; then
      qwen_bundle
    else
      one_file "${name}" "${TAG}"
    fi
    ;;
  *)
    echo "error: unknown image model TAG=${TAG}" >&2
    echo "Known ids: ${FLUX_FILE}, ${QWEN_ID}." >&2
    echo "Or pass hf.co/org/repo/file.safetensors (not an Ollama LLM tag)." >&2
    exit 1
    ;;
esac

echo ""
echo "Model dir: ${MODELS_ROOT}"
if [[ "${DRY}" -eq 1 ]]; then
  echo "DRY_RUN: no files were written."
fi

ROOT="${ROOT}" python3 - "${MODELS_ROOT}" "${EXPECT}" <<'PY'
import os
import sys

root, expect = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(os.environ["ROOT"], "services/comfyui-gateway"))
os.environ["SPOCKIFY_IMAGE_MODELS_ROOT"] = root
os.environ["COMFYUI_UNET_GGUF"] = "1"
os.environ["COMFYUI_QWEN_IMAGE21"] = "1"
os.environ["SPOCKIFY_QWEN_IMAGE_GGUF"] = ""
import image_models

catalog = image_models.image_model_catalog()
ids = [item["id"] for item in catalog["models"]]
print("catalog models:", ", ".join(ids) if ids else "(none)")
qwen = catalog["qwen_image_2_1"]
if expect == image_models.QWEN_ID:
    if qwen["included"]:
        print("listed: qwen-image-2.1")
    else:
        print("not listed: qwen-image-2.1")
        missing = qwen.get("missing") or []
        if missing:
            print("missing:", "; ".join(missing))
        print("A lone UNet GGUF is not enough.")
elif expect:
    on_disk = os.path.isfile(os.path.join(root, "checkpoints", expect)) or os.path.isfile(
        os.path.join(root, "text_encoders", expect)
    )
    if expect in ids and on_disk:
        print("listed:", expect)
    else:
        print("not listed:", expect)
print("Chat reads this directory on the next Model-control load. Comfy GPU stays at 0 until an image request.")
PY
