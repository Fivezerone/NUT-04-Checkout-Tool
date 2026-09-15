# NUT-04 Checkout Tool — Zero-Assumption Codebase Analysis

---

## 1. System Architecture Map

### Core Components

| Layer | Module | Runtime | Role |
|---|---|---|---|
| **Extension Manifest** | `manifest.json` (MV3) | Chrome | Declares permissions, injects scripts, registers SW |
| **Service Worker** | `background.js` | SW context | Message broker, product lookup orchestrator, IDB write gate |
| **Data Layer** | `db.js` (built from `db.ts`) | SW + UI | IndexedDB wrapper (idb), product matching, FSA-NPS scoring, analytics |
| **Disease Engine** | `engine/disease-engine.js` | SW context | Per-condition dietary burden scoring and shopper warning generation |
| **Content Script** | `content.js` | Page context | DOM observer, adapter router, cart sync, badge injection coordinator |
| **Retailer Adapters** | `adapters/naivas.js`, `adapters/carrefour.js` | Page context | DOM scraping, cart state extraction, API fetching |
| **Shared UI** | `adapters/shared-ui.js` | Page context | Shadow DOM badge, flyout portal, placement logic |
| **Grade Colors** | `adapters/grade-colors.js` | Page context | Global color map for A-E grades |
| **UI — Dashboard** | `Dashboard.tsx` + `Charts.tsx` | Browser (Preact) | Full analytics dashboard with charts, ledger table, settings |
| **UI — Popup** | `Popup.tsx` | Browser (Preact) | Toolbar badge mini-panel with live page stats |
| **UI — Onboarding** | `OnboardingWizard.tsx` | Browser (Preact) | First-run user profile and health condition setup |
| **Domain Types** | `nutriscore.ts`, `domain.ts` | TypeScript compile-time | Shared types, grade helpers, timeframe/bucket logic |
| **Raw Data** | `data/carrefour_products.json` (10 MB), `data/naivas_products.json` (5.8 MB) | Bundled static | Ground-truth product + nutrition dataset |

---

### Data & Execution Flow

#### A. Extension Boot (Service Worker)

```
SW Start
  -> importScripts("db.js", "engine/disease-engine.js")
  -> initializeDatabases()           [singleton Promise guard]
      -> NutriScoreDB.importDatasets()
          -> fetch("data/carrefour_products.json") + fetch("data/naivas_products.json")
          -> IDB bulk insert in 500-record chunks
          -> write dataset_metadata record (version, recordCount, retailer)
```

#### B. Page Load (Content Script)

```
document_end
  -> NutriScoreContentEngine constructor
  -> init()
      -> assign window.RetailerAdapter (naivas.js or carrefour.js written to this slot)
      -> attach click handler (extractCartAction / extractRemoveAction)
      -> attach chrome.runtime.onMessage (GET_PAGE_STATS)
      -> MutationObserver -> debounced scanAndInject (300ms) + syncCart (1000ms)
      -> _startNavMonitor() -- Navigation API or polling interval
      -> scanAndInject() [initial pass]
      -> syncCart(fetchApi=true) [initial pass]
      -> checkOrderConfirmation()
```

#### C. Product Badge Injection (per card)

```
adapter.detectProducts()
  -> [{ domElement, id, name, nameHash, price, url }]
  -> filter: already processed? already in notFoundCache?
  -> chrome.runtime.sendMessage({ action: "CHECK_PRODUCT_SCORE", retailer, payload })
      -> background.js handler
          -> initializeDatabases()  [noop if already done]
          -> NutriScoreDB.getCachedProduct(cacheKey)
              -> hit? -> re-evaluate DiseaseEngine (settings may have changed) -> return
              -> miss -> NutriScoreDB.resolveProductMatch(retailer, id, url, name)
                  -> priority: product_id -> url -> exact_name -> case_insensitive -> normalized
                  -> miss -> throw Error("Product not found")
          -> NutriScoreDB.interpretProduct(groceryProduct)   [eligibility + evidence tier]
          -> DiseaseEngine.evaluate(groceryProduct, patientProfile)
          -> NutriScoreDB.computeGradeFromProduct(groceryProduct)  [FSA-NPS scoring]
          -> assemble result object
          -> NutriScoreDB.saveProduct(cacheKey, result).catch()   [fire-and-forget]
          -> sendResponse({ status: "SUCCESS", data: result })
      -> content script receives response
          -> card.setAttribute("data-nutriscore-grade", grade)
          -> adapter.injectBadge(card, product, price)
              -> NutriSharedUI.injectBadge(...)
                  -> attachShadow({ mode: "open" })
                  -> badge click -> _ensureGlobalPortal() -> flyout rendered into fixed overlay
```

