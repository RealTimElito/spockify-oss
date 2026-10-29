#!/usr/bin/env bash
# Pull an Ollama tag into the running compose stack and wire LiteLLM.
# Usage:
#   make add-model TAG=llama3.2:3b
#   make add-model TAG=gemma4:12b AUTO=1      # Auto UI + DEFAULT_CHAT_WORKER
#   make add-model TAG=gemma4:12b DEFAULT=1   # UI picker default = this model
#   ./docker/add-model.sh TAG=llama3.2:3b
# Env aliases: MODEL= (same as TAG).
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
Usage: make add-model TAG=<ollama-tag> [AUTO=1|DEFAULT=1]
       ./docker/add-model.sh TAG=<ollama-tag> [AUTO=1|DEFAULT=1]

  Pulls TAG into the Ollama container, appends a LiteLLM model_list row
  (docker/litellm.yaml), and restarts litellm without wiping data.

  TAG / MODEL   Exact Ollama tag (required), e.g. llama3.2:3b, gemma4:12b.
                Hugging Face GGUF: hf.co/org/name or huggingface.co/org/name,
                with an optional quant (:Q4_K_M or /Q4_K_M).
  AUTO=1        Keep UI on spockify-auto; set DEFAULT_CHAT_WORKER (via
                set-chat-worker). Prefer this for Auto routing.
  DEFAULT=1     Use this model as the Open WebUI picker default
                (DEFAULT_MODELS=<model> + DEFAULT_CHAT_WORKER=<model>).
                Leaves Auto as a selectable model, not the UI default.

  Do not pass AUTO=1 and DEFAULT=1 together.
  model_name is the last path segment with ':' → '-' (llama3.2:3b →
  llama3.2-3b). That name is what OWUI lists.

  Sharded GGUF (multi-file *-00001-of-0000N.gguf): one quant, every shard.
  No quant in the tag → the smallest complete sharded quant (N>=2, all
  parts present, lowest total bytes). A suffix such as :Q4_K_M matches
  that id or a hyphen suffix (UD-Q4_K_M). Other quants are not downloaded.
  Ollama 0.34 does not pull hf.co shards. Files land in
  $STORAGE_ROOT/ollama/hf-gguf/<org>/<repo>/<quant>/ (container
  /root/.ollama/hf-gguf/...). ollama create uses Modelfile FROM that
  directory so every shard is in the model. DRY_RUN=1 prints the quant
  and shard filenames only. :cloud tags are refused.

Env:
  SPOCKIFY_CONTAINER_ENGINE  docker|podman (same as run.sh)
  SYNC_CONFIG=1              also append to config/litellm.yaml when present
  DRY_RUN=1                  plan only (no pull, no yaml write, no restart)
  HF_GGUF_LISTING            size<TAB>path file instead of the Hub API
EOF
}

TAG="${TAG:-${MODEL:-}}"
DEFAULT="${DEFAULT:-0}"
AUTO="${AUTO:-0}"
SYNC_CONFIG="${SYNC_CONFIG:-0}"
DRY_RUN="${DRY_RUN:-0}"

for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    TAG=*) TAG="${arg#TAG=}" ;;
    MODEL=*) TAG="${arg#MODEL=}" ;;
    DEFAULT=*) DEFAULT="${arg#DEFAULT=}" ;;
    AUTO=*) AUTO="${arg#AUTO=}" ;;
    SYNC_CONFIG=*) SYNC_CONFIG="${arg#SYNC_CONFIG=}" ;;
    DRY_RUN=*) DRY_RUN="${arg#DRY_RUN=}" ;;
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

DEFAULT_ON=0
case "${DEFAULT}" in
  1|true|yes|YES) DEFAULT_ON=1 ;;
esac
AUTO_ON=0
case "${AUTO}" in
  1|true|yes|YES) AUTO_ON=1 ;;
esac

if [[ "${DEFAULT_ON}" -eq 1 && "${AUTO_ON}" -eq 1 ]]; then
  echo "error: pass AUTO=1 or DEFAULT=1, not both." >&2
  echo "  AUTO=1     → UI stays spockify-auto; worker = ${MODEL_NAME}" >&2
  echo "  DEFAULT=1  → UI picker default = ${MODEL_NAME}" >&2
  exit 1
fi

DRY_ON=0
case "${DRY_RUN}" in
  1|true|yes|YES) DRY_ON=1 ;;
esac

case "${TAG,,}" in
  *:cloud)
    echo "error: refusing :cloud tags; models stay on this machine." >&2
    exit 1
    ;;
esac

REQUEST_TAG="${TAG}"
# Shards go on the compose volume (.env STORAGE_ROOT), not the Spark PVC path.
HF_GGUF_COMPOSE=1
export HF_GGUF_COMPOSE
HF_SHARDS=""
if [[ -f "${ROOT}/scripts/hf-gguf-shards.sh" ]]; then
  HF_SHARDS="${ROOT}/scripts/hf-gguf-shards.sh"
elif [[ -f "${HERE}/../scripts/hf-gguf-shards.sh" ]]; then
  HF_SHARDS="${HERE}/../scripts/hf-gguf-shards.sh"
fi

