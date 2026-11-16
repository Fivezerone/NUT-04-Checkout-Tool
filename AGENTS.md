# AGENTS.md — Authoritative Architecture & Engineering Guardrails

> **Target Audience:** All AI Coding Agents (Antigravity, Claude Code, Cursor, Copilot) and Human Engineers.  
> **Repository:** `NUT-04 Checkout Tool` (NutriScore Kenya Digital Health Platform)  
> **Status:** Binding Mandate — Zero Exceptions Permitted.

---

## 1. Prime Invariants & Inviolable Rules

Every AI agent and human engineer modifying this repository MUST obey these 6 prime rules without exception:

### Rule 1: Strict Host Isolation (Rule R4)

- **NEVER** run `node`, `npm`, `npx`, `python`, `psql`, or build scripts directly on the host machine.
- The host machine runs **only** `git` and `docker`.
- All executions (building, linting, testing, typechecking, database migrations) must run inside Docker:
  - **Windows (PowerShell):** `.\bin\nut.ps1 <verb>` or `docker compose exec toolchain ...`
  - **POSIX (Linux/macOS):** `./bin/nut <verb>` or `docker compose exec toolchain ...`
- _Single Host Exception:_ Loading the unpacked extension in Chrome Developer Mode (`chrome://extensions` → `./dist/extension`).
- _See:_ [ADR-002](docs/adr/002-docker-exclusive-build.md) & [Golden Path 6](docs/architecture/golden-paths.md).

### Rule 2: Zero Hardcoded Patient PII or Clinic Identifiers (Rule R5 & Stage B)

- **NEVER** insert real or fake patient reference codes (e.g., `PAT-XXXX`, `pat-anon-XXXX`), clinician IDs (`usr-dr-XXXX`), real phone numbers (`2547XXXXXXXX`), hospital email domains (`@knh.or.ke`, `@akuh.ac.ke`), or real Kenyan hospital names (`Kenyatta National Hospital`, `Aga Khan University Hospital`, slug `knh-cardio`) anywhere in code, comments, or UI defaults.
- Always initialize arrays with empty literals (`[]`) and render neutral empty/loading states.
- For test fixtures, use synthetic identifiers (e.g., `patient-test-01`, domain `@example.test`).
- _Enforced by:_ `node scripts/check-no-hardcoded-data.mjs` (pre-build) and `node scripts/check-no-fixtures-in-dist.mjs` (post-build).
- _See:_ [ADR-009](docs/adr/009-elimination-hardcoded-pii-ci-guards.md) & [Anti-Patterns](docs/architecture/anti-patterns.md).

### Rule 3: Zero Supabase Dependencies (ADR-001)

- Supabase was completely decommissioned in favor of an open-source, self-hosted Docker stack:
  - Database: `postgres:16-bookworm` with plain SQL migrations via `dbmate`.
  - Identity: Keycloak 26.2.5 (Quarkus) on `/auth/*` (realm `nutriscore`, OIDC + PKCE).
  - REST API: PostgREST 12.2.3 on `/api/*` enforcing Row Level Security.
  - Gateway: Caddy 2.9.1 on `:8080` (HTTP) and `:8443` (internal TLS).
- **NEVER** re-introduce `@supabase/*` packages, `supabase/` folders, or `VITE_SUPABASE_*` environment variables.
- _See:_ [ADR-001](docs/adr/001-decommission-supabase.md).

### Rule 4: Dietary Profile Token (DPT) Privacy & Fail-Closed Safety (ADR-010)

- **NEVER** put medical diagnoses or condition strings (e.g., "diabetes", "hypertension", "renal") in tokens or extension messages.
- Tokens must contain ONLY dimensionless numerical thresholds from `ALLOWLISTED_KEYS` (e.g., `sodium_mg_per_100g_max`).
- **Fail-Closed on Swaps:** Never recommend a swap candidate product unless its nutritional fields are verified (`review_state >= ESTIMATED`).
- **Conservative Banding:** Never round upper nutritional limits upward (a 500mg ceiling must never become 600mg).
- _See:_ [ADR-010](docs/adr/010-dietary-profile-token-cryptography.md) & [Data Flow](docs/architecture/data-flow.md).

### Rule 5: Immutable WORM Audit Ledger & RLS (ADR-008 & ADR-012)

- All multi-tenant tables in `iam`, `clinical`, `exchange`, and `commercial` MUST enforce Row Level Security (`FORCE ROW LEVEL SECURITY`) checking `app_private.claims()->>'tenant_id'`.
- All application roles must be created with `NOLOGIN NOBYPASSRLS`.
- **NEVER** execute `UPDATE`, `DELETE`, or `TRUNCATE` against `audit.ledger` or `clinical.clinical_records`. All audit events are append-only with SHA-256 hash chaining.
- _See:_ [ADR-008](docs/adr/008-multi-tenant-cad-identity.md) & [ADR-012](docs/adr/012-append-only-worm-audit-chain.md).

