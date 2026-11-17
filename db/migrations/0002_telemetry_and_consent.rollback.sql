-- migrate:down
-- db/migrations/0002_telemetry_and_consent.rollback.sql
-- Companion rollback for 0002_telemetry_and_consent.sql

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
