#!/usr/bin/env bash
# Pack the downloadable compose kit (no git history, no k8s).
# Usage:
#   ./docker/pack-release.sh
#   SPOCKIFY_IMAGE_PREFIX=ghcr.io/example/spockify VERSION=0.1.0 ./docker/pack-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-${SPOCKIFY_VERSION:-dev}}"
PREFIX="${SPOCKIFY_IMAGE_PREFIX:-ghcr.io/spockify}"
ROUTER_IMAGE="${SPOCKIFY_ROUTER_IMAGE:-${PREFIX}/spockify-router:${VERSION}}"
OWUI_IMAGE="${SPOCKIFY_OPENWEBUI_IMAGE:-${PREFIX}/spockify-openwebui:${VERSION}}"
DIST="${ROOT}/dist"
STAGE="${DIST}/spockify-docker"
ZIP="${DIST}/spockify-docker-${VERSION}.zip"

rm -rf "${STAGE}"
mkdir -p "${STAGE}/postgres-init"

cp "${ROOT}/docker/compose.pull.yml" "${STAGE}/docker-compose.yml"
cp "${ROOT}/docker-compose.gpu.yml" "${STAGE}/docker-compose.gpu.yml"
cp "${ROOT}/docker-compose.gpu.podman.yml" "${STAGE}/docker-compose.gpu.podman.yml"
cp "${ROOT}/docker-compose.gpu.podman.devices.yml" "${STAGE}/docker-compose.gpu.podman.devices.yml"
cp "${ROOT}/docker-compose.podman.yml" "${STAGE}/docker-compose.podman.yml"
cp "${ROOT}/docker-compose.demo.yml" "${STAGE}/docker-compose.demo.yml"
mkdir -p "${STAGE}/docker"
cp "${ROOT}/docker/security-demo-prompt.md" "${STAGE}/docker/security-demo-prompt.md"
cp "${ROOT}/docker/ollama-pull.sh" "${STAGE}/"
chmod +x "${STAGE}/ollama-pull.sh"
cp "${ROOT}/docker/litellm.yaml" "${STAGE}/"
cp "${ROOT}/docker/searxng-settings.yml" "${STAGE}/"
cp "${ROOT}/docker/routing-rules.json" "${STAGE}/"
cp "${ROOT}/docker/postgres-init/01-create-litellm.sql" "${STAGE}/postgres-init/"
mkdir -p "${STAGE}/modelfiles"
cp "${ROOT}/config/modelfiles/coder.Modelfile" "${STAGE}/modelfiles/"
cp "${ROOT}/config/modelfiles/devstral-16g.Modelfile" "${STAGE}/modelfiles/"
cp "${ROOT}/config/modelfiles/llama3.2-3b-cpu.Modelfile" "${STAGE}/modelfiles/"
cp "${ROOT}/config/orchestrator-prompt.md" "${STAGE}/"
cp "${ROOT}/docker/README.md" "${STAGE}/README.md"
cp "${ROOT}/docker/run.sh" "${STAGE}/run.sh"
chmod +x "${STAGE}/run.sh"
cp "${ROOT}/docker/engine.sh" "${STAGE}/engine.sh"
cp "${ROOT}/docker/clean.sh" "${STAGE}/clean.sh"
chmod +x "${STAGE}/clean.sh"
cp "${ROOT}/docker/add-model.sh" "${STAGE}/add-model.sh"
chmod +x "${STAGE}/add-model.sh"
cp "${ROOT}/docker-run.sh" "${STAGE}/docker-run.sh"
chmod +x "${STAGE}/docker-run.sh"

