# services/api/Dockerfile
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS base

RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid 1001 --shell /bin/bash --create-home appuser

WORKDIR /app

COPY --chown=appuser:appgroup package.json ./
COPY --chown=appuser:appgroup src ./src

USER appuser

EXPOSE 4000

HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD curl -fs http://localhost:4000/health || exit 1

CMD ["node", "src/server.mjs"]

