# PROGRESS.md — Blueprint Execution Log

## Baseline Execution Status (WP-00)

- **Branch:** `ns/blueprint`
- **Starting Baseline Commit:** `0bf30bdc67ab29a0cfc82de995ba49d4ecab3bc9` (tagged `pre-blueprint`)
- **Unit & Contract Tests:** 46 test files, 813 passed tests, 0 failures (`vitest run --no-cache src/ui/src/app/__tests__`).
- **TypeScript Typecheck:** 0 errors (`tsc --noEmit`).
- **ESLint:** 0 errors, 654 warnings (`eslint .`).
- **Build System:** Clean production compilation (`npm run build:db && npm run build:ui && npm run build:cad && npm run build:ext`).

---

## Catalogue Nutrient Completeness Baseline (Decision D-9 Evidence)

Evaluated via `checkNutrientCompleteness` from `src/shared/target-sync.ts` (Invariant T20: requires all four components: Energy, Sugars, Saturated Fat, and Sodium/Salt; zero substitution prohibited) across offline catalogue fallback seed datasets in `src/extension/data/`:

| Retailer Catalogue | Total SKUs | Computable (4 Nutrients Present) | Computable % | Legacy Energy-Only Incomputable | Legacy Falsely Graded % | Missing Component Breakdown |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Carrefour** (`carrefour_products.json`) | 6,698 | 189 | **2.82%** | 2,983 | 44.54% (total 47.36% legacy passed) | Energy: 3,526<br>Sugars: 4,487<br>Sat Fat: 6,496<br>Sodium/Salt: 4,742 |
| **Naivas** (`naivas_products.json`) | 3,820 | 272 | **7.12%** | 1,347 | 35.26% (total 42.38% legacy passed) | Energy: 2,201<br>Sugars: 2,897<br>Sat Fat: 3,372<br>Sodium/Salt: 2,573 |
| **Quickmart** (`quickmart_products.json`) | 3,669 | 15 | **0.41%** | 462 | 12.59% (total 13.00% legacy passed) | Energy: 3,192<br>Sugars: 3,365<br>Sat Fat: 3,653<br>Sodium/Salt: 3,381 |
| **Total Ecosystem** | **14,187** | **476** | **3.36%** | **4,792** | **33.78%** (total 37.13% legacy passed) | — |

### Finding & Impact for Decision D-9:
1. **Confirmation of Deck Discrepancy:** The 42%–46% coverage figure quoted in commercial presentations was computed using the legacy Gate 2 flaw (`EnergyKJ != null || EnergyKcal != null`), where missing negative nutrients (sugars, saturated fat, sodium) were imputed as `0` by `safePos`.
2. **Honest Coverage Under Strict Completeness:** True computable coverage across real Kenyan retailer catalogues under FSA-NPS with fail-closed negative completeness is **3.36%** (476 / 14,187 SKUs).
3. **Data Curation Action:** Saturated fat is the primary data blocker (missing on 6,496 / 6,698 Carrefour SKUs and 3,653 / 3,669 Quickmart SKUs). Data curation must populate saturated fat and sodium values rather than weakening safety gates in code.

---

## Work Package Status

| Work Package | Title | Status | Findings Closed | Flags Introduced | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **WP-00** | Orientation, verification, baseline & guardrails | **Completed** | F-08 | — | Baseline recorded, 5 verification items confirmed, completeness benchmarked, guardrails staged |
| **WP-01** | Measurement foundation & low-risk hot fixes | **Completed** | O-01, A-06 (hotfix), A-12 | `ns.obs.sdk` | Observability SDK (`obs/obs.js`) with microsecond benchmarks (avg mark ~2.4µs, 10-batch ~0.32ms; budget <= 1.2ms), deterministic SHA-256 idempotency key for observed-orders sync, `check-dist` guardrail wired |
| **WP-02** | Crypto provider & browser-safe shared primitives | **Completed** | X-05(e), X-10, ADR-3 | — | `CryptoProvider` interface (`provider.ts`, `node.ts`, `web.ts`), Ed25519 SubtleCrypto feature detection (SW fail-neutral), `codeUnitCompare` in `canonical.mjs` (X-10), standalone `nutrient-completeness.ts` export for extension bundle (Invariant T20), cross-environment parity test suite (30/30 passed). |
| **WP-03** | Signed flag manifest client | **Completed** | 3.8, ADR-5 | `ns.global.neutral`, `ns.retailer.<carrefour\|naivas\|quickmart>.enabled` | Implemented `src/extension/flags.js` with Ed25519 signature verification against pinned root key, monotonic seq enforcement, FNV-1a 32-bit cohort bucketing (verified 29.8% vs 30%), fail-static cache, 5-minute background refresh, and `scripts/publish-flags.mjs` publisher. 13/13 unit tests passed. |
| **WP-04** | Scoring & policy v5 | *Pending* | E-01..E-07, X-07, X-12, ADR-8 | `ns.scoring.v5`, `ns.policy.v2` | — |
| **WP-05** | Server trust boundary fixes | *Pending* | X-01, X-03, X-04, X-08, X-09, X-11 | — | — |
| **WP-06** | Token & bundle verification | *Pending* | X-02, A-05, X-05, ADR-3 | `ns.token.v2` | — |
| **WP-07** | Catalogue verify-then-commit | *Pending* | A-01..A-04, X-10 | `ns.catalog.verify_v2` | — |
| **WP-08** | Rendering hardening & scanner resilience | *Pending* | A-07, A-10, A-11, E-06 | `ns.ui.closed_shadow`, `ns.scanner.v2` | — |
| **WP-09** | CAD interim fixes | *Pending* | F-01, F-03, F-05 | `ns.cad.strict_states` | — |
| **WP-10** | Product resolution v2 & IndexedDB v19 | *Pending* | E-11, E-12 | `ns.nme.v2` | — |
| **WP-11** | Ledger v2 | *Pending* | E-08..E-10, E-13 | `ns.ledger.v2` | — |
| **WP-12** | Telemetry client & observability upload | *Pending* | O-02, A-06 | `ns.telemetry.v2` | — |
| **WP-13** | Gateway, bronze ingest, consent register | *Pending* | G-02, G-03 | — | — |
| **WP-14** | BFF, auth, audit | *Pending* | F-01..F-04, X-01, X-03 | `ns.bff.enforce` | — |
| **WP-15** | CAD client migration | *Pending* | F-02, F-04, F-06 | `ns.cad.bff_client` | — |
| **WP-16** | Real-time hub & CAD reducer | *Pending* | F-07 | `ns.sse` | — |
| **WP-17** | Adapter core & specs | *Pending* | A-08, A-09 | `ns.adapter.core.*` | — |
| **WP-18** | Observability stack, SLOs, controller, canary | *Pending* | 3.4, 3.8 | — | — |
| **WP-19** | Phase 2 harnesses & runbooks | *Pending* | 5.2, 5.5 | — | — |
