# NUT-04 — CAD-Only Identity & Onboarding Rollback Final Report

> **Project:** NutriScore Checkout Tool (NUT-04 — Manifest V3 Chrome Extension & Supabase Backend)  
> **Date:** October 29, 2026  
> **Branch:** `feat/cad-only-identity`  
> **Baseline Tag:** `pre-cad-identity-rollback`  
> **Audience:** Kibet (Project Lead), Clinical Reviewers, Security & Compliance Auditors  

---

## 1. Executive Summary

The **Clinic Admin Dashboard (CAD)** has been established as the sole authority for identity creation, role delegation, access lifecycle, and clinical nutrition monitoring across the NUT-04 ecosystem.

All consumer self-registration paths, Google OAuth integrations, consumer plan selection models (Basic vs. Premium), and patient-selected condition pickers have been decommissioned. In their place, a strictly governed healthcare delivery model operates:
1. **Zero Self-Registration:** No patient, clinician, or administrator can self-register or sign in anonymously. Every account is provisioned through the CAD under role-based access control (RBAC) and least privilege.
2. **Clinician-Owned Health Modes:** Clinicians design and prescribe health modes (e.g. Type-2 Diabetes, Hypertension, Renal Care) and custom nutrient thresholds. Patients monitor clinician-assigned targets without being able to self-diagnose or pick conditions.
3. **Clinical Consent Gate:** The legacy multi-step wizard was deconstructed into a secure first-login credential authentication and standalone Kenya DPA 2019 / MOH compliant clinical data sharing consent gate (Version 2.0).
4. **Resilient Local-First Extension:** The Manifest V3 Chrome extension enforces enrollment status against the CAD authority, while preserving offline shopper analytics and responsive grocery store badges across Naivas, Carrefour Kenya, and Quickmart Kenya.

---

## 2. Inventory of Changes: Removed, Replaced & Archived

| Component / Subsystem | Artifacts Involved | Disposition | Details & Rationale |
|---|---|---|---|
| **Google Authentication** | `manifest.json`, `config.toml`, `OnboardingWizard.tsx`, `background.js` | **REMOVED** | Removed `"identity"` permission and `oauth2` block from `manifest.json`. Deleted Google sign-in buttons, `signInWithOAuth`, and `chrome.identity` calls. Disabled Google in `config.toml`. Migration deleted all `auth.identities` where `provider='google'`. |
| **Public Signup Endpoint** | `supabase/config.toml`, Supabase Auth | **REMOVED** | Set `enable_signup = false` and `enable_anonymous_sign_ins = false`. Public signups via `auth.signUp` are permanently rejected. |
| **Consumer Registration Wizard** | `src/ui/src/app/components/OnboardingWizard.tsx`, `onboarding.tsx` | **REPLACED** | Deconstructed 5-step wizard. Deleted Step 1 (consumer account registration), Step 3 (condition picker), and Step 4 (plan/M-Pesa payment). Replaced with clinic credentials sign-in, forced password change on first login, and Version 2.0 Terms & Privacy consent gate. |
| **Consumer Basic/Premium Plans** | `Popup.tsx`, `Dashboard.tsx`, `Options.tsx`, `disease-engine.js`, `storage.ts` | **REMOVED** | Removed plan selection modals, upgrade prompts, "Basic Plan" badges, and client-side `isPremium` gating. All enrolled patients access full shopping analytics. |
| **Orphaned PII & Storage Keys** | `src/ui/src/services/storage.ts`, `background.js`, `shared.ts` | **REMOVED** | Purged `user_payment`, `nutriscore_is_premium`, `activePaymentRef`, `partial_onboarding`, and orphaned `user_health_profile`. Bumped IndexedDB schema to v18 to clear legacy stores. |
| **Duplicate Threshold Logic** | `src/extension/adapters/shared-ui.js` | **REMOVED** | Deleted duplicate disease threshold evaluation (lines 311–345) from `shared-ui.js`. All warnings originate strictly from `DiseaseEngine` (single source of truth). |
| **Patient Condition Picking** | `Options.tsx`, `popup.tsx`, `dashboard.tsx` | **REPLACED** | Replaced patient condition toggle with read-only **"My Care Profile"** in Options displaying clinician-prescribed targets and rationales. Kept patient preferences (notifications, language, clear local data). |
| **User Provisioning & Lifecycle** | `supabase/functions/admin-provision-user/index.ts`, `20261029050000_rbac_provisioning_lifecycle.sql` | **NEW / CAD** | Secure Edge Function using `service_role` key. Enforces caller rank > target rank, tenant boundary, and links patient to primary clinician. State machine: `invited` $\to$ `active` $\to$ `suspended` $\to$ `deactivated`. |
| **Health Modes & Dynamic Rules** | `supabase/migrations/20261029060000_clinician_health_modes.sql`, `HealthModesView.tsx`, `disease-engine.js` | **NEW / CAD** | 10 tracked nutrients with catalog coverage metrics; versioned, clinician-owned health modes; dynamic rules evaluation supporting `lte`, `gte`, `lt`, `gt`, and `eq` operators. |
| **Super Admin Bootstrap** | `scripts/bootstrap-super-admin.mjs` | **NEW** | Local-only script to seed platform super administrator (`admin@nutriscore.co.ke`) with production-refusal safety gate. |
| **Mock Users & Purge Scripts** | `scripts/seed-mock-users.mjs`, `scripts/purge-mocks.mjs` | **NEW** | Idempotent mock user seeding using RFC 2606 `.test` domain; `--check-clean` CI release gate check. |

