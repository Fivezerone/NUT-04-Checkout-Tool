-- NutriScore CAD Blueprint Phase 8
-- Migration: Commercial overlay, observed orders, and demand analytics
-- Reference: Blueprint §4.3, Decision D6, Amendment A6
--
-- In scope: commercial.skus, commercial.sku_mappings, observed commercial.orders
-- and commercial.order_lines, v_orders_tracking, and v_sku_demand (k >= 5).
-- Strictly omitted: inventory table and stock logic per D6.

BEGIN;

CREATE SCHEMA IF NOT EXISTS commercial;

GRANT USAGE ON SCHEMA commercial TO authenticated, anon, svc_commercial;

-- 1. Reference SKUs (shared dataset, read-only to tenants, written by curation job)
CREATE TABLE IF NOT EXISTS commercial.skus (
  sku_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer            text NOT NULL CHECK (retailer IN ('naivas','carrefour_ke','quickmart_ke')),
  retailer_product_id text NOT NULL,
  name                text NOT NULL,
  brand               text,
  category_kfct       text,
  nova                smallint CHECK (nova BETWEEN 1 AND 4),
  per_100g            jsonb NOT NULL,
  review_state        text NOT NULL CHECK (review_state IN ('REJECTED','UNVERIFIED','ESTIMATED','VERIFIED','HIGH_CONFIDENCE')),
  active              boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer, retailer_product_id)
);

ALTER TABLE commercial.skus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skus_select ON commercial.skus;
CREATE POLICY skus_select ON commercial.skus
  FOR SELECT TO authenticated, anon, svc_commercial
  USING (active = true OR app_private.app_role() = 'super_admin');

DROP POLICY IF EXISTS skus_curation_writer ON commercial.skus;
CREATE POLICY skus_curation_writer ON commercial.skus
  FOR ALL TO svc_commercial
  USING (true) WITH CHECK (true);

-- 2. Tenant SKU Mappings
CREATE TABLE IF NOT EXISTS commercial.sku_mappings (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  sku_id      uuid NOT NULL REFERENCES commercial.skus (sku_id),
  partner_sku text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);

SELECT app_private.apply_tenant_wall('commercial.sku_mappings');

DROP POLICY IF EXISTS sku_mappings_stakeholder_select ON commercial.sku_mappings;
CREATE POLICY sku_mappings_stakeholder_select ON commercial.sku_mappings
  FOR SELECT TO authenticated
  USING (app_private.app_role() IN ('commercial_stakeholder', 'tenant_admin', 'super_admin'));

DROP POLICY IF EXISTS sku_mappings_stakeholder_modify ON commercial.sku_mappings;
CREATE POLICY sku_mappings_stakeholder_modify ON commercial.sku_mappings
  FOR ALL TO authenticated
  USING (app_private.app_role() IN ('commercial_stakeholder', 'tenant_admin', 'super_admin'))
  WITH CHECK (app_private.app_role() IN ('commercial_stakeholder', 'tenant_admin', 'super_admin'));

DROP POLICY IF EXISTS sku_mappings_svc_all ON commercial.sku_mappings;
CREATE POLICY sku_mappings_svc_all ON commercial.sku_mappings
  FOR ALL TO svc_commercial
  USING (true) WITH CHECK (true);

