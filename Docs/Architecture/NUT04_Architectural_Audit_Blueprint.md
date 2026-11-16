# NUT-04 Architectural Audit & Zero-Downtime Refactoring Blueprint

*13 to 15 November 2026 · Audience: Project Lead, CTO, Security and Privacy Lead · Basis: `extension.rar` (22 files, about 6,300 lines) and `ui.rar` (113 source files, 45 test files) audited against the Clinical Data Pipeline Strategy, the Multi-Stakeholder Business Model Blueprint and the UI/UX Overhaul Report.*

## 0. Read this first

### 0.1 Evidence coverage: what this audit can and cannot claim

Every finding carries an evidence tag. **V** = verified by reading the code. **I** = inferred from a test, comment or reference, not read directly. **G** = gap by absence in the supplied files.

| Area | Status |
| --- | --- |
| Read in full or in the hot paths | `db.js` (1,349 lines; generated from `ui/src/app/lib/db/*.ts`), `catalog-sync.js`, `entitlement.js`, `scanner.js`, `observed-orders-sync.js`, `config.js`, `health-modes.js`, `engine/*`, `pipeline/disease-engine.js`, `adapters/*` (structure, cart paths, `shared-ui.js` rendering), CAD `AuthContext`, `navigation.ts`, views, `services/storage.ts` |
| Supplied with the second upload, read in full | `shared.rar` (24 files, 2,751 lines): `claims`, `rbac`, `authz`, `dpt`, `dpop`, `signer`, `consent`, `target-sync`, `canonical`, `pack-client`, `field-encryption`, `key-wrapper`, `patient-export`, `commercial-catalogue`, `storage`. Audited in 1.3 |
| Referenced by tests, still not supplied | `src/extension/background.js` (13 test references), `content.js`, `manifest.json`, `infra/keycloak-realm.json`, `supabase/migrations` |
| Not supplied at all | Any gateway or BFF code, Edge Functions (`entitlement`, `observed-orders`), CI configuration, observability stack |

**Consequence.** Pillar 3 on the server and the BFF half of Pillar 4 cannot be audited; Section 3 designs them as net-new and every net-new item starts with a reconcile-against-`shared/*` step, because the tests show that `dpt`, `dpop`, `signer`, `rbac` and `authz` modules already exist in the repository. Scores below are my judgement against an explicit rubric, not measurements. No benchmark was run; all performance statements are static-analysis estimates that Phase 2 of the rollout turns into measurements.

### 0.2 Set points used as targets

| Area | Set point | Source |
| --- | --- | --- |
| Badge latency | P95 from batch flush to painted badge ≤ 120 ms goal, 200 ms hard limit, over 100 recorded fixture pages (T-03) | Clinical §1.3, §6.2 |
| Stage budgets | Extraction 15 ms, exact identity resolution 10 ms, fuzzy fallback 40 ms (10–15% of items, blocked candidate sets only), scoring 5 ms per item, render 25 ms, headroom 25 ms | Clinical §1.1, §1.3 |
| Mapping precision | M1–M3 ≥ 99.5%; M4 ≥ 97% at P ≥ 0.92 (T-05) | Clinical §6.2 |
| Grade accuracy | 20 of 20 exact on the official reference set plus each retailer's top 500 SKUs (T-04) | Clinical §3.5 |
| Coverage | Graded SKUs with energy, sugars, saturated fat and sodium present ≥ 80% (now 42–46%) | Clinical §2.8; Business KPI 3 |
| Selector drift | Nightly canary; alert above 2% selector failure | Clinical §1.3 |
| Telemetry | Upload every 15 min, at checkout, or on alarm with exponential backoff; schema conformance ≥ 99.5%; duplicates < 1%; P95 lateness < 24 h; consent linkage 100%; drop above 20 events per second per device | Clinical §2.3, §2.6, §2.8 |
| Revocation | Gateway rejects at once; revocation list within 1 min; client stops within 5 min; next analytics run 24 h; purge 30 d | Clinical §5.4 |
| Audit integrity | Merkle root signed every 60 s; tamper alert within 5 min (T-10) | Clinical §5.4 |
| Token | ES256 or EdDSA, offline verification, 30-day lifetime \[A\], key rotation 90 d; expiry shows neutral grades | Clinical §1.2 |
| Server engines | Token exchange < 300 ms; Profile Compiler < 1 s; ingestion validation < 2 s per bundle | Clinical §1.1 |
| Safety and ops | Unresolved safety events 0; false-block rate ≤ 1%; clinician time ≤ 10 min per patient per month | Business §6.4 |
| UI budgets | Eager gzip: popup 40 KB, dashboard 70 KB, side panel 60 KB, CAD 110 KB; WCAG 2.2 AA; zero serious or critical axe violations | UI report §5.5 |
| Retention | Device and UI data 3 months; server and clinician data per Kenyan health-data law (default 20 years, pending legal confirmation) | UI report §5.7 |

### 0.3 Executive summary

1. **The scoring path is not yet safe to certify.** `interpretProduct` lets a record with only an energy value pass Gate 2 and `computeGradeFromProduct` then treats every missing nutrient as zero (E-01). A high-sugar product with only energy filled can grade A or B. Fix this before anything else. Expect the honest coverage figure to fall below the 42–46% reported in the deck, because that figure was computed with the energy-only gate.
2. **The offline catalogue verifies the wrong thing.** The signature covers the manifest, but the per-row hashes are copied from the server and never recomputed, verification runs after the data is already live, and a failed check is swallowed (A-01, A-02).
3. **Nothing can be measured.** There are no performance marks, trace IDs or counters in the extension (O-01), so none of the latency set points in 0.2 can be proven or enforced. Instrumentation is therefore the first deliverable, ahead of any tuning.
4. **The identity boundary leaks.** Diagnosis labels are stored on the device, defaulted on (E-06), and rendered into an open shadow root readable by retailer scripts (A-07). In the CAD, MFA is client-side theatre (F-01) and role logic lives in 37 view-level checks (F-04).
5. **Most of the target architecture is not in the supplied code.** The telemetry gateway, audit writer, BFF, closed-loop monitoring and a live token-exchange service are absent; a policy engine, DPT minting and field encryption exist in shared/ but only as Stage A local implementations. Part of the token layer exists in `shared/*` and was supplied later; it holds a policy engine, DPT minting, DPoP and field encryption, with the gaps listed in 1.3.

**Added after `shared.rar` arrived.** Two further critical items: server-side role checks trust an unverified JWT payload (X-01), and clinical target bundles are accepted on a string-prefix "signature" (X-02). Section 3.5 and 2.7 fix both before any rollout.

**Sequencing principle: measure, make safe, make verifiable, then migrate.** Section 5 follows this order.

## Section 1: Current-State Audit & Gap Analysis Matrix

### 1.1 Component inventory and pillar scores

Rubric: 0 absent or contradicts the report · 1 present but unsafe · 2 partial · 3 meets with gaps · 4 meets · 5 exceeds. A dash means the pillar does not apply. Pillars: **P1** core engines, **P2** adapters and contract safety, **P3** observability, **P4** frontend and access.

| ID | Component (files) | P1 | P2 | P3 | P4 | Main reasons |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Grade kernel: `db.js` `computeGradeFromProduct`, `interpretProduct` | 1 | — | 0 | — | E-01, E-02 |
| C2 | Context engine, scorers, `health-flags.js` | 2 | — | 0 | — | E-02, E-03, E-07 |
| C3 | `pipeline/disease-engine.js` | 2 | — | 0 | 1 | E-04, E-05, E-06 |
| C4 | Product resolution in `db.js` (NME) | 2 | 2 | 0 | — | E-11, E-12 |
| C5 | Cart ledger and analytics in `db.js` | 2 | — | 0 | — | E-08 to E-10, E-13 |
| C6 | `scanner.js` (RDA scheduler) | 3 | 3 | 0 | — | A-10; good viewport gating and batching |
| C7 | Retailer adapters, `adapter-factory.js`, `declarative-engine.js` | — | 2 | 0 | — | A-08, A-09 |
| C8 | `adapters/shared-ui.js` (badge and flyout) | — | 2 | 0 | 1 | A-07, A-11 |
| C9 | `catalog-sync.js` | 2 | 2 | 0 | — | A-01 to A-04 |
| C10 | `entitlement.js` | — | 1 | 0 | 1 | A-05 |
| C11 | `observed-orders-sync.js` | — | 1 | 1 | — | A-06 |
| C12 | `config.js`, `health-modes.js` | — | 3 | — | 2 | Public keys only (good); A-12; condition recolour |
| C13 | Monitoring and telemetry (extension) | — | — | 0 | — | O-01 to O-03 |
| C14 | CAD shell: `AuthContext`, navigation, views | — | — | 0 | 1 | F-01, F-02, F-04, F-05 |
| C15 | `services/storage.ts` REST client | — | 1 | 0 | 1 | F-03, F-06 |
| C16 | Shopper surfaces (Popup, Dashboard, Options) | — | — | 0 | 2 | UI report D-13 to D-18; E-13 |

What is good and should be kept: the viewport-gated, batched, bounded-concurrency scanner; the 30 ms micro-batch (the 300 ms debounce problem in the report is already solved at scanner level, unless `content.js` re-debounces); in-memory index caches with explicit invalidation; the atomic staging-then-swap pattern for premium rows; `escapeHTML` discipline; the `product_cache` invalidation on `scoringVersion` and `catalogVersion`; clock-rollback guard; the per-condition role-to-navigation contract; and the 45-file test suite as a refactoring net.

### 1.2 Findings register

Severity: Critical, High, Medium, Low. "Fix" points to the section that redesigns the item.

#### Pillar 1: Engines (processing, state, algorithmic efficiency)

| ID | Sev | Ev. | Finding | Violates | Fix |
| --- | --- | --- | --- | --- | --- |
| E-01 | Critical | V | `db.js:790` `gate2Passed = n.EnergyKJ != null \|\| n.EnergyKcal != null`; `db.js:711` `safePos` turns missing sugars, saturated fat, sodium, fibre, protein into 0. shared/target-sync.ts checkNutrientCompleteness (invariant T20) already encodes the correct four-nutrient gate and is not wired in. Energy-only records get a grade, which is also snapshotted into `shopping_ledger.gradeSnapshot`. | Clinical §2.5 "never impute zero", §2.8 completeness, P1 | 2.1 |
| E-02 | High | V | Two A–E systems: FSA-NPS in `db.js`, and a 0–100 "badness" bucket in `context-engine.js getContextGrade`. `evaluateProductForUser` returns `warnings: []` and `diseaseAssessment: {}`, a facade that can only under-warn. T-04 is definable for only one system. | T-04, P7 | 2.1 |
| E-03 | High | V | Three threshold families with no single source: `MEDICAL_THRESHOLDS` (energy-dense 275 kcal), `DISEASE_RULES` (energy 400 kcal; renal sodium 600 mg per 100 g versus 200 mg per serving in `health-flags.js`), `scorers/general.js`. Salt to sodium uses ×400 (`Kernel.resolveSodiumMg`, `db.js` `SaltG / 2.5 * 1e3`) which is the EU labelling convention (salt = sodium × 2.5, ADR-8) and differs from the ×393.4 in §2.5 by 1.7%. | §2.5, P5 | 2.1 |
| E-04 | High | V | Policy is hard-coded. `DiseaseEngine.evaluate` accepts diagnosis labels (`patientProfile.conditions`) or flat booleans. `evaluateDynamicRules` compares per-100 g values to `rule.threshold` with no `basis` (per day versus per 100 g), `mode`, `weight`, `min_conf` or `exclude`. No allergen logic exists in any of the 22 files. | P2, P3, I2, §1.2 token | 2.1, 3.1 |
| E-05 | High | V/I | The engine does not gate on `ReviewState`; "warn or block only at VERIFIED or higher" can only live in `background.js` (not supplied). `RenalSafe` can be `false` on a 100 g proxy serving (`resolveServingGrams`, confidence "low"). | §1.3 action by confidence | 2.1 |
| E-06 | High | V | `getSettings` and `updateSettings` default `diabetes`, `hypertension`, `kidney` and `obesity` to `true` (`?? true`): a fresh or guest profile receives all four warning families. | P1, P2 | 2.1 |
| E-07 | Medium | V | `isDiabeticFriendlyPredicate` disqualifies any item with fibre < 3 g, so sugar-free drinks (0 g sugar, 0 g fibre) return `DiabeticFriendly = false`. | Clinical validity | 2.1 |
| E-08 | Medium | V | Quantities are summed: `db.js:977` (`logCartEvent`) and `db.js:1085` (`dedupeActiveCartItems`). §2.7 requires the last known quantity. Dedupe, update and insert run in separate transactions, so two tabs can race. | §2.7 | 2.3 |
| E-09 | High | V | `syncCart` skips unmatched or non-gradable items (`continue`), so unscored spend is lost and coverage C (≥ 0.70 of spend) and the unscored share cannot be computed. | §2.5, §3.1, §3.3 | 2.3 |
| E-10 | Medium | V | Ledger rows carry no `scoringVersion`, `catalogVersion`, `profile_ver`, `cart_episode_id` or `client_seq`. `SCORING_VERSION` (`db.js:300`) is applied only to `product_cache`. | P5, §2.3 | 2.3 |
| E-11 | High | V | Hot-path scans: `db.js:878` and `:940` clone whole stores (`getAll()`) into SW heap on each cold wake (6,698 Carrefour records); the Carrefour fragment match and Quickmart slug match are `Array.find` over the cache, the latter parsing a `new URL()` per record; `getAllProducts` joins the whole `price_cache` per call. | §1.3: no full-catalogue scans; 40 ms fuzzy budget | 2.2 |
| E-12 | High | V | The M1–M5 cascade does not exist: no GTIN, no brand + size + variant key, no calibrated probability. A `normalized_name` match returns `confidence: "low"` yet is accepted as a match. T-05 cannot be measured. | §1.3, T-05 | 2.2 |
| E-13 | Medium | V | `resolveTimeframe` still serves `year` and `all` (start 2020). The only purges are `purgeAll` and 7-day `product_cache` eviction; no 3-month ceiling. | UI report §5.7 (4) | 2.3 |

#### Pillar 2: Integration adapters (resilience and contract safety)

| ID | Sev | Ev. | Finding | Violates | Fix |
| --- | --- | --- | --- | --- | --- |
| A-01 | High | V | `catalog-sync.js:138` stores the server's `record_hash`; `computeLocalHash` hashes those copied values, and no code recomputes a hash from `row.record`. A tampered record with its original hash passes; the signature covers the manifest only. | §5.1 "verify signed deltas" | 2.6 |
| A-02 | High | V | Verification runs after commit and fails open: `applyStaging` writes live stores before the hash check; the mismatch throw is swallowed by `ensureReady` when `meta.version` exists; `stagingCursor` (`:148`) has already advanced, so every later sync re-throws without re-pulling. | P1, T-13 spirit | 2.6 |
| A-03 | Medium | V | No anti-rollback: `isNewVersion = meta.version !== manifest.version` (`:285`) accepts any validly signed older manifest. | §5.1 | 2.6 |
| A-04 | Medium | I | Sync cadence: `ensureReady` memoises per SW lifetime and `sync()` has no `lastSyncAt` TTL. Tests gate only entitlement refresh to alarms. If `background.js` calls sync on wake, about 100 wakes per user-day each query the release table. | Cost per transaction | 2.6 |
| A-05 | High | V | `_doRefresh` returns "unchanged" for any non-OK response, 401, 403 and 410 included, and keeps the token until `exp`. Token sits in plaintext `chrome.storage.local`. `verifyToken` checks `iss`, `sub`, `exp` only (no `aud`, `nbf`, `jti`, `profile_ver`, key manifest). It models Basic/Premium, not the Dietary\_Profile\_Token. | §1.2 token rules, §5.1, §5.4 | 2.7 |
| A-06 | High | V | `observed-orders-sync.js`: idempotency key defaults to `obs-${retailer}-${Date.now()}-${random}` and is regenerated per call, so a retry duplicates; no timeout, backoff or jitter; no envelope (`event_id`, `client_seq`, `consent_ref`, `cart_episode_id`, `profile_ver`); `backendUrl` defaults to `http://127.0.0.1:54321`. `pending_cart_syncs` is keyed by retailer (`db.js:1109`), so a pending payload is overwritten by the next. | §2.3 collection rules | 2.8 |
| A-07 | High | V | Shadow DOM is `mode: "open"` (`shared-ui.js:96`, `:137`). Retailer page scripts can read `host.shadowRoot`, including condition chips such as "Diabetes Risk" in the flyout. | I2, §5.1 | 2.9 |
| A-08 | Medium | V | `naivas.js` 667, `carrefour.js` 685, `quickmart.js` 723 lines; the first 170 lines are about 85% identical boilerplate; `declarative-engine.js` (ranked selectors, `killSwitch`) is used by none of them; selectors are code, not signed data. | §1.3 "selectors are data" | 2.5 |
| A-09 | Medium | V | `adapter-factory.js` captures `window.*Adapter` at module evaluation (order-dependent) and tests regexes against the whole URL (`/quickmart/i` matches any URL containing the word); no path allow-list or exclusions. `declarative-engine.js` builds `new RegExp(rule.hrefRegex)` from spec data with no length or safety check. | §1.3, T-06 | 2.5 |
| A-10 | Medium | V | `scanner.js` `_score` resolves only when `_safeSend` calls back. With `NUTRI_SCANNER_MAX_INFLIGHT = 2`, two lost replies stall scoring on the page. `_retryLater` re-enqueues at once (no backoff or jitter). Giving up leaves no badge rather than a neutral state. | T-13, P1 | 2.4 |
| A-11 | Medium | V | `shared-ui.js fetchWithRetry`: 500 ms doubling, no jitter, no per-attempt timeout, no `Retry-After`, no retry budget. | Backpressure | 2.9 |
| A-12 | Low | V | `config.js` ships `__VITE_API_URL__` and `__VITE_OIDC_ISSUER__` placeholders; no check fails the build if they survive into `dist/`. | CI gates | 2.8 |

#### Pillar 3: Analytics and monitoring (closed-loop control)

