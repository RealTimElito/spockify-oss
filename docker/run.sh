#!/usr/bin/env bash
# Start Spockify with Docker Compose or Podman. Works on Ubuntu and Fedora (SELinux).
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

usage() {
  cat <<'EOF'
Usage: ./docker/run.sh [up|down|logs|pull-model|status] [--gpu] [--demo [profile]] [--build]

  up          Start the stack (default). Pulls GHCR images when possible.
              Starts model download in the background
              (default: llama3.2:3b llama3.1:8b codestral — ~8–12 GiB VRAM).
  down        Stop containers (keeps ./data)
  logs        Follow all service logs
  pull-model  Re-run the model pull (same tags as up)
  status      compose ps
  --gpu       Apply docker-compose.gpu.yml (Docker). On Podman: classic
              /dev/nvidia* devices by default; CDI (nvidia.com/gpu=all) only
              when proven resolvable (nvidia-ctk list + podman probe).
              Aborts if neither works. After up, verifies nvidia-smi inside
              Ollama and self-heals (strip CDI → devices; SELinux) when possible.
  --demo [profile]
              Apply docker-compose.demo.yml (default profile: security).
              Authorized scoped security assessments for spockify-auto —
              NOT unfiltered / jailbreak mode. Rebuilds the router image when
              local services/router source is present so prompt injection works.
  --build     Rebuild router and Open WebUI even if local images exist

Env:
  SPOCKIFY_CONTAINER_ENGINE  docker|podman (default: Podman if compose works)
  SPOCKIFY_PODMAN_GPU        cdi|devices (Podman --gpu; default: devices unless
                             CDI is proven resolvable; forced cdi aborts if not)
  SPOCKIFY_DEMO_PROFILE      demo profile name (set by --demo; default security)
  OLLAMA_PULL_MODELS         override default pull list (space-separated)
EOF
}

# Default Ollama tags for compose (keep in sync with docker-compose.yml).
DEFAULT_OLLAMA_PULL_MODELS="llama3.2:3b llama3.1:8b codestral"

# shellcheck disable=SC1091
source "${HERE}/engine.sh"

image_exists() {
  local img="$1"
  [[ -n "${img}" ]] || return 1
  "$(runtime_bin)" image inspect "${img}" >/dev/null 2>&1
}

ghcr_prefix_from_git() {
  local url owner
  url="$(git -C "${ROOT}" remote get-url origin 2>/dev/null || true)"
  [[ -n "${url}" ]] || return 1
  owner="$(printf '%s\n' "${url}" | sed -nE 's#.*github.com[:/]([^/]+)/.*#\1#p')"
  [[ -n "${owner}" ]] || return 1
  printf 'ghcr.io/%s\n' "${owner,,}"
}

# Pull published images so Fedora/Podman does not have to run Vite in-container.
pull_ghcr_images() {
  local prefix tag router owui rt
  prefix="${SPOCKIFY_IMAGE_PREFIX:-}"
  tag="${SPOCKIFY_IMAGE_TAG:-latest}"
  if [[ -z "${prefix}" ]]; then
    prefix="$(ghcr_prefix_from_git || true)"
  fi
  [[ -n "${prefix}" ]] || return 1
  router="${SPOCKIFY_ROUTER_IMAGE:-${prefix}/spockify-router:${tag}}"
  owui="${SPOCKIFY_OPENWEBUI_IMAGE:-${prefix}/spockify-openwebui:${tag}}"
  rt="$(runtime_bin)"
  echo "Pulling ${router} and ${owui} (skips a local Open WebUI npm build)..."
  if "${rt}" pull "${router}" && "${rt}" pull "${owui}"; then
    export SPOCKIFY_ROUTER_IMAGE="${router}"
    export SPOCKIFY_OPENWEBUI_IMAGE="${owui}"
    return 0
  fi
  return 1
}

storage_root() {
  printf '%s\n' "${STORAGE_ROOT:-${ROOT}/data/spockify}"
}

# Host binds for Ollama / Open WebUI only. Never chown — rootless Podman
# cannot recursively chown those paths (EPERM). Do not add :U in compose.
# Postgres on Podman is a named volume (see docker-compose.podman.yml).
prepare_data_dirs() {
  local root
  root="$(storage_root)"
  mkdir -p "${root}/ollama" "${root}/openwebui"
  if ! using_podman; then
    mkdir -p "${root}/postgres"
  fi
}

