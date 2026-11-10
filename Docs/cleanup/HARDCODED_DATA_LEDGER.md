# Hard-Coded Data Ledger

> Every instance of hard-coded shopper or patient data is recorded here.
> See Stage B (§5) for the full elimination procedure.
>
> `ID | location | what | class | replacement | commit`

## Classes

| Class | Meaning |
|---|---|
| A | Delete outright — demo fallback, fabricated rows |
| B | Move to synthetic test-only fixtures |
| C | Reference data — move to `db/seeds/reference/` |
| D | Keep — with written justification |

## Entries

| ID | Location | What | Class | Replacement | Commit |
|---|---|---|---|---|---|
| B-01 | `src/ui/src/cad/views/UserManagementView.tsx:70–130` | Demo clinic roster — 8 staff rows with @knh.or.ke emails, KMPDC licence numbers, clinician names | A | `[]` empty list; TODO(Stage C) | `cf004952` |
| B-02 | `src/ui/src/cad/context/AuthContext.tsx:70–90` | Hardcoded KNH / AKUH demo tenant objects with real hospital names | A | `[]` stub; TODO(Stage C) | `cf004952` |
| B-03 | `src/ui/src/cad/context/AuthContext.tsx:112–140` | MFA stub accepted any 6-char code | A | Throws `'invalid_code'` on any input | `cf004952` |
| B-04 | `src/ui/src/cad/views/ClinicalOverviewView.tsx` | Hardcoded patient vitals / clinical data for demo cohort (whole file) | A | File deleted in A-03 | `cf004952` |
| B-05 | `src/ui/src/app/components/Dashboard.tsx:57–97` | `year` and `all` range options exceed Decision 4 (3-month device ceiling) | A | Removed; `rangeStart()` simplified; `analytics` useMemo `range==="all"` branch removed | `0052277d` |
| B-06 | `src/ui/src/cad/views/ClinicianWorkspaceView.tsx:7,11` | Metric counts 12/1/6; patient ref `PAT-0042` in heading and alert | A | MetricCard values → `"—"`; patient card → empty state; alert → no-patient placeholder | `0052277d` |
| B-07 | `src/ui/src/cad/views/PlatformOverviewView.tsx:7,13,18` | `\|\| 3` fake tenant count; MetricCard 112/0; inline fallback with 'Kenyatta National Hospital' and 'Aga Khan University Hospital' | A | Empty-row `<td>` message; `—` values | `0052277d` |
| B-08 | `src/ui/src/cad/views/PatientLinkingConsentView.tsx:44–91` | `useState` fixtures: `PAT-0042`, `PAT-0108`, `Dr. Mwangi, MBChB`, consent records | A | `[]` empty; TODO(Stage C) for API wiring | `0052277d` |
| B-09 | `src/ui/src/cad/views/TenantSettingsView.tsx:89` | Slug fallback `'knh-cardio'` (real hospital identifier) | A | `activeTenant?.slug \|\| ''` | `0052277d` |
| B-10 | `scripts/check-no-hardcoded-data.mjs`, `scripts/check-no-fixtures-in-dist.mjs` | Guard scripts added to CI | — | New guard scripts | `5464155d` |
| B-11 | `src/ui/src/options/Options.tsx:78–79` | Hardcoded clinician name `"Dr. David Omondi, MBChB, MMed"` and clinic `"Kenyatta National Hospital — Clinical Nutrition Unit"` as local variable fallbacks | A | Both set to `""` with STAGE B comment and TODO(Stage C) | `HEAD` |
| B-12 | `src/ui/src/cad/views/PatientLinkingConsentView.tsx:37` | Comment contained literal patient ref codes — guard self-match | A | Reworded comment to remove literal refs | `HEAD` |
| B-13 | `src/ui/src/cad/views/UserManagementView.tsx:70,344` | Comment contained `@knh.or.ke`; placeholder `KMPDC/2026/12345` matched real licence format | A | Comment reworded; placeholder changed to `Reg-No/YYYY/NNNNN` | `HEAD` |
| B-14 | `src/ui/src/cad/views/PatientTargetsView.tsx:15–71` | Hardcoded patient references `pat-anon-8821`, `pat-anon-4109`, demo clinician `usr-dr-omondi`, `usr-diet-wanjiku`, and clinical targets | A | Prescribed targets set to `[]` empty list; cosigner fallback sanitized to `'clinician'`; placeholder changed to `'patient-ref'` | `HEAD` |
| B-15 | `src/ui/src/cad/views/BillingSubscriptionView.tsx:22–50` | Hardcoded phone number `254712345678` and demo M-Pesa receipts `QHJ882194K`, `PZX110943A` | A | Phone number default cleared to `""` with placeholder `'e.g. 254...'`; `invoices` array set to `[]` empty list with empty table state | `HEAD` |

## Guard Scripts Added (B-10)

| Script | Purpose | Added to `ci`? |
|--------|---------|----------------|
| `scripts/check-no-hardcoded-data.mjs` | Scans `src/` for PAT-XXXX, @knh.or.ke, @akuh.ac.ke, hospital names, knh-cardio slug, KMPDC licence format | ✓ (pre-build) |
| `scripts/check-no-fixtures-in-dist.mjs` | Scans `dist/` after build for same patterns | ✓ (post-build) |

## Status

Stage B complete — 15 items found, 15 resolved, 2 guard scripts added to CI.
Closed: 2026-11-10.
