-- migrate:down
-- db/migrations/0004_stream_events.rollback.sql
-- Rollback for 0004_stream_events.sql

BEGIN;

DROP POLICY IF EXISTS stream_events_tenant_isolation ON public.stream_events;
DROP TABLE IF EXISTS public.stream_cursors CASCADE;
DROP TABLE IF EXISTS public.stream_events CASCADE;

COMMIT;
