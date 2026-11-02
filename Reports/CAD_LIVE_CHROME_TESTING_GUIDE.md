# NUT-04 Checkout Tool — Live Chrome Environment Testing Guide

> **Scope:** CAD Multi-Tenant Healthcare Backend Blueprint — Phases 0–10
> **Environment:** Local Supabase Docker stack only. **NEVER** target hosted Supabase (`nqcpudpkrkutpxuqpsfk`).
> **Branch:** `feat/cad-backend-blueprint` (11 commits, all green)

---

## Quick Reference

| Service | URL |
|---|---|
| Local Supabase API | `http://localhost:54321` |
| Supabase Studio | `http://localhost:54323` |
| CAD UI (Vite dev) | `http://localhost:3000/cad.html` |
| Postgres (direct) | `localhost:54322` (user: `postgres`) |

**Docker container name:** `supabase_db_NUT-04_Checkout_Tool`

---

## Getting Started: Opening PowerShell & Environment Verification

### Step 1 — Open PowerShell in the Project Root Directory

**Option A — From File Explorer (Fastest):**
1. Open Windows File Explorer and navigate to:
   `c:\Users\USER\Documents\NUT-04 Checkout Tool`
2. Click directly on the **address bar** at the top.
3. Type `powershell` and press `Enter`.
4. A PowerShell console will open with the working directory already set to the project root.

**Option B — From Start Menu / Windows Terminal:**
1. Press `Win + X` (or search for `PowerShell` in the Start Menu) and open **Windows PowerShell**.
2. Navigate to the project root:
   ```powershell
   cd "c:\Users\USER\Documents\NUT-04 Checkout Tool"
   ```
3. Confirm your current location:
   ```powershell
   pwd
   # Expected output: C:\Users\USER\Documents\NUT-04 Checkout Tool
   ```

---

## Pre-Flight Checklist

Run these commands one at a time in order. Confirm the expected output before proceeding to Section 1.

### 1. Confirm Local Supabase Docker Containers Are Active
```powershell
docker ps --filter "name=supabase" --format "table {{.Names}}`t{{.Status}}"
```
> **Expected:** `supabase_db_NUT-04_Checkout_Tool` (and associated services) show status `Up ...`. If stopped or missing, launch Docker Desktop and run `npx supabase start`.

### 2. Verify TypeScript Compilation
```powershell
npm run typecheck
```
> **Expected:**
> ```text
> ✓ TypeScript check passed: 0 errors
> ```
> *Note: If there are zero errors, the TypeScript compiler (`tsc --noEmit`) succeeds with code 0. If any type discrepancies existed, it would output specific file lines and syntax codes.*

### 3. Run Automated Unit & Integration Tests
```powershell
npm test -- --reporter=dot
```
> **Expected:** `Test Files  50 passed (50) | Tests  837 passed (837)` with zero failures.

### 4. Code Quality & Formatting Gates
```powershell
npm run format:check
npm run lint
```
> **Expected:** Prettier reports all files use Prettier style. ESLint reports `0 errors` (pre-existing lint warnings are non-blocking).

### 5. Compile UI & Extension Build Artifacts
```powershell
npm run build
```
> **Expected:** Executes `build:db`, `build:ui` (Vite production bundle into `dist/`), and `build:ext`. Completes cleanly with `✓ built in Xs`.

### 6. Seed De-Identified Mock Identities
```powershell
node scripts/seed-mock-users.mjs
```
> **Expected:** Connects to `http://127.0.0.1:54321` and outputs:
> ```text
> =============================================================================
>   CAD MOCK TEST CREDENTIALS (LOCAL ONLY)
> =============================================================================
> Role                   | Email                          | Password
> -----------------------+--------------------------------+------------------------
> tenant_admin           | tenant.admin@clinic.test       | [Generated password]
> writing_clinician      | clinician.one@clinic.test      | [Generated password]
> viewing_dietician      | dietician.one@clinic.test      | [Generated password]
> patient                | patient.alpha@clinic.test      | [Generated password]
> patient                | patient.beta@clinic.test       | [Generated password]
> commercial_stakeholder | partner.stakeholder@clinic.test | [Generated password]
> compliance_auditor     | regulator.dha@platform.test    | [Generated password]
> compliance_auditor     | regulator.odpc@platform.test   | [Generated password]
> =============================================================================
> ```
> Credentials are automatically written to `.mock-credentials.json` (git-ignored) for convenient reference during manual Chrome UI testing.

### 7. Launch the CAD UI Web Server
Open a **new, dedicated PowerShell window** in the project directory (leave it running in the background) and execute:
```powershell
npm run dev
```
> **Expected:** Vite starts the local development server:
> ```text
>   VITE v6.4.4  ready in 450 ms
>
>   ➜  Local:   http://localhost:3000/
>   ➜  Network: use --host to expose
> ```
> *Keep this window running.* Now navigating to `http://localhost:3000/cad.html` in Chrome will load the Clinic Admin Dashboard.

---

## PowerShell Database Execution Pattern (pgTAP & SQL Queries)

On Windows PowerShell, the `<` redirection operator does not function as it does in POSIX shells. Always use the pipe pattern:

