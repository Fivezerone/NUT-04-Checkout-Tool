# NutriScore Platform — Clinical Data Pipeline, Analytics Engine & Compliance Architecture Strategy

*Prepared 11 November 2026 · Audience: CTO, Lead Data Scientist, Security and Privacy Lead · Status: engineering baseline v1.0 · Companion: Multi-Stakeholder Business Model & Value Exchange Blueprint (source numbers S1–S11 continue from it; S12–S15 are added at the end)*

## 0. Scope, principles and regulatory snapshot

### 0.1 What this document specifies

Five engineering areas, each written so that it converts into tickets: (1) health engines and adapters; (2) data streams, normalisation and cleaning; (3) the adherence and variance scoring engine; (4) cohort segmentation and tiered analytics; (5) privacy-by-design and compliance architecture. Section 6 closes with a delivery plan, acceptance tests and open decisions. Numbers labelled **\[A\]** are engineering assumptions to be validated. Legal statements must be confirmed by counsel before they are relied on.

### 0.2 Ten design principles

| # | Principle | Consequence |
| --- | --- | --- |
| P1 | Fail open on uncertainty; block only on verified evidence | Low-confidence records show a neutral state, never a block |
| P2 | The clinician is the authority | The platform computes, signs and logs; it never prescribes or auto-tightens clinical limits |
| P3 | Diagnosis never leaves the clinical zone | Only semantic limits travel in the token |
| P4 | Score on the device | Keeps the shipped offline design; grades need no network call |
| P5 | Every transformation is versioned, reproducible and audit-logged | Each output stores its input versions and code hash |
| P6 | Purchase is a proxy for intake | Every exposure estimate carries an uncertainty field |
| P7 | Money never changes a grade | Sponsorship sits outside the scoring and eligibility code path |
| P8 | Build to the strictest common denominator | Kenya Data Protection Act and GDPR consent and pseudonymisation rules, HIPAA minimum-necessary and BAA terms, Kenyan hosting for the clinical zone |
| P9 | Consent is purpose-specific and revocable | Revocation propagates within defined SLAs (Section 5.4) |
| P10 | Every requirement has an acceptance test | Section 6.2 |

### 0.3 Trust zones

```
┌─ ZONE 1: CLINICAL (Kenya-hosted) ──────────────────────────────────┐
│ Clinician dashboard │ FHIR / form ingestion │ Identity Vault (MPI) │
│ Clinical_Nutrition_Profile │ Outcome store │ Signer (HSM / KMS)    │
└───────────────┬────────────────────────────────────────────────────┘
                │ signed Dietary_Profile_Token (no diagnosis, no identity)
┌───────────────▼─ ZONE 2: TOKEN EXCHANGE / PRIVACY BROKER ──────────┐
│ Shopper_ID and Payer_ID derivation │ Consent registry (PDP)         │
│ Key management │ Revocation list │ Audit-log writer                 │
└───────┬─────────────────────────────────────┬──────────────────────┘
        │                                     │
┌───────▼─ ZONE 3: RETAIL EDGE ─────┐  ┌───────▼─ ZONE 4: ENCLAVES ───────┐
│ MV3 extension, on-device scoring  │  │ Hospital enclave (T0)            │
│ Encrypted token │ catalogue cache │  │ Payer enclave (T4)               │
│ Telemetry gateway (pseudonymous)  │  │ Retail enclave (T5)              │
└───────────────────────────────────┘  └──────────────────────────────────┘
```

| Zone | Holds | Who can reach it | Location |
| --- | --- | --- | --- |
| 1 Clinical | Clinical records, identity vault, clinical nutrition profile, signing keys | Clinicians by role and treatment relationship; DPO and auditors read-only; platform operators under dual control | Kenya |
| 2 Token exchange | Key derivation, consent registry, revocation list, audit-log writer | Services only; no human access without break-glass | Kenya |
| 3 Retail edge | Extension code, on-device token, catalogue cache, telemetry gateway | The patient's device; the gateway holds pseudonymous telemetry only | Device; gateway in Kenya |
| 4 Analytics enclaves | Separate hospital (T0), payer (T4) and retail (T5) stores | Per-stakeholder service accounts; no cross-enclave joins | Kenya |

### 0.4 Regulatory snapshot as at 11 November 2026

| Regime | Status | What it forces in the design |
| --- | --- | --- |
| Kenya Data Protection Act 2019 and General Regulations 2021 | In force. Health data is sensitive personal data. Sensitive data may be processed outside Kenya only with consent and safeguards; processing tied to primary or secondary healthcare provision falls in the localisation categories and needs a Kenyan server, or at least one serving copy in Kenya (S8) | Clinical zone in Kenya; documented lawful basis and explicit consent; DPIA for large-scale sensitive processing; registration of controllers and processors; limits on commercial use of personal data |
| ODPC Guidance Notes on cross-border transfers (8 September 2026) | Regulator guidance, not statute. Cloud hosting outside Kenya counts as a transfer; onward transfers for the recipient's own analytics, profiling, product improvement or marketing are strictly prohibited; transfer assessments must be documented (S8) | Default to no cross-border flows; any foreign sub-processor needs a transfer assessment and a contractual ban on secondary use |
| Digital Health Act 2023 and 2025 regulations (data exchange; health information management procedures) | In force. Further instruments, such as e-health application certification, circulated in draft in 2024, so confirm their gazettement status. National and county health data banks, certification and interoperability duties apply (S9). A stakeholder submission flagged that the Act's consent definition may fall short of informed consent | Treat consent as informed, written and specific. Keep integration with the national exchange optional and module-based, as already decided |
| HIPAA (US customers only) | Privacy Rule de-identification (45 CFR 164.514) and the current Security Rule are enforced. The Security Rule overhaul proposed in January 2025 is not final, and final action has been pushed to at least July 2027 (S10) | Build to the proposed controls now: encryption at rest and in transit, MFA, asset inventory, annual risk analysis, BAAs with every sub-processor |
| GDPR (EU data subjects only) | Art. 9 special-category data, Art. 25 by design, Art. 32 security, Art. 35 DPIA. EDPB draft guidelines 01/2025 treat pseudonymised data as personal data where additional information exists; check for the final text (S11). The EU–Kenya adequacy process is under way (S8) | Pseudonymised outputs stay in scope; explicit consent for health data; DPIA |
| Chrome Web Store user-data policy and Manifest V3 | Health information counts as sensitive user data, with disclosure, consent and limited-use rules \[A: verify the current text (S15)\] | Minimal permissions, no remote code, in-product disclosure, privacy policy |

## 1. Health engines and adapter architecture

### 1.1 Engine map

| Engine | Zone | Input → output | Target |
| --- | --- | --- | --- |
| Clinical Ingestion Adapter (CIA) | 1 | FHIR bundle or dashboard form → validated canonical clinical record | Validation under 2 s per bundle |
| Profile Compiler | 1 | Canonical record + clinician overrides → signed Clinical\_Nutrition\_Profile and Dietary\_Profile\_Token | Under 1 s |
| Token Exchange | 2 | Token request → per-retailer token with ephemeral Shopper\_ID | Under 300 ms |
| Retail DOM Adapter (RDA) | 3, on device | Page DOM → ProductObservation and CartObservation | P95 ≤ 15 ms per batch |
| Nutrition Mapping Engine (NME) | 3, on device | ProductObservation + catalogue → NutritionRecord with confidence | P95 ≤ 50 ms |
| Scoring Engine | 3, on device (mirrored on the server for audit) | Token + NutritionRecord → grade, flags, swap candidates | P95 ≤ 5 ms per item |
| Adherence and Variance Engine | 4 and 1 | Cart snapshots + token constraints → scores | Daily batch plus on demand |

### 1.2 Clinical Ingestion Adapter

**Two paths, one canonical model.** Path A reads FHIR R4 from the hospital's EHR using SMART backend services (OAuth 2 client credentials with a signed JWT assertion) and resource subscriptions for new observations. Path B takes the same fields from structured dashboard forms for clinics without an interoperable EHR. Both write the same canonical record and pass through the same validation.

**FHIR mapping and plausibility ranges.** LOINC codes are from the LOINC distribution; verify them against the current release (S13).

| Datum | FHIR resource | Code | Unit | Plausible range (reject outside) |
| --- | --- | --- | --- | --- |
| HbA1c | Observation | LOINC 4548-4 | % (NGSP) or mmol/mol | 3 to 20 % |
| Blood pressure panel | Observation | 85354-9; systolic 8480-6, diastolic 8462-4 | mm\[Hg\] | SBP 60–260; DBP 30–160; SBP > DBP |
| Body weight | Observation | 29463-7 | kg | 20 to 400 |
| Body height | Observation | 8302-2 | cm | 50 to 250 |
| BMI | Observation | 39156-5 | kg/m² | 10 to 80 (derive from weight and height if absent) |
| Fasting glucose | Observation | 1558-6 | mg/dL or mmol/L | 20 to 600 mg/dL |
| eGFR | Observation | 62238-1 | mL/min/1.73 m² | 1 to 200 |
| Serum potassium | Observation | 2823-3 | mmol/L | 2.0 to 8.0 |
| Diagnoses | Condition | ICD-10 such as E11.x (type 2 diabetes), I10 (hypertension), E66.x (obesity), N18.x (CKD) | — | Code must exist in the release |
| Medications | MedicationRequest or MedicationStatement | Local or RxNorm code | — | Mapped to interaction flags (below) |
| Allergies | AllergyIntolerance | Allergen code | — | Must map to the product allergen vocabulary |
| Dietary prescription | NutritionOrder (oralDiet.nutrient) | Nutrient code, modifier, amount | UCUM | Within guideline-library bounds, or flagged for review |
| Consent | Consent | Purpose codes | — | Must be active |

