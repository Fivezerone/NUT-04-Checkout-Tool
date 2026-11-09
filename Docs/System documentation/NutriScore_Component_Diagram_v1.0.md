**JHUB AFRICA | AFYAVENTURES**

─────────────────────────────────────

**NutriScore Checkout Tool**

**Component Diagram**

**Comprehensive Architecture Reference**

NUT-04 | JHUB Africa AfyaVentures | June 2026

| **Field** | **Details** |
| --- | --- |
| Document Type | UML Component Diagram -- Architecture Reference |
| Standard | UML 2.5.1 Component Diagram notation (ISO/IEC 19501) |
| Project Code | NUT-04 |
| Repository | github.com/Fivezerone/NUTRISCORE |
| Primary Source of Truth | NutriScore\_Requirements\_v2\_Evidence\_Linked (NUT-04, June 2026) |
| Student Lead | Kibet -- B.Sc. Electronic & Computer Engineering, JKUAT, Year 3 |
| Programme | JHUB Africa AfyaVentures 2026 |
| Document Status | Approved -- Architecture Baseline v1.0 (historical design intent — see reconciliation note below) |

# **Current Implementation Status (reconciliation note, added August 2026)**

This document is the **original architecture baseline**, written in June 2026 before implementation began. Read it as a record of design intent, not as a description of the shipped extension. `02_System_Architecture_NUT-04.md` (v1.1) is the current, authoritative reconciliation of spec vs. shipped code; where the two disagree, that document and the running source in `github.com/Fivezerone/NUTRISCORE` govern. The load-bearing divergences, confirmed by direct inspection of `src/extension`:

| Baseline design (this document) | Current shipped reality |
| --- | --- |
| `OpenFoodFactsAPI` is the primary nutrition source; `KenyanFallbackDatabase` is the fallback | No live network call exists anywhere in `background.js`. Every lookup resolves against the bundled canonical datasets (`naivas_final.json`, `carrefour_final.json`) via `NutriScoreDB.resolveProductMatch()`. `KenyanFallbackDatabase` / `fallback-db.json` was never built — superseded by the layered, provenance-carrying dataset design in Requirements Spec §10.5 |
| `IndexedDBCache` stores exactly 7 `NutritionalProfile` fields (DATA-001), 7-day TTL | The shipped schema is a nested, multi-field `CanonicalGroceryProduct` record (Identity/Classification/Packaging/Nutrition/NutritionProvenance/Validation/Price), not a flat 7-field cache. IndexedDB is at schema **v8** with 8 object stores; cached results persist until explicitly purged, not on a 7-day TTL |
| `UIWidget` is built in Preact (`widget.tsx`) | Popup and dashboard are Vite + **React** (`popup.tsx`, `dashboard.tsx`); the badge/flyout itself is vanilla JS (`adapters/shared-ui.js`), not Preact — an unreconciled conflict with NFR-004 |
| Message contract: `SCORE_REQUEST` / `SCORE_RESPONSE` / `ALTERNATIVES_REQUEST` / `ALTERNATIVES_RESPONSE` | The real `chrome.runtime` action names are `CHECK_PRODUCT_SCORE`, `LOG_CART_ADD`, `SYNC_CART_STATE`, `REMOVE_CART_ITEM`, `CART_CLEARED`, `ORDER_PLACED` — none of this baseline's message names exist in the shipped source |
| `AlternativesEngine` invoked only for D/E-scored products, returns ranked alternatives | Now functional end-to-end and matches this baseline's ranking intent (grade → category → price), but runs for **any** non-excluded product, not only D/E grades. `NutriScoreDB.getAllProducts()` exists and supplies real candidates; price-proximity uses a live scan-time cache, not a static field |
| Firebase/Firestore is not part of this baseline at all | An optional Firebase/Firestore sync layer was added after this baseline, then **fully removed**. No trace remains except a dead `firebase-sync.js` reference in `build.cjs` |
| — (not present in this baseline) | `adapters/grade-colors.js` — a small shared grade→colour/label module added later, loaded ahead of `shared-ui.js` in both retailer content-script bundles |

The Mermaid diagram in §9 has been redrawn to show the **current shipped architecture**. The PlantUML source in §8 and the component/interface tables in §3–§7 are left as **historical baseline documentation** of original design intent and are not updated line-by-line here — cross-reference the table above and the System Architecture document for current status on any specific component.

# **1. Purpose and Scope**

This document presents the complete UML 2.5.1 Component Diagram for the NutriScore Checkout Tool (NUT-04). It defines every architectural component, the interfaces each component provides and requires, and the operational connections that implement the nutritional scoring workflow for Kenyan online grocery shoppers.

The diagram covers three architectural layers -- Client/Frontend Extension, Core Logic Engines, and Data & Integration -- plus the eight canonical data model entities that flow between them. All component names, interface names, and data entity names are canonical per the Terminology Reconciliation Log and Project Domain Model v2.0.

|  |
| --- |
| **\* Requirements traceability:** Every component in this diagram traces to at least one functional requirement in NutriScore\_Requirements\_v2\_Evidence\_Linked. Interface boundaries enforce the data minimisation rule (DATA-001), the 2023 FSA-NPS category-first architecture (FR-006), and the adapter pattern for retailer extensibility (NFR-005). The component boundary between BackgroundServiceWorker and the engine layer enforces the principle that ContentScript contains zero business logic. |

# **2. UML Notation Guide**

This document uses UML 2.5.1 Component Diagram notation. The following conventions apply throughout.