| ID | Sev | Ev. | Finding | Violates | Fix |
| --- | --- | --- | --- | --- | --- |
| O-01 | High | V/G | No `performance.mark` or `measure`, no trace or correlation IDs, no counters or histograms; 39 `console.*` calls across 22 files. T-03 and the 2% selector-failure canary cannot run. | T-03, §1.3 | 3.2 |
| O-02 | High | G | No on-device telemetry contract: no `telemetry_queue`, no ULID event IDs, no consent-gated enqueue, no purge on revoke (T-08). | §2.3, §5.4 | 2.8, 3.3 |
| O-03 | High | G | Gateway, bronze/silver/gold layers, SLO monitoring, auto-scaling and rollback automation are not in the supplied files. | §2.1, §5.4 | 3.3, 3.4 |
| O-04 | Medium | V | CAD `SystemHealthBanner` is static copy (UI report D-10); `AuditLogView` is a stub. | UI report D-10 | 4.4 |

#### Pillar 4: Frontend alignment and multi-user access control

| ID | Sev | Ev. | Finding | Violates | Fix |
| --- | --- | --- | --- | --- | --- |
| F-01 | Critical | V | `AuthContext.verifyMfa` returns `true` for any six digits; `signIn` sets `mfaVerified` immediately after the password grant; `initAuth` sets it for any stored token. No `acr` or `amr` claim is checked. Server-side enforcement is unknown (I). | Plan §6.4, DPA s.46 copy in UI | 3.5, 4.1 |
| F-02 | High | V | Resource Owner Password Credentials grant from the SPA (`grant_type=password`, client `cad-web-ui`); access and refresh tokens in `sessionStorage`; role and tenant read from an unverified JWT (`claimsFromAccessToken`, fallback to `realm_access.roles`). | OAuth 2.1 direction, zero-trust UI | 3.5 |
| F-03 | High | V | No BFF. `services/storage.ts` `PostgrestQueryBuilder` issues `select=*` from the browser and attaches no `Authorization` header (ambient auth assumed). `then()` and `maybeSingle()` swallow errors into `{ data: [] }` or `{ data: null }`, so failure renders as "no data". | Pillar 4: backend-first filtering | 3.5, 4.2 |
| F-04 | High | V | Role logic sits in views: 37 role comparisons across 12 files in `ui/src/cad`, static `ROLE_NAVIGATION`, `PROVISIONABLE_ROLES`. Overlaps: `super_admin` counts as writing clinician (`PatientTargetsView`, `PatientLinkingConsentView`); `HealthModesView` lets `tenant_admin` author modes; `switchTenant` only mutates local claims. | P2, §2.3 "who may see what" | 4.1, 4.2 |
| F-05 | High | V | `AuditLogView`: `chainValid` starts `true` and is reset to `true` on error. `verifyHashChain` compares stored `prev_hash` to stored `row_hash`; it never recomputes a hash or checks a signed Merkle root. With the stubbed fetch it shows "valid" over zero rows. T-10 cannot pass. | T-10, §5.4 | 3.6 |
| F-06 | Medium | V | One IndexedDB (`nut04-nutriscore`) for every user on a browser profile. `signOutUser` removes five keys but not `shopping_ledger` or `product_cache`; `AuthContext.signOut` clears `cad_*` keys separately; nothing purges on role or tenant change; legacy `nutri_entitlement` and `user_health_profile` keys remain in the purge list. | Pillar 4: cache partitioning | 4.4 |
| F-07 | Medium | V | No sync transport: no SSE, WebSocket, polling or sequence IDs in the CAD; views are Stage C stubs returning empty arrays. | Pillar 4: deterministic sync | 3.5, 4.3 |
| F-08 | Medium | I | `shared/rbac`, `shared/authz`, `shared/claims`, `shared/consent`, `shared/dpt`, `shared/dpop`, `shared/signer` and `infra/keycloak-realm.json` were referenced by 45 test files; the shared modules were then supplied and are audited in 1.3, while infra/keycloak-realm.json is still missing. | Evidence gap | 5.1 |

### 1.3 Findings from `shared/` (supplied with the second upload)

`shared/` is the most mature layer in the repository: an ordered deny-first policy engine with obligations and generic 403s (`authz.ts`), an AES-256-GCM field envelope with AAD and key versions (`field-encryption.ts`), RFC 9449-style DPoP (`dpop.ts`), a DPT allowlist with condition-name scrubbing, banding and a k-gate (`dpt.ts`), and the right invariants for nutrient completeness, anti-rollback and renal-rule disablement (`target-sync.ts`, T16–T25). Its problems are at the trust boundaries, not in the design intent. Every file is labelled Stage A (local keys, in-process state); the findings are what must change before Stage C.

| ID | Sev | Ev. | Finding | Violates | Fix |
| --- | --- | --- | --- | --- | --- |
| X-01 | Critical | V | `claims.ts` `claimsFromRequest` and `claimsFromAccessToken` base64-decode the JWT payload and never verify the signature, `iss`, `aud`, `exp` or `nbf`. `rbac.ts` `requireRole` builds authorisation on that result. Unless every Edge Function sits behind a gateway that verifies tokens (not evidenced; Keycloak is Stage C), anyone can send `app_role: super_admin`. | Zero-trust; Plan §6.4 | 3.5 |
| X-02 | Critical | V | `target-sync.ts` `verifyBundle` accepts any signature string that starts with `sig_es256_`. Clinical target bundles (the prescription) are therefore unauthenticated. Anti-rollback (T17) and expiry (T16) are correct but guard an unauthenticated object; an invalid `validTo` (NaN) passes the expiry test; no `tenantId` or `subjectRef` binding to the device user. | P2, §1.2 token rules | 2.7 |
| X-03 | High | V | `authz.ts` `decide()`: (a) account-status and denylist checks pass when `adapters.members` or `adapters.denylist` are omitted; (b) tenant isolation trusts the caller-built `Resource.tenantId`, so a resource built without it skips the check; (c) up to five sequential adapter awaits per decision; (d) `Subject.acr` is a number but `CanonicalClaims.acr` is a string, and `(s.acr ?? 1) < 2` is false for any non-numeric string ("loa1", "password"), so step-up passes; (e) `STEP_UP` omits `accounts:create`, `consent_register:update`, `clinical_records:update`, `tenants:*`. | Pillar 4, §5.4 | 3.5 |
| X-04 | High | V | UI and policy disagree: `PERMISSIONS` gives `super_admin` no `clinical_records` and no `target_bundles:create` or `update`, and no `health_modes` resource exists, yet the CAD shows write controls to `super_admin` (`PatientTargetsView`, `PatientLinkingConsentView`) and to `tenant_admin` (`HealthModesView`). Controls that always return 403, and no policy for mode authoring. | P2, F-04 | 4.1 |
| X-05 | High | V | `dpt.ts`: (a) the DPT is a 15-minute, `aud: ns-commercial`, per-100 g band token (`cs`), not the report's per-retailer token with per-day constraints, `exclude`, `policy.min_conf`, `block_mode` and `profile_ver`; (b) `verifyDpt` has no `kid` lookup (one key, no rotation), does not pin `alg` to EdDSA, checks claims before the signature, and takes `revokedJtis` as a caller-supplied in-memory Set; (c) `mintDpt` calls `deriveTenantAlias(tenantId)` without a secret, so every alias uses the hard-coded salt `CAD_TENANT_ROUTING_SALT_V1`; (d) `mintDpt` casts `signer.sign()` to `Uint8Array` without `await`, which breaks the async Vault or HSM signers the `Signer` interface allows; (e) `node:crypto` only, so the MV3 worker cannot reuse it. | §1.2, §5.3 | 2.7, 3.1 |
| X-06 | High | V | `commercial-catalogue.ts` `filterCatalogueWithDpt` calls `verifyDpopProof(proof, 'POST', url)` without a replay cache, so anti-replay is off in the one production caller. `verifyDpt` enforces key binding only when `dpopJkt` is passed. The replay cache, where used, is an unbounded in-process Set. | RFC 9449 §11.1 | 3.1 |
| X-07 | High | V | `evaluateSkuAgainstConstraints` treats a null nutrient as conforming and never reads `review_state`. Swap candidates can include UNVERIFIED or REJECTED records with no nutrition data. | §1.3, I1 | 2.1 |
| X-08 | High | V | `consent.ts` `evaluatePatientVisibility`: a `clinician_link` consent satisfies every required purpose (`purchase_timeline`, `diary`). Purposes do not map to C1–C4 and there is no payer-sharing purpose. `evaluateCohortSuppression` and `applyCohortGate` default to k = 5 against k ≥ 20 for retailer outputs. `cryptoShredPatient` builds a pseudonym with `Math.random()`, leaks the first four characters of `patientRef`, and destroys no key. | P9, §4.5, §5.4 | 3.4 |
| X-09 | Medium | V | `LocalEd25519Signer` generates a fresh key pair per instance, so tokens do not survive a restart; `LocalKeyWrapper` derives its master key from a passphrase with the fixed salt `CAD_STAGE_A_MASTER_SALT`. Nothing fails a production build if either is used. | §1.2 key custody | 5.1 |
| X-10 | Medium | V | The integrity primitives the extension lacks already exist: `canonical.mjs` `recordHash` and `computeCatalogHash`, and `pack-client.ts` (content-addressed shards checked against the signed manifest). `catalog-sync.js` uses neither (A-01). Both hash routines sort with `localeCompare(..., 'en')` although the comment says "plain string comparison"; ICU differences between Node and Chrome can reorder keys and cause false mismatches. | §5.1 | 2.6 |
| X-11 | Medium | V | `storage.js`: `CentralStorage.get` and `set` swallow errors and return defaults; settings, `selectedTags` and the consent flags `termsAccepted` and `privacyAccepted` sit in plaintext `chrome.storage.local`. Consent is a local boolean, not a receipt with a notice hash (§5.4). `claims.schema.json` has `acr` as a string and no `amr`, `iss`, `aud` or `exp`. | §5.4 | 3.4 |
| X-12 | Low | V | Parameter drift: `verifyAtwaterEnergy` tolerates 8%, §2.5 says 15% when calculated energy exceeds 20 kcal; salt to sodium is ×400 everywhere in code (ADR-8). | §2.5 | 2.1 |

### 1.4 Consolidated view

#### Performance and efficiency bottlenecks

Static analysis only; nothing was benchmarked. Phase 2 of the rollout turns each row into a measurement.

| Where | Behaviour | Set point at risk | IDs |
| --- | --- | --- | --- |
| Service-worker cold start | `getAll()` of a whole product store per retailer, rebuilt after every worker termination | 120 ms badge budget; 10 ms exact resolution | E-11 |
| Unresolved lookups | `Array.find` with a RegExp test over 6,698 Carrefour records; Quickmart parses a `new URL()` per record | Fuzzy fallback ≤ 40 ms, blocked sets only | E-11, E-12 |
| Catalogue sync cadence | No TTL inside `sync()`; if called on each wake, about 100 release queries per user-day | Cost per transaction | A-04 |
| Retry behaviour | Scanner re-enqueues at once; `fetchWithRetry` doubles from 500 ms without jitter | Backpressure; T-13 | A-10, A-11 |
| Policy decision | Up to five sequential awaits per `decide()` | BFF added latency (target in 3.5) | X-03 |
| Cart ledger | Full `in_cart` index scans per sync; summed duplicates | Cart sync accuracy | E-08 |
| Analytics | Whole-ledger aggregation with no 3-month ceiling | UI budgets; retention | E-13 |
| Catalogue verification | Locale-aware sort of about 10,500 keys per verify | Determinism | X-10 |

#### Architectural and functional gaps

| Gap | Required by | Evidence | Designed in |
| --- | --- | --- | --- |
| G-01 On-device policy from a verified token: per-retailer audience, per-day constraints, allergen exclusion, `min_conf`, `block_mode`, `profile_ver` | Clinical §1.2; T-01, T-02 | E-04, X-05 | 3.1 |
| G-02 Device telemetry queue and envelope | §2.3 | O-02, A-06 | 2.8, 3.2 |
| G-03 Gateway: consent check, dedupe, outlier rules, quarantine | §2.3, §2.6, §2.8 | O-03 | 3.3 |
| G-04 Instrumentation SDK, SLO stack, canary | §1.3; T-03 | O-01 | 3.2, 3.4 |
| G-05 BFF with field masking and capability flags | Pillar 4 | F-03, F-04, X-04 | 3.5 |
| G-06 Real-time hub with sequence IDs | Pillar 4 | F-07 | 3.6 |
| G-07 Audit writer and verifier with signed Merkle roots | §5.4; T-10 | F-05 | 3.7 |
| G-08 Signed selector manifest and kill switch | §1.3 | A-08, A-09 | 2.5, 3.8 |
| G-09 Allergen vocabulary on product records | §1.2, §1.3 | E-04 | 3.1 |
| G-10 Revocation distribution (jti list, session denylist) | §5.4 | A-05, X-03, X-05 | 3.9 |
| G-11 Adherence and variance engine | §3 | E-09 | 3.10 (contract only) |
| G-12 Clinical Ingestion Adapter, Profile Compiler, Token Exchange service | §1.2 | Not in any archive | 3.10 (contract only) |

#### Security and data-leakage risks, ranked

| Rank | Risk | Failure path | Blast radius | Fix |
| --- | --- | --- | --- | --- |
| 1 | X-01 unverified JWT claims | Forged `app_role` and `tenant_id` reach any function using `requireRole` | Every tenant, all roles | 3.5 |
| 2 | X-02 string-prefix bundle signature | Forged target bundle sets or clears a patient's limits | Patient safety | 2.7 |
| 3 | F-01, F-02 client-side MFA, ROPC grant | Password alone reaches the CAD; tokens in `sessionStorage` | Clinician accounts | 3.5 |
| 4 | E-06, A-07 diagnosis on device in an open shadow root | Retailer script reads "Diabetes Risk" from `host.shadowRoot` | Every default-profile shopper | 2.1, 2.9 |
| 5 | E-01 energy-only grading | Missing sugar, sodium, saturated fat read as zero | Every shopper | 2.1 |
| 6 | A-05, X-05(b) revocation not honoured | Revoked token stays valid until `exp` | Revoked patients, leaked tokens | 2.7, 3.9 |
| 7 | X-06, X-07 replay and unknown-as-eligible | Replayed DPoP proof; swap offered for a record with no data | Swap integrity | 3.1, 2.1 |
| 8 | A-01, A-02 catalogue integrity | Tampered rows with original hashes pass; failure swallowed | Grades shown to shoppers | 2.6 |
| 9 | X-08 purpose escalation | `clinician_link` consent opens timeline and diary | Patient privacy | 3.4 |
| 10 | F-04, X-04 role overlap | `super_admin` and `tenant_admin` shown clinical write paths | Clinical authority (P2) | 4.1 |

## Section 2: Redesign Blueprint for Existing Engines & Adapters

Rules that apply to every change below. (1) Additive first: new code ships dark behind a signed flag, old code keeps serving. (2) Engines are pure functions with no I/O, so they can be replayed against the 10,518-record catalogue. (3) Every output stores the versions that produced it (P5). (4) Every change lists its failure behaviour, rollback trigger and verification tests. (5) `db.js` is generated: all edits are made in `ui/src/app/lib/db/*.ts` and the bundle is rebuilt, never hand-edited.

### 2.1 Scoring and policy: one kernel, one grade, token-driven policy (C1–C3; E-01 to E-07, X-07, X-12)

**Target architecture.** Three pure layers behind one entry point, replacing the three overlapping engines.

```text
engine/kernel.js      canonicalise(record) -> NutrientVector   units, ADR-8 constants, never zero-fills
                      gate(record, vec)    -> { g1, g2, missing[] }
engine/fsa-nps.js     fsaNps2023(vec, category) -> ScoreResult   wraps engine/scorers/* as category adjusters
engine/policy.js      evaluatePolicy(vec, gate, tier, policy) -> PolicyDecision
engine/evaluate.js    evaluateItem(record, policy) -> ItemEvaluation   the only function callers use
```

`gate()` is the existing `shared/target-sync.ts` `checkNutrientCompleteness` (invariant T20): energy, sugars, saturated fat and sodium (or salt) must all be non-null. One implementation, imported by the extension build and the server, so the two cannot drift again. `NutritionContextEngine.getContextGrade` stops producing a letter (its flags survive as data chips behind a flag), `evaluateProductForUser` is deleted in Phase 4, and the `DISEASE_RULES` presets become a legacy path.

**Evaluation state machine** (deterministic; every transition is a pure function of record, policy and versions):

```ts
type EvalStatus =
  | 'NOT_ATTEMPTED'          // unsupported page or non-food: neutral
  | 'UNRESOLVED'             // no catalogue match: "Not rated"
  | 'INSUFFICIENT_DATA'      // gate G2 fails: no letter, known facts shown as chips
  | 'COMPUTED_PROVISIONAL'   // tier ESTIMATED: letter shown, no warn or block
  | 'COMPUTED_CONFIRMED';    // tier VERIFIED or HIGH_CONFIDENCE: letter plus policy actions

interface ItemEvaluation {
  status: EvalStatus;
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null;      // null unless COMPUTED_*
  facts: Array<{ key: NutrientKey; value: number; unit: 'g' | 'mg' | 'kcal' }>;
  missing: NutrientKey[];                         // from checkNutrientCompleteness
  assumptions: Array<'fibre_zero' | 'protein_zero' | 'fvl_zero'>; // positive components only
  tier: 'high_confidence' | 'confirmed' | 'estimated' | 'not_rated';
  decision: PolicyDecision;
  versions: { scoring: 'v5'; algorithm: 'fsa-nps-2023'; catalogue: string; profile: number | null };
}
```

**Code-level directives.**

1. `grading.ts` (source of `db.js:763` `interpretProduct`): replace the energy-only gate and make `computeGradeFromProduct` (`db.js:685`) refuse incomplete input.

```diff
- const gate2Passed = n.EnergyKJ != null || n.EnergyKcal != null;
+ const completeness = checkNutrientCompleteness(toCompletenessInput(n));
+ const gate2Passed = completeness.computability === 'COMPUTABLE';

  // computeGradeFromProduct
- if (energy == null) return { grade: 'UNKNOWN', status: 'insufficient_data', plausibleFields };
- const safePos = (v) => v == null ? 0 : v;
+ const miss = requiredMissing({ energy, sugars, satFat, sodium });   // the four negative components
+ if (miss.length) return { grade: 'UNKNOWN', status: 'insufficient_data', plausibleFields, missing: miss };
+ // fibre, protein and FVL may default to 0 points: that can only lower the grade. Record it.
+ const assumptions = [fibre == null && 'fibre_zero', protein == null && 'protein_zero', fvlPct == null && 'fvl_zero'].filter(Boolean);
```

