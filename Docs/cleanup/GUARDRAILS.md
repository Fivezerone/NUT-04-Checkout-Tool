# Guardrails

> This document explains every automated gate that prevents decay from
> returning after Stage A cleanup. See §4.11.

## Gates in CI

| Gate | Command | Threshold | Purpose |
|---|---|---|---|
| Unused files/exports/deps | `npx knip` | Zero findings (allow-list below) | Prevents dead code accumulation |
| Unused locals/params | `npx tsc --noUnusedLocals --noUnusedParameters` | Zero errors | TypeScript dead code |
| Circular dependencies | `npx madge --circular` | Zero circular deps | Architecture hygiene |
| Dependency cruiser | `npx depcruise` | Per `dependency-cruiser.config.mjs` | No cross-boundary imports |
| ESLint unused directives | `eslint --report-unused-disable-directives` | Zero | Prevents suppress-and-forget |
| No hard-coded data | `node scripts/check-no-hardcoded-data.mjs` | Zero findings | Stage B compliance |
| No fixtures in dist | `node scripts/check-no-fixtures-in-dist.mjs` | Zero findings | Prevents test data in production |
| Secret scan | `gitleaks detect` | Zero leaks | R5 compliance |
| Feature flag expiry | Vitest flag test | Zero expired flags | Ephemeral flag hygiene |
| Scheduled audit | Monthly GitHub Action | Report as artifact | Catch new drift |

## Knip Allow-list

The following items are allowed to be "unused" by knip with a written justification:

| Item | Justification |
|---|---|
| (none yet) | Populated during Stage A |

## Feature Flag Registry

All temporary build flags live in `src/shared/flags.ts`.
Each flag must have: `owner`, `createdAt`, `expiresAt`, `issueUrl`.
A test fails if `expiresAt` is in the past or `issueUrl` is missing.

## Review Culture

- Pre-commit hook: format, lint, secret-scan
- PR template asks: "Did you delete what this change replaced?"
- `CODEOWNERS` assigns review to relevant team members
- Commented-out code is a lint error (`no-commented-out-code` rule)

## Allow-list Maintenance

To add an item to the knip allow-list:
1. Add it to `knip.config.ts` under `ignore` with a comment explaining why
2. Update this document's allow-list table
3. Set an expiry date — the flag registry test will remind you

