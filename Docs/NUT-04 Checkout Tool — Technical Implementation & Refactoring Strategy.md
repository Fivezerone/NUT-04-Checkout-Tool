# NUT-04 Checkout Tool — Technical Implementation & Refactoring Strategy

*Prepared 12 November 2026 · Cross-references the Business Model Blueprint and the Clinical Data Pipeline, Analytics Engine & Compliance Architecture Strategy against the uploaded repository (NUT-04\_Checkout\_Tool.rar, extension v1.1.0, IndexedDB schema v18) · Audience: Lead engineers, security lead, data lead*

## 0. How this audit was done, and what it could not see

Every finding carries an evidence tag. **\[V\]** means I read the code and the behaviour follows from it. **\[I\]** means an inference from static reading that needs a live-page capture to confirm. **\[N\]** means I did not inspect it.

**Read closely:** manifest.json; content.js; scanner.js; adapters/quickmart.js (all), naivas.js and carrefour.js (detection, cart and order logic), shared-ui.js (all), adapter-factory.js and declarative-engine.js (head); background.js (message routing, getProductInfo, appendPremiumAssessment); db.js (schema and store definitions); shared/dpt.ts, commercial-catalogue.ts, consent.ts, authz.ts (permission matrix), claims.ts (roles); observed-orders-sync.js; styles/tokens.css; GradeBadge.tsx, ConditionChip.tsx and TargetMeter.tsx (heads); cad/views/CommercialInsightsView.tsx; a repository-wide scan of the CAD views for TODO markers; the adapter tests.

**Not read line by line \[N\]:** db.js beyond the schema, Dashboard.tsx, Options.tsx, HealthModesView.tsx, entitlement.js, catalog-sync.js beyond the atomic-swap section, patient-export.ts, target-sync.ts, field-encryption.ts, key-wrapper.ts, the product JSON files and most of the 46 test files.

**Missing from the archive:** the `scripts/` directory that package.json calls (build-db, build-ext, build-cad-dist, check-manifest-globals, check-cad-security, verify-audit-chain, check-no-hardcoded-data and others), any `supabase/` folder (migrations, edge functions), any server-side SQL, and the CAD Vite entry configuration. The database audit therefore covers the IndexedDB schema and the TypeScript data contracts in `src/shared`; the PostgreSQL DDL in Section 5 is new design, not a diff against existing migrations.

**Not executed:** I did not run npm install, the build, or the test suite, and I had no access to live Naivas, Carrefour or Quickmart pages. Every selector-level root cause for Naivas and Carrefour is therefore **\[I\]**. Section 2.5 gives a 30-minute capture protocol that turns each one into a confirmed or rejected finding before anyone rewrites a selector.

## 1. Codebase audit and gap analysis

### 1.1 What already aligns with the reports

The repository is further along than the extension code suggests. These pieces match the reports and should be kept and extended:

- **Dietary Profile Token machinery** (shared/dpt.ts): allow-listed constraint keys (`ALLOWLISTED_KEYS`), condition-name rejection (`CONDITION_NAMED_PATTERNS`), device-only dimensions dropped (`DEVICE_ONLY_KEYS`), `mintDpt` with Ed25519 signing through `Signer`, `verifyDpt`, and DPoP binding (shared/dpop.ts). This is the semantic-only token the reports call for.
- **Authorisation engine** (shared/authz.ts): `decide()` with RBAC (`PERMISSIONS`), clearance classes (`CLEARANCE`: PHI1, PHI2, ADMIN, COMMERCIAL, AUDIT, AUDIT\_META), step-up rules (`STEP_UP`) and obligations (`audit()`, `notifyDpo()`).
- **Privacy primitives:** `evaluateCohortSuppression` (small-cell suppression), `applyCohortGate`, field encryption with blind indexes (shared/field-encryption.ts), signed patient export (shared/patient-export.ts).
- **Extension footprint:** the manifest has no remote code, an MV3 default CSP, and only three permissions (`alarms`, `storage`, `scripting`); scoring runs on the device from bundled data; the flyout renders inside a Shadow DOM portal (`NutriSharedUI._ensureGlobalPortal`).
- **Design system:** `styles/tokens.css` defines institutional spacing, type, colour and grade tokens, and `components/ui/` holds `GradeBadge`, `ConditionChip`, `TargetMeter`, `KpiCard` and `ConfirmDialog`.

The gap is mainly **wiring and coverage**: the extension does not consume the token, the engines are per-product rather than per-basket, and the adapters for the two SPA retailers lack the lifecycle handling that the server-rendered Quickmart site never needed.

### 1.2 Impact matrix

Severity: **C** critical (patient-safety or privacy-breaking), **H** high, **M** medium, **L** low.

