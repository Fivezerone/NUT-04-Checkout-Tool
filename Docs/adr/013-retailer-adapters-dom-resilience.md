# ADR-013: Multi-Engine Retailer Adapter Architecture & DOM Mutation Resilience

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Browser Extension Team
- **References:** `src/extension/adapters/`, `src/extension/scanner.js`, `Docs/NUT-04 Checkout Tool — Technical Implementation & Refactoring Strategy.md` (Section 2)

---

## Context
The NUT-04 Chrome extension operates on three major supermarket e-commerce websites in Kenya: **Quickmart**, **Naivas**, and **Carrefour**. These retailers use fundamentally different frontend architectures:
1. **Quickmart (Growcer CMS):** Traditional server-rendered multi-page application. Each search or navigation causes a full page load with static HTML forms and stable numeric product IDs.
2. **Naivas (Laravel Livewire v3 + Tailwind / Alpine):** Highly dynamic Single-Page Application (SPA) where DOM morphing replaces inner HTML fragments on component updates without full-page reloads.
3. **Carrefour (Vue.js / Nuxt SPA):** Client-side rendered virtual DOM with lazy-loaded infinite scrolling, dynamic off-canvas carts, and client-side route transitions.
4. **Historical Failures (G-15, G-23, N1-N5):** In earlier iterations, Naivas and Carrefour broke silently. Static analysis revealed:
   - Observers bound once to a header or single element and never re-bound upon client route change.
   - Livewire DOM morphs erased injected badges while `WeakSet` caches considered cards "already processed", leaving cards badge-less.
   - Badge product IDs and cart action IDs belonged to different namespaces, breaking cart diffing.
   - Adapter tests lacked DOM fixture assertions, allowing selector regressions to pass CI unnoticed.

---

## Decision
We implement a **Unified Multi-Engine Retailer Adapter Architecture** with anchor-first discovery and self-healing MutationObserver loops:

1. **Uniform Adapter Interface (`src/extension/adapters/`):**
   - Every retailer adapter (`quickmart.js`, `naivas.js`, `carrefour.js`) implements a strict contract:
     - `getRetailerCode()`: `'quickmart' | 'naivas' | 'carrefour'`
     - `getObserveTarget()`: Resolves live root (defaults to `document.body` for SPAs)
     - `candidatesIn(root)`: Anchor-first product card discovery
     - `inject(el, result)`: Injects badge inside an isolated Shadow DOM host (`NutriSharedUI._ensureGlobalPortal`)
     - `extractCartState()`: Multi-tier cart extraction (drawer DOM, API intercept, and fallback)
     - `extractCartAction(node)`: Normalizes click events on "Add to Cart"
     - `detectOrderConfirmation()`: Detects successful checkout
2. **Anchor-First Card Discovery (`candidatesIn`):**
   - Rather than relying on fragile outer card container class names (which change between retailer marketing campaigns), discovery searches for stable product link anchors (`a[href*='/products/']`, `a[href*='/p/']`) and ascends upward using `.closest(CARD_SELECTOR)`.
   - Checks `scope.matches()`, `scope.querySelectorAll()`, and `root.closest()` to survive partial re-renders and inner DOM morphs.
3. **Self-Healing Reconcile Loop & Mutation Tracking:**
   - The scanner (`src/extension/scanner.js`) monitors both `addedNodes` and removals.
   - If a Livewire morph removes the badge host, the card's seen flag is reset, and the badge is immediately re-injected on the next animation frame.
4. **Shadow DOM Style Isolation:**
   - All injected badges and flyout cards render inside Shadow DOM roots (`NutriSharedUI._ensureGlobalPortal`). This prevents retailer CSS styles from corrupting the badge, and prevents extension styles from breaking the retailer's layout.
5. **Fixture-Based Contract Testing:**
   - Adapter unit tests (`src/ui/src/app/__tests__/*-adapter.test.ts`) test realistic DOM HTML snapshots with JSDOM, asserting candidate discovery, ID resolution, and cart extraction.

---

## Consequences & Rules

### Positive Consequences
- **Resilient to Retailer Updates:** Anchor-first ascending discovery survives 90%+ of retailer frontend styling changes.
- **Zero Style Bleed:** Shadow DOM portals guarantee pixel-perfect badge rendering without interfering with supermarket checkout flows.
- **Automated Regression Catching:** Any change to retailer selectors is tested against recorded DOM fixtures in CI.

### Trade-offs & Operational Risks
- **DOM Maintenance:** Retailers periodically redesign URL structures or cart APIs, requiring scheduled smoke tests.

### Strict Enforcement Rules
1. **Always Use Anchor-First Discovery:** Never discover product cards using top-level layout classes alone (`div.col-4`); always key off semantic anchor links or product inputs.
2. **Always Inject Inside Shadow DOM:** Extension elements must never inject raw unencapsulated CSS or unshadowed elements directly into the retailer's host DOM.
3. **Single Product ID Namespace:** An adapter must use the exact same ID extraction function (`extractProductRef`) for both badge injection and cart ledger tracking.

