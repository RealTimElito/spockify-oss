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
cp "${ROOT}/docker-compose.podman.yml" "${STAGE}/docker-compose.podman.yml"
cp "${ROOT}/docker/ollama-pull.sh" "${STAGE}/"
chmod +x "${STAGE}/ollama-pull.sh"
cp "${ROOT}/docker/litellm.yaml" "${STAGE}/"
cp "${ROOT}/docker/searxng-settings.yml" "${STAGE}/"
cp "${ROOT}/docker/routing-rules.json" "${STAGE}/"
cp "${ROOT}/docker/postgres-init/01-create-litellm.sql" "${STAGE}/postgres-init/"
mkdir -p "${STAGE}/modelfiles"
cp "${ROOT}/config/modelfiles/coder.Modelfile" "${STAGE}/modelfiles/"
cp "${ROOT}/config/modelfiles/devstral-16g.Modelfile" "${STAGE}/modelfiles/"
cp "${ROOT}/config/orchestrator-prompt.md" "${STAGE}/"
cp "${ROOT}/docker/README.md" "${STAGE}/README.md"
cp "${ROOT}/docker/run.sh" "${STAGE}/run.sh"
chmod +x "${STAGE}/run.sh"
cp "${ROOT}/docker/engine.sh" "${STAGE}/engine.sh"
cp "${ROOT}/docker/clean.sh" "${STAGE}/clean.sh"
chmod +x "${STAGE}/clean.sh"
cp "${ROOT}/docker-run.sh" "${STAGE}/docker-run.sh"
chmod +x "${STAGE}/docker-run.sh"

cat > "${STAGE}/Makefile" <<'EOF'
# Unpacked compose kit (run.sh lives next to this file).
.PHONY: help up down clean logs status
help:
	@echo "make up      ./run.sh"
	@echo "make down    stop containers (keeps ./data)"
	@echo "make clean   stop leftovers / free ports (keeps ./data; CLEAN_DATA=1 to wipe)"
	@echo "make logs    follow logs"
	@echo "make status  compose ps"
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

LITELLM_CONFIG=./litellm.yaml
SEARXNG_CONFIG=./searxng-settings.yml
ROUTING_RULES=./routing-rules.json
ORCHESTRATOR_PROMPT=./orchestrator-prompt.md
POSTGRES_INIT=./postgres-init

# Prebuilt images for this kit
SPOCKIFY_ROUTER_IMAGE=${ROUTER_IMAGE}
SPOCKIFY_OPENWEBUI_IMAGE=${OWUI_IMAGE}

# Pulled automatically on compose up (~42 GiB first time). Space-separated.
OLLAMA_PULL_MODELS=llama3.2:3b llama3.1:8b gemma4:12b codestral devstral-small-2
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
