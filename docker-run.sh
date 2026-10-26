#!/usr/bin/env bash
# Convenience wrapper: ./docker-run.sh → ./docker/run.sh
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/docker/run.sh" "$@"
