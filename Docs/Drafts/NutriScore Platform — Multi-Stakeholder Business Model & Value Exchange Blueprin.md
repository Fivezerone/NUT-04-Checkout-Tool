# NutriScore Platform — Multi-Stakeholder Business Model & Value Exchange Blueprint

*Prepared 11 November 2026 · Audience: CTO, Lead Data Scientist, VP Business Development · Status: planning baseline v1.0 · Companion document: Clinical Data Pipeline, Analytics Engine & Compliance Architecture Strategy*

## 0. Reading guide, evidence labels and three flags

Every figure in this document carries one of three labels. **\[R\]** is a published rate or rule that must be re-verified before contracting. **\[M\]** is a published model or estimate: directional evidence, not a promise. **\[A\]** is a planning assumption that the 90-day pilot must replace with measured data. Nothing labelled \[A\] belongs in an external pitch as fact. Source numbers (S1–S11) point to the list at the end.

**Flag 1 — RPM cannot be billed from grocery data.** Medicare remote patient monitoring pays for physiologic data captured by a device such as a blood-pressure cuff, glucometer or scale. Purchase telemetry is behavioural data, so the platform cannot be the thing that RPM codes pay for. It helps a hospital earn CCM/APCM revenue (and RPM revenue where a connected device is already in use) by lifting enrolment, engagement and time-capture quality. This is my reading of the code descriptors; have billing counsel confirm each claim before an ROI model reaches a customer.

**Flag 2 — the US rules changed last week.** CMS issued the CY2027 Physician Fee Schedule final rule on 4 November 2026. From 1 January 2027 both RPM and RTM require an established patient and a face-to-face initiating visit with the billing practitioner. The direct-employee requirement for clinical staff was finalised but delayed to 1 January 2029. Practice-expense revaluation of the device-supply codes cuts relative value units by 20% or more and must be phased in over at least two years. \[R\] (S3)

**Flag 3 — Kenya has no CCM/RPM billing codes.** Kenya-first revenue comes from subscriptions, per-member programmes and sponsorship, not code-by-code reimbursement. Sections 3 and 5 therefore keep a **Reference calibration** (US-style, as the brief specifies) and a **Kenya calibration** side by side.

## 1. Executive summary

**Thesis.** The platform turns a clinician’s dietary prescription into a machine-readable constraint set that travels with the patient into the online grocery aisle. Value is created once, when a patient buys a safer basket, and captured four times: by the hospital (care-management productivity and outcomes), by the insurer (avoided acute cost), by the retailer (healthy-basket conversion and loyalty) and by CPG manufacturers (sponsored placement among clinically eligible alternatives). The patient pays nothing.

**Money map**

| Payer | Buys | Price basis | Reference calibration | Kenya calibration |
| --- | --- | --- | --- | --- |
| Hospital / clinic | Clinician dashboard, profile engine, compliance and time logs | Platform fee + per-active-patient fee | $9.00 per enrolled patient per month (PEPM) \[A\] | $1.50 PEPM \[A\] |
| Insurer / payer | Risk-cohort analytics, outcomes-linked programme | PMPM base + shared savings | ≈$3.40 PMPM per insured member \[A\] | $1.20 PMPM per insured member \[A\] |
| Retail grocer | Healthy-basket conversion, white-label tool | 15% of incremental gross profit | ≈$0.77 per patient-month \[A\] | ≈$0.20 per patient-month \[A\] |
| CPG brand | Sponsored slot among eligible alternatives | Cost per accepted substitution | ≈$0.60 per patient-month \[A\] | ≈$0.10 per patient-month \[A\] |
| Patient | Free, consent-gated | — | — | — |

**Five decisions this blueprint asks leadership to take**

1. **Go Kenya-first with the Kenya calibration as the base case.** Treat the US-style model as a reference design for later markets.
2. **Make the clinical firewall a contract term and a code invariant.** Clinical eligibility is decided before any commercial ranking, and money never changes a grade (Section 2.5).
3. **Sell documentation and coordination, not RPM billing.** Add connected BP/glucose device feeds before any RPM revenue claim.
4. **Run insurer work as an outcomes-linked pilot with an independent evaluator**, and write a non-adverse-use covenant into every payer contract.
5. **Sign the master pilot agreement and every schedule before any data flows** (Section 6).

## 2. Ecosystem value architecture

### 2.1 Value-flow map

```
PATIENT (pays $0)
  ├─ consent + purchase behaviour ─────────────────────► PLATFORM
  ◄─ safer basket, swaps (token applied on-device) ──────┤
HOSPITAL / CLINIC
  ├─ prescription + clinical review ───────────────────► PLATFORM
  ├─ SaaS fee (platform + per active patient) ─────────► PLATFORM
  ◄─ adherence, variance, safety events, time logs ──────┤
INSURER / PAYER
  ├─ PMPM base + shared savings ───────────────────────► PLATFORM
  ◄─ de-identified risk cohorts, forecasts (T4) ─────────┤
RETAIL GROCER (+ CPG)
  ├─ catalogue, price, stock feeds ────────────────────► PLATFORM
  ├─ revenue share, sponsorship fees ──────────────────► PLATFORM
  ◄─ aggregate demand, elasticity (T5), eligible-SKU events

PLATFORM = Clinical zone | Token Exchange | Retail edge | Analytics enclaves
           (architecture detail in the companion document)
```

### 2.2 Exchange ledger

Privacy tiers are defined in the companion document (Section 5.3): **T0** identified clinical data, **T1** pseudonymous operational data, **T3** HIPAA Safe Harbor de-identified, **T4** Expert-Determination de-identified, **T5** aggregate with k-anonymity.