| ID | Gap | Affected files | Sev | Tag | Downstream impact |
| --- | --- | --- | --- | --- | --- |
| G-01 | The extension does not consume the Dietary Profile Token. Alerts come from `NutriScoreDB.getSettings().activeTheme` (one condition label) and fixed per-100 g thresholds | background.js (`getBatchContext`, `appendPremiumAssessment`), db.js (settings), shared/dpt.ts | C | V | Prescription never reaches the aisle; every patient sees generic thresholds. Blocks the swap lifecycle and adherence scoring |
| G-02 | DPT vocabulary has six per-100 g dimensions only: no per-day budgets, weights, household size, hard exclusions, block mode, minimum confidence | shared/dpt.ts (`ALLOWLISTED_KEYS`, `DptPayload`), claims.schema.json | H | V | Adherence and variance scoring (report 2, Section 3) cannot be computed from the token |
| G-03 | `bandValue()` rounds maximum limits **up** to the next band (a 500 mg limit becomes 600 mg) | shared/dpt.ts | H | V | The token is looser than the prescription, so a product can pass although it breaks the clinician’s limit. Privacy banding and clinical safety conflict |
| G-04 | `evaluateSkuAgainstConstraints()` treats a missing nutrient as conforming, and ignores `review_state` | shared/commercial-catalogue.ts | C | V | A swap candidate with unknown nutrition can be recommended as safe. Violates fail-open-on-block but fail-closed-on-recommend |
| G-05 | No swap, alternatives or voucher code anywhere (only an atomic-swap sync pattern and a stale comment) | shared-ui.js, catalog-sync.js | H | V | The Smart Compare & Swap concept and the insurer-voucher value hook do not exist in code |
| G-06 | No adherence or variance engine. ‘Adherence’ appears only as UI components | TargetMeter.tsx, Dashboard.tsx, CommercialInsightsView.tsx | H | V | No Nutritional Adherence Score, no Variance Score, nothing for hospital or insurer reports |
| G-07 | Hard-coded demo metrics in production CAD: cohorts ‘3’, target adherence ‘74.2%’, programme adherence 76/68/82% | cad/views/CommercialInsightsView.tsx | H | V | A commercial stakeholder sees invented outcomes. Contradicts the no-hard-coded-data rule in package.json `ci` |
| G-08 | CAD data layer is stubbed: AuthContext, UserManagementView, AuditLogView, TenantSettingsView, PatientLinkingConsentView and ClinicianWorkspaceView all carry ‘TODO (Stage C)’ with no API calls | cad/context/AuthContext.tsx and the views listed | H | V | No live identity, audit, consent or provisioning. Every stakeholder-access claim in the reports is unimplemented in the UI |
| G-09 | `cryptoShredPatient()` is a stub: uses `Math.random()`, keeps the first four characters of the patient reference, and deletes no key | shared/consent.ts | H | V | Erasure is claimed (invariant T27) but not performed; leaks a reference prefix |
| G-10 | `deriveShopperAlias('order')` HMAC input is patientId + epoch, with no retailer identifier; `deriveTenantAlias` falls back to a constant salt | shared/dpt.ts | H | V | The same alias appears at every retailer within an epoch, so cross-retailer linkage is possible. Report 2 requires per-retailer, per-epoch derivation |
| G-11 | Only seven roles. There is no insurer role and no separate retailer role; `commercial_stakeholder` covers both and can read `commercial_orders`. `super_admin` holds `target_bundles:read` | shared/claims.ts (`CAD_ROLES`), shared/authz.ts (`PERMISSIONS`) | H | V | Insurer (T4) and retailer (T5) data cannot be provisioned separately; platform staff can read health-inferable targets |
| G-12 | Cohort threshold k = 5 everywhere; no per-cell order suppression, no noise | shared/consent.ts, dpt.ts | M | V | Below the k ≥ 20 release rule in report 2 (Section 4.5) |
| G-13 | `observed-orders-sync.js` is not loaded by the manifest or the service worker, defaults to `http://127.0.0.1:54321` (cleartext, local Supabase), and the extension has no code that obtains a DPT or DPoP key | extension/observed-orders-sync.js | M | V | The Phase 8 ledger sync is dead code. The URL would fail the Web Store review if enabled |
| G-14 | `adapter-factory.js` and `declarative-engine.js` are ES modules that nothing in the manifest or runtime loads; only tests import them | extension/adapters/ | M | V | The declarative, kill-switchable adapter design exists but is unused. Reuse it (Section 2.6) |
| G-15 | Adapter tests are contract-only: no DOM fixtures, no jsdom environment in the three adapter test files | **tests**/carrefour-naivas-adapters.test.ts, quickmart-adapter.test.ts | H | V | A selector regression on Naivas or Carrefour passes CI. This is why the breakage went unnoticed |
| G-16 | Manifest declares `scripting` but no code uses it; `web_accessible_resources` exposes `data/*.json` (about 21 MB of catalogue) to every page on the five retailer origins | extension/manifest.json | M | V | Least-privilege breach; lets retailer pages detect the extension and copy the dataset |
| G-17 | Health thresholds exist in at least five places with different values: background.js fallback block, `DISEASE_RULES` (disease-engine.js), `MEDICAL_THRESHOLDS` (context-engine.js), `BANDS` and `GENERIC_HEALTHY_EATING_PROFILE` (dpt.ts), shared/health-modes.mjs | background.js, pipeline/disease-engine.js, engine/context-engine.js, shared/dpt.ts, shared/health-modes.mjs | M | V | Two screens can disagree about the same product; kidney sodium is 600 mg per 100 g in one place and 200 mg per serving in another |
| G-18 | Grade colours are defined three times with different values (A is #037b3e in grade-colors.js and #038141 in GradeBadge.tsx and tokens.css; B, C and D text colours differ) | adapters/grade-colors.js, ui/GradeBadge.tsx, styles/tokens.css | L | V | Visual and contrast inconsistency between flyout and popup |
| G-19 | content.js carries an unreachable legacy path (`scanAndInject`, `processedElements`, `notFoundCache`, a first `this.observer` that is created and then replaced); `NutriScanner._onMutations` ends with a no-op `if (...) return;` | extension/content.js, scanner.js | L | V | Dead code and a misleading read of the observer lifecycle |
| G-20 | Telemetry vocabulary is thin. Messages are CHECK\_PRODUCT\_SCORES\_BATCH, LOG\_CART\_ADD, SYNC\_CART\_STATE, REMOVE\_CART\_ITEM, CART\_CLEARED, ORDER\_PLACED, POPUP\_STATS\_UPDATE, CART\_UPDATED. There is no Badge\_Render, Blocked\_Attempt, Swap\_Recommended or Swap\_Accepted, and no consent reference or episode id | extension/background.js, content.js | H | V | The reports’ event model cannot be produced; no stakeholder metric can be built |
| G-21 | Premium-tier code remains in the scoring path (`currentTier()`, `appendPremiumAssessment`, `premium_assessments` store, `entitlement.js`) although identity moved to the CAD-only model | background.js, entitlement.js, db.js | M | V | Health alerts are gated on a tier instead of on a clinician-signed profile; must be removed before the swap flow depends on it |
| G-22 | `cryptoShred`, audit obligations and ledger verification have no writer: `audit()` returns an obligation, and `verify:audit` points to a script that is not in the archive | shared/authz.ts, package.json | H | V | The WORM audit trail in report 2 (Section 5.4) is not evidenced |
| G-23 | Naivas and Carrefour badge rendering and cart-entry detection failures (detailed in Section 2) | adapters/naivas.js, carrefour.js, content.js, scanner.js | H | I | Two of three retailers show no badges or wrong cart data |
| G-24 | `_cartFromLivewireV3Snapshot` reads `data.cartItems` as plain JSON; Livewire v3 snapshots tuple-encode nested arrays | adapters/naivas.js | M | I | Cart API fallback probably returns nothing |
| G-25 | No FHIR ingestion, consent client, or revocation-list check in the extension | extension/\* | M | V | Clinical ingestion and revocation SLAs (report 2, Sections 1.2 and 5.4) are unimplemented on the device |

### 1.3 Five findings that should change this quarter’s plan

1. **G-04 and G-03 are patient-safety defects, not polish.** A recommender that passes unknown nutrition, and a token that loosens limits, together can tell a hypertensive patient that an over-limit product is a safe swap. Fix both before any swap UI ships.
2. **G-01 means the product does not yet do what the reports describe.** Until the extension holds and verifies a signed token, everything downstream (variance, adherence, vouchers) is cosmetic.
3. **G-15 explains how Naivas and Carrefour broke unseen.** Fixture-based tests are the cheapest durable fix.
4. **G-07 and G-08 mean the CAD cannot yet support the stakeholder-access story.** Do not demo commercial numbers until live data replaces the literals.
5. **G-10 and G-11 must be fixed before any insurer or retailer receives data**, because they decide whether linkage and over-broad access are possible.

## 2. Retailer adapter diagnosis and parity blueprint (Quickmart benchmark)

### 2.1 The shared contract today

All three adapters expose the same surface, which `scanner.js` and `content.js` rely on: `getRetailerCode()`, `getObserveTarget()`, `candidatesIn(root)`, `inject(el, result)`, `detectProducts()`, `injectBadge()`, `extractCartState()`, `fetchCartFromAPI()`, `extractCartAction(node)`, `extractRemoveAction(node)`, `detectOrderConfirmation()`, plus `_parseCard()` helpers. The orchestration is `content.js` (`NutriScoreContentEngine.init`) creating one `NutriScanner(adapter, safeSend, observeTarget)` and one cart observer, both bound **once** to the element that `getObserveTarget()` returned at start-up.

### 2.2 Why Quickmart works

| # | Property of the Quickmart adapter | Why it matters |
| --- | --- | --- |
| Q1 | The site is server-rendered (Growcer). Each navigation is a full page load, so the content script re-runs `init()` and re-resolves `getObserveTarget()` | The stale-observer problem cannot occur |
| Q2 | Product ID comes from stable sources in a defined order: `input[name=selprod_id]`, `data-product-id`/`data-selprod-id`, then the `frmBuyProd-<id>` form id. Cart actions, cart state and cart API use the same numeric ID | Badge, cart ledger and catalogue key on the same identifier |
| Q3 | Discovery is anchor-first: `a.products-title` and `a[href*='/products/view/']`, then `.closest()` upward to a card. `candidatesIn(root)` therefore finds the card even when only a descendant was added | Survives partial re-renders |
| Q4 | `extractCartAction` matches many button shapes (`btnAddToCart`, `.add-to-cart--js`, `[data-action=add-to-cart]`) and falls back to a text test \`add to cart | quick add |
| Q5 | Cart extraction has three layers: the off-canvas drawer (`#sideCartJs`), three JSON endpoints in `fetchCartFromAPI`, and DOM fallbacks | Resilient to one layer changing |
| Q6 | `detectOrderConfirmation` combines URL patterns, DOM signals and heading text | Fewer missed orders |
| Q7 | Data is keyed on `Identity.ProductID` in `quickmartProducts` (db.js, store with `by-url` and `by-name` indexes) | Lookup parity with the ID the adapter emits |

**Quickmart’s own weaknesses, to fix while unifying:** `_parseCard` returns `nameHash: null`; the generic card selectors `.product` and `li.product-item` can match non-product nodes; `extractCartAction` falls back to `document.body` as the card, which can pick the wrong product; `candidatesIn` and `detectProducts` duplicate the same discovery code; the three cart API endpoints are guesses without a recorded response shape.

### 2.3 Root causes on Naivas (Livewire/Tailwind) \[all I unless marked\]

| ID | Finding | Evidence | Fix |
| --- | --- | --- | --- |
| N1 | **Observe root is the wrong node and is never re-resolved.** `getObserveTarget()` tries a Magento selector (`.products.list.items.product-items`) first, then the first `[wire:id]` element. On a Livewire page the first component is usually navigation or header, not the product list. `NutriScanner.start()` and the cart `MutationObserver` observe that single node forever | naivas.js `getObserveTarget`; content.js `init()` \[V that it is bound once\] | Observe `document.body` (or re-bind on navigation, Section 2.4) |
| N2 | **Card discovery misses partial re-renders.** `candidatesIn(root)` checks `scope.matches(selector)` and `scope.querySelectorAll(selector)` but never `root.closest(selector)`. When Livewire or Alpine morph replaces nodes *inside* an existing card, the added root is a descendant of the card and no candidate is found. Quickmart and Carrefour avoid this through anchor-then-`closest` discovery | naivas.js `candidatesIn` \[V that `closest` is absent\] | Anchor-first discovery plus `root.closest(CARD)` |
| N3 | **Badges are wiped by the morph and never restored.** `scanner._seen` is a WeakSet that remembers the card, `_onMutations` looks only at `addedNodes`, and nothing handles our badge host being removed. After the first Livewire update the card is ‘seen’ but badge-less | scanner.js `_onMutations`, `_drainRoots` \[V that removals are ignored\] | Self-healing reconcile loop (Section 2.4, item 3) |
| N4 | **Badge ID and cart ID are different namespaces.** `_parseCard` reads `data-product-id` or `data-sku`, else `generateIdFromName(name)` (`synth_…`). Cart actions read the numeric ID from `wire:click="addToCart(ID)"` and `redirectToProductPage(ID)`. The ledger therefore holds numeric IDs while catalogue lookups use name-derived IDs | naivas.js `_parseCard` vs `extractCartAction`, `extractCartState` \[V\] | One `extractProductRef(card)` used by both paths, preferring the Livewire numeric ID |
| N5 | **Cart-add detection finds no card.** `extractCartAction` resolves the card with \`closest('.product-item, \[class\*="product-card"\], li, article') |  | parentElement` , but listing cards are found with  `\[class\*='border-naivas-bg'\]\`. The two lookups disagree, so on listing pages the card falls back to the button’s parent, no name is found, and the function returns null |
| N6 | **Magento leftovers.** `_cartFromMagentoSections` (`/customer/section/load`), the `.tocart` branch, and the Magento order-success URLs in `detectOrderConfirmation` belong to the retired platform | naivas.js \[V\] | Remove after confirming the live stack |
| N7 | **Livewire v3 snapshot shape.** Nested arrays in `wire:snapshot` are tuple-encoded (`[value, {s: 'arr'}]`), so `data.cartItems.filter(i => i.id)` likely yields nothing | naivas.js `_cartFromLivewireV3Snapshot` | Decode tuples, or read the DOM instead |
| N8 | **Click handler runs in the bubble phase** (`document.addEventListener('click', …)` in content.js). If a Livewire or Alpine handler stops propagation, the adapter never sees the click | content.js `init()` | Register with `{ capture: true }` |

### 2.4 Root causes on Carrefour (Next.js/React) \[all I unless marked\]

| ID | Finding | Evidence | Fix |
| --- | --- | --- | --- |
| C1 | **Stale observe root after client navigation.** `getObserveTarget()` returns `[data-testid='product-grid']`, `.product-grid` or `#__next main`, resolved once. In a Next.js app a route change replaces the grid node, leaving the observer on a detached element. `_startNavMonitor` reacts to navigation only by calling `syncCart` and `checkOrderConfirmation`; it does not rescan or re-bind | carrefour.js `getObserveTarget`; content.js `_startNavMonitor` \[V code\] | Navigation hook that re-binds the scanner and calls `rescan()` |
| C2 | **Badge lost on React commits.** The host is appended into a React-managed card; any re-render of that card can drop it, and the same missing removal handling as N3 prevents recovery | scanner.js; shared-ui.js `injectBadge` (`card.appendChild`) \[V mechanism\] | Reconcile loop, or a body-level overlay layer |
| C3 | **Wrong name or price from union selectors.** `_parseCard` uses `card.querySelector("[data-testid='product-title'], h2, h3, h4, [class*='title'], [class*='name'], …")`. `querySelector` returns the first match in document order, not selector priority, so a promotion label or brand block can be picked as the name. Price uses `[class*='price']` and can pick a strike-through or unit price | carrefour.js `_parseCard` \[V code\] | Ordered lookup, one selector at a time |
| C4 | **Wrong product logged on cart add.** `extractCartAction` accepts only a `<button>` whose aria-label or text contains ‘add to cart’, and resolves the card as \`closest('li') |  | \[data-testid=product-card\] |
| C5 | **Cart DOM depends on a utility-class chain** (`.relative.flex.items-start.gap-md`) and on a trash icon or combobox being present | carrefour.js `extractCartState` \[V\] | Anchor-first extraction by product link, then `closest`; data-testid where available |
| C6 | **ID pattern and stale SSR data.** The ID regex is \`/(p | product)/(\\d+)` , which fails for alphanumeric codes.  `\_cartFromNextData`reads`**NEXT\_DATA**\`, which is the first-load snapshot and is stale after client navigation | carrefour.js \[V code\] |
| C7 | **Bubble-phase click listener and React event handling** (same as N8) | content.js | Capture phase |

### 2.5 Confirm before you change: a 30-minute capture protocol

On one product-listing page, one product page and one cart view per retailer, run this in the DevTools console and paste the output into the issue. It prints what the adapters would see.

```js
(() => {
  const attr = (n) => '[' + CSS.escape(n) + ']';
  const anchors = [...document.querySelectorAll('a[href]')]
    .filter(a => /[/](p|product|products)[/]/.test(a.href)).slice(0, 5);
  const report = anchors.map(a => {
    let n = a, chain = [];
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      chain.push(n.tagName.toLowerCase() + '.' + [...n.classList].slice(0, 4).join('.'));
    }
    return { href: a.href, chain };
  });
  console.log('product anchors', report);
  console.log('livewire components', document.querySelectorAll(attr('wire:id')).length);
  console.log('wire:click samples', [...document.querySelectorAll(attr('wire:click'))].slice(0, 8).map(e => e.getAttribute('wire:click')));
  console.log('next root', !!document.getElementById('__next'), 'grid', !!document.querySelector('[data-testid="product-grid"]'));
  window.__nsGrid = document.querySelector('[data-testid="product-grid"], main');
  console.log('Now navigate by clicking a category, then run: window.__nsGrid.isConnected');
})();
```

Also copy the `outerHTML` of one product card, one ‘add’ button and one cart row. **Decision rules:** if `window.__nsGrid.isConnected` is false after navigation, C1 is confirmed. If only one of several `wire:id` elements contains the product cards, N1 is confirmed. If the `wire:click` values contain numeric IDs, N4 is confirmed. If card ancestors differ from the `closest()` list in `extractCartAction`, N5 and C4 are confirmed. Save the three HTML captures per retailer as test fixtures (Section 2.7).

### 2.6 Remediation and the unified base adapter

**Fix 1: lifecycle (content.js, scanner.js).** Add a `RootBinder` to content.js that resolves the observe root, and re-resolves it when the Navigation API fires, when the bound node is no longer connected, or when `document.body` children are replaced. On any re-bind call `this._scanner.rebind(newRoot)` and `rescan()`.

```js
// content.js (new)
class RootBinder {
  constructor(adapter, onRebind) { this.adapter = adapter; this.onRebind = onRebind; this.root = null; }
  resolve() { return (this.adapter.getObserveTarget && this.adapter.getObserveTarget()) || document.body; }
  start() {
    this.root = this.resolve();
    const check = () => { if (!this.root || !this.root.isConnected) { this.root = this.resolve(); this.onRebind(this.root); } };
    if (typeof navigation !== 'undefined') navigation.addEventListener('navigatesuccess', () => setTimeout(check, 250));
    this.guard = setInterval(check, 1500); // cheap guard for frameworks that swap the root without a navigation event
  }
  stop() { clearInterval(this.guard); }
}
```

**Fix 2: discovery (all adapters).** Replace each `candidatesIn` with a shared implementation in the base adapter that is anchor-first and also checks the ancestor:

```js
candidatesIn(root) {
  const out = [], seen = new Set();
  const add = (card) => { if (card && !seen.has(card)) { seen.add(card); const item = this.parseCard(card); if (item) out.push({ el: card, item }); } };
  const scope = root && root.querySelectorAll ? root : document;
  const ancestor = scope.closest && this.closestCard(scope);   // new: the added node may be inside a card
  if (ancestor) add(ancestor);
  scope.querySelectorAll(this.spec.productLinkSelector).forEach(a => add(this.closestCard(a)));
  return out;
}
```

**Fix 3: self-healing badges (scanner.js).** Track removal of our host and re-queue the card; add a low-cost periodic reconcile for frameworks that wipe children silently.

```js
// in NutriScanner._onMutations(records)
for (const r of records) {
  r.removedNodes.forEach(n => {
    if (n.nodeType === 1 && n.classList.contains('nutriscore-isolated-root') && r.target.isConnected) {
      const card = this._adapter.closestCard(r.target);
      if (card) { this._seen.delete(card); this._attempts.delete(card); this._enqueueRoot(card); }
    }
  });
}
// reconcile every 2 s while the tab is visible
setInterval(() => { if (document.visibilityState !== 'visible') return;
  for (const el of this._visibleCards) if (!el.querySelector('.nutriscore-isolated-root')) this._enqueueRoot(el); }, 2000);
