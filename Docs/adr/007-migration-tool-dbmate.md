# ADR-007: Plain SQL Database Migration Engine (dbmate)

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Database Team
- **References:** ADR-001

---

## Context
Following the elimination of Supabase CLI and migrations (ADR-001), the database schema management strategy required a dedicated migration engine:
1. **Plain SQL Requirement:** Migrations must use standard PostgreSQL DDL without proprietary abstraction layers (such as Prisma, TypeORM, or custom ORM DSLs) to allow exact schema control, RLS policy definitions, custom role grants, and PostgreSQL triggers.
2. **Container-Native Execution:** The tool must execute effortlessly inside Docker Compose without requiring a JVM (Flyway/Liquibase) or Python/Node.js host runtimes.
3. **Deterministic Rollbacks:** Every schema migration must have an explicit, tested rollback companion (`*.rollback.sql`).
4. **Zero-Drift Invariant:** The database state must be reproducible from a cold start in development, CI, and production environments.

---

## Decision
We select **dbmate** (`ghcr.io/amacneil/dbmate:2.24.0`) as the authoritative database migration engine:

1. **Migration Files:** Plain SQL files stored in `db/migrations/` using timestamped naming (`NNNN_description.sql`).
2. **Companion Rollbacks:** Every migration file has an adjacent `NNNN_description.rollback.sql` defining the exact inverse operations.
3. **Compose Service:** The `migrate` service in `compose.yaml` executes `dbmate up` as a one-shot container that depends on PostgreSQL health. PostgREST and the API service depend on `migrate` completing successfully (`condition: service_completed_successfully`).
4. **Schema Migrations Table:** `dbmate` tracks applied migrations in the standard `schema_migrations` table.
5. **No Schema Dumping in CI/Dev:** Environment variable `DBMATE_NO_DUMP_SCHEMA: 'true'` prevents unnecessary schema file churn.

---

## Consequences & Rules

### Positive Consequences
- **Lightweight & Fast:** Single statically-compiled Go binary executed in an alpine container (~15MB image).
- **Universal SQL:** Any PostgreSQL feature (custom schemas, triggers, RLS, cryptographic functions, extensions) is written directly in standard SQL.
- **Automated Startup:** When running `.\bin\nut.ps1 up`, migrations apply automatically before dependent web services start.

### Trade-offs & Operational Risks
- **Manual SQL Authoring:** Developers must write explicit `CREATE` and `DROP` statements by hand; no automatic schema diffing is provided.

### Strict Enforcement Rules
1. **Mandatory Rollback Companion:** Every new SQL migration in `db/migrations/` must be committed with its corresponding `.rollback.sql` companion file.
2. **No Breaking DDL:** Migrations on production tables must use non-locking operations (`ADD COLUMN ... DEFAULT ...`, `CREATE INDEX CONCURRENTLY`) to ensure zero-downtime deployments.
3. **Reset Command:** Use `.\bin\nut.ps1 db-reset` or `./bin/nut db-reset` to verify migrations can be cleanly rebuilt from scratch.

