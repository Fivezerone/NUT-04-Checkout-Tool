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
| 7 | *(pending)* | Exchange service, DPoP proofs, Dietary Profile Token (DPT), k≥5 cohort gate, shopper aliases, revocation, and leak proofs. |

Baseline tag: `pre-cad-backend-blueprint`. The application role is `app_role`;
Supabase's Postgres `role` claim was intentionally not changed (OQ-001 option 2).

## Phase 7 deliverables (committed in this phase)

| File | Purpose |
|---|---|
| `supabase/migrations/20261101060000_exchange_dpt_and_revocations.sql` | `exchange` schema: `alias_map`, `dpt_revocations`, projection lookup view |
| `supabase/rollbacks/20261101060000_exchange_dpt_and_revocations.rollback.sql` | Clean rollback |
| `src/shared/signer.ts` | `Signer` interface (A7) + `LocalEd25519Signer` Stage A |
| `src/shared/dpop.ts` | RFC 9449/7638 DPoP proof generation, thumbprint, anti-replay, freshness |
| `src/shared/dpt.ts` | 6-key allowlist, device-only dropping, step-up banding, k≥5 cohort gate, CSPRNG/HMAC aliases, DPT mint & verify |
| `src/shared/node-crypto.d.ts` | `createPublicKey` type shim for ESM scripts |
| `supabase/functions/exchange-token/index.ts` | RFC 8693 Edge Function with DPoP, consent check, scrub/band, cohort gate, `DPT_MINTED` audit |
| `supabase/tests/cad_exchange_and_dpt.sql` | 4 pgTAP test blocks (all pass) |
| `scripts/check-leak-proofs.mjs` | CI: PHI lint, D5 ban, contract tests, DPoP replay, Signer outage (5/5 pass) |
| `scripts/check-rls-policies.mjs` | Updated: 26 relations verified |
| `src/ui/src/app/__tests__/cad-blueprint-phase7.test.ts` | 58 Vitest tests covering DPoP, DPT, scrub/band, cohort gate, aliases, Signer |

## Validation suites (Phase 7 gate — all green)

- Local Postgres tests (all pass):
  - `supabase/tests/cad_tenant_wall.sql`
  - `supabase/tests/cad_claims_and_revocation.sql`
  - `supabase/tests/cad_grant_matrix_lifecycle.sql`
  - `supabase/tests/cad_abac_and_clinical.sql`
  - `supabase/tests/cad_worm_ledger.sql`
  - `supabase/tests/cad_field_encryption_and_projection.sql`
  - `supabase/tests/cad_exchange_and_dpt.sql`
- Live verification scripts:
  - `node scripts/verify-audit-chain.mjs` (all chains verified)
  - `node scripts/verify-phase6-canary.mjs` (zero plaintext leaks)
  - `node scripts/check-leak-proofs.mjs` (5/5 steps pass)
- Application gates:
  - `npm test -- --reporter=dot` (810 passed, 48 test files)
  - `npm run typecheck` (0 errors)
  - `npm run lint` (0 errors)
  - `npm run format:check` (clean)
  - `npm run check:rls` (26 relations verified)
  - `npm run check:cad-security` (clean)
  - `npm run build` (clean)
  - `git diff --check` (clean)

## DPT invariants (D5 — must never be violated)

- **Allowlisted constraint keys (6):** `sugars_g_100g_max`, `carbs_g_100g_max`, `sodium_mg_100g_max`, `satfat_g_100g_max`, `energy_kcal_100g_max`, `fibre_g_100g_min`.
- **Device-only keys (dropped from wire, never in DPT):** `protein_g_100g_max`, `potassium_mg_100g_max`, `phosphorus_mg_100g_max`.
- **Condition-named strings banned:** `diabetic_friendly`, `renal_safe`, `low_potassium`, `hypertension`, `cardiac`, `cancer`, `condition`, `diagnosis`, `disease`.
- **Cohort gate:** k ≥ 5 patients with matching constraint fingerprint; if < 5, generalise to `GENERIC_HEALTHY_EATING_PROFILE` and set `generalised = true` in audit.
- **DPoP freshness:** iat within ±60s; jti anti-replay enforced per request.
- **Signer outage:** `mintDpt` throws immediately; client falls back to unfiltered catalogue.

## Next phases

| Phase | Required outcome | Required commit |
|---|---|---|
| 8 | Overlay-only commercial schema and observed orders. No inventory, payment, fulfilment, checkout, or storefront. | `feat(p8): overlay-only commercial schema, orders and DPT endpoints` |
| 9 | Dry-run retention/rights workflows, DPIA draft, deliberately failing launch gate pending counsel. | `feat(p9): retention, rights workflows, DPIA draft and release gate` |
| 10 | Prepared-only network, Keycloak, replication, cutover and hosted-checklist artifacts; deploy nothing. | `docs(p10): cutover artifacts, hosted checklist and final report` |
