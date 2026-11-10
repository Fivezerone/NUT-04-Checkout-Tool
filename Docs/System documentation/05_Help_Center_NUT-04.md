# NUT-04 — Nutri-Score Checkout Tool
## User-Facing Help Center & Knowledge Base

> **Document Owner:** Kibet — Project Lead, NUT-04
> **Status:** In Review — Consolidated against evidence-linked requirements and personas
> **Standard:** Product-Led Growth (PLG) & Technical Communication Manuals
> **Related Docs:** [PRD](./01_PRD_NUT-04.md) · [System Architecture](./02_System_Architecture_NUT-04.md)

---

## Change Log

| Version | Date | Author | Summary of Changes |
|---|---|---|---|
| 0.1 | — | — | Initial skeleton created |
| 1.0 | 2026-08-08 | Claude (doc pass) | Populated with shopper-facing content grounded in the extension's actual behavior |
| 1.1 | 2026-08-10 | Claude (consolidation pass) | Rewrote copy tone to reflect the four evidence-grounded personas (fast/non-intrusive for Peter and Grace, plain-language for John, non-punitive for Njeri); replaced the placeholder medical disclaimer with the verbatim shipped text; tightened Privacy & Data FAQ language against DATA-002/003/004 with explicit caveats where UI behavior wasn't independently verifiable |

---

## 1. Document Control

| Field | Value |
|---|---|
| Version | 1.1 |
| Status | In Review |
| Author(s) | Kibet |
| Content Reviewers | JHUB Africa / AfyaVentures team |

---

## 2. Getting Started — Onboarding Guide

### 2.1 What is NUT-04?
NutriScore is a free browser extension that shows you an at-a-glance A–E nutrition grade — and personal dietary warnings if you want them — right on Naivas and Carrefour Kenya product listings, without slowing down your shopping.

*This works whether or not you have a diagnosed condition: the A–E grade is scientifically validated on its own, and the optional warning modules add a second layer for anyone managing diabetes, high blood pressure, heart health, or kidney health.*

### 2.2 Onboarding Flow

| Step | Title | Content |
|---|---|---|
| 1 | See your score at checkout | Install the extension, then browse any product listing on naivas.online, naivas.co.ke, carrefour.ke, or carrefourkenya.com. A colored badge appears on each recognized product card within about a second — no click required to see the grade itself. |
| 2 | Understand what the grade means | Tap the badge if you want the full nutrient breakdown per 100g or 100ml, plus a data-confidence label. Most shoppers can stop at step 1 — the letter is designed to be the whole answer for a quick decision. |
| 3 | Set up your dietary flags (optional) | If a condition applies to you, open Settings and turn on diabetes, hypertension, cardiovascular, and/or kidney warnings. If none apply, leave them off — the grade badge works fine on its own and nothing about the extension changes if you skip this step. |

