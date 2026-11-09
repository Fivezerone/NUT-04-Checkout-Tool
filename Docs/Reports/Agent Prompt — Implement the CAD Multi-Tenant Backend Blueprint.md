# Agent Prompt — Implement the CAD Multi-Tenant Backend Blueprint

Prepared for Kibet · NUT-04 · 31 October 2026

## 1. Role, authority and operating rules

You are a Staff Security and Platform Engineer in the NUT-04 repository (NutriScore Checkout Tool: Manifest V3 Chrome extension, React/Vite UI, Supabase backend). Implement the **NutriScore CAD — Multi-Tenant Healthcare Backend Blueprint** (NUT-04 Checkout Tool\Reports\NutriScore CAD — Multi-Tenant Healthcare Backend Blueprint)end to end, applying the engineer decisions D1–D6 in section 2 and the amendments A1–A7 in section 3.

**Order of authority when sources conflict**

1. The blueprint, plus amendments A1–A7 (they are part of it).
2. Decisions D1–D6.
3. `NUT-04 Checkout Tool\Reports\IDENTITY_PROVISIONING_SOP.md` and `NUT-04 Checkout Tool\Reports\/CAD_ROLLBACK_FINAL_REPORT.md`, for existing behaviour.
4. The current code.

Where the blueprint and a decision differ, the blueprint wins; D1–D6 already say how. Record every deviation and every judgement call in `docs/BLUEPRINT_DEVIATIONS.md` with its reason. If the blueprint file is missing, stop and ask. Do not reconstruct it from memory.

**Operating rules**

1. Branch `feat/cad-backend-blueprint` the main branch. Tag the starting commit `pre-cad-backend-blueprint`.
2. One commit per phase (section 4), using the given message. Each phase ends with `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:rls` and `npm run build` all green. The passing-test count never drops below the 446 at the rollback baseline.
3. **Never touch the hosted Supabase project** (`nqcpudpkrkutpxuqpsfk`). Local stack only. Anything that must run on hosted goes into the operational checklist (phase 10), never into a script you run.
4. No hard deletes of clinical or audit data. No plaintext PHI in logs, snapshots, fixtures or error messages. No secrets in the repo; local keys come from `.env.local` (gitignored).
5. Migrations are numbered from `20261101000000`, idempotent where possible, and each ships a rollback file in `supabase/rollbacks/`. Never drop a table that holds data without a documented copy-and-verify step.
6. Mock data stays on the RFC 2606 `.test` domain, and `node scripts/purge-mocks.mjs --check-clean` must still pass.
7. Stop and report when you hit a trigger in section 6. Do not guess.
8. Build nothing that D6 puts out of scope.

## 2. Binding decisions (D1–D6)

### D1 — `commercial_stakeholder` onboarding: `super_admin` only

- Creating a `commercial_stakeholder`, reactivating one, and changing any account into or out of that role all require a `super_admin`. `tenant_admin` loses every one of those powers. Suspension stays available to `tenant_admin` inside its own tenant as a leaver safeguard (SOP §5.2). Log that as a judgement call.
- In `iam.role_grants`: **delete** `('tenant_admin','commercial_stakeholder','tenant')` and **add** `('super_admin','commercial_stakeholder','platform')`.
- The account is still created with exactly one `tenant_id`, chosen by the `super_admin`, so the tenant wall and k ≥ 5 suppression apply unchanged. This is assumption **O1**; report it.
- Add `iam.members.partner_org text` (the commercial partner’s legal entity name), required by CHECK for this role.
- Audit action `PROVISION_COMMERCIAL_STAKEHOLDER` records the approving `super_admin` and `partner_org`.
- Update the SOP (§2.1 and §3) to match.
- Tests: a `tenant_admin` attempt through the Edge Function, any RPC and the CAD UI returns a generic 403 and writes `AUTHZ_DENY` with reason `GRANT_MATRIX`; the `super_admin` path succeeds; the CAD UI shows the option only in the super-admin console.

### D2 — The grant matrix replaces rank; one ban constant