2. `policy.js`: the token-driven evaluator. Unknown never triggers and never clears; an allergen exclusion with no allergen data returns a caution, never silence.

```ts
function evaluatePolicy(vec, gate, tier, policy): PolicyDecision {
  if (!policy) return NONE;                               // no verified token: neutral grades only (P1)
  const triggers = [];
  for (const f of policy.per100gFlags) {                  // DPT constraint set, per 100 g only
    const v = vec[f.n];
    if (v == null) continue;
    if ((f.gt != null && v > f.gt) || (f.lt != null && v < f.lt)) triggers.push({ n: f.n, actual: v, limit: f.gt ?? f.lt, cmp: f.gt != null ? 'gt' : 'lt' });
  }
  for (const a of policy.exclude ?? []) {
    if (vec.allergens === undefined) return caution('allergen_data_unavailable');   // confidence_low
    if (vec.allergens.includes(a)) return hard('safety_hard');
  }
  const confirmed = tier === 'confirmed' || tier === 'high_confidence';
  if (!triggers.length || !confirmed || !gate.g2) return { ...NONE, triggers, min_conf_ok: confirmed };
  return { action: policy.blockMode, reason_class: 'clinical_soft', triggers, min_conf_ok: true, profile_ver: policy.profileVer };
}
```

3. `per_day` constraints (for example sodium ≤ 1,500 mg per day) are not item-level flags. They are consumed by the exposure and adherence engines (3.10); the item-level engine ignores them rather than comparing a per-day cap with a per-100 g value, which is what `evaluateDynamicRules` does today (E-04).
4. `getSettings` and `updateSettings` (`db.js:457`): an unset condition flag becomes `false`, not `true`. Existing explicit values are untouched. This is a behaviour change by design (a safety correction), so it needs the sign-off listed as D-1 in Section 5.
5. `isDiabeticFriendlyPredicate`: drop the fibre < 3 g disqualifier for items whose sugars and carbohydrates are both below the policy limit (E-07). It becomes a policy flag, not a hard-coded predicate.
6. `commercial-catalogue.ts` `evaluateSkuAgainstConstraints` (X-07): require `review_state` of VERIFIED or higher and `checkNutrientCompleteness` for every constrained key; null becomes `unknown`, and unknown is ineligible for a swap.
7. `verifyAtwaterEnergy` tolerance from 8% to 15% above 20 kcal calculated energy, per §2.5 (X-12); the stricter 8% stays as a data-curation lint, not a runtime gate.

> **ADR-8: salt to sodium conversion factor** **Context.** The code uses salt × 400 mg per g everywhere (`Kernel.resolveSodiumMg`, `db.js`, `target-sync.ts`); the report says ×393.4 (E-03). **Research.** The EU labelling regulation (1169/2011, Annex I) defines salt equivalent as sodium × 2.5. Manufacturers derive the labelled salt value by that formula, so the exact inverse is 400 mg of sodium per gram of labelled salt. 393.4 is the chemical mass fraction of sodium in NaCl and would not round-trip with label values. **Decision.** Keep ×400 and amend §2.5 of the Clinical report. Rejected: ×393.4 (breaks round-trip with label data, adds a 1.7% disagreement with every stored `SaltG`). **Residual risk.** A stored `SodiumMG` and `SaltG` that disagree by more than the rounding tolerance should raise a `consistency_check` flag, not be silently resolved. Added to the Phase 2 data lint.

**Set-point tuning.**

| Parameter | Value | Basis |
| --- | --- | --- |
| `evaluateItem` P95 | ≤ 5 ms per item (policy ≤ 1 ms of that) | Clinical §1.1 scoring budget |
| In-memory result cache | LRU 512 entries, key `(productId, catalogueVersion, scoring, profileVer)`, not persisted | Earlier benchmark: about 0.01 ms per product, so persistence adds cost without benefit |
| `product_cache` TTL | Keep 7 days; invalidated by `SCORING_VERSION` v4 to v5 automatically (`getCachedProduct` already checks it) | `db.js:558` |
| Plausibility bounds | Unchanged: energy 0–4,000 kJ, sugars and fats 0–100 g, sodium 0–40,000 mg | `db.js:700` |

**Failure handling.** Any thrown error inside `evaluateItem` returns `NOT_ATTEMPTED` with `error_code`, increments the `eval_error` counter (3.2) and renders the neutral badge; it never blocks a purchase flow. **Rollback trigger.** Flag `ns.scoring.v5` off, or `eval_error` rate above 0.5% in any 10-minute window. **Verification.** (a) T-04 reference set, 20 of 20 exact, plus each retailer's top 500 SKUs; (b) property test over all 10,518 records: `status` is `COMPUTED_*` only if the four nutrients are non-null (zero violations); (c) metamorphic test: nulling any one of the four fields flips the status to `INSUFFICIENT_DATA`; (d) v4-to-v5 diff test: every changed grade must have a non-empty `missing`; (e) policy tests: unknown never triggers, UNVERIFIED never warns (T-02), allergen-unknown returns caution; (f) JSON-schema contract test on `ItemEvaluation`.

### 2.2 Product resolution (NME) (C4; E-11, E-12)

**Target architecture.** A batch resolver that implements the M1–M5 cascade over precomputed indexes, never scans the catalogue and never builds a RegExp from page data.

```ts
interface Observation { retailer: RetailerCode; sku: string | null; gtin: string | null; url: string;
                        name: string; sizeText: string | null; price_minor: number | null }
interface Resolution  { productId: string | null; method: 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | null; p: number;
                        reason?: 'no_candidate' | 'ambiguous' | 'below_threshold' }
resolveBatch(retailer: RetailerCode, obs: Observation[]): Promise<Resolution[]>   // replaces resolveProductMatch(db.js:856)
```

- **Index store.** New IndexedDB store `nme_index` (additive, DB v19) with keys `sku:<retailer>:<sku>`, `gtin:<gtin>`, `k3:<brand>:<normalisedName>:<size>:<variant>` and blocking keys `blk:<brand>:<sizeBucket>` mapping to product IDs. It is written inside the same transaction as the catalogue swap in `applyStaging` (2.6), so index and records can never disagree.
- **Lookup.** One read-only transaction per batch, `get()` per key (B-tree lookups; no `getAll()`), records fetched by primary key through an LRU of 256. The in-heap `memCache` of whole stores is deleted.
- **Cascade.** M1 GTIN exact, M2 retailer SKU or URL slug via `sku:` keys, M3 deterministic key, M4 candidates from the blocking key scored by token-set ratio, size agreement and brand agreement, M5 category fallback (tier cap ESTIMATED, no warn or block).
- **Confidence.** `p` replaces the `high`, `medium`, `low` strings. M1–M3 accept at p ≥ 0.99; M4 accepts at p ≥ 0.92 and is capped to ESTIMATED between 0.80 and 0.92; below 0.80 it is rejected. The legacy `normalized_name` match is re-labelled M4 with p = 0.80, so it can no longer drive a warning (E-12).
- **Safety.** The Carrefour `new RegExp` path and the Quickmart per-record `new URL()` path are removed, which also closes the ReDoS class.

| Parameter | Value | Basis |
| --- | --- | --- |
| Exact resolution (M1–M3), batch of 48 | P95 ≤ 10 ms | Clinical §1.1 |
| Fuzzy (M4) | ≤ 40 ms per batch; blocked set ≤ 200 candidates; 10–15% of items | Clinical §1.3 |
| Cold-start cost | No preload; first batch pays index `get()`s only. If Phase 2 shows exact resolution above 10 ms, fall back to a key-only in-heap Map (about 0.4 MB for 7,000 keys) | Measure-then-decide |
| Record LRU | 256 entries, evicted on catalogue swap | Bounded memory |
| Acceptance thresholds | M4 p ≥ 0.92 accept; 0.80–0.92 cap; < 0.80 reject (recalibrate on the labelled set) | T-05 |

**Failure handling.** An index miss is `UNRESOLVED` (neutral), never a guess. A corrupted index (checksum on `dataset_metadata`) triggers a rebuild from `catalog_products` inside one transaction; during the rebuild the resolver serves `UNRESOLVED`. **Rollback.** Flag `ns.nme.v2` off returns to `resolveProductMatch`. **Verification.** Labelled-pair precision test (M1–M3 ≥ 99.5%, M4 ≥ 97% at p ≥ 0.92); a no-scan test that spies on `IDBObjectStore.getAll` and `openCursor` and fails if either runs on the hot path; a 48-item batch timing test in CI on a throttled profile; fuzz test feeding hostile `data-product-id` strings (regex metacharacters, 10 KB strings).

### 2.3 Cart ledger and analytics (C5; E-08, E-09, E-10, E-13)

**Target architecture.** The adapter's cart snapshot is the source of truth; the ledger is a derived, versioned, bounded projection.

```ts
interface LedgerRow {
  id: string; retailer: RetailerCode; retailerProductId: string; productId: string | null;
  quantity: number;                    // last known, never summed
  status: 'in_cart' | 'removed' | 'purchased';
  scoringStatus: 'scored' | 'unscored' | 'unmatched';   // unscored rows are kept (E-09)
  gradeSnapshot: Grade | null;
  unitPriceMinor: number | null;
  cartEpisodeId: string;               // new
  clientSeq: number;                   // new, monotonic per install
  versions: { scoring: string; catalogue: string; profile: number | null };   // new (E-10)
  firstSeenAt: number; updatedAt: number;
}
applyCartSnapshot(retailer, snapshot): Promise<{ added: number; updated: number; removed: number }>
```

1. `applyCartSnapshot` runs in one `readwrite` transaction over `shopping_ledger`: set (not add) the quantity for matched rows, insert new rows (scored, unscored or unmatched), and mark rows absent from two consecutive snapshots as `removed` (hysteresis stops a partial DOM read from flapping). `dedupeActiveCartItems` keeps the last-writer row by `updatedAt` instead of summing; `logCartEvent` (`db.js:968`) sets instead of adds.
2. `clientSeq` comes from a counter in `chrome.storage.local` incremented under `navigator.locks.request('ns-seq', ...)` so two tabs cannot issue the same number.
3. Retention: `purgeOlderThan(90 days)` runs on a daily `chrome.alarms` entry and on dashboard load. `resolveTimeframe` (`db.js:1128`) keeps its signature but maps `year` and `all` to `3m`; the UI stops offering them (UI report §5.7). Server retention is a separate policy and is unaffected.
4. Coverage C and the unscored share are computed from `scoringStatus`, which is what the Adherence engine needs (§3.1, §3.3).
5. Schema: DB v19 adds indexes `by_episode` and `by_seq` and defaults the new fields on read; no stored row is rewritten, so the change is non-breaking and reversible. Legacy rows read as `scoringStatus: 'scored'`, `versions.scoring: 'v4'`.

**Failure handling.** If the transaction aborts, nothing is written and `pending_cart_syncs` retains the last snapshot (it is keyed by retailer, which is correct for snapshots, wrong for events, so events go to the new `telemetry_queue` in 2.8). **Rollback.** Flag `ns.ledger.v2` off; v19 indexes are inert. **Verification.** Two-tab race test (fake IndexedDB, interleaved snapshots, expect one row and the later quantity); property test that quantity never exceeds the last snapshot; 3-month purge test with a clock stub; coverage test over a cart with 30% unscored spend.

### 2.4 Scanner resilience and neutral fallback (C6; A-10)

`scanner.js` keeps its viewport gating, 30 ms micro-batching and bounded concurrency. Three additions: a response deadline, jittered backoff with a circuit breaker, and a neutral state when it gives up.

```js
const RPC_DEADLINE_MS = 1500;
const backoffMs = (n) => Math.random() * Math.min(2000, 150 * 2 ** n);   // full jitter

function sendWithDeadline(msg) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ ok: false, reason: 'timeout' }); } }, RPC_DEADLINE_MS);
    _safeSend(msg, (res) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok: true, res }); });
  });
}
// _score(): on { ok:false } -> breaker.record(); if (attempt < 3) retry after backoffMs(attempt) else adapter.injectNeutral(el)
// breaker: 5 failures within 10 s opens for 15 s; while open, render neutral immediately and skip the RPC
```

> **ADR-9: retry policy for the on-device RPC and network calls** **Context.** `_retryLater` re-enqueues at once; `fetchWithRetry` doubles from 500 ms with no jitter or deadline (A-10, A-11). Two stalled replies currently freeze scoring because the in-flight slots never release. **Research.** The AWS Architecture Blog analysis of backoff strategies shows that plain exponential backoff keeps correlated clients colliding, while full jitter (a uniform random delay up to the exponential cap) finishes the same work with fewer calls and less contention than equal or no jitter. Honouring a server `Retry-After` takes precedence over any computed delay. **Decision.** Full jitter, base 150 ms and cap 2 s on-device; base 1 s, cap 60 s and three attempts for network calls; a per-attempt deadline everywhere; `Retry-After` honoured. Rejected: fixed delays (synchronised retries) and decorrelated jitter (more state, no measurable gain at this scale). **Residual risk.** A deadline shorter than a cold service-worker start would turn a slow wake into a neutral badge. The 1,500 ms value is provisional and is re-fitted from the P99.9 of the new `sw_rpc_ms` histogram in Phase 2.

Instrumentation points added here: `performance.mark('ns:batch')` at flush, `ns:painted` after the badge write, and `performance.measure('ns:badge_ms', ...)` per batch, fed to the SDK in 3.2. The dead `_onMutations` tail branch is removed.

| Parameter | Value | Basis |
| --- | --- | --- |
| RPC deadline | 1,500 ms (provisional) | Longer than a cold wake, shorter than shopper patience |
| Attempts and backoff | 3 attempts, full jitter, base 150 ms, cap 2 s | ADR-9 |
| Circuit breaker | 5 failures in 10 s, open 15 s, half-open one probe | Prevents retry storms on a dead worker |
| In-flight limit | 2 (raise to 3 only if queue wait P95 exceeds 25 ms) | Existing bound |
| Neutral state | Rendered on give-up, breaker open, or catalogue unavailable | T-13: zero blocks |

**Rollback.** Flag `ns.scanner.v2` off. **Verification.** Fake worker that drops replies: scoring resumes after the deadline and shows neutral badges; breaker test with 5 induced failures; T-13 offline test; no `chrome.runtime` listener leak after 100 navigations.

### 2.5 Retailer adapters (C7; A-08, A-09)

**Target architecture.** One adapter contract, one generic extraction engine, and per-retailer spec data. Retailer-specific code shrinks to the cart quirks that cannot be expressed as selectors (Magento section API and Livewire snapshot on Naivas, `__NEXT_DATA__` on Carrefour).

```ts
interface RetailerAdapter {
  readonly retailer: RetailerCode; readonly specVersion: string;
  matches(url: URL): boolean;                          // hostname plus path allow-list and exclusions
  observeProducts(root: ParentNode): Observation[];    // pure extraction, no network, no storage
  injectBadge(el: Element, ev: ItemEvaluation): void; // shared renderer (2.9)
  injectNeutral(el: Element): void;
  observeCart(): CartSnapshot | null;                  // retailer-specific code stays here
  detectCheckoutCompleted(): OrderConfirmation | null;
}
// adapters/spec/<retailer>.json: { specVersion, minExtVersion, killSwitch, hostSuffixes[], allowPaths[], excludePaths[],
//   tile: [{ sel, rank }], fields: { sku[], gtin[], name[], price[], size[] } }   // signed, see 3.8
```

**Directives.**

1. New `adapters/adapter-core.js` wraps the existing `declarative-engine.js` (ranked selectors, `killSwitch`) and extends it with JSON-LD and microdata first, `data-*` second, visible text last, recording the `source` of each field. `naivas.js`, `carrefour.js` and `quickmart.js` become subclasses that delegate `observeProducts` and `injectBadge` to the core and keep only cart methods. The roughly 85% duplicated 170-line header disappears.
2. `adapters/registry.js` replaces the `window.*Adapter` capture in `adapter-factory.js`. Adapters are imported statically by the content-script bundle, so registration no longer depends on script order.
3. URL matching uses the parsed URL, not a regex over the whole string:

```js
function matches(urlString, spec) {
  const u = new URL(urlString);
  const hostOk = spec.hostSuffixes.some((s) => u.hostname === s || u.hostname.endsWith('.' + s));
  if (!hostOk) return false;
  if (spec.excludePaths.some((p) => u.pathname.startsWith(p))) return false;   // /account, /login, /checkout/payment
  return spec.allowPaths.some((p) => u.pathname.startsWith(p));
}
```

4. Spec regexes (`hrefRegex`) are compiled once at spec load inside try/catch, rejected above 200 characters or when a safe-regex lint finds nested quantifiers, and a failing rule disables itself rather than the adapter.
5. Page values are untrusted. Price and quantity from the page are used for display and telemetry only, never for a safety decision; a page price above 5 times the catalogue price is quarantined (`price_quarantined`) and excluded from spend aggregates.
6. Migration is a strangler, one retailer at a time: Quickmart first (smallest surface, the benchmark adapter), then Naivas, then Carrefour. Each step is gated by a parity test: 100 recorded fixture pages per retailer, old and new extractors must return identical `Observation[]` apart from the new fields.

| Parameter | Value | Basis |
| --- | --- | --- |
| `observeProducts`, batch of 48 | P95 ≤ 15 ms | Clinical §1.1 |
| Spec refresh | Alarm every 6 h plus jitter; signature verify ≤ 5 ms; spec ≤ 32 KB | Cost, 3.8 |
| Kill-switch propagation | ≤ 5 min (flag poll, 5.3) | Matches rollback target |
| Selector-failure alert | > 2% of observed tiles in a nightly canary run | Clinical §1.3 |
| Price quarantine | page price > 5 × catalogue price | Spoof guard |

**Failure handling.** A spec that fails signature, version or lint checks is ignored and the previous spec stays active; with no valid spec the adapter reports `NOT_ATTEMPTED` and the page is left untouched. **Rollback.** Flag `ns.adapter.core.<retailer>` off. **Verification.** Parity fixtures; hostile-URL test (`https://evil.example/?ref=quickmart.co.ke` must not match); ReDoS test with a 10 KB hostile `hrefRegex`; spec-signature tamper test; selector-drift test that mutates a class name and expects the next-ranked selector to win.

