# NUT-04 Checkout Tool — Live Chrome Environment Testing & Verification Guide

> **Scope:** Full-System Verification of Dockerized Architecture (Stages A, B, and C)  
> **Environment:** Dockerized Microservices Stack behind Caddy API Gateway (`http://localhost:8080` / `https://localhost:8443`). Decommissioned Supabase (ADR-0001).  
> **Branch:** `refactor/decay-cleanup-docker-ui`  
> **Security Baseline:** Host-Isolation Policy (Rule R4), Zero Hardcoded PII/Credentials (Rule R5 & Stage B), 3-Tier Design System & Clinical UI (Stage C).

---

## Executive Summary & System State

This guide specifies the definitive manual and semi-automated verification procedures for testing the **NUT-04 Checkout Tool** Chrome extension and **Clinic Admin Dashboard (CAD)** in a live Google Chrome environment.

### Architectural Evolution
1. **Stage A (Decommissioning & Dockerization):** Supabase GoTrue, Supabase Studio, and local Supabase Docker containers have been completely purged (ADR-0001). The backend is replaced by an enterprise-grade, containerized microservices stack: **PostgreSQL 16 (Bookworm)**, **Keycloak 26.2.5 (Quarkus)** for OIDC authentication, **PostgREST 12.2.3** for direct database REST exposure with row-level security (RLS), **Node.js API service** for ported edge services, and an **Nginx unprivileged** container hosting the CAD application, all reverse-proxied behind **Caddy 2.9.1**.
2. **Stage B (Hardcoded Data Elimination):** Zero real clinician names, patient identifiers, hospital titles (such as Kenyatta National Hospital or Aga Khan University Hospital), or real phone numbers exist in the codebase. All testing uses synthetic, dynamically provisioned tenant data and standard `.test` domain identities.
3. **Stage C (UI/UX Overhaul & Clinical Shell):** 3-tier CSS custom property token architecture (`--t-color-...`), WCAG 2.1 AA accessible primitives (`GradeBadge`, `KpiCard`, `TargetMeter`, `ConfirmDialog`, `ConditionChip`), 4-timeframe timeline model (`today`, `week`, `month`, `3months`) with a strict 90-day retention cutoff, zero-truncation tables, and typed-phrase crypto-shredding (`SHRED`).

> [!IMPORTANT]
> **Strict Host Isolation (Rule R4):**  
> Under no circumstances should build, test, lint, database, or package management commands execute directly on the host operating system. The host machine runs **only** `git` and `docker`. All verification actions are executed through the cross-platform orchestration wrappers:
> - **Windows PowerShell:** `.\bin\nut.ps1 <verb>` or `docker compose exec toolchain ...`
> - **POSIX / Bash:** `./bin/nut <verb>` or `docker compose exec toolchain ...`

---

## Quick Reference Table

| Service / Component | Container / Process | Ingress URL / Access Point | Credentials / Authentication |
|---|---|---|---|
| **API Gateway (HTTP)** | `gateway` (Caddy 2.9.1) | `http://localhost:8080` | None (Public ingress & routing) |
| **API Gateway (HTTPS/TLS)** | `gateway` (Caddy 2.9.1) | `https://localhost:8443` | TLS self-signed / internal CA |
| **CAD Web Application** | `cad` (Nginx unprivileged) | `http://localhost:8080/cad/` (or `http://localhost:8080/cad.html`) | Authenticated via Keycloak OIDC |
| **Keycloak OIDC Realm** | `keycloak` (Quarkus 26.2.5) | `http://localhost:8080/auth/` (Realm: `nutriscore`) | Realm import: `infra/keycloak-realm.json` |
| **Keycloak Admin Console** | `keycloak` (Quarkus 26.2.5) | `http://localhost:8080/auth/admin` | `admin` / `.secrets/kc_admin_password` |
| **PostgREST REST API** | `postgrest` (v12.2.3) | `http://localhost:8080/api/` (proxied to `postgrest:3000`) | Bearer JWT with `app_role` claim |
| **Node.js API Service** | `api` (Node 22 slim) | `http://localhost:8080/api/v1/` (proxied to `api:4000`) | Bearer JWT / Internal service tokens |
| **Mailpit (Dev Mail)** | `mailpit` (v1.22.3) | `http://localhost:8025/` | None (inspect outgoing OTPs & alerts) |
| **PostgreSQL Database** | `postgres` (16-bookworm) | Internal port `postgres:5432` | User: `nutriscore_app`, DB: `nutriscore` |
| **Toolchain Runner** | `toolchain` (Node 22 slim) | Container execution context | Non-root `node` user in `/app` |
| **Chrome Extension** | Unpacked Manifest V3 | `chrome://extensions` → `./dist/extension` | Local isolated client |

