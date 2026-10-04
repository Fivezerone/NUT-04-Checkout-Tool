# UI/UX Forensic & Remediation Engineering Report

**Target:** NutriScore Checkout Tool v1.1.0 (MV3 extension, 82 files, \~12.7k lines) **Method:** Static read of every file named in Pillars I–II plus their direct dependencies. Line numbers refer to the uploaded archive.

## 0. Scope, corrections to the brief, and limits

**Corrections to the brief's assumptions (verified in code):**

- The theme attribute is `data-health-condition`, not `data-health-mode`. A second axis, `data-theme="blue"`, is used by the popup.
- There are **no `.insert()` calls** in the UI. Writes are `.upsert()` (`OnboardingWizard.tsx:393`) and `.update()` (`:164`, `useSubscriptionGuard.ts:82`, `dashboard.tsx:113`). The RLS-dropout risk is real, but it appears as an ignored `.update()` result and an `.upsert()` error path.
- Daraja and Paystack are **not called from the client**. The client invokes the Edge Functions `mpesa-initiate`, `paystack-initiate` and `payment-status`, and listens to a `payments` table over Realtime. Webhook handling lives server-side and **was not in the archive**, so server-side race conditions are *not assessed*.
- `carrefour.js`, `naivas.js` and `quickmart.js` are retailer DOM adapters, not payment adapters. `quickmart.js` is never loaded (see D-21).
- `src/extension/supabase.js` is a minified vendored bundle (supabase-js 2.116.0). Only its last line, the `NutriSupabase.create` wrapper, is project code.

**Not available / not assessed:** Supabase SQL (RLS policies, the `enforce_billing_state` trigger), Edge Function source, `vite`/`tsconfig`, the built `dist/`. Findings that depend on these are marked **(verify)**. Not read line by line: `adapters/naivas.js`, `carrefour.js`, `quickmart.js` (only grepped), `lib/db/*.ts` (same code as the `db.js` bundle), `Options.tsx` and `Popup.tsx` (scanned), and the test files.

**Severity key:** **S1** = money, auth or data-loss, or a core feature never works. **S2** = soft-lock or wrong data shown to a health user. **S3** = degraded UX, accessibility or maintainability.

---

## 1. System-Wide Architectural Mapping

**Three JS runtimes, one storage substrate.**

| Runtime | Entry | Reads/writes |
| --- | --- | --- |
| Service worker | `background.js` → `importScripts(config, supabase, db, entitlement, catalog-sync, health-modes, engine/*)` | IndexedDB `nut04-nutriscore` (v15), `chrome.storage.local` (`nutri_entitlement`, `nutri_time_guard`, `sb-*-auth-token`), Supabase |
| Content script (retailer page) | `grade-colors.js`, `shared-ui.js`, `<adapter>.js`, `content.js` | Page DOM only, plus `chrome.runtime.sendMessage` |
| Extension pages (popup, dashboard, options, onboarding) | `popup.tsx`, `dashboard.tsx`, `options.tsx`, `onboarding.tsx` | `supabase` client (`services/storage.ts`), `chrome.storage.local`, IndexedDB via the **same TS source that `db.js` is bundled from**, `localStorage` (`nutriscore_theme`) |

**Data flow, product badge:** `MutationObserver` → `scanAndInject()` → `CHECK_PRODUCT_SCORES_BATCH` → SW `getProductInfo()` → `initializeDatabases()` (awaits `NutriEntitlement.refresh()` **then** `NutriCatalogSync.ensureReady()`) → a *new* `NutriSupabase` client per product → `resolveTier()` → IDB match → `injectBadge()` (Shadow DOM) and flyout (light DOM, global portal).

**Data flow, account and premium:** Wizard → `supabase.auth` → `users` row (client `upsert`) → Edge Function payment → `payments` row → Realtime/poll → `savePremiumStatus()` writes `nutriscore_is_premium` (**a key the SW never reads**) → the SW only learns of premium when `NutriEntitlement.refresh()` next runs, writing `nutri_entitlement`.

**Theme data flow:** there are four stores and no owner: `localStorage.nutriscore_theme` → `theme-init.js` sets `data-health-condition` pre-paint → `ThemeProvider` mirrors it to IDB `settings.activeTheme` and broadcasts `THEME_CHANGED` → the SW forwards it to tabs → `shared-ui.js` only *closes the flyout* (it never re-renders badges). `BlueThemeProvider` (popup) **removes** the attribute after first paint. `.dark` tokens exist but are never toggled.

**Where this architecture leaks:**

1. Premium truth has two storage keys and two refresh paths (D-04).
2. Supabase has **two client configurations** (`autoRefreshToken: true` in the UI, `false` in the SW), a **new client per product** in the SW, and one shared refresh-token slot (D-05).
3. Subscription logic is implemented **three times** (`useSubscriptionGuard`, `redirectAfterLogin`, `checkSubscriptionAndProfile`) with contradictory sign-out behaviour. Two of the artifacts (`useSubscriptionGuard.ts`, `SubscriptionExpiredPage.tsx`) have zero consumers.
4. `src/extension/db.js` is a **build artifact** (`// src/ui/src/app/lib/db/shared.ts` banner) committed as source, as is `health-modes.js`.

---

## 2. Comprehensive Vulnerability & Error Inventory

Each entry has a root cause and a fix. Fixes are written to drop in; adapt names to your tree.

---

### \[D-01: Payment-UI-CancelSoftLock\] **S1**

- **File Path:** `src/ui/src/app/components/OnboardingWizard.tsx:1047-1057`, `src/ui/src/app/hooks/usePaymentState.ts:40-41`
- **Visual & Functional Impact:** After tapping "Cancel Verification & Go Back" the spinner never leaves. The Pay button is hidden (`:1119`) and Back is disabled (`:1087`). The only exit is reloading the tab. The STK push may still complete after cancel, so the user can be charged with no UI path to reconcile.
- **Root Cause Technical Analysis:** Cancel nulls `activePaymentRef/Method`, and the hook's effect early-returns (`if (!transactionRef || !method) return;`). **Nothing resets `status`**, which stays `'processing'`. The comment at `:1052` ("controlled by usePaymentState") is the bug.
- **Refactored Production Solution:**

```ts
// usePaymentState.ts — replace the early return
useEffect(() => {
  if (!transactionRef || !method) {
    setStatus(prev => (prev === 'processing' ? 'idle' : prev));
    return;
  }
  setStatus('processing');
  // ...unchanged
}, [transactionRef, method]);
```

```tsx
// OnboardingWizard.tsx — cancel handler: clear local state, keep the ref for late reconciliation
onClick={async () => {
  await ExtensionStorage.setActivePayment(null, null);
  setActivePaymentRef(null);
  setActivePaymentMethod(null);
  setPaymentStatus('idle');
  setError('Verification cancelled. If you already approved the prompt on your phone, '
         + 'your premium will activate within a few minutes — do not pay again.');
}}
```

---

### \[D-02: Payment-PollingDeadEnds\] **S1**

