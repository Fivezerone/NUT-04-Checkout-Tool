# Repository Inventory

> Generated during Phase 0 of `refactor/decay-cleanup-docker-ui`.
> Columns: Path/Group | Purpose | Reachable from entry point | Last commit | Authors

## Entry Points Enumerated First

| Entry point | Type | File |
|---|---|---|
| `src/extension/manifest.json` | Extension manifest | Background SW, content scripts, popup, options, web-accessible resources |
| `src/ui/src/popup.tsx` | Vite input | Popup UI |
| `src/ui/src/dashboard.tsx` | Vite input | Shopper dashboard |
| `src/ui/src/options.tsx` | Vite input | Extension options |
| `src/ui/src/onboarding.tsx` | Vite input | Onboarding wizard (DEAD — decision 6) |
| `src/ui/src/cad/main.tsx` | Vite input | CAD application |
| `package.json` scripts | npm scripts | `build`, `test`, `lint`, `ci`, `dev`, etc. |
| `.github/` workflows | CI | (to be enumerated) |
| `vite.config.ts` | Vite config | All build inputs |

## Full File Inventory

> Populated by `git ls-files` analysis — to be completed in §4.2.

| Path or Group | Purpose | Reachable | Last Commit | Authors |
|---|---|---|---|---|
| `src/extension/manifest.json` | MV3 manifest | ✅ entry | — | — |
| `src/extension/background.js` | Service worker | ✅ manifest | — | — |
| `src/extension/content.js` | Content script | ✅ manifest | — | — |
| `src/extension/scanner.js` | Product scanner | ✅ manifest | — | — |
| `src/extension/catalog-sync.js` | Catalogue sync | ✅ via background | — | — |
| `src/extension/health-modes.js` | Health-mode loader | ✅ manifest | — | — |
| `src/extension/db.js` | IndexedDB wrapper | ✅ via background | — | — |
| `src/extension/entitlement.js` | Entitlement check | ⚠ verify | — | — |
| `src/extension/supabase.js` | Supabase client | ⚠ DEAD by decision 7 | — | — |
| `src/extension/observed-orders-sync.js` | Order sync | ⚠ verify | — | — |
| `src/extension/adapters/` | Retailer adapters | ✅ manifest | — | — |
| `src/extension/engine/` | Scoring engine | ✅ via content.js | — | — |
| `src/extension/data/*.json` | Product catalogue | ✅ web-accessible | — | — |
| `src/shared/` | Shared TypeScript modules | ⚠ verify per file | — | — |
| `src/ui/src/app/components/OnboardingWizard.tsx` | Onboarding | ❌ DEAD decision 6 | — | — |
| `src/ui/src/app/components/SubscriptionExpiredPage.tsx` | Subscription expired | ❌ DEAD decision 6 | — | — |
| `src/ui/src/app/hooks/usePaymentState.ts` | Payment hook | ❌ DEAD decision 6 | — | — |
| `src/ui/src/app/hooks/useSubscriptionGuard.ts` | Subscription guard | ❌ DEAD decision 6 | — | — |
| `src/ui/src/cad/views/ClinicalOverview.tsx` | Clinical overview | ❌ imported nowhere | — | — |
| `src/ui/src/cad/supabaseClient.ts` | Supabase CAD client | ❌ DEAD decision 7 | — | — |
| `src/ui/src/services/storage.ts` | Storage service | ⚠ verify | — | — |
| `supabase/` | Supabase config, migrations, functions | ❌ DEAD decision 7 | — | — |
| `scripts/seed-mock-users.mjs` | Seed mock users | ❌ Supabase-specific | — | — |
| `scripts/stage-pilot-fixtures.mjs` | Pilot fixtures | ❌ Supabase-specific | — | — |
| `scripts/purge-mocks.mjs` | Purge mock users | ❌ Supabase-specific | — | — |
| `scripts/migrate-quickmart-supabase.mjs` | Quickmart migration | ❌ Supabase-specific | — | — |
| `scripts/publish-catalog.mjs` | Catalogue publish | ⚠ migrate to Docker | — | — |
| `scripts/check-rls-policies.mjs` | RLS check | ⚠ rewrite for Postgres | — | — |
| `build.ps1` | Host-side build script | ❌ DEAD — R4 (Docker only) | — | — |
| `debug.cjs` | Debug script | ⚠ verify | — | — |
| `fix_dashboard.cjs` | Dashboard fix | ⚠ one-off? | — | — |
| `fix_dashboard.js` | Dashboard fix | ⚠ one-off? | — | — |
| `patch_datasets.cjs` | Dataset patch | ⚠ one-off? | — | — |
| `test_disease_engine.cjs` | Disease engine test | ⚠ verify | — | — |
| `test_regex.*` | Regex test | ⚠ one-off? | — | — |
| `test-import.mjs` | Import test | ⚠ one-off? | — | — |

## Status

Detailed inventory (last-commit dates, full reachability) to be populated
by running `git ls-files --format '%(objectmode) %(path)' | ...` inside
the toolchain container during §4.2.

