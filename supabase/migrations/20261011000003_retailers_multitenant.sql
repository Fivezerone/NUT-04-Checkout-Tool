-- Migration: 003_retailers_multitenant
-- Finding: F-13 — Multi-tenant retailer registry as data, not code.
--
-- Creates the public.retailers table to store supported retailers, hosts,
-- and declarative adapter specifications dynamically.

create table if not exists public.retailers (
  id                text primary key check (id ~ '^[A-Z0-9_]{2,32}$'),
  display_name      text not null,
  hosts             text[] not null,                         -- registrable hostnames; drives optional_host_permissions + dynamic content-script registration
  adapter_spec      jsonb,                                   -- declarative selectors/rules (data only — never code)
  adapter_spec_hash text,
  enabled           boolean  not null default true,
  rollout_pct       smallint not null default 100 check (rollout_pct between 0 and 100),
  updated_at        timestamptz not null default now()
);

insert into public.retailers (id, display_name, hosts) values
  ('NAIVAS',    'Naivas',          array['naivas.online','naivas.co.ke']),
  ('CARREFOUR', 'Carrefour Kenya', array['carrefour.ke','carrefourkenya.com'])
on conflict (id) do nothing;

alter table public.retailers enable row level security;
revoke all on public.retailers from anon, authenticated;
grant select on public.retailers to authenticated;
drop policy if exists retailers_read on public.retailers;
create policy retailers_read on public.retailers for select to authenticated using (enabled);

-- Enforce foreign key from catalog products and premium to retailers table
alter table public.catalog_products drop constraint if exists catalog_products_retailer_fk;
alter table public.catalog_premium  drop constraint if exists catalog_premium_retailer_fk;
alter table public.catalog_products add constraint catalog_products_retailer_fk foreign key (retailer) references public.retailers(id) not valid;
alter table public.catalog_premium  add constraint catalog_premium_retailer_fk  foreign key (retailer) references public.retailers(id) not valid;
alter table public.catalog_products validate constraint catalog_products_retailer_fk;
alter table public.catalog_premium  validate constraint catalog_premium_retailer_fk;