-- 3. Observed Orders (Ledger events from extension, not store transactions)
CREATE TABLE IF NOT EXISTS commercial.orders (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  shopper_alias   bytea NOT NULL,
  epoch           int   NOT NULL,
  retailer        text  NOT NULL,
  status          text  NOT NULL,
  total_kes       numeric(12,2),
  idempotency_key text  NOT NULL,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  source          text  NOT NULL DEFAULT 'extension_observed',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

SELECT app_private.apply_tenant_wall('commercial.orders');

DROP POLICY IF EXISTS orders_svc_all ON commercial.orders;
CREATE POLICY orders_svc_all ON commercial.orders
  FOR ALL TO svc_commercial
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS orders_stakeholder_select ON commercial.orders;
CREATE POLICY orders_stakeholder_select ON commercial.orders
  FOR SELECT TO authenticated
  USING (app_private.app_role() IN ('commercial_stakeholder', 'tenant_admin', 'super_admin'));

-- 4. Observed Order Lines
CREATE TABLE IF NOT EXISTS commercial.order_lines (
  tenant_id      uuid NOT NULL,
  order_id       uuid NOT NULL,
  line_no        int  NOT NULL,
  sku_id         uuid NOT NULL REFERENCES commercial.skus (sku_id),
  qty            int  NOT NULL CHECK (qty > 0),
  unit_price_kes numeric(12,2) NOT NULL,
  PRIMARY KEY (tenant_id, order_id, line_no),
  FOREIGN KEY (tenant_id, order_id) REFERENCES commercial.orders (tenant_id, id) ON DELETE CASCADE
);

SELECT app_private.apply_tenant_wall('commercial.order_lines');

DROP POLICY IF EXISTS order_lines_svc_all ON commercial.order_lines;
CREATE POLICY order_lines_svc_all ON commercial.order_lines
  FOR ALL TO svc_commercial
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS order_lines_stakeholder_select ON commercial.order_lines;
CREATE POLICY order_lines_stakeholder_select ON commercial.order_lines
  FOR SELECT TO authenticated
  USING (app_private.app_role() IN ('commercial_stakeholder', 'tenant_admin', 'super_admin'));

-- 5. Views: Stakeholder order tracking (without alias) and demand analytics (k >= 5)
DROP VIEW IF EXISTS commercial.v_orders_tracking CASCADE;
CREATE VIEW commercial.v_orders_tracking WITH (security_invoker = true) AS
  SELECT tenant_id, id, retailer, status, total_kes, placed_at
  FROM commercial.orders;

DROP VIEW IF EXISTS commercial.v_sku_demand CASCADE;
CREATE VIEW commercial.v_sku_demand WITH (security_invoker = true) AS
  SELECT o.tenant_id, l.sku_id, date_trunc('week', o.placed_at) AS week,
         count(DISTINCT o.shopper_alias) AS shoppers, sum(l.qty) AS units
  FROM commercial.orders o
  JOIN commercial.order_lines l ON l.tenant_id = o.tenant_id AND l.order_id = o.id
  GROUP BY o.tenant_id, l.sku_id, date_trunc('week', o.placed_at)
  HAVING count(DISTINCT o.shopper_alias) >= 5;

-- 6. Public compatibility views
DROP VIEW IF EXISTS public.skus CASCADE;
CREATE VIEW public.skus WITH (security_invoker = true) AS
  SELECT * FROM commercial.skus;

DROP VIEW IF EXISTS public.sku_mappings CASCADE;
CREATE VIEW public.sku_mappings WITH (security_invoker = true) AS
  SELECT * FROM commercial.sku_mappings;

DROP VIEW IF EXISTS public.v_orders_tracking CASCADE;
CREATE VIEW public.v_orders_tracking WITH (security_invoker = true) AS
  SELECT * FROM commercial.v_orders_tracking;

DROP VIEW IF EXISTS public.v_sku_demand CASCADE;
CREATE VIEW public.v_sku_demand WITH (security_invoker = true) AS
  SELECT * FROM commercial.v_sku_demand;

-- 7. Privileges
GRANT SELECT ON commercial.skus TO authenticated, anon, svc_commercial;
GRANT INSERT, UPDATE, DELETE ON commercial.skus TO svc_commercial;

GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.sku_mappings TO authenticated, svc_commercial;

GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.orders TO svc_commercial;
GRANT SELECT ON commercial.orders TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.order_lines TO svc_commercial;
GRANT SELECT ON commercial.order_lines TO authenticated;

GRANT SELECT ON commercial.v_orders_tracking, commercial.v_sku_demand TO authenticated, svc_commercial;
GRANT SELECT ON public.skus, public.sku_mappings, public.v_orders_tracking, public.v_sku_demand TO authenticated, anon;

COMMIT;
