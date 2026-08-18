# Technical Design Document (TDD): NutriScore Checkout Tool (Kenya)

## 1. System Overview

**High-Level Summary:**
The NutriScore Checkout Tool (Kenya) is a browser extension that intercepts grocery items on retailer websites (such as Naivas and Carrefour) to provide real-time nutritional grading and disease-specific dietary warnings. It evaluates product health risks locally, calculates a NutriScore grade, and suggests healthier alternatives directly within the shopper's e-commerce interface.

**Tech Stack:**
*   **Languages:** JavaScript (vanilla, `importScripts`-based for the service worker/content scripts/engines/adapters), TypeScript (application code for the popup and dashboard — `db.ts`, `domain.ts`, `nutriscore.ts`, `products.ts`, `analytics.ts`, not just build config), HTML, CSS.
*   **Frameworks & Build Tools:** **React** (popup + dashboard) via Vite, TailwindCSS. The requirements spec's NFR-004 mandates Preact instead — this is a confirmed, unreconciled conflict (see System Architecture doc ADR-006), not a "React/Preact" either-or in practice. What ships today is React.
*   **Storage:** IndexedDB (via the `idb` library, wrapped in `db.js`/`db.ts`) for local dataset storage, the shopping ledger, and a live scan-time price cache.
*   **Architecture:** Chrome Extension Manifest V3 (Background Service Worker, per-retailer Content Scripts, Options Page, and Popup). No server-side component and no external network calls exist in the current build — see §2 and §3.

---

## 2. Architecture Diagrams (Mermaid)

### System Context Diagram
```mermaid
graph TD
    User([Shopper]) -->|Browses & Adds to Cart| Browser[Browser Extension<br/>NutriScore Checkout Tool]
    Browser -->|Parses DOM & Injects Badges| Retailer[Retailer Website<br/>Naivas / Carrefour]
    Browser -->|Queries Local DB| LocalDB[(IndexedDB<br/>NutriScore Datasets)]
    Browser -->|Checks Settings| Options[Extension Dashboard<br/>Settings & User Profile]
```

### Container Diagram
```mermaid
flowchart LR
    subgraph PAGE["Retailer Page — Content-Script Context"]
        direction TB
        ADAPT["Retailer Adapter<br/><i>naivas.js / carrefour.js</i>"]
        CS["Content Script<br/><i>content.js</i>"]
        UI["Shared UI Renderer<br/><i>grade-colors.js + shared-ui.js</i>"]
        ADAPT <--> CS
        CS --> UI
    end

    subgraph WORKER["Service Worker — background.js"]
        direction TB
        ORCH(["Orchestrator<br/><i>getProductInfo()</i>"])
    end

    subgraph ENGINES["Core Engine Modules"]
        direction TB
        FC["FoodClassifier"]
        SE["ScoreEngine"]
        DE["DiseaseEngine"]
        AE["AlternativesEngine"]
    end

    DB[("IndexedDB v8<br/><i>via db.js</i>")]

    CS <-->|"CHECK_PRODUCT_SCORE ⇄ result"| ORCH
    ORCH --> FC
    FC --> SE
    FC --> DE
    SE --> AE
    ORCH <-->|read / write| DB
    AE -.->|read candidates + live prices| DB
```

*Note: `FoodClassifier` gates the pipeline — if a product is SPF-excluded, `ScoreEngine` and `AlternativesEngine` are skipped entirely and a `LetterGrade: "UNKNOWN"` result is returned; only `DiseaseEngine` still runs. No Firebase/Firestore container exists in the current build — it was scaffolded early on and has since been fully removed (see System Architecture doc, ADR-004).*

---

## 3. Data Flow Analysis

**Lifecycle of a Product Entity:**
1.  **Input:** The `NutriScoreContentEngine` (via `MutationObserver` in `content.js`) detects a new product DOM element on the retailer page. It delegates to the `RetailerAdapter` to extract metadata like `product_name`, `url`, `retailer_product_id`, and `price`.
2.  **Transmission:** The Content Script sends a message payload to the Background Service Worker (`background.js`) to evaluate the product.
3.  **Lookup & Caching:** The Service Worker queries `NutriScoreDB` to check if the product is already cached. If not, it executes `resolveProductMatch` to find the corresponding dataset entry locally.
4.  **Processing (Orchestration):** 
    *   `FoodClassifier.classify()` categorizes the item (e.g., Beverage vs. General Food).
    *   `DiseaseEngine.evaluate()` assesses the nutritional data against active disease warnings (Diabetes, Hypertension, etc.).
    *   `ScoreEngine.score()` calculates the final FSA-NPS numeric score and letter grade.
    *   `AlternativesEngine.getAlternatives()` finds healthier substitutes within the same category. It runs whenever the product isn't SPF-excluded — not only when the grade is poor — filtering candidates to a strictly better letter grade (or an equal A) and a price within ±30% (widened to ±50% if fewer than 3 results), using a live scan-time price cache rather than the static dataset's price field.
5.  **Output & UI Injection:** The enriched product object is cached and returned to the Content Script, which utilizes the adapter and `shared-ui.js` to render the interactive badge (Grade and Disease Warnings) back into the DOM.

