# Production Guardrails: Pre-Flight Verification Checklist

## Purpose & Scope
This checklist defines the mandatory quality and security gates that must be completed **before merging any Pull Request into the main branch or cutting a production release** of the NUT-04 Checkout Tool. Failure of any single gate constitutes an automatic block.

---

## 1. Automated CI Pipeline Checklist (Docker-Only)

All commands must execute inside the containerized toolchain (Rule R4) using the orchestration wrapper (`.\bin\nut.ps1` on Windows, `./bin/nut` on POSIX).

| Order | Verification Gate | Execution Command | Required Result | Blocking Criteria |
|---|---|---|---|---|
| **1** | **No Tracked Secrets** | `node scripts/check-no-secrets-tracked.mjs` | `No secrets tracked.` | ANY untracked secret, `.env`, or `.secrets/*` staged in git. |
| **2** | **No Hardcoded Data** | `node scripts/check-no-hardcoded-data.mjs` | `[PASS] No hardcoded patient or clinic-specific data found in src/.` | ANY match of `PAT-XXXX`, `pat-anon-XXXX`, `@knh.or.ke`, `@akuh.ac.ke`, hospital names, or phone numbers in `src/`. |
| **3** | **Manifest Globals** | `npm run check:manifest` | `✓ Manifest globals check passed` | Unregistered globals or missing extension permissions. |
| **4** | **CAD Security Audit** | `npm run check:cad-security` | `[PASS] CAD security verification passed` | Hardcoded security bypasses, unverified role strings. |
| **5** | **Syntax Check** | `node --check src/extension/content.js` | Zero output (exits 0) | Syntax errors in unbundled extension content scripts. |
| **6** | **Prettier Formatting** | `npm run format:check` | `All matched files use Prettier code style!` | Unformatted code. Run `.\bin\nut.ps1 format` to fix. |
| **7** | **ESLint Quality Gate** | `npm run lint` | `0 errors` | ANY ESLint error in UI, extension, or scripts. |
| **8** | **TypeScript Typecheck** | `npm run typecheck` | `✓ TypeScript check passed: 0 errors` | ANY TypeScript compiler diagnostic error. |
| **9** | **Vitest Regression Suite**| `npm run test` | `45 passed (45), 793+ passed` | ANY failing test in `src/ui/src/app/__tests__/`. |
| **10** | **Production Build** | `npm run build` | Builds `dist/` and `dist-ui/` | Build compilation failure in Vite or esbuild. |
| **11** | **No Fixtures in Dist** | `node scripts/check-no-fixtures-in-dist.mjs` | `[PASS] No test fixtures or mock credentials found in dist/.` | ANY mock credentials or test fixtures present in `./dist/` or `./dist-ui/`. |
| **12** | **Cryptographic Audit Chain**| `node scripts/verify-audit-chain.mjs` | `[PASS] All 6 chains cryptographic hash continuity verified` | ANY hash mismatch or broken link in the WORM audit ledger. |

---

## 2. Database Migration Safety Rules (dbmate)

Before applying any migration to production databases:

- [ ] **Dual Migration Pair Committed:** Verify that both `db/migrations/NNNN_name.sql` and `db/migrations/NNNN_name.rollback.sql` exist and have been tested.
- [ ] **Zero-Downtime Non-Locking DDL:**
  - [ ] No `ALTER TABLE ... ADD COLUMN` without a default value or `NOT NULL` on massive tables without concurrent backfill.
  - [ ] Indexes must use `CREATE INDEX CONCURRENTLY`.
  - [ ] No column renames or table drops on live tables without multi-phase deprecation.
- [ ] **Row Level Security (RLS) Applied:**
  - [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
  - [ ] `ALTER TABLE ... FORCE ROW LEVEL SECURITY;`
  - [ ] Explicit policy checking `tenant_id = (app_private.claims()->>'tenant_id')::uuid`.
  - [ ] Privileges granted strictly to `authenticated` or specific service roles; revoked from `PUBLIC`.
- [ ] **Retention Trigger Attached:** Clinical tables must have `retain_until` column defaulting to 20 years with `BEFORE DELETE` triggers blocking early deletion (ADR-005).

---

## 3. Chrome Extension Manifest & Security Review

Before submitting an updated extension package to the Chrome Web Store:

- [ ] **Manifest V3 Strict Adherence:** Manifest must declare `"manifest_version": 3`.
- [ ] **Zero Dangerous Permissions:**
  - Permissions strictly limited to: `["alarms", "storage", "scripting", "identity", "sidePanel"]`.
  - No `<all_urls>` permission requested.
  - `host_permissions` strictly restricted to the 3 target retailer supermarket domains (`*://*.quickmart.co.ke/*`, `*://*.naivas.co.ke/*`, `*://*.carrefourkenya.com/*`) and local development endpoints.
- [ ] **Zero Remote Code Execution:** CSP must prohibit `unsafe-eval` and remote script downloads. All code runs locally from the signed CRX bundle.
- [ ] **Web Accessible Resources Least Privilege:** `web_accessible_resources` must never expose bulk product catalogs (`data/*.json`) to retailer origins (Gap G-16 resolved).

---

## 4. Statutory & Regulatory Release Gate (DPA 2019)

Before launching new clinical healthcare functionality:

- [ ] **DPIA Active & Filed:** Verify that the Data Protection Impact Assessment (`docs/compliance/dpia/DPIA-draft.md`) has been filed with the Office of the Data Protection Commissioner (ODPC) for $\ge 60$ days (ADR-014).
- [ ] **Legal Counsel Sign-Off:** Confirm that Kenyan legal counsel (Law Society of Kenya advocate) has signed off on the release configuration in `release-gate.mjs`.
- [ ] **Run Statutory Check:** Execute `node scripts/release-gate.mjs` and confirm `[PASS] Release gate conditions satisfied`.