selinux_hint() {
  if command -v getenforce >/dev/null 2>&1; then
    local mode root
    mode="$(getenforce 2>/dev/null || true)"
    root="$(storage_root)"
    if [[ "${mode}" == "Enforcing" ]]; then
      echo "SELinux is Enforcing — compose bind mounts already use :z."
      mkdir -p "${root}"
      if command -v chcon >/dev/null 2>&1; then
        chcon -Rt container_file_t "${root}" 2>/dev/null || true
        echo "If a volume is Permission denied: sudo chcon -Rt container_file_t ${root}"
      fi
    fi
  fi
}

load_env() {
  if [[ -f "${ROOT}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${ROOT}/.env"
    set +a
  fi
}

# Host sessions (esp. SSH / non-desktop) often leave XDG_* unset. NVIDIA CDI
# specs and nvidia-ctk may reference ${XDG_CONFIG_HOME}; unset vars print noisy
# "variable … not found" warnings during device resolution. Harmless if
# nvidia-smi works in the container — export defaults before Podman GPU up.
ensure_xdg_defaults() {
  export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
  export XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${HOME}/.cache}"
}

# OLLAMA_LLM_LIBRARY must be a real runner (cuda_v12, cpu, …), never "gpu".
sanitize_ollama_llm_library() {
  case "${OLLAMA_LLM_LIBRARY:-}" in
    gpu|gpou|GPU|GPOU)
      echo "WARNING: OLLAMA_LLM_LIBRARY=${OLLAMA_LLM_LIBRARY} is invalid — unsetting (autodetect)." >&2
      unset OLLAMA_LLM_LIBRARY
      ;;
  esac
}

wait_http() {
  local url="$1" name="$2" tries="${3:-90}"
  local i=0
  echo "Waiting for ${name} at ${url}..."
  until curl -fsS "${url}" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "${i}" -ge "${tries}" ]]; then
      echo "${name} did not become ready. Recent logs:" >&2
      "${ENGINE[@]}" "${FILES[@]}" logs --tail=80 "${name}" >&2 || true
      return 1
    fi
    sleep 2
  done
}

print_podman_gpu_cdi_setup() {
  cat >&2 <<'EOF'
Fedora / Podman NVIDIA setup (once):
  sudo dnf install -y nvidia-container-toolkit
  sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
  sudo nvidia-ctk runtime configure --runtime=podman
  sudo systemctl --user restart podman.socket
  nvidia-ctk cdi list    # expect nvidia.com/gpu=all
  sudo setsebool -P container_use_devices on
  # then: make down && make gpu
EOF
}

# nvidia-ctk lists a concrete GPU device (not "file exists" — that was a false positive).
podman_cdi_lists_gpu() {
  if ! command -v nvidia-ctk >/dev/null 2>&1; then
    return 1
  fi
  nvidia-ctk cdi list 2>/dev/null | grep -Eq 'nvidia\.com/gpu=(all|[0-9]+)'
}

# Pick a local image for a cheap CDI resolve probe (avoid pulls when possible).
podman_cdi_probe_image() {
  local rt img
  rt="$(runtime_bin)"
  for img in \
    docker.io/library/alpine:3.20 \
    alpine:3.20 \
    docker.io/nvidia/cuda:12.3.1-base-ubuntu22.04 \
    docker.io/ollama/ollama:latest; do
    if "${rt}" image exists "${img}" >/dev/null 2>&1; then
      printf '%s\n' "${img}"
      return 0
    fi
  done
  # Last resort — tiny pull if nothing local.
  printf '%s\n' "docker.io/library/alpine:3.20"
}

# Prove Podman can resolve nvidia.com/gpu=all (or =0). Listing alone is not enough.
podman_cdi_probe_resolvable() {
  local rt device img out
  rt="$(runtime_bin)"
  ensure_xdg_defaults
  device="nvidia.com/gpu=all"
  if ! nvidia-ctk cdi list 2>/dev/null | grep -Eq 'nvidia\.com/gpu=all'; then
    if nvidia-ctk cdi list 2>/dev/null | grep -Eq 'nvidia\.com/gpu=0'; then
      device="nvidia.com/gpu=0"
    fi
  fi
  img="$(podman_cdi_probe_image)"
  # Create+rm is enough to catch "unresolvable CDI"; no nvidia-smi required.
  if out="$("${rt}" run --rm --device "${device}" "${img}" true 2>&1)"; then
    return 0
  fi
  if printf '%s\n' "${out}" | grep -Eiq 'unresolvable CDI|nvidia\.com/gpu'; then
    echo "CDI probe failed (${device}): Podman cannot resolve the device." >&2
  else
    echo "CDI probe failed (${device}): ${out}" >&2
  fi
  return 1
}

