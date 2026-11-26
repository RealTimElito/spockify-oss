#!/usr/bin/env bash
# Install (vendor-on-demand) upstream CyberGym into a local venv.
#
# CyberGym is NOT vendored into this git repo — this script clones the
# upstream repo pinned to a fixed commit, exactly like scripts/run-swebench.sh
# installs mini-swe-agent into ./.venv-bench on demand. Re-run is idempotent
# (reset --hard to the pin if the vendor dir already exists).
#
# Upstream: https://github.com/sunblaze-ucb/cybergym
# See docs/CYBERGYM.md for what this benchmark is and how scoring works.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # evaluations/
HARNESS_DIR="${ROOT}/cybergym-harness"
# shellcheck source=/dev/null
source "${HARNESS_DIR}/pin.env"

VENDOR_DIR="${CYBERGYM_VENDOR_DIR:-${HARNESS_DIR}/vendor/cybergym}"
VENV_DIR="${CYBERGYM_VENV_DIR:-${HARNESS_DIR}/.venv}"

echo "=== Spockify CyberGym install ==="
echo "upstream:  ${CYBERGYM_REPO_URL}"
echo "pin:       ${CYBERGYM_PIN_COMMIT} (${CYBERGYM_PIN_NOTE})"
echo "vendor:    ${VENDOR_DIR}"
echo "venv:      ${VENV_DIR}"
echo

if [[ ! -d "${VENDOR_DIR}/.git" ]]; then
  mkdir -p "$(dirname "${VENDOR_DIR}")"
  echo "Cloning upstream CyberGym..."
  git clone "${CYBERGYM_REPO_URL}" "${VENDOR_DIR}"
else
  echo "Vendor checkout already present — fetching pin..."
  git -C "${VENDOR_DIR}" fetch origin "${CYBERGYM_PIN_COMMIT}" 2>/dev/null || \
    git -C "${VENDOR_DIR}" fetch origin main
fi

git -C "${VENDOR_DIR}" checkout -q "${CYBERGYM_PIN_COMMIT}"
echo "Checked out: $(git -C "${VENDOR_DIR}" rev-parse HEAD)"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "Creating venv..."
  python3 -m venv "${VENV_DIR}"
fi

echo "Installing CyberGym (editable, dev+server extras)..."
"${VENV_DIR}/bin/pip" install -q -U pip
"${VENV_DIR}/bin/pip" install -q -e "${VENDOR_DIR}[dev,server]"

echo "Installing Spockify adapter requirements (huggingface_hub, httpx)..."
"${VENV_DIR}/bin/pip" install -q -U "huggingface_hub>=0.24" "httpx>=0.27"

"${VENV_DIR}/bin/python" -c "import cybergym; from cybergym.task import gen_task; from cybergym.server import pocdb; print('cybergym import ok')"

echo
echo "Install complete. Next:"
echo "  ./scripts/run-cybergym.sh dry-run"
echo "  ./scripts/run-cybergym.sh smoke --model gpt-oss-20b"