- **File Path:** `src/ui/src/app/hooks/usePaymentState.ts:63-98`
- **Visual & Functional Impact:** Three silent spinner dead-ends: (a) no session → permanent spinner; (b) any persistent poll error (401/403/500) → infinite fixed-interval retries and a permanent spinner; (c) the Realtime fast path reports success **without a token** (D-03).
- **Root Cause Technical Analysis:** (a) `if (!accessToken || !user) return;` (`:68`) exits without rescheduling or erroring. (b) The `catch` reschedules with an **unchanged** backoff and has no attempt cap. (c) `channel.subscribe()` has no status callback, so channel errors are invisible (polling masks it, but nothing is logged). Realtime also only delivers rows the user's RLS lets them `SELECT` **(verify)**.
- **Refactored Production Solution:**

```ts
const MAX_ATTEMPTS = 14;
let attempts = 0;
const pollStatus = async () => {
  attempts++;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('NO_SESSION');
    const { data, error } = await supabase.functions.invoke('payment-status',
      { body: { transaction_ref: transactionRef, method } });
    if (error) throw error;
    if (data?.status === 'completed') return handleSuccess(data.token);
    if (data?.status === 'failed' || data?.status === 'cancelled')
      return handleFailure('Payment failed or was cancelled.');
  } catch (err: any) {
    if (err?.message === 'NO_SESSION')
      return handleFailure('Your session expired. Sign in again — if you paid, your premium will still activate.');
    console.error('Polling error:', err);
  }
  if (attempts >= MAX_ATTEMPTS)
    return handleFailure('We could not confirm your payment yet. If you were charged, contact support with ref ' + transactionRef);
  backoffRef.current = Math.min(backoffRef.current * 1.5, 30_000);
  pollTimerRef.current = setTimeout(pollStatus, backoffRef.current);
};
channel.subscribe((s) => { if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') console.warn('[payment] realtime degraded, polling only'); });
```

---

### \[D-03: Payment-OptimisticSuccessWithoutVerification\] **S1**

- **File Path:** `usePaymentState.ts:53-58`, `OnboardingWizard.tsx:92-95, 425`
- **Visual & Functional Impact:** The Realtime branch calls `handleSuccess()` (no token) → `savePremiumStatus(token || 'LEGACY_TRUE')`, the exact "client flips to Paid before backend verification" pattern. The fallback string is stored as the "premium token". It is **inert in the SW** (the SW verifies an ES256 JWT), so there is no free-premium exploit, but the UI shows "Payment Successful" and the popup dev-fallback treats `LEGACY_TRUE` (length 11 > 10) as premium (`popup.tsx:47`).
- **Root Cause Technical Analysis:** Success is decided from a Realtime payload instead of from the verified `payment-status` response. `LEGACY_TRUE` is write-only legacy.
- **Refactored Production Solution:**

```ts
// Realtime handler: treat as a hint, then verify once via the authoritative endpoint
(payload) => {
  if (payload.new.status === 'completed') { void pollStatus(); }        // verify, never trust
  else if (payload.new.status === 'failed') handleFailure('Payment failed or was cancelled.');
}
// OnboardingWizard onSuccess — require a token
onSuccess: async (ref, method, token) => {
  if (!token) { setError('Payment confirmed but entitlement is still syncing. Please wait…'); return; }
  await savePremiumStatus(token);
  await finishOnboarding(ref, method === 'mpesa' ? 'Mobile Money' : 'Card');
},
```

Also delete both `'LEGACY_TRUE'` fallbacks (`:93`, `:425`).

---

### \[D-04: Entitlement-KeyMismatchAndActivationLag\] **S1**

- **File Path:** `storage.ts:201-215`, `entitlement.js:21,126,171`, `dashboard.tsx:208-217`, `background.js:27-49`
- **Visual & Functional Impact:** A paying user finishes checkout and the badges stay "basic" until the SW happens to sleep and re-wake. Nothing triggers `NutriEntitlement.refresh()` after payment.
- **Root Cause Technical Analysis:** The UI writes the token to `nutriscore_is_premium` and a dead IDB key (`isPremium`; `settings.ts:23` says it is no longer read). The SW reads only `nutri_entitlement`, written solely inside `refresh()`, which runs once per SW wake via the cached `initPromise`. There is no `REFRESH_ENTITLEMENT` message.
- **Refactored Production Solution:**

```js
// entitlement.js: also accept a pushed token (after verifying it)
async function adopt(token, uid) {
  const r = await verifyToken(token, uid);
  if (r.valid) await chrome.storage.local.set({ [STORAGE_KEY]: token });
  return r.valid;
}
return { resolveTier, refresh, clear, verifyToken, adopt };

// background.js
if (message.action === 'REFRESH_ENTITLEMENT') {
  (async () => {
    const tier = await NutriEntitlement.refresh();
    sendResponse({ tier });
  })();
  return true;
}
```

```ts
// storage.ts — replace savePremiumStatus body; stop writing the dead IDB key
export const savePremiumStatus = async (token: string | false) => {
  if (token) await chrome.storage.local.set({ nutri_entitlement: token });
  else await chrome.storage.local.remove('nutri_entitlement');
  await chrome.runtime.sendMessage({ action: 'REFRESH_ENTITLEMENT' }).catch(() => {});
};
```

---

### \[D-05: Auth-MultiClientRefreshStorm\] **S1**

- **File Path:** `background.js:138, 267`, `entitlement.js:146`, `supabase.js` (tail), `services/storage.ts:56-63`
- **Visual & Functional Impact:** Users are randomly signed out and premium vanishes. A page with 40 products produces 40 parallel `getSession()` calls.
- **Root Cause Technical Analysis:** `NutriSupabase.create()` runs **per product** in `getProductInfo` (via `CHECK_PRODUCT_SCORES_BATCH` → `Promise.all`). `refreshingDeferred` is per instance, so N clients can each POST the same refresh token when the access token is near expiry. Rotation/reuse detection can then revoke the session. The UI client additionally auto-refreshes with a different config (`autoRefreshToken:true`) against the same `sb-…-auth-token` key.
- **Refactored Production Solution:**

```js
// background.js — module singleton + memoised tier
let _sb;
const sb = () => (_sb ??= NutriSupabase.create(NUTRI_CONFIG.SUPABASE_URL, NUTRI_CONFIG.SUPABASE_ANON_KEY));
let _tier, _tierAt = 0;
async function currentTier() {
  if (_tier && Date.now() - _tierAt < 30_000) return _tier;
  const { data: { session } } = await sb().auth.getSession();
  _tier = (await NutriEntitlement.resolveTier(session?.user?.id)).tier;
  _tierAt = Date.now();
  return _tier;
}
// getProductInfo: const tier = await currentTier();  — one resolution per batch, not per item
```

Replace the three other `NutriSupabase.create` sites with `sb()`. Invalidate `_tier` in the `REFRESH_ENTITLEMENT` handler.

---

### \[D-06: Entitlement-TokenWipeOnTransientFailure\] **S1**

- **File Path:** `entitlement.js:150-177`
- **Visual & Functional Impact:** A paying user goes offline (laptop asleep > 1 h, access token expired), the SW wakes, `getSession()` returns null, and `clear()` **deletes the valid premium token**. The same happens on any 401/5xx JSON body.
- **Root Cause Technical Analysis:** `if (!session) { await clear(); }` conflates "signed out" with "could not refresh". `res.ok` is never checked, so `{message:"…"}` falls through to `clear()`. `fetch` has no timeout.
- **Refactored Production Solution:**