# True only when CDI is proven resolvable (list + live podman probe).
# Never treat "yaml file exists" as success — that caused Fedora false positives.
podman_cdi_nvidia_resolvable() {
  if ! podman_cdi_lists_gpu; then
    return 1
  fi
  if ! podman_cdi_probe_resolvable; then
    return 1
  fi
  return 0
}

# Back-compat name used by host checks / heal paths.
podman_cdi_nvidia_available() {
  podman_cdi_nvidia_resolvable
}

# True when any compose -f file still requests nvidia.com/gpu=*.
compose_files_request_cdi_gpu() {
  local f
  for f in "${FILES[@]}"; do
    [[ "${f}" == "-f" ]] && continue
    [[ -f "${f}" ]] || continue
    if grep -Eq 'nvidia\.com/gpu=(all|[0-9]+)' "${f}" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

# Host NVIDIA character devices suitable for a classic Podman devices: mount.
collect_host_nvidia_devices() {
  local d
  # Multi-GPU: /dev/nvidia0, /dev/nvidia1, ...
  for d in /dev/nvidia[0-9]*; do
    [[ -e "${d}" ]] && printf '%s\n' "${d}"
  done
  for d in /dev/nvidiactl /dev/nvidia-uvm /dev/nvidia-uvm-tools /dev/nvidia-modeset; do
    [[ -e "${d}" ]] && printf '%s\n' "${d}"
  done
  for d in /dev/nvidia-caps/nvidia-cap*; do
    [[ -e "${d}" ]] && printf '%s\n' "${d}"
  done
  # Optional DRI for some driver stacks.
  for d in /dev/dri/card* /dev/dri/renderD*; do
    [[ -e "${d}" ]] && printf '%s\n' "${d}"
  done
}

host_has_nvidia_gpu_nodes() {
  local d
  for d in /dev/nvidia[0-9]*; do
    [[ -e "${d}" ]] && return 0
  done
  return 1
}

# Write a compose overlay that only mounts devices present on this host.
write_podman_devices_overlay() {
  local out="$1"
  local -a devs=()
  local d
  mapfile -t devs < <(collect_host_nvidia_devices)
  if [[ "${#devs[@]}" -eq 0 ]]; then
    return 1
  fi
  {
    cat <<'YAML'
# Generated by docker/run.sh — do not commit. Only host devices that exist.
name: spockify

services:
  ollama:
    devices:
YAML
    for d in "${devs[@]}"; do
      printf '      - %s:%s\n' "${d}" "${d}"
    done
    cat <<'YAML'
    environment:
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: compute,utility
      OLLAMA_FLASH_ATTENTION: "1"
YAML
  } >"${out}"
}

# Apply classic /dev/nvidia* overlay (generated or template).
append_podman_gpu_devices_overlay() {
  local generated="${ROOT}/.spockify-gpu-devices.generated.yml"
  local devices_tmpl=""
  if [[ -f "${ROOT}/docker-compose.gpu.podman.devices.yml" ]]; then
    devices_tmpl="${ROOT}/docker-compose.gpu.podman.devices.yml"
  elif [[ -f "${ROOT}/compose.gpu.podman.devices.yml" ]]; then
    devices_tmpl="${ROOT}/compose.gpu.podman.devices.yml"
  fi
  if write_podman_devices_overlay "${generated}"; then
    echo "Wrote ${generated} (only devices present on this host)."
    FILES+=(-f "${generated}")
  elif [[ -n "${devices_tmpl}" ]]; then
    echo "Using template ${devices_tmpl} (generation skipped)."
    FILES+=(-f "${devices_tmpl}")
  else
    echo "ERROR: /dev/nvidia* present but no devices overlay template." >&2
    exit 1
  fi
}

# Podman --gpu: CDI only when proven resolvable; else classic /dev/nvidia*; else abort.
# Default when unsure: devices (not CDI). Force: SPOCKIFY_PODMAN_GPU=devices|cdi.
append_podman_gpu_overlay() {
  ensure_xdg_defaults

  local force_mode="${SPOCKIFY_PODMAN_GPU:-}"
  force_mode="${force_mode,,}"
  local want_cdi=0
  local want_devices=0
  local cdi_ok=0

  if podman_cdi_nvidia_resolvable; then
    cdi_ok=1
  fi

  case "${force_mode}" in
    devices) want_devices=1 ;;
    cdi) want_cdi=1 ;;
    "")
      # Default: devices unless CDI is proven. Fedora often lists/files CDI
      # that Podman still cannot resolve.
      if [[ "${cdi_ok}" -eq 1 ]]; then
        want_cdi=1
      else
        want_devices=1
      fi
      ;;
    *)
      echo "ERROR: SPOCKIFY_PODMAN_GPU must be cdi or devices (got: ${SPOCKIFY_PODMAN_GPU})." >&2
      exit 1
      ;;
  esac

  if [[ "${want_cdi}" -eq 1 ]]; then
    if [[ "${cdi_ok}" -ne 1 ]]; then
      echo "ERROR: SPOCKIFY_PODMAN_GPU=cdi but NVIDIA CDI is not resolvable." >&2
      print_podman_gpu_cdi_setup >&2
      if host_has_nvidia_gpu_nodes; then
        echo "Tip: omit the force, or SPOCKIFY_PODMAN_GPU=devices make gpu" >&2
      fi
      exit 1
    fi
    if [[ "${force_mode}" == "cdi" ]]; then
      echo "GPU (Podman): SPOCKIFY_PODMAN_GPU=cdi — nvidia.com/gpu=all overlay."
    else
      echo "GPU (Podman): CDI proven resolvable — using nvidia.com/gpu=all overlay."
    fi
    if [[ -f "${ROOT}/docker-compose.gpu.podman.yml" ]]; then
      FILES+=(-f docker-compose.gpu.podman.yml)
    elif [[ -f "${ROOT}/compose.gpu.podman.yml" ]]; then
      FILES+=(-f compose.gpu.podman.yml)
    else
      echo "ERROR: CDI is resolvable but docker-compose.gpu.podman.yml is missing." >&2
      exit 1
    fi
    PODMAN_GPU_ACTIVE_MODE=cdi
    return 0
  fi

  if [[ "${want_devices}" -eq 1 ]] && host_has_nvidia_gpu_nodes; then
    if [[ "${force_mode}" == "devices" ]]; then
      echo "GPU (Podman): SPOCKIFY_PODMAN_GPU=devices — classic /dev/nvidia* overlay."
    else
      cat <<'EOF'
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
GPU (Podman): CDI not proven resolvable — using classic /dev/nvidia* devices.
(Default on Fedora unless nvidia-ctk list + podman --device probe both succeed.)
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
EOF
    fi
    append_podman_gpu_devices_overlay
    if compose_files_request_cdi_gpu; then
      echo "ERROR: devices path still has nvidia.com/gpu in compose files — refusing." >&2
      exit 1
    fi
    PODMAN_GPU_ACTIVE_MODE=devices
    return 0
  fi

  if [[ "${want_devices}" -eq 1 ]]; then
    echo "ERROR: SPOCKIFY_PODMAN_GPU=devices but no /dev/nvidia* on host." >&2
    exit 1
  fi


  cat >&2 <<'EOF'

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
ERROR: --gpu with Podman, but no resolvable NVIDIA CDI and no /dev/nvidia*.
Refusing to start — Ollama would run on CPU and feel very slow.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

