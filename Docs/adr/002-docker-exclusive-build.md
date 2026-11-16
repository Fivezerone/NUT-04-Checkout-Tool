# ADR-002: Docker-Exclusive Build, Run, Test, and Host Isolation (Rule R4)

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & Security Team

---

## Context
In early iterations, developers ran `node`, `npm`, `python`, `vitest`, `psql`, and custom PowerShell scripts directly on their host machines (primarily Windows 10/11). This caused severe environment divergence:
1. **Toolchain Version Drift:** Differences in Node.js minor versions, Python virtual environments, and path separators broke test suites and scripts across machines.
2. **Untracked Secret Contamination:** Host environment variables and local user paths inadvertently contaminated build outputs.
3. **Flaky CI Pipelines:** Local execution succeeded while CI failed due to missing system binaries or differing module resolutions.
4. **Mandatory Security Directive:** Rule R4 mandates: *"After Phase 0, never run node, npm, python, psql, or any build tool on the host. The host runs only git and docker."*

---

## Decision
All build, test, lint, database migration, and packaging operations must execute strictly inside Docker containers. The host machine is treated as an untrusted orchestration terminal running only `git` and `docker`.

To provide seamless developer ergonomics, cross-platform wrapper scripts are provided in the repository root:
- **Windows PowerShell:** `.\bin\nut.ps1 <verb>`
- **POSIX / Bash:** `./bin/nut <verb>`

Underlying execution targets `docker/toolchain.Dockerfile` across multi-stage build targets:
- `base`: Node.js 22 LTS on Debian Bookworm Slim with non-root user `node`, `gitleaks`, and core OS dependencies.
- `deps`: Cached dependency layer executing `npm ci --ignore-scripts` with BuildKit cache mounting.
- `dev`: Live development runner with hot reload volumes mounted for rapid prototyping.
- `ci`: Hermetic quality gate environment where source code is `COPY`'d (not bind-mounted) for clean validation.

---

## Consequences & Rules

### Positive Consequences
- **Hermetic Reproducibility:** Every build and test runs in an identical Linux environment regardless of whether the developer is on Windows, macOS, or Linux.
- **Zero Host Tool Dependencies:** Developers need only install Docker and Git.
- **CI/Local Parity:** `.\bin\nut.ps1 ci` executes the exact containerized pipeline that GitHub Actions runs.

### Trade-offs & Operational Risks
- **Initial Build Latency:** The initial image pull and layer compilation require several minutes. Subsequent runs are cached via BuildKit.
- **IDE Language Server Bridging:** Developers using local IDEs (VS Code, Cursor) rely on local node_modules purely for TypeScript intellisense, while all authoritative executions happen in Docker.

### Strict Enforcement Rules
1. **Banned Host Execution:** Never invoke `npm run ...`, `npx ...`, or `node scripts/...` directly on the host command prompt or terminal. Always execute via `.\bin\nut.ps1 <verb>` or `docker compose exec toolchain ...`.
2. **Single Exception:** Loading the unpacked extension directory (`./dist/extension`) into Google Chrome Developer Mode (`chrome://extensions`) is the only manual host action permitted.

