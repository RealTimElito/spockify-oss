#!/usr/bin/env bash
# Start Spockify with Docker Compose or Podman. Works on Ubuntu and Fedora (SELinux).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${HERE}/docker-compose.yml" ]]; then
  ROOT="${HERE}"
elif [[ -f "${HERE}/../docker-compose.yml" ]]; then
  ROOT="$(cd "${HERE}/.." && pwd)"
else
  echo "Cannot find docker-compose.yml next to or above this script." >&2
  exit 1
fi
cd "${ROOT}"

usage() {
  cat <<'EOF'
Usage: ./docker/run.sh [up|down|logs|pull-model|status] [--gpu]

  up          Build (if source is present) and start the stack (default).
              Also downloads OLLAMA_PULL_MODELS
              (default: llama3.2:3b llama3.1:8b gemma4:12b codestral devstral-small-2).
  down        Stop containers (keeps ./data)
  logs        Follow all service logs
  pull-model  Re-run the model pull (same tags as up)
  status      docker compose ps
  --gpu       Also apply docker-compose.gpu.yml
EOF
}

ENGINE=()
detect_engine() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ENGINE=(docker compose)
    return
  fi
  if command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    ENGINE=(podman compose)
    return
  fi
  if command -v podman-compose >/dev/null 2>&1; then
    ENGINE=(podman-compose)
    return
  fi
  echo "Need Docker Compose v2 (Ubuntu: docker.io + docker-compose-v2) or Podman Compose (Fedora: podman + podman-compose)." >&2
  exit 1
}

selinux_hint() {
  if command -v getenforce >/dev/null 2>&1; then
    local mode
    mode="$(getenforce 2>/dev/null || true)"
    if [[ "${mode}" == "Enforcing" ]]; then
      echo "SELinux is Enforcing — compose bind mounts already use :z."
      if [[ ! -d data/spockify ]]; then
        mkdir -p data/spockify/{postgres,ollama,openwebui}
      fi
      if command -v chcon >/dev/null 2>&1; then
        chcon -Rt container_file_t data/spockify 2>/dev/null || true
        echo "If a volume is Permission denied: sudo chcon -Rt container_file_t ${ROOT}/data/spockify"
      fi
    fi
  fi
}

CMD="up"
GPU=0
for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    --gpu) GPU=1 ;;
    up|down|logs|pull-model|status) CMD="${arg}" ;;
    *) echo "Unknown argument: ${arg}" >&2; usage; exit 1 ;;
  esac
done

detect_engine

FILES=(-f docker-compose.yml)
if [[ ! -d "${ROOT}/services/router" ]]; then
  # Unpacked GitHub / spockify.eu kit.
  if [[ -f "${ROOT}/docker-compose.yml" ]]; then
    FILES=(-f docker-compose.yml)
  elif [[ -f "${ROOT}/compose.pull.yml" ]]; then
    FILES=(-f compose.pull.yml)
  fi
fi
if [[ "${GPU}" -eq 1 ]]; then
  if [[ -f "${ROOT}/docker-compose.gpu.yml" ]]; then
    FILES+=(-f docker-compose.gpu.yml)
  elif [[ -f "${ROOT}/compose.gpu.yml" ]]; then
    FILES+=(-f compose.gpu.yml)
  fi
fi

if [[ ! -f "${ROOT}/.env" && -f "${ROOT}/.env.example" ]]; then
  cp "${ROOT}/.env.example" "${ROOT}/.env"
  echo "Wrote .env from .env.example — edit secrets before publishing this host."
fi

case "${CMD}" in
  up)
    selinux_hint
    if [[ -d "${ROOT}/services/router" ]]; then
      "${ENGINE[@]}" "${FILES[@]}" up -d --build
    else
      "${ENGINE[@]}" "${FILES[@]}" up -d
    fi
    echo
    echo "Chat UI:  http://localhost:${SPOCKIFY_CHAT_PORT:-3080}"
    echo "API:      http://localhost:${SPOCKIFY_API_PORT:-4000}/v1"
    echo "Models:   ${OLLAMA_PULL_MODELS:-llama3.2:3b llama3.1:8b gemma4:12b codestral devstral-small-2}"
    echo "Open the UI and create the first admin account."
    ;;
  down)
    "${ENGINE[@]}" "${FILES[@]}" down
    ;;
  logs)
    "${ENGINE[@]}" "${FILES[@]}" logs -f --tail=100
    ;;
  status)
    "${ENGINE[@]}" "${FILES[@]}" ps
    ;;
  pull-model)
    "${ENGINE[@]}" "${FILES[@]}" run --rm --no-deps ollama-pull
    ;;
esac