### 2.6 Catalogue sync: verify, then commit (C9; A-01 to A-04, X-10)

**Target architecture.** Fail-closed integrity, atomic promotion, anti-rollback, and a cadence driven by an alarm rather than by worker wakes. The integrity primitives already exist in `shared/` (`canonical.mjs` `recordHash` and `computeCatalogHash`, `pack-client.ts`); the work is to use them.

1. **Check on a timer.** `chrome.alarms` entry `catalog-check` every 6 hours plus up to 30 minutes of jitter, and once on install. `ensureReady()` no longer syncs; it only guarantees a live catalogue exists. The manifest request is conditional (`If-None-Match`).
2. **Anonymous and cacheable.** The catalogue holds no personal data, so it is served as signed static objects and the `isAuth` precondition in `catalog-sync.js` is removed. This also detaches sync from the Supabase client that is being decommissioned.
3. **Verify the manifest.** Existing signature check, plus `release_seq` strictly greater than the stored `max_release_seen` (anti-rollback, the same rule as T17 for bundles), and `issued_at` not more than 5 minutes in the future.
4. **Verify before commit.** Pull into staging only. For every staged row, recompute `recordHash(row.record)` and compare it with `row.record_hash`; then compute the aggregate over the recomputed hashes and compare it with the manifest's `catalog_hash`. Nothing touches live stores until both pass.
5. **Atomic promotion.** One transaction writes the catalogue rows, the `nme_index` entries (2.2) and flips a `catalog_live` pointer `{ version, release_seq, committedAt }`. The previous version is retained, so rollback is a pointer flip.
6. **Fail closed.** An `IntegrityError` discards staging, keeps the last good catalogue, increments `integrity_failure_count`, emits a `catalog_integrity_failure` event (3.2) and retries at 1 h, 4 h, then 12 h. It is never swallowed into a "continuing with cached catalogue" log line without a metric.

```js
class IntegrityError extends Error {}
async function verifyStaging(manifest) {
  for await (const row of stagingRows()) {
    if ((await recordHash(row.record)) !== row.record_hash) throw new IntegrityError('row:' + row.key);
  }
  if ((await computeCatalogHash(stagingHashes())) !== (manifest.catalog_hash_v2 ?? manifest.catalog_hash)) {
    throw new IntegrityError('aggregate');
  }
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // code-unit order replaces localeCompare(..., 'en')
```

**Contract bridge for the sort change.** `localeCompare` and code-unit ordering produce different key orders for mixed case and punctuation, so switching changes the aggregate hash. The publisher (`scripts/publish-catalog.mjs`, `canonical.mjs`) emits both `catalog_hash` (legacy order) and `catalog_hash_v2` (code-unit order) for at least two releases; the client prefers v2 when present and accepts the legacy hash for older releases until Phase 4.

| Parameter | Value | Basis |
| --- | --- | --- |
| Check interval | 6 h plus 0–30 min jitter | Cost per transaction (A-04) |
| Per-request deadline | 15 s (from 30 s) | Fail fast, retry with jitter |
| Retry policy | 3 attempts, full jitter, base 1 s, cap 60 s | ADR-9 |
| Global sync deadline | 300 s | Bound a stuck sync |
| Page and chunk size | 500 rows per page, 200 per staging chunk (unchanged) | Existing |
| Heap bound | ≤ 8 MB staged at once | MV3 worker limits |
| Versions retained | 2 | Pointer-flip rollback |

**Rollback.** Flag `ns.catalog.verify_v2`; in Phase 2 it runs report-only (log mismatches, do not block) so false positives are measured before enforcement. **Verification.** Tamper test (flip one nutrient in a staged row, keep its hash: rejected, live catalogue unchanged); aggregate-mismatch test; rollback-replay test with an older signed manifest; ICU determinism test (same hash in Node and headless Chrome); network-chaos test that drops the connection mid-page and resumes from `stagingCursor`; migration test that a legacy manifest still verifies through the bridge.

### 2.7 Entitlement becomes a token verifier (C10; A-05, X-02, X-05)

`entitlement.js` models a paid tier. Under the CAD-only identity model the device needs to verify a clinician-issued policy, not a subscription. The verifier keeps its good parts (WebCrypto, clock-rollback guard, signature-before-trust) and changes the contract.

> **ADR-3: signature algorithm and token lifetime on the device** **Context.** The extension verifies ES256 (`entitlement.js`, catalogue manifest); `shared/dpt.ts`, `dpop.ts` and `signer.ts` use Ed25519 through `node:crypto`, which the MV3 worker cannot import; target bundles use no real signature (X-02). **Research.** Ed25519 shipped in the Web Cryptography API in Chrome 137 (Blink intent to ship; Chrome 137 release notes), so `crypto.subtle.verify` can check EdDSA in a service worker without a library. The Vault transit engine named in `signer.ts` as the cutover target supports Ed25519 signing keys (confirm against the deployed version). **Decision.** Standardise on Ed25519 for target bundles, profile tokens, DPoP proofs, selector and flag manifests; set `minimum_chrome_version` to 137; feature-detect with a test `importKey('raw', pk, 'Ed25519', ...)` at worker start and fall back to neutral grades plus an update notice if it throws. ES256 verification stays for the legacy entitlement and catalogue manifests until Phase 4. Each token `typ` accepts exactly one algorithm, so an ES256 token can never be presented where EdDSA is required. Rejected: keep ES256 everywhere (two toolchains, rewrites the working server modules for no gain), RS256 (larger keys and signatures, slower verification). **Residual risk.** Browsers older than 137 lose grading; the neutral fallback is the safe failure. HSM or KMS products in the chosen sovereign cloud may lack Ed25519; the Vault transit path avoids that dependency.

**Two tokens, two jobs.** `shared/dpt.ts` is a 15-minute, DPoP-bound, band-only token for the commercial catalogue filter. The device needs the report's profile token: long-lived (30 days, offline-verifiable), audience `ext:<retailer>`, carrying `per_100g_flags`, `exclude`, `policy` and `profile_ver`. They are separate `typ` values signed by the same signer (contract in 3.1).

```ts
interface VerifyPolicy { typ: 'ns-profile+jwt' | 'ns-dpt+jwt' | 'ns-bundle+json'; algs: Array<'EdDSA' | 'ES256'>; aud: string; skewS: 60 }
verifyToken(compact: string, p: VerifyPolicy, keys: SignedKeyManifest, revoked: RevocationSnapshot, now: number): Promise<VerifyResult>
// checks in order: typ, alg allow-list for typ, kid present in the signed key manifest, signature, iss, aud,
// nbf and exp with 60 s skew, jti not revoked, profile_ver >= stored (monotonic), cnf.jkt equals the device key when present
```

| Refresh response | Action |
| --- | --- |
| 200 | Replace token; store encrypted |
| 304 | Unchanged |
| 401, 403, 410 | Definitive revocation: purge token and queue, `policy = null`, emit `token_revoked`, neutral grades only (A-05 fix) |
| 429, 5xx, network | Keep until `exp`, retry with full jitter, `Retry-After` honoured; after `exp` neutral grades |

**Storage.** Encrypt the token at rest with AES-GCM under a non-extractable `CryptoKey` held in IndexedDB. State the limit plainly: this defeats casual profile-copy and storage-dump access, not code running inside the extension.

**Target bundle fix (X-02), `shared/target-sync.ts` `verifyBundle`:**

```diff
- if (!newBundle.signature || !newBundle.signature.startsWith('sig_es256_')) return { valid: false, reason: 'invalid_signature' };
+ const ok = await verifyDetached(canonicalBytes(withoutSignature(newBundle)), newBundle.sig, keys.get(newBundle.kid), 'ns-bundle+json');
+ if (!ok) return { valid: false, reason: 'invalid_signature' };
+ if (newBundle.subjectRef !== ctx.subjectRef || newBundle.tenantId !== ctx.tenantId) return { valid: false, reason: 'binding_mismatch' };
+ if (!Number.isFinite(Date.parse(newBundle.validTo))) return { valid: false, reason: 'invalid_expiry' };
+ if (Date.parse(newBundle.issuedAt) > now + 5 * 60_000) return { valid: false, reason: 'issued_in_future' };
```

**Contract bridge for bundles.** Phase 1: the server signs bundles with the new `sig` field and keeps the legacy `signature` string. Phase 2: the client runs in shadow mode and logs `legacy_ok_new_invalid` and `new_ok_legacy_invalid`. Phase 3: enforce per cohort. A cached legacy bundle that cannot be re-fetched is honoured until `validTo` but limited to warn-level actions (no block) and flagged `unsigned_legacy`. Phase 4: remove legacy acceptance.

| Parameter | Value | Basis |
| --- | --- | --- |
| Token verification | ≤ 3 ms | Worker budget |
| Key manifest | Signed, TTL 24 h; two pinned root keys in the bundle for rotation | §1.2 key custody |
| Revocation snapshot | Server list within 1 min; device poll every 5 min via alarm | §5.4 (client stop ≤ 5 min) |
| Clock skew | ± 60 s; existing clock-rollback guard kept | Existing |
| Profile token lifetime | 30 days \[A\], expiry shows neutral grades | §1.2 |

**Rollback.** Flag `ns.token.v2`; legacy verifier stays until Phase 4. **Verification.** T-01 expired token gives neutral grades; tampered-claim rejection; `alg: none` and cross-`typ` algorithm-confusion rejection; revoked token purged within 5 minutes; older `profile_ver` rejected; wrong-audience rejection; forged `sig_es256_x` bundle rejected once enforcement is on; Ed25519 feature-detect failure falls back to neutral.

### 2.8 Telemetry client replaces `observed-orders-sync.js` (C11; A-06, A-12, O-02)

**Target architecture.** A durable, consent-gated, idempotent, bounded queue.

```ts
interface TelemetryEvent {
  schema: 'nutriscore.telemetry/1.1';
  event_id: string;                 // ULID, created once at enqueue and never regenerated
  client_seq: number;               // monotonic per install (2.3)
  type: 'cart_snapshot' | 'checkout_completed' | 'swap_accepted' | 'swap_declined' | 'obs_metric';
  occurred_at: string;              // RFC 3339 device time; the gateway adds received_at
  shopper_ref: string;              // Shopper_ID alias from the token, never the patient UUID
  retailer: RetailerCode; cart_episode_id: string;
  consent_ref: string;              // receipt id; 100% linkage required
  profile_ver: number | null;
  versions: { scoring: string; catalogue: string; ext: string };
  payload: unknown;                 // validated against a JSON Schema per type
}
```

- **Queue.** IndexedDB store `telemetry_queue` (primary key `event_id`; indexes `by_status`, `by_seq`), statuses `pending`, `inflight`, `acked`, `dead`.
- **Flush.** Alarm every 15 minutes, on `checkout_completed`, and on the `online` event. Batch of at most 100 events and 256 KB. `Idempotency-Key` is the SHA-256 of the sorted event IDs, so a retried batch carries the same key. Request deadline 5 s through `AbortSignal.timeout(5000)`. The reply is per event: `accepted`, `duplicate` or `rejected` with a code. Accepted and duplicate are deleted; schema-rejected go to `dead` with no retry; 429 and 5xx retry with full jitter (base 5 s, cap 15 min) and `Retry-After`; eight attempts then `dead`.
- **Consent.** Checked at enqueue and again at flush, from the verified profile token. On revocation the queue is purged at once (T-08; client stop within 5 minutes).
- **Bounds.** At most 1,000 events or 2 MB queued, oldest dropped with a `telemetry_dropped` counter; 20 events per second per device guard; dead letters kept 7 days.
- **Config hygiene.** Remove the `http://127.0.0.1:54321` default. `GATEWAY_URL` comes from `config.js` at build time, and `scripts/check-dist.mjs` fails the build if `dist/` contains `__VITE_`, `127.0.0.1`, `localhost` or `sandbox.safaricom` (A-12).

**Immediate low-risk patch (Phase 1).** In the legacy path, derive the idempotency key from the payload, `obs-${retailer}-${sha256(canonical(payload))}`, so a retry carries the same key. This is safe to ship before anything else, provided the legacy Edge Function de-duplicates on that header (not supplied; to be confirmed).

**Contract bridge.** Phase 1 dual-writes: the legacy POST continues; the new queue also flushes to `/v1/telemetry/batch` with `X-NS-Shadow: 1`, which the gateway validates and stores in a shadow table that feeds no analytics. Phase 3 cuts over by cohort. Phase 4 deletes the legacy function.

| Parameter | Value | Basis |
| --- | --- | --- |
| Flush | 15 min, checkout, online | Clinical §2.3 |
| Batch | ≤ 100 events and ≤ 256 KB | Bounded payload |
| Deadline | 5 s per request | Fail fast |
| Backoff | Full jitter, base 5 s, cap 15 min, 8 attempts | ADR-9 |
| Queue cap | 1,000 events or 2 MB; dead letters 7 days | Bounded storage |
| Rate guard | 20 events per second per device | Clinical §2.6 |

**Rollback.** Flag `ns.telemetry.v2` off; the legacy path never stopped. **Verification.** Kill the worker mid-flush (no loss, no duplicate server-side); replay the same batch (every event `duplicate`); revoke consent (queue empty within 5 minutes); schema conformance at least 99.5% on 10,000 synthetic events; device clock skew of plus and minus 2 days; `check-dist` negative test with a planted placeholder.

### 2.9 Badge and flyout rendering (C8; A-07, A-11, E-06)

1. `attachShadow({ mode: 'closed' })` at `shared-ui.js:96` and `:137`, with the root kept in a module-scoped `WeakMap`. Page scripts then get `null` from `host.shadowRoot`. State the limit: closed mode hides the subtree from page JavaScript, not from the user or a screenshot, and the host element stays visible, so no sensitive text goes into attributes.
2. Copy rule: the UI names the nutrient and the limit in plain words and never the condition, for example "High in sodium: 750 mg per 100 g, above your limit of 600 mg". The strings "Diabetes Risk", "Hypertension Risk" and similar are removed. Theme recolouring by condition (`health-modes.js`) is replaced by the neutral palette from the UI report (D-03).
3. Dynamic strings go in through `textContent` or `createElement`; `escapeHTML` stays for static templates; an ESLint rule bans `innerHTML` assignment with a non-literal.
4. `fetchWithRetry` follows ADR-9: `AbortSignal.timeout(4000)`, full jitter, `Retry-After`, and a three-attempt budget.
5. `window._nutriscore*` globals are replaced by module state.

**Rollback.** Flag `ns.ui.closed_shadow`. **Verification.** Playwright test with a hostile page script (`document.querySelector('ns-host').shadowRoot` must be `null`); a DOM text scan that fails on `/diabet|hypertens|kidney|obes/i`; axe run on the injected badge and flyout.

## Section 3: Architecture for Net-New Engines & System Components

Every component below answers a gap in 1.4. Rule zero: reuse `shared/` before writing anything. Where `shared/` already holds the logic (policy engine, field envelope, DPoP, canonical hashing, pack client), the new component wraps it and fixes the listed defect; where it does not (gateway, hub, controller, observability), the design is new. Shared code that must run in both Node and the MV3 worker moves behind a small `CryptoProvider` interface (`crypto/node.ts`, `crypto/web.ts`), because `dpt.ts` and `dpop.ts` import `node:crypto`.

```text
DEVICE (MV3)                         GATEWAY ZONE                     CLINICAL ZONE              ANALYTICS ZONE
+--------------------------+       +-----------------------+       +--------------------+     +------------------+
| content.js + adapters    | batch | N3 telemetry gateway  |       | Profile Compiler   |     | bronze > silver  |
|  observe > resolveBatch  |------>|  schema, consent,     |-queue>| Token Exchange     |     | > gold (k >= 20) |
| SW: evaluateItem         | DPoP  |  dedupe, outliers     |       | Consent register   |     | Adherence (N10)  |
| N1 token verifier        |       +-----------------------+       | Audit writer (N7)  |     +------------------+
| N2 obs SDK, queue        |<--- signed keys, flags, catalogue (anonymous, cacheable) ---+
+--------------------------+

CAD (browser) --cookie--> N5 BFF (PDP, masking, caps) --> N6 SSE hub --> views
N4 controller <-- Prometheus <-- OTel collector <-- every service above (in-region)
```

| ID | Component | Closes | Section |
| --- | --- | --- | --- |
| N1 | Profile token, device policy contract, allergen vocabulary | G-01, G-09 | 3.1 |
| N2 | Observability SDK (device) | G-04, O-01 | 3.2 |
| N3 | Telemetry gateway and bronze ingest | G-02, G-03 | 3.3 |
| N4 | Metrics, SLOs and closed-loop controller | G-04, O-03 | 3.4 |
| N5 | BFF with PDP, field masking and capability service | G-05 | 3.5 |
| N6 | Real-time hub (SSE) | G-06 | 3.6 |
| N7 | Audit writer and verifier | G-07 | 3.7 |
| N8 | Selector and flag manifest service, canary | G-08 | 3.8 |
| N9 | Consent, revocation and crypto-shred hooks | G-10, X-08 | 3.9 |
| N10 | Adherence engine, Profile Compiler, Token Exchange (contract only) | G-11, G-12 | 3.10 |

### 3.1 N1: profile token, device policy contract and allergen vocabulary

**Responsibility and boundaries.** Server side: mint a profile token from a compiled clinician profile. Device side: verify it (2.7) and hand a `Policy` to `evaluatePolicy` (2.1). The token carries constraints only, never a condition name, diagnosis or biomarker (I2). Device-only dimensions (protein, potassium, phosphorus) travel in the signed target bundle, as `dpt.ts` already drops them from the commercial token. Data residency: minted and signed inside the clinical zone; the device holds only the token.

**Design.** New `shared/profile-token.ts`, reusing the `dpt.ts` allowlist and `CONDITION_NAMED_PATTERNS` scrubber as a mint-time lint, `signer.ts` for signing and `dpop.ts` for binding.

