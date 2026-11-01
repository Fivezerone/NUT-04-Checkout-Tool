# NutriScore Clinic Admin Dashboard (CAD) & Extension — Live Chrome Testing & Integration Guide

**Document ID:** `CAD-TEST-GUIDE-V1`  
**Target Environments:** Google Chrome (MV3 Extension + CAD Web Surface)  
**System Version:** NutriScore Kenya 0.0.1 (Multi-Tenant Core)  
**Compliance Context:** Kenya Data Protection Act 2019 (DPA ss. 40, 46) & Digital Health Act 2023 (DHA)  

---

## 1. System Overview & Nomenclature

To ensure clarity during testing and verification, distinguish strictly between the two dashboards:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                       NUTRISCORE SYSTEM TOPOLOGY                               │
├──────────────────────────────────────┬─────────────────────────────────────────┤
│    PATIENT / CONSUMER SURFACE        │      CLINICAL / PROVIDER SURFACE        │
│   (Chrome Extension MV3 Client)      │      (Clinic Admin Dashboard - CAD)     │
├──────────────────────────────────────┼─────────────────────────────────────────┤
│ • Entry: Popup, Options, Onboarding  │ • Entry: CAD Web Application (cad.html) │
│ • Surface: Shopper Dashboard         │ • Surface: Clinic Admin Dashboard (CAD) │
│ • Scope: Patient shopping analytics, │ • Scope: Multi-tenant clinic management,│
│   cart grade, swap recommendations   │   cohort tracking, clinical targets     │
│ • Storage: Local IndexedDB           │ • Storage: Supabase PostgreSQL (RLS,    │
│   (NutriScoreDB, target_bundles)     │   audit_log, tenant_members, targets)   │
│ • Identity: Consumer user JWT        │ • Identity: Provider JWT + custom claims│
│   (sub, entitlement token)           │   (tenant_id, role, licence_verified)   │
└──────────────────────────────────────┴─────────────────────────────────────────┘
```

### The Architectural Bridges

1. **The Linking Bridge (Patient–Clinician Pairing)**:
   - Clinicians in CAD issue single-use, 24-hour linking codes (`NS-XXXXXX`).
   - Patients enter this code in the Chrome extension.
   - Two-identifier confirmation binds the patient to the clinic and activates purpose-specific consent (`clinician_link`, `purchase_timeline`, `diary`).
2. **The Target & Signed Bundle Distribution Bridge**:
   - Writing clinicians prescribe clinical nutrition targets (e.g., Sodium $\le 2000\,\text{mg/day}$, Sugars $\le 25\,\text{g/day}$).
   - The platform edge function (`publish-bundle`) compiles and signs an ES256 target bundle with anti-rollback protection (`bundle_version`).
   - The extension downloads the signed bundle into IndexedDB (`target_bundles`), replacing generic thresholds with custom medical targets on retailer sites (Carrefour, Naivas, Quickmart).
3. **The Consent & Crypto-Shredding Gate**:
   - Consent revocation immediately cuts off clinician access in CAD (Test T26).
   - Right to Erasure (DPA s.40 / Test T27) replaces patient references with irreversible tokens (`SHREDDED-...`) while maintaining the cryptographic SHA-256 audit chain.

---

## 2. Prerequisites & Building the Distribution

Ensure the project dependencies and build artifacts are clean and up to date before launching Chrome:

```powershell
# 1. Verify and enforce Row-Level Security policies across all migrations
npm run check:rls

# 2. Stage synthetic pilot fixtures (KNH Nutrition Unit, clinicians, cohorts, targets)
npm run stage:pilot

# 3. Verify the cryptographic audit log hash chain
npm run verify:audit

# 4. Build the complete distribution (DB + UI + Extension)
npm run build
```

This compiles:
- `dist/manifest.json` — Manifest V3 configuration with scripting permissions.
- `dist/cad.html` — The Clinic Admin Dashboard (CAD) web application.
- `dist/popup.html`, `dist/options.html`, `dist/onboarding.html`, `dist/dashboard.html` — Extension patient surfaces.
- `dist/background.js`, `dist/content.js`, `dist/db.js` — Service worker and content scripts.

---

## 3. Loading the Extension in Google Chrome

1. Open **Google Chrome**.
2. Navigate to `chrome://extensions/`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left toolbar.
5. In the file picker, select the `dist` directory:
   ```
   C:\Users\USER\Documents\NUT-04 Checkout Tool\dist
   ```
