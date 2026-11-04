#!/usr/bin/env bash
# Timed compose Postgres restore drill (B-09 / G6 local).
#
# Does NOT restore onto a production cluster, k8s postgres-0, or a live
# compose postgres volume. Restore target is a throwaway container. Optional
# --dump-compose takes a read-only pg_dump from the local compose
# project named "spockify".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="synthetic"
REPORT=""
KEEP=0
IMAGE="${SPOCKIFY_POSTGRES_IMAGE:-postgres:17-alpine}"
RUNTIME=""

usage() {
  cat <<'EOF'
Timed restore drill against a throwaway Postgres container.

  docker/restore-drill.sh [--synthetic|--dump-compose|--dry-run] [--report FILE]

  --synthetic       Restore a tiny SQL fixture (default). No live DB.
  --dump-compose    pg_dump from local compose service "postgres" (read-only),
                    then restore into the throwaway. Never kubectl.
  --dry-run         Print the plan and refuse engines; no containers.
  --report FILE     Write the timed report (local time in the filename if FILE
                    is a directory).
  --keep            Leave the throwaway container for inspection.

Refuses Kubernetes: this script never calls kubectl and never targets
postgres-0. Do not point it at production volumes.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --synthetic) MODE=synthetic; shift ;;
    --dump-compose) MODE=dump-compose; shift ;;
    --dry-run) MODE=dry-run; shift ;;
    --keep) KEEP=1; shift ;;
    --report)
      REPORT="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

log() { printf '%s\n' "$*"; }

refuse_cluster() {
  if [[ "${SPOCKIFY_RESTORE_DRILL_ALLOW_K8S:-}" == "1" ]]; then
    log "WARNING: SPOCKIFY_RESTORE_DRILL_ALLOW_K8S=1 is ignored; this drill still will not call kubectl."
  fi
  case "$(hostname -s 2>/dev/null || hostname || true)" in
    spark|data)
      echo "restore-drill: refusing to run on cluster/prod hostname $(hostname)" >&2
      exit 1
      ;;
  esac
}

pick_runtime() {
  if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
    RUNTIME=podman
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    RUNTIME=docker
  else
    echo "restore-drill: need podman or docker for a live drill" >&2
    return 1
  fi
}

STAMP="$(date '+%Y%m%dT%H%M%S%z')"
# Docker/podman names cannot include '+' from %z.
SAFE_STAMP="$(printf '%s' "${STAMP}" | tr '+-' 'pm')"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/spockify-restore-drill.${SAFE_STAMP}.XXXX")"
DUMP="${WORKDIR}/compose-pg.dump"
REPORT_BODY="${WORKDIR}/report.txt"
NAME="spockify-restore-drill-${SAFE_STAMP}"
CLEANED=0

cleanup() {
  if [[ "${CLEANED}" -eq 1 ]]; then
    return
  fi
  CLEANED=1
  if [[ "${KEEP}" -eq 0 && -n "${RUNTIME:-}" ]]; then
    "${RUNTIME}" rm -f "${NAME}" >/dev/null 2>&1 || true
  fi
  if [[ "${KEEP}" -eq 0 ]]; then
    rm -rf "${WORKDIR}"
  fi
}
trap cleanup EXIT

now_s() {
  date +%s
}

elapsed_s() {
  local start="$1" end
  end="$(now_s)"
  echo $((10#${end} - 10#${start}))
}

write_report() {
  local dest="$1"
  if [[ -d "${dest}" ]]; then
    dest="${dest}/restore-drill-${STAMP}.txt"
  fi
  cp "${REPORT_BODY}" "${dest}"
  log "wrote ${dest}"
}

refuse_cluster

{
  echo "Spockify compose restore drill"
  echo "stamp: ${STAMP}"
  echo "mode: ${MODE}"
  echo "host: $(hostname)"
  echo "image: ${IMAGE}"
  echo "workdir: ${WORKDIR}"
  echo "target: throwaway container ${NAME} (not live compose postgres, not k8s)"
} | tee "${REPORT_BODY}"

if [[ "${MODE}" == "dry-run" ]]; then
  {
    echo "plan:"
    echo "  1. optional read-only pg_dump from compose service postgres"
    echo "  2. start throwaway ${IMAGE} named ${NAME}"
    echo "  3. psql restore into throwaway"
    echo "  4. SELECT 1 sanity"
    echo "  5. rm throwaway"
    echo "status: dry-run (no containers started)"
  } | tee -a "${REPORT_BODY}"
  if [[ -n "${REPORT}" ]]; then
    KEEP=1
    write_report "${REPORT}"
    KEEP=0
  fi
  exit 0
fi

pick_runtime
echo "runtime: ${RUNTIME}" | tee -a "${REPORT_BODY}"

if [[ "${MODE}" == "dump-compose" ]]; then
  DUMP_START="$(now_s)"
  if ! "${RUNTIME}" compose -f "${ROOT}/docker-compose.yml" exec -T postgres \
    pg_dump -U spockify -d spockify --no-owner --no-acl >"${DUMP}"; then
    echo "restore-drill: compose pg_dump failed (is local compose postgres up?)" >&2
    exit 1
  fi
  DUMP_S="$(elapsed_s "${DUMP_START}")"
  echo "dump_s: ${DUMP_S}" | tee -a "${REPORT_BODY}"
  echo "dump_bytes: $(wc -c <"${DUMP}")" | tee -a "${REPORT_BODY}"
else
  cat >"${DUMP}" <<'SQL'
CREATE TABLE IF NOT EXISTS restore_drill (id int primary key, note text);
INSERT INTO restore_drill (id, note) VALUES (1, 'synthetic restore drill');
SQL
  echo "dump_s: 0" | tee -a "${REPORT_BODY}"
  echo "dump_bytes: $(wc -c <"${DUMP}")" | tee -a "${REPORT_BODY}"
fi

RESTORE_START="$(now_s)"
"${RUNTIME}" run -d --name "${NAME}" --network none \
  -e POSTGRES_PASSWORD=drill \
  -e POSTGRES_USER=spockify \
  -e POSTGRES_DB=spockify \
  "${IMAGE}" >/dev/null

for _ in $(seq 1 40); do
  if "${RUNTIME}" exec "${NAME}" pg_isready -U spockify -d spockify >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! "${RUNTIME}" exec "${NAME}" pg_isready -U spockify -d spockify >/dev/null 2>&1; then
  echo "restore-drill: throwaway postgres never became ready" >&2
  exit 1
fi

"${RUNTIME}" exec -i "${NAME}" psql -U spockify -d spockify <"${DUMP}" >/dev/null
SANITY="$("${RUNTIME}" exec "${NAME}" psql -U spockify -d spockify -tAc 'SELECT 1')"
RESTORE_S="$(elapsed_s "${RESTORE_START}")"

{
  echo "restore_s: ${RESTORE_S}"
  echo "sanity: ${SANITY}"
  echo "rto_note: restore_s is throwaway-container wall time, not a published SLO"
  echo "rpo_note: dump is point-in-time of the source; agree RPO with the operator"
  if [[ "${SANITY}" == "1" ]]; then
    echo "status: pass"
  else
    echo "status: fail"
  fi
} | tee -a "${REPORT_BODY}"

if [[ "${SANITY}" != "1" ]]; then
  exit 1
fi

if [[ -n "${REPORT}" ]]; then
  KEEP_SAVE="${KEEP}"
  KEEP=1
  write_report "${REPORT}"
  KEEP="${KEEP_SAVE}"
fi