```powershell
Get-Content supabase\tests\<file>.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

- **`Get-Content <path>`**: Reads the file contents as a text stream.
- **`|`**: Pipes the SQL script into Docker standard input.
- **`docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres`**: Runs the script directly in the local container as database administrator.

### Run All 9 pgTAP Test Suites in Sequence
Run this loop in PowerShell whenever you want to perform a comprehensive database-level verification sweep:

```powershell
$suites = @(
    "cad_tenant_wall.sql",
    "cad_claims_and_revocation.sql",
    "cad_grant_matrix_lifecycle.sql",
    "cad_abac_and_clinical.sql",
    "cad_worm_ledger.sql",
    "cad_field_encryption_and_projection.sql",
    "cad_exchange_and_dpt.sql",
    "cad_commercial_overlay.sql",
    "cad_retention_and_rights.sql"
)

foreach ($suite in $suites) {
    Write-Host "`n=== Running $suite ===" -ForegroundColor Cyan
    Get-Content "supabase\tests\$suite" | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
}
```
> **Expected:** Every suite prints clean `ok` assertions ending with `# All tests passed.` and zero `not ok` lines.

### Quick Troubleshooting Reference

| Symptom | Cause | Solution |
|---|---|---|
| `REFUSING TO RUN: seed-mock-users.mjs may only be run against a LOCAL Supabase instance` | `process.env` loaded remote URL from `.env` | Ensure `.env.local` exists with `VITE_SUPABASE_URL=http://127.0.0.1:54321`. Script now loads `.env.local` automatically. |
| `docker: command not found` or connection refused | Docker Desktop is closed | Launch Docker Desktop, wait for engine to initialize, run `npx supabase start`. |
| `ERROR: table or column not found in schema cache` | PostgREST schema cache out of date | Run: `docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"` |
| `npm run typecheck` returned no console lines | Silence means 0 type errors | Script now prints `✓ TypeScript check passed: 0 errors` explicitly. |
| `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` | Node.js Windows libuv handle issue on abrupt exit | Fixed: `purge-mocks.mjs` now lets event loop drain naturally. |
| **"Invalid clinic credentials"** on CAD sign-in (clinician or patient) | Two bugs: (1) `supabase_auth_admin` lacked `USAGE` on schema `public` → hook call failed with `SQLSTATE 42501`; (2) hook stripped `email`/`phone` from claims but GoTrue output schema requires both keys | **FIXED in commit `15b4faf1`** — migration `20261101010000` now grants `USAGE ON SCHEMA public` and `EXECUTE ON FUNCTION custom_access_token_hook` to `supabase_auth_admin`, and blanks `email`/`phone` to `""` instead of removing them. Verify: sign-in returns HTTP 200 and JWT contains `session_id`. |
| Hook HTTP 500 `permission denied for schema public (SQLSTATE 42501)` | `supabase_auth_admin` cannot call hook | Run: `docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres -c "GRANT USAGE ON SCHEMA public TO supabase_auth_admin; GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;"` |

---

## Section 1 — Extension Loading & Manifest Verification

**Goal:** Confirm the Manifest V3 extension loads cleanly with no forbidden permissions or global leaks.

### 1.1 Load the Unpacked Extension

1. Open Chrome → navigate to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked** → select `c:\Users\USER\Documents\NUT-04 Checkout Tool\dist\`
4. The extension card should appear with the NUT-04 icon and **no error badge**

### 1.2 Manifest Permission Check

In `chrome://extensions`, click **Details** → confirm:

| Check | Expected |
|---|---|
| `identity` permission | **Absent** |
| `storage` permission | Present (needed for settings) |
| Background service worker | Registered and active |
| Manifest version | `3` |

Alternatively, read the manifest directly:

```powershell
Get-Content dist\manifest.json | ConvertFrom-Json | Select -ExpandProperty permissions
```

→ Must **not** contain `"identity"`.

### 1.3 Service Worker Registration

1. `chrome://extensions` → **Inspect views: service worker**
2. Console must show zero errors on startup
3. Network tab must show no outbound requests to hosted Supabase (`nqcpudpkrkutpxuqpsfk`)

### 1.4 Popup / Dashboard Smoke Test

1. Click the extension icon in the Chrome toolbar → popup must render
2. Open `chrome://extensions` → **Inspect views: popup.html** → Console tab must be error-free

### 1.5 Manifest Security Scan

```powershell
npm run check:manifest
```

**Expected:** 0 global variable leaks reported.

---

## Section 2 — Authentication & JWT Claims Contract

**Goal:** Verify the canonical claims contract (Phase 2) is enforced end-to-end.

### 2.1 Sign In via CAD UI

1. Navigate to `http://localhost:3000/cad.html`
2. Sign in with the mock `writing_clinician` account (seeded by `seed-mock-users.mjs`)

### 2.2 Inspect the JWT in DevTools

1. Open Chrome DevTools (`F12`) → **Network** tab
2. Find the `/auth/v1/token` response
3. Copy the `access_token` value
4. Decode at `https://jwt.io` (offline: `node -e "console.log(JSON.parse(Buffer.from('<token>'.split('.')[1],'base64').toString()))"`)

**Required claims — all must be present:**

