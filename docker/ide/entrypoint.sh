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
mkdir -p "${HOME}/.config/Spockify IDE/User" "${HOME}/.config/spockify" \
  "${HOME}/.spockify-ide" "${HOME}/.spockify-ide-shared" /workspace
cd /workspace

# Seed baseUrl for settings/Tab when host mount has no settings yet.
SETTINGS="${HOME}/.config/Spockify IDE/User/settings.json"
BASE="${SPOCKIFY_BASE_URL:-${WEBUI_URL:-http://127.0.0.1:3080}}"
BASE="${BASE%/}"
if [[ ! -f "${SETTINGS}" ]]; then
  printf '{\n    "spockify.baseUrl": "%s"\n}\n' "${BASE}" >"${SETTINGS}"
fi

exec /opt/spockify-ide/AppRun \
  --disable-dev-shm-usage \
  "$@"