#### D. Cart Tracking Flow

```
User clicks "Add to Cart"
  -> content.js click handler -> adapter.extractCartAction(e.target) -> item
  -> chrome.runtime.sendMessage({ action: "LOG_CART_ADD", payload: item })
      -> background.js
          -> resolveProductMatch(...)
          -> getProductInfo(item, retailer)  [full scoring]
          -> NutriScoreDB.logCartEvent(row)  [IDB write; deduplicates by retailer+productId]
          -> chrome.runtime.sendMessage({ action: "CART_UPDATED" })  [-> Dashboard reload]

MutationObserver fires (1000ms debounce)
  -> syncCart()
      -> adapter.extractCartState()  [DOM scrape]
      -> adapter.fetchCartFromAPI()  [if fetchApi=true]
      -> merge DOM + API items (DOM wins on conflict)
      -> chrome.runtime.sendMessage({ action: "SYNC_CART_STATE", items })
          -> background.js -> NutriScoreDB.syncCart(retailer, items)
              -> dedupeActiveCartItems()
              -> update quantities/prices for existing in_cart rows
              -> insert new rows via logCartEvent()
```

#### E. Dashboard Render Flow

```
dashboard.html -> DashboardRoot (React/Preact)
  -> getSettings() [IDB]
  -> if no profile -> OnboardingWizard
  -> Dashboard component
      -> getAllEntries() [IDB: shopping_ledger by-addedAt, reversed]
      -> useMemo: resolveTimeframe(range) + calculateAnalytics(filtered, total, tf)
          -> generateBucketSlots(tf)
          -> forEach entry: grade count, price/category map, health alert thresholds,
                            nutrient trend accumulation per bucket
      -> render: DonutChart, LineTrend, HBarChart, StackedHBarChart, ledger Table
  -> listen chrome.runtime.onMessage("CART_UPDATED") -> reload()
```

---

### External Dependencies

| Dependency | Version | Where Used | Coupling Level |
|---|---|---|---|
| `idb` | 8.0.3 | `db.ts` bundled into `db.js` | **Tight** — inlined into generated IIFE |
| `preact` | 10.29.7 | Aliased as `react`/`react-dom` in Vite | **Tight** — alias-layer swap |
| `@vitejs/plugin-react` | 4.7.0 | Build only | Low |
| `@tailwindcss/vite` | 4.1.12 | Build only | Low |
| `lucide-react` | 0.487.0 | Dashboard icons | Low |
| `sonner` | 2.0.3 | Toast notifications | Low |
| `motion` | 12.23.24 | Animation | Low |
| `react-router` | 7.13.0 | Declared, **no routing visible in scanned UI** | Dead dependency |
| `react-hook-form` | 7.55.0 | Declared, **not observed in use** | Dead dependency |
| `react-day-picker` | 8.10.1 | Declared, **not observed in use** | Dead dependency |
| Chrome Extension APIs | MV3 | `background.js`, `content.js` | **Platform lock-in** |
| Naivas / Carrefour DOM | Live sites | Adapters | **Extremely tight** — CSS selector coupling |

---

## 2. Structural & Performance Evaluation

### The "Good" — Sound Architecture

#### 1. Single Source of Truth for Data Layer
`db.ts` is compiled via `scripts/build-db.mjs` (esbuild IIFE) into `db.js`. The Service Worker and the React UI share **one codebase** for all IndexedDB logic, FSA-NPS scoring, and analytics. This is architecturally excellent — a forced contract that prevents drift between the two runtimes.

#### 2. Content Script Maintains a Clean Boundary
`content.js` contains **zero business logic**. It delegates: product detection to adapter, badge rendering to adapter/shared-ui, scoring to background message. The comment at line 1 explicitly enforces this constraint. Textbook separation of concerns.

#### 3. DiseaseEngine is Stateless and Testable
`disease-engine.js` is a pure object with no external dependencies. It operates on a `{ Nutrition: {...} }` shaped input and returns a deterministic result. The `INTERACTIONS` array uses tuple-of-conditions instead of a concatenated string key — a deliberate fix noted in comments, avoiding a silent `split("_")` breakage.

