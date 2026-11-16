# ADR-011: 3-Tier Design System Token Architecture & UI Surface Decoupling

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & UI/UX Design System Team
- **References:** `src/ui/src/styles/tokens.css`, `Docs/ui-ux-overhaul-report.md`, commits `fe213295`, `630d2493`

---

## Context
Prior to Stage C, the user interface suffered from critical architectural coupling and design system divergence:
1. **Hardcoded Color Divergence:** NutriScore grade colors were defined inconsistently across three files with mismatched hex values (e.g., Grade A was `#037b3e` in `grade-colors.js` and `#038141` in `GradeBadge.tsx` and `tokens.css`; text contrast on Grade C failed WCAG AA).
2. **Surface Entanglement:** The Chrome extension shopper surface (popup/sidepanel) and the Clinic Admin Dashboard (CAD) shared mixed Vite entry points and duplicate bundle configurations, leading to duplicate React runtimes and white-screen startup errors in production.
3. **Accessibility (a11y) Violations:** Interactive primitives lacked proper ARIA attributes, semantic roles, and focus outlines, violating WCAG 2.1 AA healthcare accessibility standards.
4. **Direct Utility Overuse:** Ad-hoc Tailwind utility classes (`bg-emerald-600`, `text-slate-900`) made systematic institutional theme switching (e.g., high-contrast clinic modes, dark mode) impossible.

---

## Decision
We implement a **3-Tier Design System Token Architecture** and enforce strict decoupling between the Shopper Surface and the Clinic Admin Dashboard:

### 1. 3-Tier CSS Custom Property Token Hierarchy (`src/ui/src/styles/tokens.css`)
- **Tier 1 (Global Primitives):** Raw color palettes, base font metrics, and physical spacing values (e.g., `--color-green-700: #038141`, `--space-4: 1rem`).
- **Tier 2 (Semantic Tokens):** Functional roles across the application domain (e.g., `--t-color-grade-a: var(--color-green-700)`, `--t-color-surface-card`, `--t-color-text-primary`, `--t-color-border-subtle`).
- **Tier 3 (Component Tokens):** Component-specific bindings (e.g., `--badge-grade-a-bg`, `--kpi-metric-font-size`).

### 2. Standardized Accessible Primitives (`src/ui/src/app/components/ui/`)
- `GradeBadge`: Renders canonical NutriScore 5-tier grades (A, B, C, D, E) with verified WCAG 2.1 AA color contrast ratios (minimum 4.5:1 against light and dark backgrounds).
- `ConditionChip`: Displays non-stigmatizing health focus chips with semantic icons and accessible tooltips.
- `TargetMeter`: Accessible SVG progress indicator displaying adherence against clinical targets with numeric readouts for screen readers.
- `KpiCard`: Institutional metric presentation with trend indicators and status badges.
- `ConfirmDialog`: Typed-phrase destructive confirmation modal (e.g., requiring the clinician to type `"SHRED"` before executing crypto-shredding).

### 3. Strict Surface Decoupling
- **Shopper Surface:** Scoped to the Chrome extension popup and sidepanel (`src/ui/src/app/`), built into `./dist/extension`.
- **CAD Surface:** Scoped to the Clinic Admin Dashboard (`src/ui/src/cad/`), built into `./dist-ui/cad`, and served in production via a dedicated unprivileged Nginx container reverse-proxied by Caddy at `/cad/`.

---

## Consequences & Rules

### Positive Consequences
- **Institutional Consistency:** Colors, spacing, and typography are mathematically aligned between the browser extension and CAD.
- **Zero White-Screen Duplicate Dist Bundles:** Decoupled build pipelines (`build:ui`, `build:cad`, `build:ext`) eliminate bundle collisions.
- **Full WCAG 2.1 AA Compliance:** High-contrast text, clear visual indicators, and semantic markup ensure usability for all healthcare users.

### Trade-offs & Operational Risks
- **Token Discipline:** Developers must reference semantic CSS tokens (`var(--t-color-...)`) rather than using raw arbitrary Tailwind hex colors (`bg-[#038141]`).

### Strict Enforcement Rules
1. **Never Hardcode Grade Colors:** All NutriScore grade styles must use `--t-color-grade-[a-e]`.
2. **Never Import CAD Views into Extension Popup:** The extension popup must remain lightweight and isolated from CAD administrative components.
3. **Mandatory Typed-Phrase Confirmations:** Irreversible actions (crypto-shredding, clinic deletion) must use `ConfirmDialog` with typed phrase verification.