```

If the pilot capture shows that a retailer wipes children on every update, switch that retailer to an **overlay badge layer**: one fixed-position Shadow host on `document.body` places each badge by `getBoundingClientRect()` of its card (updated through `IntersectionObserver` and `ResizeObserver`). It cannot be removed by a framework because it lives outside the framework’s tree.

**Fix 4: one product reference (all adapters).** Replace the three divergent ID paths with `extractProductRef(card)` returning `{ retailerSku, url, name, price, gtin? }`. Naivas reads the numeric ID from `addToCart(...)` or `redirectToProductPage(...)`; Carrefour from the product-link path; Quickmart from `selprod_id`. Badge, cart and catalogue lookups all call it.

```js
// naivas spec helper: numeric ID from Livewire attributes, no regex escapes needed
function naivasSkuFromCard(card) {
  for (const el of card.querySelectorAll('*')) {
    const wc = el.getAttribute('wire:click');
    if (wc && (wc.includes('addToCart(') || wc.includes('redirectToProductPage('))) {
      const m = wc.match(/[0-9]+/);
      if (m) return m[0];
    }
  }
  return null;
}
```

**Fix 5: click capture and card resolution (content.js, adapters).** Register `document.addEventListener('click', handler, { capture: true })`. In every `extractCartAction`, call `this.closestCard(btn)` and return null if it is not found, instead of falling back to `document.body`. Broaden button detection to `aria-label`, `title`, `data-testid` and a localised text test, as Quickmart already does.

**Fix 6: remove stale sources.** Delete the Magento branches from naivas.js (N6) and `_cartFromNextData` from carrefour.js (C6) once the capture confirms they are dead. Replace `_cartFromLivewireV3Snapshot` with a DOM-first cart read (N7).

**Base adapter and declarative specs.** `declarative-engine.js` already supports ranked selectors, attribute rules and a per-retailer `killSwitch`, and the manifest rules allow it because specs are data. Finish it rather than writing a fourth hand-coded adapter:

```js
// adapters/base-adapter.js (classic script, built to an IIFE; no ES module in content scripts)
class BaseAdapter {
  constructor(spec) { this.spec = spec; }
  getRetailerCode() { return this.spec.retailer; }
  getObserveTarget() { return document.body; }                       // re-bound by RootBinder
  closestCard(el) { for (const s of this.spec.cardSelectors) { const c = el.closest(s); if (c) return c; } return null; }
  parseCard(card) { return NutriDeclarative.extractProductFromCard(card, this.spec); }
  candidatesIn(root) { /* Fix 2 */ }
  inject(el, result) { NutriSharedUI.injectBadge(el, result.data || result, result?.price ?? 0); NutriTelemetry.emit('Badge_Render', { sku: result?.productId, grade: result?.nutriscore_grade }); }
  extractCartAction(node) { /* spec.addToCart rules, then closestCard */ }
  extractCartState() { /* spec.cartRows rules */ }
  detectOrderConfirmation() { return this.spec.orderSignals.some(r => NutriDeclarative.matchSignal(r)); }
}
```

Specs live in `adapters/specs/quickmart.spec.json`, `naivas.spec.json` and `carrefour.spec.json`, signed and delivered with the catalogue manifest so that a selector fix never needs a store release, and each has `killSwitch` for emergencies.

**Standard telemetry payloads.** Every adapter emits the same three events through one emitter (`NutriTelemetry.emit`) that maps onto the envelope in report 2, Section 2.3 and never carries a nutrient name:

| Event | Trigger | Required fields |
| --- | --- | --- |
| `SKU_Attempted` | A graded tile is scored, or the patient attempts to add a product | `retailer`, `sku_ref`, `source` (listing, detail, cart), `ts` |
| `Cart_Add` | `extractCartAction` returns an item | `retailer`, `sku_ref`, `qty`, `unit_price_minor`, `cart_episode_id` |
| `Badge_Render` | `inject()` completes | `retailer`, `sku_ref`, `grade`, `confidence_tier`, `render_ms` |

Blocked and swap events (`Blocked_Attempt`, `Swap_Recommended`, `Swap_Accepted`) are added in Section 3.

### 2.7 Test strategy that would have caught this

Save the Section 2.5 captures as `src/ui/src/app/__tests__/__fixtures__/<retailer>/{plp,pdp,cart}.html`. Set `// @vitest-environment jsdom` on the adapter tests and assert, for each fixture: the number of candidates, the extracted `sku_ref`, name and price of the first three cards, that `extractCartAction` returns the *clicked* product (not the first on the page), that `candidatesIn` finds the card when given a descendant node, and that a simulated morph (replace the card’s children) re-injects the badge within two reconcile ticks. Add a nightly canary that loads one live page per retailer in Playwright and fails on zero candidates.

### 2.8 Side effects of the adapter changes

| Change | Files to update | What to check |
| --- | --- | --- |
| New `RootBinder`, `scanner.rebind()`, reconcile loop | content.js, scanner.js | `destroy()` must clear the new interval and observers; `pagehide` handler |
| `extractProductRef` replaces three ID paths | all three adapters, background.js (`getProductInfo` cache key and `resolveProductMatch` arguments), db.js (`shopping_ledger.productId`) | Existing ledger rows with `synth_` IDs: add a one-time migration that re-keys them by `retailerSku` where a catalogue match exists |
| Capture-phase click | content.js | Our own badge click handler calls `stopPropagation`; confirm it still works inside the Shadow DOM |
| Specs as data | manifest.json (content\_scripts order), catalog-sync.js (spec manifest download and verification), build script | Spec signature verification before use; kill-switch default off |
| Remove Magento and `__NEXT_DATA__` branches | naivas.js, carrefour.js, adapter tests | Update the contract tests that list method names |
| New telemetry emitter | content.js, background.js (new message types), db.js | Message schema versioning; consent gate (Section 5.6) |

## 3. End-to-end flow: the swap lifecycle

### 3.1 What runs today (verified path)

`NutriScanner._score` (scanner.js) → `chrome.runtime.sendMessage({ action: 'CHECK_PRODUCT_SCORES_BATCH', retailer, payloads })` → the `chrome.runtime.onMessage` listener in background.js → `getBatchContext()` (settings and tier, once per batch) → `getProductInfo(payload, retailerCode, ctx)` → `NutriScoreDB.getCachedProduct` or `resolveProductMatch` → `interpretProduct` → `computeGradeFromProduct` → `appendPremiumAssessment` (tier gate, `premium_assessments` lookup, per-100 g threshold fallback) → `results[{ status, data }]` → `adapter.inject(el, product)` → `NutriSharedUI.injectBadge` → on badge click, an `innerHTML` flyout in the global Shadow portal. There is no step that reads a clinician token, proposes an alternative, or records a swap.

### 3.2 Target sequence

