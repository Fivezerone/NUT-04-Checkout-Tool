# Pull Request Description

## 1. Summary of Changes

<!-- Provide a clear, concise summary of what this PR does and why it is needed. -->

## 2. Issue / Architecture Decision Reference

- Fixes Issue: #
- Corresponds to ADR: [ADR-00X](docs/adr/00X-title.md) (or None)

---

## 3. Mandatory Architectural Checklist

Before submitting, verify that this change satisfies all repository architectural guardrails:

### Golden Paths & Anti-Patterns Compliance

- [ ] **Golden Paths Followed:** I have consulted [docs/architecture/golden-paths.md](docs/architecture/golden-paths.md) and adhered to the approved implementation pattern.
- [ ] **Anti-Patterns Avoided:** I have verified against [docs/architecture/anti-patterns.md](docs/architecture/anti-patterns.md) that this PR re-introduces ZERO banned patterns:
  - [ ] No host-level tool execution (Rule R4 followed).
  - [ ] No hardcoded patient PII, clinician IDs, real phone numbers, or real hospital names (Rule R5 & Stage B).
  - [ ] No `@supabase/*` imports, variables, or dependencies (ADR-001).
  - [ ] No condition names or clinical diagnoses leaked into Dietary Profile Tokens (ADR-010).
  - [ ] No `BYPASSRLS` or unvalidated tenant boundaries.
  - [ ] No mutations or deletions on `audit.ledger` records (ADR-012).
  - [ ] No multi-year device queries exceeding the 90-day retention ceiling (ADR-005).
  - [ ] Recommender fails closed on food swaps with missing nutrition data (Gap G-04).

### Automated CI Quality Gates (Containerized via Rule R4)

I have executed `.\bin\nut.ps1 ci` (or `./bin/nut ci`) and confirmed that all 12 gates passed:

- [ ] `check-no-secrets-tracked.mjs` (0 leaks)
- [ ] `check-no-hardcoded-data.mjs` (0 matches in `src/`)
- [ ] `check-manifest-globals.mjs` (passed)
- [ ] `check-cad-security.mjs` (passed)
- [ ] `node --check src/extension/content.js` (syntax valid)
- [ ] `npm run format:check` (Prettier clean)
- [ ] `npm run lint` (0 ESLint errors)
- [ ] `npm run typecheck` (0 TypeScript errors)
- [ ] `npm run test` (100% pass rate across 793+ Vitest tests)
- [ ] `npm run build` (builds cleanly without fixture duplication)
- [ ] `check-no-fixtures-in-dist.mjs` (0 fixtures in `dist/`)
- [ ] `verify-audit-chain.mjs` (WORM audit chain verified)

### Documentation & Living Blueprints

- [ ] **Living Blueprints Updated:** If this PR alters system boundaries, data contracts, or workflows, I have updated the corresponding files in [docs/architecture/](docs/architecture/) and [docs/operations/](docs/operations/).
- [ ] **New ADR Added:** If this PR introduces a significant new library, pattern shift, or database table, an ADR has been added to [docs/adr/](docs/adr/).
- [ ] **Cleanup Ledger:** If this PR replaces or decommissions code, I have deleted the superseded code and documented it in the PR description.