**Validation and normalisation steps, in order.** (1) Structural validation against the profile. (2) Code-system check. (3) Unit normalisation to UCUM: HbA1c NGSP % = 0.09148 × IFCC mmol/mol + 2.152, and glucose mg/dL = mmol/L × 18.016. (4) Plausibility ranges above. (5) Recency: labs older than the staleness limit (HbA1c 120 days, blood pressure and weight 90 days, eGFR 180 days \[A, clinician-configurable\]) are flagged stale and cannot tighten a limit automatically. (6) Source precedence: clinician override, then structured form, then FHIR feed, then patient-entered values.

**Medication interaction flags.** Map medication classes to nutrient cautions that the clinician must confirm: ACE inhibitors, ARBs and potassium-sparing diuretics → potassium; warfarin → vitamin K consistency; insulin and sulfonylureas → carbohydrate timing and hypoglycaemia risk. The platform proposes; the clinician confirms.

**Guideline library v1 (defaults, always overridable, each rule needs clinical-lead sign-off) \[A\].**

| Condition | Default limit | Basis |
| --- | --- | --- |
| Hypertension | Sodium ≤ 2,000 mg per day; a stricter value (for example ≤ 1,500 mg) when the clinician selects it | WHO sodium guidance; Kenya's national target of a 30% cut in population salt intake |
| Type 2 diabetes | Free sugars < 10% of energy; fibre ≥ 25 g per day; carbohydrate targets set by the clinician | WHO free-sugars guidance; clinician protocol |
| Obesity | Energy target set by the clinician; saturated fat < 10% of energy; NOVA group 4 share capped | Clinician protocol |
| CKD (if coded) | Potassium, phosphorus and protein limits set by the clinician only; no default | Stage-dependent |

**Two outputs from the Profile Compiler.** The **Clinical\_Nutrition\_Profile** stays in Zone 1 and includes diagnoses and latest biomarkers. The **Dietary\_Profile\_Token** is a signed, short-lived credential that carries semantic constraints only.

Clinical\_Nutrition\_Profile (abbreviated):

```json
{
  "schema": "nutriscore.clinical_profile/1.2",
  "profile_id": "pf_9b1f2c",
  "patient_uuid": "5e3c7a10-8d44-4c0e-9b6a-2f1d0c9a7e11",
  "version": 7,
  "supersedes": 6,
  "effective_from": "2026-11-12T08:00:00Z",
  "expires_at": "2026-12-12T08:00:00Z",
  "authored_by": {"practitioner_id": "pr-0192", "role": "writing_clinician"},
  "clinical_context": {
    "conditions": ["E11.9", "I10"],
    "latest": {"hba1c_pct": 8.1, "sbp": 152, "dbp": 94, "bmi": 31.4, "egfr": 78},
    "stale": []
  },
  "constraints": [
    {"nutrient": "sodium_mg", "basis": "per_day", "max": 1500, "mode": "soft", "weight": 0.50, "rule": "GL1-HTN-02", "override": true},
    {"nutrient": "free_sugars_g", "basis": "per_day", "max": 36, "mode": "soft", "weight": 0.25, "rule": "GL1-T2D-01", "override": false},
    {"nutrient": "fibre_g", "basis": "per_day", "min": 25, "mode": "target", "weight": 0.25, "rule": "GL1-T2D-03", "override": false}
  ],
  "exclusions": [{"type": "allergen", "code": "peanut", "mode": "hard"}],
  "provenance": {"inputs": ["obs-4411", "obs-4412"], "engine": "profile-compiler@2.3.1", "guideline_library": "gl1@2026-10"},
  "signature": {"alg": "ES256", "kid": "ks-2026-11", "jws": "eyJhbGciOi…"}
}
```

Dietary\_Profile\_Token payload. The signed token goes to the extension and contains no name, diagnosis or biomarker:

```json
{
  "iss": "https://tokens.example.co.ke",
  "sub": "shp_7Hk2mQ9x",
  "aud": "ext:naivas",
  "iat": 1794470400,
  "exp": 1797062400,
  "jti": "tok_01JC8Z",
  "profile_ver": 7,
  "ctr": {
    "per_day": [
      {"n": "sodium_mg", "max": 1500, "mode": "soft", "w": 0.50},
      {"n": "free_sugars_g", "max": 36, "mode": "soft", "w": 0.25},
      {"n": "fibre_g", "min": 25, "mode": "target", "w": 0.25}
    ],
    "per_100g_flags": [{"n": "sodium_mg", "gt": 600, "action": "warn"}],
    "exclude": [{"t": "allergen", "c": "peanut", "mode": "hard"}],
    "nova4_cap_pct": 30
  },
  "household": {"adult_eq": 2.5},
  "policy": {"block_mode": "confirm", "min_conf": "VERIFIED", "sponsored": true},
  "kid": "ks-2026-11"
}
```

**Token rules.**

- Constraint values are health-inferable (a 1,500 mg sodium limit hints at hypertension). The token therefore lives only on the device, encrypted, and constraint values never appear in telemetry, logs or retailer-facing calls. Telemetry carries only profile\_ver.
- Sign with ES256 or EdDSA. Keys live in an HSM or KMS inside Kenya and rotate every 90 days; the extension carries pinned trust anchors and a signed key manifest for rotation.
- Default lifetime is 30 days \[A\]. The extension verifies offline and checks the revocation list on refresh. On expiry it shows neutral grades and asks the patient to contact the clinic; it never keeps enforcing an expired prescription.
- A new profile version supersedes the old one. The signer refuses to sign any change, loosening or tightening, that lacks a clinician identity and timestamp.

### 1.3 Retail DOM and Nutritional Mapping Adapter

**Adapter contract.** Each retailer implements one interface, and selectors are data, not code.

```ts
interface RetailerAdapter {
  id: string;                       // 'naivas' | 'carrefour_ke' | 'quickmart'
  matches(url: URL): boolean;       // path allow-list only
  observeProducts(root: Document): AsyncIterable<ProductObservation>;
  observeCart(root: Document): CartObservation | null;
  mountBadge(tile: Element, result: ScoreResult): void;
}
type ProductObservation = {
  retailer_id: string; retailer_sku: string; gtin?: string;
  title: string; brand?: string; size_text?: string;
  price_minor: number; currency: 'KES';
  source: 'jsonld' | 'attr' | 'microdata' | 'dom'; extracted_at: number;
};
```

**Extraction priority.** schema.org JSON-LD Product (gtin13, sku, name, brand, offers), then data-\* attributes, then microdata, then visible tile text. Observe dynamic pages with a MutationObserver and an IntersectionObserver so that only visible tiles plus one viewport of margin are scored.

**Allow-list and exclusions (a privacy control, tested in CI).** Adapters declare path allow-lists for product listing, product detail, search and cart. Account, login and payment paths are hard-excluded. The adapter reads only product tiles and cart rows, never input fields, and never text outside those containers.

**Identity resolution cascade.**

| Step | Method | Confidence | Auto-accept |
| --- | --- | --- | --- |
| M1 | Exact GTIN match in the catalogue | High | Yes |
| M2 | Retailer SKU crosswalk (retailer id + SKU) | High | Yes |
| M3 | Deterministic key: normalised brand + normalised name + pack size in g or ml + variant | Medium-high | Yes |
| M4 | Probabilistic match inside a blocked candidate set (same brand, size bucket ± 10%) | Calibrated probability | ≥ 0.92 accept; 0.80–0.92 show as ESTIMATED; < 0.80 reject |
| M5 | Category fallback to a generic food-composition average | Low | Display only; never blocks and is never a swap source |

For M4, compute weighted similarities s\_j (token-set Jaro–Winkler on the name, character 3-gram TF-IDF cosine, size ratio, brand equality, category agreement) and a calibrated probability P(match) = σ(β0 + Σ β\_j × s\_j). Fit β on labelled pairs from the existing catalogue and re-calibrate each release.

**Nutrition sources and precedence.** A manufacturer label verified by a reviewer comes first (VERIFIED). Next is a retailer-published panel (ESTIMATED until spot-checked), then USDA FoodData Central branded records, which carry GTINs, and Open Food Facts matches (both capped at ESTIMATED), then Kenya Food Composition Tables averages for generic foods (ESTIMATED, non-blocking), otherwise nothing. Open Food Facts returned no match for several major Kenyan brands during earlier pilot testing, so the local reviewed catalogue is the primary source and global databases only fill gaps. Use the five-tier review scale already in the catalogue: REJECTED, UNVERIFIED, ESTIMATED, VERIFIED, HIGH\_CONFIDENCE.

**Action by confidence.** Show a grade at ESTIMATED or higher. Warn or block only at VERIFIED or higher. Use only VERIFIED or higher records as swap candidates. Anything lower shows a neutral not-yet-graded state.

**Latency budget.** Target: P95 below 200 ms from batch flush to painted badge, with an engineering goal of 120 ms.

