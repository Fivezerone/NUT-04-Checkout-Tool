# Production Guardrails: Developer Environment & Operational Runbook

## Executive Summary
This runbook provides the definitive guide for operating the **NUT-04 Checkout Tool** development, testing, and live verification environments. In accordance with **Rule R4 (Host Isolation)**, developers must never run build or runtime commands directly on their host machines. All operations are conducted via Docker Compose and the provided wrapper scripts.

---

## 1. Quick Reference: Service Port & Credential Matrix

| Service / Container | Ingress URL / Host Binding | Internal Port | Protocol / Auth Mechanism | Default Dev Credentials |
|---|---|---|---|---|
| **Caddy API Gateway (HTTP)** | `http://localhost:8080` | 8080 | HTTP Ingress & Reverse Proxy | None (Public Gateway) |
| **Caddy API Gateway (TLS)** | `https://localhost:8443` | 8443 | HTTPS Ingress (`tls internal`) | Internal Dev CA |
| **Clinic Admin Dashboard (CAD)** | `http://localhost:8080/cad/` | 8080 (cad container) | Nginx Unprivileged / React App | Keycloak OIDC Authenticated |
| **Keycloak OIDC Realm** | `http://localhost:8080/auth/` | 8080 (keycloak) | OIDC (Realm: `nutriscore`) | Realm import: `infra/keycloak-realm.json` |
| **Keycloak Admin Console** | `http://localhost:8080/auth/admin` | 8080 (keycloak) | Keycloak Master Realm | `admin` / `.secrets/kc_admin_password` |
| **PostgREST REST API** | `http://localhost:8080/api/` | 3000 (postgrest) | HTTP REST with PostgreSQL RLS | Bearer JWT with `app_role` claim |
| **Node.js API Service** | `http://localhost:8080/api/v1/` | 4000 (api) | Fastify / Microservice HTTP | Bearer JWT / Internal service tokens |
| **Mailpit (Dev SMTP Sink)** | `http://localhost:8025/` | 8025 (Web) / 1025 (SMTP)| Web UI for inspecting OTP emails | None (Open Web UI) |
| **PostgreSQL Database** | `postgres:5432` (Internal) | 5432 | PostgreSQL Wire Protocol | User: `nutriscore_app`, DB: `nutriscore` |
| **Toolchain Runner** | Container Execution Only | — | Node 22 LTS / Debian Bookworm | Non-root `node` user in `/app` |
| **Chrome Extension** | `chrome://extensions` | — | Manifest V3 Unpacked Extension | Local directory `./dist/extension` |

---

## 2. Orchestration Wrapper Parity (`bin/nut.ps1` vs `bin/nut`)

The repository provides zero-dependency wrapper scripts that enforce host isolation while providing convenient CLI verbs:
- **Windows (PowerShell):** `.\bin\nut.ps1 <verb>`
- **POSIX (Linux/macOS):** `./bin/nut <verb>`

| Command Verb | PowerShell Syntax | POSIX Syntax | Underlying Docker Action |
|---|---|---|---|
| `up` | `.\bin\nut.ps1 up [-d]` | `./bin/nut up [-d]` | `docker compose --profile dev up --build [-d]` |
| `down` | `.\bin\nut.ps1 down` | `./bin/nut down` | `docker compose --profile dev down` |
| `ci` | `.\bin\nut.ps1 ci` | `./bin/nut ci` | `docker compose --profile ci run --rm ci` |
| `extension` | `.\bin\nut.ps1 extension`| `./bin/nut extension`| Builds unpacked extension artifact to `./dist/extension` |
| `e2e` | `.\bin\nut.ps1 e2e` | `./bin/nut e2e` | `docker compose --profile e2e run --rm e2e` |
| `db-reset` | `.\bin\nut.ps1 db-reset` | `./bin/nut db-reset` | Drops and re-executes all migrations via `dbmate` |
| `logs` | `.\bin\nut.ps1 logs [-f]` | `./bin/nut logs [-f]` | `docker compose --profile dev logs [-f]` |
| `shell` | `.\bin\nut.ps1 shell [svc]`| `./bin/nut shell [svc]`| Opens interactive bash shell in container (defaults to `toolchain`) |

---

## 3. Starting the Full Stack & Pre-Flight Checks

### Step 1: Launch the Docker Stack
```powershell
.\bin\nut.ps1 up -d
```

### Step 2: Verify Health Status of All Microservices
```powershell
docker compose ps
```
> **Expected Output:** 8 services running and healthy:
> - `postgres` (healthy)
> - `migrate` (exited 0 / completed successfully)
> - `keycloak` (healthy)
> - `postgrest` (running)
> - `api` (healthy)
> - `gateway` (healthy)
> - `cad` (healthy)
> - `mailpit` (healthy)

### Step 3: Run the Full CI Verification Suite
```powershell
.\bin\nut.ps1 ci
```
> **Expected:** Zero secret leaks, zero hardcoded patient data, zero lint errors, zero typecheck errors, 100% test pass rate across 793+ tests.

---

## 4. Live Chrome Extension Testing Protocol

The **only** permitted manual host action is loading the compiled extension into Google Chrome Developer Mode.

### Step 1: Build the Extension Artifact
```powershell
.\bin\nut.ps1 extension
```
> This runs Docker BuildKit to compile TypeScript, bundles scripts, and outputs the final extension files into `./dist/extension`.

### Step 2: Load Unpacked Extension in Chrome
1. Open Google Chrome.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** button.
5. In the file picker, select: `c:\Users\USER\Documents\NUT-04 Checkout Tool\dist\extension`.
6. Confirm the extension card displays:
   - **Name:** *NutriScore Kenya Shopping Assistant*
   - **Version:** `1.1.0` (or current)
   - **Permissions:** `alarms`, `storage`, `scripting`, `identity`, `sidePanel`.

### Step 3: Verify Live Supermarket Interception
1. Navigate to Quickmart Kenya (`https://www.quickmart.co.ke/`) or Naivas (`https://naivas.online/`).
2. Open Chrome DevTools (`F12`) and inspect the Elements panel.
3. Verify that product listings contain NutriScore badges injected within the Shadow DOM portal (`NutriSharedUI._ensureGlobalPortal`).
4. Click the extension action icon in the Chrome toolbar to verify the Shopper Popup and Side Panel workflows.

