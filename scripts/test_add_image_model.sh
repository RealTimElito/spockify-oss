#!/usr/bin/env bash
# Dry-run checks for add-image-model. Does not download weights.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT}/scripts/add-image-model.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

BIN="${TMP}/bin"
mkdir -p "${BIN}"
cat > "${BIN}/curl" <<'EOF'
#!/bin/sh
echo "curl should not run during DRY_RUN" >&2
exit 99
EOF
chmod +x "${BIN}/curl"

run() {
  PATH="${BIN}:${PATH}" MODELS_ROOT="$1" DRY_RUN=1 "${SCRIPT}" TAG="$2"
}

echo "== flux missing =="
out="$(run "${TMP}/empty" flux1-schnell-fp8.safetensors)"
printf '%s\n' "${out}" | grep -q "would download: flux1-schnell-fp8.safetensors"
printf '%s\n' "${out}" | grep -q "not listed: flux1-schnell-fp8.safetensors"
printf '%s\n' "${out}" | grep -q "DRY_RUN: no files were written."
test ! -e "${TMP}/empty/checkpoints/flux1-schnell-fp8.safetensors"

echo "== flux present =="
mkdir -p "${TMP}/flux/checkpoints"
: > "${TMP}/flux/checkpoints/flux1-schnell-fp8.safetensors"
out="$(run "${TMP}/flux" flux1-schnell-fp8.safetensors)"
printf '%s\n' "${out}" | grep -q "skip (exists): flux1-schnell-fp8.safetensors"
printf '%s\n' "${out}" | grep -q "listed: flux1-schnell-fp8.safetensors"

echo "== qwen unet only =="
mkdir -p "${TMP}/qwen/checkpoints"
: > "${TMP}/qwen/checkpoints/qwen_image_2.1_turbo_Q3_K_M.gguf"
out="$(run "${TMP}/qwen" qwen-image-2.1)"
printf '%s\n' "${out}" | grep -q "not listed: qwen-image-2.1"
printf '%s\n' "${out}" | grep -q "qwen_image_2.1_vae_bf16.safetensors"
printf '%s\n' "${out}" | grep -q "qwen3vl_8b_int8_convrot.safetensors"
printf '%s\n' "${out}" | grep -q "would download: qwen3vl_8b_int8_convrot.safetensors"
printf '%s\n' "${out}" | grep -q "would download: qwen_image_2.1_vae_bf16.safetensors"
printf '%s\n' "${out}" | grep -q "A lone UNet GGUF is not enough."
test ! -e "${TMP}/qwen/text_encoders/qwen3vl_8b_int8_convrot.safetensors"

echo "== qwen complete =="
mkdir -p "${TMP}/qwen-ok/checkpoints" "${TMP}/qwen-ok/text_encoders"
: > "${TMP}/qwen-ok/checkpoints/qwen_image_2.1_turbo_Q3_K_M.gguf"
: > "${TMP}/qwen-ok/checkpoints/qwen_image_2.1_vae_bf16.safetensors"
: > "${TMP}/qwen-ok/text_encoders/qwen3vl_8b_int8_convrot.safetensors"
out="$(run "${TMP}/qwen-ok" "hf.co/Abiray/Qwen-Image-2.1-turbo-GGUF:latest")"
printf '%s\n' "${out}" | grep -q "listed: qwen-image-2.1"
printf '%s\n' "${out}" | grep -q "skip (exists): qwen_image_2.1_turbo_Q3_K_M.gguf"

echo "== extra checkpoint =="
mkdir -p "${TMP}/sd/checkpoints"
: > "${TMP}/sd/checkpoints/sd_xl_base_1.0.safetensors"
out="$(run "${TMP}/sd" "hf.co/example/sdxl/sd_xl_base_1.0.safetensors")"
printf '%s\n' "${out}" | grep -q "listed: sd_xl_base_1.0.safetensors"

echo "== ltx refused =="
if run "${TMP}/empty" ltxv-2b-0.9.8-distilled-fp8.safetensors >/dev/null 2>"${TMP}/ltx.err"; then
  echo "ltx tag should fail" >&2
  exit 1
fi
grep -q "video checkpoint" "${TMP}/ltx.err"

echo "== unknown refused =="
if PATH="${BIN}:${PATH}" MODELS_ROOT="${TMP}/empty" DRY_RUN=1 "${SCRIPT}" TAG=gemma4:26b >/dev/null 2>"${TMP}/unk.err"; then
  echo "llm tag should fail" >&2
  exit 1
fi
grep -q "unknown image model" "${TMP}/unk.err"

echo "ok"
