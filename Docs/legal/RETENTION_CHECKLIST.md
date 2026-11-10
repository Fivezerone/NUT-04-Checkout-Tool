# Retention Checklist

> This document is a **human gate**. It must be signed before production deployment.
> See ADR 0005 and binding decision 4.

## Legal references

| Instrument | Relevant provision | Status |
|---|---|---|
| Kenya Data Protection Act 2019 | s.46 — retention of personal data | ⬜ Counsel review required |
| Health Information Management Regulations 2024 | Reg 24 — retention of health records | ⬜ Counsel review required |
| Kenyan Ministry of Health guidelines | Electronic health record retention | ⬜ Identify applicable guidance |

## Implemented defaults

| Data category | Retention | Enforced by |
|---|---|---|
| Shopping ledger (device/IndexedDB) | 90 days | Client-side `ledger-retention` alarm |
| Clinical targets, consents (server) | `CLINICAL_RETENTION_YEARS` years (default 20) | `retain_until` column + DB guard trigger |
| Audit log | Append-only, indefinite | `BEFORE DELETE` policy revocation |
| Crypto-shredded (erased) records | Key deleted; ciphertext retained | Existing shredding function (R7) |

## Questions for counsel

1. Does the 20-year default for clinical health records comply with Reg 24 for
   this category of application (retailer shopping data used for clinical guidance)?
2. Does the 90-day client-side purge create any conflict with the server-side
   20-year retention (they hold different data — device ledger vs. clinical targets)?
3. Is crypto-shredding an acceptable erasure mechanism under DPA s.46 and the
   right to erasure?
4. Are there any sector-specific shorter retention limits for nutritional data
   that override the general 20-year health-record rule?

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Legal counsel | — | — | — |
| Data Protection Officer | — | — | — |
| Engineering lead | — | — | — |

> [!CAUTION]
> Do not deploy to production until all three signatories have completed this checklist.

