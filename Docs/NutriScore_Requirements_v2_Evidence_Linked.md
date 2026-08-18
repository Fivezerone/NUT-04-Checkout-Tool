**JHUB AFRICA | AFYAVENTURES**

─────────────────────────────────

**NutriScore Checkout Tool**

**Full Requirements Specification v2.0**

NUT-04 | Science-Grounded & Evidence-Linked Edition | June 2026

|  |
| --- |
| **★ Scientific Mandate:** This specification is grounded in: (1) IARC/WHO EPIC epidemiological evidence (500K+ adults, 15+ year follow-up) directly linking the FSAm-NPS algorithm to cancer and mortality risk; (2) the 2023 FSA-NPS revision documented in the Santé publique France calculation workbook (4 April 2024); (3) Global Nutrition Report NACS action-classification taxonomy; (4) Kalpakoglou et al. (2025, Frontiers in Nutrition) AI-based nutrition recommender design principles. Every requirement in this document traces to at least one of these published evidence sources. |

| **Metadata Field** | **Value** |
| --- | --- |
| Project title | NutriScore Checkout Tool for Kenyan Online Grocery Platforms |
| Project code | NUT-04 |
| Cohort / programme | JHUB Africa AfyaVentures 2026 |
| Repository | github.com/Fivezerone/NUTRISCORE |
| Student lead | Kibet -- B.Sc. Electronic & Computer Engineering, JKUAT, Year 3 |
| Document version | v2.2 -- Data Governance Update, July 2026 |
| Document status | Draft -- pending Gate 0 client approval (v2.2 adds Section 10.5 Data Governance) |
| Algorithm baseline | FSA-NPS 2023 revision (Santé publique France, 4 April 2024 workbook) |
| Scientific evidence base | IARC Evidence Summary Brief No.2; EPIC cohort (471,495 adults, 15.3yr median follow-up); Kalpakoglou et al. 2025 (Frontiers in Nutrition); Global Nutrition Report NACS 2021; Eurofins/SPF Nutri-Score 2023 Facts; Kenya Nutrient Profile Model (KNPM) 1st Ed. 2025 (MoH); ATNi/TGI Kenya Market Assessment 2025; Kenya STEPS Survey 2015; National Guidelines for Healthy Diets and Physical Activity 2017; Nyeri Diabetes MVC Study 2024 |
| Standards compliance | ISO/IEC/IEEE 29148:2018; WCAG 2.2 Level AA; Kenya Data Protection Act 2019; Chrome Manifest V3; OWASP ASVS |
| Change log | v2.1 (July 2026): added Section 1.6 Kenya National Regulatory Grounding (EV-KE-001-010); added DATA-005/DATA-006; extended Appendix B evidence index. Companion reports: NUT-04 Database Audit and Compliance Report; ATNi/EAMA Kenya Market Assessment Product Benchmark Report; Nyeri County Diabetes Evidence Brief. |
| Change log (v2.2) | v2.2 (July 2026): implemented the Database Modification Recommendation -- added Section 10.5 (NUT-04 Data Governance and Database Lifecycle: layered architecture, official confidence hierarchy, mandatory provenance fields, completeness thresholds, plausibility validation rules, record lifecycle, quality gates); added EV-KE-011. Companion artefact: implement\_db\_modification\_recommendation.py, applied to the KFCT2018/Naivas/Carrefour datasets. |

# **PART I -- Scientific and Epidemiological Foundation**

This part establishes the scientific rationale for the NutriScore Checkout Tool. Every subsequent requirement traces to at least one evidence code defined here. No requirement appears in this document without a published evidence chain.

## **1. The Epidemiological Case -- Why Nutri-Score Is a Public Health Instrument**

### **1.1 IARC/EPIC Evidence: Nutritional Quality and Chronic Disease Mortality**

The International Agency for Research on Cancer (IARC), a WHO agency, published Evidence Summary Brief No.2 establishing the FSAm-NPS/Nutri-Score as the most scientifically validated front-of-pack nutrition labelling system globally. The evidence derives from the European Prospective Investigation into Cancer and Nutrition (EPIC) -- over 500,000 adults across 10 countries, recruited 1992-2000, followed for a median of 15.3-17.2 years.

|  |  |
| --- | --- |
| **EV-SCI-001**  *IARC Evidence Summary Brief No.2 (2021)* | Among 471,495 EPIC adults, 49,794 were diagnosed with cancer during follow-up. Individuals with the highest FSAm-NPS DI scores (lowest nutritional quality) had a 7% increased overall cancer risk, with specific elevated risk for colorectal, liver, upper aerodigestive tract, stomach, and lung cancers. For sex-specific cancers: higher scores linked to increased postmenopausal breast cancer and prostate cancer risk. |

|  |  |
| --- | --- |
| **EV-SCI-002**  *IARC Evidence Summary Brief No.2 (2021)* | Among 501,594 EPIC adults followed 17.2 years, higher FSAm-NPS DI score (lower nutritional quality) was associated with a 6% increase in overall mortality risk, with specific increases in cancer mortality and mortality from circulatory, respiratory, and digestive system diseases. |

|  |  |
| --- | --- |
| **EV-SCI-003**  *IARC Evidence Summary Brief No.2 (2021)* | The FSAm-NPS rates nutritional quality independently of food category or country-specific dietary patterns. This cross-cultural validity -- confirmed across 10 European dietary cultures -- establishes the algorithm's applicability to the Kenyan market context. The challenge for NUT-04 is data availability, not algorithm validity. |

|  |
| --- |
| **▲ Requirements Engineering Implication:** EV-SCI-001 through EV-SCI-003 elevate the score engine (FR-003) from a functional requirement to a safety-adjacent requirement. An inaccurate Nutri-Score grade delivered to a diabetic or hypertensive Kenyan shopper at checkout constitutes a false health signal with mortality-relevant consequences established in a 500,000-person cohort study. This is the scientific basis for requiring 20/20 reference-product accuracy -- not merely good software engineering practice. |

### **1.2 The FSA-NPS Algorithm: 2023 Revision -- What Changed and Why It Matters**

The 2023 revision of the FSA-NPS algorithm, documented in the Santé publique France calculation workbook (4 April 2024), is the mandatory implementation standard for NUT-04. The original 2017 algorithm is deprecated for products placed on market after January 2024 in all 7 adopting countries.

|  |  |
| --- | --- |
| **EV-SCI-004**  *FSA-NPS Algorithm Technical Reference (Eclarion/SPF, 2023-2024)* | The 2023 revision was motivated by 7 specific scientific improvements: (1) improved categorisation of fatty fish, (2) better distinction between wholemeal and white bread, (3) improved differentiation of vegetable oils by fatty acid profile, (4) stricter penalisation of high-sugar products (Sugar Ib scale replaces original), (5) stricter penalisation of high-salt products (0-20 pts), (6) sharper distinction between red meat and poultry (protein cap), (7) harmonised sweetener treatment for beverages (+4 penalty for non-nutritive sweeteners). |

|  |  |
| --- | --- |
| **EV-SCI-005**  *FSA-NPS Algorithm Technical Reference (Eclarion/SPF, 2023-2024)* | Score = N − P (with category-specific combining rules). N = energy (0-10 pts, 335→3350 kJ) + total sugars (Sugar Ib: 0-15 pts, 3.4→51g) + saturated fat (0-10 pts, 1pt/g to 10g; or SFA/total-fat ratio for added fats) + salt (0-20 pts, 0.2g steps to 4.0g). P = FVL (0-5 pts, 40/60/80/>80% bands) + fibre (0-5 pts, Scenario II, 3.0→7.4g) + protein (0-7 pts, Scenario II, 2.4→17g). Combining rule for general foods: if N < 11 → N − P; if N ≥ 11 → N − FVL − Fibre (protein excluded to prevent processed meats offsetting negatives). |

|  |  |
| --- | --- |
| **EV-SCI-006**  *FSA-NPS Algorithm Technical Reference (Eclarion/SPF, 2023-2024)* | Five distinct product categories require different scoring formulas and cut-offs: (1) General foods: N<11 → N−P, N≥11 → N−FVL−Fibre; cut-offs A=<1/B=<3/C=<11/D=<19/E=≥19. (2) Red meat: same combining rule, protein capped at 2 pts. (3) Cheese: always N−P (protein always counted). (4) Added fats/oils/nuts/seeds: uses SFA-to-total-fat ratio; N<7 threshold; cut-offs A=<-5. (5) Beverages: always N−P; stricter energy thresholds; sweetener +4 penalty; A=water only (flag); non-water beverages max grade B. |

|  |
| --- |
| **⚠ Algorithm Architecture Requirement (FR-003, FR-006):** Category detection MUST precede score computation. The five-category architecture is not optional -- it is mandated by EV-SCI-006. A single-path score engine that treats all products as "general foods" will produce incorrect grades for red meat (protein overcounted), cheese (wrong combining rule), added fats (wrong energy and SFA calculation), and beverages (wrong thresholds, wrong cut-offs). This is a scientific correctness issue, not a feature gap. |

### **1.3 Nutri-Score Scope: Products Excluded from Scoring (SPF Rules)**

|  |  |
| --- | --- |
| **EV-SCI-007**  *Eurofins/SPF Nutri-Score 2023 Facts Sheet (2024)* | The Nutri-Score algorithm is NOT applicable to: baby food for infants and toddlers (0-3 years), sports nutrition products, food for special medical purposes, food and dietary supplements, meal replacement products (for weight control or otherwise). These are permanent SPF exclusions -- not limitations of the current database. The food classification gate (FR-007) must suppress badge rendering for all these categories. |

|  |  |
| --- | --- |
| **EV-SCI-008**  *Eurofins/SPF Nutri-Score 2023 Facts Sheet (2024)* | Fibre content is required for FSA-NPS calculation but is not mandatory in Kenyan nutrition labelling. Open Food Facts data for fibre is inconsistent. The fallback database must include fibre values (or documented estimates from food composition tables) for every entry. Without fibre data, the algorithm underestimates positive points for high-fibre products (e.g., whole grains, legumes) -- systematically worsening their grades. |

### **1.4 Global Nutrition Report: NACS Classification of NUT-04**

|  |  |
| --- | --- |
| **EV-SCI-009**  *Global Nutrition Report -- NACS (2021)* | The Nutrition Action Classification System classifies nutrition actions into three categories: Enabling (governance, financing, research/monitoring), Policy (food supply chain, food environment, consumer knowledge, nutrition care services), and Impact (diet, food/nutrition security, undernutrition, obesity/NCDs). The NutriScore Checkout Tool is a Policy action in two sub-categories: (1) Food Environment -- "implementing nutrition labelling standards (e.g. front-of-pack labels)"; (2) Consumer Knowledge -- "increasing awareness on nutrition" and "tools/scores to assess diet quality." |

|  |  |
| --- | --- |
| **EV-SCI-010**  *Global Nutrition Report -- NACS (2021); IARC Evidence Summary Brief No.2 (2021)* | IARC explicitly frames the Nutri-Score as a tool that "aims to influence consumers at the point of purchase to choose food products with a better nutritional profile, and to incentivise food manufacturers to improve nutritional quality of products." This dual consumer-behaviour and systemic-incentive framing positions NUT-04 as both a consumer knowledge tool and a food environment intervention -- the two NACS sub-categories identified in EV-SCI-009. |

