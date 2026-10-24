#!/usr/bin/env bash
# Fail-closed production profile checks (no compose up, no cluster APIs).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="${ROOT}/docker/check-production-secrets.sh"
DRILL="${ROOT}/docker/restore-drill.sh"
fail=0

pass() { printf 'ok  %s\n' "$1"; }
bad() { printf 'not ok  %s\n' "$1"; fail=1; }

run_check() {
  env -i PATH="${PATH}" HOME="${HOME}" "$@" bash "${CHECK}" >/tmp/spockify-prod-check.out 2>/tmp/spockify-prod-check.err
}

if env -i PATH="${PATH}" bash "${CHECK}"; then
  pass "non-production is a no-op"
else
  bad "non-production is a no-op"
fi

if run_check SPOCKIFY_PRODUCTION=1 POSTGRES_PASSWORD=x LITELLM_MASTER_KEY=x \
  WEBUI_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx SEARXNG_SECRET=x \
  ENABLE_SIGNUP=false SPOCKIFY_API_BIND=127.0.0.1 SPOCKIFY_ROUTER_BIND=127.0.0.1 \
  SPOCKIFY_ISOLATED_RUNNER=bwrap; then
  bad "unpinned :latest ollama/searxng must fail"
else
  pass "unpinned :latest ollama/searxng must fail"
fi

if run_check SPOCKIFY_PRODUCTION=1 POSTGRES_PASSWORD=real-secret-not-placeholder \
  LITELLM_MASTER_KEY=sk-real-not-placeholder \
  WEBUI_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  SEARXNG_SECRET=real-searx-secret ENABLE_SIGNUP=false \
  SPOCKIFY_API_BIND=127.0.0.1 SPOCKIFY_ROUTER_BIND=127.0.0.1; then
  bad "production without isolated runner must fail"
else
  pass "production without isolated runner must fail"
fi

if run_check SPOCKIFY_PRODUCTION=1 POSTGRES_PASSWORD=real-secret-not-placeholder \
  LITELLM_MASTER_KEY=sk-real-not-placeholder \
  WEBUI_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  SEARXNG_SECRET=real-searx-secret ENABLE_SIGNUP=false \
  SPOCKIFY_API_BIND=127.0.0.1 SPOCKIFY_ROUTER_BIND=127.0.0.1 \
  SPOCKIFY_ISOLATED_RUNNER=none; then
  bad "production with isolated runner=none must fail"
else
  pass "production with isolated runner=none must fail"
fi

FAKE='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
HOST_ISO="$(mktemp /tmp/spockify-host-iso.XXXXXX)"
if run_check SPOCKIFY_PRODUCTION=1 POSTGRES_PASSWORD=real-secret-not-placeholder \
  LITELLM_MASTER_KEY=sk-real-not-placeholder \
  WEBUI_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  SEARXNG_SECRET=real-searx-secret ENABLE_SIGNUP=false \
  SPOCKIFY_API_BIND=127.0.0.1 SPOCKIFY_ROUTER_BIND=127.0.0.1 \
  SPOCKIFY_ISOLATED_RUNNER=bwrap \
  SPOCKIFY_HOST_ISOLATION_ENV="${HOST_ISO}" \
  SPOCKIFY_SEARXNG_IMAGE="docker.io/searxng/searxng@${FAKE}" \
  SPOCKIFY_OLLAMA_IMAGE="docker.io/ollama/ollama@${FAKE}" \
  SPOCKIFY_ROUTER_IMAGE=spockify-router:local \
  SPOCKIFY_OPENWEBUI_IMAGE=spockify-openwebui:local; then
  if grep -q 'SPOCKIFY_PRODUCTION=1' "${HOST_ISO}" && \
     grep -q 'SPOCKIFY_ISOLATED_RUNNER=bwrap' "${HOST_ISO}"; then
    pass "loopback + isolated runner + digest/local images"
    pass "production exports host isolation env"
  else
    bad "production host isolation env missing keys"
    cat "${HOST_ISO}" >&2 || true
  fi
else
  bad "loopback + isolated runner + digest/local images"
  cat /tmp/spockify-prod-check.err >&2 || true
fi
rm -f "${HOST_ISO}"

chmod +x "${DRILL}" "${ROOT}/docker/record-image-digests.sh" 2>/dev/null || true
if bash "${DRILL}" --dry-run >/tmp/spockify-drill.out; then
  if grep -q 'status: dry-run' /tmp/spockify-drill.out; then
    pass "restore drill dry-run"
  else
    bad "restore drill dry-run missing status"
  fi
else
  bad "restore drill dry-run"
fi

if [[ "${SPOCKIFY_RESTORE_DRILL_LIVE:-}" == "1" ]]; then
  if bash "${DRILL}" --synthetic >/tmp/spockify-drill-live.out 2>/tmp/spockify-drill-live.err; then
    if grep -q 'status: pass' /tmp/spockify-drill-live.out; then
      pass "restore drill synthetic"
    else
      bad "restore drill synthetic missing pass"
      cat /tmp/spockify-drill-live.err >&2 || true
    fi
  else
    bad "restore drill synthetic"
    cat /tmp/spockify-drill-live.err >&2 || true
  fi
else
  echo "restore drill synthetic skipped (set SPOCKIFY_RESTORE_DRILL_LIVE=1)"
fi

if [[ "${fail}" -ne 0 ]]; then
  echo "production-profile tests failed" >&2
  exit 1
fi
echo "production-profile tests: ok"
