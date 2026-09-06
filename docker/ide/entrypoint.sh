#!/bin/bash
# Launch extracted Spockify IDE (AppRun already passes --no-sandbox).
set -euo pipefail

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "No DISPLAY or WAYLAND_DISPLAY. This is a GUI app — pass the host socket." >&2
  echo "Use ./docker/ide/run.sh from a graphical session." >&2
  exit 1
fi

export HOME="${HOME:-/home/spockify}"
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
mkdir -p "${HOME}" /workspace
cd /workspace

exec /opt/spockify-ide/AppRun \
  --disable-dev-shm-usage \
  "$@"
