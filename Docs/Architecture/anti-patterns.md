# Living Architectural Blueprint: Anti-Patterns (Do Not Repeat)

## Purpose & Scope
This document cataloging banned coding and architectural patterns within the **NUT-04 Checkout Tool** repository. These anti-patterns represent historical defects, architectural vulnerabilities, regulatory non-compliances, and dead ends that were permanently excised during Stages A, B, and C. 

Future developers and AI agents are **strictly prohibited** from reintroducing these patterns. Automated CI guards (`scripts/check-*.mjs`) actively scan pull requests and will fail the build if any of these patterns appear.

---

## The 10 Banned Architectural Anti-Patterns

### 1. Host-Level Command Execution (Violation of Rule R4)
- **Banned Pattern:** Running `node`, `npm`, `npx`, `python`, `psql`, or custom build scripts directly in the host terminal (PowerShell, Command Prompt, or bash).
- **Why It Is Banned:** Causes environment drift across developer operating systems (Windows vs Linux vs macOS), contaminates the build with untracked host environment variables, and produces non-reproducible artifacts.
- **What to Use Instead:** Execute all commands inside Docker containers via the repository orchestration wrappers:
  - Windows: `.\bin\nut.ps1 <verb>` or `docker compose exec toolchain ...`
  - POSIX: `./bin/nut <verb>` or `docker compose exec toolchain ...`
  - *Single Permitted Host Action:* Manually loading `./dist/extension` into Chrome Developer Mode.

---

### 2. Hardcoding Patient Identifiers, Real Clinician Names, or Hospital Domains (Rule R5 & Stage B)
- **Banned Pattern:** Inserting literal patient codes (e.g., `PAT-0042`, `pat-anon-XXXX`), clinician names (e.g., `"Dr. David Omondi"`), real Kenyan mobile numbers (`254712...`), hospital email domains (`@knh.or.ke`, `@akuh.ac.ke`), or real institutional names (`"Kenyatta National Hospital"`, `"Aga Khan University Hospital"`, slug `'knh-cardio'`) into source code, comments, or UI component defaults.
- **Why It Is Banned:** Violates the Kenya Data Protection Act 2019, creates acute regulatory exposure, and leaks confidential institutional identities into client bundles.
- **What to Use Instead:** 
  - In React components, initialize lists with empty array literals (`[]`) and display clean loading or empty states.
  - In test fixtures, use neutral synthetic identifiers (e.g., `patient-test-01`, `clinic-alpha`, domain `@example.test`).
  - Enforced by automated CI pre-commit guard: `scripts/check-no-hardcoded-data.mjs`.

---

### 3. Reintroducing Supabase SDKs, URLs, or Configurations (ADR-001)
- **Banned Pattern:** Importing `@supabase/supabase-js`, creating a `supabase/` directory, adding `VITE_SUPABASE_*` environment variables, or writing code that connects to `supabase.co` or Supabase local containers (`supabase_*` on ports 54321-54327).
- **Why It Is Banned:** Supabase was completely decommissioned in favor of an open-source, self-hosted sovereign microservices stack (Postgres 16, Keycloak 26, PostgREST 12, Fastify API, Caddy 2). Reintroducing Supabase fragments creates dual-backend schizophrenia, breaks containerized CI, and violates Binding Decision 7.
- **What to Use Instead:**
  - Authentication: Keycloak OIDC via `chrome.identity.launchWebAuthFlow` or CAD OIDC redirect.
  - Database REST: PostgREST exposed via `/api/*`.
  - Server logic: Node.js API service in `services/api/`.

---

### 4. Injecting Medical Diagnoses or Condition Names into Dietary Profile Tokens (ADR-010)
- **Banned Pattern:** Including condition labels (e.g., `"diabetes"`, `"hypertension"`, `"chronic_kidney_disease"`, `"obesity"`) in Dietary Profile Token (DPT) payloads, extension storage, or client-side queries.
- **Why It Is Banned:** Transmitting medical condition names across extension storage or network requests creates acute privacy leaks. Retailers or network sniffers can profile consumers by medical conditions.
- **What to Use Instead:** DPTs must contain **only** dimensionless numerical nutrient thresholds and constraint flags from `ALLOWLISTED_KEYS` (e.g., `sodium_mg_per_100g_max: 400`, `fibre_g_per_100g_min: 6`). All tokens are checked against `CONDITION_NAMED_PATTERNS` and rejected if any condition name appears.

