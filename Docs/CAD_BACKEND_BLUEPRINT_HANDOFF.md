# NutriScore CAD Backend Blueprint — Continuation Directive

**Prepared:** 2 November 2026  
**Branch:** `feat/cad-backend-blueprint`  

Use `Reports/NutriScore CAD — Multi-Tenant Healthcare Backend Blueprint.md` and
`Reports/Agent Prompt — Implement the CAD Multi-Tenant Backend Blueprint.md` as
controlling requirements. Preserve user-owned changes, work one phase at a
time, and never touch hosted Supabase (`nqcpudpkrkutpxuqpsfk`).

## Committed work

| Phase | Commit | Outcome |
|---|---|---|
| 0 | `f5bc6c0` | Gap analysis, migration map, deviations, and open questions. |
| 1 | `2d09a77` | Schema groups, forced restrictive tenant wall, service identities, compatibility views. |
| 2 | `522ec8d` | Canonical `app_role` claims, auth-provider seam, denylist and one ban constant. |
| 3 | `86cd74a4`| Grant-matrix provisioning, regulator and stakeholder onboarding. |
| 4 | `1a6b3069`| Clinical core, treatment relationships, ABAC `decide()`, break-glass, retention. |
| 5 | `3c320902`| WORM audit ledger, signed checkpoints, platform metadata view, offline & online verifier. |
| 6 | `a9a67762`| Field-level AES-256-GCM encryption, KeyWrapper Stage A, blind indexes, keyed MACs, crypto-shredding, allowlisted projection. |
| 7 | `0000dd7b`| Exchange service, DPoP proofs, Dietary Profile Token (DPT), k≥5 cohort gate, shopper aliases, revocation, and leak proofs. |
| 8 | `596513ad`| Overlay-only commercial schema, reference SKUs curation, observed orders, demand analytics (k≥5), and DPT endpoints. |
| 9 | *(pending)* | Dry-run retention/rights workflows, DPIA draft, deliberately failing launch gate pending counsel. |

Baseline tag: `pre-cad-backend-blueprint`. The application role is `app_role`;
Supabase's Postgres `role` claim was intentionally not changed (OQ-001 option 2).

## Phase 9 deliverables (committed in this phase)

| File | Purpose |
|---|---|
| `supabase/migrations/20261101080000_compliance_retention_and_rights.sql` | Retention seeding per D5, lawful_basis backfill, `set_patient_restriction`, `rectify_clinical_record`, and fail-safe `execute_retention_purge` |
| `supabase/rollbacks/20261101080000_compliance_retention_and_rights.rollback.sql` | Clean rollback for compliance functions |
| `scripts/purge-retention.mjs` | Automated fail-safe retention purge engine (dry run by default, legal-hold safe, writes ledger entries) |
| `src/shared/patient-export.ts` | Data-subject portability export bundle generator, SHA-256 canonical digest, Ed25519 signature, WORM audit event |
| `docs/compliance/dpia/DPIA-draft.md` | Data Protection Impact Assessment (DPIA) draft under Kenya DPA 2019 / ODPC guidance with `[COUNSEL]` markers |
| `compliance/launch.json` | Production release gate configuration recording DPIA state, ODPC filing reference, and 60-day launch schedule |
| `scripts/release-gate.mjs` | Release gate verification script wired to `npm run release:check` (deliberately blocks production release pending counsel) |
| `docs/compliance/BREACH_RUNBOOK.md` | Incident response & 72-hour statutory ODPC notification runbook for verifier failures, AUTHZ_DENY spikes, and break-glass anomalies |
| `supabase/tests/cad_retention_and_rights.sql` | pgTAP test suite verifying fail-safe purge refusal, legal hold, patient restriction, rectification version bump, dry/active purge (18 tests, all pass) |
| `src/ui/src/app/__tests__/cad-blueprint-phase9.test.ts` | Vitest test suite covering purge eligibility, release gate rules, signed export bundles, and audit verification (14 tests, all pass) |

## Validation suites (Phase 9 gate — all green)

- Local Postgres tests (all pass):
  - `supabase/tests/cad_tenant_wall.sql`
  - `supabase/tests/cad_claims_and_revocation.sql`
  - `supabase/tests/cad_grant_matrix_lifecycle.sql`
  - `supabase/tests/cad_abac_and_clinical.sql`
  - `supabase/tests/cad_worm_ledger.sql`
  - `supabase/tests/cad_field_encryption_and_projection.sql`
  - `supabase/tests/cad_exchange_and_dpt.sql`
  - `supabase/tests/cad_commercial_overlay.sql` (15/15 pass)
  - `supabase/tests/cad_retention_and_rights.sql` (18/18 pass)
- Live verification scripts:
  - `node scripts/verify-audit-chain.mjs` (all 6 chains verified)
  - `node scripts/verify-phase6-canary.mjs` (zero plaintext leaks)
  - `node scripts/check-leak-proofs.mjs` (5/5 steps pass)
  - `node scripts/check-commercial-overlay.mjs` (4/4 steps pass)
  - `node scripts/purge-retention.mjs` (dry-run succeeds)
- Application gates:
  - `npm test -- --reporter=dot` (836 passed, 50 test files)
  - `npm run typecheck` (0 errors)
  - `npm run lint` (0 errors)
  - `npm run format:check` (clean)
  - `npm run check:rls` (29 relations verified)
  - `npm run check:cad-security` (clean)
  - `npm run release:check` (fails as required by DoD #8 pending counsel sign-off)
  - `npm run build` (clean)
  - `git diff --check` (clean)

## Compliance invariants (D5 — strictly observed)

- **Fail-safe purge refusal:** Any record class without an explicit retention policy throws an immediate error; NULL retain_years is forbidden.
- **Legal hold safeguard:** Active legal hold blocks purge execution across all tenants.
- **Data subject rights:**
  - Restriction sets `clinical.patients.restricted = true` and audits `RESTRICT_PROCESSING`.
  - Rectification inserts a new immutable version with `supersedes_id`, audits `RECTIFY_CLINICAL_RECORD`.
  - Portability export produces a verifiable Ed25519-signed bundle and audits `EXPORT_PATIENT_DATA`.
- **Statutory release gate:** Fails if DPIA missing, counsel sign-off absent, or submission lead time is under 60 days before launch.

## Next phases

| Phase | Required outcome | Required commit |
|---|---|---|
| 10 | Prepared-only network, Keycloak, replication, cutover and hosted-checklist artifacts; deploy nothing. | `docs(p10): cutover artifacts, hosted checklist and final report` |
