# ADR 0002 — Docker-Exclusive Build, Run and Test

**Status:** Accepted  
**Date:** 2026-11-10  
**Authors:** NUT-04 Engineering

---

## Context

The original project ran `node`, `npm`, `python`, `psql` and build tools directly
on the developer's host (Windows). This caused environment drift, non-reproducible
builds, and made CI fragile. R4 mandates: "After Phase 0 never run node, npm,
python, psql or any build tool on the host."

---

## Decision

All build, test, run and packaging operations are performed inside Docker containers.
The host runs only `git` and `docker`.

Wrapper scripts (`bin/nut.ps1` on Windows, `bin/nut` on POSIX) provide the verbs:
`up`, `down`, `ci`, `extension`, `e2e`, `db-reset`, `logs`, `shell`.

The `docker/toolchain.Dockerfile` provides:
- `base`: Node 22 LTS on Debian Bookworm Slim, non-root user, gitleaks, OS tools
- `deps`: `npm ci --ignore-scripts` with BuildKit cache mount
- `dev`: dev servers, watchers, CLI tools (knip, depcheck, madge)
- `ci`: all quality gates; source COPY'd not bind-mounted

The only exception: loading the unpacked extension into Chrome by hand (not automatable).

---

## Consequences

**Positive:**
- Fully reproducible builds across Windows, macOS, Linux
- No "works on my machine" failures
- CI and local runs use identical environments
- Secrets never on host PATH or environment

**Negative / risks:**
- Developers must learn Docker vocabulary
- First build is slower (image pull + npm ci)
- BuildKit cache mount speeds up subsequent builds significantly

**Wrapper scripts** provide discoverability: `bin/nut.ps1 help` lists all verbs.

