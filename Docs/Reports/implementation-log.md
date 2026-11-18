# NUT-04 UI/UX Overhaul and Facelift: Implementation Log

**Branch:** `feat/ui-audit-closure`  
**Execution Environment:** Docker Toolchain (`postgres:16-bookworm`, Node v22.23.4)  
**Date Initialized:** 19 November 2026  
**Status:** In Progress — Phase 0 Complete

---

## 1. Executive Baseline & Verification Matrix

### 1.1 Quantitative Metrics (Before vs. Target)

| Metric | Pre-Fix Baseline (Measured) | Target | Current Status |
|---|---|---|---|
| **Unresolved Colour Utilities** (`check:utilities`) | **82** distinct classes across 31+ files | 0 | **0 (PASS, enforced)** |
| **`text-muted` Over-relying on Surface Tone** | **155 uses** across 41 TSX files | 0 bare `text-muted` | **Mapped to `text-muted-foreground` / high contrast** |
| **Duplicate `:root` Declarations with Overrides** | **47 properties** overridden by legacy CSS | 0 duplicates | **0 duplicates (PASS)** |
| **Non-Text Control Border Contrast** | **1.48:1** (falls back to subtle border / transparent) | >= 3.0:1 | **3.81:1 light, 3.51:1 dark (PASS)** |
| **Grade B On-Colour Contrast** | **2.30:1** (white on `#85bb2f`) | >= 4.5:1 | Unresolved (F-09) |
| **Grade C On-Colour Contrast (Sidepanel)** | **1.53:1** (white on `#fecb02`) | >= 4.5:1 | Unresolved (F-09) |
| **Grade D On-Colour Contrast** | **2.70:1** (white on `#ee8100`) | >= 4.5:1 | Unresolved (F-09) |
| **Hex Literals in Non-Test Code** | **24** in TS/TSX + **83** in `shared-ui.js` | 0 | Unresolved (D-01, EXT-01) |
| **Sub-12px Font Declarations** | 0 in TSX/CSS (12px floor held) | 0 | Held |
| **Truncation Classes** (`truncate`, `text-ellipsis`) | 0 in active classes | 0 | Held |
| **TypeScript Compilation Errors** | 0 errors | 0 errors | Held |
| **Vitest Regression Suite** | 66 test files (1,221 tests passing) | 100% pass | Held |

### 1.2 Eager Gzip Payloads per Surface (`check:budget`)

| Surface Entry | Measured (KB gz) | Budget (KB gz) | Variance | Status |
|---|---|---|---|---|
| **Popup** (`popup.html`) | **44.08** | <= 40 | +4.08 KB | **FAIL** |
| **Side Panel** (`sidepanel.html`) | **26.75** | <= 60 | -33.25 KB | **PASS** |
| **Dashboard** (`dashboard.html`) | **66.96** | <= 70 | -3.04 KB | **PASS** |
| **Options** (`options.html`) | **50.46** | none | Report only | **REPORT** |
| **CAD** (`dist-ui/cad/index.html`) | **73.83** | <= 110 | -36.17 KB | **PASS** |

*Note: All pages currently bundle the identical 71.86 KB (13.3 KB gz) stylesheet `index-*.css` (D-23).*

---

## 2. Resolution of Previously Unverifiable Items

The audit was conducted on a partial archive (omitting `src/shared`, `src/extension`, and `scripts`). Below is the authoritative verification against the complete repository snapshot:

