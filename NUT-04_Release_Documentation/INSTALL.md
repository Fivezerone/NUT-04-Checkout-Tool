# Installation and Deployment Guide

Production setup for NUT-04 v1.1.0: Supabase backend, secrets, signing keys, catalog publishing, extension build and verification. Verified against the source tree on 2026-10-07. Read the [Pre-launch checklist](#pre-launch-checklist) before taking real payments.

## Contents

1. [Topology and requirements](#1-topology-and-requirements)
2. [Install dependencies](#2-install-dependencies)
3. [Signing keys](#3-signing-keys)
4. [Apply database migrations](#4-apply-database-migrations)
5. [Configure authentication](#5-configure-authentication)
6. [Set secrets](#6-set-secrets)
7. [Deploy Edge Functions](#7-deploy-edge-functions)
8. [Configure payment providers](#8-configure-payment-providers)
9. [Publish the catalog](#9-publish-the-catalog)
10. [Configure and build the extension](#10-configure-and-build-the-extension)
11. [Package and distribute](#11-package-and-distribute)
12. [Verification](#12-verification)
13. [Pre-launch checklist](#pre-launch-checklist)
14. [Troubleshooting](#14-troubleshooting)

## 1. Topology and requirements

| Component | Runs on | Deployed by |
|---|---|---|
| Extension (`dist/`) | User's Chrome | Chrome Web Store upload or unpacked load |
| Postgres, Auth, Edge Functions | Supabase project | Supabase CLI |
| Catalog publisher | Operator workstation or CI | `node scripts/publish-catalog.mjs` |
| Payments | Safaricom Daraja and Paystack | Provider dashboards |

### 1.1 Software

| Requirement | Version | Used for |
|---|---|---|
| Node.js and npm | Node 20 or newer (CI uses 20; verified on 22) | Build, tests, publishing |
| Git | any recent | `npm ci` runs a `prepare` script that sets `core.hooksPath`, so install from a Git checkout |
| Supabase CLI | current release | Migrations, secrets, function deploys |
| `psql` (PostgreSQL client) | 14 or newer | Verification queries |
| `curl` and `jq` | any | Verification commands |
| Google Chrome | 110 or newer | Running the extension |

### 1.2 Hardware

No dedicated hardware. Building needs roughly 1 GB of free disk for `node_modules` and a machine able to run Node. The runtime footprint is the user's browser plus the Supabase project; the catalog is stored in the browser's IndexedDB.

### 1.3 Accounts and credentials

| Account | Needed for |
|---|---|
| Supabase project (Postgres 17 locally, hosted version per your plan) | Backend |
| Safaricom Daraja app with Lipa Na M-Pesa Online (shortcode and passkey) | M-Pesa STK Push |
| Paystack account with KES enabled | Card and other Paystack payments |
| Google Cloud OAuth client | "Continue with Google" sign-in (configured inside Supabase Auth) |
| Chrome Web Store developer account | Public distribution |

### 1.4 Shell variables used in this guide

Set these in your shell before running the commands. Values come from the Supabase, Safaricom, Paystack and Chrome dashboards. Do not commit them.

| Variable | Meaning |
|---|---|
| `SUPABASE_PROJECT_REF` | Project reference (the subdomain of the project URL) |
| `SUPABASE_URL` | Project URL, `https://` plus the reference plus `.supabase.co` |
| `ANON_KEY` | Project anon or publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key. Operator use only; never in `.env` or the extension |
| `DATABASE_URL` | Direct Postgres connection string (Dashboard, Database settings) |
| `ENTITLEMENT_SIGNING_KEY` | Private entitlement JWK as one-line JSON (from step 3) |
| `CATALOG_SIGNING_KEY` | Private catalog JWK as one-line JSON (from step 3) |
| `EXTENSION_ID` | The 32-character ID Chrome shows for the installed extension |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY` | Daraja credentials |
| `PAYSTACK_SECRET_KEY` | Paystack secret key (live key for production) |
| `TEST_EMAIL`, `TEST_PASSWORD` | A throwaway account used only for verification |

## 2. Install dependencies

From the repository root:

```bash
npm ci
```

Confirm the toolchain before continuing:

```bash
npm test
npm run lint
npm run build
```

Expected: 209 tests pass, lint reports no errors, and `dist/` contains `popup.html`, `dashboard.html`, `options.html`, `onboarding.html` and `manifest.json`. `npm run typecheck` currently fails; see the checklist.

## 3. Signing keys

Two ES256 (P-256) key pairs protect the system. The catalog key signs release manifests; the entitlement key signs Premium tokens.

The repository already contains public keys (`kid` values `catalog-v1` and `entitlement-v1`) in `config/public-keys/` and in `src/extension/config.js`. **If you hold the matching private keys, skip this step.** Otherwise generate new pairs; this overwrites the two public-key files:

```bash
node scripts/gen-keys.mjs
```

The command prints the two private JWKs to stdout once and never writes them to disk. Store them immediately in your secret manager and export them as `CATALOG_SIGNING_KEY` and `ENTITLEMENT_SIGNING_KEY` (each as a single-line JSON string).

Then copy the new public keys into `NUTRI_CONFIG.CATALOG_PUBLIC_KEYS` and `NUTRI_CONFIG.ENTITLEMENT_PUBLIC_KEYS` in `src/extension/config.js`. The build does not inject keys, and the three places must agree:

| Location | Used by |
|---|---|
| `src/extension/config.js` | The extension (signature verification) |
| `config/public-keys/*.jwks.json` | `publish-catalog.mjs` (reads the `kid`) |
| Private key in the Supabase secret or CI secret | Signing |

## 4. Apply database migrations

Authenticate and link the CLI to your project:

```bash
supabase login
supabase link --project-ref "$SUPABASE_PROJECT_REF"
```

If your database already contains users in the `trialing` status, relax the constraint first, otherwise migration `20260928000000_billing_authority.sql` aborts when it converts those rows to `basic`. Skip this on an empty project:

```bash
psql "$DATABASE_URL" -c "ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_subscription_status_check;"
```

Apply all migrations:

```bash
supabase db push
```

**Required remediation, all deployments.** The shipped migrations leave a constraint that rejects the `basic` status the billing trigger writes. On a database built only from the shipped migrations, every sign-up fails with `violates check constraint "users_subscription_status_check"` (reproduced on PostgreSQL 16). After `db push`, run:

```bash
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_subscription_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_subscription_status_check
  CHECK (subscription_status IN ('basic', 'active', 'expired'));
SQL
```

If any row still holds `trialing` the second statement fails; convert them first with `UPDATE public.users SET subscription_status = 'basic' WHERE subscription_status = 'trialing';`.

Notes on the migration set:

- Migrations are forward-only; there are no down migrations. See [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md).
- `20240922000000_realtime.sql` runs `DROP PUBLICATION IF EXISTS supabase_realtime` and recreates it with only `public.payments`. On a project that publishes other tables to Realtime, re-add them afterwards.
- `20260922173139_query_payments.sql` is intentionally empty.
- The seed row `premium_30d` (189.00 KES, 30 days) is created by `20260928000000_billing_authority.sql`.

Verify the result (section 12.1 has the full query set):

```bash
psql "$DATABASE_URL" -c "SELECT code, price_kes, duration_days, active FROM public.plans;"
```

## 5. Configure authentication

In the Supabase dashboard, under Authentication:

1. **Email provider:** enabled. Decide whether email confirmation is required; the onboarding flow signs in with the password immediately after sign-up.
2. **Google provider:** enable it and enter the Google OAuth client ID and secret.
3. **Redirect URLs:** add the extension's OAuth redirect, which is `https://` plus `EXTENSION_ID` plus `.chromiumapp.org/`. The extension builds it with `chrome.identity.getRedirectURL()`.

`manifest.json` has no `key` field, so an unpacked extension gets a different ID per folder and per machine. The ID becomes stable once the extension is uploaded to the Chrome Web Store; add the store ID's redirect URL before launch. In Google Cloud Console, the authorized redirect URI for the OAuth client is the Supabase callback shown in the Google provider settings.

## 6. Set secrets

Edge Function secrets are stored in Supabase, not in the repository. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

```bash
supabase secrets set \
  ENTITLEMENT_SIGNING_KEY="$ENTITLEMENT_SIGNING_KEY" \
  ALLOWED_ORIGINS="chrome-extension://$EXTENSION_ID" \
  PAYSTACK_SECRET_KEY="$PAYSTACK_SECRET_KEY" \
  PAYSTACK_CALLBACK_URL="$SUPABASE_URL/functions/v1/paystack-redirect" \
  MPESA_CONSUMER_KEY="$MPESA_CONSUMER_KEY" \
  MPESA_CONSUMER_SECRET="$MPESA_CONSUMER_SECRET" \
  MPESA_SHORTCODE="$MPESA_SHORTCODE" \
  MPESA_PASSKEY="$MPESA_PASSKEY" \
  MPESA_CALLBACK_URL="$SUPABASE_URL/functions/v1/mpesa-webhook" \
  MPESA_ENV="production"
```

| Secret | Notes |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated list. The extension's service worker calls `entitlement` from its `chrome-extension://` origin, so that origin must be listed. Add a second entry for the Web Store ID when it exists |
| `MPESA_ENV` | `production` selects `https://api.safaricom.co.ke`. Any other value or no value selects the sandbox, so real payments will not process |
| `PAYSTACK_CALLBACK_URL` | Read by `paystack-initiate` but not forwarded to Paystack; the effective redirect is the one set in the Paystack dashboard (step 8) |

## 7. Deploy Edge Functions

```bash
supabase functions deploy entitlement
supabase functions deploy payment-status
supabase functions deploy mpesa-initiate
supabase functions deploy paystack-initiate
supabase functions deploy mpesa-webhook --no-verify-jwt
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy paystack-redirect --no-verify-jwt
```

Why the flags differ: `config.toml` sets `verify_jwt = true` for `entitlement` and `false` for `payment-status`, and configures nothing for the others. Provider callbacks carry no Supabase JWT, so the three callback functions must be deployed with `--no-verify-jwt`. The two initiate functions authenticate the user inside the function.

Do **not** deploy `debug-payments`. If it was ever deployed to this project, remove it:

```bash
supabase functions delete debug-payments
```

`get-premium-token` is a legacy function and is intentionally absent from the list above. The dashboard calls it for active subscribers inside a `try/catch`, so the page loads without it. Premium itself is decided by `entitlement`.

## 8. Configure payment providers

### 8.1 Safaricom Daraja

1. Create or open the app with Lipa Na M-Pesa Online for the production shortcode.
2. The STK callback URL is set per request from `MPESA_CALLBACK_URL` (step 6), which points at `mpesa-webhook`. No dashboard URL is needed for STK Push.
3. Confirm the passkey belongs to the shortcode set in `MPESA_SHORTCODE`.

### 8.2 Paystack

1. In the Paystack dashboard, set the **Callback URL** to `$SUPABASE_URL/functions/v1/paystack-redirect`.
2. Set the **Webhook URL** to `$SUPABASE_URL/functions/v1/paystack-webhook`.
3. Enable KES as a transaction currency.

## 9. Publish the catalog

The extension ships no product data. Until a release exists in `catalog_releases`, signed-in users receive no grades.

Inputs are two JSON files, `carrefour_products.json` and `naivas_products.json`, which are not stored in this repository. Each is an array of product records (see [API_REFERENCE.md, section 7](API_REFERENCE.md#7-catalog-and-record-schema)).

Dry run (validates, hashes, evaluates Premium assessments and writes `publish-report.json`; writes nothing to Supabase):

```bash
node scripts/publish-catalog.mjs --carrefour ./carrefour_products.json --naivas ./naivas_products.json
```

Commit:

```bash
export SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CATALOG_SIGNING_KEY
node scripts/publish-catalog.mjs --carrefour ./carrefour_products.json --naivas ./naivas_products.json --commit
```

Add `--allow-dedupe` when the dry run reports expected duplicate product IDs, and `--force-count-change` when a retailer's product count moves by more than 10 percent. Exit code `0` is success, `1` is a validation, duplicate, count or hash abort, and `2` is a configuration error.

The first publish into an empty catalog works. A later publish that removes products currently fails at `catalog_release_publish` with `manifest max_seq N does not match current catalog max_seq M`; see [Troubleshooting](#14-troubleshooting).

## 10. Configure and build the extension

Two configuration locations must point at the same Supabase project.

1. `.env` (read by Vite for the UI pages):

   ```bash
   cp .env.example .env
   ```

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `$SUPABASE_URL` |
   | `VITE_SUPABASE_ANON_KEY` | `$ANON_KEY` |

2. `src/extension/config.js` (read by the service worker): set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the same values, and confirm the public keys from step 3.

Only public values belong in either file. The service role key must never appear in `.env`, `config.js` or `dist/`.

Build:

```bash
npm run build
```

Build output and exclusions: `dist/` receives the Vite pages, then a copy of `src/extension` that skips `data/`, `pipeline/` and `.xlsx` files. Confirm no private material shipped:

```bash
grep -rIl "service_role" dist || echo "no service_role references in dist"
```

## 11. Package and distribute

Version consistency: the extension version is `version` in `src/extension/manifest.json` (`1.1.0`). `package.json` carries `0.0.1`; align the two before tagging a release.

Create the upload archive from the built folder:

```bash
cd dist && zip -r ../nutriscore-checkout-tool-1.1.0.zip . && cd ..
```

Upload the zip in the Chrome Web Store developer dashboard. Chrome does not accept the same or a lower version number for a new upload, so every rebuild submitted to the store needs a higher `version`.

Store listing prerequisites called out by the manifest: the `identity` permission (Google sign-in), `alarms`, `storage`, and host access to the four retailer domains. The extension's privacy disclosure must state that account data and cart history are stored in Supabase and on the device, and that users can delete local data from Options.

## 12. Verification

### 12.1 Database

```bash
psql "$DATABASE_URL" <<'SQL'
SELECT pg_get_constraintdef(oid) AS users_status_constraint
  FROM pg_constraint WHERE conname = 'users_subscription_status_check';
SELECT code, price_kes, duration_days, active FROM public.plans;
SELECT relname, relrowsecurity
  FROM pg_class
 WHERE relnamespace = 'public'::regnamespace
   AND relname IN ('users','payments','plans','catalog_products','catalog_premium','catalog_releases')
 ORDER BY relname;
SELECT id, key_id, is_current, manifest->>'version' AS version, manifest->>'max_seq' AS max_seq
  FROM public.catalog_releases WHERE is_current;
SQL
```

Expected: the constraint lists `basic`, `active`, `expired`; one plan row `premium_30d | 189.00 | 30 | t`; `relrowsecurity = t` for all six tables; one current release after step 9.

### 12.2 Authentication and entitlement

```bash
ACCESS_TOKEN=$(curl -sS "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" | jq -r .access_token)

curl -sS -X POST "$SUPABASE_URL/functions/v1/entitlement" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "apikey: $ANON_KEY" | jq
```

Expected for a user without a subscription: `{"tier":"basic","server_now":"..."}`. A `401` means the token is invalid; a `500` mentioning `ENTITLEMENT_SIGNING_KEY` means the secret is missing.

### 12.3 Billing rules (non-production database only)

Run against a scratch database, never production. With a throwaway user and a pending payment row whose `amount` is `189`, `grant_premium` must return `granted`, then `already_granted` on repeat, extend expiry by 30 days on a second pending payment, and return `amount_mismatch` for a pending payment with a different amount. An authenticated client updating `premium_expires_at` must fail with `permission denied for table users`. These behaviours were verified on PostgreSQL 16 on 2026-10-07 after applying the constraint remediation.

The SQL files in `supabase/tests/` do not run (doubled quotes inside `DO $$` blocks cause syntax errors); do not use them as a gate.

### 12.4 Payment functions

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/payment-status" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"transaction_ref":"unknown-ref","method":"mpesa"}'
```

Expected: HTTP 400 with `{"error":"Payment not found"}`, which proves authentication and the user-scoped lookup. Check that the webhook URLs respond without a JWT:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$SUPABASE_URL/functions/v1/paystack-redirect?reference=check"
```

Expected: `200`. A POST to `paystack-webhook` without the `x-paystack-signature` header must return `401`.

### 12.5 Extension

1. `chrome://extensions`, enable Developer mode, **Load unpacked**, choose `dist/`.
2. Open the service worker console. Expected log lines: `Component Architecture v2.0 active.` and, after sign-in and sync, `Catalog synced and ready.`
3. Complete sign-up in the onboarding page. At present the final onboarding step throws for new users (see the checklist), so this step passes only after that defect is fixed.
4. Open a Naivas or Carrefour Kenya category page. Product cards should gain grade badges; the popup shows scanned and total counts.

## Pre-launch checklist

Do not enable live payments or submit to the store until every item is closed.

| # | Item | Why | Required action |
|---|---|---|---|
| 1 | Constraint conflict | New sign-ups fail on migrated databases | Apply the SQL in step 4 |
| 2 | Onboarding crash | `finishOnboarding` calls the undefined `getPrimaryCondition()` and shadows `condition` and `metric`, so a new user's onboarding throws after the profile upsert | Fix in `OnboardingWizard.tsx`, then re-test sign-up end to end |
| 3 | M-Pesa webhook trust | `mpesa-webhook` grants Premium when Safaricom's confirmation query returns no `ResultCode` or `1036`, and the callback carries no authentication. Anyone who knows a pending `CheckoutRequestID` (the payer receives it) can post a forged success callback while the query is inconclusive | Grant only when the confirmation query returns result code `0`; authenticate callbacks (for example with a secret token in `MPESA_CALLBACK_URL` that the function checks); leave other cases `pending` for `payment-status` to settle |
| 4 | `debug-payments` | Returns the 20 most recent payments of every user to any signed-in caller | Never deploy; delete the function from the repository before release |
| 5 | `MPESA_ENV` | Defaults to sandbox | Set `production` (step 6) and run one real small transaction |
| 6 | Paystack | Live key and dashboard URLs | Use the live secret key; set callback and webhook URLs (step 8.2) |
| 7 | Typecheck | 31 TypeScript errors, so CI Typecheck fails | Resolve, or remove the step from CI by decision |
| 8 | Ledger gaps | Cart removal, cart clear and order confirmation never update the ledger; no code writes `purchased` or `removed` | Implement `removeCartItem`, `clearCartItems`, `markCartPurchased`, or document the dashboard as add-only |
| 9 | Catalog removals | Publishing after a removal fails (`max_seq` mismatch) | Make the publisher and `catalog_release_publish` use the same `max_seq` definition, and make sure clients can still pull tombstones |
| 10 | Catalog data | Inputs are not in the repository | Keep the two JSON files and a recorded hash with the release record |
| 11 | Extension ID | OAuth redirect depends on it | Register the Web Store ID's redirect URL in Supabase Auth and add its origin to `ALLOWED_ORIGINS` |
| 12 | Archive hygiene | `.env` and `supabase/.temp/` exist in working copies | Keep both out of archives and commits; `.gitignore` already lists them |
| 13 | Version | `package.json` 0.0.1 versus manifest 1.1.0 | Align before tagging |
| 14 | Legal text | Store submission needs privacy disclosures | Provide a privacy policy that matches section 11 |

## 14. Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| `Database error saving new user` on sign-up | Status constraint rejects `basic` | Step 4 remediation |
| `npm ci` fails at `prepare` with a Git error | Not a Git checkout | Run from a clone, or `npm ci --ignore-scripts` and set `git config core.hooksPath .githooks` later |
| Badges never appear | Catalog not published or sync failing | Run the 12.1 release query; check the service worker console for `Catalog manifest signature invalid` or `Catalog hash mismatch` |
| `Unknown catalog key_id` in the console | `config.js` public key does not match the signing key | Re-sync keys per step 3 and rebuild |
| Premium never activates after payment | `entitlement` secret missing, or CORS origin not allowed | Check `ENTITLEMENT_SIGNING_KEY` and `ALLOWED_ORIGINS`; run 12.2 |
| M-Pesa prompt never arrives | Sandbox base URL in use | Set `MPESA_ENV` to `production` |
| `manifest max_seq N does not match current catalog max_seq M` | Publisher counts tombstoned rows; the database function does not | Known defect (checklist item 9) |
| Extension opens but pages are blank | `dist/` was built before the UI step, or `.env` missing | Run `npm run build` in full; confirm `.env` |