```js
async function refresh() {
  try {
    const sb = NutriSupabase.create(NUTRI_CONFIG.SUPABASE_URL, NUTRI_CONFIG.SUPABASE_ANON_KEY);
    const { data: { session }, error } = await sb.auth.getSession();
    if (!session) {
      // only a definitive auth failure may revoke
      const definitive = error && /refresh_token_not_found|invalid_grant|session_not_found/i.test(error.code || error.message || '');
      if (!error || definitive) await clear();
      return (await resolveTier(null)).tier === 'premium' ? 'premium' : 'basic';
    }
    const res = await fetch(`${NUTRI_CONFIG.SUPABASE_URL}/functions/v1/entitlement`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!res.ok) return 'unchanged';                 // keep whatever token we have
    const data = await res.json();
    await updateTimeGuard(data.server_now ? Date.parse(data.server_now) : null);
    if (data.tier === 'premium' && data.token) { await chrome.storage.local.set({ [STORAGE_KEY]: data.token }); return 'premium'; }
    if (data.tier === 'basic') { await clear(); return 'basic'; }   // only an explicit basic revokes
    return 'unchanged';
  } catch { return 'unchanged'; }
}
```

---

### \[D-07: Entitlement-ClockGuardPermanentLockout\] **S2**

- **File Path:** `entitlement.js:43-56`
- **Visual & Functional Impact:** If a device clock was ever ahead by > 5 min (dead CMOS battery, wrong date, DST mistake) and then corrected, **premium is forced to basic permanently**, with no recovery or message.
- **Root Cause Technical Analysis:** `maxLocalSeen = Math.max(stored, Date.now())` can only increase. `lastServerNow` is stored but never used.
- **Refactored Production Solution:**

```js
async function updateTimeGuard(serverNow) {
  const stored = (await chrome.storage.local.get(TIME_GUARD_KEY))[TIME_GUARD_KEY] ?? {};
  let maxLocalSeen = Math.max(stored.maxLocalSeen ?? 0, Date.now());
  // A trusted server clock caps the high-water mark, so a once-wrong clock self-heals.
  if (serverNow) maxLocalSeen = Math.min(maxLocalSeen, serverNow + CLOCK_SKEW_MS);
  await chrome.storage.local.set({ [TIME_GUARD_KEY]: { maxLocalSeen, lastServerNow: serverNow ?? stored.lastServerNow } });
  return maxLocalSeen;
}
```

Surface a "Check your device clock" notice instead of silently downgrading.

---

### \[D-08: Billing-ClientWritesEntitlementFields\] **S1 (verify)**

- **File Path:** `OnboardingWizard.tsx:393-410`, `:164-168`, `useSubscriptionGuard.ts:82-85`, `dashboard.tsx:113-116`
- **Visual & Functional Impact:** If RLS lets users update their own `users` row without column restrictions, anyone can set `is_premium=true, subscription_status='active'` from the console. The comments say `enforce_billing_state` neutralises this, and I cannot see that trigger.
- **Root Cause Technical Analysis:** The client writes billing columns. Also `amount: packagePrice` (`:473,507`) is client-supplied to the payment Edge Functions, and price (`189`) is duplicated in `SubscriptionExpiredPage.tsx:86`.
- **Refactored Production Solution:**

```ts
// Client: write profile fields only
.upsert({ id: userId, full_name, email, dob: dob || null, gender: gender || null, condition, metric,
          notification_frequency: notificationFrequency, terms_accepted: termsAccepted,
          privacy_accepted: privacyAccepted, onboarding_completed: true,
          health_mode: condition !== 'general', selected_tags: [condition, metric].filter(Boolean) },
         { onConflict: 'id' })
```

```sql
-- Server: make billing columns immutable for the authenticated role (verify against your trigger)
revoke update (is_premium, subscription_status, payment_received_at, trial_started_at) on public.users from authenticated;
```

Edge Functions must compute the amount server-side and ignore `body.amount`.

---

### \[D-09: Onboarding-RenewalClobbersProfileAndSoftLocks\] **S1**

- **File Path:** `OnboardingWizard.tsx:246-249, 343-349, 393-410, 536-541, 507`
- **Visual & Functional Impact:** Four linked failures on **renew** (expired users, the people most likely to pay):
  1. `processSession` returns on `initialMode==='renew'` **before** `getActivePayment()`, so an in-flight payment is never recovered, which invites a **double charge**.
  2. `handlePayment` demands `termsAccepted && privacyAccepted`, but **step 5 has no checkboxes**. If `partial_onboarding` is missing (new browser profile, cleared storage), the user hits "Please accept…" with nothing to click.
  3. `finishOnboarding` upserts the whole profile from wizard state. With empty state it writes `dob:''` (invalid for a `date` column → 22007 **(verify)**), `condition:''` and `health_mode:true` over the saved profile, and re-stamps `consent_timestamp: now`.
  4. Paystack uses `email.trim() || "user@example.com"` (`:507`) although `user.email` is in scope, which misattributes receipts.
- **Root Cause Technical Analysis:** The renew path reuses the signup wizard's *form state* as its source of truth.
- **Refactored Production Solution:**

```tsx
// 1. recover pending payment first, in every mode
const pending = await ExtensionStorage.getActivePayment();
if (pending.ref && pending.method) { setActivePaymentRef(pending.ref); setActivePaymentMethod(pending.method); setStep(5); return; }
if (initialMode === 'renew') { setStep(5); setWizardMode('signup'); return; }

// 2. renew never rewrites profile/consent
const isRenewal = initialMode === 'renew';
const payload = isRenewal ? { id: userId } : { id: userId, /* …profile fields… */ };

// 3. Paystack email
body: { email: user.email! }
```

Render the two consent checkboxes in step 5 whenever `!termsAccepted || !privacyAccepted`.

---

### \[D-10: Onboarding-ProfileSaveFailureDeadEnd\] **S1**

- **File Path:** `OnboardingWizard.tsx:412-427, 1061-1068, 1087`
- **Visual & Functional Impact:** If the profile upsert fails after payment, the user sees **"Payment Successful! Redirecting…"** and an error banner together, with Back disabled and no retry. The error text leaks internals ("INSERT policy … may be missing").
- **Root Cause Technical Analysis:** The hook sets `status='success'` before `finishOnboarding` runs. The failure path returns without a retry affordance, and `activePayment` is left set, so only a reload recovers.
- **Refactored Production Solution:**

```tsx
const [finishError, setFinishError] = useState<string | null>(null);
// in finishOnboarding failure branch:
setFinishError(`Payment received (ref ${paymentRef}). We couldn't save your profile yet — your premium is safe. Please retry.`);
return;
// in step-5 success block:
{finishError ? (<><p role="alert" className="text-sm text-destructive">{finishError}</p>
  <button onClick={() => { setFinishError(null); void finishOnboarding(activePaymentRef!, 'Mobile Money'); }}>Retry saving profile</button></>)
 : <p className="text-sm font-semibold">Payment confirmed. Setting up your account…</p>}
