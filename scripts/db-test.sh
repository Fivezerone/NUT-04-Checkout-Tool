#!/usr/bin/env bash
# Usage: PGURL=postgres://postgres:postgres@localhost:5432 scripts/db-test.sh
set -euo pipefail
: "${PGURL:?set PGURL to a superuser connection string without a database name}"
DB=nut04_test_$$
psql "$PGURL/postgres" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB"' EXIT
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/_bootstrap.sql
for m in $(ls supabase/migrations/*.sql | sort); do
  echo "-- migration $m"; psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$m"
done
for t in $(ls supabase/tests/*.sql | grep -v _bootstrap | sort); do
  echo "-- test $t"; psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$t"
done
echo "DB TESTS PASSED"