| # | From → To | Financial | Clinical | Data (tier) |
| --- | --- | --- | --- | --- |
| 1 | Patient → Hospital | Covered by hospital or payer | Symptoms, labs at visits, consent | Identified clinical record (T0) |
| 2 | Hospital → Platform | SaaS fee | Prescription, thresholds, overrides | Clinical nutrition profile (T0, never leaves clinical zone) |
| 3 | Platform → Patient | Free | Grades, warnings, alternatives | Dietary token: semantic limits only, no diagnosis |
| 4 | Patient → Retailer | Basket spend | — | Retailer’s own first-party order data |
| 5 | Platform → Retailer | — | Eligible-SKU and substitution events | Aggregates only (T5) |
| 6 | Retailer → Platform | Revenue share, sponsorship fees | — | Catalogue, price, stock, SKU nutrition (non-personal) |
| 7 | CPG → Platform / Retailer | Sponsorship, slotting | — | Product master data and nutrition claims for verification |
| 8 | Platform → Hospital | — | Adherence, variance, safety events, time logs | T0, identity re-bound inside clinical zone |
| 9 | Platform → Insurer | PMPM fee flows to platform | Cohort risk, forecasts | T4; member-level only under payer-sharing consent |
| 10 | Insurer → Hospital | Reimbursement or contracted rate, outcomes bonus | Authorisations | Claims data per existing contract |
| 11 | Insurer → Platform | PMPM base, shared savings | Outcome definitions | Claims for independent evaluation (T4) |

### 2.3 Who may see what

Legend: ● full access · ◐ conditional (consent, contract, aggregation) · ○ none.

| Data element | Patient | Hospital | Insurer | Retailer | CPG | Platform ops |
| --- | --- | --- | --- | --- | --- | --- |
| Identity and contact | ● | ● | ◐ own members only | ◐ own customers only, never linked to clinical | ○ | ○ vault custodian under dual control |
| Diagnoses, labs, vitals | ● | ● | ◐ claims they already hold | ○ | ○ | ○ enclave only |
| Dietary token constraints | ● | ● | ○ | ○ consumed on-device | ○ | ◐ token service |
| Item-level basket | ● | ◐ own patients, retail-telemetry consent | ○ | ● their own orders | ○ | ◐ pseudonymous (T1) |
| Adherence and variance scores | ● | ● | ◐ cohort-level (T4) | ○ | ○ | ◐ |
| Cohort or segment membership | ◐ | ● | ◐ T4 | ◐ segment-level, k ≥ 20 | ○ | ● |
| Category demand and elasticity | ○ | ○ | ○ | ● | ◐ via retailer, k ≥ 20 | ● |

### 2.4 What each stakeholder is buying

| Stakeholder | Pain today | What the platform delivers | KPI they will pay for |
| --- | --- | --- | --- |
| Patient | Dietary advice that dies at the shop door | Real-time grades, blocks and affordable swaps at checkout | Basket healthiness, biometrics, time saved |
| Hospital | Care-management minutes are hard to document and bill; follow-up is invisible | Prescription-to-basket loop, adherence trend, time and contact logs | Enrolment rate, documented minutes, no-show and relapse reduction |
| Insurer | Chronic cost growth with no behavioural signal between visits | Risk-stratified cohorts and forecasts, outcomes-linked programme | Avoided admissions, claims per member-month |
| Retailer | Thin margins, low differentiation, no nutrition signal on shelf | Healthy-basket conversion, loyalty, white-label feature | Incremental gross profit per order, retention |
| CPG brand | Cannot reach clinically motivated shoppers credibly | Sponsored placement among clinically eligible alternatives | Cost per accepted substitution, share of eligible set |

### 2.5 Five invariants (contract terms and code assertions)

- **I1. Eligibility before ranking.** The clinical constraint set filters candidates first. Commercial signals may only reorder candidates whose clinical scores sit within a pre-agreed margin (default 3%), and sponsored items are always labelled.
- **I2. No diagnosis or biomarker leaves the clinical zone.** Only semantic limits (for example, sodium ≤ 1,500 mg/day) travel in the token.
- **I3. Money never changes a grade.** Grades come from the clinical scoring engine and the reviewed catalogue only.
- **I4. Non-adverse use.** Insurer and retailer data may not be used for underwriting, pricing individuals, claims denial or credit decisions.
- **I5. Independent revocation.** A patient can withdraw retail-telemetry or payer-sharing consent without losing clinical care.

## 3. Market applicability: reference model versus Kenya-first

| Dimension | Reference calibration (US-style, per brief) | Kenya calibration | Implication |
| --- | --- | --- | --- |
| Hospital revenue mechanism | CCM, APCM and RPM codes paid per patient per month \[R\] (S1, S2) | Social Health Authority runs a Primary Health Care Fund (capitation), a Social Health Insurance Fund and a chronic and emergency fund; outpatient and specialist services still lean on fee-for-service (S7) | Hospitals buy software on subscription. The ROI case rests on retention, outcomes contracts and avoided complications, not codes |
| Payer base | Medicare, Medicaid, Medicare Advantage, commercial | About 31–32 million registered with SHA, against roughly 8 million under the former NHIF (S7); private insurers and employer schemes cover a smaller, better-paying segment | Lead insurer pilots with private insurers and employer wellness. Align with SHA’s chronic-illness fund, which lists diabetes, as a longer-term route |
| Payer cash-flow risk | Predictable fee schedule | Operators reported about KSh 5.5 billion in unpaid SHA claims to level 2–3 facilities since February 2026 (S7) | Price hospital contracts so they do not depend on SHA remittance timing |
| Retail media | US retail media spend $60.3 billion in 2025, forecast $71.1 billion in 2026 \[M\] (S6) | Nascent \[A\] | CPG revenue is upside, not base case |
| Privacy regime | HIPAA, state laws, GDPR for EU data | Data Protection Act 2019 and General Regulations 2021, Digital Health Act 2023 with 2025 regulations, ODPC cross-border guidance of 8 September 2026 (S8, S9) | Clinical zone hosted in Kenya (companion document, Section 5.5) |
| Currency and rails | USD, card and ACH | KES, M-Pesa and Paystack | Price and bill in KES. Pass FX risk to no one |
| Differentiation | Crowded digital-health field | A national benchmarking study found no Kenyan online retailer showing front-of-pack nutrition signals; a June 2026 scan found no Chrome extension offering Nutri-Score on Kenyan grocery sites | First-mover position, but the reviewed-catalogue gap (about 42–46% of records displayable) must close first |

