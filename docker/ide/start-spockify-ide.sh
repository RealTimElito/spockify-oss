#!/usr/bin/env bash
# One-command Spockify IDE start (Fedora GUI terminal friendly).
# Sets display access, default image tag, and reminds about Tab baseUrl.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
RUN="${HERE}/run.sh"

export SPOCKIFY_IDE_IMAGE="${SPOCKIFY_IDE_IMAGE:-localhost/spockify-ide:local}"
export SPOCKIFY_WORKSPACE="${SPOCKIFY_WORKSPACE:-${ROOT}}"
export SPOCKIFY_BASE_URL="${SPOCKIFY_BASE_URL:-${WEBUI_URL:-http://127.0.0.1:3080}}"

# SSH / tty: adopt the active graphical seat's display if unset.
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  runtime="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  if [[ -S "${runtime}/wayland-0" ]]; then
    export XDG_RUNTIME_DIR="${runtime}"
    export WAYLAND_DISPLAY=wayland-0
  fi
  if [[ -z "${DISPLAY:-}" && -d /tmp/.X11-unix ]]; then
    for sock in /tmp/.X11-unix/X*; do
      [[ -S "${sock}" ]] || continue
      export DISPLAY=":${sock##*/X}"
      break
    done
  fi
  if [[ -z "${XAUTHORITY:-}" ]]; then
    for auth in "${runtime}"/.mutter-Xwaylandauth.* "${HOME}/.Xauthority"; do
      if [[ -f "${auth}" ]]; then
        export XAUTHORITY="${auth}"
        break
      fi
    done
  fi
fi

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "No graphical session (DISPLAY/WAYLAND_DISPLAY empty)." >&2
  echo "Open a GUI terminal on the desktop, then run this again." >&2
  exit 1
fi

# Electron in rootless Podman is more reliable on X11/Xwayland than nested Wayland.
if [[ -n "${DISPLAY:-}" ]]; then
  export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-x11}"
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

# GUI menu entry → ~/bin/spockify-ide (idempotent).
install_desktop_launcher() {
  local bin="${HOME}/bin/spockify-ide"
  local desk_dir="${HOME}/.local/share/applications"
  local desk="${desk_dir}/spockify-ide.desktop"
  mkdir -p "${HOME}/bin" "${desk_dir}"
  if [[ ! -x "${bin}" ]]; then
    cat >"${bin}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
REPO="\${SPOCKIFY_REPO:-${ROOT}}"
export SPOCKIFY_IDE_IMAGE="\${SPOCKIFY_IDE_IMAGE:-localhost/spockify-ide:local}"
export SPOCKIFY_WORKSPACE="\${SPOCKIFY_WORKSPACE:-\$REPO}"
export SPOCKIFY_BASE_URL="\${SPOCKIFY_BASE_URL:-\${WEBUI_URL:-http://127.0.0.1:3080}}"
cd "\$REPO"
exec ./docker/ide/start-spockify-ide.sh "\$@"
EOF
    chmod +x "${bin}"
  fi
  cat >"${desk}" <<EOF
[Desktop Entry]
Name=Spockify IDE
Comment=Spockify IDE (container)
Exec=${bin}
Icon=spockify-ide
Terminal=false
Type=Application
Categories=Development;IDE;
StartupWMClass=spockify-ide
EOF
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${desk_dir}" >/dev/null 2>&1 || true
  fi
}
install_desktop_launcher

echo "Spockify IDE"
echo "  image:     ${SPOCKIFY_IDE_IMAGE}"
echo "  workspace: ${SPOCKIFY_WORKSPACE}"
echo "  display:   DISPLAY=${DISPLAY:-} WAYLAND=${WAYLAND_DISPLAY:-} ozone=${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
echo "  Tab/FIM:   spockify.baseUrl → ${SPOCKIFY_BASE_URL} (compose OWUI)"
echo

chmod +x "${RUN}"
exec "${RUN}" "$@"