| Stage | Budget (ms) | How |
| --- | --- | --- |
| DOM extraction | 15 | Allow-listed selectors; visible tiles only |
| Identity resolution, exact paths | 10 | In-memory Map indexes on GTIN and SKU built at start-up |
| Fuzzy fallback (about 10–15% of items \[A\]) | 40 | Blocked candidate sets only; no full-catalogue scans |
| Scoring | 5 | Pure functions over normalised nutrient vectors |
| Render | 25 | Batched DOM writes in one frame |
| Headroom for layout and garbage collection | 25 | — |
| **Total** | **120** | — |

The shipped build batches mutations with a 300 ms debounce. That is batching delay, not processing time, but a shopper still waits for it. Use a leading-edge trigger (process the first mutation at once, then debounce the rest at 100–150 ms) and measure from first mutation to first painted badge. Enforce the budget with performance marks in a Playwright suite that fails the build if the P95 over 100 recorded fixture pages exceeds it.

**Drift resilience under Manifest V3.** Remote code is not allowed, so deliver selector changes as signed configuration data (a versioned selector manifest that the extension verifies) and release code changes through the store. Run nightly canary tests against live retailer pages and alert when selector failure rates exceed 2% \[A\].

## 2. Data collection, normalisation and cleaning pipeline

### 2.1 Pipeline overview

```
Device telemetry ----> Gateway (schema + consent check) ----> BRONZE  raw, append-only, 30-day TTL
FHIR / forms --------> CIA validation ------------------------> BRONZE
Retailer feeds (catalogue, price, stock) --------------------> BRONZE
                                  |
            SILVER  validated, typed, unit-normalised, de-duplicated, pseudonymous
                                  |
            GOLD    features, scores, cohorts, one mart per stakeholder enclave
```

Clinical data runs through bronze, silver and gold inside Zone 1. Telemetry lands in Zone 3, is joined to clinical data only through the token service's blind join (Section 5.3), and the stakeholder marts are built inside the Zone 4 enclaves. Orchestrate with a scheduler such as Dagster or Airflow, enforce data contracts through a schema registry, and run transformation tests with dbt or Great Expectations. Everything runs on Kenyan infrastructure.

### 2.2 Stream A: user baseline nutrition profile

This is the Clinical\_Nutrition\_Profile from Section 1.2, stored as an immutable, versioned record (type-2 slowly changing dimension: each version has effective\_from, effective\_to and a supersedes pointer). Nothing is updated in place, so every score can be recomputed against the profile version that applied on the day.

### 2.3 Stream B: active dietary intake and extension telemetry

**Event catalogue.**

| Event | Trigger | Key payload fields |
| --- | --- | --- |
| session\_start, session\_end | Retailer tab opened or closed, or 30 minutes idle | retailer\_id, ext\_ver |
| product\_impression | A graded tile enters the viewport | sku\_ref, grade letter, confidence tier |
| warning\_shown | A caution or confirmation prompt appears | sku\_ref, reason\_class |
| add\_to\_cart\_blocked | The patient meets a confirm-block dialog | sku\_ref, reason\_class |
| add\_to\_cart\_overridden | The patient proceeds anyway | sku\_ref, override\_code from a fixed list |
| substitution\_offered | Swap candidates are shown | from\_sku, to\_sku list, sponsored flag, rank |
| substitution\_accepted | The patient swaps | from\_sku, to\_sku, price\_delta\_minor |
| cart\_snapshot | Cart changes, debounced | items \[sku\_ref, qty, unit\_price\_minor\] |
| checkout\_completed | Order confirmation page reached | order\_hash, items, total\_minor |
| consent\_changed | The patient changes a consent | purpose, new\_state |

**Rule on reason\_class.** The values are limited to safety\_hard, clinical\_soft and confidence\_low. A reason\_class never names a nutrient, because naming sodium would reveal the constraint behind it. Adherence is computed downstream, inside the hospital enclave, where the constraints are legitimately known.

**Telemetry envelope.**

```json
{
  "schema": "nutriscore.telemetry/1.1",
  "event_id": "01JC9K2V8Q3T6X",
  "event_type": "substitution_accepted",
  "shopper_id": "shp_7Hk2mQ9x",
  "retailer_id": "naivas",
  "session_id": "ses_4f2a",
  "cart_episode_id": "ce_a91c0e",
  "client_ts": "2026-11-14T09:12:44.120Z",
  "client_seq": 412,
  "profile_ver": 7,
  "ext_ver": "1.4.0",
  "catalogue_ver": "2026-11-10",
  "payload": {
    "from_sku": "nav-100231",
    "to_sku": "nav-100877",
    "price_delta_minor": 1500,
    "sponsored": false,
    "rank_position": 2
  },
  "consent_ref": "cr_2c71",
  "sig": "base64url..."
}
```

**Collection rules.** Use time-sortable identifiers (UUIDv7 or ULID) for event\_id so that replays are idempotent. Queue events in IndexedDB and upload every 15 minutes, on checkout, or when the service worker wakes on a chrome.alarms alarm, with exponential backoff. Queue nothing unless an active retail-telemetry consent exists, and clear the queue the moment that consent is revoked. The per-install signature detects tampering and replay; it does not authenticate a person. Retention \[A\]: bronze 30 days, silver 24 months, gold per stated purpose.

### 2.4 Stream C: longitudinal clinical feedback

Follow-up labs and vitals arrive as FHIR Observations, or from clinic forms, and are normalised into an Outcome\_Record.

| Field | Notes |
| --- | --- |
| patient\_uuid | Zone 1 only |
| metric | hba1c\_pct, sbp\_mmhg, dbp\_mmhg, weight\_kg, bmi, egfr, potassium\_mmol\_l |
| value\_norm, unit | After UCUM normalisation |
| effective\_dt | Date of measurement, not of data entry |
| source | lab, clinic, home\_device, patient\_entered |
| context | fasting or non-fasting; seated rest minutes for blood pressure; device type |
| quality | verified, unverified, outlier\_flagged |
| profile\_ver\_at\_measure | Links the outcome to the prescription then in force |

Blood pressure has high within-person variation, so use the mean of at least three home readings per week (or the clinic reading) and store the individual readings. HbA1c reflects roughly three months of glucose exposure, so analyses should not expect it to move within 4 weeks.

### 2.5 Normalisation and missing-label rules

| Rule | Specification |
| --- | --- |
| Canonical basis | Per 100 g or per 100 ml, plus per serving where a serving mass is stated. Mass in g, minerals in mg, vitamins in µg, energy in kcal |
| Energy | kcal = kJ × 0.2390 when only kJ is present |
| Salt and sodium | sodium\_mg = salt\_g × 393.4 (sodium is 39.34% of sodium chloride by mass) |
| Serving to 100 g | per\_100 = per\_serving × 100 ÷ serving\_g. For liquids use a stated density, or 1.00 g/ml with a density\_assumed flag |
| Censored values | ‘< 0.5 g’ becomes 0.25 g with a censored flag; ‘trace’ becomes 0 with the flag |
| Atwater check | Calculated energy = 4 × protein + 4 × available carbohydrate + 9 × fat (+ 2 × fibre). Flag if reported energy differs by more than 15% (when calculated energy exceeds 20 kcal) |
| Component checks | Sugars ≤ carbohydrate; saturated fat ≤ total fat; macronutrients sum to ≤ 102 g per 100 g; sodium ≤ 40,000 mg per 100 g (above 10,000 only for salt and stock products) |
| Never impute zero | A missing value is missing, not zero |

**Missing-label hierarchy**, applied in order and recorded in the provenance field:

1. Recover from an alternate field (salt → sodium, kJ → kcal).
2. Derive by difference where the components are present.
3. Borrow from a sibling variant of the same product (different pack size), scaled per 100 g, and mark ESTIMATED.
4. Use the category median with its inter-quartile range as an uncertainty band. This is for display and exposure estimation only, never for a block or a swap.
5. Exclude the item from the adherence numerator and count it in the unscored share of the cart.

An adherence score is produced only when scored items cover at least 70% of cart spend (coverage C ≥ 0.70 \[A\]); otherwise the window is reported as insufficient data.

Canonicalisation sketch:

```python
SODIUM_MG_PER_G_SALT = 393.4

def to_canonical(n: dict) -> dict:
    out = dict(n)
    if out.get('energy_kcal') is None and out.get('energy_kj') is not None:
        out['energy_kcal'] = out['energy_kj'] * 0.2390
    if out.get('sodium_mg') is None and out.get('salt_g') is not None:
        out['sodium_mg'] = out['salt_g'] * SODIUM_MG_PER_G_SALT
    if out.get('basis') == 'per_serving' and out.get('serving_g'):
        k = 100.0 / out['serving_g']
        for f in NUTRIENT_FIELDS:
            if out.get(f) is not None:
                out[f] *= k
        out['basis'] = 'per_100g'
    return out
```

### 2.6 Outlier detection in telemetry

| Check | Rule | Action |
| --- | --- | --- |
| Event rate | More than 20 events per second from one device | Drop and flag as bot or replay |
| Clock skew | client\_ts differs from server\_ts by more than 24 h, or lies in the future | Use server\_ts; flag the device |
| Cart size and value | Robust z = 0.6745 × (x − median) ÷ MAD per retailer; flag when the absolute value exceeds 3.5 | Quarantine pending review |
| Line quantity | Above the 99.9th percentile or above 50 | Quarantine |
| Price | price\_minor more than 5 times the catalogue price | Quarantine; check for a parser fault |
| Impossible sequences | Checkout with no cart; duplicate event\_id; session longer than 12 h | Drop or quarantine |
| Daily metric series | Hampel filter: window of 7 days, 3 MADs | Winsorise for modelling; keep the raw value |