```

Log the raw `upsertError` to console only.

---

### \[D-11: Auth-BlankRootAndSignOutOnTransientError\] **S1**

- **File Path:** `dashboard.tsx:164-225, 99-103, 139-143, 237`; `popup.tsx:33-63, 128`
- **Visual & Functional Impact:** (a) `init()` has no try/catch and `if (!ready) return null;`, so **any rejection = permanent blank white page**. (b) `popup.tsx` `resolveAuthState()` also lacks try/catch, so `authState` stays `'checking'` and the popup is blank forever. (c) A transient 5xx or offline error on the `users` read calls `signOutUser()`, which destroys the session and the entitlement token. (d) `getUser()` failing offline returns `user:null`, so an offline user gets the **login modal**.
- **Root Cause Technical Analysis:** All failure classes are collapsed into "unauthenticated". `getUser()` makes a network call and returns `{user:null,error}` on network failure.
- **Refactored Production Solution:**

```tsx
type Boot = 'loading' | 'ready' | 'offline' | 'unauth';
async function init() {
  try {
    const { data: { session } } = await supabase.auth.getSession();       // local, no network
    if (!session) return setBoot('unauth');
    const res = await checkSubscriptionAndProfile(session.user.id, fallbackName);
    if (res.kind === 'transient') return setBoot('offline');               // keep session!
    /* …unchanged… */
  } catch (e) { console.error(e); setBoot('offline'); }
}
// checkSubscriptionAndProfile: signOut ONLY on error.code in ['PGRST301','401','403'] (JWT invalid)
if (boot === 'offline') return <ConnectionProblem onRetry={init} />;       // never null
```

`popup.tsx`: wrap in `try { … } catch { setAuthState('returning'); }` and do not render `null` for more than \~1 s.

---

### \[D-12: Subscription-LogicTripled / BasicTierRedirectLoop / DeadComponents\] **S2**

- **File Path:** `dashboard.tsx:119-125`, `useSubscriptionGuard.ts`, `SubscriptionExpiredPage.tsx`, `OnboardingWizard.tsx:158-176`
- **Visual & Functional Impact:** Users on the **Basic plan** ("Start Basic Plan") are redirected from the dashboard to `onboarding.html?mode=renew` (a payment page labelled "renew") and can never open it. The dashboard also leaves the `unauthenticated` login modal mounted until navigation fires (flash of login UI for a signed-in user). The polished "Subscription Expired" screen is never shown.
- **Root Cause Technical Analysis:** `resolved === 'basic'` is treated like `'expired'`. `useSubscriptionGuard` and `SubscriptionExpiredPage` have **zero importers**. `AuthState 'basic'` and `{!profile && <OnboardingWizard/>}` are unreachable.
- **Refactored Production Solution:** Keep one hook and render, don't redirect:

```tsx
const { status, daysRemaining } = useSubscriptionGuard();     // add transient/error status per D-11
if (status === 'loading') return <Skeleton />;
if (status === 'expired') return <SubscriptionExpiredPage />;
if (status === 'basic') return <BasicDashboard onUpgrade={openRenew} />;
```

Delete `checkSubscriptionAndProfile`'s duplicate expiry logic and the second copy in `redirectAfterLogin`. Remove the silent `.update()` calls (the trigger is authoritative) or at least check `{error}`.

---

### \[D-13: Content-DiseaseWarningsNeverRender\] **S1**

- **File Path:** `adapters/shared-ui.js:243-280`, `manifest.json:22-27,35-40`, `health-modes.js:2`
- **Visual & Functional Impact:** The product's core premium feature (diabetes / hypertension / kidney / obesity warning chips and the upsell) **never appears in the flyout**. This contradicts the "warning modules verified" claim in the deck, whose engines are correct but whose display path is broken.
- **Root Cause Technical Analysis:** `self.NutriHealthModes` is defined only in `health-modes.js`, which is loaded by the SW's `importScripts`. It is **not listed in either `content_scripts` block**. In the content script's isolated world it is `undefined`, so `tc = null` and the `activeTheme !== "general" && tc` branch is skipped for every mode.
- **Refactored Production Solution:**

```json
// manifest.json — both content_scripts blocks
"js": ["health-modes.js", "adapters/grade-colors.js", "adapters/shared-ui.js", "adapters/naivas.js", "content.js"]
```

and fail loudly in `shared-ui.js`:

```js
if (activeTheme !== 'general' && !modeObj) console.error('[NutriScore] NutriHealthModes missing in content world');
```

Add a build check that every `self.Nutri*` global referenced in `adapters/*.js` is in the manifest list for that script.

---

### \[D-14: Content-UpsellCTADoublyDead\] **S2**

- **File Path:** `shared-ui.js:254-260`, `background.js` (no `OPEN_UPGRADE` handler)
- **Visual & Functional Impact:** "Upgrade to Premium" does nothing.
- **Root Cause Technical Analysis:** Inline `onclick="chrome.runtime.sendMessage(…)"` in the page's light DOM runs in the **page's main world**, where `chrome.runtime` is unavailable, and is blocked by strict page CSP. Even if sent, the SW has no `OPEN_UPGRADE` branch.
- **Refactored Production Solution:**

```js
// shared-ui.js: build the node, attach the listener in the content-script world
const cta = flyoutEl.querySelector('[data-ns-upgrade]');
cta?.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'OPEN_UPGRADE' }).catch(() => {}));
// background.js
if (message.action === 'OPEN_UPGRADE') {
  chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html?mode=renew') });
  return false;
}
```

Replace the `onmouseover/onmouseout` attributes with a CSS `:hover` rule.

---

### \[D-15: Content-FlyoutToggleAndStaleStateBugs\] **S2**

- **File Path:** `shared-ui.js:195-199, 336, 365-373, 56-72, 385-394`; `content.js:60`
- **Visual & Functional Impact:** (a) Clicking an open badge closes and **instantly reopens** the flyout (cannot toggle off). (b) The `outsideClick` capture listeners **leak**: they are removed only on an outside click, not on close-button, scroll, theme change or opening another flyout. (c) On Livewire/SPA body swaps, the cached `window._nutriscoreGlobalPortal` can be detached, so **badge clicks do nothing**. (d) After switching health mode or upgrading, **existing badges keep stale `productResult`** (old mode and tier); the `THEME_CHANGED` handler only closes the flyout.
- **Root Cause Technical Analysis:** (a) `ev.target !== trigger` compares a retargeted shadow host with an inner element, so it is always true. (c) No `isConnected` check. (d) `content.js` never handles `THEME_CHANGED`; there is no re-scan.
- **Refactored Production Solution:**

```js
// (a)+(b) one managed listener
_closeActiveFlyout() {
  window._nutriscoreActiveFlyout?.remove(); window._nutriscoreActiveFlyout = null;
  if (window._nutriscoreOutside) { document.removeEventListener('click', window._nutriscoreOutside, true); window._nutriscoreOutside = null; }
},
// in click handler, before opening:
const wasOpen = window._nutriscoreActiveFlyout && window._nutriscoreActiveTrigger === trigger;
NutriSharedUI._closeActiveFlyout(); if (wasOpen) return;
window._nutriscoreActiveTrigger = trigger;
window._nutriscoreOutside = (ev) => { if (!ev.composedPath().includes(flyoutEl) && !ev.composedPath().includes(trigger)) NutriSharedUI._closeActiveFlyout(); };
setTimeout(() => document.addEventListener('click', window._nutriscoreOutside, true), 0);
// (c)
if (window._nutriscoreGlobalPortal?.isConnected) return window._nutriscoreGlobalPortal;
```

```js
// (d) content.js
rescan() { this.processedElements = new WeakSet(); this.notFoundCache.clear();
  document.querySelectorAll('.nutriscore-isolated-root').forEach(n => n.remove());
  document.querySelectorAll('[data-nutriscore-scanned]').forEach(n => n.removeAttribute('data-nutriscore-scanned'));
  this.scanAndInject(); }
// in onMessage: if (msg.action === 'THEME_CHANGED' || msg.action === 'TIER_CHANGED') this.rescan();
```

---

### \[D-16: Content-PendingAndNotFoundPoisoning\] **S2**

- **File Path:** `content.js:205-264, 68-83, 142-164, 32-56`; `background.js:20-49, 312-330`
- **Visual & Functional Impact:** (a) A transient SW or network failure marks **every product "not-found" for the life of the tab**. (b) If `injectBadge` throws on one card (DOM changed), the loop aborts and the remaining cards stay `pending` forever. (c) The observer reacts to its **own** injected badges (feedback loop) and re-runs `syncCart` every second on any DOM churn. (d) After an extension update, `chrome.runtime.sendMessage` throws "Extension context invalidated" unguarded in click and timer paths. (e) `processedElements` is a strong `Set` of DOM nodes (leak on infinite scroll).
- **Root Cause Technical Analysis:** Failure and "genuinely unknown" share one cache. No per-item `try/catch`. Mutations are not filtered. `syncCart` awaits `fetchCartFromAPI()` unguarded.
- **Refactored Production Solution:**

```js
const safeSend = (msg, cb) => { try { return chrome.runtime.sendMessage(msg, cb); } catch { return undefined; } };
// only cache true not-found (res.error startsWith 'Product not found'), never infra errors
if (res.status !== 'SUCCESS') {
  const definitive = /^Product not found/.test(res.error || '');
  card.setAttribute('data-nutriscore-scanned', definitive ? 'not-found' : 'error');
  if (definitive && cacheKey) this.notFoundCache.add(cacheKey); else this.processedElements.delete(card);
  return;
}
try { this.adapter.injectBadge(card, product, payload.price); } catch (e) { console.warn(e); this.processedElements.delete(card); }
// observer: ignore our own nodes
const relevant = mutations.some(m => ![...m.addedNodes, ...m.removedNodes].every(n => n.nodeType === 1 && (n.classList?.contains('nutriscore-isolated-root') || n.id === 'nutriscore-global-portal')));
// syncCart
let apiItems = []; try { apiItems = (await this.adapter.fetchCartFromAPI()) ?? []; } catch {}
```

Use `WeakSet` for `processedElements`.

---

### \[D-17: SW-InitBlocksEveryProductOnUnboundedNetwork\] **S2**

- **File Path:** `background.js:29-49, 89, 123-125`; `entitlement.js:156`; `background.js:58-86, 336-496`
- **Visual & Functional Impact:** If the entitlement call stalls (common on flaky mobile data), **all** scoring waits indefinitely, so every card stays `pending` and no badge appears. When init throws, the cart handlers do `await initializeDatabases()` **outside** their `try`, so `SYNC_CART_STATE` never calls `sendResponse` and the cart event is lost before it is even persisted. Entitlement refresh also runs on **every SW wake**.
- **Root Cause Technical Analysis:** Serial `await refresh(); await ensureReady();`, no timeout, no separation of "must have catalog" from "nice to have entitlement". Handlers returning `true` without ever responding (LOG_CART_ADD, REMOVE_CART_ITEM, CART_CLEARED, ORDER_PLACED, THEME_CHANGED) hold ports open.
- **Refactored Production Solution:**

```js
initPromise = (async () => {
  void NutriEntitlement?.refresh();                    // non-blocking, with its own 5 s timeout (D-06)
  await NutriCatalogSync.ensureReady();
})().catch(e => { initPromise = null; throw e; });
// handlers: wrap init inside try; always respond
(async () => { try { await initializeDatabases(); /* … */ sendResponse({ ok: true }); }
               catch (e) { sendResponse({ ok: false, error: String(e) }); } })();
