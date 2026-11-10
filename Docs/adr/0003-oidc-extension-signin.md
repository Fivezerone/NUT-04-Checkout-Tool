# ADR 0003 — OIDC Sign-in for the Extension (chrome.identity)

**Status:** Accepted (pending install-prompt verification)  
**Date:** 2026-11-10  
**Authors:** NUT-04 Engineering

---

## Context

Decision 6 mandates CAD-only identity: "Patients, clinicians and admins are created
and authenticated through the CAD with role-based access." The extension must
authenticate via OIDC against Keycloak.

Chrome extensions can use `chrome.identity.launchWebAuthFlow` to perform the
Authorization Code + PKCE flow in a pop-up window. The `identity` permission
must be declared in the manifest.

---

## Decision

The extension uses `chrome.identity.launchWebAuthFlow` for OIDC sign-in:
- Flow: Authorization Code with PKCE against Keycloak (`/auth/realms/nutriscore/protocol/openid-connect/auth`)
- Redirect URI: `https://<extension-id>.chromiumapp.org/` (Chrome's synthetic scheme)
- Token refresh: via `chrome.identity.launchWebAuthFlow` with `interactive: false`
- Tokens stored in `chrome.storage.session` (session-scoped, not persisted)

**Install-prompt behaviour:**
The `identity` permission does NOT trigger an install-time warning in Chrome (as of
Chrome 120+). It is listed in the "optional permissions" category and is requested
at sign-in time, not installation time. This was verified by reviewing the Chrome
Extensions permission warning documentation at:
https://developer.chrome.com/docs/extensions/mv3/declare_permissions/#warnings

> [!NOTE] If this changes in a future Chrome version, the sign-in flow falls back to
> opening the CAD in a new tab where the user signs in. The extension polls for the
> token via `chrome.runtime.sendMessage`. Record any regression as a stop condition.

---

## Consequences

**Positive:**
- Standard OIDC flow; no custom auth code
- Keycloak handles TOTP enforcement server-side
- Tokens scoped to session — cleared on browser restart
- No Supabase dependency

**Negative / risks:**
- `chrome.identity` requires a registered redirect URI matching the extension ID
- Extension ID changes between dev and production — managed via build arguments
- If `interactive: false` refresh fails, user must re-authenticate (acceptable UX)

**Permission manifest addition:**
```json
"permissions": ["alarms", "storage", "scripting", "identity", "sidePanel"]
```

