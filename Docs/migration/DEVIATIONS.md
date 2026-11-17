# DEVIATIONS.md — Blueprint Deviations & Ground-Truth Alignments

This register logs every difference between assumptions in `NUT04_Architectural_Audit_Blueprint.md` and the actual repository ground truth.

| Deviation ID | Blueprint Assumption | Repository Ground Truth | Architectural Decision / Safe Path |
| :--- | :--- | :--- | :--- |
| **DEV-001** | Blueprint §0.1 assumed Supabase Edge Functions (`entitlement`, `observed-orders`) existed in repo. | Supabase was fully decommissioned per ADR-001 in favor of a self-hosted Docker stack: Postgres 16, Keycloak 26.2.5, PostgREST 12.2.3, and Caddy 2.9.1. | All server-side auth and gateway routes target Keycloak `/auth` and PostgREST `/api` via Caddy. New BFF endpoints are implemented as Node/TypeScript microservices within the Docker network. |
| **DEV-002** | Blueprint §0.1 marked `manifest.json` minimum Chrome version as unversioned/unknown. | `manifest.json` specifies `"minimum_chrome_version": "114"`. | Per ADR-3, upgrading to Chrome 137 (for native WebCrypto Ed25519) will be executed as an isolated, small PR labelled `RELEASE: manifest-only` after evaluating browser telemetry. |
| **DEV-003** | Blueprint §0.1 inferred that `claimsFromAccessToken` in `src/shared/claims.ts` might be verifying signatures. | `claimsFromAccessToken` directly decodes the base64url payload segment without signature verification. | Confirms finding X-01. WP-05 implements `claimsFromVerifiedToken(jwt, jwks)` with branded type `VerifiedClaims`. |
| **DEV-004** | Blueprint §1.1 hypothesized `content.js` might be re-debouncing card scans on top of `NutriScanner`. | `content.js` uses `NutriScanner` for card scanning (30ms flush window), but retains a separate 1000ms debounce observer for cart mutations, and has an unattached 300ms observer in the legacy fallback branch. | Scanner micro-batching is clean. The orphaned observer will be cleaned up in WP-08. |
