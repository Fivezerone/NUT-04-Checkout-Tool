# Hosted Supabase Migration & Operational Checklist
## NutriScore CAD Backend Blueprint — Production Deployment Guide

**Target Environment:** Hosted Supabase Project (`nqcpudpkrkutpxuqpsfk`)
**Controlling Directive:** Prepared for operations; NEVER executed autonomously by development agents.
**Governing Standard:** Kenya Data Protection Act, 2019

---

## 1. Migration Sequence (Ordered 20261101 Series)

All migrations are designed to run sequentially within a single maintenance window. Corresponding rollback files are available in `supabase/rollbacks/`.

| Order | Migration File | Rollback File | Phase & Description |
|---|---|---|---|
| **01** | `20261101000000_cad_schema_foundation.sql` | `20261101000000_cad_schema_foundation.rollback.sql` | Phase 1: Schemas (`iam`, `clinical`, `exchange`, `commercial`, `audit`), service login roles, forced `RESTRICTIVE` tenant wall, claim helpers (`app_private`). |
| **02** | `20261101010000_canonical_claims_and_revocation.sql` | `20261101010000_canonical_claims_and_revocation.rollback.sql` | Phase 2: Canonical `app_role` claims hook, token revocation denylist, `BAN_UNTIL` single constant. |
| **03** | `20261101020000_grant_matrix_lifecycle.sql` | `20261101020000_grant_matrix_lifecycle.rollback.sql` | Phase 3: `iam.role_grants` matrix, regulator (`DHA`, `ODPC`) & commercial stakeholder onboarding, licence verification gate. |
| **04** | `20261101030000_clinical_core_and_abac.sql` | `20261101030000_clinical_core_and_abac.rollback.sql` | Phase 4: Clinical records, treatment relationships, ABAC `decide()`, break-glass workflow, immutable triggers. |
| **05** | `20261101040000_worm_audit_ledger_and_checkpoints.sql` | `20261101040000_worm_audit_ledger_and_checkpoints.rollback.sql` | Phase 5: Cryptographic append-only WORM ledger (`audit.ledger`), Merkle checkpoints, `audit_view_owner` platform view. |
| **06** | `20261101050000_field_encryption_shredding_and_projection.sql` | `20261101050000_field_encryption_shredding_and_projection.rollback.sql` | Phase 6: Field-level encryption schema, `clinical.patient_keys`, crypto-shredding, allowlisted semantic projection outbox. |
| **07** | `20261101060000_exchange_dpt_and_revocations.sql` | `20261101060000_exchange_dpt_and_revocations.rollback.sql` | Phase 7: Exchange token schema, DPT issuance & revocation records, dual shopper aliases, $k \ge 5$ cohort gate. |
| **08** | `20261101070000_commercial_overlay_and_observed_orders.sql` | `20261101070000_commercial_overlay_and_observed_orders.rollback.sql` | Phase 8: Commercial schema (`skus`, `sku_mappings`, observed `orders`), `v_orders_tracking` (no alias), `v_sku_demand` ($k \ge 5$). |
| **09** | `20261101080000_compliance_retention_and_rights.sql` | `20261101080000_compliance_retention_and_rights.rollback.sql` | Phase 9: Commercial retention seeding (3 years from deactivation), lawful_basis backfill, `set_patient_restriction`, `rectify_clinical_record`, fail-safe `execute_retention_purge`. |

---

## 2. Secrets & Environment Configuration to Provision

Configure the following secrets in Supabase Dashboard (`Settings -> Vault / Secrets`):

```bash
# 1. Dietary Profile Token (DPT) Ed25519 Signing Keys
DPT_SIGNER_KID="dpt-key-prod-2026-q4"
DPT_SIGNER_PRIVATE_KEY="<ED25519_PRIVATE_KEY_PKCS8_PEM>"
DPT_SIGNER_PUBLIC_KEY="<ED25519_PUBLIC_KEY_PEM>"

# 2. KeyWrapper Master Key (Stage A Field-Level Envelope Encryption)
# 256-bit AES Master Key in hex (64 hex characters)
KEY_WRAPPER_MASTER_KEY="<SECURE_RANDOM_32_BYTE_HEX>"

# 3. Merkle Audit Checkpoint Anchor Sink (Object-Lock S3 Bucket in Nairobi)
ANCHOR_SINK_BUCKET="nutriscore-audit-worm-checkpoints"
ANCHOR_SINK_ENDPOINT="https://s3.nbo1.servercore.com"
ANCHOR_SINK_ACCESS_KEY="<S3_ACCESS_KEY>"
ANCHOR_SINK_SECRET_KEY="<S3_SECRET_KEY>"

# 4. Identity & Auth Constants
JWT_SECRET="<SUPABASE_JWT_SECRET>"
CLAIM_SCHEMA_VERSION="1"
```

---

## 3. Mandatory Verification Checks to Run on Hosted

After executing the ordered migrations, run these verification commands against hosted:

```bash
# 1. Verify RLS tenant wall on all 29 relations
npm run check:rls

# 2. Verify clean production state (Zero mock accounts)
node scripts/purge-mocks.mjs --check-clean

# 3. Verify security invariants (No rank logic, single ban constant)
npm run check:cad-security

# 4. Verify audit ledger continuity on platform & tenant genesis rows
node scripts/verify-audit-chain.mjs --db-url="$HOSTED_DATABASE_URL"

# 5. Verify commercial overlay invariants (Zero aliases, k >= 5 demand)
node scripts/check-commercial-overlay.mjs --db-url="$HOSTED_DATABASE_URL"

# 6. Verify statutory release gate
npm run release:check
```

---

## 4. Operational Boundaries: What Must NEVER Run on Hosted

The following scripts and test fixtures are strictly for local/disposable stacks and **MUST NEVER BE RUN AGAINST HOSTED SUPABASE**:

| Action / File | Reason for Prohibition |
|---|---|
| `scripts/seed-mock-users.mjs` | Inserts mock users (`.test` domain) into database; violates Kenya DPA audit requirements. |
| `supabase/tests/*.sql` (pgTAP suites) | Disables mutation triggers, drops test tables, mutates state, and injects synthetic claims. |
| `scripts/verify-phase6-canary.mjs` | Injects synthetic plaintext canary strings into database and executes crypto-shredding tests. |
| `DROP SCHEMA ... CASCADE` | Causes irreversible data destruction; violates WORM audit and medico-legal retention rules. |
| Any command lacking `enforcing-resource-attribution` | All operational DDL and CLI actions must carry tenant attribution metadata. |