### Rule 6: 90-Day (3-Month) Device Storage Ceiling (ADR-005)

- IndexedDB shopping ledger entries older than 90 days are purged daily by the `ledger-retention` alarm.
- UI timeline models strictly limit query ranges to: `today`, `week`, `month`, and `3months`. Multi-year queries (`year`, `all`) are banned.
- _See:_ [ADR-005](docs/adr/005-retention-policy.md).

---

## 2. Fast Architecture & File Routing Reference

When you are asked to touch a part of the codebase, consult these authoritative documents first:

| Area of Codebase              | Target Directories                | Required Reading Before Editing                                                                                                                                                                       |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chrome Extension Engine**   | `src/extension/`                  | [ADR-003](docs/adr/003-oidc-extension-signin.md), [ADR-004](docs/adr/004-side-panel-permission.md), [System Overview](docs/architecture/system-overview.md)                                           |
| **Retailer Adapters**         | `src/extension/adapters/`         | [ADR-013](docs/adr/013-retailer-adapters-dom-resilience.md), [Golden Path 3](docs/architecture/golden-paths.md#golden-path-3-adding-or-updating-a-supermarket-retailer-adapter)                       |
| **Shopper UI & Primitives**   | `src/ui/src/app/`                 | [ADR-011](docs/adr/011-three-tier-design-tokens-ui-separation.md), [Golden Path 4](docs/architecture/golden-paths.md#golden-path-4-creating-a-ui-component-or-cad-view)                               |
| **Clinic Admin Dashboard**    | `src/ui/src/cad/`                 | [ADR-008](docs/adr/008-multi-tenant-cad-identity.md), [ADR-011](docs/adr/011-three-tier-design-tokens-ui-separation.md), [System Overview](docs/architecture/system-overview.md)                      |
| **Shared Contracts & Crypto** | `src/shared/`                     | [ADR-010](docs/adr/010-dietary-profile-token-cryptography.md), [Data Flow](docs/architecture/data-flow.md)                                                                                            |
| **Database & Migrations**     | `db/migrations/`, `db/seeds/`     | [ADR-005](docs/adr/005-retention-policy.md), [ADR-007](docs/adr/007-migration-tool-dbmate.md), [Golden Path 2](docs/architecture/golden-paths.md#golden-path-2-modifying-database-schemas-via-dbmate) |
| **API Microservice**          | `services/api/`                   | [ADR-001](docs/adr/001-decommission-supabase.md), [Golden Path 1](docs/architecture/golden-paths.md#golden-path-1-adding-or-modifying-a-backend-api-endpoint)                                         |
| **Gateway & Routing**         | `infra/caddy/`                    | [ADR-006](docs/adr/006-gateway-caddy.md), [System Overview](docs/architecture/system-overview.md)                                                                                                     |
| **Identity & OIDC Realm**     | `infra/keycloak-realm.json`       | [ADR-003](docs/adr/003-oidc-extension-signin.md), [ADR-008](docs/adr/008-multi-tenant-cad-identity.md)                                                                                                |
| **CI, Toolchain & Docker**    | `docker/`, `compose.yaml`, `bin/` | [ADR-002](docs/adr/002-docker-exclusive-build.md), [Environment Runbook](docs/operations/environment-runbook.md)                                                                                      |

---

## 3. Mandatory Pre-Flight Verification Sequence

Before you claim any task is complete or push a commit, you MUST execute the containerized CI quality check:

```powershell
# Windows PowerShell
.\bin\nut.ps1 ci

# POSIX / Bash
./bin/nut ci
```

### The 12 Quality Gates That Must Exit Code 0:

1. `node scripts/check-no-secrets-tracked.mjs` — Zero staged secrets.
2. `node scripts/check-no-hardcoded-data.mjs` — Zero hardcoded patient/clinic data.
3. `npm run check:manifest` — Manifest globals and permissions intact.
4. `npm run check:cad-security` — CAD security verification passed.
5. `node --check src/extension/content.js` — Syntax check passes.
6. `npm run format:check` — Prettier code formatting verified.
7. `npm run lint` — ESLint passes with 0 errors.
8. `npm run typecheck` — TypeScript passes with 0 errors.
9. `npm run test` — Vitest regression suite passes 100% (793+ tests).
10. `npm run build` — Clean Vite and extension compilation.
11. `node scripts/check-no-fixtures-in-dist.mjs` — Zero fixtures or mock credentials in `./dist/`.
12. `node scripts/verify-audit-chain.mjs` — WORM audit hash continuity verified.