If you see: Unresolvable cdi devices nvidia.com/gpu=all
CDI specs are missing or not usable by Podman. Prefer devices:

  SPOCKIFY_PODMAN_GPU=devices make gpu

Or install/generate CDI:

EOF
  print_podman_gpu_cdi_setup >&2
  cat >&2 <<'EOF'

Also confirm the driver created nodes: ls -l /dev/nvidia0 /dev/nvidiactl
Without a working NVIDIA driver, make gpu cannot help.

EOF
  exit 1
}

# Passwordless sudo only (never prompt). Returns 1 if sudo needs a password.
sudo_n() {
  if ! command -v sudo >/dev/null 2>&1; then
    return 1
  fi
  if ! sudo -n true >/dev/null 2>&1; then
    return 1
  fi
  sudo -n "$@"
}

host_nvidia_visible() {
  if host_has_nvidia_gpu_nodes; then
    return 0
  fi
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# Host / toolkit / CDI preflight (informational; does not abort).
print_gpu_host_checks() {
  echo "GPU host checks:"
  if host_has_nvidia_gpu_nodes; then
    echo "  /dev/nvidia*: present"
  elif command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    echo "  /dev/nvidia*: missing nodes, but host nvidia-smi works"
  else
    echo "  /dev/nvidia* / nvidia-smi: NOT found on host" >&2
  fi
  if command -v nvidia-ctk >/dev/null 2>&1; then
    echo "  nvidia-ctk: $(command -v nvidia-ctk)"
  else
    echo "  nvidia-ctk: not installed"
  fi
  if podman_cdi_lists_gpu; then
    if podman_cdi_nvidia_resolvable; then
      echo "  CDI nvidia.com/gpu: listed + probe OK"
    else
      echo "  CDI nvidia.com/gpu: listed but NOT resolvable (will use /dev/nvidia*)"
    fi
  else
    echo "  CDI nvidia.com/gpu: not listed (default: /dev/nvidia* devices)"
  fi
  if command -v getenforce >/dev/null 2>&1; then
    echo "  SELinux: $(getenforce 2>/dev/null || echo unknown)"
  fi
}

# Quiet: 0 if nvidia-smi works inside ollama. Sets _OLLAMA_NVIDIA_SMI_OUT.
ollama_container_nvidia_smi() {
  local rt out=""
  rt="$(runtime_bin)"
  _OLLAMA_NVIDIA_SMI_OUT=""
  if using_podman; then
    local cid
    cid="$("${rt}" ps -qf name=ollama | head -1 || true)"
    if [[ -z "${cid}" ]]; then
      return 1
    fi
    if out="$("${rt}" exec "${cid}" nvidia-smi 2>&1)"; then
      _OLLAMA_NVIDIA_SMI_OUT="${out}"
      return 0
    fi
    return 1
  fi
  if out="$(compose exec -T ollama nvidia-smi 2>&1)"; then
    _OLLAMA_NVIDIA_SMI_OUT="${out}"
    return 0
  fi
  return 1
}

print_gpu_ok() {
  if [[ -n "${_OLLAMA_NVIDIA_SMI_OUT:-}" ]]; then
    echo "${_OLLAMA_NVIDIA_SMI_OUT}" | head -n 12
  fi
  echo "GPU OK: nvidia-smi works in the ollama container."
}

# Optional: warn if a loaded model shows CPU-only (empty ps is fine — no chat required).
warn_ollama_ps_cpu() {
  local rt out=""
  rt="$(runtime_bin)"
  if using_podman; then
    local cid
    cid="$("${rt}" ps -qf name=ollama | head -1 || true)"
    [[ -n "${cid}" ]] || return 0
    out="$("${rt}" exec "${cid}" ollama ps 2>/dev/null || true)"
  else
    out="$(compose exec -T ollama ollama ps 2>/dev/null || true)"
  fi
  [[ -n "${out}" ]] || return 0
  if printf '%s\n' "${out}" | grep -Eqi '100%[[:space:]]*CPU|[[:space:]]CPU[[:space:]]*$'; then
    echo "WARNING: ollama ps looks CPU-only — chat may still be slow:" >&2
    printf '%s\n' "${out}" >&2
  else
    echo "ollama ps (optional):"
    printf '%s\n' "${out}" | head -n 8
  fi
}

try_regenerate_nvidia_cdi() {
  if ! command -v nvidia-ctk >/dev/null 2>&1; then
    echo "Self-heal: nvidia-ctk missing — cannot regenerate CDI."
    return 1
  fi
  ensure_xdg_defaults
  echo "Self-heal: trying passwordless CDI regenerate..."
  if sudo_n mkdir -p /etc/cdi \
    && sudo_n nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml; then
    echo "Self-heal: wrote /etc/cdi/nvidia.yaml"
    return 0
  fi
  echo "Self-heal: sudo needed for CDI. Run exactly:" >&2
  echo "  sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml" >&2
  return 1
}

try_selinux_container_use_devices() {
  if ! command -v getenforce >/dev/null 2>&1; then
    return 1
  fi
  local mode
  mode="$(getenforce 2>/dev/null || true)"
  if [[ "${mode}" != "Enforcing" ]]; then
    return 1
  fi
  echo "Self-heal: SELinux Enforcing — trying container_use_devices..."
  if sudo_n setsebool -P container_use_devices on; then
    echo "Self-heal: setsebool -P container_use_devices on"
    return 0
  fi
  echo "Self-heal: sudo needed for SELinux. Run exactly:" >&2
  echo "  sudo setsebool -P container_use_devices on" >&2
  return 1
}

# Rebuild FILES from current GPU/Podman/demo env (used after SPOCKIFY_PODMAN_GPU changes).
init_compose_files() {
  FILES=(-f docker-compose.yml)
  if [[ ! -d "${ROOT}/services/router" ]]; then
    if [[ -f "${ROOT}/docker-compose.yml" ]]; then
      FILES=(-f docker-compose.yml)
    elif [[ -f "${ROOT}/compose.pull.yml" ]]; then
      FILES=(-f compose.pull.yml)
    fi
  fi
  if [[ "${GPU}" -eq 1 ]]; then
    if [[ -f "${ROOT}/docker-compose.gpu.yml" ]]; then
      FILES+=(-f docker-compose.gpu.yml)
    elif [[ -f "${ROOT}/compose.gpu.yml" ]]; then
      FILES+=(-f compose.gpu.yml)
    fi
  fi
  if [[ -n "${DEMO_PROFILE}" ]]; then
    export SPOCKIFY_DEMO_PROFILE="${DEMO_PROFILE}"
    if [[ -f "${ROOT}/docker-compose.demo.yml" ]]; then
      FILES+=(-f docker-compose.demo.yml)
    elif [[ -f "${ROOT}/compose.demo.yml" ]]; then
      FILES+=(-f compose.demo.yml)
    else
      echo "WARNING: --demo set but no docker-compose.demo.yml found" >&2
    fi
  fi
  if using_podman && [[ -f "${ROOT}/docker-compose.podman.yml" ]]; then
    FILES+=(-f docker-compose.podman.yml)
    export SPOCKIFY_PGDATA="${SPOCKIFY_PGDATA:-spockify_pgdata}"
  fi
  PODMAN_GPU_ACTIVE_MODE=""
  if [[ "${GPU}" -eq 1 ]]; then
    ensure_xdg_defaults
  fi
  if [[ "${GPU}" -eq 1 ]] && using_podman; then
    append_podman_gpu_overlay
  fi
}

gpu_stack_reup() {
  echo "Self-heal: compose down + up (keeps ./data; no CLEAN_DATA)..."
  compose down || true
  compose_up
  sleep 3
}

print_gpu_failure_checklist() {
  cat >&2 <<'EOF'

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
ERROR: nvidia-smi still FAILED inside the ollama container after self-heal.
Inference is almost certainly on CPU — chat will feel very slow.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

Checklist (run what print above asked for, then: make down && make gpu):
  1. Host GPU:     ls -l /dev/nvidia0 /dev/nvidiactl && nvidia-smi
  2. Toolkit:      sudo dnf install -y nvidia-container-toolkit   # or apt
  3. CDI:          sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
                   sudo nvidia-ctk runtime configure --runtime=podman
                   nvidia-ctk cdi list    # expect nvidia.com/gpu=all
  4. SELinux:      sudo setsebool -P container_use_devices on
  5. Devices path: SPOCKIFY_PODMAN_GPU=devices make gpu
  6. Docker:       install nvidia-container-toolkit, restart dockerd, remake gpu

Do NOT wipe models: avoid make clean CLEAN_DATA=1 for this.

Host smoke (CDI):
  podman run --rm --device nvidia.com/gpu=all docker.io/nvidia/cuda:12.3.1-base-ubuntu22.04 nvidia-smi
Host smoke (classic devices):
  podman run --rm --device /dev/nvidia0 --device /dev/nvidiactl --device /dev/nvidia-uvm \
    -e NVIDIA_VISIBLE_DEVICES=all docker.io/nvidia/cuda:12.3.1-base-ubuntu22.04 nvidia-smi

EOF
}

# After --gpu up: verify GPU in Ollama; auto-remediate when possible; else fail loud.
ensure_ollama_gpu() {
  local rt
  rt="$(runtime_bin)"
  sanitize_ollama_llm_library
  ensure_xdg_defaults
  print_gpu_host_checks
  echo "Checking GPU inside Ollama (nvidia-smi)..."

  if ollama_container_nvidia_smi; then
    print_gpu_ok
    warn_ollama_ps_cpu || true
    echo "After a short chat, confirm PROCESSOR is GPU: ${rt} exec \$(${rt} ps -qf name=ollama | head -1) ollama ps"
    return 0
  fi

  echo
  echo "GPU verify failed — attempting self-heal (no data wipe)..."

  # Bad OLLAMA_LLM_LIBRARY=gpu|gpou already cleared above; re-check env from .env.
  sanitize_ollama_llm_library

  if using_podman; then
    # CDI path failed nvidia-smi: never regenerate+retry CDI in a loop.
    # Strip CDI immediately and force classic devices when host nodes exist.
    if host_has_nvidia_gpu_nodes; then
      if [[ "${PODMAN_GPU_ACTIVE_MODE:-}" != "devices" ]] || compose_files_request_cdi_gpu; then
        echo "Self-heal: stripping CDI — forcing SPOCKIFY_PODMAN_GPU=devices..."
        export SPOCKIFY_PODMAN_GPU=devices
        init_compose_files
        if compose_files_request_cdi_gpu; then
          echo "ERROR: after devices force, compose files still request nvidia.com/gpu." >&2
          print_gpu_failure_checklist
          return 1
        fi
        gpu_stack_reup
        echo "Re-checking GPU inside Ollama (devices overlay)..."
        if ollama_container_nvidia_smi; then
          print_gpu_ok
          warn_ollama_ps_cpu || true
          return 0
        fi
      fi

      # SELinux often blocks /dev/nvidia* into containers.
      if try_selinux_container_use_devices; then
        export SPOCKIFY_PODMAN_GPU=devices
        init_compose_files
        gpu_stack_reup
        echo "Re-checking GPU inside Ollama (after SELinux bool)..."
        if ollama_container_nvidia_smi; then
          print_gpu_ok
          warn_ollama_ps_cpu || true
          return 0
        fi
      fi
    elif ! host_nvidia_visible; then
      echo "Self-heal: no host NVIDIA device nodes — cannot fall back to devices." >&2
    fi
  else
    # Docker: toolkit/CDI fixes usually need interactive sudo / dockerd restart.
    try_regenerate_nvidia_cdi || true
    echo "Self-heal (Docker): if nvidia-smi still fails, install nvidia-container-toolkit," >&2
    echo "  restart the Docker daemon, then: make down && make gpu" >&2
  fi

  print_gpu_failure_checklist
  return 1
}

CMD="up"
GPU=0
FORCE_BUILD=0
DEMO_PROFILE=""
_args=("$@")
_i=0
while [[ "${_i}" -lt "${#_args[@]}" ]]; do
  arg="${_args[_i]}"
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    --gpu) GPU=1 ;;
    --build) FORCE_BUILD=1 ;;
    --demo)
      DEMO_PROFILE=security
      _next="${_args[_i+1]:-}"
      if [[ -n "${_next}" && "${_next}" != -* \
        && "${_next}" != up && "${_next}" != down && "${_next}" != logs \
        && "${_next}" != pull-model && "${_next}" != status ]]; then
        DEMO_PROFILE="${_next}"
        _i=$((_i + 1))
      fi
      ;;
    --demo=*)
      DEMO_PROFILE="${arg#--demo=}"
      [[ -n "${DEMO_PROFILE}" ]] || DEMO_PROFILE=security
      ;;
    up|down|logs|pull-model|status) CMD="${arg}" ;;
    *) echo "Unknown argument: ${arg}" >&2; usage; exit 1 ;;
  esac
  _i=$((_i + 1))