| Claim | Expected value |
|---|---|
| `app_role` | e.g. `writing_clinician` |
| `tenant_id` | `11111111-2222-3333-4444-555555555555` (mock clinic) |
| `lic_ok` | `true` |
| `session_id` | UUID string (Supabase session ID, used as `sid` by `canonicalizeClaims`) |
| `ver` | `1` |
| `email` | `""` (blanked — PII stripped, key must remain for GoTrue schema validation) |
| `phone` | `""` (blanked — PII stripped, key must remain for GoTrue schema validation) |

**Forbidden claims — all must be absent:**

| Claim | Why Forbidden |
|---|---|
| `diagnosis` | PHI — never in token |
| `health_mode` | Condition inference vector |
| `national_id` | PII — stripped by hook |
| `callerRank` | Deprecated rank comparison scheme |

### 2.3 Session Denylist / Ban Test

```sql
-- In Supabase Studio SQL editor (local only)
-- Ban a session by its `sid` claim value:
INSERT INTO iam.session_denylist (sid, banned_until)
VALUES ('<sid-from-jwt>', '2099-01-01T00:00:00Z');
```

1. Make any authenticated API request from the UI
2. **Expected:** HTTP 401 response
3. Verify the single `BAN_UNTIL_ISO` constant is used — check that no numeric rank comparison appears:

```powershell
npm run check:cad-security
```

### 2.4 TOTP / AAL2 Step-Up

1. Attempt a bundle-publish action from a `writing_clinician` session without TOTP
2. **Expected:** Server returns `AAL2_REQUIRED` error
3. Complete TOTP enrollment → retry → must succeed

---

## Section 3 — Multi-Tenant Wall (Forced Restrictive RLS)

**Goal:** Confirm that Tenant 1 data is invisible to Tenant 2 sessions under all circumstances.

> [!IMPORTANT]
> This is the most critical security invariant. A single cross-tenant row leak is a critical failure.

### 3.1 RLS Coverage Verification

```powershell
npm run check:rls
```

**Expected:** 29 tenant-scoped relations confirmed covered. Zero exceptions.

### 3.2 Cross-Tenant Query — Must Return Zero Rows

Open Supabase Studio → **SQL Editor**:

```sql
-- Set JWT claims for Tenant 1 session
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', gen_random_uuid()::text,
  'tenant_id', '11111111-1111-1111-1111-111111111111',
  'app_role', 'writing_clinician'
)::text, true);

SET ROLE authenticated;

-- Attempt to read Tenant 2 patients — MUST return 0 rows
SELECT COUNT(*) FROM clinical.patients
WHERE tenant_id = '22222222-2222-2222-2222-222222222222';
```

**Expected:** `count = 0`

### 3.3 pgTAP Tenant Wall Suite

```powershell
Get-Content supabase/tests/cad_tenant_wall.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** All tests pass (no `not ok` lines).

### 3.4 Cross-Tenant Clinical Record Attempt

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'tenant_id', '11111111-1111-1111-1111-111111111111',
  'app_role', 'writing_clinician'
)::text, true);

-- Attempt to read Tenant 2 clinical records
SELECT * FROM clinical.clinical_records cr
JOIN clinical.patients p ON cr.patient_id = p.id
WHERE p.tenant_id = '22222222-2222-2222-2222-222222222222';
```

**Expected:** 0 rows (RLS silently filters).

---

## Section 4 — ABAC Policy & Role Enforcement

**Goal:** Verify each role's access matrix (Phase 4) is correctly enforced.

### 4.1 pgTAP ABAC Suite

```powershell
Get-Content supabase/tests/cad_abac_and_clinical.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** All tests pass.

### 4.2 Role-by-Role Access Matrix

For each role below, sign in via CAD UI and verify the listed behavior.

#### `writing_clinician`

| Action | Expected |
|---|---|
| Read own patients | ✅ |
| Write clinical record for own patient | ✅ |
| Read another clinician's patient | ❌ 0 rows |
| Access `commercial.orders` | ❌ Permission denied |

#### `viewing_dietician`

| Action | Expected |
|---|---|
| Read assigned patients | ✅ |
| Write clinical record | ❌ RLS / permission denied |
| Read DPT nutritional thresholds | ✅ |

#### `tenant_admin`

| Action | Expected |
|---|---|
| Provision new tenant member | ✅ |
| Write clinical record | ❌ |
| Read `audit.ledger` (own tenant) | ✅ metadata only |

#### `compliance_auditor` (tenant scope)

```sql
SELECT set_config('request.jwt.claims', json_build_object(
  'tenant_id', '11111111-1111-1111-1111-111111111111',
  'app_role', 'compliance_auditor',
  'audit_scope', 'tenant'
)::text, true);
SET ROLE authenticated;

-- Must read own chain only
SELECT COUNT(*) FROM audit.ledger WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
-- Must NOT read cross-tenant
SELECT COUNT(*) FROM audit.ledger WHERE tenant_id = '22222222-2222-2222-2222-222222222222';
```

**Expected:** First query > 0, second query = 0.

#### `compliance_auditor` (platform scope)

```sql
SELECT set_config('request.jwt.claims', json_build_object(
  'app_role', 'compliance_auditor',
  'audit_scope', 'platform'
)::text, true);
SET ROLE authenticated;

