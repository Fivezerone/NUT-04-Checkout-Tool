# CAD Rollback Inventory & Component Disposition

**Document:** `docs/CAD_ROLLBACK_INVENTORY.md`  
**Phase:** Phase 0 — Inventory (Read-Only Analysis)  
**Branch:** `feat/cad-only-identity`  
**Baseline Tag:** `pre-cad-identity-rollback`  
**Author:** Staff Security & Platform Engineer  
**Date:** 2026-10-29  

---

## 1. System Inventory & Disposition Matrix

Every file, route, component, Edge Function, database table, column, trigger, policy, manifest permission, and storage key relating to Google auth, consumer self-registration, onboarding, plans/pricing, patient-selected conditions, and `isPremium` gating is inventoried below with its assigned disposition:

- **KEEP**: Preserved as-is (e.g., Terms & Privacy modal copy adapted for consent gate).
- **REMOVE**: Completely excised from the codebase.
- **REPLACE**: Superseded by a CAD-governed, multi-tenant equivalent.
- **ARCHIVE**: Backend table/function preserved for historical audit or clinic-level billing, but decoupled and blocked from all client access.

### 1.1 Client & Chrome Extension Files

| Artifact | Current Path | Current Role | Disposition | Rationale / Target State |
|---|---|---|---|---|
| **Onboarding Wizard Root** | `src/ui/src/onboarding.tsx` | Entrypoint for consumer registration wizard | **REPLACE** | Replace with `PatientAuthRoot` (Sign-in only with clinic credentials + Terms & Privacy consent gate). |
| **Onboarding Wizard Component** | `src/ui/src/app/components/OnboardingWizard.tsx` | 4-step consumer wizard (Account, Preferences, Plan, Payment) | **REMOVE / REPLACE** | Remove steps 1 (signup), 3 (plan choice), 4 (payment). Replace with `PatientSignInConsent.tsx` (clinic credentials + Terms consent). |
| **Google Sign-In Buttons** | `src/ui/src/app/components/OnboardingWizard.tsx` (lines 800–850) | `signInWithOAuth({ provider: 'google' })` & `chrome.identity.launchWebAuthFlow` | **REMOVE** | Self sign-up and third-party consumer OAuth are completely prohibited. |
| **Onboarding Persistence** | `src/ui/src/app/lib/persistOnboarding.ts` | Writes `condition`, `is_premium`, `onboarding_completed` to DB | **REPLACE** | Superseded by server-side `consents` recorder and CAD-driven profile syncing. |
| **Options Page** | `src/ui/src/options/Options.tsx` | Patient-facing condition picker, plan display, billing address | **REPLACE** | Convert to read-only "My Care Profile": displays clinician-assigned modes, thresholds, and rationale. Patient edits only display/notification preferences. |
| **Popup Root** | `src/ui/src/popup.tsx` | Auth & tier resolution, `CHECK_TIER`, upgrade button routing | **REPLACE** | Resolve active CAD enrollment (not `isPremium`). Unauthenticated state prompts for clinic credentials. |
| **Popup View Component** | `src/ui/src/app/components/Popup.tsx` | Renders "Upgrade to Premium" button and condition badges | **REPLACE** | Remove all upgrade prompts. Show "View Shopping Analytics" for active patients; show clinician-assigned health mode badge. |
| **Shopper Dashboard Root** | `src/ui/src/dashboard.tsx` | Premium gating (`authState === 'basic'`, `authState === 'expired'`) | **REPLACE** | Gate access solely on active CAD clinic enrollment with accepted terms. Remove "Upgrade to Premium" screen. |
| **Shopper Dashboard Component** | `src/ui/src/app/components/Dashboard.tsx` | Consumer analytics, upsell banners, condition theme switcher | **REPLACE** | Remove upsell banners. Theme is driven exclusively by clinician-assigned primary health mode. |
| **Terms & Privacy Consent Modal** | `src/ui/src/app/components/ConsentDocModal.tsx` | Modal displaying legal agreements | **KEEP** | Retained and adapted as the standalone DPA 2019 consent gate upon first login. |
| **Legal Copy Fixtures** | `src/ui/src/app/legal/decoyLegalDocs.ts` | Terms of Service & Privacy Policy text | **KEEP** | Retained; flagged for legal counsel review. |
| **Extension Manifest** | `src/extension/manifest.json` | `permissions: ["identity", ...]` | **REPLACE** | Remove `"identity"` permission. Retain `"alarms"`, `"storage"`, `"scripting"`. |
| **Service Worker** | `src/extension/background.js` | `appendPremiumAssessment`, `CHECK_TIER`, `settings.isPremium` | **REPLACE** | Replace `isPremium` gating with active CAD target bundle validation. Alerts evaluate generic rules from engine. |
| **Adapter Shared UI** | `src/extension/adapters/shared-ui.js` | Duplicate disease threshold checks (lines 311–345) | **REMOVE** | Excised completely. Flyout renders alerts only from `NutriScoreEngine` output. |
| **Disease Engine Facade** | `src/extension/pipeline/disease-engine.js` | Hardcoded `DISEASE_RULES` matching `patientProfile.conditions` | **REPLACE** | Generic rule evaluation supporting dynamic `patientProfile.rules[]` from clinician health modes. |
| **Health Modes Config** | `src/extension/health-modes.js` & `src/shared/health-modes.mjs` | Client-side presets and themes | **REPLACE** | Dynamic health modes fetched from Supabase `tracked_nutrients` and `health_modes`. |
| **Storage Schema & Service** | `src/shared/storage.js`, `storage.d.ts`, `services/storage.ts` | `user_payment`, `billingAddress`, `nutriscore_is_premium` | **REMOVE** | Excised all orphaned payment/billing fields and dead local keys. |

