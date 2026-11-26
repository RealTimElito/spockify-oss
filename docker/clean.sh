#!/usr/bin/env bash
# Stop Spockify compose leftovers (ports 3080/4000/4100). Keeps ./data by default.
# Usage: ./docker/clean.sh [--data]
# Env: CLEAN_DATA=1 (same as --data), SPOCKIFY_CONTAINER_ENGINE=docker|podman
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

# shellcheck disable=SC1091
source "${HERE}/engine.sh"

usage() {
  cat <<'EOF'
Usage: ./docker/clean.sh [--data]

  Stops and removes Spockify compose project containers (and orphans when
  the engine supports it). Does not touch Kubernetes.

  --data / CLEAN_DATA=1  Also wipe STORAGE_ROOT (./data/spockify) and
                         named volume spockify_pgdata. Default: keep data.

Env:
  SPOCKIFY_CONTAINER_ENGINE  docker|podman (same as run.sh)
  CLEAN_DATA=1               same as --data
EOF
}

WANT_DATA=0
case "${CLEAN_DATA:-0}" in
  1|true|yes|YES) WANT_DATA=1 ;;
esac
for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    --data) WANT_DATA=1 ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      usage
      exit 1
      ;;
  esac
done

detect_engine

FILES=(-f docker-compose.yml)
if [[ ! -d "${ROOT}/services/router" ]]; then
  if [[ -f "${ROOT}/docker-compose.yml" ]]; then
    FILES=(-f docker-compose.yml)
  elif [[ -f "${ROOT}/compose.pull.yml" ]]; then
    FILES=(-f compose.pull.yml)
  fi
fi
if using_podman && [[ -f "${ROOT}/docker-compose.podman.yml" ]]; then
  FILES+=(-f docker-compose.podman.yml)
  export SPOCKIFY_PGDATA="${SPOCKIFY_PGDATA:-spockify_pgdata}"
fi

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

storage_root() {
  printf '%s\n' "${STORAGE_ROOT:-${ROOT}/data/spockify}"
}

compose() {
  "${ENGINE[@]}" "${FILES[@]}" "$@"
}

compose_supports_remove_orphans() {
  [[ "${ENGINE[0]}" != "podman-compose" ]] || return 1
  compose down --help 2>&1 | grep -q -- '--remove-orphans' || return 1
}

echo "Engine: ${ENGINE[*]}"
echo "Stopping Spockify compose project..."

down_args=()
if compose_supports_remove_orphans; then
  down_args+=(--remove-orphans)
fi
if [[ "${WANT_DATA}" -eq 1 ]]; then
  down_args+=(-v)
fi
if ! compose down "${down_args[@]}"; then
  # podman-compose may reject -v / --remove-orphans; retry bare down.
  echo "compose down with extras failed; retrying plain down..." >&2
  compose down || true
fi

# Catch leave-behinds that compose down missed (common on Fedora / podman-compose).
rt="$(runtime_bin)"
removed_extra=0
collect_ids() {
  local id
  for id in $(
    {
      "${rt}" ps -aq --filter "label=com.docker.compose.project=spockify" 2>/dev/null || true
      "${rt}" ps -aq --filter "label=io.podman.compose.project=spockify" 2>/dev/null || true
      "${rt}" ps -aq --filter "name=^spockify[-_]" 2>/dev/null || true
    } | awk 'NF' | sort -u
  ); do
    printf '%s\n' "${id}"
  done
}

mapfile -t leftover_ids < <(collect_ids || true)
if [[ "${#leftover_ids[@]}" -gt 0 ]]; then
  echo "Removing leftover Spockify containers..."
  for id in "${leftover_ids[@]}"; do
    "${rt}" rm -f "${id}" >/dev/null 2>&1 || true
    removed_extra=1
  done
fi

data_root="$(storage_root)"
wiped_vol=0
if [[ "${WANT_DATA}" -eq 1 ]]; then
  if [[ -d "${data_root}" ]]; then
    echo "Wiping local data: ${data_root}"
    rm -rf "${data_root}"
  else
    echo "No data dir at ${data_root} (nothing to wipe)."
  fi
  # Named volume (Podman) — project-prefixed and bare names both show up in the wild.
  for vol in spockify_pgdata spockify_spockify_pgdata; do
    if "${rt}" volume inspect "${vol}" >/dev/null 2>&1; then
      echo "Removing volume ${vol}"
      "${rt}" volume rm -f "${vol}" >/dev/null 2>&1 || true
      wiped_vol=1
    fi
  done
fi

echo
echo "Done."
if [[ "${removed_extra}" -eq 1 ]]; then
  echo "  Containers: compose down + leftover rm"
else
  echo "  Containers: compose down"
fi
if [[ "${WANT_DATA}" -eq 1 ]]; then
  if [[ "${wiped_vol}" -eq 1 ]]; then
    echo "  Data:       wiped (${data_root}; volumes removed)"
  else
    echo "  Data:       wiped (${data_root})"
  fi
else
  echo "  Data:       kept (${data_root}; named volume spockify_pgdata kept)"
  echo "  Wipe data:  make clean CLEAN_DATA=1   or   ./docker/clean.sh --data"
fi
echo
echo "If ports 3080/4000/4100 are still busy (non-Spockify process):"
echo "  ss -ltnp | rg '3080|4000|4100'"