```
Patient   Page + adapter        content.js / scanner.js      background.js (service worker)        Flyout (Shadow DOM)
  | view listing |                     |                              |                                    |
  |              |--candidatesIn()---->|                              |                                    |
  |              |                     |--SKU_Attempted-------------->| outbox (only if consent C2)        |
  |              |                     |--CHECK_PRODUCT_SCORES_BATCH (sku_ref[])-->                        |
  |              |                     |                              | getBatchContext(): load + verify token
  |              |                     |                              | getProductInfo(): match, interpret, grade
  |              |                     |                              | evaluateAgainstToken(): severity, reason_class
  |              |                     |<--results[{ grade, clinical }]|                                   |
  |              |<--inject(el, r)-----| Badge_Render --------------->|                                    |
  | click Add    |                     |                              |                                    |
  |------------->|--capture click----->| extractCartAction(): item + severity?                             |
  |              |                     | severity = block: preventDefault, hold the click                  |
  |              |                     |--RESOLVE_SWAPS------------->| swap-engine: candidates by category,|
  |              |                     |                              | filter (token, VERIFIED, complete), |
  |              |                     |                              | rank, attach offers                 |
  |              |                     |<--{ decision, swaps[<=3], offer }                                 |
  |              |                     |--Blocked_Attempt, Swap_Recommended-->outbox                       |
  |              |                     |---------------------- open(viewModel) ---------------------------->|
  | Swap in cart |<------------------------------------------------------ onSwap(from, to) -----------------|
  |              |<--adapter.swapInCart(from, to)--  Swap_Accepted -->outbox                                  |
  |              |--SYNC_CART_STATE--->|--ledger: swap_of = from; Swap_Completed when `to` is in the cart   |
  | Add anyway   |<------------------------------------------------------ onOverride(reason_code) -----------|
  |              |<--replay held click (flag data-ns-allow)--  Add_Anyway -->outbox                           |
```

### 3.3 Step 1: detection and grading against the signed profile

| Layer | File and function | Change |
| --- | --- | --- |
| Page | each adapter `candidatesIn()` → `extractProductRef()` | Emit `sku_ref` (retailer SKU) with name, price, URL (Section 2.6, Fix 4) |
| Page | scanner.js `_score()` | Send `sku_ref` as `retailer_product_id`; emit `SKU_Attempted` through `NutriTelemetry.emit` |
| SW | background.js `getBatchContext()` | After settings, call `NutriProfile.getVerifiedToken()` (new `extension/profile-token.js`, added to the `importScripts` list). Return `{ settings, token }`; delete the `tier` branch (G-21) |
| SW | profile-token.js (new) | Store the encrypted token in `chrome.storage.local`; verify the Ed25519 signature offline against pinned keys from a signed key manifest; check `exp`, audience and revocation list; return `null` when invalid. WebCrypto support for Ed25519 arrived late in Chrome’s release train and the manifest minimum is Chrome 110, so check before relying on it; otherwise vendor a small, audited pure-JS verifier at a pinned version |
| SW | `engine/constraint-evaluator.js` (new, shared with Node) | `evaluateAgainstToken(nutrientsPer100, token.cs, token.policy)` returns `{ severity: 'none' \| 'warn' \| 'block', violations[], reasonClass, confidence }`. Replaces the threshold fallback block in `appendPremiumAssessment`, `DISEASE_RULES`, `MEDICAL_THRESHOLDS` and the duplicated block formerly in shared-ui.js (G-17) |
| SW | `getProductInfo()` result | Add `clinical: { severity, reasonClass, tokenVer }`. Violation details (nutrient names and values) stay on the device and are never put in telemetry |
| Rule | confidence gate | `severity: 'block'` only when the record is at `VERIFIED` or higher; below that, severity is capped at `warn` and the UI shows a neutral state (report 2 principle P1) |

**Token vocabulary change that this step depends on (G-02, G-03).** Extend `DptPayload.cs` with the keys the reports need, and stop loosening limits:

```ts
// shared/dpt.ts (extend)
export const ALLOWLISTED_KEYS = [
  'sugars_g_100g_max', 'carbs_g_100g_max', 'sodium_mg_100g_max',
  'satfat_g_100g_max', 'energy_kcal_100g_max', 'fibre_g_100g_min',
  'sodium_mg_day_max', 'free_sugars_g_day_max', 'fibre_g_day_min', // per-day budgets for basket variance
] as const
export interface DptPayload { /* existing fields */
  w?: Record<string, number>        // nutrient weights, sum to 1
  hh?: number                       // household adult-equivalents
  ex?: string[]                     // hard exclusions as opaque codes, e.g. 'al:peanut'
  pol_b?: 'confirm' | 'hard'        // block behaviour
  pol_c?: 'ESTIMATED' | 'VERIFIED'  // minimum confidence to block
  cns?: string                      // consent receipt reference (opaque)
}
// bandValue(): band DOWN for maximums and UP for minimums (never looser than the prescription)
```

### 3.4 Step 2: alternative resolution, ranking and voucher metadata

| Layer | File and function | Change |
| --- | --- | --- |
| Message | background.js `onMessage` | New actions `RESOLVE_SWAPS`, `SWAP_DECISION`, `GET_CONSENT_STATE`. Convert the long `if (message.action === …)` chain into a `MESSAGE_HANDLERS` map so each action is unit-testable |
| SW | `extension/swap-engine.js` (new) | `resolveSwaps({ retailer, skuRef, category, price, qty, token })` |
| DB | db.js schema v19 | New index `by-kfct-category` on `Classification.NutritionCategory` for `quickmartProducts`, `naivasProducts` and `carrefourProducts`, so candidates come from one indexed range query, not a scan |
| Filter | swap-engine.js | A candidate is eligible only if: same retailer; same functional category; `evaluateAgainstToken(...).severity === 'none'`; every constrained nutrient present (**a missing value fails**, fixing G-04); `ReviewState` at `VERIFIED` or higher; price within the cap (token `pol_p`, default +10%); not the same SKU |
| Rank | swap-engine.js | Utility `U = 0.50·CG + 0.25·PP + 0.20·TA + 0.05·AV` (report 2, Section 4.4): clinical gain `CG` from the token weights `w`, price parity `PP`, taste affinity `TA` from the patient’s own accepted swaps in `event_outbox` and `shopping_ledger`, availability `AV` when the adapter can read stock |
| Sponsor | swap-engine.js | A boost applies only to candidates within 3% of the best utility, at most one in three, and always carries `sponsored: true` |
| Offer | swap-engine.js + catalog-sync.js | Offers arrive in a signed `swap_offers` pack, hashed and swapped atomically with the same pattern already used for `premium_staging` (catalog-sync.js). Each offer has `offer_id`, `retailer`, `sku_refs[]`, `value_kes`, `expires_at`, `redeem_code` (neutral) and `sponsor_label` (default ‘Programme offer’). The funder’s name is shown only if the patient has consented to payer display (consent C3) |
| Output | swap-engine.js | `{ decision, swaps: [{ skuRef, name, grade, priceDeltaKes, deltas[], sponsored, offer? }], reason }` with up to three swaps. When none qualify, return `decision: 'none'` and show ‘No safer match found’; never show a nearly conforming item |

**Voucher rule.** The retailer must never learn the funder or the condition. Redemption uses the neutral code settled through the platform (Blueprint addendum), and the offer is stored in the extension without any patient identifier.

### 3.5 Step 3: state and telemetry sync

| Event | Emitted by | When | Added fields |
| --- | --- | --- | --- |
| `Blocked_Attempt` | content.js, in the capture-phase click handler | An add is held because `severity === 'block'` | `sku_ref`, `reason_class` (`safety_hard`, `clinical_soft` or `confidence_low`; never a nutrient name), `token_ver` |
| `Swap_Recommended` | content.js after `RESOLVE_SWAPS` returns | The swap list is shown | `from_sku`, `to_skus[]`, `sponsored[]`, `offer_ids[]`, `rank` |
| `Swap_Accepted` | flyout `onSwap` | The patient clicks ‘Swap in cart’ | `from_sku`, `to_sku`, `price_delta_minor`, `offer_id?` |
| `Swap_Completed` | background.js `SYNC_CART_STATE` handler | `to_sku` appears in the cart within 60 s of acceptance | `from_sku`, `to_sku`, `latency_ms` |
| `Add_Anyway` | flyout `onOverride` | The patient overrides | `sku_ref`, `override_code` from a fixed list |

- **Outbox.** New IndexedDB store `event_outbox` (keyPath `event_id`, indexes `by-status` and `by-ts`) in schema v19. An alarm created with `chrome.alarms` (every 15 minutes, and on checkout) uploads batches with exponential backoff, keyed idempotently by `event_id`. Events are queued only if `NutriConsent.isActive('C2')` is true and are purged when it is revoked. Without consent nothing is stored, only the local `shopping_ledger` that the patient already sees.
- **Ledger.** `shopping_ledger` gains `swap_of`, `cart_episode_id` and `sku_ref` (db.js `syncCart`, `LOG_CART_ADD` handler).
- **Accepted versus completed.** Retailer pages are not under our control, so `Swap_Accepted` records intent and `Swap_Completed` records the observed result; the gap between them is a first-class quality metric for each adapter.
- **Holding the click.** `extractCartAction()` runs in the capture phase. For `severity === 'block'` the handler calls `preventDefault()` and `stopImmediatePropagation()`, opens the flyout, and replays the original click with a `data-ns-allow` marker when the patient chooses ‘Add anyway’. Test this on Livewire and React pages; if a retailer breaks, fall back to a non-blocking `warn` for that retailer through its spec flag.

### 3.6 Step 4: rendering and one-click swap

- **View model.** content.js receives `{ grade, clinical, swaps, offer, consent, variance }` and calls `NutriFlyout.open(anchorRect, viewModel, handlers)` (Section 4).
- **Swap in cart.** Each adapter gains `swapInCart({ fromRef, toRef, qty })` returning `{ ok, mode }` where `mode` is `'clicked'`, `'navigated'` or `'unsupported'`. If the alternative’s card is on the page, click its add control and the original’s remove control. Otherwise open the alternative’s URL and show an ‘Add’ prompt. Calling a retailer’s internal cart API directly is not recommended: it is brittle and risks the retailer’s terms.
- **Failure states.** Expired token: neutral grade and ‘Ask your clinic to renew’. Catalogue missing: no swaps. Offer expired: hide the voucher tag. Offline: the local path still works because scoring and swap resolution run on the device.

### 3.7 Side effects of the swap lifecycle

| Change | Downstream files | Update needed |
| --- | --- | --- |
| `MESSAGE_HANDLERS` refactor | background.js, all tests that send messages | Keep action names stable; add handler unit tests |
| Schema v19 (`event_outbox`, `swap_offers`, `by-kfct-category`, ledger fields) | db.js `upgrade()`, ui/src/app/lib/db.ts, db/shared.ts, `NutriScoreDB` proxy | Additive migration only; keep v18 stores; bump `DB_VERSION` to 19 and add the `if (oldVersion < 19)` branch |
| Token verification in `getBatchContext` | background.js, `appendPremiumAssessment` callers | Remove `isPremium`, `tier`, `upsell` from results; update Popup.tsx and Dashboard.tsx consumers |
| New view model | shared-ui.js, Popup.tsx (swap counts), Dashboard.tsx (swap history) | Dashboard reads `event_outbox` and the ledger, not a new store |
| `constraint-evaluator.js` shared with Node | shared/commercial-catalogue.ts | Replace `evaluateSkuAgainstConstraints` with the shared module so the server and the device decide identically |
| Voucher pack | catalog-sync.js, manifest (signature key) | Verify the pack signature before use |

