# NutriScore UI/UX Overhaul: Research, Audit and Implementation Report

*Shopper extension and Clinic Admin Dashboard (CAD) · 6 November 2026 · Basis: ui.rar (130 files, 43 TSX components, about 11,200 lines of non-test source), your four reference boards, desk research, and computed colour and contrast analysis*

## 0. Executive summary

**Verdict.** The build is a strong engineering foundation wearing an unfinished interface. The role model, navigation contract, consent flows and 50 test files are worth keeping. The visual layer is not: two design systems coexist, 79% of colour styling bypasses the token layer, the CAD home screens show hard-coded numbers, and the shopper dashboard hides its best content behind a toggle. I recommend a **full overhaul of the presentation layer** while preserving the role/navigation contract, the data layer and the tests.

**The five decisions that matter most**

1. **Two surfaces, one core.** Build a *Shopper* surface (warm, airy, narrow-first, plain language, top navigation) and a *Clinical* surface (navy rail, dense, URL-addressable, role-aware), both generated from one token core. Distinction comes from layout, density, type scale, radius and tone, not from a different brand.
2. **Stop recolouring the whole UI by health condition.** Today a diabetes profile paints the interface red. That red sits at ΔE 7.9 from the critical-alert token (near-identical) and 19.7 from the Grade E colour, and four of the five condition headers fail AA contrast for their subtitles. Express condition with an icon and a chip, never a surface colour.
3. **Rebuild tokens in three tiers** (primitive, semantic, component) in the W3C Design Tokens format, generate CSS variables from them, and enforce them with lint. Today there are 554 raw palette utilities against 147 token references.
4. **Replace the always-on banner and mock numbers with a tiered alert system and real work queues** (clinician roster, tenant exceptions). In clinical software, alert design is a safety property, not decoration.
5. **Make accessibility a CI gate (WCAG 2.2 AA).** Every input border measures 1.48:1 against the 3:1 required for component boundaries, 31 text instances are 10–11px, six modals are hand-rolled without focus management, and the irreversible crypto-shredding action is confirmed with `window.confirm`.

**Revision 2: what your build files and a real render changed.** I installed your lockfile (369 packages), built the UI with Vite 6.4.4, and rendered the shopper dashboard, popup, options page and CAD in headless Chromium at 1440, 1024, 768 and 480 px with worst-case clinical text. Four results reshape the plan:

- **Text is truncated by design.** With realistic data, 12 of 12 audit reasons, 3 of 3 target reasons and 4 of 4 rule rationales end in an ellipsis; the Health Modes rules table loses 349 px of its right side at 1024 px; the shopper ledger is a fixed 1,121 px wide, so 36% of it is off-screen at 768 px. Section 4.9 replaces this with a no-truncation table contract and a CI test that fails on any clipped cell.
- **The shopper dashboard becomes a four-timeframe timeline** (Today, This week, This month, 3 months) with a hard 3-month retention cut-off. Today the code offers five ranges (including This Year and All Time), defines the same range two different ways in two files, and has no ledger retention at all. Section 4.10 specifies the model, the purge, and what comparisons mean once older data no longer exists.
- **The build chain carries avoidable cost and risk.** CAD ships inside the extension package; the popup’s eager payload is 85.5 KB gzip, about 69 KB of it a shared chunk that is 91% Supabase client code; MUI, Emotion, Popper, motion, class-variance-authority and date-fns have zero imports (MUI alone is 194 MB of the 490 MB install); React 19 types check code that runs on Preact 10. Section 3 (B6) and Part D fix each.
- **MFA is a placeholder.** `verifyMfa` accepts any six characters and the result lives only in React state. This is not a design finding, but it blocks any real clinician use of the CAD (defect D-30).

**Scorecard** (my assessment, 5 = production-grade)

| Dimension | Score | Headline |
| --- | --- | --- |
| Role model and navigation contract | 4 | Clean role-to-nav map with tests; keep it |
| Visual system consistency | 2 | Tokens exist but most screens ignore them |
| Accessibility | 2 | Good intentions (focus ring, reduced motion); fails contrast, dialogs, sortable headers |
| Dashboard hierarchy and data presentation | 2 | No hero metric, hidden charts, hard-coded KPIs |
| Alert and safety UX | 2 | One static banner per role; no tiers, no queue |
| Interaction quality (tables, dialogs, states) | 2 | Two of 13 CAD views have loading states; no pagination |
| Extension-surface fit (popup, panel) | 3 | Popup is lean and fast; half-migrated and text-only |
| Friendliness and emotional tone | 3 | Copy is kind; visuals are pastel bands and small grey text |

---

## 1. Scope, method and limits

**What I reviewed.** All 43 non-test TSX components, 7 CSS files, 4 HTML shells, the role/navigation map, the theme providers, and the test inventory. **How.** (1) Desk research across dashboard practice, clinical alert design, WCAG 2.2, design tokens, extension UI constraints and the Nutri-Score graphic charter. (2) Static review of source. (3) Counting audits by pattern (raw palette classes, hex literals, text sizes, dialog semantics). (4) Colour mathematics: WCAG relative-luminance contrast, CIE76 ΔE, and Machado colour-vision-deficiency simulation.

**Limits you should know.**

- **What ran.** I built the UI from your `package.json`, `package-lock.json` and `vite.config.ts` (Vite 6.4.4, 8 s) and rendered it in headless Chromium at 1440, 1024, 768 and 480 px, with 125 days of seeded purchases and mocked Supabase responses containing the longest realistic clinical strings. I also measured bundles from source maps and ran `npm audit` (0 production vulnerabilities).
- **What did not run.** `tsconfig.json`, ESLint and Prettier configs were not shared, so `typecheck`, `lint` and `format:check` were not executed. The 50 test files were not run (many import `src/extension/*`, which is absent).
- **Stand-ins.** `src/shared/*` and `src/extension/*` are still missing. I wrote throwaway stubs for the five shared modules the UI imports (`storage`, `claims`, `auth-provider`, `health-modes.mjs`, `session-key.mjs`) so screens could render. Anything that depends on their real behaviour (auth, storage layers, per-mode palettes) is unverified.
- **Out of scope.** The in-page flyout and badge (`adapters/shared-ui.js`), the service worker and Supabase. For those I only specify how they consume tokens and retention.
- **Scores** are judgement calls, shown so you can argue with them.

---

## 2. Part A — Research: how professional dashboards are designed

Each finding ends with its consequence for NutriScore.

### A1. Decision-first hierarchy

- Strong dashboards answer one primary question in seconds, then support it. A common structure is an inverted pyramid: 4–6 KPI cards at the top, 2–3 trend or segment charts in the middle, and an exception table at the bottom. Twelve equal-weight tiles is the classic failure.
- Scanning research on F-shaped reading shows attention decays left-to-right and top-to-bottom across repeated items, so a row of five KPIs under-serves the last two. Rank by importance, not by data availability.
- A 12-column grid with fixed spans (KPI = 3 columns, medium chart = 6, large = 12) keeps rhythm predictable.
- Missing data should read as 'No data', never as zero, and line charts should show gaps instead of interpolating.

**For NutriScore:** the shopper dashboard needs one hero (basket quality), three supporting KPIs, then trend and history. The CAD needs a work queue first, metrics second. Today both lead with prose and filters.

### A2. Role-aware information architecture

- Good dashboards are designed per audience and per decision. An executive view, an operational view and an analyst view should not be one page with toggles.
- Systematic reviews put information overload at the top of dashboard problems, driven by density without hierarchy.

**For NutriScore:** seven CAD roles and a shopper should not share one visual pattern. Section 4 defines a distinction matrix and a home screen per role.

### A3. Healthcare has two audiences with opposite needs

- Patient-facing views need low cognitive load: plain language (guidance commonly cited is a 6th–8th grade reading level), one decision per screen, visible progress, and for each number a plain-language interpretation, a comparison to the person’s own history, and a clear next action.
- Provider views need high density, structured data, and workflow fit.
- Calm, non-judgemental tone is a design requirement: health apps that make users feel they failed reduce engagement.

**For NutriScore:** the shopper surface speaks in ‘heads-up’ and ‘better swap’, never ‘violation’ or ‘breach’. The CAD may use clinical terms, but must still stratify severity.

### A4. Alerts are a safety system

- Published figures put clinician override rates for decision-support alerts between 49% and 96%. Alert fatigue is an architecture problem: when everything interrupts, nothing is heard.
- In one comparison across two academic medical centres using the same drug-interaction alerts, tiered presentation reached roughly 29% compliance against 10% for untiered presentation.
- A systematic review concluded fatigue can be reduced by changing interaction design and tailoring alerts to clinical role, and noted that under fatigue, modal dialogs become obstacles and the acknowledge button becomes the workaround.
- Practical tiering: **passive** (inline badge or sidebar), **advisory** (visible in context, not blocking), **interruptive** (modal, reserved for safety-critical, with a reason or acknowledgement). Severity must be visually distinct before anyone reads a word.

**For NutriScore:** the CAD `SystemHealthBanner` currently shows one permanent `role=alert` message to clinicians (‘Six dietary threshold breaches require clinical review today’), which is exactly the always-interrupting pattern. Section 4.6 defines four tiers.

### A5. Colour carries information, not decoration

- Reserve saturated colour for things that need attention; keep one consistent palette; never rely on colour alone (WCAG 1.4.1); text needs 4.5:1 and component boundaries and graphics need 3:1 (WCAG 1.4.3, 1.4.11).
- **The Nutri-Score scale is fixed.** The graphic charter fixes the logo colours and proportions and forbids altering them, and its A–E letters exist precisely so colour is never the only signal. Usage rights are free but require registration with the relevant authority. Your A–E badge should be treated as a protected component, and the brand palette must stay visually separate from it.
- Computed on your grade colours: under simulated deuteranopia the D–E pair drops to ΔE 14.3, and under protanopia the B–C pair drops to 14.8 (adjacent steps are hard to tell apart by colour alone). The letter must therefore always appear with the colour.

### A6. Accessibility baseline: WCAG 2.2 AA

Relevant new criteria: **2.5.8 Target Size (Minimum)**, at least 24×24 CSS px (44 px is the AAA target and the right default for primary mobile and touch controls); **2.4.11 Focus Not Obscured (Minimum)**, so sticky headers must not hide focus; **2.5.7 Dragging Movements**, which needs a single-pointer alternative; **3.3.8 Accessible Authentication (Minimum)**, which matters for the CAD login and MFA (allow paste, do not block password managers, do not require transcription); **3.2.6 Consistent Help**; **3.3.7 Redundant Entry**.

### A7. Design tokens: use the stable standard

- The W3C Design Tokens Community Group published its first stable specification (2025.10) on 28 October 2025: `$value`, `$type`, aliases with `{group.token}`, groups, `$extends`, and colour objects with an explicit colour space.
- The industry pattern is three tiers: **primitive** (raw values), **semantic** (purpose: `color.text.error`), **component** (`button.background.primary`). Themes override only the semantic tier. Material, Fluent and Polaris all follow variants of this.

**For NutriScore:** this is how one token core can serve two surfaces and two colour modes without forked CSS.

### A8. Admin-console patterns

- Table toolbar: search plus filter chips, saved views, density toggle (comfortable and compact), column visibility, export. Empty states keep the toolbar visible.
- Filter, sort and view state lives in the URL so views can be bookmarked and shared.
- Selection uses a tri-state header checkbox; selected rows replace the toolbar with a contextual action bar showing the count.
- Destructive actions are never adjacent to frequent ones and always get explicit confirmation.
- Breadcrumbs on every non-root page; one primary action per page header.

### A9. Extension surface constraints

- Browser action popups are clamped to a maximum of 800×600 and a minimum of 25×25 px, have no API to set size, and grow to fit content. Fix the body width (320–400 px), use pixel `min-height`, never `vh` or `vw`, pre-size async regions to prevent size jumps, and keep headroom for browser zoom.
- Guidance for extension UI separates three mechanisms: **popup** (quick status and one primary action), **side panel** (persistent tasks that live beside the page), and **content-script UI** (in-page, isolated with Shadow DOM and a maximal z-index).
- Because extension pages run on desktop Chrome, ‘mobile-first’ translates to **narrow-first**: popup (about 360 px), side panel (variable width) and resized windows. Use container queries, not viewport breakpoints.

### A10. Prefer native primitives

- `<dialog>` with `showModal()` is Baseline widely available since March 2022 and provides top-layer rendering, inert background, focus entry and return, and Escape dismissal. Hand-built overlays must re-implement all of that and usually get it wrong.

### A11. Your four reference boards, decoded

