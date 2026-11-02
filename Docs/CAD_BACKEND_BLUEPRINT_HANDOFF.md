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
| 8 | *(pending)* | Overlay-only commercial schema, reference SKUs curation, observed orders, demand analytics (k≥5), and DPT endpoints. |

Baseline tag: `pre-cad-backend-blueprint`. The application role is `app_role`;
Supabase's Postgres `role` claim was intentionally not changed (OQ-001 option 2).

## Phase 8 deliverables (committed in this phase)

| File | Purpose |
|---|---|
| `supabase/migrations/20261101070000_commercial_overlay_and_observed_orders.sql` | `commercial` schema: `skus`, `sku_mappings`, observed `orders`, `order_lines`, `v_orders_tracking`, `v_sku_demand` |
| `supabase/rollbacks/20261101070000_commercial_overlay_and_observed_orders.rollback.sql` | Clean rollback |
| `scripts/curate-commercial-skus.mjs` | Platform SKU curation job ingesting Carrefour Kenya, Naivas, and Quickmart Kenya |
| `scripts/check-commercial-overlay.mjs` | Phase 8 CI guard: alias exclusion, k≥5 cohort gate, zero prohibited terms |
| `scripts/check-rls-policies.mjs` | Updated: 29 relations verified |
| `src/shared/commercial-catalogue.ts` | Shared catalogue nutritional evaluation against DPT constraints |
| `supabase/functions/observed-orders/index.ts` | DPT-authenticated observed orders ingestion |
| `supabase/functions/catalogue/index.ts` | DPT-authenticated catalogue filtering endpoint |
| `src/extension/observed-orders-sync.js` | Extension client for syncing observed carts with DPT + DPoP |
| `Docs/ROADMAP_POST_MVP.md` | Post-MVP storefront architecture & schema support |
| `supabase/tests/cad_commercial_overlay.sql` | pgTAP test suite (15 tests, all pass) |
| `src/ui/src/app/__tests__/cad-blueprint-phase8.test.ts` | Vitest test suite (12 tests, all pass) |

## Validation suites (Phase 8 gate — all green)

- Local Postgres tests (all pass):
  - `supabase/tests/cad_tenant_wall.sql`
  - `supabase/tests/cad_claims_and_revocation.sql`
  - `supabase/tests/cad_grant_matrix_lifecycle.sql`
  - `supabase/tests/cad_abac_and_clinical.sql`
  - `supabase/tests/cad_worm_ledger.sql`
  - `supabase/tests/cad_field_encryption_and_projection.sql`
  - `supabase/tests/cad_exchange_and_dpt.sql`
  - `supabase/tests/cad_commercial_overlay.sql` (15/15 pass)
- Live verification scripts:
  - `node scripts/verify-audit-chain.mjs` (all chains verified)
  - `node scripts/verify-phase6-canary.mjs` (zero plaintext leaks)
  - `node scripts/check-leak-proofs.mjs` (5/5 steps pass)
  - `node scripts/check-commercial-overlay.mjs` (4/4 steps pass)
- Application gates:
  - `npm test -- --reporter=dot` (822 passed, 49 test files)
  - `npm run typecheck` (0 errors)
  - `npm run lint` (0 errors)
  - `npm run format:check` (clean)
  - `npm run check:rls` (29 relations verified)
  - `npm run check:cad-security` (clean)
  - `npm run build` (clean)
  - `git diff --check` (clean)

## Commercial overlay invariants (D6 / A6 — strictly observed)

- **No inventory / stock:** `commercial.inventory` and `on_hand` logic are omitted per D6.
- **Observed events only:** `commercial.orders` and `order_lines` record cart sync events from extension (`source = 'extension_observed'`), not transaction routing.
- **Stakeholder alias redaction:** `v_orders_tracking` exposes no shopper alias.
- **k ≥ 5 Demand aggregation:** `v_sku_demand` suppresses cells under 5 distinct shoppers.
- **Prohibited terms CI check:** Zero occurrences of prohibited terms in commercial files.

## Next phases

| Phase | Required outcome | Required commit |
|---|---|---|
| 9 | Dry-run retention/rights workflows, DPIA draft, deliberately failing launch gate pending counsel. | `feat(p9): retention, rights workflows, DPIA draft and release gate` |
| 10 | Prepared-only network, Keycloak, replication, cutover and hosted-checklist artifacts; deploy nothing. | `docs(p10): cutover artifacts, hosted checklist and final report` |
