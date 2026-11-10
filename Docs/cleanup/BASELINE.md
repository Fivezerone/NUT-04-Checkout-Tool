# Baseline — `refactor/decay-cleanup-docker-ui`

> Recorded at tag `baseline/pre-cleanup` (commit `2ffa433f` tidy + `e594f4d1` scaffold).  
> Date: 2026-11-10

## File and Line Counts

| Dimension | Baseline |
|---|---|
| Total tracked files | 495 |
| Source files (TS/TSX/JS/MJS) | 217 |
| Source lines (TS/TSX/JS/MJS) | 33,305 |
| `src/` files | 189 |
| `supabase/` files | 87 |
| `Docs/` files | 56 |
| `android/` files | 54 |
| `NUT-04_Release_Documentation/` files | 32 |
| `scripts/` files | 31 |

## Package Counts

| Dimension | Baseline |
|---|---|
| Production dependencies | 19 |
| Dev dependencies | 16 |
| Total declared | 35 |
| Test files | 51 |

## Pattern Occurrence Counts

| Pattern | Occurrences in source |
|---|---|
| `supabase` | 622 |
| `mock` | 193 |
| `fixture` | 76 |
| `PAT-` | 19 |
| `demo` | 16 |
| `@knh.or.ke` | 4 |

## Docker / Build Metrics

> To be populated after toolchain image build in Phase 0.

| Metric | Baseline |
|---|---|
| Toolchain image size | TBD |
| `npm ci` install time | TBD |
| Eager gzip — popup | TBD |
| Eager gzip — dashboard | TBD |
| Eager gzip — CAD | TBD |
| Eager gzip — options | TBD |
| Lint errors | TBD (pre-commit passed) |
| TypeScript errors | TBD |
| Test pass/fail/skip | TBD |

## Known Dead Code (from initial survey)

| Item | Evidence |
|---|---|
| `OnboardingWizard.tsx`, `SubscriptionExpiredPage.tsx`, `usePaymentState.ts`, `useSubscriptionGuard.ts` | Dead by decision 6 (CAD-only identity) |
| `ClinicalOverview.tsx` | Imported nowhere (static — not in any import graph) |
| `src/ui/src/cad/supabaseClient.ts` | Dead by decision 7 (Supabase decommission) |
| `supabase/` directory (87 files) | Dead by decision 7 |
| `@mui/material`, `@mui/icons-material`, `@emotion/*`, `@popperjs/core`, `motion`, `next-themes` | No imports found in production code |
| `build.ps1` | Dead by R4 (Docker-only) |
| MFA stub `verifyMfa()` accepts any 6 chars | Dead by decision 8 — Keycloak enforces TOTP |
| Demo tenant fallbacks (hospital names) | Stage B — hard-coded person/org data |
| `esbuild` in production dependencies | Should be devDependency |
| `figmaAssetResolver` plugin in `vite.config.ts` | Figma Make scaffolding — no `figma:asset/` imports |

## Open Questions at Baseline

See `docs/cleanup/QUESTIONS_FOR_OWNER.md` — all Q-01 through Q-04 resolved.  
Q-05 (`src/ui.rar`) — file not found on disk; archived reference at `../nut-04-archive/`.

