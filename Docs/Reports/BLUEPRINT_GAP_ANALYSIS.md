# CAD backend blueprint — Phase 0 gap analysis

**Baseline:** `pre-cad-backend-blueprint` (`5d38c249b8cb01694103b80d52ffeb025973e9c7`)  
**Authoritative inputs:** `NutriScore CAD — Multi-Tenant Healthcare Backend Blueprint.md`, amendments A1–A7, and decisions D1–D6.  
**Scope:** local Supabase stack and repository only. No hosted project operation is authorised.

## Current-state inventory and disposition

| Shipped object | Blueprint destination | Action | Rationale |
| --- | --- | --- | --- |
| `public.tenants`, `public.tenant_members` | `iam.tenants`, `iam.members`, `iam.platform_members` | Move + wrap | The existing membership table is the identity source of truth, but it lacks platform-member, regulator, partner and denylist data. Compatibility views keep CAD callers alive during the schema move. |
| `public.custom_access_token_hook` | Supabase Stage A claim issuer | Replace | It currently writes the reserved `role` claim and emits `licence_verified`; A1 requires `app_role` and `lic_ok`, with only canonical claims. |
| `admin-provision-user` | Stage A provisioning service | Replace | It authorizes from `ROLE_HIERARCHY` and embeds rank comparisons. D1/D2 require `iam.role_grants` as the sole authority. |
| `public.audit_log`, `trg_audit_log_tamper`, chain trigger, verifier | `audit.ledger`, `audit.checkpoints` | Move + replace | The current log has plaintext-style before/after snapshots and no signed checkpoint/anchor semantics. Freeze the legacy table after a copy-and-verify cutover. |
| `public.targets`, `target_bundles`, `health_modes`, `health_mode_rules`, `tracked_nutrients` | `clinical.*`, `clinical.published_profiles` | Move + wrap | Preserve current clinical features while binding writes to treatment relationships and publishing a six-field projection only. |
| `public.consents`, `consent_records`, `patient_links` | `clinical.consent_records`, relationships and retention controls | Move + replace | Existing consent state lacks lawful-basis arrays, per-purpose DPT enforcement and revocation notices. |
| `public.users`, `payments`, subscription/invoice/payment-attempt tables; Daraja/Paystack functions | Consumer/billing legacy | Retire from new scope | D6 excludes native checkout, payment routing, fulfilment, and stock. Existing payment functions are left untouched and are not extended. |
| `catalog_*`, retailer product JSON, catalogue sync | `commercial.skus`, `sku_mappings` | Move + replace | Keep the data inputs but make the curation job the only writer and remove premium/payment semantics from overlay commerce. |
| `entitlement` Edge Function and extension entitlement client | Patient session/DPT seam | Retire + wrap | Premium entitlement is not the DPT. Tier-B on-device scoring remains local and must not send device-only dimensions. |
| CAD React app | CAD role consoles | Wrap + replace | It reads Supabase user metadata and public tables directly. Move it to the claims adapter and compatibility views; add the super-admin-only partner/regulator affordances. |
| Chrome extension | Overlay client and DPT consumer | Wrap | The manifest is already free of `identity`. Preserve that property and keep DPT/DPoP state memory-only. |
| Android companion | Mobile companion (present) | Wrap | The `android/` Gradle modules are present. It has no CAD identity client today, so no claims reader is migrated in Phase 2; any future client must use the canonical contract. |
| `scripts/check-rls-policies.mjs` | Blueprint tenant-wall CI gate | Replace | It scans migration text only, ignores schema-qualified objects and does not require `FORCE RLS` or a restrictive `tenant_wall` policy. |
| mock seed/purge scripts | Mock lifecycle controls | Replace | Add regulator and partner `.test` accounts and extend purge coverage. |

## Claim and direct-access findings

The effective current hook emits `tenant_id`, `role`, `licence_verified`, `account_status`, and optionally `primary_clinician_id`. It also defaults unassociated users to the platform tenant and a `patient` role. This violates A1 and the canonical minimal-claim contract.

The following application areas read identity or public data directly and require adapters or compatibility views before removal of `public` objects:

- `src/ui/src/cad/context/AuthContext.tsx`: user/app metadata (`role`, `tenant_id`, `licence_verified`) and `public.tenants`.
- `src/shared/rbac.ts` and `supabase/functions/_shared/rbac.ts`: raw JWT decoding and fallback `app_metadata` reads.
- `supabase/functions/admin-provision-user/index.ts`: `tenant_members`, `users`, `audit_log` and direct Auth administration.
- `supabase/functions/publish-bundle/index.ts` and the CAD clinical views: legacy public clinical tables.
- `src/extension/*.js`: Supabase session and public catalogue access; no Chrome `identity` permission is present.

## Current RLS state

Legacy tenant-scoped tables enable RLS but do **not** consistently force it or apply the required restrictive `tenant_wall`: `tenant_members`, `audit_log`, `users`, `payments`, `targets`, `target_bundles`, `consumption_diary`, `consent_records`, `patient_links`, `consents`, `subscriptions`, `invoices`, `payment_attempts`, `health_modes`, and `health_mode_rules`. The current checker verifies only `ENABLE RLS` and the existence of any policy. Phase 1 replaces this with the catalogue gate and a live local-stack query.

## Phase mapping

| Blueprint phase | Main change | Status at inventory |
| --- | --- | --- |
| 1 | schemas, roles, helpers, forced tenant wall | Not implemented |
| 2 | canonical claims, denylist, auth seam | Not implemented; reserved-claim issue recorded as OQ-001 and resolved as Option 2 |
| 3 | grant-matrix provisioning and regulator/partner lifecycle | Not implemented |
| 4 | clinical ABAC and break-glass | Partially represented by public tables; replace |
| 5 | signed WORM ledger and anchors | Legacy chain only; replace |
| 6 | encryption and semantic projection | Not implemented |
| 7 | DPT exchange and leak controls | Not implemented |
| 8 | observed-order overlay commerce | Not implemented |
| 9 | retention, rights and release gate | Partially represented by consent erasure; replace |
| 10 | cutover artefacts and operational reports | Not implemented |

## Risks and migration controls

- The historical reference names `Reports/IDENTITY_PROVISIONING_SOP.md` and `Reports/CAD_ROLLBACK_FINAL_REPORT.md` are not present in the restored folder. Their closest available history is retained in Git and the CAD testing guide; this is recorded as a deviation.
- Schema moves must use `ALTER TABLE ... SET SCHEMA` only after matching `security_invoker` compatibility views are ready and smoke-tested.
- `public.audit_log` must be copied and verified before it is frozen; it must not be dropped.
- Payment/Daraja/Paystack implementations remain untouched under D6.
- The local stack must be checked for `btree_gist`, `pgaudit`, and `pg_cron` before their phase begins; absence is a stop-and-ask trigger.