done

detect_engine

# PODMAN_GPU_ACTIVE_MODE set by append_podman_gpu_overlay (cdi|devices).
PODMAN_GPU_ACTIVE_MODE=""
init_compose_files

if [[ ! -f "${ROOT}/.env" && -f "${ROOT}/.env.example" ]]; then
  cp "${ROOT}/.env.example" "${ROOT}/.env"
  echo "Wrote .env from .env.example — edit secrets before publishing this host."
fi
load_env
sanitize_ollama_llm_library

compose() {
  "${ENGINE[@]}" "${FILES[@]}" "$@"
}

# docker compose / `podman compose` (v2) support --remove-orphans.
# podman-compose often rejects it and aborts `up`.
compose_supports_remove_orphans() {
  [[ "${ENGINE[0]}" != "podman-compose" ]] || return 1
  compose up --help 2>&1 | grep -q -- '--remove-orphans'
}

compose_up() {
  local args=(-d)
  if [[ "${1:-}" == "--build" ]]; then
    args+=(--build)
  fi
  if compose_supports_remove_orphans; then
    args+=(--remove-orphans)
  fi
  compose up "${args[@]}"
}

# Run compose up; on Podman CDI unresolvable at start, strip CDI → devices and retry once.
compose_up_gpu_safe() {
  local log ec=0
  if [[ "${GPU}" -ne 1 ]] || ! using_podman || [[ "${PODMAN_GPU_ACTIVE_MODE:-}" != "cdi" ]]; then
    set +e
    compose_up "$@"
    ec=$?
    set -e
    return "${ec}"
  fi

  log="$(mktemp)"
  set +e
  compose_up "$@" >"${log}" 2>&1
  ec=$?
  set -e
  cat "${log}"

  if [[ "${ec}" -eq 0 ]]; then
    rm -f "${log}"
    return 0
  fi

  if grep -Eiq 'unresolvable[[:space:]]+CDI|nvidia\.com/gpu' "${log}"; then
    echo
    echo "Self-heal: compose failed with unresolvable CDI — stripping CDI, forcing devices..."
    export SPOCKIFY_PODMAN_GPU=devices
    init_compose_files
    if compose_files_request_cdi_gpu; then
      echo "ERROR: devices path still requests nvidia.com/gpu — refusing CDI retry." >&2
      rm -f "${log}"
      return 1
    fi
    echo "Compose files: ${FILES[*]}"
    compose down || true
    rm -f "${log}"
    set +e
    compose_up "$@"
    ec=$?
    set -e
    return "${ec}"
  fi

  rm -f "${log}"
  return "${ec}"
}