6. Confirm that **NutriScore Kenya** appears in the extension grid with:
   - Version: `0.0.1`
   - Manifest: `Manifest V3`
   - Permissions: `storage`, `unlimitedStorage`, `scripting`, `activeTab`
   - Background service worker: `service worker (Active)`
7. Click the Chrome **Extensions puzzle icon** in your toolbar and pin **NutriScore Kenya**.

---

## 4. Launching the Clinic Admin Dashboard (CAD)

You have two supported ways to open and interact with the CAD in Chrome:

### Method A: Direct Chrome Extension URL (Self-Contained)
Open a new tab in Chrome and enter the internal extension URL:
```text
chrome-extension://<YOUR_EXTENSION_ID>/cad.html
```
*(Replace `<YOUR_EXTENSION_ID>` with the 32-character ID shown on `chrome://extensions/`)*.

### Method B: Local Live Server (Hot Reloading)
In your terminal, start the Vite development server:
```powershell
npm run dev
```
Open Chrome and navigate to:
```text
http://localhost:5173/cad.html
```

---

## 5. Step-by-Step Live Testing Walkthrough

Follow these test flows sequentially to verify the entire multi-tenant clinical workflow.

### Flow 1: Authentication, Multi-Tenant Switching & MFA Challenge
1. Open CAD (`cad.html`).
2. You will see the **Clinic Admin Dashboard Sign-In** portal:
   - Enter email: `dr.omondi@knh.or.ke`
   - Enter password: `Password123!`
   - Click **Sign In to CAD**.
3. **MFA Challenge**:
   - Because `writing_clinician` is a privileged healthcare role, CAD immediately prompts for the **Two-Factor Authentication (MFA)** step.
   - Enter 6-digit TOTP code (e.g., `123456`) and click **Verify & Enter Dashboard**.
4. **Tenant Header & Role Display**:
   - Notice the top navigation bar displays:
     - Tenant: `Kenyatta National Hospital — Clinical Nutrition Unit`
     - Role Badge: `Writing Clinician` (Emerald border)
     - Security Badge: `MFA Active`
5. **Super Admin Tenant Switcher Test**:
   - Sign out and log in with a Super Admin account (`admin@nutriscore.co.ke`).
   - Notice the tenant dropdown appears in the header, allowing switching across clinics (KNH, Nairobi Hospital, Aga Khan).

---

### Flow 2: Cohort Analytics & Small-Cell Privacy Suppression (Test T13)
1. In CAD, click the **Cohorts & Overview** tab.
2. Observe the active patient cohorts:
   - **Type 2 Diabetes** ($n = 48$) $\to$ Full compliance statistics and nutrient averages rendered.
   - **Essential Hypertension** ($n = 35$) $\to$ Full compliance statistics rendered.
   - **Stage 3 Renal** ($n = 14$) $\to$ Full compliance statistics rendered.
   - **Rare Paediatric Inborn Metabolic Cohort** ($n = 3$):
3. **Small-Cell Suppression Test**:
   - When viewed under a `commercial_stakeholder` role, any cohort with fewer than $k = 5$ patients automatically masks values:
     - Count displays as: `Suppressed (k < 5)`
     - Average Sodium & Sugars: `NULL`
     - Compliance rate: `Hidden for re-identification protection`
   - Verify that patient counts $\ge 5$ remain visible.

---

### Flow 3: Patient–Clinician Linking (The Extension Bridge)
1. In CAD, click the **Linking & Consent** tab (`/consent`).
2. Under the top banner, click **Generate Patient Link Code**.
3. Observe the newly generated token:
   - Format: `NS-XXXXXX` (e.g., `NS-849201`).
   - Expiration notice: `Valid for 24 hours (Single Use)`.
4. Click the **Copy** icon next to the code.
5. In another tab or the extension popup:
   - Click the NutriScore toolbar icon $\to$ Open **Options** (`options.html`) or **Onboarding**.
   - Navigate to the **Clinic Integration** card.
   - Paste the code `NS-849201` and provide patient date of birth / national ID for two-identifier confirmation.
   - Click **Confirm Clinic Link**.
6. Switch back to CAD:
   - The link status dynamically updates from `pending` to `confirmed`.
   - The **Consent Ledger** records active permissions for `clinician_link`, `purchase_timeline`, and `diary`.

---

### Flow 4: Clinical Target Prescription & Co-Signature Verification (Test T25)
1. In CAD, navigate to **Patient Targets** (`/targets`).
2. Review the active clinical rules:
   - **Sodium Rule**: $\le 2000\,\text{mg/day}$ (Severity: Critical, WHO Hypertension protocol).
   - **Sugar Rule**: $\le 25\,\text{g/day}$ (Severity: Critical, Diabetes protocol).