SELECT COUNT(*) FROM audit.v_ledger_platform;
```

**Expected:** Row count spanning multiple tenants.

#### `commercial_stakeholder`

| View | Expected |
|---|---|
| `v_orders_tracking` | ✅ (no `shopper_alias` column) |
| `v_sku_demand` | ✅ (suppressed below k=5) |
| `clinical.patients` | ❌ 0 rows |

#### `patient`

```sql
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '<patient-user-id>',
  'tenant_id', '11111111-1111-1111-1111-111111111111',
  'app_role', 'patient'
)::text, true);
SET ROLE authenticated;

SELECT COUNT(*) FROM clinical.patients;          -- must be exactly 1 (own row)
SELECT COUNT(*) FROM clinical.clinical_records;  -- must be own records only
```

### 4.3 Grant Matrix pgTAP Suite

```powershell
Get-Content supabase/tests/cad_grant_matrix_lifecycle.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** All tests pass.

---

## Section 5 — Clinical Data Flows & Field-Level Encryption

**Goal:** Verify Phase 6 field encryption — PHI is stored as `bytea`, never plaintext.

### 5.1 Create a Patient Record (via UI)

1. Sign in as `writing_clinician`
2. Create a new patient through the CAD UI form
3. Submit and note the patient UUID from the response

### 5.2 Verify Encrypted Storage in Studio

Open Supabase Studio → **Table Editor** → `clinical.patients`:

| Column | Expected type | Expected value |
|---|---|---|
| `full_name_enc` | `bytea` | Binary blob (not a readable name) |
| `dob_enc` | `bytea` | Binary blob |

> [!CAUTION]
> If `full_name_enc` shows a plaintext name string, field encryption is broken. Stop testing and investigate Phase 6 migration.

### 5.3 Phase 6 Canary — Zero Plaintext Leaks

```powershell
node scripts/verify-phase6-canary.mjs
```

**Expected:** `0 plaintext PHI fields found in pg_dump output`.

### 5.4 Cross-Row Ciphertext Isolation (AAD Binding)

```sql
-- Get two patient rows from different patients
SELECT id, full_name_enc FROM clinical.patients LIMIT 2;
```

The ciphertext blobs are bound to their row's `patient_id` via Additional Authenticated Data (AAD). Swapping ciphertext between rows will cause decryption to fail — this is tested in the pgTAP suite:

```powershell
Get-Content supabase/tests/cad_field_encryption_and_projection.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** All tests pass, including AAD tamper detection.

### 5.5 Crypto-Shredding Test

```sql
-- Record patient ID before shredding
-- Then trigger crypto-shred (DEK deletion):
SELECT clinical.crypto_shred_patient('<patient-uuid>');
```

After shredding:

```sql
-- Key must be deleted
SELECT COUNT(*) FROM clinical.patient_dek_registry
WHERE patient_id = '<patient-uuid>';
-- → 0

-- Ciphertext row must still exist (but unreadable)
SELECT COUNT(*) FROM clinical.patients WHERE id = '<patient-uuid>';
-- → 1 (row preserved, ciphertext permanently unreadable)
```

> [!NOTE]
> Crypto-shredding is irreversible. Use a test patient created specifically for this check.

---

## Section 6 — Break-Glass Workflow

**Goal:** Verify Phase 4 emergency access grants are logged immediately and expire correctly.

### 6.1 Access Denied Without Grant

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '<clinician-without-assignment>',
  'tenant_id', '11111111-1111-1111-1111-111111111111',
  'app_role', 'writing_clinician'
)::text, true);

-- Attempt to read a patient not assigned to this clinician
SELECT * FROM clinical.patients WHERE id = '<restricted-patient-uuid>';
```

**Expected:** 0 rows returned (RLS enforced).

### 6.2 Create Emergency Grant

```sql
-- As the treating clinician (or tenant_admin):
INSERT INTO clinical.break_glass_grants (
  clinician_id, patient_id, tenant_id,
  granted_by, reason, expires_at
) VALUES (
  '<clinician-uuid>',
  '<restricted-patient-uuid>',
  '11111111-1111-1111-1111-111111111111',
  '<admin-uuid>',
  'Emergency: patient presented unconscious',
  NOW() + INTERVAL '24 hours'
);
```

### 6.3 Access Succeeds Within Grant Window

Re-run the query from 6.1 — **Expected:** Patient row is returned.

### 6.4 Audit Ledger Entry Appears Immediately

