-- Migration: 20261019000000_add_quickmart_retailer
-- Finding: Multi-tenant retailer registration for Quickmart
--
-- Registers Quickmart in public.retailers to satisfy foreign key constraints:
-- - catalog_products_retailer_fk
-- - catalog_premium_retailer_fk

insert into public.retailers (id, display_name, hosts) values
  ('QUICKMART', 'Quickmart', array['quickmart.co.ke'])
on conflict (id) do update set
  display_name = excluded.display_name,
  hosts = excluded.hosts;
