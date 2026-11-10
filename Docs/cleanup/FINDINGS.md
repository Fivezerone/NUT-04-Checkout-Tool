# Findings

> Items that are out of scope for this refactor but need recording (R9).
> Items that need resolution by counsel or the product lead are also listed here.

## Format

`ID | area | finding | recommended action | owner`

## Findings

| ID | Area | Finding | Recommended Action | Owner |
|---|---|---|---|---|
| F-01 | Secrets / history | Supabase anon JWT (`eyJhbGciOiJIUzI1NiI…`) found in commits `15b4faf1`, `92ba1341`, `dd435df7` on `feat/cad-backend-blueprint`, which is pushed to public GitHub. Project ref `nqcpudpkrkutpxuqpsfk` in 9 commits. Keys are **not** in git objects from the new branch but are reachable via public history. | Human confirmed keys rotated (2026-11-10). Do not rewrite history (R8). Consider making repo private. | Human — done |
| F-02 | Secrets / disk | `SUPABASE_SERVICE_ROLE_KEY` present in `.env` on disk (gitignored). Key begins `sb_secret_i0-…`. | Human to rotate (confirmed 2026-11-10) and delete `.env` after replacing with new stack credentials. | Human |
| F-03 | Supabase local stack | Supabase local dev containers still running (`supabase_*` on ports 54321-54327). These should be stopped once the new Postgres/Keycloak stack is healthy. | Stop with `npx supabase stop` once Stage A §4.7 is complete. | Agent (Stage A) |
| F-04 | Build artefacts | Root-level JS files (`background.js`, `catalog-sync.js`, `config.js`, `content.js`, `db.js`, `entitlement.js`, `health-modes.js`, `manifest.json`, `observed-orders-sync.js`, `scanner.js`, `supabase.js`, `theme-init.js`) appear to be a stale build output committed alongside source. Confirm whether these are the canonical sources or build outputs. | Investigate during §4.2 inventory. | Agent (Stage A) |
| F-05 | Architecture | `src/ui.rar` referenced in git status but file not found on disk — may have been deleted already. Archived reference copy stored at `../nut-04-archive/` per R6. | No action required. | Done |
| F-06 | Scoring algorithm | Earlier audits (UI/UX report) found gaps: fibre-points cap at 4.5 g vs specified 7.4 g; beverage non-nutritive-sweetener penalty not implemented. These are not addressed in this refactor — they require a separate scoring-engine review and human sign-off on the licence checklist. | Record in `docs/legal/NUTRI_SCORE_LICENCE_CHECKLIST.md` (Stage C). | Human / Stage C |