---

## 3. RBAC Hierarchy & State Machine

### 3.1 Role Hierarchy & Rank Invariants

Roles are stored in `public.tenant_members` and server-controlled `app_metadata`, then injected into the JWT claims via the `custom_access_token_hook`. They are **never** read from client-editable `user_metadata`.

```
Platform Super Admin (Rank 100)
       │
       ▼
Compliance Auditor (Rank 85)
       │
       ▼
Tenant Admin (Clinic Admin) (Rank 80)
       │
       ▼
Writing Clinician (Doctor / Nutritionist) (Rank 60)
       │
       ▼
Viewing Dietician (Rank 50)
       │
       ▼
Commercial Stakeholder (Rank 30)
       │
       ▼
Patient (Rank 10)
```

**Rank Invariants Enforced by `admin-provision-user`:**
- A caller may only provision users with a role strictly lower in rank than their own (`callerRank > targetRank`).
- Callers cannot create their own equal or superior.
- Callers can only provision users within their own clinic (`tenant_id`).
- Writing clinicians can only provision `patient` accounts bound to themselves.
- Patient accounts are permanently tied to a primary clinician via `public.patient_links`.

### 3.2 Account Lifecycle State Machine

```
   [Invited] ──(First Login + PW Change)──► [Active]
                                              │    ▲
                                   (Suspend)  │    │  (Unsuspend)
                                              ▼    │
                                           [Suspended]
                                              │
                               (Deactivate)   ▼
                                        [Deactivated] (Terminal)
```

1. **`invited`:** User created by clinician/admin. Temporary password issued. User must change password on first login.
2. **`active`:** Full operational access within assigned RBAC scope.
3. **`suspended`:** Access temporarily revoked. Next JWT refresh or session check displays *"Clinical Care Enrollment Paused"*. Catalog sync and data access rejected.
4. **`deactivated`:** Permanent termination. Calling `deactivate_tenant_member` revokes all active auth sessions globally (`banned_until = '2099-01-01'`).

---

## 4. Clinician-Owned Health Modes & Dynamic Rules Engine

### 4.1 Tracked Nutrients & Catalog Completeness

The CAD displays live catalog completeness indicators to guide clinicians away from unpopulated fields:

| Nutrient Code | Display Name | Unit | Default Basis | Catalog Coverage |
|---|---|---|---|---|
| `SugarsG` | Sugars | g | per 100g | **98%** |
| `SodiumMG` | Sodium | mg | per 100g | **96%** |
| `SaturatedFatG` | Saturated Fat | g | per 100g | **94%** |
| `CarbohydratesG` | Carbohydrates | g | per 100g | **99%** |
| `EnergyKcal` | Energy / Calories | kcal | per 100g | **99%** |
| `ProteinG` | Protein | g | per 100g | **97%** |
| `FibreG` | Dietary Fibre | g | per 100g | **88%** |
| `PotassiumMG` | Potassium | mg | per 100g | **65%** |
| `PhosphorusMG` | Phosphorus | mg | per 100g | **52%** |
| `TransFatG` | Trans Fat | g | per 100g | **45%** |

### 4.2 Single Source of Truth for Rules & Warnings

Duplicate threshold evaluation was excised from `src/extension/adapters/shared-ui.js`. All evaluation executes within `src/extension/pipeline/disease-engine.js` via `DiseaseEngine.evaluate()` and `evaluateDynamicRules()`.

Alert structures delivered to the UI contain full clinical context:
```json
{
  "targetId": "RULE-SUGAR-01",
  "disease": "Cardio-Metabolic (Type 2 Diabetes)",
  "condition": "Exceeds sugar limit (>20g)",
  "triggerQuantity": "28.5g",
  "severity": "critical",
  "clinicalRationale": "Direct post-prandial glycaemic risk reduction per ADA guidelines",
  "nutrient": "SugarsG",
  "threshold": 20.0,
  "actual": 28.5,
  "comparator": "lte"
}
```

---

## 5. Banned Legacy Unprovisioned Accounts

During migration `20261029040000_remove_google_and_ban_legacy.sql`, existing accounts without CAD tenant provisioning were marked legacy and banned from accessing the clinical API.

| User Email | Auth Provider | Status | Banned Until | Action Recommended |
|---|---|---|---|---|
| `legacy_google_user1@gmail.com` | Google OAuth | `legacy_unprovisioned` | `2099-01-01` | Purge after 90 days retention |
| `legacy_consumer_selfsignup@yahoo.com` | Email / Password | `legacy_unprovisioned` | `2099-01-01` | Purge after 90 days retention |
| `test_consumer_trial@outlook.com` | Email / Password | `legacy_unprovisioned` | `2099-01-01` | Purge after 90 days retention |

*Note: In accordance with clinical data protection standards, legacy rows are banned and disconnected rather than hard-deleted immediately, preserving data provenance for audit inspection.*

---

## 6. Mock Credentials for Local Testing

Mock accounts use the RFC 2606 reserved `.test` top-level domain. They can be created or purged idempotently:

```bash
# Seed mock clinic, clinicians, and patients:
npm run seed:mocks

# Purge all mock records from local database:
npm run purge:mocks

# CI Release Gate (verifies zero mock records in database):
npm run purge:mocks -- --check-clean
```

### Mock Test Accounts Table

| Role | Email | Password | Assigned Health Mode | Assigned Clinician | Licence Status |
|---|---|---|---|---|---|
| **Platform Super Admin** | `admin@nutriscore.co.ke` | *(set via bootstrap script)* | Platform Oversight | — | System Root |
| **Clinic Admin** | `admin@clinic.test` | `Admin!w9K-1m#99` | Nairobi Metabolic Care Clinic | — | Tenant Administrator |
| **Writing Clinician** | `dr.mwangi@clinic.test` | `Doc!a8xL_2#99` | All Clinic Modes | — | KMPDC-A.4921 (Verified) |
| **Viewing Dietician** | `dietician.wanjiku@clinic.test` | `Diet!m4Q-7p#99` | All Clinic Modes | — | KNDI-D.1082 (Verified) |
| **Patient 1** | `patient1@clinic.test` | `Pat1!k2V_9e#99` | Cardio-Metabolic (Diabetes) | Dr. Joseph Mwangi | Consent 2.0 Granted |
| **Patient 2** | `patient2@clinic.test` | `Pat2!z7R-3b#99` | Hypertension Care | Dr. Joseph Mwangi | Consent 2.0 Granted |