- Remove every numeric rank comparison (`callerRank`, `targetRank`, `Rank(...)`) from SQL, Edge Functions, scripts and UI. Ranks may survive only as a display-order constant named `DISPLAY_ORDER` that nothing authorises from. Add a CI grep gate that fails on `callerRank`, `targetRank` and `3000-01-01`.
- Implement `iam.role_grants` as in blueprint 1.3, with D1 and D3 applied. It is the only source of provisioning authority.
- The ban constant is **`2099-01-01T00:00:00Z`**, defined once in SQL as `app_private.ban_until()` and once in `src/shared/constants.ts`, with a unit test asserting they are equal. Replace every `3000-01-01` (SOP §5.2, migrations, scripts).
- The decision says a token mapping to this value must be denied at the edge. A JWT never carries `banned_until`, so implement the intent this way, and do **not** invent a `banned_until` claim:
  1. **Issuance.** `custom_access_token_hook` refuses to issue when member status is `suspended` or `deactivated` or `auth.users.banned_until` is at or beyond the constant.
  2. **Tokens already issued** (5-minute lifetime). A revocation denylist keyed by `sid` and `sub` is checked by the shared Edge Function guard and, on every query, by `app_private.is_active_member()` inside RLS. At the Keycloak cutover the same denylist feeds Envoy Gateway (blueprint 1.2 rule 4 and 2.4).
- Tests: a deactivated user’s still-valid token is rejected by every Edge Function and by RLS on the next query; issuance fails; the two constants match.

### D3 — Platform auditors exist only for DHA and ODPC

- `compliance_auditor` with `auditor_scope = 'platform'` exists solely for the Digital Health Agency and the Office of the Data Protection Commissioner. Add `regulator_body text CHECK (regulator_body IN ('DHA','ODPC'))` on `iam.platform_members`, required by CHECK whenever the scope is platform. Any other platform-scope auditor insert must fail in the database.
- Only a `super_admin` provisions them, and each creation stores a `mandate_ref` (the regulator’s written request) and is audited.
- Their visibility is exactly blueprint 4.5: cross-tenant ledger **metadata** through `audit.v_ledger_platform`, checkpoints and inclusion proofs, and payload decryption only through the two-person approval workflow. The decision text says “platform-wide read-only visibility”; the blueprint narrows that to metadata, so the blueprint wins. Record it in the deviations file. No platform-auditor policy exists on any `clinical.*` table.
- Clinic-appointed auditors: created by `tenant_admin`, `auditor_scope = 'tenant'`, confined to their own chain.
- Add mock accounts `regulator.dha@platform.test`, `regulator.odpc@platform.test` and `partner.stakeholder@clinic.test` to `scripts/seed-mock-users.mjs`, and make the purge script cover them.

### D4 — Supabase Auth now, Keycloak at the sovereign-cloud cutover, nothing in between

Do **not** deploy Keycloak, a second identity provider or any bridge. Build so the cutover is configuration, not code.

1. `src/shared/claims.schema.json` defines the canonical claim contract from blueprint 1.2 (with A1). The Supabase hook output and the checked-in Keycloak mapper config (phase 10) are both validated against it in CI. The contract tests, not the word “identical”, are the proof of compatibility.
2. One `claims` adapter module is the only code that reads raw JWT claims, in the extension, the mobile companion app (if it is in this repo), Edge Functions and the UI. It maps Supabase names to canonical ones (`session_id` → `sid`, `aal` → `acr`) and exposes `{ sub, sid, tenantId, appRole, licOk, auditorScope, acr, ver }`.
3. An `AuthProvider` interface (clinic-credential sign-in, refresh, sign-out, current claims) with a `SupabaseAuthProvider`, and an `OidcCodePkceProvider` that is an interface plus contract tests only, with no network code. The extension must not regain the `identity` permission; the OIDC flow uses a first-party callback page and `externally_connectable` messaging (blueprint 1.2).
4. Controls the blueprint gives to Keycloak that Supabase cannot do (per-API audiences, WebAuthn, lightweight tokens) are listed in `docs/CUTOVER_IDENTITY.md` as Stage B. Stage A compensations: every Edge Function enforces its own role allowlist, and step-up (publishing a bundle, changing a role, break-glass) requires Supabase TOTP at `aal2`.
5. Prepare the cutover artifacts (realm export, mapper definitions, client list, event-listener spec) in phase 10 and deploy none of them.

### D5 — Retention, lawful basis, DPIA

**Retention**