## 4. Flyout UI redesign and design-system alignment

### 4.1 Audit of the current flyout (shared-ui.js)

| Area | Finding | Tag |
| --- | --- | --- |
| Structure | One `injectBadge()` function builds the badge and, inside its click handler, a 150-line `innerHTML` template with about 35 inline style declarations. No component boundaries, no reuse | V |
| Tokens | Private `--ns-*` variables defined on the portal `:host`, plus hard-coded colours (`#C2410C` for hypertension, grade colours from `NutriScoreGradeColors`). None of the institutional tokens in styles/tokens.css (`--color-*`, `--space-*`, `--text-*`, `--shadow-raised`, `--ui-radius-*`) is used | V |
| Grade palette | Three definitions with different values (G-18) | V |
| Content | Grade header, text-only condition warnings, a per-100 g table, a confidence caption. No variance indicator, no alternatives, no voucher, no consent state | V |
| Dead code | `[data-ns-upgrade]` is wired but the template has no such element; `OPEN_UPGRADE` belongs to the removed plan picker | V |
| Accessibility | `role='dialog'` and `aria-modal='true'` without a focus trap or inert background; fixed 240 px width; the flyout closes on any scroll (capture-phase listener) | V |
| Isolation | Good: one global Shadow portal, flyouts never inherit page CSS. Per-card badge hosts each adopt a stylesheet | V |
| Parity | Popup and Dashboard use `GradeBadge`, `ConditionChip`, `TargetMeter`, `KpiCard` and `ConfirmDialog`; the flyout shares none of them | V |

### 4.2 Target architecture

- **One palette.** Create `src/shared/grade-palette.ts` as the only definition of grade colours and accessible text colours. A build step generates `adapters/grade-colors.js` (classic script) from it, and `GradeBadge.tsx` and tokens.css import it. Resolve the A, B, C and D differences once, by contrast test.
- **One token source.** `build-flyout-css` extracts the `:root` variables from styles/tokens.css into a constructable stylesheet that the flyout adopts into its Shadow root, so a token change reaches popup, dashboard and flyout together.
- **Shared primitives without Tailwind.** `ConditionChip` currently uses Tailwind utility classes that do not exist inside a Shadow root. Move the five primitives to `src/ui/src/ds/` as token-based CSS classes (`.ns-chip`, `.ns-meter`, …) consumed by React (popup, dashboard) and by Preact in the flyout through the `preact/compat` alias. This also settles the React-versus-Preact toolchain question already open in the project.
- **Bundle.** A new `src/flyout/main.tsx` builds to `flyout.js` (IIFE) added to each retailer’s `content_scripts` list before content.js; remove the inline template from shared-ui.js.

### 4.3 Component tree and new states

```
FlyoutRoot            portal host, positioning, focus trap, Esc, reduced-motion
 ├─ FlyoutHeader       ClinicalGradeBadge (size lg), product name, ConfidenceTag, close
 ├─ ClinicalBanner     severity none | warn | block, plain-language reason, ConsentStatusIndicator
 ├─ VarianceStrip      up to 3 MacroMicroVarianceIndicator (basket so far, per day)
 ├─ NutritionTable     per 100 g rows; cells that exceed a limit are marked
 ├─ SwapList
 │    └─ SwapCard x3   name, GradeBadge sm, DeltaChips, price delta, VoucherTag, SponsoredTag, [Swap in cart]
 ├─ BlockedActions     [Add anyway] opens ReasonPicker (fixed reason codes)
 └─ FlyoutFooter       provenance caption, ‘Informational only, not medical advice’
```

| State | Props and data source | Behaviour |
| --- | --- | --- |
| **Clinical Grade Badge** | `grade`, `confidenceTier`, `tokenState` (verified, expired, none) from `getProductInfo()` and `NutriProfile` | Below `ESTIMATED` or with no valid token: neutral ‘Not graded’ with no colour. Never red on low confidence |
| **Macro/Micro Variance Indicator** | `nutrient`, `exposurePerDay`, `limit`, `variance` from `variance-lite.js` (new, SW) using in-cart rows of `shopping_ledger` divided by the days the shop covers and by `hh` | A bar with the limit marked, an overshoot colour from `--color-warning` or `--color-critical`, and text ‘+40% over your daily sodium budget’. Hidden when basket coverage is under 70% |
| **One-click Swap Card** | `SwapOption` from `RESOLVE_SWAPS` | Shows grade, the two largest improvements as delta chips (‘−380 mg sodium’), the price change, and a primary button. Keyboard: arrow keys move between cards; Enter swaps |
| **Insurer Voucher Tag** | `offer.value_kes`, `expires_at`, `sponsor_label` | ‘Save KSh 200 · Programme offer · ends 30 Nov’. Disabled and struck through after expiry. The funder is named only with consent C3 |
| **Sponsored Tag** | `sponsored: true` | A visible ‘Sponsored’ label, never styled as a clinical recommendation (invariant I1) |
| **Consent Status Indicator** | `consent` from `GET_CONSENT_STATE`: clinic programme (C1), shopping insights (C2) | Two small chips: ‘Clinic programme: on’ and ‘Shopping insights: not shared’, with a ‘Manage’ link to options.html. Expired token shows ‘Ask your clinic to renew’ |
| **Reason Picker** | Fixed codes: ‘Buying for someone else’, ‘Occasional treat’, ‘Already within today’s plan’, ‘Other’ | Required before ‘Add anyway’; the code is the only override data stored |

The on-device flyout may name nutrients, because it never leaves the patient’s browser; telemetry still carries only reason classes.

### 4.4 Visual and interaction specification

- **Size and shape:** width `min(92vw, 360px)`, radius `--ui-radius-xl`, shadow `--shadow-raised`, padding `--space-2`, gap `--space-1`.
- **Type:** `--font-sans`; product name `--text-body-lg` semibold; rows and captions `--text-body` and `--text-caption`.
- **Colour:** surfaces `--color-surface` and `--color-surface-muted`; severity from `--color-critical`, `--color-warning`, `--color-success` and their `-subtle`, `-border` and `-text` partners; text contrast at least 4.5:1; focus ring `--focus-ring`. Condition colour never recolours the flyout (the existing `ConditionChip` rule).
- **Motion:** 150 ms `--transition-fast`, disabled under `prefers-reduced-motion`.
- **Touch and keyboard:** targets at least 44 px, a real focus trap, Esc closes, focus returns to the badge, and the flyout stays open on scroll but re-anchors (replace the capture-phase scroll listener).
- **Isolation:** keep the single portal host, add `:host { all: initial }`, use `adoptedStyleSheets` only, and no inline styles or inline handlers (the extension CSP already forbids them).

```ts
// src/shared/flyout-model.ts
export interface FlyoutViewModel {
  product: { skuRef: string; name: string; grade: 'A'|'B'|'C'|'D'|'E'|null; confidence: string; per100: Record<string, number|null> };
  clinical: { severity: 'none'|'warn'|'block'; reason: string; tokenState: 'verified'|'expired'|'none' };
  variance: Array<{ nutrient: string; exposure: number; limit: number; v: number }>;
  swaps: Array<{ skuRef: string; name: string; grade: string; priceDeltaKes: number; deltas: string[]; sponsored: boolean; offer?: { id: string; valueKes: number; expiresAt: string; label: string } }>;
  consent: { c1: boolean; c2: boolean };
}
```

### 4.5 Refactoring steps and side effects

1. Create `grade-palette.ts` and its generator; update `GradeBadge.tsx`, tokens.css and `grade-colors.js`. *Side effects:* popup and dashboard snapshot tests (`characterization.test.ts.snap`), chart colours in `Charts.tsx`.
2. Extract `ds/` primitives and convert Tailwind classes to token classes. *Side effects:* `ConditionChip`, `TargetMeter`, `KpiCard` consumers in Popup.tsx and Dashboard.tsx.
3. Build `flyout.js` and add it to the three `content_scripts` blocks in manifest.json. *Side effects:* `check:manifest` load-order script, `check-no-fixtures-in-dist`.
4. Replace the click handler in `NutriSharedUI.injectBadge` with `NutriFlyout.open(...)`; delete `_ensureGlobalPortal`’s scroll-close behaviour and the `[data-ns-upgrade]` wiring. *Side effects:* `content.js rescan()` calls `_closeActiveFlyout`; keep a thin compatibility function.
5. Remove `OPEN_UPGRADE`, `CHECK_TIER` and `REFRESH_ENTITLEMENT` handlers and `entitlement.js` once no caller remains (G-21). *Side effects:* options.html, popup.html, the entitlement tests (`entitlement.test.ts`, `d04`, `d06-d07`).
6. Add visual regression tests for the flyout states (none, warn, block, expired token, voucher, sponsored, no swaps) in Playwright against a fixture page.

## 5. Database schema evolution and pipeline integration

### 5.1 Current data layer (verified)

**Device (IndexedDB, db.js `DB_VERSION = 18`).** Stores: `shopping_history` (index `by-viewedAt`), `user_settings`, `product_cache`, `carrefourProducts`, `naivasProducts` and `quickmartProducts` (keyPath `Identity.ProductID`, indexes `by-url` and `by-name`), `shopping_ledger` (indexes `by-addedAt`, `by-retailer-product-status`, `by-status`), `dataset_metadata`, `price_cache`, `pending_cart_syncs`, `catalog_staging`, `catalog_hashes`, `premium_assessments`, `premium_staging`.

**Product record shape (all three JSON files):** `Identity{ProductID, ProductName, Retailer, RetailerProductUrl, NormalizedName, BrandName}`, `Classification{NutritionCategory, NOVA}`, `Packaging{PackSizeUnit}`, `Nutrition{Basis, EnergyKJ, EnergyKcal, SugarsG, SaturatedFatG, FatG, CarbohydratesG, FibreG, ProteinG, SodiumMG, SaltG, FVL}`, `NutritionProvenance{ValueSpecificity, EvidenceLevel, SourceID, SourceName}`, `Validation{ReviewState, ConsistencyChecks, DataQualityFlags}`, `Price{CurrentPriceKES}`.

**Server:** no DDL in the archive (Section 0). The TypeScript contracts in `src/shared` (claims, consent, patient-export, target-sync) imply the tables but do not define them.

**Catalogue readiness for the swap feature, measured on the shipped JSON:**