3. **Prescribe a New Renal Target**:
   - Click **New Target Rule**.
   - Nutrient: `PotassiumMG`
   - Value: `2000` mg/day
   - Severity: `Critical`
   - Clinical Justification: `Stage 3 CKD hyperkalemia prevention protocol`
4. **Co-Signature Gate**:
   - Note the system requires a physician co-signature (`cosigned_by IS NOT NULL`) for Renal and Paediatric rules.
   - Submit the target. The trigger validates the Platform Safety Envelope and sets the rule to `active`.
5. **Signed Bundle Sync to Extension**:
   - Edge function `publish-bundle` compiles active targets and signs them with ES256 (`TARGET_SIGNING_KEY`).
   - On the patient side, the extension downloads the bundle into IndexedDB (`target_bundles`).
   - Verify that when the patient shops on Carrefour or Naivas, products exceeding $2000\,\text{mg}$ sodium or missing potassium trigger medical alert badges instead of generic defaults.

---

### Flow 5: Real-Time Consent Revocation & Right to Erasure (Tests T26 & T27)
1. In CAD, open the **Linking & Consent** tab.
2. Locate patient `PAT-0042` under the Consent Ledger:
   - Click the red **Revoke** button next to `clinician_link`.
3. **Verify Revocation (Test T26)**:
   - Consent status switches to `revoked`.
   - Navigating to patient-level details immediately displays:
     > *"Consent has been explicitly revoked by the patient. Patient-level data is inaccessible."*
4. **Trigger Right to Erasure / Crypto-Shredding (Test T27)**:
   - Click the **Trash icon** next to a patient record.
   - Confirm the DPA s.40 erasure confirmation prompt.
   - Notice the patient reference is replaced with `SHREDDED-PAT-XXXX-YYYY`.
   - Identifiable diary and target records are pseudonymized.
   - The audit log records `patient_erasure_crypto_shredded` while sequence numbers (`seq`) and hash chains remain valid.

---

### Flow 6: Verifying the Immutable Audit Log (Test T14)
1. In CAD, click the **Immutable Audit Log** tab (`/audit`).
2. Verify the live table:
   - **Seq**: Sequential numbers (`#1`, `#2`, `#3`, `#4...`) with zero gaps.
   - **Action**: `ONBOARD_TENANT`, `CREATE_TARGET`, `patient_link_confirmed`, `consent_revoked`.
   - **Row Hash**: Canonical SHA-256 hash preview.
3. Check the status badge at the top:
   - Displays **"SHA-256 Hash Chain Verified"** with a green checkmark.
4. Verify via terminal:
   ```powershell
   npm run verify:audit
   ```
   Output: `✅ [audit-verify] Hash chain intact! Verified entries. Head hash: ...`

---

### Flow 7: Billing Lifecycle & M-Pesa Payment Simulation (Tests T1–T9)
1. In CAD, click the **Billing & Plan** tab (`/billing`).
2. Current plan shows **Clinic Annual** (`KES 48,000 / year`).
3. Click **Renew Subscription via M-Pesa STK Push**:
   - Phone number: `254712345678`
   - Click **Send STK Push**.
4. Test failure routing simulation:
   - Simulate **User Cancelled (1032)** $\to$ Attempt status updates to `failed_cancelled`, optimistic flags rolled back.
   - Simulate **Insufficient Funds (1)** $\to$ Attempt status updates to `failed_funds`, 7-day grace period banner appears (`past_due`).
   - Simulate **Success (0)** $\to$ State immediately transitions to `active`, invoice marked paid, receipt generated, and audit event logged.

---

## 6. Chrome DevTools Inspection Guide

When testing live in Chrome, use DevTools to inspect each subsystem:

| Subsystem | What to Inspect | DevTools Location |
|---|---|---|
| **Service Worker** | Ensure `background.js` is active and handles message passing | `chrome://extensions/` $\to$ Inspect views: **service worker** |
| **IndexedDB** | Check stores: `product_cache`, `shopping_ledger`, `user_settings`, `target_bundles` | DevTools $\to$ **Application** $\to$ **Storage** $\to$ **IndexedDB** $\to$ `NutriScoreDB` |
| **Signed Bundles** | Confirm bundle signature (`sig_es256_...`) and `bundle_version` increment | DevTools $\to$ **Application** $\to$ **IndexedDB** $\to$ `target_bundles` |
| **JWT & Claims** | Inspect stored auth token with `tenant_id`, `role`, and `licence_verified` | DevTools $\to$ **Application** $\to$ **Local Storage** |
| **Network Requests** | Monitor calls to Supabase REST / Edge Functions (`publish-bundle`, `reconcile-payment`) | DevTools $\to$ **Network** $\to$ Filter `Fetch/XHR` |