```

Throttle entitlement refresh with a `chrome.alarms` period (e.g. 6 h) plus `REFRESH_ENTITLEMENT`, not per wake.

---

### \[D-18: DB-ClosedConnectionNeverReopened\] **S2**

- **File Path:** `db.js:307-310` (bundled from `ui/src/app/lib/db/shared.ts`); `services/storage.ts:206-214`
- **Visual & Functional Impact:** After an extension update bumps `DB_VERSION`, an old tab's connection is closed on `blocking` but `dbPromise` still points to the closed DB, so **every later call throws `InvalidStateError`** until the page/SW restarts. Separately, `savePremiumStatus` opens a raw connection that is **never closed** and has no `onversionchange`, which can itself block upgrades.
- **Refactored Production Solution:**

```ts
blocking() { const p = dbPromise; dbPromise = null; p?.then(db => db.close()); },
terminated() { dbPromise = null; },
```

Delete the raw `indexedDB.open('nut04-nutriscore')` block in `savePremiumStatus` (see D-04).

---

### \[D-19: SW-ProductResultDropsEvidenceLevel / ZeroHiding / FloatNoise\] **S2**

- **File Path:** `background.js:183-213, 111`; `shared-ui.js:133, 152-163`
- **Visual & Functional Impact:** (a) The flyout always says "**Unknown provenance**" even for "High confidence", because `getProductInfo` does not copy `evidenceLevel` from `interpretProduct`. This actively undermines trust. (b) `Number(r.val) !== 0` hides **0 g sugar / 0 mg sodium / 0 g sat fat**, so a sugar-free product looks like it lacks data, which matters most to diabetes and hypertension users. (c) `EnergyKcal * 4.184` is unrounded, so values like `1255.2000000000002 kJ` can render.
- **Refactored Production Solution:**

```js
// background.js
evidenceLevel: interpretation.evidenceLevel, valueSpecificity: interpretation.valueSpecificity,
// buildNutritionalProfileDisplay
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
energy_kj: round(parseNumeric(...), 0),
// shared-ui.js
.filter(r => r.val !== null && r.val !== undefined && r.val !== '')
```

---

### \[D-20: Cache-PremiumFieldsRaceIntoProductCache\] **S3**

- **File Path:** `background.js:215-219`
- **Impact / Root Cause:** `saveProduct(cacheKey, result)` is fire-and-forget, then `appendPremiumAssessment(result)` mutates the **same object**. IndexedDB clones at `put()` time, which happens after an `await getDB()`, so `tier/isPremium/activeTheme` can land in the shared product cache. The cache-hit path overwrites them, so this is non-deterministic rather than a leak.
- **Fix:**

```js
NutriScoreDB.saveProduct(cacheKey, structuredClone(result)).catch(() => {});   // before any enrichment
```

---

### \[D-21: Dead / Unwired Code\] **S3**

- **Files:** `adapters/quickmart.js` (317 lines; no manifest entry, no host permission); `background.js:515-580` (`oauth_login`, no senders; it also logs the auth URL); `SubscriptionExpiredPage.tsx`, `useSubscriptionGuard.ts`; `ExtensionStorage.setOnboardingComplete`; `default_shadcn_theme.css` (not imported); `.dark` token block and `@custom-variant dark` (never toggled); `HBarChart` (imported in `Dashboard.tsx:14`, unused); `rangeStart()` (`Dashboard.tsx:45`); `window.applyPersonalization` (`Dashboard.tsx:191-197` never defined); `useState` import in `Charts.tsx`.
- **Impact:** Larger audit surface (`oauth_login` returns raw tokens to any extension sender), and a false sense of coverage. Delete or wire each.

---

### \[D-22: Privacy-PartialOnboardingPIINeverPurged\] **S1**

- **File Path:** `OnboardingWizard.tsx:272-285`, `storage.ts:152-175, 77-90`, `dashboard.tsx:199-206`
- **Visual & Functional Impact:** On every keystroke, **name, email, DOB, gender, health condition and M-Pesa number** are written in clear text to `chrome.storage.local` under `partial_onboarding`. It is **never deleted** (`setOnboardingComplete`, the only remover, is never called). `signOutUser` does not clear it, nor `user_account`, `activePaymentRef` or `onboarding_completed`. On a shared PC (cyber café), the next user's signup form is pre-filled with the previous person's health data, and `onboarding_completed=true` can **skip onboarding** for a different account (`dashboard.tsx:200`). Health data is "sensitive personal data" under Kenya's Data Protection Act, 2019 (confirm with counsel).
- **Refactored Production Solution:**

```ts
const USER_KEYS = ['partial_onboarding','user_account','user_preferences','user_payment',
  'onboarding_completed','activePaymentRef','activePaymentMethod','nutri_entitlement','nutriscore_is_premium'];
