# NUT-04 — Nutri-Score Checkout Tool
## Engineering Runbook & Developer Guide

> **Document Owner:** Kibet — Project Lead, NUT-04
> **Status:** In Review — Consolidated against evidence-linked requirements
> **Standard:** DevOps / SRE Industry Practices, adapted for a client-side-only browser extension
> **Related Docs:** [PRD](./01_PRD_NUT-04.md) · [System Architecture](./02_System_Architecture_NUT-04.md) · [API Reference](./03_API_Reference_NUT-04.md)

---

## Change Log

| Version | Date | Author | Summary of Changes |
|---|---|---|---|
| 0.1 | — | — | Initial skeleton created |
| 1.0 | 2026-08-08 | Claude (doc pass) | Populated from direct inspection of the shipped source tree |
| 1.1 | 2026-08-10 | Claude (consolidation pass) | Replaced the generic recommended-testing table with the actual spec-mandated test types and their exact acceptance targets (§13 of the requirements spec); added a P1–P6 roadmap reconciliation table showing verified status against each phase's claimed exit criteria; added the NFR-004 Preact/React toolchain conflict as a tracked incident-matrix item; added a data-governance backlog section reflecting the confidence-hierarchy/completeness gaps found in the flexible database design |

---

## 1. Document Control

| Field | Value |
|---|---|
| Version | 1.1 |
| Status | In Review |
| Author(s) | Kibet |
| On-Call Rotation Owner | Kibet (no formal rotation — student project) |

---

## 2. Local Development Environment Setup

Unchanged from v1.0 of this document for §2.1–2.5 (Node/toolchain not pinned, no `package.json`, no Docker, first-run checklist). One addition:

### 2.6 Toolchain Conflict to Resolve Before Onboarding a Second Engineer
The requirements spec's NFR-004 mandates Preact specifically, citing a deliberate bundle-size decision ("Preact (not React) is mandated... No Tailwind CSS framework"). Direct inspection of the shipped `popup.html`/`dashboard.html` bundles confirms a Vite + **React** build is what's actually shipping. Whoever restores `package.json` should resolve this explicitly — pin React and update NFR-004, or plan a Preact migration — rather than let a second engineer inherit an ambiguous toolchain decision.

---

## 3. Testing Framework Rules

### 3.1 Actual Spec-Mandated Test Types (Requirements Spec §13) — All Currently Unimplemented

The prior revision of this document recommended a generic Jest/Puppeteer testing approach. The requirements spec is actually far more specific about what's required, with exact numeric acceptance targets tied to the science-grounded framing in Part I of that document. **None of the following exist in the shipped source today** — confirmed by the continued absence of any `*.test.js`, `*.spec.js`, or `__tests__` path:

| Test Type | Spec Requirement | Exact Target | Verified Current Status |
|---|---|---|---|
| Algorithm unit tests | 20 SPF reference products, all 5 FSA-NPS categories, `score-engine.js` output vs. official SPF grade | 100% (20/20) pass | ❌ Does not exist. Given the confirmed fibre-scale and missing-sweetener-penalty gaps (PRD §4, FR-003), this suite would very likely **fail** on beverage and high-fibre products today — building it is also how those two bugs get caught by CI going forward, not just documented here |
| Category classification tests | 50-product test set, 10 per FSA-NPS category | ≥95% (47/50) | ❌ Does not exist |
| Threshold boundary tests | Synthetic products at exactly each DR-00x threshold, ±1 unit | 100% correct activation/suppression | ❌ Does not exist — though the six thresholds themselves were verified by direct source read this pass (see PRD §4, FR-005) and are numerically correct; a boundary-test suite would still catch the FR-011/FR-012 combined-vs-independent divergence that direct threshold reading alone did not initially surface |
| Performance test | 10 products, 25 Mbps 4G throttle, badges within 2s, CLS=0.00 | Pass | ❌ Does not exist; no Lighthouse/DevTools trace artefact found |
| Coverage test | 100-product Naivas test set | ≥70% receive a grade | ❌ Does not exist as an automated test. A reasonable proxy from the dataset audit in the PRD (§5.5) suggests Naivas coverage may currently sit below this — ~33% of Naivas records are missing core macronutrient data entirely |
| WCAG 2.2 AA audit | Lighthouse ≥90, NVDA + VoiceOver walkthrough, keyboard-only nav | Pass | ❌ Does not exist; the badge trigger element also lacks an ARIA role/`tabindex` per direct source inspection (System Architecture, NFR-007) |
| Privacy/security test | Network panel: no PII in outbound requests, HTTPS only | Pass | ✅ No outbound network traffic exists at all in the current build — the OFacts path was never built (ADR-005) and the Firebase/Firestore sync path has since been fully removed from the codebase (ADR-004), not merely left unreachable. Nothing external to audit today |
| UAT | AfyaVentures supervisor + 2 persona-representative users + 1 accessibility tester | Sign-off | ❌ Not conducted. This is also the point at which the four evidence-grounded personas (see PRD §3) should be validated or corrected against real shoppers — they are currently desk research, not tested profiles |

