# Deletion Ledger

> Generated and maintained by the refactor agent on the `refactor/decay-cleanup-docker-ui` branch.
> Every deletion requires a row here (R3). Format: ID · Path · Reason class · Proof · Risk.
>
> **Reason classes:**
> - `EXP` — expired / superseded (never used or decision-obsoleted)
> - `HARD` — hard-coded data (Stage B)
> - `CFG` — config/env change

---

## Stage A — Repository Cleanup (Commits A-01 through A-10)

### A-01 · Commit `5c27c580` (A-02)

| ID | Path | Reason | Proof | Risk |
|----|------|--------|-------|------|
| A-01 | `src/ui/src/app/components/OnboardingWizard.tsx` | EXP/decision-6 | Decision 6: no self sign-up; zero imports confirmed by `git grep` | low |
| A-02 | `src/ui/src/app/components/SubscriptionExpiredPage.tsx` | EXP/decision-6 | Decision 6: no payment plans; zero imports | low |
| A-03 | `src/ui/src/app/hooks/usePaymentState.ts` | EXP/decision-6 | Decision 6: no payment state; zero imports | low |
| A-04 | `src/ui/src/app/hooks/useSubscriptionGuard.ts` | EXP/decision-6 | Decision 6: no subscription guard; zero imports | low |
| A-05 | `src/ui/src/app/lib/subscriptionUtils.ts` | EXP/decision-6 | Decision 6: no subscription utils; zero imports | low |
| A-06 | `src/ui/src/app/lib/persistOnboarding.ts` | EXP/decision-6 | Decision 6: no onboarding persistence; zero imports | low |
| A-07 | `src/ui/src/onboarding.tsx` | EXP/decision-6 | Decision 6: no onboarding entry point; zero imports | low |
| A-08 | `src/ui/onboarding.html` | EXP/decision-6 | Decision 6: onboarding HTML entrypoint; removed from vite rollupOptions | low |
| A-09 | `src/shared/payments.ts` | EXP/decision-6 | Decision 6: no payments in extension; zero imports | low |

**Also in A-02 commit:** `vite.config.ts` — removed `onboarding` rollup entry and `figmaAssetResolver()` plugin call.

---

### A-02 · Commit `cf004952` (A-03 + B-01)

| ID | Path | Reason | Proof | Risk |
|----|------|--------|-------|------|
| A-10 | `src/extension/supabase.js` | EXP/decision-7 | Decision 7: bundled Supabase-js build artefact; deleted from importScripts | low |
| A-11 | `src/ui/src/cad/supabaseClient.ts` | EXP/decision-7 | Decision 7: `cadSupabase` createClient wrapper; zero external consumers | low |
| A-12 | `src/ui/src/cad/views/ClinicalOverview.tsx` | EXP/decision-7 | No imports outside file itself (`git grep` confirmed) | low |
| A-13 | `src/ui/src/services/storage.ts` | EXP/decision-7 | `createClient` from `@supabase/supabase-js`; zero consumers after A-02 | low |

**Also in A-03/B-01 commit:**
- `AuthContext.tsx` rewritten: `cadSupabase` calls → stubs; KNH/AKUH demo fallbacks → empty (B-01)
- `AuditLogView.tsx`, `TenantSettingsView.tsx`, `UserManagementView.tsx`: `cadSupabase` import removed → stubs (A-03)
- `src/shared/auth-provider.ts`: `SupabaseAuthProvider` class removed; `OidcCodePkceProvider` stub kept (A-03)

---

### A-03 · Commit `13aab9ad` (A-04)

| ID | Path/Package | Reason | Proof | Risk |
|----|--------------|--------|-------|------|
| A-15 | `@emotion/react@11.14.0` | EXP/zero-imports | `git grep` returns zero TypeScript imports | low |
| A-16 | `@emotion/styled@11.14.1` | EXP/zero-imports | `git grep` returns zero TypeScript imports | low |
| A-17 | `@mui/icons-material@7.3.5` | EXP/zero-imports | `git grep` returns zero TypeScript imports | low |
| A-18 | `@mui/material@7.3.5` | EXP/zero-imports | `git grep` returns zero TypeScript imports | low |
| A-19 | `@popperjs/core@2.11.8` | EXP/zero-imports | `git grep` returns zero TypeScript imports | low |
| A-20 | `motion@12.23.24` | EXP/zero-imports | `git grep` returns zero TypeScript imports | low |
| A-21 | `next-themes@0.4.6` | EXP/zero-imports | `git grep` returns zero TypeScript imports | low |
| A-22 | `@supabase/supabase-js@^2.116.0` | EXP/decision-7 | Decision 7; all callers deleted/stubbed | low |
| A-23 | `esbuild` moved to devDependencies | CFG | Build-time only tool; not a runtime dependency | low |

**npm scripts removed:** `check:rls`, `migrate:quickmart`, `seed:mocks`, `purge:mocks`, `stage:pilot`, `check:rls` from `ci`.

---

### A-04 · Commit `e5b71878` (A-05)

