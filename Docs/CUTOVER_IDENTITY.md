# Identity cutover: Supabase Auth Stage A → Keycloak Stage B

Stage A uses Supabase Auth with a five-minute token lifetime, the canonical
`app_role` claim hook, and Supabase TOTP for every action requiring step-up.
Every Edge Function retains its own allowlist; a gateway never substitutes for
service authorization.

Stage B is prepared only. No Keycloak realm, bridge, or second identity
provider is deployed from this branch.

## Invariants for the configuration-only cutover

- The checked-in `src/shared/claims.schema.json` is the contract. Both the
  Supabase hook output and the Keycloak mapper configuration must validate
  against it in CI.
- `sub`, `sid`, `tenant_id`, `app_role`, `lic_ok`, optional `auditor_scope`,
  `acr`, and `ver` are the only application access fields. Email, names,
  phones, identifiers, diagnoses, health modes, and patient/clinician lists
  are never token claims.
- The claims adapter is the only code that maps provider names: Supabase
  `session_id` becomes `sid` and `aal` becomes `acr`.
- OIDC uses Authorization Code + PKCE through a first-party callback page and
  `externally_connectable` messaging. The Chrome `identity` permission remains
  absent.

## Stage A compensations

- Each Edge Function validates its own role allowlist and checks the `sid`/
  `sub` denylist; RLS evaluates `app_private.is_active_member()` for every
  query.
- Publishing a bundle, changing a role, and break-glass require Supabase TOTP
  at `aal2` before their Phase 3/4 endpoints act.

## Stage B delivery items (Phase 10)

Keycloak gains per-API audience claims, WebAuthn, lightweight access tokens,
realm/client exports, mapper definitions, and the audit event-listener spec.
Envoy receives the same `sid`/`sub` denylist feed. The client adapter is the
only configuration switch point; neither the extension nor the UI gains
provider-specific authorization logic.

