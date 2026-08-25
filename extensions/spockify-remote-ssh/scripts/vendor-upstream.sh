#!/usr/bin/env bash
# Shallow-clone jeanp413/open-remote-ssh into extensions/spockify-remote-ssh/upstream.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEST="${ROOT}/extensions/spockify-remote-ssh/upstream"
REPO_URL="${SPOCKIFY_OPEN_REMOTE_SSH_URL:-https://github.com/jeanp413/open-remote-ssh.git}"
REF="${SPOCKIFY_OPEN_REMOTE_SSH_REF:-v0.2.0}"

usage() {
  cat <<'EOF'
Usage: vendor-upstream.sh [--ref REF] [--dest PATH]

  Default REF: v0.2.0 (override if tag missing — try 0.2.0 or a commit SHA)
  Writes SHA into ../VENDOR.md hint on stdout; update VENDOR.md manually.

Env: SPOCKIFY_OPEN_REMOTE_SSH_URL, SPOCKIFY_OPEN_REMOTE_SSH_REF
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

mkdir -p "$(dirname "$DEST")"

if [[ -d "${DEST}/.git" ]]; then
  echo "Updating existing upstream at ${DEST}…"
  git -C "$DEST" fetch --tags --force origin
  if git -C "$DEST" rev-parse "refs/tags/${REF}" >/dev/null 2>&1; then
    git -C "$DEST" checkout -f "tags/${REF}"
  else
    git -C "$DEST" checkout -f "$REF"
  fi
else
  echo "Cloning ${REPO_URL} @ ${REF} → ${DEST}"
  # Try tag first; fall back to branch/commit via clone+checkout
  if ! git clone --depth 1 --branch "$REF" --single-branch "$REPO_URL" "$DEST" 2>/dev/null; then
    git clone --depth 1 "$REPO_URL" "$DEST"
    git -C "$DEST" fetch --depth 1 origin "$REF" || true
    git -C "$DEST" checkout -f "$REF"
  fi
fi

SHA="$(git -C "$DEST" rev-parse HEAD)"
echo "Vendored commit: ${SHA}"
echo "Update extensions/spockify-remote-ssh/VENDOR.md with this SHA and ref ${REF}."
echo "Next: wire into code-oss per apps/spockify-ide/docs/REMOTE_SSH.md"