```sql
SELECT action, actor_id, patient_id, created_at
FROM audit.ledger
WHERE action = 'BREAK_GLASS_ACCESS'
  AND patient_id = '<restricted-patient-uuid>'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:** Row exists with `created_at` within the last 60 seconds.

### 6.5 Grant Expiry

```sql
-- Simulate expiry by back-dating the grant
UPDATE clinical.break_glass_grants
SET expires_at = NOW() - INTERVAL '1 second'
WHERE patient_id = '<restricted-patient-uuid>';
```

Re-run the patient query — **Expected:** 0 rows (grant expired).

---

## Section 7 — WORM Audit Ledger

**Goal:** Verify Phase 5 hash-chained signed ledger is tamper-evident and trigger-protected.

### 7.1 Verify All Audit Chains

```powershell
node scripts/verify-audit-chain.mjs
```

**Expected:** All 6 audit chains verified. Zero hash mismatches.

### 7.2 Tamper Attempt — UPDATE Must Fail

Open Supabase Studio → SQL Editor:

```sql
-- Attempt to tamper with an existing ledger entry
UPDATE audit.ledger SET action = 'HACKED_ACTION' WHERE seq = 1;
```

**Expected:** `ERROR: audit ledger is append-only (WORM protection)` (trigger fires, update rejected).

### 7.3 Tamper Attempt — DELETE Must Fail

```sql
DELETE FROM audit.ledger WHERE seq = 1;
```

**Expected:** `ERROR: audit ledger rows cannot be deleted` (trigger fires, delete rejected).

### 7.4 Merkle Checkpoint Verification

```sql
SELECT id, chain_id, checkpoint_at, merkle_root, seq_start, seq_end
FROM audit.checkpoints
ORDER BY checkpoint_at DESC
LIMIT 5;
```

**Expected:** Rows exist with non-null `merkle_root` values.

### 7.5 pgTAP WORM Ledger Suite

```powershell
Get-Content supabase/tests/cad_worm_ledger.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** All tests pass.

### 7.6 Platform Auditor View Restriction

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'app_role', 'compliance_auditor',
  'audit_scope', 'tenant'  -- NOT platform
)::text, true);

SELECT COUNT(*) FROM audit.v_ledger_platform;
```

**Expected:** 0 rows or permission denied (tenant-scope auditor cannot read cross-tenant view).

---

## Section 8 — Exchange Service & Dietary Profile Token (DPT)

**Goal:** Verify Phase 7 DPT exchange issues privacy-preserving tokens with no condition names or PHI.

### 8.1 DPoP Key Pair Is Memory-Only

1. Sign in as `patient` role in CAD UI
2. Navigate to "Shop with my plan" (DPT exchange flow)
3. Open DevTools → **Application** tab → **Storage**:
   - `localStorage` → must contain **no** DPoP private key material
   - `IndexedDB` → must contain **no** DPoP private key material
4. DevTools → **Memory** tab → Take heap snapshot → Search for `dpop` → Key material exists in heap only (ephemeral)

### 8.2 DPT Token Claims Verification

1. DevTools → **Network** tab → find `exchange-token` Edge Function call
2. Copy `access_token` from response → decode:

```powershell
node -e "
const token = '<paste-token-here>';
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
console.log(JSON.stringify(payload, null, 2));
"
```

**Required claims (allowlist only):**

| Claim | Description |
|---|---|
| `carbs_g_100g_max` | Carbohydrate threshold |
| `sugars_g_100g_max` | Sugar threshold |
| `sodium_mg_100g_max` | Sodium threshold |
| `satfat_g_100g_max` | Saturated fat threshold |
| `energy_kcal_100g_max` | Energy threshold |
| `fibre_g_100g_min` | Fibre minimum |

**Forbidden content — must be absent:**

```powershell
# Grep decoded token for condition names
node -e "
const token = '<paste-token-here>';
const payload = Buffer.from(token.split('.')[1], 'base64').toString();
['diabetic_friendly','renal_safe','low_potassium','diagnosis','health_mode'].forEach(k => {
  if (payload.includes(k)) console.error('FAIL: found forbidden key:', k);
  else console.log('OK: absent:', k);
});
"
```

**Expected:** All 5 checks print `OK: absent:`.

### 8.3 DPoP Proof Replay Rejection

Submit the same DPoP-signed request twice using the same `jti`:

```powershell
# Use the exchange endpoint directly
$dpopProof = "<your-dpop-proof-with-same-jti>"
$headers = @{ "DPoP" = $dpopProof; "Authorization" = "Bearer <access-token>" }

Invoke-RestMethod -Uri "http://localhost:54321/functions/v1/exchange-token" -Headers $headers
# First call → 200 OK

Invoke-RestMethod -Uri "http://localhost:54321/functions/v1/exchange-token" -Headers $headers
# Second call → must be 401 DPOP_REPLAY or 400
```

**Expected:** Second call rejected.

### 8.4 Leak Proof Verification

```powershell
node scripts/check-leak-proofs.mjs
```

**Expected:** `5/5 steps pass`.

### 8.5 pgTAP Exchange & DPT Suite

```powershell
Get-Content supabase/tests/cad_exchange_and_dpt.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** All tests pass.

---

## Section 9 — Commercial Overlay & Extension Scoring

**Goal:** Verify Phase 8 scoring overlay renders correctly on retailer pages with no PHI leakage.

### 9.1 Load a Supported Grocery Site

1. In Chrome (with extension loaded), navigate to one of:
   - `https://www.naivas.online/` (Naivas Kenya)
   - `https://www.carrefour.ke/` (Carrefour Kenya)
   - `https://www.quickmart.co.ke/` (Quickmart Kenya)
2. Browse to a product category page
3. **Expected:** NUT-04 scoring overlay badges appear on product cards

### 9.2 Zero PHI to Retailer — Network Verification

1. DevTools → **Network** tab → filter by the retailer's domain
2. Inspect all outbound requests from the extension content script
3. **Expected:** No requests contain:
   - Patient name, DOB, or any `clinical.*` data
   - DPT raw nutritional thresholds (only scoring result transmitted, not the threshold values)
   - Any `tenant_id` or `patient_id` values