HF_GGUF=0
if [[ -n "${HF_SHARDS}" ]]; then
  hf_rc=0
  "${HF_SHARDS}" --check --tag "${REQUEST_TAG}" || hf_rc=$?
  if [[ "${hf_rc}" -eq 0 ]]; then
    HF_GGUF=1
  elif [[ "${hf_rc}" -ne 2 ]]; then
    exit "${hf_rc}"
  fi
elif [[ "${TAG,,}" == hf.co/* || "${TAG,,}" == huggingface.co/* || "${TAG,,}" == http://hf.co/* || "${TAG,,}" == https://hf.co/* || "${TAG,,}" == http://huggingface.co/* || "${TAG,,}" == https://huggingface.co/* ]]; then
  echo "error: ${REQUEST_TAG} looks like a Hugging Face repo, but scripts/hf-gguf-shards.sh is missing." >&2
  exit 1
fi

if [[ "${HF_GGUF}" -eq 1 && "${DRY_ON}" -eq 1 ]]; then
  "${HF_SHARDS}" --dry-run --tag "${REQUEST_TAG}"
  exit 0
fi
if [[ "${DRY_ON}" -eq 1 ]]; then
  echo "DRY_RUN: would ollama pull ${TAG}"
  exit 0
fi

if [[ "${HF_GGUF}" -eq 1 ]]; then
  hf_plan="$(mktemp)"
  "${HF_SHARDS}" --print-plan --tag "${REQUEST_TAG}" --plan-out "${hf_plan}"
  # shellcheck disable=SC1090
  source "${hf_plan}"
  rm -f "${hf_plan}"
  TAG="${HF_OLLAMA_TAG}"
  MODEL_NAME="${HF_MODEL_NAME}"
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

if [[ "${HF_GGUF}" -eq 1 ]]; then
  echo "Downloading ${#HF_SHARD_NAMES[@]} shard(s) for quant ${HF_QUANT}..."
  hf_dl="$(mktemp)"
  "${HF_SHARDS}" --download --tag "${REQUEST_TAG}" --plan-out "${hf_dl}"
  # shellcheck disable=SC1090
  source "${hf_dl}"
  rm -f "${hf_dl}"
  TAG="${HF_OLLAMA_TAG}"
  MODEL_NAME="${HF_MODEL_NAME}"
  first="${HF_SHARD_NAMES[0]}"
  if ! compose exec -T ollama test -f "${HF_FROM}/${first}"; then
    echo "error: shard not visible in the ollama container: ${HF_FROM}/${first}" >&2
    echo "  host dir: ${HF_HOST_DIR}" >&2
    echo "  Compose mounts \${STORAGE_ROOT}/ollama at /root/.ollama." >&2
    exit 1
  fi
  echo "Creating ${TAG} from ${HF_FROM} (all shards in that directory)..."
  compose exec -T ollama ollama create "${TAG}" -f "${HF_MODELFILE}"
else
  echo "Pulling ${TAG} inside ollama..."
  compose exec -T ollama ollama pull "${TAG}"
fi

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
  # In-place write: `mv` replaces the inode. Podman/Docker file bind-mounts
  # pin the old inode until recreate, so the running litellm container would
  # keep serving a stale catalog while the host path looks updated.
  cat "${tmp}" > "${file}"
  rm -f "${tmp}"
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
# LiteLLM loads model_list at process start; `up -d` alone does not reload.
# Prefer restart (same project/containers). Fall back to force-recreate.
echo "Restarting litellm to reload model_list (keeps data)..."
if ! compose restart litellm 2>/dev/null; then
  compose up -d --force-recreate litellm 2>/dev/null \
    || compose up -d litellm
fi
if [[ "${DEFAULT_ON}" -eq 1 ]]; then
  # DEFAULT_* are injected at container create time.
  echo "Recreating router + openwebui to pick up .env defaults..."
  compose up -d --force-recreate router openwebui 2>/dev/null \
    || compose up -d router openwebui
fi

# AUTO=1: keep UI on Auto; set chat worker (recreates router/openwebui itself).
if [[ "${AUTO_ON}" -eq 1 ]]; then
  echo "AUTO=1: set-chat-worker MODEL=${MODEL_NAME} (DEFAULT_MODELS stays spockify-auto)..."
  "${HERE}/set-chat-worker.sh" "MODEL=${MODEL_NAME}"
fi

echo
echo "Done."
echo "  Ollama tag:   ${TAG}"
echo "  LiteLLM name: ${MODEL_NAME}"
if [[ "${ADDED_DOCKER}" -eq 0 ]]; then
  echo "  Catalog:      already wired (no yaml change)"
fi
if [[ "${AUTO_ON}" -eq 1 ]]; then
  echo "  Auto worker:  DEFAULT_MODELS=spockify-auto DEFAULT_CHAT_WORKER=${MODEL_NAME}"
elif [[ "${DEFAULT_ON}" -eq 1 ]]; then
  echo "  UI default:   DEFAULT_MODELS=${MODEL_NAME} DEFAULT_CHAT_WORKER=${MODEL_NAME}"
else
  cat <<EOF

Next (pick one):
  make set-chat-worker MODEL=${MODEL_NAME}   # keep UI on Auto; set chat worker
  make add-model TAG=${TAG} AUTO=1           # same, after a future pull
  make add-model TAG=${TAG} DEFAULT=1        # UI picker default = this model
EOF
fi
