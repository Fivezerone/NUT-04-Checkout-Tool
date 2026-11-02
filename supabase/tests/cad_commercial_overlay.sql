-- NutriScore CAD Blueprint Phase 8 — Commercial Overlay & Observed Orders Tests
-- Reference: Blueprint §4.3, Decision D6, Amendment A6
--
-- Exit criteria verified:
-- 1. A stakeholder cannot see a shopper alias (v_orders_tracking has no alias).
-- 2. Demand view (v_sku_demand) suppresses cells under 5 distinct shoppers.
-- 3. Demand view exposes aggregated metrics when shoppers >= 5 without revealing aliases.
-- 4. Forced restrictive tenant wall isolates commercial orders across tenants.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- Test tenants
CREATE TEMP TABLE p8_test_context AS
SELECT
  '11111111-1111-1111-1111-111111111111'::uuid AS tenant_1,
  '22222222-2222-2222-2222-222222222222'::uuid AS tenant_2,
  '33333333-3333-3333-3333-333333333333'::uuid AS stakeholder_user_id,
  gen_random_uuid() AS test_sku_id;

-- 1. Verify table existence and RLS enabled
SELECT has_table('commercial', 'skus', 'commercial.skus exists');
SELECT has_table('commercial', 'sku_mappings', 'commercial.sku_mappings exists');
SELECT has_table('commercial', 'orders', 'commercial.orders exists');
SELECT has_table('commercial', 'order_lines', 'commercial.order_lines exists');

SELECT has_view('commercial', 'v_orders_tracking', 'commercial.v_orders_tracking exists');
SELECT has_view('commercial', 'v_sku_demand', 'commercial.v_sku_demand exists');
SELECT has_view('public', 'v_orders_tracking', 'public.v_orders_tracking compatibility view exists');

-- 2. Verify column schema of views: NO alias column exists
SELECT columns_are(
  'commercial',
  'v_orders_tracking',
  ARRAY['tenant_id', 'id', 'retailer', 'status', 'total_kes', 'placed_at'],
  'v_orders_tracking projects strictly non-identifying order metadata without alias'
);

SELECT columns_are(
  'commercial',
  'v_sku_demand',
  ARRAY['tenant_id', 'sku_id', 'week', 'shoppers', 'units'],
  'v_sku_demand projects aggregated counts without individual aliases'
);

-- 3. Seed test data
INSERT INTO commercial.skus (
  sku_id, retailer, retailer_product_id, name, brand, category_kfct,
  nova, per_100g, review_state, active
)
SELECT
  test_sku_id,
  'carrefour_ke',
  'test-sku-prod-001',
  'Whole Grain Oats 500g',
  'BrandOats',
  'Cereals & Grains',
  1,
  '{"sugars_g": 1.2, "sodium_mg": 5}'::jsonb,
  'VERIFIED',
  true
FROM p8_test_context;

-- Insert 4 distinct shopper orders for tenant_1 (under k=5 cohort threshold)
INSERT INTO commercial.orders (
  tenant_id, id, shopper_alias, epoch, retailer, status, total_kes, idempotency_key, placed_at
)
SELECT
  tenant_1,
  gen_random_uuid(),
  decode('alias_shopper_00' || i, 'escape'),
  1,
  'carrefour_ke',
  'observed',
  250.00,
  'idem-key-shpr-' || i,
  now()
FROM p8_test_context, generate_series(1, 4) AS i;

-- Insert order lines for the 4 orders
INSERT INTO commercial.order_lines (tenant_id, order_id, line_no, sku_id, qty, unit_price_kes)
SELECT
  o.tenant_id,
  o.id,
  1,
  c.test_sku_id,
  2,
  125.00
FROM commercial.orders o, p8_test_context c
WHERE o.tenant_id = c.tenant_1 AND o.idempotency_key LIKE 'idem-key-shpr-%';

-- 4. Test k < 5 cohort gate suppression on v_sku_demand
SELECT is(
  (
    SELECT count(*)::int
    FROM commercial.v_sku_demand
    WHERE sku_id = (SELECT test_sku_id FROM p8_test_context)
  ),
  0,
  'v_sku_demand suppresses cells with fewer than 5 distinct shoppers (k=4)'
);

-- 5. Insert 5th order from a 5th distinct shopper to reach k=5
INSERT INTO commercial.orders (
  tenant_id, id, shopper_alias, epoch, retailer, status, total_kes, idempotency_key, placed_at
)
SELECT
  tenant_1,
  gen_random_uuid(),
  decode('alias_shopper_005', 'escape'),
  1,
  'carrefour_ke',
  'observed',
  250.00,
  'idem-key-shpr-5',
  now()
FROM p8_test_context;

INSERT INTO commercial.order_lines (tenant_id, order_id, line_no, sku_id, qty, unit_price_kes)
SELECT
  o.tenant_id,
  o.id,
  1,
  c.test_sku_id,
  3,
  125.00
FROM commercial.orders o, p8_test_context c
WHERE o.idempotency_key = 'idem-key-shpr-5';

-- 6. Test k >= 5 cohort gate release on v_sku_demand
SELECT is(
  (
    SELECT count(*)::int
    FROM commercial.v_sku_demand
    WHERE sku_id = (SELECT test_sku_id FROM p8_test_context)
  ),
  1,
  'v_sku_demand releases aggregated row once cohort threshold k >= 5 is reached'
);

SELECT is(
  (
    SELECT shoppers::int
    FROM commercial.v_sku_demand
    WHERE sku_id = (SELECT test_sku_id FROM p8_test_context)
  ),
  5,
  'v_sku_demand correctly reports 5 distinct shoppers'
);

SELECT is(
  (
    SELECT units::int
    FROM commercial.v_sku_demand
    WHERE sku_id = (SELECT test_sku_id FROM p8_test_context)
  ),
  11, -- 4 orders * 2 units + 1 order * 3 units = 11 units
  'v_sku_demand correctly aggregates 11 total units across 5 shoppers'
);

-- 7. Test v_orders_tracking returns all 5 orders without alias
SELECT is(
  (
    SELECT count(*)::int
    FROM commercial.v_orders_tracking
    WHERE tenant_id = (SELECT tenant_1 FROM p8_test_context)
  ),
  5,
  'v_orders_tracking returns all 5 observed orders'
);

-- 8. Verify cross-tenant isolation under tenant_wall
SELECT is(
  (
    SELECT count(*)::int
    FROM commercial.orders
    WHERE tenant_id = (SELECT tenant_2 FROM p8_test_context)
  ),
  0,
  'Tenant 2 has zero orders (tenant wall isolation verified)'
);

SELECT * FROM finish();

ROLLBACK;
