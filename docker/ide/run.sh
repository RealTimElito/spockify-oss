#!/usr/bin/env bash
# Run Spockify IDE in a container on Ubuntu or Fedora (SELinux / Podman).
# Does not use FUSE. Requires a graphical session (X11 or Wayland).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${SPOCKIFY_IDE_IMAGE:-spockify-ide:local}"
WORKSPACE="${SPOCKIFY_WORKSPACE:-${PWD}}"
# Compose Open WebUI (Tab/FIM + settings API). Override for Spark/cloud if needed.
BASE_URL="${SPOCKIFY_BASE_URL:-${WEBUI_URL:-http://127.0.0.1:3080}}"
BASE_URL="${BASE_URL%/}"

usage() {
  cat <<'EOF'
Usage: ./docker/ide/run.sh [--build] [-- extra electron args]

  --build    Build docker/ide/Dockerfile first (downloads AppImage unless
             docker/ide/payload/*.AppImage exists)

Env:
  SPOCKIFY_IDE_IMAGE           Image tag (default spockify-ide:local)
  SPOCKIFY_WORKSPACE           Folder to open (default: current directory)
  SPOCKIFY_CONTAINER_ENGINE    docker|podman (default: Podman if present)
  SPOCKIFY_BASE_URL / WEBUI_URL  Seeded into settings (default http://127.0.0.1:3080)
EOF
}

BUILD=0
PASS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --build) BUILD=1; shift ;;
    --) shift; PASS+=("$@"); break ;;
    *) PASS+=("$1"); shift ;;
  esac
done

ENGINE=()

use_podman_docker_host() {
  local sock="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
  if [[ ! -S "${sock}" ]]; then
    sock="/run/user/$(id -u)/podman/podman.sock"
  fi
  if [[ -S "${sock}" ]]; then
    export DOCKER_HOST="unix://${sock}"
  fi
}

detect_engine() {
  local want="${SPOCKIFY_CONTAINER_ENGINE:-}"
  case "${want}" in
    docker)
      if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        ENGINE=(docker)
        return
      fi
      echo "SPOCKIFY_CONTAINER_ENGINE=docker but docker is not available or the Docker API is unreachable." >&2
      exit 1
      ;;
    podman)
      if command -v podman >/dev/null 2>&1; then
        ENGINE=(podman)
        use_podman_docker_host
        return
      fi
      echo "SPOCKIFY_CONTAINER_ENGINE=podman but podman is not available." >&2
      exit 1
      ;;
    "")
      ;;
    *)
      echo "SPOCKIFY_CONTAINER_ENGINE must be docker or podman (got: ${want})." >&2
      exit 1
      ;;
  esac
  if command -v podman >/dev/null 2>&1; then
    ENGINE=(podman)
    use_podman_docker_host
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ENGINE=(docker)
    return
  fi
  echo "Need podman or docker." >&2
  exit 1
}
detect_engine

if [[ "${BUILD}" -eq 1 ]]; then
  # Prefer a local AppImage so the build does not need Docker→internet.
  if ! ls "${HERE}/payload/"*.AppImage >/dev/null 2>&1; then
    LOCAL_AI=""
    for cand in \
      "${HERE}/../../apps/spockify-ide/build/Spockify-IDE.AppImage" \
      "${HERE}/../../apps/spockify-ide/build/Spockify-IDE-"*"-$(uname -m).AppImage"; do
      if [[ -f "${cand}" ]]; then LOCAL_AI="${cand}"; break; fi
    done
    if [[ -n "${LOCAL_AI}" ]]; then
      echo "Using local AppImage ${LOCAL_AI}"
      cp -f "${LOCAL_AI}" "${HERE}/payload/"
    fi
  fi
  "${ENGINE[@]}" build -t "${IMAGE}" -f "${HERE}/Dockerfile" "${HERE}"
fi

if ! "${ENGINE[@]}" image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "Image ${IMAGE} not found. Run: ./docker/ide/run.sh --build" >&2
  echo "Or: docker pull \$SPOCKIFY_IDE_IMAGE" >&2
  exit 1
fi

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "No graphical session (DISPLAY/WAYLAND_DISPLAY empty)." >&2
  exit 1
fi

if command -v xhost >/dev/null 2>&1 && [[ -n "${DISPLAY:-}" ]]; then
  xhost +SI:localuser:"$(id -un)" >/dev/null 2>&1 || xhost +local: >/dev/null 2>&1 || true
fi

# Host-side writable config (settings panel + device login). Container HOME alone
# is an empty Podman volume and never sees ~/.config/Spockify IDE.
HOST_CFG="${HOME}/.config/Spockify IDE"
HOST_SPOCKIFY_CFG="${HOME}/.config/spockify"
HOST_DATA="${HOME}/.spockify-ide"
HOST_SHARED="${HOME}/.spockify-ide-shared"
mkdir -p "${HOST_CFG}/User" "${HOST_SPOCKIFY_CFG}" "${HOST_DATA}" "${HOST_SHARED}"
SETTINGS_JSON="${HOST_CFG}/User/settings.json"
if [[ ! -f "${SETTINGS_JSON}" ]]; then
  cat >"${SETTINGS_JSON}" <<EOF
{
    "spockify.baseUrl": "${BASE_URL}"
}
EOF
else
  # Ensure baseUrl points at local OWUI when still on cloud default / empty.
  python3 - "${SETTINGS_JSON}" "${BASE_URL}" <<'PY' 2>/dev/null || true
import json, sys
path, base = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        data = json.load(f)
except Exception:
    data = {}
cur = (data.get("spockify.baseUrl") or "").rstrip("/")
if not cur or cur in ("https://spockify.eu", "http://spockify.eu"):
    data["spockify.baseUrl"] = base
    with open(path, "w") as f:
        json.dump(data, f, indent=4)
        f.write("\n")
PY
fi

# :z relabel fails on root-owned trees (e.g. compose data/); skip under Enforcing + label=disable.
WORKSPACE_MOUNT_OPTS=":z"
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce 2>/dev/null || true)" == "Enforcing" ]]; then
  WORKSPACE_MOUNT_OPTS=""
fi

# Relaunch: prior --name spockify-ide blocks Podman/Docker ("name already in use").
"${ENGINE[@]}" rm -f spockify-ide >/dev/null 2>&1 || true

ARGS=(
  run --rm
  --name spockify-ide
  --hostname spockify-ide
  # Host IPC shares /dev/shm; do not also set --shm-size (Podman 5 rejects both).
  --ipc=host
  -e HOME=/home/spockify
  -e ELECTRON_OZONE_PLATFORM_HINT=${ELECTRON_OZONE_PLATFORM_HINT:-auto}
  -e SPOCKIFY_BASE_URL="${BASE_URL}"
  -e WEBUI_URL="${BASE_URL}"
  -v "${WORKSPACE}:/workspace${WORKSPACE_MOUNT_OPTS}"
  -v spockify-ide-home:/home/spockify
  -v "${HOST_CFG}:/home/spockify/.config/Spockify IDE"
  -v "${HOST_SPOCKIFY_CFG}:/home/spockify/.config/spockify"
  -v "${HOST_DATA}:/home/spockify/.spockify-ide"
  -v "${HOST_SHARED}:/home/spockify/.spockify-ide-shared"
)

# Restored windows remember the host path; mirror it so open folders resolve.
if [[ "${WORKSPACE}" != "/workspace" ]]; then
  ARGS+=(-v "${WORKSPACE}:${WORKSPACE}${WORKSPACE_MOUNT_OPTS}")
fi

# Display
if [[ -n "${WAYLAND_DISPLAY:-}" && -n "${XDG_RUNTIME_DIR:-}" && -S "${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY}" ]]; then
  ARGS+=(-e WAYLAND_DISPLAY -e XDG_RUNTIME_DIR -e XDG_SESSION_TYPE=wayland)
  ARGS+=(-v "${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY}:${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY}")
fi
if [[ -n "${DISPLAY:-}" ]]; then
  ARGS+=(-e DISPLAY)
  if [[ -d /tmp/.X11-unix ]]; then
    ARGS+=(-v /tmp/.X11-unix:/tmp/.X11-unix:ro)
  fi
  if [[ -n "${XAUTHORITY:-}" && -f "${XAUTHORITY}" ]]; then
    ARGS+=(-e XAUTHORITY=/tmp/.Xauthority -v "${XAUTHORITY}:/tmp/.Xauthority:ro")
  elif [[ -f "${HOME}/.Xauthority" ]]; then
    ARGS+=(-e XAUTHORITY=/tmp/.Xauthority -v "${HOME}/.Xauthority:/tmp/.Xauthority:ro")
  fi
fi

if [[ -d /dev/dri ]]; then
  ARGS+=(--device /dev/dri)
fi

# Session D-Bus (Electron menus/portals); optional.
if [[ -n "${XDG_RUNTIME_DIR:-}" && -S "${XDG_RUNTIME_DIR}/bus" ]]; then
  ARGS+=(-e DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus")
  ARGS+=(-v "${XDG_RUNTIME_DIR}/bus:${XDG_RUNTIME_DIR}/bus")
fi

# Host network so http://127.0.0.1:3080 inside the container hits compose OWUI.
if [[ "${SPOCKIFY_IDE_HOST_NET:-1}" == "1" ]]; then
  ARGS+=(--network=host)
fi

# Fedora SELinux: X11/Wayland sockets rarely work with MCS :z labels.
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce 2>/dev/null || true)" == "Enforcing" ]]; then
  ARGS+=(--security-opt label=disable)
  echo "SELinux Enforcing: using label=disable for the display sockets (not a sandbox)."
fi

if [[ "${ENGINE[0]}" == "podman" ]]; then
  ARGS+=(--userns=keep-id)
else
  ARGS+=(--user "$(id -u):$(id -g)")
fi

echo "  baseUrl:   ${BASE_URL} (settings + SPOCKIFY_BASE_URL)"
exec "${ENGINE[@]}" "${ARGS[@]}" "${IMAGE}" "${PASS[@]}"
