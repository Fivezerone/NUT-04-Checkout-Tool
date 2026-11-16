# ADR-005: Dual-Tier Data Retention Policy & Crypto-Shredding Architecture

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted (Statutory Review Baseline)
- **Authors:** NUT-04 Engineering, Legal & Compliance
- **References:** Kenya Data Protection Act 2019 (s.46), Health Information Management Regulations (Reg 24)

---

## Context
The NUT-04 platform bridges consumer shopping telemetry (browser extension grocery browsing) with clinical healthcare prescriptions (clinical dietetic interventions). These two domains have fundamentally conflicting legal and privacy requirements:
1. **Shopper Privacy (Consumer Principle):** Continuous tracking of user shopping habits over years presents severe surveillance and profiling risks. Privacy best practices and DPA minimization principles mandate that device-local shopping histories be ephemeral.
2. **Clinical Healthcare Retention (Medical Principle):** Under Kenyan health law (Kenya Health Act, 2017 and Health Information Management Regulations), clinical patient records, dietary prescriptions, and care team audit trails must be preserved for medical continuity and malpractice defense for a minimum statutory period (default 20 years).
3. **Right to Erasure vs. Statutory Duty:** When a patient requests account erasure (GDPR Art. 17 / Kenya DPA s.40), medical retention laws prohibit deleting clinical records.

---

## Decision
We implement a **Dual-Tier Retention Policy** enforced by distinct client-side and server-side mechanisms:

### 1. Client-Side (Device / UI Shopping Ledger): 90-Day (3-Month) Hard Ceiling
- All IndexedDB shopping ledger entries (`nut04-nutriscore`) older than 90 days are automatically purged.
- A daily background Chrome alarm (`ledger-retention`) deletes entries where `addedAt < Date.now() - 90 * 24 * 60 * 60 * 1000`.
- All client timeline queries (`timeframes.ts`) enforce 4 views: `today`, `week`, `month`, and `3months`. Options for `year` or `all` are strictly eliminated.
- All API sync requests send `since=<retentionCutoff>` so the server never returns stale client telemetry.

### 2. Server-Side (PostgreSQL Clinical & Audit Records): 20-Year Configurable Statutory Retention
- Clinical tables (`clinical.clinical_records`, `clinical.patient_targets`, `iam.consents`) include a `retain_until` column defaulting to `created_at + (INTERVAL '1 year' * current_setting('app.clinical_retention_years', true)::int)`.
- Default setting: `CLINICAL_RETENTION_YEARS=20`.
- A PostgreSQL `BEFORE DELETE` trigger strictly denies deletion of rows prior to `retain_until`, **except** via authorized cryptographic shredding (`cryptoShredPatient()`).
- Audit log entries (`audit.ledger`) are strictly append-only; `UPDATE`, `DELETE`, and `TRUNCATE` are revoked from all roles.

### 3. Privacy Erasure via Crypto-Shredding
- When a patient exercises their statutory right to erasure, the system destroys the patient's individual encryption key (`dek`) stored in the Key Management service.
- The encrypted clinical records in `clinical.clinical_records` remain physically present to satisfy medical retention law, but are mathematically unrecoverable ciphertext (effective cryptographic erasure).

---

## Consequences & Rules

### Positive Consequences
- **Privacy By Design:** Shoppers have mathematical guarantees that ancient browsing and grocery habits do not persist on local disks.
- **Statutory Compliance:** Healthcare facilities satisfy Kenyan hospital record retention mandates without violating privacy laws.
- **Auditable Erasure:** Crypto-shredding resolves the conflict between erasure requests and statutory retention.

### Trade-offs & Operational Risks
- **IndexedDB Compaction:** Extensive shopping history is cleared periodically; shoppers cannot view year-over-year grocery trends on the device.

### Strict Enforcement Rules
1. **Never Reintroduce Multi-Year Device Views:** No UI view, chart, or analytics module may query or display device data older than 90 days.
2. **Never Permit Unshredded Hard Deletes on Clinical Tables:** Direct SQL `DELETE FROM clinical.clinical_records` is banned and blocked by statement-level triggers.

