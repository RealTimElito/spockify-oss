#!/usr/bin/env bash
# Shared container-engine detection for run.sh / clean.sh.
# Sourced only — do not execute. Prefer podman-compose; skip a broken Docker API.
#
# Expects: nothing. Sets: ENGINE (array). Exports DOCKER_HOST / PODMAN_COMPOSE_PROVIDER when needed.

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

using_podman() {
  case "${ENGINE[0]}" in
    podman|podman-compose) return 0 ;;
    *) return 1 ;;
  esac
}
