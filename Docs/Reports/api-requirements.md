# NUT-04 Backend API & Keycloak Requirements

**Target:** Clinic Admin Dashboard (CAD) & Chrome Extension Backend API  
**Status:** Canonical Requirement Document  
**Date Created:** 19 November 2026 (Phase 2 Closure)  

---

## 1. Overview & Architectural Directives

Per Rule 3 (Zero Supabase Dependencies) and Rule of Engagement 5, the frontend components connect to an open-source Docker stack consisting of:
- **Keycloak 26.2.5** (OIDC realm `nutriscore`, Authorization Code Flow with PKCE, AAL2 MFA enforcement).
- **PostgREST 12.2.3** (`/api/rest/v1/*`, Row Level Security checking JWT `app_private.claims()->>'tenant_id'`).
- **CAD BFF / API Microservice** (`/api/v1/*`, server-side cryptographic operations, key-wrapper, telemetry ingestion).

Client-side simulation of cryptographic operations (e.g. `Math.random()` tokens, local crypto-shredding, browser-generated passwords) is prohibited. When endpoints are unreachable, frontend clients fail closed and display an honest "Not connected" state.

---

## 2. API Endpoints Required by CAD Frontend

### 2.1 Audit & Verification (`cadApi.getAuditLogs`, `cadApi.verifyAuditChain`)
- `GET /api/rest/v1/audit_log?tenant_id=eq.{tenantId}&order=seq.desc&limit={limit}`
  - **Purpose:** Retrieve immutable audit ledger rows for the active tenant.
  - **Auth:** `Authorization: Bearer <token>`
  - **RLS:** Enforced by PostgREST against `app_private.claims()->>'tenant_id'`.
  - **Response:** Array of `AuditLogEntry` objects with `seq`, `occurred_at`, `record_type`, `record_id`, `actor_id`, `actor_role`, `action`, `prev_hash`, `row_hash`, `reason`.
- `GET /api/v1/audit/verify`
  - **Purpose:** Server-side audit tree and root hash verification.
  - **Response:** `{ status: "verified" | "failed", checked: number, roots_verified: number }`

### 2.2 Patient Linking (`cadApi.generateLinkCode`)
- `POST /api/v1/patient-links/generate`
  - **Purpose:** Cryptographically generate a secure, short-lived 6-digit or alpha-numeric patient linking code on the server.
  - **Auth:** Writing clinician role required (`patients.targets.write`).
  - **Payload:** `{ patientRef?: string }`
  - **Response:** `{ success: boolean, code: string, expires_at: string }`

### 2.3 Cryptographic Shredding (`cadApi.cryptoShredPatient`)
- `POST /api/v1/patients/crypto-shred`
  - **Purpose:** Execute GDPR Article 17 / Kenya DPA s.40 Right to Erasure via cryptographic shredding (destroying patient encryption keys in KMS/database while maintaining WORM hash chain integrity).
  - **Auth:** Super admin or tenant admin role required (`platform.tenants.write`).
  - **Payload:** `{ patientRef: string, reason: string }`
  - **Response:** `{ success: boolean, shred_token: string }`
  - **Audit:** Appends an immutable audit event with actor ID, timestamp, and target pseudonym token.

### 2.4 Staff Provisioning (`cadApi.inviteStaff`)
- `POST /api/v1/staff/invite`
  - **Purpose:** Invite and provision tenant staff members into Keycloak realm with assigned RBAC roles and licence attributes.
  - **Auth:** Super admin or tenant admin role required.
  - **Payload:** `{ email: string, role: CadRole, tenantId: string, licenceNumber?: string }`
  - **Response:** `{ success: boolean, invite_id: string }`
  - **Behavior:** Triggers Keycloak email with credential setup / password reset link; zero plain-text passwords transmitted or generated in browser.

### 2.5 Multi-Factor Authentication Verification (`AuthContext.verifyMfa`)
- `POST /api/v1/auth/mfa/verify`
  - **Purpose:** Server-side step-up authentication verifying Keycloak TOTP or WebAuthn code.
  - **Auth:** Valid Level 1 Bearer token.
  - **Payload:** `{ code: string }`
  - **Response:** `{ verified: boolean, access_token?: string }`
  - **Behavior:** When verified, issues upgraded JWT with `acr: "aal2"` and `amr: ["otp"]`.

---

## 3. Keycloak Realm Configuration Requirements

Documented in `infra/keycloak-realm.json`:
1. **Clients:**
   - `cad-web-ui`: Public client, Standard Flow with PKCE (S256), Redirect URI `/cad/*`.
   - `nutriscore-extension`: Chrome extension OIDC client, PKCE enabled.
2. **Client Scopes & Token Mappers:**
   - `tenant_id`: User attribute mapped to top-level JWT claim.
   - `app_role`: User role mapped to top-level JWT claim.
   - `lic_ok`: Boolean licence verification flag mapped to top-level JWT claim.
   - `acr`: Level of assurance (`aal1` for single-factor, `aal2` for multi-factor).
3. **MFA Execution Policy:**
   - Mandatory OTP or WebAuthn for all non-patient roles (`super_admin`, `tenant_admin`, `writing_clinician`, `viewing_dietician`, `compliance_auditor`, `commercial_stakeholder`).
