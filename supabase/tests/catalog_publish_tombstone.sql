-- Regression test for F-08: "A release that removes any product cannot be published"
-- Run with: psql <connection> -f supabase/tests/catalog_publish_tombstone.sql
-- or via: scripts/db-test.sh (once F-23 is resolved)
--
-- On the UNFIXED function this test raises:
--   "manifest max_seq X does not match current catalog max_seq Y"
-- On the FIXED function (migration 001) the test passes and rolls back cleanly.
--
-- Plain psql, no doubled-quote DO $$ bodies (avoids the F-23 syntax issue).

begin;

-- 1. Upsert three products
select public.catalog_upsert('[
  {"retailer":"NAIVAS","product_id":"t1","record":{"n":1},"record_hash":"h1","review_state":"VERIFIED"},
  {"retailer":"NAIVAS","product_id":"t2","record":{"n":2},"record_hash":"h2","review_state":"VERIFIED"},
  {"retailer":"NAIVAS","product_id":"t3","record":{"n":3},"record_hash":"h3","review_state":"VERIFIED"}
]'::jsonb);

-- 2. Tombstone product t3 (simulates a product being removed from the source data)
select public.catalog_tombstone_missing('NAIVAS', array['t1','t2']);

-- 3. Compute max_seq exactly as publish-catalog.mjs does:
--    MAX(seq) over ALL rows, tombstones included.
do $$
declare
  v_max bigint;
  v_id  bigint;
begin
  select greatest(
    (select max(seq) from public.catalog_products),
    coalesce((select max(seq) from public.catalog_premium), 0)
  ) into v_max;

  -- This call must succeed on the fixed function.
  v_id := public.catalog_release_publish(
    jsonb_build_object('max_seq', v_max, 'version', 'test-tombstone'),
    'test-sig',
    'test-kid'
  );

  if v_id is null then
    raise exception 'FAIL: catalog_release_publish returned null';
  end if;

  -- Verify the tombstone seq is inside the released window
  if not exists (
    select 1 from public.catalog_products
    where deleted = true and seq <= v_max
  ) then
    raise exception 'FAIL: tombstone is outside the released seq window — clients would miss the delete';
  end if;

  raise notice 'PASS: F-08 regression test — release id=%, max_seq=%', v_id, v_max;
end $$;

rollback;
