**JHUB AFRICA | AFYAVENTURES -- NUT-04 SUPPORTING ARTEFACT**

**NUT-04 User Personas: Evidence-Grounded Profiles**

*Full profiles for Personas 1 and 4 (newly constructed); Personas 2 and 3 rebuilt from proxy assumptions onto Kenya-specific secondary evidence*

|  |  |
| --- | --- |
| **Project** | NutriScore Checkout Tool (NUT-04), JHUB Africa AfyaVentures 2026 |
| **Author** | Kibet -- B.Sc. Electronic & Computer Engineering, JKUAT, Year 3 |
| **Date** | July 2026 |
| **Supersedes** | EV-005 "Persona research (proxy)", June 2026 -- Personas 2 and 3 only |
| **Companion to** | NutriScore\_Requirements\_v2\_Evidence\_Linked.docx v2.1, Section 6 (Stakeholder Analysis) |
| **Also references** | NUT-04 Database Audit and Compliance Report; ATNi/EAMA Kenya Market Assessment Benchmark Report; Nyeri County Diabetes Evidence Brief |

**1. Methodology and Evidence Basis**

The original NUT-04 requirements specification (v2.0) referenced four personas but only documented two by name -- Persona 2 ("John M.") and Persona 3 ("Grace N.") -- and its own evidence log labelled that work "Persona research (proxy), June 2026": constructed profiles, not primary interviews or surveys with real Kenyan shoppers. Personas 1 and 4 were referenced only in passing and never profiled.

This document does two things. First, it writes full profiles for Persona 1 and Persona 4, filling a documented gap. Second, it rebuilds Personas 2 and 3 on the Kenya-specific secondary evidence gathered since June 2026 -- the Kenya STEPS Survey 2015, the National Guidelines for Healthy Diets and Physical Activity 2017, the Nyeri County Diabetes MVC Study 2024, and the ATNi/EAMA Kenya Market Assessment 2025 -- in place of the earlier unsupported assumptions.

|  |
| --- |
| **⚠ What this document is NOT:** This is still desk research, not primary user research. No interviews, surveys, or usability sessions with actual Kenyan diabetic, hypertensive, or general shoppers have been conducted. These profiles are built by combining published national/county epidemiological and market data with reasonable shopping-behaviour inference -- an improvement on the earlier proxy assumptions, but not a substitute for the UAT recruitment already planned in the requirements specification (Section 13: "AfyaVentures supervisor + 2 persona-representative users + 1 accessibility tester"). That UAT step remains the point at which these profiles should be tested and corrected against real shoppers. |

**2. Persona Coverage Map**

|  |  |  |  |
| --- | --- | --- | --- |
| **Persona** | **Status** | **NCD-risk segment represented** | **Approx. population anchor (Kenya)** |
| Persona 1 -- Peter K. | New (previously unprofiled) | General / undiagnosed majority shopper | Baseline adult population; only 6.0% meet min. fruit/veg intake (STEPS 2015) |
| Persona 2 -- John M. | Rebuilt (was proxy-only) | Diagnosed Type 2 diabetes | 3.1% national prevalence (STEPS 2015); ~4.2M modelled estimate (IDF 2021); 6.4% in Nyeri County (2024) |
| Persona 3 -- Grace N. | Rebuilt (was proxy-only) | Diagnosed hypertension | 23.8% raised BP nationally (STEPS 2015); ~30% of urban adults (MoH estimate) |
| Persona 4 -- Njeri W. | New (previously unprofiled) | Undiagnosed, overweight, family history of NCD (primary prevention) | 27.9% combined overweight/obesity nationally; 49.5% among women (STEPS 2015) |

Personas 2 and 3 represent secondary prevention -- people already diagnosed, managing a known condition. Persona 1 and Persona 4 represent primary prevention -- the much larger undiagnosed population NUT-04’s general A-E grade is scientifically validated for independent of diagnosis (EV-SCI-003). Between them, the four personas span the population segments the requirements specification’s problem statement already claims to serve.

**3. Persona 1 -- Peter K., 41 (New Profile)**

*The mainstream, undiagnosed majority shopper. Represents the retailer-adoption constraint already referenced in the requirements specification ("Persona 1 -- non-intrusive").*

**Snapshot**

