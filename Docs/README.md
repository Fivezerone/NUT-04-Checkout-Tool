# NUT-04 Checkout Tool — Master Documentation Index

> **Status:** Authoritative Source of Truth  
> **Audience:** All Software Engineers, Technical Leads, and AI Coding Agents  
> **Enforcement File:** [AGENTS.md](../AGENTS.md)

---

## 1. "Read This Before You Code" Routing Table

Before modifying any file or beginning a task, consult the exact Architecture Decision Records (ADRs), Living Blueprints, and Production Runbooks required for that area:

| Task / Codebase Directory | Primary Files to Touch | Mandatory Pre-Reading (ADRs) | Living Blueprints & Runbooks to Follow |
|---|---|---|---|
| **Touching Chrome Extension Core** | `src/extension/background.js`<br/>`src/extension/content.js`<br/>`src/extension/scanner.js` | [ADR-003](adr/003-oidc-extension-signin.md)<br/>[ADR-004](adr/004-side-panel-permission.md) | [System Overview](architecture/system-overview.md)<br/>[Data Flow (Section 1)](architecture/data-flow.md#1-retailer-product-detection--scoring-pipeline) |
| **Updating Retailer Adapters** | `src/extension/adapters/quickmart.js`<br/>`src/extension/adapters/naivas.js`<br/>`src/extension/adapters/carrefour.js` | [ADR-013](adr/013-retailer-adapters-dom-resilience.md) | [Golden Path 3](architecture/golden-paths.md#golden-path-3-adding-or-updating-a-supermarket-retailer-adapter)<br/>[Blast Radius Map (Module 1)](operations/blast-radius-map.md#module-1-retailer-dom-adapters-srcextensionadapters) |
| **Touching Shopper UI or Primitives** | `src/ui/src/app/components/ui/*`<br/>`src/ui/src/app/components/Popup.tsx`<br/>`src/ui/src/styles/tokens.css` | [ADR-011](adr/011-three-tier-design-tokens-ui-separation.md) | [Golden Path 4](architecture/golden-paths.md#golden-path-4-creating-a-ui-component-or-cad-view)<br/>[Anti-Patterns (Rule 2)](architecture/anti-patterns.md#2-hardcoding-patient-identifiers-real-clinician-names-or-hospital-domains-rule-r5--stage-b) |
| **Touching Clinic Admin Dashboard (CAD)** | `src/ui/src/cad/CadApp.tsx`<br/>`src/ui/src/cad/views/*`<br/>`src/ui/src/cad/context/AuthContext.tsx` | [ADR-008](adr/008-multi-tenant-cad-identity.md)<br/>[ADR-011](adr/011-three-tier-design-tokens-ui-separation.md) | [System Overview](architecture/system-overview.md)<br/>[Anti-Patterns (Rule 2 & 6)](architecture/anti-patterns.md) |
| **Modifying Database Schemas or DDL** | `db/migrations/*.sql`<br/>`db/migrations/*.rollback.sql` | [ADR-005](adr/005-retention-policy.md)<br/>[ADR-007](adr/007-migration-tool-dbmate.md)<br/>[ADR-012](adr/012-append-only-worm-audit-chain.md) | [Golden Path 2](architecture/golden-paths.md#golden-path-2-modifying-database-schemas-via-dbmate)<br/>[Pre-Flight Checklist (Section 2)](operations/pre-flight-checklist.md#2-database-migration-safety-rules-dbmate) |
| **Modifying Backend API Service** | `services/api/src/server.mjs`<br/>`services/api/Dockerfile` | [ADR-001](adr/001-decommission-supabase.md)<br/>[ADR-010](adr/010-dietary-profile-token-cryptography.md) | [Golden Path 1](architecture/golden-paths.md#golden-path-1-adding-or-modifying-a-backend-api-endpoint)<br/>[Data Flow (Section 2)](architecture/data-flow.md#2-dietary-profile-token-dpt-lifecycle--fail-closed-enforcement) |
| **Changing Gateway Routes or TLS** | `infra/caddy/Caddyfile` | [ADR-006](adr/006-gateway-caddy.md) | [System Overview (Section 4)](architecture/system-overview.md#4-ingress--security-topology)<br/>[Blast Radius Map (Module 6)](operations/blast-radius-map.md#module-6-ingress-api-gateway-infracaddycaddyfile) |
| **Changing Keycloak OIDC Realm** | `infra/keycloak-realm.json`<br/>`compose.yaml` | [ADR-003](adr/003-oidc-extension-signin.md)<br/>[ADR-008](adr/008-multi-tenant-cad-identity.md) | [System Overview](architecture/system-overview.md)<br/>[Rollback Procedures (Section 6)](operations/rollback-procedures.md#6-keycloak-realm-configuration-rollback) |
| **Updating Cryptographic Contracts** | `src/shared/dpt.ts`<br/>`src/shared/signer.ts`<br/>`src/shared/claims.ts` | [ADR-010](adr/010-dietary-profile-token-cryptography.md)<br/>[ADR-012](adr/012-append-only-worm-audit-chain.md) | [Data Flow (Section 2 & 4)](architecture/data-flow.md)<br/>[Blast Radius Map (Module 3)](operations/blast-radius-map.md#module-3-dietary-profile-token-dpt--cryptography-srcshareddptts-signerts-dpopts) |
| **Building, Testing, or CI Runs** | `bin/nut.ps1`<br/>`docker/toolchain.Dockerfile` | [ADR-002](adr/002-docker-exclusive-build.md) | [Environment Runbook](operations/environment-runbook.md)<br/>[Pre-Flight Checklist](operations/pre-flight-checklist.md) |

---

## 2. Four-Tier Documentation Architecture

This repository organizes all technical documentation into four structured tiers designed to prevent architectural erosion and operational incidents:

```
docs/
├── README.md                          # Master routing map & navigation index (this file)
├── adr/                               # Tier 1: Architecture Decision Records (Numbered 001-014)
│   ├── 001-decommission-supabase.md
│   ├── 002-docker-exclusive-build.md
│   ├── 003-oidc-extension-signin.md
│   ├── 004-side-panel-permission.md
│   ├── 005-retention-policy.md
│   ├── 006-gateway-caddy.md
│   ├── 007-migration-tool-dbmate.md
│   ├── 008-multi-tenant-cad-identity.md
│   ├── 009-elimination-hardcoded-pii-ci-guards.md
│   ├── 010-dietary-profile-token-cryptography.md
│   ├── 011-three-tier-design-tokens-ui-separation.md
│   ├── 012-append-only-worm-audit-chain.md
│   ├── 013-retailer-adapters-dom-resilience.md
│   └── 014-kenyan-health-data-localization.md
├── architecture/                     # Tier 2: Living Architectural Blueprints
│   ├── system-overview.md             # System boundaries, container topology & Mermaid diagrams
│   ├── data-flow.md                   # End-to-end event lifecycles, DPT flow & audit triggers
│   ├── golden-paths.md                # Approved step-by-step developer implementation recipes
│   └── anti-patterns.md               # Explicit catalog of banned patterns & what to use instead
├── operations/                       # Tier 3: Production Guardrails & Runbooks
│   ├── pre-flight-checklist.md        # Mandatory pre-merge automated CI checks & statutory gates
│   ├── blast-radius-map.md            # Component dependency risk matrix & containment paths
│   ├── rollback-procedures.md         # SEV1-3 triage matrices, database & container recovery
│   └── environment-runbook.md         # Local stack startup, port reference, unpacked Chrome setup
└── archive/                          # Tier 4 (Preservation): Historical Ledgers & Noise Archive
    └── README.md                      # Comprehensive manifest of archived legacy documents
```

---

## 3. Tier Summaries & Quick Navigation

### [Tier 1: Architecture Decision Records (`docs/adr/`)](adr/)
Every historical shift, technology selection, and security mandate is recorded using a strict template (`Title`, `Metadata`, `Context`, `Decision`, `Consequences & Rules`):
- **ADR-001:** Decommission Supabase in favor of self-hosted Docker microservices.
- **ADR-002:** Docker-exclusive build, run, test, and host isolation (Rule R4).
- **ADR-003:** OIDC extension authentication via `chrome.identity` with PKCE.
- **ADR-004:** Adoption of Chrome MV3 `side_panel` with zero install warnings.
- **ADR-005:** Dual-tier data retention (90-day device ceiling vs 20-year clinical retention).
- **ADR-006:** Ingress API gateway using Caddy 2 reverse proxy.
- **ADR-007:** Plain SQL database migration engine via dbmate.
- **ADR-008:** Multi-tenant CAD architecture & deprecation of consumer self-signup.
- **ADR-009:** Elimination of hardcoded patient/clinician data & mandatory CI guards.
- **ADR-010:** Dietary Profile Token (DPT) cryptography (Ed25519, DPoP, condition bans).
- **ADR-011:** 3-tier design system token architecture (`--t-color-...`) & surface decoupling.
- **ADR-012:** Append-only cryptographic WORM audit trail with SHA-256 hash chaining.
- **ADR-013:** Multi-engine retailer adapter architecture (Anchor-first DOM discovery).
- **ADR-014:** Data residency, sovereign Kenyan cloud, and split-by-schema architecture.

### [Tier 2: Living Architectural Blueprints (`docs/architecture/`)](architecture/)
Synthesizes how the system operates *today*, providing developers with clear guides:
- [System Overview](architecture/system-overview.md): System boundaries, container topology, database ERD, and Mermaid interaction diagrams.
- [Data Flow](architecture/data-flow.md): End-to-end event lifecycles: product scanning, DPT verification, cart diffing, and WORM auditing.
- [Golden Paths](architecture/golden-paths.md): Exact step-by-step instructions for adding API endpoints, database migrations, retailer adapters, UI tokens, and running tests.
- [Anti-Patterns](architecture/anti-patterns.md): 10 banned legacy patterns with concrete file path examples, technical reasons, and approved replacements.

### [Tier 3: Production Guardrails & Runbooks (`docs/operations/`)](operations/)
Operational safety guides protecting production environments:
- [Pre-Flight Checklist](operations/pre-flight-checklist.md): Mandatory 12-step CI validation sequence and statutory release gates.
- [Blast Radius Map](operations/blast-radius-map.md): High-risk module mapping, failure modes, and containment pathways.
- [Rollback Procedures](operations/rollback-procedures.md): Actionable recovery runbooks for database, microservice, extension, and Keycloak regressions.
- [Environment Runbook](operations/environment-runbook.md): Local development startup, port map, credentials, and Chrome unpacked testing.

### [Historical Archive (`docs/archive/`)](archive/)
- [Archive Manifest](archive/README.md): Master ledger mapping all historical reports, academic assignments, cleanup ledgers, and obsolete PRDs to their modern replacements.

---

## 4. Root Automated Enforcement Files

Engineering rules are actively embedded into the developer and agent workflows:
- [AGENTS.md](../AGENTS.md): The binding instruction set for all AI coding agents.
- [CLAUDE.md](../CLAUDE.md): Quick command and anti-pattern reference.
- [.cursorrules](../.cursorrules): Cursor IDE configuration rules.
- [.github/pull_request_template.md](../.github/pull_request_template.md): Mandatory PR submission checklist verifying Golden Path compliance and zero anti-patterns.