---

## 7. Automated Test Suite Matrix

To verify all invariant checks before or after live Chrome testing, run:

```powershell
npm test
```

| Invariant Group | Test File | Scenarios Covered |
|---|---|---|
| **Phase 2: Multi-Tenant & RBAC** | `cad-phase2-multitenant.test.ts` | **T10** (Tenant isolation), **T11** (RLS policy gate), **T12** (Direct API 403 guard), **T13** (Small-cell suppression), **T14** (Immutable audit log), **T15** (Break-glass access) |
| **Phase 3: Payments & Billing** | `cad-phase3-payments.test.ts` | **T1** (ResultCode 1032 cancellation), **T2** (ResultCode 1 insufficient funds), **T3** (ResultCode 1037 timeout query), **T4** (Duplicate callback idempotency), **T5** (Amount mismatch quarantine), **T6** (Unknown checkout request quarantine), **T7** (Bad signature rejection), **T8** (Grace period to suspension), **T9** (Still-processing retry backoff) |
| **Phase 4: Targets & Bundles** | `cad-phase4-targets.test.ts` | **T16** (Bundle expiry fallback), **T17** (Anti-rollback protection), **T18** (Target revocation sync), **T20** (Missing nutrient completeness), **T21** (Salt-to-sodium derivation at 400mg/g), **T22** (Per-serving to per-100g conversion), **T23** (Atwater energy 8% check), **T25** (Renal potassium safety guard) |
| **Phase 5: Consent & Erasure** | `cad-phase5-consent.test.ts` | **T26** (Consent revocation visibility cut-off), **T27** (Crypto-shredding right to erasure) |
| **Phase 5: Health Modes & Engine** | `disease-engine-dynamic-rules.test.ts` | Dynamic rules evaluation across operators (`lte`, `gte`, `lt`, `gt`, `eq`), target IDs, clinical rationales, severities (`critical`, `high`, `warning`, `advisory`), backward compatibility for legacy condition presets |
| **Phase 7: Mock Scripts & Safety** | `mock-scripts.test.ts` | Production refusal safety gate, RFC 2606 `.test` domain constraints, CI release gate `--check-clean` validation |

---

## 8. Executing Section 5 — Auditing, Verifying & Handling Banned Legacy Accounts

Section 5 of the CAD-Only Identity Rollback establishes the protocol for legacy consumer accounts created before CAD authority was instituted. These accounts were marked `legacy_unprovisioned` and banned (`banned_until = '2099-01-01'`) in migration `20261029040000_remove_google_and_ban_legacy.sql`.

### Step 5.1: SQL Audit & Verification of Legacy Accounts
1. Connect to the database using Supabase SQL Editor or `psql`:
   ```sql
   -- Inspect all banned legacy unprovisioned accounts
   SELECT 
     u.id, 
     u.email, 
     u.banned_until, 
     u.raw_app_meta_data->>'cad_provisioned' AS cad_provisioned,
     u.raw_app_meta_data->>'status' AS app_status,
     tm.role AS cad_role,
     tm.status AS tenant_status
   FROM auth.users u
   LEFT JOIN public.tenant_members tm ON tm.user_id = u.id
   WHERE u.banned_until = '2099-01-01 00:00:00+00'::timestamptz
      OR tm.id IS NULL;
   ```
2. **Verification Invariant:**
   - Confirm that all legacy consumer accounts have:
     - `banned_until = '2099-01-01 00:00:00+00'`
     - `app_status = 'legacy_unprovisioned'`
     - Zero matching rows in `public.tenant_members` (`cad_role IS NULL`).
   - Confirm that zero identities remain with `provider = 'google'`:
     ```sql
     SELECT COUNT(*) FROM auth.identities WHERE provider = 'google';
     -- Expected: 0
     ```

### Step 5.2: Live Chrome Testing — Rejection of Banned Account Authentication
1. Open Google Chrome with the unpacked extension loaded.
2. Navigate to the extension onboarding page:
   ```text
   chrome-extension://<EXTENSION_ID>/onboarding.html
   ```
3. Attempt to sign in with a known legacy banned email (e.g. `legacy_google_user1@gmail.com` or `legacy_consumer_selfsignup@yahoo.com`):
   - Enter email and any password.
   - Click **Sign In with Clinic Credentials**.
