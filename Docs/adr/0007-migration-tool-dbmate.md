# ADR 0007 — Migration Tool Choice (dbmate)

**Status:** Accepted  
**Date:** 2026-11-10  
**Authors:** NUT-04 Engineering

---

## Context

The replacement stack needs a database migration tool that runs plain SQL,
integrates cleanly with Docker, and doesn't require a Supabase CLI or Node.js.

Candidates: Flyway, Liquibase, golang-migrate, dbmate.

---

## Decision

Use **dbmate** (single binary, plain SQL, Docker-native).

- Migrations live in `db/migrations/` as plain SQL files (`NNNN_description.sql`)
- The `migrate` service in compose.yaml runs `dbmate up` as a one-shot container
- Rollback files (`*.rollback.sql`) mirror the existing Supabase rollback pattern
- `dbmate` checks a `schema_migrations` table to track applied migrations

---

## Consequences

**Positive:**
- No JVM, no classpath — single statically-linked binary
- Plain SQL migrations are readable by any engineer
- `dbmate` works identically in dev, CI and production
- Existing Supabase SQL migrations are ported directly (no dialect conversion)

**Negative / risks:**
- No auto-generated migrations — all SQL written by hand (acceptable; migrations
  are already hand-written)
- `schema_migrations` table is separate from Supabase's internal migration tracking
  (no overlap issue since we start from empty Postgres)

