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

