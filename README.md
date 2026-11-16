# NUT-04 Checkout Tool — NutriScore Kenya Shopping Assistant & CAD Platform

[![CI Quality Gate](<https://img.shields.io/badge/CI-Passing%20(793%2B%20tests)-success>)](.github/workflows/ci.yml)
[![Architecture](https://img.shields.io/badge/Architecture-4--Tier%20Consolidated-blue)](docs/README.md)
[![Security Policy](<https://img.shields.io/badge/Security-Host%20Isolated%20(Rule%20R4)-red>)](AGENTS.md)
[![License](https://img.shields.io/badge/License-Proprietary-lightgrey)](NUT-04_Release_Documentation/LICENSE)

The **NUT-04 Checkout Tool** is an enterprise-grade digital health nutrition platform operating across Kenya. The platform combines a **Chrome Manifest V3 browser extension** for real-time supermarket grocery shopping assistance (Quickmart, Naivas, Carrefour) with a **Clinic Admin Dashboard (CAD)** for clinical nutritionists, dieticians, and physicians to prescribe personalized dietary boundaries to patients managing chronic metabolic conditions.

---

## 📚 Master Documentation Index

All technical documentation, architecture blueprints, decision records, and operational runbooks are organized under the unified [docs/](docs/README.md) directory:

- 🧭 **[Master Documentation Index (docs/README.md)](docs/README.md)** — Master routing table with the _"Read This Before You Code"_ matrix.
- 🏛️ **[Architecture Decision Records (docs/adr/)](docs/adr/)** — Numbered records (`001` through `014`) documenting all historical architectural choices.
- 📐 **[Living Architectural Blueprints (docs/architecture/)](docs/architecture/)** — System overview, data flows, golden path implementation guides, and banned anti-patterns.
- 🛡️ **[Production Guardrails & Runbooks (docs/operations/)](docs/operations/)** — Pre-flight checklists, blast radius maps, rollback runbooks, and developer environment guides.
- 🤖 **[AI Agent & Developer Mandate (AGENTS.md)](AGENTS.md)** — Binding operational rules (Rule R4 Host Isolation, Rule R5 Zero Hardcoded Data, ADR-001 Supabase Decommission).

---

## ⚡ Quickstart (Strict Host Isolation — Rule R4)

Under **Rule R4**, developers never run `node`, `npm`, `python`, or `psql` directly on the host machine. All commands are executed inside Docker containers via the provided orchestration wrappers:

- **Windows (PowerShell):** `.\bin\nut.ps1 <verb>`
- **POSIX (Linux/macOS):** `./bin/nut <verb>`

### 1. Start the Development Stack

```powershell
.\bin\nut.ps1 up -d
```

> Starts PostgreSQL 16, Keycloak 26, PostgREST 12, Fastify API, Caddy Gateway, CAD Nginx, and Mailpit.

### 2. Run the Full Quality Gate & CI Suite

```powershell
.\bin\nut.ps1 ci
```

> Runs 12 automated checks (secret scans, zero hardcoded patient data, manifest checks, CAD security, format, lint, typecheck, 793+ Vitest tests, and WORM audit hash verification).

### 3. Build the Unpacked Chrome Extension

```powershell
.\bin\nut.ps1 extension
```

> Compiles the extension bundle into `./dist/extension`. Load this folder into Google Chrome at `chrome://extensions` via **Load unpacked**.

---

## 🌐 Ingress Endpoints & Architecture Topology

| Service                          | Ingress URL                        | Description                                      |
| -------------------------------- | ---------------------------------- | ------------------------------------------------ |
| **Caddy Gateway (HTTP)**         | `http://localhost:8080`            | Unified ingress gateway & reverse proxy          |
| **Caddy Gateway (TLS)**          | `https://localhost:8443`           | Secure ingress with internal CA (`tls internal`) |
| **Clinic Admin Dashboard (CAD)** | `http://localhost:8080/cad/`       | Clinical management web application              |
| **Keycloak OIDC Realm**          | `http://localhost:8080/auth/`      | Identity provider (Realm: `nutriscore`)          |
| **Keycloak Admin Console**       | `http://localhost:8080/auth/admin` | Keycloak administrative console                  |
| **PostgREST REST API**           | `http://localhost:8080/api/`       | Database REST API with Row Level Security        |
| **Node.js API Microservice**     | `http://localhost:8080/api/v1/`    | Cryptographic token minting & server logic       |
| **Mailpit (Dev SMTP Sink)**      | `http://localhost:8025/`           | Local dev inbox for OTPs and alert verification  |

---

## 👥 Contributing & Pull Requests

All pull requests must adhere to the mandatory checklist in [.github/pull_request_template.md](.github/pull_request_template.md). Review [docs/architecture/golden-paths.md](docs/architecture/golden-paths.md) before writing code, and verify against [docs/architecture/anti-patterns.md](docs/architecture/anti-patterns.md).
