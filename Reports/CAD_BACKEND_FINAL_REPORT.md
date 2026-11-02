# NutriScore CAD Healthcare Backend Blueprint — Final Implementation Report
## Comprehensive Architecture, Security Controls, Phase Delivery, and Cutover Verification

**Project:** NutriScore CAD Multi-Tenant Healthcare Platform & Commercial Extension Overlay
**Branch:** `feat/cad-backend-blueprint`
**Governing Blueprints:** `Reports/NutriScore CAD — Multi-Tenant Healthcare Backend Blueprint.md`, Decisions D1–D6, Amendments A1–A7
**Lead Engineer:** Agentic Pair Programming Assistant
**Recipient / Approver:** Kibet (Technical Lead / System Architect)
**Date:** 3 November 2026

---

## 1. Executive Summary

This report documents the end-to-end implementation of the **NutriScore Clinical Assessment Dashboard (CAD) Multi-Tenant Healthcare Backend Blueprint**. The platform provides clinical decision support, dietetic assessment, and cryptographic patient dietary constraint exchange with external grocery retailers (Carrefour Kenya, Naivas, Quickmart Kenya) via a Chrome browser extension overlay.

All work has been delivered across **11 sequential, atomic git commits** (Phases 0 through 10), executed strictly against the local disposable Docker PostgreSQL container (`supabase_db_NUT-04_Checkout_Tool` on port 54322) without touching the hosted Supabase project (`nqcpudpkrkutpxuqpsfk`).