| **Symbol** | **UML Name** | **Rendered As (text notation)** | **Meaning in NUT-04** |
| --- | --- | --- | --- |
| [Component] | Component | Rectangle with <<component>> stereotype | An autonomous architectural unit with defined interfaces. Examples: ScoreEngine, ContentScript. |
| O--- | Provided Interface (lollipop) | Circle on a stem extending from the component boundary | The component implements and exposes this interface for others to call. Example: ScoreEngine provides ScoringPort. |
| ---[ | Required Interface (socket) | Half-circle (socket) on the component boundary | The component depends on this interface being provided by another component. Example: BackgroundServiceWorker requires ScoringPort from ScoreEngine. |
| ---> | Assembly Connector | Lollipop mated with socket (lollipop fits inside socket) | Two components are connected via a matched provided/required interface pair. |
| - - -> | Usage Dependency | Dashed arrow with open head | One component uses another but not via a formal interface; typically async or conditional. |
| {package} | Package / Layer | Dashed rectangle containing components | Groups components into an architectural layer (Frontend Extension, Core Logic, Data & Integration). |
| <<data entity>> | Data type annotation | Italicised label near arrow | Names the data structure flowing across a connection (e.g., NutritionalProfile, HealthWarning). |

|  |
| --- |
| **i Reading convention:** Throughout this document, interface names follow the pattern ComponentNamePort. A provided interface is written as O--[InterfaceName]. A required interface is written as [InterfaceName]--[. Assembly connectors are written as O--[InterfaceName]--[ showing the lollipop-to-socket pairing. |

# **3. Component Overview**

The NutriScore Checkout Tool comprises eleven architectural components organised into three layers. The following table provides a one-line functional summary of each component before the detailed interface specification in Section 4.

| **Component** | **Layer** | **Module / File** | **Functional Summary** | **Current Build (Aug 2026)** |
| --- | --- | --- | --- | --- |
| UIWidget | Client / Frontend | widget.tsx (Preact) | Renders the NutritionalScore badge (LetterGrade A-E), NOVAProcessingLevel tag, HealthWarning panels, and AlternativeRecommendation drawer in the browser via Shadow DOM. The only component visible to the Consumer. | Split across `adapters/shared-ui.js` (Shadow DOM badge/flyout, vanilla JS — not Preact) and **React** `popup.tsx` / `dashboard.tsx` |
| ContentScript | Client / Frontend | content-script.ts | Injected into supported retailer pages (Naivas, Carrefour Kenya). Uses a MutationObserver (300ms debounce) to detect GroceryProduct DOM elements asynchronously. Bridges UIWidget and BackgroundServiceWorker via chrome.runtime messaging. | Shipped as `content.js` (vanilla JS, not TypeScript); behaviour matches this baseline's intent |
| BackgroundServiceWorker | Client / Frontend | background.ts | Extension lifecycle manager and central router. Implements cache-first strategy (IndexedDBCache lookup before API call), request deduplication (GroceryProductID hash), and dispatches NutritionalProfile to all four engines. | Shipped as `background.js`. Cache-first lookup is accurate — but there is no API to fall back to; no live network call exists anywhere in the source |
| ScoreEngine | Core Logic | score-engine.ts | Implements the 2023 FSA-NPS algorithm across all five FSAProductCategories. Receives NutritionalProfile + FSAProductCategoryCode from FoodClassifier. Outputs NutritionalScore (LetterGrade, NumericScore, AlgorithmVersion="FSA-NPS-2023"). | Shipped as `engine/score-engine.js` (vanilla JS); functional, same responsibility |
| FoodClassifier | Core Logic | food-classifier.ts | Assigns FSAProductCategoryCode (GENERAL\_FOOD, RED\_MEAT, CHEESE, ADDED\_FAT, BEVERAGE) to each GroceryProduct. Applies the SPF exclusion gate (baby food, sports nutrition, supplements). Outputs FSAProductCategory and NOVAProcessingLevel. | Shipped as `engine/food-classifier.js`; functional, matches this baseline's exclusion-gate intent |
| DiseaseEngine | Core Logic | disease-engine.ts | Evaluates NutritionalProfile against active DiseaseRules (DR-001 to DR-006). Generates HealthWarning objects when thresholds are exceeded. Injects AI-003 disclaimer into every HealthWarning. | Shipped as `engine/disease-engine.js`; functional, though the cardiovascular/kidney rules fire as independent single-nutrient warnings rather than this baseline's combined AND-condition |
| AlternativesEngine | Core Logic | alternatives-engine.ts | Produces ranked AlternativeRecommendation objects for D/E-scored GroceryProducts. Applies three-factor ranking: LetterGrade rank, FSAProductCategory match (mandatory), price proximity +/-30%. | Shipped as `engine/alternatives-engine.js`. Functional end-to-end; runs for any non-excluded product, not only D/E grades |
| IndexedDBCache | Data & Integration | idb wrapper | Local browser key-value store. Caches NutritionalProfile (7 fields; 7-day TTL), NutritionalScore, and ShoppingHistory. Stores UserProfile.HealthConditionToggles. Never transmits data externally (DATA-004). | Shipped as `db.js`, schema **v8**, 8 object stores. Records are nested multi-field `CanonicalGroceryProduct` objects, not a flat 7-field cache; no TTL — cached results persist until explicitly purged |
| KenyanFallbackDatabase | Data & Integration | fallback-db.json (bundled) | Bundled JSON dataset of 200+ Kenyan-market GroceryProducts with NutritionalProfile. Queried when OpenFoodFactsAPI returns no match for a product name. All 7 required NutritionalProfile fields present; FibreG estimated where unavailable. | **Not built.** No `fallback-db.json` exists — superseded by the layered dataset design in Requirements Spec §10.5 |
| OpenFoodFactsAPI | Data & Integration | External HTTPS API | Open Food Facts REST API v2 (world.openfoodfacts.org). Queried by product name (HTTPS only; no user identifier in request). Primary nutrition data source for internationally recognised products. CC BY-SA 4.0 licence. | **Not integrated.** No network call to Open Food Facts, or anywhere else, exists in the shipped build |

# **4. Provided and Required Interface Specification**

This section documents every interface each component exposes (provided -- lollipop) and every interface each component depends on (required -- socket). Assembly connectors are identified in Section 5.

## **4.1 UIWidget**

|  |
| --- |
| **[Component] UIWidget**  *User-facing overlay: badge, warnings, alternatives drawer, settings panel* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| REQUIRED | RenderDataPort | socket [ | Receives SCORE\_RESPONSE from ContentScript containing NutritionalScore, NOVAProcessingLevel, and []HealthWarning. The primary data input for badge rendering. |
| REQUIRED | AlternativeDataPort | socket [ | Receives ALTERNATIVES\_RESPONSE from BackgroundServiceWorker containing ranked []AlternativeRecommendation objects. |
| PROVIDED | UserInteractionPort | lollipop O-- | Exposes user trigger events to ContentScript: badge click, "See alternatives" click, settings panel open, consent modal response, "Delete all my data" action. |
| PROVIDED | ConsentPort | lollipop O-- | Emits consumer consent decision (accept / decline) to BackgroundServiceWorker on first-run modal interaction. DATA-002 enforcement point. |

|  |
| --- |
| **i Design constraint:** UIWidget uses Shadow DOM CSS encapsulation to prevent its styles from affecting or being affected by retailer page CSS (NFR-002). All grade colours are applied via CSS custom properties, never inline style strings (NFR-006). Every visual element exposes an aria-label for screen reader compatibility (ACC-001, NFR-007). |

## **4.2 ContentScript**

|  |
| --- |
| **[Component] ContentScript**  *DOM observer and chrome.runtime messaging bridge* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| PROVIDED | ProductDetectionPort | lollipop O-- | Exposes detected GroceryProduct metadata (ProductName, RetailerCode, GroceryProductID, PriceKES) to BackgroundServiceWorker via SCORE\_REQUEST chrome.runtime message. Fired by MutationObserver with 300ms debounce. |
| PROVIDED | WidgetRenderPort | lollipop O-- | Passes SCORE\_RESPONSE payload from BackgroundServiceWorker to UIWidget for badge and warning panel rendering. |
| REQUIRED | ScoreResponsePort | socket [ | Receives SCORE\_RESPONSE from BackgroundServiceWorker: NutritionalScore, NOVAProcessingLevel, []HealthWarning. |

|  |
| --- |
| **i Design constraint:** ContentScript contains zero business logic. It detects products and passes messages -- all computation happens in BackgroundServiceWorker and the engine layer. This boundary is enforced architecturally so that future retailer adapter changes never touch the scoring pipeline (NFR-005). |

## **4.3 BackgroundServiceWorker**

|  |
| --- |
| **[Component] BackgroundServiceWorker**  *Central hub: cache management, API dispatch, engine orchestration* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| PROVIDED | RoutingPort | lollipop O-- | Accepts SCORE\_REQUEST from ContentScript; coordinates the full analysis pipeline; returns SCORE\_RESPONSE to ContentScript. |
| PROVIDED | CacheManagementPort | lollipop O-- | Manages IndexedDBCache reads and writes: cache-first NutritionalProfile lookup (7-day TTL), NutritionalScore storage, ShoppingHistory recording (only after consent via DATA-002), UserProfile.HealthConditionToggles persistence. |
| PROVIDED | AlternativesRoutingPort | lollipop O-- | Accepts ALTERNATIVES\_REQUEST from UIWidget via ContentScript; dispatches to AlternativesEngine; returns ALTERNATIVES\_RESPONSE. |
| REQUIRED | NutritionLookupPort | socket [ | Calls OpenFoodFactsAPI (HTTPS, no user identifier) on cache miss. Falls back to KenyanFallbackDatabase if OpenFoodFactsAPI returns no match or times out (>3s). |
| REQUIRED | ScoringPort | socket [ | Dispatches NutritionalProfile + FSAProductCategoryCode to ScoreEngine; receives NutritionalScore. |
| REQUIRED | ClassificationPort | socket [ | Dispatches NutritionalProfile + ProductName to FoodClassifier; receives FSAProductCategoryCode, NOVAProcessingLevel, IsExcluded flag. |
| REQUIRED | DiseaseEvaluationPort | socket [ | Dispatches NutritionalProfile + active UserProfile.HealthConditionToggles to DiseaseEngine; receives []HealthWarning. |
| REQUIRED | AlternativesPort | socket [ | Dispatches SourceGroceryProductID + FSAProductCategoryCode + PriceKES to AlternativesEngine; receives ranked []AlternativeRecommendation. |
| REQUIRED | CacheReadWritePort | socket [ | Reads and writes IndexedDBCache via the idb library wrapper. Cache key: GroceryProductID (deterministic hash of ProductName + RetailerURL). |

|  |
| --- |
| **! Security constraint:** BackgroundServiceWorker enforces DATA-004: only ProductName (as a plain string) is included in outbound requests to OpenFoodFactsAPI. No GroceryProductID, no UserID, no HealthConditionToggles, and no ShoppingHistory data is ever transmitted externally. CSP in manifest.json restricts connect-src to https://world.openfoodfacts.org only (SEC-001). |

## **4.4 ScoreEngine**

|  |
| --- |
| **[Component] ScoreEngine**  *2023 FSA-NPS algorithm: five-category scoring, letter grade output* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| REQUIRED | NutritionalProfileInputPort | socket [ | Receives NutritionalProfile (7 fields) + FSAProductCategoryCode from BackgroundServiceWorker. FSAProductCategoryCode MUST be present before scoring begins (BR-101: category-first architecture). |
| PROVIDED | ScoringPort | lollipop O-- | Returns NutritionalScore {LetterGrade: A|B|C|D|E|UNSCORED, NumericScore: Integer, FSACategoryUsed: Enum, AlgorithmVersion: "FSA-NPS-2023"} to BackgroundServiceWorker. |

|  |
| --- |
| **! Algorithm constraint (BR-102):** ScoreEngine MUST implement the 2023 FSA-NPS revision (SPF workbook, 4 April 2024). The 2017 algorithm is deprecated for products placed on market after January 2024. Five distinct formula paths are required: GENERAL\_FOOD (N<11 rule), RED\_MEAT (protein capped at 2 pts), CHEESE (always N-P), ADDED\_FAT (SFA-to-total-fat ratio; N<7 rule), BEVERAGE (sweetener +4 penalty; water flag). AlgorithmVersion="FSA-NPS-2023" is mandatory in every NutritionalScore output (BR-102). |

## **4.5 FoodClassifier**

|  |
| --- |
| **[Component] FoodClassifier**  *FSAProductCategory assignment and SPF exclusion gate* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| REQUIRED | ProductMetadataInputPort | socket [ | Receives NutritionalProfile + ProductName string from BackgroundServiceWorker for category classification. |
| PROVIDED | ClassificationPort | lollipop O-- | Returns {FSAProductCategoryCode: GENERAL\_FOOD|RED\_MEAT|CHEESE|ADDED\_FAT|BEVERAGE, NOVAProcessingLevel: 1|2|3|4|null, IsExcluded: boolean} to BackgroundServiceWorker. |

|  |
| --- |
| **i Exclusion gate (BR-104, FR-007):** If IsExcluded = true, BackgroundServiceWorker immediately sends SCORE\_RESPONSE(suppressed=true) to ContentScript and UIWidget renders no badge. No ScoreEngine, DiseaseEngine, or AlternativesEngine call is made. Excluded categories (permanent SPF exclusions per EV-SCI-007): baby food (0-3 years), sports nutrition products, food for special medical purposes, dietary supplements, meal replacement products. |

## **4.6 DiseaseEngine**

|  |
| --- |
| **[Component] DiseaseEngine**  *DiseaseRule evaluation, HealthWarning generation, AI-003 disclaimer injection* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| REQUIRED | NutritionalProfileEvalPort | socket [ | Receives NutritionalProfile + UserProfile.HealthConditionToggles from BackgroundServiceWorker. |
| REQUIRED | DiseaseRuleStorePort | socket [ | Reads active DiseaseRules (DR-001 to DR-006) from bundled constants in disease-engine.ts. Not a runtime interface -- the rule set is compiled in. |
| PROVIDED | DiseaseEvaluationPort | lollipop O-- | Returns []HealthWarning to BackgroundServiceWorker. Each HealthWarning contains: HealthConditionCode, NutrientField, ActualValue, ThresholdValue, AlertSeverityLevel, plain-language warning text (Flesch-Kincaid Grade <=8), and the AI-003 disclaimer string. |

Active DiseaseRule threshold values (seeded in disease-engine.ts; pending KNDI review in Phase 5):

| **Rule ID** | **HealthConditionCode** | **NutrientField** | **Threshold** | **Unit** | **Severity** | **Requirement** |
| --- | --- | --- | --- | --- | --- | --- |
| DR-001 | DIABETES | SugarsG | >22.5 | g/100g | FLAG | FR-009, EV-SCI-001 |
| DR-002 | HYPERTENSION | SodiumMG | >600 | mg/100g | FLAG | FR-010, EV-SCI-002 |
| DR-003 | CVD | SaturatedFatG | >5 (conj.) | g/100g | CAUTION | FR-011 |
| DR-004 | CVD | SodiumMG | >400 (conj.) | mg/100g | CAUTION | FR-011 |
| DR-005 | KIDNEY | Potassium | >200 (conj.) | mg/100g | WARNING | FR-012 |
| DR-006 | KIDNEY | SodiumMG | >600 (conj.) | mg/100g | WARNING | FR-012 |

## **4.7 AlternativesEngine**

|  |
| --- |
| **[Component] AlternativesEngine**  *Multi-factor alternative ranking, ExplanationText generation* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| REQUIRED | SourceProductInputPort | socket [ | Receives SourceGroceryProductID, FSAProductCategoryCode, and PriceKES from BackgroundServiceWorker. Only invoked for GroceryProducts with LetterGrade D or E. |
| REQUIRED | CandidateLookupPort | socket [ | Queries IndexedDBCache for GroceryProducts matching: same FSAProductCategoryCode (MANDATORY per BR-109), LetterGrade in {A, B, C}, PriceKES within +/-30% of source (widened to +/-50% if fewer than 3 results found). |
| PROVIDED | AlternativesPort | lollipop O-- | Returns ranked []AlternativeRecommendation to BackgroundServiceWorker. Each recommendation contains: AlternativeGroceryProductID, LetterGrade, FSAProductCategoryMatch=true, RelevanceScore (0.60\*GradeRank + 0.30\*CategoryMatch + 0.10\*PriceProximity), ExplanationText (Flesch-Kincaid <=8), AI-003 disclaimer. |

|  |
| --- |
| **i Category match is mandatory, not optional (BR-109):** Cross-category comparisons are scientifically invalid Nutri-Score comparisons. The FSAProductCategoryCode filter is the first filter applied, before grade or price. AlternativesEngine will not return a result from a different FSAProductCategory regardless of price proximity or LetterGrade. |

## **4.8 IndexedDBCache**

|  |
| --- |
| **[Component] IndexedDBCache**  *Local browser storage: profiles, scores, history, user preferences* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| PROVIDED | CacheReadWritePort | lollipop O-- | Exposes get(key), set(key, value, TTL), delete(key), clear(), and query(filter) operations to BackgroundServiceWorker. Key format: GroceryProductID (deterministic UUID hash). |
| PROVIDED | HistoryWritePort | lollipop O-- | Accepts ShoppingHistory records (GroceryProductID, NutritionalScoreLetterGrade, ScannedAt, UserID) after UserProfile.ConsentGrantedAt is confirmed set (DATA-002 enforcement). |
| PROVIDED | UserProfilePort | lollipop O-- | Accepts UserProfile writes (HealthConditionToggles, ConsentGrantedAt, ConsentVersion) from BackgroundServiceWorker. Never transmitted externally. |

IndexedDBCache store schema (DATA-001 data minimisation):

| **Store Name** | **Key** | **Value Schema** | **Data Minimisation Rule** |
| --- | --- | --- | --- |
| products | GroceryProductID | GroceryProduct (ProductName, FSAProductCategoryCode, PriceKES, IsExcluded, RetailerCode, CachedAt) | No PII. ProductName is used only as an OFacts query string -- not linked to any user identity. |
| profiles | GroceryProductID | NutritionalProfile (exactly 7 fields: EnergyKJ, SugarsG, SaturatedFatG, SodiumMG, ProteinG, FibreG, FVLPercent + DataSourceCode + FibreGEstimated + LastUpdated) | Exactly 7 nutrient fields per DATA-001. API response parser strips all other OFacts fields before storage. |
| scores | GroceryProductID | NutritionalScore (LetterGrade, NumericScore, FSACategoryUsed, AlgorithmVersion, ScoredAt) | No PII. Score is a computed output -- not a user data item. |
| history | HistoryID | ShoppingHistory (UserID, GroceryProductID, NutritionalScoreLetterGrade, ScannedAt) | Only recorded after ConsentGrantedAt is set (DATA-002). Deleted on user request within 1 second (DATA-003, TC-DEL). |
| userProfile | UserID | UserProfile (HealthConditionToggles JSON, ConsentGrantedAt, ConsentVersion) | HealthConditionToggles are system classification codes -- not medical diagnoses. Never transmitted externally (DATA-004, SEC-003). |

## **4.9 KenyanFallbackDatabase**

|  |
| --- |
| **[Component] KenyanFallbackDatabase**  *Bundled JSON: 200+ Kenyan-market products with all 7 NutritionalProfile fields* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| PROVIDED | FallbackLookupPort | lollipop O-- | Exposes get(ProductName) -> NutritionalProfile | null to BackgroundServiceWorker. Called only when OpenFoodFactsAPI returns no match or times out (>3s). Response time target: <100ms (bundled JSON, no network call). |

|  |
| --- |
| **! Critical path status (EV-SCI-012, EV-003):** KenyanFallbackDatabase is load-bearing, not supplementary. Open Food Facts has sparse coverage of Kenyan-market brands (Kabras, Kenchic, Kimbo, Unga) per Phase 1 API testing. Recommendation quality is bounded by database coverage -- a finding from peer-reviewed AINR research (Kalpakoglou et al. 2025). Minimum 200 entries required before Phase 7 development begins (Project Plan Gate G5). FibreG must be included for all entries, estimated from food composition tables where direct measurements are unavailable (BR-105, EV-SCI-008). |

## **4.10 OpenFoodFactsAPI**

|  |
| --- |
| **[Component] OpenFoodFactsAPI**  *External HTTPS API: global open nutrition database (CC BY-SA 4.0)* |

| **Direction** | **Interface Name** | **Type** | **Description** |
| --- | --- | --- | --- |
| PROVIDED | NutritionLookupPort | lollipop O-- | Accepts HTTPS GET /api/v2/search?query={ProductName}. Returns NutritionalProfile JSON (7 required fields + nova\_group) or empty result. Timeout: 3 seconds. Rate limit: 100 req/min (request deduplication in BackgroundServiceWorker prevents limit breaches). |

| **Integration Parameter** | **Value** |
| --- | --- |
| Base URL | https://world.openfoodfacts.org |
| Endpoint | /api/v2/search?query={ProductName}&fields=energy\_kj,sugars\_100g,saturated-fat\_100g,sodium\_100g,proteins\_100g,fiber\_100g,nova\_group |
| Protocol | HTTPS only (SEC-001). HTTP fallback disabled in CSP. |
| Authentication | None required for free tier. User-Agent header set to identify NUT-04 extension per Open Food Facts policy. |
| Timeout | 3 seconds. On timeout: KenyanFallbackDatabase queried. If fallback also misses: NFR-008 grey badge rendered. |
| Rate limit | 100 requests per minute. Mitigated by: (1) request deduplication via GroceryProductID hash in BackgroundServiceWorker; (2) 7-day IndexedDBCache TTL prevents repeat API calls for same product. |
| Licence | Open Food Facts data: CC BY-SA 4.0. Attribution required in extension credits and Privacy Policy (Phase 9 deliverable). |
| Data fields returned | energy\_kj, sugars\_100g, saturated-fat\_100g (SaturatedFatG), sodium\_100g (converted to mg), proteins\_100g, fiber\_100g, nova\_group. All other fields stripped by BackgroundServiceWorker response parser before IndexedDBCache write (DATA-001). |

# **5. Assembly Connectors and Operational Workflow**

This section documents all assembly connectors (provided interface mated with required interface) and the operational message flow that implements the NutriScore scoring workflow from GroceryProduct detection to UIWidget render.

## **5.1 Connector Register**

| **ID** | **Provider Component** | **Provided Interface** | **Consumer Component** | **Data Payload / Description** |
| --- | --- | --- | --- | --- |
| AC-001 | ContentScript | ProductDetectionPort | BackgroundServiceWorker | SCORE\_REQUEST: {GroceryProductID, ProductName, RetailerCode, PriceKES}. Fired by MutationObserver (300ms debounce) on new GroceryProduct DOM element (FR-001). |
| AC-002 | BackgroundServiceWorker | RoutingPort | ContentScript | SCORE\_RESPONSE: {NutritionalScore, NOVAProcessingLevel, []HealthWarning}. Returned to ContentScript for relay to UIWidget. Total latency <= 2 seconds (NFR-001). |
| AC-003 | UIWidget | UserInteractionPort | ContentScript | User events: badge click, "See alternatives" trigger, settings open, consent decision. One-way flow from UIWidget to ContentScript to BackgroundServiceWorker. |
| AC-004 | IndexedDBCache | CacheReadWritePort | BackgroundServiceWorker | Cache check: get(GroceryProductID). Cache hit (age <7 days) -> skip to AC-002. Cache miss -> proceed to AC-005. |
| AC-005 | OpenFoodFactsAPI | NutritionLookupPort | BackgroundServiceWorker | GET /api/v2/search?query={ProductName}. Returns NutritionalProfile or empty result. HTTPS only. No user identifier in request (DATA-004). |
| AC-006 | KenyanFallbackDatabase | FallbackLookupPort | BackgroundServiceWorker | get(ProductName) -> NutritionalProfile | null. Only called when AC-005 returns no match or times out (>3s). |
| AC-007 | BackgroundServiceWorker | RoutingPort | FoodClassifier | Forwards NutritionalProfile + ProductName for FSAProductCategory assignment and SPF exclusion gate check. MUST be called before ScoreEngine (BR-101). |
| AC-008 | FoodClassifier | ClassificationPort | BackgroundServiceWorker | {FSAProductCategoryCode, NOVAProcessingLevel, IsExcluded}. If IsExcluded=true: AC-002 returns suppressed=true immediately; no AC-009 to AC-012 calls made. |
| AC-009 | BackgroundServiceWorker | RoutingPort | ScoreEngine | Forwards NutritionalProfile + FSAProductCategoryCode (from AC-008) to ScoreEngine. FSAProductCategoryCode required in payload (BR-101). |
| AC-010 | ScoreEngine | ScoringPort | BackgroundServiceWorker | NutritionalScore {LetterGrade, NumericScore, FSACategoryUsed, AlgorithmVersion="FSA-NPS-2023"}. AlgorithmVersion validated before caching. |
| AC-011 | BackgroundServiceWorker | RoutingPort | DiseaseEngine | Forwards NutritionalProfile + UserProfile.HealthConditionToggles. DiseaseEngine evaluates all active DiseaseRules in parallel with AC-009. |
| AC-012 | DiseaseEngine | DiseaseEvaluationPort | BackgroundServiceWorker | []HealthWarning. Zero items = no thresholds exceeded. Each item contains ActualValue, ThresholdValue, plain-language text, AI-003 disclaimer. |
| AC-013 | BackgroundServiceWorker | AlternativesRoutingPort | AlternativesEngine | ALTERNATIVES\_REQUEST: {SourceGroceryProductID, FSAProductCategoryCode, PriceKES}. Only dispatched when Consumer clicks "See alternatives" AND LetterGrade is D or E. |
| AC-014 | AlternativesEngine | AlternativesPort | BackgroundServiceWorker | []AlternativeRecommendation (top 3+). Each item: AlternativeGroceryProductID, LetterGrade, RelevanceScore, ExplanationText, AI-003 disclaimer. FSAProductCategoryMatch=true on every item (BR-109). |
| AC-015 | IndexedDBCache | CacheReadWritePort | BackgroundServiceWorker | Cache write after AC-010: set(GroceryProductID, {NutritionalProfile, NutritionalScore}, TTL=7days). Only 7 NutritionalProfile fields written (DATA-001). |
| AC-016 | IndexedDBCache | HistoryWritePort | BackgroundServiceWorker | ShoppingHistory record written after AC-015 only if UserProfile.ConsentGrantedAt is set (DATA-002 enforcement). |

## **5.2 Operational Message Flow (Happy Path)**

The following numbered sequence describes the complete operational workflow from GroceryProduct detection to UIWidget render. This corresponds to System Sequence Diagram SD-001 in the System Sequence Catalogue.

1. Consumer opens a Naivas.co.ke product listing page. ContentScript MutationObserver fires after 300ms debounce, detecting a GroceryProduct DOM element. [FR-001]
2. ContentScript sends SCORE\_REQUEST {GroceryProductID, ProductName, RetailerCode, PriceKES} to BackgroundServiceWorker via chrome.runtime.sendMessage. [AC-001]
3. BackgroundServiceWorker checks IndexedDBCache.get(GroceryProductID). If cache hit (age <7 days): skip to step 10. [AC-004]
4. On cache miss: BackgroundServiceWorker calls OpenFoodFactsAPI GET /api/v2/search?query={ProductName}. Request: HTTPS only; no user identifier. [AC-005, SEC-001, DATA-004]
5. If OpenFoodFactsAPI returns no result or times out (>3s): BackgroundServiceWorker calls KenyanFallbackDatabase.get(ProductName). [AC-006, FR-002]
6. If KenyanFallbackDatabase also returns null: BackgroundServiceWorker sends SCORE\_RESPONSE {LetterGrade=UNSCORED} to ContentScript. UIWidget renders grey "?" badge. [NFR-008] -- END of flow for this product.
7. NutritionalProfile (7 fields) received. BackgroundServiceWorker calls FoodClassifier.classify(NutritionalProfile, ProductName). [AC-007, FR-006]
8. FoodClassifier assigns FSAProductCategoryCode and NOVAProcessingLevel; checks SPF exclusion gate. If IsExcluded=true: SCORE\_RESPONSE {suppressed=true} sent; UIWidget renders no badge. [AC-008, FR-007, BR-104] -- END for excluded products.
9. BackgroundServiceWorker dispatches in parallel: (a) ScoreEngine.score(NutritionalProfile, FSAProductCategoryCode) [AC-009, FR-003] and (b) DiseaseEngine.evaluate(NutritionalProfile, HealthConditionToggles) [AC-011, FR-005].
10. ScoreEngine computes NutritionalScore using 2023 FSA-NPS formula for FSAProductCategoryCode. Returns NutritionalScore {LetterGrade, NumericScore, AlgorithmVersion="FSA-NPS-2023"}. [AC-010]
11. DiseaseEngine evaluates all active DiseaseRules. Returns []HealthWarning (may be empty). Each HealthWarning includes AI-003 disclaimer text. [AC-012, AI-003]
12. BackgroundServiceWorker writes NutritionalProfile + NutritionalScore to IndexedDBCache (7-day TTL). If ConsentGrantedAt is set, ShoppingHistory record also written. [AC-015, AC-016, DATA-001, DATA-002]
13. BackgroundServiceWorker sends SCORE\_RESPONSE {NutritionalScore, NOVAProcessingLevel, []HealthWarning} to ContentScript via chrome.runtime.sendMessage. [AC-002]
14. ContentScript passes SCORE\_RESPONSE to UIWidget. UIWidget renders: (a) NutritionalScore badge (colour + letter via CSS custom properties), (b) NOVAProcessingLevel tag, (c) HealthWarning panels if []HealthWarning is non-empty. [FR-004, FR-008, FR-005, NFR-002, NFR-006, ACC-001]
15. Total elapsed time steps 1-14: <= 2 seconds on 25 Mbps 4G connection. CLS = 0.00 (Shadow DOM encapsulation). [NFR-001, NFR-002]

## **5.3 Alternative Flow: Consumer Requests Alternatives (SD-002)**

1. Consumer clicks "See healthier alternatives" in UIWidget for a GroceryProduct with LetterGrade D or E.
2. UIWidget sends ALTERNATIVES\_REQUEST via ContentScript to BackgroundServiceWorker: {SourceGroceryProductID, FSAProductCategoryCode, PriceKES}. [AC-013, FR-013]
3. BackgroundServiceWorker dispatches to AlternativesEngine. AlternativesEngine queries IndexedDBCache for candidates with: same FSAProductCategoryCode (MANDATORY, BR-109), LetterGrade in {A,B,C}, PriceKES within +/-30%.
4. If fewer than 3 candidates within 30%: widen price filter to +/-50%.
5. AlternativesEngine ranks candidates by RelevanceScore = 0.60\*(LetterGradeRank) + 0.30\*(CategoryMatch) + 0.10\*(PriceProximity). Generates ExplanationText per AI-002 for each.
6. BackgroundServiceWorker sends ALTERNATIVES\_RESPONSE {[]AlternativeRecommendation} to ContentScript to UIWidget. [AC-014]
7. UIWidget renders alternatives drawer: >=3 AlternativeRecommendation cards, each with NutritionalScore badge, ExplanationText, and AI-003 disclaimer.

# **6. Architectural Layer Summary**

## **6.1 Client / Frontend Extension Layer**

This layer runs entirely inside the Chrome browser extension sandbox. It has no server-side components. Communication between ContentScript and BackgroundServiceWorker uses the Chrome Extension Runtime Messaging API (chrome.runtime.sendMessage / chrome.runtime.onMessage). Communication between UIWidget and ContentScript is mediated by ContentScript -- UIWidget never communicates directly with BackgroundServiceWorker.

| **Component** | **Provided Interfaces** | **Required Interfaces** |
| --- | --- | --- |
| UIWidget | UserInteractionPort, ConsentPort | RenderDataPort, AlternativeDataPort |
| ContentScript | ProductDetectionPort, WidgetRenderPort | ScoreResponsePort |
| BackgroundServiceWorker | RoutingPort, CacheManagementPort, AlternativesRoutingPort | NutritionLookupPort, ScoringPort, ClassificationPort, DiseaseEvaluationPort, AlternativesPort, CacheReadWritePort |

## **6.2 Core Logic Layer**

The four engine components are stateless and pure-function in nature: given the same inputs, they always produce the same outputs. This makes them independently unit-testable and replaceable without affecting other layers. None of the engines read from or write to IndexedDBCache directly -- all cache operations are handled by BackgroundServiceWorker (separation of concerns).

| **Component** | **Provided Interfaces** | **Required Interfaces** |
| --- | --- | --- |
| ScoreEngine | ScoringPort | NutritionalProfileInputPort |
| FoodClassifier | ClassificationPort | ProductMetadataInputPort |
| DiseaseEngine | DiseaseEvaluationPort | NutritionalProfileEvalPort, DiseaseRuleStorePort (bundled constants) |
| AlternativesEngine | AlternativesPort | SourceProductInputPort, CandidateLookupPort |

## **6.3 Data & Integration Layer**

This layer manages all data persistence and external data access. IndexedDBCache is the only persistent store and it is strictly local to the Consumer device. OpenFoodFactsAPI is the only external network dependency; all other data access is either local cache or bundled JSON.

| **Component** | **Provided Interfaces** | **Required Interfaces** |
| --- | --- | --- |
| IndexedDBCache | CacheReadWritePort, HistoryWritePort, UserProfilePort | None (data originates from BackgroundServiceWorker) |
| KenyanFallbackDatabase | FallbackLookupPort | None (bundled JSON, no external dependency) |
| OpenFoodFactsAPI | NutritionLookupPort | None (external service; HTTPS only) |

# **7. Data Model Entities**

The following eight canonical data entities flow between components across assembly connectors. All entity names are as defined in the Project Domain Model v2.0 and Data Dictionary v2.0.

| **Entity** | **Produced By** | **Consumed By** | **Key Fields** | **Requirement** |
| --- | --- | --- | --- | --- |
| GroceryProduct | ContentScript (DOM scrape) | BackgroundServiceWorker, FoodClassifier, AlternativesEngine, IndexedDBCache | GroceryProductID, ProductName, FSAProductCategoryCode, NOVAProcessingLevelCode, PriceKES, IsExcluded, RetailerCode | FR-001, FR-006, FR-007 |
| NutritionalProfile | OpenFoodFactsAPI or KenyanFallbackDatabase (parsed by BackgroundServiceWorker) | ScoreEngine, DiseaseEngine, IndexedDBCache (7 fields only, DATA-001) | EnergyKJ, SugarsG, SaturatedFatG, SodiumMG, ProteinG, FibreG, FVLPercent, DataSourceCode, FibreGEstimated | FR-002, DATA-001, EV-SCI-005 |
| NutritionalScore | ScoreEngine | BackgroundServiceWorker, UIWidget (via SCORE\_RESPONSE), IndexedDBCache, ShoppingHistory | LetterGrade (A-E|UNSCORED), NumericScore, FSACategoryUsed, AlgorithmVersion="FSA-NPS-2023", ScoredAt | FR-003, EV-SCI-005/006 |
| FSAProductCategory | FoodClassifier | ScoreEngine (required before scoring, BR-101), AlternativesEngine (mandatory filter, BR-109) | GENERAL\_FOOD | RED\_MEAT | CHEESE | ADDED\_FAT | BEVERAGE | FR-006, EV-SCI-006 |
| NOVAProcessingLevel | FoodClassifier (from NutritionalProfile.nova\_group) | UIWidget (secondary badge tag) | 1=Unprocessed, 2=Culinary Ingredient, 3=Processed, 4=Ultra-Processed; null if unavailable | FR-008, EV-SCI-004 |
| DiseaseRule | Bundled constants in disease-engine.ts (DR-001 to DR-006) | DiseaseEngine (evaluation loop) | DiseaseRuleID, HealthConditionCode, NutrientField, ThresholdValue, ThresholdUnit, AlertSeverityLevel, RequiresConjunction | FR-005, FR-009-012, EV-SCI-001/002 |
| HealthWarning | DiseaseEngine | BackgroundServiceWorker, UIWidget (warning panel rendering) | HealthConditionCode, NutrientField, ActualValue, ThresholdValue, AlertSeverityLevel, plain-language text, AI-003 disclaimer | FR-005, AI-003, EV-SCI-001/002 |
| AlternativeRecommendation | AlternativesEngine | BackgroundServiceWorker, UIWidget (alternatives drawer) | SourceGroceryProductID, AlternativeGroceryProductID, LetterGrade, FSAProductCategoryMatch=true, RelevanceScore, ExplanationText, AI-003 disclaimer | FR-013, AI-001, AI-002 |

# **8. PlantUML Source Code**

The following PlantUML code renders the **original v1.0 baseline** component diagram (design intent, not current status — see the reconciliation note near the top of this document) in any PlantUML-compatible tool (plantuml.com, VS Code PlantUML extension, IntelliJ IDEA, or a local PlantUML install). GitHub does not render PlantUML natively — paste this block into a PlantUML renderer, not into a GitHub preview. It is reproduced here as a properly fenced code block (the prior revision embedded it inside a single-cell Markdown table, which most Markdown renderers, including GitHub's, do not expand into a readable code block).

```plantuml
@startuml NutriScore_Component_Diagram
skinparam componentStyle rectangle
skinparam ArrowColor #5B21B6
skinparam ArrowFontColor #374151
skinparam ArrowFontSize 11
skinparam PackageBorderColor #9CA3AF
skinparam PackageBorderThickness 1
skinparam PackageFontStyle italic
skinparam ComponentBackgroundColor #FFFFFF
skinparam ComponentBorderColor #D1D5DB
skinparam ComponentBorderThickness 1
skinparam defaultFontName Arial
skinparam defaultFontSize 12

' ── DATA ENTITIES (stereotyped components) ──────────────
component GroceryProduct <<entity>> as GP
component NutritionalProfile <<entity>> as NP
component NutritionalScore <<entity>> as NS
component FSAProductCategory <<entity>> as FPC
component NOVAProcessingLevel <<entity>> as NOVA
component DiseaseRule <<entity>> as DR
component HealthWarning <<entity>> as HW
component AlternativeRecommendation <<entity>> as AR

' ── LAYER 1: CLIENT / FRONTEND EXTENSION ────────────────
package "Client / Frontend Extension Layer" #EDE9FE {
  component [UIWidget] as UIW {
    port UserInteractionPort
    port ConsentPort
  }
  component [ContentScript] as CS {
    port ProductDetectionPort
    port WidgetRenderPort
  }
  component [BackgroundServiceWorker] as BSW {
    port RoutingPort
    port CacheManagementPort
    port AlternativesRoutingPort
  }
  UIW -right-> CS : trigger / events [AC-003]
  CS -down-> BSW : SCORE_REQUEST [AC-001]
  BSW .up.> CS : SCORE_RESPONSE [AC-002]
}

' ── LAYER 2: CORE LOGIC ENGINES ─────────────────────────
package "Core Logic Layer" #D6EEEE {
  component [ScoreEngine] as SE { port ScoringPort }
  component [FoodClassifier] as FC { port ClassificationPort }
  component [DiseaseEngine] as DE { port DiseaseEvaluationPort }
  component [AlternativesEngine] as AE { port AlternativesPort }
}

' ── LAYER 3: DATA & INTEGRATION ─────────────────────────
package "Data & Integration Layer" #FEF3C7 {
  component [IndexedDBCache] as IDB {
    port CacheReadWritePort
    port HistoryWritePort
    port UserProfilePort
  }
  component [KenyanFallbackDatabase] as KFB { port FallbackLookupPort }
  component [OpenFoodFactsAPI] as OFA { port NutritionLookupPort }
}

' ── ASSEMBLY CONNECTORS ──────────────────────────────────
BSW -down-> FC  : classify(NP, ProductName) [AC-007]
FC  .up.> BSW   : FSAProductCategory, IsExcluded [AC-008]
BSW -down-> SE  : score(NP, FSAProductCategory) [AC-009]
SE  .up.> BSW   : NutritionalScore [AC-010]
BSW -down-> DE  : evaluate(NP, Toggles) [AC-011]
DE  .up.> BSW   : []HealthWarning [AC-012]
BSW -down-> AE  : findAlternatives(GroceryProductID, FPC, Price) [AC-013]
AE  .up.> BSW   : []AlternativeRecommendation [AC-014]
BSW <-right-> IDB : cache read/write [AC-004, AC-015, AC-016]
BSW .right.> OFA  : GET /api/v2/search [AC-005]
BSW .right.> KFB  : fallback.get(ProductName) [AC-006]

' ── ENTITY ASSOCIATIONS (dashed) ────────────────────────
GP ..> NP  : has
NP ..> NS  : scored into
NP ..> FPC : classified by FoodClassifier
NP ..> NOVA: tagged by FoodClassifier
DR ..> HW  : triggers (if threshold exceeded)
NS ..> AR  : ranked against (D/E grade triggers alternatives)
@enduml
```

# **9. Mermaid.js Source Code — Current Shipped Architecture**

The block below replaces the prior revision's Mermaid source. Two problems with the prior version are fixed here: first, it was embedded inside a single-cell Markdown table, which GitHub (and most Markdown renderers) does not expand into an interactive diagram — it rendered as flat text. Second, its content mirrored the June 2026 baseline (`OpenFoodFactsAPI`, `KenyanFallbackDatabase`, `SCORE_REQUEST`/`SCORE_RESPONSE`), none of which exists in the shipped build. This version is a standalone fenced code block (renders natively on GitHub, GitLab, and Notion) showing the **current** architecture: real component names, real message-action names, no dead nodes for integrations that were never built or have since been removed.

```mermaid
flowchart TD
    subgraph FE["Client / Frontend Extension"]
        direction LR
        ADAPT["Retailer Adapter<br/>naivas.js / carrefour.js"]:::frontend
        CS["ContentScript<br/>content.js"]:::frontend
        UI["Shared UI Renderer<br/>grade-colors.js + shared-ui.js<br/>+ React popup.tsx / dashboard.tsx"]:::frontend
    end

    subgraph SW["Background Service Worker"]
        direction LR
        ORCH["Orchestrator<br/>background.js"]:::frontend
    end

    subgraph CL["Core Logic Layer"]
        direction LR
        FC["FoodClassifier"]:::engine
        SE["ScoreEngine"]:::engine
        DE["DiseaseEngine"]:::engine
        AE["AlternativesEngine"]:::engine
    end

    subgraph DI["Data Layer"]
        direction LR
        IDB[("IndexedDB v8<br/>via db.js")]:::data
    end

    ADAPT --> CS
    CS --> UI
    CS <-->|"CHECK_PRODUCT_SCORE ⇄ result"| ORCH
    ORCH --> FC
    FC --> SE
    FC --> DE
    SE --> AE
    ORCH <-->|"read / write"| IDB
    AE -.->|"read candidates + live prices"| IDB

    classDef frontend fill:#EDE9FE,stroke:#5B21B6,color:#26215C
    classDef engine fill:#D6EEEE,stroke:#006B6B,color:#04342C
    classDef data fill:#FEF3C7,stroke:#B45309,color:#412402
```

**What changed vs. the baseline diagram in §8:** no `OpenFoodFactsAPI` or `KenyanFallbackDatabase` nodes (neither exists — every lookup resolves against the bundled dataset, ADR-005); no Firebase/Firestore node (added after this baseline, then fully removed, ADR-004); message labels use the real action names (`CHECK_PRODUCT_SCORE`, not `SCORE_REQUEST`/`SCORE_RESPONSE`); `AlternativesEngine` shows its real second read from `IndexedDB` for candidates and live cached prices, which no version of the UML/PlantUML diagram captured; `grade-colors.js` is included as a real shipped file.

# **10. Architecture-to-Requirements Traceability**

Every component and every assembly connector in this diagram traces to at least one requirement in NutriScore\_Requirements\_v2\_Evidence\_Linked (NUT-04, June 2026).

| **Component / Connector** | **Requirement ID(s)** | **Design Decision** | **Evidence Chain** |
| --- | --- | --- | --- |
| ContentScript MutationObserver | FR-001 | 300ms debounce; no business logic in ContentScript | EV-002: Carrefour/Naivas use React/Vue lazy loading -- synchronous DOMContentLoaded misses products |
| BackgroundServiceWorker cache-first strategy | FR-002, NFR-001 | IndexedDBCache checked before OpenFoodFactsAPI; 7-day TTL | EV-003: OFacts coverage sparse; cache prevents repeated API calls and reduces latency to meet 2s budget |
| ScoreEngine 2023 FSA-NPS, 5-category paths | FR-003, FR-006 | Category-first architecture; AlgorithmVersion="FSA-NPS-2023" mandatory | EV-SCI-005/006: 5 distinct scoring formulas; 2023 revision corrects 7 scientific deficiencies from 2017 baseline |
| FoodClassifier SPF exclusion gate | FR-007 | Exclusion gate fires before ScoreEngine -- no API call wasted on excluded products | EV-SCI-007: permanent SPF exclusions (baby food, sports nutrition, supplements, meal replacements) |
| DiseaseEngine DR-001 to DR-006 | FR-009, FR-010, FR-011, FR-012 | DiseaseRules are bundled constants (not user-editable); thresholds KNDI-reviewed in Phase 5 | EV-SCI-001 (sugar -> cancer risk); EV-SCI-002 (sodium -> CVD mortality) |
| AlternativesEngine FSAProductCategory mandatory filter | FR-013, AI-001 | Cross-category comparisons blocked at engine level (not UI level) | Nutri-Score design intent: comparisons only valid within same food category |
| AI-003 disclaimer in DiseaseEngine and AlternativesEngine outputs | AI-003 | Disclaimer injected by engine, not by UIWidget -- cannot be accidentally omitted in display | EV-SCI-013: IARC and Kalpakoglou et al. 2025 both mandate human oversight and prohibition on medical advice framing |
| IndexedDBCache only 7 NutritionalProfile fields | DATA-001 | BackgroundServiceWorker response parser strips all OFacts fields not in the 7-field schema before IndexedDBCache write | Kenya DPA 2019 data minimisation; only fields required by FSA-NPS 2023 algorithm are stored |
| OpenFoodFactsAPI: HTTPS only; no user identifier | DATA-004, SEC-001 | CSP connect-src restricts to https://world.openfoodfacts.org; no GroceryProductID or UserID in query string | Kenya DPA 2019; Chrome Web Store privacy disclosure requirements; OWASP ASVS 9.2 |
| Shadow DOM CSS encapsulation in UIWidget | NFR-002 | Prevents CLS > 0 on retailer pages; prevents CSS conflicts with retailer page styles | SN-007: retail partners require zero page disruption as condition of adoption |
| Adapter pattern (IRetailerAdapter) | NFR-005 | Each retailer has its own adapter file; ScoreEngine, DiseaseEngine, and UIWidget are never modified for new retailers | Phase 5 multi-retailer expansion; maintainability requirement |
| CSS custom properties for grade colours (no inline style strings) | NFR-006, SEC-002 | Prevents XSS via CSS injection; grade colours are design-system tokens not runtime strings | OWASP ASVS 1.14.6; Chrome Web Store security review |
| KenyanFallbackDatabase bundled JSON | FR-002, DATA-001 | No network call required for fallback lookup (<100ms response); all 7 fields present including estimated FibreG | EV-003: OFacts sparse for Kenyan brands; EV-SCI-008: FibreG required by FSA-NPS but not on Kenyan labels; EV-SCI-012: DB coverage is primary quality bottleneck |

# **11. Key Design Constraints and Rationale**

## **11.1 Category-First Architecture (BR-101)**

FoodClassifier MUST run and return FSAProductCategoryCode before ScoreEngine is called. This is not an optimisation preference -- it is a scientific correctness requirement. The 2023 FSA-NPS algorithm has five distinct formula paths (GENERAL\_FOOD, RED\_MEAT, CHEESE, ADDED\_FAT, BEVERAGE) with different N-points tables, P-points constraints, score-combining rules, and letter grade cut-offs (EV-SCI-006). Calling ScoreEngine without a category code, or defaulting all products to GENERAL\_FOOD, produces wrong grades for red meat (protein overcounted), cheese (wrong combining rule), added fats (wrong energy and SFA calculation), and beverages (wrong thresholds; sweetener penalty missed).

## **11.2 No Business Logic in ContentScript**

ContentScript contains only MutationObserver event handling, DOM scraping (ProductName, PriceKES, RetailerCode), message forwarding (SCORE\_REQUEST, SCORE\_RESPONSE relay), and UIWidget injection via chrome.tabs.executeScript. Zero nutritional calculation, classification, or disease evaluation logic lives here. This constraint ensures that adding a new retailer (Phase 5) requires only a new IRetailerAdapter file -- no changes to ContentScript (NFR-005).

## **11.3 No Direct Engine-to-Cache Communication**

None of the four engine components (ScoreEngine, FoodClassifier, DiseaseEngine, AlternativesEngine) read from or write to IndexedDBCache directly. All cache operations are routed through BackgroundServiceWorker. This enforces single-responsibility (engines are pure computation; BackgroundServiceWorker is the orchestrator) and makes the cache schema upgradeable without touching engine logic.

## **11.4 Single External Network Dependency**

OpenFoodFactsAPI is the only external network call in the entire system. KenyanFallbackDatabase is bundled JSON (no network). IndexedDBCache is local storage (no network). ShoppingHistory, UserProfile, and NutritionalScore are never transmitted to any server. This architectural choice was made to satisfy DATA-004 (no PII transmitted), SEC-001 (HTTPS only; single domain in CSP), and the Kenya Data Protection Act 2019 requirement that health data remain on the Consumer device.

## **11.5 Adapter Pattern for Retailer Extensibility (NFR-005)**

The IRetailerAdapter interface defines a contract for retailer-specific DOM scraping: {detectProducts(): GroceryProduct[], getRetailerCode(): RetailerCode}. Each retailer (Naivas, Carrefour Kenya) has its own adapter file implementing this interface. ContentScript imports the correct adapter based on the current tab URL. Adding a fourth or fifth retailer in future phases requires only a new adapter file -- zero changes to BackgroundServiceWorker, any engine, or UIWidget.

|  |
| --- |
| **\* Architecture baseline declaration (historical):** This Component Diagram constituted the Architecture Baseline v1.0 for NutriScore Checkout Tool (NUT-04) at the start of implementation (June 2026). It no longer describes the shipped system as-is — see the reconciliation note near the top of this document and `02_System_Architecture_NUT-04.md` for current, verified status. Treat the component boundaries and interface contracts below as the original design rationale, useful for understanding *why* the system was shaped this way, not as a conformance target for new work. Architecture Change Requests should be evaluated against the current System Architecture document, not against this baseline. |