|  |  |
| --- | --- |
| **Attribute** | **Detail** |
| Age / role | 41, mid-level accountant, Nairobi |
| Household | Married, two children, dual-income household |
| Health status | No diagnosed NCD; has not had a check-up in over a year |
| Shopping channel | Naivas.co.ke, weekly household shop, mobile app, often during a lunch break |
| Digital literacy | High -- comfortable with apps, low patience for anything that slows checkout down |

**Health and market context (evidence-grounded)**

* Represents Kenya’s undiagnosed majority: nationally, only 6.0% of adults meet the minimum fruit-and-vegetable intake, and combined overweight/obesity is 27.9% (Kenya STEPS Survey 2015) -- most people in Peter’s position are at some elevated risk without knowing it.
* The Food-EPI Kenya Benchmarking Study (2020) found most food-environment policy indicators, including front-of-pack labelling, still "in development" at the time of review -- meaning shoppers like Peter currently get zero point-of-purchase nutrition signal on Kenyan retail sites.
* IARC/EPIC evidence (EV-SCI-003, already in the requirements specification) establishes that the FSAm-NPS algorithm rates nutritional quality validly across a whole population, independent of pre-existing condition or country -- so a badge is scientifically meaningful for Peter even though he has no diagnosis.

**Shopping behaviour and pain points**

* Price- and convenience-driven; does not read nutrition panels today and would not start doing so voluntarily.
* Will disengage from or disable any tool that adds friction, pop-ups, or delay to checkout -- this is the same constraint retailer stakeholders (Carrefour Kenya / Naivas digital teams) raised about zero page disruption.
* Wants a "glance and decide" signal, not an explanation -- if the tool requires reading to be useful to him, he will not use it.

**Goals**

* Make marginally better choices without extra time cost or cognitive effort.
* Not be lectured, warned, or made to feel guilty about routine grocery choices.

**How NUT-04 serves Persona 1**

|  |  |
| --- | --- |
| **Requirement** | **Why it matters to Peter** |
| FR-004 (badge render < 2 seconds) | A slow badge is worse than no badge -- he will simply stop noticing it. |
| NFR-002 (Cumulative Layout Shift = 0) | A badge that shifts the page while he is tapping "Add to Cart" will be perceived as broken, risking retailer rejection of the extension entirely. |
| FR-003 (general A-E grade, no disease module triggered) | He has no diagnosed condition, so the diabetes/hypertension warning modules (FR-009/010) should stay silent for him -- the plain grade is his only touchpoint. |
| Non-intrusive design (no default pop-ups) | Detail is available on click, but nothing interrupts his default checkout flow. |

**Supporting evidence**

|  |  |  |
| --- | --- | --- |
| **Code** | **Source** | **Contribution** |
| EV-SCI-003 | IARC Evidence Summary Brief No.2 (2021) | FSAm-NPS validity across whole population regardless of condition -- grounds relevance to an undiagnosed shopper. |
| EV-KE-005 | Kenya STEPS Survey 2015 | Population-level dietary/obesity baseline used to characterise Peter’s risk profile. |
| EV-KE-009 | Food-EPI Kenya Benchmarking Study (2020) | Confirms the current absence of point-of-purchase nutrition signals on Kenyan retail platforms. |
| EV-004 | Chrome Web Store competitive analysis, June 2026 | No existing Kenyan grocery Nutri-Score extension -- validates the market gap Peter currently experiences. |

**4. Persona 2 -- John M., 58 (Rebuilt)**

*Diagnosed Type 2 diabetes. Previously named in the specification with a single line ("cannot interpret jargon; plain language essential"); rebuilt here with the supporting national and county evidence.*

**Snapshot**

|  |  |
| --- | --- |
| **Attribute** | **Detail** |
| Age / role | 58, retired secondary-school teacher, now part-time education consultant |
| Health status | Type 2 diabetes, diagnosed 6 years ago; managed with metformin and diet |
| Shopping channel | Carrefour Kenya app, twice-weekly shop |
| Digital literacy | Moderate -- comfortable with apps but easily lost by technical or English-jargon nutrition terms |

**Health context (evidence-grounded)**

