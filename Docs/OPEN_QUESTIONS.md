# Open questions

## OQ-001 — Reserved JWT `role` claim migration (blocked)

**Trigger:** Blueprint section 6.1.

The existing `public.custom_access_token_hook` writes `claims.role` in
`supabase/migrations/20261029000000_multi_tenant_core.sql` and again in
`supabase/migrations/20261029050000_rbac_provisioning_lifecycle.sql`.
Existing SQL policies, the provisioning Edge Function, and CAD UI code read
that claim through `auth.jwt() ->> 'role'` or equivalent helpers.

Amendment A1 requires the canonical application-role claim to be `app_role`
because Supabase reserves `role` for selecting the PostgreSQL database role.
The approved target is therefore clear, but a compatibility choice is still
needed before a migration that removes the legacy claim:

1. Should the Phase 2 migration emit both `app_role` and legacy `role` for one
   bounded compatibility release while all consumers move to the claims
   adapter, then remove `role` in a later migration; or
2. Should it remove the application `role` claim immediately, accepting a
   coordinated all-consumer cutover in the same release?

**Recommended:** option 1, with the legacy claim treated as read-only
compatibility data and with all authorization moved immediately to
`app_private.app_role()` / the claims adapter. This avoids an availability
regression while still preventing `role` from being an authorization source.

**Resolution:** Kibet selected option 2 on 1 November 2026. Remove the application
`role` claim in the coordinated Phase 2 cutover. Supabase's database-role claim
is not changed.

**Owner:** Resolved — Staff Engineering implements in Phase 2.

## OQ-002 — Plaintext clinical-style mock fixture data (blocked)

**Trigger:** Blueprint section 6.7.

`scripts/seed-mock-users.mjs` currently stores real-person-style names and
condition values in mock definitions, then writes them into the local
`.mock-credentials.json` file. Examples include full names and condition text
used for patient demo accounts. The source is not verified as synthetic, and
the blueprint forbids plaintext PHI in fixtures, snapshots, and logs.

No Phase 3 mock-seed change will be made until Kibet confirms one of these
paths:

1. The existing values are confirmed fully synthetic; they will be replaced
   with neutral non-identifying fixture labels and condition-free test data
   before adding the DHA, ODPC, and commercial partner mocks; or
2. The fixture must be removed from the repository and regenerated from an
   approved de-identified local-only specification.

**Recommended:** option 1. Replace all current fixture names with neutral IDs,
remove condition fields and condition-labelled keys, preserve only the role,
tenant, and synthetic credential data needed by the test suite, and add the
three required `.test` accounts.

**Resolution:** Kibet selected option 1 on 1 November 2026. Replace every
real-person-style mock name with a neutral fixture ID, remove condition fields
and condition-labelled keys, retain only the role, tenant and synthetic
credentials needed by tests, and add the DHA, ODPC and commercial stakeholder
`.test` accounts.

**Owner:** Resolved — Staff Engineering implements in Phase 3.

