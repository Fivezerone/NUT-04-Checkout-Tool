# §3.1 Record Size Measurements

**Method:** `Buffer.byteLength(JSON.stringify(record), 'utf8')` per record, over `src/extension/data/`.
**Measured:** 2026-10-11 · Node.js v26.3.0

> **Key finding:** The report assumed 2.5 KB per full record. **Both retailers measure ~1.05 KB — 2.4× below the assumed range.** All §1.4 load figures scale down proportionally.

## Full record sizes (bytes, JSON-serialised)

| Retailer | Count | Mean | Median | p95 | Min | Max |
|---|---|---|---|---|---|---|
| CARREFOUR | 6,698 | 1,052 | 1,049 | 1,118 | 944 | 1,242 |
| NAIVAS | 3,820 | 1,057 | 1,056 | 1,109 | 961 | 1,165 |
| **Combined** | **10,518** | **~1,054** | **~1,052** | **~1,115** | 944 | 1,242 |

**Status: Measured** (replaces Modelled 2.5 KB assumption in §1.4)

## Revised §1.4 load-model (at 1.05 KB actual)

| Quantity | Report (2.5 KB) | Revised (1.05 KB) |
|---|---|---|
| Cold catalog pull per install | ~25.7 MB / 25.7 TB per 1M installs | **~10.8 MB / 10.8 TB** |
| Whole-catalog heap per wake (F-02) | ~26 MB serialised | **~11 MB serialised** |
| At 5M products | 11.9 GB raw | **~5.0 GB raw** |
| Overlay @ 5M (200 B target) | ~1.0 GB | **~1.0 GB** (unchanged — target-driven) |

## Overlay candidate (target: <=200 B)

Minimal `{ id, grade, trust, flags }` = **47 bytes**. Realistic with conditionTiers = **~130-160 bytes**. Both within the 200 B budget.

**Status: <=200 B target confirmed achievable.**

## §3.3 Grade-purity check (required before Phase 10)

The displayed grade is **NOT** a pure function of the record alone. `getProductInfo` in background.js applies user health-condition settings (diabetes/hypertension/renal/obesity) during scoring. The overlay must therefore carry `grade_base` (unmodified NutriScore) only. Condition-specific grades are re-derived at badge-render time from the full record fetched on flyout open. This keeps the overlay <=200 B and avoids per-condition data in the overlay pack.

**Human approval required before starting Phase 10 overlay work.**

## §3.2 SW wake rate

~100 wakes/day is a human-stated figure. Static analysis supports plausibility (tab messages + 2 alarms + install/update + payment flows). The `sw_wake` counter (§3.8) will confirm in production.

**Status: Estimated — production counter needed.**
