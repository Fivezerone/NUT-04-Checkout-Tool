# Stage B Phase Report — Hard-Coded Data Elimination

**Branch:** `refactor/decay-cleanup-docker-ui`
**Stage A end commit:** `8e3cb4f9`
**Stage B end commit:** `59b0738d`
**Date:** 2026-11-10

---

## 1. Objective

Locate and delete every hard-coded shopper, patient, clinician, and clinic-specific
identifier from committed source. Replace with empty states or API-driven values.
Add CI guard scripts to prevent regression.

---

## 2. Commits (Stage B)

| Commit | ID | Description |
|--------|----|-------------|
| `cf004952` | B-01 | Purge KNH/AKUH demo clinic roster (8 staff rows, real-pattern emails, KMPDC numbers); MFA stub hardened; KNH/AKUH demo tenant objects removed from `AuthContext` *(shared with A-03)* |
| `0052277d` | B-02 to B-05 | `ClinicianWorkspaceView`: metric counts + `PAT-0042` → empty state; `PlatformOverviewView`: `\|\| 3` count + `112`/`0` values + inline hospital tenant array removed; `Dashboard`: `year`/`all` range options removed (Decision 4); `PatientLinkingConsentView`: `PAT-0042`/`PAT-0108`/`Dr. Mwangi` fixtures → `[]`; `TenantSettingsView`: `knh-cardio` slug fallback → `''` |
| `5464155d` | B-06/B-10 | `check-no-hardcoded-data.mjs` and `check-no-fixtures-in-dist.mjs` guard scripts; `package.json` CI chain updated |
| `59b0738d` | B-11 to B-13 | `Options.tsx`: clinician name + hospital name fallbacks → `""`; comment/placeholder false-positives fixed after guard run |

---

## 3. Items Found and Resolved

| ID | Location | Type | Action |
|----|----------|------|--------|
| B-01 | `UserManagementView.tsx`, `AuthContext.tsx` | Demo clinic roster (8 rows), real-pattern hospital names | Deleted; replaced with `[]` stubs |
| B-02 | `ClinicianWorkspaceView.tsx` | Metric values (12/1/6) + `PAT-0042` patient ref in heading and alert | `—` values; empty state card |
| B-03 | `PlatformOverviewView.tsx` | `\|\| 3` fake count; `112`/`0` metric values; inline `KNH`/`AKUH` tenant array | Removed; empty-row `<td>` |
| B-04 | `Dashboard.tsx` | `year`/`all` range options violate 3-month device retention ceiling | Removed from `Range` type, `RANGE_OPTIONS`, `rangeStart()`, `analytics` useMemo |
| B-05 | `PatientLinkingConsentView.tsx` | `PAT-0042`, `PAT-0108`, `Dr. Mwangi, MBChB` in `useState` fixtures | `[]` empty; TODO(Stage C) |
| B-06 | `TenantSettingsView.tsx` | `knh-cardio` slug fallback | Replaced with `''` |
| B-07 | `Options.tsx` | `"Dr. David Omondi, MBChB, MMed"` + `"Kenyatta National Hospital — Clinical Nutrition Unit"` local var fallbacks | Both set to `""`; TODO(Stage C) |
| B-08 | `PatientLinkingConsentView.tsx` comment | Literal `PAT-0042`/`PAT-0108` in comment triggered guard | Reworded |
| B-09 | `UserManagementView.tsx` comment + placeholder | `@knh.or.ke` in comment; `KMPDC/2026/12345` in placeholder triggered guard | Reworded; placeholder → `Reg-No/YYYY/NNNNN` |

**Total: 9 distinct violation sites → 13 ledger entries (some sites had multiple sub-items) → 0 remaining.**

---

## 4. Guard Script Verification

```
> node scripts/check-no-hardcoded-data.mjs
[PASS] No hardcoded patient or clinic-specific data found in src/.
```

Guard exit code: **0** ✅

The guard script is now the first step in the `ci` chain and runs before any build step.
The dist guard runs after build (exits 0 with warning if `dist/` does not exist).

---

## 5. Metric Deltas (Stage B specific)

| Metric | Before Stage B | After Stage B | Delta |
|--------|---------------|---------------|-------|
| Hardcoded patient ref occurrences | 8 (`PAT-0042` × 5, `PAT-0108` × 3) | 0 | −8 |
| Hardcoded clinic email domains | 1 (comment) | 0 | −1 |
| Hardcoded hospital name strings | 3 (`KNH` tenant, `AKUH` tenant, Options.tsx) | 0 | −3 |
| Hardcoded clinician names | 2 (`Dr. Omondi`, `Dr. Mwangi`) | 0 | −2 |
| Range options exceeding 3-month ceiling | 2 (`year`, `all`) | 0 | −2 |
| CI guard scripts | 0 | 2 | +2 |

---

## 6. Known Limitations / TODOs for Stage C

- **`Options.tsx`**: `clinician` and `clinic` variables are now `""` — UI will show blank until OIDC session + tenant API are wired (Stage C)
- **`PatientLinkingConsentView.tsx`**: consent/link lists start empty — needs `GET /patient-links` wiring (Stage C)
- **`ClinicianWorkspaceView.tsx`**: metric cards show `—` — needs live dashboard API (Stage C)
- **`PlatformOverviewView.tsx`**: tenant list shows "No tenants provisioned" message — needs `GET /tenants` (Stage C)

---

## 7. Verdict

Stage B objectives met:
- ✅ 0 hard-coded patient references in `src/`
- ✅ 0 real clinic email domains in `src/`
- ✅ 0 real hospital names or slugs in `src/`
- ✅ 0 real clinician names in `src/`
- ✅ Dashboard range ceiling enforced (3 months, Decision 4)
- ✅ CI guard blocks any regression
- ✅ `HARDCODED_DATA_LEDGER.md` complete (13 entries)