cat > "${STAGE}/Makefile" <<'EOF'
# Unpacked compose kit (run.sh lives next to this file).
.PHONY: help up down clean logs status gpu demo demo-gpu add-model
help:
	@echo "make up       ./run.sh"
	@echo "make down     stop containers (keeps ./data)"
	@echo "make clean    stop leftovers / free ports (keeps ./data; CLEAN_DATA=1 to wipe)"
	@echo "make logs     follow logs"
	@echo "make status   compose ps"
	@echo "make gpu      ./run.sh --gpu (Docker gpus=all; Podman CDI or /dev/nvidia* fallback)"
	@echo "make demo     ./run.sh --demo security (authorized defensive overlay — not unfiltered)"
	@echo "make demo-gpu ./run.sh --gpu --demo security"
	@echo "make add-model TAG=<ollama-tag> [DEFAULT=1]  pull + wire LiteLLM"
up:
	chmod +x run.sh docker-run.sh
	./run.sh
down:
	./run.sh down
clean:
	chmod +x clean.sh
	./clean.sh $(if $(filter 1,$(CLEAN_DATA)),--data,)
logs:
	./run.sh logs
status:
	./run.sh status
gpu:
	chmod +x run.sh
	./run.sh --gpu
demo:
	chmod +x run.sh
	./run.sh --demo security
demo-gpu:
	chmod +x run.sh
	./run.sh --gpu --demo security
add-model:
	chmod +x add-model.sh engine.sh
	./add-model.sh
EOF

cat > "${STAGE}/.env.example" <<EOF
POSTGRES_PASSWORD=spockify-dev
LITELLM_MASTER_KEY=sk-spockify-change-me
WEBUI_SECRET_KEY=change-me-to-at-least-32-characters
SEARXNG_SECRET=change-me-searxng-secret

SPOCKIFY_CHAT_PORT=3080
SPOCKIFY_API_PORT=4000
SPOCKIFY_ROUTER_PORT=4100
STORAGE_ROOT=./data/spockify
ENABLE_SIGNUP=true

# Leave empty for LAN/IP access. Set for OAuth/share links only.
# WEBUI_URL=http://localhost:3080
# OFFLINE_MODE=true
# Optional neural TTS when online: AUDIO_TTS_ENGINE=edge

LITELLM_CONFIG=./litellm.yaml
SEARXNG_CONFIG=./searxng-settings.yml
ROUTING_RULES=./routing-rules.json
ORCHESTRATOR_PROMPT=./orchestrator-prompt.md
DEMO_SYSTEM_PROMPT=./docker/security-demo-prompt.md
POSTGRES_INIT=./postgres-init

# Prebuilt images for this kit
SPOCKIFY_ROUTER_IMAGE=${ROUTER_IMAGE}
SPOCKIFY_OPENWEBUI_IMAGE=${OWUI_IMAGE}

# Lean pull for 8–12 GiB VRAM (~20 GiB disk). Space-separated.
# Smoke: OLLAMA_PULL_MODELS=llama3.2:3b
# 12GB+: append gemma4:12b. 16GB+: append devstral-small-2.
# Huge (~75GB): append devstral-2 only on Spark/121GiB-class hosts.
OLLAMA_PULL_MODELS=llama3.2:3b llama3.1:8b codestral
OLLAMA_PULL_SCRIPT=./ollama-pull.sh
OLLAMA_MODELFILES=./modelfiles
EOF

cat > "${STAGE}/IMAGES.txt" <<EOF
SPOCKIFY_ROUTER_IMAGE=${ROUTER_IMAGE}
SPOCKIFY_OPENWEBUI_IMAGE=${OWUI_IMAGE}
EOF

mkdir -p "${DIST}"
rm -f "${ZIP}" "${DIST}/spockify-docker.zip"
(
  cd "${DIST}"
  zip -qr "spockify-docker-${VERSION}.zip" spockify-docker
  cp -f "spockify-docker-${VERSION}.zip" spockify-docker.zip
  sha256sum "spockify-docker-${VERSION}.zip" spockify-docker.zip > SHA256SUMS-docker
)

echo "Packed ${ZIP}"
echo "Images:"
echo "  ${ROUTER_IMAGE}"
echo "  ${OWUI_IMAGE}"
