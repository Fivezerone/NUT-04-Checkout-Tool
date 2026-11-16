# ADR-008: Multi-Tenant CAD Architecture & Deprecation of Consumer Self-Registration

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Product Leadership
- **References:** ADR-001, ADR-003, `Docs/CAD_ROLLBACK_INVENTORY.md`

---

## Context
In early releases (v1.0–v1.1), NUT-04 operated under a Direct-to-Consumer (B2C) model:
1. **Self-Registration Wizard:** Any browser user could self-register via Google OAuth or email, select arbitrary chronic conditions from a consumer UI dropdown (e.g., "Hypertension", "Type 2 Diabetes"), and self-diagnose nutritional restrictions.
2. **Consumer Pricing & In-App Upgrades:** An in-app 4-step wizard prompted users to purchase a "Premium" subscription tier (189 KES / 30 days) via M-Pesa STK push or Paystack cards (`is_premium: boolean` flag in `public.users`).
3. **Clinical Inefficacy & Legal Risk:** Allowing untrained shoppers to self-select clinical dietary thresholds created severe health risks (e.g., overly strict or inaccurate sodium/potassium restrictions for renal or cardiovascular patients) and raised regulatory exposure as an uncertified medical diagnostic device.
4. **Strategic Shift to Enterprise Healthcare:** Strategic partnership agreements pivoted NUT-04 to a clinical enterprise model: the tool is prescribed by licensed clinical nutritionists and medical doctors at partner healthcare facilities (clinics, hospitals) to enrolled patients.

---

## Decision
We completely deprecate the B2C consumer self-registration and payment model, replacing it with the **Clinic Admin Dashboard (CAD) Multi-Tenant Healthcare Architecture**:

1. **CAD-Only Identity Provisioning:**
   - Consumer self-signup, Google OAuth buttons, and onboarding registration steppers are completely excised from the extension.
   - All users (patients, dieticians, clinicians, tenant administrators) are provisioned exclusively through the CAD by authorized healthcare administrators.
   - Enrolled patients authenticate using clinic-issued credentials via Keycloak OIDC (ADR-003).
2. **Multi-Tenant Role Hierarchy:**
   - `super_admin`: Platform governance, tenant lifecycle, global metrics.
   - `tenant_admin`: Clinic management, clinician staffing, patient rosters within a single tenant.
   - `clinician` / `dietician`: Clinical workspace, assigning prescriptive health modes, approving target bundles.
   - `patient`: Authenticated shopper linked to a prescribing healthcare facility.
   - `commercial_stakeholder` / `platform_auditor`: Read-only aggregated analytics subject to k-anonymity gates ($k \ge 5$).
3. **Deprecation of Consumer Billing:**
   - Individual consumer subscription columns (`is_premium`, `subscription_status`, `premium_expires_at`) are frozen and deprecated.
   - Billing transitions entirely to B2B clinic licensing (`clinic_monthly`, `clinic_annual`) managed in the CAD.
4. **Relational Health Modes & Target Bundles:**
   - Self-selected condition strings are replaced by relational `clinical.health_modes`, `clinical.health_mode_rules`, and cryptographically signed target bundles prescribed by clinicians.

---

## Consequences & Rules

### Positive Consequences
- **Clinical Governance:** Every dietary rule and nutritional boundary enforced by the shopper extension is linked directly to a licensed healthcare practitioner.
- **Strict Multi-Tenancy:** Patient health data is isolated by `tenant_id` at the database level with PostgreSQL Row Level Security (RLS).
- **Clean Extension UX:** No upsell banners, paywalls, or "Upgrade to Premium" buttons appear in the browser extension.

### Trade-offs & Operational Risks
- **Clinic Onboarding Required:** Shoppers cannot use personalized prescription features without an active enrollment from a participating healthcare clinic. (A generic healthy eating mode is provided for unregistered shoppers).

### Strict Enforcement Rules
1. **Zero B2C Registration Paths:** The extension must never contain self-registration forms, OAuth signup buttons, or consumer payment gateways.
2. **Tenant Isolation Invariant:** Every query in the CAD data layer must enforce tenant boundaries; cross-tenant data leakage is a critical blocker.
3. **No Direct `is_premium` Reads:** Code must not evaluate `is_premium` for feature access; access is governed solely by active clinic enrollment and signed target bundles.