| Retailer | Records | VERIFIED or HIGH\_CONFIDENCE | of those with sodium | with sugars | with saturated fat | with energy, sugars, sat. fat and sodium |
| --- | --- | --- | --- | --- | --- | --- |
| Naivas | 3,820 | 1,486 | 1,068 | 835 | 378 | 206 |
| Carrefour | 6,698 | 2,717 | 1,679 | 1,910 | 60 | 52 |
| Quickmart | 3,669 | 386 | 245 | 248 | 11 | 10 |
| **Total** | **14,187** | **4,589 (32%)** | **2,992** | **2,993** | **449** | **268** |

The combined catalogue is 14,187 records, up from the 10,518 in the deck because Quickmart (3,669) is now included.

**Defects found while measuring:**

- **D-1 Quickmart categories are scraper artefacts.** `mapToCanonicalSchema` copies `raw.scrapedCategory` (breadcrumb or heading text) into `Classification.NutritionCategory`. The file holds values such as ‘Category/View/18’ (335 records) and more than 200 more under other `Category/View/N` values, and 32 distinct categories against 14–15 for the other two retailers. Category-based swap lookup cannot work until this is mapped to the 14-tag food-composition taxonomy.
- **D-2 Schema drift in the Quickmart file:** extra lower-case keys `nova_confidence`, `nutrition_provenance`, `data_quality_flags`, `validation_status` sit beside the canonical blocks.
- **D-3 Missing fields.** `Nutrition` has no `PotassiumMG`, `PhosphorusMG`, `ServingSizeG` or `TransFatG` (the adapter’s `mapToCanonicalSchema` emits `PotassiumMG`, the data does not carry it), and `Identity` has no `GTIN`, so the GTIN step of the identity cascade (report 2, Section 1.3) cannot run.
- **D-4 Saturated fat is nearly absent** among verified records (449 of 4,589), so a swap rule that requires every default constraint will eliminate most candidates. Require only the nutrients present in the patient’s token, and prioritise sodium, sugars and fibre curation.

### 5.2 Device schema v19 (additive)

```js
// db.js upgrade(): add after the existing blocks
if (oldVersion < 19) {
  const ev = db.createObjectStore('event_outbox', { keyPath: 'event_id' });
  ev.createIndex('by-status', 'status');
  ev.createIndex('by-ts', 'client_ts');
  db.createObjectStore('swap_offers', { keyPath: 'offer_id' });
  for (const name of ['quickmartProducts', 'naivasProducts', 'carrefourProducts']) {
    const s = transaction.objectStore(name);
    if (!s.indexNames.contains('by-kfct-category')) s.createIndex('by-kfct-category', 'Classification.NutritionCategory');
  }
  const ledger = transaction.objectStore('shopping_ledger');
  // new optional fields are written by LOG_CART_ADD / syncCart: sku_ref, swap_of, cart_episode_id
  if (!ledger.indexNames.contains('by-episode')) ledger.createIndex('by-episode', 'cart_episode_id');
}
```

The patient token is held outside IndexedDB in `chrome.storage.local`, encrypted, with the consent state under `user_settings`.

### 5.3 Server schema (new PostgreSQL migrations)

Create `db/migrations/` with numbered files and run them on the Kenyan-hosted cluster. Every table carries `tenant_id` and Row-Level Security.

| Migration | Tables (key columns) | Purpose |
| --- | --- | --- |
| 0001\_ontology\_catalogue | `nutrient_def(code, infoods_tag, unit, basis)`; `food_item(id, gtin, brand, name, name_norm, category_kfct, nova, pack_size_g)`; `retailer_sku(retailer, retailer_sku, food_item_id, url, active)`; `nutrition_record(food_item_id, nutrient_code, basis, value, censored, source_kind, source_ref, review_state, reviewed_by, valid_from, valid_to)`; `match_candidate(retailer_sku_id, food_item_id, method, p_match, accepted)` | Normalised ontology and retailer SKU cross-mapping |
| 0002\_profiles\_tokens\_consent | `clinical_nutrition_profile(tenant_id, patient_ref, version, effective_from, expires_at, supersedes, constraints_enc, weights, signature)`; `dietary_token_issue(jti, tenant_alias, shopper_alias, retailer, profile_id, iat, exp, jkt, revoked_at)`; `consent_receipt(consent_id, patient_ref, purpose, recipients, notice_hash, state, granted_at, expires_at, revoked_at, evidence_hash)` | Signed profile, token issue log with revocation, purpose-specific consent |
| 0003\_telemetry | `telemetry_event` (partitioned by month: `event_id`, `event_type`, `shopper_alias`, `retailer`, `session_id`, `cart_episode_id`, `client_ts`, `server_ts`, `profile_ver`, `payload`, `consent_ref`); `telemetry_quarantine(event_id, reason, raw)`; `cart_episode`; `cart_snapshot_item` | Bronze and silver event layer |
| 0004\_scores\_outcomes | `adherence_score(tenant_id, patient_ref, window_start, window_end, profile_ver, score, ci_low, ci_high, variance_score, coverage, intake_confidence, safety_events, code_ver)`; `variance_nutrient(score_id, nutrient_code, exposure, limit_value, v, weight, sub_score)`; `outcome_record(patient_ref, metric, value_norm, unit, effective_dt, source, context, quality, profile_ver)` | Adherence and variance scoring, longitudinal outcomes |
| 0005\_cohorts\_risk | `cohort_definition(code, layer, rule, version)`; `cohort_membership(patient_ref, segment_code, layer, valid_from, valid_to)` (opaque codes); `risk_score(patient_ref, model_id, model_ver, horizon_days, p10, p50, p90, features_hash, computed_at)` | Cohort segmentation tags and predictive risk scores |
| 0006\_audit | `audit_log` (hash chain); `audit_batch_root(batch_id, from_seq, to_seq, merkle_root, signature, anchored_at, tsa_token)` | Immutable audit trail |
| 0007\_release\_views | Per-stakeholder views and roles (Section 6) | Insurer and retailer access |

**Audit log, in the format the brief asks for (`[Timestamp] [TokenID] [Action] [Hash]`) plus the fields needed to verify it:**

```sql
create extension if not exists pgcrypto;

create table audit_log (
  seq         bigint generated always as identity primary key,
  ts          timestamptz not null default clock_timestamp(),
  tenant_id   uuid not null,
  token_id    text,                       -- DPT jti or session id
  actor       jsonb not null,             -- id, role, service, code_ver
  purpose     text not null,
  subject_ref text,                       -- pseudonymous only
  resource    text not null,
  action      text not null,
  before_hash bytea,
  after_hash  bytea,
  policy      jsonb not null,             -- pdp version, rule, decision
  prev_hash   bytea not null,
  entry_hash  bytea not null
);

create function audit_chain() returns trigger language plpgsql as $$
declare prev bytea;
begin
  perform pg_advisory_xact_lock(hashtext(new.tenant_id::text));   -- one chain per tenant
  select entry_hash into prev from audit_log
    where tenant_id = new.tenant_id order by seq desc limit 1;
  new.prev_hash  := coalesce(prev, decode(repeat('00', 32), 'hex'));
  new.entry_hash := digest(new.prev_hash ||
      convert_to((to_jsonb(new) - 'entry_hash' - 'prev_hash')::text, 'utf8'), 'sha256');
  return new;
end $$;

create trigger audit_chain_bi before insert on audit_log
  for each row execute function audit_chain();

create function audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;

create trigger audit_no_change before update or delete on audit_log
  for each row execute function audit_immutable();

revoke update, delete, truncate on audit_log from public;
```

A separate job (`services/audit/anchor.ts`) builds a Merkle tree over each 60-second batch, signs the root with the existing `LocalEd25519Signer` interface (replace it with an HSM-backed `Signer` in production), writes `audit_batch_root`, copies it to write-once storage, and anchors a daily root with an RFC 3161 time-stamping authority. `scripts/verify-audit-chain.mjs` (referenced by `npm run verify:audit` but absent) recomputes the chain per tenant and checks the Merkle proofs.

**Telemetry and scores, key DDL:**

