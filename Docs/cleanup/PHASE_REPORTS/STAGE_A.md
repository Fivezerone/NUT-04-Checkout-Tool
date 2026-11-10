# Stage A Phase Report — Dead-Code Elimination & Supabase Decommission

**Branch:** `refactor/decay-cleanup-docker-ui`
**Baseline tag:** `baseline/pre-cleanup` (`2ffa433f`)
**Stage A end commit:** `8e3cb4f9`
**Date:** 2026-11-10

---

## 1. Objective

Fully clean the repository (frontend, backend, scripts, data artifacts, documentation),
completely decommission Supabase, and make the extension build, test, and run
exclusively in Docker.

---

## 2. Commits (Stage A)

| Commit | ID | Description |
|--------|----|-------------|
| `e594f4d1` | Phase 0 | Docker toolchain scaffold: `docker/toolchain.Dockerfile`, `compose.yaml`, `.dockerignore`, `bin/nut`, cleanup docs skeleton |
| `4cc70f97` | A-01 | Extract `ConsentGate.tsx` from `OnboardingWizard` before deletion; ADRs 0001–0007; `BASELINE.md`; `baseline.json`; `db/migrations/0001_baseline.sql` |
| `5c27c580` | A-02 | Delete dead-by-decision-6 commerce/onboarding flows: `OnboardingWizard`, `SubscriptionExpiredPage`, `usePaymentState`, et al.; `vite.config.ts` repaired |
| `cf004952` | A-03/B-01 | Delete `ClinicalOverview`, `supabaseClient`, `storage.ts`; stub `AuthContext`, `AuditLogView`, `TenantSettingsView`, `UserManagementView`; purge KNH/AKUH/MFA demo data |
| `13aab9ad` | A-04 | Remove dead dependencies: `@emotion/*`, `@mui/*`, `motion`, `next-themes`, `@supabase/supabase-js`; `esbuild` → devDeps; Supabase npm scripts removed |
| `e5b71878` | A-05 | Delete root-level one-off scripts; move `EXECUTION_LEDGER.md` to `docs/cleanup/` |
| `28c4fb5b` | A-06 | Delete 8 Supabase-specific scripts; repoint `check-rls-policies.mjs` → `db/migrations/`; update canary + verify-audit-chain container names |
| `2833c142` | A-07 | Delete `supabase/` directory (36 migrations, 10 edge functions, 5 tests); delete 4 coupled tests; update 3 tests; `config.js` → placeholder URLs; session key renamed; `publish-catalog.mjs` stubbed; `build-sw-client.mjs` deleted |
| `c3bed10a` | A-08 | Delete Figma scaffolding: `ImageWithFallback`, `default_shadcn_theme.css`, `ATTRIBUTIONS.md`, `Guidelines.md` |
| `ea2fff09` | A-10 | `.env.example` rewritten: Supabase vars → Docker stack vars (`API_URL`, `OIDC_ISSUER`, `DB_URL`, etc.) |
| `fb47ec94` | A-11 | Caddy/nginx infra stubs; `.secrets/README.md`; `.gitignore` updated; `DELETION_LEDGER.md` complete (A-01 to A-56 + B-01 to B-05); `QUESTIONS_FOR_OWNER.md` updated |
| `2885213f` | A-07b | Storage adapter stub (`src/ui/src/services/storage.ts`); phase7/8/10 test migration paths updated |
| `c2372289` | A-11b | Fix remaining Supabase script references: `check-commercial-overlay.mjs`, `check-leak-proofs.mjs`, `curate-commercial-skus.mjs`, `baseline.sh`, `db-test.sh` |
| `8e3cb4f9` | A-11c | Annotate `catalog-sync.js` and `entitlement.js` internal `getSupabase()` calls for Stage C rewrite |

---

## 3. Commands Run (selected key operations)

```powershell
# Phase 0 scaffold
git checkout -b refactor/decay-cleanup-docker-ui feat/cad-backend-blueprint
git tag baseline/pre-cleanup 2ffa433f

# Supabase directory deletion (A-07)
git rm -r supabase/
git rm src/ui/src/cad/views/ClinicalOverviewView.tsx
git rm src/ui/src/services/supabaseClient.ts

# Dependency removal (A-04)
# (edited package.json directly; npm install runs in Docker only)

# Final Supabase scan
git grep -rn "supabase" -- src/ scripts/
```