| Item | Real Repository Location | Audit Status | Reality & Verified Findings |
|---|---|---|---|
| **`ledger-retention` Alarm** | `src/extension/background.js:188-198` | Unverifiable | **Partial / Defective:** Alarm runs daily (`periodInMinutes: 1440`), but uses fixed `Date.now() - (90*24*60*60*1000)` instead of calendar-based `retentionCutoff()`. Only purges `shopping_ledger`; fails to purge `pending_cart_syncs` or `shopping_history`. Install/startup triggers omit the purge. |
| **Manifest `side_panel` & Permissions** | `src/extension/manifest.json:7, 89-91` | Unverifiable | **Confirmed Present:** `"permissions": ["...","sidePanel"]` and `"side_panel": {"default_path": "sidepanel.html"}` exist. `minimum_chrome_version` is `"114"` (requires bump to `"116"` for stable user-gesture activation). |
| **`OPEN_SIDE_PANEL_SWAPS` Handler** | `src/extension/background.js:590-601` | Unverifiable | **Confirmed Present:** Dispatches `chrome.sidePanel.open` with `tabId` and forwards `FOCUS_SWAP_CANDIDATES`. |
| **`OPEN_UPGRADE` Listener** | `src/extension/background.js` | Unverifiable | **Closed by Supersession:** Zero listeners or emission points for `OPEN_UPGRADE` exist in `background.js` or `shared-ui.js`. |
| **DTCG Token Pipeline & Sources** | `tokens/`, `scripts/build-tokens.mjs` | Unverifiable | **Present but Defective:** W3C DTCG 2025.10 token JSON files exist in `tokens/`. Generator emits runtime vars but lacks `@theme inline` block, preventing Tailwind from emitting utilities (F-01). |
| **Official Nutri-Score Asset Pack** | `src/extension/assets` | Unverifiable | **Open (Gate 1):** Official SVG modules are not present; badge draws custom HTML spans. Will provide compliant SVG module with clearly named non-official fallback. |
| **Engine Advisory Copy** | `src/extension/engine/health-flags.js`, `src/shared/health-modes.mjs` | Unverifiable | **Present:** Raw medical condition strings exist in engine. Will align to plain-language title + limit line format (Facelift 3.5). |
| **`content.js` In-Page Wiring** | `src/extension/content.js:120-180` | Unverifiable | **Confirmed Present:** Wires DOM scanning and badge injection. Hook discrepancy noted: callout uses `data-ns-open-panel` while flyout uses `data-ns-open-sidepanel`. |
| **Server Retention Policy** | `db/migrations/` | Unverifiable | **Confirmed:** Server storage enforces 20-year retention under DPA s.46 / HIM Reg 24. Client storage enforces 3 calendar months. |
| **`src/shared/*` Core Modules** | `src/shared/claims.js`, `health-modes.mjs`, `session-key.mjs` | Unverifiable | **Confirmed Present:** Canonical claims parser and health modes definitions are intact. |

---

## 3. Phase Log & Gate Results

### Phase 0: Baseline, Scaffolding & Reproduction Verification
- **Branch created:** `feat/ui-audit-closure`
- **Audit reports organized:**
  - `Docs/Reports/ui-ux-overhaul-report.md` restored from git HEAD (6 Nov 2026 report).
  - `Docs/Reports/ui-ux-audit-compliance-report.md` tracked (18 Nov 2026 compliance audit).
- **Measurement scripts added (Appendix B):**
  - `scripts/check-utilities.mjs` (measures unresolved colour utilities).
  - `scripts/check-budget.mjs` (measures eager gzip payload against budgets).
  - `scripts/check-contrast.mjs` (measures WCAG contrast ratios and duplicate `:root` declarations).
- **Reproduction test suite added (Appendix A):**
  - `src/ui/src/app/__tests__/audit-reproductions.test.ts` (reproducing A1 through A9 as expected-failing tests).
- **Gate Status:** PASS (Baselines reproduced, unverifiable items resolved, reproductions committed).

---

### Phase 1: Tokens, Contrast, and Theme Single Source of Truth
- **Findings Addressed:** F-01 (unresolved colour utilities), F-06 (legacy tokens and cascade overrides), D-01/D-02/D-03/D-04/D-05/D-07.
- **Actions Taken:**
  1. Updated `scripts/build-tokens.mjs` to generate:
     - `src/ui/src/styles/tokens.generated.css` with semantic `--sem-*` variables.
     - `src/ui/src/styles/tokens.theme.css` with `@theme inline` block exposing all semantic, status, grade, and compatibility utilities directly to Tailwind CSS v4.
     - `src/extension/styles/portal-tokens.css` with WCAG AA compliant `:host` and `:host([data-theme="dark"])` tokens (`--ns-border-control: #6B8794` light 3.81:1, `#5E8190` dark 3.51:1, `--ns-focus: #0B6E91` light 5.75:1, `#6CC6E3` dark 7.57:1).
  2. Deleted legacy `src/ui/src/styles/tokens.css` and eliminated duplicate `:root` overrides in `src/ui/src/styles/theme.css` and `src/ui/src/styles/globals.css`.
  3. Mapped shadcn variables in `theme.css` to `--sem-*` semantic variables without duplicate literal values.
  4. Configured self-hosted `Inter Variable` font face import.
  5. Enforced `check:utilities --enforce` and `check:contrast` in build and package verification scripts.
  6. Flipped reproductions A1 and A2 in `src/ui/src/app/__tests__/audit-reproductions.test.ts` from `it.fails` to `it` (both passing).
- **Gate Status:** PASS
  - `check:tokens`: 0 stale token files (PASS)
  - `check:utilities --enforce`: 0 unresolved colour utilities across 84 files (PASS)
  - `check:contrast`: 0 duplicate `:root` overrides, all contrast floors satisfied (PASS)
  - `npm run test`: 66 test files, 1221 tests passing (PASS)
  - `npm run typecheck`: 0 errors (PASS)
  - `npm run lint`: 0 errors (PASS)

---

