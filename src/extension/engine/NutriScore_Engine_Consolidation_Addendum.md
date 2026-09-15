# Engine Consolidation — Integration Addendum
### Updates to "Engine Integration Directive" now that DiseaseEngine + NutritionContextEngine live in one file behind NutriScoreEngine

**Relationship to the previous directive:** this does not replace it. Sections 3 (storage unification), 4 (product resolution), 7 (MV3 constraints), 6a (cart-sync retry via `chrome.alarms`), 8 (content script adapters), 9 (open decisions), and 10 (rendering split) are **unchanged and still authoritative** — read them there. This addendum covers only what the engine consolidation actually changes: how many scripts get loaded, which function the service worker calls, and what the caching guidance now looks like given a measured throughput number.

---

## 1. What changed, precisely

- `disease-engine.js` + `nutrition-context-engine.js` (two files) → `nutri-score-engine.js` (one file, four exports: `DiseaseEngine`, `NutritionContextEngine`, `NutriScoreEngine`, `Kernel`).
- The service worker's `EVALUATE_PRODUCT` handler should call `NutriScoreEngine.evaluate(product, patientProfile)` **once**, not `NutritionContextEngine.evaluate()` and `DiseaseEngine.evaluate()` as two separate steps that the SW then has to reconcile itself. The facade already returns the combined shape the message contract specifies.
- Accuracy fix included in the consolidation: `DiseaseEngine`'s sodium exposure (hypertension, renal) now falls back to `SaltG`-derived sodium when `SodiumMG` is absent, matching what `NutritionContextEngine` already did. This will change output for any product where only `SaltG` is populated — that's a correction, not a regression, but it means any existing golden-file test fixtures built against the old behavior need updating (Section 5 below).
- Removed API surface: `DiseaseEngine.parseNutrient`/`.clamp` and `NutritionContextEngine.parseNutrient`/`.clamp`/`.isLiquid`/`.resolveSodiumMg` no longer exist as methods on those objects — they live on `Kernel` now. Grep for direct calls to these before removing the old files.

---

## 2. Retire the old files — don't let them coexist

**Directive, in order:**
1. `grep -r "disease-engine" .` and `grep -r "nutrition-context-engine" .` across the extension codebase to find every import/require/`importScripts()` reference.
2. Repoint each to `nutri-score-engine.js`, importing whichever of the four exports that call site actually needs (see the table in Section 3 — most call sites want `NutriScoreEngine`, not the sub-engines directly).
3. If the service worker currently loads the two engine files via two separate `importScripts()` calls (the common pattern for a non-module MV3 service worker), collapse that to one `importScripts('nutri-score-engine.js')`. This is a small but real win on top of correctness — fewer scripts to fetch/parse/execute on every SW cold start, which happens often given MV3's non-persistent lifecycle.
4. **Delete** `disease-engine.js` and `nutrition-context-engine.js` once the new file is verified working — don't leave them in the repo "just in case." A stale, unused copy of the pre-fix `DiseaseEngine` sitting in the tree is exactly the kind of thing that gets accidentally re-imported or hand-edited out of habit six months from now.

---

## 3. Which export to call from where

| Caller | Call | Why |
|---|---|---|
| Service worker, `EVALUATE_PRODUCT` handler | `NutriScoreEngine.evaluate(product, patientProfile)` | Standard path — both context grade and profile-conditional warnings, computed from one shared parse. |
| Service worker, catalog pre-computation (if you ever pre-warm badges for the full catalog independent of any shopper) | `NutritionContextEngine.evaluate(product)` | `ContextScore`/`HealthFlags` don't depend on a patient profile — no need to run disease logic or supply one. |
| Dashboard, a "how would this product look under condition X" preview (if you build one) | `DiseaseEngine.evaluate(product, patientProfile)` | Testing one hypothetical profile against one product without recomputing context grading. |
| Test suite | `Kernel.parseNutrient`, `Kernel.normalizeProduct`, `Kernel.resolveSodiumMg` directly | Unit-test the shared parsing/derivation logic in isolation from either engine's scoring. |

`NutriScoreEngine` is the default. Reach for a sub-engine directly only when you specifically don't need the other one's output — don't route everything through the facade reflexively if a call site genuinely only needs context grading; that's an unnecessary `patientProfile` dependency for no benefit.

---

## 4. Service worker orchestration — before/after

This replaces the engine-calling portion of the previous directive's Section 6 (the message contract table and MV3 constraints there are unchanged; this is just the implementation inside the handler).

**Before:**
```js
const contextResult = NutritionContextEngine.evaluate(product);
const diseaseResult = DiseaseEngine.evaluate(product, patientProfile);
// SW then needs its own glue code to combine these into one response
```

**After:**
```js
const { NutriScoreEngine } = require('./nutri-score-engine.js'); // or your SW's module loading equivalent

// inside the EVALUATE_PRODUCT handler:
const evaluation = NutriScoreEngine.evaluate(product, patientProfile);
// evaluation.contextScore, .healthFlags, .diseaseAssessment, .warnings, .disclaimer
// already match the response shape the message contract specifies — no reconciliation code needed.
```

The combining logic that used to have to live in the SW (or worse, get duplicated across SW and UI) now lives once, tested, inside the engine file.

---

## 5. Caching guidance — reconciled with a measured number

The previous directive's Section 5 said: don't persist a cache of engine *output*, because it's cheap to recompute and risks silently serving a stale disease assessment after a profile edit. That guidance is now backed by an actual number rather than just reasoning: evaluating 10,500 products through `NutriScoreEngine` (both engines, shared parse) benchmarks at **~110ms total, ~0.01ms per product**, in Node.

**Directive:** don't build the `evaluationCache` IndexedDB store's persisted-output ambition at all. It's not worth the invalidation-correctness risk for a step that costs a hundredth of a millisecond. The resolution cache (matching a raw scraped product name to a full schema object — still Section 5's genuinely expensive, shared step) remains the only thing worth persisting or coalescing.

---

## 6. Migration verification checklist

- `grep -r "disease-engine\|nutrition-context-engine"` across the repo returns nothing outside of git history.
- The extension's manifest/service-worker entry loads exactly one engine script.
- Re-run (or write, if they don't exist yet) a test case for a product with `SaltG` populated and no `SodiumMG` key at all, against an active hypertension or renal profile — confirm it now correctly triggers rather than reading as missing data. If a prior fixture asserted the old (incorrect) "missing sodium" behavior, update that assertion — it was encoding the bug, not the intended behavior.
- `NutriScoreEngine.evaluate(product)` called with no second argument doesn't throw, and returns an empty `diseaseAssessment` (mirrors `DiseaseEngine`'s own `no_active_conditions` short-circuit).
- Confirm every UI call site that previously called `NutritionContextEngine.evaluate()` and `DiseaseEngine.evaluate()` separately now goes through `NutriScoreEngine`, *unless* it's one of the genuine single-engine cases in Section 3's table.
- Everything from the first directive's Section 8 verification pass (SW memory across wake cycles, cart-sync retry surviving SW termination, HTML-special-character product names rendering as text) still applies unchanged and should still be run.