---

## Getting Started: Opening PowerShell & Host Isolation Guardrails

### Step 1 — Open PowerShell in the Repository Root
1. Open Windows File Explorer and navigate to:
   `c:\Users\USER\Documents\NUT-04 Checkout Tool`
2. Click the File Explorer address bar, type `powershell`, and press `Enter`.
3. Verify your location and branch:
   ```powershell
   pwd
   # Expected: c:\Users\USER\Documents\NUT-04 Checkout Tool
   git branch --show-current
   # Expected: refactor/decay-cleanup-docker-ui
   ```

### Step 2 — Wrapper Command Parity (`bin/nut.ps1` vs `bin/nut`)
The `bin/nut.ps1` PowerShell script mirrors the POSIX `bin/nut` wrapper. The available verbs are:

| Verb | PowerShell Invocation | Underlying Docker Command |
|---|---|---|
| `up` | `.\bin\nut.ps1 up` | `docker compose --profile dev up --build` |
| `down` | `.\bin\nut.ps1 down` | `docker compose --profile dev down` |
| `ci` | `.\bin\nut.ps1 ci` | `docker compose --profile ci run --rm ci` |
| `extension`| `.\bin\nut.ps1 extension`| `docker buildx build --target extension-artifact --output type=local,dest=./dist/extension .` |
| `e2e` | `.\bin\nut.ps1 e2e` | `docker compose --profile e2e run --rm e2e` |
| `db-reset` | `.\bin\nut.ps1 db-reset` | Drops and re-applies migrations with `dbmate` |
| `logs` | `.\bin\nut.ps1 logs` | `docker compose --profile dev logs -f` |
| `shell` | `.\bin\nut.ps1 shell [svc]`| `docker compose --profile dev run --rm [svc] bash` |

---

## Pre-Flight Checklist

Execute these verification checks in order before launching the Chrome browser.

### 1. Launch the Docker Stack
```powershell
.\bin\nut.ps1 up -d
```
> **Expected:** Docker Compose builds and starts the full development profile in the background.

Verify that all services reach healthy status:
```powershell
docker compose ps
```
> **Expected:** 8 services running and healthy:
> - `postgres` (healthy)
> - `migrate` (exited 0 / completed)
> - `keycloak` (healthy)
> - `postgrest` (running)
> - `api` (healthy)
> - `gateway` (healthy)
> - `cad` (healthy)
> - `mailpit` (healthy)

### 2. Run the Full Automated CI Suite via Docker (Host Isolation)
```powershell
.\bin\nut.ps1 ci
```
> **Expected Output:**
> - `[1/10] Secrets scan:` 0 tracked secrets detected.
> - `[2/10] Hardcoded data check:` 0 violations in source code.
> - `[3/10] Manifest check:` 0 global window leaks.
> - `[4/10] CAD security check:` Invariants verified.
> - `[5/10] Syntax check:` `content.js` passes Node syntax validation.
> - `[6/10] Prettier format check:` All files conform to formatting standards.
> - `[7/10] ESLint:` 0 errors.
> - `[8/10] TypeScript compilation:` `✓ TypeScript check passed: 0 errors`.
> - `[9/10] Vitest suite:` `45 passed (45) | 793 passed (793)`.
> - `[10/10] Production build:` Successfully compiles `dist/` and `dist-ui/cad`.

### 3. Build the Deterministic Extension Artifact
```powershell
.\bin\nut.ps1 extension
```
> **Expected:** Outputs unpacked extension to `./dist/extension` containing `manifest.json`, `content.js`, icons, and bundled scripts.

### 4. Database Migration Verification (`dbmate`)
```powershell
.\bin\nut.ps1 db-reset
```
> **Expected:** Applies all versioned migrations from `db/migrations/0001_baseline.sql` cleanly against Postgres.

---

## Database Execution Pattern (PowerShell to Docker Postgres)

Because direct host `psql` is forbidden by Rule R4, database queries and SQL test assertions are piped directly into the containerized Postgres service:

### Windows PowerShell Pattern
```powershell
# Interactive psql session inside container
docker compose exec postgres psql -U nutriscore_app -d nutriscore

# Single SQL command execution
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "SELECT current_database(), current_user;"

# Piping an external SQL file
Get-Content db\tests\<test_file>.sql | docker compose exec -T postgres psql -U nutriscore_app -d nutriscore
```

---

## Section 1 — Extension Loading & Manifest Verification

**Goal:** Confirm the Manifest V3 extension loads cleanly in Chrome with no forbidden permissions or runtime leaks.

