-- migrate:up
-- db/migrations/0002_telemetry_and_consent.sql
-- NUT-04 Checkout Tool — Telemetry Gateway, Bronze Ingest & Consent Register
-- References: Blueprint §3.3 (N3), §3.9 (N9), §4.2; ADR-005, ADR-008, ADR-012

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Consent Register (Blueprint §3.9 N9, §4.2)
-- Receipts: consent_register rows hold consent_ref, patient_ref, tenant_id,
-- purpose ('C1', 'C2', 'C3', 'C4'), scope, notice_hash, granted_at, expires_at, revoked_at.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_register (
  consent_ref text PRIMARY KEY,
  patient_ref text NOT NULL,
  tenant_id text,
  purpose text NOT NULL CHECK (purpose IN ('C1', 'C2', 'C3', 'C4')),
  scope text,
  notice_hash text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_register_patient_purpose
  ON public.consent_register (patient_ref, purpose);
CREATE INDEX IF NOT EXISTS idx_consent_register_lookup
  ON public.consent_register (consent_ref, purpose, revoked_at, expires_at);

-- ---------------------------------------------------------------------------
-- 2. Telemetry Dedupe Gate Index (Blueprint §3.3 N3)
-- A partitioned table cannot hold a global PK, so dedupe gate uses telemetry_event_index
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_event_index (
  event_id char(26) PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_event_index_received_at
  ON public.telemetry_event_index (received_at);

-- ---------------------------------------------------------------------------
-- 3. Telemetry Batch Idempotency (Blueprint §3.3 N3)
-- Batch Idempotency-Key (sha256 of sorted event_ids) short-circuits identical retries for 24h
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_batch_idempotency (
  idempotency_key text PRIMARY KEY,
  batch_id text NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_batch_idempotency_created_at
  ON public.telemetry_batch_idempotency (created_at);

-- ---------------------------------------------------------------------------
-- 4. Telemetry Bronze Table (Blueprint §3.3 N3, §4.2)
-- Raw telemetry stream, partitioned daily by received_at; append-only WORM ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_bronze (
  event_id char(26) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  occurred_at timestamptz NOT NULL,
  shopper_ref text NOT NULL,
  retailer text NOT NULL,
  type text NOT NULL,
  consent_ref text NOT NULL,
  profile_ver int,
  client_seq bigint NOT NULL,
  schema_ver text NOT NULL,
  payload jsonb NOT NULL,
  flags text[] NOT NULL DEFAULT '{}'
) PARTITION BY RANGE (received_at);

-- Default partition ensures any received_at timestamp can be accepted without error
CREATE TABLE IF NOT EXISTS public.telemetry_bronze_default
  PARTITION OF public.telemetry_bronze DEFAULT;

-- ---------------------------------------------------------------------------
-- 5. Telemetry Shadow Table (Blueprint §3.3 N3, §4.2)
-- For requests with X-NS-Shadow: 1 (feeds nothing to analytics)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_shadow (
  event_id char(26) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  occurred_at timestamptz NOT NULL,
  shopper_ref text NOT NULL,
  retailer text NOT NULL,
  type text NOT NULL,
  consent_ref text NOT NULL,
  profile_ver int,
  client_seq bigint NOT NULL,
  schema_ver text NOT NULL,
  payload jsonb NOT NULL,
  flags text[] NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- 6. Append-Only WORM Guard on Telemetry Bronze (Rule 5 & ADR-012)
-- Prohibits UPDATE and DELETE operations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_telemetry_bronze_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'telemetry_bronze is an append-only WORM ledger: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_telemetry_bronze_modification ON public.telemetry_bronze;
CREATE TRIGGER trg_prevent_telemetry_bronze_modification
  BEFORE UPDATE OR DELETE ON public.telemetry_bronze
  FOR EACH ROW EXECUTE FUNCTION public.prevent_telemetry_bronze_modification();

DROP TRIGGER IF EXISTS trg_prevent_telemetry_bronze_default_modification ON public.telemetry_bronze_default;
CREATE TRIGGER trg_prevent_telemetry_bronze_default_modification
  BEFORE UPDATE OR DELETE ON public.telemetry_bronze_default
  FOR EACH ROW EXECUTE FUNCTION public.prevent_telemetry_bronze_modification();

-- ---------------------------------------------------------------------------
-- 7. Atomic Ingest Stored Procedure (Blueprint §3.3)
-- Ingests events atomically with deduplication against telemetry_event_index
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_telemetry_batch(p_events jsonb, p_shadow boolean DEFAULT false)
RETURNS jsonb AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_item jsonb;
  v_event_id text;
  v_inserted_id text;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    v_event_id := v_item->>'event_id';
    
    -- Attempt deduplication insert
    INSERT INTO public.telemetry_event_index (event_id, received_at)
    VALUES (v_event_id, now())
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
      -- Already processed
      v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'duplicate');
    ELSE
      -- Insert into bronze or shadow
      IF p_shadow THEN
        INSERT INTO public.telemetry_shadow (
          event_id, occurred_at, shopper_ref, retailer, type,
          consent_ref, profile_ver, client_seq, schema_ver, payload, flags
        ) VALUES (
          v_event_id,
          (v_item->>'occurred_at')::timestamptz,
          v_item->>'shopper_ref',
          v_item->>'retailer',
          v_item->>'type',
          v_item->>'consent_ref',
          (v_item->>'profile_ver')::int,
          (v_item->>'client_seq')::bigint,
          v_item->>'schema_ver',
          v_item->'payload',
          COALESCE((SELECT array_agg(x.value::text) FROM jsonb_array_elements_text(v_item->'flags') x), '{}'::text[])
        );
      ELSE
        INSERT INTO public.telemetry_bronze (
          event_id, occurred_at, shopper_ref, retailer, type,
          consent_ref, profile_ver, client_seq, schema_ver, payload, flags
        ) VALUES (
          v_event_id,
          (v_item->>'occurred_at')::timestamptz,
          v_item->>'shopper_ref',
          v_item->>'retailer',
          v_item->>'type',
          v_item->>'consent_ref',
          (v_item->>'profile_ver')::int,
          (v_item->>'client_seq')::bigint,
          v_item->>'schema_ver',
          v_item->'payload',
          COALESCE((SELECT array_agg(x.value::text) FROM jsonb_array_elements_text(v_item->'flags') x), '{}'::text[])
        );
      END IF;

      v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'accepted');
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security & Permissions (Rule 5 & ADR-008)
-- ---------------------------------------------------------------------------
ALTER TABLE public.consent_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_event_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_batch_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_bronze ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_shadow ENABLE ROW LEVEL SECURITY;

-- Grants for service_role and authenticated users
GRANT SELECT, INSERT ON public.consent_register TO authenticated, service_role;
GRANT SELECT, UPDATE ON public.consent_register TO service_role;
GRANT SELECT, INSERT ON public.telemetry_event_index TO authenticated, service_role;
GRANT SELECT, INSERT ON public.telemetry_batch_idempotency TO authenticated, service_role;
GRANT SELECT, INSERT ON public.telemetry_bronze TO authenticated, service_role;
GRANT SELECT, INSERT ON public.telemetry_shadow TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingest_telemetry_batch(jsonb, boolean) TO authenticated, service_role;

REVOKE UPDATE, DELETE ON public.telemetry_bronze FROM authenticated, service_role, public;
REVOKE UPDATE, DELETE ON public.telemetry_bronze_default FROM authenticated, service_role, public;

COMMIT;

-- migrate:down
BEGIN;
DROP FUNCTION IF EXISTS public.ingest_telemetry_batch(jsonb, boolean);
DROP TRIGGER IF EXISTS trg_prevent_telemetry_bronze_default_modification ON public.telemetry_bronze_default;
DROP TRIGGER IF EXISTS trg_prevent_telemetry_bronze_modification ON public.telemetry_bronze;
DROP FUNCTION IF EXISTS public.prevent_telemetry_bronze_modification();
DROP TABLE IF EXISTS public.telemetry_shadow CASCADE;
DROP TABLE IF EXISTS public.telemetry_bronze_default CASCADE;
DROP TABLE IF EXISTS public.telemetry_bronze CASCADE;
DROP TABLE IF EXISTS public.telemetry_batch_idempotency CASCADE;
DROP TABLE IF EXISTS public.telemetry_event_index CASCADE;
DROP TABLE IF EXISTS public.consent_register CASCADE;
COMMIT;