#### 4. Shadow DOM Isolation
Every badge is injected into a Shadow DOM (`attachShadow({ mode: "open" })`). This prevents CSS bleed-in/bleed-out with retailer stylesheets — correct and robust for extension badge isolation.

#### 5. Global Portal Pattern for Flyouts
The single `_nutriscoreGlobalPortal` div (`z-index: MAX_INT`, `position:fixed`, `pointer-events:none`) with a single active flyout constraint solves z-index stacking context wars common in extension overlays. The scroll-listener closes open flyouts passively.

#### 6. IDB Singleton with Version Guard
`getDB()` uses a module-level promise singleton (`dbPromise`). The upgrade path handles 10 sequential schema versions cleanly, including safe store deletion before recreation. `blocked`/`blocking` events are handled with appropriate console warnings.

#### 7. Product Cache Versioning
`getCachedProduct` validates against both `scoringVersion` and `datasetVersion`. A cached product is invalidated if either the scoring algorithm or the underlying dataset changes.

#### 8. Debounced MutationObserver with Separate Timers
Two distinct debounce timers (300ms for scan, 1000ms for cart) avoid coupling high-frequency DOM mutations to expensive API calls. Architecturally correct.

#### 9. Cart Sync Merge Strategy
`syncCart()` in `content.js` correctly gives DOM-extracted items precedence over API-fetched items. This respects "what the user actually sees" over what the API reports.

---

### The "Bad" — Design Flaws & Bottlenecks

#### FLAW 1 — `memCache` is a Module-Level Global with No Invalidation
**Location:** `db.js` lines 667–669
```js
var memCache = { carrefour: null, naivas: null };
```
Once the full product array is loaded into memory, it **never expires**. If the dataset is re-imported (e.g., user installs an updated extension version), the IDB store is updated but the in-memory cache remains stale until the SW is terminated. The SW can persist across browser sessions in some configurations.

**Impact:** Stale product matches after dataset updates. Dangerous because the version check (`datasetVersion`) in `getCachedProduct` guards the `product_cache` store, but `memCache` raw product arrays bypass this check entirely.

#### FLAW 2 — `resolveTimeframe()` Exists in Two Divergent Implementations
**Locations:** `src/ui/src/app/lib/domain.ts` (lines 20–124) vs `src/extension/db.js` (lines 881–920, compiled from `db.ts`)

The `db.ts` version returns `{ windowStart, windowEnd, bucketUnit, bucketCount, tickLabelFormat, tickLabelFn }`. The `domain.ts` version returns `{ key, windowStart, windowEnd, bucketUnit, tickLabelFn }` — no `bucketCount`, no `tickLabelFormat`. `Dashboard.tsx` imports from `"../lib/db"` then **mutates its returned object**:

```js
tf.windowStart = oldest;    // line 183
tf.bucketUnit = "week";     // line 185
```

**Impact:** Behavioral inconsistency between implementations. `domain.ts:resolveTimeframe` is unused dead code. Future changes to either will silently diverge.

#### FLAW 3 — Health Alert Threshold Duplication with a Logical Discrepancy
**Location A:** `db.js` line 1007:
```js
if (sodium > 600 || potassium > 200) kidney++;
```
**Location B:** `domain.ts` line 310:
```js
if (sodiumMg > 600) kidney++;
```
Kidney alert in `calculateAnalytics` fires on **sodium OR potassium**. In `domain.ts:evaluateHealthAlerts`, the potassium branch is missing. Silent logical discrepancy between two functions purporting to do the same thing.

#### FLAW 4 — CVD Alert Disconnected from DiseaseEngine
`DiseaseEngine.DISEASE_RULES` has no "cvd" condition (explicitly removed). Yet `calculateAnalytics()` and `domain.ts` still compute a `cvd` count using inline thresholds `satFat > 5 || (sodium > 400 && sodium <= 600)`. Any change to CVD thresholds requires hunting multiple hardcoded sites.

#### FLAW 5 — `logCartEvent()` Does a Full Table Scan on Every Cart Add
**Location:** `db.js` lines 389–401
```js
const all = await db.getAllFromIndex("shopping_ledger", "by-addedAt");
const existing = all.find(r => r.retailer === row.retailer && r.productId === row.productId && r.status === "in_cart");
```
Fetches the **entire ledger** on every add. O(n) linear scan. No compound index on `(retailer, productId, status)`. Degrades progressively as ledger grows — the ledger has no pruning.