### 1.1 Load the Unpacked Extension in Chrome
1. Launch Google Chrome.
2. In the omnibox, navigate to: `chrome://extensions`
3. Toggle the **Developer mode** switch (top-right corner) to **ON**.
4. Click the **Load unpacked** button (top-left).
5. In the file picker, select:
   `c:\Users\USER\Documents\NUT-04 Checkout Tool\dist\extension`
6. Verify that the **NUT-04 Checkout Tool** card appears with:
   - Version `0.0.1` (or current semantic version)
   - Active status with no red "Errors" button or badge.

### 1.2 Manifest Permissions Audit
Click **Details** on the extension card and inspect permissions:

| Permission | Expected State | Security Reason |
|---|---|---|
| `identity` | **ABSENT** | Banned: Chrome identity API must not leak Google account tokens. |
| `storage` | **PRESENT** | Required for local client configuration and rule-pack caching. |
| `activeTab` | **PRESENT** | Required for retail DOM inspection upon user activation. |
| Background Service Worker | **Active (`service-worker.js`)** | Manages background alarm sync and rules. |

Alternatively, verify via command:
```powershell
docker compose exec toolchain node scripts/check-manifest-globals.mjs
```
> **Expected:** `0 global variable leaks reported. Manifest V3 compliant.`

### 1.3 Service Worker Inspection
1. On `chrome://extensions`, locate the NUT-04 card.
2. Click **Inspect views: service worker** to open DevTools for the extension background.
3. In the DevTools **Console** tab, verify:
   - Zero uncaught exceptions on startup.
   - Initialized state messages.
4. In the DevTools **Network** tab, verify:
   - **Zero** requests to legacy endpoints or external tracking services.

### 1.4 Shopper Popup Smoke Test & Dashboard Navigation
1. Click the NUT-04 icon in the Chrome toolbar to open `popup.html`.
2. Inspect the UI layout:
   - Header with **NutriScore** badge and version.
   - **Health Focus Selection:** Displays mode selection pills using the Stage C `ConditionChip` component.
   - **Accessible Targets:** All clickable chips and toggles satisfy minimum 44px touch targets.
   - **Dark Mode Parity:** If OS is in dark mode, the popup renders high-contrast slate surfaces (`--t-color-surface-card`).
3. **Actions & Patient Dashboard Access:**
   - **Enrolled Shoppers (`#open-dashboard-btn`):** When authenticated with an active clinical session, renders **Open Shopper Dashboard** leading to `dashboard.html`.
   - **Unauthenticated / Incomplete Shoppers (`#open-auth-btn`):** In accordance with `Docs/ui-ux-overhaul-report.md` §4.4, replaces the dashboard button with **Sign in with Clinic Credentials** (or **Complete Care Consent**), opening `dashboard.html` to present the clinical onboarding and consent gate. The extension popup is strictly a patient/shopper surface and contains no clinical administrative entrypoints.
4. Right-click the popup → **Inspect**:
   - Console must be clean of errors and warnings.

---

## Section 2 — Keycloak OIDC Authentication & JWT Claims Contract

**Goal:** Verify the enterprise OIDC authentication flow and ensure strict claims adherence (no PHI or raw PII in tokens).

### 2.1 Sign In to the CAD Web Application

Navigate in Chrome to the dedicated CAD entrypoint:

- **Docker Compose Gateway:**  
  `http://localhost:8080/cad/`  
  *(Note: navigating to `http://localhost:8080/cad.html` or `http://localhost:8080/cad` automatically redirects with HTTP 301 to `/cad/`)*.  
  The Caddy gateway reverse-proxies `/cad/*` to the dedicated Nginx container (`cad:8080`), `/auth/*` to Keycloak (`keycloak:8080`), and `/api/*` to PostgREST (`postgrest:3000`).

1. Open Chrome and navigate to `http://localhost:8080/cad/`.
2. The CAD Clinical Login portal renders cleanly with NutriScore branding, email, and password fields.
3. Sign in with the test clinician account:
   - **Username / Email:** `clinician.one@clinic.test`
   - **Password:** Preloaded via `infra/keycloak-realm.json` or `.secrets/`

### 2.2 Inspect the JWT Token in Chrome DevTools
1. Press `F12` to open DevTools → Navigate to the **Network** tab.
2. Filter for `token` or look for the Keycloak OIDC token exchange response:
   `POST http://localhost:8080/auth/realms/nutriscore/protocol/openid-connect/token`
3. Copy the returned `access_token`.
4. Inspect the payload claims using the toolchain container:
   ```powershell
   docker compose exec toolchain node -e "const token = '<PASTE_JWT_HERE>'; console.log(JSON.stringify(JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()), null, 2));"
   ```