### 3.1 What the CY2027 US rule changes mean for the Reference calibration

| Change (final rule, 4 Nov 2026) | Effective | Effect on the platform |
| --- | --- | --- |
| Established-patient requirement extended to RTM; initiating face-to-face visit required for RPM and RTM | 1 Jan 2027 | Add an enrolment gate: confirm established-patient status and record the initiating-visit discussion before any monitoring starts |
| Direct-employee requirement for clinical staff | 1 Jan 2029 (delayed) | Third-party clinical staffing stays allowed until 31 Dec 2028. Outside vendors may still supply software, devices, hosting and interoperability, but not clinical staff time. Never sell clinician time as a service |
| Revaluation of device-supply and set-up codes (99445, 99453, 99454 and RTM equivalents) | Phased over at least two years | Model device-supply revenue as declining. Re-run the ROI model each rule cycle |
| Treatment-management codes (99470, 99457, 99458) keep their practice-expense inputs | 2027 | Time-capture value holds; the AMA’s RUC will review all 19 RPM and RTM codes in January 2027, so further change is possible |

Source for this table: S3 (Nixon Peabody alert of 9 November 2026). It is a law-firm summary; read the final rule text before relying on it.

## 4. Monetization streams and pricing mechanics

### 4.1 Hospitals: enterprise SaaS and care-management ROI

**Tier architecture.** Price points are hypotheses for the pilot to test. Kenya prices use a planning rate of KES 130 per USD \[A\].

| Tier | Scope | Reference price \[A\] | Kenya price \[A\] |
| --- | --- | --- | --- |
| Clinic | One clinic, up to 300 enrolled patients | $1,200 per month + $6.00 PEPM (blended $10.00) | $150 per month + $1.00 PEPM (blended $1.50) |
| Hospital | Up to 1,500 enrolled patients | $3,000 per month + $7.00 PEPM (blended $9.00 at 1,500) | $750 per month + $1.00 PEPM (blended $1.50 at 1,500) |
| Enterprise / group | 1,500 to 5,000+ patients, multi-site, SSO, custom audit export | $6,000 per month + $6.00 PEPM (blended $7.20 at 5,000) | $2,500 per month + $0.80 PEPM (blended $1.30 at 5,000) |

**Value metric.** Bill on enrolled patients for the first 90 days. After that, bill on active patients (at least one grade view or clinician review in the month) with a floor of 70% of enrolled, so the hospital pays for use and the platform is not exposed to silent churn.

**Published US reimbursement inputs \[R\]** (S1, S2; national averages, check the locality-specific schedule before modelling a real hospital):

| Programme | Code | Approx. monthly payment | Note |
| --- | --- | --- | --- |
| Chronic care management | 99490 first 20 min clinical staff | $66.13 | Physician-time variant 99491 (30 min) pays $89.18 |
|  | 99439 each additional 20 min | $50.44 | Add-on |
|  | 99487 complex, first 60 min | $144.29 | 99489 adds $78.16 per 30 min |
| Advanced primary care management | G0556 / G0557 / G0558 | $16.37 / $53.78 / about $117 | Primary-care specialties only; not billable in the same month as staff-based CCM |
| Remote patient monitoring | 99453 set-up | about $22 | One-time |
|  | 99454 device supply, 16+ days | $47–$52 | Sources differ by a few dollars |
|  | 99445 device supply, 2–15 days | about $47 | New in 2026; exclusive with 99454 |
|  | 99470 first 10 min management | about $26 | New in 2026; not billable with 99457 in the same month |
|  | 99457 first 20 min / 99458 add-on | about $52 / $41 | Both need a real-time interaction with the patient |

**ROI formula (CCM line).** Revenue per enrolled patient per month is R = b × (r1 + a × r2), where b is the share of enrolled months in which the time threshold is met and documented, r1 is the 99490 rate, a is the share of billable months that also earn the add-on, and r2 is the 99439 rate.

| Scenario | b | a | R per month | Per year | 500 enrolled, per year |
| --- | --- | --- | --- | --- | --- |
| Conservative | 0.75 | 0.0 | $49.60 | $595.17 | $297,585 |
| Base | 0.85 | 0.3 | $69.07 | $828.87 | $414,436 |
| Upside | 0.90 | 0.5 | $82.22 | $986.58 | $493,290 |

**Hospital net contribution, base case.** Planning assumptions \[A\]: one care coordinator per 250 enrolled patients at $65,000 fully loaded ($260 per patient per year) and a $9.00 PEPM platform fee ($108 per patient per year). Contribution before platform fee is $828.87 − $260 = $568.87 per patient; after the fee it is $460.87, or about $230,000 a year across 500 patients. The conservative case nets $113,585 and the upside case $309,290.

**Attribution test (the number a CFO will actually ask for).** Gross revenue is not the platform’s ROI; only the uplift it causes is. Suppose that without the platform a practice enrols 20% of a 2,000-patient eligible panel with b = 0.70 and a = 0.20 (about $640 per patient per year, $256,092 in total). With the platform it enrols 25% at the base-case values ($414,436). The incremental revenue is about $158,000 against a platform fee of $54,000, a net gain of about $104,000 and a return of 2.9×. The pilot must measure b, a and enrolment before and after, because these three numbers carry the whole claim.

