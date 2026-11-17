# LEGACY_REGISTER.md — Phase 4 Decommissioning Register

Tracks legacy functions, interfaces, constants, and endpoints preserved during Waves 1–3 behind feature flags, to be decommissioned in Phase 4 / Wave 5.

| Symbol / Item | Location | Retained For | Target Removal | Flag Controlling New Path |
| :--- | :--- | :--- | :--- | :--- |
| `getContextGrade` | `src/extension/engine/context-engine.js` | Legacy scoring fallback | Phase 4 (Step 5.4.1) | `ns.scoring.v5` |
| `evaluateProductForUser` | `src/extension/engine/context-engine.js` | Legacy context evaluation | Phase 4 (Step 5.4.1) | `ns.scoring.v5`, `ns.policy.v2` |
| `NutriScoreEngine` | `src/extension/pipeline/disease-engine.js` | Legacy test compatibility | Phase 4 (Step 5.4.1) | `ns.scoring.v5` |
| `resolveProductMatch` | `src/ui/src/app/lib/db/product-resolution.ts` | Legacy product resolution | Phase 4 (Step 5.4.2) | `ns.nme.v2` |
| `NutriEntitlement` (ES256 verifier) | `src/extension/entitlement.js` | Legacy JWT token validation | Phase 4 (Step 5.4.3) | `ns.token.v2` |
| `legacyCompare` (`catalog_hash`) | `src/shared/canonical.mjs` | Catalog hash bridge | Phase 4 (Step 5.4.4) | `ns.catalog.verify_v2` |
| Direct-grant client `cad-web-ui` | `infra/keycloak-realm.json` | Legacy CAD authentication | Phase 4 (Step 5.4.5) | `ns.cad.bff_client` |
| `PostgrestQueryBuilder` (browser) | `src/ui/src/services/storage.ts` | Direct browser-to-DB calls | Phase 4 (Step 5.4.5) | `ns.cad.bff_client` |
| `observed-orders` (cleartext default) | `src/extension/observed-orders-sync.js` | Legacy cart logging | Phase 4 (Step 5.4.6) | `ns.telemetry.v2` |
| `gate2Passed = EnergyKJ != null || EnergyKcal != null` | `src/ui/src/app/lib/db/grading.ts` | Legacy Gate 2 energy-only fallback | Phase 4 (Step 5.4.1) | `ns.scoring.v5` |
| `safePos` nutrient imputation | `src/ui/src/app/lib/db/grading.ts` | Legacy zero imputation for unverified items | Phase 4 (Step 5.4.1) | `ns.scoring.v5` |