### 2.3 Token Claims Verification Matrix

| Claim | Expected Value | Classification / Rule |
|---|---|---|
| `app_role` | `writing_clinician` (or selected role) | **Mandatory:** Mapped from Keycloak realm role. |
| `tenant_id` | `11111111-1111-1111-1111-111111111111` | **Mandatory:** Multi-tenant clinic scoping UUID. |
| `lic_ok` | `true` | **Mandatory:** Professional regulatory license flag. |
| `sid` | UUID string | **Mandatory:** Active session ID for revocation denylist. |
| `ver` | `1` | **Mandatory:** Token claims schema version. |
| `sub` | UUID string | **Mandatory:** Opaque user ID. |
| `email` | Omitted or blanked `""` | **Privacy:** Raw email must not leak in transit. |
| `diagnosis` | **MUST BE ABSENT** | **PHI Protection:** Diagnostic data must never appear in JWT. |
| `health_mode`| **MUST BE ABSENT** | **Inference Vector:** Condition inferences strictly banned. |
| `national_id`| **MUST BE ABSENT** | **PII Protection:** National identity numbers strictly banned. |
| `callerRank` | **MUST BE ABSENT** | **Security:** Deprecated rank-comparison scheme forbidden. |

### 2.4 Session Denylist & Immediate Revocation Test
Test that revoking a session instantly denies access across the gateway and PostgREST.

1. Obtain the current session ID (`sid`) from the decoded token.
2. In PowerShell, insert the session into the denylist:
   ```powershell
   docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
   INSERT INTO iam.session_denylist (sid, banned_until, reason)
   VALUES ('<sid-from-jwt>', NOW() + INTERVAL '2 hours', 'Security verification test');"
   ```
3. In Chrome, refresh `http://localhost:8080/cad/` or trigger a data fetch.
4. **Expected:** PostgREST and the CAD UI return `HTTP 401 Unauthorized` with immediate session invalidation.

---

## Section 3 — Multi-Tenant Isolation & Restrictive RLS

**Goal:** Confirm that Tenant 1 clinical records and patient data are strictly invisible to Tenant 2 sessions.

### 3.1 RLS Coverage Check
Execute the RLS policy inspection script via the toolchain:
```powershell
docker compose exec toolchain node scripts/check-rls-policies.mjs
```
> **Expected:** All tenant-scoped relations are confirmed protected by forced restrictive RLS. Zero uncovered tables.

### 3.2 SQL Cross-Tenant Isolation Test
Simulate a request authenticated as a Tenant 1 clinician attempting to query Tenant 2 patients:

```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000001\",\"tenant_id\":\"11111111-1111-1111-1111-111111111111\",\"app_role\":\"writing_clinician\",\"lic_ok\":true}', true);

-- Attempt to read Tenant 2 patients
SELECT COUNT(*) AS cross_tenant_leak_count
FROM clinical.patients
WHERE tenant_id = '22222222-2222-2222-2222-222222222222';
"
```
> **Expected:** `cross_tenant_leak_count = 0`. RLS silently and completely excludes records outside Tenant 1.

---

## Section 4 — ABAC Policy & Role Enforcement

**Goal:** Verify that each role's granular permissions are enforced at the database and API boundary.

| Role Tested | Allowed Capabilities | Strictly Prohibited Actions (Must Return 403 / 0 rows) |
|---|---|---|
| `writing_clinician` | Read/write assigned patients; create clinical records. | Read other clinicians' unassigned patients; access `commercial.orders`. |
| `viewing_dietician` | Read assigned patients; view DPT nutritional thresholds. | Write clinical records; alter prescription rules; export raw keys. |
| `tenant_admin` | Manage tenant membership; view tenant audit metadata. | Read raw patient clinical records (`clinical.clinical_records`). |
| `compliance_auditor`| Inspect tamper-evident audit ledger (`audit.ledger`) within scope. | Access decrypted clinical notes or commercial customer records. |
| `commercial_stakeholder` | View aggregate SKU demand (`v_sku_demand` where $k \ge 5$). | View `clinical.*`, individual orders, or `shopper_alias`. |
| `patient` | View own records and consent settings; initiate export/shred. | View any other patient's data; access clinical notes before sign-off. |

### Role Privilege Verification via SQL Session Switching
```powershell
# Verify commercial_stakeholder cannot query clinical.patients
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000099\",\"tenant_id\":\"11111111-1111-1111-1111-111111111111\",\"app_role\":\"commercial_stakeholder\"}', true);
SELECT * FROM clinical.patients;
"
```
> **Expected:** 0 rows returned (or permission denied by RLS).

---