### 3.2 Recommended Build Order
Given the fibre-scale and sweetener-penalty gaps confirmed this pass, build the **algorithm unit test suite first** — it is both the spec's own Must-priority acceptance gate for FR-003 and the fastest way to convert this document's manual findings into a regression-proof CI check. Category classification and boundary tests follow naturally from the same fixture data.

### 3.3 Test Data Management
Unchanged from v1.0: no dedicated small fixture set exists; the offline pipeline's own working files double informally as test data. A ~20-record synthetic fixture spanning all 5 FSA-NPS categories, sourced from the same 20 SPF reference products the spec names, would serve both the algorithm suite and the category-classification suite.

### 3.4 CI Test Gates
Unchanged from v1.0: none configured.

---

## 4. Deployment Procedures

### 4.1–4.4
Unchanged from v1.0 of this document (staging N/A, production via Chrome Web Store dashboard, rollback via version history, feature flags via `user_settings`).

### 4.5 Delivery Roadmap Reconciliation (Requirements Spec §15)

The spec defines six delivery phases with specific exit criteria. Reconciled against verified build status (not against the roadmap's target dates, which this review cannot independently confirm were met):

| Phase | Claimed Exit Criteria | Verified Status |
|---|---|---|
| P1 — Foundations | Scraper detects products; 50 fallback entries with fibre values | ✅ Detection implemented; dataset far exceeds 50 entries (9,274 combined, though ~33% of Naivas entries are missing fibre and other core fields — see PRD §5.5) |
| P2 — Score Engine | 20/20 reference products pass; ≥70% coverage; KNDI validation memo | ❌ Cannot be true as stated — no test suite exists to produce a 20/20 result, and no KNDI memo was found in the reviewed build |
| P3 — Widget MVP | Badge <2s, CLS=0.00; all thresholds trigger; disclaimer visible in all warning states | 🟡 Thresholds verified correct in source (§3.1 above); render-speed/CLS claims not independently measurable without the missing test harness; disclaimer is present (verbatim text in the API Reference doc) |
| P4 — Alternatives | ≥3 alternatives with explanation; AI-001 multi-factor ranking confirmed | ✅ Confirmed true — `NutriScoreDB.getAllProducts()` exists and `AlternativesEngine.getAlternatives()` returns real, ranked results, sourced from a live scan-time price cache rather than the (still all-zero) static dataset price field |
| P5 — Dashboard + Data | Consent flow works; deletion works <1s; Carrefour adapter smoke test | 🟡 Carrefour adapter exists and matches the required adapter pattern; consent-flow and deletion-affordance claims were not independently verifiable against the compiled dashboard UI |
| P6 — Privacy + Submission | Web Store submission receipt; Lighthouse A11Y ≥90; Privacy Policy ODPC-reviewed | ❌ None of these artefacts were found in the reviewed build |

**Recommendation:** use this table, not the roadmap's own checkboxes, as the basis for the Gate 0 client-approval conversation referenced in the spec's document status ("Draft — pending Gate 0 client approval").

---

## 5. Incident Management & Troubleshooting Matrix

Most rows from v1.0 of this document remain valid and are not repeated here (Naivas order-confirmation false positive, etc. — see the Code Review companion document for full detail). Three items have since changed and should **not** be treated as open: the Alternatives Engine is now functional end-to-end (see P4 above); the "Firestore batch limit" issue is moot — Firebase/Firestore has been fully removed from the codebase, not merely left unreachable (ADR-004 in the Architecture doc); and the KFCT reference-dataset "filename case mismatch" does not exist in the current build — `db.js` and the shipped file both use the same lowercase path (see §7 below). Two additions:

| Symptom | Likely Root Cause | Remediation Steps | Severity |
|---|---|---|---|
| A cheese product's fibre-heavy sibling scores better than expected relative to the official SPF reference grade | `score-engine.js`'s fibre P-point formula (`floor(fiber/0.9)`, cap 5) reaches maximum points at ~4.5g fibre, versus the spec's stated 7.4g Scenario-II ceiling — a systematic over-reward | Correct the fibre formula to match the official discrete threshold bands; add the 20-reference-product regression test (§3.1) so this class of drift is caught automatically going forward | Sev-2 |
| A diet or "zero sugar" beverage using a non-nutritive sweetener grades better than the official algorithm would assign | No sweetener-detection logic or +4 penalty exists anywhere in `score-engine.js`, despite being one of the 7 named 2023-revision improvements (EV-SCI-004) | Implement sweetener-keyword/ingredient detection and the beverage +4 penalty | Sev-2 |
| Dashboard/popup build fails or behaves unexpectedly after a dependency bump | NFR-004 (Preact mandated) vs. actual shipped React stack is an unreconciled conflict — see §2.6 | Resolve the toolchain question explicitly before adding new UI dependencies | Sev-3 (governance, not currently causing a live incident) |
| Carrefour injected badges disappear, are clipped, or misaligned off-screen | Carrefour's true outer product container wrapper (`[style*="grid-column"]`) had `overflow: hidden`, clipping absolutely positioned child badges anchored inside | Target the outermost `grid-column` container with `MutationObserver` and force `overflow: visible` and `position: relative` directly on it during injection | Sev-3 (Fixed in v1.2) |
| Nutrient Trend charts in Dashboard show a completely flat line (0%) despite having data | Trend bucketing logic used a strict AND-gate for all 3 nutrients; any partial record (e.g., sodium but no sugar) resulted in throwing out the bucket average | Use an OR-gate (`hasAny`) for bucket accumulation; isolate nutrient divisors (`nSodium`, `nSugar`) so partial data doesn't sink the entire day's average | Sev-2 (Fixed in v1.2) |

---

## 6. Monitoring, Alerting, & Log Triage
Unchanged from v1.0.

---

## 7. Data Governance Backlog (Requirements Spec §10.5)

This is new in this revision, reflecting the flexible database design now adopted as authoritative (see PRD §5 and Architecture doc §6). These are concrete, quantified engineering tasks, not abstract governance aspirations:

| Task | Why | Scale |
|---|---|---|
| Remap `EvidenceLevel` values onto the official 7-tier confidence hierarchy | Spec claims this mapping is already done in production; it is not | Naivas uses 9 ad hoc values, Carrefour uses 3, and they don't share a vocabulary — all ~9,274 records need remapping |
| Backfill the 4 missing provenance fields (`SourceDatabase`, `ValidationMethod`, `Reviewer`, `ValidationDate`) | §10.5.3 mandates 7 fields; only `EvidenceType` matches by name today | Schema-wide addition, ~9,274 records |
| Close Naivas's core-macronutrient completeness gap | §10.5.4 mandates 100% completeness on `EnergyKJ`/`SugarsG`/`FatG`/`CarbohydratesG` (or documented exemption) | 1,163–1,172 of 3,518 Naivas records (~33%) currently null |
| ~~Fix the KFCT reference-dataset import (filename case mismatch)~~ | **Already resolved — not an open task.** `db.js` imports from `data/kfct2018_reference_validated.json`, and the file ships at that exact lowercase path. The two match; the import runs successfully and the reference layer is functional | — |
| Re-evaluate the `category_reference` / `category_default` quality gate | §10.5.7 targets <5% category-default records; if `category_reference` is the shipped equivalent, actual figures are 16.2% (Naivas) and 83.7% (Carrefour) | Category-by-category re-matching effort, prioritise by KNPM ineligibility rate per EV-KE-004 (Savoury Snacks, Sweet Biscuits, Ice Cream first) |
| Add the missing `IsEligibleForScoring`/`ExclusionReason` dataset fields, or formally document the runtime-classifier approach as the intended design | DATA-005 specifies a pre-computed field; the actual mechanism is a runtime check in `FoodClassifier` | Architectural decision + schema addition if the pre-computed approach is preferred |

---

## 8. Appendix
- **On-Call Contact List:** Kibet (Project Lead) — no formal rotation
- **Architecture Reference:** [System Architecture](./02_System_Architecture_NUT-04.md)
- **Glossary:** See PRD Appendix