### 9.3 Observed Order Sync

After adding an item to a retailer cart:

```sql
SELECT source, epoch, idempotency_key, shopper_alias
FROM commercial.orders
WHERE source = 'extension_observed'
ORDER BY epoch DESC
LIMIT 5;
```

**Expected:** Row exists with `source = 'extension_observed'` and `shopper_alias` as an opaque `bytea` (not a real name).

### 9.4 `v_orders_tracking` — No `shopper_alias` Column

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'commercial'
  AND table_name = 'v_orders_tracking';
```

**Expected:** `shopper_alias` is **NOT** in the result set.

### 9.5 `v_sku_demand` k-Anonymity Suppression

```sql
-- This view suppresses any SKU with fewer than 5 distinct shoppers
SELECT * FROM commercial.v_sku_demand LIMIT 10;
```

Verify the underlying HAVING clause:

```sql
SELECT pg_get_viewdef('commercial.v_sku_demand'::regclass, true);
```

**Expected:** Output contains `HAVING count(DISTINCT shopper_alias) >= 5`.

### 9.6 Commercial Overlay Script Verification

```powershell
node scripts/check-commercial-overlay.mjs
```

**Expected:** `4/4 steps pass`.

### 9.7 pgTAP Commercial Overlay Suite

```powershell
Get-Content supabase/tests/cad_commercial_overlay.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** 15/15 tests pass.

---

## Section 10 — Consent & DPT Revocation

**Goal:** Verify that withdrawing consent immediately invalidates active DPTs.

### 10.1 Withdraw Dietary Profile Sharing Consent

```sql
-- Update patient consent record
UPDATE clinical.patient_consents
SET dietary_profile_sharing = false,
    updated_at = NOW()
WHERE patient_id = '<test-patient-uuid>';
```

### 10.2 Verify DPT Revocation Record

```sql
SELECT token_id, revoked_at, reason
FROM exchange.token_revocations
WHERE patient_id = '<test-patient-uuid>'
ORDER BY revoked_at DESC;
```

**Expected:** At least one row with `reason = 'CONSENT_WITHDRAWN'`.

### 10.3 Revoked DPT Must Be Rejected

Attempt to use the previously-issued DPT at the observed orders endpoint:

```powershell
$revokedToken = "<old-dpt-access-token>"
Invoke-RestMethod `
  -Uri "http://localhost:54321/functions/v1/observed-orders" `
  -Headers @{ Authorization = "Bearer $revokedToken" }
```

**Expected:** HTTP 401 with body containing `TOKEN_REVOKED`.

### 10.4 Revocation Audit Event

```sql
SELECT action, actor_id, patient_id, created_at
FROM audit.ledger
WHERE action = 'DPT_REVOKED'
  AND patient_id = '<test-patient-uuid>'
ORDER BY created_at DESC LIMIT 1;
```

**Expected:** Row exists within the last 60 seconds.

### 10.5 pgTAP Claims & Revocation Suite

```powershell
Get-Content supabase/tests/cad_claims_and_revocation.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** All tests pass.

---

## Section 11 — Data Subject Rights Workflows

**Goal:** Verify Phase 9 patient export, restriction, and rectification workflows (GDPR/DPA compliant).

### 11.1 Patient Data Export (Right to Portability)

```powershell
# Export and verify signature
node -e "
const { exportPatientData } = require('./dist/shared/patient-export.js');
exportPatientData('<test-patient-uuid>').then(bundle => {
  console.log('SHA-256 digest:', bundle.digest);
  console.log('Ed25519 signature present:', !!bundle.signature);
  console.log('Export size (bytes):', JSON.stringify(bundle).length);
});
"
```

**Expected:** Bundle contains `digest` (SHA-256 hex), `signature` (Ed25519 base64), and patient data.

Alternatively, test via the UI export button in the CAD dashboard for the patient role.

### 11.2 Processing Restriction (Right to Restrict)

```sql
SELECT clinical.set_patient_restriction('<test-patient-uuid>', true, 'User requested restriction');
```

Verify:

```sql
SELECT restricted, restriction_reason
FROM clinical.patients
WHERE id = '<test-patient-uuid>';
```

**Expected:** `restricted = true`.

Check audit ledger:

```sql
SELECT action FROM audit.ledger
WHERE action = 'RESTRICT_PROCESSING' AND patient_id = '<test-patient-uuid>'
ORDER BY created_at DESC LIMIT 1;
```

**Expected:** Row exists.

### 11.3 Record Rectification (Right to Rectification)

```sql
-- Rectify an existing clinical record (creates v2, preserves v1)
SELECT clinical.rectify_clinical_record(
  '<existing-record-uuid>',
  '<corrected-body-enc-bytea>',
  'Correction: initial transcription error'
);
```

Verify version chain:

```sql
-- Original record preserved
SELECT id, supersedes_id, version FROM clinical.clinical_records
WHERE id = '<existing-record-uuid>';
-- → supersedes_id = NULL, version = 1