## Section 5 — Clinical Data Flows, Field Encryption & Stage C Typed Shredding

**Goal:** Verify AES-256-GCM field encryption of PHI and test the Stage C typed-phrase crypto-shredding mechanism.

### 5.1 Verification of Encrypted Storage
Inspect the `clinical.patients` table to ensure PHI is stored strictly as `bytea`:
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
\d clinical.patients
"
```
Verify that `full_name_enc`, `dob_enc`, and `contact_enc` have type `bytea`.

### 5.2 Phase 6 Plaintext Leak Canary
Run the zero-plaintext leak verification:
```powershell
docker compose exec toolchain node scripts/verify-phase6-canary.mjs
```
> **Expected:** `0 plaintext PHI fields found in database dump. Canary clean.`

### 5.3 Stage C Typed Crypto-Shredding in Chrome UI
Stage C implements a hardened `<ConfirmDialog>` requiring the user to explicitly type the confirmation phrase `"SHRED"` before crypto-erasure executes.

1. In Chrome, navigate to CAD: `http://localhost:8080/cad/`
2. Open the **Patient Linking & Consent Management** view (`PatientLinkingConsentView.tsx`).
3. Select an active test patient.
4. Click the **Revoke & Shred** action button.
5. **Inspect the Modal Dialog (`ConfirmDialog.tsx`):**
   - The dialog title displays: **Confirm Irreversible Crypto-Shredding**.
   - A warning banner alerts the user: *"This will permanently destroy the Data Encryption Key (DEK). All encrypted clinical records will become permanently undecryptable."*
   - An input field prompts: **Type "SHRED" to confirm:**
   - Verify that the **Confirm Shredding** button is **disabled** initially.
   - Type `"shred"` (lowercase) → button remains **disabled** (strict case check).
   - Type `"SHRED"` → button becomes **enabled**.
6. Click **Confirm Shredding**.
7. **Verify Database State Post-Shred:**
   ```powershell
   docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
   -- Confirm the DEK was deleted
   SELECT COUNT(*) FROM clinical.patient_dek_registry WHERE patient_id = '<patient-uuid>';
   -- Expected: 0

   -- Confirm the ciphertext row remains for audit preservation
   SELECT id, full_name_enc FROM clinical.patients WHERE id = '<patient-uuid>';
   -- Expected: 1 row present with intact ciphertext, but permanently unreadable
   "
   ```

---

## Section 6 — Break-Glass Emergency Access Workflow

**Goal:** Verify that emergency clinician overrides are strictly time-bound and immediately audited.

### 6.1 Attempt Access Without Break-Glass Grant
A clinician attempting to access an unassigned patient in emergency intake receives 0 rows.

### 6.2 Grant Emergency Access
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
INSERT INTO clinical.break_glass_grants (
  clinician_id, patient_id, tenant_id, granted_by, reason, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '<restricted-patient-uuid>',
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000002',
  'Emergency triage: acute diabetic crisis',
  NOW() + INTERVAL '24 hours'
);
"
```

### 6.3 Immediate Immutable Audit Entry
Verify that the grant triggers an immediate WORM ledger entry:
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
SELECT action, actor_id, patient_id, created_at
FROM audit.ledger
WHERE action = 'BREAK_GLASS_ACCESS'
ORDER BY created_at DESC LIMIT 1;
"
```
> **Expected:** Record exists with timestamp within the last 30 seconds.

---

## Section 7 — WORM Append-Only Audit Ledger & Merkle Verification

**Goal:** Verify cryptographic SHA-256 hash chaining and tamper-rejection on `audit.ledger`.

### 7.1 Verify Audit Chain Integrity
```powershell
docker compose exec toolchain node scripts/verify-audit-chain.mjs
```
> **Expected:** All 6 tenant and platform audit hash chains pass verification with 0 mismatches.

### 7.2 Tamper Rejection Test (UPDATE & DELETE Blocked)
Attempt to alter an audit row:
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
UPDATE audit.ledger SET action = 'TAMPERED_ACTION' WHERE seq = 1;
"
```
> **Expected:** `ERROR: audit ledger is append-only (WORM protection). Updates rejected.`

Attempt to delete an audit row:
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
DELETE FROM audit.ledger WHERE seq = 1;
"
```
> **Expected:** `ERROR: audit ledger rows cannot be deleted. Deletes rejected.`

---

## Section 8 — Dietary Profile Token (DPT) & Ephemeral DPoP

**Goal:** Verify privacy-preserving token issuance with zero condition leakage and memory-only DPoP key management.