---

### 1.2 Backend Database (Tables, Columns, Triggers & Policies)

| Database Object | Type | Current Role | Disposition | Rationale / Target State |
|---|---|---|---|---|
| `public.users.is_premium` | Column | Consumer billing boolean | **ARCHIVE** | Retain column structure for backwards compatibility; freeze updates; client stops reading it. |
| `public.users.subscription_status` | Column | `basic`, `active`, `expired`, `trialing` | **ARCHIVE** | Deprecated for patients. Replaced by `tenant_members.status = 'active'`. |
| `public.users.premium_expires_at` | Column | Expiration timestamp | **ARCHIVE** | Freeze updates; client stops reading it. |
| `public.users.payment_received_at` | Column | Payment timestamp | **ARCHIVE** | Freeze updates. |
| `public.users.condition` | Column | Patient-selected condition string | **ARCHIVE** | Replaced by relational `public.health_modes` assigned by clinicians. |
| `public.users.metric` | Column | Patient-selected primary nutrient | **ARCHIVE** | Replaced by clinician-prescribed rules. |
| `public.users.onboarding_completed` | Column | Local wizard completion flag | **REPLACE** | Replaced by server-derived check on `public.consents` (accepted terms version). |
| `public.users.onboarding_step` | Column | Stepper resume index | **REMOVE** | Wizard stepper is obsolete. |
| `public.payments` | Table | Consumer payment transaction rows | **ARCHIVE** | Retain for historical accounting. Decouple completely from client extension. |
| `public.plans` | Table | Subscription pricing plans | **ARCHIVE / KEEP** | Clinic tiers (`clinic_monthly`, `clinic_annual`) used by CAD billing; individual `premium_30d` retired. |
| `public.protect_billing_columns` | Trigger | Intended to guard billing columns | **ARCHIVE / DROP** | Defunct trigger. Replaced by strict RLS and absence of client billing mutations. |
| `public.enforce_billing_state` | Trigger | Derived billing state | **ARCHIVE** | Frozen. |
| `public.grant_premium` | RPC | Granted consumer premium | **ARCHIVE** | Deprecated. CAD uses `activate_tenant_subscription` for clinics. |
| `public.is_premium_active` | Function | Checked auth.uid() premium status | **ARCHIVE** | Deprecated. Replaced by `is_enrolled_active(auth.uid())`. |
| `public.consents` | Table | Patient consent records | **REPLACE / ENHANCE** | Integrated with `consent_records` to track terms acceptance version and purpose gates. |
| `public.tracked_nutrients` | Table | Registry of Nutrition fields | **NEW** | Registry of tracked nutrients with coverage flags and schema gap tracking. |
| `public.health_modes` | Table | Clinician-assigned health modes | **NEW** | Versioned, clinician-owned patient health modes (preset or custom). |
| `public.health_mode_rules` | Table | Specific nutrient thresholds | **NEW** | Nutrient rules (`max`/`min`, threshold, unit, basis, severity, rationale). |

