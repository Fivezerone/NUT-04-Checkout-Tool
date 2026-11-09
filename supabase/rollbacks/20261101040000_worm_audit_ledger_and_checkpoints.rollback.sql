-- NutriScore CAD Blueprint Phase 5 Rollback
-- Rolls back 20261101040000_worm_audit_ledger_and_checkpoints.sql

BEGIN;

-- 1. Drop public compatibility views
DROP VIEW IF EXISTS public.v_ledger_platform CASCADE;

-- 2. Drop platform metadata view
DROP VIEW IF EXISTS audit.v_ledger_platform CASCADE;

-- 3. Unfreeze legacy audit log
DROP TRIGGER IF EXISTS trg_legacy_audit_freeze ON audit.legacy_audit_log;
DROP FUNCTION IF EXISTS audit.deny_legacy_audit_mutation();

-- 4. Drop ledger and checkpoint triggers
DROP TRIGGER IF EXISTS trg_audit_log_tamper ON audit.ledger;
DROP TRIGGER IF EXISTS trg_audit_log_truncate ON audit.ledger;
DROP TRIGGER IF EXISTS trg_checkpoints_tamper ON audit.checkpoints;
DROP TRIGGER IF EXISTS trg_checkpoints_truncate ON audit.checkpoints;

-- 5. Drop functions
DROP FUNCTION IF EXISTS audit.append_ledger_entry CASCADE;
DROP FUNCTION IF EXISTS audit.genesis_hash(uuid) CASCADE;
DROP FUNCTION IF EXISTS audit.deny_mutation() CASCADE;

-- 6. Drop tables
DROP TABLE IF EXISTS audit.outbox CASCADE;
DROP TABLE IF EXISTS audit.checkpoints CASCADE;
DROP TABLE IF EXISTS audit.ledger CASCADE;

-- 7. Drop pgaudit extension
DROP EXTENSION IF EXISTS pgaudit;

COMMIT;

