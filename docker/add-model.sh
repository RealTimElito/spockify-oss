#!/usr/bin/env bash
# Pull an Ollama tag into the running compose stack and wire LiteLLM.
# Usage:
#   make add-model TAG=llama3.2:3b
#   make add-model TAG=gemma4:12b DEFAULT=1
#   ./docker/add-model.sh TAG=llama3.2:3b
# Env aliases: MODEL= (same as TAG), DEFAULT=1 (set .env defaults).
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
Usage: make add-model TAG=<ollama-tag> [DEFAULT=1]
       ./docker/add-model.sh TAG=<ollama-tag> [DEFAULT=1]

  Pulls TAG into the Ollama container, appends a LiteLLM model_list row
  (docker/litellm.yaml), and restarts litellm without wiping data.

  TAG / MODEL   Exact Ollama tag (required), e.g. llama3.2:3b or gemma4:12b
  DEFAULT=1     Also set DEFAULT_MODELS and DEFAULT_CHAT_WORKER in .env
                (does not change defaults unless this flag is set)

  model_name is derived by replacing ':' with '-' (llama3.2:3b → llama3.2-3b).

Env:
  SPOCKIFY_CONTAINER_ENGINE  docker|podman (same as run.sh)
  SYNC_CONFIG=1              also append to config/litellm.yaml when present
EOF
}

TAG="${TAG:-${MODEL:-}}"
DEFAULT="${DEFAULT:-0}"
SYNC_CONFIG="${SYNC_CONFIG:-0}"

for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    TAG=*) TAG="${arg#TAG=}" ;;
    MODEL=*) TAG="${arg#MODEL=}" ;;
    DEFAULT=*) DEFAULT="${arg#DEFAULT=}" ;;
    SYNC_CONFIG=*) SYNC_CONFIG="${arg#SYNC_CONFIG=}" ;;
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

# Stable Spockify / LiteLLM model_name: llama3.2:3b → llama3.2-3b
tag_to_model_name() {
  local t="$1"
  # Strip registry/path prefix if someone passes org/name:tag
  t="${t##*/}"
  printf '%s\n' "${t//:/-}"
}

MODEL_NAME="$(tag_to_model_name "${TAG}")"
if [[ -z "${MODEL_NAME}" ]]; then
  echo "error: could not derive model_name from TAG=${TAG}" >&2
  exit 1
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
echo "Pull + wire: ollama tag=${TAG} → litellm model_name=${MODEL_NAME}"

# --- 1) Pull into Ollama ---
if ! compose ps 2>/dev/null | grep -Eqi 'ollama'; then
  echo "error: ollama container not running. Start the stack first (make up / make gpu)." >&2
  exit 1
fi

echo "Pulling ${TAG} inside ollama..."
compose exec -T ollama ollama pull "${TAG}"

# --- 2) LiteLLM yaml ---
LITELLM_DOCKER="${ROOT}/docker/litellm.yaml"
if [[ ! -f "${LITELLM_DOCKER}" ]]; then
  # Kit layout: litellm.yaml next to run.sh
  if [[ -f "${ROOT}/litellm.yaml" ]]; then
    LITELLM_DOCKER="${ROOT}/litellm.yaml"
  else
    echo "error: docker/litellm.yaml not found" >&2
    exit 1
  fi
fi

entry_exists() {
  local file="$1"
  # Exact ollama tag already wired (fixed-string; TAG may contain dots)
  if grep -Fq "model: ollama_chat/${TAG}" "${file}"; then
    return 0
  fi
  # Same model_name already present
  if grep -Fq "model_name: ${MODEL_NAME}" "${file}"; then
    return 0
  fi
  return 1
}

append_litellm_entry() {
  local file="$1"
  local api_base="$2"
  local timeout="${3:-300}"
  local tmp entry_file anchor

  if entry_exists "${file}"; then
    echo "LiteLLM: already present in ${file#"${ROOT}/"} (skip)"
    return 1
  fi

  entry_file="$(mktemp)"
  cat > "${entry_file}" <<EOF

  - model_name: ${MODEL_NAME}
    litellm_params:
      model: ollama_chat/${TAG}
      api_base: ${api_base}
      timeout: ${timeout}
EOF

  tmp="$(mktemp)"
  anchor=""
  if grep -Eq '^router_settings:' "${file}"; then
    anchor='^router_settings:'
  elif grep -Eq '^litellm_settings:' "${file}"; then
    anchor='^litellm_settings:'
  elif grep -Eq '^general_settings:' "${file}"; then
    anchor='^general_settings:'
  fi

  if [[ -n "${anchor}" ]]; then
    # Insert blank-line + entry before the anchor section.
    awk -v anchor="${anchor}" -v ef="${entry_file}" '
      $0 ~ anchor && !done {
        while ((getline line < ef) > 0) print line
        close(ef)
        done=1
      }
      { print }
    ' "${file}" > "${tmp}"
  else
    cat "${file}" > "${tmp}"
    cat "${entry_file}" >> "${tmp}"
  fi
  rm -f "${entry_file}"
  mv "${tmp}" "${file}"
  echo "LiteLLM: appended ${MODEL_NAME} → ollama_chat/${TAG} in ${file#"${ROOT}/"}"
  return 0
}