case "${CMD}" in
  up)
    selinux_hint
    prepare_data_dirs
    echo "Starting Spockify..."
    if [[ -n "${DEMO_PROFILE}" ]]; then
      echo "Demo profile: ${DEMO_PROFILE} (authorized scoped assessments — NOT unfiltered/jailbreak mode)"
    fi
    if [[ -d "${ROOT}/services/router" ]]; then
      router_img="${SPOCKIFY_ROUTER_IMAGE:-spockify-router:local}"
      owui_img="${SPOCKIFY_OPENWEBUI_IMAGE:-spockify-openwebui:local}"
      need_build="${FORCE_BUILD}"
      if [[ "${need_build}" -eq 0 ]]; then
        if image_exists "${router_img}" && image_exists "${owui_img}"; then
          need_build=0
        elif pull_ghcr_images && image_exists "${SPOCKIFY_ROUTER_IMAGE}" \
          && image_exists "${SPOCKIFY_OPENWEBUI_IMAGE}"; then
          need_build=0
        else
          echo "No prebuilt images — building Open WebUI locally (needs several GiB RAM)." >&2
          echo "If npm run build fails on Fedora, pull GHCR instead of building:" >&2
          echo "  $(runtime_bin) pull ghcr.io/<owner>/spockify-openwebui:latest" >&2
          need_build=1
        fi
      fi
      # Demo prompt injection lives in router: rebuild router only (not OWUI).
      if [[ -n "${DEMO_PROFILE}" && "${need_build}" -eq 0 ]]; then
        echo "Rebuilding router for demo profile '${DEMO_PROFILE}'..."
        compose build router
      fi
      if [[ "${need_build}" -eq 1 ]]; then
        echo "Building images (first run can take several minutes)..."
        compose_up_gpu_safe --build
      else
        compose_up_gpu_safe
      fi
    else
      compose_up_gpu_safe
    fi
    if command -v curl >/dev/null 2>&1; then
      wait_http "http://127.0.0.1:${SPOCKIFY_ROUTER_PORT:-4100}/health" router 90
      wait_http "http://127.0.0.1:${SPOCKIFY_API_PORT:-4000}/health/liveliness" litellm 90
      wait_http "http://127.0.0.1:${SPOCKIFY_CHAT_PORT:-3080}/health" openwebui 90
    fi
    echo
    echo "Chat UI:  http://localhost:${SPOCKIFY_CHAT_PORT:-3080}"
    echo "API:      http://localhost:${SPOCKIFY_API_PORT:-4000}/v1"
    echo "Models:   ${OLLAMA_PULL_MODELS:-${DEFAULT_OLLAMA_PULL_MODELS}}"
    echo "Model pull runs in the background. Watch with:"
    echo "          ${ENGINE[*]} ${FILES[*]} logs -f ollama-pull"
    if [[ -n "${DEMO_PROFILE}" ]]; then
      echo "Demo:     ${DEMO_PROFILE} — use model spockify-auto (authorized defensive overlay)."
    fi
    if [[ "${GPU}" -eq 1 ]]; then
      echo
      if ! ensure_ollama_gpu; then
        exit 1
      fi
      echo
      echo "Fast path: leave Thinking on Off (llama3.1:8b ignores think=)."
      echo "UI model: spockify-auto (routes to llama3.1-8b) or pick llama3.1-8b."
      echo "Smoke pull only: OLLAMA_PULL_MODELS=llama3.2:3b make gpu"
      echo "12GB+ quality: append gemma4:12b to OLLAMA_PULL_MODELS and set"
      echo "  DEFAULT_CHAT_WORKER=gemma4-12b in compose (or re-export before up)."
    fi
    echo "Open the UI and create the first admin account."
    ;;
  down)
    compose down
    ;;
  logs)
    compose logs -f --tail=100
    ;;
  status)
    compose ps
    ;;
  pull-model)
    compose run --rm --no-deps ollama-pull
    ;;
esac