| ID | Path | Reason | Proof | Risk |
|----|------|--------|-------|------|
| A-24 | `debug.cjs` | EXP/one-off | One-off engine debug script; never referenced in package.json | low |
| A-25 | `fix_dashboard.cjs` | EXP/one-off | One-off CSS token find-and-replace; already applied | low |
| A-26 | `fix_dashboard.js` | EXP/one-off | Duplicate of A-25 | low |
| A-27 | `patch_datasets.cjs` | EXP/one-off | One-off dataset normalization; already applied | low |
| A-28 | `test_disease_engine.cjs` | EXP/one-off | One-off engine test harness; replaced by vitest suite | low |
| A-29 | `test_regex.cjs` | EXP/one-off | One-off regex test snippet | low |
| A-30 | `test_regex.js` | EXP/one-off | Duplicate of A-29 | low |
| A-31 | `test-import.mjs` | EXP/one-off | One-off import probe | low |
| A-32 | `build.ps1` | EXP/R4 | Host build script; R4 — Docker-only after Phase 0 | low |
| A-33 | `dev-reload.ps1` | EXP/R4 | Host reload script; R4 — Docker-only after Phase 0 | low |
| A-34 | `complexity.md` | EXP/one-off | One-off CC snapshot; superseded by FINDINGS.md | low |
| A-35 | `supabase_migration_strategy.md` | EXP/decision-7 | Decision 7 — Supabase fully decommissioned | low |
| A-36 | `EXECUTION_LEDGER.md` (root) | CFG | Moved to `docs/cleanup/EXECUTION_LEDGER.md` (not deleted) | n/a |

---

### A-05 · Commit `28c4fb5b` (A-06)

| ID | Path | Reason | Proof | Risk |
|----|------|--------|-------|------|
| A-37 | `scripts/bootstrap-super-admin.mjs` | EXP/decision-7 | Supabase admin API calls; no plain-Postgres replacement path | low |
| A-38 | `scripts/check_payments.mjs` | EXP/decision-6+7 | `@supabase/supabase-js` createClient; payment check | low |
| A-39 | `scripts/check_payments_service.mjs` | EXP/decision-6+7 | `@supabase/supabase-js` createClient; service role key | low |
| A-40 | `scripts/migrate-quickmart-supabase.mjs` | EXP/decision-7 | Supabase storage upload; R4 Docker-only anyway | low |
| A-41 | `scripts/purge-mocks.mjs` | EXP/decision-7 | Deletes from `auth.users`; Supabase-only | low |
| A-42 | `scripts/seed-mock-users.mjs` | EXP/decision-7 | Creates Supabase `auth.users`; replaced by DB seeds | low |
| A-43 | `scripts/stage-pilot-fixtures.mjs` | EXP/decision-7 | Inserts into Supabase via REST | low |
| A-44 | `scripts/upload_success_page.mjs` | EXP/decision-7 | Supabase storage bucket upload | low |

**Updated in A-06:**
- `scripts/check-rls-policies.mjs` — repointed to `db/migrations/`; exits 0 if empty
- `scripts/verify-phase6-canary.mjs` — container name updated

---

### A-06 · Commit `2833c142` (A-07)

| ID | Path | Reason | Proof | Risk |
|----|------|--------|-------|------|
| A-45 | `supabase/` (entire directory) | EXP/decision-7 | 36 migrations, 10 edge functions, 5 test SQL, config.toml, .gitignore | low |
| A-46 | `scripts/ingest_products.ts` | EXP/decision-7 | `@supabase/supabase-js` createClient; replaced by DB seeds | low |
| A-47 | `scripts/build-sw-client.mjs` | EXP/decision-7 | Built `src/extension/supabase.js` (deleted in A-10) | low |
| A-48 | `src/ui/src/app/__tests__/cad-blueprint-phase3.test.ts` | EXP/decision-7 | Reads deleted `supabase/migrations/` and `supabase/functions/` | low |
| A-49 | `src/ui/src/app/__tests__/cad-phase3-payments.test.ts` | EXP/decision-6+7 | Reads deleted `supabase/migrations/`; payment-flow tests | low |
| A-50 | `src/ui/src/app/__tests__/onboarding-finish.test.tsx` | EXP/decision-6+7 | Imports deleted `services/storage` and `persistOnboarding` | low |
| A-51 | `src/ui/src/app/__tests__/phase9-f12-f18-f23.test.ts` | EXP/decision-7 | Tests deleted `supabase.js` bundle size and `supabase/tests/` | low |

**Also updated in A-07:**
- `src/extension/config.js`: `SUPABASE_URL`/`ANON_KEY` → `API_URL`/`OIDC_ISSUER` placeholders (R5: rotated keys removed)
- `src/extension/background.js`: `supabase.js` removed from `importScripts`; session key renamed
- `src/extension/catalog-sync.js`, `entitlement.js`: session key + config key names updated
- `src/shared/session-key.mjs`: `nutri_supabase_session` → `nutri_oidc_session`
- `scripts/publish-catalog.mjs`: Supabase upload section stubbed; TODO(Stage C)
- `scripts/check-cad-security.mjs`: `supabase` removed from `SCAN_DIRS`
- `package.json build:ext`: removed `build-sw-client.mjs`