```sql
create table telemetry_event (
  event_id text not null, event_type text not null,
  shopper_alias text not null, retailer text not null,
  session_id text, cart_episode_id text,
  client_ts timestamptz not null, server_ts timestamptz not null default now(),
  profile_ver int, ext_ver text, catalogue_ver text,
  payload jsonb not null, consent_ref text not null,
  primary key (event_id, server_ts)
) partition by range (server_ts);

create table adherence_score (
  id bigint generated always as identity primary key,
  tenant_id uuid not null, patient_ref text not null,
  window_start date not null, window_end date not null, profile_ver int not null,
  score numeric(5,2) check (score between 0 and 100),
  ci_low numeric(5,2), ci_high numeric(5,2),
  variance_score numeric(6,4), coverage numeric(4,3), intake_confidence numeric(4,3),
  safety_events int not null default 0, code_ver text not null,
  unique (tenant_id, patient_ref, window_end, profile_ver)
);

alter table adherence_score enable row level security;
create policy tenant_isolation on adherence_score
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

### 5.4 Backfilling the catalogue

`scripts/load-catalogue.mjs` (new) loads the three JSON files:

| JSON field | Target |
| --- | --- |
| `Identity.ProductID`, `Identity.Retailer`, `Identity.RetailerProductUrl` | `retailer_sku(retailer_sku, retailer, url)` |
| `Identity.ProductName`, `NormalizedName`, `BrandName`, `Packaging.PackSizeUnit` | `food_item(name, name_norm, brand, …)` |
| `Classification.NutritionCategory` | `food_item.category_kfct` **after** the mapping in D-1; unmapped values go to a review queue, not the table |
| `Classification.NOVA` | `food_item.nova` |
| `Nutrition.*` (one row per non-null nutrient) with `Nutrition.Basis` | `nutrition_record(nutrient_code, basis, value)` |
| `NutritionProvenance.EvidenceLevel`, `SourceID`, `SourceName` | `nutrition_record.source_kind`, `source_ref` |
| `Validation.ReviewState`, `DataQualityFlags` | `nutrition_record.review_state`, a `data_quality_flag` side table |
| `Price.CurrentPriceKES` | a `price_snapshot` table (not part of the ontology) |

After loading, regenerate the three JSON bundles and the signed `catalog_hashes` from the database, so the server is the single source of truth and the extension remains an offline cache (the existing `computeCatalogHash` in shared/canonical.mjs stays the integrity function).

### 5.5 ETL and scoring modules

The archive contains no backend service code, so these are new paths. Where existing code already implements a rule, it is moved, not rewritten.

| Module (path) | Status | Responsibility | Reuse |
| --- | --- | --- | --- |
| `src/shared/nutrient-normalise.ts` | New, from existing | Unit canonicalisation, sodium from salt, serving to per 100 g, Atwater energy check, completeness | Move `checkNutrientCompleteness`, `resolveSodium`, `convertServingTo100g`, `verifyAtwaterEnergy` out of shared/target-sync.ts; use in the catalogue build, ETL and extension |
| `services/ingest/gateway.ts` | New | `POST /v1/events`: schema check, consent check against `consent_receipt`, idempotent insert into `telemetry_event`, quarantine on failure | `verifyDpt` and `verifyDpopProof` for authentication |
| `services/etl/quarantine.ts` | New | Rate, clock-skew, MAD-based cart outliers, price anomaly rules | Report 2, Section 2.6 |
| `services/etl/cart-episodes.sql` and `.ts` | New | Sessionise, build `cart_episode`, last-snapshot reconciliation, checkout idempotency (`order_hash`) | Report 2, Section 2.7 |
| `services/scoring/exposure.ts`, `variance.ts`, `adherence.ts` | New | Pure functions: exposure per adult-equivalent per day, signed variance, half-score adherence (`2^(−V/h)`), interval from exposure uncertainty | Same maths ported to `extension/variance-lite.js` for the on-device variance strip; one shared test vector (the report’s worked example: AS 57.5, VS 0.28) |
| `services/scoring/recalibrate.ts` | New | Trend classification, bounded weight update, clinician proposal; shadow mode first | Report 2, Section 3.4 |
| `analytics/segments.py`, `analytics/uplift.py`, `analytics/trajectory.py` | New (Python) | Gower distance and HDBSCAN segments, T-learner uplift, quantile boosting and Cox models; write `cohort_membership` and `risk_score` | Nightly job; model cards in `analytics/models/` |
| `services/release/k-anon.ts` | New, extends consent.ts | k ≥ 20, cell suppression below 10 orders, Laplace noise on repeated counts; refuses release without an Expert Determination certificate id for insurer products | Extend `evaluateCohortSuppression` with `minOrders` and a configurable k (default 20 externally) |
| `services/audit/anchor.ts` | New | Merkle batching, signing, anchoring | `Signer` interface (shared/signer.ts) |
| `services/jobs/schedule.ts` | New | Cron: hourly episodes, daily scores, weekly cohorts, nightly canaries | — |

### 5.6 Side effects of the schema work

| Change | Affected files | Update needed |
| --- | --- | --- |
| Add `GTIN`, `PotassiumMG`, `PhosphorusMG`, `ServingSizeG`, `TransFatG` to the record shape | the three JSON files, `buildNutritionalProfileDisplay` and `interpretProduct` (background.js, db.js), `mapToCanonicalSchema` in each adapter, `db/shared.ts` types | Make new fields optional; extend `canDisplayGrade` tests; no change to FSA-NPS inputs |
| Map categories (D-1) | quickmart.js `mapToCanonicalSchema`, `scripts/enrich_quickmart.mjs`, the Quickmart JSON, `swap-engine.js` | Stop copying breadcrumb text into `NutritionCategory`; map through a table, and fail the build on unmapped values |
| Server becomes catalogue source of truth | catalog-sync.js (`catalog_hashes`, atomic swap), `build-db` script | Keep the signed hash check; add `catalogue_ver` to every telemetry event |
| Raise cohort k | shared/consent.ts callers, `TenantSettingsView.tsx` (the only place k is mentioned), tests `cad-phase5-consent.test.ts` | Make k a tenant setting with a floor of 20 for insurer and retailer products |
| Per-tenant audit chain | shared/authz.ts obligations (`audit()`), `AuditLogView.tsx` | Replace the stub with `GET /audit_log` filtered by tenant; show chain status |

## 6. Multi-stakeholder data access and security architecture

### 6.1 Starting point and the two roles that are missing

The repository has seven roles (`CAD_ROLES` in shared/claims.ts), an RBAC matrix (`PERMISSIONS`), clearance classes (`CLEARANCE`), step-up rules (`STEP_UP`) and a `decide()` function with obligations. It has **no insurer role and no separate retailer role**: `commercial_stakeholder` serves both (G-11). Add two roles and two resource classes, and keep `commercial_stakeholder` only as an alias until callers move.

| Role | Who | Resource classes | Key permissions |
| --- | --- | --- | --- |
| `writing_clinician`, `viewing_dietician`, `tenant_admin` (existing) | Hospital staff | PHI1, PHI2, ADMIN | As today, plus `adherence_score:read`, `care_log:create` for clinicians, and `outcome_record:create` |
| `payer_analyst` (new) | Insurer analysts and actuaries | `PAYER_T4` | `payer_cohort_reports:read`, `payer_forecasts:read`; `payer_member_scores:read` only with consent C3 |
| `retail_partner` (new) | Retailer category and data teams | `RETAIL_T5` | `retail_insights:read`, `catalogue:create/update`, `offer_settlement:read` |
| `compliance_auditor`, `super_admin` (existing) | Oversight | AUDIT, AUDIT\_META, ADMIN | Remove `target_bundles:read` from `super_admin` (G-11); platform operators reach clinical data only through a dual-control break-glass grant with an alert |

**Files to change:** shared/claims.ts (`CAD_ROLES`, `canonicalizeClaims`), shared/claims.schema.json, shared/authz.ts (`PERMISSIONS`, `CLEARANCE`, `Resource.type` union, `ResourceClass`), `cad/types.ts`, `cad/navigation.ts`, `Navigation.tsx` and `SidebarNavigation.tsx` (role-filtered menus), the `cad-blueprint-phase*.test.ts` files that assert the matrix.

### 6.2 Authentication per stakeholder

| Party | Flow | Details |
| --- | --- | --- |
| Hospital staff | OIDC authorization code with PKCE (`OidcCodePkceProvider` already exists in shared/auth-provider.ts; AuthContext.tsx has the TODO to use it) | Keycloak realm per tenant group; MFA mandatory; `acr` at least 2 for `STEP_UP` actions (target bundles, account updates); access-token claims `tenant_id`, `app_role`, `acr`, `licenceVerified`, PHI-free |
| Patient extension | Dietary Profile Token bound to a DPoP key (`mintDpt`, `verifyDpopProof` exist) | Issued only after clinic-assisted enrolment; no password and no sign-in inside the extension; token refresh through `POST /v1/tokens/refresh` |
| Insurer analysts | OIDC code with PKCE, MFA always, short sessions | Browser portal only; no bulk export except signed report files |
| Insurer systems | OAuth 2 client credentials with mutual TLS-bound tokens (RFC 8705) or `private_key_jwt` | One client per insurer, scopes `payer:cohorts:read` and `payer:forecasts:read`, IP allow-list, rate limit |
| Retailer analysts | OIDC code with PKCE, MFA | Aggregates only |
| Retailer systems | Client credentials with mutual TLS | Scopes `retail:insights:read`, `retail:catalogue:write`, `retail:offers:read`; write access limited to catalogue and price feeds |
| Service to service | Mutual TLS with workload identities; gateway filters check the JWT and set `app.tenant_id` and `app.role` for row-level security | Envoy external-authorisation hook calls `decide()` |

Static API keys are not used for any endpoint that returns health-derived data. If a low-risk endpoint needs one (for example a catalogue feed), store a hash, scope it to one route, rotate it every 90 days and log every use.

### 6.3 Attribute-based rules layered on RBAC

| Stakeholder | Attribute checks in `decide()` (new adapters on `DecisionAdapters`) |
| --- | --- |
| Hospital | `tenant_id` matches the resource; an active treatment relationship between the clinician and the patient (extend the `members` adapter); consent C1 active; purpose is care; `acr` at least 2 for step-up actions |
| Insurer | An active payer contract; the accepted non-adverse-use covenant version; the release carries a valid Expert Determination certificate; k at least 20; member-level reads only with an active C3 receipt naming that insurer |
| Retailer | An active retail contract; the release is `RETAIL_T5` with opaque segments; no field that contains an alias or a clinical term (checked by the release builder, not by trust) |

```ts
// shared/authz.ts: sketch of the new branches (adapters are new members of DecisionAdapters)
if (subject.role === 'payer_analyst') {
  if (resource.class !== 'PAYER_T4') return deny('payer: resource class not permitted')
  if (!(await adapters.contracts?.isActive(subject.orgId, 'payer'))) return deny('payer: no active contract')
  if (!(await adapters.releases?.hasExpertDetermination(resource.releaseId))) return deny('payer: release lacks expert determination')
  if (resource.type === 'payer_member_scores' && !(await adapters.consent?.isActive(resource.patientId, 'C3', subject.orgId)))
    return deny('payer: no member consent')
  return allow([audit(resource, action), flag('payer-access')])
}
```

### 6.4 Split-key tokenisation and masking

**Layers.** (1) Identity data lives in a `clinical` schema, encrypted with `encryptField` and searched through `computeBlindIndex` (both exist in shared/field-encryption.ts); keys come from a `KeyWrapper` (`LocalKeyWrapper` today, an HSM or KMS implementation in production). (2) A `tokens` schema holds only alias derivation functions and issue logs, executable by one service role. (3) A `telemetry` schema holds aliases and events, never identity. (4) A `release` schema holds the only objects that insurer and retailer roles can read. (5) The gateway sets `app.tenant_id` and `app.role` for row-level security.

**Fix the alias derivation first (G-10).** Bind the retailer into the derivation and derive per-retailer keys:

```ts
// shared/dpt.ts: deriveShopperAlias('order', ...) — retailer now part of the input
export function deriveShopperAlias(mode: 'browse'|'order', patientId: string, retailer: string,
    masterKey?: Uint8Array, epoch?: string): string {
  if (mode === 'browse') return base64UrlEncode(randomBytes(16))
  if (!masterKey || !epoch) throw new Error('Order mode requires masterKey and epoch')
  const k = hkdfSync('sha256', masterKey, Buffer.from(`${retailer}:${epoch}`), Buffer.from('shopper-alias/v1'), 32)
  const h = createHmac('sha256', Buffer.from(k)).update(`${patientId}:order:${retailer}:${epoch}`).digest()
  return base64UrlEncode(h.subarray(0, 16))
}
// deriveTenantAlias: throw when no secret is supplied instead of using a constant salt
```

*Side effects:* every caller of `deriveShopperAlias` and `mintDpt` (the `dpt` parameters gain `retailer`), tests `cad-blueprint-phase7.test.ts` and `claims-contract.test.ts`, and all issued tokens (re-issue at the next refresh because aliases change). Document the epoch rotation (90 days) and who holds the master key shares.

**Hospital re-identification for care management (CCM) is internal, not an export.** The hospital enclave job calls `tokens.aliases_for(patient_ref, epochs)` (callable only by the hospital service role), scores the telemetry for those aliases, and stores results in `adherence_score` keyed by `patient_ref`. Clinicians see identity because a treatment relationship exists. CCM time comes from a clinician-entered `care_management_contact_log(patient_ref, staff_id, channel, started_at, minutes)`; the platform never creates billable minutes (Blueprint, Flag 1).

**Insurer masking, implemented in the database, not in the UI:**

```sql
create schema release;
create role payer_reader nologin;

create materialized view release.payer_cohort_month as
select c.segment_code,
       date_trunc('month', a.window_end)::date as month,
       count(distinct a.patient_ref)            as members,
       round(avg(a.score), 1)                   as mean_adherence,
       round(avg(a.variance_score), 3)          as mean_variance
