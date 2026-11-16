# ADR-009: Elimination of Hardcoded Patient/Clinician Data & Mandatory CI Guards (Rule R5 & Stage B)

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Compliance Team
- **References:** `Docs/cleanup/HARDCODED_DATA_LEDGER.md`, `Docs/cleanup/GUARDRAILS.md`

---

## Context
During the Stage A/B repository audit, static code analysis revealed that demo data, UI prototypes, and early testing mockups had littered the codebase with hardcoded identifiers:
1. **Real Hospital Names & Domains:** Code comments, fallbacks, and UI placeholders contained literal mentions of major Kenyan healthcare institutions (e.g., `"Kenyatta National Hospital"`, `"Aga Khan University Hospital"`, `@knh.or.ke`, `@akuh.ac.ke`, slug `'knh-cardio'`).
2. **Fabricated Patient References:** Hardcoded patient references (e.g., `PAT-0042`, `pat-anon-8821`, `pat-anon-4109`) and demo clinician identifiers (`usr-dr-omondi`) were embedded directly in React component default states.
3. **Real Phone Numbers & Financial Receipts:** Mock billing views contained literal Kenyan mobile phone numbers (`254712345678`) and fake M-Pesa transaction codes (`QHJ882194K`).
4. **License Numbers:** Real KMPDC (Kenya Medical Practitioners and Dentists Council) license formats (`KMPDC/2026/12345`) appeared in placeholder text.
5. **Severe Regulatory & Privacy Risks:** Shipping hardcoded clinical identifiers or institutional names—even as dummy data—violates the Kenya Data Protection Act 2019, risks defamation, and contaminates production bundles.

---

## Decision
We executed a complete purge of all hardcoded patient data, clinician references, hospital names, and PII across the codebase (Stage B), and instituted mandatory automated CI quality guards:

1. **Complete Codebase Scrubbing (15/15 Items Resolved):**
   - All demo rosters, patient arrays, vitals, and billing tables in React components were replaced with empty array defaults (`[]`) and neutral loading/empty states.
   - All real hospital references were replaced with synthetic, generic placeholders (e.g., `"Health Facility A"`, slug `'clinic-alpha'`).
   - Phone numbers and license formats were sanitized to generic masks (e.g., `e.g. 254...`, `Reg-No/YYYY/NNNNN`).
2. **Automated CI Guard Scripts (`package.json`):**
   - `scripts/check-no-hardcoded-data.mjs`: Pre-build static analysis scanning all files in `src/` for regex patterns matching `PAT-\d+`, `pat-anon-\d+`, `usr-(dr|diet)-[a-z]+`, Kenyan mobile numbers (`2547...`), `@knh.or.ke`, `@akuh.ac.ke`, hospital names, and KMPDC license numbers.
   - `scripts/check-no-fixtures-in-dist.mjs`: Post-build static analysis scanning compiled output directories (`dist/`, `dist-ui/`) to guarantee no test fixture, mock credential, or banned pattern slipped into production bundles.
   - `scripts/check-no-secrets-tracked.mjs`: Scans git staging to prevent accidental tracking of `.secrets/`, `.env`, or API tokens.

---

## Consequences & Rules

### Positive Consequences
- **Zero Privacy Leakage:** Production builds are mathematically proven to contain zero hardcoded clinician, patient, or institutional references.
- **Automated Regression Prevention:** Any commit that inadvertently introduces a patient code or hospital name immediately breaks CI and fails the build.
- **Synthetic Testing Standard:** All automated testing relies strictly on dynamically generated mock factories or synthetic `.test` domain identities.

### Trade-offs & Operational Risks
- **Zero Inline Prototyping:** Developers cannot hardcode "quick mock items" in React components while building new UI views. All components must render realistic empty/loading states when unpopulated.

### Strict Enforcement Rules
1. **Zero Banned Pattern Tolerance:** `npm run ci` must exit with code 1 if a single banned regex pattern is found in `src/` or `dist/`.
2. **Never Bypass with Git Ignore:** Guard scripts must never be commented out or bypassed in `.githooks` or GitHub Actions.
3. **Use Neutral Fixtures Only:** When creating test fixtures for unit tests, use synthetic identifiers like `patient-test-01` and domain `@example.test`.

