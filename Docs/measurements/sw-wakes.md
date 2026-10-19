# §3.2 SW Wake Rate Analysis

**Status: Estimated** — production counter needed to confirm.

## Static enumeration of wake events

| Source | Wakes per typical session | Notes |
|---|---|---|
| `chrome.alarms` — entitlement | every 12 h = ~0.5/session | randomised first fire |
| `chrome.alarms` — catalog | every 6 h = ~1/session | randomised first fire |
| `chrome.runtime.onMessage` from content script | 1 per tab message | tabs fire on every page scoring request; 5-10 pages/day = 5-10 wakes |
| `chrome.runtime.onInstalled` | 1 on install/update | not daily |
| Payment/entitlement refresh (`REFRESH_ENTITLEMENT`) | 1 per payment event | rare |
| Cart sync alarm (safety-net) | per alarm period | bounded |

**Estimated per active user per day:** 5–10 (browsing-driven) + 1 (alarm) + incidental = **~10–20 range** for light users, **up to ~100** for heavy users who browse many retailer pages.

The human-stated figure of ~100 wakes/day is plausible for heavy users.

## Consequence at 100 wakes/day (current, before wake-gate — F-01)

- 2 × `NutriEntitlement.refresh()` POST per wake = **200 POST/user/day**
- 1 × `catalog_releases` GET per wake = **100 GET/user/day**
- At 1 M DAU: **200 M POSTs/day = ~2,315 req/s** on `/entitlement`

## After wake-gate fix (Phase 3 — F-01)

- Entitlement: 1 POST per 12 h = **2/day** → **2 M POSTs/day = ~23 req/s** (-99%)
- Catalog manifest: static file on CDN, 304 Not Modified on most hits → **0 Postgres reads**
- **Plain wake: 0 network requests**

## Production instrumentation plan (§3.8)

Add a privacy-safe `sw_wake` counter to `background.js`:

```js
// In the service worker top level (fires on every cold start):
// Aggregated on-device, flushed at most once per day, no identifiers.
(async () => {
  const key = 'sw_wake_today';
  const today = new Date().toISOString().slice(0, 10);
  const stored = (await chrome.storage.local.get(key))[key] ?? { date: today, count: 0 };
  if (stored.date !== today) { stored.date = today; stored.count = 0; }
  stored.count++;
  await chrome.storage.local.set({ [key]: stored });
  // Flush once per day via the catalog alarm handler (already scheduled).
})();
```

The flush path sends only `{ date, count }` to the telemetry Edge Function — no user ID, no product IDs.

## Recommendation

The priority order in the report is **correct**: F-01 (wake-gate) is the single most valuable change, and the ~100/day estimate supports its High/Critical ranking. Proceed with Phase 3 as planned.
