# ADR-012: Append-Only Cryptographic WORM Audit Trail & Hash Chaining

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Security Team
- **References:** `Docs/BLUEPRINT_DEVIATIONS.md` (D-009, D-010), `db/migrations/0001_baseline.sql`, `scripts/verify-audit-chain.mjs`

---

## Context
As a clinical healthcare platform operating under Kenya Data Protection Act 2019 and international healthcare standards, every modification to clinical prescriptions, tenant membership, consent status, and emergency access grants must produce an untamperable audit record:
1. **Tampering Vulnerability:** Traditional database audit tables with standard permissions allow malicious actors or compromised service credentials to alter or delete past log entries to conceal unauthorized access.
2. **Medical Malpractice Defense & Statutory Oversight:** Audits must be admissible in statutory inquiry and court proceedings, requiring mathematical proof that records were created at the claimed time and have not suffered bit-level alteration.
3. **Emergency "Break-Glass" Access:** In clinical emergencies, clinicians may request elevated access to patient data outside their normal tenant roster. This break-glass access must be strictly audited, read-only, time-boxed (≤ 24 hours), and impossible to conceal.

---

## Decision
We implement an **Append-Only Write-Once-Read-Many (WORM) Cryptographic Audit Trail** directly in PostgreSQL:

1. **Database Schema & Permissions (`audit.ledger`):**
   - The `audit` schema is strictly isolated from standard application roles.
   - All `UPDATE`, `DELETE`, and `TRUNCATE` operations on `audit.ledger` and `clinical.clinical_records` are revoked from all users and roles (including service roles).
   - A PostgreSQL statement-level trigger (`trg_clinical_records_deny_mutation`) unconditionally aborts any mutation attempt with an exception.
2. **SHA-256 Hash Chaining:**
   - Every audit ledger record contains:
     - `sequence_id`: Monotonically increasing 64-bit integer.
     - `previous_hash`: SHA-256 digest of the immediately preceding record.
     - `record_hash`: SHA-256 digest computed across `(sequence_id, timestamp, tenant_id, actor_id, event_type, payload, previous_hash)`.
   - Modifying any historical record breaks the entire subsequent cryptographic chain.
3. **Merkle Checkpoint Verification:**
   - Periodic Merkle roots are computed and verified by automated tools (`scripts/verify-audit-chain.mjs`).
   - Platform auditors hold `svc_audit_reader_platform` privileges, allowing them to inspect audit metadata and cryptographic proofs across tenants without reading sensitive clinical payload content.
4. **Time-Boxed Break-Glass Grants:**
   - Break-glass grants (`clinical.break_glass_grants`) are strictly read-only, require documented clinical justification, and are capped at a maximum of 24 hours via database check constraints (`expires_at <= granted_at + INTERVAL '24 hours'`).
   - Expired break-glass grants automatically fail RLS evaluation on query without relying on background batch timers.

---

## Consequences & Rules

### Positive Consequences
- **Mathematical Non-Repudiation:** Tampering with audit logs is cryptographically detectable by automated verification scripts.
- **Statutory Admissibility:** Satisfies forensic evidentiary standards under Kenyan and international law.
- **Strict Role Boundaries:** Platform auditors cannot view patient diagnoses while verifying audit chain continuity.

### Trade-offs & Operational Risks
- **Immutable Log Volume:** The audit ledger grows continuously; automated partition strategies must be planned for multi-year enterprise production.

### Strict Enforcement Rules
1. **Never Grant Mutation Rights on Audit Tables:** Never grant `UPDATE`, `DELETE`, or `TRUNCATE` on `audit.ledger` or `clinical.clinical_records`.
2. **Mandatory Hash Continuity Check:** CI and scheduled maintenance runs must execute `node scripts/verify-audit-chain.mjs` to confirm 100% chain integrity.