|  |
| --- |
| **★ Stakeholder Communication Implication:** When presenting NUT-04 to JHUB Africa leadership, potential retailer partners (Carrefour Kenya, Naivas), or Kenya Ministry of Health, the project should be positioned as a Policy action (NACS taxonomy) in the Food Environment and Consumer Knowledge sub-categories, backed by WHO/IARC epidemiological evidence, targeting the Impact sub-category of obesity and diet-related NCDs. This framing elevates NUT-04 from a Chrome extension to a measurable digital nutrition policy intervention -- with a published scientific evidence base. |

### **1.5 AI-Based Nutrition Recommender: Peer-Reviewed Design Evidence**

|  |  |
| --- | --- |
| **EV-SCI-011**  *Kalpakoglou et al. (2025) -- Frontiers in Nutrition, doi:10.3389/fnut.2025.1546107* | The AINR system evaluated across 4,000 generated user profiles and 28,000 daily nutritional plans achieves 98% average caloric accuracy and over 90% average macronutrient accuracy. The system uses a four-step process combining user profile filtering, expert-validated rules, daily NP scoring by DER, and weekly assembly ensuring food group balance and diversity. Published August 2025, peer-reviewed by Frontiers in Nutrition. |

|  |  |
| --- | --- |
| **EV-SCI-012**  *Kalpakoglou et al. (2025) -- Frontiers in Nutrition* | The paper establishes that AI nutrition recommenders must consider multiple factors simultaneously -- not single-factor sorting. For NUT-04, the analogous requirement is multi-factor alternative ranking: (1) Nutri-Score grade, (2) same FSA-NPS food category, (3) price proximity. The paper also establishes that database coverage is the primary quality bottleneck: "Augmenting the database with additional meals and dishes could help overcome the challenges." This directly grounds DATA-001 as critical-path. |

|  |  |
| --- | --- |
| **EV-SCI-013**  *Kalpakoglou et al. (2025) + IARC Evidence Summary Brief No.2 (2021)* | Both sources mandate human oversight: AINR paper -- "human oversight is strongly advised in any usage of the system with real users"; IARC -- Nutri-Score "guides consumers towards healthier food choices" (not replaces clinical judgment). This dual-source mandate grounds AI-003 (no medical advice framing) and requires a nutritionist validation review of disease warning thresholds before Phase 3 deployment. |

### **1.6 Kenya National Regulatory Grounding: KNPM 2025 and County-Level Burden**

Sections 1.1-1.5 establish the FSA-NPS 2023 algorithm (Sante publique France / UK-origin) as the scoring engine. This section grounds NUT-04 in Kenya's own national and county-level evidence base, discovered during the July 2026 database audit and documentary review. Kenya has its own Ministry of Health-approved nutrient profiling standard (KNPM) and a body of national and county NCD surveillance data that must inform product-exclusion scope, category architecture, and feature prioritisation -- independently of, and in addition to, the European FSA-NPS evidence chain above.

|  |  |
| --- | --- |
| **EV-KE-001**  *Kenya Nutrient Profile Model (KNPM), 1st Edition (Ministry of Health, July 2025)* | The MoH-approved national standard for Front-of-Pack nutrition warning labelling in Kenya, developed with JKUAT technical input. Defines nutrient thresholds (sugars, sodium, saturated fat, total fat) across 25 food categories (expanded from a 21-category 2021 draft). NUT-04's category-detection layer (FR-007) must carry a KNPM category code alongside the existing FSA-NPS 5-category code, and treat KNPM as the authoritative eligibility/exclusion standard for the Kenyan market while FSA-NPS supplies the graded A-E score. |

|  |  |
| --- | --- |
| **EV-KE-002**  *KNPM validation study, Nutrients journal (MDPI), February 2026* | Applies the final 25-category KNPM to real Kenyan packaged-product market data, confirming the model is implementable against retailer-scraped product data of the same shape NUT-04 collects from Naivas and Carrefour Kenya. |

|  |  |
| --- | --- |
| **EV-KE-003**  *ATNi/The George Institute Kenya Market Assessment 2025, Product Profile (983 products, 30 manufacturers, ~57% of Kenyan F&B market)* | Applied KNPM alongside HSR, WHO-AFRO and mHSR+ models to real Kenyan products, and defined an explicit negligible-nutrition exclusion scope: unprocessed meat/raw commodities, plain tea and coffee, herbs/salt/pepper/vinegars/spices without an on-pack nutrient declaration, and infant formula/medical nutrition products. This independently corroborates the exclusion filter NUT-04 derived from its own July 2026 database audit (see companion report: ATNi/EAMA Kenya Market Assessment -- Product Benchmark Report for NUT-04). |

|  |  |
| --- | --- |
| **EV-KE-004**  *ATNi/The George Institute Kenya Market Assessment 2025, category-level findings* | Category-level KNPM ineligibility (share of products failing to meet thresholds) ranged from roughly 40% up to 100% in categories such as Savoury Snacks, Sweet Biscuits/Bars, Ice Cream, Baked Goods and Concentrates. Grounds the MUST-priority of accurate sugar/salt/saturated-fat data specifically for the categories most heavily represented in Kenyan retailer catalogues, and should drive Phase-1 fallback-database build-out order. |

|  |  |
| --- | --- |
| **EV-KE-005**  *Kenya STEPS Survey 2015 (KNBS/Ministry of Health, with WHO STEPwise tool)* | Kenya's nationally representative NCD risk-factor baseline: obesity 27.9% (49.5% among women), diabetes prevalence 3.1%, raised blood pressure 23.8%, high dietary salt intake 18.3%, high sugar intake 13.7%, only 6.0% of adults meeting minimum fruit-and-vegetable intake. Grounds NUT-04's health-condition modules (FR-012) in Kenyan-population data, independent of the European EPIC cohort cited in EV-SCI-001/002. |

|  |  |
| --- | --- |
| **EV-KE-006**  *National Guidelines for Healthy Diets and Physical Activity (Ministry of Health, 2017)* | Documents Kenya's WHO-aligned 25x25 NCD targets (by 2025): -30% salt/sodium intake, -10% physical inactivity, -25% raised blood pressure, 0% rise in diabetes/obesity prevalence. Consumer behaviour baseline: ~20% of Kenyans add salt before eating, 83.5% add sugar when cooking, 28% always add sugar to beverages. Grounds sodium and added sugar as the two nutrients NUT-04 must surface most prominently at checkout, matching Kenya's own stated reduction targets. |

|  |  |
| --- | --- |
| **EV-KE-007**  *Kenya National Strategic Plan for the Prevention and Control of NCDs 2021/22-2025/26* | Cardiovascular disease, cancer, diabetes and chronic respiratory disease account for 57% of NCD deaths nationally. Positions NUT-04 within Kenya's multisectoral NCD monitoring and prevention framework, consistent with the NACS Policy-action framing already established in EV-SCI-009. |

|  |  |
| --- | --- |
| **EV-KE-008**  *Nyeri County Diabetes Microvascular Complications Study (JKUAT / Open Journal of Epidemiology, 2024)* | Nyeri County diabetes prevalence (6.4%) is almost triple the STEPS national rate; NCDs account for over 50% of hospital admissions and over 55% of deaths at Nyeri County Referral Hospital. Among 314 diabetes patients, 36.6% had a microvascular complication; physical-exercise frequency, smoking and alcohol intake were significant risk factors (BMI was not significant in this cohort). Establishes county-level severity variance and grounds a future county-weighting feature, scoped as Could/Won't-this-phase (see companion report: Nyeri County Diabetes -- Local Evidence Brief). |

|  |  |
| --- | --- |
| **EV-KE-009**  *Food-EPI Kenya Benchmarking Study (2020, PMC)* | A 43-indicator expert-panel assessment found most Kenyan food-environment policy indicators still "in development," flagging food labelling and marketing restriction as priority gaps. Independently corroborates the market gap NUT-04 addresses (EV-004) from a policy-benchmarking rather than competitive-analysis angle. |

|  |  |
| --- | --- |
| **EV-KE-010**  *NUT-04 internal database audit, July 2026 (unified\_database.json, nutritional\_profiles.json, enrichment\_log.json; 7,821 products)* | Identified 169 products with no nutrition profile, 75 with physiologically implausible per-100g values, and 50 confirmed food-composition-table donor-row mismatches (e.g. tomato paste enriched from a potato-chips template; fresh milk from a hyacinth-bean template) via the enrichment pipeline's own audit log. Grounds DATA-005 and DATA-006 and the Phase-1 "essential data only" checkout database (see companion report: NUT-04 Database Audit and Compliance Report). |

|  |
| --- |
| **▲ Requirements Engineering Implication: EV-KE-001 through EV-KE-004 require the food-classification module (FR-007) to carry a KNPM category code (25 values) alongside the existing FSA-NPS category code (5 values), and require the product-exclusion filter (DATA-005) to apply KNPM/ATNi negligible-nutrition scope BEFORE FSA-NPS scoring runs, not after. This is a regulatory-correctness requirement, not a data-cleanliness step: KNPM is the standard against which NUT-04's outputs will be judged by MoH stakeholders, retailer partners and JKUAT reviewers. EV-KE-005 through EV-KE-008 additionally establish that Kenyan NCD burden varies materially by county (Nyeri diabetes prevalence ~3x the national STEPS rate), which is documented here as evidence for a future scope item and explicitly NOT implemented as a v1 requirement.** |

# **PART II -- Requirements Engineering Framework (ISO/IEC/IEEE 29148:2018)**

This specification applies the IEEE 29148:2018 framework: iterative requirements processes through the product lifecycle, with stakeholder needs mapped to system requirements, then to architecture, then to verification and validation criteria.

## **2. Requirements Engineering Process**

| **IEEE 29148 Process Step** | **Application in NUT-04** | **Key Artefact** | **Status** |
| --- | --- | --- | --- |
| Elicitation | Direct retailer site inspection (Naivas, Carrefour), OFacts API testing, scientific literature review, user persona research, competitive analysis | Evidence Log (Section 6), User Personas (Section 5) | Ongoing -- Phase 1-2 |
| Analysis | Root-cause analysis; MoSCoW prioritisation; scope boundary definition; MoSCoW grounded in science evidence (not technical preference alone) | Root-Cause Analysis (Section 6.3), MoSCoW Matrix (Section 8.2) | Complete -- v2.0 |
| Specification | Formal FR/NFR/DATA/AI/SEC requirements with: unique ID, priority, evidence chain (linking to Part I codes), acceptance criteria (Given/When/Then or measurable), phase assignment | Sections 9-9.6 of this document | Complete -- v2.0 |
| Validation | Requirements reviewed against: FSA-NPS 2023 algorithm (EV-SCI-004-006), IARC evidence (EV-SCI-001-003), Kenya DPA 2019, WCAG 2.2, Kalpakoglou et al. 2025 | Evidence chain column in all requirements tables | Complete -- v2.0 |
| Verification planning | Per-requirement acceptance criteria linked to test types (unit, integration, E2E, UAT, accessibility audit); test phase assignments | Section 13 -- Validation and Testing Framework | Planned |
| Management | Version-controlled via GitHub; change requests logged as GitHub Issues; requirements updates trigger version bump and re-approval | GitHub Issues; Document Control (Section 1) | Ongoing |

