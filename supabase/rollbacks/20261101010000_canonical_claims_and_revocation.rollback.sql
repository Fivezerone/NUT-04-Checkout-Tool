-- Safety rollback record for 20261101010000.
--
-- Do not restore application authorization to the Supabase-reserved `role`
-- claim. That would reintroduce the condition fixed by A1/Option 2 and can
-- make still-issued tokens authorize differently. The safe rollback is a
-- forward migration that preserves app_role while correcting the new consumer
-- or claim mapping. Token denylist rows and canonical member columns are also
-- retained so a revoked session can never become valid through rollback.
--
-- This intentionally performs no destructive schema operation.
BEGIN;
COMMIT;

