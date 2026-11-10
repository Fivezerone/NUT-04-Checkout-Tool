# Dockerfile — root build definition for NUT-04 extension packaging
# Pinned Node 22 LTS (Debian Bookworm slim)
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS base

RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends \
     git \
     curl \
     ca-certificates \
     zip \
     unzip \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid 1001 --shell /bin/bash --create-home appuser

WORKDIR /app

FROM base AS builder
COPY --chown=appuser:appgroup package.json package-lock.json ./
RUN npm ci --ignore-scripts --prefer-offline

COPY --chown=appuser:appgroup . .
RUN npm run build

# Create deterministic zip
RUN cd dist && zip -r -X -9 ../dist/nutriscore-extension.zip . -x "*.zip" || true

# extension-artifact target (spec §2 item 2)
FROM scratch AS extension-artifact
COPY --from=builder /app/dist/ /

