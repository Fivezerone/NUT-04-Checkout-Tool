# NUT-04 — Nutri-Score Checkout Tool
## API Reference — Internal Extension Message Contract

> **Document Owner:** Kibet — Project Lead, NUT-04
> **Status:** In Review — Consolidated against evidence-linked requirements
> **Related Docs:** [PRD](./01_PRD_NUT-04.md) · [System Architecture](./02_System_Architecture_NUT-04.md) · [Engineering Runbook](./04_Engineering_Runbook_NUT-04.md)

---

## Change Log

| Version | Date | Author | Summary of Changes |
|---|---|---|---|
| 0.1 | — | — | Initial OpenAPI skeleton created |
| 1.0 | 2026-08-08 | Claude (doc pass) | Rewritten to document the real internal message-passing contract |
| 1.1 | 2026-08-10 | Claude (consolidation pass) | Replaced illustrative `DiseaseWarning` threshold examples with the actual verified DR-001–DR-006 values from `engine/disease-engine.js`; documented the confirmed FR-011/FR-012 divergence (independent single-nutrient warnings vs. the spec's combined AND-condition warnings); replaced the placeholder AI-003 disclaimer text with the verbatim shipped string; noted the FR-002 architectural pivot (no Open Food Facts call — see Architecture doc ADR-005) |

---

## A note on scope

This system has no HTTP backend. Every "endpoint" is a `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` action between a content script and the background service worker (plus one `onMessageExternal` action reserved for a future companion website). It is documented in OpenAPI shape for structural clarity only — `servers` and `securitySchemes` are intentionally empty, since neither concept has a real analogue here.

**Also note:** the requirements specification (`NutriScore_Requirements_v2_Evidence_Linked.md`, FR-002) describes an architecture where the background worker calls the Open Food Facts REST API and falls back to a local database. The shipped build contains no such call anywhere — every lookup below resolves entirely against the bundled local dataset. See the System Architecture document, ADR-005, for the reasoning and status of this divergence. No OFacts-related message action is documented below because none exists in the source.

---

```yaml
openapi: 3.1.0

info:
  title: NUT-04 NutriScore Internal Extension Message API
  description: >
    Documents the chrome.runtime.sendMessage / onMessage contract between
    NUT-04's content scripts and its background service worker. There is no
    network transport and no live third-party nutrition API call (see the
    System Architecture document's ADR-005).
  version: "1.1.0"
  contact:
    name: Kibet — Project Lead, NUT-04

servers: []
# No servers exist. All "calls" execute in-process via chrome.runtime.sendMessage.

tags:
  - name: Scoring
    description: Product scoring / classification / disease-flag / alternatives lookup
  - name: Cart
    description: Shopping-ledger cart lifecycle events
  - name: Sync
    description: Cross-device sync was originally planned via Firestore. That integration has since been fully removed from the codebase (no SDK, no sync module) — AUTH_SYNC below is documented as a dormant/reserved action, not a working feature.

components:
  securitySchemes: {}
  # Chrome scopes chrome.runtime messages to the extension's own origin
  # automatically. AUTH_SYNC was originally intended to be gated by Firebase
  # Authentication, but Firebase has since been fully removed from the
  # codebase — there is no SDK, no auth gate, and manifest.json does not
  # declare externally_connectable, so no external caller can reach it.

  schemas:

    ProductScorePayload:
      type: object
      required: [product_name]
      properties:
        product_name: { type: string }
        name_hash: { type: [string, "null"] }
        retailer_product_id: { type: [string, "null"] }
        url: { type: [string, "null"] }
        price: { type: [number, "null"], description: "Sent by content.js as prodInfo.price, extracted from the DOM at scan time. Cached into IndexedDB's price_cache store and later read back by AlternativesEngine for price-proximity filtering." }

    CartActionPayload:
      type: object
      required: [retailer, productId, product_name]
      properties:
        retailer: { type: string, enum: [NAIVAS, CARREFOUR] }
        productId: { type: string }
        product_name: { type: string }
        priceSnapshot: { type: number }
        quantity: { type: integer, default: 1 }
        url: { type: [string, "null"] }

    CartSyncPayload:
      type: object
      required: [retailer, items]
      properties:
        retailer: { type: string, enum: [NAIVAS, CARREFOUR] }
        items:
          type: array
          items: { $ref: "#/components/schemas/CartActionPayload" }

    RemoveCartItemPayload:
      type: object
      required: [retailer, productId]
      properties:
        retailer: { type: string, enum: [NAIVAS, CARREFOUR] }
        productId: { type: string }

    NutrientBreakdown:
      type: object
      properties:
        energy_kj: { type: number }
        fat_g: { type: number }
        sat_fat_g: { type: number }
        carbs_g: { type: number }
        sugars_g: { type: number }
        fibre_g: { type: number }
        protein_g: { type: number }
        sodium_mg: { type: number }
        # ⚠ No potassium field exists on the wire — DR-005 (kidney/potassium)
        # can never fire; the source object also has no PotassiumMG field
        # (see System Architecture §6.1). Cross-reference: PRD §4, FR-012.

    DiseaseWarning:
      type: object
      description: >
        One entry per DR-00x rule that fired, sourced from engine/disease-engine.js.
        Verified directly against source — these are the actual shipped values,
        not illustrative placeholders.
      properties:
        disease: { type: string, enum: [Diabetes, Hypertension, "Heart Disease (CVD)", "Kidney Disease"] }
        condition: { type: string }
        triggerQuantity: { type: string }
      x-verified-rules:
        DR-001 (Diabetes):      "settings.diabetes && sugars > 22.5"   # condition: "High sugar linked to glucose spikes"; triggerQuantity: ">22.5g"
        DR-002 (Hypertension):  "settings.hypertension && sodium > 600" # condition: "High sodium linked to high BP"; triggerQuantity: ">600mg"
        DR-003 (CVD):           "settings.cardiovascular && sat_fat > 5" # condition: "High sat fat increases LDL"; triggerQuantity: ">5g"
        DR-004 (CVD):           "settings.cardiovascular && sodium > 400 && sodium <= 600" # condition: "Moderate-high sodium impacts heart"; triggerQuantity: ">400mg"
        DR-005 (Kidney):        "settings.kidney && potassium > 200"   # condition: "High potassium needs monitoring"; triggerQuantity: ">200mg" — NEVER FIRES: background.js reads potassium via `nutrition.PotassiumMG ?? nutrition.Potassium?.ValueMG`, but no PotassiumMG field exists anywhere in the source schema, so the value always resolves to `null` (not a hardcoded 0). `null > 200` is always false in JavaScript, so the rule can never fire either way
        DR-006 (Kidney):        "settings.kidney && sodium > 600"      # condition: "High sodium strains compromised kidneys"; triggerQuantity: ">600mg"
      x-requirement-divergence: >
        FR-011 specifies ONE combined cardiovascular warning firing only when
        sat_fat > 5g AND sodium > 400mg are BOTH true. The shipped engine
        instead fires DR-003 and DR-004 as two independent single-nutrient
        warnings, neither requiring the other's condition. FR-012 has the
        same divergence for the two kidney rules (DR-005/DR-006).

    AlternativeProduct:
      type: object
      properties:
        AlternativeGroceryProductID: { type: string }
        LetterGrade: { type: string, enum: [A, B, C, D, E] }
        FSAProductCategoryMatch: { type: boolean }
        RelevanceScore: { type: string, description: "0.60*GradeRank + 0.30*CategoryMatch + 0.10*PriceProximity, formatted to 2dp — AI-001's multi-factor ranking, as designed" }
        ExplanationText: { type: string, description: "AI-002's explanation requirement" }
        PriceKES: { type: number }
      x-status: "Populated end-to-end in the shipped build — NutriScoreDB.getAllProducts() exists in db.js and background.js passes its result into AlternativesEngine.getAlternatives(). PriceKES is sourced from a live price_cache populated at scan time, not from the dataset's own (still all-zero) Price.CurrentPriceKES field, so this array is empty only for a product that hasn't been scanned/cached at least once. See PRD §4, FR-013."

    ScoredProduct:
      type: object
      properties:
        productId: { type: string }
        product_name: { type: string }
        retailer: { type: string, enum: [NAIVAS, CARREFOUR] }
        nutriscore_grade: { type: string, enum: [A, B, C, D, E, UNKNOWN] }
        score: { type: number }
        score_details: { type: object, properties: { N_Points: { type: number }, P_Points: { type: number } } }
        fsaCategory: { type: string, enum: [GENERAL_FOOD, RED_MEAT, CHEESE, ADDED_FAT, BEVERAGE] }
        # ⚠ No KNPM 25-category code field — EV-KE-001 requires one alongside
        # fsaCategory; not present in the shipped schema (see PRD §5.2).
        displayCategory: { type: string }
        isExcluded: { type: boolean, description: "SPF/DATA-005 exclusion gate result, computed at request time by FoodClassifier rather than read from a pre-tagged dataset field" }
        algorithmVersion: { type: string, example: "FSA-NPS-2023" }
        diseaseWarnings:
          type: array
          items: { $ref: "#/components/schemas/DiseaseWarning" }
        diseaseDisclaimer:
          type: string
          example: "This information is based on standard thresholds and is not medical advice. Consult a healthcare provider."
          description: >
            Verbatim shipped text (engine/disease-engine.js DISCLAIMER constant).
            AI-003's spec-suggested text is: "General nutritional information
            only — not medical advice. Consult a qualified nutritionist or
            physician for personalised dietary guidance." Functionally
            equivalent, not verbatim; not independently Flesch-Kincaid scored.
        alternatives:
          type: array
          items: { $ref: "#/components/schemas/AlternativeProduct" }
          description: "Populated whenever the product isn't SPF-excluded and at least one qualifying same-category, same-retailer alternative exists — see the AlternativeProduct x-status note above for the price-cache caveat"
        nutritional_profile_display: { $ref: "#/components/schemas/NutrientBreakdown" }
        confidence: { type: string, description: "See System Architecture §6.3 for the gap between this value's actual vocabulary and the spec's official 7-tier hierarchy" }
        canDisplayGrade: { type: boolean }
        validationStatus: { type: string }
        evidenceTier: { type: string }
        matchInfo:
          type: object
          properties:
            matched: { type: boolean }
            matchMethod: { type: string, enum: [product_id, url_path_fragment, url, exact_name, case_insensitive_name, normalized_name, none] }
            confidence: { type: string, enum: [high, medium, low, none] }

    ErrorResponse:
      type: object
      properties:
        status: { type: string, enum: [NOT_FOUND, ERROR] }
        data: { type: object }
        error: { type: string }

paths:

  /CHECK_PRODUCT_SCORE:
    post:
      tags: [Scoring]
      operationId: checkProductScore
      summary: Score a single product detected on a listing page
      description: >
        Sent by content.js for every newly detected, unscanned product card.
        Resolves the product via NutriScoreDB.resolveProductMatch against the
        LOCAL dataset only (see ADR-005 — no live API call), then runs
        FoodClassifier -> ScoreEngine -> DiseaseEngine -> AlternativesEngine.
      x-dispatch: "chrome.runtime.sendMessage({ action: 'CHECK_PRODUCT_SCORE', retailer, payload })"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ProductScorePayload" }
      responses:
        "200":
          description: Callback-delivered response (sendResponse), status SUCCESS or NOT_FOUND
          content:
            application/json:
              schema:
                oneOf:
                  - type: object
                    properties: { status: { const: SUCCESS }, data: { $ref: "#/components/schemas/ScoredProduct" } }
                  - $ref: "#/components/schemas/ErrorResponse"

  /LOG_CART_ADD:
    post:
      tags: [Cart]
      operationId: logCartAdd
      summary: Log a single add-to-cart event to the local shopping ledger
      x-dispatch: "chrome.runtime.sendMessage({ action: 'LOG_CART_ADD', payload })"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CartActionPayload" }
      responses:
        "204":
          description: No response is sent (fire-and-forget)

  /SYNC_CART_STATE:
    post:
      tags: [Cart]
      operationId: syncCartState
      summary: Reconcile the full observed cart against the local ledger
      x-dispatch: "chrome.runtime.sendMessage({ action: 'SYNC_CART_STATE', payload })"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CartSyncPayload" }
      responses:
        "200":
          description: "{ status: SUCCESS } or { status: ERROR, error }"

  /REMOVE_CART_ITEM:
    post:
      tags: [Cart]
      operationId: removeCartItem
      x-dispatch: "chrome.runtime.sendMessage({ action: 'REMOVE_CART_ITEM', payload })"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/RemoveCartItemPayload" }
      responses:
        "204":
          description: No response is sent

  /CART_CLEARED:
    post:
      tags: [Cart]
      operationId: cartCleared
      x-dispatch: "chrome.runtime.sendMessage({ action: 'CART_CLEARED', retailer })"
      responses:
        "204":
          description: No response is sent

  /ORDER_PLACED:
    post:
      tags: [Cart]
      operationId: orderPlaced
      x-dispatch: "chrome.runtime.sendMessage({ action: 'ORDER_PLACED', retailer })"
      responses:
        "204":
          description: No response is sent

  /GET_PAGE_STATS:
    post:
      tags: [Scoring]
      operationId: getPageStats
      x-dispatch: "chrome.runtime.sendMessage({ action: 'GET_PAGE_STATS' })"
      responses:
        "200":
          description: "{ count: number, retailer: string | null }"

  /AUTH_SYNC:
    post:
      tags: [Sync]
      operationId: authSync
      summary: "Reserved action name — authenticate the current user for cross-device ledger sync"
      description: >
        Documented for completeness only. No handler for `AUTH_SYNC` exists
        anywhere in the current source (searched `background.js`,
        `content.js`, and every content/popup/dashboard script) — this is not
        a "blocked" or "unreachable" endpoint so much as one that was never
        implemented. The Firestore-backed sync it was originally scoped for
        has since been fully removed from the codebase (System Architecture
        doc, ADR-004), and `manifest.json` still declares no
        `externally_connectable` entry, so even a future companion website
        could not reach it without further work.
      x-dispatch: "chrome.runtime.sendMessage(EXTENSION_ID, { type: 'AUTH_SYNC', user })"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                type: { const: AUTH_SYNC }
                user: { type: object, properties: { id: { type: string }, email: { type: string } } }
      responses:
        "200":
          description: "{ status: 'OK' } — hypothetical; no handler exists to produce this response today"
```

---

## Appendix — Fields Deliberately Left Out

- **`servers`** — omitted: there is no network transport.
- **`securitySchemes`** — omitted: Chrome enforces message-origin isolation natively.
- **Any OFacts-related action** — omitted: FR-002 as written describes calling this API; the shipped build does not (System Architecture, ADR-005).
- **Any Firestore-backed sync action beyond the reserved `AUTH_SYNC` name** — omitted: Firebase/Firestore has been fully removed from the codebase (System Architecture, ADR-004); no other sync-related message action was ever built.
- **Admin scoring-rule endpoints** — removed: there is no configurable scoring-rule service; FSA-NPS thresholds are hardcoded constants.