4. **Expected UI & Network Behavior:**
   - **User Surface:** Displays generic security error message: `"Invalid login credentials"`.
   - **DevTools Network Tab:** The POST to `/auth/v1/token?grant_type=password` returns HTTP 400:
     ```json
     {
       "error": "invalid_grant",
       "error_description": "User is banned"
     }
     ```
   - **Security Invariant:** The client interface purposely sanitizes the error to `"Invalid login credentials"` to prevent account enumeration attacks while the backend strictly enforces the ban.

### Step 5.3: Verifying Session Revocation & Storage Purge
1. If an existing browser session previously held a token for a banned account:
   - When the extension opens, `supabase.auth.getSession()` attempts token rehydration or refresh.
   - The token refresh request is rejected with HTTP 400 (`User is banned`).
   - The extension immediately triggers `signOutUser()`.
2. Inspect Chrome DevTools $\to$ **Application** $\to$ **Storage** $\to$ **Local Storage**:
   - Verify that `nutri_supabase_session` is cleared.
   - Verify that `nutri_entitlement` is cleared.
   - Verify that `patient_consent_accepted` is false or cleared.
   - The user is redirected to `onboarding.html`.

### Step 5.4: Controlled 90-Day Purge Execution Protocol
In compliance with Kenya Data Protection Act (DPA 2019) data retention standards, legacy rows are quarantined for 90 days before permanent deletion. After 90 days:
```sql
-- Hard purge executed only after 90-day retention review by Kibet / Compliance Officer:
DELETE FROM auth.users 
WHERE raw_app_meta_data->>'status' = 'legacy_unprovisioned'
  AND banned_until = '2099-01-01 00:00:00+00'::timestamptz;
```

---

## 9. Executing Section 6 — Local Mock Environment Seeding, Chrome Live Testing & Purge Lifecycle

Section 6 defines the standardized local test personas using the RFC 2606 reserved `.test` domain.

### Step 6.1: Environment Pre-Flight & Safety Verification
1. Ensure your local Supabase stack is running:
   ```powershell
   npx supabase status
   ```
   Confirm API URL is `http://127.0.0.1:54321`.
2. Test the production refusal safety gate:
   ```powershell
   $env:SUPABASE_URL = "https://nqcpudpkrkutpxuqpsfk.supabase.co"
   node scripts/seed-mock-users.mjs
   ```
   **Expected output:**
   ```text
   ❌ REFUSING TO RUN: seed-mock-users.mjs may only be run against a LOCAL Supabase instance.
   Target URL was: https://nqcpudpkrkutpxuqpsfk.supabase.co
   ```
3. Remove the override to point back to local:
   ```powershell
   $env:SUPABASE_URL = "http://127.0.0.1:54321"
   ```

### Step 6.2: Seeding the Mock Clinic & Personas
1. Run the seed script:
   ```powershell
   npm run seed:mocks
   ```
2. Observe the terminal output:
   - Creates Mock Tenant: `Nairobi Metabolic Care Clinic` (`11111111-2222-3333-4444-555555555555`).
   - Creates 5 accounts in `auth.users`, `public.users`, and `public.tenant_members`.
   - Links Patient 1 (`David Kiprono`) and Patient 2 (`Sarah Achieng`) to Dr. Joseph Mwangi (`dr.mwangi@clinic.test`).
   - Grants Version 2.0 Care Consent for both patients.
   - Generates `.mock-credentials.json` (git-ignored).
3. Open `.mock-credentials.json` in your editor to read the generated secure passwords:
   ```json
   {
     "users": {
       "clinic_admin": { "email": "admin@clinic.test", "password": "Admin!..." },
       "clinician": { "email": "dr.mwangi@clinic.test", "password": "Doc!..." },
       "dietician": { "email": "dietician.wanjiku@clinic.test", "password": "Diet!..." },
       "patient_diabetes": { "email": "patient1@clinic.test", "password": "Pat1!..." },
       "patient_hypertension": { "email": "patient2@clinic.test", "password": "Pat2!..." }
     }
   }
   ```

### Step 6.3: Step-by-Step Live Chrome Testing by Persona

#### Persona A: Clinic Admin (`admin@clinic.test`)
1. Open CAD in Chrome: `http://localhost:5173/cad.html` (or `chrome-extension://<EXTENSION_ID>/cad.html`).
2. Log in with `admin@clinic.test` and password from `.mock-credentials.json`.
3. Enter MFA OTP: `123456`.
4. **Verify Header:** Displays `Nairobi Metabolic Care Clinic`, Role: `Tenant Admin`.
5. **Staff & Licences View (`/users`):**
   - Verify clinician table lists:
     - `Dr. Joseph Mwangi` (`writing_clinician`, KMPDC A.4921, Verified).
     - `Grace Wanjiku` (`viewing_dietician`, KNDI D.1082, Verified).
   - Click **Provision New User**:
     - Attempt to provision a user with role `super_admin`.
     - Verify: Invariant blocks this; only roles strictly below `tenant_admin` are permitted in the dropdown.