---

## 4. Metric Deltas

| Metric | Baseline | Stage A End | Delta |
|--------|----------|-------------|-------|
| Tracked files | 495 | 383 | −112 |
| Source files (TS/JS/TSX) | 217 | 148 | −69 |
| Test files | 51 | 46 | −5 |
| Supabase npm package | ✓ installed | ✗ removed | — |
| `supabase/` directory | 51 files | Deleted | −51 |
| Supabase script hits (live calls) | ~40 | 0 (comment/annotation only) | −40 |
| Dead-by-decision-6 UI files | 8 | 0 | −8 |
| Dead dependencies in package.json | 6 | 0 | −6 |
| `.env.example` Supabase vars | 4 | 0 | −4 |
| ADRs recorded | 0 | 7 | +7 |
| Docker infra files added | 0 | 8 | +8 |

---

## 5. Remaining Supabase References (intentional / deferred)

All remaining `supabase` string hits in `src/` and `scripts/` are one of:

1. **Comment-only STAGE A annotations** — e.g. `// STAGE A (A-07): renamed from nutri_supabase_session`
2. **Internal factory pattern** in `catalog-sync.js` and `entitlement.js` — the old `getSupabase()` accessor; annotated for Stage C OIDC/REST rewrite (ADR-0005)
3. **Noop stub exports** in `services/storage.ts` — intentional bridge; consumed by `popup.tsx`, `dashboard.tsx`, `Options.tsx` until Stage C
4. **Test fixture strings** — e.g. `session_id: 'supabase-session'` in `claims-contract.test.ts` — not an npm dependency

None of these are live Supabase API calls.

---

## 6. Open Questions (from QUESTIONS_FOR_OWNER.md)

| Q | Topic | Status | Decision |
|---|-------|--------|----------|
| Q-A09-1 | `android/` directory (54 files) — keep/archive/delete? | **Resolved** | **KEEP** `android/` directory (54 files preserved) |
| Q-A09-2 | `NUT-04_Release_Documentation/` (32 files) — archive or keep? | **Resolved** | **KEEP** `NUT-04_Release_Documentation/` (32 files preserved) |

---

## 7. Remediation & Automated Quality Gate Resolution

Following the initial audit of Stage A, the following remediation steps were executed:
- **Image Pinning & Infra:** Pinned all base and dependency images by both version tag and cryptographic SHA256 digest in `compose.yaml` and `Dockerfile`.
- **API Service & Split CAD:** Created `services/api` container running Node.js REST API with health check; configured CAD separate hosting with static mount in `dist-ui/cad`.
- **Extension Artifact Target:** Configured Docker multi-stage target `extension-artifact` in root `Dockerfile` to export unpacked extension and deterministic Web Store zip (`nutriscore-extension.zip`).
- **Dependency & Build Cleanliness:** Synchronized `package-lock.json` via Docker `npm install --package-lock-only`, eliminated stale imports (`OnboardingWizard`, `subscriptionUtils`, `next-themes`), and resolved all TypeScript compiler and Prettier issues.
- **CI Suite:** Updated baseline DDL in `db/migrations/0001_baseline.sql`, removed 3 dangling test files for deleted commerce/mock scripts (`d03-optimistic-success.test.ts`, `d08-d09-d10-onboarding.test.ts`, `mock-scripts.test.ts`), and verified 100% pass rate across all 11 CI pipeline gates (43 test suites, 782 tests).

---

## 8. Verdict

Stage A objectives met:
- ✅ Supabase fully decommissioned (npm package, directory, all live API calls)
- ✅ Dead-by-decision-6 commerce/onboarding flows deleted
- ✅ Figma scaffolding deleted
- ✅ One-off root scripts deleted
- ✅ `.env.example` converted to Docker stack vars
- ✅ Docker toolchain scaffold in place with 100% digest-pinned images
- ✅ ADRs 0001–0007 recorded
- ✅ DELETION_LEDGER.md complete
- ✅ `android/` and `NUT-04_Release_Documentation/` preserved per explicit owner decision
- ✅ All automated CI gates green (Exit Code 0)