detect_api_base() {
  local file="$1"
  if grep -Eq 'api_base:[[:space:]]*os\.environ/OLLAMA_API_BASE' "${file}"; then
    printf '%s\n' 'os.environ/OLLAMA_API_BASE'
  else
    printf '%s\n' 'http://ollama:11434'
  fi
}

ADDED_DOCKER=0
if append_litellm_entry "${LITELLM_DOCKER}" "$(detect_api_base "${LITELLM_DOCKER}")"; then
  ADDED_DOCKER=1
fi

# Optional / private: keep config/litellm.yaml in sync when asked or compose-style.
LITELLM_CONFIG="${ROOT}/config/litellm.yaml"
if [[ -f "${LITELLM_CONFIG}" ]]; then
  want_config=0
  case "${SYNC_CONFIG}" in
    1|true|yes|YES) want_config=1 ;;
  esac
  if [[ "${want_config}" -eq 0 ]] && grep -Eq 'api_base:[[:space:]]*http://ollama:11434' "${LITELLM_CONFIG}"; then
    want_config=1
  fi
  if [[ "${want_config}" -eq 1 ]]; then
    append_litellm_entry "${LITELLM_CONFIG}" "$(detect_api_base "${LITELLM_CONFIG}")" || true
  fi
fi

# --- 3) Optional .env defaults ---
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
    # Update existing assignment only (leave comments/secrets alone).
    sed -E "s|^${key}=.*|${key}=${val}|" "${file}" > "${tmp}"
    mv "${tmp}" "${file}"
    echo ".env: set ${key}=${val}"
  elif grep -qE "^#[[:space:]]*${key}=" "${file}"; then
    # Uncomment first matching commented key.
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

DEFAULT_ON=0
case "${DEFAULT}" in
  1|true|yes|YES) DEFAULT_ON=1 ;;
esac

if [[ "${DEFAULT_ON}" -eq 1 ]]; then
  ENV_FILE="${ROOT}/.env"
  if [[ ! -f "${ENV_FILE}" && -f "${ROOT}/.env.example" ]]; then
    cp "${ROOT}/.env.example" "${ENV_FILE}"
    echo "Wrote .env from .env.example"
  fi
  set_env_key "DEFAULT_MODELS" "${MODEL_NAME}" "${ENV_FILE}"
  set_env_key "DEFAULT_CHAT_WORKER" "${MODEL_NAME}" "${ENV_FILE}"
fi

# --- 4) Restart litellm (and dependents when defaults changed) ---
echo "Restarting litellm (compose up -d, keeps data)..."
compose up -d litellm
if [[ "${DEFAULT_ON}" -eq 1 ]]; then
  # DEFAULT_* are injected at container create time.
  echo "Recreating router + openwebui to pick up .env defaults..."
  compose up -d --force-recreate router openwebui 2>/dev/null \
    || compose up -d router openwebui
fi

echo
echo "Done."
echo "  Ollama tag:   ${TAG}"
echo "  LiteLLM name: ${MODEL_NAME}"
if [[ "${ADDED_DOCKER}" -eq 0 ]]; then
  echo "  Catalog:      already wired (no yaml change)"
fi
if [[ "${DEFAULT_ON}" -eq 0 ]]; then
  cat <<EOF

To use as default (optional — not applied unless DEFAULT=1):
  # .env
  DEFAULT_MODELS=${MODEL_NAME}
  DEFAULT_CHAT_WORKER=${MODEL_NAME}
  # then: make down && make up   # or make gpu
Or re-run: make add-model TAG=${TAG} DEFAULT=1
EOF
else
  echo "  Defaults:     DEFAULT_MODELS=${MODEL_NAME} DEFAULT_CHAT_WORKER=${MODEL_NAME}"
fi