- Seed `clinical.retention_policies` for the record classes `shopping_ledger`, `commercial_orders` and `transaction_logs` at **3 years counted from account deactivation** (`retain_from = 'deactivation'`, amendment A2), overridable by a clinical or legal hold.
- **Apply 3 years to nothing else.** `clinical_records`, `clinical_advice`, `consent_records` and the audit ledger get no default. The purge job refuses to purge any class without an explicit `retain_years` (fail-safe). Their values arrive only when counsel supplies the basis (blueprint R8, still open). Ledger rows are never purged; at the end of retention only payload keys are shredded.
- The purge job runs as a dry run by default, writes `RETENTION_PURGE_PLAN` to the ledger before acting, respects legal hold, and never touches a class without a policy.

**Lawful basis**

- Every consent records `lawful_basis = {contract, explicit_consent}` (A3), a specific `purpose`, and the policy version. Consent is specific per purpose, so DPT sharing is never bundled with another purpose.
- Explicit consent is the hard gate: no active `dietary_profile_sharing` consent means no DPT, whatever the contract basis. Withdrawal revokes live DPTs.
- **DPT content: the blueprint wins.** The decision quotes `["diabetic_friendly", "max_carbs_30g"]` as an example, but blueprint Phase 3 (R9) bans condition-named tags because they disclose the diagnosis by inference. Implement banded nutrient bounds only, for example `{ "carbs_g_100g_max": 30 }`, with device-only dimensions never sent. Add a CI test that fails if `diabetic_friendly`, `renal_safe`, `low_potassium` or any condition name appears in a DPT, fixture, log or commercial table. The “minimum necessary” requirement is met by the allowlist plus the cohort gate.

**DPIA** — build a launch gate, not a filing. You cannot file with the ODPC.

- `scripts/release-gate.mjs`, wired into `npm run release:check`, fails a production build unless `docs/compliance/dpia/DPIA-<version>.md` exists and `compliance/launch.json` holds `dpia.submitted_on`, `dpia.odpc_reference`, `dpia.counsel_signoff` and `planned_launch_on`, with `submitted_on` at least 60 days before `planned_launch_on`. ODPC guidance puts DPIA submission 60 days before high-risk processing begins; counsel confirms.
- Draft `docs/compliance/dpia/DPIA-draft.md` from the blueprint: processing description, data flows, necessity and proportionality, risks, and the control that answers each. Mark every counsel-dependent field `[COUNSEL]`.
- ODPC registration as controller or processor is a separate manual item on the launch checklist.

### D6 — Overlay-only MVP

In scope: scoring overlays on external grocery sites through the Chrome extension (and the mobile companion app, if it is in this repo), plus the clinical, exchange, commercial-reference and audit layers of the blueprint.

**Out of scope. Do not build or extend:** a native checkout, a payment routing layer, fulfilment or logistics, stock management, a `shop.` storefront. Consequences:

- Skip `commercial.inventory` and any `on_hand` logic (blueprint 4.3). Do not touch the archived Daraja and Paystack Edge Functions.
- `commercial.orders` and `order_lines` are **observed events** (the cart and checkout ledger synced from the extension), not transactions. Add `source text NOT NULL DEFAULT 'extension_observed'` (A6). No payment, address or fulfilment columns.
- `POST /v1/shop/orders` becomes `POST /v1/commerce/observed-orders`: DPT-authenticated, idempotent ledger ingestion. The Tier A catalogue-filter endpoint stays, because the overlay uses it.
- Record the first-party storefront in `docs/ROADMAP_POST_MVP.md`, noting which blueprint schema already supports it.

## 3. Amendments to the blueprint (part of it)