| Board | What it does well | NutriScore decision |
| --- | --- | --- |
| **Smile Food** (courier dashboard) | Grouped rail (MAIN, SUPPORT) with tinted active state and a left bar; greeting plus search plus bell plus avatar header; filter row with period picker and a single primary Export; KPI triplet (icon, number, delta vs previous period); donut with centre total and legend; table with status as icon plus text; soft shadows on white cards over a near-white canvas | **Adopt** the KPI-with-delta and ring-with-centre-value patterns for both surfaces. **Adapt** the grouped rail for the CAD (Work, Administer, Govern). **Adapt** status as icon plus text. **Avoid** the promo card in clinical areas; use it only as a contextual capacity or licence reminder |
| **NevBank** (banking) | Top navigation; tile row for accounts; list with category chips; ring chart with floating total and tooltip; segmented daily/weekly/monthly control; de-emphasised decimals in large numbers | **Adopt** top navigation for the Shopper surface (visibly different from the CAD rail). **Adopt** the segmented period control and category chips. **Adapt** the tile row for tenant portfolio cards. **Adopt** the number typography (large integer, lighter unit or decimal) |
| **Goodle Drive** (files) | Strong brand-colour field behind a rounded app frame; ‘Quick access’ cards for recent items; storage meter in the rail; clean file table | **Adapt** Quick access into ‘Pinned and recent patients’ for clinicians. **Adapt** the storage meter into a plan-capacity meter. **Adopt** the rounded outer frame only for sign-in and empty states |
| **Colour palette** (#F04770, #F78C6A, #FFD167, #06D7A0, #108AB1, #073A4B) | Warm-to-cool spectrum with a deep navy anchor; friendly and modern | **Adopt** as the brand family. **Constraint:** only the navy is text-safe on white. Measured on white: pink 3.60, blue 3.97, coral 2.36, mint 1.87, yellow 1.44. So the palette colours are fills and accents with navy ink, and each needs a darker text-safe sibling (Section 4.2) |

---

## 3. Part B — Audit of the current build

### B1. Inventory

| Surface | Main files | Lines | State |
| --- | --- | --- | --- |
| Shopper dashboard | `Dashboard.tsx`, `dashboard.tsx`, `Charts.tsx` | 926 + 344 + 554 | Functional; hierarchy and tokens weak |
| Popup (320 px) | `popup.tsx`, `Popup.tsx` | 241 + 165 | Fast; half-migrated |
| Options (‘My Care Profile’) | `Options.tsx` | 468 | Legacy raw Tailwind |
| Onboarding and subscription | `OnboardingWizard.tsx`, `SubscriptionExpiredPage.tsx`, hooks | 577 + 116 + 323 | Legacy commerce flow still shipped |
| CAD shell | `CadApp.tsx`, `AppShell`, `Navigation`, `SidebarNavigation`, `SystemHealthBanner` | about 290 | Tokenised; static |
| CAD role homes | six small views | 6–21 each | Hard-coded mock data |
| CAD workflows | `HealthModesView` (788), `UserManagementView` (526), `PatientLinkingConsentView` (348), `PatientTargetsView` (307), `BillingSubscriptionView` (270), `AuditLogView` (219), `TenantSettingsView` (211) | 2,669 | Mixed: raw Tailwind with a token bridge |
| Styles | `tokens.css`, `theme.css`, `globals.css`, `health-modes.generated.css` | 607 | Two systems in conflict |

### B2. Measured findings

| Metric | Result |
| --- | --- |
| Raw palette utilities (`bg-slate-*`, `text-emerald-*`, …) vs token references | **554 vs 147** (79% bypass). Worst: `HealthModesView` 97, `Options` 88, `BillingSubscriptionView` 78, `PatientLinkingConsentView` 62, `Dashboard` 62 |
| Hex literals in TSX / inline `style={{}}` objects | 37 / 74 |
| Text smaller than 12 px | 15 × `text-[10px]`, 16 × `text-[11px]`, 6 inline sizes from 0.67 to 0.78 rem |
| Input border contrast (`#cbd5e1` on white) | **1.48:1** (needs 3:1); decorative border 1.23:1 |
| Placeholder and `text-slate-400` | 2.56:1 (needs 4.5:1) |
| Condition-header subtitle contrast | General 3.12, Hypertension 2.99, Kidney 3.55, Obesity 3.93; only Diabetes passes (4.67) |
| Chart ‘Daily limit’ amber `#f9a825` on white | 1.97:1 |
| Hand-rolled modal overlays (`fixed inset-0`) | 6 (Options ×2, HealthModes ×2, ConsentDocModal, SubscriptionExpired); only 2 views use the `ui-modal` dialog |
| Sortable headers built as `<th onClick>` | 8, with 0 `aria-sort` |
| Dark-mode toggle / skip link / router | 0 / 0 / 0 |
| CAD views with loading state | 2 of 13 live views |
| Competing reds | critical `#b91c1c`, diabetes theme `#D32F2F` (ΔE 7.9 apart), Grade E `#e63e11`, Quickmart badge `#dc2626` |
| Green collision | General theme `#2E7D32` vs Grade A `#037b3e`: ΔE 8.9 (near-identical) |

ΔE below about 10 means two colours are close to indistinguishable in UI use; above about 25 they are safely distinct.

### B3. Defect register

| ID | Severity | Finding and evidence | Fix (see Part D) |
| --- | --- | --- | --- |
| D-01 | High | **Token bypass.** 554 raw utilities; `globals.css` carries a descendant-selector ‘bridge’ (`.cad-main .bg-white { … }`) that re-maps Tailwind palette classes inside `.cad-main`, so styling depends on specificity luck | Phase 1–2: tokens, lint ban, remove bridge |
| D-02 | High | **Two dark palettes, unreachable.** `tokens.css .dark` (navy slate) and `theme.css .dark` (near-black oklch, `--primary` flips to near-white) both exist; no toggle exists; charts hard-code `#fff`, `#eee`, `#ccc` | Phase 1: one dark set, `color-scheme`, toggle |
| D-03 | High | **Condition recolour collisions.** Diabetes red equals ‘danger’; General green equals ‘Grade A’; four of five header subtitles fail AA; a patient’s whole UI changing to red is also stigmatising | Phase 1: remove surface recolour; chip plus icon |
| D-04 | High | **Non-text contrast.** `.ui-input` border 1.48:1; placeholders 2.56:1 | Phase 1: `border.control` token at 3.8:1 |
| D-05 | Medium | **Sub-12 px text** in 37 places | Phase 1: type scale floor of 12 px |
| D-06 | High | **Dialog semantics.** Six overlays with no focus trap, no focus return, no inert background, inconsistent z-index (`z-50`, `z-[100]`) | Phase 2: native `<dialog>` primitive |
| D-07 | High | **Irreversible action guarded by `window.confirm`** (`PatientLinkingConsentView`, DPA s.40 crypto-shredding); three `alert('Permission Denied')` calls in `UserManagementView` | Phase 6: typed-confirmation dialog; inline permission states |
| D-08 | Medium | **Ledger sort headers** are click-only `<th>`: no keyboard, no role, no `aria-sort` | Phase 4: button-in-`th` with `aria-sort` |
| D-09 | High | **Navigation is a `useState` string** (`CadApp`): no URL, back button, deep link or breadcrumb. For a super administrator, ‘Overview’ and ‘Platform tenants’ both render active (the active test is `currentTab === id \|\| (id === 'platform' && currentTab === 'overview' && role === 'super_admin')`) | Phase 3: router plus route guards |
| D-10 | High | **Mock data shown as live.** All six role homes use constants (18 staff, 97 links, 74% capacity, 112 bundles, one fixed patient PAT-0042). `SystemHealthBanner` is static copy; for clinicians it is a permanent `role=alert` | Phase 6: queries plus tiered alerts |
| D-11 | Medium | **Missing states.** Loading in 2 of 13 views, search and sort in 1, pagination in 0, empty and error states in a handful | Phase 2–6: state primitives |
| D-12 | Medium | **Orphan and client-side suppression.** `ClinicalOverview.tsx` (233 lines, 53 raw classes) is imported nowhere, and it zeroes small-cell rows in the browser from raw values | Delete; enforce suppression server-side so the client never receives raw small cells |
| D-13 | High | **Shopper hierarchy.** Above the fold: a text summary plus two filter groups. Basket chart, trend, category and alerts are behind ‘Show details’. Every card has a full-bleed condition-coloured header band. No hero metric, no target progress, no swaps | Phase 5 |
| D-14 | Medium | **Imperative DOM in React.** `dashboard.tsx` uses `getElementById`, `textContent` and `appendChild` re-ordering to personalise a ‘static scaffold’ | Phase 5: state-driven render |
| D-15 | Medium | **Ledger delete has no confirm or undo** | Phase 5: undo toast |
| D-16 | Medium | **Popup half-migrated.** `Popup.tsx` says ‘Sign in with Clinic Credentials’, while `popup.tsx` still routes to `onboarding.html?mode=signup\|login` and carries premium-tier logic. Metrics are one sentence of text | Phase 5 |
| D-17 | Medium | **Theme boot mismatch.** `theme-init.js` reads `localStorage.nutriscore_theme` from `<body>`; `ThemeContext` reads `MultiLayerStorage` (a second source of truth). Risk of flash and drift | Phase 1: single boot script in `<head>` |
| D-18 | Medium | **Legacy commerce UI still bundled:** `OnboardingWizard` (577 lines), `SubscriptionExpiredPage`, `usePaymentState`, `useSubscriptionGuard`, Basic/Premium legal copy. These conflict with the CAD-only identity model where clinicians provision patients | Phase 7: remove; keep consent gate |
| D-19 | Medium | **Chart kit.** Hand-rolled SVG, hard-coded colours, 9–11 px labels, mouse-only tooltips, no tabular alternative (credit: donut segments are keyboard-operable and charts carry `role=img`) | Phase 4 |
| D-20 | Low | **Token hygiene.** Duplicate `--color-overlay`; `--font-size: 16px` vs `--text-body: 0.875rem`; shadcn `oklch` tokens and institutional hex tokens both define `--border` and `--primary` semantics | Phase 1 |

### B4. What to keep

- `getCadNavigationIds(role)` and its tests: a clean role-to-navigation contract.
- The spacing and type scale in `tokens.css`, and the `.ui-*` primitive idea (it just needs real components behind it).
- Grade colour tokens with computed on-grade foregrounds (`--ns-on-grade-*`).
- The focus ring, the reduced-motion block, `ChartBox` skeleton, `aria-pressed` segmented groups, `sonner` toasts.
- The consent and privacy language (‘Session actions are audit logged’, DPA references) and first-name-only greetings.
- The 50-file test suite, which gives you a refactoring net.

### B5. Surface critique

**CAD shell.** The top bar crowds role badge, MFA badge, email, tenant name and sign-out into one strip, while omitting what admin users reach for: global search, notifications, density, theme, and a user menu. The rail has one flat list with no grouping. There are no breadcrumbs, and the footer repeats the audit note already in the rail. The rail’s 17.5 rem width and fixed positioning are fine; the missing collapse-to-icons mode wastes space on tablets.

**Role homes.** The structure is right (page header, metric row, work panel) and the copy is thoughtful (‘Aggregate adoption, without patient exposure’). But the pages are showpieces: the clinician home is one hard-coded patient rather than a prioritised roster; the dietician chart uses four constant weeks; the commercial view has no suppression indicator tied to real cohort sizes.

**Shopper dashboard.** The empty-state copy (‘Small choices add up’) is the best moment in the product. Everything after it under-delivers: cards use pale full-width condition bands, subtitles at 0.78 rem fail contrast, the ledger caps at 500 px inside a 600 px section (nested scroll), and the numbers that should motivate (items graded, alerts, better swaps, progress to clinician targets) are absent.

**Popup.** Right size and fast paint (stale-while-revalidate is well done). It reports progress as a sentence (‘X of Y items graded’), offers no live basket grade, no pause toggle, and no hint of what to do next on a store page.

**Options.** Still raw `slate` and `emerald` classes, own modals, and a ‘Save Preferences’ button with no dirty-state logic. Because clinicians now own thresholds, this page should be mostly read-only (care plan) plus display preferences, notification choices and privacy actions.

### B6. Build chain and dependencies (`package.json`, `vite.config.ts`, lockfile)

The toolchain is sound at the top (Vite 6, Tailwind 4.1.12, TypeScript 6, ESLint 10, 0 production vulnerabilities per `npm audit`, lockfile v3 with 508 packages: 146 production, 362 development) but has fourteen concrete problems. Bundle figures come from a real build with source-map attribution.

| ID | Severity | Finding and evidence | Fix |
| --- | --- | --- | --- |
| D-21 | High | **CAD is packaged inside the extension.** `vite.config.ts` lists `cad.html` beside popup, dashboard, options and onboarding, all into `outDir: ../../dist`. The 118 KB (26 KB gzip) CAD chunk reaches every shopper, `cadSupabase` has a `chrome.storage` branch, and `base: './'` breaks history-API routes on a hosted CAD | Two builds, two outputs (D1) |
| D-22 | Medium | **Supabase dominates the eager payload.** The shared chunk is 249 KB minified (69 KB gzip) and about 91% Supabase: auth-js 46%, storage-js 12%, postgrest-js 12%, realtime-js 11%, phoenix 6%. The UI uses only auth, `from()` and `functions.invoke` | Import `auth-js`, `postgrest-js`, `functions-js` directly, or dynamic-import after first paint |
| D-23 | Medium | **One 68 KB stylesheet (12.8 KB gzip) serves all five pages**, so the 320 px popup downloads CAD, dashboard and onboarding rules | One CSS entry per surface with scoped `@source` |
| D-24 | Medium | **React/Preact split-brain.** The alias sends `react` to `preact/compat` (verified: Preact is 2.8% of the shared chunk, no React runtime), yet `react@18.3.1` is installed as a peer, `@types/react@19.3.0` types the code, and `jsxRuntime: 'classic'` forces `window.React = React` in five entry files (`popup`, `dashboard`, `options`, `onboarding`, `cad/main`) | `@preact/preset-vite`, automatic JSX runtime, Preact types, drop the React peers |
| D-25 | Medium | **Dead dependencies.** Zero imports of `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`, `@popperjs/core`, `motion` (pulls `framer-motion` 5.9 MB), `class-variance-authority`, or `date-fns`. MUI alone is 194 MB of the 490 MB install. `next-themes` is used once (sonner wrapper) and duplicates `ThemeContext`. `esbuild` is a runtime dependency but only scripts use it | `npm rm` eight packages; adopt the already-paid-for `date-fns` for timeframes (4.10) |
| D-26 | Low | `pnpm.overrides.vite = 6.3.5` is ignored by npm (the lockfile is `package-lock.json`), so Vite resolved to 6.4.4 | Use npm `overrides` or delete the block |
| D-27 | Low | `figmaAssetResolver` and the `figma:asset/` scheme have zero uses: Figma Make scaffolding, also the origin of the competing shadcn `oklch` theme (D-02) | Delete plugin and leftovers |
| D-28 | Medium | `emptyOutDir: true` with `outDir: ../../dist`: running `build:ui` alone deletes every assembled extension file until `build:ext` reruns. Same mechanism class as the earlier packaging-overwrite bug | UI builds to `dist-ui/`; `build:ext` merges |
| D-29 | Medium | **Inconsistent env handling.** `services/storage.ts` throws at import when `VITE_SUPABASE_*` is missing (I hit it: popup, options and dashboard render blank), while `cad/supabaseClient.ts` silently falls back to `https://mock.supabase.co` and `mock-key` | One validated `env.ts`; build-time assertion; in-UI configuration error screen |
| D-30 | **Blocker** | **MFA is a stub.** `verifyMfa` returns true for any six-character string (`abcdef` passes) and `mfaVerified` is React state, so a refresh resets it | Supabase TOTP `mfa.challengeAndVerify`; derive assurance from the JWT `aal` claim |
| D-31 | Low | No `build.target`, no `manualChunks`, no CSS split | `target: 'chrome120'` (confirm your minimum Chrome), vendor chunk, per-surface CSS |
| D-32 | Medium | **No component tests or a11y tooling.** devDependencies have no jsdom or happy-dom, Testing Library, axe-core, `eslint-plugin-jsx-a11y` or Playwright. The 50 test files are logic and contract tests; `npm test` only runs `src/ui/src/app/__tests__` | Part D5 |
| D-33 | Medium | **`window.React` global hack and `theme-init.js`** loaded as `/theme-init.js` from `<body>`, an absolute path that only works when the page sits at the package root | Move to `<head>`, relative path, single source of truth (D-17) |
| D-34 | Low | `prepare` runs `git config core.hooksPath .githooks` on every install, silently altering repository config in CI and contributors’ clones | `simple-git-hooks` or Husky with a CI guard |

**Eager payload per page** (static import graph, gzip, JS plus CSS):

| Page | Eager gzip | Observation |
| --- | --- | --- |
| Popup | 85.5 KB | About 69 KB is the Supabase-heavy shared chunk, for a 320 px panel that paints from cache |
| Dashboard | 108.7 KB | Charts (4.4 KB) are separate; 11 KB page code |
| Options | 101.8 KB | Pulls ConsentDocModal and the legal copy eagerly |
| Onboarding | 89.8 KB | Legacy flow (D-18); delete |
| CAD | 111.6 KB | 26 KB page code plus the same shared chunk |

A fair target after Part D is under 40 KB gzip eager for the popup and under 70 KB for the dashboard, mostly by removing unused Supabase modules, splitting CSS, and deleting the onboarding entry.

### B7. What the rendered build shows (beyond static review)

I mounted the real components in a harness with seeded data and looked at them. Nine findings only a render reveals:

| ID | Surface | What the render shows | Why it matters |
| --- | --- | --- | --- |
| D-35 | Shopper dashboard | Under the diabetes profile the header, every card band, the filter pill, the alert card and the ledger band are pink or red, while ‘Return to store’ is teal and retailer chips are green, blue and red. The Health Alerts card shows ‘BLOOD SUGAR · Sugar > 22.5g/100g’ with a large red **0 items** | Three colour systems on one screen; a zero state styled as an alarm trains users to ignore the alert style |
| D-36 | Trend chart | The line is a smoothed spline that dips to 0% on days with no purchases (`Dashboard.tsx:316` coerces `sodiumMg ?? 0`); the ‘Daily limit’ label is about 9 px | Missing data drawn as zero is a false statement of good behaviour; unreadable label |
| D-37 | Grade badges | An ungraded item renders a grey circle with clipped ‘UNK’. The legend reads ‘A · Everyday Choice’ then ‘B · Great Choice’, so the ladder reads backwards | Unknown must be its own ‘Not rated’ state (4.5); copy should rise from A to E |
| D-38 | Metrics | `getAllEntries` returns every ledger row of every status and `filtered` applies time and retailer only, so rows with `status: 'removed'` still count toward basket quality and alerts. `calculateAnalytics` also defaults `averageGrade` to ‘C’ for an empty set | Confirm intent; define KPIs over `purchased` (optionally `in_cart`); never show a default grade |
| D-39 | Popup | The ‘Health Mode’ label and the uppercase red pill each wrap to two lines; the ‘N’ logo tile uses the Grade-A green token | A brand mark that looks like a grade badge; a condition that looks like an alert |
| D-40 | CAD banner | ‘Two staff licences need review before their next clinical shift’ appears on Audit trail, Health modes and Clinical targets alike, whatever the page | Static banner on every page: the alert-fatigue pattern from A4 |
| D-41 | CAD top bar | The tenant `<select>` cuts ‘Kenyatta National Hospital (Cardio-Metabolic C…’; the email is hidden below the `lg` breakpoint | A native select cannot wrap; replace with a combobox that does |
| D-42 | Health Modes at 1024 px | The master-detail pane squeezes: the mode title wraps over three lines beside the version chip, constraint chips wrap as ‘LTE 22.5 g / per 100g’ (shorthand plus a doubled ‘per’), and the rules table is cut off at the right edge | Clinical content is unreadable at a common laptop width |
| D-43 | Options page | Primary buttons and links are a strong blue, the rest of the product is teal; field labels (about 18 px) are larger than section titles (about 15 px) | The type scale and brand colour are not applied |

**Seen working.** The Options page already separates a read-only, clinician-prescribed regimen from editable preferences, which is the right model for 4.4. The Staff and licences table wrapped a 76-character email and a long licence number correctly, proving the base table CSS can wrap when no `nowrap` or `truncate` class is added.

**Found in code, not in the render: fabricated fallbacks (D-44, High).** `AuditLogView.tsx` renders seeded demo audit events, `UserManagementView.tsx` renders a demo roster with a named clinician and licence number, and `AuthContext.tsx` invents demo tenants, whenever the API returns no rows or an error. Nothing restricts these to development builds. A real tenant with no staff yet, or any API failure, would display fabricated staff and audit events, and on an audit screen that is a compliance risk. Fix: strip fallbacks from production builds, serve fixtures only behind a dev flag (MSW or `import.meta.env.DEV`), and show a real empty or error state instead.

### B8. Table truncation audit (measured)

A DOM probe counted every `td` and `th` whose content ends in an ellipsis or line clamp, and every table wider than an `overflow: hidden` ancestor. Fixtures used the longest realistic strings (clinical reasons of 150–190 characters, 76-character emails, 64-character hashes).

| Table (file) | Mechanism | Measured result | Consequence |
| --- | --- | --- | --- |
| Audit trail (`AuditLogView.tsx:149–200`) | `whitespace-nowrap` on time and actor; reason has `max-w-xs truncate` with a `title` tooltip | **12 of 12** reasons ellipsised at 1440 and at 1024 px. At 1024 the Action, Resource, Patient ref, Reason and Hash columns are beyond the card edge (horizontal scroll only, no cue) | The column auditors need most is nearly last, cut to about 40 characters, and the full text exists only in a hover tooltip |
| Clinical targets (`PatientTargetsView.tsx:175`) | `max-w-xs truncate` on reason | **3 of 3** truncated at 1440 and 1024, although about 300 px of row width is unused at 1440. The Action column is empty for the ‘Pending co-sign’ row | Clinician evidence is cut mid-word; width is spent on an empty column |
| Health Modes rules (`HealthModesView.tsx:580, 437`) | `max-w-xs truncate` on rationale; `line-clamp-1` on the mode description; wrapper is `overflow-hidden` | **4 of 4** rationales truncated. The table is 751 px inside a 681 px box at 1440 (**72 px clipped**) and inside 403 px at 1024 (**349 px clipped**), with no scroll | Clinical rationale is unreachable at laptop widths: this is data loss, not styling |
| Shopper ledger (`Dashboard.tsx:822–895`) | `whitespace-nowrap` on all nine columns | Intrinsic width **1,121 px**. At a 768 px window 718 px are visible (36% hidden); at 480 px, 446 px (60% hidden). Three nested scroll regions (page, 600 px section, 500 px table) | No ellipsis, but unusable in a side panel or narrow window; the product name scrolls away from its grade |
| CAD top bar (`Navigation.tsx:35, 41`) | `truncate` on tenant name; `max-w-48 truncate hidden lg:inline` on email | Tenant `<select>` cuts the name; email absent below `lg` | The user cannot confirm which clinic or account they act as |
| Staff and licences (`UserManagementView.tsx`) | none | **0** truncated; 76-character email and licence number wrap | Baseline CSS works when nothing forbids wrapping |
| Platform tenants (`PlatformOverviewView.tsx`) | `overflow-x-auto` plus `min-w-[42rem]` | 0 truncated; scrolls on narrow screens | Acceptable fallback, not a design |

**Six root causes.** (1) `max-w-xs truncate title=…` is the default for free text, and `title` tooltips do not work by keyboard or touch. (2) `whitespace-nowrap` is the default for cells. (3) The longest, most important column is placed last. (4) No column has a sizing contract, so width is whatever the content wants. (5) Wrappers use `overflow-hidden` instead of a labelled scroll region. (6) Nothing transforms the table when its container is narrow. Section 4.9 addresses each.

### B9. Timeframe and retention audit (current code)

| Topic | What the code does | Evidence |
| --- | --- | --- |
| Ranges offered | Five: Today, This Week, This Month, **This Year, All Time**; default is This Month | `Dashboard.tsx:57–65, 108` |
| Two definitions of one range | The dashboard filters with `resolveTimeframe` (rolling: week = now minus 7 days, month = now minus one calendar month, year = minus one year, all = from a hard-coded 2020). A second function, `rangeStart`, defines calendar ranges (Monday-start week, first of month, 1 January) but is never called | `analytics.ts:11–30` vs `Dashboard.tsx:77–96` |
| Label versus behaviour | ‘This Week’ means the last 7 days, ‘This Month’ the last month, so numbers shift at midnight rather than at a week or month boundary | same |
| Month arithmetic | `setMonth(getMonth() - 1)` overflows on the 31st: from 31 March the ‘month’ starts 3 March | `analytics.ts` month branch |
| Dead fields | `bucketCount` is returned but never read; the ‘week’ bucket unit exists but only the All Time override uses it | `analytics.ts`, `Dashboard.tsx:274–281` |
| Retention | **None for the ledger.** `evictStaleCacheEntries` removes `product_cache` after 7 days via an alarm; `shopping_ledger` grows without bound until the user presses ‘Delete all my data’ | `settings.ts:188`, `cart.ts` |
| Read path | `getAllEntries` loads the whole ledger on every dashboard open, although the `by-addedAt` index (schema v18) supports range queries | `cart.ts:50` |
| Comparisons | No delta against a previous period exists anywhere | search of `analytics.ts` and `Dashboard.tsx` |
| Tests | One characterization snapshot pins `resolveTimeframe('week')` (rolling) and will need a deliberate update | `characterization.test.ts:96` |

Consequences for the model you asked for: remove `year` and `all` end to end (type, options, analytics branch, the All Time bucket override); keep one calendar-based definition so labels tell the truth; add a real purge; and accept that a previous-period delta cannot exist for the 3-month view, because the previous three months are, by policy, gone. Section 4.10 specifies all four.

---

## 4. Part C — Target design

### 4.1 Principles and the shopper / clinical distinction

Six principles govern every decision below: **(1) one question per screen** (what is the user deciding?); **(2) hierarchy before decoration**; **(3) severity must be visible before it is read**; **(4) colour is information, never mood**; **(5) native and accessible by default**; **(6) the same bones, different bodies**: one token core, two surfaces.

| Attribute | Shopper (user) surface | Clinical (admin) surface |
| --- | --- | --- |
| Purpose | Reassure, guide and motivate at the moment of purchase | Triage, prescribe, govern and audit |
| Primary question | Is my basket okay, and what could I swap? | Who needs me now, and what changed? |
| Navigation | Top bar with four tabs (Home, History, Care plan, Privacy); bottom tab bar below 560 px | Left navy rail in three groups, collapsible; breadcrumbs; command palette |
| Layout | Hero plus card grid, max width 1120 px | Fluid 12-column to 1440 px; master-detail; sticky toolbars |
| Density | Comfortable: 16 px base, 56 px rows, 24 px card padding | Compact default: 14 px base, 36–40 px rows, 16 px padding; comfortable on request |
| Shape | Radius 20 on cards, pill chips, soft ambient shadow | Radius 12 on cards, 8 on controls, 1 px border, near-flat |
| Colour emphasis | Mint brand, sun and coral accents, navy ink, generous white | Navy rail, blue primary, status tints, neutral surfaces |
| Numbers | 40–56 px hero figures | 24–32 px, tabular numerals |
| Alerts | Passive and advisory only; never modal; plain language | Four tiers; modal only for safety-critical with reason capture |
| Motion | Gentle (count-up, ring draw, 200 ms) | Functional (120 ms) |
| Language | Plain, about grade 6–8, second person, no jargon | Clinical vocabulary, exact units, audit terms |
| Empty states | Illustrated, encouraging, one action | Instructional, with next task or documentation link |
| Mode | Light default; dark optional | Light default; dark and density chosen per user and persisted |

### 4.2 Visual language

**Palette mapping.** Your reference palette becomes the primitive layer. Because only navy is text-safe on white, every hue gets a darker sibling for text and filled controls. All ratios below were computed (WCAG relative luminance).

| Primitive | Hex | Role | Text-safe sibling | Verified |
| --- | --- | --- | --- | --- |
| navy-900 | `#073A4B` | Strong text, CAD rail, ink on bright fills | itself | 12.24:1 on white |
| blue-500 | `#108AB1` | Graphics, charts, focus accents | blue-700 `#0B6E91` (primary buttons and links) | white on blue-700 5.75:1 |
| mint-400 | `#06D7A0` | Shopper brand fill (navy ink) | mint-700 `#04785A` (text, links, filled buttons) | navy on mint-400 6.55:1; white on mint-700 5.47:1 |
| sun-400 | `#FFD167` | Highlights, pending (navy ink) | sun-800 `#7A5400` on sun-50 `#FFF6DC` | 8.49:1 and 6.29:1 |
| coral-400 | `#F78C6A` | Heads-up fill (navy ink) | coral-800 `#9A3412` on coral-50 `#FFF0EA` | 5.20:1 and 6.58:1 |
| pink-500 | `#F04770` | Graphics and large text only | critical-600 `#C81E4F`; critical-800 `#9F1239` on critical-50 `#FFF1F4` | white on pink-500 3.60:1 (large only); 5.59:1; 7.31:1 |

**Neutral ramp (navy-tinted so everything feels related).**

| Token | Light | Contrast / note |
| --- | --- | --- |
| canvas | `#F5F9FA` | page background |
| surface | `#FFFFFF` | cards |
| surface-muted | `#EAF1F4` | wells, table headers |
| border-subtle | `#D6E3E8` | decorative dividers only |
| **border-control** | `#6B8794` | **3.81:1** on white; inputs, checkboxes, buttons (fixes D-04) |
| text-strong / text / text-muted | `#073A4B` / `#234B5A` / `#46636F` | 11.55 / 8.90 / 6.05 on canvas |
| placeholder | `#5B7682` | 4.82:1 on white |

**Dark mode (single definition, navy-based).** canvas `#04222D`, surface `#072C3A`, raised `#0B3A4B`, text `#E6F2F5` (14.45:1), muted `#A9C3CC` (7.95:1), control border `#5E8190` (3.51:1). Accents lighten instead of darken: mint-400 text 7.85:1, blue-300 `#6CC6E3` 7.57:1, coral-400 6.23:1, pink-400 `#FF7A9B` 5.95:1, sun-400 10.18:1.

**Semantic status (one meaning per colour, always icon plus text).**

| Meaning | Treatment | Icon | Used for |
| --- | --- | --- | --- |
| Success | mint-800 on mint-50 `#E6FBF4` (7.22:1) | check-circle | verified, consent confirmed, target met |
| Info | blue-800 `#0A5A77` on blue-50 `#E5F4F9` (6.80:1) | info | neutral guidance, read-only notices |
| Pending | sun-800 on sun-50 | clock | awaiting co-sign, licence due |
| Heads-up (shopper) / Warning (clinical) | coral-800 on coral-50 | triangle-alert | a threshold is close or exceeded |
| Critical | critical-800 on critical-50; solid critical-600 for buttons | octagon-alert | safety-critical only |
| Neutral / unknown | surface-muted, text-muted | circle-dashed | inactive, not rated |

**Colour rules.**

1. **Grade colours are a protected component.** `--ns-grade-*` appears only inside `GradeBadge`, `GradeScale` and charts that encode grade. Do not tint, gradient or re-proportion them. Before release, compare your five hex values to the charter’s reference colours (your A is `#037b3e`; confirm it). If you display the official logo modules you must register for the right to use them; if you do not, make your badge clearly your own FSA-NPS grade component and avoid imitating the registered mark.
2. **Never use brand mint to mean ‘good product’.** Success mint-700 is only ΔE 18 from Grade A. Product quality is communicated by the grade itself.
3. **The brand gradient** (pink to coral to sun to mint to blue to navy) is for brand moments only: sign-in backdrop, empty-state art, and a 3 px hairline under the popup header. Never behind text or data, and never beside a grade badge, because it sweeps through the grade hues.
4. **Condition identity** is a neutral chip (surface-muted, an icon, the mode name). The UI does not recolour. Because clinicians define modes (including non-disease ones such as pregnancy or malnutrition), the clinician picks the icon from a curated set of about twelve, defaulting to a stethoscope.
5. **Personalisation** is user-chosen and cosmetic: an accent picker (mint, blue, coral) that swaps `brand` only. Semantic tokens never change.

**Typography.**

- **Family:** Inter Variable, self-hosted (`@fontsource-variable/inter`, `font-display: swap`; no remote font requests, which also removes a privacy leak and works offline). Decided: Inter Variable only; shopper hero figures use Inter at weight 700–800 with tabular numerals, and no second family is added.
- **Scale (rem at 16 px root):**

| Role | Shopper | Clinical |
| --- | --- | --- |
| Hero figure | 3 / 1.05 | n/a |
| KPI figure | 2 / 1.1 | 1.75 / 1.1 |
| Page title | 1.75 / 2.25 | 1.5 / 2 |
| Section title | 1.25 / 1.75 | 1.125 / 1.5 |
| Body | 1 / 1.5 | 0.875 / 1.25 |
| Table cell | 0.9375 / 1.4 | 0.8125 / 1.25 |
| Caption (floor) | 0.75 / 1 | 0.75 / 1 |

- **Floor of 12 px, no exceptions** (retire all 10–11 px text). Tabular numerals in every table and KPI. Large figures pair an integer at display size with a lighter, smaller unit (‘1,420 mg’), the pattern NevBank uses for decimals. Prose line length 60–75 characters.

**Spacing, shape, elevation.** 4-pt base on an 8-pt rhythm (existing `--space-*` scale is fine). Grid gaps 24 px (shopper) and 16 px (clinical). Elevations: `elev-0` none; `elev-1` shopper card `0 1px 2px rgb(7 58 75 / .06), 0 8px 24px rgb(7 58 75 / .06)`; clinical card is a 1 px `border-subtle` plus `0 1px 2px rgb(7 58 75 / .04)`; `elev-3` overlays `0 16px 48px rgb(7 58 75 / .20)`.

**Motion.** 120 / 200 / 320 ms with `cubic-bezier(.2, 0, 0, 1)`. KPI count-up once per session; donut and ring draw 600 ms on first paint only; skeletons pulse (no shimmer) and everything collapses to instant under `prefers-reduced-motion`. Celebrate sparingly: a subtle ring pulse when a swap lowers sodium; no confetti in a medical context.

**Icons.** Keep `lucide-react`; 20 px, 1.75 stroke; status icons always accompany text; hit area at least 24 px (44 px on shopper primary controls).

### 4.3 Token architecture

Three tiers in the W3C DTCG format, compiled to CSS variables, consumed through Tailwind v4 semantic utilities.

```
tokens/
  primitive.tokens.json        color.navy.900, color.mint.400, space.4, radius.20 ...
  semantic.light.tokens.json   color.surface, color.text.muted, color.border.control ...
  semantic.dark.tokens.json    same keys, dark values
  surface.shopper.tokens.json  radius, density, type scale overrides
  surface.clinical.tokens.json radius, density, type scale overrides
  component.tokens.json        kpi.value.size, button.height, table.row.height ...
```

- **Selectors:** `:root[data-surface='shopper']`, `:root[data-surface='clinical']`, `[data-mode='dark']`, `[data-density='compact']`. Mode follows `prefers-color-scheme` until the user chooses.
- **Build:** Style Dictionary (DTCG parser) writes `src/styles/tokens.generated.css` and a typed `tokens.d.ts`. CI fails if the generated file is stale (you already have this pattern for `db.js` freshness).
- **Authoring rule:** components use semantic utilities only (`bg-surface`, `text-muted`, `border-control`, `bg-status-warning-subtle`). A hex or a palette name in TSX is a lint error.
- **shadcn bridge:** keep the shadcn variable names (`--background`, `--primary`, `--border`) but define them *from* the semantic tokens in one place, deleting the competing `oklch` definitions in `theme.css`.

### 4.4 Information architecture and layouts

**Shopper surface (extension pages).** Top navigation, four destinations, no sidebar.

```
+----------------------------------------------------------------------+
| (N) NutriScore   Home  History  Care plan  Privacy       bell  (AK) v |  sticky, 64 px
+----------------------------------------------------------------------+
| Good afternoon, Alex               [Today|Week|Month|3mo][All stores v]|
| Your clinic: Kenyatta National  .  Care plan: [icon] Hypertension     |
|                                                                      |
| +- Basket quality -----------+ +- Items --+ +- Heads-ups -+ +- Swaps -+|
| |  ring: 72% rated A-C       | | 148      | | 9           | | 14      ||
| |  centre: B  (typical)      | | +12%     | | -3 vs last  | | -420 mg ||
| |  A B C D E counts          | | sparkline| | sparkline   | | sodium  ||
| +----------------------------+ +----------+ +-------------+ +---------+|
| +- This week vs your targets -+ +- Trend --------------------------+  |
| | Sodium  [#####-] 41 of 52 OK| | line: sodium and sugar vs limit    |  |
| | Sugar   [##----]   44/52 OK | | dashed limit line, direct labels   |  |
| +-----------------------------+ +------------------------------------+ |
| +- Recent activity --------------------------------------------------+ |
| | [B] Brookside milk 500 ml  Naivas  Today 10:12   (i) Higher in salt  | |
| +---------------------------------------------------------------------+ |
+----------------------------------------------------------------------+
```

- **Home** answers the one question (hero ring plus three KPIs), then progress to the clinician’s targets, then trend, then recent activity. The detailed ledger moves to **History** (a real page with filters, not a toggle).
- **Care plan** is read-only: the clinician-set mode, thresholds in plain language, and who set them and when. The only editable items are display preferences (accent, units, language en/sw, notification digest) and privacy actions (download, delete).
- **Privacy** holds consent state, what the clinic can see, and the existing delete-all-data control, with a typed confirmation.
- **Popup (360 px, fixed).**

```
+-------------------------------------+
|=====================================|  3 px brand gradient hairline
| (N) NutriScore    Hi Alex     (gear)|
| (o) Active on Naivas     [Pause v]  |
| +---------------------------------+ |
| | Basket now    [ B ]   12 items  | |
| | 2 heads-ups            Review > | |
| +---------------------------------+ |
| Care plan: [icon] Hypertension      |
| [ Open my dashboard ]               |
+-------------------------------------+
```

One primary action; a live basket grade and heads-up count replace the ‘X of Y graded’ sentence; Pause is per-site; the sign-in state (‘Sign in with clinic credentials’, ‘Complete care consent’) replaces the dashboard button only when needed.

- **Side panel (new, optional).** Persistent beside the store page: basket grade at top, cart items sorted worst-grade-first, each with a reason chip and a ‘Better swap’ action, and a ‘Why this grade?’ link. Layout is container-query driven (320–480 px). This is where the future alternatives engine lives. Verify the `sidePanel` permission and its install prompt in Chrome’s documentation before adding it to the manifest.

**Clinical surface (CAD).**

```
+------+----------------------------------------------------------------+
| RAIL | [Tenant: KNH v]  [ Search or jump to...  Ctrl+K ]  bell  dens  (SM)|
|      +----------------------------------------------------------------+
| CARE | Home > Patients                                                 |
|  Home| Patient roster                              [ + Link patient ]  |
|  Roster [search] [Status v] [Mode v] [Saved view v]  [Density] [Cols]  |
|  Targets +-------------------------------+-----------------------------+
|  Modes | | Pri | Patient  | Flags       | | PAT-0042  consent active   |
| ADMIN  | | !   | PAT-0042 | 2 sodium    | | timeline . targets . alerts|
|  Staff | | .   | PAT-0108 | none        | | [ Prescribe target ]       |
|  Billing +-------------------------------+-----------------------------+
| GOVERN                                                                 |
|  Audit                                                                 |
+------+----------------------------------------------------------------+
```

- **Rail groups** (metadata layered over `getCadNavigationIds`, which stays the source of truth and keeps its tests): *Care* (Home, Targets, Modes, Linking and consent), *Administer* (Staff and licences, Billing, Tenant settings, Platform tenants), *Govern* (Audit trail). Active item: tinted fill plus a 3 px left bar. Collapses to icons below 1200 px; labels return on hover and focus.
- **Top bar** keeps only what is global: tenant switcher (combobox with search for super administrators), command palette, notification bell, density and theme toggles, and a user menu that now holds role, MFA state and sign-out. This removes today’s badge clutter.
- **Page frame:** breadcrumbs, title, description, and exactly one primary action. Filter, sort, saved view and selected record live in the URL.
- **Role homes:**

| Role | Home screen | Hero content | Distinctive cue |
| --- | --- | --- | --- |
| super\_admin | Platform portfolio | Tenant tiles with service status, sparkline and exception count; exceptions queue | Tenant switcher prominent; ‘Platform’ scope chip |
| tenant\_admin | Operations | Licences due, pending invitations, consent exceptions, capacity meter (the Drive storage-meter pattern) | Queue-first layout |
| writing\_clinician | Roster (master-detail) | Triage-ordered patients, pending co-signs, pinned and recent patients (Quick access cards) | ‘Prescribe target’ primary action |
| viewing\_dietician | Cohort trends | Longitudinal charts with plain-language interpretation | Persistent ‘Read-only’ ribbon |
| compliance\_auditor | Audit ledger | Hash-chain verification status, saved filters, watermarked export | Monospace identifiers; no edit affordances |
| commercial\_stakeholder | Aggregate KPIs | Cohort metrics with server-generated ‘withheld, cohort below k’ markers | No patient references anywhere |
| patient (in CAD) | Care summary | Data-sharing state and a deep link to the shopper dashboard | Shopper styling, not clinical |

### 4.5 Component specifications

| Component | Anatomy and behaviour | Accessibility notes |
| --- | --- | --- |
| **AppShell** (two variants) | `ShopperShell` (top bar, tab bar below 560 px) and `ClinicalShell` (rail, top bar, breadcrumb slot, main). Skip link first in DOM; `main` has `id` and `tabIndex=-1` | `scroll-padding-top` equals sticky header height so focus is not obscured (WCAG 2.4.11) |
| **KpiCard** | Label, value (display), unit, delta chip vs previous period with direction icon and text, optional sparkline, optional status. States: loading skeleton, no data (shows ‘No data’, not 0), stale | Delta announced as text (‘down 3 from last week’); colour never alone |
| **GradeBadge** and **GradeScale** | Official five-step scale with the active letter enlarged; letter always present; separate confidence chip (High confidence, Confirmed, Estimated); states for `insufficient_data` (‘Limited nutrition info’, known fields shown as fact chips) and `not_attempted` (‘Not rated’) | `aria-label` such as ‘Grade B, good nutritional quality, estimated’; never recoloured |
| **TargetMeter** | Horizontal bar with value, limit marker and label (‘41 of 52 items within your limit’); over-limit uses warning tint plus icon, not red fill | `role=meter` with `aria-valuenow/min/max` and text alternative |
| **ProgressRing** | Hero ring with centre value; segments use grade tokens | `role=img` plus a visually hidden list of counts |
| **DataTable** | TanStack Table v8: server-side sort, filter and pagination; sticky header; column visibility; density toggle; row selection with tri-state header and contextual action bar; saved views; URL serialisation; empty state keeps toolbar | Sort control is a `<button>` inside `<th aria-sort>`; row actions in a labelled menu; targets at least 24 px; no truncated cells and no clipped columns (see 4.9) |
| **FilterBar** | Search, chips, ‘+ Add filter’, clear all; chips removable by keyboard | Result count in a polite live region |
| **Dialog** | Native `<dialog>` with `showModal()`; sizes S/M/L; header, body, footer with one primary | Inert background, focus entry and return, Escape, `aria-labelledby` |
| **ConfirmDialog** | Three levels: simple (Cancel/Confirm), consequence list, **typed confirmation** (type the patient reference to enable the button) for irreversible actions such as crypto-shredding | Default focus on Cancel; button states announced |
| **CommandPalette** | `cmdk`; jump to pages, patients (by reference only), saved views; filtered by role permissions | Opens with Ctrl/Cmd+K; listed in the shortcut help |
| **Banner / Callout** | Tier 1–3 messaging inside a context (not global) with action link | `role=status` unless blocking |
| **EmptyState** | Illustration slot, one sentence, one action; three variants (first-use, no results, no permission) | Heading level inherited from context |
| **Skeleton** | Shapes mirror the final layout; pulse, no shimmer | `aria-busy` on the region |
| **Toast** | Keep `sonner`; add Undo action for reversible deletes | `role=status`; 8 s minimum when it carries an action |
| **Timeline** | Patient events (purchases, alerts, target changes) with date dividers | List semantics; each event has a text summary |
| **PermissionGate** | Renders children, a read-only variant, or an explanation; never `alert()` | Explanation uses plain text, not colour |

### 4.6 Alert and notification system

| Tier | Name | Placement | Interruption | Shopper treatment | Clinical treatment |
| --- | --- | --- | --- | --- | --- |
| 0 | Info | Inline text | None | ‘Estimated from similar products’ | Data provenance notes |
| 1 | Advisory | Chip or badge on the item | None; polite live region | ‘Higher in salt than your plan suggests’ | Flag chip in roster row |
| 2 | Warning | Banner scoped to the affected context | Non-blocking; snooze with reason | Summary card on Home with one suggested swap | Queue item with SLA, assignee, ‘document next step’ |
| 3 | Critical | `<dialog role=alertdialog>` | Blocking | **Not used** | Safety-critical only; requires acknowledgement and reason code; audit logged; rate-capped |

**Governance.** Every alert type has an owner, a severity, a rate budget (maximum per user per day) and a reason-capture schema. Review override rates monthly and demote any alert overridden more than about 90% of the time. The bell holds Tier 1–2 items with read state; shoppers get a daily digest instead of per-item pings. This replaces the global `SystemHealthBanner`: a banner appears only when there is a real, role-relevant exception, with the count linking to the queue.

**Shopper copy rules.** Say what it means and what to do, in about 15 words, without blame.

| Instead of | Write |
| --- | --- |
| Threshold breach: sodium over 600 mg/100 g | Higher in salt than your plan suggests. A lower-salt option is available. |
| Non-compliant item added | This one is worth a second look. |
| Insufficient data | We don’t have full nutrition details for this product yet. |
| Alert acknowledged | Got it. |

### 4.7 Data visualisation specification

| Question | Chart | Rules |
| --- | --- | --- |
| What is my overall basket quality? | Ring with centre value | Segments are grade tokens in fixed A→E order; centre shows percent rated A–C |
| How is this changing? | Line with dashed limit line | At most 3 series; direct end-labels; limit labelled ‘Your limit’; gaps for missing weeks (no interpolation) |
| Progress to a target | Bullet bar (TargetMeter) | Value, limit marker, plain-language label |
| Compare categories | Horizontal stacked bar (grade segments) | Sorted by total; labels at least 12 px |
| Many small trends | Sparkline in KpiCard | No axes; last value labelled |

Standards for all charts: every colour from a token (so dark mode works); labels at least 12 px; focus and hover both reveal values; an adjacent **Show data table** `<details>` with the same numbers; an `aria-label` that states the takeaway; no more than 5 colours; never red/green as the only difference. Library: keep the custom SVG primitives for ring and sparkline (they are small), adopt `visx` for line and area charts (tree-shakable, so the popup is unaffected), and delete hard-coded hex from `Charts.tsx`.

### 4.8 States, motion and microcopy

- **Loading:** skeletons shaped like the final content, never a lone spinner; the popup paints from cache first (already implemented) and shows a stale marker (‘Updated 10:12’).
- **Empty:** first-use (‘Add an item at checkout to see simple guidance’, with a single action), no results (suggest clearing a filter), no permission (say who can grant it).
- **Error:** state what happened and what to do, with a retry; never raw error text.
- **Offline and stale:** the extension works offline, so show ‘Using saved data’ rather than an error.
- **Partial nutrition data:** route `insufficient_data` and `not_attempted` to the two distinct GradeBadge states above; never show a placeholder grade.
- **Clinical microcopy:** precise units and identifiers, sentence-case labels, verbs on buttons (‘Prescribe target’, ‘Co-sign’, ‘Revoke link’).

### 4.9 Table design contract: content is never truncated

The rule: **a table never hides text because a cell is narrow.** Text wraps, columns are sized by what they hold, and what cannot fit at the current width moves into the row or the record, not behind an ellipsis. This is enforced by a component contract and by a CI test (Part D5).

**Principles.**

1. No `truncate`, `text-ellipsis`, `line-clamp-*` or `title`-only disclosure on data cells. A tooltip is never the only route to the full value (it fails on keyboard and touch).
2. Every column declares a **kind**; the kind fixes its sizing and wrapping.
3. The flexible column (long text) is placed **second**, directly after the identifier, never last.
4. A scroll region is a last resort, and it is labelled, focusable and shows an edge shadow; `overflow: hidden` on a table wrapper is banned.
5. Below a width threshold the table becomes a list of records, not a squeezed grid.

**Column kinds.**

| Kind | Examples | Width rule | Wrapping rule |
| --- | --- | --- | --- |
| `id` | `PAT-0042`, `#100`, licence number | `max-content`, tabular numerals, monospace | No wrap up to 16 characters; beyond that `overflow-wrap: anywhere` |
| `hash` | `row_hash` (64 hex), UUID | Not a default column; shown in the row detail with a Copy button. If shown: 12 px monospace in two lines | `overflow-wrap: anywhere` |
| `name` | Tenant, clinician, product | `minmax(16ch, 2fr)` | Wrap at words; `text-wrap: pretty` |
| `email` | `dr.name@clinic.or.ke` | `minmax(20ch, 2fr)` | `overflow-wrap: anywhere`; `<wbr>` after `@` and `.` |
| `status` | Active, Pending co-sign | `max-content` | Never wrap; icon plus text |
| `number` | `KES 1,420`, quantity | `max-content`, right-aligned, tabular | Never wrap |
| `datetime` | `1 Nov 2026, 12:15` | `max-content` | Two lines (date over time) in compact density |
| `enum` | Category, mutation type | `minmax(12ch, 1fr)` | Wrap |
| `text` (reason, rationale, description) | Free text up to about 500 characters | `minmax(28ch, 4fr)`: takes all spare width; measure capped at 75ch | **Always wraps; never clamped in a table** |
| `actions` | Buttons, menu | `max-content`; sticky right when scrolling | Icon buttons at least 24 px with accessible names |

**Responsive behaviour, driven by the table’s container (container queries), not the viewport.**

| Container width | Presentation |
| --- | --- |
| 960 px and up | Full table; every column that has priority 1 or 2 |
| 640–959 px | Priority-3 columns (hash, resource ID, created) move into an expandable row (‘Details’, `aria-expanded`); a column chooser restores them; first column sticky |
| Below 640 px | **Record list**: each row becomes a card with label/value pairs, long text at full width, actions at the bottom. Rendered from the same column definitions by a sibling `RecordList` component, because `display: block` on table elements strips table semantics for some screen readers |
| 400% zoom (320 CSS px) | Record list (WCAG 1.4.10 Reflow) |

**Long text.** The default is to show it whole. Only for fields that can exceed about 300 characters (clinical rationale) may a table clamp to four lines, and then with a visible, focusable ‘Show more’ control that expands in place; the full text is always present in the row detail and in the export. Silent ellipses are never acceptable.

**Applied to your tables.**

| Table | Change |
| --- | --- |
| Audit trail | Columns: Seq (`id`), Reason (`text`, flexible, second), Time (`datetime`), Actor + role (`name`), Action (`enum`), Mutation (`status` chip), Patient ref (`id`). Resource, Resource ID, Row hash and Previous hash move to the row detail, with a ‘Verify chain’ action and Copy buttons. Auditors get a monospace hash block in the detail, never an ellipsis |
| Clinical targets | Reason becomes the flexible second column; remove the empty Action column or show ‘Awaiting co-sign by Dr X’ text when the viewer cannot act; rule shown as ‘Sodium: at most 2,000 mg per day’ (plain words replace `LTE ... / per day`) |
| Health Modes rules | Replace the squeezed master-detail with a full-width rules table under a mode header; Rationale is the flexible column and wraps; the mode list becomes a compact selector (tabs or a combobox) at under 1200 px |
| Shopper ledger | Product (`name`, flexible, first after date) wraps to two lines; retailer, category and quantity move under the name as a secondary line at under 960 px; price and grade stay as the right-hand cluster; below 640 px each purchase is a card with the grade badge leading |
| CAD top bar | Tenant switcher is a combobox with wrapped option text; the account email moves into the user menu so it is always reachable |

**Microcopy for constraints** (retire the shorthand): ‘at most 22.5 g per 100 g’, ‘at least 6 g per 100 g’, ‘at most 2,000 mg per day’. Keep field keys such as `SugarsG` for engineers only (in a detail drawer), never as the primary label.

### 4.10 Shopper timelines and the 3-month retention rule

The shopper dashboard has exactly four timeframes (Today, This week, This month, 3 months) and shows and keeps exactly three months of data on the device and in the UI; everything older is deleted there. Server records follow Kenyan health-data retention (decision 4 in 5.7).

| Timeframe | Window (local time) | Chart buckets | Compared with | Focus |
| --- | --- | --- | --- | --- |
| Today | 00:00 to now | Hourly, 24 slots; future hours empty | Yesterday, same elapsed hours | What I just chose; the next swap |
| This week | Monday 00:00 to now | Daily, Monday to Sunday | Previous week, same elapsed span | Progress against my limits; best day |
| This month | 1st 00:00 to now | Daily with week gridlines | Previous month, same elapsed days | Trend and grade mix |
| 3 months | Start of day three calendar months ago to now | Weekly, about 13 slots | **None** (earlier data is deleted); show the direction of the 13-week trend | Consistency and long-run direction |

**Control.** Segmented tabs (`role=tablist`, arrow-key navigation) at the top of Home and History. One control drives every widget: hero ring, KPIs, trend, timeline. Default is This week; the last choice is stored per device in `chrome.storage.local`. The retailer filter becomes a secondary dropdown.

**One definition of each range.** Create `timeframes.ts` (Part D3) on `date-fns`, which is already installed and unused: `startOfDay`, `startOfWeek({ weekStartsOn: 1 })`, `startOfMonth`, `subMonths`. Delete `rangeStart`, the `year` and `all` branches, `bucketCount` and the All Time bucket override, and update the one characterization snapshot on purpose. This removes the rolling-versus-calendar mismatch and the 31st-of-month overflow found in B9.

**Timeline view.** Under the chart, a chronological timeline grouped by hour (Today), day (Week, Month) or week (3 months), each group with a one-line summary (‘Tuesday: 6 items, 1 heads-up’). Each entry carries the grade badge, the wrapped product name, a retailer chip and any heads-up chip. Selecting a chart bucket filters the timeline to it (keyboard operable). An empty bucket reads ‘No items’, never 0.

**Retention rule.** Cutoff = `subMonths(startOfDay(now), 3)`. Rows with `addedAt` before the cutoff are deleted; a row exactly on the cutoff is kept.

| Layer | Action | When |
| --- | --- | --- |
| IndexedDB `shopping_ledger` (and the legacy `shopping_history` store) | Cursor delete over the `by-addedAt` index with `IDBKeyRange.upperBound(cutoff, true)` in one readwrite transaction | On dashboard open before the first read; on extension startup, install and update; daily via a `chrome.alarms` job `ledger-retention` beside the existing `cache-eviction` handler |
| `pending_cart_syncs` | Delete entries with `savedAt` before the cutoff | Same job |
| Supabase (any synced purchase events or per-patient rollups) | Superseded by decision 4 in 5.7 (server records are not purged at three months). Originally: scheduled delete (for example `pg_cron`) of patient-linked purchase rows older than three months | Nightly |
| Audit ledger (append-only) | Must hold metadata and `subject_ref` only, never purchase content, so deletion does not conflict with its 20-year immutable retention | Verify in the schema before launch |

**What the user is told** (calm, factual). Under the range tabs on 3 months: ‘Showing your last 3 months. Older shopping history is removed automatically.’ In the Privacy tab: ‘Your shopping history stays on this device for 3 months.’ One first-run notice; an optional ‘Download last 3 months (CSV)’ before data ages out. No warning dialogs.

**Comparisons.** A delta appears only when the previous window lies wholly inside retention and holds at least three items; otherwise ‘Not enough data to compare’. Today, This week and This month always qualify (the previous month always starts less than three months ago). The 3-month view shows a trend direction from the weekly buckets (needs six weeks with data) instead of a delta.

**Metric definitions** (this also fixes D-36 and D-38).

- **Items chosen:** ledger rows with status `purchased` or `in_cart`, not `removed` (confirm intent); the history list still shows removed rows with a ‘removed’ chip.
- **Rated coverage:** items with a computed grade out of items chosen, shown beside every grade statistic (‘9 of 12 rated’). No default grade for an empty period.
- **Basket quality:** share of rated items graded A to C, with the A to E distribution.
- **Heads-ups:** distinct items that crossed a clinician-set threshold in the timeframe.
- **Limit adherence:** for each per-100 g rule the clinician set (for example sugars at most 22.5 g per 100 g), the number of items within the limit out of items with data. **Purchases are not intake.** The ledger holds per-100 g values and quantities, not what was eaten, so a daily total such as ‘sodium 1,420 of 2,000 mg’ cannot be computed honestly. Daily-total targets stay on the Care plan page as reference. Relabel the trend chart from ‘Average intake as % of daily limit’ to ‘Average sodium per 100 g of items chosen’, with the per-100 g limit as the dashed line.
- **Missing data** is `null`, drawn as a gap, never coerced to zero.

**Read path.** `getAllFromIndex('shopping_ledger', 'by-addedAt', IDBKeyRange.lowerBound(start))` loads only the selected window; with a 3-month cap the store is bounded.

**Decisions for you.**

- Resolved on 7 November 2026: the 3-month ceiling applies to UI and device data only. Clinician views and server storage follow Kenyan health-data retention (see 5.7).
- ‘3 months’ as rolling three calendar months (recommended) or the current month plus the two before it.
- Which statuses count as ‘items chosen’.

---

## 5. Part D — Implementation plan

### 5.1 Target architecture and build configuration

**Separate what ships to shoppers from what ships to clinicians.** Two applications, one shared token and component core. If you want the smallest change first, keep one repository and one `package.json` and only split the Vite configs and output folders; npm workspaces can follow.

```
nut-04/
  apps/
    extension-ui/   popup, shopper dashboard, options redirect, side panel (Preact, MV3 pages)
    cad/            Clinic Admin Dashboard (hosted web app, own origin)
  packages/
    tokens/         DTCG JSON, Style Dictionary build, tokens.generated.css, tokens.d.ts
    ui/             primitives, shells, DataTable, RecordList, KpiCard, GradeBadge, charts
    data/           LedgerRepo (IndexedDB), CadApi (Supabase), env.ts, timeframes.ts
  src/extension/    content scripts, service worker (unchanged)
  src/shared/       unchanged
```

| Target | Config | Entries | Output | `base` | Notes |
| --- | --- | --- | --- | --- | --- |
| Extension UI | `vite.extension.config.ts` | popup, dashboard, options, sidepanel | `dist-ui/extension` (merged into `dist/` by `build:ext`) | `./` | Relative paths for `chrome-extension://` pages |
| CAD | `vite.cad.config.ts` | cad | `dist-ui/cad` | `/` | History-API routes need an absolute base; deploy as static files behind a gateway with SPA fallback, strict CSP and `no-store` on `index.html` |

If you decide the CAD must stay inside the extension, keep one config but switch the router to hash mode and keep `base: './'`. I recommend the split because clinical staff should not need the shopper extension, the CAD chunk should not reach every shopper, and a hosted origin gives you proper cache and security headers.

**Extension UI config** (replaces `vite.config.ts`; the preset sets the React-to-Preact aliases and the automatic JSX runtime, so `jsxRuntime: 'classic'`, the manual aliases, the Figma plugin and every `window.React = React` line can go):

```ts
// vite.extension.config.ts
import { defineConfig } from 'vite'
import path from 'node:path'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/ui',
  base: './',
  envDir: __dirname,
  plugins: [preact(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src/ui/src') } },
  build: {
    outDir: '../../dist-ui/extension',   // never dist/: build:ext merges
    emptyOutDir: true,
    target: 'chrome120',                 // confirm your minimum Chrome version
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/ui/popup.html'),
        dashboard: path.resolve(__dirname, 'src/ui/dashboard.html'),
        options: path.resolve(__dirname, 'src/ui/options.html'),
        sidepanel: path.resolve(__dirname, 'src/ui/sidepanel.html'),
      },
    },
  },
})
```

```ts
// vite.cad.config.ts
export default defineConfig({
  root: 'src/ui',
  base: '/',
  envDir: __dirname,
  plugins: [preact(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src/ui/src') } },
  build: {
    outDir: '../../dist-ui/cad',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { cad: path.resolve(__dirname, 'src/ui/cad.html') } },
  },
})
```

**`package.json` changes.**

- Scripts: `build:ui:ext` (`vite build --config vite.extension.config.ts`), `build:ui:cad` (`vite build --config vite.cad.config.ts`), and `build` = `build:db`, `build:ui:ext`, `build:ext` (merging `dist-ui/extension` into `dist/`), `build:ui:cad`. Add `check:tokens`, `check:budget`, `test:e2e`, `test:a11y`.
- Remove: `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`, `@popperjs/core`, `motion`, `next-themes`, the `pnpm` block, and the React peer dependencies. Keep `class-variance-authority` for the new primitive variants (so seven removals rather than the eight in D-25). Move `esbuild` to devDependencies.
- Add (runtime): `wouter` (about 1.5 KB router with hash and history modes, Preact-friendly), `@tanstack/table-core` (headless; use a thin Preact adapter) or `@tanstack/react-table` via compat, `@tanstack/react-query` via compat for the CAD only, `@fontsource-variable/inter`, and either `@visx/shape`, `@visx/scale`, `@visx/axis` or your own SVG for the line chart. Build the command palette on `<dialog>` plus a small filter rather than adding `cmdk`, to avoid compat risk.
- Add (development): `@preact/preset-vite`, `style-dictionary`, `@playwright/test`, `@axe-core/playwright`, `happy-dom`, `@testing-library/preact`, `fake-indexeddb`, `eslint-plugin-jsx-a11y`, `stylelint` with `stylelint-config-standard`.
- Pin versions at install and commit the lockfile; because Preact is aliased, run the compat smoke tests (5.5) on every upgrade of a third-party UI library.

**Slim the Supabase client** (D-22). The UI uses sign-in, REST queries and Edge Function calls. Import `@supabase/auth-js`, `@supabase/postgrest-js` and `@supabase/functions-js` directly behind one `createClient()` factory in `packages/data`, with a custom `fetch` that adds the `apikey` and `Authorization: Bearer <access_token>` headers so RLS keeps working. This drops `realtime-js`, `storage-js` and `phoenix` (about a third of the shared chunk, my estimate from source sizes). Verify auth refresh and RLS behaviour against your local Supabase before switching; if you later need realtime, lazy-load it.

**Routing.** CAD: `wouter` in history mode. The route table derives from `getCadNavigationIds(role)`, so the tested role contract stays the source of truth; each route is wrapped in `PermissionGate` (UI convenience only, since RLS remains the control). Shopper dashboard: `wouter` with `useHashLocation` for Home, History, Care plan and Privacy.

**Data layer.** CAD: typed `CadApi` per resource with TanStack Query (stale-while-revalidate, retry, uniform loading, empty and error states). Shopper: `LedgerRepo` with `getEntriesSince(start)`, `purgeLedgerOlderThan(cutoff)` and `deleteEntry(id)`, reading through the `by-addedAt` index. All hard-coded role-home numbers are replaced by queries; demo fixtures live under a dev-only module excluded from production builds (D-44).

**Env.** One `env.ts` validates `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time (a small Vite plugin that throws) and at runtime renders a configuration-error screen instead of a blank page (D-29).

**Manifest additions** for the side panel (verify the permission and its install prompt in Chrome’s documentation first): `"side_panel": { "default_path": "sidepanel.html" }` and the `sidePanel` permission.

### 5.2 Phased roadmap

Sizes assume one developer who knows the codebase: **S** about 1–2 days, **M** 3–5, **L** 6–10. Phases 0 to 2 can overlap; 3 depends on 2; 5 and 6 depend on 3; 7 depends on 4 and 5.

| Phase | Goal | Key work (files) | Done when | Size |
| --- | --- | --- | --- | --- |
| **0. Guardrails and baseline** | Measure before changing | Commit the render harness as `src/ui/dev/` (fixtures with worst-case text, stand-ins for `src/shared/*`); add Playwright, axe, stylelint and jsx-a11y; script that prints the B2 and B8 numbers (raw palette classes, hex, text under 12 px, truncated cells); baseline screenshots of 12 screens at 3 widths | CI prints the baseline numbers (non-blocking) and stores screenshots | S |
| **1. Build chain** | Fix D-21 to D-34, D-44 | Two Vite configs; `@preact/preset-vite`; delete the eight dead packages and the Figma plugin; `env.ts`; slim Supabase; `dist-ui/` outputs; per-surface CSS; remove production demo fallbacks | Popup eager gzip at or under 45 KB; `npm ls @mui/material` empty; `build:ui` leaves `dist/` untouched; no `window.React` | M |
| **1b. MFA (blocker)** | Close D-30 | TOTP enrolment and `mfa.challengeAndVerify`; derive assurance from the JWT `aal` claim; persist across refresh; rate limiting and lockout messaging | Wrong codes are rejected; refresh keeps `aal2` until expiry; e2e test | M |
| **2. Token layer** | One design system | `packages/tokens` (DTCG, Style Dictionary); generated CSS; shadcn variable bridge; self-hosted Inter; one dark set; boot script in `<head>`; delete `theme.css` oklch block, `health-modes.generated.css` recolour and the `.cad-main` bridge; lint bans | `check:tokens` passes (all semantic pairs meet 4.5:1 text and 3:1 controls); theme and density toggles work; zero hex or palette classes in new code | M |
| **3. Primitives** | Build the kit once | Button, IconButton, Input, Select, Combobox, Checkbox, Switch, Tabs and SegmentedControl, Badge and Chip, Banner, Toast, Skeleton, EmptyState, Card, native-`<dialog>` Dialog and ConfirmDialog, KpiCard, GradeBadge and GradeScale, TargetMeter; a gallery page that renders every state | Each primitive has keyboard and axe tests; gallery page in the harness | L |
| **4. Shells and navigation** | Distinct surfaces | `ClinicalShell` (grouped rail, top bar, breadcrumbs, palette, user menu, density and theme), `ShopperShell` (top nav, tab bar); `wouter` routing; `PermissionGate`; replace the static banner; fix the double-active rail item (D-09) | Deep links, back and forward work; role route-guard tests; axe clean at 3 widths | M |
| **5. Tables** | The 4.9 contract | `DataTable`, `RecordList`, column kinds, container-query tiers, URL-serialised sort, filter and saved views; rebuild Audit, Targets, Staff, Health Modes rules and the ledger | Truncation guard passes at 5 widths with worst-case fixtures: 0 ellipsised cells, 0 clipped tables | L |
| **6. Shopper dashboard** | The 4.10 model | `timeframes.ts`; `purgeLedgerOlderThan` plus the `ledger-retention` alarm; Home (hero, KPIs, trend, limit adherence, timeline), History, Care plan, Privacy; popup redesign; side panel; remove imperative DOM; delete `year` and `all`; rebuild charts on tokens | Only four timeframes exist; purge test passes at the boundary; deltas follow the eligibility rule; no data older than the cutoff after any open | L |
| **7. CAD workspaces** | Real data, real states | Role homes on queries with loading, empty and error states; clinician roster (master-detail); typed-confirmation shredding; consent flow; four-tier alerts and the bell | No hard-coded metric remains; every list has all three states; typed-confirm e2e passes | L |
| **8. Legacy removal and hardening** | Ship cleanly | Delete `OnboardingWizard`, `SubscriptionExpiredPage`, payment and subscription hooks, the onboarding entry and `ClinicalOverview`; keep the consent gate content; externalise strings (English and Swahili); forced-colors and reduced-motion passes; bundle budgets enforced; release gate extended | Budgets enforced in CI; WCAG 2.2 AA checklist signed; Swahili strings pass the truncation guard | M |

Critical path: 0, 2, 3, 5, 6 delivers the shopper experience you described; 1, 4, 5, 7 delivers the clinical surface. Phase 1b gates any clinician pilot.

### 5.3 Reference code

Short, working starting points. Adapt names to your conventions.

**Tokens, three tiers (DTCG 2025.10).** Primitives hold raw values; semantic tokens alias them; surface files override only what differs (colour of the primary action, card radius, row height).

```json
{
  "color": {
    "$type": "color",
    "navy": { "900": { "$value": { "colorSpace": "srgb", "components": [0.027, 0.227, 0.294], "hex": "#073A4B" } } },
    "mint": { "700": { "$value": { "colorSpace": "srgb", "components": [0.016, 0.471, 0.353], "hex": "#04785A" } } },
    "blue": { "700": { "$value": { "colorSpace": "srgb", "components": [0.043, 0.431, 0.569], "hex": "#0B6E91" } } },
    "text":   { "strong":  { "$value": "{color.navy.900}" } },
    "action": { "primary": { "$value": "{color.mint.700}" } }
  }
}
```

The clinical surface file re-points `color.action.primary` to `{color.blue.700}` and sets `radius.card` to 12 px and row height to 40 px; the shopper file sets 20 px and 56 px. Style Dictionary emits:

```css
/* tokens.generated.css: do not edit */
:root { --t-color-text-strong: #073a4b; --t-color-surface: #ffffff; --t-color-canvas: #f5f9fa; --t-color-border-control: #6b8794; }
:root[data-surface='shopper']  { --t-color-action-primary: #04785a; --t-radius-card: 20px; --t-row-height: 56px; }
:root[data-surface='clinical'] { --t-color-action-primary: #0b6e91; --t-radius-card: 12px; --t-row-height: 40px; }
:root[data-density='compact']  { --t-row-height: 36px; }
:root[data-mode='dark'] { --t-color-surface: #072c3a; --t-color-canvas: #04222d; --t-color-text-strong: #e6f2f5; --t-color-border-control: #5e8190; }
```

```css
/* app.css: semantic utilities, so authors never type a hex or a palette name */
@import 'tailwindcss' source(none);
@source '../**/*.{ts,tsx}';
@theme inline {
  --color-surface: var(--t-color-surface);
  --color-canvas:  var(--t-color-canvas);
  --color-strong:  var(--t-color-text-strong);
  --color-action:  var(--t-color-action-primary);
  --color-control: var(--t-color-border-control);
  --radius-card:   var(--t-radius-card);
}
```

This yields `bg-surface`, `text-strong`, `bg-action`, `border-control` and `rounded-card`.

**One definition of each timeframe** (`packages/data/timeframes.ts`, built on the already-installed `date-fns`):

```ts
import { startOfDay, startOfWeek, startOfMonth, subMonths, subDays, subWeeks } from 'date-fns'

export type TimeframeKey = 'today' | 'week' | 'month' | '3months'
export interface Timeframe {
  key: TimeframeKey
  start: number
  end: number
  bucket: 'hour' | 'day' | 'week'
  previous: { start: number; end: number } | null
}

export const RETENTION_MONTHS = 3
export const retentionCutoff = (now = new Date()) =>
  subMonths(startOfDay(now), RETENTION_MONTHS).getTime()

export function getTimeframe(key: TimeframeKey, nowMs = Date.now()): Timeframe {
  const now = new Date(nowMs)
  switch (key) {
    case 'today': {
      const start = +startOfDay(now)
      const prev = +subDays(start, 1)
      return { key, start, end: nowMs, bucket: 'hour', previous: { start: prev, end: prev + (nowMs - start) } }
    }
    case 'week': {
      const start = +startOfWeek(now, { weekStartsOn: 1 })
      const prev = +subWeeks(start, 1)
      return { key, start, end: nowMs, bucket: 'day', previous: { start: prev, end: prev + (nowMs - start) } }
    }
    case 'month': {
      const start = +startOfMonth(now)
      const prev = +subMonths(start, 1)
      return { key, start, end: nowMs, bucket: 'day', previous: { start: prev, end: Math.min(prev + (nowMs - start), start - 1) } }
    }
    default:
      return { key: '3months', start: retentionCutoff(now), end: nowMs, bucket: 'week', previous: null }
  }
}
```

Elapsed-time arithmetic is safe in Nairobi (no daylight saving); if the product ever runs in a zone that has it, compute the previous window with calendar functions instead.

**Retention** (`db/cart.ts`, `idb` API; one transaction, index range, cursor delete):

```ts
export async function purgeLedgerOlderThan(cutoff: number): Promise<number> {
  const db = await getDB()
  const tx = db.transaction('shopping_ledger', 'readwrite')
  let removed = 0
  let cursor = await tx.store.index('by-addedAt').openCursor(IDBKeyRange.upperBound(cutoff, true))
  while (cursor) {
    await cursor.delete()
    removed++
    cursor = await cursor.continue()
  }
  await tx.done
  return removed
}

export async function getEntriesSince(start: number) {
  const db = await getDB()
  return db.getAllFromIndex('shopping_ledger', 'by-addedAt', IDBKeyRange.lowerBound(start))
}
```

```js
// service worker, beside the existing 'cache-eviction' alarm
async function runRetention() { await purgeLedgerOlderThan(retentionCutoff()) /* also pending_cart_syncs */ }
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('ledger-retention', { periodInMinutes: 1440, delayInMinutes: 1 }); runRetention() })
chrome.runtime.onStartup.addListener(runRetention)
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'ledger-retention') runRetention() })
```

The dashboard also calls `purgeLedgerOlderThan(retentionCutoff())` before its first read, so the guarantee does not depend on the alarm having fired.

**Tests that pin the behaviour** (Vitest with `fake-indexeddb`):

```ts
test('month window on the 31st does not overflow', () => {
  const tf = getTimeframe('month', new Date(2026, 2, 31, 10).getTime())
  expect(new Date(tf.start).getDate()).toBe(1)
  expect(new Date(tf.previous!.start).getMonth()).toBe(1) // February
})

test('3 months starts exactly three calendar months back at midnight', () => {
  const tf = getTimeframe('3months', new Date(2026, 10, 7, 15).getTime())
  expect(new Date(tf.start)).toEqual(new Date(2026, 7, 7, 0, 0, 0, 0))
})

test('purge deletes rows before the cutoff and keeps the boundary', async () => {
  const cutoff = retentionCutoff(new Date(2026, 10, 7, 15))
  await seed([{ id: 'old', addedAt: cutoff - 1 }, { id: 'edge', addedAt: cutoff }, { id: 'new', addedAt: cutoff + 1 }])
  expect(await purgeLedgerOlderThan(cutoff)).toBe(1)
  expect((await allIds()).sort()).toEqual(['edge', 'new'])
})
```

**Table column contract** (`packages/ui/DataTable`). Columns declare a kind and a priority; the component derives classes and responsive behaviour.

```ts
export type ColumnKind = 'id' | 'hash' | 'name' | 'email' | 'status' | 'number' | 'datetime' | 'enum' | 'text' | 'actions'
export interface Column<T> {
  key: string
  header: string
  kind: ColumnKind
  priority: 1 | 2 | 3            // 3 moves to the row detail below 960 px
  cell: (row: T) => ComponentChildren
  sortValue?: (row: T) => string | number
}
```

```css
.ns-table-wrap { container-type: inline-size; overflow-x: auto; }   /* labelled, focusable scroll region as a last resort */
.ns-table { width: 100%; table-layout: auto; border-collapse: collapse; }
.ns-table th, .ns-table td { padding: var(--t-space-2) var(--t-space-3); text-align: start; vertical-align: top; }
.col-id      { width: 1%; white-space: nowrap; font-variant-numeric: tabular-nums; }
.col-status, .col-number, .col-actions { width: 1%; white-space: nowrap; }
.col-number  { text-align: end; font-variant-numeric: tabular-nums; }
.col-name, .col-enum { min-width: 12ch; overflow-wrap: break-word; }
.col-email, .col-hash { min-width: 20ch; overflow-wrap: anywhere; }
.col-text    { width: 100%; min-width: 28ch; max-width: 75ch; overflow-wrap: break-word; text-wrap: pretty; }
@container (max-width: 59.9rem) { .prio-3 { display: none; } }          /* shown in the row detail instead */
@container (max-width: 39.9rem) { .ns-table { display: none; } .ns-recordlist { display: grid; gap: var(--t-space-3); } }
.ns-recordlist { display: none; }
```

The `width: 1%` plus `white-space: nowrap` pattern gives short columns exactly their content width, and `col-text` with `width: 100%` absorbs every spare pixel. `RecordList` is a sibling component rendered from the same column definitions (cards of label and value pairs), so table semantics are never stripped.

**ConfirmDialog on the native element** (with typed confirmation for irreversible actions such as crypto-shredding):

```tsx
export function ConfirmDialog({ open, title, consequences, confirmText, requireTyped, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [typed, setTyped] = useState('')
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  const ok = !requireTyped || typed === requireTyped
  return (
    <dialog ref={ref} role='alertdialog' aria-labelledby='cd-title' class='ns-dialog'
            onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <h2 id='cd-title'>{title}</h2>
      <ul>{consequences.map((c) => <li key={c}>{c}</li>)}</ul>
      {requireTyped && (
        <label>Type <code>{requireTyped}</code> to confirm
          <input value={typed} onInput={(e) => setTyped(e.currentTarget.value)} autoComplete='off' />
        </label>
      )}
      <div class='ns-dialog-actions'>
        <button autofocus onClick={onCancel}>Cancel</button>
        <button class='danger' disabled={!ok} onClick={onConfirm}>{confirmText}</button>
      </div>
    </dialog>
  )
}
```

The browser supplies the inert background, focus entry and return, and Escape handling; focus starts on Cancel. Use it to replace both `window.confirm` (D-07) and the six hand-built overlays (D-06).

**Theme boot** (`public/theme-init.js`, loaded from `<head>` as `<script src='./theme-init.js' data-surface='shopper'></script>`; external, so it respects the MV3 content-security policy). Chrome storage stays the source of truth; `localStorage` holds a synchronous mirror written by `ThemeContext`, so there is no flash and no second authority:

```js
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('ns.prefs') || '{}')
    var mode = p.mode || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    var r = document.documentElement
    r.dataset.mode = mode
    r.dataset.density = p.density || 'comfortable'
    r.dataset.surface = document.currentScript.dataset.surface
    r.style.colorScheme = mode
  } catch (e) {}
})()
```

**Truncation guard** (`e2e/no-truncation.spec.ts`; the probe is the one used for B8, generalised):

```ts
import { test, expect } from '@playwright/test'

