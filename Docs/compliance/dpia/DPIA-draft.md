# Data Protection Impact Assessment (DPIA) — Draft
## NutriScore CAD Healthcare Platform & Commercial Extension Overlay

**Document Reference:** `DPIA-2026-NUT-CAD-001`  
**Status:** DRAFT — PENDING LEGAL COUNSEL SIGN-OFF `[COUNSEL]`  
**Governing Law:** Kenya Data Protection Act, 2019 (s. 31); Data Protection (General) Regulations, 2021  
**Regulatory Authority:** Office of the Data Protection Commissioner (ODPC), Kenya  
**Target Submission Window:** ≥ 60 days prior to planned production launch `[COUNSEL]`  

---

## 1. Executive Summary & Purpose

This Data Protection Impact Assessment (DPIA) evaluates the processing operations of the NutriScore Clinical Decision Support and Assessment (CAD) Multi-Tenant Healthcare Backend and its associated Browser Extension Overlay. The system processes sensitive personal data (health and nutritional diagnostic data) under the Kenya Data Protection Act 2019 (s. 44).

The architecture adheres to the principle of **Data Protection by Design and by Default** (s. 41) through cryptographic tenant isolation, field-level envelope encryption, a zero-trust semantic projection outbox, zero knowledge of diagnosis in the commercial zone via banded Dietary Profile Tokens (DPT), and an append-only, tamper-evident WORM audit ledger.

---

## 2. Controller & Processor Classification

- **Platform Operator:** NutriScore Technologies Ltd (Kenya) — Data Processor `[COUNSEL]`
- **Healthcare Providers:** Enrolled Clinics, Hospitals, and Primary Clinicians — Data Controllers `[COUNSEL]`
- **Commercial Retailers:** Partner Supermarkets (Naivas, Carrefour Kenya, Quickmart Kenya) — Independent Controllers for grocery retail, zero access to clinical health records `[COUNSEL]`
- **Data Protection Officer (DPO):** `[COUNSEL: Appointed DPO Name & ODPC Registration Number]`
- **ODPC Registration Status:** `[COUNSEL: Data Controller / Processor Certificate Reference Number]`

---

## 3. Systematic Description of Processing Operations

### 3.1 Data Subjects
1. **Patients:** Individuals undergoing clinical dietary consultation and nutritional therapy.
2. **Clinicians & Healthcare Workers:** Licensed healthcare professionals issuing clinical advice.
3. **Clinic Administrators & Auditors:** Personnel managing clinic rosters and regulatory compliance.

### 3.2 Categories of Personal Data Processed
- **Identifying Personal Data:** Name, phone, email, national ID (retained solely within clinic tenant boundary; strictly excluded from all access tokens and commercial payloads).
- **Sensitive Personal Data (Health):** Anthropometric measurements, metabolic biomarkers, clinical records, condition tags, dietary advice, target nutrient limits.
- **Derived / De-identified Data:** Banded nutritional bounds (e.g. `carbs_g_100g_max: 30`), cryptographic shopper aliases, DPTs.
- **Observed Commercial Metadata:** Extension-observed cart items, SKU matches, timestamp (`commercial.orders` where `source = 'extension_observed'`).

### 3.3 End-to-End Data Flow
```
[ Patient / Clinician ]
        │  (mTLS / TLS 1.3 + Supabase Auth / Keycloak)
        ▼
[ Clinical DB (iam + clinical schemas) ]
   ├── Tenant Wall (FORCED RESTRICTIVE RLS)
   ├── Field-level AES-256-GCM (Row-specific AAD)
   └── Crypto-shredding keys (patient_keys)
        │
        ▼ (Outbox Trigger: 6 Allowlisted Columns Only)
[ Exchange Service (exchange schema) ]
   ├── Scrubbing: Drop device-only & clinical terms
   ├── Cohort Gate: k ≥ 5 anonymity threshold
   ├── Dual Alias: CSPRNG (Browse) / Pairwise HMAC (Order)
   └── Minting: Ed25519 DPoP-bound Dietary Profile Token (DPT)
        │
        ▼ (Token valid 15 mins, memory-only in Extension)
[ Browser Extension / Commercial Zone ]
   ├── Local client-side scoring overlay (No PHI sent to retailer)
   └── Observed cart sync (POST /v1/commerce/observed-orders)
```

---

## 4. Assessment of Necessity & Proportionality

1. **Lawful Basis (DPA s. 30, s. 44):**
   - Health data processing is anchored on **Explicit Consent** (`clinical.consent_records.lawful_basis = {'contract', 'explicit_consent'}`) and provision of healthcare by licensed practitioners (`[COUNSEL]`).
   - Commercial DPT exchange requires explicit, unbundled patient consent for purpose `dietary_profile_sharing`. Consent withdrawal immediately triggers cryptographic revocation and alias erasure.
