# NUT-04 — Nutri-Score Checkout Tool
## Product Requirements Document (PRD)

> **Document Owner:** Kibet — Project Lead, NUT-04 (JHUB Africa / AfyaVentures Internship Programme)
> **Status:** In Review — Consolidated against evidence-linked requirements and personas; pending Gate 0 client approval
> **Related Docs:** [System Architecture](./02_System_Architecture_NUT-04.md) · [API Reference](./03_API_Reference_NUT-04.md) · [Engineering Runbook](./04_Engineering_Runbook_NUT-04.md) · [Help Center](./05_Help_Center_NUT-04.md)
> **Reconciled against:** `NutriScore_Requirements_v2_Evidence_Linked.md` (v2.2, Data Governance Update) and `NUT04_User_Personas_Evidence_Grounded.md`, cross-checked line-by-line against the shipped `Fivezerone/NUTRISCORE` build

---

## Change Log

| Version | Date | Author | Summary of Changes |
|---|---|---|---|
| 0.1 | — | — | Initial skeleton created |
| 1.0 | 2026-08-08 | Claude (doc pass) | Fully populated from source-code analysis of the shipped extension build |
| 1.1 | 2026-08-10 | Claude (consolidation pass) | Replaced placeholder personas with the four evidence-grounded profiles (Peter K., John M., Grace N., Njeri W.); replaced the placeholder FR/NFR matrices with the actual FR-001–FR-013 / NFR-001–NFR-008 requirement set from v2.2 of the requirements spec; every requirement now carries a **Current Build Status** verified directly against source; rewrote the data-requirements section (formerly DATA-001's fixed 7-field "compressed" schema) to reflect the flexible, layered database design defined in the spec's own §10.5 Data Governance section, which the shipped dataset already resembles far more closely than DATA-001 as literally written |

---

## ⚠ How to read the "Current Build Status" columns in this document

Every requirement below carries one of four statuses, assigned only where directly verified against the shipped source (`background.js`, `content.js`, `db.js`, `engine/*.js`, `adapters/*.js`, `manifest.json`, and the canonical datasets):

| Status | Meaning |
|---|---|
| ✅ **Implemented** | Confirmed present and matching the requirement as written |
| 🟡 **Partial / Diverged** | Implemented in spirit, but the mechanism, exact values, or architecture differs from the spec — detailed inline |
| ❌ **Not Implemented** | Confirmed absent from the shipped source |
| ⬜ **Not Independently Verified** | Requires UI-bundle reverse-engineering or live testing beyond this review's scope (e.g. compiled React dashboard internals) |

---

## 1. Document Control

| Field | Value |
|---|---|
| Document Title | NUT-04 Nutri-Score Checkout Tool — Product Requirements Document |
| Version | 1.1 (this doc) — reconciled against Requirements Spec v2.2 |
| Status | In Review |
| Author(s) | Kibet (Project Lead) |
| Reviewers | JHUB Africa mentors, AfyaVentures programme reviewers, Kenya Nutritionists & Dieticians Institute (KNDI, planned Phase 2) |
| Approvers | JHUB Africa Student Innovation Development panel |
| Approval Date | Pending — Gate 0 client approval outstanding per the requirements spec's own document status |
| Distribution List | NUT-04 project team, JHUB Africa reviewers |

### 1.1 Approval Sign-off

| Role | Name | Signature / Approval | Date |
|---|---|---|---|
| Product Owner | Kibet | Pending | — |
| Engineering Lead | Kibet | Pending | — |
| Design Lead | — | Pending | — |
| Business Sponsor | JHUB Africa / AfyaVentures | Pending | — |

---

## 2. Executive Summary & Product Vision

### 2.1 Problem Statement (Evidence-Grounded)

For Kenyan online grocery shoppers — particularly the estimated 4.2 million Kenyans living with Type 2 diabetes (IDF 2021 modelled estimate; 3.1% by direct Kenya STEPS 2015 survey measurement) and the roughly 30% of urban adults with hypertension (23.8% nationally, Kenya STEPS 2015) — the absence of real-time, interpretable nutritional guidance on retail platforms such as Naivas.co.ke and Carrefour Kenya creates a preventable decision gap at the point of purchase, because nutrition information is hidden, inconsistently formatted, or entirely absent on product listing pages. This matters because IARC Evidence Summary Brief No.2 — drawing on the EPIC cohort of over 500,000 adults followed 15.3–17.2 years — links lower nutritional quality (higher FSAm-NPS scores) to a 7% increase in overall cancer risk and a 6% increase in overall mortality: outcomes that are demonstrably preventable through informed dietary choices at the point of purchase.

### 2.2 Product Vision Statement
Embed the scientifically validated Nutri-Score A–E grade (2023 FSA-NPS revision), disease-specific health warnings, and multi-factor healthier-alternative suggestions directly into the Kenyan online grocery checkout experience — reaching not only the diagnosed population but the much larger undiagnosed majority the general grade is validated for independent of diagnosis.

### 2.3 Strategic Alignment
NUT-04 is delivered under JHUB Africa's Student Innovation Development framework, as part of the AfyaVentures internship programme. Per the Global Nutrition Report's NACS taxonomy (EV-SCI-009), NUT-04 is a **Policy action** in two sub-categories — Food Environment (front-of-pack labelling) and Consumer Knowledge (diet-quality assessment tools) — targeting the **Impact** category of obesity and diet-related NCDs. This is the framing to use with JHUB Africa leadership, retailer partners, and Kenya Ministry of Health contacts: a measurable digital nutrition-policy intervention with a published scientific evidence base, not merely a browser extension.

### 2.4 Scope

| In Scope                                                                                                                       | Out of Scope (current build)                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome Manifest V3 extension: content-script badge injection, popup, options-page dashboard                                    | Companion marketing/auth website (`nutriscore.co.ke`) — not yet built                                                                                                                     |
| FSA-NPS 2023 scoring engine, food classifier, disease-flag engine                                                              | Firefox / Safari / mobile browser support                                                                                                                                                 |
| Naivas Online and Carrefour Kenya retailer adapters                                                                            | Retailers beyond Naivas and Carrefour Kenya (Jumia Food referenced in the problem statement is not yet a supported adapter)                                                               |
| Local IndexedDB shopping ledger and personal analytics dashboard                                                               | Live retailer price-feed integration                                                                                                                                                      |
| Curated offline nutrition dataset (~9,274 combined SKUs) sourced against KFCT 2018, layered per §10.5 of the requirements spec | Server-side backend of any kind — the extension is 100% client-side today, which is itself a deliberate departure from FR-002's literal OFacts-API-primary design (see §4, FR-002 status) |
| —                                                                                                                               | Cross-device ledger sync — a Firebase/Firestore integration was scaffolded early on but has since been **fully removed** from the codebase (no `firebase-sync.js` source, no Firebase reference in `manifest.json`, `background.js`, or any content script); no sync mechanism ships today — see Architecture doc ADR-004 |
| —                                                                                                                               | Kenya Nutrient Profile Model (KNPM) 25-category code alongside the FSA-NPS 5-category code (EV-KE-001) — not yet present in the shipped classifier                                        |
| —                                                                                                                               | County-level NCD-burden weighting (explicitly scoped Could/Won't-this-phase per EV-KE-008)                                                                                                |

### 2.5 Assumptions & Constraints
- **Assumption:** Naivas (Magento 2 + Livewire) and Carrefour Kenya (Next.js + SAP Commerce Cloud) retain their current DOM structure closely enough for the hardcoded adapter selectors to keep working.
- **Assumption:** All scoring/classification logic can run entirely client-side against a static, periodically-refreshed dataset — the requirements spec's original architecture (§10) assumed a live Open Food Facts API call with local fallback; the shipped build instead runs 100% offline against the bundled canonical dataset with no live nutrition API call anywhere in `background.js`. Given EV-SCI-012's own finding that "database coverage is the primary quality bottleneck" for Kenyan products, and EV-003's finding that OFacts returns no match for major Kenyan brands, this is a defensible architectural pivot — but it should be formally ratified as a superseding decision (see Architecture doc, ADR-005) rather than left as an unreconciled gap against FR-002.
- **Constraint:** Manifest V3 service workers are non-persistent; `background.js` re-initializes on every wake.
- **Constraint:** The extension currently ships without a `package.json`; NFR-004's mandated toolchain (Preact, no Tailwind, ≤250KB gzipped) cannot be verified against a pinned build config, and — per direct source inspection — the shipped popup/dashboard are Vite + **React** bundles, not Preact, which directly contradicts NFR-004's "Preact (not React) is mandated" requirement (see §4, NFR-004 status).

### 2.6 Dependencies
- UK Food Standards Agency Nutrient Profiling Model, 2023 revision (FSA-NPS-2023, Santé publique France workbook, 4 April 2024), as the scoring methodology.
- Kenya Nutrient Profile Model (KNPM) 1st Edition, MoH July 2025 — the Kenya-market authoritative eligibility/exclusion standard (EV-KE-001), intended to run alongside FSA-NPS but not yet integrated into the shipped classifier.
- Kenya Food Composition Table 2018 (KFCT 2018) as the category-level nutrient-imputation reference (`data/KFCT2018_reference_validated.json`) — note this file currently fails to import in the shipped build due to a filename case mismatch (see Engineering Runbook §5).
- `idb` (IndexedDB wrapper), bundled into `db.js`, for all local persistence.
- ~~Firebase / Firestore SDK for the optional cross-device ledger mirror~~ — **removed.** No Firebase/Firestore code exists anywhere in the shipped `src/extension` tree today. A dead reference remains in `build.cjs` (it still targets a `firebase-sync.js` entry point that no longer exists in the repo) and will fail the build if ever invoked — see Engineering Runbook §5.
- An offline Python data-curation pipeline producing the canonical `naivas_final.json` / `carrefour_final.json` datasets, now governed by the layered architecture in §5 below.

---

## 3. User Personas & Core Journeys

*Replaces the placeholder personas in the prior revision of this document. These four profiles are reproduced (condensed) from `NUT04_User_Personas_Evidence_Grounded.md`, itself explicitly labelled desk research grounded in published Kenyan epidemiological and market evidence — **not** primary interviews or usability sessions. The UAT plan already defined in the requirements spec (§13: AfyaVentures supervisor + 2 persona-representative users + 1 accessibility tester) is the point at which these profiles should be tested and corrected against real shoppers; treat them as well-informed hypotheses until then.*

Personas 2 and 3 represent **secondary prevention** — people already diagnosed and managing a known condition. Personas 1 and 4 represent **primary prevention** — the much larger undiagnosed population the general A–E grade is scientifically validated for independent of diagnosis (EV-SCI-003). Together they span the population the problem statement (§2.1) claims to serve.

### 3.1 Persona 1 — Peter K., 41 (General / Undiagnosed Majority)

| Attribute | Detail |
|---|---|
| Role | Mid-level accountant, Nairobi; married, two children, dual-income household |
| Health status | No diagnosed NCD; hasn't had a check-up in over a year |
| Shopping channel | Naivas.co.ke mobile app, weekly household shop, often during a lunch break |
| Digital literacy | High; low patience for anything that slows checkout down |

**Evidence grounding:** Represents Kenya's undiagnosed majority — only 6.0% of adults meet minimum fruit-and-vegetable intake and 27.9% are overweight/obese nationally (Kenya STEPS 2015, EV-KE-005), most without knowing their risk. The Food-EPI Kenya Benchmarking Study (EV-KE-009) found point-of-purchase nutrition signals absent from Kenyan retail platforms as of 2020. EV-SCI-003 establishes the FSAm-NPS algorithm is valid regardless of diagnosis, so a badge is scientifically meaningful for Peter despite having none.

**Goals & pain points:** Wants a "glance and decide" signal, not an explanation. Price- and convenience-driven; will disengage from or disable any tool that adds friction or delay at checkout — the same non-intrusive constraint retailer stakeholders (Carrefour Kenya / Naivas digital teams) raised directly.

**How NUT-04 serves Peter:** FR-004 (badge render <2s) and NFR-002 (zero layout shift) matter more to Peter than any other persona — a slow or disruptive badge is worse than no badge. FR-003's plain A–E grade is his only touchpoint; the diabetes/hypertension modules should stay silent for him.

### 3.2 Persona 2 — John M., 58 (Diagnosed Type 2 Diabetes)

| Attribute | Detail |
|---|---|
| Role | Retired secondary-school teacher, now part-time education consultant |
| Health status | Type 2 diabetes, diagnosed 6 years ago; managed with metformin and diet |
| Shopping channel | Carrefour Kenya app, twice-weekly shop |
| Digital literacy | Moderate; easily lost by technical or English-jargon nutrition terms |

**Evidence grounding:** National diabetes prevalence is 3.1% by direct STEPS 2015 survey measurement (the commonly cited 4.2M figure is a separate IDF 2021 modelled estimate — both legitimate, methodologically different, and both should continue to be cited rather than conflated). County-level burden varies sharply: Nyeri County diagnosed diabetes prevalence is 6.4%, almost triple the national rate, with 36.6% of a diagnosed cohort there having a microvascular complication (EV-KE-008) — diabetic retinopathy is directly relevant to interface design, reinforcing colour-independent design (ACC-002/NFR-007) as more than generic best practice for this persona specifically. 83.5% of Kenyans add sugar when cooking (EV-KE-006), and added sugar is not a mandatory Kenyan label field (ATNi/EAMA 2025, EV-KE-003/004) — the specific gap NUT-04 closes for John.

**How NUT-04 serves John:** FR-005/FR-009 (sugar >22.5g/100g threshold warning) surfaces a signal Kenyan retail pages don't show today. AI-003's plain-language, Flesch-Kincaid ≤8 disclaimer requirement matters directly to him given his stated jargon-avoidance. NFR-007's "colour never the sole indicator" requirement is reinforced by the Nyeri retinopathy data, not just generic accessibility practice.

### 3.3 Persona 3 — Grace N., 47 (Diagnosed Hypertension)

| Attribute | Detail |
|---|---|
| Role | Owns and runs a small hair salon, Nairobi |
| Health status | Diagnosed hypertension 3 years ago; managed with medication and reduced-salt diet |
| Shopping channel | Naivas app, shops around her work schedule, buys in bulk for home and staff lunches |
| Digital literacy | High but time-poor — needs answers fast, not detail |

**Evidence grounding:** Raised blood pressure affects 23.8% of Kenyan adults nationally (EV-KE-005), consistent with the ~30% urban-adult estimate. Kenya's own 25×25 national policy target is a 30% reduction in population salt/sodium intake by 2025 (EV-KE-006) — Grace choosing a lower-sodium product at checkout is a direct, individual enactment of a named national health target, a strong framing for Ministry of Health / KNDI stakeholder conversations. Under KNPM, the processed-food categories she relies on for bulk/convenience buying are overwhelmingly non-compliant (Sauces/Dips/Condiments 92% ineligible, Dairy 94%, Carbonates 89% — EV-KE-004), and Kenyan on-pack labelling is too incomplete to compute nutrient profiles from packaging alone (EV-KE-003/004).

**How NUT-04 serves Grace:** FR-010 (sodium >600mg/100g, exact mg displayed) gives her the specific number Kenyan retail pages don't show. FR-013 (alternatives engine) matters more to Grace than to a browsing-for-leisure shopper — she needs a fast swap given her time pressure and bulk-purchase stakes, not a research exercise. **Note:** FR-013/the Alternatives Engine is now implemented end-to-end in the shipped build (see §4) — `NutriScoreDB.getAllProducts()` sources same-retailer candidates and a live-scraped price (cached in `price_cache` at scan time) drives the ±30%/±50% price-proximity filter, so this gap is closed for Grace's specific use case.

### 3.4 Persona 4 — Njeri W., 34 (Undiagnosed, Overweight, Family History — Primary Prevention)

| Attribute | Detail |
|---|---|
| Role | Marketing coordinator, Nairobi; married, two young children |
| Health status | No diagnosed NCD; overweight by BMI; mother diagnosed with Type 2 diabetes at 52 |
| Shopping channel | Jumia Food and Carrefour Kenya (Jumia not currently a supported retailer — see §2.4 Scope) |
| Digital literacy | High; early adopter of shopping and health-tracking apps |

**Evidence grounding:** Combined overweight/obesity affects 27.9% of Kenyan adults, and 49.5% of women specifically (EV-KE-005) — Njeri represents this large, mostly undiagnosed, predominantly female segment that neither John nor Grace captures, since both already carry a diagnosis. Family history is a recognised risk amplifier; national policy sets a 0% target for further rise in obesity/diabetes prevalence by 2025 (EV-KE-006) — Njeri is exactly the population that target is aimed at reaching *before* diagnosis. The Global Nutrition Report's NACS framing (EV-SCI-009/010) positions NUT-04 as a population-level Impact intervention, of which Njeri is the concrete face.

**How NUT-04 serves Njeri:** FR-003's general A–E grade is her primary touchpoint — the disease-specific modules don't fire for her since she has no diagnosis. FR-013/AI-001/AI-002's multi-factor, explained alternatives ("similar but healthier and still kid-friendly," not a single-nutrient number) matter specifically to her stated goal of habit-building without guilt. Non-punitive tone is a direct requirement for Njeri, distinct from Peter's "don't slow me down" constraint — Njeri would actively disengage from a warning-heavy, diet-policing tool.

### 3.5 Persona 5 — Data Curator (Internal, Secondary)

Retained from the prior revision: the internal JHUB Africa/AfyaVentures team member responsible for running the offline fuzzy-matching, five-tier confidence classification, and fact-checking pipeline that produces the canonical datasets. See §5 (Database Design) for how this role's output is governed.

---

## 4. Functional Requirements Matrix (Actual Spec IDs, with Verified Build Status)

*Replaces the placeholder FR-001–FR-008 in the prior revision. IDs, statements, and priorities are reproduced from Requirements Spec v2.2 §9.1–9.3 and §9.6; statements are condensed. Full Given/When/Then acceptance criteria and evidence chains remain in the source requirements document.*

| ID     | Requirement (condensed)                                                                                                                                                                   | Priority | Current Build Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001 | MutationObserver-based product detection, 300ms debounce, handles React/Vue async rendering                                                                                               | Must     | ✅ Implemented — `content.js` uses a debounced `MutationObserver`. Exact 90%-detection-within-2s acceptance criterion not independently measured (no test harness exists).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| FR-002 | Retrieve nutrition data from Open Food Facts API, falling back to a curated Kenyan DB, returning 7 named fields                                                                           | Must     | 🟡 **Diverged.** No OFacts (or any live) API call exists anywhere in `background.js`. The shipped build is 100% offline against the bundled canonical dataset — a full architectural pivot from the spec's API-primary design, not a partial implementation of it. See Architecture doc ADR-005.                                                                                                                                                                                                                                                                                                                                                                                                          |
| FR-003 | 2023 FSA-NPS algorithm exactly: Sugar Ib scale, revised salt scale, red-meat protein cap, N≥11 exclusion rule, SFA ratio for added fats, beverage sweetener +4 penalty, category cut-offs | Must     | 🟡 **Partial.** Energy/sugar/sat-fat/salt N-point scales, the red-meat protein cap, and the N≥11 exclusion rule are implemented and closely match the SPF 2023 tables. **Two confirmed gaps:** (1) the fibre P-point formula is linear (`fiber/0.9`, cap 5) and reaches max points at ~4.5g fibre, versus the spec's stated 7.4g Scenario-II ceiling — a systematic over-reward of fibre; (2) the beverage non-nutritive-sweetener +4 penalty described in EV-SCI-004 and Appendix A has no implementation anywhere in `score-engine.js`. The mandatory 20/20 SPF-reference-product test suite does not exist, so these grade-accuracy claims are not currently verified by any automated test.           |
| FR-004 | Colour-coded badge via CSS custom properties (not inline styles), letter grade always visible as DOM text                                                                                 | Must     | 🟡 **Diverged.** Letter grade is visible as DOM text (good). However, `adapters/shared-ui.js` sets badge/flyout markup via `shadow.innerHTML` with hardcoded inline hex-colour values in a JS object, not CSS custom properties — directly contradicting this requirement and the related NFR-006/SEC-002 "no innerHTML" mandate. Mitigated in practice by consistent `escapeHTML()` use (not a live XSS today), but not architecturally compliant.                                                                                                                                                                                                                                                       |
| FR-005 | Health warning panel for sugar >22.5g, sodium >600mg, sat fat >5g; plain language, AI-003 disclaimer                                                                                      | Must     | ✅ **Implemented and verified.** `engine/disease-engine.js` DR-001 (sugar >22.5g), DR-002 (sodium >600mg), DR-003 (sat fat >5g) match these thresholds exactly. Disclaimer present but wording differs slightly from the spec's suggested text (see §4 AI-003 below).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FR-006 | Classify into 5 FSA-NPS categories before scoring                                                                                                                                         | Must     | ✅ Implemented — `score-engine.js` branches on `GENERAL_FOOD` / `RED_MEAT` / `CHEESE` / `ADDED_FAT` / `BEVERAGE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| FR-007 | Suppress badges on non-food items and SPF-excluded categories (baby food, sports nutrition, supplements, medical foods)                                                                   | Must     | ✅ Implemented — `engine/food-classifier.js`'s exclusion gate; `isExcluded` is consumed by `background.js`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| FR-008 | NOVA processing-level tag alongside the grade                                                                                                                                             | Should   | ⬜ Not independently verified — depends on OFacts `nova_group`, which is unreachable given FR-002's status; not confirmed present in the canonical dataset schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| FR-009 | Diabetes module: sugar >22.5g/100g, non-diagnostic framing                                                                                                                                | Must     | ✅ Implemented (DR-001), see FR-005.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| FR-010 | Hypertension module: sodium >600mg/100g, exact mg displayed                                                                                                                               | Must     | ✅ Implemented (DR-002), see FR-005.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| FR-011 | Cardiovascular module: **combined** warning only when sat fat >5g AND sodium >400mg simultaneously                                                                                        | Should   | 🟡 **Diverged.** `disease-engine.js` implements DR-003 (sat fat >5g, alone) and DR-004 (sodium 400–600mg, alone) as two **independent** single-nutrient warnings — neither requires the other condition to also be true, unlike the spec's explicit AND-condition combined warning.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| FR-012 | Kidney module: potassium >200mg AND sodium >600mg                                                                                                                                         | Could    | 🟡 **Diverged, and non-functional today regardless.** DR-005 (potassium alone) and DR-006 (sodium alone) fire independently, not as a joint condition. Separately, `background.js` reads potassium via `nutrition.PotassiumMG ?? nutrition.Potassium?.ValueMG` — but no `PotassiumMG` field exists anywhere in the current schema (§5 below), so the value always resolves to `null`, not a hardcoded `0`. The practical effect is the same either way: `null > 200` is always `false`, so DR-005 can never fire in the current build irrespective of the AND/OR question.                                                                                                                                |
| FR-013 | ≥3 alternatives, ranked by grade → category → price proximity ±30%, each with an explanation                                                                                              | Must     | ✅ **Implemented.** `NutriScoreDB.getAllProducts()` exists in `db.js` and returns every same-retailer candidate; `background.js` passes the full list into `AlternativesEngine.getAlternatives()`, which applies the mandatory category filter, the grade filter, and the ±30%/±50% price-proximity filter exactly as specified, ranking the top 3 by `RelevanceScore`. **One caveat:** the price used for filtering comes from a live `price_cache` populated by DOM-scraped prices at scan time, not from the dataset's own `Price.CurrentPriceKES` field, which is still `0` for 100% of all 9,274 records — a product's price-proximity data is only available once it has been scanned at least once. |
| AI-001 | Multi-factor alternative ranking (grade, category, price)                                                                                                                                 | Must     | ✅ Implemented — see FR-013 above; ranking uses `0.60×GradeRank + 0.30×CategoryMatch + 0.10×PriceProximity` exactly as specified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AI-002 | Explanation on every alternative (grade comparison, category, nutrients improved)                                                                                                         | Must     | ✅ Implemented — every returned alternative includes an `ExplanationText` string.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AI-003 | Non-dismissible "not medical advice" disclaimer on every warning panel                                                                                                                    | Must     | 🟡 **Implemented, wording differs.** Shipped disclaimer: *"This information is based on standard thresholds and is not medical advice. Consult a healthcare provider."* Spec-suggested text: *"General nutritional information only — not medical advice. Consult a qualified nutritionist or physician for personalised dietary guidance."* Functionally equivalent; not verbatim. Flesch-Kincaid grade of the shipped text not independently scored.                                                                                                                                                                                                                                                    |

---

## 5. Data Requirements & Database Design (Reconciled with Requirements Spec §10.5)

### 5.1 Why this section replaces DATA-001 as originally written

The requirements spec itself contains two data-model descriptions that are in tension with each other. **DATA-001** (§9.5, v2.0-era) specifies a fixed, minimal, "compressed" schema: *"The system shall collect only the following nutritional fields: energy_kJ, sugars_100g, saturated_fat_100g, sodium_mg_100g, proteins_100g, fiber_100g, nova_group... IndexedDB schema contains exactly these 7 fields — no additional fields stored."* **Section 10.5** (added in v2.2, "Data Governance and Database Lifecycle") supersedes this with a much richer, **flexible, layered** model: six governed data layers, a seven-tier confidence hierarchy, seven mandatory provenance fields, completeness thresholds, automatic plausibility validation, record lifecycle/versioning, and quality gates.

Direct inspection of the shipped canonical datasets confirms the flexible model in §10.5 is the one the project has actually been building toward — the compressed 7-field DATA-001 schema was never implemented, and implementing it now would mean *discarding* data (category codes, packaging, provenance, validation flags) the project already collects and needs. **This document adopts §10.5 as the authoritative database design going forward, and DATA-001 should be formally superseded in the next requirements spec revision rather than left as a live, contradicted requirement.**

### 5.2 The Layered Data Architecture (§10.5.1), as actually implemented

| Layer | Spec Definition | Actual Build Status |
|---|---|---|
| 1. Governance (this specification) | Authoritative standard every record should trace to | ✅ This document now plays that role for the schema question |
| 2. KFCT 2018 (immutable scientific reference) | Never edited directly, only extended alongside the original | ✅ File ships as `data/kfct2018_reference_validated.json` and `db.js` imports it from that exact lowercase path — the two match. No filename case mismatch exists in the current build; the reference layer imports and functions correctly. |
| 3. Curated nutrition reference DB | KFCT + FAO/USDA/McCance & Widdowson + manufacturer labels | 🟡 Partially realised — `NutritionProvenance.SourceName`/`SourceID` fields exist per record, but a distinct, queryable reference layer separate from the retailer product records was not found |
| 4. Retailer product databases | Consume the reference layer rather than inventing estimates | ✅ `naivas_final.json` / `carrefour_final.json`, ~9,274 combined records |
| 5. FSA-NPS 2023 scoring engine | — | ✅ `engine/score-engine.js` (see §4, FR-003 status for fidelity gaps) |
| 6. Browser extension | — | ✅ Shipped |

### 5.3 Official Confidence Hierarchy (§10.5.2) vs. Actual Production Data

The spec defines seven canonical tiers (`manufacturer_verified` → `manual_review_required`) and states these have *"been mapped onto this hierarchy in the production datasets."* **Direct inspection of both live datasets shows this remapping has not yet happened:**

| Dataset | Distinct `EvidenceLevel` values actually in use | Records with no `EvidenceLevel` at all |
|---|---|---|
| Naivas (3,518 records) | `category_reference`, `retailer_matched_product`, `unverified`, `single_ingredient_known_composition`, `international_fct`, `recovered_pending_evidence`, `manufacturer`, `rejected`, `retailer_matched_product_low_confidence` — **9 ad hoc values, none matching the official 7-tier vocabulary by name** | 1,163 records (33%) |
| Carrefour (5,756 records) | `category_reference`, `unresolved`, `international_fct` — **3 ad hoc values**, overlapping only partially with Naivas's vocabulary | 0 records |

The two retailer datasets do not even share a consistent vocabulary with **each other**, let alone with the spec's official hierarchy. Remapping both datasets onto the seven canonical tiers is outstanding work, not a completed step.

### 5.4 Mandatory Provenance Fields (§10.5.3) vs. Actual

Spec requires: `SourceDatabase`, `SourceFoodCode`, `EvidenceType`, `ValidationMethod`, `Reviewer`, `ValidationDate`, `ReviewStatus`. Actual `NutritionProvenance` object carries only: `ValueSpecificity`, `EvidenceLevel`, `EvidenceType`, `SourceID`, `SourceName`. Only `EvidenceType` matches by name; `SourceID`/`SourceName` are a plausible but not identical substitute for `SourceDatabase`/`SourceFoodCode`; `ValidationMethod`, `Reviewer`, and `ValidationDate` have no equivalent anywhere in the schema. A `ReviewState` field exists under `Validation` (not `NutritionProvenance`), which is a close but not identical match to `ReviewStatus`.

### 5.5 Mandatory Completeness Thresholds (§10.5.4) vs. Actual

| Dataset | Core macronutrient fields (`EnergyKJ`, `SugarsG`, `FatG`, `CarbohydratesG`, `SaltG`, `SodiumMG`, `FibreG`, `ProteinG`) null count |
|---|---|
| Naivas (3,518 records) | 1,163–1,172 nulls per field (**~33% of the dataset**) — fails the 100% completeness threshold |
| Carrefour (5,756 records) | **0 nulls on any core field — fully meets the completeness threshold** |

This is a genuinely large, retailer-specific quality gap, not a general project-wide shortfall — Carrefour's data is complete; Naivas's is roughly two-thirds complete on the fields §10.5.4 makes mandatory.

### 5.6 Automatic Plausibility Validation (§10.5.5) vs. Actual

The concept is genuinely implemented, and in a more nuanced form than specified: both datasets carry a populated `Validation.DataQualityFlags` array with real, specific values (`atwater_failed`, `atwater_not_checked`, `salt_sodium_failed`, `salt_sodium_not_checked`, `category_plausibility_failed`, `category_plausibility_not_checked`, `gate0_manual_review_resolved`, `energy_recalculated_for_atwater_consistency`, and others) — usefully distinguishing "rule ran and failed" from "rule never ran," a distinction the spec's binary flag concept (e.g. `SALT_SODIUM_MISMATCH`) doesn't make. The gap is naming-convention alignment only: the spec's `UPPER_SNAKE_CASE` flag vocabulary and the shipped `lower_snake_case` ad hoc vocabulary have not been reconciled into one controlled list.

### 5.7 Quality Gates Before Production Promotion (§10.5.7) vs. Actual

| Gate | Target | Actual (best available proxy) |
|---|---|---|
| Required nutrient fields complete | 100% | Carrefour: 100% ✅ · Naivas: ~67% 🟡 |
| Category-default records | <5% of database | If `category_reference` is the shipped equivalent of the spec's `category_default` tier: Naivas 16.2% (570/3,518), **Carrefour 83.7% (4,820/5,756)** — both far outside target, Carrefour dramatically so |
| Provenance fields populated | 100% | Naivas: 67% have any `EvidenceLevel` at all; Carrefour: 100% have one, but see §5.3 for vocabulary caveats |
| Internal consistency | 100% | Not zero — see §5.6; exact pass-rate not computed here (would need cross-tabulating flags against total record count per rule) |
| DATA-005 negligible-nutrition exclusion (`IsEligibleForScoring`/`ExclusionReason` fields) | Present | ❌ Not found anywhere in the schema. The negligible-nutrition exclusion **concept** is implemented, but via a different mechanism — `engine/food-classifier.js`'s runtime SPF-exclusion gate — not as a pre-computed, per-record dataset field as DATA-005 specifies. |
| DATA-006 implausibility flagging (`DATA_QUALITY_IMPLAUSIBLE_VALUES` / `CONFIRMED_MISLABELED_FCT_MATCH`) | Present | 🟡 Conceptually covered by the `DataQualityFlags` in §5.6, under different flag names |

**Recommendation:** treat §5.3–§5.7 above as the Phase-2 data-engineering backlog: standardise the `EvidenceLevel` vocabulary across both retailers onto the official 7-tier hierarchy, add the four missing provenance fields, close Naivas's completeness gap, and re-evaluate the category-default quality gate once `category_reference` is either confirmed equivalent to `category_default` or given its own, correctly-targeted threshold.

---

## 6. Non-Functional Requirements (Actual Spec IDs, with Verified Build Status)

| ID      | Requirement (condensed)                                                                              | Priority | Current Build Status                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-001 | Badge + warnings visible within 2s of DOM detection on 25 Mbps 4G                                    | Must     | ⬜ Not independently measured — no performance test harness exists                                                                                                                                                                                                                                                                                                                                    |
| NFR-002 | Zero Cumulative Layout Shift on badge injection                                                      | Must     | ⬜ Not independently measured; Shadow DOM approach is structurally consistent with this goal                                                                                                                                                                                                                                                                                                          |
| NFR-003 | ≥95% category classification accuracy on a 50-product test set                                       | Must     | ❌ Not verified — no test suite of any kind exists in the shipped source                                                                                                                                                                                                                                                                                                                              |
| NFR-004 | Bundle ≤250KB gzipped; **Preact mandated, not React**; no Tailwind                                   | Should   | ❌ **Contradicted.** Direct inspection confirms the shipped popup/dashboard are Vite + **React** bundles (React-shaped hashed asset names, React-pattern source-map hints), not Preact. Bundle-size budget not independently measured. This is a project-level decision to reconcile explicitly — either the spec's toolchain mandate or the shipped stack needs to change; they cannot both be true. |
| NFR-005 | Adapter-pattern architecture — new retailer = new adapter file only                                  | Must     | ✅ Implemented — `adapters/naivas.js` and `adapters/carrefour.js` share a common interface (`detectProducts`, `extractCartState`, `injectBadge`, etc.) via `adapters/shared-ui.js`.                                                                                                                                                                                                                   |
| NFR-006 | No `eval()`, no `innerHTML`, grade colours via CSS custom properties only; strict CSP                | Must     | 🟡 **Diverged** — see FR-004 above; `shared-ui.js` uses `shadow.innerHTML` (escaped) with inline hex colours, not CSS custom properties.                                                                                                                                                                                                                                                             |
| NFR-007 | WCAG 2.2 AA: text alternatives, colour never sole indicator, keyboard nav, NVDA/VoiceOver compatible | Must     | 🟡 **Partial/Diverged.** The badge trigger element lacks an ARIA role/`tabindex` for keyboard users (confirmed by direct inspection of `shared-ui.js`); no accessibility audit artefact exists.                                                                                                                                                                                                      |
| NFR-008 | Graceful degradation: grey "?" badge on data-source timeout/unavailability, not a broken badge       | Should   | ✅ Implemented in spirit — `ScoreEngine.score()` returns a `LetterGrade: "UNKNOWN"` result when no nutrient data is available, and `shared-ui.js` skips badge rendering for `UNKNOWN`/`NULL` grades rather than rendering something broken. This is a local-lookup-miss equivalent of the spec's API-timeout scenario, consistent with FR-002's architectural pivot away from a live API call.        |

---

## 7. Success Metrics & Key Performance Indicators (KPIs)

| KPI | Definition | Spec Target | Current Status |
|---|---|---|---|
| Score-engine accuracy | 20 SPF reference products, all 5 categories | 20/20 exact match | Not measurable — no test suite exists (see NFR-003, FR-003) |
| Category classification accuracy | 50-product test set, 10 per category | ≥95% (47/50) | Not measurable — no test suite exists |
| Coverage rate | 100-product Naivas test set | ≥70% receive a grade | Not measured directly, though dataset-side nulls (§5.5) suggest Naivas coverage is materially below Carrefour's |
| Checkout Score Engagement Rate | % of scanned products where the badge flyout is opened | Not stated numerically in spec | Not instrumented — no telemetry pipeline exists |
| Healthy Substitution Adoption Rate | % of D/E-grade products where a suggestion is accepted | Not stated numerically in spec | Not instrumented — no telemetry pipeline exists to measure acceptance, though FR-013 itself is now functional (see §4) |
| Accessibility | Lighthouse audit | ≥90 | Not measured |

### 7.1 North Star Metric
Weighted average NutriScore grade of a shopper's basket over time, trending toward A/B. **Note:** `calculateAnalytics()`'s `averageGrade` field is a genuine weighted computation (`computeAverageGrade()` maps A–E to 1–5, weights by count, rounds, and maps back to a letter) — it only falls back to a neutral `"C"` when a time window has zero ledger entries to average. This is correctly implemented, not a hardcoded placeholder.

---

## 8. Risks & Open Questions

| ID | Risk / Question | Impact | Likelihood | Mitigation / Resolution Owner |
|---|---|---|---|---|
| RQ-001 | Retailer DOM/selector drift breaks detection | High | Medium-High | Add a selector health-check signal; owner: Extension team |
| RQ-002 | FR-013 (Alternatives Engine) is implemented end-to-end, but its price-proximity filter depends entirely on the live `price_cache` (populated only after a product has been scanned) rather than the dataset's own `Price.CurrentPriceKES`, which is `0` for 100% of records | Medium | Confirmed in code | Populate `Price.CurrentPriceKES` at the data-curation layer so alternatives are price-aware even for never-before-scanned products; owner: Core Logic |
| RQ-003 | *(Resolved)* Firebase/Firestore has been fully removed from the shipped extension — no SDK, no API key, and no sync code ships in `src/extension` today. The only remnant is a dead `firebase-sync.js` entry point still referenced in `build.cjs`, which will throw on build if ever invoked | Low (build-time only, not a runtime exposure) | N/A — the code path no longer exists | Delete the dead `firebase-sync.js` reference from `build.cjs`; owner: Infra |
| RQ-004 | FR-003's fibre P-point scale and missing beverage sweetener penalty diverge from the SPF 2023 reference tables | Medium-High (scientific accuracy) | Certain (confirmed by direct calculation) | Correct the fibre formula to the Scenario-II bands (max points at 7.4g, not ~4.5g); implement sweetener detection and the +4 penalty; add the 20-reference-product test suite as an acceptance gate | Core Logic |
| RQ-005 | NFR-004's Preact-only mandate directly contradicts the shipped React-based dashboard/popup | Medium (process/governance) | Certain | Formally reconcile: either amend NFR-004 to permit React, or schedule a Preact migration; owner: Kibet + JHUB Africa reviewers |
| RQ-006 | §10.5's flexible database design (confidence hierarchy, provenance fields, quality gates) is specified but not yet fully realised in the production datasets — see §5.3–5.7 | Medium | Confirmed, quantified above | Standardise `EvidenceLevel` vocabulary across retailers; add missing provenance fields; close Naivas's ~33% completeness gap; owner: Data Curator role |
| RQ-007 | No automated test suite exists for scoring, classification, or disease-flagging logic, despite the spec treating FR-003 as safety-adjacent | High | Certain | Add the mandated 20-reference-product suite, 50-product category test, and boundary tests as CI gates before any further feature work; owner: Core Logic / QA |

---

## 9. Release & Rollout Plan

Reconciled against the requirements spec's own P1–P6 delivery roadmap (§15). The spec's phase checkboxes (e.g. P2's "20/20 reference products pass") describe target exit criteria, not confirmed current status — per §4 and §6 above, several of these have not been independently verified and in some cases (test suite, Alternatives Engine) are confirmed not yet met.

| Phase | Target Date (spec) | Key Deliverables | Actual Status |
|---|---|---|---|
| P1 — Foundations | Week 3 (Jul 11, 2026) | MutationObserver scraper; first 50 fallback DB entries with fibre | ✅ Detection implemented; dataset far exceeds 50 entries (9,274 combined) |
| P2 — Score Engine | Week 5 (Jul 25, 2026) | 2023 FSA-NPS algorithm, 20-reference-product suite, ≥200-product DB, KNDI review | 🟡 Algorithm implemented with known gaps (§4 FR-003); test suite and KNDI review not evidenced |
| P3 — Widget MVP | Week 6 (Aug 1, 2026) | Badge, disease warnings, NOVA tag, 2s performance test | 🟡 Badge/warnings implemented; NOVA tag unverified; performance test not evidenced |
| P4 — Alternatives | Week 8 (Aug 15, 2026) | Multi-factor alternatives engine, cardiovascular module | ✅ Alternatives engine now functional end-to-end (see §4, FR-013); cardiovascular module still diverged (independent, not combined, warnings) |
| P5 — Dashboard + Data | Week 10 (Aug 29, 2026) | Consent flow, data deletion, Carrefour adapter | 🟡 Carrefour adapter implemented; consent-modal/deletion-affordance not independently verified in the compiled dashboard UI |
| P6 — Privacy + Submission | Week 12 (Sep 12, 2026) | Privacy Policy, WCAG audit, Web Store submission, KNDI letter | ❌ Not evidenced — no privacy policy, accessibility audit, or submission artefact found in the reviewed build |

Given the gaps above, **Gate 0 client approval should be sought against this reconciled status, not against the roadmap's original target-state checkboxes**, so JHUB Africa reviewers are evaluating the project against verified current reality.

---

## Appendix

- **Glossary:** FSA-NPS (UK FSA Nutrient Profiling Model); KNPM (Kenya Nutrient Profile Model, MoH 2025); KFCT 2018 (Kenya Food Composition Table); NACS (Nutrition Action Classification System); Evidence Tier / DataConfidence (per-record data-confidence rating per §5.3); `canDisplayGrade` (the authoritative render-gate boolean used across all three extension surfaces).
- **Evidence Source Index:** Full EV-SCI-001–013 and EV-KE-001–011 citations are maintained in `NutriScore_Requirements_v2_Evidence_Linked.md`, Appendix B — not reproduced here to avoid duplication; this document cites codes inline and defers to that index as the source of record.
- **Persona Source:** Full evidence-grounded persona profiles (including the methodology caveat that this is desk research pending UAT validation) are maintained in `NUT04_User_Personas_Evidence_Grounded.md`.