#### FLAW 6 — `dedupeActiveCartItems()` Also Does a Full Table Scan
**Location:** `db.js` lines 477–503
```js
const all = await db.getAll("shopping_ledger");
```
Called at the start of every `syncCart()`. Called potentially every 1000ms via the MutationObserver debounce. Same O(n) problem, more frequently triggered.

#### FLAW 7 — Probabilistic Product Cache Eviction (5% Chance on Write)
**Location:** `db.js` lines 527–538
```js
if (Math.random() < 0.05) {
  // cursor walk + delete entries older than 7 days
}
```
Eviction fires randomly on 5% of product cache writes. During a heavy session scanning 100 product cards, this triggers ~5 full cursor-walk eviction passes. Probabilistic noise causing spiky latency — not a controlled eviction strategy.

#### FLAW 8 — `importDatasets()` Has No Re-import Guard
**Location:** `db.js` lines 550–583
```js
if (count === 0) { /* only imports if store is empty */ }
```
Once any record exists, the dataset will **never be re-imported** regardless of what the bundled JSON contains. `dataset_metadata.datasetVersion` is hardcoded as `"v2.0.0"` at write time — not read from the JSON. Updating product data silently fails unless `DB_VERSION` is bumped.

#### FLAW 9 — Flyout Placement Reads Dimensions Before Layout
**Location:** `shared-ui.js` lines 315–342
```js
flyoutEl.style.cssText = "...;visibility:hidden";
portal.appendChild(flyoutEl);
const flyoutRect = flyoutEl.getBoundingClientRect(); // layout hasn't happened yet
```
`getBoundingClientRect()` is called immediately after appending the element with `innerHTML` just set. The browser has not laid out the content. `flyoutHeight` will be 0, meaning the flip-above logic `if (spaceBelow < flyoutHeight + margin)` **never fires**. The flip-above feature is effectively broken.

#### FLAW 10 — `popup.tsx` Polls Chrome Tab API Every 1000ms Unconditionally
**Location:** `popup.tsx` lines 39–40
```js
const interval = setInterval(fetchStats, 1000);
```
Triggers `chrome.tabs.query` + `chrome.tabs.sendMessage` every second for the popup's lifetime. No reactive update from the content script. Unnecessary ongoing load on an already message-heavy system.

#### FLAW 11 — `applyPersonalization()` Runs on Every Render
**Location:** `dashboard.tsx` lines 106–110
```js
useEffect(() => {
  if (profile) { applyPersonalization(profile); }
}); // no dependency array
```
No dependency array means this runs after every single render. `applyPersonalization` does multiple direct DOM mutations (querySelector + textContent/replaceChildren). Repeated unnecessary DOM writes on every state update.

#### FLAW 12 — `Dashboard.tsx` Mutates the Object Returned by `resolveTimeframe()`
**Location:** `Dashboard.tsx` lines 183–187
```js
tf.windowStart = oldest;
tf.bucketUnit = "week";
```
Mutating the direct return value of a function inside `useMemo` is a React anti-pattern. Any future reference held to this object will see the mutation. Breaks referential integrity assumptions that React/Preact memoization depends on.

#### FLAW 13 — Silent Strategy Swallowing in Naivas Cart API Fetch
**Location:** `naivas.js` lines 152–229
Three strategies are tried sequentially, each with `catch(e) { /* silent */ }`. If Strategy 1 fails on malformed JSON, Strategy 2 silently runs. No observability into which strategy succeeded or failed. If Livewire's structure changes, there is no diagnostic surface.

#### FLAW 14 — `buildPatientProfile()` Defined Inside a Hot Function
**Location:** `background.js` lines 52–60
```js
// inside getProductInfo() — called for every product card
function buildPatientProfile(s) { ... }
```
Function closure re-created on every invocation of `getProductInfo()`. Should be hoisted to module scope.

#### FLAW 15 — React/Preact Alias Stack is Fragile
**Location:** `vite.config.ts` lines 29–32
```js
"react": "preact/compat",
"react-dom": "preact/compat",
"react/jsx-runtime": "preact/jsx-runtime",
```
Combined with `react({ jsxRuntime: 'classic' })` and `window.React = React` hacks in both entry points, this is a fragile shim stack. Third-party libraries that import `react/jsx-runtime` directly may bypass the alias, loading the real React peer alongside preact and creating two concurrent renderer instances.

