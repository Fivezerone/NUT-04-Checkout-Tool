# CLAUDE.md — Authoritative Developer & Agent Guidelines

See [AGENTS.md](AGENTS.md) for the master architectural mandate, invariants, and directory mapping.

## Quick Command Reference (Host Isolation — Rule R4)

All commands must execute inside Docker containers via `.\bin\nut.ps1` (PowerShell) or `./bin/nut` (POSIX):

- **Full CI Suite:** `.\bin\nut.ps1 ci`
- **Start Stack:** `.\bin\nut.ps1 up -d`
- **Stop Stack:** `.\bin\nut.ps1 down`
- **Build Extension:** `.\bin\nut.ps1 extension`
- **Reset Database Migrations:** `.\bin\nut.ps1 db-reset`
- **Tail Container Logs:** `.\bin\nut.ps1 logs -f`
- **Run Vitest Tests:** `docker compose exec toolchain npm run test`
- **Run Typecheck:** `docker compose exec toolchain npm run typecheck`
- **Run Linter:** `docker compose exec toolchain npm run lint`

## Strict Anti-Patterns

1. Never run `node`, `npm`, `python`, `psql` directly on the host (Rule R4).
2. Never commit patient PII (`PAT-XXXX`, `pat-anon-XXXX`), clinician IDs, or real hospital names (Rule R5 & Stage B).
3. Never re-introduce `@supabase/*` packages or Supabase URLs (ADR-001).
4. Never put condition names in Dietary Profile Tokens (ADR-010).
5. Never bypass Row Level Security or use `BYPASSRLS`.
6. Never mutate or delete records in `audit.ledger` (ADR-012).
7. Never exceed the 90-day device storage ceiling for shopping history (ADR-005).

## Documentation Navigation

- Master Index: [docs/README.md](docs/README.md)
- Architecture Decision Records: [docs/adr/](docs/adr/)
- Living Blueprints: [docs/architecture/](docs/architecture/)
- Operations & Runbooks: [docs/operations/](docs/operations/)
