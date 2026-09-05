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
Usage: ./docker/run.sh [up|down|logs|pull-model|status] [--gpu] [--build]

  up          Start the stack (default). Pulls GHCR images when possible.
              Starts model download in the background
              (default: llama3.2:3b llama3.1:8b gemma4:12b codestral devstral-small-2).
  down        Stop containers (keeps ./data)
  logs        Follow all service logs
  pull-model  Re-run the model pull (same tags as up)
  status      compose ps
  --gpu       Also apply docker-compose.gpu.yml
  --build     Rebuild router and Open WebUI even if local images exist

Env:
  SPOCKIFY_CONTAINER_ENGINE  docker|podman (default: Podman if compose works)
EOF
}

ENGINE=()

# `podman compose` searches PATH for docker-compose (hyphen) first; that binary
# talks to the Docker API and fails on rootless Fedora. Prefer podman-compose.
podman_user_socket() {
  local sock="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
  if [[ ! -S "${sock}" ]]; then
    sock="/run/user/$(id -u)/podman/podman.sock"
  fi
  if [[ -S "${sock}" ]]; then
    printf 'unix://%s\n' "${sock}"
    return 0
  fi
  return 1
}

use_podman_docker_host() {
  local host
  if host="$(podman_user_socket)"; then
    export DOCKER_HOST="${host}"
  fi
}

podman_compose_ok() {
  command -v podman >/dev/null 2>&1 || return 1
  local host
  host="$(podman_user_socket || true)"
  if [[ -n "${host}" ]]; then
    DOCKER_HOST="${host}" podman compose version >/dev/null 2>&1
  else
    podman compose version >/dev/null 2>&1
  fi
}

pick_podman() {
  command -v podman >/dev/null 2>&1 || return 1
  # Never exec hyphenated docker-compose unless that is the chosen ENGINE.
  if command -v podman-compose >/dev/null 2>&1; then
    ENGINE=(podman-compose)
    export PODMAN_COMPOSE_PROVIDER=podman-compose
    use_podman_docker_host
    return 0
  fi
  # Without podman-compose, `podman compose` will pick docker-compose if present.
  if command -v docker-compose >/dev/null 2>&1; then
    return 1
  fi
  if podman_compose_ok; then
    ENGINE=(podman compose)
    use_podman_docker_host
    return 0
  fi
  return 1
}

# docker compose version can succeed while dockerd is down (Fedora / podman-docker).
docker_engine_ok() {
  command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1
}

detect_engine() {
  local want="${SPOCKIFY_CONTAINER_ENGINE:-}"
  case "${want}" in
    docker)
      if docker_engine_ok; then
        ENGINE=(docker compose)
        return
      fi
      echo "SPOCKIFY_CONTAINER_ENGINE=docker but docker compose is not available or the Docker API is unreachable (is dockerd running?)." >&2
      exit 1
      ;;
    podman)
      if pick_podman; then
        return
      fi
      echo "SPOCKIFY_CONTAINER_ENGINE=podman but podman-compose is not available (and podman compose would call docker-compose)." >&2
      exit 1
      ;;
    "")
      ;;
    *)
      echo "SPOCKIFY_CONTAINER_ENGINE must be docker or podman (got: ${want})." >&2
      exit 1
      ;;
  esac
  # Prefer Podman when compose actually works; Ubuntu without Podman falls through.
  if pick_podman; then
    return
  fi
  if docker_engine_ok; then
    ENGINE=(docker compose)
    return
  fi
  echo "Need Podman Compose (Fedora: podman + podman-compose) or Docker Compose v2 (Ubuntu: docker.io + docker-compose-v2)." >&2
  echo "If you saw 'failed to connect to the docker API' or 'docker-compose --remove-orphans', dockerd is not running. Prefer Podman:" >&2
  echo "  sudo dnf install -y podman podman-compose" >&2
  echo "  systemctl --user enable --now podman.socket" >&2
  echo "  podman-compose version" >&2
  exit 1
}

