#!/usr/bin/env bash
# Keep Open WebUI on spockify-auto; set the router Auto code worker.
# Usage:
#   make set-code-worker MODEL=codestral
#   make set-code-worker TAG=codestral
#   ./docker/set-code-worker.sh MODEL=devstral-small-2
# MODEL= accepts a LiteLLM model_name; TAG= is sanitized (: → -).
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
Usage: make set-code-worker MODEL=<model_name>
       make set-code-worker TAG=<ollama-tag>
       ./docker/set-code-worker.sh MODEL=<model_name>

  Keeps the UI picker on spockify-auto and points Auto code routes
  (ROOM_CODER_WORKER) at MODEL (LiteLLM model_name). TAG= is accepted
  and sanitized (codestral:latest → codestral-latest).

  Writes/updates .env:
    DEFAULT_MODELS=spockify-auto
    ROOM_CODER_WORKER=<model_name>
    COMMIT_MESSAGE_WORKER=<model_name>

  Does not change DEFAULT_CHAT_WORKER / FAST_CHAT_WORKER / Tab FIM
  (GHOST_OLLAMA_FIM_MODEL). Use a FIM-capable model (codestral) for Tab.

  Recreates router only (keeps volumes / chat data).

Env:
  SPOCKIFY_CONTAINER_ENGINE  docker|podman (same as run.sh)
  SKIP_RESTART=1             update .env only
EOF
}

MODEL="${MODEL:-}"
TAG="${TAG:-}"
SKIP_RESTART="${SKIP_RESTART:-0}"

for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    MODEL=*) MODEL="${arg#MODEL=}" ;;
    TAG=*) TAG="${arg#TAG=}" ;;
    SKIP_RESTART=*) SKIP_RESTART="${arg#SKIP_RESTART=}" ;;
    *)
      if [[ -z "${MODEL}" && -z "${TAG}" && "${arg}" != *=* ]]; then
        MODEL="${arg}"
      else
        echo "Unknown argument: ${arg}" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

tag_to_model_name() {
  local t="$1"
  t="${t##*/}"
  printf '%s\n' "${t//:/-}"
}

if [[ -z "${MODEL}" && -n "${TAG}" ]]; then
  MODEL="$(tag_to_model_name "${TAG}")"
elif [[ -n "${MODEL}" && "${MODEL}" == *:* ]]; then
  # Treat MODEL=codestral:22b like TAG=
  MODEL="$(tag_to_model_name "${MODEL}")"
fi

if [[ -z "${MODEL}" ]]; then
  echo "error: MODEL= or TAG= is required." >&2
  usage
  exit 1
fi

set_env_key() {
  local key="$1"
  local val="$2"
  local file="$3"
  local tmp
  if [[ ! -f "${file}" ]]; then
    printf '%s=%s\n' "${key}" "${val}" > "${file}"
    echo ".env: created ${file#"${ROOT}/"} with ${key}=${val}"
    return
  fi
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "${file}"; then
    sed -E "s|^${key}=.*|${key}=${val}|" "${file}" > "${tmp}"
    mv "${tmp}" "${file}"
    echo ".env: set ${key}=${val}"
  elif grep -qE "^#[[:space:]]*${key}=" "${file}"; then
    awk -v key="${key}" -v val="${val}" '
      BEGIN { done=0 }
      !done && $0 ~ "^#[[:space:]]*" key "=" {
        print key "=" val
        done=1
        next
      }
      { print }
    ' "${file}" > "${tmp}"
    mv "${tmp}" "${file}"
    echo ".env: uncommented/set ${key}=${val}"
  else
    printf '\n%s=%s\n' "${key}" "${val}" >> "${file}"
    echo ".env: appended ${key}=${val}"
  fi
}

ENV_FILE="${ROOT}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ROOT}/.env.example" ]]; then
    cp "${ROOT}/.env.example" "${ENV_FILE}"
    echo "Wrote .env from .env.example"
  else
    touch "${ENV_FILE}"
    echo "Created empty .env"
  fi
fi

set_env_key "DEFAULT_MODELS" "spockify-auto" "${ENV_FILE}"
set_env_key "ROOM_CODER_WORKER" "${MODEL}" "${ENV_FILE}"
# Commit-message helper shares the coding tier on compose.
set_env_key "COMMIT_MESSAGE_WORKER" "${MODEL}" "${ENV_FILE}"

SKIP_ON=0
case "${SKIP_RESTART}" in
  1|true|yes|YES) SKIP_ON=1 ;;
esac

if [[ "${SKIP_ON}" -eq 1 ]]; then
  echo
  echo "Done (SKIP_RESTART=1)."
  echo "  DEFAULT_MODELS=spockify-auto"
  echo "  ROOM_CODER_WORKER=${MODEL}"
  echo "  COMMIT_MESSAGE_WORKER=${MODEL}"
  echo "Recreate later: compose up -d --force-recreate router"
  exit 0
fi

detect_engine

FILES=(-f docker-compose.yml)
if [[ ! -d "${ROOT}/services/router" ]]; then
  if [[ -f "${ROOT}/docker-compose.yml" ]]; then
    FILES=(-f docker-compose.yml)
  elif [[ -f "${ROOT}/compose.pull.yml" ]]; then
    FILES=(-f compose.pull.yml)
  elif [[ -f "${ROOT}/docker/compose.pull.yml" ]]; then
    FILES=(-f docker/compose.pull.yml)
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

compose() {
  "${ENGINE[@]}" "${FILES[@]}" "$@"
}

runtime="$(runtime_bin)"
echo "Engine: ${ENGINE[*]} (runtime=${runtime})"

if ! compose ps 2>/dev/null | grep -Eqi 'router'; then
  echo "warning: router not running — .env updated; start with make up / make gpu." >&2
  echo
  echo "Done."
  echo "  DEFAULT_MODELS=spockify-auto"
  echo "  ROOM_CODER_WORKER=${MODEL}"
  echo "  COMMIT_MESSAGE_WORKER=${MODEL}"
  exit 0
fi

echo "Recreating router to pick up .env (keeps data)..."
compose up -d --force-recreate router 2>/dev/null \
  || compose up -d router

echo
echo "Done."
echo "  DEFAULT_MODELS=spockify-auto"
echo "  ROOM_CODER_WORKER=${MODEL}"
echo "  COMMIT_MESSAGE_WORKER=${MODEL}"
echo "  UI stays on Auto; code routes to ${MODEL}."