```ts
interface ProfileTokenClaims {
  iss: string; aud: `ext:${RetailerCode}`;       // one token per retailer
  sub: string;                                   // Shopper_ID, pairwise per retailer and epoch
  iat: number; nbf: number; exp: number; jti: string;
  profile_ver: number;                           // strictly increasing per patient
  cnf?: { jkt: string };                         // DPoP key thumbprint of the device
  ctr: {
    per_100g_flags: Array<{ n: NutrientKey; gt?: number; lt?: number; action: 'warn' | 'confirm' | 'hide' }>;
    per_day?: Partial<Record<NutrientKey, number>>;   // exposure engine only; item evaluation ignores it
    exclude?: AllergenCode[];                    // hard exclusions
    nova4_cap_pct?: number; household?: { adult_eq: number };
  };
  policy: { block_mode: 'warn_only' | 'confirm' | 'hide'; min_conf: 'verified'; reason_classes: ReasonClass[] };
  consent: { ref: string; purposes: Array<'C1' | 'C2' | 'C3' | 'C4'> };   // receipt id echoed by telemetry
}
```

Defects fixed while building it (X-05): `deriveTenantAlias` receives a secret from the KMS (no hard-coded `CAD_TENANT_ROUTING_SALT_V1` fallback; the function throws if the secret is missing); `mintToken` awaits `signer.sign()`; the verifier resolves `kid` from a signed key manifest (`GET /v1/keys`) and pins `alg` per `typ`; token size capped at 4 KB.

**Allergen vocabulary (G-09).** Add `Safety.Allergens: AllergenCode[] | null` to the product schema, where `null` means unknown and is never read as "none". Start with the Codex list plus the EU additions (cereals containing gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, tree nuts, sulphites, celery, mustard, sesame, lupin, molluscs). The field is populated from ingredient statements by the curation pipeline and ships as a catalogue schema version bump (additive: older clients ignore it). Until a record has the field, an allergen exclusion produces the caution in 2.1, not silence.

**Failure modes.** Compile failure keeps the previous token (monotonic `profile_ver`); mint failure returns 503 with `Retry-After`; a claim outside the allowlist fails the mint and raises an alert.

**Integration contract.**

```ts
// POST /v1/token   headers: DPoP proof, Authorization: Bearer <session>
// body: { retailer: RetailerCode }       -> 200 { token: string; exp: number; profile_ver: number }
// GET  /v1/keys                          -> 200 signed key manifest { keys: [{ kid, alg: 'EdDSA', x }], issued_at, sig }
// GET  /v1/revocations?since=<epoch>     -> 200 signed { jtis: string[], issued_at, sig }
```

**Instrumentation.** `token_minted`, `token_mint_ms`, `token_verify_fail{reason}`, `token_age_s` at use. **Tests.** T-01, T-02; claim-scrubber test (a claim named `diabetes_type2` fails the mint); size-cap test; verifier fuzz on header and payload.

### 3.2 N2: observability SDK (device)

**Responsibility.** Make the set points measurable without leaving a footprint: per-batch latency marks, counters and histograms, a bounded ring buffer of spans, and a 15-minute aggregate upload. It never records SKUs, nutrient values, URLs or condition names.

**Design.** `obs/obs.js`, loaded by both the content script and the service worker.

- API: `obs.mark(name)`, `obs.measure(name, a, b)`, `obs.count(name, labels?)`, `obs.hist(name, value)`, `obs.span(name, fn)`. Every call is wrapped so it cannot throw.
- Correlation: a ULID `trace_id` is minted per scanner batch and carried in the RPC message (`{ trace: { id, span } }`), so the content-script and worker spans join. Traces stay local in a ring buffer of the last 200 spans and leave the device only in an explicit diagnostics bundle.
- Histograms use fixed buckets (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000 ms), 12 counters per metric.
- Metrics: `badge_ms` (flush to paint), `nme_ms`, `score_ms`, `sw_rpc_ms`; counters `neutral_fallback`, `selector_fail`, `sw_rpc_fail`, `eval_error`, `catalog_integrity_failure`, `token_verify_fail`, `telemetry_dropped`.
- Logs: `log.warn(code, fields)` writes structured records to the ring buffer; `console.*` is allowed only in dev builds (the current 39 calls are migrated).

```ts
interface ObsMetricPayload {                   // type: 'obs_metric', uploaded as a TelemetryEvent (2.8)
  window_start: string; window_s: number;
  hist: Record<'badge_ms' | 'nme_ms' | 'score_ms' | 'sw_rpc_ms', number[]>;      // 12 bucket counts
  counters: Record<string, number>;
  ext_ver: string; chrome_major: number;      // no URLs, no SKUs, no nutrient names (schema forbids extra keys)
}
```

| Parameter | Value |
| --- | --- |
| SDK cost | ≤ 20 µs per call; ≤ 1.2 ms per batch in total (1% of the 120 ms goal) |
| Memory | Ring buffer 200 spans; 4 histograms × 12 buckets |
| Upload | One `obs_metric` event per 15 minutes, only when the queue flushes |

> **Open decision D-2.** Whether anonymous performance counters need a consent receipt is a legal question for counsel. Until it is answered they are gated on the same consent as telemetry (C2), so a shopper who declines sends nothing, at the cost of losing their latency signal.

**Failure handling.** Overflow drops the oldest span; a thrown error is swallowed and counted. **Verification.** Micro-benchmark of the overhead budget; a schema test that rejects a metric labelled with a SKU; T-03 harness reading the same marks over 100 fixture pages; histogram merge correctness test.

### 3.3 N3: telemetry gateway and bronze ingest

**Responsibility and boundaries.** Accept batches from devices, authenticate, validate, check consent, de-duplicate, flag outliers, and append to bronze through a bounded queue. It never reads clinical data and writes only inside the in-region gateway and analytics zones.

**Design.** Stateless service behind the load balancer. Per request: (1) verify the DPoP-bound profile token and the proof, with a shared replay cache (Redis or Postgres, not an in-process Set, closing X-06); (2) validate each event against the JSON Schema registry by `schema` version; (3) check consent with `hasActiveConsent(consent_ref, purpose)` (3.9), cache TTL 30 s with push invalidation on revocation; (4) de-duplicate on `event_id`; (5) apply outlier rules (clock skew above 24 hours flagged, above 20 events per second per device dropped, payload size cap); (6) append to the bronze queue; (7) reply per event.

```sql
CREATE TABLE telemetry_event_index (            -- dedupe gate; a partitioned table cannot hold a global PK
  event_id char(26) PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE telemetry_bronze (
  event_id char(26) NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), occurred_at timestamptz NOT NULL,
  shopper_ref text NOT NULL, retailer text NOT NULL, type text NOT NULL, consent_ref text NOT NULL,
  profile_ver int, client_seq bigint NOT NULL, schema_ver text NOT NULL, payload jsonb NOT NULL,
  flags text[] NOT NULL DEFAULT '{}'
) PARTITION BY RANGE (received_at);             -- daily partitions; REVOKE UPDATE, DELETE; trigger raises on both
-- gate: INSERT INTO telemetry_event_index ... ON CONFLICT DO NOTHING RETURNING event_id   (same transaction as the bronze insert)
-- index rows older than 7 days are purged; bronze partitions are dropped per retention policy
```

```ts
interface BatchResponse {
  batch_id: string;
  results: Array<{ event_id: string; status: 'accepted' | 'duplicate' | 'rejected'; code?: 'SCHEMA' | 'CONSENT' | 'SKEW' | 'RATE' | 'TOO_LARGE' }>;
}
// POST /v1/telemetry/batch   headers: Authorization: DPoP <token>, DPoP: <proof>, Idempotency-Key: <sha256 of sorted event_ids>
// 429 and 503 carry Retry-After computed from queue depth; they mean "keep the events queued", never "drop".
```

**Idempotency.** `event_id` is the unit; the batch `Idempotency-Key` short-circuits identical retries for 24 hours. **Failure modes.** Database or queue down: 503 and the device keeps events. Consent store unreachable: fail closed with 503, not `CONSENT`, so events are not dropped by mistake. A `CONSENT` rejection tells the device to drop and purge. **Backpressure.** Queue depth above 5,000 events for 2 minutes scales workers (3.4) and then answers 429 with a Retry-After proportional to depth.

| Parameter | Value |
| --- | --- |
| Ack latency | P99 < 300 ms; availability 99.5% |
| Batch limits | ≤ 100 events, ≤ 256 KB |
| Dedupe window | 7 days (device dead-letter TTL) |
| Consent cache | TTL 30 s plus push invalidation (revocation ≤ 1 min) |
| Shadow mode | `X-NS-Shadow: 1` writes to `telemetry_shadow`, feeds nothing |

**Instrumentation.** RED metrics per endpoint, rejects by `code`, queue depth, lateness histogram (`received_at - occurred_at`), duplicate ratio, replay-cache hit rate. **Tests.** Replay a batch 3 times (one accepted, then duplicates); schema fuzz; consent-revocation race (event arrives 5 s after revoke: rejected); load test at 10× expected pilot rate with the queue near its bound; append-only test (UPDATE and DELETE fail).

### 3.4 N4: metrics, SLOs and the closed control loop

**Responsibility.** Turn the set points into alerts and bounded automatic actions. Stack, all in-region to respect residency: OpenTelemetry Collector, Prometheus, Loki for structured JSON logs carrying `trace_id`, Tempo or Jaeger for traces, Grafana and Alertmanager. No SaaS endpoint receives health-adjacent data.

| SLI | SLO | Source |
| --- | --- | --- |
| Badge latency | 95% of batches ≤ 120 ms and 99.9% ≤ 200 ms, 28-day window | Device `badge_ms` histogram |
| Neutral-fallback rate | ≤ 2% of items on supported pages | Device counters |
| Gateway ack latency | P99 < 300 ms; availability 99.5% | Gateway RED metrics |
| Telemetry freshness | P95 lateness < 24 h; conformance ≥ 99.5%; duplicates < 1% | Bronze checks |
| Token exchange | P95 < 300 ms | Token service |
| Revocation | Gateway rejects at once; list within 1 min; device stop ≤ 5 min | Synthetic probe |
| Catalogue integrity | Failure rate on devices ≤ 0.1% | `catalog_integrity_failure` |
| Selector health | Failure ≤ 2% per retailer per night | Canary (3.8) |
| Audit anchoring | Signed root within 60 s; tamper alert ≤ 5 min | Audit service (3.7) |
| BFF | Added latency P95 ≤ 25 ms; 5xx ≤ 0.5% | BFF RED metrics |

Alerting uses multi-window burn rates (the Google SRE Workbook pattern): page at a burn of 14.4 over both 1 hour and 5 minutes, page at 6 over 6 hours and 30 minutes, ticket at 1 over 3 days. Unresolved safety events are not an SLO; any open one pages and freezes flag changes.

| Signal | Threshold | Automatic action |
| --- | --- | --- |
| Gateway queue depth | > 5,000 events for 2 min | Scale workers; then 429 with `Retry-After` |
| Gateway CPU | > 70% for 5 min | Horizontal scale +1, maximum 6 |
| Device event rate | > 20 per second | Drop at gateway, `RATE` code, counter |
| Fast burn (14.4×) | Both windows | Page; freeze flag changes; revert last flag step |
| Canary breach | Rollback triggers in 5.3 | Flip the flag back one cohort step |
| Catalogue integrity | > 0.1% of devices | Mark the release `held` at the publisher |
| Selector failure | > 2% for a retailer | Set that retailer's `killSwitch`; neutral badges; page |

**Controller.** A small service reads Prometheus and may only write to the signed flag manifest (3.8) through an allow-list of flag names. It cannot change scoring constants, thresholds or policy. Hysteresis and a 15-minute cool-down prevent flapping; if the controller is silent for 10 minutes an alert fires and the system stays in its last state (fail static). Per-shopper and per-IP token buckets (20 events per second, burst 100) and a BFF per-user limit of 20 requests per second are the other actuators. **Tests.** Fire drills in staging: induce a latency regression and check the revert within one cool-down; kill the controller and check the alert; attempt a flag outside the allow-list (rejected).

### 3.5 N5: BFF with policy decision point, field masking and capability service (G-05; F-01 to F-04, X-01, X-03, X-04)

**Responsibility and boundaries.** The only service the CAD browser (and the side panel) talks to. It owns authentication, authorisation, field masking, capability computation, audit emission and trace propagation. PostgREST and the database are not reachable from the browser. Tokens never reach browser JavaScript. Residency: deployed in the same in-region cluster as the clinical zone.

> **ADR-4: browser authentication model** **Context.** `AuthContext.signIn` uses the password grant from the SPA, keeps access and refresh tokens in `sessionStorage`, decodes role and tenant from an unverified JWT, and treats MFA as a client-side flag (F-01, F-02). **Research.** The IETF OAuth 2.0 for Browser-Based Apps draft says the resource owner password credentials grant must not be used, and describes the backend-for-frontend (BFF) proxy as the most secure option because tokens stay on the server and the browser holds only a cookie. It also warns that `SameSite` alone is not a sufficient CSRF defence. **Decision.** The BFF is a confidential OIDC client using Authorization Code with PKCE against Keycloak. The browser holds one cookie, `__Host-ns_sid` (HttpOnly, Secure, `SameSite=Strict`, path `/`). Unsafe methods require a custom header `X-NS-CSRF` bound to the session plus an `Origin` check. Tokens live in an encrypted server-side session store; access token 10 minutes, refresh-token rotation, idle timeout 15 minutes, absolute 8 hours. MFA is enforced in Keycloak (required action) and again in the BFF: every non-patient role needs `acr` level 2 or higher and an `amr` containing `otp` or `webauthn`. Rejected: ROPC (prohibited); SPA-held tokens with PKCE (still exposed to XSS, acceptable only as a stop-gap if the BFF slips). **Residual risk.** The session store becomes a high-value target. Mitigations: envelope encryption of stored tokens with `field-encryption.ts`, short lifetimes, rotation on every refresh, and per-session revocation through the denylist (3.9).

**X-01: verify before trust.** `claims.ts` is split. `claimsFromVerifiedToken(jwt, jwks)` checks signature (JWKS cached, refetched once per unknown `kid` with rate limiting), `iss`, `aud`, `exp` and `nbf`, and is the only constructor of server-side claims. The current decoder is renamed `unsafeDecodeClaimsForUi`, kept only for cosmetic UI hints, and banned in `bff/` and `supabase/functions` by an ESLint restriction. `requireRole`, `decide` and every handler accept a branded type, so unverified claims no longer compile:

```ts
declare const verified: unique symbol;
export type VerifiedClaims = CanonicalClaims & { readonly [verified]: true };
export function requireRole(req: Request, claims: VerifiedClaims, allowed: Role[]): Role { /* ... */ }
```

> **ADR-1: where the policy decision point runs, and with what** **Context.** `shared/authz.ts` `decide()` is an in-process, ordered, deny-first ABAC engine with obligations and tests. The concern is policy-as-code latency at the BFF and whether to replace it with OPA or Cedar. The Clinical report names OPA or Cedar as examples, not as requirements. **Research.** Embedded policy engines evaluate small policy sets in microseconds to low milliseconds; a remote policy server adds a network hop that vendor sources put at one to five milliseconds. Cedar cannot fetch data during evaluation, so attributes must be loaded first, which makes attribute loading, not rule evaluation, the dominant cost in any engine. These figures come from vendor and secondary sources and are order-of-magnitude only; Phase 2 measures them on this workload. In `decide()` the real cost is up to five sequential awaits (denylist, membership, relationship, emergency access, consent). **Options compared.** (A) Keep `authz.ts` in-process, fix X-03, parallelise and cache attribute loads. (B) OPA as sidecar or WASM. (C) Cedar via WASM or a service. **Decision.** A. Independent lookups run under `Promise.all`; a request-scoped memo removes repeats; caches use a 30-second TTL with push invalidation so the 1-minute revocation set point still holds. Budget: PDP P95 ≤ 5 ms with warm caches, BFF added latency P95 ≤ 25 ms. Rejected for now: B and C add a second policy language and a network or runtime boundary while the TypeScript engine is already tested and shared with the extension build. Their real benefit (policies authored or analysed outside code) is not yet needed. **Residual risk.** TypeScript policy has no formal analysis. Mitigation: an exhaustive decision-table test generated from `PERMISSIONS` (role × action × resource class × consent × relationship × acr) and a default-deny property test; a differential harness that replays logged decisions through a Cedar port is added if policy authorship moves to non-engineers.

**PDP fixes (X-03, X-04).**

1. `createPdp(adapters)` throws if `members` or `denylist` is missing (fail closed at start-up, not open at request time).
2. The policy enforcement point loads resource attributes by ID from the data layer (`loadResource(type, id)` returns `tenantId`, `patientId`, `dataClass`); handlers cannot build a `Resource` from request input. `decide()` throws if `tenantId` is absent for PHI classes.
3. `acr` becomes an enum `AcrLevel = 0 | 1 | 2 | 3` mapped from Keycloak's configured values at claim construction; unknown strings map to 0. `Subject.acr` is that enum, so the `NaN < 2` bypass disappears.
4. `STEP_UP` gains `accounts:create`, `consent_register:update`, `clinical_records:update` and `tenants:*`.
5. `PERMISSIONS` gains a `health_modes` resource: `propose` for `tenant_admin`, `approve` and `update` for `writing_clinician` only (P2), and no clinical write for `super_admin` (break-glass stays dual-controlled).

**Field masking.** `bff/masks/<resource>.ts` declares, per role, an allow-list of fields; everything else is dropped before serialisation (default deny). DTO types are distinct per role. A schema-driven test fails the build if a field exists in a DTO type without an allow or deny declaration, so a new column cannot leak by omission. Retailer-facing and commercial outputs additionally pass the k ≥ 20 small-cell rule server-side (3.9).

**Capability service.** `GET /v1/capabilities` evaluates the PDP over a catalogue of `(action, resourceClass)` pairs for the current subject and returns `{ caps, caps_hash, step_up_required, tenant }`. Per-record buttons use `allowed_actions` embedded in each resource DTO, so the UI never infers a permission from a role name.

```ts
interface CapabilitiesResponse {
  caps: string[];                       // e.g. 'patients.targets.read', 'patients.targets.write', 'audit.verify'
  caps_hash: string;                    // SHA-256 over sorted caps; drives cache partitioning (4.4)
  step_up_required: string[];           // capabilities that need a fresh acr 3 challenge
  tenant: { id: string; label: string };
}
interface ProblemDetails {              // RFC 9457; the error mapping per role is in 4.3
  type: string; title: string; status: number; code: string; trace_id: string; retry_after_s?: number;
}
```