Never delete an outlier. Move it to a quarantine table with a reason code so that parser faults and retailer changes become visible.

### 2.7 Deduplicating multi-session carts

A household cart is often built over several sessions and devices, abandoned, rebuilt, or submitted twice. The pipeline works in four steps.

1. **Sessionise.** Start a new session after 30 minutes of inactivity.
2. **Define a cart episode.** An episode starts with the first add after an empty cart or after a completed checkout. It ends at checkout\_completed, or after 14 days of inactivity \[A\]. If the retailer exposes a cart identifier, store only its hash.
3. **Reconcile snapshots.** Per episode and item, keep the latest snapshot by server time and client sequence. Quantity is the last known quantity, never the sum across sessions.
4. **Make checkout idempotent.** Use order\_hash = H(retailer\_order\_id), or, if the order id is not visible, H(sorted items and quantities ‖ total ‖ 10-minute bucket). Collapse duplicates inside the window.

```sql
WITH ranked AS (
  SELECT cart_episode_id, sku_ref, qty, client_seq,
         ROW_NUMBER() OVER (PARTITION BY cart_episode_id, sku_ref
                            ORDER BY server_ts DESC, client_seq DESC) AS rn
  FROM silver.cart_snapshot_items
)
SELECT cart_episode_id, sku_ref, qty
FROM ranked
WHERE rn = 1 AND qty > 0;
```

### 2.8 Data quality gates

| Gate | Rule | Threshold \[A\] | On failure |
| --- | --- | --- | --- |
| Schema conformance | Events valid against the registry | ≥ 99.5% | Alert; reject batch |
| Consent linkage | Every event has an active consent\_ref | 100% | Fail closed: quarantine and purge |
| Duplicates after dedup | Duplicate event\_id or order\_hash | < 1% | Investigate gateway |
| Event lateness | P95 of server\_ts minus client\_ts | < 24 h | Alert |
| Catalogue completeness | Graded SKUs with energy, sugars, saturated fat and sodium present | ≥ 80% | Block pilot Gate 1 |
| Unit failures | Records failing unit normalisation | < 0.5% | Review queue |
| Lineage | Gold rows traceable to bronze inputs and code version | 100% | Fail the job |

## 3. Adherence and variance scoring engine

### 3.1 Exposure estimate

For each constrained nutrient k and an evaluation window W (default: the last 7 days, recomputed daily):

E\_k(W) = Σ\_i (q\_i × n\_ik × e\_i) ÷ (A × D)

