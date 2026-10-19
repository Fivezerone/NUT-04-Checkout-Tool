# Changelog

All notable changes to NUT-04 (NutriScore Checkout Tool) are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The repository snapshot this file was written from contains no Git history. The 1.1.0 entries were reconstructed from the SQL migration timestamps (2026-09-22 to 2026-09-28), regression test names (`d01` to `d30`, `sec005`), code comments and the schema, compared with the previous build that shipped the retailer datasets inside the extension package (IndexedDB schema version 12, no accounts, no backend).

## [Unreleased]

Changes made on 2026-10-07 to make the toolchain verifiable. Test, lint and build then pass; typecheck still fails (see Known issues).

### Fixed

- `src/extension/content.js`: removed a stray closing brace in the batch-score response handler. The file failed to parse, so neither retailer content script loaded and no badges rendered.
- `tsconfig.json`: added `"types": ["chrome", "vite/client"]`. TypeScript 6 no longer loads `@types/*` packages automatically, which made every `chrome` and `import.meta.env` reference an error.
- Test suite: the `calculateAnalytics` snapshot depended on the machine's timezone and default locale and failed elsewhere. Added `src/ui/src/app/__tests__/setup.ts` (pins UTC and `en-US` for the test run) and registered it in `vite.config.ts` under `test.setupFiles`, then refreshed the snapshot. 209 of 209 tests pass in six timezone and locale combinations.

### Added