**Billing-integrity guardrails (build them in, do not leave them to the customer).**

- Time logs are created by authenticated clinical staff. Minutes are never auto-credited from patient activity.
- Time codes require a real-time interaction with the patient or caregiver, so the dashboard must record the contact (call, video or visit) with timestamp and staff identity.
- Enforce one billing practitioner per patient per month and block incompatible code combinations (for example 99470 with 99457, or APCM with staff-based CCM).
- Add the 2027 enrolment gate: established-patient check and a documented initiating visit before monitoring starts.
- Keep a patient-consent record for each care-management programme.

**Kenya hospital value case.** Without per-code reimbursement, the ROI rests on three levers. (1) A self-pay or insured *nutrition-care programme* sold by the hospital at a monthly fee, with the platform as its backbone; keep the platform fee under 20% of programme revenue \[A\]. (2) Retention of chronic patients who would otherwise lapse between quarterly visits. (3) Outcome data that strengthens the hospital’s position in insurer contracts. Because SHA remittances can be late (S7), contract hospitals on subscription, in advance, and never contingent on SHA payments.

### 4.2 Insurers: PMPM tied to avoided acute cost

**Pricing logic.** Gross savings per member-month are S = (λ × C × ρ) ÷ 12, where λ is baseline acute events per member-year, C is average cost per event and ρ is the relative reduction attributable to the programme. Price the platform at a fixed share of S.

Worked example, Reference calibration \[A\]: λ = 0.12 admissions per member-year, C = $12,000, ρ = 8%. Then S = 0.12 × 12,000 × 0.08 ÷ 12 = **$9.60** per member-month. At a 35% capture the target price is **$3.36**, rounded to about $3.40.

| Component | Mechanic | Example |
| --- | --- | --- |
| Base fee | 40% of target price, paid monthly per enrolled insured member | $1.36 PMPM |
| Performance fee | 60% of target price, paid only on savings verified by an independent evaluator against a matched or delayed-start control | up to $2.04 PMPM |
| Risk corridor | If verified savings fall below 50% of target, the performance fee is zero and 20% of base fees are credited back | Caps the insurer’s downside |
| Evaluation | Independent actuary or academic partner; platform funds 50% of cost | Protects credibility |
| Non-adverse-use covenant | No underwriting, individual pricing, claims denial or credit decisions from platform data (invariant I4) | Breach ends the contract and triggers data destruction |

**Evidence anchors \[M\], to be used as ceilings and never as forecasts** (S4, S5). Tufts University modelling estimated that national insurance coverage of medically tailored meals for people with a diet-related condition and limited daily-living ability could avert about 1.6 million hospitalisations and net about $13.6 billion in the first year. A separate microsimulation of produce prescriptions for people with diabetes and food insecurity estimated about 292,000 cardiovascular events averted and a cost-effectiveness ratio near $18,100 per quality-adjusted life year. Both are US models of far more intensive interventions than aisle-level nudging, and a Health Affairs commentary stresses that results depend on programme design and cost. Present them as direction, not as the platform’s expected effect.

**Kenya route.** The first task in any insurer data room is to obtain 24 months of de-identified claims for the target chronic-disease cohort and estimate λ and C locally. The 2026 tariff amendment lifting the chronic and emergency fund ceiling from KSh 150,000 to KSh 400,000 shows the public system carrying catastrophic chronic cost (S7); the private-insurer opportunity sits in outpatient chronic-disease claims and avoidable complications. Start with one private insurer or one employer scheme.

### 4.3 Retail grocers and CPG manufacturers

**Stream A: revenue share on healthy substitution.** The retailer’s incremental gross profit per order is ΔGP = Σ (m\_new,i − m\_old,i) × q\_i + Δbasket × m̄ − incentive cost, where m is unit margin, q is quantity, Δbasket is any change in basket value and m̄ is the blended margin. The platform earns 15% of ΔGP, measured against a holdout group of shoppers who see no prompts. Worked example, Reference calibration \[A\]: 4 orders a month, $85 basket, ΔGP of 1.5% of basket = $1.275 per order, $5.10 per patient-month, platform share **$0.77**. Kenya calibration \[A\]: 3 orders, $30 basket, same 1.5% gives $1.35 per patient-month and a share of about **$0.20**. Grocery net margins are thin, so the retailer needs the pilot to show the platform is margin-neutral or better before it pays anything.

**Stream B: white-label licence.** The retailer offers the feature under its own brand, either through the extension channel or an embedded SDK. Price as the greater of a minimum annual guarantee and the revenue share in Stream A. The SDK route also removes the page-scraping dependency (see risk R4).

**Stream C: CPG sponsorship, three products.**

| Product | Mechanic | Price hypothesis \[A\] | Guardrail |
| --- | --- | --- | --- |
| Sponsored eligible alternative | Brand boosts an already clinically eligible SKU in the swap list | $0.25–$0.75 per accepted substitution (Kenya $0.05–$0.15) | Labelled sponsored; at most one sponsored item in three suggestions; clinical team can veto |
| Verified-claim review | Independent review of a brand’s nutrition data to move a record from unverified to verified | Flat fee, same price whatever the outcome | Fee never depends on the grade; review team sits behind a wall from sales |
| Category insight subscription | Aggregate category conversion and elasticity | Annual subscription | Cells with fewer than 20 shoppers suppressed |

**Two-stage ranking (this is invariant I1 in code).**

