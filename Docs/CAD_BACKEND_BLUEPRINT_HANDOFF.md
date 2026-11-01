# NutriScore CAD Backend Blueprint — Continuation Directive

**Prepared:** 1 November 2026
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

Baseline tag: `pre-cad-backend-blueprint`. The application role is `app_role`;
Supabase's Postgres `role` claim was intentionally not changed (OQ-001 option 2).

## Phase 4 files to review, test, and commit

- `supabase/migrations/20261101030000_clinical_core_and_abac.sql`
- `supabase/rollbacks/20261101030000_clinical_core_and_abac.rollback.sql`
- `supabase/tests/cad_abac_and_clinical.sql`
- `supabase/tests/cad_claims_and_revocation.sql`
- `supabase/functions/break-glass/index.ts`
- `supabase/functions/publish-bundle/index.ts`
- `supabase/functions/_shared/authz.ts`
- `src/shared/authz.ts`
- `src/ui/src/app/__tests__/cad-blueprint-phase4.test.ts`
- `scripts/check-cad-security.mjs`
- `scripts/check-rls-policies.mjs`
- `Docs/BLUEPRINT_DEVIATIONS.md`
- `Docs/CAD_BACKEND_BLUEPRINT_HANDOFF.md`

Required commit message:

```text
feat(p4): treatment relationships, ABAC policies, break-glass and clinical core
```

## Phase 4 implementation contract

1. **Clinical core schema:** `clinical.patients`, `treatment_relationships`,
   `tag_vocabulary`, `dietary_tags`, `clinical_records`, `clinical_advice`,
   `consent_records`, `emergency_grants`, `retention_policies`, and
   `published_profiles`.
2. **Treatment relationships:** GiST exclusion constraint enforces at most one
   active primary clinician per patient at any moment. `has_relationship`
   re-reads `iam.members.status` and `licence_verified` on every query, ensuring
   immediate access loss on suspension.
3. **Append-only records:** `clinical.clinical_records` has no UPDATE or DELETE
   policies, and is protected by a statement-level trigger denying mutations.
4. **Break-glass emergency grants:** Strictly read-only, time-boxed to ≤ 24
   hours via database check constraint, auto-expiring without relying on cron,
   and audited under `BREAK_GLASS_*` actions.
5. **ABAC policy engine:** Shared `decide()` implements ordered first-deny-wins
   algorithm across 7 roles, 12 resources, classification clearance,
   relationship checks, consent, and step-up authentication. Generic 403
   responses to clients; detailed reasons logged to audit ledger.
6. **Retention and lawful basis:** Seeded 3-year commercial deactivation
   retention per D5/A2; lawful basis array per A3.

## Validation suites

- Local Postgres tests:
  - `supabase/tests/cad_tenant_wall.sql`
  - `supabase/tests/cad_claims_and_revocation.sql`
  - `supabase/tests/cad_grant_matrix_lifecycle.sql`
  - `supabase/tests/cad_abac_and_clinical.sql`
- Application gates:
  - `npm test -- --reporter=dot` (737 passed)
  - `npm run typecheck` (0 errors)
  - `npm run lint` (0 errors)
  - `npm run format:check` (clean)
  - `npm run check:rls` (23 relations verified)
  - `npm run check:cad-security` (clean)
  - `npm run build` (clean)
  - `git diff --check` (clean)

## Next phases

| Phase | Required outcome | Required commit |
|---|---|---|
| 5 | Hash-chained signed WORM ledger, checkpoints, metadata-only platform view, anchor seam. Freeze, do not delete, legacy audit. | `feat(p5): hash-chained signed ledger with anchored checkpoints` |
| 6 | KeyWrapper, encrypted fields/blind indexes/MACs, crypto-shred, allowlisted semantic projection/outbox. | `feat(p6): field-level encryption, crypto-shredding and semantic projection` |
| 7 | Exchange DPT with consent, k≥5 generalization, DPoP, aliases, revocation, leak proofs. | `feat(p7): exchange service, dietary profile token and leak proofs` |
| 8 | Overlay-only commercial schema and observed orders. No inventory, payment, fulfilment, checkout, or storefront. | `feat(p8): overlay-only commercial schema, observed orders and DPT endpoints` |
| 9 | Dry-run retention/rights workflows, DPIA draft, deliberately failing launch gate pending counsel. | `feat(p9): retention, rights workflows, DPIA draft and release gate` |
| 10 | Prepared-only network, Keycloak, replication, cutover and hosted-checklist artifacts; deploy nothing. | `docs(p10): cutover artifacts, hosted checklist and final report` |
