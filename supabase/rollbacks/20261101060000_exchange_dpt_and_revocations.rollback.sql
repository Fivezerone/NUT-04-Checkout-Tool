-- NutriScore CAD Blueprint Phase 7 Rollback
-- Rolls back 20261101060000_exchange_dpt_and_revocations.sql

BEGIN;

-- 1. Drop compatibility views
DROP VIEW IF EXISTS public.exchange_revocations CASCADE;

-- 2. Drop consent withdrawal trigger and function
DROP TRIGGER IF EXISTS trg_consent_withdrawal ON clinical.consent_records;
DROP FUNCTION IF EXISTS clinical.trg_consent_withdrawal_notice() CASCADE;

-- 3. Drop exchange functions
DROP FUNCTION IF EXISTS exchange.erase_alias(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS exchange.revoke_token(uuid, timestamptz, text) CASCADE;
DROP FUNCTION IF EXISTS exchange.is_token_revoked(uuid) CASCADE;

-- 4. Drop tables
DROP TABLE IF EXISTS exchange.alias_map CASCADE;
DROP TABLE IF EXISTS exchange.revocations CASCADE;

COMMIT;