export const signOutUser = async () => {
  try { await supabase.auth.signOut(); } catch {}
  await chrome.storage.local.remove(USER_KEYS);
  localStorage.removeItem('nutriscore_theme');
};
// finishOnboarding: await chrome.storage.local.remove('partial_onboarding');
// persist partial state without mpesaPhone, dob, gender; debounce 500 ms
```

Also bind `onboarding_completed` to the user id (`onboarding_completed_for: userId`).

---

### \[D-23: Theme-GeneratedPaletteImportInvalid / DualAxis / FOUC\] **S2 (verify)**

- **File Path:** `styles/theme.css:60`, `public/theme-init.js`, `context/BlueThemeProvider.tsx:7-10`, `popup.html`
- **Visual & Functional Impact:** (a) `@import url("./health-modes.generated.css")` appears **after** rules. `@import` must precede all rules, so browsers ignore it and bundlers warn or drop it. If dropped, **no health palette ever applies** (every mode renders the General green). Check the built CSS: `grep -c 'data-health-condition' dist/assets/*.css` (0 = broken). (b) The popup loads `theme-init.js` (sets the health attribute) and then `BlueThemeProvider` **removes** it after React mounts: a palette flash on every popup open. (c) The health palettes are light-only; `.dark` never composes with them.
- **Refactored Production Solution:**

```css
/* index.css — imports first */
@import './tailwind.css';
@import './health-modes.generated.css';
@import './theme.css';
@import './globals.css';
```

```html
<!-- popup.html: no theme-init.js; set the axis server-side -->
<html lang="en" data-theme="blue">
```

Remove the `@import` line from `theme.css`.

---

### \[D-24: Theme-TokenBypass & PaletteDivergence\] **S2**

- **File Path:** `globals.css:3-14` vs `adapters/grade-colors.js:2-6`; `Charts.tsx` (`#fff #f2f2f2 #ccc #eee #f9a825`); `OnboardingWizard.tsx`, `Options.tsx`, `SubscriptionExpiredPage.tsx`; `options.html`/`onboarding.html` (`#f8fafc`)
- **Visual & Functional Impact:** `globals.css` claims to be the "single source of truth" for grade colours, but the retailer-page badge uses a **different palette**. Contrast measured:

| Grade | Page badge (`grade-colors.js`) | Dashboard chart label (white on `globals.css`) |
| --- | --- | --- |
| A | 4.90 (pass) | 5.38 |
| B | **2.67 (fail)** | **2.30 (fail)** |
| C | 12.49 | **1.53 (fail)** |
| D | **2.94 (fail)** | **2.70 (fail)** |
| E | **4.18 (borderline fail)** | 4.15 (borderline fail) |

`globals.css` already defines accessible `--ns-on-grade-*` foregrounds (B 6.14:1, C 8.76:1), which the charts ignore. Token usage (counted): **358 raw palette classes vs 101 token usages** across TSX. `OnboardingWizard.tsx` has 147 raw / **0 token**; `Options.tsx` 108 / **0**; `SubscriptionExpiredPage.tsx` 19 / 0. The wizard's primary buttons are hard-coded `blue-600`, so they ignore the active health palette.

- **Refactored Production Solution:**

```js
// generate grade-colors.js from the same JSON as globals.css (build step), including `on` colours
window.NutriScoreGradeColors = {
  A:{bg:"#037b3e",txt:"#ffffff"}, B:{bg:"#85bb2f",txt:"#14320a"}, C:{bg:"#fecb02",txt:"#3a2e00"},
  D:{bg:"#ee8100",txt:"#331c00"}, E:{bg:"#e63e11",txt:"#ffffff"} };
```

```tsx
// Charts.tsx segment label
fill={`var(--ns-on-grade-${seg.grade.toLowerCase()})`}   // delete textShadow hack
```

Add `eslint-plugin-tailwindcss` `no-arbitrary-value` / a lint rule banning `\b(bg|text|border)-(slate|blue|green|red)-\d+` and `#[0-9a-f]{6}` outside `styles/`.

---

### \[D-25: Chart-EmptyAndInvalidDataStates\] **S2**

- **File Path:** `Charts.tsx:64-70, 237-265, 304-311, 415, 463, 467-481`; `ChartBox.tsx:26`; `Dashboard.tsx:222-225, 292`
- **Visual & Functional Impact:**
  - `DonutChart` with `total===0` renders a **blank grey disc** (`#f2f2f2`, no label, no role). The default for a new user (`analytics===null` → `basketData=[]`).
  - `LineTrend` with a non-empty array of all zeros draws an **empty grid** (the "No data" text only handles `length===0`). A **single point draws no mark at all**.
  - `HBarChart`: negative `barH` when `data.length` is large → invalid SVG rects.
  - `StackedHBarChart` with all-zero spend: `maxVal=1` produces axis labels "0 / 1 / 1 / KES 1". `.slice(0,7)` silently drops categories without an "Other" roll-up.
  - `ChartBox` renders `null` while `width===0` (also when a tab is `display:none`): blank gap, no skeleton.
  - Any `NaN` value yields `NaN` SVG attributes and a "NaN% DV" tooltip.
  - **No `ErrorBoundary` exists anywhere**, so a single render exception blanks the whole dashboard.
- **Root Cause Technical Analysis:** Each chart handles at most one empty case; none validates numeric input; no shared empty-state component.
- **Refactored Production Solution:**