### 8.1 Memory-Only DPoP Key Verification
1. In Chrome, open CAD: `http://localhost:8080/cad/`
2. Open DevTools → **Application** tab → **Storage**:
   - Check `IndexedDB` → verify **no private keys** or DPoP key pairs stored.
   - Check `localStorage` → verify **no private keys** stored.
   - Check `sessionStorage` → verify **no private keys** stored.
3. DPoP signing keys exist strictly within volatile JavaScript memory and are discarded upon tab closure.

### 8.2 DPT Allowlist Claims Inspection
Execute the privacy leak proof script:
```powershell
docker compose exec toolchain node scripts/check-leak-proofs.mjs
```
> **Expected:** `5/5 leak proof steps pass cleanly.`

Verify that DPT payloads contain only nutritional thresholds and strictly exclude health condition names:
```powershell
# Token payload must include only:
# carbs_g_100g_max, sugars_g_100g_max, sodium_mg_100g_max, satfat_g_100g_max, energy_kcal_100g_max, fibre_g_100g_min
# Must NEVER contain:
# diabetic_friendly, renal_safe, hypertension, hiv, cancer, or any diagnosis identifier.
```

---

## Section 9 — Commercial Overlay & Live Supermarket Testing

**Goal:** Verify real-time product scoring on Kenyan retailer websites with strict zero-PHI leakage.

### 9.1 Supported Kenyan Supermarkets
With the NUT-04 extension active in Chrome, navigate to any supported Kenyan supermarket:
- **Naivas Online:** `https://www.naivas.online/`
- **Carrefour Kenya:** `https://www.carrefour.ke/`
- **Quickmart Kenya:** `https://www.quickmart.co.ke/`

### 9.2 Badge Rendering & Accessibility Verification
1. Navigate to a grocery category (e.g., Dairy, Bakery, or Pantry).
2. Observe product cards:
   - Each item displays a **NutriScore Grade Badge** (A, B, C, D, or E) rendered using the Stage C design system tokens:
     - Grade A: High-contrast green pill (`bg-emerald-100 text-emerald-800 border-emerald-300`)
     - Grade C: Neutral amber pill (`bg-amber-100 text-amber-800 border-amber-300`)
     - Grade E: High-contrast red pill (`bg-rose-100 text-rose-800 border-rose-300`)
   - Food composition scoring calculates locally against the embedded **Kenya Food Composition Reference Database**.

### 9.3 Zero-PHI Network Verification
1. In Chrome, open DevTools (`F12`) → **Network** tab.
2. Filter requests by the retailer domain (e.g., `naivas.online`).
3. Inspect all outbound HTTP requests made by the extension content script.
4. **Expected:**
   - **Zero** patient identifiers, clinician IDs, or tenant UUIDs transmitted.
   - **Zero** raw health conditions transmitted.
   - Only anonymous SKU hashes or anonymized nutrient queries are evaluated.

### 9.4 Aggregated Commercial Orders & $k$-Anonymity ($k \ge 5$)
Run the commercial overlay verification suite:
```powershell
docker compose exec toolchain node scripts/check-commercial-overlay.mjs
```
> **Expected:** `4/4 steps pass.`
> - `v_orders_tracking` view contains no `shopper_alias` column.
> - `v_sku_demand` view enforces `HAVING count(DISTINCT shopper_alias) >= 5` to prevent micro-targeting or individual re-identification.

---

## Section 10 — Consent Withdrawal & Immediate Token Invalidation

**Goal:** Verify that withdrawing patient consent immediately revokes active DPTs and halts synchronization.

### 10.1 Withdraw Consent via SQL / UI
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
UPDATE clinical.patient_consents
SET dietary_profile_sharing = false, updated_at = NOW()
WHERE patient_id = '<patient-uuid>';
"
```

### 10.2 Verify Token Revocation
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
SELECT token_id, revoked_at, reason
FROM exchange.token_revocations
WHERE patient_id = '<patient-uuid>'
ORDER BY revoked_at DESC LIMIT 1;
"
```
> **Expected:** A revocation record appears with `reason = 'CONSENT_WITHDRAWN'`.

---

## Section 11 — Data Subject Rights (Portability, Restriction & Rectification)

**Goal:** Verify compliance with the Kenya Data Protection Act 2019 (DPA) and GDPR data subject rights.

### 11.1 Patient Data Portability Export
Test the signed patient export bundle generation:
```powershell
docker compose exec toolchain node -e "
const { exportPatientData } = await import('./src/shared/patient-export.js');
const bundle = await exportPatientData('<test-patient-uuid>');
console.log('Export SHA-256 Digest:', bundle.digest);
console.log('Digital Signature Present:', !!bundle.signature);
console.log('Payload Byte Count:', JSON.stringify(bundle).length);
"
```
> **Expected:** Generates an export payload with cryptographic SHA-256 digest and digital signature.

