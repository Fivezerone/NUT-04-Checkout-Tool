-- Migration: 001_catalog_release_publish_fix
-- Finding: F-08 — "A release that removes any product cannot be published"
--
-- Root cause: publish-catalog.mjs computes max_seq as MAX(seq) over ALL rows
-- (tombstones included, because catalog_tombstone_missing stamps deletions with
-- a fresh nextval()). The old catalog_release_publish validated against
-- MAX(seq) WHERE NOT deleted, which is always lower than the tombstone seq.
-- The two values can never match, so the RPC always raises an exception.
--
-- Fix: compute v_max_seq over ALL rows (no WHERE NOT deleted filter), matching
-- what the publisher sends. Also add an advisory lock so two concurrent
-- publishers cannot both read "current max" and both try to become is_current.
--
-- Safe to apply on a live DB: CREATE OR REPLACE is non-destructive. The only
-- observable change is that publishes that remove products now succeed.

create or replace function public.catalog_release_publish(
  p_manifest jsonb, p_signature text, p_key_id text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_max_seq bigint;
  v_id      bigint;
begin
  -- Serialise concurrent publishers so two simultaneous releases cannot both
  -- read the "current" max and both become is_current.
  perform pg_advisory_xact_lock(hashtext('catalog_release_publish'));

  -- NOTE: no "where not deleted" — tombstones consume sequence numbers and the
  -- publisher's max_seq is computed over all rows including tombstones.
  -- Clients use .lte("seq", manifest.max_seq) so they always receive the
  -- tombstone rows and can process deletes correctly.
  select greatest(
    coalesce((select max(seq) from public.catalog_products), 0),
    coalesce((select max(seq) from public.catalog_premium),  0)
  ) into v_max_seq;

  if (p_manifest->>'max_seq')::bigint <> v_max_seq then
    raise exception 'manifest max_seq % does not match current catalog max_seq %',
      p_manifest->>'max_seq', v_max_seq;
  end if;

  update public.catalog_releases set is_current = false where is_current;
  insert into public.catalog_releases (manifest, signature, key_id, is_current)
    values (p_manifest, p_signature, p_key_id, true)
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.catalog_release_publish(jsonb, text, text) from public, anon, authenticated;
grant  execute on function public.catalog_release_publish(jsonb, text, text) to service_role;
