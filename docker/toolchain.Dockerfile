# docker/toolchain.Dockerfile
# NUT-04 Checkout Tool — multi-stage toolchain image
# Node 22 LTS (Debian Bookworm slim), pinned by tag and digest.
# Never use `latest`; update the digest when upgrading Node.
#
# Stages:
#   base   — OS + non-root user + npm globals
#   deps   — npm ci with BuildKit cache mount
#   dev    — dev server, watchers, CLI tools
#   ci     — all gates (lint, typecheck, test, build, audit, e2e-less)

# ---------------------------------------------------------------------------
# base
# ---------------------------------------------------------------------------
FROM node:22.14.0-bookworm-slim@sha256:4a55308cc855cba4b5a05b28a596edf3b0c48d394ec4c58f62fb06c79d3e43b0 AS base

LABEL maintainer="NUT-04 Engineering"

# Install OS-level tools needed by scripts and audit tools
RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends \
     git \
     curl \
     ca-certificates \
     zip \
     unzip \
     jq \
  && rm -rf /var/lib/apt/lists/*

# Install gitleaks for secret scanning (§4.3 / R5)
ARG GITLEAKS_VERSION=8.21.2
RUN curl -sSfL \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    | tar -xz -C /usr/local/bin gitleaks \
  && gitleaks version

# Non-root user (R4 — no root in containers)
RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid 1001 --shell /bin/bash --create-home appuser

WORKDIR /app

# ---------------------------------------------------------------------------
# deps — install node_modules with a BuildKit cache mount
# ---------------------------------------------------------------------------
FROM base AS deps

# Copy manifests only — changes here bust the layer, not source changes
COPY --chown=appuser:appgroup package.json package-lock.json ./

# BuildKit cache mount: persists the npm cache across builds
RUN --mount=type=cache,target=/home/appuser/.npm,uid=1001,gid=1001 \
    npm ci --ignore-scripts --prefer-offline

# ---------------------------------------------------------------------------
# dev — includes watchers, dev-only CLI tools, source bind-mounted at runtime
# ---------------------------------------------------------------------------
FROM deps AS dev

# Install dev-only global tools inside the image
RUN --mount=type=cache,target=/home/appuser/.npm,uid=1001,gid=1001 \
    npm install -g knip@5 depcheck@1 madge@8 jscpd@4 \
  && knip --version \
  && depcheck --version

# Playwright + Chromium for e2e / coverage
RUN npx --yes playwright install --with-deps chromium 2>/dev/null || true

USER appuser

EXPOSE 5173 5174

CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
# ci — runs all quality gates; source is COPY'd (not bind-mounted)
# ---------------------------------------------------------------------------
FROM deps AS ci

# Copy full source (excluding .dockerignore patterns)
COPY --chown=appuser:appgroup . .

# Install CI-only global tools
RUN --mount=type=cache,target=/home/appuser/.npm,uid=1001,gid=1001 \
    npm install -g knip@5 depcheck@1 madge@8 jscpd@4 \
  && npx --yes playwright install --with-deps chromium 2>/dev/null || true

USER appuser

# Default CI entrypoint — overridden via `docker compose run --rm ci <cmd>`
CMD ["npm", "run", "ci"]