6. **Health Modes View (`/modes`):**
   - Click the **Health Modes** tab in the top navigation.
   - Review catalog coverage metrics: `SugarsG (98%)`, `SodiumMG (96%)`, `TransFatG (45%)`.
   - Click **Cardio-Metabolic (Type 2 Diabetes)** preset $\to$ Inspect rules:
     - `SugarsG <= 22.5g` (Critical)
     - `CarbohydratesG <= 60.0g` (High)
     - `EnergyKcal <= 400 kcal` (Warning)

#### Persona B: Writing Clinician (`dr.mwangi@clinic.test`)
1. Sign out of CAD and sign in with `dr.mwangi@clinic.test`.
2. Enter MFA OTP: `123456`.
3. Header displays Role: `Writing Clinician`.
4. **Patient Targets View (`/targets`):**
   - Select patient `David Kiprono` (`patient1@clinic.test`).
   - Click **Add Target Rule**:
     - Nutrient: `SugarsG`
     - Comparator: `lte`
     - Threshold: `20.0` g / 100g
     - Severity: `High`
     - Clinical Rationale: `Restrict refined sugar < 20g/100g per KNDI clinical guidelines`
     - Click **Save Rule**.
5. **Linking & Consent View (`/consent`):**
   - Verify that David Kiprono and Sarah Achieng display active care links with Consent Version `2.0`.

#### Persona C: Viewing Dietician (`dietician.wanjiku@clinic.test`)
1. Sign out and sign in with `dietician.wanjiku@clinic.test`.
2. Verify role badge displays `Viewing Dietician`.
3. Navigate to **Patient Targets**:
   - Confirm patient targets and nutrient progress are visible in read-only mode.
   - Confirm write/edit buttons (`Add Target Rule`, `Edit Rule`) are disabled or hidden, adhering to least-privilege RBAC.

#### Persona D: Patient 1 — Type 2 Diabetes (`patient1@clinic.test`)
1. Open Chrome extension onboarding:
   ```text
   chrome-extension://<EXTENSION_ID>/onboarding.html
   ```
2. Enter `patient1@clinic.test` and initial password from `.mock-credentials.json`.
3. **First-Login Password Reset Gate:**
   - Prompt displays: *"Temporary Password Detected — Set New Secure Password"*.
   - Enter new password (e.g., `PatientCare2026!`).
   - Click **Update Password & Continue**.
4. **Care Consent Gate (Version 2.0):**
   - Displays Kenya DPA 2019 / Digital Health Act 2023 compliant data-sharing agreement:
     - Clinic: `Nairobi Metabolic Care Clinic`
     - Attending Clinician: `Dr. Joseph Mwangi`
     - Purpose: Clinical dietary monitoring and shopping nutrition guidance.
   - Click **Accept & Begin Care Monitoring**.
5. **Options Page ("My Care Profile"):**
   - Navigate to `options.html`.
   - Confirm top card displays **"My Care Profile"**:
     - Mode: `Cardio-Metabolic (Type 2 Diabetes)`
     - Clinician: `Dr. Joseph Mwangi`
     - Rules: `Sugars <= 22.5g`, `Carbohydrates <= 60.0g`.
     - Confirm condition picker is completely absent; condition is clinician-owned.
6. **Live Grocery Shopping Badges Test:**
   - In Chrome, navigate to **Naivas** (`naivas.online`) or **Carrefour Kenya** (`carrefour.ke`).
   - Browse to a confectionery or soft drink product with Sugars $> 22.5\text{g}/100\text{g}$.
   - Click the NutriScore badge on the product card.
   - **Verify Flyout Warning:**
     - Displays: `"Diabetes Risk: High sugar (>22.5g per 100g)"`.
     - WCAG AA compliant alert text.
     - Note: No "Basic Plan" banner or "Upgrade to Premium" prompt appears. Full analytics are unlocked under clinical care entitlement.

#### Persona E: Patient 2 — Hypertension Care (`patient2@clinic.test`)
1. Open Chrome in a second browser profile or incognito window.
2. Sign in with `patient2@clinic.test`.
3. Navigate to the **Shopper Dashboard** (`dashboard.html`):
   - **Greeting Test:** Confirms dynamic greeting: `"Good morning/afternoon, Sarah"` (first name only, per privacy mandate).
   - **Subtitle:** Confirms `"Shopper Dashboard — Shopping Analytics"`.
   - **Clinical Metric Cards:** Highlights Sodium and Saturated Fat compliance.