- `eslint.config.js`: ESLint 10 flat configuration with separate scopes for the UI, extension runtime, Node scripts and Edge Functions. `npm run lint` now runs (0 errors, 87 warnings). Previously ESLint aborted for lack of a configuration file, so the CI Lint step could not pass.
- Documentation suite: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md`, `INSTALL.md`, `ROLLBACK_RUNBOOK.md`, `API_REFERENCE.md`, `docs/README.md`.

### Changed

- Superseded documents (product requirements, requirements v2, personas, component diagram, system architecture, technical design, engineering runbook, API reference, help center and the assignment decks) moved to `docs/archive/` with a banner pointing to their replacements.

### Known issues

These were found during the documentation audit and are not fixed in this release. Each is described in detail in [README.md](README.md#release-status).

| Area | Issue | Severity |
|---|---|---|
| Database | Sign-up fails on a database built from the shipped migrations: `users_subscription_status_check` still rejects `basic`, which the billing trigger writes. Remediation SQL in [INSTALL.md](INSTALL.md#4-apply-database-migrations) | Blocker |
| Onboarding | `finishOnboarding` calls the undefined `getPrimaryCondition()` and shadows `condition` and `metric`, so a new user's onboarding throws after the profile upsert | Blocker |
| Payments | `mpesa-webhook` grants Premium on an empty or `1036` confirmation query and accepts unauthenticated callbacks | High |
| Payments | `debug-payments` returns the 20 most recent payments of all users to any signed-in caller; disabled only in local `config.toml` | High |
| Catalog | Publishing after any product removal fails: `max_seq` includes tombstones in the script but not in `catalog_release_publish` | High |
| Ledger | `REMOVE_CART_ITEM`, `CART_CLEARED` and `ORDER_PLACED` call `NutriScoreDB` functions that do not exist; no code writes `purchased` or `removed` | Medium |
| Typecheck | 31 TypeScript errors, 7 of them from the onboarding defect above | Medium |
| Payments | `MPESA_ENV` defaults to sandbox | Configuration |
| Tests | `supabase/tests/*.sql` do not run (syntax errors) | Medium |
| Tooling | `check:manifest` and an extension syntax check are not part of CI; `build-health-modes.mjs` is not part of `npm run build` | Low |
| Housekeeping | `package.json` version `0.0.1` versus manifest `1.1.0`; legacy `get-premium-token`, `build.ps1`, `patch_datasets.cjs`, `ingest_products.ts`, empty migration `20260922173139_query_payments.sql` | Low |

## [1.1.0] - September 2026

Thin-client release: the product catalog moves from the extension package to Supabase, accounts become mandatory, and Premium is sold and enforced server-side.

### Added

- **Signed catalog sync.** `catalog-sync.js` reads the current `catalog_releases` manifest, verifies its ES256 signature against `CATALOG_PUBLIC_KEYS`, pulls `catalog_products` by sequence number into staging, checks the SHA-256 catalog hash and commits to IndexedDB. A failed signature, key or hash check leaves the previous catalog in place.
- **Catalog tables and publisher.** `catalog_products`, `catalog_premium` and `catalog_releases` with row-level security; service-role-only upsert, tombstone and publish functions; `scripts/publish-catalog.mjs` with dry run, duplicate guard, 10 percent count-change guard and database-side hash verification; `scripts/gen-keys.mjs` for ES256 key pairs.
- **Accounts.** Supabase Auth with email and password and Google sign-in through `chrome.identity`; onboarding wizard capturing profile, condition and consent; `public.users` profile table with a `handle_new_user` trigger.
- **Premium subscription.** Server-owned plan table (`premium_30d`, 189 KES, 30 days); M-Pesa STK Push (`mpesa-initiate`, `mpesa-webhook`) and Paystack (`paystack-initiate`, `paystack-webhook`, `paystack-redirect`); `payment-status` polling; Realtime publication on `payments`; `MPESA_ENV` switch between sandbox and production.
- **Billing authority.** `grant_premium` is the only path that grants Premium: idempotent, checks amount and currency against the plan, and stacks renewals on an unexpired subscription. `get_my_entitlement` and `is_premium_active` helpers.
- **Entitlement tokens.** `entitlement` Edge Function signs an ES256 token whose expiry equals the subscription expiry; `entitlement.js` verifies algorithm, `kid`, issuer, subject and expiry on the device and applies a clock-rollback guard.
- **Premium condition assessments.** Diabetes, hypertension, renal and obesity assessments are computed at publish time with `pipeline/disease-engine.js` and synced as `catalog_premium` (Premium accounts only). `health-modes.js` generated from `src/shared/health-modes.mjs`.
- **Context engine.** `engine/context-engine.js` with five scorers and health flags (`IsEnergyDense`, `IsHighSodium`, `DiabeticFriendly`, `RenalSafe`).
- **Data-trust grading.** Five review states (`REJECTED`, `UNVERIFIED`, `ESTIMATED`, `VERIFIED`, `HIGH_CONFIDENCE`); a grade is withheld unless a state of `ESTIMATED` or above, a resolvable category and energy data are present; `scoringStatus` of `computed`, `insufficient_data` or `not_attempted`.
- **Tooling.** `scripts/check-manifest-globals.mjs`, `scripts/build-db.mjs`, `scripts/build-sw-client.mjs`, GitHub Actions workflow `CI Validation`, pre-commit hook that regenerates `db.js`.
- **Tests.** Vitest regression suite of 209 tests including the `d01` to `d30` defect tests, entitlement, subscription-guard, premium-slice, canonicalization and security tests.

### Changed

- **Local storage.** IndexedDB `nut04-nutriscore` is at version 15. Version 13 clears the bundled product stores, `product_cache` and `dataset_metadata` and adds `catalog_staging`, `catalog_hashes` and `premium_assessments`; versions 14 and 15 clear them again to force a fresh sync.
- **Subscription model.** Expiry is derived from `users.premium_expires_at`; `subscription_status` is `basic`, `active` or `expired`. The free trial was removed and existing `trialing` rows are converted to `basic`.
- **UI build.** Popup, dashboard, options and onboarding pages build with Vite; React sources run on Preact through aliases in `vite.config.ts`.
- **Extension build.** `build:ext` is a cross-platform Node script (no `robocopy`) that bundles the Supabase client for the service worker and excludes `data/` and `pipeline/` from `dist/`.

### Security

- Billing columns on `public.users` can no longer be written by clients: column-level grants plus a `SECURITY INVOKER` trigger (fixes the earlier trigger that never fired because its owner check ran as the function owner).
- Payment amounts are no longer accepted from the client; both initiate functions read the price from `public.plans`.
- `payment-status` looks payments up by reference and the caller's user id, preventing cross-user enumeration.
- Catalog tables are readable by authenticated users only; premium assessments additionally require an active subscription; anonymous access to the legacy `products` table is revoked.
- `entitlement` restricts CORS to the origins in `ALLOWED_ORIGINS`.
- No service role key is present in any client file; it is used only inside Edge Functions and the publisher.

### Breaking changes

- **Accounts are mandatory.** Catalog access requires a signed-in user. There is no offline or anonymous mode.
- **No bundled data.** The extension ships no product dataset; first run downloads the catalog, and nothing is graded until a release has been published to `catalog_releases`.
- **Local data migration.** Opening the database at version 13 or later clears the bundled product stores, the product cache and the catalog metadata; the shopping ledger and settings are kept. A browser profile that has opened version 15 cannot be opened by a build that requests an older version.
- **Entitlement format.** Premium is proven by an ES256 token carrying `kid`, `iss` and `sub`. Tokens from the previous scheme are rejected.
- **Database.** Clients lose write access to `is_premium`, `subscription_status`, `payment_received_at` and `premium_expires_at`; the `trialing` status is retired; the `supabase_realtime` publication is dropped and recreated by migration `20240922000000`.
- **Configuration.** New required Supabase secrets: `ENTITLEMENT_SIGNING_KEY`, `ALLOWED_ORIGINS`, `MPESA_ENV` (in addition to the Daraja and Paystack secrets). Public keys must be present in `src/extension/config.js` and `config/public-keys/`. See [INSTALL.md](INSTALL.md).
- **Operator workflow.** Product data reaches users only through `scripts/publish-catalog.mjs` with `CATALOG_SIGNING_KEY`; the JSON inputs are not part of the repository.

### Migrations included

| Timestamp | File |
|---|---|
| 2024-01-01 | `20240101000000_schema.sql` |
| 2024-09-22 | `20240922000000_realtime.sql` |
| 2026-09-22 | `20260922173139_query_payments.sql` (empty), `20260922183709_fix_payments_fk.sql` |
| 2026-09-24 | `20260924000000_subscription_lifecycle.sql`, `20260924120000_user_profile_columns.sql`, `20260924130000_protect_billing_columns.sql` |
| 2026-09-27 | `20260927230000_consolidate_triggers.sql`, `20260927234500_bounded_trial.sql` |
| 2026-09-28 | `20260928000000_billing_authority.sql`, `20260928010000_catalog_schema.sql` |

[Unreleased]: #unreleased
[1.1.0]: #110---september-2026