| # | Amendment | Why |
| --- | --- | --- |
| A1 | The application role claim is `app_role`, not `role`. `app_private.app_role()` reads `claims ->> 'app_role'`; wherever the blueprint says `role` for the claim, read `app_role` | Supabase reserves `role` to select the Postgres role. Inspect the existing `custom_access_token_hook` first and fix it if it overwrites `role` |
| A2 | `clinical.retention_policies` gains `retain_from text NOT NULL DEFAULT 'creation' CHECK (retain_from IN ('creation','deactivation'))`, and `retain_years` becomes nullable (NULL = purge forbidden) | D5 |
| A3 | `clinical.consent_records` gains `lawful_basis text[] NOT NULL` | D5 |
| A4 | `iam.platform_members.regulator_body` (D3) and `iam.members.partner_org` (D1) | D1, D3 |
| A5 | **Stage A topology.** Supabase is one Postgres, so the blueprint’s four clusters become four schema groups (`iam` + `clinical`, `exchange`, `commercial`, `audit`) with separate login roles and revoked cross-schema privileges. `exchange.projection` is fed by an outbox trigger from `clinical.published_profiles`, limited to the six allowlisted columns. Write everything so it can be split by schema and replaced by logical replication (blueprint 2.6) at cutover. A test asserts `svc_commercial` and `svc_exchange` hold no privilege on `clinical` or `iam`, and `svc_commercial` none on `exchange` | D4; blueprint 2.1 |
| A6 | `commercial.orders.source text NOT NULL DEFAULT 'extension_observed'`; no `commercial.inventory` | D6 |
| A7 | Three provider interfaces, each with a local Stage A implementation and a cutover target: `Signer` (Ed25519 for DPTs and ledger rows; local keys from env, then Vault transit), `KeyWrapper` (field-encryption key wrapping; local master key, then Vault or HSM) and `AnchorSink` (checkpoint anchoring; an Object-Lock-capable MinIO bucket in the local compose stack, then an S3-compatible Object-Lock bucket at a second site) | Lets phases 5–7 run without Vault; swap at cutover |

## 4. Execution plan

Implement DDL, policies, functions and flows exactly as the blueprint gives them, with A1–A7 applied. This plan fixes order, scope and proof. Do not start a phase until the previous phase’s exit tests pass.

### Phase 0 — Inventory and gap analysis (read-only)

- Produce `NUT-04 Checkout Tool\Reports\BLUEPRINT_GAP_ANALYSIS.md`: every shipped object (tables, functions, triggers, policies, Edge Functions, scripts, UI routes, extension and mobile modules) mapped to its blueprint counterpart, with an action of keep, move, wrap, replace or retire. Start from blueprint 5.3.
- Record the claim names the hook emits today; which UI and extension code reads each table directly (this decides what needs a compatibility view); whether the mobile companion app is in the repo; and the current RLS state of every table.
- Commit: `docs(p0): blueprint gap analysis and migration map`. Report only if a section 6 trigger fires.

### Phase 1 — Foundations and the tenant wall (blueprint 1.1, A5)

- Schemas, per-service login roles (`svc_clinical`, `svc_provisioning`, `svc_exchange`, `svc_commercial`, `svc_audit_writer`, `svc_audit_reader_tenant`, `svc_audit_reader_platform`, `audit_view_owner`, `migrator`) and `REVOKE ALL … FROM PUBLIC`.
- `app_private` helpers: `claims()`, `tenant_id()`, `app_role()` (A1), `uid()`, `is_active_member()`, `ban_until()`.
- Move shipped tables into their blueprint schemas where the gap analysis says so, using `ALTER TABLE … SET SCHEMA` plus a `security_invoker` compatibility view in `public` for anything the CAD UI or extension still reads. No client loses access mid-phase.
- `tenant_wall` RESTRICTIVE policy, `ENABLE` and `FORCE ROW LEVEL SECURITY` on every tenant-scoped table, old ones included.
- Extend `npm run check:rls` to the blueprint 1.1 gate query across `iam`, `clinical`, `exchange`, `commercial` and `audit`.
- pgTAP: two tenants × every role × every table × select, insert, update, delete, with zero cross-tenant rows. Plus the privilege test from A5.
- **Exit:** gate query returns zero rows; pgTAP green; CAD UI and extension smoke tests pass.
- Commit: `feat(p1): schemas, service roles, claim helpers and forced tenant wall`.

### Phase 2 — Claims, identity seam and the ban constant (D2, D4, A1)

- Rewrite `custom_access_token_hook` to emit the canonical claims: `tenant_id`, `app_role`, `lic_ok`, `auditor_scope` (auditors only) and `ver`. Nothing from the blueprint 1.2 “never in any token” list. Refuse issuance for inactive members.
- `claims.schema.json`, the `claims` adapter and its tests. Add a CI claim scan that fails if any issued token contains an email, name, phone, national ID, diagnosis, health mode, or a patient or clinician list.
- Denylist table and shared guard; the two `BAN_UNTIL` constants and their equality test; the CI greps from D2. Remove all rank logic.
- `AuthProvider`, `SupabaseAuthProvider`, and `OidcCodePkceProvider` contract tests (D4). Move the extension, the mobile app (if present) and the UI onto the adapter only.
- **Exit:** claim scan green; deactivated-token tests green; `3000-01-01` and `callerRank` absent; the manifest still has no `identity` permission.
- Commit: `feat(p2): canonical claims contract, auth provider seam and single ban constant`.

