-- migrate:up
-- db/migrations/0004_stream_events.sql
-- NUT-04 Checkout Tool — Real-Time Event Stream & Replay Buffer (N6, F-07, G-06)
-- References: Blueprint §3.6 (N6), §4.2; ADR-002, ADR-004

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Real-Time Stream Events Table (Replay Buffer, Blueprint §3.6)
-- Buffer for Last-Event-ID resume (10m TTL / 5,000 events window per scope)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stream_events (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  scope text NOT NULL,
  event_type text NOT NULL,
  epoch bigint NOT NULL,
  seq bigint NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  audience text NOT NULL DEFAULT 'all',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_stream_events_scope_epoch_seq UNIQUE (tenant_id, scope, epoch, seq)
);

CREATE INDEX IF NOT EXISTS idx_stream_events_tenant_scope_seq
  ON public.stream_events (tenant_id, scope, epoch, seq);

CREATE INDEX IF NOT EXISTS idx_stream_events_created_at
  ON public.stream_events (created_at);

-- ---------------------------------------------------------------------------
-- 2. Stream Monotonic Sequence Generator & Cursors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stream_cursors (
  tenant_id text NOT NULL,
  scope text NOT NULL,
  current_epoch bigint NOT NULL DEFAULT 1,
  current_seq bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, scope)
);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security Policies (ADR-008, Blueprint §3.6)
-- ---------------------------------------------------------------------------
ALTER TABLE public.stream_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stream_events'
      AND policyname = 'stream_events_tenant_isolation'
  ) THEN
    CREATE POLICY stream_events_tenant_isolation ON public.stream_events
      FOR SELECT
      USING (
        tenant_id = NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'tenant_id', '')
        OR current_setting('request.jwt.claims', true)::jsonb->>'app_role' = 'super_admin'
      );
  END IF;
END $$;

COMMIT;
