-- Migration: 002_drop_retailer_check_constraint
-- Finding: F-13 — "Retailers are code, not data"
--
-- Root cause: catalog_products and catalog_premium both carry
--   CHECK (retailer IN ('CARREFOUR','NAIVAS'))
-- Adding a third retailer requires a schema migration AND triggers a full
-- re-sync of all existing clients (because the constraint is live on every
-- INSERT/UPDATE). A retailer whose host_permissions are added to a future
-- extension update also causes the "permission upgrade warning" re-approval
-- flow in Chrome — this is unavoidable — but it should not also require a
-- DB schema migration.
--
-- Fix: drop the CHECK constraints so the retailer column accepts any
-- non-empty uppercase string. Existing rows are unaffected; the publisher
-- already validates data at ingestion time via the catalog_upsert RPC which
-- can be extended independently.
--
-- Safe to apply on a live DB: ALTER TABLE … DROP CONSTRAINT is instant for
-- check-only constraints (no table rewrite). Existing NAIVAS and CARREFOUR
-- rows are unchanged.

-- catalog_products
alter table public.catalog_products
  drop constraint if exists catalog_products_retailer_check;

-- catalog_premium
alter table public.catalog_premium
  drop constraint if exists catalog_premium_retailer_check;

-- Add a non-null, length-bounded check instead so the column still has
-- a lightweight sanity guard (not tied to a specific retailer set).
alter table public.catalog_products
  add constraint catalog_products_retailer_fmt
    check (retailer ~ '^[A-Z_]{2,32}$');

alter table public.catalog_premium
  add constraint catalog_premium_retailer_fmt
    check (retailer ~ '^[A-Z_]{2,32}$');
