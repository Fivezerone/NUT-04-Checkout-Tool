# ADR 0005 — Retention Policy

**Status:** Accepted (pending legal confirmation)  
**Date:** 2026-11-10  
**Authors:** NUT-04 Engineering

---

## Context

Binding decision 4: "Split. Device and UI data: 3-month ceiling. Clinician views
and server storage: Kenyan health-data retention, default 20 years, pending legal
confirmation, implemented as one configurable policy (`CLINICAL_RETENTION_YEARS`,
default 20) enforced in the database."

---

## Decision

**Client-side (device/UI data):**
- IndexedDB shopping ledger entries older than 90 days are purged automatically
- The `ledger-retention` Chrome alarm fires daily and deletes entries where
  `addedAt < Date.now() - 90 * 24 * 60 * 60 * 1000`
- Every API request for timeline data includes `since=<retentionCutoff>` so the
  server never returns data the client would purge
- The 3-month limit is enforced **client-side only** — the server holds data per
  the clinical retention policy

**Server-side (Postgres):**
- Each clinical/patient-linked table has a `retain_until` column
- A trigger sets `retain_until = created_at + INTERVAL '20 years'` (configurable
  via `CLINICAL_RETENTION_YEARS` env var, default 20)
- A `BEFORE DELETE` guard blocks deletion before `retain_until` **except** through
  the existing crypto-shredding function (R7 — semantics unchanged)
- The audit log is append-only: `UPDATE` and `DELETE` are revoked; hash chain is
  preserved (R7)

**Configuration:**
```
CLINICAL_RETENTION_YEARS=20   # Default; override per deployment
```

---

## Consequences

**Positive:**
- Clear separation between device-local privacy (3 months) and clinical record-keeping (20 years)
- Configurable without code changes
- Crypto-shredding provides GDPR/DPA erasure within the retention window

**Negative / risks:**
- 20-year default needs confirmation from Kenyan health law counsel (DPA s.46,
  HIM Reg 24) **before production**. See `docs/legal/RETENTION_CHECKLIST.md`.
- If legal review requires a shorter or longer period, `CLINICAL_RETENTION_YEARS`
  is the only change needed

**Stop condition:** If legal counsel requires semantics beyond this configurable
policy (e.g., conflicting erasure and retention duties), stop per §8.7.