- Stage 1, eligibility: a candidate passes only if every hard constraint in the patient’s token is met and the record’s review state is VERIFIED or higher.
- Stage 2, ranking: score S(a) = w\_c × ClinicalGain + w\_p × PriceParity + w\_t × TasteAffinity. A sponsorship boost b(a) applies only where S(a) is within 3% of the best eligible score S\_max, and is always disclosed.

**Data boundary.** Retailers already hold their own order data as the controller of their customer relationship. The platform never joins its telemetry to retailer loyalty identifiers, and retailers and brands receive aggregates only. The Kenyan regulator’s September 2026 guidance prohibits recipients from using onward-transferred data for their own analytics, profiling, product improvement or marketing (S8); even though that rule addresses cross-border transfers, it shows where enforcement attention sits.

## 5. Unit economics and sustainability

### 5.1 Definitions

| Metric | Definition | Target \[A\] |
| --- | --- | --- |
| PEPM | Revenue per enrolled patient per month, summed over all payers | — |
| Gross margin | (PEPM revenue − cost to serve) ÷ PEPM revenue | Reference ≥ 60%; Kenya ≥ 50% |
| CAC | Sales, solution engineering, legal and pilot subsidy to win one contracted hospital | — |
| Payback | CAC ÷ monthly gross profit of the won account | ≤ 18 months |
| LTV | Annual gross profit × expected life, capped at 5 years, undiscounted | LTV:CAC ≥ 3 |
| Net revenue retention | (Opening ARR + expansion − contraction − churn) ÷ opening ARR | ≥ 115% |
| Logo churn | Contracted hospitals lost per year | ≤ 12% |

### 5.2 Calibrations per enrolled patient per month

| Line | Reference \[A\] | Kenya \[A\] |
| --- | --- | --- |
| Hospital SaaS | $9.00 | $1.50 |
| Insurer PMPM (60% of enrolled covered by a contracted payer in Reference; 50% in Kenya at $1.20) | $2.04 | $0.60 |
| Retailer revenue share | $0.77 | $0.20 |
| CPG sponsorship | $0.60 | $0.10 |
| **Total revenue** | **$12.41** | **$2.40** |
| Cloud and data, support, compliance, catalogue curation | $4.50 | $1.00 |
| **Gross profit** | **$7.91** | **$1.40** |
| **Gross margin** | **63.7%** | **58.3%** |
| Revenue mix: hospital / insurer / retailer / CPG | 72.5% / 16.4% / 6.2% / 4.8% | 62.5% / 25.0% / 8.3% / 4.2% |

### 5.3 Deal-level economics

|  | Reference hospital deal | Kenya clinic deal |
| --- | --- | --- |
| Enrolled patients | 1,500 | 300 |
| Attributed ARR | $223,380 | $8,640 |
| Annual gross profit | $142,380 | $5,040 |
| CAC \[A\] | $120,000 | $6,000 |
| Payback | 10.1 months | 14.3 months |
| LTV (5 years, undiscounted) | $711,900 | $25,200 |
| LTV:CAC | 5.9 | 4.2 |

### 5.4 Why the tool can stay free for the patient

The hospital line alone covers the cost to serve: $9.00 against $4.50 in the Reference calibration, and $1.50 against $1.00 in Kenya. Insurer, retailer and CPG revenue is margin expansion and diversification, not survival. This matters ethically as well as financially. Because the patient is not the revenue source, nothing in the model rewards harvesting patient data, and invariants I2 and I4 keep it that way. The risk to watch is concentration: hospital revenue is above 60% of the mix in both calibrations, so a slow insurer and retail ramp raises dependence on a few hospital contracts.

### 5.5 Kenya break-even and sensitivity

With fixed monthly operating cost of $25,000 for a small Nairobi team, hosting and compliance \[A\], break-even enrolment is 25,000 ÷ $1.40 = **17,857 patients**. That is the key Kenyan finding: clinic-by-clinic selling at $1.50 PEPM is slow, so the model depends on channel deals through hospital groups, insurers and employer schemes.

| Case | Revenue per patient-month | Cost per patient-month | Margin | Break-even enrolled patients |
| --- | --- | --- | --- | --- |
| Base | $2.40 | $1.00 | $1.40 | 17,857 |
| Price +20% | $2.88 | $1.00 | $1.88 | 13,298 |
| Cost +20% | $2.40 | $1.20 | $1.20 | 20,833 |
| Price −20% | $1.92 | $1.00 | $0.92 | 27,174 |
| Price −20% and cost +20% | $1.92 | $1.20 | $0.72 | 34,722 |

### 5.6 Net revenue retention levers

1. **Seat expansion:** more clinics and more enrolled patients inside a signed hospital group.
2. **Module upsell:** insurer analytics, programme-fee billing module, CPG insight feeds.
3. **Outcome-linked renewals:** performance fees that grow as independent evaluation confirms savings.
4. **Catalogue network effect:** every verified record raises grade coverage for every customer, which lifts engagement and revenue share without extra sales effort.

## 6. Go-to-market and the 90-day multi-stakeholder pilot

### 6.1 Commercial sequence

| Wave | Window \[A\] | Goal | Exit criterion |
| --- | --- | --- | --- |
| 1. Pilot | Day 0 targeted for early February 2027, readiness work from now | Prove engagement, safety, margin-neutral retail effect and leading biometric indicators with one hospital, one payer or employer scheme and one retailer | Gate 3 passed (Section 6.5) |
| 2. Convert and replicate | Months 4–9 | Convert the pilot hospital, add two or three hospitals through a group or insurer channel, sign the first outcomes-linked insurer contract, open CPG sponsorship after the clinical gate | At least 3 paying hospitals and 5,000 enrolled patients |
| 3. Scale | Months 10–18 | Second retailer, embedded SDK, second insurer, SHA alignment conversation using independent evaluation results | Kenya break-even of about 17,900 enrolled patients (Section 5.5) in sight |