## **3. Requirement Quality Assessment (IEEE 29148:2018)**

| **Quality Attribute** | **IEEE 29148 Definition** | **Application in NUT-04** |
| --- | --- | --- |
| Necessary | Defines essential capability, constraint, or quality factor | Each requirement traces to ≥1 evidence source (EV-SCI-XXX or EV-XXX). Requirements without evidence chains excluded from this document. |
| Unambiguous | Has only one possible interpretation | Thresholds stated numerically (sugar >22.5g/100g, not "high sugar"). Algorithm steps reference SPF formula tables explicitly by component name and scale. |
| Verifiable | Can be tested or measured objectively | Every requirement has a concrete Given/When/Then criterion or numeric measurement. "Displays a warning" is never the acceptance criterion -- the specific content and conditions are stated. |
| Consistent | Does not conflict with other requirements | IDs cross-referenced in traceability matrix (Section 14). No conflicting thresholds -- disease warning values sourced from single FSA-NPS derivation reviewed by nutritionist. |
| Complete | Fully describes the capability | Requirements specify both positive behaviour (condition met) and negative behaviour (condition not met) where applicable. Edge cases (no data, wrong category) have explicit handling. |
| Feasible | Can be implemented within project constraints | Every requirement assigned a phase (P1-P6). "Won't" requirements have no phase assignment. Scope matches the 12-week timeline. |
| Traceable | Can be traced to origin and system elements | Evidence chain column in all tables; full traceability matrix in Section 14; evidence source index in Appendix C. |
| Prioritised | Ranked by importance and risk | MoSCoW priority column. Critical-path requirements (FR-001-FR-003, DATA-001) marked Must and assigned Phase 1-2. |

## **4. Evidence Chain Architecture**

This table maps each evidence source to the requirements it grounds. All requirements in this document trace upward through this architecture.

| **Evidence Source** | **Core Contribution** | **Requirements Grounded** | **Key Architectural Implication** |
| --- | --- | --- | --- |
| IARC Evidence Summary Brief No.2 (2021) | EPIC cohort: FSAm-NPS DI score linked to +7% cancer risk, +6% overall mortality across 500K+ adults | FR-003 (score accuracy = health-outcome req.); FR-005 (disease warnings); FR-009/010 (thresholds); stakeholder business case | Score engine accuracy is safety-adjacent. 20/20 reference test is a minimum science bar, not a code quality bar. |
| FSA-NPS Technical Reference (SPF 2023/2024) | 2023 revised algorithm: 5 categories, Sugar Ib, revised salt, red meat protein cap, N≥11 rule, SFA ratio, beverage rules | FR-003 (2023 algorithm); FR-006 (5-category architecture); NFR-003 (category classifier accuracy) | Category detection MUST precede scoring. Five separate scoring paths required. The original 2017 algorithm is insufficient. |
| Eurofins/SPF Nutri-Score 2023 Facts (2024) | Algorithm universality; fibre data required but not mandatory on labels; SPF exclusion categories | FR-007 (exclusion gate); DATA-001 (fibre field required); NFR-003 (category accuracy) | Fibre is a data gap that must be addressed in fallback DB. SPF exclusion categories are permanent -- not database limitations. |
| Nutri-Score Wikipedia (2024) | Same-category comparison is the design intent of Nutri-Score; 7-country adoption + WHO endorsement | FR-013 (alternatives within same category); FR-004 (badge colour standard) | Cross-category comparisons are invalid Nutri-Score comparisons -- not just bad UX. Category match in FR-013 is mandatory. |
| Kalpakoglou et al. 2025 (Frontiers in Nutrition) | AINR: 98% accuracy at scale; multi-factor ranking required; database coverage is primary quality bottleneck; human oversight mandatory | AI-001 (multi-factor ranking); AI-002 (explainability); AI-003 (human oversight); DATA-001 (fallback DB critical) | Single-factor grade sorting is insufficient per peer-reviewed evidence. Multi-factor (grade + category + price) is required. |
| Global Nutrition Report NACS (2021) | NUT-04 is a Policy action (Food Environment + Consumer Knowledge); links to WHA nutrition targets | Section 4 (problem framing); Section 5 (stakeholder map); AI-003 (not medical advice boundary) | Correctly positions tool in public health taxonomy for client communications and potential Kenya MoH engagement. |

# **PART III -- Stakeholder and Problem Definition**

## **5. Problem Statement (Evidence-Grounded JHUB Formula)**

|  |
| --- |
| **◆ Problem Statement (IEEE 29148 / JHUB format):** For Kenyan online grocery shoppers -- particularly the estimated 4.2 million Kenyans living with Type 2 Diabetes (IDF 2021) and the approximately 30% of urban adults with hypertension (Kenya Ministry of Health) -- the absence of real-time, interpretable nutritional guidance on retail platforms such as Naivas.co.ke, Carrefour Kenya, and Jumia Food creates a preventable decision gap at the point of purchase, because nutrition information is hidden, inconsistently formatted, or entirely absent on product listing pages. This matters because, as established by IARC Evidence Summary Brief No.2 across a cohort of over 500,000 adults, individuals consuming diets with lower nutritional quality (higher FSAm-NPS DI scores) face a statistically significant increase in cancer risk (+7%), overall mortality (+6%), and cardiovascular disease mortality -- outcomes that are demonstrably preventable with informed dietary choices at the point of purchase. The NutriScore Checkout Tool will address this by embedding the scientifically validated Nutri-Score A-E grade (2023 FSA-NPS revision), NOVA processing level, disease-specific health warnings, and multi-factor healthier alternative suggestions directly into the Kenyan online grocery checkout experience. Success will be measured by: score accuracy (20/20 SPF reference products), badge render speed (<2 seconds), product coverage rate (≥70% of tested Naivas catalogue), user-reported decision confidence improvement in UAT, and full WCAG 2.2 Level AA compliance. |

## **6. Stakeholder Analysis (Evidence-Linked Needs)**

| **Stakeholder** | **Role** | **Evidence-Grounded Need** | **NACS Action Category** | **NUT-04 Response** |
| --- | --- | --- | --- | --- |
| JHUB Africa AfyaVentures | Client sponsor | Deployable health innovation with measurable NCD impact -- NACS Policy Action grounded in IARC evidence (EV-SCI-010) | Policy / Impact | Complete requirements specification; Chrome Web Store deployment; IARC-grounded scientific basis |
| Diabetic shoppers (Persona 2) | Primary user -- highest risk group | Sugar warnings at checkout. IARC EV-SCI-001: FSAm-NPS sugar component linked to metabolic syndrome and cancer risk. | Impact -- Obesity/NCDs | FR-005 (sugar >22.5g/100g); FR-009 (diabetes module); plain language (AI-003, Flesch-Kincaid ≤8) |
| Hypertensive shoppers (Persona 3) | Primary user -- highest prevalence | Sodium identification at purchase. ~30% urban Kenyan adults affected. EV-SCI-002: FSAm-NPS salt component linked to circulatory disease mortality. | Impact -- Obesity/NCDs | FR-010 (sodium >600mg/100g); exact mg value displayed; FR-005 sodium warning |
| Kenya Nutritionists & Dieticians Institute | Validation partner | Scientifically accurate thresholds reviewed against Kenyan clinical practice; endorsement letter for Web Store | Enabling -- Research/monitoring | Phase 2 threshold review meeting; KNDI endorsement letter; EV-SCI-013 grounds this review |
| Kenya Data Protection Commissioner (ODPC) | Regulator -- Kenya DPA 2019 | Lawful basis; data minimisation; right to erasure; no cross-border health data transfer | Enabling -- Governance | DATA-001-004; SEC-001-005; Privacy Policy (Phase 6) |
| Carrefour Kenya / Naivas Digital Teams | Pilot clients | Zero page disruption; customer experience value; privacy compliance | Policy -- Food environment | NFR-002 (CLS=0); Shadow DOM; Phase 5 retailer engagement; terms of service review |
| JKUAT Academic Supervisor | Academic oversight | ISO/IEEE-compliant requirements artefact; documented ECE engineering contributions | Enabling -- Operational | This v2.0 document; Phase deliverables log; attachment report |

## **7. Discovery Evidence Log and Root-Cause Analysis**

### **7.1 Evidence Log**

| **ID** | **Date** | **Source Type** | **Finding** | **Requirement Implication** | **Phase** |
| --- | --- | --- | --- | --- | --- |
| EV-001 | Jun 2026 | Site inspection -- Naivas | Nutrition panel absent from product listing HTML; 3+ clicks to access | FR-001 (detection); FR-002 (API lookup); DATA-001 (fallback DB) | P1 |
| EV-002 | Jun 2026 | Site inspection -- Carrefour Kenya | React lazy-loading -- synchronous DOMContentLoaded listener misses products | FR-001 must use MutationObserver + 300ms debounce | P1 |
| EV-003 | Jun 2026 | OFacts API pilot | Kenyan brands (Kabras, Kenchic, Kimbo) return no match -- fallback DB load-bearing per EV-SCI-012 | DATA-001 is critical path; ≥200 products before Phase 3 | P2 |
| EV-004 | Jun 2026 | Competitive analysis | No Chrome extension provides Nutri-Score for any Kenyan grocery platform | Validates market gap; grounds NACS Policy Action framing (EV-SCI-009) | P1 |
| EV-005 | Jun 2026 | Persona research | Diabetic persona (John M., 58) cannot interpret jargon; plain language + colour-independent design essential | ACC-002 (colour not sole indicator); AI-003; Flesch-Kincaid ≤8 readability target | P3 |
| EV-006 | Jun 2026 | Algorithm review (EV-SCI-004-006) | 2023 revision changes 5 components from 2017 baseline: Sugar Ib, salt scale, red meat protein cap, sweetener penalty, SFA ratio for added fats | FR-003 must implement 2023 revision; 5 category paths required; 20-reference-product test suite mandatory | P2 |
| EV-007 | Jun 2026 | SPF/Eurofins (EV-SCI-007) | SPF exclusion list: baby food, sports nutrition, supplements, meal replacements -- badges on these are scientifically invalid | FR-007 exclusion gate extends beyond non-food items to SPF-excluded food categories | P2 |

### **7.2 Root-Cause Analysis**

