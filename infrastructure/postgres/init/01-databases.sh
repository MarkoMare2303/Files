#!/bin/bash
# Legt zusätzliche Datenbanken an (z. B. für Integrationstests) und aktiviert PostGIS.
set -euo pipefail

create_db() {
  local db="$1"
  echo "  → creating database '${db}'"
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
    SELECT 'CREATE DATABASE ${db}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\gexec
EOSQL
}

enable_postgis() {
  local db="$1"
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${db}" <<-'EOSQL'
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS unaccent;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
EOSQL
}

enable_postgis "${POSTGRES_DB}"

if [ -n "${POSTGRES_EXTRA_DATABASES:-}" ]; then
  for db in $(echo "${POSTGRES_EXTRA_DATABASES}" | tr ',' ' '); do
    create_db "${db}"
    enable_postgis "${db}"
  done
fi

echo "PostGIS init complete."