where q\_i is units purchased, n\_ik is the nutrient content of one unit (from the per-100 g value and pack mass), e\_i is the edible fraction (1.0 for packaged foods; 0.8–0.95 for produce, from composition-table refuse factors), A is the household adult-equivalents from the token, and D is the days the shop covers (the household's median interval between completed checkouts, bounded to 3–14 days, defaulting to 7). The unit of E\_k is per adult-equivalent per day.

**Uncertainty.** Var(E\_k) = Σ\_i (q\_i × e\_i × σ\_ik)² ÷ (A × D)², with σ\_ik = 0 for VERIFIED records, 10% of n\_ik for ESTIMATED and 30% for category fallback \[A\].

**Purchase is not intake.** Waste, sharing, eating out and shopping at other outlets all break the link. Carry an intake\_confidence = C × ω, where C is cart coverage and ω is the share of household grocery shopping the patient says goes through tracked retailers (asked at onboarding; default 0.6 \[A\]). Use periodic clinician-led dietary recalls to estimate the bias and tune ω.

### 3.2 Macro and micro variance score

Let L\_k be a maximum limit and T\_k a minimum target. The signed relative variance is:

- Maximum-type nutrient: V\_k = (E\_k − L\_k) ÷ L\_k
- Minimum-type nutrient: V\_k = (T\_k − E\_k) ÷ T\_k
- Band-type nutrient (target T with tolerance ±δ): V\_k = max(0, |E\_k − T\_k| − δ) ÷ T\_k

Only unfavourable variance counts, so V\_k > 0 means a miss. The composite is **VS = Σ w\_k × max(0, V\_k) ÷ Σ w\_k**, the weighted mean relative overshoot, where 0 means on target. Also report the signed V\_k for dashboards, and the item-level contribution c\_ik = (q\_i × n\_ik × e\_i) ÷ (A × D × L\_k), which ranks the items that drive each miss and feeds the nudge engine.

### 3.3 Nutritional Adherence Score (0–100)

**Per-nutrient sub-score.** s\_k = 2^(− max(0, V\_k) ÷ h\_k), so the score halves at an overshoot of h\_k. Defaults \[A, clinician-adjustable\]: h = 0.25 for sodium, 0.30 for free sugars, 0.50 for fibre. s\_k = 1 when the nutrient is on or within target.

**Score.** AS = 100 × Σ w\_k × s\_k ÷ Σ w\_k.

**Why this shape.** It is smooth, bounded, monotonic (more overshoot never raises the score), and interpretable (a half-score threshold the clinician can set), and no single nutrient can drive the score below zero.

**Safety cap.** A hard-exclusion item (for example a declared allergen) purchased after a warning is recorded as a Safety Event and routed to the clinician. It caps the score at 50 and is never smoothed away by averaging.

**Worked example.** Constraints are sodium ≤ 1,500 mg (w = 0.50), free sugars ≤ 36 g (w = 0.25) and fibre ≥ 25 g (w = 0.25).

| Nutrient | Estimated E\_k | Limit or target | V\_k | h\_k | s\_k | w\_k |
| --- | --- | --- | --- | --- | --- | --- |
| Sodium | 2,100 mg | 1,500 mg | 0.40 | 0.25 | 0.330 | 0.50 |
| Free sugars | 30 g | 36 g | −0.17, counts as 0 | 0.30 | 1.000 | 0.25 |
| Fibre | 17 g | 25 g | 0.32 | 0.50 | 0.642 | 0.25 |

AS = 100 × (0.50 × 0.330 + 0.25 × 1.000 + 0.25 × 0.642) = **57.5**. VS = (0.50 × 0.40 + 0 + 0.25 × 0.32) = **0.28**, a 28% weighted overshoot. Report the score with an 80% interval from the exposure uncertainty, for example “57 (50–64)”. Suggested bands \[A\]: 80 or above is on track, 60–79 is partly on track, below 60 is off track.

**Smoothing.** AS\_t = α × AS\_window + (1 − α) × AS\_(t−1), with α = 0.3 \[A\]. Also report the 4-week median.

**Scope.** The score uses what was actually checked out. Overrides, blocks and warnings are engagement and safety metrics, kept apart from adherence.

**Basket Healthiness Index (used as a pilot KPI).** BHI = Σ spend\_i × item\_score\_i ÷ Σ spend\_i, with item\_score\_i = 100 × (40 − FSA-NPS points\_i) ÷ 55 for foods, since the food scale runs from −15 to 40 points. Beverages use their own algorithm's minimum and maximum.

### 3.4 Dynamic profile adaptation

The loop compares the **biometric trend** with **adherence** and decides who acts. The clinician is always the authority over limits.

**Trend classification.** For each outcome metric, fit a robust linear trend (for example Theil–Sen) over the recent measurements. Require at least 4 weekly blood-pressure averages across 4 weeks, or at least two HbA1c values 8–12 weeks apart. Classify as Plateau when the 90% interval of the 28-day change includes zero and its size is under the threshold (systolic 2 mmHg, weight 0.25 kg \[A\]), as Improving or Worsening when the interval excludes zero in the favourable or unfavourable direction, and as Insufficient otherwise.

| Trend | Adherence (rolling AS ≥ 70 for 4 weeks = high) | Action | Approval |
| --- | --- | --- | --- |
| Improving | High | Hold limits. Optionally reduce the weight of nutrients that have sat at s = 1 (by at most 15% per cycle) to limit fatigue | Auto, inside clinician-set bounds; clinician informed |
| Improving | Low | Hold; look for other drivers (medication, activity) | None |
| Plateau | High | Propose tighter limits, a new nutrient constraint or a medication review | Clinician must approve |
| Plateau | Low | Coaching: raise nudge priority for the top contributors | Auto (nudges only) |
| Worsening | High or low | Clinical alert within 7 days; with low adherence add engagement outreach | Clinician |
| Insufficient | Any | Wait; prompt for a measurement | None |

**Weight recalibration, bounded.** Update weights as w\_k ← normalise(w\_k × exp(η × g\_k)), where g\_k is the standardised sensitivity of the outcome to nutrient k from a hierarchical model that shrinks each patient toward the cohort mean. Use η = 0.2 \[A\], clip each step to ±15%, keep a floor of 0.05, and allow a change only every 4 weeks for blood pressure and every 12 weeks for HbA1c.

```python
def recalibrate(profile, trend, adherence, sens, now):
    if trend.status == 'INSUFFICIENT' or not cadence_ok(profile, now):
        return NoChange('cadence')
    if profile.medication_changed_since_last_review:
        return Freeze('clinician_review_required')
    if trend.status == 'WORSENING' or (trend.status == 'PLATEAU' and adherence.high):
        return ClinicianProposal(profile.version, reason=trend.status,
                                 suggested=propose_limits(profile, trend))
    w = dict(profile.weights)
    for k in w:
        step = max(-0.15, min(0.15, ETA * sens[k]))
        w[k] = max(0.05, w[k] * math.exp(step))
    return NewVersion(profile, weights=normalise(w), signer='clinician-bounds',
                      note='auto weight update inside clinician bounds')
```

**Safeguards.** Automation may change weights only, never limits or exclusions, and only if the clinician has enabled auto-weights with explicit bounds. Every change is a new signed profile version with a rationale and a patient-visible change log. A detected medication change freezes the profile until clinician review. Run the loop in shadow mode for 8 weeks before enabling it, and compare its proposals with what clinicians actually decide.

### 3.5 Validating the scoring layer

- **Product grade accuracy.** Exact agreement on the 20-product reference set from the official scoring workbook, plus a regression suite for each retailer's top 500 SKUs. This closes the open accuracy-test gap in the shipped build.
- **Property tests.** Monotonicity (more overshoot never raises AS), weight normalisation, invariance to item order, and stability under unit changes.
- **Clinical face validity.** In the pilot, compare AS bands with dietitian judgement on a sample of 40 patient-weeks and report agreement (Cohen’s kappa) \[A\].
- **Fairness slices.** Report coverage, score distributions and false-block rates by retailer, price tier and household size so that catalogue gaps do not become unequal treatment.

## 4. Cohort segmentation and multi-tiered analytics

### 4.1 Segmentation strategy

Three layers, from transparent to learned. Clinical cohorts are computed inside Zone 1, where identity and diagnoses are legitimately known; only opaque segment codes leave it.

| Layer | Method | Purpose | Example cohorts |
| --- | --- | --- | --- |
| 1. Clinical phenotype | Transparent rules over profile constraints and latest context | Clinical workflow, risk strata | **Insulin-Resistant High-Sodium**: type 2 diabetes or prediabetes coded, and sodium exposure more than 20% over the default limit in at least 3 of the last 4 weeks. **Hypertensive-Obese**: hypertension coded and BMI ≥ 30. **Cardiometabolic triple**: all three conditions |
| 2. Behavioural | Unsupervised clustering of basket features | Merchandising and nudge design | **Recovering-then-relapsing**: adherence at or above 70 for 4 weeks, then below 50 for 2 weeks. **Convenience-heavy**: high NOVA group 4 share and frequent small orders |
| 3. Responsiveness and price | Uplift modelling and elasticity estimation | Nudge targeting, price-parity rules | **High nudge-responders**; **Price-constrained adherents**: high adherence at low price per 1,000 kcal |

**Features.**

- Clinical flags: constraint set, BMI band, medication-interaction flags.
- Behavioural: spend share by category, NOVA group 4 share, sodium, free sugars and fibre per 1,000 kcal, order frequency, basket size, substitution acceptance, override rate.
- Economic: price per 1,000 kcal, share of spend on promotions and private label. Do not collect income; basket-price behaviour is the socioeconomic proxy.

**Clustering method.** Use Gower distance for mixed data, then HDBSCAN on a PCA or UMAP embedding, or k-prototypes when a fixed k is needed. Accept a clustering only if the silhouette is at least 0.25 and bootstrap stability (Jaccard) is at least 0.75 \[A\]. Minimum cohort size is 50 for internal use and 20 for any release outside the enclave.

**Dynamic assignment.** Recompute weekly. Move a patient between cohorts only after two consecutive windows agree (hysteresis), and keep the assignment history so that analyses use the cohort that applied at the time.

**Behavioural elasticity (nudge responsiveness).** Randomise a 10% holdout of eligible nudges so that some patients see no prompt. Estimate the conditional effect of a nudge with a T-learner or causal forest and evaluate with the Qini coefficient.

**Price sensitivity.** Fit a logistic model of swap acceptance on the relative price change of the swap, ln(odds of acceptance) = a + b × ln(1 + price delta) + controls, per segment. The coefficient b is the segment’s price elasticity of acceptance.

**Governance.** Cohorts are analytic tools, not eligibility decisions. A cohort label may never be used to deny, price or restrict anything for an individual (invariant I4). Review each new cohort for fairness before it is used.

### 4.2 Descriptive analytics

| Metric | Definition | Cadence | Audience |
| --- | --- | --- | --- |
| Adherence trend | AS distribution, share of patients at 70 or above, 4-week median | Daily | Hospital, insurer (cohort) |
| Variance heat map | Mean V\_k by nutrient and cohort | Weekly | Hospital |
| Basket Healthiness Index | Spend-weighted item score (Section 3.3) | Weekly | All |
| Healthy-SKU share of spend | Share of spend on grade A or B items | Weekly | Hospital, retailer |
| NOVA group 4 share | Share of spend on ultra-processed items | Weekly | Hospital |
| SKU substitution rate | Swaps accepted ÷ swaps offered | Weekly | Retailer, platform |
| Block override rate | Overridden ÷ blocked | Weekly | Hospital, safety board |
| Price parity of swaps | Median price change of accepted swaps | Weekly | Retailer |
| Grade coverage | Graded share of viewed SKUs and of spend | Daily | Platform |
| Engagement | Weekly active ÷ enrolled; share of checkouts with the tool active | Weekly | All |

### 4.3 Predictive analytics

| Model | Target | Algorithm | Main features | Evaluation | Use |
| --- | --- | --- | --- | --- | --- |
| Biometric trajectory | Change in systolic pressure, HbA1c or weight at 30, 60 and 90 days | Gradient boosting (for example LightGBM) with quantile objectives at the 10th, 50th and 90th percentiles, plus a mixed-effects baseline with a random intercept and slope per patient | Baseline value, prior slope, rolling AS at 1, 2 and 4 weeks, per-nutrient variance, BHI, medication-change flag, visit adherence, season | MAE; coverage of the 80% interval (target 75–85%); calibration; gain over a carry-forward baseline; split by patient and by time | Clinician planning and insurer forecasts |
| Dietary relapse | Time to relapse (AS below 50 for 2 weeks after at least 4 weeks at 70 or above) | Cox proportional hazards for interpretability; random survival forest as challenger | Recent AS slope, override rate, order gaps, price pressure, cohort | C-index; time-dependent AUC at 30 and 60 days; Brier score; calibration slope | Early outreach |
| Acute-event risk | Emergency visit or admission within 90 days | Discrete-time hazard model or boosted survival model with penalisation | Clinical context, trajectory, adherence, utilisation history | AUROC and AUPRC; calibration; decision-curve analysis | Insurer risk strata (phase 2) |
| Disengagement | Inactivity for 3 weeks | Gradient boosting | Session cadence, notifications, override rate | AUROC; lift at top decile | Retention outreach |

**Cold start and data sufficiency.** During the pilot, use descriptive analytics and simple models only. Do not deploy machine-learned forecasts until about 500 patient-quarters of data exist \[A\], and do not deploy acute-event models until enough events have accrued to support the predictors used (a common rule of thumb is at least 10 events per candidate predictor; use penalised models and pool across partners). Until then, borrow published trajectories as priors in a hierarchical Bayesian model and label every forecast as a prior-based estimate.

**Model governance.** Every model has a model card, a version, a validation report, and drift monitoring (population stability index above 0.2 triggers review). Run new models in shadow mode first. Clinician-facing predictions show the top three drivers (for example from SHAP values) and a confidence interval. No prediction triggers an automated adverse action; each one is a flag for a human. Confirm with counsel whether prediction features qualify as regulated clinical decision support in each market.

### 4.4 Prescriptive: recommendation engine

The engine implements the two-stage rule from the Blueprint (invariants I1 and I3).

**Stage 1, eligibility.** A candidate alternative a for an original item o is eligible only if all of these hold: it is substitutable (same functional category and use); every hard constraint in the token is satisfied; its review state is VERIFIED or higher; it is in stock; and its price change is within the cap (default +10% \[A\]).

**Stage 2, utility.** U(a | o) = w\_c × CG + w\_p × PP + w\_t × TA + w\_a × AV.

| Term | Definition |
| --- | --- |
| CG, clinical gain | Σ w\_k × (n\_ok − n\_ak) ÷ L\_k over the constrained nutrients, then scaled to 0–1 against the best candidate in the set |
| PP, price parity | 1 − min(1, max(0, (p\_a − p\_o) ÷ p\_o − δ) ÷ τ), with a free band δ = 0.05 and a scale τ = 0.20 \[A\] |
| TA, taste affinity | Item-to-item similarity from implicit-feedback matrix factorisation on within-retailer co-purchases, plus attribute similarity (brand, flavour, pack size), personalised by the shopper’s own past acceptances |
| AV, availability and fit | Stock status and pack-size fit to the household |

Default weights are w\_c = 0.50, w\_p = 0.25, w\_t = 0.20 and w\_a = 0.05. Learn them by constrained logistic regression of acceptance on the four terms, with w\_c bounded below at 0.40 so that taste and price can never outvote clinical value.

**Exploration.** Use Thompson sampling among the top three eligible candidates, with Beta posteriors per cohort, source category and target SKU. Enforce a clinical-gain floor: never explore a candidate worth less than 90% of the best eligible clinical gain.

**Sponsorship.** A sponsorship boost applies only when U(a) is within 3% of the best eligible utility, is always labelled, and is capped at one sponsored item in three suggestions. Log the sponsored flag and rank for every offer so that ranking audits are possible.

**Evaluation.** Because nudges are randomised in part, evaluate policies offline with inverse-propensity or doubly robust estimators on the logged propensities, then confirm with an A/B test. Track acceptance at rank 1, realised clinical gain, and realised price change.

### 4.5 Stakeholder output mapping

| Stakeholder | Payload | Contents | Cadence | Privacy tier | Delivery |
| --- | --- | --- | --- | --- | --- |
| Hospital | Clinical compliance and billing log | Per patient: adherence score with interval, per-nutrient variance, top contributing items, safety events, engagement, profile-change proposals, outcome trends. Care-management contact log with staff identity, date, channel and minutes entered by clinicians | Real time in the dashboard; weekly digest; export on demand | T0 (identity re-bound inside Zone 1) | Dashboard, PDF, FHIR export of scores as Observations |
| Insurer | Risk cohort and forecast report | Cohort counts and strata, mean adherence, trajectory forecasts with intervals, relapse hazard curves, avoided-event estimates with a stated method and uncertainty | Monthly | T4 (Expert Determination); member-level only under payer-sharing consent | Secure portal, signed PDF and CSV |
| Retail grocer | Category conversion and demand report | By category and opaque segment: impressions, swaps offered and accepted, price elasticity, healthy-SKU share, demand forecast for the eligible set | Weekly | T5 (k ≥ 20) | Secure portal, CSV |

**Hospital weekly digest (abbreviated):**

```json
{
  "schema": "nutriscore.hospital_digest/1.0",
  "patient_uuid": "5e3c7a10-8d44-4c0e-9b6a-2f1d0c9a7e11",
  "window": {"from": "2026-11-09", "to": "2026-11-15"},
  "profile_ver": 7,
  "adherence": {"score": 57.5, "ci80": [50, 64], "band": "off_track", "trend_4w": -3.1},
  "variance": [
    {"nutrient": "sodium_mg", "exposure": 2100, "limit": 1500, "v": 0.40},
    {"nutrient": "fibre_g", "exposure": 17, "target": 25, "v": 0.32}
  ],
  "top_contributors": [{"sku_ref": "nav-100231", "nutrient": "sodium_mg", "share": 0.18}],
  "safety_events": 0,
  "engagement": {"weekly_active": true, "overrides": 3, "swaps_accepted": 2},
  "coverage": 0.78,
  "intake_confidence": 0.47,
  "proposals": []
}
```

**Retailer weekly insight (abbreviated):**

```json
{
  "schema": "nutriscore.retail_insight/1.0",
  "retailer_id": "naivas",
  "window": {"from": "2026-11-09", "to": "2026-11-15"},
  "suppression": {"k_min": 20, "cells_suppressed": 3},
  "categories": [
    {
      "category": "pasta_sauce",
      "segment": "S07",
      "shoppers": 46,
      "impressions": 1210,
      "swaps_offered": 388,
      "swaps_accepted": 97,
      "acceptance_rate": 0.25,
      "median_price_delta_pct": 4.2,
      "elasticity": {"b": -1.4, "ci95": [-2.1, -0.7]},
      "forecast_next_4w_units": {"p10": 310, "p50": 390, "p90": 480}
    }
  ]
}
```

**Release controls for retailer and insurer outputs.** Segment codes are opaque (S07, never ‘hypertensive’), and the mapping stays in the enclave. Suppress any cell with fewer than 20 shoppers or 10 orders. Offer fixed reports only, with no ad hoc querying, to prevent differencing attacks. Add Laplace noise (ε = 1 per release \[A\]) to count time series that are published repeatedly. Insurer reports pass an Expert Determination review (Section 5.3) before the first release, and again when the cohort definition or data source changes.

## 5. Privacy-by-design and regulatory compliance architecture

### 5.1 Extension security and minimal footprint (Manifest V3)

**Manifest baseline.** Confirm the exact retailer hosts against the shipped manifest.

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "alarms"],
  "host_permissions": [
    "https://www.naivas.online/*",
    "https://www.carrefour.ke/*",
    "https://gateway.example.co.ke/*"
  ],
  "content_scripts": [{
    "matches": ["https://www.naivas.online/*", "https://www.carrefour.ke/*"],
    "exclude_matches": ["*://*/*checkout/payment*", "*://*/*account*", "*://*/*login*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "background": {"service_worker": "background.js", "type": "module"},
  "content_security_policy": {"extension_pages": "script-src 'self'; object-src 'self'"}
}
```

No tabs, history, webRequest, cookies, clipboard or all-URLs permission. Retailer hosts are the only page access, and the gateway host is the only network destination.

**What is and is never captured.**

| Captured, only with active retail-telemetry consent | Never captured |
| --- | --- |
| Product identifiers, titles and prices on allow-listed pages | Browsing history or any page outside the allow-list |
| Cart line items and quantities | Page text outside product tiles and cart rows |
| An order hash when the order-confirmation page is reached | Form fields of any kind, keystrokes, clipboard, screenshots, cookies |
| Extension events (impressions, swaps, overrides) | Payment details: card numbers, M-Pesa numbers or PINs |
| — | Names, emails, phone numbers, addresses, delivery slots, loyalty numbers |

**Controls.**

- No remote code, no eval, no inline scripts. Pin dependencies, publish an SBOM, and build with signed provenance.
- Validate the sender and schema of every runtime message. Treat page JavaScript as hostile and never read values the page can spoof when deciding safety actions.
- Store the token encrypted with AES-GCM under a non-extractable WebCrypto key. Be honest about the limit: this defends against casual inspection and profile sync leaks, not malware or a compromised browser profile. Keep tokens short-lived and free of identity and diagnosis.
- Render through textContent or sanitised templates, inside a Shadow DOM so that page styles and scripts cannot read or alter the badge.
- Verify signed catalogue deltas and selector manifests on the device.
- **CI gates:** a permission-diff check that fails the build when manifest permissions change without security sign-off; static analysis and dependency audit; unit tests that no code path reads password, card or phone inputs; and a Playwright privacy test that records every outbound request on a fixture checkout and asserts that none contains a forbidden field.
- **Patient controls:** pause on a site, view exactly what has been sent (a telemetry viewer), delete local data, and revoke consent in one tap.
- **Store compliance:** disclose the data handled, link a privacy policy, and follow the limited-use rules (S15).

### 5.2 Roles and lawful basis

Proposed allocation; counsel must confirm it for each customer.

| Activity | Controller | Processor | Basis | Notes |
| --- | --- | --- | --- | --- |
| Clinical record, profile, adherence for care | Hospital (a HIPAA covered entity for US customers) | Platform (business associate) | Provision of care plus explicit consent to the digital programme (KDPA, GDPR Art. 9(2)(a) or (h)); HIPAA treatment and operations | Patient notice must name the platform and its role |
| Pseudonymous retail telemetry for the programme | Hospital for care use | Platform | Explicit consent C2 | Stored in the enclave; never given to the retailer |
| Product-quality and catalogue improvement from telemetry | Platform | — | Explicit consent C4, aggregate only | Optional and separately switchable |
| Retailer’s own order and loyalty data | Retailer | — | Retailer’s own relationship | Platform never joins to it |
| Member-level sharing with an insurer | Insurer (for its members) | Platform | Explicit consent C3, per payer | Default off; expires after 12 months \[A\] |
| De-identified cohort outputs | Platform | — | Expert Determination; contract bans re-identification | If anonymisation cannot be shown, treat as personal data |

HIPAA requires a patient authorisation for any use or disclosure outside treatment, payment and operations, and for any sale of PHI. Marketing and sale use cases are out of scope without a separate legal review.

### 5.3 Tokenisation and de-identification

**Split-key design.** Hospital identity and retail telemetry live in separate zones with separate keys, and only the token service in Zone 2 can relate them.

```
Identity Vault (Zone 1)        Token Service (Zone 2)          Telemetry store (Zone 3/4)
patient_uuid <-> PII           keys K_ret, K_pay (HSM)         shopper_id + events only
       |                              |                              |
       |-- patient_uuid ------------> | derive shopper_id(r, e)      |
       |                              |-- token to device ---------->|
Hospital enclave --(blind join: list of patient_uuid)--> service returns shopper_ids
       job scores telemetry inside the enclave --> returns scores keyed to patient_uuid in Zone 1
Retail and payer enclaves never receive patient_uuid or any key material
```

**Derivation.**

- patient\_uuid is a random UUIDv4. Never derive it, or any pseudonym, from a name, phone number, email or national ID: those are easy to guess and hash, and HIPAA’s re-identification-code rule requires that a code not be derived from information about the individual (45 CFR 164.514(c), S12).
- Shopper\_ID = Base64url( Trunc128( HMAC-SHA256( K\_ret(r, e), patient\_uuid ‖ r ) ) ), where K\_ret(r, e) = HKDF-SHA256(K\_master\_retail, salt = r ‖ e, info = ‘shopper-id/v1’), r is the retailer and e is a 90-day epoch. The identifier differs per retailer and per epoch, so two retailers cannot link a patient, and old telemetry cannot be tied to new telemetry outside the token service.
- Payer\_ID uses a different master key, K\_master\_payer, a 12-month epoch and the payer identifier.
- Keep the two master keys in separate HSM partitions. Rotate them by a 2-of-3 Shamir quorum of custodians: the hospital’s DPO, the platform security lead and an independent custodian \[A\]. No single person can reach both keys.
- The token’s sub claim is the Shopper\_ID for the target retailer, and the token is audience-bound to the extension for that retailer.

**De-identification tiers** (T0–T5, used throughout both documents).

| Tier | Description | Technique | Legal status | Typical recipient |
| --- | --- | --- | --- | --- |
| T0 | Identified clinical data | None; access control | Personal and sensitive data; PHI | Hospital |
| T1 | Pseudonymous operational data | Per-retailer, per-epoch Shopper\_ID | Still personal data under KDPA and GDPR (S11); PHI if linkable | Platform operations, enclaves only |
| T2 | HIPAA limited data set | Direct identifiers removed; dates and geography kept | Needs a data use agreement | Optional US research partners |
| T3 | Safe Harbor de-identified (S12) | Remove all 18 identifier types: names; geography below state (first three ZIP digits only if the area has over 20,000 people); all date elements except year; ages over 89; phone, fax, email, SSN, medical record, plan, account and licence numbers; vehicle and device identifiers; URLs; IP addresses; biometric identifiers; face photographs; any other unique code. No actual knowledge that the rest could identify someone | De-identified under HIPAA | Static cohort statistics only |
| T4 | Expert Determination (S12) | A qualified statistician documents that re-identification risk is very small; may keep relative time (days since enrolment), coarse geography and age bands; re-run on material change | De-identified under HIPAA. Under KDPA and GDPR, anonymisation must withstand means reasonably likely to be used, so treat T4 as personal data unless that is demonstrated | Insurers |
| T5 | Aggregate with k-anonymity | k ≥ 20, cell suppression, count noise | Aggregate statistics | Retailers, brands |

Because Safe Harbor strips every date finer than a year, it cannot carry event timestamps. Any time-series or longitudinal product, which includes insurer trajectory forecasts, must therefore be built under Expert Determination.

**Re-identification testing.** Quasi-identifiers are age band, sex, county, cohort and enrolment month. Test with prosecutor, journalist and marketer attack models; check k-anonymity and l-diversity; and simulate a linkage attack in which a retailer holds its own order records and tries to match them to released data. A maximum acceptable risk of about 0.09 is commonly used in clinical data release practice \[A\]; the expert sets the final value. Repeat the test whenever a cohort definition, a data source or a release field changes.

### 5.4 Consent management and audit trail

**Consent purposes.**

| Code | Purpose | Default | Effect of revocation |
| --- | --- | --- | --- |
| C1 | Clinical programme: use of clinical data to build the profile and dashboard | Off until granted at the clinic | Platform processing stops; the clinician continues ordinary care |
| C2 | Retail telemetry: pseudonymous shopping events | Off | Collection stops (below); the patient keeps grades on the device if C1 is active |
| C3 | Payer data sharing, per named insurer | Off | Member-level sharing stops; aggregate cohort inclusion continues only if C4 is active |
| C4 | Aggregate analytics and service improvement | Off | Patient is excluded from future releases |

Capture consent in plain English and Swahili, with the notice-text hash stored in the receipt. Allow clinic-assisted consent for patients with low digital confidence, with the staff member recorded as witness, and use a guardian for minors. Because stakeholders have questioned whether the Digital Health Act’s consent definition reaches informed consent (S9), write the notice and the receipt to the stricter informed, specific, written standard.

Consent receipt (stored in Zone 1 and mirrored as a FHIR Consent resource):

```json
{
  "schema": "nutriscore.consent_receipt/1.0",
  "consent_id": "cr_2c71",
  "purpose": "C2",
  "recipients": ["platform-enclave"],
  "notice_hash": "sha256:9f2c...",
  "language": "sw",
  "method": "clinic_assisted",
  "witness_staff_id": "st-0441",
  "granted_at": "2026-11-12T08:20:00Z",
  "expires_at": "2027-11-12T08:20:00Z",
  "state": "active",
  "revoked_at": null,
  "evidence_hash": "sha256:b71e..."
}
```

**Enforcement.** Run a policy decision point (for example Open Policy Agent or Cedar) over the consent registry, with default deny. Policy enforcement points sit at the token service (refuses to issue without active C1 and C2), the telemetry gateway, every ETL job (row-level consent filter), every export job and every dashboard API.

**Revocation propagation SLAs \[A\].**

| Step | Target |
| --- | --- |
| Gateway rejects new events from the revoked consent | Immediately (fail closed) |
| Revocation list published to the token service | Within 1 minute |
| Extension stops collecting and clears its queue | Within 5 minutes during an active session; at next start otherwise |
| Exclusion from the next analytics run | Within 24 hours |
| Purge of silver and gold rows derived from the patient | Within 30 days |
| Backups age out | Within 35 days |
| Notice and stop request to downstream recipients | Within 24 hours; recipients bound to comply within 30 days |

**Data-subject rights.** Support access, rectification, erasure, portability and objection from one workflow, designed to the shortest statutory period across the regimes (design for 7 days \[A\]; confirm the periods in the Kenyan regulations (S14)). To reconcile erasure with an immutable audit trail, the audit log holds only pseudonymous references and hashes, and each subject’s payloads are encrypted under a per-subject data key. Deleting the key (crypto-shredding) makes the payloads unreadable while the hash chain stays intact.

**Immutable audit log.**

- Each entry holds: sequence number, trusted UTC time, actor (identity, role, service), purpose, pseudonymous subject reference, resource, action, before and after hashes, the policy decision (policy version, rule, allow or deny), the previous entry hash, and entry\_hash = SHA-256(canonical entry ‖ prev\_hash).
- Every 60 seconds, build a Merkle tree over new entries, sign the root with an HSM-held Ed25519 key, and write it to write-once storage (object lock or append-only volume) in Kenya.
- Once a day, anchor the root to an RFC 3161 time-stamping authority and send a copy to a second custodian (for example the hospital’s compliance office), so the platform cannot rewrite history alone.
- Verification: a tool recomputes the chain and produces a Merkle inclusion proof for any entry. A daily automated check plus a weekly independent check alert on any gap or mismatch within 5 minutes.
- Log every transformation and handoff: ingestion, validation, profile compilation and signing, token issuance, telemetry accept or reject, each ETL run (input and output hashes plus code version), each score, each model prediction, each report, each export (recipient, tier, dataset hash, legal basis, expiry), every read of T0 data, consent changes, administrator actions and key operations.
- Retain for at least 6 years, the HIPAA documentation period \[A\]; confirm any longer Kenyan health-record retention duty.

```json
{
  "seq": 884213,
  "ts": "2026-11-14T09:13:02.044Z",
  "actor": {"id": "svc-etl-scoring", "role": "service", "code_ver": "scoring@3.1.0"},
  "purpose": "C1/care",
  "subject_ref": "sr_44c1e9",
  "resource": "adherence_score/2026-W46",
  "action": "compute",
  "before_hash": null,
  "after_hash": "sha256:5d10...",
  "policy": {"pdp": "opa@2026-11", "rule": "allow_scoring_with_c1_c2", "decision": "allow"},
  "prev_hash": "sha256:a3e7...",
  "entry_hash": "sha256:0b9c..."
}
```

### 5.5 Hosting, residency and cross-border flows

| Component | Hosting | Condition |
| --- | --- | --- |
| Zones 1 and 2 (clinical, token exchange) | A Kenyan data centre, with a second Kenyan site for backup | Meets the localisation expectation for processing tied to healthcare provision (S8) |
| Zone 3 gateway and Zone 4 enclaves | Kenya | No egress to non-Kenyan destinations except the allow-listed ones below |
| Analytics, monitoring and ML tooling | Self-hosted inside Kenya | No identified or pseudonymous data to foreign SaaS or foreign model APIs |
| Support access from abroad | Off by default | Remote access counts as a transfer (S8); allow only through a controlled desktop with no data egress, under a documented transfer assessment |
| US customers | Separate US-region tenant under a BAA | No co-mingling with Kenyan data |
| EU data subjects | EU region, or Kenya with standard clauses and a transfer assessment | Watch the EU–Kenya adequacy outcome (S8) |

**Transfer decision rule.** (1) Is the data sensitive? Then a transfer needs the subject’s consent and appropriate safeguards (S8). (2) Does the processing fall in a localisation category, such as primary or secondary healthcare provision? Then keep it on a Kenyan server, or at least a serving copy there. (3) Would the recipient use the data for its own analytics, profiling, product improvement or marketing? Then do not transfer; that use is prohibited. Record the decision in a transfer assessment, and review it when the recipient, the law or the data changes.

### 5.6 Threat model, DPIA and breach response

| Threat | Example | Control |
| --- | --- | --- |
| Spoofing | A fake retailer page or a cloned extension | Pinned origins, store signing, signed tokens bound to the audience |
| Tampering | Altered token or catalogue | Signatures verified on the device; hash-chained audit log |
| Repudiation | A clinician denies a profile change | Signed profile versions with clinician identity; audit log |
| Information disclosure | A basket reveals a health condition; a retailer links a patient across datasets | Per-retailer pseudonyms; telemetry kept in the enclave; k-anonymity; opaque segment codes |
| Denial of service | A retailer redesign breaks the adapter | Fail open; signed selector updates; nightly canaries |
| Elevation of privilege | A user reads patients with no treatment relationship | Role-based plus relationship-based access; break-glass with alert and review |

**Inference risk is the subtle one.** Even a pseudonymous basket can reveal that a shopper avoids sodium or sugar. Treat T1 telemetry as health-sensitive, keep it inside the enclave, and never give it to retailers or brands.

**DPIA.** Complete one before the pilot: describe the processing, assess necessity and proportionality, list the risks to patients, record the mitigations above, and consult the regulator if high residual risk remains. Large-scale processing of sensitive data is a stated trigger under the Kenyan regulations (S14). Also run a HIPAA-style security risk analysis for any US tenant.

**Breach response.** Detect, contain and assess within 24 hours. Notify the regulator within 72 hours under the Kenyan Act and GDPR, and affected individuals under HIPAA within 60 days (confirm each deadline against the primary text, S14). Keep a rehearsed runbook and test it twice a year.

## 6. Delivery plan, acceptance tests and open decisions

### 6.1 Build sequence

Dates are targets \[A\] and line up with the pilot in the Blueprint (Day 0 in early February 2027).

| Phase | Window | Scope | Exit criterion |
| --- | --- | --- | --- |
| P0 Foundations | Nov–Dec 2026 | Hosting decision; key ceremony and HSM; consent registry; audit log and verifier; schema registry; DPIA and regulator registration | Audit-tamper test (T-10) and residency scan (T-14) pass |
| P1 Clinical and token path | Dec 2026–Jan 2027 | Ingestion adapter, guideline library with clinical sign-off, profile compiler and signer, token service, token verification in the extension, telemetry gateway, bronze and silver layers; catalogue coverage sprint | T-01, T-02, T-05, T-06, T-07 pass; grade coverage at least 80% |
| P2 Scoring and clinician loop | Jan 2027 | Adherence and variance engine, hospital dashboard digest, safety events, revocation flow, data quality gates | T-04, T-08, T-11, T-12, T-13 pass; Gate 0 review |
| P3 Pilot | Feb–May 2027 | Operations, shadow-mode adaptation, interim analytics, weekly safety review | Pilot Gates 1–3 (Blueprint, Section 6.5) |
| P4 Scale | From mid-2027 | Insurer enclave with Expert Determination study, retail enclave, prescriptive engine v2, external security and privacy audit, optional retailer SDK | Audit report with no critical findings |

### 6.2 Acceptance tests

| ID | Requirement | Test | Pass condition |
| --- | --- | --- | --- |
| T-01 | Token carries no identity or diagnosis | Schema check plus red-team review of every issued claim | Zero forbidden fields |
| T-02 | Token authenticity | Verify offline; tamper with one byte, change audience, expire the token | Each variant rejected |
| T-03 | Latency | 100 recorded fixture pages across retailers | P95 ≤ 120 ms goal; hard limit 200 ms |
| T-04 | Grade accuracy | 20-product reference set from the official workbook, plus each retailer’s top 500 SKUs | 20 of 20 exact; no regression |
| T-05 | Mapping precision | Labelled pair set | M1–M3 ≥ 99.5% precision; M4 ≥ 97% at the 0.92 threshold |
| T-06 | No forbidden capture | Playwright network capture on fixture login, account and payment pages | No outbound request contains a forbidden field; adapter inactive on excluded paths |
| T-07 | Permission discipline | Manifest diff in CI | Any permission change fails the build without security sign-off |
| T-08 | Revocation | Revoke C2 during a live session | Gateway rejects events at once; client stops within 5 minutes; purge within 30 days; audit entry present |
| T-09 | Re-identification | Linkage-attack simulation using retailer order data and public attributes | Risk below the expert-set threshold; k ≥ 20 on every release |
| T-10 | Audit integrity | Alter one stored entry | Verification fails and an alert fires within 5 minutes |
| T-11 | Data quality | All gates in Section 2.8 | Pass for 14 consecutive days |
| T-12 | Scoring correctness | Property tests plus the worked example | Reproduces AS = 57.5 and VS = 0.28; monotonicity holds |
| T-13 | Fail-open | Take the catalogue offline | Neutral state; zero blocks |
| T-14 | Residency | Egress allow-list scan of Zones 1 and 2 | No traffic to non-Kenyan destinations except documented exceptions |
| T-15 | Recovery | Restore from backup | Within the agreed recovery time; audit chain verifies afterwards |

### 6.3 Open decisions

| # | Decision | Owner | Needed by |
| --- | --- | --- | --- |
| 1 | Hosting provider and HSM versus cloud KMS | CTO | Before P0 key ceremony |
| 2 | Controller and processor allocation per customer | General counsel | Before the first contract |
| 3 | Expert-determination statistician or firm | Privacy lead | Before the first insurer release |
| 4 | Clinical sign-off of guideline library v1 | Clinical lead | End of P1 |
| 5 | Default block mode: confirm-and-override or hide | Clinical lead and product | End of P1 |
| 6 | Retailer SDK versus page adapters, per retailer | CTO and VP BD | Before pilot partner signature |
| 7 | Whether to support a US tenant under HIPAA in 2027 | CEO | Q1 2027 |
| 8 | Quasi-identifier list and acceptable risk threshold | Privacy lead and statistician | Before the first insurer release |

### 6.4 Reconciliation with the earlier business-model sketch

The earlier four-stage sketch (clinical dashboard, translation engine, retail extension, closed-loop reporting) is the basis of this design. These technical points differ, deliberately.

| Sketch element | Treatment here | Reason |
| --- | --- | --- |
| The translation engine turns raw values (for example HbA1c above 7.0 with pressure above 140/90) into restrictions automatically | A guideline library proposes defaults and the clinician confirms and signs; automation may adjust weights only (Section 3.4) | The clinician is the authority (P2); an unreviewed biomarker-to-restriction rule is a patient-safety and liability risk. A per-serving rule such as 140 mg of sodium can be offered as an optional product filter |
| The signed JSON carries the restriction set | Kept, but split: the clinical profile stays in Zone 1 and the token carries semantic limits only (Section 1.2) | Diagnosis and biomarkers must not travel with the shopper (P3) |
| High-sodium items are hidden or greyed out | Confirm-and-override dialog with a reason code; a hard block only for declared allergens; no silent hiding | Patient autonomy, safety if a record is wrong, and less breakage on retailer pages |
| Audit line: timestamp, token ID, SKU attempted, action, SKU substituted | Expanded to the envelope in Section 2.3 with consent reference, cart episode, profile version and reason class | Needed for deduplication, consent enforcement and replay safety |
| Dashboard launched from the EHR during a check-up | Supported: add SMART on FHIR EHR-launch alongside backend services in the ingestion adapter | Matches clinician workflow and lets the dashboard receive patient context at launch |
| Day 30, 60 and 90 stakeholder reports | Kept and mapped to Gates 1–3 and the payloads in Section 4.5 | Gives each funder a dated, evidenced decision point |
| Biometric progress charts flow to the insurer | Only as T4 cohort data under Expert Determination, or member-level under consent C3 | HIPAA, GDPR and Kenyan rules on sensitive data; non-adverse-use covenant |

## Sources and evidence notes

Source numbers S8–S11 are listed in the Blueprint. Sources S12–S15 below are primary references that I relied on from general knowledge and did not re-fetch while writing, so verify them before they are cited externally. Accessed 11 November 2026.

- **S8** Covington & Burling, *Kenya issues new cross-border data transfer guidance*, 16 September 2026 (on the ODPC Guidance Notes of 8 September 2026): sensitive-data transfers, localisation categories, cloud as transfer, onward-use prohibition, EU–Kenya adequacy process.
- **S9** Clyde & Co, *Health data protection in Kenya*, 17 March 2026; Digital Health (Data Exchange Component) Regulations 2025 and Digital Health (Health Information Management Procedures) Regulations 2025, Parliament of Kenya library; a stakeholder submission on the Act’s consent definition.
- **S10** Fierce Healthcare, *Feds push back HIPAA Security Rule overhaul to July 2027*; Clearwater Security, 2026 enforcement commentary.
- **S11** European Data Protection Board, *Guidelines 01/2025 on pseudonymisation* (consultation text; check the final version).
- **S12** US Department of Health and Human Services, guidance on de-identification of protected health information under the HIPAA Privacy Rule, 45 CFR 164.514(b) and (c). Primary text; not re-fetched.
- **S13** LOINC (loinc.org) and HL7 FHIR R4 resource definitions for Observation, Condition, NutritionOrder, Consent, AuditEvent and Provenance. Primary; not re-fetched; verify code values against the current LOINC release.
- **S14** Kenya Data Protection Act 2019 and Data Protection (General) Regulations 2021, odpc.go.ke. Primary text; use for section numbers, DPIA triggers, breach-notification and data-subject-request deadlines.
- **S15** Chrome for Developers, Manifest V3 documentation, and the Chrome Web Store user-data policy. Verify the current text.
- **Internal** NutriScore Checkout Tool deck (September 2026): shipped detection with a 300 ms mutation debounce, the five-tier review scale, the 20-product reference-test requirement, FSA-NPS scoring, and the earlier finding that Open Food Facts lacked major Kenyan brands; the uploaded Nutriscore\_Business\_Model.md sketch.