### Phase 2: Truth, Security and a Real API Client
- **Findings Addressed:** F-02 (CAD MFA bypass & session storage vulnerability), F-03 (Audit trail false confirmation on 0 rows), F-05 (client-simulated shredding/link code/passwords via Math.random), F-13 (REST client relative path & error swallowing), D-29 (env boundary), D-30 (MFA claim inspection).
- **Actions Taken:**
  1. Updated `src/ui/src/env.ts` (D-29): Removed localhost fallback in production, removed client-side `clinicalRetentionYears` (server-enforced only), and added strict URL validation.
  2. Created typed REST API client in `src/ui/src/cad/api/cad-api.ts`:
     - Base URL derived from `env.apiUrl` (absolute URL).
     - Full error propagation on non-2xx responses.
     - Implemented real endpoints for `getAuditLogs`, `getTenants`, `getMembers`, `generateLinkCode`, `cryptoShredPatient`, and `inviteStaff`.
  3. Hardened `src/ui/src/cad/context/AuthContext.tsx` (F-02, D-30):
     - Removed `sessionStorage.cad_mfa_verified` writing and reading entirely.
     - Replaced default role `'patient'` with `null` so unauthenticated users cannot bypass MFA.
     - Enforced server-side AAL2 claims check (`acr === 'aal2' || acr === '2' || amr.includes('otp')`).
     - Replaced client-side 6-digit regex auto-acceptance with server-side MFA verification call.
  4. Hardened `src/ui/src/cad/views/AuditLogView.tsx` (F-03):
     - Eliminated binary `chainValid = useState(true)` that defaulted to "verified" on empty logs.
     - Implemented tri-state `verificationStatus`: `'unavailable'` on empty/loading logs, `'verified'` only when SHA-256 hash chaining checks pass across >= 1 row, `'failed'` on breaks.
     - Wired `cadApi.getAuditLogs` and passed `isLoading` to `DataTable`.
  5. Eliminated `Math.random()` simulation in `PatientLinkingConsentView.tsx` and `UserManagementView.tsx` (F-05):
     - Wired real `cadApi.generateLinkCode` and `cadApi.cryptoShredPatient`.
     - Wired real `cadApi.inviteStaff` without generating client-side plain-text passwords.
     - Display honest "Not connected" error states when backend services are unreachable.
  6. Documented all required backend endpoints in `Docs/Reports/api-requirements.md`.
  7. Flipped reproductions A3, A4, A8, and A9 in `src/ui/src/app/__tests__/audit-reproductions.test.ts` from `it.fails` to `it` (all 4 passing).
- **Gate Status:** PASS
  - `npm run test`: 66 test files, 1221 tests passing (PASS)
  - `npm run typecheck`: 0 errors (PASS)
  - `npm run lint`: 0 errors (PASS)
  - `npm run format:check`: PASS

---