* National diabetes prevalence is 3.1% by direct survey measurement (Kenya STEPS Survey 2015); the commonly cited ~4.2 million figure is a separate modelled estimate (IDF Diabetes Atlas, 2021). Both are legitimate but methodologically different -- the specification should continue to cite both rather than treat them as interchangeable.
* County-level burden varies sharply: at Nyeri County Referral Hospital, diagnosed diabetes prevalence is 6.4% -- almost triple the national STEPS rate -- and NCDs account for over 50% of hospital admissions and over 55% of deaths there (Nyeri Diabetes MVC Study, 2024). John is not placed in Nyeri specifically, but this illustrates that his risk, and the tool’s potential impact, is not evenly distributed across Kenya -- a future county-aware feature (already scoped as Could/Won’t-this-phase) would matter most for shoppers in high-burden counties like Nyeri.
* Among diagnosed diabetics in the Nyeri cohort, 36.6% had a microvascular complication (27.4% neuropathy, 10.8% retinopathy); regular physical exercise (2-3x/week) was associated with 87% lower odds of retinopathy compared to daily exercisers in that sample. Diabetic retinopathy is directly relevant to John’s interface needs: a shopper managing diabetes is a plausible candidate for low-vision or colour-vision impairment later in the disease course, reinforcing the colour-independent design requirement (ACC-002) as more than generic best practice for this persona specifically.
* National consumer behaviour data shows 83.5% of Kenyans add sugar when cooking and 28% always add sugar to beverages (National Guidelines for Healthy Diets and Physical Activity, 2017) -- John is managing his sugar intake in a food environment where added sugar is the norm, not the exception.
* Kenyan on-pack labelling does not reliably declare added sugar (added sugar is not a mandatory label field), confirmed independently by the ATNi/EAMA Kenya Market Assessment 2025 methodology -- meaning even a motivated, label-reading diabetic like John cannot currently get this information from the package itself. This is the specific gap NUT-04 closes for him.
* Under KNPM, the categories John shops most -- Confectionery (89% ineligible), Breakfast Cereals (80% ineligible), Carbonates (89% ineligible) -- are overwhelmingly non-compliant (ATNi/EAMA Kenya Market Assessment 2025). Most of what is on the shelf in his relevant categories would trigger a warning.

**Shopping behaviour and pain points**

* Tries to check labels but Kenyan retail listing pages do not show sugar content before purchase.
* Struggles with technical nutrition terminology ("dietary fibre," "FSAm-NPS") and gives up interpreting it rather than researching further.
* Worried about a repeat hospital admission or developing a complication (retinopathy, neuropathy, nephropathy) that would affect his independence.

**Goals**

* Avoid diabetes-related complications and further hospital admissions.
* Understand, at a glance and in plain language, whether a product is safe for his sugar intake.
* Maintain independence in daily life and shopping.

**How NUT-04 serves Persona 2**

|  |  |
| --- | --- |
| **Requirement** | **Why it matters to John** |
| FR-005 (sugar > 22.5g/100g threshold warning) | Surfaces the sugar signal Kenyan retail pages do not currently provide at all. |
| FR-009 (diabetes-specific warning module) | Targets exactly his diagnosed condition rather than a generic grade. |
| AI-003 / Flesch-Kincaid ≤ 8 readability target | Plain language he can act on without needing to research unfamiliar terms. |
| ACC-002 (colour is never the sole indicator) | Protects usability if his vision is affected by diabetic retinopathy, consistent with the Nyeri study’s complication-rate findings. |

**Supporting evidence**

|  |  |  |
| --- | --- | --- |
| **Code** | **Source** | **Contribution** |
| EV-SCI-001 | IARC Evidence Summary Brief No.2 (2021) | Sugar component of FSAm-NPS linked to metabolic and cancer risk. |
| EV-KE-005 | Kenya STEPS Survey 2015 | National diabetes prevalence and dietary sugar-intake baseline. |
| EV-KE-008 | Nyeri Diabetes MVC Study (2024) | County-level diabetes severity, complication rates, and protective effect of exercise. |
| EV-KE-006 | National Guidelines for Healthy Diets and Physical Activity (2017) | National sugar-consumption behaviour baseline. |
| EV-KE-003 / EV-KE-004 | ATNi/EAMA Kenya Market Assessment 2025 | Confirms incomplete Kenyan on-pack sugar declaration and high category-level KNPM ineligibility in John’s most-shopped categories. |

**5. Persona 3 -- Grace N., 47 (Rebuilt)**

*Diagnosed hypertension. Previously named in the specification with a single line ("sodium identification at purchase"); rebuilt here with the supporting national evidence.*

**Snapshot**