| **Observed Problem** | **Root Cause** | **Scientific Evidence** | **Population Impact** | **Requirement Response** |
| --- | --- | --- | --- | --- |
| Kenyan shoppers cannot assess nutritional quality at checkout | No digital FOP labelling exists on Kenyan retail platforms; retailers optimise for price/availability | IARC EV-SCI-001/002: lower nutritional quality linked to +7% cancer risk, +6% mortality -- this is a health risk, not a convenience gap | All four personas; critical for 4.2M diabetics + ~30% hypertensive urban adults | FR-001 (detection); FR-002 (lookup); FR-003 (2023 FSA-NPS score); FR-004 (badge) |
| Diabetic shoppers unknowingly purchase high-sugar products | Sugar content absent or unlabelled on Kenyan online grocery pages; no interpretation aid | EV-SCI-001: sugar component of FSAm-NPS linked to metabolic syndrome and cancer. EV-SCI-004: 2023 Sugar Ib scale specifically improved for this | Persona 2 (John M.); 4.2M Kenyan diabetics | FR-005 (sugar >22.5g); FR-009 (diabetes module); Sugar Ib scale implementation |
| Hypertensive shoppers cannot identify high-sodium products | Sodium inconsistently reported on Kenyan retail pages; no alert mechanism | EV-SCI-002: sodium component linked to circulatory disease mortality. EV-SCI-004: 2023 salt scale (0-20 pts) specifically improved | Persona 3 (Grace N.); ~30% urban Kenyan adults | FR-010 (sodium >600mg with exact value); revised salt scale in score engine |
| Products rendered dynamically are not detected by content scripts | React/Vue frontends lazy-load products after DOMContentLoaded | EV-002 technical discovery | All users -- fundamental to extension functioning | FR-001 (MutationObserver + 300ms debounce) |
| OFacts returns no data for Kenyan-market products | Database built for European market; Kenyan brands underrepresented | EV-003; EV-SCI-012: database coverage is primary quality bottleneck per AINR research | All product detection attempts fail → no score → no health signal | DATA-001 (fallback DB ≥200 products, critical path); FR-002 (fallback logic); NFR-008 (graceful degradation) |
| Score engine uses 2017 algorithm -- produces systematically wrong grades | No explicit implementation standard stated in v1.0 spec | EV-SCI-004/006: 2023 revision corrects 7 specific scientific deficiencies; 2017 algorithm deprecated for new products since Jan 2024 | All users -- wrong grades on red meat, added fats, high-sugar products, beverages with sweeteners | FR-003 explicitly requires 2023 revision; FR-006 (5-category architecture); 20-reference-product test mandatory |

# **PART IV -- Scope and Prioritisation**

## **8. MoSCoW Prioritisation -- Science-Grounded**

| **Feature** | **Priority** | **Science / Evidence Basis** | **Phase** | **Without This...** | **Acceptance Criterion** |
| --- | --- | --- | --- | --- | --- |
| FSA-NPS 2023 score engine (FR-003) | Must | EV-SCI-001/002: accuracy = health-outcome req.; EV-SCI-005/006: 2023 is the valid algorithm | P2 | Grades inaccurate -- false health signals for 4.2M Kenyan diabetics | 20/20 SPF reference products match exactly |
| Product detection -- MutationObserver (FR-001) | Must | EV-002: React/Vue rendering makes sync detection non-functional | P1 | Extension non-functional on all target retailers; zero products scored | ≥90% products detected within 2s of DOM stabilisation |
| Kenyan fallback nutrition database (DATA-001) | Must | EV-003, EV-SCI-012: OFacts coverage sparse; DB is load-bearing | P1-P2 | Score rate for Kenyan products ≈0%; extension non-functional in target market | ≥200 products; ≥70% Naivas catalogue test set returns grade |
| FSA-NPS 5-category architecture (FR-006) | Must | EV-SCI-006: 5 different scoring formulas; category detection precedes scoring | P2 | Red meat, cheese, added fats, beverages all scored incorrectly | ≥95% category classification accuracy on 50-product test set (NFR-003) |
| SPF exclusion gate (FR-007) | Must | EV-SCI-007: baby food, sports nutrition, supplements are permanent SPF exclusions | P2 | Scientifically invalid badges on excluded categories -- potential harm for parents of infants | No badge on baby food, sports nutrition, supplements; confirmed by test suite |
| Disease warnings: diabetes + hypertension (FR-005, FR-009, FR-010) | Must | EV-SCI-001/002: sugar + sodium components linked to mortality; EV-005: plain language required | P3 | No health signal for highest-risk user groups; missed public health opportunity | Warning renders for ALL products exceeding threshold; 100% boundary test pass |
| AI-003 medical advice disclaimer | Must | EV-SCI-013: both AINR research and IARC mandate human oversight; not medical advice | P3 | Legal liability; ethical breach; potential harm if users replace clinical care with extension output | Disclaimer visible in every warning panel without scrolling or expansion |
| Healthier alternatives (FR-013, AI-001, AI-002) | Must | EV-SCI-009/010/012: NACS consumer knowledge action; AINR multi-factor ranking evidence | P4 | Tool only flags problems without solutions; reduces actionability and adoption | ≥3 alternatives; same FSA-NPS category; explanation per AI-002 |
| WCAG 2.2 AA compliance (NFR-007) | Must | EV-005: Persona 2 (John M.) requires accessible design; health tools must be inclusive | P6 | Excludes the users who most need the tool -- elderly, vision-impaired, low-literacy shoppers | Lighthouse ≥90; NVDA + VoiceOver read grade, category, warning text |
| NOVA processing level display (FR-008) | Should | EV-SCI-004: 2023 revision specifically improves wholemeal vs. white bread distinction | P3 | Missing secondary health signal the 2023 algorithm was designed to surface | NOVA 1-4 tag visible on all food product badges |
| Kenya DPA 2019 compliance (DATA-002, DATA-003, SEC-001-005) | Must | Kenya DPA 2019; ODPC; Chrome Web Store privacy disclosure requirements | P5-P6 | Web Store rejection; regulatory breach; erosion of user trust for a health-data tool | Network monitor: no PII transmitted; deletion: IndexedDB empty within 1s |
| Multi-retailer expansion (Phase 5) | Won't | Not evidence-grounded for MVP; technical complexity without incremental scientific benefit | P5 (optional) | Single retailer fully demoable; Phase 5 most droppable | Carrefour Kenya adapter smoke test (Phase 5 only, if time permits) |

# **PART V -- Full Requirements Specification**

All requirements follow IEEE 29148:2018 quality criteria. Evidence chain column references codes defined in Part I.

## **9.1 FR -- Product Detection and Scoring**

| **ID** | **Requirement Statement** | **Priority** | **Evidence Chain** | **Acceptance Criteria** | **Status** | **Phase** |
| --- | --- | --- | --- | --- | --- | --- |
| **FR-001** | The content script shall detect grocery product elements on supported retailer pages using a MutationObserver with a 300ms debounce callback, correctly identifying products rendered asynchronously by React or Vue-based frontends on Naivas.co.ke. | **Must** | *EV-002 -- React rendering; EV-SCI-003 -- algorithm valid for Kenya* | Given: User opens a Naivas product listing where products load asynchronously after page load.  When: Extension content script initialises and MutationObserver fires.  Then: ≥90% of visible product elements are detected and queued for scoring within 2s of DOM stabilisation. | **Draft** | **P1** |
| **FR-002** | The score engine shall retrieve nutritional data from Open Food Facts API (v2/search by product name) falling back to the curated Kenyan database when OFacts returns no result, returning at minimum: energy\_kJ, sugars\_100g, saturated\_fat\_100g, sodium\_mg\_100g, proteins\_100g, fiber\_100g, nova\_group per product. | **Must** | *EV-003 -- OFacts sparse; EV-SCI-005 -- required nutrient fields; EV-SCI-012 -- fallback critical* | Given: "Kabras Sugar 2kg" detected. When: OFacts returns no match. Then: Fallback DB queried within 100ms; all 7 required nutrient fields returned.  When: Neither OFacts nor fallback has data. Then: Grey "?" badge renders -- NFR-008. | **Draft** | **P2** |
| **FR-003** | The score engine shall implement the 2023 FSA-NPS revision exactly: Sugar Ib scale (0-15 pts, 3.4→51g), revised salt scale (0-20 pts, 0.2g steps to 4.0g), red meat protein cap at 2 pts, N≥11 protein exclusion rule for general foods, SFA-to-total-fat ratio for added fats, beverage sweetener +4 penalty, and category-specific letter cut-offs per EV-SCI-005/006. | **Must** | *EV-SCI-005/006 -- 2023 algorithm mandatory; EV-SCI-001/002 -- accuracy = health outcome* | Given: 20 SPF reference products (all 5 categories) with known grades from the official SPF workbook.  When: Score engine processes each product.  Then: All 20 output grades match the SPF reference exactly -- 0 discrepancies permitted.  Given: General food with N=13, protein points=2. When: Score engine applies N≥11 rule. Then: Protein excluded; score = N − FVL − Fibre only. | **Draft** | **P2** |
| **FR-004** | The score engine shall display a colour-coded badge (A=dark green, B=light green, C=yellow, D=orange, E=red) using CSS custom properties -- not inline style strings -- with the letter grade always visible as DOM text independent of colour. | **Must** | *EV-005 -- colour not sole indicator (ACC-002); EV-SCI-007 -- international colour standard; NFR-006 -- CSS vars prevent XSS* | Given: Product scores C. When: Badge renders. Then: Background matches CSS custom property (yellow), letter "C" visible as DOM text, CLS=0, renders within 2s, no CSP violations. | **Draft** | **P3** |
| **FR-005** | The system shall display a health warning panel when any of: sugar >22.5g/100g (diabetes/cancer risk -- EV-SCI-001); sodium >600mg/100g (hypertension/CVD -- EV-SCI-002); saturated fat >5g/100g (cardiovascular -- FR-011). All warnings use plain language (Flesch-Kincaid Grade ≤8) and include the AI-003 disclaimer. | **Must** | *EV-SCI-001/002 -- nutrient-mortality link; EV-005 -- plain language; AI-003 -- not medical advice* | Given: Product has 30g/100g sugar. When: Disease warning engine evaluates. Then: Panel displays "High Sugar -- 30g per 100g. Limit for blood sugar management." plus AI-003 disclaimer.  Given: Product within all thresholds. Then: No warning panel renders. | **Draft** | **P3** |

## **9.2 FR -- Food Classification (FSA-NPS Category Detection)**

| **ID** | **Requirement Statement** | **Priority** | **Evidence Chain** | **Acceptance Criteria** | **Status** | **Phase** |
| --- | --- | --- | --- | --- | --- | --- |
| **FR-006** | The product classifier shall assign each detected product to one of five FSA-NPS 2023 categories -- (1) General foods, (2) Red meat, (3) Cheese, (4) Added fats/oils/nuts/seeds, (5) Beverages -- BEFORE the score engine runs, as the scoring formula and letter cut-offs differ per category per EV-SCI-006. | **Must** | *EV-SCI-006 -- 5 categories with different formulas; architecture requirement* | Given: 500g coconut oil detected. When: Classifier runs. Then: Assigned to "Added fats/oils/nuts/seeds" and SFA-ratio path used.  Given: Coca-Cola detected. Then: Assigned to "Beverages" -- sweetener check runs, water flag evaluated. | **Draft** | **P2** |
| **FR-007** | The food classification gate shall suppress all badge rendering for: (a) non-food items (cleaning products, toiletries), (b) SPF-excluded food categories: baby food (0-3 years), sports nutrition products, food supplements, meal replacement products, food for special medical purposes (EV-SCI-007). | **Must** | *EV-SCI-007 -- SPF permanent exclusions; EV-SCI-003 -- algorithm not applicable to excluded categories* | Given: Baby formula (Stage 1) detected. When: Exclusion gate runs. Then: No badge rendered; no API call made.  Given: Whey protein supplement detected. Then: Classified as sports nutrition; no badge rendered. | **Draft** | **P2** |
| **FR-008** | The system shall tag each scored food product with its NOVA processing level (1=Unprocessed, 2=Culinary Ingredient, 3=Processed, 4=Ultra-Processed) as a secondary indicator below the Nutri-Score grade in the badge widget, sourced from OFacts nova\_group or fallback DB. | **Should** | *EV-SCI-004 -- 2023 revision improves processing-level distinction (wholemeal vs. white bread); EV-SCI-009 -- NACS food environment action* | Given: Supa Loaf white bread (NOVA 4) is scored. When: Badge renders. Then: Widget shows "NOVA 4 -- Ultra-Processed" tag.  Given: NOVA data unavailable. Then: NOVA tag omitted; main grade badge still renders. | **Draft** | **P3** |

