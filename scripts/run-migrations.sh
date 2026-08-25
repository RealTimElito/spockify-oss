#!/bin/sh
# Apply sql/migrations/*.sql in order; idempotent via schema_migrations table.
set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-spockify}"
PGUSER="${PGUSER:-spockify}"
export PGPASSWORD="${PGPASSWORD:?PGPASSWORD required}"

psql_base() {
  psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
    -v ON_ERROR_STOP=1 "$@"
}

wait_for_postgres() {
  retries="${1:-60}"
  i=1
  while [ "${i}" -le "${retries}" ]; do
    if psql_base -c "SELECT 1" >/dev/null 2>&1; then
      return 0
    fi
    echo "waiting for postgres (${i}/${retries})..."
    sleep 2
    i=$((i + 1))
  done
  echo "ERROR: postgres not ready" >&2
  return 1
}

migration_applied() {
  version="$1"
  psql_base -tAc \
    "SELECT 1 FROM schema_migrations WHERE version = '${version}'" 2>/dev/null \
    | grep -q 1
}

apply_migration() {
  file="$1"
  version="$(basename "${file}" .sql)"

  if migration_applied "${version}"; then
    echo "skip  ${version}"
    return 0
  fi

  echo "apply ${version}"
  psql_base -f "${file}"
  psql_base -c "INSERT INTO schema_migrations (version) VALUES ('${version}')"
}

wait_for_postgres

# Never apply Spockify SQL migrations if OpenWebUI user data exists but alembic is missing.
openwebui_user_rows="$(psql_base -tAc 'SELECT COUNT(*) FROM public."user";' 2>/dev/null || echo 0)"
openwebui_chat_rows="$(psql_base -tAc 'SELECT COUNT(*) FROM public.chat;' 2>/dev/null || echo 0)"
alembic_present="$(psql_base -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='alembic_version' LIMIT 1;" 2>/dev/null || echo 0)"
if [ "${openwebui_user_rows}" -gt 0 ] || [ "${openwebui_chat_rows}" -gt 0 ]; then
  if [ "${alembic_present}" != "1" ]; then
    echo "ERROR: OpenWebUI rows exist but alembic_version missing — refusing Spockify SQL migrations." >&2
    exit 1
  fi
fi

for f in $(ls "${MIGRATIONS_DIR}"/*.sql | sort); do
  if grep -qiE 'DROP[[:space:]]+(TABLE|SCHEMA)[[:space:]]+(public\.)?("user"|"chat"|"auth"|"config"|"alembic_version")' "${f}"; then
    echo "ERROR: migration ${f} contains DROP on OpenWebUI tables — refused." >&2
    exit 1
  fi
done

if ! ls "${MIGRATIONS_DIR}"/*.sql >/dev/null 2>&1; then
  echo "ERROR: no migrations in ${MIGRATIONS_DIR}" >&2
  exit 1
fi

for f in $(ls "${MIGRATIONS_DIR}"/*.sql | sort); do
  apply_migration "${f}"
done

echo "migrations complete"
psql_base -c "SELECT version, applied_at FROM schema_migrations ORDER BY version"
