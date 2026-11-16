# ADR-006: Ingress API Gateway Architecture (Caddy 2)

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Infrastructure Team

---

## Context
With the decommission of Supabase (ADR-001) and adoption of Docker microservices (Postgres, Keycloak, PostgREST, Fastify API, Nginx CAD), the architecture required a unified ingress API gateway:
1. **Single Public Port:** Microservices must not expose raw internal ports (Postgres 5432, PostgREST 3000, Keycloak 8080, Fastify 4000, Nginx 8080) to external networks or the developer host.
2. **Reverse Proxy & Routing:** The gateway must route path-based traffic to internal services cleanly (`/auth/*` to Keycloak, `/api/*` to PostgREST, `/cad/*` to CAD Nginx).
3. **TLS Termination:** Support automatic HTTPS with Let's Encrypt in production and zero-friction internal TLS (`tls internal`) in development.
4. **Content Security Policy (CSP) & CORS:** Enforce strict browser headers to prevent cross-site scripting (XSS) and cross-origin resource abuse.
5. **Simplicity vs. Overhead:** While Envoy and Traefik were considered, they require extensive YAML configuration, external control planes, or dynamic CRDs not aligned with the operational profile.

---

## Decision
We select **Caddy 2** (`caddy:2.9.1-alpine`) as the single ingress API Gateway:

1. **Routing Specification (`infra/caddy/Caddyfile`):**
   - `http://localhost:8080` (HTTP ingress & redirects)
   - `https://localhost:8443` (HTTPS TLS ingress with `tls internal`)
   - `/auth/*` → `keycloak:8080` (Keycloak OIDC provider)
   - `/api/*` → `postgrest:3000` (PostgREST database API, stripped `/api` prefix)
   - `/cad/*` → `cad:8080` (Clinic Admin Dashboard static Nginx server, stripped `/cad` prefix)
   - `/healthz` & `/health` → Gateway self-health check (returns HTTP 200).
2. **Clean URI Normalization:** Redirects `/cad` and `/cad.html` to `/cad/`, and `/admin` to `/auth/admin/`.
3. **Security Headers & CSP:**
   - `X-Frame-Options: DENY`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - CAD CSP: `default-src 'self'; connect-src 'self' http://localhost:8080 https://localhost:8443; img-src 'self' data:; frame-ancestors 'none';`

---

## Consequences & Rules

### Positive Consequences
- **Human-Readable Configuration:** The entire gateway configuration is encapsulated in a concise 44-line `Caddyfile`.
- **Zero-Config TLS:** Automatic certificate issuance in production and internal CA generation in development.
- **Port Isolation:** Only ports 8080 and 8443 are published to the host; all internal microservice networks remain unexposed.

### Trade-offs & Operational Risks
- **Local Dev CA Trust:** In development, Caddy uses an internal self-signed root CA. Developers or testing tools must accept the internal certificate or use HTTP for local testing.

### Strict Enforcement Rules
1. **Never Expose Internal Service Ports:** Services in `compose.yaml` (Postgres, PostgREST, Keycloak, API, CAD) must use `expose:` (container-to-container), never `ports:` (host-published), except through Caddy.
2. **Maintain Strict Subpath Prefix Stripping:** All API routes mapped under `/api/*` must strip prefix before forwarding to PostgREST or internal APIs.

