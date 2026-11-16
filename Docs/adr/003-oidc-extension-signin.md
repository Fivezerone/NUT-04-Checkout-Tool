# ADR-003: OIDC Authentication for Chrome Extension via chrome.identity & PKCE

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Security Team
- **References:** ADR-001, ADR-008

---

## Context
Following the decommissioning of Supabase GoTrue (ADR-001) and the transition to a Clinic Admin Dashboard (CAD) multi-tenant architecture (ADR-008), the Chrome extension required an enterprise-grade authentication mechanism to authenticate shoppers who are enrolled patients of healthcare clinics:

1. **Enterprise Identity Provider:** All identities (patients, dieticians, clinicians, tenant administrators) are managed centrally in Keycloak 26 under realm `nutriscore`.
2. **Standard Protocols:** Custom authentication flows, shared secrets, or embedded API keys are prohibited. The solution must follow the OpenID Connect (OIDC) standard.
3. **Chrome Extension Security:** Chrome extensions cannot securely protect client secrets. The solution must support the OAuth 2.0 Authorization Code Grant with Proof Key for Code Exchange (PKCE).
4. **Install-Prompt Friction:** Requesting invasive browser permissions triggers alarming install warnings in the Chrome Web Store, severely hurting user adoption.

---

## Decision
The Chrome extension implements OIDC Authorization Code Flow with PKCE against Keycloak using `chrome.identity.launchWebAuthFlow`:

1. **Authentication Endpoint:** Keycloak realm authorization endpoint (`http://localhost:8080/auth/realms/nutriscore/protocol/openid-connect/auth`).
2. **Synthetic Redirect URI:** Uses Chrome's isolated redirect scheme: `https://<extension-id>.chromiumapp.org/`.
3. **Session Storage:** Extracted JWT tokens are stored strictly in `chrome.storage.session`. Tokens are memory-backed, isolated to the active browser session, and automatically purged upon browser termination.
4. **Token Refresh:** Silent background refresh using `chrome.identity.launchWebAuthFlow` with `interactive: false`. If silent refresh fails, the user is prompted to re-authenticate.
5. **Install Prompt Safety:** In Google Chrome 120+, declaring `"identity"` in `manifest.json` does **not** trigger an install-time permission warning (classified as an optional permission requested only upon explicit user sign-in action).

---

## Consequences & Rules

### Positive Consequences
- **Standards-Compliant:** Uses industry-standard OIDC with cryptographic PKCE verification.
- **Server-Enforced MFA:** Keycloak automatically enforces TOTP MFA server-side without extension complexity.
- **Zero Disk Persistence of Tokens:** Session-scoped storage guarantees that stolen device disks do not yield long-lived bearer tokens.

### Trade-offs & Operational Risks
- **Extension ID Dependency:** The Keycloak client must whitelist the synthetic redirect URI. During development, if the extension ID changes, Keycloak client settings must be updated.

### Strict Enforcement Rules
1. **Never Persist Tokens to Local Storage:** JWTs must never be written to `chrome.storage.local` or `localStorage`. Only `chrome.storage.session` is permitted.
2. **Never Expose Client Secrets:** The extension client must remain a public OAuth client (`publicClient: true`) using PKCE.