## **9.3 FR -- Health Condition Modules**

| **ID** | **Requirement Statement** | **Priority** | **Evidence Chain** | **Acceptance Criteria** | **Status** | **Phase** |
| --- | --- | --- | --- | --- | --- | --- |
| **FR-009** | The diabetes module shall evaluate total sugars per 100g against the FSA-NPS 2023 Sugar Ib threshold, flagging products exceeding 22.5g/100g with: "High Sugar -- [value]g per 100g. This product may not be suitable for blood sugar management." Module shall not use "diabetes" in a diagnostic framing. | **Must** | *EV-SCI-001 -- sugar component linked to metabolic syndrome/cancer; EV-SCI-005 -- Sugar Ib scale; AI-003 -- not medical advice* | Given: Cornflakes 28g/100g sugar. When: Diabetes module evaluates. Then: Warning displays exact value; Flesch-Kincaid Grade ≤8 confirmed.  Given: Brown rice 0.5g/100g sugar. Then: No diabetes warning renders. | **Draft** | **P3** |
| **FR-010** | The hypertension module shall evaluate sodium (mg/100g), flagging products exceeding 600mg/100g with: "High Sodium -- [value]mg per 100g. This product may not be suitable for blood pressure management." Exact mg value must be displayed prominently. | **Must** | *EV-SCI-002 -- sodium linked to circulatory disease mortality; EV-SCI-005 -- revised salt scale; Persona 3 (Grace N.)* | Given: Smoked sausages 1,200mg/100g sodium. When: Hypertension module evaluates. Then: Warning shows "High Sodium -- 1200mg per 100g." Warning colour-coded orange. | **Draft** | **P3** |
| **FR-011** | The cardiovascular module shall trigger a combined warning when saturated fat exceeds 5g/100g AND sodium exceeds 400mg/100g simultaneously: "High in saturated fat and sodium -- associated with cardiovascular risk factors." | **Should** | *EV-SCI-001/002 -- sat fat + sodium components linked to CVD mortality; EV-SCI-005 -- both scored in FSA-NPS* | Given: Product with 7g/100g saturated fat and 800mg/100g sodium. Then: Combined flag with both values stated.  When: Only one threshold exceeded. Then: Single-nutrient warning (FR-005) renders; combined flag does not. | **Draft** | **P4** |
| **FR-012** | The kidney disease module shall evaluate potassium and phosphorus when available, flagging products where potassium exceeds 200mg/100g and sodium exceeds 600mg/100g with a kidney risk warning. | **Could** | *EV-SCI-005 -- potassium/phosphorus rarely available in OFacts data* | Given: Potassium 350mg/100g and sodium 700mg/100g available. Then: Kidney warning renders.  Given: Potassium data unavailable. Then: No kidney warning; sodium-only warning from FR-010 renders if applicable. | **Draft** | **P5** |
| **FR-013** | The system shall recommend at least three healthier alternatives within the same FSA-NPS food category, ranked by (1) Nutri-Score grade (A>B>C>D), (2) same NOVA food category, (3) price proximity ±30%. Each alternative card shall display an explanation of why it was recommended (AI-002). | **Must** | *EV-SCI-012 -- AINR multi-factor ranking mandatory; EV-SCI-009 -- NACS consumer knowledge action; Wikipedia -- same-category comparison is Nutri-Score design intent* | Given: Product scores E, priced KES 120. When: User clicks "See alternatives." Then: ≥3 alternatives shown, all higher than E, same FSA-NPS food category, within ±30% of KES 120, each with explanation card per AI-002. | **Draft** | **P4** |

## **9.4 Non-Functional Requirements**

| **ID** | **Requirement Statement** | **Priority** | **Evidence Chain** | **Acceptance Criteria** | **Status** | **Phase** |
| --- | --- | --- | --- | --- | --- | --- |
| **NFR-001** | Nutri-Score badge and health warnings shall appear within 2 seconds of the MutationObserver detecting product DOM elements, measured on a 25 Mbps 4G connection. This budget includes: cache/DB lookup + score computation + DOM injection. | **Must** | *EV-002 -- async rendering adds latency; IARC -- decision signal must be visible before add-to-cart action* | Given: 10 products visible on Naivas listing on 25 Mbps 4G. When: Extension processes them. Then: All badges visible within 2s. Chrome DevTools Performance trace confirms. | **Draft** | **P3** |
| **NFR-002** | Badge widget injection shall cause zero Cumulative Layout Shift (CLS = 0.00) on all supported retailer pages, using Shadow DOM CSS encapsulation and absolute/relative positioning within card bounds. | **Must** | *Persona 1 -- non-intrusive; Retailer stakeholder -- no page disruption; EV-004 -- retailer adoption depends on zero disruption* | When badge renders on Naivas product listing. Lighthouse CLS score remains 0.00. Product card height/width unchanged post-injection. | **Draft** | **P3** |
| **NFR-003** | Score engine shall classify products into the correct FSA-NPS 2023 category with ≥95% accuracy on a 50-product test set (10 per category), as category misclassification produces incorrect grades. | **Must** | *EV-SCI-006 -- different formula per category; category misclassification is a scientific error* | Given: 50-product test set with known categories. When: Classifier runs. Then: ≥47/50 correctly classified. Category misclassification rate logged in Phase 2 test report. | **Draft** | **P2** |
| **NFR-004** | Extension bundle shall not exceed 250 KB gzipped. Preact (not React) is mandated. No Tailwind CSS framework. | **Should** | *Phase 3 architectural decision -- deliberate bundle-size constraint* | Vite production build artefacts ≤250 KB gzipped. Chrome DevTools Memory: extension idle memory <50 MB. | **Draft** | **P3** |
| **NFR-005** | Retailer scraping adapter shall use an adapter-pattern architecture (one file per retailer implementing IRetailerAdapter) so adding a new retailer requires only a new adapter file -- zero changes to score-engine.ts, widget.tsx, or background.ts. | **Must** | *EV-007 -- multiple retailers planned; maintainability requirement* | Carrefour Kenya adapter added in Phase 5 without modifying any core module file. GitHub diff for Phase 5 shows only adapter-layer changes. | **Draft** | **P5** |
| **NFR-006** | All extension JS shall be free of eval(), innerHTML assignments, and unsanitised DOM writes. Grade colours applied exclusively via CSS custom properties. CSP in manifest.json prohibits unsafe-eval and unsafe-inline. | **Must** | *NFR-006 (v1.0 spec); OWASP ASVS; Chrome Web Store review security check* | ESLint no-eval rule passes on CI with zero violations. Lighthouse CSP audit returns no violations. | **Draft** | **P2** |
| **NFR-007** | Extension popup and injected widget shall achieve WCAG 2.2 Level AA: text alternatives for all visual indicators, colour never the sole indicator, keyboard navigation supported, visible focus indicators, compatible with NVDA and VoiceOver. | **Must** | *EV-005 -- Persona 2 (John M.) requires accessible design; IARC -- tool must reach highest-risk populations* | Lighthouse accessibility audit score ≥90. NVDA reads badge grade, category, and warning text. VoiceOver same. All interactive elements reachable via Tab. Focus indicators visible at 100% zoom. | **Draft** | **P6** |
| **NFR-008** | When OFacts API is unreachable or times out (>3 seconds), extension shall display a grey "?" badge with tooltip "Nutrition data currently unavailable" rather than a broken or blank badge. | **Should** | *EV-003 -- API connectivity unreliable on Kenyan 3G/4G; Persona 2 -- intermittent connectivity* | Given: OFacts API request times out. When: Extension processes product. Then: Grey badge with "?" renders within 3.1s. Tooltip appears on hover. No JavaScript error thrown. | **Draft** | **P3** |

## **9.5 Data Requirements**

| **ID** | **Requirement Statement** | **Priority** | **Evidence Chain** | **Acceptance Criteria** | **Status** | **Phase** |
| --- | --- | --- | --- | --- | --- | --- |
| **DATA-001** | The system shall collect only the following nutritional fields: energy\_kJ, sugars\_100g, saturated\_fat\_100g, sodium\_mg\_100g, proteins\_100g, fiber\_100g, nova\_group. Fibre must be explicitly sourced as it is required by FSA-NPS 2023 (EV-SCI-005) but is not mandatory on Kenyan labels (EV-SCI-008). | **Must** | *EV-SCI-005 -- required FSA-NPS fields; EV-SCI-008 -- fibre data gap; Kenya DPA 2019 data minimisation* | IndexedDB schema contains exactly these 7 fields -- no additional fields stored. API response parser strips all other OFacts fields before storage. Fallback DB entries document fibre as "estimated" where derived from food composition tables. | **Draft** | **P2** |
| **DATA-002** | Shopping history shall be stored only after explicit user consent modal acknowledging: "Your shopping history is stored only on this device. It is never sent to any server. You can delete it at any time in Settings." | **Must** | *Kenya DPA 2019 s.30 (consent); Chrome Web Store privacy disclosure* | Given: First extension use. When: User opens popup. Then: Consent modal appears before any history recorded.  Given: User declines. Then: Extension functions normally (scores, warnings, alternatives) but zero history stored. | **Draft** | **P5** |
| **DATA-003** | Users shall delete all locally stored personal data (shopping history + health condition toggles) from settings with a single "Delete all my data" confirmation action completing within 1 second with confirmation toast. | **Must** | *Kenya DPA 2019 s.26 (right to erasure)* | Given: Populated IndexedDB. When: User clicks "Delete all my data" and confirms. Then: All IndexedDB stores empty within 1s. Toast: "All your data has been deleted." | **Draft** | **P5** |
| **DATA-004** | Extension shall not transmit any PII, shopping history, or health condition flags to any external server. Only product name strings sent to OFacts API. No user identifiers in any request payload. | **Must** | *Kenya DPA 2019; Chrome Web Store privacy disclosure; AI-003 -- health data sensitivity* | Chrome DevTools Network panel during 10-product test session: only OFacts API requests visible. No user identifiers, history data, or condition flags in any request payload. No third-party analytics scripts. | **Draft** | **P2** |
| **DATA-005** | The system shall exclude products from scoring where nutrition contribution is negligible per KNPM/ATNi scope: unprocessed meat and raw agricultural commodities, plain tea and plain coffee, herbs/spices/vinegars without an on-pack nutrient declaration, alcoholic beverages, and infant/medical nutrition products. | **Must** | *EV-KE-001, EV-KE-003* | Given the Phase-1 product corpus (7,821 unified records audited June-July 2026). When the exclusion filter runs. Then negligible-nutrition products are flagged IsEligibleForScoring=false with a machine-readable ExclusionReason, not silently dropped. | **Draft** | **P2** |
| **DATA-006** | The system shall flag and exclude nutrition-profile records with physiologically implausible per-100g values (any macronutrient field >100g/100g, or energy >3,900kJ/100g) or with a documented food-composition-table donor-row mismatch, rather than passing them to the score engine. | **Must** | *EV-SCI-005 (physiological bounds); EV-KE-010 (internal audit)* | Given the audited nutritional\_profiles.json corpus. When implausibility/mismatch checks run. Then flagged records are excluded with reason codes DATA\_QUALITY\_IMPLAUSIBLE\_VALUES / CONFIRMED\_MISLABELED\_FCT\_MATCH, and excluded-record counts are logged for manual FCT re-matching in Phase 2. | **Draft** | **P2** |

