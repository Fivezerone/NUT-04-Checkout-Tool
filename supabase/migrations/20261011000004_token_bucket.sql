-- Migration: 004_token_bucket
-- Finding: F-14 — Atomic token bucket for Edge Functions (entitlement rate-limiting).
--
-- UNLOGGED: no WAL, much cheaper writes; losing buckets on a crash only means
-- everyone briefly gets a full bucket.

create unlogged table if not exists public.rate_buckets (
  key        text primary key,
  tokens     double precision not null,
  updated_at timestamptz      not null default clock_timestamp()
);

alter table public.rate_buckets enable row level security;     -- no policies => unreachable via PostgREST
revoke all on public.rate_buckets from anon, authenticated;

create or replace function public.rate_limit_take(
  p_key text, p_capacity int, p_refill_per_sec double precision, p_cost int default 1
) returns table (allowed boolean, retry_after_ms int)
language plpgsql security definer set search_path = public as $$
declare
  v_now     timestamptz := clock_timestamp();
  v_tokens  double precision;
  v_updated timestamptz;
begin
  insert into public.rate_buckets (key, tokens, updated_at) values (p_key, p_capacity, v_now)
    on conflict (key) do nothing;

  -- Row lock serialises concurrent calls for the SAME key only; different users never contend.
  select b.tokens, b.updated_at into v_tokens, v_updated
    from public.rate_buckets b where b.key = p_key for update;

  v_tokens := least(p_capacity::double precision,
                    v_tokens + extract(epoch from (v_now - v_updated)) * p_refill_per_sec);

  if v_tokens >= p_cost then
    update public.rate_buckets set tokens = v_tokens - p_cost, updated_at = v_now where key = p_key;
    return query select true, 0;
    return; -- RETURN QUERY does not exit: without this the denied branch below also runs
  end if;

  update public.rate_buckets set tokens = v_tokens, updated_at = v_now where key = p_key;
  return query select false, ceil((p_cost - v_tokens) / p_refill_per_sec * 1000)::int;
end $$;

revoke all on function public.rate_limit_take(text, int, double precision, int) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, int, double precision, int) to service_role;