---

### 5. Bypassing Row Level Security or Using `BYPASSRLS` in Database DDL
- **Banned Pattern:** Creating database roles with `BYPASSRLS`, writing queries that disable RLS (`DISABLE ROW LEVEL SECURITY`), or omitting `tenant_id` validation policies on multi-tenant tables.
- **Why It Is Banned:** Destroys multi-tenant clinic isolation. In an enterprise healthcare setting, a tenant breach where Clinic B accesses Clinic A's patient records constitutes a statutory breach under Kenya DPA s.43.
- **What to Use Instead:**
  - Always `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on every table in `iam`, `clinical`, `exchange`, and `commercial`.
  - Always validate `tenant_id` against `app_private.claims()->>'tenant_id'`.
  - All application service roles must be created with `NOLOGIN NOBYPASSRLS`.

---

### 6. Client-Side Direct Billing Mutations & B2C Self-Gated Features (ADR-008)
- **Banned Pattern:** Reading or writing `users.is_premium`, providing client-side upgrade buttons, or allowing extension code to invoke consumer payment flows (e.g., `mpesa-initiate` directly from the browser popup).
- **Why It Is Banned:** Consumer self-signup and B2C paywalls are retired. NUT-04 is an enterprise clinical platform prescribed through healthcare facilities. Feature gating is based on active clinic enrollment and signed clinician target bundles.
- **What to Use Instead:** Access is governed by active tenant membership (`tenant_members.status = 'active'`) and validated clinician DPT tokens. Billing is managed strictly at the clinic B2B level through CAD tenant subscriptions.

---

### 7. Mutating or Deleting Append-Only WORM Audit Ledger Records (ADR-012)
- **Banned Pattern:** Executing `UPDATE`, `DELETE`, or `TRUNCATE` statements against `audit.ledger` or `clinical.clinical_records`.
- **Why It Is Banned:** Destroys the SHA-256 cryptographic hash chain, breaking the audit trail required for forensic non-repudiation and medical malpractice defense.
- **What to Use Instead:** All modifications must be written as new audit events with sequential hash pointers. Corrections are committed as new append-only records. Statement-level trigger `trg_audit_ledger_immutable` denies any mutation.

---

### 8. Failing Open on Nutritional Swap Recommendations (Gap G-04)
- **Banned Pattern:** Treating missing or unverified product nutrient data as conforming, or recommending a swap candidate product when its nutritional profile is incomplete.
- **Why It Is Banned:** Recommending a product with unknown sodium or sugar content to a hypertensive or diabetic patient can cause severe medical harm. The recommender must obey: *fail-open on informational block, but fail-closed on active recommendation*.
- **What to Use Instead:** `evaluateSkuAgainstConstraints()` requires `review_state >= ESTIMATED`. If nutrient values are missing or unverified, the swap recommender suppresses the recommendation (`swapRecommended: null`).

---

### 9. Bundling Test Fixtures or Mock Secrets into Production Distribution (`dist/`)
- **Banned Pattern:** Bundling sample product catalogs, mock user accounts, test JWTs, or development credentials into `./dist/` or `./dist-ui/`.
- **Why It Is Banned:** Inflates extension bundle size, exposes development artifacts to public store review, and risks exposing mock accounts in production environments.
- **What to Use Instead:**
  - Production builds (`build:ext`, `build:cad`) exclude test files, mock credentials, and staging fixtures.
  - Enforced by automated CI post-build guard: `node scripts/check-no-fixtures-in-dist.mjs`.

---

### 10. Violating the 90-Day (3-Month) Device Storage Ceiling (ADR-005)
- **Banned Pattern:** Storing shopping ledger records, product browsing logs, or cart histories in IndexedDB or local storage for longer than 90 days, or providing UI timeframes for `"year"` or `"all"`.
- **Why It Is Banned:** Violates consumer privacy principles and the 3-month device storage ceiling mandated by Binding Decision 4.
- **What to Use Instead:**
  - The `ledger-retention` Chrome alarm executes daily and purges entries where `addedAt < Date.now() - 90 * 86400 * 1000`.
  - UI timeline models strictly limit query ranges to: `today`, `week`, `month`, and `3months` (`src/ui/src/app/lib/timeframes.ts`).