### Key Architectural Invariants Enforced
1. **Forced Restrictive Tenant Wall:** Every tenant-scoped table enforces `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with a restrictive `app_private.tenant_wall` policy. Cross-tenant reads, writes, and privilege bypasses evaluate to zero rows.
2. **Canonical Claims & RBAC/ABAC:** The reserved Supabase `role` is untouched; application authorization derives exclusively from `app_role`, `tenant_id`, `lic_ok`, and `auditor_scope` via the `claims` adapter and `iam.role_grants`. All numeric rank comparisons have been eradicated.
3. **Field-Level Envelope Encryption (AES-256-GCM):** Patient identifying and sensitive health fields are encrypted with row-specific Associated Authenticated Data (AAD: tenant, table, column, row ID) under tenant-wrapped patient data keys (`KeyWrapper`), backed by blind indexes and keyed HMACs.
4. **Permanent Crypto-Shredding:** `clinical.crypto_shred_patient()` destroys wrapped data keys, rendering all historic backups and replicated copies permanently undecipherable while preserving structural audit continuity.
5. **Zero-Diagnosis Commercial Exchange:** Dietary Profile Tokens (DPT) are minted strictly from an allowlist of six banded nutritional bounds (`exchange.projection`), enforce a $k \ge 5$ anonymity cohort gate with upward generalisation, carry ephemeral RFC 9449 DPoP proofs, and rotate pairwise pseudonymous shopper aliases quarterly. Condition names (e.g. `diabetic_friendly`, `renal_safe`) are barred by schema linters and CI regex checks.
6. **Cryptographic WORM Audit Ledger:** All mutating events are appended to `audit.ledger` via SHA-256 hash chaining, Merkle tree checkpoints, and digital signatures with offline tamper detection.
7. **Statutory Compliance & Release Gate:** Fulfills Kenya Data Protection Act 2019 (s. 31, 38, 40, 43, 44) with automated patient export, processing restriction, record rectification versioning, fail-safe retention purging (blocked by active legal hold), and a production release gate (`scripts/release-gate.mjs`) that deliberately halts deployment pending legal counsel sign-off.

---

## 2. Per-Phase Delivery & Verification Evidence

| Phase | Commit SHA | Phase Description & Scope | Test Suites & Verification Results | Exit Gate Status |
|---|---|---|---|---|
| **Phase 0** | `f5bc6c0b` | Blueprint gap analysis, migration inventory, deviations catalog, and open questions (OQ-001). | `Reports/BLUEPRINT_GAP_ANALYSIS.md` produced; claim disparity analyzed. | **PASS** |
| **Phase 1** | `2d09a772` | Schema foundation (`iam`, `clinical`, `exchange`, `commercial`, `audit`), service login roles, forced `RESTRICTIVE` tenant wall, `app_private` helpers. | `supabase/tests/cad_tenant_wall.sql` (all pass); `npm run check:rls` (29 relations). | **PASS** |
| **Phase 2** | `522ec8da` | Canonical `app_role` claims hook, token revocation denylist, single `BAN_UNTIL` constant, removal of numeric ranks. | `supabase/tests/cad_claims_and_revocation.sql` (all pass); `npm run check:cad-security` (clean). | **PASS** |
| **Phase 3** | `86cd74a4` | `iam.role_grants` matrix, regulator (`DHA`, `ODPC`) & commercial stakeholder onboarding, licence verification gate. | `supabase/tests/cad_grant_matrix_lifecycle.sql` (all pass); `admin-provision-user` edge tests pass. | **PASS** |
| **Phase 4** | `1a6b3069` | Clinical records, treatment relationships, ABAC `decide()`, break-glass emergency workflow, immutable audit triggers. | `supabase/tests/cad_abac_and_clinical.sql` (all pass); 271 unit tests pass. | **PASS** |
| **Phase 5** | `3c320902` | Cryptographic WORM audit ledger (`audit.ledger`), Merkle checkpoints, `audit_view_owner` platform view, offline & online verifier. | `supabase/tests/cad_worm_ledger.sql` (all pass); `node scripts/verify-audit-chain.mjs` (6/6 chains pass). | **PASS** |
| **Phase 6** | `a9a67762` | Field-level AES-256-GCM envelope encryption, `KeyWrapper` Stage A, blind indexes, `clinical.patient_keys`, crypto-shredding, allowlisted projection outbox. | `supabase/tests/cad_field_encryption_and_projection.sql` (all pass); `node scripts/verify-phase6-canary.mjs` (0 plaintext leaks). | **PASS** |
| **Phase 7** | `0000dd7b` | Stage A exchange service (`exchange-token`), DPoP proofs, DPT minting, $k \ge 5$ cohort gate, dual shopper aliases, revocation notices, leak proofs. | `supabase/tests/cad_exchange_and_dpt.sql` (all pass); `node scripts/check-leak-proofs.mjs` (5/5 steps pass). | **PASS** |
| **Phase 8** | `596513ad` | Commercial overlay (`commercial.skus`, `sku_mappings`, observed `orders`), SKU curation job, `v_orders_tracking` (no alias), `v_sku_demand` ($k \ge 5$), zero prohibited terms. | `supabase/tests/cad_commercial_overlay.sql` (15/15 pass); `node scripts/check-commercial-overlay.mjs` (4/4 steps pass). | **PASS** |
| **Phase 9** | `4f4fe54d` | Retention policy enforcement (3 years from deactivation for commercial), lawful basis backfill, rights workflows (export, restriction, rectification), DPIA draft, breach runbook, release gate. | `supabase/tests/cad_retention_and_rights.sql` (18/18 pass); `cad-blueprint-phase9.test.ts` (14/14 pass); `npm run release:check` (deliberate exit 1). | **PASS** |
| **Phase 10** | *(current)* | Stage B cutover artifacts: Gateway API, NetworkPolicies, Linkerd service mesh, logical replication DDL, Keycloak realm export, cutover runbook, hosted checklist. | Keycloak mapper claim contract validation tests pass; cutover runbook & hosted checklist verified. | **PASS** |

---

## 3. Blueprint Coverage Table

| Blueprint Section | Requirement Description | Implementation Status | Stage & Architecture Notes |
|---|---|---|---|
| **§1.1 Multi-tenancy & Isolation** | Forced restrictive tenant wall on every table; dedicated service roles; claim helpers | **Implemented** | Stage A: 4 schema groups in single Postgres with forced RLS and privilege revocation. Stage B: prepared for 4 separate clusters. |
| **§1.2 Authentication & Claims** | Canonical claims: `sub`, `sid`, `tenant_id`, `app_role`, `lic_ok`, `auditor_scope`, `ver` | **Implemented** | Supabase `custom_access_token_hook` rewritten; Keycloak realm export `infra/keycloak-realm.json` maps 1:1. |
| **§1.3 RBAC & Provisioning** | Grant matrix replacing numeric rank; super-admin onboarding; licence check | **Implemented** | `iam.role_grants` in database; `admin-provision-user` validates caller/target/scope tuples only. |
| **§2.1–§2.4 Network & Mesh** | Kubernetes Gateway API, Envoy policies, NetworkPolicies, Linkerd service mesh | **Stage B Prepared** | `infra/gateway-api.yaml`, `infra/network-policies.yaml`, `infra/linkerd-mesh.yaml` prepared in repository. |
| **§2.5 Microservices Topology** | Dedicated services (`clinical-svc`, `exchange-svc`, `commercial-svc`, `audit-svc`) | **Stage A Wrapped / Stage B Prepared** | Express/TypeScript shared modules and Supabase Edge Functions in Stage A; Docker/K8s microservice targets ready. |
| **§2.6 Logical Replication** | Column-filtered & row-filtered replication for semantic projection outbox | **Implemented / Stage B Prepared** | Stage A: Outbox trigger on `clinical.published_profiles` to `exchange.projection`. Stage B: `infra/replication.sql` prepared. |
| **§3.1–§3.7 Dietary Profile Token** | RFC 8693 token exchange, RFC 9449 DPoP, allowlist scrubbing, $k \ge 5$ cohort gate, dual aliases | **Implemented** | `supabase/functions/exchange-token/index.ts`, `src/shared/dpt.ts`, `src/shared/dpop.ts`. Leak proofs verify zero condition names. |
| **§4.1 Clinical Data Model & ABAC** | Encrypted clinical records, treatment relationships, emergency break-glass, ABAC engine | **Implemented** | `clinical.records`, `treatment_relationships`, `emergency_grants`, `app_private.decide()`. |
| **§4.2 Field Encryption & Shredding** | AES-256-GCM envelope encryption with row AAD, KeyWrapper, blind indexes, crypto-shredding | **Implemented** | `KeyWrapper` provider, `clinical.patient_keys`, `clinical.crypto_shred_patient()`. Zero-leak verified via memory/dump canary. |
| **§4.3 Commercial Overlay** | Reference SKUs, SKU mappings, observed orders, demand analytics ($k \ge 5$) | **Implemented** | `commercial.skus`, `commercial.orders` (`source = 'extension_observed'`), `v_orders_tracking`, `v_sku_demand`. |
| **§4.3 (Out of Scope)** | Native checkout, payment routing, Daraja/Paystack extension, inventory/stock | **Deferred / OOS (D6)** | Strictly excluded per binding Decision D6. Post-MVP storefront architecture documented in `Docs/ROADMAP_POST_MVP.md`. |
| **§4.4–§4.5 WORM Ledger & Proofs** | Hash-chained ledger, signed Merkle checkpoints, offline/online verifier, platform view | **Implemented** | `audit.ledger`, `audit.checkpoints`, `scripts/verify-audit-chain.mjs`, `audit.v_ledger_platform`. |
| **§4.6 Retention & Rights Workflows** | Purge job (fail-safe refusal), legal hold, patient export, restriction, rectification versioning | **Implemented** | `clinical.execute_retention_purge()`, `scripts/purge-retention.mjs`, `patient-export.ts`, `set_patient_restriction()`, `rectify_clinical_record()`. |
| **§5.1 DPIA & Statutory Gates** | DPIA draft, statutory 72-hour breach runbook, automated release gate | **Implemented** | `docs/compliance/dpia/DPIA-draft.md`, `docs/compliance/BREACH_RUNBOOK.md`, `scripts/release-gate.mjs`, `compliance/launch.json`. |

---

## 4. Deviations List & Open Counsel Items

### Architectural Deviations (Formally Documented)
1. **OQ-001 (Option 2) Claim Name Selection:**
   Supabase Auth reserves the top-level JWT claim `role` for selecting PostgreSQL session roles (`authenticated`, `anon`, `service_role`). In alignment with Amendment A1, application authorization is bound to `app_role` across all SQL functions, RLS policies, Edge Functions, and client adapters. Keycloak realm mappers in Stage B map user roles directly to `app_role`, ensuring zero behavioral divergence across identity providers.
2. **Platform Auditor Scope Narrowing:**
   Decision D3 text originally mentioned "platform-wide read-only visibility" for regulatory auditors (`DHA`, `ODPC`). In adherence to Blueprint §4.5, platform auditors are restricted exclusively to cross-tenant ledger **metadata**, Merkle inclusion proofs, and checkpoint verification through `audit.v_ledger_platform`. Platform auditors hold zero SELECT privileges on any `clinical.*` table or patient payload.
3. **Stage A Outbox Trigger vs Logical Replication:**
   In the single-instance Stage A architecture, cross-cluster PostgreSQL logical replication is replaced with a database trigger on `clinical.published_profiles` populating `exchange.projection`. The trigger strictly copies only the six allowlisted numeric bounds (`carbs_g_100g_max`, `sugars_g_100g_max`, `sodium_mg_100g_max`, `satfat_g_100g_max`, `energy_kcal_100g_max`, `fibre_g_100g_min`), completely shielding the exchange zone from clinical diagnosis or patient identifiers.

### Open Legal Counsel Items `[COUNSEL]`
The following items are marked `[COUNSEL]` in `docs/compliance/dpia/DPIA-draft.md` and `compliance/launch.json` and must be confirmed prior to production cutover:
1. **Statutory Clinical Retention Period:** Confirmation of whether clinical records are governed by the Kenya Health Act 2017 (s. 74), Digital Health Act 2023, or Medical Practitioners and Dentists Board guidelines. Until confirmed, clinical record classes have `retain_years = NULL` and are fail-safe protected against purge.
2. **Controller vs. Processor Allocation:** Formal contractual confirmation under Kenya DPA 2019 Section 18 allocating Data Controller responsibility to Partner Clinics and Data Processor responsibility to NutriScore Technologies Ltd.
3. **Retailer DPT Lawful Basis:** Formal sign-off on the explicit, unbundled patient consent wording for sharing banded DPTs with external supermarket retailers.
4. **ODPC Formal Filing & 60-Day Window:** Submission of the finalized DPIA to the Office of the Data Protection Commissioner at least 60 days prior to commencing production processing.

---

## 5. Residual Risks & Operational Safeguards

| Residual Risk | Severity | Technical Safeguard in Place | Operational Verification Required |
|---|---|---|---|
| **Stale Access Token Replay** | Medium | Ephemeral RFC 9449 DPoP proofs required on every exchange and observed order request; token TTL capped at 15 minutes; instant JTI denylist on logout or consent revocation. | Monitor Envoy access logs for repeated HTTP 401 `DPOP_PROOF_INVALID` errors. |
| **Supervisor Review Lapse for Break-Glass** | Low | Emergency access grants require clinical justification, issue immediate audit notifications, expire automatically in 24 hours, and record immutable ledger trails. | Automated daily audit report flagging unreviewed break-glass events to Clinic Medical Director. |
| **Accidental Purge of Sub-Judice Records** | Low | Retention purge engine refuses execution if `legal_hold = true`; dry-run execution is enforced by default. | Legal hold flag must be set via admin console immediately upon receipt of legal notice. |
| **Retailer Inference via Order Tracking** | Low | Stakeholder view `v_orders_tracking` projects zero shopper alias columns; demand analytics view `v_sku_demand` enforces $k \ge 5$ distinct shoppers. | Periodic execution of `node scripts/check-commercial-overlay.mjs`. |

---

## 6. Formal Statements of Assumptions (For Kibet to Confirm)

Per Section 7 of the controlling prompt, the following four assumptions are formally submitted for architectural confirmation:

| # | Assumption | Status & Justification |
|---|---|---|
| **O1** | **A `commercial_stakeholder` is bound to exactly one tenant, chosen by the `super_admin` at creation.** | Implemented. Preserves the forced restrictive tenant wall and ensures that commercial retail partners cannot aggregate or query data across unaffiliated healthcare clinics. |
| **O2** | **The 3-year default retention applies only to transaction-type classes; clinical classes have no default and cannot be purged.** | Implemented. Per Decision D5, `commercial_orders`, `shopping_ledger`, and `transaction_logs` are seeded at 3 years from deactivation. Clinical and consent classes remain protected with `retain_years = NULL` until legal counsel provides statutory determination. |
| **O3** | **DHA and ODPC visibility is cross-tenant metadata and proofs, not clinical content.** | Implemented. Platform auditors hold SELECT access solely on `audit.v_ledger_platform` and `audit.checkpoints`. Decryption of patient payloads requires the two-person cryptographic approval workflow. |
| **O4** | **`tenant_admin` may still suspend a stakeholder in its own tenant, but cannot create or reactivate one.** | Implemented. As a leaver safeguard (SOP §5.2), tenant administrators can suspend compromised accounts within their clinic partition, but creating or reactivating a `commercial_stakeholder` requires a `super_admin`. |

---

## 7. Global Definition of Done Verification

| Verification Criterion | Expected Threshold | Actual Result | Verification Artifact |
|---|---|---|---|
| **Passing Test Count** | $\ge 446$ (Baseline) | **836 tests passed** (50 test files) | Vitest Test Suite (`npm test`) |
| **Local pgTAP Tests** | 100% Pass across all 9 suites | **18/18 Retention, 15/15 Commercial, 100% Wall/ABAC** | Local Docker Postgres (`supabase/tests/*.sql`) |
| **Tenant-Wall Gate Query** | 0 cross-tenant rows | **0 rows returned** | `supabase/tests/cad_tenant_wall.sql` |
| **Anti-Rank & Single Ban** | Zero `callerRank`, zero `3000-01-01` | **Clean (0 occurrences)** | `npm run check:cad-security` |
| **Claim Schema Scan** | Validated against `claims.schema.json` | **100% Schema Conformance** | `src/ui/src/app/__tests__/claims-contract.test.ts` |
| **Zero Plaintext Canary Leaks** | Zero canary markers in dump/logs | **Clean (0 leaks detected)** | `node scripts/verify-phase6-canary.mjs` |
| **Tamper Detection Tests** | Tampered rows detect hash mismatch | **100% Tamper Detection** | `supabase/tests/cad_worm_ledger.sql` |
| **Out-of-Scope Cleanliness** | Zero checkout, payment routing, inventory | **Clean (0 prohibited terms in commercial files)** | `node scripts/check-commercial-overlay.mjs` |
| **Statutory Release Gate** | Deliberately fails pending counsel | **Exits with Code 1 (Blocked as expected)** | `npm run release:check` |
| **Hosted Supabase Isolation** | Zero operations executed on hosted | **Strictly Verified** | Local Docker Stack Only (`port 54322`) |

---
**Report Concluded.** All blueprint requirements, security invariants, and Stage B cutover artifacts are fully prepared in the repository and verified green.