```tsx
// ChartBoundary.tsx
export class ChartBoundary extends React.Component<{label:string; children:React.ReactNode},{err:boolean}> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() { return this.state.err
    ? <div role="alert" className="p-4 text-sm text-muted-foreground">Couldn’t draw “{this.props.label}”. Your data is safe — reload to retry.</div>
    : this.props.children; }
}
// EmptyChart.tsx
export const EmptyChart = ({ w, h, msg }: { w:number; h:number; msg:string }) => (
  <svg width={w} height={h} role="img" aria-label={msg}><text x={w/2} y={h/2} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">{msg}</text></svg>);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
// DonutChart: const clean = data.filter(d => finite(d.value) && d.value >= 0);  if (!clean.some(d=>d.value>0)) return <EmptyChart … msg="No graded items yet" />;
// LineTrend: if (!data.some(d => d.hasData !== false && (d.sodium>0||d.sugar>0||d.satFat>0))) return <EmptyChart … msg="No purchases in this period" />;
// single point: render <circle cx={x(0)} cy={y(pct)} r={4} fill={s.color}/> when data.length===1
// HBarChart: const barH = Math.max(12, …)
// StackedHBar: const maxVal = Math.max(1, …); if (data.every(d => d.totalPrice===0)) return <EmptyChart … />
// ChartBox: const [width,setWidth] = useState(0); render <div className="animate-pulse rounded bg-muted" style={{height}} /> while 0
// Wrap each <ChartBox> in <ChartBoundary label="Basket quality"> and wrap <Dashboard/> once at root.
```

---

### \[D-26: Chart-MisleadingHealthEncoding\] **S2**

- **File Path:** `Charts.tsx:168-175, 224-227, 288-298, 321-331, 493-495`
- **Visual & Functional Impact:**
  - The tooltip's `rawPct` is **clamped to 150 %** (`toPct` applies `Math.min(MAX_PCT)`), so a 400 % sodium day reads "150 % DV". This under-reports overshoot for hypertension users.
  - A bucket with `hasData===false` shows "0 % DV", which is ambiguous between "no purchases" and "bought nothing salty".
  - Series use **grade colours** (Sat Fat = green A-grade), so a risk nutrient is coloured "good". Two dashed secondary lines differ by colour only (WCAG 1.4.1).
  - The daily-value baseline is the **FDA 2000 kcal** table (sodium 2300 mg). The deck's evidence slide cites WHO and Kenyan MoH sources (WHO guidance for sodium is lower, \<2 g/day; confirm with KNDI), and the series is labelled "mg **average** for this bucket", which reads like per-item averages compared to a *daily* limit under a "Daily limit" line.
  - `clipPath id={clip-${d.id}}` uses category names (spaces and `&` produce invalid `url(#…)`) and collides if two instances share ids.
- **Refactored Production Solution:**

```tsx
const rawPct = (val/DV[s.key])*100;                        // tooltip: unclamped
lval.textContent = d.hasData === false ? 'No purchases' : `${Math.round(rawPct)}% DV${rawPct>MAX_PCT?' ▲':''}`;
// neutral series palette via tokens, not grade colours
const TREND_SERIES = [{key:'sodium',color:'var(--chart-1)'},{key:'sugar',color:'var(--chart-2)'},{key:'satFat',color:'var(--chart-3)'}];
// distinct dash per series, not just colour: "0", "6 4", "2 3"
const uid = React.useId(); <clipPath id={`${uid}-clip-${i}`}>
```

Move `DV` to a shared config tied to the clinical sources KNDI signs off on, and label the metric as "typical basket vs daily guideline" if that is what it is.

---

### \[D-27: A11y-InteractiveSVGAndBadge\] **S3**

- **File Path:** `Charts.tsx:79,128-148`; `shared-ui.js:187-190, 203-218`; `OnboardingWizard.tsx:707-708, 1074-1081`; `globals.css:18-23`
- **Impact:** (a) Interactive `role="button"` paths are inside `role="img"`, whose children are presentational, so screen readers lose them; the single-slice ring is mouse-only. (b) `outline:"none"` on focusable donut segments removes the focus ring (2.4.7). (c) The badge `div` has no role, `tabindex`, key handling or label. (d) The flyout has no `role="dialog"`, focus move or Escape. (e) Wizard modal lacks `role="dialog" aria-modal`, focus trap and `role="alert"` on errors (screen readers will not announce payment failures). (f) `.ns-pulse` is infinite with no `prefers-reduced-motion`. (g) 8-9 px SVG text.
- **Refactored Production Solution:**

```tsx
<svg role="group" aria-label="Basket quality by grade"><title>Basket quality</title>…
  <path … tabIndex={0} role="button" style={{ transition:'opacity .15s' }} className="focus-visible:outline focus-visible:outline-2" />
```

```js
trigger.setAttribute('role','button'); trigger.tabIndex = 0; trigger.setAttribute('aria-label', `NutriScore ${grade}, open details`);
trigger.addEventListener('keydown', e => (e.key==='Enter'||e.key===' ') && (e.preventDefault(), trigger.click()));
flyoutEl.setAttribute('role','dialog'); flyoutEl.setAttribute('aria-label', name);
document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ NutriSharedUI._closeActiveFlyout(); document.removeEventListener('keydown',esc);} });
```

```css
@media (prefers-reduced-motion: reduce) { .ns-pulse, .animate-spin { animation: none; } }
```

```tsx
<div role="alert" aria-live="assertive" …>{errorMessage}</div>   // wizard error banner
<div role="dialog" aria-modal="true" aria-labelledby="wizard-title" …>
```

---

### \[D-28: Auth-SignupMisleadingMessageAndImplicitFlow\] **S3**

- **File Path:** `OnboardingWizard.tsx:319-329, 613-642`; `background.js:549-553`
- **Impact:** With email confirmation on, signing up with an **already-registered email** returns no session, then `signInWithPassword` fails, and the user is told "**Account created!** check your email". It is shown in the red error banner (a success/info state styled as an error). OAuth uses the **implicit** flow (tokens in the URL fragment); PKCE is the recommended flow for extensions.
- **Fix:**

```ts
const { data: su, error } = await supabase.auth.signUp({ … });
if (!error && !su.session) {
  setInfo('If this is a new address, we’ve sent a confirmation link. If you already have an account, use “Log in”.');  // neutral, info style
  setIsSubmitting(false); return;
}
```

Set `auth.flowType:'pkce'` in the UI client and exchange the code via `exchangeCodeForSession`.

---

### \[D-29: Manifest-HardeningGaps\] **S3**

- **File Path:** `manifest.json:6-12, 17-43`
- **Impact:** `*://` host patterns include plain `http`; cart and health data should only run on `https://`. Quickmart adapter isn't registered (D-21). No `minimum_chrome_version` although the code uses `navigation` API fallbacks, `CSSStyleSheet` constructable and `AbortSignal.timeout` (Chrome 103+). No explicit `content_security_policy.extension_pages`.
- **Fix:**

```json
"host_permissions": ["https://*.naivas.online/*","https://*.naivas.co.ke/*","https://*.carrefour.ke/*","https://*.carrefourkenya.com/*"],
"minimum_chrome_version": "110",
"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }
```

---

### \[D-30: Minor Quality Items\] **S3**