|  |  |
| --- | --- |
| **Attribute** | **Detail** |
| Age / role | 47, owns and runs a small hair salon, Nairobi |
| Health status | Diagnosed hypertension 3 years ago; managed with medication and reduced-salt diet |
| Shopping channel | Naivas app, shops around her work schedule, buys in bulk for home and staff lunches |
| Digital literacy | High but time-poor -- needs answers fast, not detail |

**Health context (evidence-grounded)**

* Raised blood pressure affects 23.8% of Kenyan adults nationally (Kenya STEPS Survey 2015), consistent with the ~30% urban-adult estimate already cited in the requirements specification.
* National behaviour data: about 20% of Kenyans add salt before eating, and 18.3% of adults have high dietary salt intake by survey measurement (STEPS 2015 / National Guidelines 2017).
* Kenya’s own national policy sets a 25x25 target of -30% population salt/sodium intake by 2025 (National Guidelines for Healthy Diets and Physical Activity, 2017) -- Grace choosing a lower-sodium product at checkout is a direct, individual enactment of a named national health target, which is a strong framing for presenting NUT-04’s impact to Ministry of Health or KNDI stakeholders.
* Under KNPM, the processed-food categories Grace relies on for convenience cooking are overwhelmingly non-compliant: Sauces, Dips and Condiments 92% ineligible, Dairy 94% ineligible, Carbonates 89% ineligible (ATNi/EAMA Kenya Market Assessment 2025) -- meaning sodium-heavy defaults are the norm in exactly the aisles she shops most for bulk/convenience purchasing.
* Sodium content is not consistently or usefully reported on Kenyan retail listing pages today, confirmed independently by the ATNi/EAMA Kenya Market Assessment 2025 methodology finding that Kenyan on-pack labelling is too incomplete to compute nutrient profile models directly from packaging alone.

**Shopping behaviour and pain points**

* Buys in bulk for both household and salon-staff lunches -- a single bad choice affects many meals, not just her own.
* Time-pressured between clients; will not tolerate a slow or multi-step interaction at checkout.
* Wants to compare two similar products quickly rather than read a full nutrition breakdown.

**Goals**

* Keep blood pressure controlled without giving up convenience or flavour entirely.
* Make bulk-buying decisions that are better for everyone she is cooking for, not just herself.

**How NUT-04 serves Persona 3**

|  |  |
| --- | --- |
| **Requirement** | **Why it matters to Grace** |
| FR-010 (sodium > 600mg/100g, exact mg value displayed) | Gives her the specific number Kenyan retail pages do not show, matching the national -30% sodium reduction target. |
| FR-005 (disease-specific sodium warning) | Targets her diagnosed condition directly rather than a generic score. |
| FR-013 / alternatives engine | Lets her swap to a lower-sodium equivalent fast, without research -- critical given her time pressure. |
| FR-004 (badge render < 2 seconds) | Speed matters even more to Grace than to a browsing-for-leisure shopper -- she is buying at pace between clients. |

**Supporting evidence**

|  |  |  |
| --- | --- | --- |
| **Code** | **Source** | **Contribution** |
| EV-SCI-002 | IARC Evidence Summary Brief No.2 (2021) | Sodium component of FSAm-NPS linked to circulatory disease mortality. |
| EV-KE-005 | Kenya STEPS Survey 2015 | National hypertension prevalence and salt-intake baseline. |
| EV-KE-006 | National Guidelines for Healthy Diets and Physical Activity (2017) | National salt-behaviour baseline and the -30% sodium 25x25 policy target. |
| EV-KE-003 / EV-KE-004 | ATNi/EAMA Kenya Market Assessment 2025 | Confirms incomplete Kenyan sodium labelling and high category-level KNPM ineligibility in Grace’s most-shopped categories. |

**6. Persona 4 -- Njeri W., 34 (New Profile)**

*Undiagnosed, overweight, family history of diabetes -- a primary-prevention persona representing the large at-risk-but-undiagnosed population, distinct from the already-diagnosed Personas 2 and 3.*

**Snapshot**

|  |  |
| --- | --- |
| **Attribute** | **Detail** |
| Age / role | 34, marketing coordinator, Nairobi |
| Household | Married, two young children; mother diagnosed with Type 2 diabetes at 52 |
| Health status | No diagnosed NCD; overweight by BMI; has not been screened recently |
| Shopping channel | Jumia Food and Carrefour Kenya, shops for the whole household including children |
| Digital literacy | High -- an early adopter of shopping and health-tracking apps |