### Phase 3 — Provisioning and lifecycle (blueprint 1.3; D1, D2, D3)

- Create `iam.role_grants` with the D1 and D3 rows. Rewrite `admin-provision-user` (the blueprint’s `provisioning-svc` for Stage A) to authorise only through it: allowed if and only if `(caller.app_role, target.app_role, scope)` is a row; the target `tenant_id` equals the caller’s unless the scope is `platform`; a patient needs `tenant_id` and `primary_clinician_id`; a `super_admin` is never creatable through any API.
- Joiner, mover and leaver per SOP §3–§5: licence-verification gate, session purge on role change and on suspend or deactivate, `deactivate_tenant_member`, audit action names unchanged.
- `iam.platform_members` with the D3 CHECKs. A super-admin console in the CAD UI for tenant admins, commercial stakeholders and DHA/ODPC auditors; hide those options from tenant admins.
- `scripts/bootstrap-super-admin.mjs` writes to `iam.platform_members` and keeps its production-refusal gate. Extend the mock seeds (D3).
- Update the SOP: §2.1 (drop ranks, show the grant matrix), §3 (stakeholder and regulator joiner paths), §5.2 (`2099-01-01`).
- **Exit:** a test generated from the grant table: every unlisted (caller, target, scope) is denied, every listed one is allowed, cross-tenant is denied; session purge completes in under 5 seconds; mock seeds are idempotent.
- Commit: `feat(p3): grant-matrix provisioning, regulator and stakeholder onboarding`.

### Phase 4 — ABAC and the clinical core (blueprint 1.3, 4.2)

- `clinical.patients`, `treatment_relationships` (with the `btree_gist` exclusion), `clinical_records` (append-only: no UPDATE or DELETE policy), `clinical_advice`, `tag_vocabulary`, `dietary_tags`, `consent_records` (A3), `emergency_grants` (24-hour CHECK) and `retention_policies` (A2). Policies exactly as the blueprint: clinician select and insert, break-glass select, patient own published advice, dietician tags.
- Shared policy library `src/shared/authz` implementing the ordered `decide()` from blueprint 1.3, used by every Edge Function. Callers get a generic 403; the ledger gets the reason code.
- Break-glass endpoint and scheduler: invoked by the CMO or a senior tenant admin, step-up required, read-only, auto-expiring, with `BREAK_GLASS_*` events and a review state.
- Attach the existing `health_modes`, `health_mode_rules` and `target_bundles` to the relationship model. Publishing a bundle requires an active writing relationship, `licence_verified` and step-up.
- **Exit:** the blueprint 5.2 ABAC rows (no relationship, expired relationship, unlicensed writer, suspended member) are denied with the right reason; a revoked clinician loses reads on the next query; break-glass at hour 23 reads, at hour 25 is denied, and writes are always denied; the RBAC test generated from the blueprint 1.3 matrix (7 roles × resources × create, read, update) equals the matrix exactly.
- Commit: `feat(p4): treatment relationships, ABAC policies, break-glass and clinical core`.

### Phase 5 — The WORM audit ledger (blueprint 4.4–4.5, A7)

- `audit.ledger` and `audit.checkpoints` per the blueprint DDL. Keep the trigger name `trg_audit_log_tamper`. Per-tenant chains plus a platform chain; advisory-lock writer; keyed `payload_mac` commitments and encrypted `payload_enc`; `Signer`-signed rows; checkpoints every 1,000 events or 5 minutes, anchored through `AnchorSink`.
- The platform view and its roles exactly as the blueprint (`audit_view_owner`, `svc_audit_reader_platform`).
- Producers for the full event taxonomy (blueprint 4.4) through an outbox, so a business transaction and its audit event commit together. The Keycloak listener is a written spec only (D4). Enable `pgaudit` on the clinical schema if the local stack supports it; otherwise record the gap.
- Migrate `public.audit_log` into the new ledger by re-chaining under a documented cutover checkpoint. Keep the old table frozen and read-only.
- Upgrade `scripts/verify-audit-chain.mjs` to recompute hashes, verify signatures, check gapless `seq` and compare with anchored checkpoints. Add an offline verifier CLI that needs only public keys, and run the verifier every 15 minutes on the local scheduler.
- **Exit:** tamper, reorder, delete, gap and key-rotation tests behave as the blueprint 5.2 audit row requires; Object Lock refuses anchor deletion; a platform auditor cannot read `patient_ref` or any `payload_*` column.
- Commit: `feat(p5): hash-chained signed ledger with anchored checkpoints`.