---

### 1.3 Supabase Edge Functions & Config

| Edge Function / Config Key | Current Location | Current Role | Disposition | Rationale / Target State |
|---|---|---|---|---|
| `debug-payments` | `supabase/functions/debug-payments` | Insecure payment dump (`verify_jwt=false`) | **REMOVE** | Deleted outright. No deployment allowed. |
| `mpesa-initiate` | `supabase/functions/mpesa-initiate` | Initiates consumer STK push | **ARCHIVE** | Gated to CAD tenant billing only; client extension cannot invoke. |
| `mpesa-webhook` | `supabase/functions/mpesa-webhook` | M-Pesa C2B/STK callback | **ARCHIVE** | Gated to CAD tenant billing reconciliation. |
| `paystack-initiate` | `supabase/functions/paystack-initiate` | Initiates consumer Paystack transaction | **ARCHIVE** | Gated to CAD tenant billing only. |
| `paystack-redirect` | `supabase/functions/paystack-redirect` | Paystack redirect handler | **ARCHIVE** | Gated to CAD tenant billing only. |
| `paystack-webhook` | `supabase/functions/paystack-webhook` | Paystack webhook handler | **ARCHIVE** | Gated to CAD tenant billing only. |
| `payment-status` | `supabase/functions/payment-status` | Polls user payment status | **ARCHIVE** | Gated to CAD tenant billing only. |
| `entitlement` | `supabase/functions/entitlement` | Issues ES256 premium entitlement JWT | **REPLACE** | Issues active patient enrollment JWT (`sub`, `tenant_id`, `role`, `health_profile_version`, `exp`). |
| `publish-bundle` | `supabase/functions/publish-bundle` | Signs target bundles | **KEEP** | Core CAD bundle compiler. |
| `reconcile-payment` | `supabase/functions/reconcile-payment` | Background worker for tenant billing | **KEEP** | Tenant billing reconciliation. |
| `admin-provision-user` | `supabase/functions/admin-provision-user` | Privileged user creation | **NEW** | Edge Function using service-role key for RBAC-checked user provisioning. |
| `[auth.external.google]` | `supabase/config.toml` | Google OAuth provider config | **REMOVE** | Completely disabled. |
| `[auth] enable_signup` | `supabase/config.toml` | Public signup allow-list | **REPLACE** | Set to `false`. Public self-registration strictly disabled. |
| `[auth] enable_anonymous_sign_ins` | `supabase/config.toml` | Anonymous sign-in | **REPLACE** | Set to `false`. |

---

## 2. Onboarding Wizard Field-Disposition Table

The legacy onboarding wizard collected 12 distinct data points. Under the CAD-only authority model, these fields are disposed as follows:

