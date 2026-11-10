# ADR 0006 — Gateway Choice (Caddy)

**Status:** Accepted  
**Date:** 2026-11-10  
**Authors:** NUT-04 Engineering

---

## Context

The replacement architecture (§4.7.2) needs a gateway that serves as the single
published port for `/auth`, `/rest`, `/api` and the CAD. The prompt offers
"Envoy if the blueprint says so, otherwise Caddy." The architecture blueprint
(`Docs/Architecture/Local Development Portability & Production Alignment.md`)
does not specify Envoy. Caddy is simpler for the team's operational profile.

---

## Decision

Use **Caddy 2** as the gateway.

**Routing:**
- `/auth/*` → Keycloak (port 8080)
- `/rest/*` → PostgREST (port 3000)
- `/api/*` → `services/api` (port 4000)
- `/` → CAD (port 8080 on `cad` container)

**TLS:** Self-signed in dev (`tls internal`); external TLS termination in production.

**CORS:** `header Access-Control-Allow-Origin` restricted to allow-list from config.

**CSP on CAD:** `default-src 'self'`, `connect-src 'self' {api_origin} {oidc_origin}`,
`img-src 'self' data:`, `frame-ancestors 'none'`.

**Health:** `GET /healthz` returns 200 from Caddy itself.

---

## Consequences

**Positive:**
- Single binary; automatic HTTPS in production with ACME
- Caddyfile is human-readable and easy to review
- No Lua/WASM modules needed for this routing

**Negative / risks:**
- Caddy's `tls internal` uses its own CA; developers must trust it once
- If Envoy is chosen later for traffic management features, migrate the Caddyfile
  rules to Envoy's route config — the internal routing is the same