**Beachhead partner profile.** A private or faith-based hospital with a diabetes and hypertension clinic, 300 to 1,500 chronic patients, patients who already order groceries online, and a named clinical lead willing to sign prescriptions into the dashboard.

### 6.2 Pilot design

| Party | Role | Commitment | Pilot fee \[A\] |
| --- | --- | --- | --- |
| Hospital (1 hospital, 2 clinics) | Prescribes, reviews, owns clinical records | Clinical lead, dietitian, about 4 clinician hours per week, enrolment of 150–200 patients | 50% of list price, fully credited against year one |
| Insurer or employer scheme | Supplies de-identified claims baseline, receives the evaluation | Data room, 50% of evaluator cost | None |
| Retail grocer | Hosts the extension or SDK, supplies catalogue, price and stock | Integration contact, holdout design, nutrition-field feed | None; revenue share is computed in a shadow ledger but not paid |
| CPG sponsors (0–2, from Day 45) | Sponsor eligible alternatives | Capped budget, accept labelling and veto rules | Capped sponsorship at pilot rates |
| Independent evaluator | Actuary or academic team | Protocol, analysis plan, final report | Funded 50/50 by platform and insurer |
| Clinical safety and ethics board | Reviews every safety event weekly | Three members: clinician, patient representative, data-protection expert | Platform-funded |

**Cohort size and power.** For a paired before-and-after comparison at 5% significance and 80% power, the completers needed are n = ((1.96 + 0.84) × SD ÷ Δ)². For systolic pressure with SD 12 mmHg and a 4 mmHg change, n ≈ 71. For HbA1c with SD 1.0 percentage point and a 0.3-point change, n ≈ 88. With 30% attrition, enrol at least 102 patients with hypertension and 126 with diabetes. Allowing overlap, plan on **150–200 enrolled** \[A\].

**Control arm.** Use a delayed-start design: Arm A starts at Day 0 and Arm B at Day 45, so Arm B serves as a concurrent control for the first 45 days. HbA1c reflects about three months of glucose exposure, so a 90-day window is the minimum to see it move. Treat leading indicators as confirmatory endpoints and biometrics as exploratory. Do not publish clinical-effect claims from the pilot.

**Timeline**

| Window | Activities |
| --- | --- |
| Day −30 to 0 | Sign master pilot agreement and schedules; complete the data-protection impact assessment; register as controller or processor with the data-protection regulator; freeze the pilot catalogue and bring grade coverage to at least 80%; capture baseline claims and clinical data; train staff |
| Day 0–14 | Arm A consent and onboarding; token issuance; safety dry-run on live pages |
| Day 15–44 | Operations; weekly safety review; Gate 1 at Day 30 |
| Day 45 | Arm B onboarding; first sponsored alternatives go live if Gate 1 passed |
| Day 60 | Interim analysis and Gate 2 |
| Day 75–90 | Final data lock, independent evaluation, clinician and patient interviews |
| Day 90 | Readout and Gate 3 conversion decision |

### 6.3 Contract stack (all signed before data flows)

| # | Document | Key terms |
| --- | --- | --- |
| 1 | Master pilot agreement | Governance, scope, term, liability cap, change-in-law, IP, publication rights, exit |
| 2 | Hospital order form with data processing agreement (and business associate terms for US customers) | Hospital is controller of clinical data; platform is processor; hosting in Kenya; breach notification clock; sub-processor list |
| 3 | Insurer pilot schedule | De-identified data only; evaluation protocol; non-adverse-use covenant (I4); no individual-level use without payer-sharing consent |
| 4 | Retailer pilot schedule | Integration scope; catalogue feed; holdout design; shadow revenue ledger; no join to loyalty identifiers; selector-change notice period |
| 5 | CPG sponsorship rider | Only after Gate 1; sponsor cannot influence grades (I3); labelling; veto; budget caps |
| 6 | Joint governance and data-sharing charter | Roles, escalation, the five invariants, independent evaluator rights, safety board mandate |
| 7 | Exit and data return schedule | Return or destruction within 30 days; key destruction certificate; audit-log export |

### 6.4 Shared KPIs

Targets are pilot hypotheses \[A\]. ‘Confirmatory’ means the conversion decision relies on it; ‘exploratory’ means it is reported but not used for the decision.

| # | KPI | Definition | Target | Type | Owner |
| --- | --- | --- | --- | --- | --- |
| 1 | Activation | Invited patients who consent and install | ≥ 40% | Confirmatory | Platform |
| 2 | Weekly active rate | Enrolled patients with at least one graded session per week | ≥ 50% | Confirmatory | Platform |
| 3 | Grade coverage | Viewed SKUs with a displayable grade | ≥ 80% (currently about 42–46% of records) | Confirmatory | Platform |
| 4 | Substitution acceptance | Accepted ÷ offered swaps | ≥ 20% | Confirmatory | Platform, retailer |
| 5 | Basket Healthiness Index change | Spend-weighted item score versus own baseline | ≥ +8 points | Confirmatory | Platform |
| 6 | Adherence | Median Nutritional Adherence Score by week 8; share of patients at 70 or above | Median ≥ 70; ≥ 50% of patients | Confirmatory | Platform, hospital |
| 7 | Clinician time | Review minutes per patient per month | ≤ 10 | Confirmatory | Hospital |
| 8 | Retail neutrality | Change in average order value and in gross margin per order versus holdout | AOV within ±5%; margin neutral or better | Confirmatory | Retailer |
| 9 | Safety | Unresolved safety events; false-block rate | 0; ≤ 1% | Confirmatory | Safety board |
| 10 | Privacy | Incidents; data-subject requests met in time | 0; 100% | Confirmatory | DPO |
| 11 | Systolic pressure | Mean change at Day 90 | ≤ −4 mmHg | Exploratory | Hospital |
| 12 | HbA1c | Mean change at Day 90 | ≤ −0.3 points | Exploratory | Hospital |
| 13 | Retention | Enrolled patients still active at Day 90 | ≥ 60% | Confirmatory | Platform |