---

### A-07 · Commit `c3bed10a` (A-08)

| ID | Path | Reason | Proof | Risk |
|----|------|--------|-------|------|
| A-52 | `src/ui/src/app/components/figma/ImageWithFallback.tsx` | EXP/figma-scaffolding | Zero references outside the file itself (`git grep` confirmed) | low |
| A-53 | `src/ui/default_shadcn_theme.css` | EXP/figma-scaffolding | Not imported or referenced anywhere in `src/` | low |
| A-54 | `src/ui/ATTRIBUTIONS.md` | EXP/figma-scaffolding | Figma Make boilerplate; not project documentation | low |
| A-55 | `src/ui/guidelines/Guidelines.md` | EXP/figma-scaffolding | Figma Make placeholder template | low |

---

### A-08 · Commit `ea2fff09` (A-10)

| ID | Path | Reason | Proof | Risk |
|----|------|--------|-------|------|
| A-56 | `.env.example` (modified, not deleted) | CFG/decision-7 | Supabase vars removed; Docker stack vars added | low |

---

### A-09 · Remediation (A-14)

| ID | Path | Reason | Proof | Risk |
|----|------|--------|-------|------|
| A-57 | `src/ui/src/app/__tests__/d03-optimistic-success.test.ts` | EXP/decision-6 | Asserted on deleted `OnboardingWizard` & `usePaymentState` | low |
| A-58 | `src/ui/src/app/__tests__/d08-d09-d10-onboarding.test.ts` | EXP/decision-6 | Asserted on deleted `OnboardingWizard` & `persistOnboarding` | low |
| A-59 | `src/ui/src/app/__tests__/mock-scripts.test.ts` | EXP/decision-7 | Asserted on deleted `scripts/seed-mock-users.mjs` | low |
| A-60 | `next-themes` from `sonner.tsx` | EXP/zero-imports | `next-themes` was pruned from package.json in A-04 | low |

**Untracked Artifact Offloading to `../nut-04-archive/`:**
- `supabase/.temp/` and `supabase/.branches/` moved to `../nut-04-archive/supabase/`
- `.env` and `.env.local` containing old Supabase keys moved to `../nut-04-archive/.env.legacy` and `.env.local.legacy`

---

## Stage B — Hard-coded Data Purge

| ID | Location | Data class | What was removed | Commit |
|----|----------|-----------|-----------------|--------|
| B-01 | `AuthContext.tsx` `loadTenantData()` | HARD/class-A | KNH demo fallback tenant (name, slug, config) | `cf004952` |
| B-02 | `AuthContext.tsx` `loadAllTenants()` | HARD/class-A | KNH + AKUH fallback tenant array | `cf004952` |
| B-03 | `AuthContext.tsx` `verifyMfa()` | HARD/class-A | Any-6-char MFA stub (accepted any TOTP) | `cf004952` |
| B-04 | `AuditLogView.tsx` `loadAuditLogs()` | HARD/class-A | Mock audit log events (pat-anon-8821, KMPDC refs) | `cf004952` |
| B-05 | `UserManagementView.tsx` `loadMembers()` | HARD/class-A | Demo roster: dr.omondi, wanjiku.diet, mutua.admin, dr.kipchoge @knh.or.ke | `cf004952` |
| B-06 | `ClinicianWorkspaceView.tsx` | HARD/class-A | `PAT-0042` patient ref, hardcoded metric cards | `0052277d` |
| B-07 | `PlatformOverviewView.tsx` | HARD/class-A | `\|\| 3` fallback, inline KNH/AKUH demo tenant array | `0052277d` |
| B-08 | `PatientLinkingConsentView.tsx` | HARD/class-A | `PAT-0042`, `PAT-0108`, `Dr. Mwangi` consent records | `0052277d` |
| B-09 | `TenantSettingsView.tsx` | HARD/class-A | `knh-cardio` slug fallback | `0052277d` |
| B-10 | Guard scripts | — | Added `check-no-hardcoded-data.mjs` & `check-no-fixtures-in-dist.mjs` | `5464155d` |
| B-11 | `Options.tsx` | HARD/class-A | Dr. David Omondi & KNH Nutrition Unit fallbacks | `HEAD` |
| B-12 | `PatientLinkingConsentView.tsx` | HARD/class-A | Comment literal patient ref codes | `HEAD` |
| B-13 | `UserManagementView.tsx` | HARD/class-A | Comment `@knh.or.ke` and `KMPDC/2026/12345` | `HEAD` |
| B-14 | `PatientTargetsView.tsx` | HARD/class-A | `pat-anon-8821`, `pat-anon-4109`, `usr-dr-omondi`, `usr-diet-wanjiku` | `HEAD` |
| B-15 | `BillingSubscriptionView.tsx` | HARD/class-A | Phone `254712345678`, M-Pesa receipts `QHJ882194K`, `PZX110943A` | `HEAD` |

---

*Last updated: 2026-11-10 by refactor agent on `refactor/decay-cleanup-docker-ui`.*