**Health and market context (evidence-grounded)**

* Combined overweight/obesity affects 27.9% of Kenyan adults nationally, and 49.5% of women specifically (Kenya STEPS Survey 2015) -- Njeri represents this large, mostly undiagnosed, predominantly female risk segment that neither Persona 2 nor Persona 3 captures, since both of those personas already carry a diagnosis.
* Family history is a recognised risk amplifier: her mother’s diagnosis places Njeri in a higher-risk category for future Type 2 diabetes, even though she is currently undiagnosed -- this is the primary-prevention population Kenya’s own policy explicitly targets.
* National policy sets a 0% target for further rise in obesity and diabetes prevalence by 2025 (National Guidelines for Healthy Diets and Physical Activity, 2017) -- Njeri is exactly the population this target is aimed at reaching before a diagnosis occurs, not after.
* IARC/EPIC evidence (EV-SCI-003) establishes FSAm-NPS validity across the whole population independent of existing condition or country, which is the scientific basis for Njeri receiving a meaningful grade despite having no diagnosed condition -- distinguishing her use case (primary prevention via the general grade) from Personas 2 and 3’s use case (secondary prevention via disease-specific warnings).
* The Global Nutrition Report’s NACS action-classification (already cited as EV-SCI-009/010 in the requirements specification) frames tools like NUT-04 as an "Impact" intervention against obesity and diet-related NCDs at the population level -- Njeri is the concrete face of that population-level impact claim.

**Shopping behaviour and pain points**

* Shops for the whole household, including two young children -- a purchase decision affects more people than just herself.
* Does not want a tool that feels like diet-policing or induces guilt; wants practical, family-friendly better choices, not restriction.
* Actively worried about repeating her mother’s health trajectory and wants to model good habits for her children before either of them is ever diagnosed with anything.

**Goals**

* Primary prevention -- reduce her own future NCD risk before a diagnosis, not manage one after the fact.
* Find alternatives that are healthier but still affordable and appealing to children.
* Build better household food habits without turning grocery shopping into a stressful exercise.

**How NUT-04 serves Persona 4**

|  |  |
| --- | --- |
| **Requirement** | **Why it matters to Njeri** |
| FR-003 (general A-E grade) | Her primary touchpoint -- the disease-specific modules (FR-009/010) do not fire for her since she has no diagnosis, so the general grade carries the full weight of the tool’s value to her. |
| FR-013 / alternatives engine (multi-factor, not single-nutrient) | She needs "similar but healthier and still kid-friendly," not a single sugar or sodium number. |
| AI-001/002 (alternatives with explanation, not just a swap) | Supports habit-building rather than one-off substitution, matching her stated goal of modelling better habits. |
| Non-punitive tone / no guilt-inducing language | Directly protects against the "diet-policing" reaction she would otherwise have to a warning-heavy tool. |

**Supporting evidence**

|  |  |  |
| --- | --- | --- |
| **Code** | **Source** | **Contribution** |
| EV-SCI-003 | IARC Evidence Summary Brief No.2 (2021) | FSAm-NPS validity for the general population regardless of diagnosis -- grounds relevance to an undiagnosed, at-risk shopper. |
| EV-SCI-009 / EV-SCI-010 | Global Nutrition Report -- NACS (2021) | Frames NUT-04 as a population-level Impact intervention against obesity/NCDs, of which Njeri is the direct example. |
| EV-KE-005 | Kenya STEPS Survey 2015 | National and female-specific overweight/obesity prevalence. |
| EV-KE-006 | National Guidelines for Healthy Diets and Physical Activity (2017) | 0% target rise in obesity/diabetes prevalence -- the policy goal Njeri’s persona operationalises. |

**7. Recommended Next Step**

These four profiles are ready to replace the single-line proxy references currently in Section 6 (Stakeholder Analysis) of the requirements specification. Before they are treated as validated rather than well-informed desk research, the UAT plan already defined in Section 13 -- recruiting 2 persona-representative real users plus 1 accessibility tester -- should be carried out and any material mismatches between these written profiles and real shopper behaviour should be logged and corrected.

*NUT-04 Supporting Artefact -- User Personas. Companion to NutriScore\_Requirements\_v2\_Evidence\_Linked.docx v2.1 and the three NUT-04 companion reports (Database Audit and Compliance; ATNi/EAMA Kenya Market Assessment Benchmark; Nyeri County Diabetes Evidence Brief).*