from adherence_score a
join cohort_membership c on c.patient_ref = a.patient_ref
                         and a.window_end between c.valid_from and coalesce(c.valid_to, 'infinity')
join consent_receipt r   on r.patient_ref = a.patient_ref and r.purpose = 'C4' and r.state = 'active'
group by 1, 2
having count(distinct a.patient_ref) >= 20;      -- k >= 20; no patient_ref, no alias, month granularity

grant usage on schema release to payer_reader;
grant select on release.payer_cohort_month to payer_reader;
```

Member-level insurer data is a **separate** view, `release.payer_member_scores`, filtered by an active C3 receipt naming the requesting insurer and by its expiry; it is empty by default. The retailer view `release.retail_category_week` has the same shape, keyed by retailer, category, ISO week and opaque `segment_code`, with `having count(distinct shopper_alias) >= 20 and sum(orders) >= 10`. Laplace noise on repeated counts is added in `services/release/k-anon.ts`, not in SQL, so the noise parameters are versioned and tested.

### 6.5 Delivery: endpoints and webhooks

| Party | Endpoint | Returns | Auth |
| --- | --- | --- | --- |
| Hospital | `GET /v1/hospital/patients/{patient_ref}/adherence?from&to` | Adherence digest (report 2, Section 4.5) | OIDC, `decide()` |
| Hospital | `GET /v1/hospital/patients/{patient_ref}/variance` | Per-nutrient variance and top contributing items | OIDC |
| Hospital | `POST /v1/hospital/profiles` and `POST /v1/hospital/profiles/{id}/sign` | New profile version; signing requires step-up | OIDC, `acr` ≥ 2 |
| Hospital | `GET/POST /v1/hospital/care-log` | Contact log with minutes, entered by staff | OIDC |
| Hospital | `GET /v1/hospital/billing-export?month=` | CCM time log for the billing practitioner (PHI) | OIDC, audit obligation |
| Insurer | `GET /v1/payer/cohort-report?month=YYYY-MM` | Rows of `release.payer_cohort_month` | mTLS client credentials |
| Insurer | `GET /v1/payer/forecasts?horizon=90` | Cohort trajectory and risk forecasts with intervals | mTLS |
| Insurer | `GET /v1/payer/members/{member_ref}/scores` | Member-level scores, only under C3 | mTLS + consent check |
| Retailer | `GET /v1/retail/insights?week=YYYY-Www` | Rows of `release.retail_category_week` | mTLS |
| Retailer | `PUT /v1/retail/catalogue` | Accepts SKU, price, stock and nutrition-claim feeds | mTLS, write scope |
| Retailer | `GET /v1/retail/offers/settlement?period=` | Voucher redemptions per `offer_id`, aggregated | mTLS |
| Extension | `POST /v1/events`, `POST /v1/tokens/refresh`, `GET /v1/revocations`, `GET /v1/catalogue/manifest`, `GET /v1/offers` | Ingest, refresh, revocation list, signed pack manifests | DPT + DPoP |

**Webhooks** carry a pointer, never data, and are signed:

```json
{
  "id": "wh_01JD3K",
  "type": "report.ready",
  "created": "2026-12-01T06:00:00Z",
  "data": { "product": "payer_cohort_month", "month": "2026-11", "url": "https://api.example.co.ke/v1/payer/cohort-report?month=2026-11", "sha256": "5d10..." }
}
```

Send an `X-NS-Signature: t=<unix>,v1=<hmac-sha256 over t.body>` header, reject signatures older than 5 minutes, keep the delivery log in `audit_log`, and retry with backoff for 24 hours.

### 6.6 Compliance mapping

| Requirement | Mechanism | Where |
| --- | --- | --- |
| Minimum necessary (HIPAA), data minimisation (GDPR Art. 5, KDPA principles) | Views expose only aggregates; tokens carry semantic limits | `release.*` views, `dpt.ts` allow-list |
| Pseudonymisation is not anonymisation (GDPR, EDPB) | Aliases per retailer and epoch; T1 stays in the enclave; insurer products go through Expert Determination | `deriveShopperAlias`, `services/release/` |
| Purpose limitation and revocable consent | Purpose-coded receipts; policy decision point in `decide()`; fail-closed gateway | `consent_receipt`, `services/ingest/gateway.ts` |
| Audit of access and transformation | Hash-chained `audit_log`, Merkle anchors, verifier | migration 0006, `services/audit/` |
| Residency (KDPA, ODPC guidance) | Kenyan hosting; no foreign sub-processors for T0–T1 | deployment configuration |
| Right to erasure | Per-subject data keys, crypto-shredding that deletes the key; replace the `cryptoShredPatient` stub | shared/consent.ts, `key-wrapper.ts` |

### 6.7 Side effects of the access work

Role additions touch `claims.ts`, `claims.schema.json`, `authz.ts`, the CAD navigation and the phase tests; the Keycloak realm needs two new client types and the `acr` mapping; the `release` schema needs a refresh schedule and a monitoring check that fails the build if any view returns a row with fewer than 20 members; and `check-cad-security.mjs` (absent from the archive) should gain a rule that no `release` view references `patient_ref` or `shopper_alias`.

## 7. Sequenced execution roadmap

Effort sizes are rough \[A\]: S under 2 days, M under 1 week, L 1–3 weeks.

### Phase 0: safety and hygiene (week 0–1). No new features; each item is small and independent.

- [ ] **G-04** `evaluateSkuAgainstConstraints`: missing nutrient fails; `review_state` must be VERIFIED or higher; add tests. *(S)*
- [ ] **G-03** `bandValue`: round maximums down and minimums up. *(S)*
- [ ] **G-10** `deriveShopperAlias` includes the retailer; remove the constant-salt fallback in `deriveTenantAlias`. *(S)*
- [ ] **G-09** Replace `cryptoShredPatient` with key deletion, or mark it unimplemented and block the erasure UI. *(S)*
- [ ] **G-07** Remove the literals in `CommercialInsightsView.tsx`; show an empty state until live data exists. *(S)*
- [ ] **G-16, G-19** Drop the `scripting` permission and `data/*.json` from `web_accessible_resources` (confirm nothing in a content script fetches them); delete the unreachable content.js legacy path. *(S)*
- [ ] **Capture protocol** (Section 2.5) on all three retailers; commit the HTML fixtures. *(S)*

### Phase 1: core schema and adapters (weeks 1–4)

- [ ] Adapter lifecycle: `RootBinder`, `scanner.rebind()`, removed-node recovery, capture-phase click, shared `closestCard()`, `extractProductRef()`. Naivas N1–N5 and N8, Carrefour C1–C4 and C7. *(L)*
- [ ] Fixture and jsdom tests for all three adapters, including the morph-recovery and ‘clicked product’ assertions. *(M)*
- [ ] `BaseAdapter` plus declarative specs (Quickmart first as the reference, then Naivas, then Carrefour); `NutriTelemetry.emit` for `SKU_Attempted`, `Cart_Add`, `Badge_Render` (local only). *(L)*
- [ ] Catalogue: map Quickmart categories (D-1), remove schema drift (D-2), add the missing fields (D-3), and run a curation sprint on sodium, sugars and fibre for VERIFIED coverage. *(L)*
- [ ] Device schema v19; `MESSAGE_HANDLERS` refactor. *(M)*
- [ ] DPT vocabulary extension (G-02); extension-side `profile-token.js` verification; `constraint-evaluator.js` shared with Node; remove tier code (G-21). *(L)*
- [ ] Server migrations 0001–0003 and 0006; ingest gateway; consent receipt service; audit chain and verifier. *(L)*
- [ ] Split `commercial_stakeholder` into `payer_analyst` and `retail_partner`; remove `super_admin` target read (G-11). *(M)*

**Exit gate:** adapter fixtures pass on all three retailers; token round trip (mint, verify offline, expire, revoke) passes; tamper test on `audit_log` fails verification as expected; Phase 0 items closed.

### Phase 2: swap engine and flyout redesign (weeks 4–8). Needs Phase 1 items 1, 3, 4, 5 and 6.

- [ ] `grade-palette.ts`, `ds/` primitives, flyout bundle and all states (Section 4.3). *(L)*
- [ ] `swap-engine.js`, `by-kfct-category` index, offers pack, `swapInCart` per retailer (validated on live pages). *(L)*
- [ ] `variance-lite.js` and the variance strip; `Blocked_Attempt`, `Swap_*` events; outbox with consent gating and revocation purge. *(M)*
- [ ] Visual regression and accessibility audit (keyboard, focus, contrast) for every flyout state. *(M)*
- [ ] Pilot readiness review: grade coverage at least 80% for displayed SKUs, false-block rate at most 1% on a labelled set, no unresolved safety event. *(S)*

### Phase 3: analytics pipeline and stakeholder APIs (weeks 8–14). Needs Phases 1 and 2 and pilot data.

- [ ] ETL: `nutrient-normalise.ts`, quarantine, cart episodes, daily `exposure`, `variance`, `adherence` jobs and tables (migrations 0004). *(L)*
- [ ] `recalibrate.ts` in shadow mode; hospital digest endpoints and webhooks. *(M)*
- [ ] Cohorts and risk models (migration 0005, Python jobs) once enough patient-quarters exist. *(L)*
- [ ] `release` schema, `k-anon.ts`, Expert Determination gate, insurer and retailer endpoints with mTLS, webhooks. *(L)*
- [ ] Replace CAD stubs with live calls: `AuthContext.tsx`, `UserManagementView`, `AuditLogView`, `TenantSettingsView`, `PatientLinkingConsentView`, `ClinicianWorkspaceView`, `CommercialInsightsView`. *(L)*
- [ ] External security and privacy review, DPIA sign-off, penetration test of the gateway and release layer. *(M)*

```
Phase 0 --> Phase 1: (1)(2)(3) adapters --> (9)(10)(11) flyout, swap, telemetry
                     (4) catalogue ------> (10) swap eligibility, (13) coverage gate
                     (5) device schema --> (10)(11)
                     (6) token + evaluator --> (9)(10)(11)
                     (7)(8) server + roles --> (14)(15)(17)(18)
Phase 2 (13 pilot gate) --> pilot --> Phase 3 (16 needs pilot data)
```

### Verification items I could not complete

1. Run `npm ci`, `npm run typecheck`, `npm test` and `npm run build` on a clean machine (the build scripts are missing from this archive).
2. Run the capture protocol on live Naivas, Carrefour and Quickmart pages to confirm or reject N1–N8 and C1–C7.
3. Check whether any content script reads `data/*.json` before removing it from `web_accessible_resources`.
4. Confirm the Chrome version that supports Ed25519 in WebCrypto against `minimum_chrome_version` 110.
5. Review the unread files (Dashboard.tsx, Options.tsx, entitlement.js, patient-export.ts, target-sync.ts, key-wrapper.ts) for additional findings.