**Defence in depth.** The BFF calls the data layer with a short-lived internal token it mints (`aud: db`, 60 seconds, verified claims copied in), so database row-level security stays an independent second layer rather than being bypassed by a service credential.

**Failure modes.** PDP error or timeout: deny and return 503, never allow. JWKS unreachable: serve from cache up to 1 hour stale, then fail closed. Session store down: 503. Audit writer down: reads of PHI classes and all clinical writes fail (3.7). **Instrumentation.** RED metrics per route, `pdp_ms`, `pdp_deny{reason}`, `jwks_refetch`, `session_active`, trace propagation by `traceparent`, and a log scrubber test proving no PHI reaches logs.

**Tests.** Forged JWTs (`alg: none`, wrong `iss`, wrong `aud`, expired) all return 401; a tenant A user requesting a tenant B resource ID gets 404 (no enumeration signal); `acr: "loa1"` on a step-up action gets 403 with a challenge; the masking coverage test; CSRF tests (missing header, wrong origin); decision-table and default-deny property tests; load test at 200 requests per second with added latency P95 ≤ 25 ms. **Rollback.** The BFF ships in pass-through plus audit mode first (5.1), so turning it off returns the browser to the old path.

### 3.6 N6: real-time hub (G-06; F-07)

**Responsibility.** Deliver role-scoped, ordered, resumable change events to CAD views: patient alerts, link changes, target updates, consent changes, system status and session revocation. Commands stay on REST.

> **ADR-2: SSE or WebSockets for CAD push** **Context.** The CAD needs server-to-client updates; commands are ordinary requests. Clinics use variable mobile and shared networks. Authentication is by cookie (ADR-4). **Research.** Server-Sent Events are one-way over plain HTTP with built-in browser reconnection and `Last-Event-ID` resume; they pass through ordinary cookie auth and middleware. On HTTP/1.1 browsers allow only about six connections per origin, which HTTP/2 multiplexing removes. WebSockets are bidirectional but leave reconnection, resume and sequencing to the application, need sticky or specialised infrastructure, and add the cross-site WebSocket hijacking class. The native `EventSource` cannot set custom request headers, so cookie authentication or a fetch-based client is required. **Options.** SSE plus REST; WebSockets; long polling. **Decision.** SSE over HTTP/2 with application-level sequence IDs. A `GET /v1/sync?since=<id>` polling fallback covers networks that buffer or block streams. Rejected: WebSockets (no client-to-server streaming requirement; resume would be hand-built; larger attack surface); long polling as the primary (latency and cost), kept only as the fallback. **Residual risk.** Intermediaries that buffer responses. Mitigations: `X-Accel-Buffering: no`, a heartbeat comment every 15 seconds, and client fallback to 10-second polling after two failed reconnects.

**Design.**

- **Sequencing.** Each scope (`tenant`, or `tenant + patient_ref`) has a gapless sequence. The SSE `id` is `${epoch}:${seq}`. Events live in a replay buffer (Redis Streams or an append table with a trimmed window) of 10 minutes or 5,000 events per scope.
- **Resume.** On reconnect with `Last-Event-ID`, the hub replays from the buffer; if the id is older than the window it sends `resync_required` and the client fetches `GET /v1/sync/snapshot`.
- **Authorisation at send time.** Every published event carries an `audience`; per connection the hub checks capabilities and, for patient-scoped events, relationship and consent through the PDP. A `link.changed` or `consent.changed` event re-evaluates open scopes and emits `access_revoked{scope}` and stops delivery for that scope.
- **Backpressure.** Each connection has a bounded queue of 256 events. When it fills, `patient.alert` events are coalesced by `patient_ref` (latest wins); if the client still lags, the hub sends `resync_required` and closes. One stream per browser profile: tabs share it through a `BroadcastChannel` leader election.

| Parameter | Value |
| --- | --- |
| Heartbeat | 15 s |
| Client reconnect | Full jitter, 1 s to 30 s cap; polling fallback after 2 failures at 10 s |
| Replay window | 10 min or 5,000 events per scope |
| Per-connection queue | 256 events, coalesce then resync |
| Delivery latency | P95 < 2 s from commit (proposed target; none is set in the reports) |

**Failure modes and idempotency.** A hub node dies: clients reconnect with `Last-Event-ID` to another node reading the shared buffer. Buffer store down: the next connection receives `resync_required`. Events are idempotent by `id`; clients ignore any `seq` they have already applied. **Instrumentation.** `sse_connections`, `sse_lag_ms`, `resync_rate`, `coalesced_events`, `access_revoked`. **Tests.** Kill a node mid-stream (no gap, no duplicate applied); drop 1,000 events (resync path); revoke access mid-stream (delivery stops within one PDP cache TTL); slow-client test (bounded memory); 500 concurrent streams soak.

### 3.7 N7: audit writer and verifier (G-07; F-05)

**Responsibility.** Make every PDP obligation of type `AUDIT` durable and tamper-evident, and let auditors verify it without trusting the application.

**Design.** Single writer per tenant partition (an advisory lock keyed by tenant keeps chain order). Each entry:

```ts
interface AuditEntry {
  seq: number; ts: string; actor_ref: string; action: string; resource_ref: string;
  decision: 'permit' | 'deny'; trace_id: string; obj_hash: string;      // hash of the touched object, never the object
  prev_hash: string; row_hash: string;                                   // row_hash = SHA-256(canonical(entry without row_hash) || prev_hash)
}
```

Every 60 seconds the writer builds a Merkle tree over the new `row_hash` values (domain-separated leaf and node hashing as in RFC 6962 and RFC 9162), signs the root with the audit Ed25519 key held in Vault, stores it in `audit_roots`, and copies it to an object-lock (WORM) bucket.

> **ADR-7: how audit roots are anchored** **Context.** A database administrator who controls the table could rewrite entries and recompute the chain unless roots are pinned somewhere they cannot reach. **Research.** RFC 9162 defines Merkle inclusion and consistency proofs for append-only logs; RFC 3161 defines trusted timestamping, where an external authority countersigns a hash with a time. **Options.** (A) Signed roots in WORM storage only. (B) A plus a daily RFC 3161 timestamp of the day's last root. (C) A plus public blockchain anchoring. **Decision.** A and B. The timestamp request carries a 32-byte hash, no personal data, so residency is respected; counsel confirms. Rejected: C (cost and operational surface with no additional guarantee over B for this threat model). **Residual risk.** Compromise of the audit signing key before the next timestamp: mitigated by key custody in Vault, 90-day rotation and dual control for the key (no single operator).

**Verifier.** `GET /v1/audit/verify?from=&to=` recomputes the chain and every Merkle root and returns `{ status: 'verified' | 'failed', checked, first_bad_seq?, roots_verified }`. The CAD `AuditLogView` shows a tri-state (`verified`, `failed`, `unavailable`) and never defaults to verified. It also recomputes `row_hash` for the visible page in the browser with WebCrypto and checks an inclusion proof against the signed root using a pinned audit public key, which fixes F-05 (the current `verifyHashChain` only compares stored values).

**Failure modes.** Writer unavailable: PHI reads and clinical writes fail closed; other reads buffer in a local durable queue (bounded 10,000) and are written on recovery with a `delayed` flag. A verifier mismatch pages within 5 minutes (T-10). **Set points.** Root every 60 s; verifier job every 60 s over the new segment and a full pass nightly; writer capacity 500 entries per second per tenant. **Tests.** T-10 (alter one stored entry: failed within 5 minutes and alert); delete and reorder tests; forged root signature; UI test that a fetch error renders `unavailable`, never `verified`; writer crash mid-batch (no gap, chain resumes).

### 3.8 N8: signed selector and flag manifests, and the canary (G-08)

**Responsibility.** Publish two small signed objects, the adapter spec set and the flag manifest, and run a nightly canary against the live retailer pages. Flags only choose between code paths already shipped in the extension bundle. They are configuration data, not remote code, which is what Chrome's Manifest V3 policy allows.

```ts
interface FlagManifest {
  typ: 'ns-flags+json'; seq: number; issued_at: string;        // seq strictly increasing (anti-rollback)
  flags: Record<string, { enabled: boolean; cohort_pct: number; allow_ids?: string[]; min_ext_ver?: string }>;
  kid: string; sig: string;                                    // Ed25519 over the canonical body
}
const bucket = (installId: string, flag: string) => fnv1a32(installId + ':' + flag) % 100;
const on = (f: Flag, installId: string, name: string) => f.enabled && (f.allow_ids?.includes(installId) || bucket(installId, name) < f.cohort_pct);
```

`installId` is a random UUID created at install, stored locally, and never linked to the Shopper\_ID. Buckets are independent per flag and stable across sessions. The device polls the flag manifest by alarm every 5 minutes (about 2 KB, conditional request) and the spec set every 6 hours. A manifest with a bad signature, a lower `seq`, or a future `issued_at` is ignored and counted (`flag_manifest_invalid`); on any failure the device keeps its last good manifest (fail static). Two global switches exist: `ns.global.neutral` forces neutral badges everywhere, and each retailer spec carries its own `killSwitch`.

**Canary.** A Playwright job runs nightly and after each adapter release from an in-region runner against 30 fixed pages per retailer (search, category, product, cart). It records selector failure ratio, tile count parity with the previous run, and price plausibility, and pushes the results to Prometheus; thresholds are those in 3.4. It runs at a low request rate and honours each retailer's terms and robots rules (counsel confirms the permitted rate before the pilot).

| Parameter | Value |
| --- | --- |
| Flag poll | 5 min; manifest ≤ 2 KB |
| Spec poll | 6 h plus jitter |
| Kill-switch propagation | ≤ 5 min |
| Canary | Nightly plus on release; 30 pages per retailer; alert above 2% selector failure |

**Failure modes.** Publisher outage: devices keep last good state. Compromised publisher key: root keys are pinned in the extension and rotated by shipping a new bundle; flags cannot touch scoring constants or policy values. **Tests.** Signature, `seq` rollback and future-date rejection; cohort distribution test (1,000,000 synthetic installs land within 1% of the requested percentage); kill-switch end-to-end test on a fixture page; canary dry run against recorded HTML.

### 3.9 N9: consent, revocation and crypto-shred hooks (G-10; X-08, X-11)

**Responsibility.** Make consent a server-side receipt that every enforcement point checks, make revocation reach every holder of a credential within the set points, and make erasure real.

1. **Purposes.** `consent.ts` purposes are replaced by the four in Clinical §5.4: C1 clinical programme, C2 retail telemetry, C3 payer sharing per named insurer (expires after 12 months \[A\]), C4 aggregate analytics. Purposes are not hierarchical. `evaluatePatientVisibility` requires an exact purpose match, so the `clinician_link` escalation (X-08) is removed. A clinician viewing purchase timelines needs C1 and C2; the diary needs C1; the insurer view needs C3 for that insurer.
2. **Receipts.** `consent_register` rows hold `purpose`, `scope` (insurer ID for C3), `notice_hash`, `granted_at`, `expires_at`, `revoked_at`. The device stores only the `consent_ref` inside the profile token. The local `termsAccepted` and `privacyAccepted` booleans in `storage.js` become display hints; they authorise nothing (X-11).
3. **Checks.** `hasActiveConsent(consent_ref, purpose)` is called at the token service (refuses to mint without active C1 and C2), the telemetry gateway, every ETL job as a row-level filter, every export job and every dashboard read, through the PDP with default deny.
4. **Revocation distribution.** Gateway: cache TTL 30 s plus push invalidation (Redis pub/sub on `consent.revoked`), so events are rejected at once. Device: `GET /v1/revocations?since=` every 5 minutes via alarm, plus the token's `jti`; on a hit it purges the telemetry queue and policy (2.7, 2.8). Sessions: a `sid` denylist with TTL equal to the token lifetime, and an SSE `session.revoked` event that closes streams. Analytics: the next run excludes the patient (24 hours); derived data is purged within 30 days by a cascade job (T-08).
5. **k-anonymity.** Retailer-facing and commercial aggregates use `K_RETAILER_OUTPUT = 20` with cell suppression; the default of 5 in `evaluateCohortSuppression` is removed. The k used to generalise token constraints in `applyCohortGate` stays a named, separate constant; the reports do not fix it, so its value is decision D-3 for the privacy lead.
6. **Crypto-shred (X-08).** `cryptoShredPatient(patientRef)` becomes a real operation: destroy the wrapped per-patient DEK (`key-wrapper.ts`) and its Vault key version, delete the blind-index rows (they allow linkage), write an audit entry, and queue the cascade purge. The pseudonym is `HMAC(secret, patientRef)` truncated; `Math.random()` and the four-character leak are deleted.

```ts
interface ShredResult { shredded_at: string; dek_id: string; objects_unreadable: number; cascade_job_id: string }
```

**Failure modes.** Consent store unreachable: deny and return 503 to the caller; never allow by default. Shred partially fails: the operation is idempotent and resumes from the audit entry. **Tests.** T-08 (revoke C2 in a live session: gateway rejects at once, device stops within 5 minutes, purge within 30 days, audit entry present); purpose-escalation test (C1 does not open the timeline); k boundary (19 suppressed, 20 released); shred test (every encrypted field unreadable afterwards, including from a restored backup), idempotent re-run.

### 3.10 N10: contract-only components

These appear in the reports but in no archive. They are specified here only at their boundary with the existing code, so that the refactoring above has something concrete to integrate with. Build them against `shared/` and treat the contracts as proposals to confirm.

| Component | Contract with existing code | Set point |
| --- | --- | --- |
| Profile Compiler | `compile(clinicalTargets, catalogueSchemaVer) -> { ctr, policy, profile_ver }`; deterministic, lints out condition names, never lowers `profile_ver`; emits `profile.compiled` | < 1 s |
| Token Exchange | `POST /v1/token` (3.1); refuses without active C1 and C2; DPoP-bound; per-patient rate limit; audited | < 300 ms |
| Clinical Ingestion Adapter | `POST /v1/clinical/bundles` accepts the existing `patient-export.ts` and `target-sync.ts` bundle shapes; validates and quarantines; idempotent on `bundle_id` | < 2 s per bundle |
| Adherence engine | Nightly batch in the enclave; joins `telemetry_bronze` to the catalogue by `productId` at the recorded `catalogue` version; filters by C1 and C2 per row | Pilot-scale batch < 1 h |

```ts
interface AdherenceWeek {                  // idempotent on (patient_ref, week, versions)
  patient_ref: string; week: string;       // ISO week
  coverage_c: number;                      // scored spend / total spend; < 0.70 means "insufficient coverage", no adherence number
  adherence_a: number | null;
  variance: Partial<Record<NutrientKey, number>>;
  unscored_share: number; n_orders: number;
  versions: { scoring: string; catalogue: string; profile: number };
}
```

Rules carried over from the Clinical report: quantity is the last known quantity, never a sum; an unscored item is excluded from the adherence numerator and counted in the unscored share (which is why 2.3 keeps unscored rows); nothing from this engine goes to a retailer except as a T5 aggregate.

## Section 4: Downstream Dependency & Frontend Adaptation Plan

The seven roles (`super_admin`, `tenant_admin`, `writing_clinician`, `viewing_dietician`, `compliance_auditor`, `commercial_stakeholder`, `patient`), the resource classes (`PHI1`, `PHI2`, `ADMIN`, `COMMERCIAL`, `AUDIT`, `AUDIT_META`) and the resource types in `shared/authz.ts` are kept. What changes is who decides: the BFF decides, and the browser is told.

### 4.1 RBAC/ABAC and capability mapping

**The two definitions already disagree.** Comparing `ROLE_NAVIGATION` in `cad/navigation.ts` with `PERMISSIONS` in `shared/authz.ts`: 11 of the 20 role-to-screen grants (excluding the universal Overview and Settings) have no matching permission. Examples: `tenant_admin` sees Targets, Modes, Audit and Billing, yet the policy grants none of those resources; `viewing_dietician` sees Consent but has no `consent_register:read`; `super_admin` sees Audit and Consent, which it cannot read. Two of the screens (`modes`, `billing`) have no resource at all. Deriving navigation from capabilities removes the whole class.

**Target capability catalogue** (replaces role comparisons in views; derived by the PDP, 3.5). Deltas from today's `PERMISSIONS` are marked.

| Capability | Roles | ABAC conditions | Step-up |
| --- | --- | --- | --- |
| `patients.directory.read` | `writing_clinician`, `viewing_dietician`, `tenant_admin` (listing fields only), `patient` (self) | Same tenant; clinicians limited to their care-team links | No |
| `patients.targets.read` | `writing_clinician`, `viewing_dietician` | Same tenant, care-team link, active C1. `super_admin` read removed (delta, D-4) | No |
| `patients.targets.write` | `writing_clinician` only | Same tenant, care-team link, active C1, licence verified. `super_admin` never (delta) | Yes |
| `modes.read` | `writing_clinician`, `viewing_dietician`, `tenant_admin` | Same tenant. New resource `health_modes` (delta) | No |
| `modes.propose` | `tenant_admin` | Same tenant (delta, P2) | No |
| `modes.approve` | `writing_clinician` | Same tenant, licence verified (delta) | Yes |
| `consent.status.read` | `writing_clinician`, `viewing_dietician` (status only, delta), `tenant_admin` (counts only), `compliance_auditor` | Care-team link for patient-level status | No |
| `consent.record` | `writing_clinician` (on-site capture with patient attestation), `patient` (self) | Same tenant; purpose in C1–C4 | Yes (clinician) |
| `accounts.provision` | `tenant_admin` (staff roles per `PROVISIONABLE_ROLES`), `super_admin` (tenant admins only), `writing_clinician` (patients) | Same tenant | Yes (added) |
| `audit.read` | `compliance_auditor` (`AUDIT`); `tenant_admin`, `super_admin` (`AUDIT_META`, counts only) | Same tenant for tenant roles | No |
| `audit.verify` | `compliance_auditor` | Any tenant in scope | No |
| `billing.read` | `tenant_admin`, `super_admin` | New resource `billing` (delta) | No |
| `platform.tenants.manage` | `super_admin` | Dual control for deletion | Yes |
| `commercial.aggregates.read` | `commercial_stakeholder`, `compliance_auditor`, `tenant_admin`, `super_admin` | T5 only, k ≥ 20 | No |
| `catalogue.manage` | `commercial_stakeholder` | Own catalogue | No |