### Phase 6 — Field encryption and the semantic projection (blueprint 4.1–4.2, A5, A7)

- `KeyWrapper`; per-patient data keys wrapped per tenant; AES-256-GCM with associated data of tenant, table, column and row; blind indexes; keyed MACs for every digest; `patient_keys`; and a crypto-shred routine that destroys a patient’s key and leaves structural rows.
- `clinical.published_profiles` with `constraints_valid()` and the outbox to `exchange.projection` (six allowlisted columns only).
- **Exit:** a ciphertext copied to another row or tenant fails to decrypt; a shredded patient is unreadable, including from a restored backup in the local test; scanning a full database dump for canary strings finds nothing.
- Commit: `feat(p6): field-level encryption, crypto-shredding and semantic projection`.

### Phase 7 — Exchange service and the DPT (blueprint Phase 3, D5)

- `exchange-token` Edge Function (Stage A `exchange-svc`) with the RFC 8693 request shape.
- The pipeline exactly as blueprint 3.4: verify the subject token through the adapter, consent gate, load the projection, scrub (allowlist, drop device-only dimensions, band upward), cohort gate at k = 5 with generalisation, alias (browse: CSPRNG; order: pairwise HMAC per quarterly epoch), sign through `Signer` with DPoP `cnf.jkt`, 15-minute lifetime, revocation record, and a `DPT_MINTED` audit event that holds no constraint values.
- `RevokeToken` and `EraseAlias` notices. Consent withdrawal triggers both.
- Extension (and mobile app, if present): ephemeral DPoP key, DPT held in memory only, Tier B on-device scoring unchanged, device-only dimensions never leave the device.
- Leak proofs from blueprint 3.7: schema lint on commercial columns, contract tests rejecting unknown `cs` keys on both sides, and the full-flow canary test scanning commercial data, logs, traces, access logs, minted DPTs and captured traffic. Plus the D5 CI test banning condition-named strings.
- **Exit:** every Exchange and Leakage row of blueprint 5.2 passes; a replayed DPoP proof is rejected; a cohort below 5 generalises rather than refuses; with the `Signer` unavailable, no token is minted and the client falls back to the unfiltered catalogue.
- Commit: `feat(p7): exchange service, dietary profile token and leak proofs`.

### Phase 8 — Commercial overlay (blueprint 4.3, D6, A6)

- `commercial.skus`, `sku_mappings`, observed `orders` and `order_lines`, `v_orders_tracking` and `v_sku_demand` (k ≥ 5, `security_invoker`). No `inventory`.
- `skus` is loaded by a platform curation job from the existing Naivas, Carrefour Kenya and Quickmart Kenya datasets, preserving `review_state` (`REJECTED`, `UNVERIFIED`, `ESTIMATED`, `VERIFIED`, `HIGH_CONFIDENCE`). The job is the only writer.
- DPT-authenticated endpoints for catalogue filtering and `observed-orders`. They validate signature, DPoP, the `cs` allowlist and `jti` revocation, and never log the token. Stakeholder endpoints read only the two views.
- Point the extension’s shopping-ledger sync at `observed-orders`, using the alias from the DPT.
- **Exit:** a stakeholder cannot see an alias; the demand view suppresses cells under 5 shoppers; a CI grep for `on_hand`, `payment` and `checkout` across commercial migrations and functions finds nothing.
- Commit: `feat(p8): overlay-only commercial schema, observed orders and DPT endpoints`.

### Phase 9 — Compliance machinery (D5)