## **9.6 AI and Recommendation Engine Requirements**

| **ID** | **Requirement Statement** | **Priority** | **Evidence Chain** | **Acceptance Criteria** | **Status** | **Phase** |
| --- | --- | --- | --- | --- | --- | --- |
| **AI-001** | The recommendation engine shall rank alternative products using three factors: (1) Nutri-Score grade (A>B>C>D -- higher always preferred), (2) same FSA-NPS food category (mandatory -- cross-category comparisons are invalid per Nutri-Score design intent), (3) price proximity within ±30% of original product price where available. | **Must** | *EV-SCI-012 -- multi-factor ranking mandatory per AINR research; Wikipedia/EV-SCI-009 -- same-category comparison is Nutri-Score design intent* | Given: Cornflakes (E, KES 150) with alternatives: Oats (A, KES 140), Millet (A, KES 200), Brown flakes (B, KES 160).  When: Engine runs with ±30% price filter. Then: Oats (A, within range) ranks first; Brown flakes (B, within range) ranks second; Millet (A, outside ±30%) excluded if within-range alternatives ≥3. | **Draft** | **P4** |
| **AI-002** | Every recommended alternative shall include an explanation: (a) grade comparison, (b) category label, (c) specific nutrients improved. | **Must** | *EV-SCI-012 -- AINR explainability; EV-SCI-009 -- NACS consumer knowledge requires explanation* | Given: Oats (A) recommended for Cornflakes (E). When: Card renders. Then: "Grade A (vs Grade E). Same category: Cereals. 70% less sugar, 45% less sodium." All three explanation elements present in DOM text. | **Draft** | **P4** |
| **AI-003** | The system shall not present any grade, disease warning, or recommendation as medical advice. All health warning panels shall include the visible disclaimer: "General nutritional information only -- not medical advice. Consult a qualified nutritionist or physician for personalised dietary guidance." | **Must** | *EV-SCI-013 -- both AINR research and IARC mandate human oversight* | In every rendered warning panel (diabetes, hypertension, CVD, kidney): disclaimer text visible without scrolling or expansion.  Disclaimer passes Flesch-Kincaid Grade ≤8. Present in every alternative recommendation card. | **Draft** | **P3** |

# **PART VI -- Architecture, Security, Privacy, and Risk**

## **10. System Architecture Overview**

The FSA-NPS 2023 algorithm mandates a category-first architecture: product category must be determined before any scoring formula is applied, because the formula, threshold tables, and letter cut-offs all differ per category (EV-SCI-006).

| **Execution Layer** | **Module** | **Responsibility** | **Evidence Basis** | **Design Constraint** |
| --- | --- | --- | --- | --- |
| Content Script | content-script.ts | DOM observation (MutationObserver, 300ms debounce); product detection; Shadow DOM widget injection; message passing to background | EV-002 -- async rendering | Thin layer -- no scoring logic. Detection and display only. All computation in background worker. |
| Background Service Worker | background.ts | Request deduplication (product name hash); cache-first IndexedDB lookup; OFacts API calls (HTTPS only, DATA-004); score engine dispatch | EV-003 -- cache-first; NFR-006 -- HTTPS only | No DOM access. Handles concurrent product detection requests. Deduplication prevents duplicate API calls. |
| Score Engine | score-engine.ts | 5-category detection (FR-006); 2023 FSA-NPS implementation (N pts, P pts, score-combining, letter cut-offs); GRADE\_COLORS shared module | EV-SCI-005/006 -- 2023 algorithm mandatory | Single source of truth for grade computation. All 5 category paths implemented. Unit tested against 20 SPF reference products. |
| Food Classifier | food-classifier.ts | FSA-NPS category assignment; SPF exclusion gate (baby food, sports nutrition, supplements); non-food detection; NOVA tagging | EV-SCI-007 -- SPF exclusion list; FR-006/007 | Category detection uses product name tokenisation + OFacts food\_groups. Exclusion gate runs BEFORE any API call. |
| Disease Engine | disease-engine.ts | Threshold evaluation (sugar >22.5g; sodium >600mg; satfat >5g + sodium >400mg); warning text generation; AI-003 disclaimer injection | EV-SCI-001/002/005; FR-009/010/011; AI-003 | Thresholds in single config file -- one place to update after KNDI validation. Disclaimer text is a constant. |
| Alternatives Engine | alternatives-engine.ts | Multi-factor ranking (grade → category → price); explanation text (AI-002); ≥3 alternatives enforcement | EV-SCI-012 -- AINR multi-factor; FR-013; AI-001 | Category match is mandatory (not optional). Price filter ±30%; if <3 found, widen to ±50%. |
| UI / Widget | widget.tsx (Preact) | Badge rendering (CSS custom properties); NOVA tag; warning panel; alternatives drawer; WCAG 2.2 AA (aria-label, role, focus) | EV-005; NFR-006 -- CSS vars; NFR-007 -- WCAG 2.2 | Preact mandated (NFR-004 bundle size). Shadow DOM CSS encapsulation (NFR-002). No React, no Tailwind. |

## **10.5 NUT-04 Data Governance and Database Lifecycle**

This section implements the Database Modification Recommendation (July 2026, external review of this specification, the KFCT2018 reference database, and the validated Naivas/Carrefour datasets). It establishes NUT-04’s data governance model: this specification is the authoritative governance document, and every nutrition record in the production database must be traceable against the standards defined here rather than against ad hoc conventions that accumulate during enrichment.

## **10.5.1 Layered Data Architecture**

NUT-04 data flows through six governed layers, each with a single responsibility: (1) this Requirements Specification (governance); (2) the Kenya Food Composition Tables 2018 as an immutable scientific reference -- KFCT records are never edited directly, only extended with derived/completed values alongside the original; (3) a curated nutrition reference database (KFCT + FAO/USDA/McCance & Widdowson + manufacturer labels); (4) retailer product databases (Naivas, Carrefour, and future retailers), which consume the reference layer rather than each inventing their own nutrient estimates; (5) the FSA-NPS 2023 scoring engine; (6) the browser extension. A retail product record should reach the scoring engine only after passing through the reference layer’s matching pipeline: GTIN match -> manufacturer nutrition panel -> KFCT match -> international food composition match -> curated Kenyan fallback -> category default (last resort) -> manual review flag.

## **10.5.2 Official Confidence Hierarchy**

DataConfidence values are restricted to the seven tiers below, listed from strongest to weakest evidence. Ad hoc confidence values that accumulated during 2026 enrichment work (e.g. "kenya\_fct\_2018\_verified", "verified\_manual\_reference", "unverified\_generic\_placeholder") have been mapped onto this hierarchy in the production datasets and must not be introduced again outside it.

|  |  |
| --- | --- |
| **Tier** | **Definition** |
| manufacturer\_verified | Value taken directly from the manufacturer’s printed nutrition panel or verified digital spec sheet. |
| kfct\_verified | Value matched to a Kenya Food Composition Table 2018 entry for the same food (exact match or documented closest-available proxy). |
| international\_fct\_verified | Value cross-referenced against FAO INFOODS, USDA FoodData Central, McCance & Widdowson, or an equivalent international food composition table. |
| kenyan\_fallback | A Kenyan-context estimate not tied to a specific verified source record -- acceptable during enrichment, not for long-term production reliance. |
| manufacturer\_estimated | A manufacturer-provided estimate that is not a full lab-analysed panel (e.g. a supplier spec sheet range). |
| category\_default | A generic category-level average applied in the absence of any product-specific data. Last-resort tier before manual review. |
| manual\_review\_required | No source above could be confidently applied; the record is flagged for human review rather than assigned an unverified value. |

## **10.5.3 Mandatory Provenance Fields**

Every nutrition record in the production database must carry the following provenance fields, in addition to DataConfidence: SourceDatabase, SourceFoodCode, EvidenceType, ValidationMethod, Reviewer, ValidationDate, and ReviewStatus (one of "reviewed" or "pending\_review"). These fields answer not just what confidence tier a value carries but why -- which source it was matched against, by what method, by whom, and when. Records lacking these fields do not meet the Data Requirements defined in Section 9.5.

## **10.5.4 Mandatory Completeness Thresholds**

A production record must not carry EnergyKJ, SugarsG, FatG, or CarbohydratesG as null unless the product is genuinely exempt (e.g. plain water, per DATA-005’s KNPM/ATNi negligible-nutrition scope). Where SaltG is null but SodiumMG is known, SaltG must be derived (Sodium x 2.5 / 1000) rather than left null. Records that cannot meet this threshold through any available source are tagged manual\_review\_required rather than silently left incomplete.

## **10.5.5 Automatic Plausibility Validation**

Every record is checked against the following rules before being trusted for scoring; a failing record is flagged in ValidationFlags rather than silently corrected or silently trusted:

|  |  |
| --- | --- |
| **Rule** | **Flag raised** |
| SaltG is not approximately SodiumMG x 2.5 / 1000 | SALT\_SODIUM\_MISMATCH |
| EnergyKJ is not approximately consistent with Protein/Fat/Carbohydrate via the Atwater factors (17/37/17 kJ per g), beyond a 30% tolerance | ENERGY\_ATWATER\_MISMATCH |
| CanonicalCategory = Cooking Oils but CarbohydratesG > 5g | OIL\_HAS\_CARBS |
| CanonicalCategory = Fresh Fruit but SodiumMG > 20mg | FRUIT\_HIGH\_SODIUM |
| Product name indicates a sugar/sweetener product but ProteinG > 0.5g | SUGAR\_HAS\_PROTEIN |
| Any macronutrient field required by 10.5.4 remains null after the completeness pass | INCOMPLETE\_FIELDS |

## **10.5.6 Record Lifecycle and Versioning**

KFCT2018 reference records are immutable at the source-value level: a completed or derived value is always recorded alongside the original (OriginalKFCTValue, CompletedValue, CompletionMethod), never in place of it. Retail product records carry Reviewer and ValidationDate so that any correction is attributable and dated, and CategoryReviewStatus so that category assignment (Section 9.2) is tracked independently of nutrient confidence. Future re-validation passes should increment the record’s ValidationDate and update ReviewStatus rather than overwrite history silently.

## **10.5.7 Quality Gates Before Production Promotion**