-- New record supersedes original
SELECT id, supersedes_id, version FROM clinical.clinical_records
WHERE supersedes_id = '<existing-record-uuid>';
-- → supersedes_id = '<existing-record-uuid>', version = 2
```

**Expected:** Two rows — original untouched, new version with `supersedes_id` pointing to original.

---

## Section 12 — Retention Purge Engine

**Goal:** Verify Phase 9 retention purge respects legal holds and logs all decisions.

### 12.1 Dry-Run Purge (Safe)

```powershell
node scripts/purge-retention.mjs --dry-run
```

**Expected:**
- Script exits 0
- `RETENTION_PURGE_PLAN` event appears in `audit.ledger`
- No rows actually deleted

### 12.2 Fail-Safe: Missing `retain_years` Blocks Purge

```sql
-- Attempt purge on a class without retain_years configured
-- (clinical_records class has NULL retain_years by design as a safety net)
SELECT purge_class FROM retention.purge_config WHERE retain_years IS NULL;
```

Run purge targeting that class:

```powershell
node scripts/purge-retention.mjs --class=clinical_records
```

**Expected:** Script throws `FAIL_SAFE: retain_years is NULL for class clinical_records`.

### 12.3 Legal Hold Blocks Purge

```sql
-- Set legal hold on a patient
UPDATE clinical.patients SET legal_hold = true WHERE id = '<test-patient-uuid>';
```

```powershell
node scripts/purge-retention.mjs --patient=<test-patient-uuid>
```

**Expected:** Output contains `BLOCKED: legal_hold active for patient <uuid>`. No rows deleted.

### 12.4 pgTAP Retention & Rights Suite

```powershell
Get-Content supabase/tests/cad_retention_and_rights.sql | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
```

**Expected:** 18/18 tests pass.

---

## Section 13 — Release Gate & Compliance Artifacts

**Goal:** Verify Phase 10 compliance artifacts are present and release gate correctly blocks launch.

### 13.1 Release Gate — Expected Exit Code 1

```powershell
npm run release:check
```

**Expected:** Exit code 1 with messages indicating:
- DPIA not yet signed off by DPO/counsel
- `compliance/launch.json` has null/pending values
- Release is intentionally blocked until legal sign-off

> [!NOTE]
> Exit code 1 here is the **correct behavior** — the gate is designed to block until all compliance fields in `launch.json` are filled by an authorized human reviewer.

### 13.2 DPIA Document Check

```powershell
Test-Path "docs\compliance\dpia\DPIA-draft.md"
Get-Content "docs\compliance\dpia\DPIA-draft.md" | Select-Object -First 30
```

**Expected:** File exists and contains structured DPIA sections (Processing Activities, Risk Assessment, Mitigations, Residual Risk).

### 13.3 Launch Manifest Inspection

```powershell
Get-Content "compliance\launch.json" | ConvertFrom-Json
```

**Expected:** JSON object with fields like `dpia_approved`, `counsel_sign_off`, `dpo_review` — all `null` or `false` (pending). This is correct for pre-launch state.

### 13.4 Breach Runbook Presence

```powershell
Test-Path "docs\compliance\BREACH_RUNBOOK.md"
```

**Expected:** `True`.

### 13.5 Hosted Supabase Checklist

```powershell
Test-Path "Reports\HOSTED_SUPABASE_CHECKLIST.md"
Get-Content "Reports\HOSTED_SUPABASE_CHECKLIST.md" | Measure-Object -Line
```

**Expected:** File exists with > 50 lines of checklist items.

---

## Section 14 — End-to-End Security Scan

**Goal:** Run all automated security gates together as a final sweep.

### 14.1 Full Security Gate Suite

```powershell
# Gate 1: RLS coverage (29 relations)
npm run check:rls

# Gate 2: CAD security invariants
npm run check:cad-security

# Gate 3: Extension manifest (no global leaks)
npm run check:manifest

# Gate 4: No secrets tracked in repo
node scripts/check-no-secrets-tracked.mjs

# Gate 5: All audit chains valid
node scripts/verify-audit-chain.mjs

# Gate 6: Phase 6 zero plaintext PHI
node scripts/verify-phase6-canary.mjs

# Gate 7: Leak proofs (5/5)
node scripts/check-leak-proofs.mjs

# Gate 8: Commercial overlay (4/4)
node scripts/check-commercial-overlay.mjs

# Gate 9: Purge mock users (should be 0 remaining after purge)
node scripts/purge-mocks.mjs
node scripts/purge-mocks.mjs --check-clean
```

### 14.2 Expected Results Summary

| Gate | Command | Expected |
|---|---|---|
| RLS | `check:rls` | 29 relations covered |
| Security | `check:cad-security` | 0 errors |
| Manifest | `check:manifest` | 0 global leaks |
| Secrets | `check-no-secrets-tracked.mjs` | 0 secrets |
| Audit chains | `verify-audit-chain.mjs` | 6/6 valid |
| Phase 6 PHI | `verify-phase6-canary.mjs` | 0 plaintext |
| Leak proofs | `check-leak-proofs.mjs` | 5/5 pass |
| Commercial | `check-commercial-overlay.mjs` | 4/4 pass |
| Mock cleanup | `purge-mocks.mjs --check-clean` | 0 mock users |

### 14.3 Full pgTAP Suite — All Nine Files

Run all pgTAP suites in sequence to confirm every DB-layer invariant:

```powershell
$suites = @(
  "cad_tenant_wall.sql",
  "cad_claims_and_revocation.sql",
  "cad_grant_matrix_lifecycle.sql",
  "cad_abac_and_clinical.sql",
  "cad_worm_ledger.sql",
  "cad_field_encryption_and_projection.sql",
  "cad_exchange_and_dpt.sql",
  "cad_commercial_overlay.sql",
  "cad_retention_and_rights.sql"
)

