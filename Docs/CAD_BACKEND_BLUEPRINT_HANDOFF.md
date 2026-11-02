# NutriScore CAD Backend Blueprint — Implementation & Handoff Directive

**Prepared:** 3 November 2026
**Branch:** `feat/cad-backend-blueprint`
**Baseline Tag:** `pre-cad-backend-blueprint`

All phases of the **NutriScore CAD Multi-Tenant Healthcare Backend Blueprint** have been executed and verified in strict accordance with `Reports/NutriScore CAD — Multi-Tenant Healthcare Backend Blueprint.md`, Decisions D1–D6, and Amendments A1–A7.

## Completed Phase Ledger

| Phase | Commit | Description & Key Outcomes |
|---|---|---|
| **0** | `f5bc6c0b` | Gap analysis, migration map, deviations, and open questions (OQ-001). |
| **1** | `2d09a772` | Schema foundation (`iam`, `clinical`, `exchange`, `commercial`, `audit`), service login roles, forced `RESTRICTIVE` tenant wall, claim helpers (`app_private`). |
| **2** | `522ec8da` | Canonical `app_role` claims, auth-provider seam, denylist, and single `BAN_UNTIL` constant. |
| **3** | `86cd74a4` | Grant-matrix provisioning, regulator (`DHA`, `ODPC`) & stakeholder onboarding, licence verification gate. |
| **4** | `1a6b3069` | Clinical core, treatment relationships, ABAC `decide()`, break-glass workflow, retention. |
| **5** | `3c320902` | WORM audit ledger, signed checkpoints, platform metadata view, offline & online verifier. |
| **6** | `a9a67762` | Field-level AES-256-GCM encryption, KeyWrapper Stage A, blind indexes, keyed MACs, crypto-shredding, allowlisted projection outbox. |
| **7** | `0000dd7b` | Exchange service, DPoP proofs, Dietary Profile Token (DPT), k≥5 cohort gate, shopper aliases, revocation, and leak proofs. |
| **8** | `596513ad` | Overlay-only commercial schema, reference SKUs curation, observed orders, demand analytics (k≥5), and DPT endpoints. |
| **9** | `4f4fe54d` | Retention policy enforcement, rights workflows (export, restriction, rectification), DPIA draft, breach runbook, release gate. |
| **10** | *(pending)* | Stage B cutover artifacts: Gateway API, NetworkPolicies, Linkerd service mesh, replication DDL, Keycloak realm export, cutover runbook, hosted checklist, and final report. |

The application role is `app_role`; Supabase's Postgres `role` claim was intentionally preserved (OQ-001 option 2).

## Phase 10 Deliverables (Committed in this phase)

| File | Purpose |
|---|---|
| `infra/gateway-api.yaml` | Kubernetes Gateway API, ClientTrafficPolicy (TLS 1.3, rate limit), SecurityPolicy (Keycloak JWT validation, claimToHeaders), BackendTrafficPolicy (per-tenant limit). |
| `infra/network-policies.yaml` | Kubernetes NetworkPolicies enforcing default-deny and inter-zone isolation for commercial, clinical, and exchange namespaces. |
| `infra/linkerd-mesh.yaml` | Linkerd service mesh policies (`Server`, `MeshTLSAuthentication`, `AuthorizationPolicy`) enforcing mTLS authorization between workloads. |
| `infra/replication.sql` | PostgreSQL 15+ column-filtered & row-filtered logical replication publication and subscription DDL between clinical-db and exchange-db. |
| `infra/keycloak-realm.json` | Keycloak realm export with 7 canonical roles, `ns-core` client scope, protocol mappers, and clients validated against `claims.schema.json`. |
| `Reports/CUTOVER_RUNBOOK.md` | Authoritative sovereign-cloud split-by-schema procedure, identity switch (config-only for clients), validation steps, and rollback per wave. |
| `Reports/HOSTED_SUPABASE_CHECKLIST.md` | Ordered migrations (20261101 series), secrets to provision, checks to run, and what must never run on hosted. |
| `Reports/CAD_BACKEND_FINAL_REPORT.md` | Final executive report satisfying section 7 of controlling prompt (coverage table, deviations, counsel items, assumptions O1–O4). |
| `src/ui/src/app/__tests__/claims-contract.test.ts` | Updated: validates `infra/keycloak-realm.json` against `claims.schema.json` and 7 canonical roles. |

## Validation Summary Across All Standard Gates

- **Local Postgres pgTAP Suites (all 9 pass):**
  - `supabase/tests/cad_tenant_wall.sql`
  - `supabase/tests/cad_claims_and_revocation.sql`
  - `supabase/tests/cad_grant_matrix_lifecycle.sql`
  - `supabase/tests/cad_abac_and_clinical.sql`
  - `supabase/tests/cad_worm_ledger.sql`
  - `supabase/tests/cad_field_encryption_and_projection.sql`
  - `supabase/tests/cad_exchange_and_dpt.sql`
  - `supabase/tests/cad_commercial_overlay.sql` (15/15 pass)
  - `supabase/tests/cad_retention_and_rights.sql` (18/18 pass)
- **Live Verification Scripts:**
  - `node scripts/verify-audit-chain.mjs` (all 6 chains pass)
  - `node scripts/verify-phase6-canary.mjs` (0 plaintext leaks)
  - `node scripts/check-leak-proofs.mjs` (5/5 steps pass)
  - `node scripts/check-commercial-overlay.mjs` (4/4 steps pass)
  - `node scripts/purge-retention.mjs` (dry-run succeeds)
- **Application Gates:**
  - `npm test -- --reporter=dot` (837 passed across 50 test files)
  - `npm run typecheck` (0 errors)
  - `npm run lint` (0 errors)
  - `npm run format:check` (clean)
  - `npm run check:rls` (29 relations verified)
  - `npm run check:cad-security` (clean)
  - `npm run release:check` (deliberate failure exit 1 pending counsel sign-off)
  - `npm run build` (clean)
  - `git diff --check` (clean)