|  |  |
| --- | --- |
| **Gate** | **Target** |
| Required nutrient fields complete (per 10.5.4) | 100% |
| Canonical category assigned from the controlled taxonomy (Section 9.2) | 100% |
| FSA-NPS category code assigned | 100% |
| Category-default records | < 5% of production database |
| Provenance fields populated (per 10.5.3) | 100% |
| Internal consistency (per 10.5.5) | 100% |
| Manual review for high-risk categories (oils, cheese, dairy, soft drinks, breakfast cereals, confectionery, processed meat) | Required before promotion |

The July 2026 production snapshot does not yet meet the category-default and manufacturer-verification targets above (see the Database Modification Recommendation implementation notes accompanying this release); Sections 15 (Delivery Roadmap) should schedule the remaining re-matching work accordingly.

## **11. Security and Privacy Compliance Matrix**

| **ID** | **Requirement** | **Standard / Basis** | **Verification** | **Status** |
| --- | --- | --- | --- | --- |
| SEC-001 | All OFacts API communication uses HTTPS/TLS 1.2+; HTTP fallback disabled in CSP; connect-src restricted to world.openfoodfacts.org | Kenya DPA 2019; Chrome Web Store; OWASP ASVS 9.2 | CSP header inspection in manifest.json; DevTools Network confirms no HTTP requests | Draft |
| SEC-002 | No eval(), no innerHTML, no inline event handlers; grade colours via CSS custom properties only; CSP: default-src 'none'; script-src 'self' | OWASP ASVS 1.14.6; Chrome Web Store security review | ESLint no-eval CI rule; Lighthouse CSP audit; manual code review | Draft |
| SEC-003 | User health condition toggles are stored as boolean flags in local IndexedDB only -- never transmitted; they are input parameters for display, not diagnostic outputs | Kenya DPA 2019 s.32 -- sensitive data (health) requires explicit consent and prohibition on transmission | Network monitor: no health flag data in any outbound request; consent modal explicitly states local-only storage | Draft |
| SEC-004 | Privacy Policy (Phase 6 deliverable) explicitly states: (1) what data is collected; (2) what is stored locally; (3) what is never transmitted; (4) user rights under Kenya DPA 2019 | Kenya DPA 2019 s.25 (right to information); Chrome Web Store data disclosure requirements | Privacy Policy reviewed against ODPC guidelines before Web Store submission | Draft |
| SEC-005 | Administrative changes to main branch require GPG-signed commits; release tags are signed; GitHub branch protection rule enforced | Software supply chain integrity; SEC-003 in v1.0 spec | GitHub branch protection settings; GPG key verification on release tags | Draft |

## **12. Science-Grounded Risk Register**

| **ID** | **Risk** | **Likelihood** | **Impact** | **Mitigation (Evidence-Based)** | **Owner** | **Status** |
| --- | --- | --- | --- | --- | --- | --- |
| R-001 | Score engine implements 2017 algorithm instead of 2023 revision -- produces incorrect grades (EV-SCI-004/006), particularly for high-sugar products, processed meats, added fats, beverages with sweeteners | Medium | High (health harm) | 20-reference-product test suite against SPF 2024 workbook is mandatory acceptance criterion for FR-003. Automated CI test prevents regression. All 5 category paths tested separately. | Kibet | Open |
| R-002 | OFacts coverage too sparse to compute grades for >30% of Naivas catalogue (EV-003, EV-SCI-012) | High | High | Fallback DB is critical-path deliverable in Phase 1-2. Target ≥200 products. Coverage rate metric in Phase 2 test report. Escalate to JHUB if <60% coverage by end of Phase 2. | Kibet | Open |
| R-003 | Food category misclassification produces systematically wrong grades (EV-SCI-006) | Medium | High | 50-product category classification test (NFR-003: ≥95% accuracy). Category detection logic reviewed by nutritionist in Phase 2 KNDI meeting. | Kibet | Open |
| R-004 | Health warning thresholds not validated by qualified nutritionist | Low | High | Phase 2: threshold review meeting with KNDI contact. Thresholds documented with source (FSA-NPS 2023 + IARC). KNDI endorsement letter before Web Store submission. | Kibet + AfyaVentures | Open |
| R-005 | Users interpret warnings as medical advice despite AI-003 disclaimer (EV-SCI-013) | Medium | High | AI-003 disclaimer mandatory and non-dismissible. UAT includes low-literacy proxy user. Readability check: Flesch-Kincaid Grade ≤8 for all warning text. | Kibet + KNDI | Open |
| R-006 | Chrome Web Store rejects submission due to ambiguous data-handling disclosure | Medium | High | Submit 2 weeks before Phase 6 deadline. Privacy Policy reviewed against Web Store requirements. Condition toggles documented as boolean, locally stored, user-deletable. | Kibet | Open |
| R-007 | Retailer changes DOM structure mid-project -- breaks product detection | Medium | Medium | Adapter pattern (NFR-005) isolates retailer-specific DOM selectors. Weekly automated smoke test against live retailer pages in CI. Alert on test failure. | Kibet | Open |

# **PART VII -- Validation, Traceability, and Delivery**

## **13. Validation and Testing Framework**

|  |
| --- |
| **★ Why score engine validation is uniquely critical:** Unlike standard software requirements where a defect causes an error message, an incorrect Nutri-Score grade causes a user with diabetes or hypertension to receive a false health signal at the point of purchase. EV-SCI-001 and EV-SCI-002 establish that nutritional quality signals are mortality-relevant in a cohort of 500,000+ adults. FR-003 must therefore be treated as safety-adjacent, and the 20/20 reference-product acceptance criterion is a minimum science-grade accuracy bar -- not merely a code quality metric. |

| **Test Type** | **Description** | **Required Evidence** | **Phase** |
| --- | --- | --- | --- |
| Algorithm unit tests (FR-003) | 20 SPF reference products (all 5 categories) -- each nutrition vector processed by score-engine.ts and output compared to SPF reference grade. 100% pass rate required. | Vitest test suite: 20/20 pass. Published as Phase 2 deliverable alongside Score Algorithm White Paper. | P2 |
| Category classification tests (NFR-003) | 50-product test set (10 per FSA-NPS category) -- classifier assigns correct category. ≥47/50 (94%) required. | Vitest test suite; category assignment log; misclassification report. | P2 |
| Threshold boundary tests (FR-005, FR-009, FR-010) | Synthetic products at exactly threshold value, 1 unit below, 1 unit above for each disease warning trigger. 100% correct activation/suppression. | Boundary test matrix document; Vitest assertions. | P3 |
| Performance test (NFR-001) | 10 products on Naivas listing on Chrome with 25 Mbps network throttle. All badges within 2 seconds. CLS = 0.00. | Lighthouse report; Chrome DevTools Performance trace; CLS screenshot. | P3 |
| Coverage test (DATA-001 / FR-002) | 100 products from Naivas test set. ≥70% must receive a Nutri-Score grade from OFacts + fallback DB combined. | Coverage rate report: [products with grade] / [total tested] × 100%. | P2 |
| WCAG 2.2 AA accessibility test (NFR-007) | Lighthouse audit (score ≥90); NVDA screen reader walkthrough; VoiceOver on macOS; keyboard-only navigation; colour-only indicator check. | Lighthouse report; NVDA session recording (with consent); keyboard test log. | P6 |
| Privacy / security test (DATA-004, SEC-001) | Chrome DevTools Network panel: confirm no PII in outbound requests; HTTPS only; no third-party analytics. | Network session screenshot or HAR file; CSP header inspection. | P2, P6 |
| UAT (all FRs -- user perspective) | AfyaVentures supervisor + 2 persona-representative users + 1 accessibility tester. Tasks: browse listing, observe badge, trigger warning, click alternatives, delete data, screen reader test. | UAT session notes; issues log; signed UAT sign-off form. | P6 |

## **14. Requirements Traceability Matrix**

| **Need ID** | **Stakeholder Need** | **Req. ID(s)** | **Evidence Chain** | **Design Module** | **Test Case** | **Sign-off** |
| --- | --- | --- | --- | --- | --- | --- |
| N-001 | Accurate Nutri-Score grade at checkout | FR-003, FR-006 | EV-SCI-001/002 -- accuracy = health outcome; EV-SCI-005/006 -- 2023 algorithm | score-engine.ts | TC-ALG: 20 SPF ref products | AfyaVentures |
| N-002 | Products detected on retailer pages | FR-001 | EV-002 -- async rendering | content-script.ts (MutationObserver) | TC-DET: 10-product listing | Kibet QA |
| N-003 | Nutrition data for Kenyan products | FR-002, DATA-001 | EV-003; EV-SCI-012 -- fallback critical | background.ts + fallback-db.json | TC-COV: 100-product coverage | Phase 2 report |
| N-004 | Diabetes sugar warning | FR-005, FR-009 | EV-SCI-001 -- sugar + cancer; EV-005 -- plain language | disease-engine.ts (diabetes module) | TC-THR: sugar boundary | KNDI + Persona 2 UAT |
| N-005 | Hypertension sodium warning | FR-005, FR-010 | EV-SCI-002 -- sodium + CVD mortality | disease-engine.ts (hypertension module) | TC-THR: sodium boundary | KNDI + Persona 3 UAT |
| N-006 | Healthier alternatives with explanation | FR-013, AI-001, AI-002 | EV-SCI-012 -- AINR multi-factor; EV-SCI-009 -- NACS consumer knowledge | alternatives-engine.ts | TC-ALT: ≥3 alternatives shown | AfyaVentures UAT |
| N-007 | No badge on excluded products | FR-007 | EV-SCI-007 -- SPF exclusion list | food-classifier.ts (exclusion gate) | TC-EXCL: baby food, supplements | Kibet code review |
| N-008 | Not medical advice | AI-003 | EV-SCI-013 -- AINR + IARC oversight | disease-engine.ts (disclaimer) | TC-DISC: disclaimer in all warning states | AfyaVentures + KNDI |
| N-009 | Accessible to all users | NFR-007 | EV-005 -- Persona 2; WCAG 2.2 mandate | widget.tsx (aria, focus, colour+text) | TC-A11Y: Lighthouse, NVDA, VoiceOver | Phase 6 accessibility audit |
| N-010 | User data privacy | DATA-001-004, SEC-001-005 | Kenya DPA 2019; Chrome Web Store | background.ts; IndexedDB; manifest CSP | TC-PRIV: network monitor; TC-DEL: deletion | ODPC compliance check |
| N-011 | Non-intrusive on retailer pages | NFR-002 | Retailer stakeholder; EV-004 -- adoption depends on zero disruption | widget.tsx (Shadow DOM, positioning) | TC-CLS: Lighthouse CLS=0.00 | Retailer UAT (Phase 5) |
| N-012 | Fast enough not to disrupt shopping | NFR-001 | EV-002 -- async overhead; persona timing expectations | background.ts (cache-first); score-engine.ts | TC-PERF: 2s timing trace | Phase 3 QA report |

## **15. Delivery Roadmap**

