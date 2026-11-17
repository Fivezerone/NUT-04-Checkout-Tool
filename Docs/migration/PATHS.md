# PATHS.md — Repository Path Mapping

Mapping of architecture and blueprint locations to ground-truth paths in this repository.

| Architectural Component | Blueprint Reference | Repository Ground Truth Path | Notes |
| :--- | :--- | :--- | :--- |
| **Extension Engine & Core** | `src/extension/` | `src/extension/` | Service worker (`background.js`), Content script (`content.js`), Scanner (`scanner.js`), Config (`config.js`), Entitlement verifier (`entitlement.js`), Catalog sync (`catalog-sync.js`) |
| **Extension Database Runtime** | `db.js` | `src/extension/db.js` | **Generated file**. Derived from TypeScript sources in `src/ui/src/app/lib/db/*.ts` via `scripts/build-db.mjs`. Never hand-edit `db.js`. |
| **Retailer Adapters** | `src/extension/adapters/` | `src/extension/adapters/` | Carrefour (`carrefour.js`), Naivas (`naivas.js`), Quickmart (`quickmart.js`), Shared UI & Portal (`shared-ui.js`), Grade colors (`grade-colors.js`) |
| **Offline Fallback Catalogs** | `src/extension/data/` | `src/extension/data/` | `carrefour_products.json` (6,698 SKUs), `naivas_products.json` (3,820 SKUs), `quickmart_products.json` (3,669 SKUs) |
| **Pillar 1 Core Scoring Engines** | `engine/`, `pipeline/` | `src/extension/engine/`, `src/extension/pipeline/` | `context-engine.js` (legacy FSA badness scoring), `pipeline/disease-engine.js` (condition & dynamic rule evaluation) |
| **Shopper Surfaces (Extension)** | `src/ui/` | `src/ui/src/app/`, `src/ui/src/popup.tsx`, `src/ui/src/dashboard.tsx`, `src/ui/src/options/`, `src/ui/src/sidepanel.tsx` | HTML shells: `popup.html`, `dashboard.html`, `options.html`, `sidepanel.html` |
| **Clinic Admin Dashboard (CAD)** | `src/ui/src/cad/` | `src/ui/src/cad/` | Entry point `src/ui/cad.html`, App `CadApp.tsx`, Views (`views/*.tsx`), Auth context (`context/AuthContext.tsx`), Sidebar navigation |
| **Shared Contracts & Primitives** | `shared/` | `src/shared/` | `claims.ts`, `authz.ts`, `dpt.ts`, `dpop.ts`, `canonical.mjs`, `target-sync.ts`, `commercial-catalogue.ts`, `consent.ts`, `field-encryption.ts`, `signer.ts`, `pack-client.ts`, `storage.js` |
| **Database Migrations & Seeds** | `db/migrations/`, `db/seeds/` | `db/migrations/`, `db/seeds/` | Managed via `dbmate` inside container (`docker compose --profile dev run --rm migrate up`) |
| **Backend REST & API Services** | `services/api/` | `services/api/` | PostgREST 12.2.3 interfacing PostgreSQL 16; legacy endpoints |
| **BFF & Gateway** | `bff/`, `infra/caddy/` | `infra/caddy/` (Caddyfile), `bff/` (WP-14 target) | Caddy reverse proxy on port 8080/8443; BFF service scaffolded in WP-14 |
| **Identity & Access Management** | Keycloak realm | `infra/keycloak-realm.json` | Keycloak 26.2.5 OIDC realm `nutriscore` |
| **Build & Toolchain Scripts** | `scripts/` | `scripts/` | `build-db.mjs`, `build-tokens.mjs`, `build-ext.mjs`, `build-cad-dist.mjs`, `check-no-fixtures-in-dist.mjs`, `check-no-secrets-tracked.mjs`, `check-no-hardcoded-data.mjs`, `check-manifest-globals.mjs`, `check-cad-security.mjs`, `verify-audit-chain.mjs`, `check-dist.mjs` (WP-00) |
| **Container & CI Config** | Docker / Compose | `docker/toolchain.Dockerfile`, `compose.yaml`, `bin/nut.ps1`, `bin/nut` | Single-file compose profile matrix (`dev`, `ci`, `e2e`) |
| **Design Tokens** | `tokens/` | `tokens/`, `src/ui/src/styles/` | Three-tier token definitions (`primitive`, `semantic.light`, `semantic.dark`, `surface.shopper`, `surface.clinical`, `component`) compiled via `scripts/build-tokens.mjs` |
| **Documentation & Runbooks** | `docs/` | `Docs/Architecture/`, `Docs/adr/`, `Docs/operations/`, `docs/migration/` | Source of truth blueprint at `Docs/Architecture/NUT04_Architectural_Audit_Blueprint.md` |