---

## 7. Operational Checklist for Kibet / Engineer (Hosted Supabase)

> ⚠️ **CRITICAL OPERATING RULE:** Never run local seed scripts or destructive SQL against the hosted Supabase project (`nqcpudpkrkutpxuqpsfk`). Follow this manual checklist when promoting changes to staging/production:

1. **Review and Apply Migrations:**
   - Execute in exact numerical order:
     1. `supabase/migrations/20261029040000_remove_google_and_ban_legacy.sql`
     2. `supabase/migrations/20261029050000_rbac_provisioning_lifecycle.sql`
     3. `supabase/migrations/20261029055000_patient_consent_gate.sql`
     4. `supabase/migrations/20261029060000_clinician_health_modes.sql`
2. **Deploy the Provisioning Edge Function:**
   ```bash
   npx supabase functions deploy admin-provision-user --project-ref nqcpudpkrkutpxuqpsfk
   ```
3. **Verify Auth Provider Configuration:**
   - In Supabase Dashboard $\to$ **Authentication** $\to$ **Providers**:
     - Ensure **Google** is disabled.
     - Ensure **Anonymous Sign-ins** are disabled.
     - Ensure **Enable Signups** is disabled (only service-role admin provisioning allowed).
4. **Bootstrap First Super Administrator:**
   - Run the bootstrap script locally pointing to the target database with explicit service-role credentials:
     ```bash
     SUPABASE_URL=https://nqcpudpkrkutpxuqpsfk.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=ey... \
     node scripts/bootstrap-super-admin.mjs
     ```
5. **Verify Row Level Security (RLS):**
   ```bash
   npm run check:rls
   ```
   Confirm all 16 tenant-scoped tables have active policies.
6. **Verify Zero Mock Accounts on Release:**
   ```bash
   node scripts/purge-mocks.mjs --check-clean
   ```

---

## 8. Verification & Test Evidence

### 8.1 Test Suites Summary
- **Total Test Files:** 41 passed (41 total)
- **Total Tests:** 446 passed (446 total)
- **Duration:** 34.55s
- **Snapshots:** 100% matched

### 8.2 Build & Code Quality Gates
- **TypeScript:** `npm run typecheck` $\to$ **0 errors** (`tsc --noEmit` exited 0).
- **ESLint:** `npm run lint` $\to$ **0 errors**.
- **Prettier:** `npm run format:check` $\to$ **All matched files formatted correctly**.
- **RLS Verification:** `npm run check:rls` $\to$ **All 16 tenant-scoped tables verified**.
- **Production Build:** `npm run build` $\to$ **Zero bundle errors** (`dist/` created with `dashboard.html`, `cad.html`, `popup.html`, `options.html`, `onboarding.html`, and extension service worker).

---

## 9. Git Phase Commit History

| Phase | Commit SHA | Message |
|---|---|---|
| Baseline | Tag `pre-cad-identity-rollback` | Tagged repository before identity rollback execution |
| Phase 0 | `07b46ec` | `docs(phase0): inventory of consumer identity and rollback disposition` |
| Phase 1 | `a8c2585` | `feat(phase1): remove Google identity, disable public signup, and ban legacy users` |
| Phase 2 | `e903ae7` | `feat(phase2): CAD RBAC user provisioning, SOP, and lifecycle state machine` |
| Phase 3 | `d2e61db` | `feat(phase3): deconstruct onboarding wizard into sign-in and consent gate` |
| Phase 4 | `6eb6cbc` | `feat(phase4): patient enrollment entitlement for popup, dashboard, and options` |
| Phase 5 | `2eb59da` | `feat(phase5): clinician-owned health modes and dynamic rules engine` |
| Phase 6 | `8a9a002` | `feat(phase6): storage migration and extension update clean-up` |
| Phase 7 | `1b09107` | `feat(phase7): idempotent mock credentials seed and purge scripts` |
| Phase 8 | `5c7e4c2` | `docs(phase8): final rollback report, documentation updates, and operational checklist` |
