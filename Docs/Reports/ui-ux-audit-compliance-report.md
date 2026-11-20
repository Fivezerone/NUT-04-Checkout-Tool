# NUT-04 UI/UX Overhaul and Extension Facelift: End-to-End Compliance Audit

Audit date: 18 November 2026. Subject: the repository snapshot you uploaded (`NUT-04_Checkout_Tool.rar`, nested `ui.rar`, `shared-ui.js`) against `ui-ux-overhaul-report.md` and the Extension UI Facelift.

## 0. Scope, method and what could not be verified

This audit is only as complete as the archive. Read this section before the verdict.

**What was in the archive.** 142 source files under `src/ui` (about 12,600 lines of TS/TSX), three Vite configs, `package.json` and lockfile, `tsconfig.json`, `postcss.config.mjs`, and `shared-ui.js` (780 lines).

**What was not in the archive (so those checks are marked Unverifiable, not passed).** `src/shared/*`, `src/extension/*` (manifest, `background.js`, `content.js`, engines, `portal-tokens.css`), `scripts/*` (`build-tokens`, `check-tokens`, `check-cad-security` and the rest), the DTCG token JSON sources, `.github`, any Playwright suite, and the hosted API. Consequences: the Style Dictionary pipeline source, the `ledger-retention` alarm, manifest side-panel registration, the `OPEN_SIDE_PANEL_SWAPS` handler, the official Nutri-Score asset pack and its release gate could not be inspected.

**Two assumptions (the second is now resolved).**

- Resolved: the Facelift report ("In-Page Extension UI Facelift Strategy & Audit Report") arrived after my first pass. Its EXT-01 to EXT-16 are defect IDs against the legacy `shared-ui.js`, so section 2.2 now scores each one as closed, partial or open in the file you uploaded. My first pass used an invented numbering; it is replaced.
- Supabase has been decommissioned in this codebase (REST/OIDC against Keycloak). D-22, D-29 and D-30 name Supabase mechanisms, so I judged them by intent against the replacement (Keycloak OIDC), not literally.

**What was executed.**

| Layer | What I ran | Result |
| --- | --- | --- |
| 1 Static | File-tree, config and source review of all 142 files; dead-file and import-graph checks | Done |
| 2 Pattern probes | Raw palette utilities, hex literals, sub-12 px, truncation, `window.React`, `confirm/alert`, hand-rolled overlays, emoji | Done |
| 3 Build and gates | `npm ci` (440 packages), `tsc --noEmit`, `vite build` for extension and CAD, eager gzip measurement, `vitest` | Done, with 4 stand-in modules for the missing `src/shared` files |
| 3b CSS analysis | PostCSS over the built stylesheet: effective cascade, contrast, utility-class coverage | Done (independent of the stand-ins) |
| 4 Rendered DOM | `shared-ui.js` executed in jsdom with axe-core (colour-contrast rule off) | Done for the in-page surface only |
| 4 Rendered DOM | Headless Chromium, Playwright axe, 200/400 % zoom, light/dark screenshots | **Not executed.** No browser is available in this environment, so every layout and visual claim below comes from computed CSS or source, not pixels |

Gate results: `tsc --noEmit` passes with 0 errors (against stand-ins). `vitest`: 13 of 46 test files run; the other 33 fail at collection because they read files outside the archive (for example `src/extension/engine/health-flags.js`); none of the 33 is a UI assertion failure. `eslint`, `check:tokens`, `check:manifest`, `check:cad-security` were not runnable (config and scripts absent). There is no `check:budget`, `test:e2e` or `test:a11y` script in `package.json`.

## 1. Executive compliance verdict and master scorecard

**Verdict: Blocked.** Weighted conformance across both documents is about **52 %** (closed = 1, partial = 0.5, open = 0: defects D-01 to D-44 score 19.5 of 44, EXT-01 to EXT-16 score 11.5 of 16). That number flatters the real state, because one defect (F-01 below) means a large share of the redesigned styling does not reach the screen at all.

Five findings stop release:

1. **F-01.** 87 of the 101 distinct custom-colour utility classes used in the TSX (for example `bg-surface`, `text-strong`, `bg-brand-mint`, `border-border-control`, `status-*`) are not generated in the built CSS, and `text-muted` (155 uses in 41 files) compiles to the *surface* tone, about 1.1:1 against white.
2. **F-02.** CAD MFA accepts any six digits and trusts a client-writable `sessionStorage` flag (D-30, still a Blocker, now worse than the report's stub).
3. **F-03.** The compliance Audit Trail shows "SHA-256 chain verified" with no data loaded and no verification performed.
4. **F-04.** Fail-open grade rendering: the side panel always shows "Grade C Overall", the shopper dashboard renders ungraded items as `C`, the checkout callout defaults to `B`, and the in-page badge paints grade E in green if the palette global is missing.
5. **F-05.** CAD destructive and credential flows are simulated in the browser (crypto-shredding, staff provisioning with a client-generated password, a `Math.random` link code), with no server call.

### 1.1 Master scorecard (six audit domains)

| Domain | Status | Conformance | Headline |
| --- | --- | --- | --- |
| 1 Build chain, architecture, security | Blocked | 37 % | MFA bypass; legacy all-in-one Vite config still present; classic JSX runtime; `env.ts` dead code; Popup eager gzip 41.7 KB vs 40 KB budget |
| 2 Token core, visual language, condition neutrality | Blocked | 44 % | Legacy `tokens.css` and `theme.css` override 45 generated tokens; most colour utilities unresolved; Inter Variable not applied |
| 3 No-truncation table contract | Needs remediation | about 60 % | `DataTable` is sound (no truncation, `aria-sort`, container queries); `kind` sizing unenforced; two raw tables remain |
| 4 Shopper surface, timelines, 3-month retention | Needs remediation | 50 % | Four timeframes and purge-on-open are right; no deltas; fabricated defaults; side panel not wired |
| 5 CAD and tiered alerts | Blocked | 55 % | Shell, routing and native dialogs landed; no data layer; false audit assurance |
| 6 In-page extension surfaces | Needs remediation | 72 % | Geometry and ARIA mostly right; Tab trap broken by Shadow DOM; emoji icons; custom badge redraw |

### 1.2 Before and after, quantitative

| Metric | Baseline (report) | Now | Note |
| --- | --- | --- | --- |
| Raw Tailwind palette utilities in TSX | 554 | **0** | Closed (regex over `src/ui/src`) |
| Sub-12 px text declarations | 37 | **0** | Closed in TSX, CSS and `shared-ui.js` (minimum is 12 px) |
| `truncate` / `text-ellipsis` / `line-clamp` | present | **0** | One code comment mentions "truncated" |
| Hex literals in non-test TS/TSX | not stated | **24** | `GradeBadge` 12, `Charts` 10, `nutriscore.ts` 1, `EmptyChart` 1; plus 83 six-digit hex in `shared-ui.js` |
| Custom-colour utilities that do not resolve | not measured | **87 of 101** in **40 of 62** TSX files | New finding F-01 |
| Generated tokens overridden by legacy CSS | not measured | **45 unique custom properties** | New finding F-06 |
| Axe violations, in-page flyout and badge (jsdom, contrast off) | n/a | **0** | Full-page axe not run (no browser) |
| Static a11y defects found by reading | n/a | **9** | Unassociated login labels, unlabelled search/palette inputs, Tab trap, focus theft, click-only breadcrumb, non-focusable scroll regions, no skip link, tab roles without keyboard pattern, unannounced pill |
| Touch-target candidates under 24 px | n/a | **at least 4** | Checkout callout dismiss (about 18 px), popup Pause/Resume text buttons (about 16 px high), palette close, breadcrumb root; not measured in a browser |
| `window.React` / `confirm` / `alert` | present | **0** | Closed |
| Supabase in eager payload | 69 KB gz shared chunk, about 91 % Supabase | **0 Supabase**; shared chunks 23.7 KB gz (10.6 + 13.1) | Closed by supersession |

**Eager gzip per page (JS plus CSS, static import graph) against the budgets in your prompt**

| Page | Measured | Budget | Result |
| --- | --- | --- | --- |
| Popup | 41.7 KB | 40 KB | **Fail by 1.7 KB** (and the real `src/shared` modules will add to it) |
| Side panel | 25.9 KB | 60 KB | Pass |
| Dashboard | 62.2 KB | 70 KB | Pass (stand-ins; real shared storage will add) |
| Options | 47.6 KB | none set | n/a |
| CAD | 63.6 KB | 110 KB | Pass |

Every page ships the same 71 KB (12.8 KB gz) stylesheet (D-23, open). No script enforces these budgets.

## 2. Verification matrix

Status key: **Closed** = verified closed; **Partial** = partially closed; **Open** = open or regressed. "Unverifiable" notes mark the part that sits outside the archive.

### 2.1 Report defects D-01 to D-44

| ID | Status | Evidence |
| --- | --- | --- |
| D-01 Token bypass | Partial | 0 raw palette utilities (was 554); `.cad-main` bridge removed. But the semantic replacements do not resolve (F-01) and 24 hex literals remain |
| D-02 Two dark palettes | Partial | The oklch `.dark` block is gone; one dark definition in `tokens.generated.css`. No toggle exists: nothing in the UI writes `data-mode` or a theme preference. `theme.css` still carries oklch `--chart-*`, `--sidebar-*`, `--ring` that are not dark-aware |
| D-03 Condition recolour | Partial | Surface and header recolour removed; `ConditionChip` is neutral. The popup still paints a condition-coloured pill through inline style from the `HEALTH_MODES` palette; diabetes `#D32F2F` on `#FFEBEE` is 4.36:1, under AA |
| D-04 Non-text contrast | Open | `--color-border-control` (3.81:1) exists, but `border-border-control` (157 uses) is not generated, so controls fall to the subtle border (about 1.3 to 1.5:1). `--input` resolves to `transparent` |
| D-05 Sub-12 px | Closed | 0 declarations. Caveat: 12 px is now the default body size on the shopper shell (`text-xs` root), not the floor |
| D-06 Dialog semantics | Partial | `CommandPalette`, `ConfirmDialog` and the invite dialog use native `<dialog>`. `ConsentDocModal` is still hand-rolled (`fixed inset-0 z-[100]`, no trap, no inert). Palette and `ConfirmDialog` unmount instead of calling `close()`, so focus return needs a browser check |
| D-07 `confirm` and `alert` | Partial | 0 `window.confirm/alert`. Typed confirmation exists, but the phrase is the fixed word `SHRED` (spec: the patient reference) and the action itself is simulated (F-05) |
| D-08 Sort headers | Closed | `DataTable`: `<button>` inside `<th aria-sort>`. The orphaned `Dashboard.tsx` still holds the old pattern |
| D-09 Navigation and double-active | Closed | `wouter` history routing; `active = currentTab === id`; super admin Overview and Platform are distinct. Items are buttons, not links (no open-in-new-tab) |
| D-10 Mock data shown as live | Open | `TenantOperationsView` (18 staff, 2, 97, 6, "74% used"), `DieticianInsightsView` (hard-coded 4-week series, "Improving", "130 mg lower"), `CommercialInsightsView` (76/68/82 %), `PlatformOverviewView` ("Stable", every tenant "Operational") are constants. No CAD view performs any fetch |
| D-11 Missing states | Open | No view passes `isLoading` to `DataTable` (`AuditLogView` tracks `loading` but only spins an icon); 0 error states; 0 pagination |
| D-12 Orphan and client suppression | Closed | `ClinicalOverview.tsx` is gone. Server-side small-cell suppression: Unverifiable |
| D-13 Shopper hierarchy | Partial | Hero KPI and visible charts; no condition header band. The hero is a KPI tile, not the specified ring; no swaps; adherence meters are hard-coded (F-12) |
| D-14 Imperative DOM | Closed | `dashboard.tsx` only mounts the root |
| D-15 Delete confirm or undo | Open | `handleDeleteItem` deletes immediately with a success toast and no Undo |
| D-16 Popup half-migrated | Partial | `popup.tsx` now opens `dashboard.html`; `Options.tsx:181` still navigates to `onboarding.html`; `popup.tsx` keeps premium logic (`CHECK_TIER`, `nutri_entitlement`, `sb-` key listener) |
| D-17 Theme boot mismatch | Open | Three sources: `theme-init.js` (`localStorage.nutriscore_theme_mode`), `ThemeContext` (`MultiLayerStorage.uiTheme`), `shared-ui.js` (`chrome.storage.theme_mode`). No UI code writes any of them |
| D-18 Legacy commerce | Partial | Wizard, subscription pages and hooks are gone. Residue: `decoyLegalDocs.ts` Basic/Premium copy, `savePremiumStatus`, `nutriscore_is_premium`, popup premium logic |
| D-19 Chart kit | Partial | 12 px labels, `role=img`, `<details>` data tables, keyboard donut. Still: tooltips are pointer-driven; `?? 0` coercion and `> 0` treated as "has data"; hex fallbacks (`#f9a825` at 1.97:1 on white for "Daily limit") |
| D-20 Token hygiene | Open | `--font-size: 16px` and oklch tokens remain in `theme.css`; `tokens.css` and `tokens.generated.css` are both imported (F-06) |
| D-21 CAD packaged in extension | Partial | Separate configs; CAD builds to `dist-ui/cad`; extension build has no CAD. But the extension outputs to `dist/extension` (not `dist-ui/extension`) and the legacy all-in-one `vite.config.ts` is still present and is the `dev` default |
| D-22 Supabase payload | Closed | No `@supabase` package or import; REST/OIDC shim in `services/storage.ts`. Closed by supersession |
| D-23 One stylesheet for all pages | Open | One 71 KB (13.2 KB gz) CSS entry for popup, side panel, dashboard, options and CAD |
| D-24 React/Preact split-brain | Open | `jsxRuntime: 'classic'`, `@vitejs/plugin-react` in all three configs, `@preact/preset-vite` installed but unused, `react`/`react-dom` peer dependencies, `import React` throughout |
| D-25 Dead dependencies | Partial | MUI, emotion, popper, motion, next-themes removed. Still unused: `@tanstack/react-table` (0 imports), `@preact/preset-vite` |
| D-26 `pnpm.overrides` | Open | Block still in `package.json`; npm resolved Vite 6.4.4 |
| D-27 Figma plugin | Closed | No Figma plugin in any config |
| D-28 `emptyOutDir` | Partial | Extension config `emptyOutDir: false`; legacy config still `true`; no `dist-ui/extension` |
| D-29 Env handling | Open | `env.ts` is imported nowhere. Production silently falls back to `https://localhost:8443/...`, so the `!env.apiUrl` check can never fire. `CLINICAL_RETENTION_YEARS` lacks the `VITE_` prefix. Endpoints are hard-coded in `AuthContext` and `storage.ts` |
| D-30 MFA stub | Open (Blocker) | See F-02 |
| D-31 Build target, chunks, CSS split | Open | No `build.target`, no `manualChunks`, no CSS split in any config |
| D-32 Component and a11y tests | Open | No jsdom, Testing Library, axe, `jsx-a11y` or Playwright in `devDependencies`. No rendered a11y, truncation, retention, delta, contrast or budget tests; `e2e-inpage-surfaces.test.ts` exists but only substring-matches source text (F-20). `primitives.test.ts` only asserts `typeof === 'function'` |
| D-33 `window.React` and boot script | Closed | No `window.React`; `theme-init.js` in `<head>` with a relative path in the extension build |
| D-34 `prepare` hook | Open | `git config core.hooksPath .githooks` unchanged |
| D-35 Shopper colour systems | Partial | Condition no longer repaints surfaces and the zero state is not alarm-styled; but status colours do not resolve (F-01) |
| D-36 Trend chart | Partial | 12 px "Daily limit" and a `hasData` flag exist; still `sodiumMg ?? 0`, leading buckets sliced away, and a "% Daily Value" axis under an "Average intake" caption |
| D-37 Grade badges | Partial | `GradeBadge` null renders `—` / "Product Unscored"; but `ShopperShell` defaults `gradeSnapshot \|\| 'C'` (recent list and history table) and the side panel is fixed at `C` (F-04) |
| D-38 Metrics | Partial | `status !== 'removed'` excluded; empty set gives `null` average. Still undefined: `purchased` vs `in_cart`; heads-up counter can double-count one item across conditions |
| D-39 Popup | Partial | The "N" tile uses the brand token, not Grade-A green. Condition pill still coloured inline; Pause/Resume text buttons about 16 px high |
| D-40 CAD banner | Partial | Page-static banner replaced by a role-scoped `Banner`, but with static "operating normally" copy for super admin, auditor and commercial on every page; the Tier 3 MFA banner is unreachable because `MfaChallenge` renders first |
| D-41 Tenant select and top bar | Partial | `Combobox` replaces `<select>`, but `availableTenants` is always `[]`; email still hidden below `lg`; no user menu |
| D-42 Health Modes at 1024 px | Partial | Editor uses `≤` / `≥`; the two-pane layout could not be render-verified |
| D-43 Options page | Partial | Tokenised (0 palette utilities) but still a separate legacy page, with the `onboarding.html` redirect and `BlueThemeProvider` (`data-theme="blue"` matches no CSS) |
| D-44 Fabricated fallbacks | Closed | Demo staff, tenants and audit rows removed (literal wording). Adjacent fabricated states are findings F-03 and F-05 |

### 2.2 Extension Facelift, EXT-01 to EXT-16 (defects from the Facelift report)

| ID | Legacy defect (Facelift report) | Status | Evidence in the uploaded `shared-ui.js` |
| --- | --- | --- | --- |
| EXT-01 | Hard-coded slate portal tokens (`--ns-surface:#fff`, `--ns-text:#0f172a`, `--ns-focus:#2563eb`, radius 10 px), decoupled from DTCG | Partial | Values now follow the Navy/Mint palette (`--ns-text-strong #073A4B`, `--ns-radius-card 16px`, `--ns-focus #0B6E91`, a dark set). But they are hand-typed in a JS template (lines 137 to 199), not generated: the portal uses an inline `<style>` and does not consume `portal-tokens.css` (only the badge shadow root uses `adoptedStyleSheets`). 83 six-digit hex literals remain and nothing guards drift. Focus differs from the spec's `#108ab1` but is the better value (5.75:1 vs 3.97:1) |
| EXT-02 | Dark mode forced by the host page's `html.dark` | Closed (in file) | `classList.contains('dark')` is gone; the portal sets `data-theme` only from `chrome.storage` (`theme_mode`, `settings_live`) and updates live. Residual: nothing in the UI tree writes `theme_mode`, so users cannot switch it on (D-17). The report names `uiTheme`, but in this codebase `uiTheme` carries the health-condition theme |
| EXT-03 | Custom-drawn pill violates the official Nutri-Score charter | Open | The badge still draws its own A to E scale from `.ns-scale-module` / `.ns-scale-box` spans (14 x 18 px boxes, 0.75 opacity, own radii and colours); no official SVG. The in-repo gate calls this "official" (F-20) |
| EXT-04 | Identical grey fallback for `insufficient_data` and `not_attempted`; 4.08:1 | Closed | Two distinct chips: "Limited Info" (white, `#073A4B`, 12.24:1, 1 px border) and "Not Rated" (`#EAF1F4`, `#46636F`, 5.61:1). Labels match the Facelift wireframe |
| EXT-05 | Sub-24 px badge target (about 19 x 26 px) | Closed | `.badge-trigger` has `min-height` and `min-width` of 32 px; visual module 28 px |
| EXT-06 | Close button 18 x 18 px | Closed | `min-width` and `min-height` 32 px, `padding: 6px`, `aria-label="Close details"` |
| EXT-07 | Flyout destroyed on any scroll | Closed | Passive capture-phase listener repositions, and closes only when the trigger leaves the viewport (as the spec's snippet does). Minor: the spec's comment mentions `requestAnimationFrame`, but neither the spec code nor the file uses it |
| EXT-08 | `role="dialog"` and `aria-modal` with no Tab trap; focus dropped on close | Partial | Focus entry (rAF), `aria-expanded`, Esc and close-button focus return work. The Tab trap exists but never fires: it compares `document.activeElement` (the shadow host) with controls inside the shadow root (reproduced in jsdom). `aria-modal="true"` remains though the page is not inert, and an outside click pulls focus off the control the user clicked (F-08) |
| EXT-09 | Full-bleed grade-coloured flyout header | Closed | The header sits on `--ns-surface`; grade appears only in the badge |
| EXT-10 | 17 sub-12 px font declarations | Closed | Only 12, 14, 18 and 20 px remain (18 x 12 px, 3 x 14 px, 1 x 18 px, 1 x 20 px) |
| EXT-11 | Condition-palette warning text with clinical copy | Partial | Container and text use the Tier 1 `--ns-status-advisory-*` tokens (the colours the spec prescribes). Copy is still engine-supplied: a bold `chipPrefix` line plus the raw condition string, then an italic "Informational only, not medical advice." The spec's plain-language title and limit line are not implemented; the engine strings are outside the archive, so the wording is Unverifiable. The condition palette object `tc` is computed but used only as a truthiness flag |
| EXT-12 | Emoji confidence encoding | Open | `confLabel` still returns four glyphs (information sign, bar chart, clipboard, warning sign). The SVG icon plus text mapping in the report's section 3.5 is not implemented |
| EXT-13 | 240 px flyout | Closed | `width: 288px` |
| EXT-14 | Dead `[data-ns-upgrade]` and `OPEN_UPGRADE` hooks | Partial | Zero references in `shared-ui.js`. The `background.js` listener is outside the archive: Unverifiable |
| EXT-15 | Header comment claims removed functions | Closed | The header now describes badge injection, flyout and portal stacking; `findHealthierAlternatives` and `.ns-qty` are gone |
| EXT-16 | No in-page paused, sync or checkout indicators | Partial | The paused pill and the checkout callout exist, with Resume and a side-panel button. Gaps: no catalog-sync-degraded indicator; the callout has no per-item alert count (spec: "1 item exceeds your prescribed sodium limit"), defaults the grade to `B` (F-04), has a dismiss target of about 18 px and no role or `aria-live`; Resume and the CTA buttons put white on `--ns-brand`, which is 1.87:1 in dark mode (F-15). Wiring in `content.js` and `background.js`: Unverifiable |

## 3. Detailed findings, root causes and fixes

Severity: **P0** blocks release (security, compliance, safety-adjacent or unusable UI); **P1** must close before a pilot; **P2** close before general availability. Evidence cites files under `src/ui/src` unless stated.

### 3.1 P0, blockers

#### F-01. Most colour utilities never reach the screen, and `text-muted` is nearly invisible

- **Spec reference:** D-01, D-04, D-35; Domain 2 "Zero Token Bypass"; report 4.2.
- **Evidence.** PostCSS over the built stylesheet (`dist/extension/assets/index-*.css`) against the class tokens in 62 TSX files: 101 distinct custom-colour utilities are used and **87 have no matching rule**, in 40 of 62 files. Highest-impact misses by use: `border-border-control` (157), `bg-surface` (156), `bg-brand-mint` (31), `text-brand-navy` (26), 190 uses of `status-*` (`bg-status-success-subtle`, `text-status-critical`, `bg-status-error`...), `ring-focus`, `bg-canvas`. Separately, `.text-muted` compiles to `color: var(--muted)`, and `--muted` is `var(--color-surface-muted)`, so every `text-muted` (155 uses, 41 files) is the surface tone: **1.10:1 on a white card, 1.05:1 on the canvas; in dark mode 1.43:1.** The jsdom/axe run cannot see this (it does not compute contrast), and no test in the repo can either.
- **Root cause.** Tailwind v4 generates colour utilities only for `--color-*` variables declared inside `@theme`. `tokens.generated.css` declares its semantic colours as plain `:root` variables, and the only `@theme inline` block (`theme.css`) registers the shadcn names. The old `.cad-main` bridge was deleted under D-01 without adding its replacement. The shadcn mapping also makes `text-muted` and `bg-muted` share one variable (`--color-muted`), so a muted-text meaning cannot coexist with the surface meaning.
- **Fix.**
  1. Have `build-tokens.mjs` emit `tokens.theme.css` containing an `@theme inline` block whose keys are the utility names and whose values point at runtime variables. Because a key cannot reference a runtime variable of the same name, rename the runtime variables to a `--sem-*` prefix in the generator and keep thin `--color-*` aliases for the CSS that already uses them. Keys needed: `canvas`, `surface`, `surface-raised`, `surface-muted`, `border-subtle`, `border-control`, `strong`, `text`, `muted-foreground`, `brand`, `brand-hover`, `brand-subtle`, `on-brand`, `critical`, `warning`, `success`, `info`, `pending` (each with `-subtle`), `focus`, `grade-a` to `grade-e` and `on-grade-a` to `on-grade-e`.
  2. Codemod the call sites (all mechanical): `bg-brand-mint` to `bg-brand`; `text-brand-navy` to `text-on-brand` where it sits on a brand fill, else `text-strong`; `text-brand-mint` to `text-brand`; `status-error` and `status-critical` to `critical`; `status-success|warning|info` to `success|warning|info`; `border-border-control` to `border-control`; `text-muted` (not followed by a hyphen, including `hover:` variants) to `text-muted-foreground`; `bg-ns-grade-*` to `bg-grade-*`.
  3. Add `scripts/check-utilities.mjs` to CI: build the CSS, parse selectors, extract class tokens from TSX, fail on any colour utility without a rule. (The probe I used is a 40-line Node script; I can hand it over as the starting point.)
- **Verification.** The probe reports 0 unresolved utilities; computed `text-muted-foreground` on `canvas` and on `surface` is at least 4.5:1 in light and dark; `bg-brand` primary buttons render a fill in a Chromium screenshot of Popup, Dashboard and CAD login.

#### F-02. CAD MFA is bypassable (D-30, still a Blocker, now regressed)

- **Spec reference:** D-30, Domain 1 security. The Supabase wording no longer applies; the intent is real second-factor assurance derived from the token, surviving refresh.
- **Evidence (`cad/context/AuthContext.tsx`).**
  - `verifyMfa(code)` returns `true` for any six digits (`/^\d{6}$/`) and writes `sessionStorage.cad_mfa_verified = 'true'`. No call is made to the identity provider.
  - `initAuth` sets `mfaVerified` from `acr === 'aal2' || acr === '2' || storedMfaVerified || role === 'patient'`. `storedMfaVerified` is a client-writable flag, so `sessionStorage.setItem('cad_mfa_verified','true')` followed by a refresh skips MFA for any role.
  - `initAuth` never checks the stored token's `exp`, so an expired token is accepted; `cad_refresh_token` is stored and never used.
  - `signIn` uses the password grant (`grant_type=password`) with the client id `cad-web-ui`. That grant cannot carry a TOTP step, which is why the local stub exists.
  - The header comment says the stub was "replaced with error throw" (Stage B); the code does not do that.
  - `defaultClaims.role = 'patient'` makes an unauthenticated state look like a patient with `mfaVerified`-style behaviour; `Navigation` shows "MFA verified" to any patient.
- **Root cause.** Stage C OIDC work was stubbed in place, and the stub became the shipped path.
- **Fix.**
  1. Replace the password grant with authorization-code + PKCE against Keycloak; require step-up with `acr_values` for staff roles (Keycloak conditional OTP flow).
  2. Delete `verifyMfa`'s local success path and the `cad_mfa_verified` flag entirely. Derive assurance only from the verified access-token claim:

```ts
const claims = parseJwt(token)
const notExpired = claims.exp * 1000 > Date.now()
const aal2 = notExpired && (claims.acr === 'aal2' || claims.amr?.includes('otp'))
setMfaVerified(aal2)          // no sessionStorage input, no role shortcut
```

3. Hold tokens in memory (refresh by the code flow's refresh token or silent renew), not `sessionStorage`. Treat the client check as UX only: the API must reject staff-scoped calls whose token lacks the required `acr`.
4. Make the unauthenticated default `role: null`, not `'patient'`.

- **Verification.** Vitest: forged `cad_mfa_verified=true` with a token lacking `acr` still shows `MfaChallenge`; `123456` and `abcdef` never succeed; an expired token is discarded; a staff token with `acr=aal2` passes with no extra prompt; the "MFA verified" chip only appears from the claim.

#### F-03. The Audit Trail asserts a verification that never ran

- **Spec reference:** D-44, D-11; Domain 5 "Real Data and Complete States".
- **Evidence (`cad/views/AuditLogView.tsx`).** `loadAuditLogs` does `setLogs([])` and `setChainValid(true)` with no request; the `catch` also sets `chainValid(true)`; `verifyHashChain` is defined and never called; `chainValid` initialises to `true`. The header therefore always shows the success badge "SHA-256 chain verified" and "Append-only", including with zero rows, on error, and before load. Retention ("20 years under DPA s.46 / HIM Reg 24") is hard-coded instead of coming from `env.clinicalRetentionYears`. The loading state is not passed to the table.
- **Root cause.** Demo rows were removed (D-44) but the assurance badge was left initialised to the good state.
- **Fix.** Make verification tri-state and earn the green:

```tsx
type Chain = 'unknown' | 'verified' | 'broken'
const [chain, setChain] = useState<Chain>('unknown')
// after a successful fetch with rows.length > 0:
setChain(await verifyChain(rows))   // SHA-256 (crypto.subtle) over canonical row bytes + prev_hash, or server /audit/verify
// empty: 'No records to verify'; error: Tier 2 banner with Retry; never default to verified
```

Pass `isLoading={loading}` to `DataTable`; read the retention figure from config and keep the legal citation as copy that legal can change.

- **Verification.** Tests for: empty set shows "Not verified"; fetch error shows an error state, not a badge; a tampered `prev_hash` shows "Chain break detected"; a green badge requires at least one verified row.

#### F-04. Fail-open grade rendering

Four places show a grade the data does not support.

| Where | Evidence | Fix |
| --- | --- | --- |
| Side panel (`sidepanel.tsx`) | `basketGrade` initial state is `'C'` and is never updated; `items` is `[]` and never filled; Refresh sets `loading` true and never clears it. The panel always reads "Grade C Overall" | Drive from real basket data (content script to service worker to `chrome.storage.session`, panel subscribes); until data exists, show a skeleton, never a grade |
| Shopper dashboard (`ShopperShell.tsx`) | Recent purchases `GradeBadge grade={item.gradeSnapshot \|\| 'C'}` and the history table accessor `gradeSnapshot \|\| 'C'` render ungraded items as `C` (the D-37/D-38 pattern) | Pass `null`; `GradeBadge` already renders `—` / "Product Unscored"; add a visible "Not rated" chip |
| Checkout callout (`shared-ui.js`) | `averageGrade \|\| 'B'` (reproduced in jsdom with `itemCount: 4` and no grade: the callout says "average Nutri-Score of B") | Omit the grade sentence when no grade is supplied |
| In-page badge (`shared-ui.js`) | If `window.NutriScoreGradeColors` is absent, `gradeColors` is only `{C: ...}` and `gInfo = gradeColors[g] \|\| {bg:'#85bb2f'}`: reproduced, grade E is drawn **lime green** | Fail closed: if the palette global is missing, render the neutral "Not rated" chip and log the ordering error |

- **Root cause.** Defaults were written for "never blank" instead of "never wrong". A health-grade UI must prefer an honest empty state.
- **Verification.** Unit tests per site; a lint rule or CI grep that fails on `\|\| 'A'|'B'|'C'|'D'|'E'` fallbacks in TSX and `shared-ui.js`.

#### F-05. CAD destructive and credential flows are simulated client-side

- **Spec reference:** D-07, D-10; Domain 5; DPA s.40 erasure.
- **Evidence.** `PatientLinkingConsentView`: `executeCryptoShred` builds `SHREDDED-xxxx-<Math.random>` locally and sets the message "crypto-shredded ... Audit hash chain verified" with no request; the link code is `NS-` plus `Math.random()` digits, held only in component state, so no patient can redeem it, and `Math.random` is not a secure source. `UserManagementView.handleInvite` creates the member in local state with `licence_verified: true` and shows a client-generated password (`Nutri####!2026`). `BillingSubscriptionView` carries a comment "Demo active subscription state for visualization". `toggleVerifyLicence` and `handleStatusChange` only mutate local state.
- **Root cause.** The data layer (Stage C `CadApi`) does not exist, and the views were left with optimistic local success paths.
- **Fix.** Implement `CadApi` per resource and make success depend on the server: link codes and shred operations issued by the API (CSPRNG on the server, returning an audit event id); staff provisioning through a Keycloak invitation or required-action flow with no password ever generated in the browser; licence verification must never default to `true`. Until the API exists, disable the actions with an honest "Not connected" state instead of simulating success. Typed confirmation should require the patient reference, as the report specifies, not a fixed word.
- **Verification.** Contract tests with a mocked API: UI shows success only after a 2xx; a failed shred leaves the record unchanged and says so.

### 3.2 P1, high

#### F-06. Legacy token files override the new palette; Inter Variable is not applied

- **Evidence.** `index.css` imports `tokens.generated.css`, then the legacy `tokens.css`, then `health-modes.generated.css`, then `theme.css`. Same selector, later wins: in the built CSS **45 generated properties are overridden** by the old slate/teal values, for example `--color-canvas #F5F9FA` to `#f8fafc`, `--color-brand #04785A` to `#0f766e`, `--color-critical #9F1239` to `#b91c1c`, `--focus-ring #0B6E91` to `#1d4ed8`, `--rail-width`, `--header-height`, `--text-page`, `--leading-body`. `theme.css` then sets `--input: transparent` and `--ring: oklch(70.8% 0 0)` over the intended border-control and focus tokens, and `--font-size: 16px`. `--font-sans` ends as `Inter, ui-sans-serif, ...` (from `tokens.css`), so the bundled Inter Variable (about 219 KB of woff2 shipped to every build) is **not applied**: the family name registered by `@fontsource-variable/inter` is "Inter Variable". Ten status tokens (`--color-info-text`, `--color-critical-border`, `--color-brand-border`, and the other `*-border` / `*-text` tokens) exist only for light mode, so dark mode inherits light values for `.ui-status-*` and `.cad-health-banner-*`.
- **Root cause.** The old files were left in the import chain when the generated file was added.
- **Fix.** Delete `tokens.css` and the oklch/`--input`/`--ring`/`--font-size` lines in `theme.css`; make the generator the only writer of `:root` colour, type and spacing tokens, emitted for both modes (or drop the unused `*-border`/`*-text` tokens); make `--font-sans` lead with `"Inter Variable"`. Delete `health-modes.generated.css` if chips become neutral (see F-14).
- **Verification.** `check-tokens` fails if any custom property is declared twice in `:root` with different values; computed `font-family` on `body` starts with Inter Variable; dark-mode contrast table for all status pairs at least 4.5:1.

#### F-07. Role homes and banners still present constants as live (D-10, D-40)

- **Evidence.** Static figures in `TenantOperationsView`, `DieticianInsightsView`, `CommercialInsightsView`, `PlatformOverviewView`, `PatientCareSummaryView` ("Care profile: Active", "Data sharing: In control" with no consent lookup); `SystemHealthBanner` states "operating normally" and a k-anonymity threshold (`k >= 50`) as fact on every page, ignoring tenant `small_cell_k`. The Clinician home shows "No active alerts" styled as a critical alert (the D-35 pattern, now in CAD).
- **Fix.** Replace constants with `CadApi` queries behind uniform loading, empty and error states; where no query exists yet, render "—" plus a Tier 0 "Not connected" notice. Remove the static banner copy; raise a banner only for a real, role-relevant exception. Style zero states neutrally.
- **Verification.** A CI scan that fails on numeric literals inside `MetricCard value=` and on any `const [A-Z_]+: .*\[\{` fixtures under `cad/views`.

#### F-08. In-page flyout: Tab trap broken by Shadow DOM, focus theft, host DOM mutation

- **Spec reference:** EXT-07, EXT-08; Domain 6.
- **Evidence (reproduced in jsdom; confirm in Chromium).**
  - The Tab trap compares `document.activeElement` with the first and last control. The flyout lives in a shadow root, so `document.activeElement` is the shadow host (`nutriscore-global-portal-host`); the comparison never matches, `preventDefault` is never called (verified), and Tab leaves the dialog.
  - `_closeActiveFlyout()` always calls `trigger.focus()`. The outside-click path therefore pulls focus off the control the user just clicked (verified: a text input lost focus to the badge). The viewport-exit and theme-change paths do the same.
  - `card.style.position = 'relative'; card.style.overflow = 'visible'` rewrites the retailer's own card styles (verified: `static`/`hidden` became `relative`/`visible`), which can break host layouts.
  - `aria-modal="true"` is declared on a flyout that does not make the page inert and closes on outside click.
- **Root cause.** Shadow DOM retargeting was not accounted for; one close function serves every dismissal path.
- **Fix.**

```js
// Tab trap: use the shadow root's activeElement
const active = flyoutEl.getRootNode().activeElement
if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }

// Restore focus only for Esc and the close button
_closeActiveFlyout({ restoreFocus = false } = {}) { /* ... */ if (restoreFocus) trigger.focus({ preventScroll: true }) }

// Scroll: rAF-throttled
let raf = 0
window._nutriscoreScrollHandler = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; /* reposition or close */ }) }
```

Remove `aria-modal` (or make the page inert); anchor the badge without rewriting `overflow`, and set `position: relative` only when the computed position is `static`.

- **Verification.** Playwright: Tab and Shift+Tab cycle inside the flyout; clicking a page input keeps focus on that input; Esc returns focus to the badge; the host card's inline styles are unchanged after injection.

#### F-09. Nutri-Score graphics are redrawn, and two grade pairs fail contrast

- **Spec reference:** EXT-03 (the distinct no-data chips of EXT-04 are fine), report Decision 3 (official modules, unaltered).
- **Evidence.** The badge draws its own A–E scale from HTML spans (14 x 18 px boxes, 0.75 opacity, own radii). `GradeBadge.tsx` hard-codes `GRADE_DATA` hex with white text on B (`#85bb2f`, **2.30:1**) and on D (`#ee8100`, **2.70:1**); the side panel puts `text-white` on grade C (`#fecb02`, **1.53:1**). The tokens already define compliant on-colours (`--ns-on-grade-b #14320a` 6.14:1, `--ns-on-grade-d #331c00` 5.95:1), and `globals.css` still declares Grade A as `#037b3e` while the generated file uses `#038141`. White on E (`#e63e11`) is 4.15:1, which passes only as large text.
- **Fix.** Render the official asset pack unaltered as inline SVG (the report's release gate fails the build if the pack is absent); until it is registered, keep the redraw behind a clearly named fallback and never claim "Official" in file headers. `GradeBadge` must read `var(--grade-x)` and `var(--on-grade-x)` tokens, not literals. Delete the duplicate grade block in `globals.css`.
- **Verification.** Snapshot test that the badge DOM contains the unmodified SVG; contrast test over every grade/on-colour pair.

#### F-10. Build chain and runtime hygiene (D-21 to D-34)

- **Evidence.** All three configs use `@vitejs/plugin-react` with `jsxRuntime: 'classic'`; `@preact/preset-vite` is installed and unused (D-24). Legacy `vite.config.ts` still bundles everything to `dist/extension` with `emptyOutDir: true` and is the default `npm run dev`. The extension builds to `dist/extension`, not `dist-ui/extension`. No `build.target`, no `manualChunks`, no per-surface CSS. `pnpm.overrides` remains; `prepare` still rewrites git config. `env.ts` is never imported (D-29), so production silently targets `https://localhost:8443`. Popup is 1.7 KB over its eager budget before the real shared modules are added.
- **Fix.** (1) Delete `vite.config.ts`; move `cadDevRoutingPlugin` into `vite.cad.config.ts`; point `dev` at it. (2) Use `@preact/preset-vite` in every config; remove `@vitejs/plugin-react`, the React peers and `import React` lines (codemod), and set `jsxImportSource: "preact"` in `tsconfig.json`. (3) Set extension `outDir: '../../dist-ui/extension'` and update `build-ext.mjs` to copy from it. (4) Add `build.target` (confirm your minimum Chrome), a vendor chunk, and one CSS entry per surface with its own `@source`. (5) Remove the `pnpm` block and `@tanstack/react-table` (or adopt it); guard `prepare` with `CI`. (6) Import `env.ts` in every entry; validate at build with a small Vite plugin and fail production builds when `VITE_API_URL` or `VITE_OIDC_ISSUER` is missing; delete the `localhost` fallbacks outside `isDev`; use a `VITE_` name or drop the client-side `CLINICAL_RETENTION_YEARS`. (7) Add `check:budget` (the eager-gzip script I used is about 30 lines) with Popup 40, Side panel 60, Dashboard 70, CAD 110 KB.
- **Verification.** `npm ls @vitejs/plugin-react` empty; `build:ui` leaves `dist/` untouched; CI fails the budget and missing-env cases.

#### F-11. Quality gates cannot catch any of the above (D-32)

- **Evidence.** No jsdom/happy-dom, Testing Library, axe, `eslint-plugin-jsx-a11y` or Playwright dependency; `primitives.test.ts` asserts only that components are functions; there are no retention-boundary, delta-eligibility, truncation, contrast, utility-coverage or budget tests; `npm run ci` runs none of them. 33 of 46 existing test files assert on files outside the UI tree (extension, scripts, manifest), which is fine in the full repo but means the UI itself has 13 runnable files, of which three (timeframes, shell navigation, primitives) touch UI code.
- **Fix.** Add the dependencies and scripts listed in 4.1 below, convert `primitives.test.ts` to render and assert behaviour, add `fake-indexeddb` tests for `purgeLedgerOlderThan` at the cutoff boundary, and wire every new script into `npm run ci`.

#### F-12. Shopper dashboard: metric integrity and honesty (D-36 to D-38, Domain 4)

| Defect | Evidence | Fix |
| --- | --- | --- |
| KPI mislabel | The "Nutri-Score A/B" KPI shows `goodCount`, which sums A, B **and C** | Compute A+B, or relabel "Rated A–C" |
| Hard-coded limits | Adherence meters and the Care plan use fixed 600 mg, 10 g, 5 g (`sod <= 600`, `sug <= 10`, `sat <= 5`); the report uses 22.5 g for sugar; they are not the clinician's targets | Read the active targets from the stored profile; Care plan shows what the clinician set, or "No targets assigned" |
| Empty equals 100 % | `totalWithData > 0 ? ... : 100` makes no-data look like perfect adherence | Show "No data"; copy "41 of 52 items within your limit" |
| No deltas | `getTimeframe().previous` is computed and never used; no KPI shows a delta | Implement eligibility: previous window inside retention and at least 3 items; on `3 months` show trend direction only |
| Timeframe | Default is `month`, not persisted | Default `week`; persist `ns.prefs.timeframe` |
| Legacy range code | `resolveTimeframe` (rolling 7 days; `setMonth(-1)`, which overflows on the 31st) and `bucketCount` still exist; `ShopperShell` passes `bucketCount` 30 for every day bucket | Delete both; feed `calculateAnalytics` from `Timeframe` |
| Read path | `getAllEntries()` loads the whole ledger; `getEntriesSince(start)` is unused | Read through the index for the selected window |
| Retention scope | Purge-on-open is correct and ordered before the first read (boundary is exclusive, one cursor transaction). It covers `shopping_ledger` only; `pending_cart_syncs` is not purged here. The `ledger-retention` alarm and startup trigger are outside the archive | Purge all three stores; confirm the alarm and install/startup triggers in `background.js` |
| Static assertions | Privacy page: "Retention Status: Active (Purging daily)"; Care plan: "OIDC Tenant ID: verified"; clinic falls back to the invented name "Primary Care Clinical Unit" | Show real state or "Unknown"; never a made-up clinic |
| Copy | "90-day" and "3-month" are used interchangeably (Aug 10 to Nov 10 is 92 days); the 3-month tab lacks the "older history is removed automatically" line | Use the report's copy |
| Over-read of storage | `chrome.storage.local.get(null)` pulls every key, including session material, into React state | Request only `tenant_name` and `user_account` |
| Delete | No Undo (D-15) | Five-second Undo toast, then commit |
| Charts | Null coerced to 0 upstream; trend caption "Average intake" with a "% Daily Value" axis (purchases are not intake); leading empty buckets sliced away | Keep `null` as a gap; caption "Average sodium per 100 g of items chosen"; keep all buckets |

### 3.3 Remaining P1 and P2 findings

Each heading carries its own severity.

#### F-13 (P1). The REST shim cannot reach the API from extension pages and hides failures

- **Evidence (`services/storage.ts`).** `PostgrestQueryBuilder` defaults to the relative base `/rest/v1`. From `dashboard.html` or `popup.html` that resolves against the `chrome-extension://<id>` origin, not the API. Requests carry only `Accept` and `Content-Type`; no `Authorization` header is ever set. `maybeSingle()` returns `{data: null, error: null}` on any non-OK response or exception, so `checkEnrollmentAndProfile` in `dashboard.tsx` sees no consent row and lands in `consent_required` regardless of the real state. `supabase.rpc` returns a success-shaped `{data: null, error: null}`; `onAuthStateChange` never fires. `env.apiUrl` exists and is not used.
- **Root cause.** The compatibility shim was kept under its old `supabase` name while the transport was replaced, and its error handling was written for "no row", not "request failed".
- **Fix.** Build the base URL from `env.apiUrl`, attach the bearer token, return real errors (distinguish 404/406 "no row" from network and 5xx), rename the shim to `api`, and give the dashboard an explicit "cannot reach clinic service" state. Add host permissions or CORS as the manifest requires (outside the archive).
- **Verification.** Contract test with a mocked server: 200 with a consent row reaches `active`; 5xx or offline shows the offline state, not `consent_required`.

#### F-14 (P2). Popup and condition chips (D-03, D-16, D-39)

- **Evidence.** `Popup.tsx` initialises `isPaused` to `false` and never reads `paused_<host>`, so reopening the popup on a paused store shows "Monitoring". `popup.tsx` never passes `basketGrade`, so the spec's live basket grade cannot render (only "N items graded"). The "Health Mode" row wraps `ConditionChip` in a pill whose background and text come from the `HEALTH_MODES` palette via inline style (diabetes red on pink 4.36:1). `popup.tsx` still contains `CHECK_TIER`, `nutri_entitlement`, `is_premium` and an `sb-` key listener. Pause/Resume are text buttons about 16 px high with no padding.
- **Fix.** Read `paused_<host>` (and its expiry) on mount; pass the basket grade from the page-stats response, or show "Not yet rated"; render the chip neutral (surface-muted plus icon) and delete `health-modes.generated.css`; remove the premium and `sb-` logic; give Pause/Resume at least 24 px height.

#### F-15 (P2). `shared-ui.js` residue

- **EXT-12.** Replace the four emoji/glyph provenance labels with inline SVG icons plus text (they also read badly in screen readers).
- **EXT-16.** Give the pill `role="status"` and the callout `role="dialog"` or `status` with a label; raise the callout dismiss to at least 24 x 24 px.
- **Dark mode.** `data-ns-open-sidepanel`, the pill's Resume and the callout button all set `color:#ffffff` on `var(--ns-brand)`, which is mint `#06D7A0` in dark mode (1.87:1). Add `--ns-on-brand` to the portal tokens (`#04222D` in dark) and use it.
- **EXT-01.** Load portal variables from the generated `portal-tokens.css` instead of a hand-copied template string; the badge shadow root cannot see `--ns-*` at all, which is why its 83 hex values are inline and never theme.
- **Fonts.** The flyout names "Inter Variable" but no `@font-face` is injected in the content world; add it via `web_accessible_resources`.
- **Hardening.** `grade` (header) and `r.unit` (plausible-field rows) are interpolated into `innerHTML` without `escapeHTML`; escape them. `chrome.runtime.sendMessage(...).catch` throws synchronously when the extension context is invalidated; wrap in try/catch.
- **EXT-11.** The advisory tint matches the Facelift's Tier 1 tokens, so keep the container; replace the engine-supplied title (`chipPrefix` plus the raw condition string) with the plain-language title and limit line the spec shows, for example "Higher in sodium than your care plan suggests" and the clinician's limit.

#### F-16 (P2). `DataTable` and raw tables (Domain 3)

- **Evidence.** `DataTable` has no truncation, a `<button>` in `<th aria-sort>`, container-query priority columns and card fallback: this part is sound. Gaps: `kind` is declared but only `number` and `actions` change styling, so ids, hashes and emails get no `overflow-wrap:anywhere` or width rule; the `overflow-x-auto` wrapper is not focusable or labelled (axe `scrollable-region-focusable`); the search field has only a placeholder; the expand button's `aria-label` embeds the raw row key (often a UUID); the card view re-renders every column instead of delegating to `RecordList`, which has a different API; `BillingSubscriptionView` and `PlatformOverviewView` use raw `<table class="ui-table">` and the latter sits inside an `overflow-hidden` card; the orphaned `Dashboard.tsx` still has a `whitespace-nowrap` ledger.
- **Fix.** Drive column sizing from `kind` (text flexible and second, id/hash wrapping, number tabular and right-aligned); make the scroller `tabIndex={0}` with `role="region"` and a label; label the search input; use a human label for the expand button; migrate the two raw tables.
- **Verification.** Playwright no-truncation suite (see 4.2).

#### F-17 (P2). CAD shell and dialogs (Domain 5, D-06, D-09, D-41)

- **Login form.** `<label>` elements for email and password have no `htmlFor`/`id` pairing (axe `label`).
- **Navigation.** The breadcrumb root is a click-only `<span>` (not keyboard operable); last crumb lacks `aria-current="page"`; there is no skip link; nav items are buttons, so deep links cannot open in a new tab. There is no user menu (role, assurance, density, theme, sign-out) and email is hidden below `lg`. The rail has collapsible groups but does not collapse to icons below 1200 px; `settings` sits under Govern while the spec puts it under Administer.
- **Tier 3.** `Banner` tier 3 is `role="alert"`, not the blocking `alertdialog` with reason capture and rate caps.
- **Dialogs.** `CommandPaletteModal` and `ConfirmDialog` unmount instead of calling `close()`, so focus return needs a browser check; the palette input has no accessible name and no listbox semantics; `ConfirmDialog` calls both `onClose` and `onCancel`; `ConsentDocModal` is hand-rolled.
- **Tenant switch.** `switchTenant` rewrites `claims.tenantId` in client state; the active tenant must come from the server or the token, with the UI only requesting the switch.
- **Fix.** Pair labels, make breadcrumbs links, add a skip link and `ClinicalShell` user menu, render tier 3 as `<dialog role="alertdialog">`, call `close()` before unmount and restore focus to the opener, convert `ConsentDocModal` to the native dialog primitive.

#### F-18 (P2). Shopper shell semantics and routing

- **Evidence.** The timeframe control uses `role="tablist"`/`role="tab"` with no roving tabindex, arrow-key handling or tab panel; destination buttons set no `aria-current`; navigation is `useState`, not `wouter` with `useHashLocation`, so Back and deep links do not work; the page `<h1>` is 14 px and the shell root is `text-xs`, so the shopper surface renders body copy at the 12 px floor instead of the specified 16 px; loading is a lone spinner; the brand hairline is 4 px (`h-1`), not 3 px.
- **Fix.** Use a real segmented control or complete the tab pattern; add `aria-current`; adopt hash routing for the four destinations; set the shopper body size to 1 rem and the page title to the specified scale.

#### F-19 (P2). Dead code and legacy residue (D-12, D-18, D-25, D-43)

- `src/ui/src/app/components/Dashboard.tsx` (812 lines) is imported nowhere and absent from the bundle graph, but still on disk: unreferenced is not deleted. Delete it, along with `tokens.css`, `BlueThemeProvider` and `[data-shell-theme]`, `@tanstack/react-table` (unless adopted), `decoyLegalDocs.ts` Basic/Premium copy, `savePremiumStatus` and `nutriscore_is_premium`.
- `Options.tsx` still ends at `onboarding.html`, a page that no longer exists. Fold Options into the Care plan and Privacy destinations, or fix the redirect.
- Charts: replace hex fallbacks (`#fff` strokes, `#f9a825` "Daily limit" at 1.97:1) with tokens; treat `0` as data and `null` as a gap; add keyboard-reachable tooltips.

#### F-20 (P2). The in-page gate proves strings, not behaviour, and the Facelift report's own test spec cannot run as written

- **Evidence.** `src/ui/src/app/__tests__/e2e-inpage-surfaces.test.ts` (146 lines, 20 assertions) is named an end-to-end gate, but it reads `shared-ui.js`, `content.js`, `background.js` and `portal-tokens.css` with `readFileSync` and asserts `toContain(...)`. I ran it with the real `shared-ui.js` and empty stand-ins for the three files that are not in the archive: **15 pass, 5 fail**, and the 5 failures are exactly the assertions that read the stand-ins. Every `shared-ui.js` assertion passes while defects exist: the Tab trap passes on `toContain("e.key === 'Tab'")` although it never fires (EXT-08), the "official 5-segment module" check passes on the custom `ns-scale-box` class names (EXT-03), and nothing checks emoji (EXT-12), the fallback palette (F-04) or contrast. The Playwright and axe suite the Facelift report specifies (EXT-GATE-1 to 4 with `@playwright/test` and `@axe-core/playwright`) is not implemented, and neither package is a dependency.
- **Problems in the Facelift report's test spec, to fix before implementing it.**
  1. The default Playwright `page` has no extension loaded, so no badge exists; use `chromium.launchPersistentContext` with `--disable-extensions-except` and `--load-extension`, against a fixture retailer page.
  2. EXT-GATE-3 calls `.focus()` on `.nutriscore-isolated-root`, a non-focusable host `<div>`; the focusable element is `.badge-trigger` inside its open shadow root.
  3. EXT-GATE-2 reads the computed font size of every shadow element. Elements without their own size inherit the retailer's size through the host, because the portal `:host` rule sets no `font-size` and no `all: initial`. Set them, then assert.
  4. The file belongs in the directory that `npm test` collects with Vitest (`vitest run src/ui/src/app/__tests__`), so Playwright's `test.describe` would break the unit run. Put it under `e2e/` with its own config.
  5. Two token claims in section 3.1 are wrong where it matters: `--ns-border-control #b8c9ce` is **1.71:1** on white (claimed 3.1:1) and the dark value `#235b70` is **1.96:1** on `#072c3a` (claimed 3.2:1), both under the 3:1 control-border floor. The implemented values (`#6B8794`, 3.81:1; dark `#5E8190`, 3.51:1) are correct and should replace them in the spec. Smaller misstatements: `#073a4b` on white is 12.24:1, not 14.2:1.
- **Fix.** Keep the string checks as a fast lint, and add (a) jsdom tests that execute `shared-ui.js`: Tab and Shift+Tab across a shadow root, outside-click focus, host-style mutation, a missing palette failing closed, and a callout without a grade; and (b) the corrected Playwright suite with the extension loaded, run in the same job as `npm run ci`.

#### F-21 (P2). Facelift section 6 sign-off checklist and smaller deviations

| Check | Status | Note |
| --- | --- | --- |
| Token purity (no raw hex outside token sources) | Fail | 83 hex literals in `shared-ui.js`; palette hand-typed, not generated (EXT-01) |
| Nutri-Score charter (no custom letter shapes) | Fail | Custom A to E scale (EXT-03) |
| Typography floor (nothing under 12 px) | Pass | Static check only; the computed-style check needs the inheritance fix in F-20 |
| Touch targets (at least 24 x 24 px; close 32 x 32 px) | Partial | Badge, close button and the 38 px CTA pass; the callout dismiss (about 18 px) fails |
| Condition neutrality (no surface or header recolour) | Pass | Header and card are neutral; the advisory uses Tier 1 tokens |
| Focus order (popover keyboard model, focus restored) | Fail | Tab trap never fires; outside click steals focus (EXT-08) |
| Scroll resilience | Pass | Closes only when the trigger leaves the viewport (EXT-07) |
| Dead code removal (`OPEN_UPGRADE`) | Partial | Gone from `shared-ui.js`; `background.js` is Unverifiable (EXT-14) |
| `npm run ci`, all 12 gates | Unverifiable | `scripts/` and the CI configuration are not in the archive |

Smaller deviations from the Facelift's section 3, all P3:

- The badge `aria-label` reads "NutriScore B, \<label>, tap to open details"; the spec's wording is "Nutri-Score Grade B. Great dietary choice. Press Enter for clinical details." (and "tap" is wrong on desktop).
- On open, the file focuses the close button; the spec focuses the flyout root (`tabindex="-1"`, `preventScroll`). Either is acceptable; pick one and test it.
- The flyout has no size and price subtitle line (spec section 3.3).
- The callout's button uses the hook `data-ns-open-panel`, while the flyout's uses `data-ns-open-sidepanel`; confirm both are wired in `content.js` (Unverifiable here), and that the `FOCUS_SWAP_CANDIDATES` follow-up in the spec's `background.js` snippet exists.

## 4. Prioritised closure plan

Order matters: items earlier in the list make later checks meaningful (for example, contrast checks are only trustworthy after F-01 and F-06).

| Step | Work | Findings | Size | Exit gate |
| --- | --- | --- | --- | --- |
| 0 | Restore the full repo in CI (add `src/shared`, `src/extension`, `scripts`, token JSON) and obtain a Chromium run | all Unverifiable items | S | 46 of 46 test files collect; `ledger-retention`, manifest `side_panel`, `OPEN_SIDE_PANEL_SWAPS` and the asset-pack gate become checkable |
| 1 | Wire tokens to utilities; delete legacy token files; fix Inter Variable | F-01, F-06 | M | `check:utilities` 0 unresolved; `check-tokens` no duplicate `:root` values; contrast at least 4.5:1 light and dark; screenshots show filled buttons and visible muted text |
| 2 | Security and truthfulness | F-02, F-03, F-05, F-13 | M | Forged-flag, empty-set and failed-request tests pass; no `Math.random` for codes or passwords; API required for every success state |
| 3 | Fail-closed grades and the in-page surface | F-04, F-08, F-09, F-15 | M | No grade fallbacks (CI grep); Playwright Tab/Escape/outside-click suite green; official SVG pack renders unaltered; on-colour contrast tests pass |
| 4 | Build chain and budgets | F-10 | M | One Preact runtime; `dist-ui/extension` and `dist-ui/cad`; Popup at most 40, Side panel 60, Dashboard 70, CAD 110 KB eager gzip; production build fails on missing env |
| 5 | Quality gates | F-11 | M | New scripts run in `npm run ci` and fail on regression |
| 6 | Data-backed CAD and shopper metrics | F-07, F-12 | L | No numeric constants in role homes; deltas, adherence and retention behave per spec; side panel and popup show live basket data |
| 7 | Shell, tables and dialogs polish; dead-code purge | F-14, F-16, F-17, F-18, F-19 | M | axe 0 serious or critical on every surface; no-truncation suite green; `Dashboard.tsx` and the other listed files deleted |

### 4.1 Dependencies and scripts to add

- **devDependencies:** `jsdom` (or `happy-dom`), `@testing-library/preact`, `axe-core` (or `vitest-axe`), `fake-indexeddb`, `@playwright/test`, `@axe-core/playwright`, `eslint-plugin-jsx-a11y`.
- **scripts:** `check:utilities` (unresolved colour utilities), `check:budget` (eager gzip per surface), `check:no-truncation` (static grep plus DOM assertions), `test:a11y` (Playwright axe), `test:e2e`. Add each to `npm run ci`.

### 4.2 What "100 % pass" should mean

| Gate | Pass condition |
| --- | --- |
| `typecheck`, `lint` | 0 errors; `jsx-a11y` enabled |
| `check:tokens` | Single writer of `:root` tokens; no duplicate declarations; all text pairs at least 4.5:1 and control borders at least 3:1 in both modes |
| `check:utilities` | 0 colour utilities without a generated rule |
| `check:budget` | Popup 40, Side panel 60, Dashboard 70, CAD 110 KB eager gzip |
| Vitest | Unit and component tests, including the `purgeLedgerOlderThan` boundary, delta eligibility, MFA forgery, audit-chain states and grade fail-closed cases |
| Playwright axe | 0 serious or critical violations on Home, History, Care plan, Privacy, Popup, Side panel, CAD per role, and the in-page badge, open flyout, paused pill and callout; desktop, laptop, tablet and mobile; light and dark; 200 % and 400 % zoom |
| No-truncation | 0 `text-overflow: ellipsis` computed styles; 0 table cells where `scrollWidth > clientWidth`; 0 `overflow: hidden` table wrappers |

### 4.3 What I need to finish the unverifiable items

The missing source trees (`src/shared`, `src/extension`, `scripts`, token JSON), the Facelift specification with its real EXT identifiers, and a browser-capable environment for the Playwright and screenshot layer. With those, the Unverifiable notes in section 2 can be turned into pass or fail, and the percentages recomputed.