2. **Data Minimisation (s. 3):**
   - The commercial zone and partner retailers NEVER receive diagnoses, condition names, health tags, or raw clinical records.
   - Prohibited terms (`diabetic_friendly`, `renal_safe`, `low_potassium`, diagnosis codes) are systematically barred and verified by CI tests.
   - Only minimum necessary banded nutritional bounds are communicated in DPTs.
3. **Retention & Disposal (s. 39, Decision D5):**
   - Commercial observed orders and transaction logs: **3 years from deactivation** (`retain_from = 'deactivation'`).
   - Clinical and health records: Retention default is pending counsel determination (`[COUNSEL: Statutory retention period under Digital Health Act / Health Act]`). Purge job fail-safe refuses any class without an explicit retention policy.
   - Ledger integrity: Audit ledger rows are never purged; only encryption keys are destroyed via `clinical.crypto_shred_patient()`, rendering historical PHI permanently unrecoverable across all backups.

---

## 5. Assessment of Risks to Data Subjects & Envisaged Mitigations

| # | Identified Risk | Inherent Severity | Envisaged Mitigation / Technical Control | Residual Risk |
|---|---|---|---|---|
| **R1** | Cross-tenant data leakage between competing clinics | Critical | Forced `RESTRICTIVE` RLS tenant wall on every table (`app_private.tenant_wall`), isolated service roles (`svc_clinical`, `svc_exchange`, etc.), database privilege revocation. | Low |
| **R2** | Inadvertent leakage of patient diagnosis to commercial retailers | Critical | Semantic projection outbox limited to 6 numerical nutrient bounds; strict CI bans on condition names; cohort gate $k \ge 5$ with automatic upward generalisation. | Very Low |
| **R3** | Compromise of database storage / physical media | High | Field-level AES-256-GCM envelope encryption with row-specific AAD (tenant, table, column, row ID); KeyWrapper master key; blind indexes for indexed searches. | Low |
| **R4** | Rogue administrator tampering with audit records | High | Cryptographic WORM audit ledger with SHA-256 hash chains, signed Merkle checkpoints via Ed25519 Signer, offline verifier, and `audit_view_owner` isolation. | Very Low |
| **R5** | Token interception or credential replay | High | RFC 9449 DPoP proof-of-possession binding (`cnf.jkt`); 15-minute token TTL; client memory-only storage; instant revocation denylist on token ID (`jti`). | Low |
| **R6** | Unauthorized data-subject re-identification via cart orders | Medium | Pairwise cryptographic shopper aliases rotated quarterly; demand aggregation view `v_sku_demand` suppresses counts below 5 distinct shoppers; order tracking view `v_orders_tracking` redacts shopper alias. | Low |

---

## 6. Data-Subject Rights Procedures (DPA ss. 26, 38, 40)

1. **Right to Access & Portability (s. 40):**
   - Automated export service (`src/shared/patient-export.ts`) generates a cryptographically signed JSON bundle of all patient records, audited in WORM ledger under `EXPORT_PATIENT_DATA`.
2. **Right to Restriction of Processing (s. 38):**
   - `clinical.set_patient_restriction(tenant_id, patient_id, true)` sets patient `restricted` flag, halting automated processing and token minting while retaining records for clinical care.
3. **Right to Rectification (s. 38):**
   - `clinical.rectify_clinical_record()` creates a new record version while preserving prior versions immutably for medico-legal evidence and audit continuity.
4. **Right to Erasure / Crypto-Shredding (s. 40):**
   - Upon valid erasure request or retention expiry (without legal hold), `clinical.crypto_shred_patient()` destroys wrapped data keys, rendering all encrypted historical records irrecoverable.

---

## 7. Breach Notification & Incident Response (DPA s. 43)

- **72-Hour Statutory Protocol:** Full procedures documented in `docs/compliance/BREACH_RUNBOOK.md`.
- **Automated Detection Triggers:** Continuous verifier (`verify-audit-chain.mjs`), `AUTHZ_DENY` spikes, break-glass session anomalies, and leak-proof canary tests.
- **Reporting:** Immediate assessment by DPO and notification to the ODPC within 72 hours of confirmation of any breach affecting sensitive personal data.

---

## 8. Legal Counsel Review & Sign-Off Checklist `[COUNSEL]`

- [ ] `[COUNSEL]` Confirm Data Controller vs. Data Processor role distribution across Clinics and NutriScore.
- [ ] `[COUNSEL]` Confirm statutory clinical record retention period under Kenyan Law (Digital Health Act 2023 / Health Act).
- [ ] `[COUNSEL]` Review and approve patient consent wording for DPT sharing with commercial retailers.
- [ ] `[COUNSEL]` Formal sign-off on DPIA submission to the Office of the Data Protection Commissioner (ODPC).

**Counsel Name:** `[COUNSEL: Pending Legal Review]`  
**Counsel Practising Certificate Number:** `[COUNSEL: Pending]`  
**Sign-off Date:** `[COUNSEL: Pending]`  
**ODPC Filing Reference:** `[COUNSEL: Pending]`  