- `Dashboard.tsx`: `load()` and `handleDeleteEntry()` have no `try/catch` (a failed IDB read leaves the spinner on forever, `:105-119, 376`); `updateSetting` performs `saveSettings` **inside a state updater** (`:159-165`, double-fires under StrictMode); `selectCondition` never updates Supabase `users.condition`, so the next sign-in restores the old condition; the display name has **three sources** (IDB `profileName`, `chrome.storage user_account`, Supabase `full_name`); `applyPersonalization` mutates React-rendered nodes with `replaceChildren/appendChild` and uses an invalid comparator (`sort((a)=>…)`); hard-coded `#334155/#64748b` inline.
- `ThemeProvider.init` re-applies an IDB value through `applyTheme`, which writes back to IDB and **re-broadcasts `THEME_CHANGED`** on every mount where the two differ.
- `Charts.tsx:74` mojibake in a comment ("360Â°"), and `React.useRef` / `React.MouseEvent` rely on the `window.React = React` shim set in every entry. Import `useRef` and `type MouseEvent` explicitly.
- `ExtensionStorage.getOnboardingData` returns `healthMode: partial.condition && partial.condition !== "general"` (string/undefined, not boolean).
- `background.js:284`: `message.payload` dereferenced without a null check, so a malformed message throws with no `sendResponse`.
- `SubscriptionExpiredPage.tsx`: raw `#0f172a/#dc2626/#2563eb` gradients and a hard-coded "Ksh 189".
- Inconsistent payment labels: state `"Bank Transfer"` means **Card/Paystack** (`:82, 255, 1013`).
- `usePaymentState`: stale `activePaymentRef` has no TTL, so a days-old ref is recovered on a later visit and surfaces "Payment failed" for a fresh session.

---

## 3. Global Structural Remediation Matrix

| Component / Module | Found UX Bottleneck | Technical Root Cause | Optimized State Handler & UI Messaging Strategy |
| --- | --- | --- | --- |
| Payment step (`OnboardingWizard` + `usePaymentState`) | Permanent spinner after Cancel; no recovery on poll failure | Status never reset; silent early return; unbounded retry (D-01/02) | Explicit finite-state machine `idle→initiating→awaiting_pin→verifying→(success\|failed\|timeout)`, every terminal state has a button; messages: "Check your phone", "Still waiting — do not pay again", "Not confirmed — ref XXXX, contact support" |
| Premium activation | Paid but still basic; premium disappears offline | Two token keys; refresh only on SW wake; clear-on-failure (D-04/06) | `savePremiumStatus` → `REFRESH_ENTITLEMENT`; `refresh()` returns `unchanged` on transient errors; UI shows "Activating premium…" until `tier==='premium'` |
| Dashboard / Popup boot | Blank page; forced sign-out on offline | No try/catch; `null` render; error classes merged (D-11) | `loading → ready \| offline \| unauth`; offline renders a retry card, never signs out on non-auth errors |
| Renewal flow | No checkboxes, profile overwritten, double-charge risk | Form state reused as truth (D-09) | Dedicated renew path: recover pending payment, show consent checkboxes in step 5, payload = `{id}` only |
| Supabase client (SW) | Random sign-outs | Client per product, divergent configs (D-05) | Single memoised client + memoised tier per batch |
| Flyout / badge | No disease warnings, dead upsell, can't toggle, stale mode | Missing global in manifest; inline handlers; shadow retargeting; no rescan (D-13/14/15) | Load `health-modes.js` in content scripts, `composedPath`, managed listeners, `rescan()` on `THEME_CHANGED`/tier change |
| Content engine | Tab-wide "not found"; stuck `pending` | Infra errors cached as not-found; no per-item guard (D-16) | Cache only definitive misses; `data-nutriscore-scanned="error"` with a retry on next mutation |
| Charts (`Charts.tsx`/`ChartBox`) | Blank discs/grids, NaN, whole-page crash | Single empty case, no validation, no boundary (D-25) | `ChartBoundary`, `EmptyChart`, `finite()` guards, skeleton in `ChartBox` |
| Chart semantics | Under-reported overshoot, ambiguous zero, risky nutrient in "good" green | Clamp in tooltip; grade colours reused; `hasData` ignored (D-26) | Unclamped tooltip with ▲ marker, "No purchases", neutral token palette + dash patterns |
| Theme layer | Possibly no health palettes; popup flash; 78 % token bypass | `@import` after rules; attribute removed post-paint; hard-coded Tailwind palette (D-23/24) | Imports at top; `<html data-theme>`; lint ban on raw palette; generate page-badge colours from tokens |
| Shared-device privacy | Previous user's PII and flags reused | `partial_onboarding` never purged; sign-out clears too little (D-22) | `USER_KEYS` purge on sign-out and completion; bind flags to `userId`; stop persisting DOB/gender/phone |

---

## 4. Systems Integration Strategy & Future Guardrails

**1. Automated cross-viewport regression**

- **Playwright with the extension loaded** (`--load-extension`, persistent context). Viewports: popup 320 px, dashboard 360 / 768 / 1280, wizard 360 and 420.
- **Fixture the retailer pages** (saved Naivas Livewire and Carrefour HTML) and assert: a badge appears for every card; a flyout opens, closes on second click, shows a disease chip for `activeTheme=diabetes && tier=premium`; the badge **survives `document.body` replacement**.
- **Chart states** as visual snapshots: empty, single point, all zeros, NaN, 1 and 12 categories, long labels, `display:none` → visible.
- **axe-core** on every extension page and on the flyout (contrast, roles, names). Gate CI on zero serious violations.
- **Payment state machine** unit tests with fake timers: cancel, no-session, 500 loop, Realtime-before-poll, late success after cancel.

**2. Build-stage validation of database and backend configuration**

- **Contract test for `manifest.json`:** parse every `adapters/*.js`/`content.js` for `self.Nutri*`/`window.*` globals and assert each is provided by an earlier file in that script's `js` list (would have caught D-13).
- **Detect dead code:** `ts-prune`/`knip` for unused exports (`SubscriptionExpiredPage`, `useSubscriptionGuard`, `HBarChart`, `setOnboardingComplete`), and a check that every `message.action` sent anywhere has a handler (would have caught `OPEN_UPGRADE`).
- **CSS:** run `postcss`/lightningcss in CI with warnings-as-errors and assert `data-health-condition` selectors exist in the built CSS.
- **Supabase:** keep SQL migrations in-repo and run `supabase db lint` plus pgTAP tests: (a) the `authenticated` role **cannot** update billing columns on `users`; (b) a user can `SELECT` only their own `payments` rows (Realtime visibility); (c) `users` `INSERT/UPDATE` policies exist (the wizard's 42501 path). Fail the build if a table referenced by `.from('…')` has RLS enabled but no policy.
- **Edge Functions:** contract tests that `payment-status` returns one of `pending|completed|failed|cancelled` and always a `token` when `completed`; price is server-side only.
- Generated files (`db.js`, `health-modes.js`, `health-modes.generated.css`) built in CI and **not committed**, or committed with a `git diff --exit-code` freshness check.

**3. Fallback visual layouts when streams time out**

- Every async region gets four explicit states (`loading | empty | error | ready`) via one `<AsyncRegion>`; loading shows a skeleton after 150 ms, never `null`.
- Timeouts: entitlement 5 s, catalog sync 15 s with "using last downloaded catalog" banner, payment poll capped at \~6 min with the support reference.
- **Degraded badge** states on retailer pages: grey "Checking…" → "Couldn't check — tap to retry" instead of an absent badge.
- Dashboard offline banner: "Showing your saved history. Reconnect to refresh premium status." Cached tier is honoured until the JWT's own `exp`.
- `ChartBoundary` around each chart and the page root, so one bad dataset never blanks the app.

**Suggested remediation order:** D-13, D-01/02/03, D-04/05/06, D-11, D-09/10, D-22, D-08 (verify server), then D-23/24/25, then the remainder.