Break-glass (`emergency` in `authz.ts`) stays a separate, dual-controlled flow and is not granted by any role.

**Environment and subject attributes the PDP evaluates:** `role`, `tenantId`, `acr` as `AcrLevel`, `amr`, licence status (read from the database per request, not from the token), care-team links, consent state by purpose, step-up freshness (acr 3 within the last 10 minutes), `sid` not on the denylist, and the resource's `class`, `tenantId` and `patientId` loaded by ID in the enforcement point.

**Claims.** All claims below exist only inside the BFF session; the browser never sees a token.

| Claim | Rule |
| --- | --- |
| `iss`, `aud` (`ns-bff`), `exp` (≤ 10 min), `nbf`, `iat`, `jti` | Verified against JWKS on every request (X-01) |
| `sub`, `sid` | `sid` checked against the denylist on every request |
| `tid` (tenant UUID), `app_role` | Taken only from the verified token; the zero-UUID default in the client is removed |
| `acr`, `amr` | Mapped to `AcrLevel`; unknown becomes 0; non-patient roles need level 2 and `otp` or `webauthn` |

`claims.schema.json` gains `iss`, `aud`, `exp`, `nbf`, `jti` and `amr`, and `acr` becomes an enum, so the schema and the verified constructor agree.

**BFF field masks** (default deny; a field not listed is dropped). "Linked" means care-team link plus active consent for the purpose.

| Data | `writing_clinician` | `viewing_dietician` | `tenant_admin` | `compliance_auditor` | `commercial_stakeholder` | `patient` |
| --- | --- | --- | --- | --- | --- | --- |
| Identity (name, phone) | Linked patients | Name only, linked | Directory listing | Pseudonym ref | None | Own |
| Targets and bundles | Linked, full | Linked, read | None | None | None | Own |
| Clinical notes and advice | Linked, full | Advice only | None | None | None | Own advice |
| Purchase timeline | Linked, C1 and C2 | Linked, C1 and C2 | None | None | T5 aggregates only | Own |
| Consent state | Linked, by purpose | Linked, status | Counts | Receipts, no identity | None | Own |
| Audit entries | None | None | Meta counts | Full, pseudonymised actors | None | Own access log |

**Frontend capability flags.** The CAD fetches `GET /v1/capabilities` once per session and on every `caps_hash` change.

```tsx
const { can, nav } = useCapabilities();          // cached by caps_hash; nav comes from the server
{can('patients.targets.write') && <EditTargets patient={p} />}   // per-record buttons use p.allowed_actions
```

Codemod and guard rails: the 37 `claims.role ===` comparisons in 12 files become `can(...)` calls; an ESLint `no-restricted-syntax` rule forbids reading `claims.role` outside `cad/auth/`; `ROLE_NAVIGATION` survives only as a development fallback behind `import.meta.env.DEV`; a contract test asserts that every capability a view checks exists in the catalogue.

**Role overlap fixes.** `super_admin` is removed from `isWritingClinician` in `PatientTargetsView` and `PatientLinkingConsentView` (X-04); `HealthModesView` shows Propose to `tenant_admin` and Approve to `writing_clinician`; the dietician Consent screen becomes the status-only view; Billing and Modes get resources so nothing in the UI lacks a policy.

**Tests.** The generated decision table (3.5); a navigation parity test that fails if any screen offered to a role has no permitting capability; a UI test per role that no control renders without its capability; a negative test that a `super_admin` request to write a target returns 403 and the control is absent.

### 4.2 Dependency adaptation plan

| Consumer | Required change | Backward-compatible bridge | Ordering constraint |
| --- | --- | --- | --- |
| BFF and API gateway | New service (3.5). Routes under `/v1`; verified claims; PDP; masks; capabilities; audit obligation; trace propagation | Phase 1: pass-through plus audit, authorisation decisions logged beside the legacy path (shadow) | Before any CAD change |
| Identity (Keycloak) | Authorization Code with PKCE client for the BFF; required action for MFA; `acr` mapping; remove the `cad-web-ui` direct-grant client after Phase 4 | Both clients active during Phases 1–3 | Before BFF enforce |
| Postgres | Expand-only migrations: `consent_register`, `telemetry_event_index`, `telemetry_bronze` (+ `telemetry_shadow`), `audit_entry`, `audit_roots`, `stream_events`, `session_store`, `nme` publisher tables, `release_seq` on `catalog_release`; RLS rewritten against the BFF internal token | Old tables and policies untouched until Phase 4; new policies are additive and tested in shadow | Before gateway and hub |
| Redis (or equivalent) | PDP attribute cache (30 s), DPoP replay cache, denylist, consent cache with pub/sub invalidation, SSE replay window | None needed; new infrastructure | Before gateway |
| Background workers | Row-level consent filter in every ETL job; adherence batch; shred cascade; audit verifier (60 s); canary; retention purges (3-month device, server policy); catalogue publisher emits `catalog_hash_v2` and `release_seq` | Publisher writes both hashes for two releases | Publisher before client verify enforce |
| Extension: service worker | `evaluateItem` v5, NME v2, token verifier, telemetry queue, obs SDK, catalogue verify-then-commit, scanner deadline | Each behind its own flag; legacy paths intact; DB v19 additive | Flags dark in the same release |
| Extension: content scripts and UI | Adapter core, closed shadow root, neutral state, copy without condition names, 3-month timeframes, "Limited nutrition info" chips | Per-retailer flag; spec N-1 retained | After SW flags are proven |
| CAD frontend | BFF client with cookie auth, `useCapabilities`, SSE reducer, audit tri-state, `useResource` discriminated results, removal of `AuthContext` password grant and `PostgrestQueryBuilder` | Old client kept behind a flag until Phase 4 | After BFF shadow parity |
| Side panel and shopper surfaces | Same capability or policy contract; remove `year` and `all` timeframes; `nutri_entitlement` and `user_health_profile` keys retired | Reads tolerate missing new fields | With the extension release |

**Contract versioning.** Every new endpoint is versioned in the path (`/v1`), every event and stored record carries `schema` or `versions`, and clients ignore unknown fields. A breaking change needs a new version served beside the old one for at least two releases and a sunset header.

### 4.3 State synchronisation and UI contracts

**Event contract (SSE, ADR-2).** Every event is already field-masked for its subscriber. The SSE `id:` line carries the same value as `id` in the body, so the browser's native `Last-Event-ID` resume works unchanged.

```ts
type ReasonClass = 'safety_hard' | 'clinical_soft' | 'confidence_low';
interface Envelope<T extends string, D> {
  id: string;                         // `${epoch}:${seq}`; gapless per scope
  type: T;
  scope: { tenant: string; patient_ref?: string };
  at: string;                         // server commit time, RFC 3339
  caps_hash: string;                  // capabilities the server used for this subscriber
  data: D;
}
type StreamEvent =
  | Envelope<'patient.alert',  { patient_ref: string; severity: 'info' | 'attention' | 'urgent'; reason_class: ReasonClass }>
  | Envelope<'target.updated', { patient_ref: string; bundle_version: number; valid_to: string }>
  | Envelope<'link.changed',   { patient_ref: string; state: 'linked' | 'unlinked' }>
  | Envelope<'consent.changed',{ patient_ref: string; purpose: 'C1' | 'C2' | 'C3' | 'C4'; state: 'granted' | 'revoked' | 'expired' }>
  | Envelope<'system.status',  { component: string; state: 'ok' | 'degraded' | 'down'; since: string }>
  | Envelope<'access_revoked', { scope: string }>
  | Envelope<'session.revoked',{ sid: string }>
  | Envelope<'resync_required',{ reason: 'gap' | 'buffer_expired' | 'overflow' | 'server_restart' }>;
```

```text
id: 7:48213
event: patient.alert
data: {"scope":{"tenant":"t_01"},"at":"2026-11-20T08:15:02Z","caps_hash":"9c1f...","data":{"patient_ref":"p_7e2","severity":"attention","reason_class":"clinical_soft"}}
```

**Client reducer (deterministic, idempotent).**

```ts
function onEvent(ev: StreamEvent) {
  const [epoch, seq] = ev.id.split(':').map(Number);
  if (epoch !== state.epoch) return resync('server_restart');
  if (seq <= state.seq) return;                          // duplicate: ignore
  if (seq !== state.seq + 1) return resync('gap');       // GET /v1/sync?since=<state.id> (≤ 5,000 events), else snapshot
  if (ev.caps_hash !== state.capsHash) refreshCapabilities();   // purge rules in 4.4
  apply(ev); state.seq = seq; state.id = ev.id;
}
```

**State machines.**

| Machine | Transitions |
| --- | --- |
| Connection | `idle` to `connecting` to `live`; `live` to `resyncing` to `live`; `live` to `degraded` (polling every 10 s) after two failed reconnects; `degraded` to `connecting` on a successful poll; any state to `offline` when the browser reports offline; `session.revoked` or 401 to `ended` |
| View data | `idle` to `loading` to `ready`; `ready` to `stale` when older than the TTL (30 s for alerts, 5 min for lists); `stale` to `refreshing` to `ready`; any state to `error(code)`; `ready` and `stale` to `loading` on `resync_required` |

**Throttling and backpressure.** Incoming events go into a per-key map and flush at most every 250 ms (four renders per second), coalescing `patient.alert` by `patient_ref` with a counter. Lists are virtualised. A hidden tab buffers up to 500 events, then discards them and resyncs when it becomes visible again.

**Optimistic UI rules.**

| Mutation class | Strategy | On rejection |
| --- | --- | --- |
| Presentation preferences (filters, column order, dismissing a banner) | Optimistic | Revert silently to the prior value |
| Alert acknowledgement | Optimistic with a pending marker and an `Idempotency-Key` | Revert and show the mapped error |
| Clinical writes (targets, mode approval, consent recording), provisioning, anything in `STEP_UP` | Pessimistic: control disabled and progress shown until the server returns the new version | Nothing was shown as saved, so nothing to undo |
| Erasure and crypto-shred | Typed confirmation, step-up, pessimistic | As above |

Writes carry `If-Match: <version>`. A 412 reloads the current record and shows a field-level difference for the user to resolve; it never overwrites silently.

**Errors are never rendered as empty.** `useResource` returns a discriminated union `{ status: 'loading' } | { status: 'ready', data } | { status: 'empty' } | { status: 'error', code, ref }`. The REST client's `then()` and `maybeSingle()` that convert failures into `{ data: [] }` (F-03) are deleted. Role-appropriate translation of `ProblemDetails.code`:

| Code | Shopper or patient surface | Clinician and staff | Operator and auditor |
| --- | --- | --- | --- |
| `UPSTREAM_TIMEOUT` (504) | "Grades are unavailable right now." Neutral badges stay | "Data is delayed. Try again in a moment." plus a 6-character reference | Code, failing dependency, `trace_id`, `retry_after_s` |
| `FORBIDDEN` (403) | Not shown | "You don't have access to this." No reason, no existence hint | Full decision reason from the audit entry |
| `NOT_FOUND` (404, includes cross-tenant) | Not shown | "This item isn't available." | `trace_id` only (no tenant detail) |
| `STEP_UP_REQUIRED` (403) | Not shown | "Confirm your identity to continue" and the challenge | Required `acr` and current level |
| `CONSENT_REQUIRED` (403) | Not shown | "This patient hasn't shared this data." | Purpose code and `consent_ref` |
| `RATE_LIMITED` (429) | Backs off silently | "Too many requests, retry shortly." | Bucket and key |
| `SESSION_EXPIRED` (401) | Not shown | Sign-in screen; local data cleared (4.4) | Same |
| `CHAIN_VERIFICATION_FAILED` | Not shown | "Audit verification is unavailable." | Sequence of the first bad entry; security alert raised |
| `RESYNC_REQUIRED` | Not shown | Silent refetch | Counter on the ops dashboard |

**Tests.** Gap injection (drop `seq` 5 of 10, expect `GET /v1/sync` and a consistent final state); duplicate delivery (applied once); epoch change (full resync); slow-renderer test (never more than four renders per second under 2,000 events per second); optimistic-rollback tests per class; 412 conflict test; a snapshot test that no error path renders an empty list.

### 4.4 Client storage and multi-device safety

**Cache key schema.**

| Surface | Key or namespace | Lifetime |
| --- | --- | --- |
| CAD server state (in memory only) | `['ns', schemaVer, tenantId, sidHash, capsHash, resource, params]` | `gcTime` 5 min; never written to disk |
| CAD UI preferences | `sessionStorage` key `ns:ui:<sidHash>`, non-sensitive values only | Tab session |
| CAD tokens | Not in the browser at all (cookie only, ADR-4) | n/a |
| Extension user stores (`shopping_ledger`, `telemetry_queue`, settings) | Rows stamped `owner = sha256(token.sub).slice(0, 16)` | Purged on owner change; 3-month ceiling |
| Extension product evaluation LRU | `(productId, catalogueVersion, scoring, profileVer)` | In memory, evicted on any version change |
| Extension `product_cache` | `(id, scoringVersion, catalogueVersion)` (existing) | 7 days |

The `owner` stamp is cheaper and safer than one database per user: it needs no data migration (legacy rows read as owner-less and are purged on first re-pair) and it closes F-06, where two people sharing a Chrome profile would see one ledger.

**Purge hooks.**

| Trigger | Action |
| --- | --- |
| CAD logout, idle 15 min, absolute 8 h, 401, `session.revoked` | Clear query cache and `ns:ui`, close the stream, post `logout` on `BroadcastChannel('ns-auth')` so other tabs follow within 1 s, route to sign-in |
| `caps_hash` change or role change | Clear the cache, refetch capabilities, reopen the stream |
| Tenant switch (`super_admin`) | Server re-issues the session through `POST /v1/session/tenant` (step-up and dual-control audit); the client hard-reloads and clears everything. The current local `switchTenant` that edits claims is deleted |
| CAD tab hidden longer than 15 min | Require re-authentication on return |
| Extension: consent revoked or token revoked | Purge `telemetry_queue`, policy and evaluation caches at once; keep only the neutral-grade path |
| Extension: `token.sub` differs from the stored `owner` | Purge all user-scoped stores before accepting the new token |
| Extension: "Delete my data" (exists in the dashboard) | Extended to cover the queue, IndexedDB user stores and counters |
| Extension: daily alarm | `purgeOlderThan(90 days)` on ledger and queue (2.3) |

**Multi-device and shared-machine safety.** The BFF lists sessions (`GET /v1/sessions`) and lets a user revoke others; clinicians are limited to three concurrent sessions; a sign-in from a new device needs a step-up and raises a notification; a revoked session receives `session.revoked` over SSE and loses its cookie validity at once because the denylist is checked on every request. In the extension, token revocation reaches the device within 5 minutes (2.7), and a second person re-pairing the same browser profile triggers the owner purge above.

**Tests.** Two users on one browser: user A signs out, user B signs in, and a scan of `localStorage`, `sessionStorage`, IndexedDB and Cache Storage finds no A data; role-change test (caches cleared, stream reopened); revoke test (stream closes within 5 seconds); multi-tab logout within 1 second; a Playwright scan proving no token appears in any browser storage; extension owner-change test (old ledger unreadable, queue empty).

## Section 5: Zero-Downtime Migration & Production Rollout Strategy

**Principles.** (1) Measure first: no tuning before the instrumentation (3.2) is in users' hands. (2) Every change ships dark, behind a signed flag, in the same release as the code it controls. (3) Additive schemas only until Phase 4. (4) Old and new paths write mutually readable data, so a rollback never needs a data rollback. (5) A percentage is a ceiling, not a gate: at pilot scale 1% of installs may be a handful of devices, so a stage advances only when it has enough evidence (at least 200 scored batches and 30 telemetry events per metric) and its soak time has elapsed.

> **ADR-5: how to run canaries for a Manifest V3 extension at pilot scale** **Context.** The brief calls for 1%, 10%, 50%, 100% canaries with automatic rollback. The extension ships through the Chrome Web Store, and the pilot has hundreds of users, not hundreds of thousands. **Research.** Chrome Web Store documentation restricts percentage rollouts to items with more than 10,000 seven-day active users, allows one partial rollout at a time, and rolling back means publishing a new version that goes back through review (verify the current limits on the developer dashboard). Chrome extension guidance allows remotely fetched configuration data, including feature flags, provided the code that interprets it ships inside the package; remotely hosted code is not allowed. **Options.** (A) Chrome Web Store percentage rollout. (B) Signed remote flag manifest selecting among code paths already in the bundle. (C) Trusted-tester or beta listing for internal pre-release. (D) Separate extension IDs per cohort. **Decision.** B is the canary mechanism (3.8), with C for internal pre-release and A only if the item later passes the user threshold. Store rollback is the last resort for bundle-level defects, so every risky behaviour must be reachable through a flag. Rejected: D (splits reviews, identity and data, and doubles maintenance). **Residual risk.** Things that cannot be flagged: manifest changes (such as `minimum_chrome_version` 137) and permission changes. They ship as their own small, high-ceremony releases, watched for install and active-user drop, and are not bundled with behavioural changes.

> **ADR-6: IndexedDB migration without downtime** **Context.** The extension database is at version 18. The earlier v13 to v15 upgrades cleared product stores, which is acceptable for a regenerable cache and wrong for user data. Multiple tabs and the service worker hold connections; an upgrade waits for them to close. **Basis.** The repository's own migration history and the standard IndexedDB `versionchange` and `blocked` behaviour; the existing code already has a blocking handler. This was not benchmarked separately. **Options.** (A) Additive-only upgrades: new stores and indexes, fields defaulted on read, nothing cleared. (B) A new database name per major version with copy-over. (C) Destructive reindexing inside the upgrade handler. **Decision.** A for Phases 1–3 (DB v19 adds `nme_index`, `catalog_live`, `telemetry_queue`, ledger indexes). Stores are classified: user data (`shopping_ledger`, settings, `telemetry_queue`) is never dropped; derived or regenerable stores (`product_cache`, `price_cache`, `premium_*`, indexes) may be deleted in Phase 4 once nothing reads them; the catalogue is rebuildable from sync. B is reserved for a future change that must alter user data. Rejected: C for any store holding user data. **Residual risk.** A blocked upgrade or an exception inside it. Mitigations: on `versionchange` close the connection at once; keep upgrade code idempotent and wrapped; on failure run in a read-only neutral mode rather than bricking the extension, and report `idb_upgrade_failed`.