### 2.3 Quick-Start Checklist for New Shoppers
- [ ] Install NUT-04 from the Chrome Web Store (or load the beta build if you're a pilot tester)
- [ ] Visit a Naivas or Carrefour Kenya product listing and confirm a badge appears
- [ ] If a health condition applies to you, open Settings and turn on the relevant flag(s) — otherwise, skip this
- [ ] Add an item to your cart and confirm it appears on your Dashboard afterward

---

## 3. Core Feature Guides

### 3.1 Understanding Your Checkout Score

**Overview:** Your NutriScore grade (A through E) is based on the UK Food Standards Agency's Nutrient Profiling Model, updated for 2023, adapted to Kenyan grocery products using local nutrition data. It's valid whether or not you have a diagnosed condition — it's a general nutritional-quality signal, not a diagnostic tool.

**How it's calculated:** We look at the "negatives" in a product — calories, sugar, saturated fat, and salt — and subtract points for the "positives" — fibre, protein, and (for some foods) fruit/vegetable content. A few special food types — drinks, cheeses, fats & oils, and red or processed meats — use slightly adjusted rules.

**Grade Scale Reference**

| Grade | Meaning | Visual Indicator |
|---|---|---|
| A | Best nutritional choice in its category — Excellent | Dark green badge |
| B | Good nutritional choice | Light green badge |
| C | Moderate — fine in moderation | Yellow badge |
| D | Less healthy — a better alternative likely exists | Orange badge |
| E | Least healthy in its category | Red badge |

**Important note shown on every warning panel:** *"This information is based on standard thresholds and is not medical advice. Consult a healthcare provider."* This applies to the grade badge and every disease-specific warning — NUT-04 is a shopping aid, not a substitute for advice from a doctor, nutritionist, or dietician.

### 3.2 Disease-Specific Warnings (Optional)

**Overview:** If you turn on a health condition in Settings, NUT-04 checks each product against a threshold specific to that condition and shows a plain-language warning when it's exceeded — in addition to, not instead of, the general grade.

**Available modules:**
- **Diabetes** — flags products with more than 22.5g of sugar per 100g
- **Hypertension** — flags products with more than 600mg of sodium per 100g, and shows the exact value
- **Heart health (cardiovascular)** — flags products high in saturated fat or moderately-to-highly elevated in sodium
- **Kidney health** — flags products high in sodium (potassium-based flagging is planned but not yet reliably available, since most product listings don't include potassium data yet)

**Tips:**
- These modules are independent — turning one on doesn't affect the others, and none of them change the general A–E grade shown to everyone.
- If a warning shows up, it's describing one nutrient crossing one threshold — not a verdict on the whole product. A product can still be graded B or C overall while triggering a specific warning relevant to your condition.

### 3.3 Making Healthy Substitutions

**Overview:** When you view a lower-graded product, NUT-04 looks for a similar product in the same food category, from the same store, that's graded higher, and suggests it as a swap — particularly useful if you're buying in bulk on a time budget and want a fast, confident substitution rather than a research project.

**Current status:** This feature is live. If a product doesn't show any suggestions, it usually means nothing in its category currently qualifies — either nothing is graded higher, or nothing is priced close enough (see below) — not a bug on your device.

**Good to know:**
- Alternatives are always drawn from the same food category and the same retailer as the product you're viewing, and are always graded A, B, or C — never D or E.
- Price is a factor, not a hard cap: suggestions are prioritized within about 30% of the original product's price (widened to 50% if fewer than three close matches exist), so an alternative can occasionally cost a bit more, not just the same or less.
- Each suggestion explains *why* — the grade comparison and which specific nutrients improved — not just a bare "try this instead."

### 3.4 Tracking Your Shopping Health Over Time

**Overview:** Every item you add to your Naivas or Carrefour Kenya cart is automatically logged — no manual entry needed — to a private, on-device shopping ledger. Nothing ever leaves your browser: there's currently no sign-in and no sync feature of any kind, on this device or across devices.

**Step-by-step Guide**
1. Shop normally — add and remove items as usual.
2. Open the Dashboard (right-click the toolbar icon → Options, or the popup's "Dashboard" link).
3. Choose a timeframe — Today, Week, Month, Year, or All time — to see your grade distribution, top categories, and sodium/sugar/saturated-fat trends.

**A note on tone:** this dashboard is meant to help you notice patterns over time, not to grade you personally or make you feel judged about any one purchase. If it ever feels more like a scorecard than a helpful summary, that's feedback worth sending us.

---

## 4. Frequently Asked Questions (FAQ)

### 4.1 General

<details>
<summary>Which stores does NutriScore work on?</summary>

Naivas Online (naivas.online / naivas.co.ke) and Carrefour Kenya (carrefour.ke / carrefourkenya.com). Support for more Kenyan retailers may be added later.
</details>

<details>
<summary>Is NutriScore free?</summary>

Yes — NutriScore is a free browser extension, built as part of a JHUB Africa / AfyaVentures innovation project.
</details>

<details>
<summary>Do I need a diagnosed health condition to get value from this?</summary>

No. The A–E grade is designed to be useful to everyone, whether or not you have a diagnosed condition — most Kenyan adults with a diet-related risk factor don't yet have a diagnosis, and the general grade is validated independently of one. The condition-specific warnings are an additional, optional layer for anyone managing diabetes, high blood pressure, heart health, or kidney health.
</details>

### 4.2 Scoring & Accuracy

<details>
<summary>Why does a product's score seem incorrect?</summary>

Grades are only as good as the nutrition data behind them. We label each product's data-confidence level so you know how much to trust a given grade — a grade based on that exact product's own verified nutrition panel is more reliable than one estimated from a similar product's category average. We're actively working on making that confidence labelling more consistent across both supported retailers.
</details>

### 4.3 Privacy & Data

<details>
<summary>What shopping data does NUT-04 use?</summary>

By default, everything — your cart contents, the grades you've viewed, and your shopping trends — stays stored locally in your browser's own on-device database. Nothing is ever sent to any server: there's no sign-in and no cross-device sync feature in the extension today. Only the product names on the page you're viewing are ever used to look up a grade, and that lookup happens entirely against data already bundled with the extension — not sent to any outside nutrition database.
</details>

<details>
<summary>Can I delete my data?</summary>

Yes — a "delete all my data" option is available from the Dashboard, clearing your shopping ledger from your device immediately.
</details>

### 4.4 Account & Settings

<details>
<summary>How do I turn dietary warnings on or off?</summary>

Open Settings from the popup or the Dashboard's options page and toggle diabetes, hypertension, cardiovascular, and/or kidney warnings independently. All are off by default until you choose to enable the ones relevant to you — turning one on never enables the others.
</details>

---

## 5. Troubleshooting & Contact Support Escalation Path

### 5.1 Self-Service Troubleshooting

| Issue | Suggested Fix |
|---|---|
| Score not showing at checkout | Make sure you're on a product *listing* page — badges appear on product cards, not every page type. Try refreshing; if the page uses infinite scroll, scroll down slightly to trigger a re-scan. If it still doesn't appear after a few seconds, the product may not yet be in our database. |
| Substitution suggestions not appearing | This feature is live. It usually means nothing in that product's category currently qualifies — either nothing is graded higher, or nothing is priced close enough — rather than a bug. |
| A warning seems to conflict with the general grade | This is expected — a warning flags one specific nutrient crossing one specific threshold for a condition you've turned on; it isn't meant to override the overall A–E grade, which weighs several nutrients together. |
| Widget appears broken/misaligned | This can happen if the retailer recently redesigned part of their site. Please report it via the feedback link so we can update our detection. |

### 5.2 Contact Support Escalation Path

| Tier | Channel | Response Time Target | Escalates To |
|---|---|---|---|
| Tier 1 | This Help Center | Immediate (self-service) | Tier 2 |
| Tier 2 | GitHub Issues — `github.com/Fivezerone/NUTRISCORE` | Best-effort (student-led project) | Tier 3 |
| Tier 3 | Engineering escalation (per [Runbook §5](./04_Engineering_Runbook_NUT-04.md)) | Best-effort | — |

### 5.3 Support Contact Details

| Channel | Details |
|---|---|
| Email | Not yet published — planned alongside the companion website launch |
| In-app Chat | Not available |
| Help Center URL | This document; a hosted version is planned for `nutriscore.co.ke` |
| GitHub Issues | `github.com/Fivezerone/NUTRISCORE/issues` |

---

## 6. Content Maintenance

| Review Cadence | Owner | Last Reviewed |
|---|---|---|
| Quarterly | Kibet (Project Lead) | 2026-08-10 |

---

## Appendix

- **Persona Source:** This document's tone and feature framing are informed by the four evidence-grounded personas in `NUT04_User_Personas_Evidence_Grounded.md` — see the PRD, §3, for full profiles and the caveat that these are desk research pending UAT validation, not confirmed usability findings.
- **Glossary:** See PRD Appendix.
