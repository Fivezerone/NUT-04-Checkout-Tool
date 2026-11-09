-- NutriScore CAD Blueprint Phase 8
-- Rollback: Commercial overlay, observed orders, and demand analytics
-- Reference: Blueprint §4.3, Decision D6, Amendment A6

BEGIN;

DROP VIEW IF EXISTS public.v_sku_demand CASCADE;
DROP VIEW IF EXISTS public.v_orders_tracking CASCADE;
DROP VIEW IF EXISTS public.sku_mappings CASCADE;
DROP VIEW IF EXISTS public.skus CASCADE;

DROP VIEW IF EXISTS commercial.v_sku_demand CASCADE;
DROP VIEW IF EXISTS commercial.v_orders_tracking CASCADE;

DROP TABLE IF EXISTS commercial.order_lines CASCADE;
DROP TABLE IF EXISTS commercial.orders CASCADE;
DROP TABLE IF EXISTS commercial.sku_mappings CASCADE;
DROP TABLE IF EXISTS commercial.skus CASCADE;

COMMIT;
