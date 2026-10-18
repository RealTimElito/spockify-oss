#!/usr/bin/env bash
# Record compose image pins as name@sha256:… from images already on this host.
# Does not pull, apply, or talk to Kubernetes. Writes stdout; optional --write FILE.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRITE=""
RUNTIME=""

usage() {
  cat <<'EOF'
Record digest pins for the production compose profile.

  docker/record-image-digests.sh [--write FILE]

Looks up local images (podman or docker inspect). Does not pull and does not
mutate running stacks. Copy the printed SPOCKIFY_*_IMAGE= lines into .env
(or --write .env.pin) before SPOCKIFY_PRODUCTION=1.

:latest is refused by docker/check-production-secrets.sh for that profile.
Tree builds may keep SPOCKIFY_ROUTER_IMAGE=spockify-router:local.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --write)
      WRITE="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
  RUNTIME=podman
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  RUNTIME=docker
else
  echo "record-image-digests: no podman/docker engine available" >&2
  exit 1
fi

digest_of() {
  local ref="$1" id repo
  id="$("${RUNTIME}" image inspect --format '{{.Id}}' "${ref}" 2>/dev/null || true)"
  if [[ -z "${id}" ]]; then
    return 1
  fi
  repo="$("${RUNTIME}" image inspect --format '{{index .RepoDigests 0}}' "${ref}" 2>/dev/null || true)"
  if [[ "${repo}" == *@sha256:* ]]; then
    printf '%s\n' "${repo}"
    return 0
  fi
  # Local/built images often have no RepoDigest. Pin by image id.
  if [[ "${id}" == sha256:* ]]; then
    printf '%s@%s\n' "${ref%%@*}" "${id}"
    return 0
  fi
  return 1
}

emit() {
  local name="$1" fallback="$2" pinned
  if pinned="$(digest_of "${fallback}")"; then
    printf '%s=%s\n' "${name}" "${pinned}"
  else
    printf '# %s unset — image %s is not on this host. Pull it, then re-run.\n' "${name}" "${fallback}"
  fi
}

# Load .env so already-set refs win as inspect targets.
if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

OUT="$(mktemp)"
{
  echo "# Generated $(date '+%Y-%m-%d %H:%M:%S %z') by docker/record-image-digests.sh (${RUNTIME})"
  echo "# Production profile: copy into .env. Unpinned :latest is refused."
  emit SPOCKIFY_POSTGRES_IMAGE "${SPOCKIFY_POSTGRES_IMAGE:-postgres:17-alpine}"
  emit SPOCKIFY_SEARXNG_IMAGE "${SPOCKIFY_SEARXNG_IMAGE:-docker.io/searxng/searxng:latest}"
  emit SPOCKIFY_OLLAMA_IMAGE "${SPOCKIFY_OLLAMA_IMAGE:-docker.io/ollama/ollama:latest}"
  emit SPOCKIFY_LITELLM_IMAGE "${SPOCKIFY_LITELLM_IMAGE:-ghcr.io/berriai/litellm:main-v1.79.3-stable}"
  if [[ "${SPOCKIFY_ROUTER_IMAGE:-spockify-router:local}" == *:local ]]; then
    echo "SPOCKIFY_ROUTER_IMAGE=${SPOCKIFY_ROUTER_IMAGE:-spockify-router:local}"
  else
    emit SPOCKIFY_ROUTER_IMAGE "${SPOCKIFY_ROUTER_IMAGE}"
  fi
  if [[ "${SPOCKIFY_OPENWEBUI_IMAGE:-spockify-openwebui:local}" == *:local ]]; then
    echo "SPOCKIFY_OPENWEBUI_IMAGE=${SPOCKIFY_OPENWEBUI_IMAGE:-spockify-openwebui:local}"
  else
    emit SPOCKIFY_OPENWEBUI_IMAGE "${SPOCKIFY_OPENWEBUI_IMAGE}"
  fi
} >"${OUT}"

cat "${OUT}"
if [[ -n "${WRITE}" ]]; then
  cp "${OUT}" "${WRITE}"
  echo "wrote ${WRITE}" >&2
fi
rm -f "${OUT}"