4. **Retailer Alert Test:**
   - On Carrefour or Naivas, view a product with Sodium $> 600\text{mg}/100\text{g}$ (e.g. salted chips or seasoning).
   - Click badge to view flyout:
     - Warning: `"Hypertension Risk: High sodium (>600mg per 100g)"`.
     - Badge displays `#C2410C` high-contrast orange indicator.

### Step 6.4: Executing Mock Purge & CI Release Gate Check
1. When local testing is complete, purge all mock data:
   ```powershell
   npm run purge:mocks
   ```
2. Verify terminal output:
   - Deletes `consents`, `patient_links`, `targets`, `tenant_members`, and `users` for all `.test` accounts.
   - Calls `auth.admin.deleteUser` for all 5 mock auth accounts.
   - Deletes mock tenant `11111111-2222-3333-4444-555555555555`.
   - Removes `.mock-credentials.json` from the filesystem.
3. Run the CI release gate check:
   ```powershell
   npm run purge:mocks -- --check-clean
   ```
   **Expected output:**
   ```text
   [purge-mocks] Connecting to Supabase at: http://127.0.0.1:54321
   [purge-mocks] Running CI Release Gate Check (--check-clean)...
   ✅ CI RELEASE GATE PASSED: Zero mock users or mock tenant records found.
   ```

---

## 10. Executing Section 7 — Hosted Supabase Promotion & Production Staging Operational Runbook

Section 7 details the manual operational sequence required to promote the CAD-Only Identity changes to the hosted Supabase environment (`nqcpudpkrkutpxuqpsfk`).

> ⚠️ **CRITICAL OPERATING DIRECTIVE:**  
> Never run `npm run seed:mocks` or local test scripts against the hosted project. Hosted deployment must strictly execute forward-only migrations and production-safe scripts.

### Step 7.1: Hosted Project Pre-Flight Verification
1. Verify Supabase CLI project link:
   ```powershell
   npx supabase projects list
   ```
   Confirm project reference: `nqcpudpkrkutpxuqpsfk` (`NUT-04 Nutriscore`).
2. Verify current database migration version:
   ```powershell
   npx supabase migration list --project-ref nqcpudpkrkutpxuqpsfk
   ```

### Step 7.2: Sequential Migration Execution (Forward-Only & Idempotent)
Execute database migrations in exact numerical order against the hosted instance:

```powershell
npx supabase db push --project-ref nqcpudpkrkutpxuqpsfk
```

Verify that the 4 new rollback migrations apply in sequence:
1. `supabase/migrations/20261029040000_remove_google_and_ban_legacy.sql`:
   - Deletes Google OAuth identities from `auth.identities`.
   - Marks legacy unprovisioned users and sets `banned_until = '2099-01-01'`.
   - *Reversal note: Set `banned_until = null` for specific accounts if needed.*
2. `supabase/migrations/20261029050000_rbac_provisioning_lifecycle.sql`:
   - Configures `tenant_members` lifecycle state machine (`invited` $\to$ `active` $\to$ `suspended` $\to$ `deactivated`).
   - Updates `custom_access_token_hook` to inject `tenant_id`, `role`, and `status` into JWT claims.
   - Deploys `deactivate_tenant_member` RPC with global session revocation.
3. `supabase/migrations/20261029055000_patient_consent_gate.sql`:
   - Creates `public.consents` table with strict RLS policies.
   - Deploys `check_patient_consent` RPC.
4. `supabase/migrations/20261029060000_clinician_health_modes.sql`:
   - Creates `tracked_nutrients` catalog registry with completeness metrics.
   - Creates `health_modes` and `health_mode_rules` tables with RLS.

### Step 7.3: Edge Function Compilation & Deployment
Deploy the privileged `admin-provision-user` Edge Function:

```powershell
npx supabase functions deploy admin-provision-user --project-ref nqcpudpkrkutpxuqpsfk
```

**Verification:**
1. Check function status:
   ```powershell
   npx supabase functions list --project-ref nqcpudpkrkutpxuqpsfk
   ```
2. Verify that `verify_jwt = true` is enforced in `supabase/config.toml` so anon callers cannot reach it.
3. Verify that `SUPABASE_SERVICE_ROLE_KEY` is available in the Edge Function environment secrets.

