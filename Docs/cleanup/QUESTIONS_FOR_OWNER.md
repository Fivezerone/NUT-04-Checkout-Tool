# Questions for Owner

> Generated automatically by the refactor agent on 2026-11-10.  
> Every item here is a **stop-and-ask condition** (prompt §8) that blocks further
> work on the affected area. Items are ordered by urgency.

---

## Q-01 — CRITICAL: Supabase credentials committed to public GitHub history

**Category:** §8.2 — real secret found in repository history  
**Rule:** R5, R8

### Evidence

| Artefact | Contains | Commits in public history |
|---|---|---|
| `.env` (gitignored, local only) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Not in history (file is gitignored) |
| Supabase anon JWT (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…`) | Hardcoded in source/docs | **3 commits**: `15b4faf1`, `92ba1341`, `dd435df7` — pushed to `github.com/Fivezerone/NUT-04-Checkout-Tool` |
| Supabase project ref `nqcpudpkrkutpxuqpsfk` | Linked project reference | **9 commits**: `15b4faf1`, `b335c508`, `1a6b3069`, `5d38c249`, `59906e16`, `5c7e4c23`, `11584c5e`, `b54e0097`, `dd435df7` |
| `.mock-credentials.json` (gitignored, local) | Mock passwords and UUIDs | Not in history |
| `supabase/.temp/linked-project.json` | Real project ref + org IDs | Gitignored; confirms live project |

**The public git history of this repository contains the Supabase project reference and anon JWT.** Because the anon key is a signed JWT encoding the project ref, it can be used to identify the live project. The Service Role Key on disk is **not** in history (the `.env` file is gitignored) but must be treated as potentially exposed if the host was ever compromised.

### What needs to happen (human actions)

1. **Rotate immediately — today** in the Supabase dashboard for project `nqcpudpkrkutpxuqpsfk`:
   - Roll the anon key
   - Roll the service role key
   - If any other secrets were ever stored in Supabase Vault or Edge Function secrets, roll those too
2. If the repository is public, **consider making it private** until history is clean, or accept that the old keys are permanently visible in git history (R8 forbids rewriting; this is a human decision)
3. **Answer Q-03 below** before deciding whether to delete the Supabase project

### My recommended answer

Rotate both keys now (regardless of other decisions). Make the repo private temporarily if the team is not comfortable with the history exposure. Do not rewrite history (R8) — the keys will be invalidated by rotation, making the history exposure harmless.

---

## Q-02 — BLOCKER: Working tree is not clean at the start of the branch

**Category:** §8.1 — working tree dirty  
**Rule:** R1

### Evidence

Running `git status` on `feat/cad-backend-blueprint` shows:

- **25 tracked files staged as deleted** (Docs/ and Reports/ markdown files from prior work)
- **Multiple untracked directories**: `Docs/Agent Final reports/`, `Docs/Architecture/`, `Docs/Guides/`, `Docs/Reports/`, `Docs/System documentation/`, plus `Docs/ui-ux-overhaul-report.md`, `src/ui.rar`

The deletions appear to be an incomplete manual tidy-up. The untracked files include the architecture blueprints referenced in the prompt (`Docs/Architecture/Local Development Portability & Production Alignment.md`, etc.) and the UI/UX overhaul report.

### Three options (pick one)

| Option | Action | Risk |
|---|---|---|
| A (recommended) | Commit the deletions and add the untracked files in a single `chore(docs): tidy pre-cleanup working tree` commit on the **current** branch, then create `refactor/decay-cleanup-docker-ui` from that commit | Low — keeps intent clear |
| B | Restore the deleted files (`git restore Docs/ Reports/`) and stash or discard the untracked material, then create the new branch from the clean tip | The deletions are intentional, so this un-does work |
| C | Create the new branch **from `main`**, not from `feat/cad-backend-blueprint` | Loses all the CAD backend work in the current branch |

### My recommended answer

**Option A.** The 25 staged deletions appear intentional (old reports being replaced by the new docs in `Docs/` untracked dirs). Commit them together with the untracked files, then branch. I will do this once you confirm.

---

## Q-03 — BLOCKER: Does the live Supabase project hold real user or patient data?

**Category:** §8.3 — production data question  
**Rule:** Prompt §4.7.6 and §8 item 3

### Evidence

`supabase/.temp/linked-project.json` shows the project `nqcpudpkrkutpxuqpsfk` ("NUT-04 Nutriscore") is linked and org `zqwuxefqljbbxoqlersl`. Credentials exist in `.env`. The hosted checklist in `Reports/HOSTED_SUPABASE_CHECKLIST.md` and `Reports/CUTOVER_RUNBOOK.md` suggest a live pilot was run against this project.

The prompt says: **"If a production Supabase project holds real data, stop and ask."**

### Questions

1. Does this Supabase project hold **any real (non-synthetic) user accounts**, patient records, clinical data, or personal information?
2. If yes: should that data be exported and migrated before decommissioning, or is it expendable?
3. If pilot users were real people (not the synthetic `.mock-credentials.json` test users), their data must not be silently destroyed.

### My recommended answer

If the answer is "it only holds the synthetic mock users from `.mock-credentials.json` plus product catalogue data" → safe to decommission after key rotation (Q-01). If any real people were enrolled, export and decide.

---

## Q-04 — BLOCKER: Docker Desktop is not running

**Category:** §8.9 — step requires host tooling beyond git and docker  
**Rule:** R4

### Evidence

`docker info` returns: *"failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine"* — Docker Desktop's Linux engine is **stopped**.

Phase 0 and all subsequent work require Docker. No build, test, or analysis step can run until Docker Desktop is started.

### Action required

Start Docker Desktop before giving the green light to proceed.

---

## Q-05 — INFORMATIONAL: `src/ui.rar` untracked in `src/`

**Category:** §8 / R6 (untracked artefact)

### Evidence

`src/ui.rar` is an untracked archive. Its contents are unknown.

### Questions

1. What does `src/ui.rar` contain?
2. Should it be unzipped into the repository, archived to `../nut-04-archive/`, or deleted?

The prompt says untracked artefacts should be moved to `../nut-04-archive/` and listed in the ledger; I will do that once you answer.

---

## Q-06 — INFORMATIONAL: Multiple existing branches with overlapping work

**Category:** §8.1 / R1

### Evidence

Existing branches: `main`, `feat/cad-backend-blueprint` (current, 20+ commits ahead of main), `feat/cad-only-identity`, `feature/agent-fix-tests`, `refactor/repo-cleanup`, `remediation/20261004`, `remediation/nut04`.

The prompt says to branch **from the default branch** (`main`). However, `feat/cad-backend-blueprint` contains significant CAD backend work (Supabase migrations, Edge Functions, schema) that the new work must build on.

### Question

Should `refactor/decay-cleanup-docker-ui` branch from:
- **`main`** (clean start, some backend work missing), or
- **`feat/cad-backend-blueprint`** (includes the CAD backend schema work, but tree is dirty — see Q-02)?

### My recommended answer

Branch from `feat/cad-backend-blueprint` after resolving Q-02 (clean the tree first), since all the Supabase schema migrations that must be ported to plain Postgres in §4.7 live in that branch.

---

*This file is maintained throughout the refactor. Add items as new questions arise. Close each item by recording the human's answer and the date.*