foreach ($suite in $suites) {
  Write-Host "`n=== Running $suite ===" -ForegroundColor Cyan
  Get-Content "supabase/tests/$suite" | docker exec -i supabase_db_NUT-04_Checkout_Tool psql -U postgres -d postgres
}
```

**Expected:** Zero `not ok` lines across all nine suites.

---

## Section 15 — Post-Test Cleanup

> [!CAUTION]
> Run this section after completing all tests. Do **not** skip the mock purge — mock accounts must not persist in any environment.

```powershell
# 1. Purge all mock test users
node scripts/purge-mocks.mjs

# 2. Confirm zero mock users remain
node scripts/purge-mocks.mjs --check-clean

# 3. Unload the extension (optional, but recommended)
# chrome://extensions → Remove the NUT-04 extension card

# 4. Confirm no plaintext PHI introduced during testing
node scripts/verify-phase6-canary.mjs
```

---

## Appendix A — Key File Reference

| File | Purpose |
|---|---|
| [`scripts/seed-mock-users.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/seed-mock-users.mjs) | Seeds one account per role for testing |
| [`scripts/purge-mocks.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/purge-mocks.mjs) | Removes all mock accounts; `--check-clean` asserts zero |
| [`scripts/verify-audit-chain.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/verify-audit-chain.mjs) | Verifies hash-chain integrity across all 6 audit chains |
| [`scripts/verify-phase6-canary.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/verify-phase6-canary.mjs) | Scans pg_dump for plaintext PHI fields |
| [`scripts/check-leak-proofs.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/check-leak-proofs.mjs) | 5-step DPT privacy leak proof |
| [`scripts/check-commercial-overlay.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/check-commercial-overlay.mjs) | Commercial overlay invariants (4 steps) |
| [`scripts/purge-retention.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/purge-retention.mjs) | Retention purge engine (supports `--dry-run`) |
| [`scripts/release-gate.mjs`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/scripts/release-gate.mjs) | Compliance release gate (blocks until counsel sign-off) |
| [`src/shared/patient-export.ts`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/shared/patient-export.ts) | Patient data export with SHA-256 + Ed25519 signature |
| [`compliance/launch.json`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/compliance/launch.json) | Compliance launch manifest (DPO/counsel fields) |
| [`docs/compliance/dpia/DPIA-draft.md`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/docs/compliance/dpia/DPIA-draft.md) | DPIA draft document |
| [`docs/compliance/BREACH_RUNBOOK.md`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/docs/compliance/BREACH_RUNBOOK.md) | Data breach response runbook |
| [`Reports/CAD_BACKEND_FINAL_REPORT.md`](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/Reports/CAD_BACKEND_FINAL_REPORT.md) | Full implementation report (Phases 0–10) |

---

## Appendix B — Critical Security Invariants Checklist

These are the hard invariants that must hold at all times. Each is tested in this guide.

- [ ] **S1** Cross-tenant query returns exactly 0 rows (Sections 3.2, 3.4)
- [ ] **S2** No `callerRank` or numeric rank comparisons anywhere (Section 2.3 via `check:cad-security`)
- [ ] **S3** Single `BAN_UNTIL_ISO` constant used for all bans (Section 2.3)
- [ ] **S4** DPT contains no condition names (`diabetic_friendly`, `renal_safe`, `low_potassium`) (Section 8.2)
- [ ] **S5** `v_orders_tracking` has no `shopper_alias` column (Section 9.4)
- [ ] **S6** `v_sku_demand` suppresses below k=5 distinct shoppers (Section 9.5)
- [ ] **S7** WORM ledger rejects UPDATE and DELETE (Sections 7.2, 7.3)
- [ ] **S8** Crypto-shredded patient data is permanently unreadable (Section 5.5)
- [ ] **S9** Break-glass access is immediately recorded in `audit.ledger` (Section 6.4)
- [ ] **S10** DPoP proof replay is rejected (Section 8.3)
- [ ] **S11** No DPoP key material persists to IndexedDB or localStorage (Section 8.1)
- [ ] **S12** Extension transmits no PHI to retailer domains (Section 9.2)
- [ ] **S13** Revoked DPT returns `TOKEN_REVOKED` 401 (Section 10.3)
- [ ] **S14** Legal hold blocks retention purge (Section 12.3)
- [ ] **S15** Release gate blocks launch without counsel sign-off (Section 13.1)

---

## Appendix C — Test Tenant UUIDs

| Tenant | UUID |
|---|---|
| Test Tenant 1 | `11111111-1111-1111-1111-111111111111` |
| Test Tenant 2 | `22222222-2222-2222-2222-222222222222` |

---

*Generated for NUT-04 Checkout Tool — CAD Backend Blueprint v1.0 — Branch `feat/cad-backend-blueprint`*
*Last updated: 2026-11-03*