| **Phase** | **Target Date** | **Key Science / Evidence Deliverables** | **Client Gate** | **Acceptance Evidence** |
| --- | --- | --- | --- | --- |
| P1 -- Foundations | Week 3 (Jul 11, 2026) | MutationObserver scraper (FR-001 validated on EV-002); Component Diagram; first 50 Kenyan fallback DB entries with fibre values (EV-SCI-008) | AfyaVentures supervisor review | Scraper detects products on Naivas; 50 fallback DB entries with 7 required nutrient fields |
| P2 -- Score Engine | Week 5 (Jul 25, 2026) | 2023 FSA-NPS algorithm (FR-003, all 5 categories); 20-reference-product test suite; ≥200-product fallback DB; KNDI threshold review meeting; Score Algorithm White Paper citing EV-SCI-001-008 | KNDI threshold validation meeting | 20/20 reference products pass; ≥70% coverage on 100-product Naivas test set; KNDI validation memo |
| P3 -- Widget MVP | Week 6 (Aug 1, 2026) | Score badge (FR-004); disease warnings (FR-005) with AI-003 disclaimer; NOVA tag (FR-008); 2s performance test; Sequence Diagram | AfyaVentures demo | E2E: badge renders <2s, CLS=0.00; all thresholds trigger; disclaimer visible in all warning states |
| P4 -- Alternatives | Week 8 (Aug 15, 2026) | Multi-factor alternatives engine (FR-013, AI-001/002 -- grounded in EV-SCI-012); cardiovascular module (FR-011) | Internal demo | ≥3 alternatives with explanation; no cross-category recommendations; AI-001 multi-factor ranking confirmed |
| P5 -- Dashboard + Data | Week 10 (Aug 29, 2026) | Shopping history dashboard (DATA-002 consent flow); data deletion (DATA-003); Carrefour Kenya adapter (if time permits); kidney module (FR-012 -- optional) | AfyaVentures UAT session | Consent flow works; history dashboard shows data; deletion works in <1s; Carrefour adapter smoke test (if built) |
| P6 -- Privacy + Submission | Week 12 (Sep 12, 2026) | Privacy Policy (Kenya DPA 2019 compliant, reviewed against ODPC guidelines); WCAG 2.2 AA audit (NFR-007); Chrome Web Store submission; KNDI endorsement letter; all 4 diagram deliverables | Client/supervisor final sign-off | Web Store submission receipt; Lighthouse A11Y ≥90; NVDA/VoiceOver test passed; Privacy Policy ODPC-reviewed |

# **PART VIII -- Appendices**

## **Appendix A -- FSA-NPS 2023 Algorithm Quick Reference**

Implementation contract for score-engine.ts. Source: Santé publique France calculation workbook (4 April 2024) and Eclarion Technical Reference.

| **Component** | **General Foods** | **Red Meat** | **Cheese** | **Added Fats/Oils** | **Beverages** |
| --- | --- | --- | --- | --- | --- |
| N: Energy | 0-10 pts, 335→3350 kJ | 0-10 pts, same | 0-10 pts, same | SFA energy: 120→1200 kJ | 0-10 pts, 30→390 kJ (stricter) |
| N: Sugars | Sugar Ib: 0-15 pts, 3.4→51g | Same as general | Same as general | Same as general | 0-10 pts, 0.5→11g/100ml |
| N: Saturated fat | 0-10 pts, 1pt/g to 10g | 0-10 pts, same | 0-10 pts, same | SFA-to-total-fat ratio: 10%→64% | 0-10 pts, same as general |
| N: Salt | 0-20 pts, 0.2g steps to 4.0g | Same as general | Same as general | Same as general | Same as general |
| N: Sweetener | n/a | n/a | n/a | n/a | +4 pts if non-nutritive sweetener present |
| P: FVL | 0-5 pts: 40/60/80/>80% | Same | Same | Same | 0/2/4/6 -- four-band scale |
| P: Fibre | 0-5 pts (Scenario II), 3.0→7.4g | Same | Same | Same | Same |
| P: Protein | 0-7 pts (Scenario II), 2.4→17g | CAP: max 2 pts | Same as general (no cap) | Same as general | Beverage-specific scale |
| Score combining | N<11: N−P; N≥11: N−FVL−Fibre | Same; protein always capped at 2 | Always N−P (regardless of N) | N<7: N−P; N≥7: N−FVL−Fibre | Always N−P |
| Grade cut-offs (A/B/C/D/E) | <1 / <3 / <11 / <19 / ≥19 | Same as general | Same as general | <-5 / <3 / <11 / <19 / ≥19 | Water flag / ≤2 / ≤6 / ≤9 / >9 |

## **Appendix B -- Evidence Source Index (Full)**

| **Code** | **Source** | **Type** | **Key Contribution to NUT-04** |
| --- | --- | --- | --- |
| EV-SCI-001 | IARC Evidence Summary Brief No.2 (2021) | Peer-reviewed epidemiology (WHO/IARC) | EPIC cohort: +7% cancer risk with higher FSAm-NPS DI score. Grounds score accuracy as health-outcome requirement. |
| EV-SCI-002 | IARC Evidence Summary Brief No.2 (2021) | Peer-reviewed epidemiology (WHO/IARC) | EPIC cohort: +6% overall mortality. Grounds sodium and saturated fat thresholds in disease warning modules. |
| EV-SCI-003 | IARC Evidence Summary Brief No.2 (2021) | Peer-reviewed epidemiology (WHO/IARC) | FSAm-NPS valid across 10 countries/dietary cultures → establishes Kenyan market applicability. |
| EV-SCI-004 | FSA-NPS Technical Reference (Eclarion/SPF, 2024) | Algorithm documentation | 7 goals of 2023 revision → establishes why 2023 (not 2017) algorithm must be implemented. |
| EV-SCI-005 | FSA-NPS Technical Reference (Eclarion/SPF, 2024) | Algorithm documentation | Exact N/P component tables, score-combining rules, category-specific cut-offs → implementation contract for score-engine.ts. |
| EV-SCI-006 | FSA-NPS Technical Reference (Eclarion/SPF, 2024) | Algorithm documentation | 5 product categories with different formulas → mandatory category-first architecture. |
| EV-SCI-007 | Eurofins/SPF Nutri-Score 2023 Facts (2024) | Regulatory/technical guidance | Algorithm universality; SPF exclusion categories; fibre measurement methods. |
| EV-SCI-008 | Eurofins/SPF Nutri-Score 2023 Facts (2024) | Regulatory/technical guidance | Fibre not mandatory on Kenyan labels but required for FSA-NPS → fallback DB must include fibre. |
| EV-SCI-009 | Global Nutrition Report NACS (2021) | International nutrition governance | NUT-04 is a Policy action (Food Environment + Consumer Knowledge) per NACS taxonomy. |
| EV-SCI-010 | Global Nutrition Report NACS (2021) + IARC (2021) | Combined evidence | IARC + NACS: dual consumer-behaviour and systemic-incentive framing of front-of-pack labelling. |
| EV-SCI-011 | Kalpakoglou et al. 2025, Frontiers in Nutrition | Peer-reviewed AI/nutrition research | AINR achieves 98% caloric accuracy at scale; multi-factor ranking required for valid recommendations. |
| EV-SCI-012 | Kalpakoglou et al. 2025, Frontiers in Nutrition | Peer-reviewed AI/nutrition research | Database coverage is primary quality bottleneck; elevates fallback DB to critical-path status. |
| EV-SCI-013 | Kalpakoglou et al. 2025 + IARC (2021) | Combined evidence | Human oversight mandatory in both sources → grounds AI-003 medical advice prohibition. |
| EV-001 | Direct site inspection -- Naivas.co.ke, June 2026 | Technical discovery | Nutrition panel absent from listing HTML → grounds FR-001 and FR-002. |
| EV-002 | Direct site inspection -- Carrefour Kenya, June 2026 | Technical discovery | React lazy-loading → grounds MutationObserver requirement in FR-001. |
| EV-003 | OFacts API pilot test, June 2026 | Technical discovery | Sparse Kenyan coverage → grounds DATA-001 fallback DB as critical-path. |
| EV-004 | Chrome Web Store search, June 2026 | Competitive analysis | No existing Kenyan grocery Nutri-Score extension → validates market gap. |
| EV-005 | Persona research (proxy), June 2026 | User research | Plain language + colour-independent design essential for Persona 2 → grounds ACC-002, AI-003 readability target. |
| EV-KE-001 | Kenya Nutrient Profile Model (KNPM) 1st Ed., MoH, July 2025 | National regulatory standard | 25-category KNPM (JKUAT-contributed) is the MoH-approved FOP standard -> authoritative category/eligibility layer alongside the FSA-NPS grade. |
| EV-KE-002 | KNPM validation study, Nutrients (MDPI), Feb 2026 | Peer-reviewed validation | Confirms KNPM's 25 categories are implementable against real retailer product data, same shape as NUT-04's corpus. |
| EV-KE-003 | ATNi/TGI Kenya Market Assessment 2025, Product Profile (983 products/30 companies) | Independent market assessment | Confirms NUT-04's negligible-nutrition exclusion scope (plain tea/coffee, raw commodities, undeclared spices, infant/medical) against an authoritative precedent. |
| EV-KE-004 | ATNi/TGI Kenya Market Assessment 2025 | Independent market assessment | Category-level KNPM ineligibility rates (up to 100% in Savoury Snacks, Sweet Biscuits, Ice Cream) -> prioritises Phase-1 fallback-DB coverage by category. |
| EV-KE-005 | Kenya STEPS Survey 2015 (KNBS/MoH/WHO) | National epidemiological survey | Kenyan-population NCD/dietary risk-factor baseline independent of the EPIC cohort; grounds health-condition modules in local data. |
| EV-KE-006 | National Guidelines for Healthy Diets and Physical Activity, MoH 2017 | National policy guideline | Kenya's 25x25 NCD targets and consumer salt/sugar behaviour baseline -> prioritises sodium/sugar visibility at checkout. |
| EV-KE-007 | Kenya National NCD Strategic Plan 2021/22-2025/26 | National policy | Positions NUT-04 within Kenya's multisectoral NCD monitoring framework. |
| EV-KE-008 | Nyeri Diabetes MVC Study, JKUAT / Open Journal of Epidemiology 2024 | Peer-reviewed regional study | County-level burden variance (Nyeri diabetes prevalence ~3x national rate) -> grounds future county-weighting as a documented Could/Won't-this-phase item. |
| EV-KE-009 | Food-EPI Kenya Benchmarking Study 2020 (PMC) | Policy benchmarking | Corroborates the market/policy gap NUT-04 addresses from an independent benchmarking angle. |
| EV-KE-010 | NUT-04 internal database audit, July 2026 (7,821 products) | Internal data audit | Identified missing-profile, implausible-value and confirmed-mislabelled-template records; grounds DATA-005/DATA-006 and the Phase-1 "essential data only" checkout database. |
| EV-KE-011 | Database Modification Recommendation (external review), July 2026 | External data architecture review | Grounds Section 10.5’s layered architecture, confidence hierarchy, provenance fields, completeness thresholds, and plausibility validation rules; implemented across the KFCT2018/Naivas/Carrefour datasets. |

*-- End of Document -- NUT-04 NutriScore Checkout Tool Requirements Specification v2.2 -- Evidence-Linked Edition (Data Governance Update) -- JHUB Africa AfyaVentures 2026 --*