| Legacy Wizard Field | Collected In | Data Type | Disposition | New Location & Authority |
|---|---|---|---|---|
| **Full Name** | Step 1 (Account) | `string` | **MOVED TO CAD** | Input during CAD Patient Intake by authorized clinic staff. Synced read-only to extension. |
| **Email Address** | Step 1 (Account) | `string` | **MOVED TO CAD** | Clinic-issued account identifier provisioned via CAD. |
| **Password** | Step 1 (Account) | `string` | **REPLACED** | Initial temporary password generated at CAD provisioning; forced password reset on first login. |
| **Confirm Password** | Step 1 (Account) | `string` | **MOVED TO RESET** | Used only during password reset / first-login password change screen. |
| **Date of Birth (`dob`)** | Step 1 (Account) | `date` | **MOVED TO CAD** | Clinical demographic captured during CAD intake; used to validate paediatric nutrient envelopes. |
| **Gender** | Step 1 (Account) | `string` | **MOVED TO CAD** | Clinical demographic captured during CAD intake. |
| **Health Condition** | Step 1 / Options | `string` | **MOVED TO CAD** | **Clinician-Owned**. Prescribed exclusively via CAD `health_modes`. Patient cannot pick or edit. |
| **Primary Metric** | Step 1 / Options | `string` | **MOVED TO CAD** | Derived from active clinician rules (e.g. `SodiumMG`, `SugarsG`). |
| **Notification Frequency** | Step 2 (Preferences) | `enum` | **MOVED TO OPTIONS** | Retained as patient-editable preference in "My Care Profile" (`realtime`, `daily`, `weekly`, `off`). |
| **Terms of Service Acceptance** | Step 2 (Consent) | `boolean` | **RETAINED IN GATE** | Standalone consent gate upon first authenticated login. Recorded in `public.consents`. |
| **Privacy Policy Acceptance** | Step 2 (Consent) | `boolean` | **RETAINED IN GATE** | Standalone consent gate upon first authenticated login. Recorded in `public.consents`. |
| **Plan Selection (`tier`)** | Step 3 (Plan) | `enum` | **DROPPED** | Consumer plans are completely removed. Access is determined by active clinic enrollment. |
| **Payment Method & Phone** | Step 4 (Payment) | `string` | **DROPPED** | Consumer payment flow is completely removed from the patient extension. |

---

## 3. CAD Roles, Permissions & User-Creation Path

### 3.1 Role Hierarchy & Least-Privilege Mapping