# docker vs podman-compose: inspect/pull must use the runtime, not "podman-compose".
runtime_bin() {
  case "${ENGINE[0]}" in
    podman|podman-compose) printf '%s\n' podman ;;
    *) printf '%s\n' docker ;;
  esac
}

image_exists() {
  local img="$1"
  [[ -n "${img}" ]] || return 1
  "$(runtime_bin)" image inspect "${img}" >/dev/null 2>&1
}

ghcr_prefix_from_git() {
  local url owner
  url="$(git -C "${ROOT}" remote get-url origin 2>/dev/null || true)"
  [[ -n "${url}" ]] || return 1
  owner="$(printf '%s\n' "${url}" | sed -nE 's#.*github.com[:/]([^/]+)/.*#\1#p')"
  [[ -n "${owner}" ]] || return 1
  printf 'ghcr.io/%s\n' "${owner,,}"
}

# Pull published images so Fedora/Podman does not have to run Vite in-container.
pull_ghcr_images() {
  local prefix tag router owui rt
  prefix="${SPOCKIFY_IMAGE_PREFIX:-}"
  tag="${SPOCKIFY_IMAGE_TAG:-latest}"
  if [[ -z "${prefix}" ]]; then
    prefix="$(ghcr_prefix_from_git || true)"
  fi
  [[ -n "${prefix}" ]] || return 1
  router="${SPOCKIFY_ROUTER_IMAGE:-${prefix}/spockify-router:${tag}}"
  owui="${SPOCKIFY_OPENWEBUI_IMAGE:-${prefix}/spockify-openwebui:${tag}}"
  rt="$(runtime_bin)"
  echo "Pulling ${router} and ${owui} (skips a local Open WebUI npm build)..."
  if "${rt}" pull "${router}" && "${rt}" pull "${owui}"; then
    export SPOCKIFY_ROUTER_IMAGE="${router}"
    export SPOCKIFY_OPENWEBUI_IMAGE="${owui}"
    return 0
  fi
  return 1
}

storage_root() {
  printf '%s\n' "${STORAGE_ROOT:-${ROOT}/data/spockify}"
}

using_podman() {
  case "${ENGINE[0]}" in
    podman|podman-compose) return 0 ;;
    *) return 1 ;;
  esac
}

# postgres:17-alpine drops to UID 70. Debian postgres images use 999.
# Never use Podman :U: image USER is root (chown to 0), then alpine needs 70,
# and :U walks every bind (ollama models → EPERM). Only unshare-chown postgres.
prepare_data_dirs() {
  local root pg pg_uid
  root="$(storage_root)"
  mkdir -p "${root}"/{postgres,ollama,openwebui}
  using_podman || return 0
  pg="${root}/postgres"
  pg_uid="${SPOCKIFY_POSTGRES_UID:-70}"
  if ! podman unshare chown -R "${pg_uid}:${pg_uid}" "${pg}" 2>/dev/null; then
    echo "Could not chown ${pg} for rootless Postgres (UID ${pg_uid}). Continuing." >&2
    echo "If postgres then fails to start, on the host:" >&2
    echo "  sudo chown -R $(id -u):$(id -g) ${pg}" >&2
    echo "  # or start empty: sudo rm -rf ${pg} && mkdir -p ${pg}" >&2
  fi
}

selinux_hint() {
  if command -v getenforce >/dev/null 2>&1; then
    local mode root
    mode="$(getenforce 2>/dev/null || true)"
    root="$(storage_root)"
    if [[ "${mode}" == "Enforcing" ]]; then
      echo "SELinux is Enforcing — compose bind mounts already use :z."
      mkdir -p "${root}"
      if command -v chcon >/dev/null 2>&1; then
        chcon -Rt container_file_t "${root}" 2>/dev/null || true
        echo "If a volume is Permission denied: sudo chcon -Rt container_file_t ${root}"
      fi
    fi
  fi
}

load_env() {
  if [[ -f "${ROOT}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${ROOT}/.env"
    set +a
  fi
}

wait_http() {
  local url="$1" name="$2" tries="${3:-90}"
  local i=0
  echo "Waiting for ${name} at ${url}..."
  until curl -fsS "${url}" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "${i}" -ge "${tries}" ]]; then
      echo "${name} did not become ready. Recent logs:" >&2
      "${ENGINE[@]}" "${FILES[@]}" logs --tail=80 "${name}" >&2 || true
      return 1
    fi
    sleep 2
  done
}

