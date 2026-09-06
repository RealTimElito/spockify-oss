#!/usr/bin/env bash
# One-command Spockify IDE start (Fedora GUI terminal friendly).
# Sets display access, default image tag, and reminds about Tab baseUrl.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
RUN="${HERE}/run.sh"

export SPOCKIFY_IDE_IMAGE="${SPOCKIFY_IDE_IMAGE:-localhost/spockify-ide:local}"
export SPOCKIFY_WORKSPACE="${SPOCKIFY_WORKSPACE:-${ROOT}}"

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "No graphical session (DISPLAY/WAYLAND_DISPLAY empty)." >&2
  echo "Open a GUI terminal on the desktop, then run this again." >&2
  exit 1
fi

if command -v xhost >/dev/null 2>&1 && [[ -n "${DISPLAY:-}" ]]; then
  xhost +SI:localuser:"$(id -un)" >/dev/null 2>&1 || xhost +local: >/dev/null 2>&1 || true
fi

# Prefer a local image; fall back to plain spockify-ide:local if localhost/ missing.
ENGINE=()
if command -v podman >/dev/null 2>&1; then
  ENGINE=(podman)
elif command -v docker >/dev/null 2>&1; then
  ENGINE=(docker)
fi
if [[ "${#ENGINE[@]}" -gt 0 ]]; then
  if ! "${ENGINE[@]}" image inspect "${SPOCKIFY_IDE_IMAGE}" >/dev/null 2>&1; then
    if "${ENGINE[@]}" image inspect spockify-ide:local >/dev/null 2>&1; then
      export SPOCKIFY_IDE_IMAGE=spockify-ide:local
    else
      echo "No IDE image yet — building ${SPOCKIFY_IDE_IMAGE} (0.9.16 AppImage)…"
      # run.sh --build tags SPOCKIFY_IDE_IMAGE
      set -- --build "$@"
    fi
  fi
fi

echo "Spockify IDE"
echo "  image:     ${SPOCKIFY_IDE_IMAGE}"
echo "  workspace: ${SPOCKIFY_WORKSPACE}"
echo "  Tab/FIM:   set spockify.baseUrl to http://localhost:3080 (compose OWUI)"
echo

chmod +x "${RUN}"
exec "${RUN}" "$@"