### 5.1 Phase 1: Expand (non-breaking additions behind flags)

Release trains, in order. Each train is shippable alone and leaves the system working if the next never arrives.

| Train | Contents | Flags (all default off) |
| --- | --- | --- |
| R0 Measure | Obs SDK (3.2), `check-dist.mjs` build gate, legacy idempotency-key patch (2.8), neutral badge renderer, DB v19 indexes | `ns.obs.sdk` |
| R1 Shadow-capable | Scoring v5 and policy v2 beside v4, NME v2 and `nme_index`, ledger v2, scanner deadline and breaker, catalogue verify-then-commit in report-only mode, closed shadow root, telemetry queue with shadow flush, token verifier v2 with `minimum_chrome_version` 137 shipped as its own manifest release just before | `ns.scoring.v5`, `ns.policy.v2`, `ns.nme.v2`, `ns.ledger.v2`, `ns.scanner.v2`, `ns.catalog.verify_v2`, `ns.ui.closed_shadow`, `ns.telemetry.v2`, `ns.token.v2` |
| R2 Adapters | Adapter core and specs, one retailer per release: Quickmart, Naivas, Carrefour | `ns.adapter.core.<retailer>` |
| S1 Server | Expand-only migrations (4.2); gateway with shadow table; consent register; flag and key manifest services; BFF in pass-through plus audit mode; Keycloak PKCE client beside the existing client; publisher emits `catalog_hash_v2` and `release_seq`; bundles signed with `sig` beside the legacy `signature`; audit writer and verifier; controller in observe-only mode | `ns.bff.enforce`, `ns.sse`, `ns.global.neutral` |
| C1 CAD | BFF client, capabilities, SSE reducer, audit tri-state, `useResource` | `ns.cad.bff_client` |

**Dual writes and shadows.** The ledger continues to feed `pending_cart_syncs` and the legacy POST while also filling `telemetry_queue`, which flushes to the gateway with `X-NS-Shadow: 1`. Target bundles carry both signatures. The BFF logs its PDP decision beside the legacy outcome for every request. Nothing in Phase 1 changes what a shopper or clinician sees.

**Gate to leave Phase 1.** R0 live for 14 days with baselines recorded for `badge_ms`, `nme_ms`, `neutral_fallback`, `sw_rpc_fail`; every flag proven to flip on and off in staging; the flag manifest signed, verified and rolled back once in a drill; DB v19 deployed with zero `idb_upgrade_failed`.

### 5.2 Phase 2: Shadow and parity verification

Run the refactored paths beside the legacy ones on the same inputs and compare outputs, latency and resource use against the set points.

| Component | What runs in shadow | Compared against | Exit criterion |
| --- | --- | --- | --- |
| Scoring v5 | Offline replay of all 10,518 records, plus 1% of live evaluations | Scoring v4 | Every grade change has a non-empty `missing`; zero unexplained diffs; T-04 20 of 20 exact; restated coverage published (D-9) |
| NME v2 | 100 recorded pages per retailer, plus 1% live | `resolveProductMatch` | Agreement ≥ 99.5% on M1–M3; M4 precision ≥ 97% at p ≥ 0.92 on the labelled set; exact resolution P95 ≤ 10 ms; no-scan test green |
| Catalogue verify | Report-only on every sync | Current behaviour | 14 consecutive days with zero false mismatches; ICU determinism test passes; v2 hash parity |
| Telemetry v2 | Shadow flush from every device with the flag | Legacy POST | Conformance ≥ 99.5%; duplicates 0 after dedupe; consent linkage 100%; lateness P95 < 24 h; event counts within 1% of legacy |
| Token and bundles | Dual verification | Legacy string check | No unexplained `new_ok_legacy_invalid` or `legacy_ok_new_invalid`; key manifest fetched and rotated once |
| BFF and PDP | Shadow authorise every request | Legacy outcome | Zero unexplained "legacy allowed, PDP denied"; the designed corrections (for example `super_admin` writing targets) are listed and expected; PDP P95 ≤ 5 ms; BFF added latency P95 ≤ 25 ms |
| SSE hub | 500 simulated streams plus staff users | Polling | Zero gaps after fault injection; delivery P95 < 2 s |
| Observability | Full pipeline | Baselines | Burn-rate alerts fire in staging fire drills |

**Test programme that must be green to exit.**

- *Load.* Gateway at 10× expected pilot rate with the queue near its bound (backpressure and 429 behaviour); BFF at 200 requests per second; SSE soak at 500 streams for 2 hours; catalogue sync of a full release on a throttled connection.
- *Security and RBAC boundary.* Forged JWTs, algorithm confusion, cross-tenant object IDs, CSRF, `acr` bypass, replayed DPoP, forged bundle, tampered catalogue row, tampered audit row, hostile page script against the badge, storage scan for tokens, two-user shared-browser test.
- *Chaos.* Kill the service worker mid-flush and mid-sync, drop the gateway, drop Redis, expire the signing key, corrupt `nme_index`.
- *Accessibility and performance.* axe on the injected badge, flyout and CAD views; UI bundle budgets (popup 40 KB, dashboard 70 KB, side panel 60 KB, CAD 110 KB gzip); T-03 over 100 fixture pages.

Failures found here are fixed in shadow. Nothing proceeds to Phase 3 with an open High finding from Section 1.

### 5.3 Phase 3: Progressive cutover with metric-driven rollback

**Stages.** Stage 0 staff and testers (`allow_ids`, at least 3 days), Stage 1 at 1% (at least 48 hours), Stage 2 at 10% (72 hours), Stage 3 at 50% (72 hours), Stage 4 at 100% (hold 7 days before Phase 4 timing starts). A stage advances only when its soak time has passed, its evidence minimum is met (200 scored batches and 30 telemetry events per metric) and no rollback trigger fired. Components cut over one at a time, lowest blast radius first.

| Order | Cutover | Why this position |
| --- | --- | --- |
| 1 | `ns.scanner.v2`, `ns.ui.closed_shadow`, `ns.catalog.verify_v2` (enforce) | Fail-safe changes; neutral on failure |
| 2 | `ns.telemetry.v2` live to analytics | No shopper-visible effect; consent-gated |
| 3a | `ns.nme.v2`, `ns.ledger.v2` | Internal data path; grades unchanged until 3b |
| 3b | `ns.scoring.v5`, `ns.policy.v2` | The only change shoppers see; highest clinical sensitivity, so it follows evidence from 3a |
| 4 | `ns.token.v2` and bundle enforcement (legacy bundles limited to warn level) | Needs key manifest and shadow history |
| 5 | `ns.bff.enforce` by route group (reads, then writes, then clinical writes) and `ns.cad.bff_client` | Per-route cutover keeps each rollback small |
| 6 | `ns.sse` | Polling fallback exists |
| Any time after parity | `ns.adapter.core.<retailer>`, one retailer at a time | Independent of the above |

**Automatic rollback triggers.** The controller (3.4) evaluates these on 10-minute windows with at least 200 batches, and flips the owning flag back one stage through the signed manifest (propagation ≤ 5 minutes).

| Signal | Trigger | Action |
| --- | --- | --- |
| `badge_ms` P95 | > 200 ms in any window, or > 120 ms in 3 consecutive windows | Revert last flag step |
| Neutral-fallback rate | More than 3 percentage points above the cohort baseline and above 5% in total, for 2 windows | Revert |
| `eval_error` rate | > 0.5% | Revert `ns.scoring.v5` and `ns.policy.v2` |
| `sw_rpc_fail` rate | > 2% | Revert `ns.scanner.v2` or the owning flag |
| Grade distribution shift | Unexplained shift of more than 2 percentage points against the shadow expectation | Freeze and revert 3b |
| Safety | Any unresolved safety event, or false-block reports above 1% of blocks | Freeze all flags and revert the active stage; page |
| Catalogue integrity | Failures on more than 0.1% of devices | Mark the release `held`; devices keep last good |
| Telemetry | Gateway ack P99 > 300 ms for 15 min, schema rejects > 2%, or duplicates > 1% | Revert `ns.telemetry.v2` |
| BFF | 5xx > 0.5% over 5 min, or any divergence from the shadow-predicted decision | Route group back to the legacy path |
| SSE | Resync rate above 5% of reconnects, or delivery P95 > 5 s | Turn `ns.sse` off (polling) |
| Selector health | > 2% failure for a retailer | `killSwitch` for that retailer |
| Error budget | Fast burn 14.4 over 1 h and 5 min: page and revert; slow burn 6 over 6 h and 30 min: freeze | As stated |

**Rollback mechanics.** Because Phases 1–3 are additive and dual-written, a rollback never needs a data rollback: v4 and v5 read the same records, the legacy endpoints still run, and old and new ledger rows are mutually readable. Before every stage the flag is flipped off and on once in staging as a drill, and each rollback is recorded with the metric that caused it. If a bundle-level defect appears that no flag can reach, the fallback is a Chrome Web Store re-publish of the previous version (ADR-5), which is why risky behaviour is never left outside a flag.

### 5.4 Phase 4: Contract and clean-up

**Entry gate.** All flags at 100% for 30 consecutive days with no rollback trigger fired, including at least one catalogue release and one signing-key rotation drill; `ext_ver` telemetry shows at least 99% of active installs on the new version; the gateway logs show no legacy client calls for 14 days; the stability set points of 3.4 held across the whole window.

| Step | Removal | Safety check before and after |
| --- | --- | --- |
| 1 | Legacy HTTP paths: the old observed-orders function, the direct-grant client `cad-web-ui`, the browser-to-PostgREST path, `debug-payments` | Zero traffic for 14 days; 410 responses for a further release |
| 2 | Dual-write shims: legacy POST, `pending_cart_syncs` event use, legacy bundle `signature` acceptance, legacy `catalog_hash` order | Parity dashboards show the new path alone carries all events |
| 3 | Extension code: `entitlement.js`, `NutritionContextEngine.getContextGrade`, `evaluateProductForUser`, `DISEASE_RULES` presets, `window.*Adapter` capture, the three monolithic adapter bodies, `year` and `all` timeframes | Tag `pre-contract-<date>` first; static check for remaining imports |
| 4 | CAD code: `AuthContext` password grant, `PostgrestQueryBuilder`, `ROLE_NAVIGATION` (development fallback too), the 37 role comparisons | ESLint rule now errors instead of warning |
| 5 | IndexedDB v20: delete derived stores only (`premium_*`, `price_cache`, unused indexes); user-data stores are never dropped (ADR-6) | Upgrade tested on a copy of a real profile; `idb_upgrade_failed` stays at zero |
| 6 | Server contract migrations (drop legacy columns and tables, remove `release_seq`-less paths, retire dead Supabase artefacts) | Scheduled one operational cycle after step 5; backups verified |

Every step keeps a git tag and a reversible schema state until the next cycle passes, so Phase 4 itself is not a point of no return until its last step.

### 5.5 Verification matrix and definition of done

| Layer | What is verified | Where it runs | Gate |
| --- | --- | --- | --- |
| Unit and property | `evaluateItem` completeness property over 10,518 records; `checkNutrientCompleteness` metamorphic tests; token verifier cases; reducer sequencing; masks cover every DTO field | CI | Merge |
| Contract | JSON Schemas for `ItemEvaluation`, `TelemetryEvent`, `StreamEvent`, `FlagManifest`, `ProblemDetails`; publisher and client hash parity (Node and Chrome); legacy and new bundle verification | CI | Merge |
| Reference accuracy | T-04: 20 of 20 on the official set plus top 500 SKUs per retailer; T-05 labelled-pair precision | CI nightly | Release |
| Performance | T-03 over 100 fixture pages (P95 ≤ 120 ms goal, 200 ms hard); stage budgets; no-scan spy; UI bundle sizes | CI on a throttled profile | Release |
| Load | Gateway 10× pilot rate; BFF 200 rps; SSE 500 streams; sync on a throttled link | Staging | Phase 2 exit |
| Security and RBAC boundary | Forged JWT set, BOLA, CSRF, `acr` bypass, DPoP replay, forged bundle, tampered catalogue and audit rows, hostile page script, storage token scan, two-user shared browser | Staging, repeated before each cutover | Phase 2 exit and each stage |
| Compliance | T-08 revocation, T-09 re-identification and k ≥ 20 on every release, T-10 audit tamper, crypto-shred, retention purges | Staging and synthetic production | Phase 3 entry |
| Chaos | Worker killed mid-flush and mid-sync, gateway or Redis down, key expiry, corrupted index | Staging | Phase 2 exit |
| Accessibility | axe on badge, flyout and CAD views; WCAG 2.2 AA; zero serious or critical violations | CI | Merge |
| Migration | IndexedDB v18 to v19 upgrade on real profile copies; idempotent re-run; blocked-upgrade handling | CI and staging | Release |

**Definition of done for any change in this blueprint:** the flag and its default exist; the failure behaviour is implemented and tested; the rollback was drilled; the metric that watches it is on the dashboard with its trigger; and the entry in Section 1 is closed with a test that fails if it regresses.

### 5.6 The minimum safe set

If capacity allows only a small first cut, these ten changes remove the highest risks, in this order of value over effort. Each is independent of the larger migration.

1. **E-01** Gate 2 and zero-fill fix with `checkNutrientCompleteness` (2.1).
2. **X-01** Verified-claims constructor and the branded type (3.5).
3. **X-02** Real bundle signature verification, dual-signed first (2.7).
4. **F-01** Remove client-side MFA; enforce `acr` in Keycloak and the BFF (ADR-4).
5. **A-02 and A-01** Catalogue verify-then-commit and fail-closed, using `recordHash` (2.6).
6. **A-05** Honour 401, 403 and 410 as revocation (2.7).
7. **A-07 and E-06** Closed shadow root, no condition names, default-off conditions behind sign-off D-1 (2.9, 2.1).
8. **A-06** Payload-derived idempotency key in the legacy sync (2.8).
9. **O-01** The observability SDK, so everything after this is measurable (3.2).
10. **F-05** Audit tri-state in the CAD, so the screen can never assert integrity it has not checked (3.7).

### 5.7 Decisions needing sign-off

| ID | Decision | Owner | Default if unanswered |
| --- | --- | --- | --- |
| D-1 | Unset condition flags default to off (behaviour change for profiles that never chose; E-06) | Clinical lead and product | Ship behind `ns.policy.v2`, off |
| D-2 | Whether anonymous performance counters need consent | Counsel | Gate on C2 |
| D-3 | k for generalising token constraints (`applyCohortGate`); retailer outputs stay at k ≥ 20 | Privacy lead | Keep 5 as a named, documented constant |
| D-4 | Remove `super_admin` read of target bundles | Security lead | Remove |
| D-5 | `minimum_chrome_version` 137 and the neutral-grade fallback below it | Product | Adopt; check the share of older browsers first |
| D-6 | RFC 3161 daily timestamp for audit roots | Counsel | Signed roots and WORM only until answered |
| D-7 | Canary request rate and retailer terms | Counsel and retailer relations | 30 pages per retailer per night, honour robots |
| D-8 | Server retention period for clinical data (20 years assumed) | Legal | As in the UI report |
| D-9 | Restating grade coverage in the deck and to partners once Gate 2 is corrected | Project lead | Restate in the next release train |

### 5.8 Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R-1 | Honest coverage falls below the 42–46% already reported once the four-nutrient gate is enforced | Publish computed and eligible coverage side by side with the curation plan (D-9); the data-curation pass is the lever to reach the 80% target |
| R-2 | Browsers below Chrome 137 lose grading | Neutral fallback; measure the share before the manifest release |
| R-3 | Compromise of a flag, key-manifest or audit signing key | Two pinned root keys, rotation drill, Vault custody, dual control |
| R-4 | The BFF and PDP become a single point of failure | At least two replicas, health checks, documented fail-closed behaviour, clear status messages |
| R-5 | Pilot sample too small for canary statistics | Evidence minimums per stage, staff cohort, synthetic traffic from the canary runner |
| R-6 | Retailer page changes during the migration | Nightly canary, `killSwitch`, parity fixtures refreshed monthly |
| R-7 | Capacity: the full programme is large | Trains are independently shippable; the minimum safe set (5.6) delivers the safety fixes first |
| R-8 | Conclusions about files not supplied | See 5.10 |

### 5.9 Architecture decision records index

| ADR | Decision | Section |
| --- | --- | --- |
| ADR-1 | Keep the in-process TypeScript PDP; fix X-03, parallelise and cache attribute loads; revisit OPA or Cedar if policy authorship moves out of code | 3.5 |
| ADR-2 | SSE over HTTP/2 with sequence IDs and a polling fallback; commands over REST | 3.6 |
| ADR-3 | Ed25519 across tokens, bundles, DPoP and manifests; `minimum_chrome_version` 137; ES256 legacy until Phase 4 | 2.7 |
| ADR-4 | BFF with Authorization Code and PKCE, cookie session, server-side tokens, MFA enforced twice | 3.5 |
| ADR-5 | Signed remote flags as the canary mechanism; Web Store rollout and rollback as last resort | 5 |
| ADR-6 | Additive IndexedDB upgrades; never drop user-data stores; delete only derived stores in Phase 4 | 5 |
| ADR-7 | Signed Merkle roots in WORM storage plus a daily RFC 3161 timestamp (pending D-6) | 3.7 |
| ADR-8 | Keep salt to sodium at ×400 (the labelling convention); amend the Clinical report | 2.1 |
| ADR-9 | Full-jitter backoff with per-attempt deadlines and `Retry-After` honoured | 2.4 |

### 5.10 What would tighten this blueprint

Conclusions marked I, and everything about files that were not supplied, should be rechecked against: `background.js` (message routing, wake gating, whether catalogue sync runs per wake, where grade and warning gating by `ReviewState` happens), `content.js`, `manifest.json` (permissions, CSP, minimum version), the `observed-orders` and `entitlement` Edge Functions (idempotency behaviour), `infra/keycloak-realm.json` (MFA flow, client definitions, `acr` mapping), the CI configuration, and the retailers' current terms for automated page checks. None of these is expected to change the direction; several could change the order or the effort of individual steps.