### 6.5 Gates and conversion triggers

| Gate | When | Pass condition | If missed |
| --- | --- | --- | --- |
| 1. Data and safety | Day 30 | KPI 3 ≥ 80%, KPI 9 and 10 clean, consent and revocation flows pass audit | Pause onboarding, fix, re-run Gate 1 within 14 days; no CPG activation |
| 2. Engagement | Day 60 | KPI 1, 2 and 4 within 80% of target | Redesign nudges or onboarding; extend pilot by up to 30 days at no charge |
| 3. Conversion | Day 90 | All of KPI 3, 7, 8, 9, 10 met, and at least three of KPI 1, 2, 4, 5, 6, 13 met | Partners may exit with 14 days’ notice; data returned or destroyed within 30 days |

**Terms that take effect on a Gate 3 pass.** The hospital moves to list price from Day 91 on a 12-month term, with a price lock if it signs within 30 days of the readout and 100% of pilot fees credited. The insurer moves to the base-plus-performance structure in Section 4.2 once the independent evaluation confirms the leading indicators. The retailer’s shadow ledger becomes payable prospectively from Day 91, with a negotiated minimum guarantee. CPG sponsorship renews quarterly. No exclusivity is granted unless it is separately paid for.

## 7. Risk register

| # | Risk | Mitigation | Owner |
| --- | --- | --- | --- |
| R1 | Sponsorship bias distorts clinical advice | Invariants I1 and I3; two-stage ranking in code; catalogue team walled off from sales; quarterly audit of ranking logs; visible sponsor labels | CEO, clinical lead |
| R2 | Over-claiming RPM billing | Flag 1; billing counsel sign-off on every ROI claim; add connected devices before any RPM revenue story; integrity guardrails in Section 4.1; US scrutiny of RPM is rising (S3) | VP BD |
| R3 | Rules change (CMS, SHA tariffs, ODPC, Digital Health Act, HIPAA) | Named rule-watch owner; quarterly model refresh; change-in-law clauses. The HIPAA Security Rule overhaul is still proposed, with final action pushed to at least July 2027, but the current rule is already enforced (S10) | General counsel |
| R4 | Retailer dependency and page-scraping fragility | Retailer agreements; embedded SDK path; selector-versioned adapters with automated canaries; read-only observer mode; legal review of each retailer’s terms | CTO |
| R5 | Low catalogue coverage (about 42–46% displayable; 54% of records unverified) | Curation sprint to move records from unverified to estimated; 80% coverage gate before the pilot; funded verification line | Lead data scientist |
| R6 | Data localisation and cross-border rules | Kenyan hosting for the clinical zone; transfer impact assessments; consent plus safeguards for any sensitive-data transfer (S8). Pseudonymised data stays personal data under EU guidance (S11) | DPO |
| R7 | Hospital concentration and SHA payment delays | Advance subscriptions; programme-fee revenue; insurer and employer diversification | CFO |
| R8 | Modelled benefits do not appear in practice | Independent evaluation; delayed-start control; no effect claims beyond data | Evaluator |
| R9 | False blocks or a missed safety constraint | Fail open when confidence is low; block only at VERIFIED or higher; override with reason; weekly safety board | Clinical lead |
| R10 | Consent fatigue and patient distrust | Three separate consents, plain-language receipts, one-tap revocation | Product |
| R11 | Decision-support software classified as a regulated device in some markets | Counsel review per market (US FDA clinical decision support guidance, Kenya, EU) before launch | General counsel |

## 8. Twelve-month roadmap and decisions needed

| Quarter \[A\] | Commercial | Product and data | Compliance |
| --- | --- | --- | --- |
| Nov 2026–Jan 2027 | Pick pilot partners; term sheets; evaluator engaged | Catalogue to ≥ 80% coverage; ranking firewall and consent service ready | DPIA; regulator registration; hosting decision; contract stack |
| Feb–Apr 2027 | Run the 90-day pilot | Safety dashboard; interim analytics | Weekly safety board; audit-log verification drill |
| May–Jul 2027 | Convert hospital; first insurer contract | Insurer analytics tier; SDK prototype | Expert-determination study for insurer data |
| Aug–Oct 2027 | Hospital group deals; CPG sponsorship live | Prescriptive engine v2 | External security and privacy audit |

**Decisions needed from leadership**

1. Confirm Kenya-first as the base case and approve the Kenya calibration for the pilot price book. *Owner: CEO; before partner outreach.*
2. Approve the five invariants as binding on sales, product and engineering. *Owner: CEO and clinical lead; before the first term sheet.*
3. Fund the catalogue-curation sprint. *Owner: CFO; before Day −30.*
4. Choose the hosting option for the clinical zone in Kenya. *Owner: CTO; before the DPIA.*
5. Appoint the independent evaluator and the safety board. *Owner: clinical lead; before Day 0.*

## Sources and evidence notes

Vendor blogs and news articles are secondary sources; confirm rates against the CMS fee-schedule lookup, and legal points against primary texts, before contracting. Accessed 11 November 2026.

