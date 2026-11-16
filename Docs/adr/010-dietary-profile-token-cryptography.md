# ADR-010: Dietary Profile Token (DPT) Cryptographic Architecture

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering, Cryptography & Clinical Lead
- **References:** `src/shared/dpt.ts`, `src/shared/dpop.ts`, `src/shared/signer.ts`

---

## Context
When a patient shops at a retail supermarket, the browser extension needs to enforce the clinical dietary prescription established by the patient's clinician. However, transmitting healthcare data to a browser extension creates acute privacy vulnerabilities:
1. **Diagnosis Linkability & Stigma:** If an extension token states "Hypertension", "Kidney Disease (Stage 3)", or "Type 2 Diabetes", any observer inspecting extension storage, network logs, or DOM messages can deduce the shopper's medical diagnoses.
2. **Retailer Tracking:** Retailer web pages could potentially probe extension state to profile consumers based on medical conditions, raising severe discrimination risks.
3. **Token Tampering:** Malicious shoppers could modify their dietary limits locally to bypass alerts or fraudulently qualify for insurer health discounts or vouchers.
4. **Clinical Safety Conflicts (G-03 & G-04):** Static analysis revealed that early code rounded limit bands up (a 500 mg sodium ceiling becoming 600 mg), and treated missing nutrient data as conforming. This violated the clinical safety rule: *fail-closed on recommendations, fail-safe on restrictions*.

---

## Decision
We implement the **Dietary Profile Token (DPT)** architecture: a cryptographically signed, semantic-only constraint token bound via DPoP (Demonstrating Proof-of-Possession):

1. **Semantic Constraints Only (Zero Condition Names):**
   - Condition names, diagnoses, ICD-10 codes, and clinical rationale are **strictly banned** from the token payload.
   - The token contains only dimensionless numerical nutrient thresholds and constraint flags from an explicit allowlist (`ALLOWLISTED_KEYS` in `src/shared/dpt.ts`):
     - `sodium_mg_per_100g_max`
     - `sugar_g_per_100g_max`
     - `sat_fat_g_per_100g_max`
     - `fibre_g_per_100g_min`
     - `protein_g_per_100g_min`
     - `energy_kcal_per_100g_max`
   - Rejection Regex: `CONDITION_NAMED_PATTERNS` explicitly rejects tokens containing words like "diabetes", "hypertension", "renal", "cardiac", etc.
2. **Cryptographic Signing & Proof of Possession:**
   - Tokens are minted by the prescribing healthcare clinic using an Ed25519 signing key (`mintDpt()`).
   - Tokens are bound to the client device using an asymmetric DPoP keypair (`src/shared/dpop.ts`), preventing token theft and replay on unauthorized devices.
   - The extension verifies the Ed25519 signature before loading constraints (`verifyDpt()`).
3. **Dual-Alias Privacy Derivation:**
   - Cross-retailer tracking is prevented via dual pseudo-anonymous aliases (`deriveShopperAlias`):
     - `retailer_alias`: Derived using HMAC-SHA256 with a per-retailer, per-epoch salt.
     - `tenant_alias`: Derived using a separate clinic salt.
     - A shopper visiting Quickmart cannot be linked to the same shopper visiting Carrefour or Naivas.
4. **Cohort Gate & K-Anonymity ($k \ge 5$):**
   - Aggregated commercial insights or reporting views require a minimum cohort size of $k \ge 5$ shoppers (`evaluateCohortSuppression`). Small cells are suppressed to prevent re-identification.
5. **Fail-Closed Clinical Safety:**
   - Swaps and recommendations require verified nutrient data. If a product has missing or unverified nutrition data, the recommendation engine fails closed: it will never recommend an unknown product as a healthy swap.

---

## Consequences & Rules

### Positive Consequences
- **Mathematical Privacy:** Inspecting the token reveals zero diagnostic or medical information; it reveals only food nutrient thresholds.
- **Tamper-Proof:** Any local modification to nutrient limits invalidates the Ed25519 cryptographic signature.
- **Unlinkable Shopping Sessions:** Retailers cannot correlate shopper identities across supermarket domains.

### Trade-offs & Operational Risks
- **Key Rotation Management:** Clinic Ed25519 public keys must be distributed to extensions via trusted catalog/pack sync.

### Strict Enforcement Rules
1. **Never Put Medical Names in Tokens:** Any PR introducing condition names or medical diagnoses into `DptPayload` or token generators will be rejected.
2. **Conservative Banding:** Banding functions must never round maximum limits upward (a 500mg limit must round down to 400mg or remain exact, never round up to 600mg).
3. **Fail-Closed on Swaps:** Never recommend a swap product unless its nutritional fields are verified (`review_state >= ESTIMATED`).