### Level 1 Data Flow Diagram (DFD)
```mermaid
flowchart TD
    subgraph FE["Retailer Page Context"]
        OBS(["DOM MutationObserver"])
        EXT["Retailer Adapter<br/>extracts {id, name, price}"]
        INJ["UI Injector<br/>renders badge + warnings"]
    end

    subgraph BE["Service Worker Context"]
        MATCH["NutriScoreDB Matcher<br/>resolveProductMatch()"]
        CLASS["FoodClassifier"]
        DISEASE["DiseaseEngine"]
        SCORE["ScoreEngine"]
        ALTS["AlternativesEngine"]
    end

    DB[("IndexedDB<br/>datasets + price_cache")]

    OBS --> EXT
    EXT -->|CHECK_PRODUCT_SCORE| MATCH
    MATCH -.->|reads product record| DB
    MATCH --> CLASS
    CLASS -->|"category + isExcluded"| DISEASE
    CLASS -->|"category (skipped if excluded)"| SCORE
    SCORE -->|grade + score| ALTS
    ALTS -.->|reads candidates + live prices| DB
    DISEASE --> INJ
    ALTS --> INJ
```

**Correction from the prior revision of this diagram:** `DiseaseEngine` and `ScoreEngine` are independent, parallel branches off `FoodClassifier`'s output — `DiseaseEngine` does **not** feed into `ScoreEngine`, and disease warnings play no role in the score calculation. `AlternativesEngine` also performs its own read from `IndexedDB` (a full same-retailer product list plus cached live prices), which the prior diagram omitted entirely.

---

## 4. Component Deep Dive

### Background Service Worker (`background.js`)
*   **Responsibility:** Acts as the central orchestrator (Component Architecture v2.0). It handles all heavy lifting, enforces business logic, coordinates the various analysis engines, and manages communication with the databases and content scripts.
*   **Key Functions:**
    1.  `initializeDatabases()`: Bootstraps the IndexedDB environment via `NutriScoreDB` and imports static datasets if they are not already populated.
    2.  `getProductInfo(payload, retailerCode)`: The primary orchestration function. It takes raw product payloads, fetches matched records from the DB, routes them through the classifiers and engines, and returns the final computed score and alternatives.
    3.  `Message Listeners`: Listens for `chrome.runtime.onMessage` events, routing on `message.action`: `CHECK_PRODUCT_SCORE` (score a product), `LOG_CART_ADD`, `SYNC_CART_STATE`, `REMOVE_CART_ITEM`, `CART_CLEARED`, and `ORDER_PLACED` (cart/ledger lifecycle events from the frontend).

### NutriScore Content Engine (`content.js`)
*   **Responsibility:** The client-facing extension layer. It observes DOM mutations (debounced by 300ms to maintain performance), extracts product data using retailer-specific adapters, relays requests to the background worker, and handles UI interactions (flyouts, cart clicks) without containing any core business logic.
*   **Key Functions:**
    1.  `init()`: Sets up document-level click listeners for cart interactions, handles flyout UI state, and prepares the MutationObserver.
    2.  `scanAndInject()`: Triggered by the MutationObserver. It scans the DOM for unprocessed product cards and delegates to the adapter for data extraction and eventual UI injection.
    3.  `syncCart()`: Monitors the user's shopping cart state and relays lifecycle events (`LOG_CART_ADD`, `REMOVE_CART_ITEM`, `CART_CLEARED`) to the background worker.

### Sequence Diagram: Product Evaluation
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Page as Retailer DOM
    participant CS as Content Script (content.js)
    participant Adapter as Retailer Adapter (naivas.js)
    participant SW as Service Worker (background.js)
    participant DB as NutriScoreDB (db.js)
    participant Engines as Analysis Engines

    User->>Page: Scrolls to new products on page
    Page->>CS: MutationObserver triggered (addedNodes)
    CS->>Adapter: detectProducts()
    Adapter-->>CS: [{ product_name, retailer_product_id, price, domElement }]
    CS->>SW: sendMessage(action: "CHECK_PRODUCT_SCORE")

    SW->>DB: getCachedProduct(cacheKey)
    alt Product is cached
        DB-->>SW: cached result
    else Not cached
        SW->>DB: resolveProductMatch(retailer, id, url, name)
        DB-->>SW: Matched Product (Nutrition, Identity)
        SW->>Engines: FoodClassifier.classify()
        Engines-->>SW: { isExcluded, fsaCategory }
        SW->>Engines: DiseaseEngine.evaluate()
        Engines-->>SW: disease warnings
        opt Product not excluded
            SW->>Engines: ScoreEngine.score()
            Engines-->>SW: grade, numeric score
            SW->>DB: getAllProducts(retailer)
            DB-->>SW: same-retailer candidates + cached prices
            SW->>Engines: AlternativesEngine.getAlternatives()
            Engines-->>SW: ranked alternatives
        end
        SW->>DB: saveProduct(cacheKey, result)
    end

    SW-->>CS: { status: "SUCCESS", data: result }
    CS->>Adapter: injectBadge(card, result, price)
    Adapter->>Page: Renders NutriScore Badge & Warnings
```

**Corrections from the prior revision:** the message action is `CHECK_PRODUCT_SCORE`, not `GET_PRODUCT_INFO` — no `GET_PRODUCT_INFO` action exists anywhere in the source. The adapter's real entry point is the bulk `detectProducts()` scan (content.js calls it once per mutation batch and iterates the results), not a per-node `extractProduct(node)` method. `ScoreEngine` and `AlternativesEngine` only run when the product is not SPF-excluded, and `AlternativesEngine` requires its own `getAllProducts()` round trip to `IndexedDB` — both omitted from the prior version of this diagram.
