# ADR 0001 — Decommission Supabase

**Status:** Accepted  
**Date:** 2026-11-10  
**Authors:** NUT-04 Engineering

---

## Context

The NUT-04 Checkout Tool was built on Supabase (hosted Postgres + GoTrue auth +
PostgREST + Edge Functions + Supabase Storage). Binding decision 7 mandates full
decommissioning: "No `@supabase/*` package, no `supabase/` directory, no Supabase
service, URL or variable anywhere."

The hosted Supabase project `nqcpudpkrkutpxuqpsfk` was used for pilot testing.
No real patient data was present (confirmed by project lead 2026-11-10). Both
the anon key and service role key were rotated before this refactor began.

Supabase local dev containers were also running (`supabase_*` on ports 54321–54327)
and must be stopped once the new stack is healthy.

---

## Decision

Fully replace every Supabase capability with self-hosted, open-source equivalents:

| Supabase capability | Replacement | Notes |
|---|---|---|
| Postgres | `postgres:16` container | Extensions `pgcrypto`, `pg_stat_statements`; plain SQL migrations via dbmate |
| Auth (GoTrue) | Keycloak 26, realm `nutriscore` | OIDC / Authorization Code + PKCE; TOTP mandatory for all staff roles |
| PostgREST | `postgrest:v12` container | JWKS fetched from Keycloak; RLS stays in Postgres |
| Edge Functions | `services/api` (Node 22, TypeScript) | One Express route per function |
| Storage | `services/api` volume mount | ES256 signing preserved (R7) |
| Realtime | **Removed** | No code used it |
| Gateway | Caddy | Single published port; self-signed TLS in dev |
| Mail | Mailpit (dev profile only) | Keycloak SMTP configured to Mailpit |
| Migrations | dbmate one-shot container | Plain SQL in `db/migrations/` |

---

## Consequences

**Positive:**
- No vendor lock-in; full control over schema, auth, and data
- Secrets never leave the host environment
- RLS and auth semantics preserved exactly
- Local dev stack is fully reproducible from Docker alone

**Negative / risks:**
- More infrastructure to maintain (Keycloak, Caddy, dbmate)
- Keycloak realm export must be kept current when realm changes
- Realm export committed with **no users** — users are provisioned via CAD admin

**Migration:**
- No production data migration (pilot data was synthetic; confirmed by project lead)
- Identity is re-provisioned through the CAD (decision 6)
- Supabase project to be deleted by the human after key rotation and confirmation

**History:**
- Supabase anon JWT and project ref present in git history (commits on `feat/cad-backend-blueprint`).
  Keys were rotated; history is not rewritten (R8). See `docs/cleanup/FINDINGS.md` F-01.

---

## Checklist

- [x] `@supabase/supabase-js` removed from `package.json`
- [x] `supabase/` directory deleted
- [x] `src/extension/supabase.js` deleted
- [x] `src/ui/src/cad/supabaseClient.ts` deleted
- [x] `src/shared/auth-provider.ts` (SupabaseAuthProvider) deleted / replaced with interface
- [x] All `VITE_SUPABASE_*` variables removed from `.env.example`
- [x] New `.env.example` has `VITE_API_URL`, `VITE_OIDC_ISSUER`, `VITE_OIDC_CLIENT_ID`
- [ ] Supabase project deleted by human (pending — human gate)
- [ ] Old Supabase local containers stopped (`npx supabase stop`)