CMD="up"
GPU=0
FORCE_BUILD=0
for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    --gpu) GPU=1 ;;
    --build) FORCE_BUILD=1 ;;
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
if using_podman && [[ -f "${ROOT}/docker-compose.podman.yml" ]]; then
  FILES+=(-f docker-compose.podman.yml)
fi

if [[ ! -f "${ROOT}/.env" && -f "${ROOT}/.env.example" ]]; then
  cp "${ROOT}/.env.example" "${ROOT}/.env"
  echo "Wrote .env from .env.example — edit secrets before publishing this host."
fi
load_env

compose() {
  "${ENGINE[@]}" "${FILES[@]}" "$@"
}

# docker compose / `podman compose` (v2) support --remove-orphans.
# podman-compose often rejects it and aborts `up`.
compose_supports_remove_orphans() {
  [[ "${ENGINE[0]}" != "podman-compose" ]] || return 1
  compose up --help 2>&1 | grep -q -- '--remove-orphans'
}

compose_up() {
  local args=(-d)
  if [[ "${1:-}" == "--build" ]]; then
    args+=(--build)
  fi
  if compose_supports_remove_orphans; then
    args+=(--remove-orphans)
  fi
  compose up "${args[@]}"
}

case "${CMD}" in
  up)
    selinux_hint
    prepare_data_dirs
    echo "Starting Spockify..."
    if [[ -d "${ROOT}/services/router" ]]; then
      router_img="${SPOCKIFY_ROUTER_IMAGE:-spockify-router:local}"
      owui_img="${SPOCKIFY_OPENWEBUI_IMAGE:-spockify-openwebui:local}"
      need_build="${FORCE_BUILD}"
      if [[ "${need_build}" -eq 0 ]]; then
        if image_exists "${router_img}" && image_exists "${owui_img}"; then
          need_build=0
        elif pull_ghcr_images && image_exists "${SPOCKIFY_ROUTER_IMAGE}" \
          && image_exists "${SPOCKIFY_OPENWEBUI_IMAGE}"; then
          need_build=0
        else
          echo "No prebuilt images — building Open WebUI locally (needs several GiB RAM)." >&2
          echo "If npm run build fails on Fedora, pull GHCR instead of building:" >&2
          echo "  $(runtime_bin) pull ghcr.io/<owner>/spockify-openwebui:latest" >&2
          need_build=1
        fi
      fi
      if [[ "${need_build}" -eq 1 ]]; then
        echo "Building images (first run can take several minutes)..."
        compose_up --build
      else
        compose_up
      fi
    else
      compose_up
    fi
    if command -v curl >/dev/null 2>&1; then
      wait_http "http://127.0.0.1:${SPOCKIFY_ROUTER_PORT:-4100}/health" router 90
      wait_http "http://127.0.0.1:${SPOCKIFY_API_PORT:-4000}/health/liveliness" litellm 90
      wait_http "http://127.0.0.1:${SPOCKIFY_CHAT_PORT:-3080}/health" openwebui 90
    fi
    echo
    echo "Chat UI:  http://localhost:${SPOCKIFY_CHAT_PORT:-3080}"
    echo "API:      http://localhost:${SPOCKIFY_API_PORT:-4000}/v1"
    echo "Models:   ${OLLAMA_PULL_MODELS:-llama3.2:3b llama3.1:8b gemma4:12b codestral devstral-small-2}"
    echo "Model pull runs in the background. Watch with:"
    echo "          ${ENGINE[*]} ${FILES[*]} logs -f ollama-pull"
    echo "Open the UI and create the first admin account."
    ;;
  down)
    compose down
    ;;
  logs)
    compose logs -f --tail=100
    ;;
  status)
    compose ps
    ;;
  pull-model)
    compose run --rm --no-deps ollama-pull
    ;;
esac