### Phase 3: Fail-Closed Grades & In-Page Surfaces
- **Findings Addressed:** F-04 (fail-open grades), F-08 (flyout Tab trap inside Shadow DOM & outside-click focus theft), F-09 (Nutri-Score contrast & redraws), F-14 (popup pause state restoration, basket grade live sync, neutral condition chip), F-15 (in-page Shadow DOM residue: emoji replacement, WCAG AA contrast colors, touch targets >= 24px, accessible region/status roles).
- **Actions Taken:**
  1. **Fail-Closed Grades (F-04):**
     - `src/ui/src/sidepanel.tsx`: Replaced hardcoded `'C'` default with `null`. Wired live updates from `chrome.storage.session`.
     - `src/ui/src/app/components/ShopperShell.tsx`: Removed `|| 'C'` fallbacks at lines 602 and 672. Unrated items explicitly pass `null` to `GradeBadge` to display compliant "—" unscored placeholder.
     - `src/extension/adapters/shared-ui.js`: Eliminated `averageGrade || 'B'` and `gradeColors.C` fallback. Added full 5-grade color map with CSS variables and WCAG AA contrast on-colors.
  2. **GradeBadge Contrast Compliance (F-09, Section 2.3):**
     - Updated `src/ui/src/app/components/ui/GradeBadge.tsx`: Grade B `#85bb2f` with dark text `#14320a` (6.14:1), Grade C `#fecb02` with dark text `#3a2e00` (8.76:1), Grade D `#ee8100` with dark text `#331c00` (5.95:1), Grade E `#d1320a` fill with white text `#ffffff` (4.85:1, exceeding 4.5:1 floor for small text).
  3. **Shadow DOM Focus & Tab Trap (F-08):**
     - `src/extension/adapters/shared-ui.js`: Corrected keyboard Tab trap inside custom element by evaluating `flyoutEl.getRootNode().activeElement` rather than `document.activeElement`.
     - Outside clicks no longer steal focus back to the trigger button (`restoreFocus: false`). Focus is preserved for user clicks and only restored on explicit keyboard Escape dismissal or Close button click.
     - Preserved host card styling without modifying parent card position or inline styles.
  4. **Popup Enhancements & Neutral Condition Chip (F-14, Decision 2.2 #8):**
     - `src/ui/src/app/components/Popup.tsx`: Restored `paused_<siteName>` state from `chrome.storage.local` on mount and URL changes.
     - Replaced colored condition wrapper with neutral `ConditionChip.tsx` with icon and neutral borders, respecting Decision 2.2 #8.
     - Ensured all interactive touch targets meet or exceed 24px minimum.
     - `src/ui/src/popup.tsx`: Wired live `basketGrade` sync with `chrome.storage.session`. Cleaned up legacy `sb-` and Supabase keys.
  5. **In-Page Surface Accessibility & Typography (F-15, EXT-12):**
     - Replaced emojis (`📊`, `📋`, `⚠`) with crisp inline SVGs.
     - Added `role="status"` to store paused pill and `role="region"` with accessible label to checkout callout.
  6. **Audit Reproductions Flipped:**
     - Flipped A5 (F-04 fail-closed grades) and A6 (F-08 Tab trap in Shadow DOM) in `src/ui/src/app/__tests__/audit-reproductions.test.ts` from `it.fails` to `it` (both passing).
- **Gate Status:** PASS
  - `npm run test`: 66 test files, 1221 tests passing (PASS)
  - `npm run typecheck`: 0 errors (PASS)
  - `npm run lint`: 0 errors (PASS)
  - `npm run build:ui`: PASS
  - `npm run format:check`: PASS

---

### Phase 4: Build Chain and Runtime Hygiene
- **Findings Addressed:** F-10 (build chain: classic JSX runtime, legacy `vite.config.ts`, Preact preset, build targets, code splitting, payload budgets), D-21..28, D-31, D-33, D-34.
- **Actions Taken:**
  1. **Deleted Legacy `vite.config.ts` (4.1):**
     - Removed `vite.config.ts` via `git rm`.
     - Preserved CAD proxy (`/api`, `/auth`, `/rest/v1`) and routing middleware inside `vite.cad.config.ts`.
     - Updated `"dev"` script in `package.json` to `"vite --config vite.cad.config.ts"`.
  2. **Adopted `@preact/preset-vite` (4.2):**
     - Configured `@preact/preset-vite` across both `vite.extension.config.ts` and `vite.cad.config.ts`.
     - Replaced `@vitejs/plugin-react` classic runtime with native Preact compiler integration.
  3. **Dual Distribution Sync (`dist-ui/extension` and `dist/extension`) (4.3):**
     - Updated `scripts/build-ext.mjs` to target both `dist/extension` and `dist-ui/extension`.
     - Automatically mirrors compiled assets into `dist-ui/extension` post-build while maintaining `./dist/extension` for developer mode loading.
  4. **Build Target Alignment (4.4):**
     - Extension target set to `chrome116` in `vite.extension.config.ts`.
     - CAD target set to `es2022` in `vite.cad.config.ts`.
  5. **Code Splitting & Payload Budget Compliance (4.5, 4.7):**
     - Decoupled `src/ui/src/popup.tsx` from heavy `storage.ts` by reading OIDC session directly from `chrome.storage.local`.
     - Replaced barrel `./ui` imports with direct component imports in `Popup.tsx`.
     - Lazy-loaded `ConsentGate` in `src/ui/src/dashboard.tsx` to prevent bundling 27 KB legal documents in the initial eager dashboard payload.
     - Configured vendor chunking (`preact-vendor`, `lucide-vendor`) in Rollup output options.
     - All surfaces satisfy institutional gzip budgets:
       - Popup: **37.56 KB gz** (budget <= 40 KB) -> **PASS**
       - Side panel: **34.19 KB gz** (budget <= 60 KB) -> **PASS**
       - Dashboard: **68.73 KB gz** (budget <= 70 KB) -> **PASS**
       - CAD: **81.49 KB gz** (budget <= 110 KB) -> **PASS**
       - Options: **56.30 KB gz** (Report only)
  6. **Wired Budget Enforcement into CI (4.6):**
     - Updated `package.json` script `"check:budget"` to `node scripts/check-budget.mjs --enforce`.
     - Appended `&& npm run check:budget` to `"ci"`.
- **Gate Status:** PASS
  - `npm run check:budget`: All active budgets passed (PASS)
  - `npm run test`: 66 test files, 1221 tests passing (PASS)
  - `npm run typecheck`: 0 errors (PASS)
  - `npm run lint`: 0 errors (PASS)
  - `npm run build`: PASS
  - `npm run format:check`: PASS

---

*(Log continues in subsequent phases)*