### Step 7.4: Supabase Auth Console Hardening
Log in to the [Supabase Web Management Console](https://supabase.com/dashboard/project/nqcpudpkrkutpxuqpsfk):

1. **Disable Google OAuth:**
   - Navigate to **Authentication** $\to$ **Providers** $\to$ **Google**.
   - Toggle **Enable Google provider** to **OFF**.
   - Click **Save**.
2. **Disable Public Sign-Ups:**
   - Navigate to **Authentication** $\to$ **Configuration** $\to$ **Sign Up**.
   - Toggle **Allow new users to sign up** to **OFF** (`enable_signup = false`).
   - Toggle **Allow anonymous sign-ins** to **OFF** (`enable_anonymous_sign_ins = false`).
   - Click **Save**.
3. **Verify Security Invariant:**
   - Try creating an account via `curl -X POST 'https://nqcpudpkrkutpxuqpsfk.supabase.co/auth/v1/signup' ...`
   - Confirm response: `{"code": 403, "msg": "Signups not allowed for this instance"}`.

### Step 7.5: Bootstrapping the Platform Super Administrator
1. Run the bootstrap script targeting the hosted project by providing explicit service-role credentials:
   ```powershell
   $env:SUPABASE_URL = "https://nqcpudpkrkutpxuqpsfk.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "<PROD_SERVICE_ROLE_KEY>"
   $env:SUPER_ADMIN_EMAIL = "admin@nutriscore.co.ke"
   node scripts/bootstrap-super-admin.mjs
   ```
2. Observe terminal confirmation:
   - Platform Tenant `00000000-0000-0000-0000-000000000000` verified.
   - Super admin user `admin@nutriscore.co.ke` provisioned with `role = 'super_admin'`.
   - Initial temporary master password output.
3. **Immediate Operational Action:**
   - Open CAD (`cad.html`).
   - Log in as `admin@nutriscore.co.ke` with the master password.
   - Navigate to Security Settings and pair TOTP authenticator app (Google Authenticator / 1Password).
   - Verify MFA status badge turns green (`MFA Active`).

### Step 7.6: Row Level Security (RLS) Policy Audit
Verify that all 16 tenant-scoped tables have active RLS policies:

```powershell
npm run check:rls
```

**Expected verification output:**
```text
[check-rls] Found 16 tenant-scoped table(s): tenants, tenant_members, audit_log, subscriptions, invoices, payment_attempts, targets, target_bundles, consumption_diary, consent_records, patient_links, consents, health_modes, health_mode_rules, users, payments
✅ [check-rls] All tenant-scoped tables have RLS enabled and policies defined.
```

### Step 7.7: Production Release Gate Clearance
Run the CI release gate check against the hosted database to guarantee zero mock `.test` accounts exist:

```powershell
node scripts/purge-mocks.mjs --check-clean
```

**Expected output:**
```text
[purge-mocks] Connecting to Supabase at: https://nqcpudpkrkutpxuqpsfk.supabase.co
[purge-mocks] Running CI Release Gate Check (--check-clean)...
✅ CI RELEASE GATE PASSED: Zero mock users or mock tenant records found.
```

---

## 11. Summary Checklist for QA & Deployment Verification

- [ ] Extension loaded unpacked from `dist/` without manifest errors.
- [ ] CAD accessed via `chrome-extension://<id>/cad.html` or `http://localhost:5173/cad.html`.
- [ ] Privileged roles challenge for MFA before accessing clinical views.
- [ ] Legacy unprovisioned accounts are rejected with sanitized `"Invalid login credentials"` error.
- [ ] Mock users seeded cleanly via `npm run seed:mocks` and `.mock-credentials.json` remains git-ignored.
- [ ] Patient 1 forces password reset on first login and passes Version 2.0 Consent Gate.
- [ ] Options page reflects read-only "My Care Profile" with clinician name and prescribed rules.
- [ ] Retailer badges on Naivas, Carrefour, and Quickmart render medical warning alerts without premium upgrade prompts.
- [ ] `npm run purge:mocks` purges all `.test` records and `--check-clean` passes.
- [ ] Hosted Supabase migrations 20261029040000 through 20261029060000 applied in numerical sequence.
- [ ] Google OAuth and public signup toggled OFF in Supabase Auth Console.
- [ ] `admin-provision-user` Edge Function deployed with `verify_jwt = true`.
- [ ] Platform Super Admin bootstrapped and MFA enrolled.
- [ ] All 16 tenant-scoped tables pass RLS audit (`npm run check:rls`).
- [ ] All 450 unit and integration tests pass cleanly (`npm test`).