### 11.2 Right to Restriction of Processing
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
SELECT clinical.set_patient_restriction('<test-patient-uuid>', true, 'Subject exercised Right to Restrict');
"
```
Verify `clinical.patients.restricted = true`. All non-emergency read/write actions are suspended.

### 11.3 Right to Rectification (Immutable Audit Preserved)
```powershell
docker compose exec -T postgres psql -U nutriscore_app -d nutriscore -c "
SELECT clinical.rectify_clinical_record(
  '<record-uuid>',
  '\x0102030405060708',
  'Subject provided updated laboratory values'
);
"
```
> **Expected:** Version 1 remains intact for audit compliance. Version 2 is created with `supersedes_id` pointing to Version 1.

---

## Section 12 — Stage C Timeline Model & Retention Purge Engine

**Goal:** Verify the 4-timeframe timeline model, the 90-day retention cutoff, and zero-truncation UI tables.

### 12.1 The 4-Timeframe Timeline Model
In CAD (`http://localhost:8080/cad/`), navigate to the **Clinical Metrics & Target Adherence** view.
1. Locate the timeframe selector buttons:
   - **Today (`today`):** Immediate 24-hour nutritional check.
   - **Week (`week`):** Rolling 7-day compliance average.
   - **Month (`month`):** 30-day target adherence.
   - **3 Months (`3months`):** 90-day maximum clinical overview boundary.
2. Click between the four timeframes. Observe that:
   - `<TargetMeter>` components smoothly recalculate target percentages and threshold alerts.
   - `<KpiCard>` summaries update values dynamically.
   - Any data older than 90 days is strictly excluded from clinical views in compliance with clinic data retention policy.

### 12.2 Zero-Truncation Clinical Tables
Inspect all tables in the CAD UI (`Patients`, `Adherence`, `Audit Logs`):
- Patient IDs, timestamps, and dietary targets render in full with zero clipping or artificial ellipses (`text-truncate` is prohibited on clinical data).
- Long values wrap cleanly or provide responsive horizontal scrolling containers with clear column headers.

### 12.3 Automated Retention Purge Engine (Dry Run)
Execute the retention purge script in dry-run mode:
```powershell
docker compose exec toolchain node scripts/purge-retention.mjs --dry-run
```
> **Expected:**
> - Exits cleanly with status 0.
> - Logs proposed purge candidates older than the statutory retention policy.
> - Preserves all records subject to active legal holds (`legal_hold = true`).

---

## Section 13 — Compliance Release Gates & Artifacts

**Goal:** Verify statutory pre-launch compliance checks.

### 13.1 Compliance Release Gate Check
```powershell
docker compose exec toolchain node scripts/release-gate.mjs
```
> **Expected Result:**
> - Exits with status code `1` (Intentional block).
> - Console displays pending items:
>   - DPIA draft awaiting final Legal / DPO sign-off.
>   - `compliance/launch.json` contains pending statutory approvals.
> - This confirms the automated barrier prevents premature production deployment.

### 13.2 Compliance Documents Verification
Verify presence of required compliance documentation:
```powershell
# Verify Data Protection Impact Assessment (DPIA) draft
Test-Path "docs\compliance\dpia\DPIA-draft.md"

# Verify Incident & Data Breach Response Runbook
Test-Path "docs\compliance\BREACH_RUNBOOK.md"
```
> **Expected:** Both return `True`.

---

## Section 14 — Automated Quality Gates Sweep (Docker Executed)

To run the full suite of automated checks at any point during testing, execute the unified CI command:

```powershell
.\bin\nut.ps1 ci
```

### Gate Verification Matrix

| Gate | Execution Command (Containerized) | Verification Criteria |
|---|---|---|
| **Secret Tracking** | `node scripts/check-no-secrets-tracked.mjs` | 0 private keys or tokens tracked in git |
| **Hardcoded Data** | `node scripts/check-no-hardcoded-data.mjs` | 0 hospital names, real emails, or real PII |
| **Manifest Security** | `node scripts/check-manifest-globals.mjs` | 0 global leaks, Manifest V3 valid |
| **CAD Invariants** | `node scripts/check-cad-security.mjs` | 0 security invariant violations |
| **Code Formatting** | `npm run format:check` | Prettier style enforced across codebase |
| **Static Analysis** | `npm run lint` | ESLint reports 0 errors |
| **Type Integrity** | `npm run typecheck` | `tsc --noEmit` reports 0 errors |
| **Unit & Integration** | `npm run test` | Vitest: 45 files, 793 tests passing |
| **Production Build** | `npm run build` | Compiles `dist/` and `dist-ui/cad` cleanly |
| **Fixture Verification**| `node scripts/check-no-fixtures-in-dist.mjs`| 0 test fixtures or mock data in production bundle |