- **S1** Health Recovery Solutions, *2026 RPM and CCM reimbursement codes and payment updates*, healthrecoverysolutions.com/blog/2026-rpm-and-ccm-reimbursement-codes-and-payment-updates; ThoroughCare, *2026 remote patient monitoring CPT codes*, thoroughcare.net/blog/2026-remote-patient-monitoring-cpt-codes; Vivo Care, *CMS 2026 final rule: new RPM codes*, vivocaresolutions.com/?p=2907.
- **S2** NACHC, *Building Blocks of CC PACE, Part II billing specifics*, nachc.org (2026 payment table for 99490 and 99491); Mindbowser, *The 2026 CCM playbook*, mindbowser.com/ccm-codes-cpt-variants-guide; Vivo Care, *Advanced primary care management 2026*, vivocaresolutions.com/blog/advanced-primary-care-management-apcm-2026.
- **S3** Nixon Peabody, *CMS finalizes 2027 Medicare RPM/RTM changes; direct employee rule delayed to 2029*, 9 November 2026, nixonpeabody.com.
- **S4** Tufts Food is Medicine Institute, *True Cost of Food: Food is Medicine case study* (September 2023), tuftsfoodismedicine.org/true-cost-fim-case-study-report; News-Medical summary, news-medical.net/news/20230926.
- **S5** Palar K and Cox C, *Modeling the value of Food is Medicine: medically tailored meals*, Health Affairs 2025;44(4):443–448.
- **S6** EMARKETER, *FAQ on retail media networks: how marketers should allocate budgets in 2026* (forecast of December 2025).
- **S7** Kenya Social Health Authority coverage: Business Daily Africa, *How Kenya’s fee-for-service model prioritises costly treatment*; The Standard, *Health spending rises by Sh37b to plug donor gap*; The Standard, *SHA hasn’t paid healthcare centres Sh5.5b since February* (16 June 2026); The Standard, *Patients demand clarity in SHA benefits* (2026 tariff amendment).
- **S8** Covington & Burling, *Kenya issues new cross-border data transfer guidance*, insideprivacy.com, 16 September 2026, on the ODPC Guidance Notes for Cross-border Data Transfers of 8 September 2026.
- **S9** Clyde & Co, *Health data protection in Kenya*, 17 March 2026; Digital Health (Data Exchange Component) Regulations 2025 (Legal Notice 77) and Digital Health (Health Information Management Procedures) Regulations 2025, Parliament of Kenya library.
- **S10** Fierce Healthcare, *Feds push back HIPAA Security Rule overhaul to July 2027*; Clearwater, *HIPAA Security Rule enforcement in 2026*.
- **S11** European Data Protection Board, *Guidelines 01/2025 on pseudonymisation* (adopted for consultation in January 2025; check for the final text).
- **Internal** NutriScore Checkout Tool deck, September 2026: catalogue coverage of about 46% (Carrefour Kenya) and 42% (Naivas), 54% of records unverified, and the competitive scan of June 2026.

## Addendum: reconciliation with the earlier business-model sketch

The earlier five-stakeholder sketch (Nutriscore\_Business\_Model.md) is the starting point for this Blueprint. The structure survives; what changes is the evidential standard and the risk treatment. Technical differences are in Section 6.4 of the companion document.

| Sketch element | Treatment in this Blueprint | Why |
| --- | --- | --- |
| ‘Unlocks automated RPM/CCM revenue streams with zero added clinician friction’ | Reframed as documentation and coordination support | Billing needs authenticated clinician time and a real-time patient contact, and RPM needs device-captured physiologic data (Flag 1, Section 4.1). A claim of automated billing is the kind that draws payer audits |
| Government as a fifth stakeholder (grants, subsidies, a fast-track listing for digital therapeutics) | Not a payer in the base case. Treated as policy alignment and non-dilutive bridge funding | The German fast-track route the sketch cites has no Kenyan equivalent that I found. Grants stay outside the unit economics. A public-funded digital produce-prescription voucher is a possible later module |
| Licensing anonymised data to pharmaceutical companies | Deferred; not in any calibration | It collides with invariants I2 and I4, Kenyan limits on commercial and onward use (S8), and patient trust. Revisit only at scale, under explicit opt-in (consent C4), Expert Determination and ethics review |
| Device plus subscription sold to patients | Not pursued | The patient-free model (invariant I5) is the point. Connected BP cuffs or glucometers supplied by the hospital are the route to RPM-eligible data, and they are a hospital cost, not a patient subscription |
| Insurer-funded voucher: ‘Save Sh200 sponsored by your insurer’ | A valid incentive, but not yet in the unit economics. Add as an insurer-funded budget line | Redeem through a neutral promo code settled by the platform so the retailer never learns the insurer or the condition (I2). Cap per patient per month. Take legal advice on beneficiary-inducement and anti-kickback rules for US federal programmes and on Kenyan insurer rules. Cost check: two redemptions a month at KSh 200 is KSh 400, about $3.08 at the planning rate, more than twice the $1.20 Kenya insurer platform fee, so the insurer’s savings case must carry both |
| Pilot of 100 high-risk patients with obesity, hypertension and type 2 diabetes over 90 days | Kept as the minimum viable cohort; enlarge or relabel the endpoints | With 30% attrition, 100 enrolled leaves about 70 completers, which just meets the roughly 71 needed to detect a 4 mmHg systolic change and falls short of the roughly 88 needed for a 0.3-point HbA1c change. Either enrol 150–200 (Section 6.2) or declare biometrics exploratory and decide on leading indicators |
| Insurer matches pilot patients against emergency admissions | Not used as a conversion trigger | Admissions among 100 people in 90 days are too few to measure. Use leading indicators now and an independent, matched evaluation once volume allows (Section 4.2) |
| Integrate with the grocer’s inventory API or scrape matrices | Prefer a retailer agreement or embedded SDK; keep page adapters as a fallback | Scraping is fragile and exposes terms-of-service risk (risk R4) |
| Slotting fees, revenue share and white-label from grocers | Kept as in Section 4.3 | Added the eligibility-before-ranking firewall so that slotting fees cannot buy a clinical recommendation |