const WIDTHS = [1440, 1280, 1024, 768, 390]
const ROUTES = ['audit', 'targets', 'modes', 'staff', 'history']

for (const w of WIDTHS) for (const route of ROUTES) {
  test(`no truncated or clipped cells: ${route} at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto(`/harness.html?route=${route}&fixture=worst-case`)
    const hits = await page.evaluate(() => {
      const out: string[] = []
      for (const el of document.querySelectorAll('table td, table th, [data-record] *')) {
        const cs = getComputedStyle(el) as any
        const label = (el.textContent ?? '').slice(0, 40)
        if (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) out.push('clamped: ' + label)
        if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') out.push('clipped: ' + label)
      }
      for (const t of document.querySelectorAll('table')) {
        for (let a = t.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX
          if (ox === 'auto' || ox === 'scroll') break
          if ((ox === 'hidden' || ox === 'clip') && t.getBoundingClientRect().right > a.getBoundingClientRect().right + 1) { out.push('table clipped by an ancestor'); break }
        }
      }
      return out
    })
    expect(hits).toEqual([])
  })
}
```

The `worst-case` fixture holds the longest realistic strings: 190-character clinical reasons, 76-character emails, 64-character hashes, 80-character product names, and Swahili strings (roughly 30% longer than English).

**Lint rules** (no regex backslashes needed):

```js
// eslint.config.js (excerpt)
{ files: ['src/ui/src/**/*.tsx'], rules: { 'no-restricted-syntax': ['error',
  { selector: "JSXAttribute[name.name='className'] Literal[value=/truncate|text-ellipsis|line-clamp/]",
    message: 'Data text must wrap. See the table contract (4.9).' },
  { selector: "JSXAttribute[name.name='className'] Literal[value=/-(slate|gray|zinc|emerald|rose|amber|red|blue|green|orange|purple)-[0-9]/]",
    message: 'Use semantic tokens, not palette classes.' } ] } }
```

```json
// .stylelintrc (excerpt)
{ "rules": { "declaration-property-value-disallowed-list": { "text-overflow": ["ellipsis"] }, "color-no-hex": true } }
```

Allow `color-no-hex` only in the generated tokens file through an override. Badges and chips may be exempted from the ellipsis rule by an explicit, reviewed allow-list, never by default.

### 5.4 File-by-file migration map

| Current file | Action | Phase |
| --- | --- | --- |
| `vite.config.ts`, `package.json` | Split configs; drop eight dead packages (keep `class-variance-authority`); preset; scripts per 5.1 | 1 |
| `styles/theme.css` (shadcn `oklch` set) | Delete; map the shadcn variables from semantic tokens in one place | 2 |
| `styles/health-modes.generated.css`, per-mode palettes in `health-modes.mjs` | Delete the recolour; keep mode labels and icons; condition identity becomes a neutral chip | 2 |
| `styles/tokens.css` | Replace with generated tokens; keep the spacing scale values | 2 |
| `styles/globals.css` | Keep resets; remove the `.cad-main` colour bridge and `.ui-*` rules as primitives land | 2–3 |
| `app/context/ThemeContext.tsx`, `public/theme-init.js` | Reduce to mode, density and accent; write the `ns.prefs` mirror; boot script in `<head>`; remove `next-themes` | 2 |
| `app/components/Dashboard.tsx` (926 lines) | Split into `ShopperHome`, `History`, `CarePlan`, `Privacy`; delete `rangeStart`, `year`, `all`, the full-bleed condition bands and the ‘Show details’ toggle | 6 |
| `dashboard.tsx` | Remove imperative `applyPersonalization` DOM edits; mount `ShopperShell` with the router | 6 |
| `app/components/charts/Charts.tsx` | Replace with `ProgressRing`, `Sparkline`, `TrendLine` (null gaps, no spline through gaps), `GradeStack`; tokens only; data-table alternative | 6 |
| `app/lib/db/analytics.ts` | Rewrite on `timeframes.ts`; filter by status; null-safe; no default grade | 6 |
| `app/lib/db/cart.ts`, `settings.ts` | Add `getEntriesSince`, `purgeLedgerOlderThan`, alarm wiring; purge `pending_cart_syncs` | 6 |
| `app/components/Popup.tsx`, `popup.tsx` | Redesign per 4.4; remove onboarding and premium routing; add `sidepanel` entry | 6 |
| `options/Options.tsx` | Fold into Care plan, Preferences and Privacy inside the shopper shell; `options.html` redirects | 6 |
| `OnboardingWizard.tsx`, `SubscriptionExpiredPage.tsx`, `usePaymentState`, `useSubscriptionGuard`, `onboarding.html/.tsx` | Delete; keep the consent text as a Consent screen | 8 |
| `cad/CadApp.tsx`, `navigation.ts` | Router plus shells; keep `getCadNavigationIds` and its tests; add group metadata (Care, Administer, Govern) | 4 |
| `cad/components/AppShell`, `Navigation`, `SidebarNavigation`, `SystemHealthBanner` | Replace with `ClinicalShell` and a queue-driven banner | 4 |
| `cad/views/*` (13 live views) | Re-skin onto primitives; per-view table changes in 4.9; real queries; three states each | 5, 7 |
| `cad/views/ClinicalOverview.tsx` | Delete (orphan; client-side suppression) | 8 |
| `cad/views/UserManagementView`, `AuditLogView`, `AuthContext` | Remove demo fallbacks (D-44); replace `alert()` with `PermissionGate` states | 1, 7 |
| `cad/views/PatientLinkingConsentView` | Typed-confirmation `ConfirmDialog` for crypto-shredding | 7 |
| `cad/context/AuthContext.tsx` | Real TOTP and `aal` handling (D-30) | 1b |
| `services/storage.ts`, `cad/supabaseClient.ts` | One slim client factory; shared `env.ts` | 1 |
| `app/__tests__/characterization.test.ts` | Update the `resolveTimeframe('week')` snapshot on purpose; add timeframe, purge and truncation suites | 6 |

### 5.5 Quality gates (add to `npm run ci` and `release:check`)

| Gate | Tool | Threshold |
| --- | --- | --- |
| Token contrast | `scripts/check-tokens.mjs` (WCAG relative luminance over every semantic text and surface pair, light and dark) | Text 4.5:1, large text and graphics 3:1, control borders 3:1; fails the build below |
| Accessibility | `@axe-core/playwright` on the gallery and every route at 1440 and 390 px, light and dark | Zero serious or critical violations |
| Truncation guard | Playwright spec from 5.3 | 0 ellipsised or clipped cells and 0 clipped tables at five widths with worst-case fixtures |
| Lint | ESLint (no palette classes, no `truncate` or `line-clamp`, jsx-a11y), stylelint (no hex, no ellipsis) | Zero errors |
| Bundle budgets | `scripts/check-budget.mjs` over `dist-ui` (eager gzip) | Popup at most 40 KB, dashboard at most 70 KB, side panel at most 60 KB, CAD at most 110 KB |
| Visual regression | Playwright `toHaveScreenshot`, 12 screens, 3 widths, light and dark | Under 0.2% pixel difference or an approved update |
| Unit and data | Vitest and `fake-indexeddb` | Timeframe boundaries, purge boundary, delta eligibility, null-gap charting, status filter |
| Compat smoke | Component tests under `preact/compat` for every third-party UI library | Run on every dependency upgrade |
| E2E: shopper | Playwright | Switch all four timeframes; delete an entry then undo; ‘Delete all my data’ requires typed confirmation; nothing older than the cutoff survives opening the dashboard |
| E2E: CAD | Playwright | Navigation matrix per role matches `getCadNavigationIds`; typed-confirm shredding; wrong MFA code rejected; no demo data in a production build |
| Manual | NVDA with Chrome and Firefox, VoiceOver, keyboard-only pass, 200% zoom, 400% reflow, forced-colors, reduced motion | Checklist signed per release |

### 5.6 Risks, dependencies and decisions for you

| Item | Why it matters | Suggested handling |
| --- | --- | --- |
| Preact compatibility of third-party UI libraries | TanStack, visx and wouter generally work under `preact/compat`, but regressions are silent | Pin versions; compat smoke tests; fall back to headless cores |
| Removing condition recolour | Some users may like it | Offer a user-chosen accent (mint, blue, coral); never condition-driven |
| Nutri-Score branding | The charter fixes colours and requires registration for official modules | Decided: official modules. Register for the right of use and follow the charter; nothing may redraw, recolour or restyle them (5.7) |
| 3-month retention scope | Clinician views and Supabase rows may still show older data | Resolved: 3 months for UI and device data; server and clinician data follow Kenyan health-data retention (default 20 years, legal confirmation required) |
| Hosting the CAD on its own origin | Changes auth storage, CSP and redirect URLs | Plan the cut-over; the static build deploys to whichever host your infrastructure plan selects |
| Real shared modules | My render used stand-ins for `src/shared/*` | Re-run the harness against the real modules before trusting auth and storage findings |
| Items-chosen definition | Whether `in_cart` counts changes every KPI | Decide in Phase 6 (default: `purchased` plus `in_cart`) |
| Swahili strings | About 30% longer than English; stresses tables and buttons | Include in the worst-case fixture from Phase 5 |
| Test churn | One snapshot changes by design | Update it in the same commit as `timeframes.ts` |

**Questions I need answered:** all five were answered on 7 November 2026; see 5.7.

### 5.7 Decisions recorded (7 November 2026)

| # | Question | Decision | Consequence for the plan |
| --- | --- | --- | --- |
| 1 | CAD hosting | **Hosted separately** | Own build, container and origin (5.1), `base: '/'`, history routing, strict CSP. No admin code in the extension package |
| 2 | Side panel | **In scope** | `sidepanel.html`, manifest `side_panel` and the `sidePanel` permission (verify its install prompt in Chrome’s documentation), the basket-check layout in 4.4, eager budget of 60 KB gzip |
| 3 | Nutri-Score graphics | **Official modules** | Use the official asset pack unaltered: no redrawing, recolouring or non-proportional scaling; follow the charter’s placement rules. Registration for the right of use is a human gate before release. ‘Not rated’ and ‘Limited nutrition info’ are separate components, never a variant of the logo. The release build fails if the asset pack is absent |
| 4 | Retention | **Split** | Device and UI data: 3 months (4.10), enforced by the client purge and by a UI window that never asks for older data. Clinician views and server storage: Kenyan health-data retention, **default 20 years, pending legal confirmation**, implemented as one configurable policy (`CLINICAL_RETENTION_YEARS`) enforced in the database; the 3-month purge never runs server-side. The audit screen already cites DPA s.46 and HIM Reg 24; have counsel confirm the period before production |
| 5 | Typeface | **Inter Variable only** | One family on both surfaces; shopper hero figures use weight 700–800 with tabular numerals. Distinction comes from scale, weight, radius and density, which also saves about 20 KB |

---

## 6. Appendix

### A. Verification log (what I ran)

| Step | Result |
| --- | --- |
| `npm ci --ignore-scripts` from your lockfile | 369 packages installed on Linux (optional platform binaries skipped); lockfile v3 lists 508 |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `vite build` with five stand-in shared modules and a mock `.env` | 1,032 modules transformed; succeeded in about 8 s; five HTML entries emitted |
| Eager payload per page (static import graph, gzip) | Popup 85.5 KB, Dashboard 108.7 KB, Options 101.8 KB, Onboarding 89.8 KB, CAD 111.6 KB |
| Shared chunk composition (source maps) | 249 KB minified; Supabase about 91% (auth-js 46%, storage-js 12%, postgrest-js 12%, realtime-js 11%, phoenix 6%, supabase-js 4%); Preact 2.8% |
| Render harness | Vite dev server plus Playwright with Chromium 153; seeded IndexedDB (125 days, 10 long product names), `chrome.*` mock, session seeded for each CAD role, Supabase REST intercepted with worst-case fixtures |
| Widths | Shopper pages at 1440, 1024, 768, 480; popup at 360; CAD at 1440 and 1024 (768 not captured: the rail is off-canvas) |
| DOM probe | Counts ellipsised or line-clamped cells, clipped cells, and tables wider than an `overflow: hidden` ancestor |
| Colour mathematics | WCAG relative-luminance contrast, CIE76 ΔE, Machado (2009) colour-vision-deficiency simulation for protan, deutan and tritan |
| Not run | `typecheck`, `lint`, `format:check` (no config files shared), the 50 test files, any real Supabase call |

An evidence kit accompanies this report: the harness, the stand-ins, the probe and screenshot scripts, the colour scripts and the screenshots referred to above, with a README for reproducing every number.

### B. Sources

Opened and read in full for this report: the W3C Design Tokens Community Group announcement of the first stable specification (2025.10, 28 October 2025); the Extension.js guide to popup sizing (800×600 clamp, 25×25 minimum, fixed width, no viewport units); MDN’s `<dialog>` reference (Baseline widely available since March 2022; modal inert background, Escape handling, `alertdialog` permitted).

Consulted through search results and not opened individually; verify the figures before citing them formally:

- Healthcare UX principles and override-rate range: themomentum.ai, blog post at the path /blog/healthcare-ux-design-principles-patient-provider-apps.
- Tiered versus untiered alert compliance (about 29% vs 10%): IOS Press, conference paper comparing tiered and untiered drug-interaction alerts at two academic medical centres (ebooks.iospress.nl, DOI 10.3233/978-1-60750-806-9-930).
- Alert-fatigue systematic review: eScholarship, `escholarship.org/uc/item/4v79x7m6`; Halo Lab, ‘Alert fatigue in healthcare software’.
- WCAG 2.2 new criteria: Deque University (`dequeuniversity.com/resources/wcag-2.2`); TetraLogical, ‘What’s new in WCAG 2.2’.
- Nutri-Score graphic charter and rules: Santé publique France (`santepubliquefrance.fr/en/Nutri-Score`); charter PDF at `ral.de/app/uploads/2024/12/charta-nutri-score-en.pdf`.
- Dashboard hierarchy and layout practice: uxpilot.ai, ’12 Dashboard Design Principles’; FusionCharts, ‘Dashboard Design Best Practices’.
- Admin table patterns: AWS Cloudscape, ‘Table view’ (`cloudscape.design/patterns/resource-management/view/table-view/`).

Everything about your code (counts, line references, defects) comes from your archive and files, and every colour ratio from my own computation.
