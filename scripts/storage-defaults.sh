#!/usr/bin/env bash
# Resolve STORAGE_ROOT for Spock (8TB) vs Spark (/var/lib/spockify).
set -euo pipefail

_sd_root="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

if [[ -z "${STORAGE_ROOT:-}" && -f "${_sd_root}/config/spark.env" ]]; then
  # shellcheck source=/dev/null
  source "${_sd_root}/config/spark.env"
fi

if [[ -z "${STORAGE_ROOT:-}" ]]; then
  if [[ -d /var/lib/spockify ]] && [[ ! -d /var/lib/spockify ]]; then
    STORAGE_ROOT=/var/lib/spockify
  else
    STORAGE_ROOT=/var/lib/spockify/spockify
  fi
fi

export STORAGE_ROOT
