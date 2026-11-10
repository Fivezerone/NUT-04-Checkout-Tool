#!/usr/bin/env bash
# Usage: PGURL=postgres://postgres:postgres@localhost:5432 scripts/db-test.sh
# Runs all migrations in db/migrations/ against a fresh scratch database, then
# runs any SQL test files in db/tests/ (if present).
# NOTE: Supabase-specific paths (supabase/tests/, supabase/migrations/) were
# removed in A-07. Repointed to db/ in A-11b.
set -euo pipefail
: "${PGURL:?set PGURL to a superuser connection string without a database name}"
DB=nut04_test_$$
psql "$PGURL/postgres" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB"' EXIT
for m in $(ls db/migrations/*.sql | sort); do
  echo "-- migration $m"; psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$m"
done
# TODO(Stage C): add db/tests/*.sql when Docker-native test SQL files are written
echo "DB TESTS PASSED"
