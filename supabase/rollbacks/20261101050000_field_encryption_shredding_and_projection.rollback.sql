-- NutriScore CAD Blueprint Phase 6 Rollback
-- Rolls back 20261101050000_field_encryption_shredding_and_projection.sql

BEGIN;

-- 1. Drop compatibility views
DROP VIEW IF EXISTS public.exchange_projection CASCADE;

-- 2. Revoke privileges
REVOKE ALL ON exchange.projection, exchange.projection_outbox FROM svc_exchange;

-- 3. Drop trigger and function on published_profiles
DROP TRIGGER IF EXISTS trg_published_profiles_exchange_sync ON clinical.published_profiles;
DROP FUNCTION IF EXISTS clinical.trg_sync_published_profile_to_exchange() CASCADE;

-- 4. Drop tables in exchange schema
DROP TABLE IF EXISTS exchange.projection_outbox CASCADE;
DROP TABLE IF EXISTS exchange.projection CASCADE;

-- 5. Drop SQL helper functions
DROP FUNCTION IF EXISTS clinical.keyed_mac(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS clinical.blind_index(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS clinical.derive_tenant_mac_key(uuid) CASCADE;
DROP FUNCTION IF EXISTS clinical.derive_tenant_bidx_key(uuid) CASCADE;
DROP FUNCTION IF EXISTS clinical.crypto_shred_patient(uuid, uuid) CASCADE;

-- 6. Drop patient_keys table
DROP TABLE IF EXISTS clinical.patient_keys CASCADE;

COMMIT;