- Seed retention per D5 and ship the purge job (dry run by default). Data-subject workflows: export (a signed bundle, audited as `EXPORT_PATIENT_DATA`), the `restricted` flag, rectification as a new version, and crypto-shred after retention. Backfill existing consents with `lawful_basis`.
- `scripts/release-gate.mjs`, `compliance/launch.json` and the DPIA draft (D5). `docs/compliance/BREACH_RUNBOOK.md` wiring verifier failure, `AUTHZ_DENY` spikes and break-glass anomalies to a severity-1 incident and the 72-hour notification assessment.
- **Exit:** the purge refuses any class without a policy; legal hold blocks purge; the release gate fails on a missing DPIA, a missing counsel sign-off, and a `submitted_on` less than 60 days before `planned_launch_on`, and passes when all three hold.
- Commit: `feat(p9): retention, rights workflows, DPIA draft and release gate`.

### Phase 10 — Cutover readiness and final report

Prepared, never deployed.

- `infra/`: the blueprint Phase 2 manifests (Gateway, ClientTrafficPolicy, SecurityPolicy, BackendTrafficPolicy, NetworkPolicy, and the Linkerd Server, MeshTLSAuthentication and AuthorizationPolicy), the logical-replication publication DDL, and the Keycloak realm export and mapper config validated against `claims.schema.json`.
- `NUT-04 Checkout Tool\Reports\CUTOVER_RUNBOOK.md`: split-by-schema procedure, the identity switch (config-only for clients), validation steps and rollback per wave, aligned with the existing sovereign-cloud migration plan.
- `NUT-04 Checkout Tool\Reports\HOSTED_SUPABASE_CHECKLIST.md`: ordered migrations, secrets to provision, `npm run check:rls`, `npm run release:check`, `purge-mocks --check-clean`, and what must never run on hosted.
- `NUT-04 Checkout Tool\Reports\CAD_BACKEND_FINAL_REPORT.md` (section 7).
- Commit: `docs(p10): cutover artifacts, hosted checklist and final report`.

## 5. Global definition of done

1. Every phase exit test passes, the six standard gates are green, and the test count is at least 446 plus the new tests.
2. The tenant-wall gate query returns zero rows.
3. CI greps find no numeric rank logic, no `3000-01-01`, no `callerRank`, and no condition-named string in any DPT, fixture or log.
4. Claim contract tests pass for the Supabase hook output and the Keycloak mapper config.
5. The canary flow leaves no marker anywhere in commercial data.
6. The tamper tests prove detection.
7. Nothing on D6’s out-of-scope list exists in the repo.
8. `npm run release:check` **fails** on this branch until the counsel items and the DPIA are real. That is correct behaviour.
9. The deviations file is complete, and no TODO lacks an owner.

## 6. Stop-and-ask triggers

Stop, write the question into `docs/OPEN_QUESTIONS.md`, and report to Kibet when:

1. The existing hook overwrites `role`, or its claim names differ from A1 in a way the adapter cannot absorb.
2. Moving a table breaks the CAD UI or the extension beyond what a compatibility view fixes.
3. An extension the blueprint needs (`btree_gist`, `pgaudit`, `pg_cron`) is unavailable on the local stack or the hosted plan.
4. Supabase’s own roles bypass `FORCE ROW LEVEL SECURITY` in a way that breaks a wall test.
5. Something needs legal judgement: retention for clinical classes, consent wording, the DPIA text.
6. Assumption O1 changes, meaning commercial stakeholders must span tenants.
7. You find plaintext PHI in a log, fixture or dump.
8. A required change would lower the test count or weaken an exit test.

## 7. Final report and open assumptions

`NUT-04 Checkout Tool\Reports\CAD_BACKEND_FINAL_REPORT.md` contains:

- A per-phase summary with commit SHAs and the test and gate evidence.
- A blueprint coverage table: each blueprint section marked implemented, Stage B prepared, or deferred with the reason.
- The deviations list and the counsel items still open.
- Residual risks and the hosted-Supabase checklist.
- The assumptions below, stated for Kibet to confirm:

| # | Assumption |
| --- | --- |
| O1 | A `commercial_stakeholder` is bound to one tenant, chosen by the `super_admin` at creation |
| O2 | The 3-year default applies only to transaction-type classes; clinical classes have no default and cannot be purged |
| O3 | DHA and ODPC visibility is cross-tenant metadata and proofs, not clinical content |
| O4 | `tenant_admin` may still suspend a stakeholder in its own tenant, but cannot create or reactivate one |