The CAD uses a hierarchical multi-tenant Role-Based Access Control (RBAC) model. Each role has strictly defined boundaries:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CAD ROLE HIERARCHY                              │
│                                                                        │
│    Level 1: super_admin (Platform Technical Administrator)             │
│       │                                                                │
│       ├── Level 2: compliance_auditor (DHA / ODPC Regulatory Auditor)  │
│       │                                                                │
│       └── Level 3: tenant_admin (Clinic Administrator)                 │
│              │                                                         │
│              ├── Level 4: writing_clinician (Physician / Dietitian)    │
│              │      │                                                  │
│              │      └── Level 5: viewing_dietician (Dietary Monitor)   │
│              │             │                                           │
│              │             └── Level 6: commercial_stakeholder         │
│              │                                                         │
│              └── Level 7: patient (Enrolled Clinic Subject)            │
└────────────────────────────────────────────────────────────────────────┘
```

#### Mapping Prompt Terms to CAD Role System:
- **`tech_admin`** $\longleftrightarrow$ **`super_admin`**: Platform owner, manages tenants, global audit logs, and platform default rule templates.
- **`clinic_admin`** $\longleftrightarrow$ **`tenant_admin`**: Manages clinic staff, clinic subscriptions, and verifies professional licences.
- **`clinician`** $\longleftrightarrow$ **`writing_clinician`**: Licensed medical practitioner (KMPDC / KNDI) who prescribes health modes and targets.
- **`dietician`** $\longleftrightarrow$ **`viewing_dietician`**: Licensed nutritionist/dietitian with read-only clinical access.
- **`auditor`** $\longleftrightarrow$ **`compliance_auditor`**: External or internal auditor with read-only access to immutable audit chains.
- **`patient`** $\longleftrightarrow$ **`patient`**: Enrolled patient subject linked to a clinic and primary clinician.

### 3.2 User Provisioning Architecture & Identified Gaps

#### What Exists in CAD:
1. `public.tenants`: Registry of clinic organizations with lifecycle state.
2. `public.tenant_members`: Relational membership table linking `auth.users(id)` to `tenants(id)` with roles, licence numbers, and status.
3. `public.custom_access_token_hook`: Injects `tenant_id`, `role`, and `licence_verified` into JWT claims from `tenant_members`.
4. `public.audit_log`: Append-only, hash-chained audit ledger with gapless sequence numbers.

#### Gaps to Fill in Phase 2:
1. **Edge Function `admin-provision-user`**:
   - Currently, `UserManagementView.tsx` creates mock users in React component state.
   - We must build a secure Edge Function using `SUPABASE_SERVICE_ROLE_KEY` that:
     - Rejects any unauthenticated or `anon` call.
     - Validates the caller's JWT role and enforces that the target role is strictly lower in the hierarchy (`super_admin` can create `tenant_admin`, `tenant_admin` can create `writing_clinician`/`patient`, `writing_clinician` can create `patient`).
     - Enforces tenant isolation: callers can only provision users within their own `tenant_id` (unless `super_admin`).
     - Enforces patient linkage: requires `primary_clinician_id` when provisioning a `patient`.
     - Calls Supabase Auth Admin API (`auth.admin.createUser`) with an auto-generated temporary password and `email_confirm: true`.
     - Inserts the corresponding row into `public.tenant_members` with initial status `'invited'` or `'active'`.
     - Records the action in `public.audit_log` with `mutation_type = 'create'`.
2. **Platform Bootstrap Script**:
   - `scripts/bootstrap-super-admin.mjs`: One-time script using local service-role credentials to create the genesis `super_admin` account.
3. **Account Lifecycle State Machine**:
   - Update `tenant_members.status` constraint to enforce: `'invited'`, `'active'`, `'suspended'`, `'deactivated'`.
   - Implement global session revocation upon suspension or deactivation.

---

## 4. Conflicts Between Prompt & Existing CAD Blueprint

| # | Item | Prompt Directive | Existing CAD Architecture | Resolution (CAD Wins on Roles/Schema) |
|---|---|---|---|---|
| **C-1** | **Role Naming** | References `tech_admin`, `clinic_admin`, `clinician`. | CAD uses `super_admin`, `tenant_admin`, `writing_clinician`, `viewing_dietician`. | **Follow CAD**: Keep CAD role names (`super_admin`, `tenant_admin`, etc.) to maintain consistency with existing migrations and UI. |
| **C-2** | **Account States** | Specifies `invited` $\to$ `active` $\to$ `suspended` $\to$ `deactivated`. | Migration `20261029000000` had `active`, `suspended`, `revoked`. | **Align with Prompt**: Extend check constraint on `tenant_members.status` to include `invited` and `deactivated` (`revoked` treated as synonym for `deactivated`). |
| **C-3** | **Health Modes vs Targets** | Prompt Phase 5 specifies `tracked_nutrients`, `health_modes`, `health_mode_rules`. | CAD Phase 4 created `public.targets` and `public.target_bundles`. | **Harmonize**: Build `tracked_nutrients`, `health_modes`, and `health_mode_rules` as the authoritative clinician interface, which automatically compiles and signs into `target_bundles` for extension delivery. |
| **C-4** | **Legacy Account Handling** | Ban legacy unprovisioned users; do not delete. | Current `users` table holds direct consumer profiles from previous tests. | **Follow Prompt**: Write migration to set `banned_until = '3000-01-01'` and flag `legacy_unprovisioned` on existing users without a verified clinic tenant membership. |

---

## 5. Phase 0 Verification & Readiness

- **Branch Created**: `feat/cad-only-identity`
- **State Tagged**: `pre-cad-identity-rollback`
- **Stop-and-Report Status**: No blocking architectural gaps. The CAD's multi-tenant core and JWT custom claims hook are operational and ready to host the secure `admin-provision-user` Edge Function.
- **Proceeding to Phase 1**: Removing Google identity, OAuth endpoints, and public registration.