---

## Section 15 — Post-Test Cleanup & Environment Reset

After completing manual and automated testing, return the environment to a pristine state:

### 1. Reset Database State
```powershell
.\bin\nut.ps1 db-reset
```
> Re-executes `dbmate` down/up migrations, wiping test sessions and restoring the baseline schema.

### 2. Stop Development Containers
```powershell
.\bin\nut.ps1 down
```
> Shuts down all 8 Docker services and cleans up local test networks.

### 3. Clear Chrome Test Artifacts
1. In Chrome, open `chrome://extensions`.
2. Locate the **NUT-04 Checkout Tool** card → Click **Remove**.
3. Open Chrome Settings → **Clear browsing data** → select **Cached images and files** and **Cookies and other site data** for `localhost`.

---

## Appendix A — Key File Reference

| File Path | Description |
|---|---|
| [`bin/nut.ps1`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/bin/nut.ps1) | Windows PowerShell CLI wrapper for Docker-based operations. |
| [`bin/nut`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/bin/nut) | POSIX / Bash CLI wrapper for Docker-based operations. |
| [`compose.yaml`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/compose.yaml) | Docker Compose specification for microservices stack. |
| [`infra/caddy/Caddyfile`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/infra/caddy/Caddyfile) | API Gateway reverse proxy configuration (HTTP :8080 / TLS :8443). |
| [`infra/keycloak-realm.json`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/infra/keycloak-realm.json) | Keycloak `nutriscore` realm configuration, roles, and client scopes. |
| [`src/ui/src/app/components/ui/`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/app/components/ui/) | Stage C design system primitives (`GradeBadge`, `ConfirmDialog`, `TargetMeter`, `KpiCard`, `ConditionChip`). |
| [`src/ui/src/styles/tokens.css`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/styles/tokens.css) | 3-tier CSS custom property design tokens. |
| [`db/migrations/0001_baseline.sql`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/db/migrations/0001_baseline.sql) | Dbmate baseline database schema and RLS policies. |
| [`scripts/check-no-hardcoded-data.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/check-no-hardcoded-data.mjs) | Stage B verification script for zero hardcoded PII/hospital data. |
| [`scripts/check-cad-security.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/check-cad-security.mjs) | CAD security invariant enforcement script. |
| [`docs/adr/0001-decommission-supabase.md`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/docs/adr/0001-decommission-supabase.md) | Architecture Decision Record: Supabase decommissioning. |

---

## Appendix B — Critical Security Invariants Checklist

- [ ] **S1** Cross-tenant query returns exactly 0 rows under all conditions (Section 3.2).
- [ ] **S2** No `callerRank` or numeric rank comparisons anywhere in the codebase (Section 2.3).
- [ ] **S3** Single `BAN_UNTIL_ISO` constant used for session denylisting (Section 2.4).
- [ ] **S4** DPT tokens contain no condition names (`diabetic_friendly`, `renal_safe`, etc.) (Section 8.2).
- [ ] **S5** `v_orders_tracking` view contains no `shopper_alias` column (Section 9.4).
- [ ] **S6** `v_sku_demand` view enforces $k$-anonymity suppression below $k=5$ shoppers (Section 9.4).
- [ ] **S7** WORM ledger triggers reject `UPDATE` and `DELETE` (Section 7.2).
- [ ] **S8** Crypto-shredded patient ciphertext is permanently unreadable (Section 5.3).
- [ ] **S9** Break-glass access creates an immediate immutable audit ledger entry (Section 6.3).
- [ ] **S10** DPoP proof replay attacks are rejected (Section 8.2).
- [ ] **S11** No private keys or DPoP secrets persist in `localStorage` or `IndexedDB` (Section 8.1).
- [ ] **S12** Extension content scripts transmit zero PHI to retailer domains (Section 9.3).
- [ ] **S13** Revoked DPT returns HTTP 401 `TOKEN_REVOKED` (Section 10.2).
- [ ] **S14** Active legal hold strictly blocks retention purge (Section 12.3).
- [ ] **S15** Statutory release gate intentionally blocks unapproved production release (Section 13.1).
- [ ] **S16** Host-isolation rule R4 enforced: 0 host `npm`/`node`/`psql` calls (Section Pre-Flight).

---

*NUT-04 Checkout Tool — CAD Testing Guide v2.0 — Modernized for Dockerized Microservices & Stage C UI*  
*Target Branch: `refactor/decay-cleanup-docker-ui`*
