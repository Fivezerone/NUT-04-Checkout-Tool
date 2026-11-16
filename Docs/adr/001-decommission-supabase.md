# ADR-001: Decommission Supabase in Favor of Self-Hosted Docker Stack

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Security Team
- **Supersedes:** Legacy Supabase Cloud Architecture (Project `nqcpudpkrkutpxuqpsfk`)

---

## Context
The NUT-04 Checkout Tool was originally scaffolded using hosted Supabase (hosted PostgreSQL, GoTrue authentication, PostgREST, Deno Edge Functions, and Supabase Storage). While functional for early exploratory prototyping, this architecture introduced severe operational, legal, and architectural blockers:

1. **Vendor Lock-In & Extensibility:** Deep coupling to proprietary `@supabase/*` client SDKs and proprietary GoTrue auth mechanisms limited architectural portability and multi-tenant isolation.
2. **Data Residency & Statutory Compliance:** Under the Kenya Data Protection Act, 2019 (DPA s.46-50) and Health Information Management Regulations, sensitive healthcare and clinical dietary prescription data must reside in sovereign Kenyan data centers or under strictly audited self-hosted infrastructure. Hosted multitenant cloud databases without local region guarantees violated statutory compliance.
3. **Environment Drift:** Developers ran local Supabase CLI containers on dynamic ports (`54321`–`54327`) alongside host-installed tooling, leading to irreproducible local development environments and fragile CI pipelines.
4. **Mandatory Architecture Directive:** Binding Decision 7 strictly mandates: *"No `@supabase/*` package, no `supabase/` directory, no Supabase service, URL, or variable anywhere in the codebase."*

---

## Decision
We decommission all Supabase components completely and replace every capability with self-hosted, open-source containerized microservices managed via Docker Compose (`compose.yaml`):

| Supabase Capability | Self-Hosted Open-Source Replacement | Architectural Implementation |
|---|---|---|
| **Database** | `postgres:16-bookworm` container | Hardened PostgreSQL 16 with `pgcrypto`, `pg_stat_statements`, isolated schemas (`iam`, `clinical`, `exchange`, `commercial`, `audit`, `app_private`), strict RLS policies, and plain SQL migrations. |
| **Authentication** | `quay.io/keycloak/keycloak:26.2.5` | Keycloak Quarkus container mounted on relative path `/auth`, realm `nutriscore`, OIDC Authorization Code Flow with PKCE, mandatory TOTP MFA for staff roles. |
| **REST API** | `postgrest/postgrest:v12.2.3` | Direct PostgreSQL REST exposure adhering to PostgreSQL Row Level Security (RLS) driven by JWT claims (`app_role`, `tenant_id`, `sub`). |
| **Edge Functions** | `services/api` (Node.js 22 LTS) | Microservice container running Fastify/Node HTTP server on port 4000 for server-side logic and token minting. |
| **Ingress Gateway** | `caddy:2.9.1-alpine` | Caddy reverse proxy serving as the single unified ingress (`:8080` HTTP, `:8443` internal TLS), routing `/auth/*`, `/api/*`, `/cad/*`, and `/healthz`. |
| **Database Migrations** | `ghcr.io/amacneil/dbmate:2.24.0` | One-shot migration runner executing plain SQL in `db/migrations/`. |
| **Dev Email / OTP** | `axllent/mailpit:v1.22.3` | Dedicated mail sink for local testing of Keycloak OTPs and alerts. |

---

## Consequences & Rules

### Positive Consequences
- **Complete Sovereign Ownership:** Complete control over data persistence, database schemas, cryptographic triggers, and authentication flows.
- **Strict Data Residency:** Infrastructure can be deployed on sovereign Kenyan cloud providers (e.g., iColo NBO1 / Africa Data Centres via Servercore / Angani).
- **Zero Third-Party Secrets:** No API keys or service role tokens are transmitted to third-party SaaS infrastructure.
- **Deterministic Toolchain:** Full development stack starts identically across all host operating systems with `.\bin\nut.ps1 up` or `./bin/nut up`.

### Trade-offs & Operational Risks
- **Operational Overhead:** Requires local management of container health checks, Keycloak realm exports (`infra/keycloak-realm.json`), and PostgreSQL volume persistence.
- **Realm Synchronization:** Changes to Keycloak configuration must be explicitly exported to `infra/keycloak-realm.json` without user data.

### Strict Enforcement Rules
1. **Zero `@supabase/*` Imports:** No package in `package.json`, `services/api/package.json`, or extension scripts may import or depend on Supabase libraries.
2. **Zero Supabase Environment Variables:** No `.env` or configuration file may contain `VITE_SUPABASE_*` or `SUPABASE_*` credentials.
3. **No Direct Host Databases:** PostgreSQL must run inside the containerized environment; no host-level PostgreSQL instances may be used.

