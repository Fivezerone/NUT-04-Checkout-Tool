-- migrate:down
-- db/migrations/0003_bff_session_and_audit.rollback.sql
-- Companion rollback for 0003_bff_session_and_audit.sql

BEGIN;
DROP TRIGGER IF EXISTS trg_prevent_audit_entry_modification ON public.audit_entry;
DROP FUNCTION IF EXISTS public.prevent_audit_entry_modification();
DROP TABLE IF EXISTS public.audit_roots CASCADE;
DROP TABLE IF EXISTS public.audit_entry CASCADE;
DROP TABLE IF EXISTS public.session_denylist CASCADE;
DROP TABLE IF EXISTS public.session_store CASCADE;
COMMIT;
