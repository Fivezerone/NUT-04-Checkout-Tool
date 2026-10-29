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

---

## 8. Summary Checklist for QA / Clinical Pilots

- [ ] Extension loaded unpacked from `dist/` without manifest errors.
- [ ] CAD accessed either via `chrome-extension://<id>/cad.html` or `localhost:5173/cad.html`.
- [ ] Privileged roles challenge for MFA before accessing clinical views.
- [ ] Single-use patient link code successfully connects extension to clinic.
- [ ] Prescribed targets take precedence over platform generic thresholds.
- [ ] Cohort sizes below $k = 5$ are suppressed for commercial roles.
- [ ] Patient revocation and erasure crypto-shredding preserve the audit hash chain.
- [ ] All 436 automated unit tests pass with zero errors.