---

## 3. Change-Impact Matrix

### Brittle Zones — Ranked by Blast Radius

| Zone | File(s) | Risk Level | Why It's Brittle |
|---|---|---|---|
| **`db.ts` / `db.js` build pipeline** | `db.ts`, `build-db.mjs`, `db.js` | CRITICAL | Any change to `db.ts` requires `npm run build:db` or the SW runs stale code. No build-time enforcement. The generated `db.js` is checked in — trivial to forget to regenerate. |
| **`memCache` global** | `db.js` lines 667–669 | CRITICAL | All product lookups after first SW load read from this cache. Invalidation only on SW termination. A new dataset version silently serves old data. |
| **Retailer DOM selectors** | `naivas.js`, `carrefour.js` | CRITICAL | Any CSS class or DOM structure change by Naivas or Carrefour silently breaks product detection, cart extraction, or price parsing. No fallback validation, no telemetry. |
| **FSA-NPS scoring thresholds** | `db.ts` `computeGradeFromProduct()` | HIGH | Changing any threshold affects every cached and live grade. `product_cache` is versioned (`SCORING_VERSION = "v3"`) but `memCache` is not — mismatches are possible. |
| **DiseaseEngine thresholds vs analytics thresholds** | `disease-engine.js` DISEASE_RULES vs `db.ts` `calculateAnalytics()` | HIGH | Changing a disease threshold in DISEASE_RULES will NOT update the `calculateAnalytics()` health alert counts, which hardcode matching values. Must be kept in sync manually. |
| **IDB schema version** | `db.ts` `DB_VERSION = 10` | HIGH | Incrementing DB_VERSION triggers the upgrade callback. A missing or incorrect upgrade path for the new version corrupts all users' IDB. Sequential if-chains are the only guard. |
| **`importDatasets()` guard** | `db.ts` | HIGH | Condition `if (count === 0)`. Once any record exists, dataset never re-imports. Adding products to the JSON without bumping DB_VERSION silently ignores them. |
| **Chrome messaging action strings** | `background.js`, `content.js` | MEDIUM | `message.action` string literals are untyped. Renaming one side causes silent failures — `sendMessage` callbacks swallow errors. |
| **Shared-UI flyout placement** | `shared-ui.js` lines 315–342 | MEDIUM | Any retailer card wrapped in `transform` CSS creates a new stacking context, making `getBoundingClientRect` relative to the transform origin instead of the viewport. |
| **`window.RetailerAdapter` global** | `naivas.js`, `carrefour.js`, `content.js` | MEDIUM | Both adapters write to `window.RetailerAdapter` as their last line. Adding a third adapter or having two load on the same page: last-writer wins, silently. |
| **`applyPersonalization()` element IDs** | `dashboard.tsx` | MEDIUM | Hard-codes IDs (`"user-greeting"`, `"user-avatar-badge"`, etc.). Any renaming or structural change in Dashboard.tsx silently disables personalization. |
| **`analytics` useMemo object mutation** | `Dashboard.tsx` lines 183–187 | MEDIUM | Mutating the `tf` result inside `useMemo` is a React anti-pattern. Future Preact optimizations that memoize or reuse this reference will produce incorrect analytics. |

---

## Summary Verdict

**Architecturally sound:** The layered separation (SW / content / adapter / UI), the single-source `db.ts` build pattern, the stateless DiseaseEngine, shadow DOM isolation, and IDB versioning model are all well-reasoned decisions showing deliberate architectural thinking.

**Technically fragile:** Converging failure modes are concentrated in the data layer. Most critically: unbounded `memCache`, divergent `resolveTimeframe` implementations, a never-refreshing dataset import guard, and full-table-scan patterns on every cart event. These will degrade silently under real-world usage with no diagnostic surface.

**Highest priority interventions:**
1. Add `memCache` invalidation tied to `dataset_metadata.datasetVersion`
2. Unify `resolveTimeframe` to one implementation; delete `domain.ts` dead version
3. Add compound IDB index on `(retailer, productId, status)` to replace O(n) cart scans
4. Fix flyout placement: measure dimensions after `requestAnimationFrame` or use explicit `width/height` CSS
5. Automate `build:db` as a pre-commit hook or CI step — it is currently a manual, unenforced step
