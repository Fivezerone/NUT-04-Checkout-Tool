-- NutriScore CAD Blueprint — Stage B Postgres Logical Replication DDL
-- Reference: Blueprint §2.6 (Database topology & replication), Amendment A5
-- Status: Prepared, never deployed (Phase 10 Cutover Readiness)
--
-- Replaces Stage A outbox trigger with PostgreSQL 15+ column-filtered and
-- row-filtered logical replication between clinical-db and exchange-db.

-- ============================================================================
-- 1. Source Database: clinical-db (Port 5432)
-- ============================================================================

-- Create dedicated, least-privilege replication login role
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'repl_exchange_user') THEN
    CREATE ROLE repl_exchange_user WITH REPLICATION LOGIN PASSWORD 'CHANGE_IN_VAULT';
  END IF;
END $$;

-- Grant select strictly on the published profiles table
GRANT USAGE ON SCHEMA clinical TO repl_exchange_user;
GRANT SELECT (
  tenant_id,
  patient_id,
  carbs_g_100g_max,
  sugars_g_100g_max,
  sodium_mg_100g_max,
  satfat_g_100g_max,
  energy_kcal_100g_max,
  fibre_g_100g_min,
  status,
  updated_at
) ON clinical.published_profiles TO repl_exchange_user;

-- Create publication with PostgreSQL 15+ column list and row filter:
-- 1. Strictly the 6 allowlisted nutrient bounds plus IDs and status (NO condition names, NO diagnoses)
-- 2. Row filter replicates only active, validated profiles (status = 'active')
DROP PUBLICATION IF EXISTS clinical_semantic_pub;

CREATE PUBLICATION clinical_semantic_pub FOR TABLE clinical.published_profiles (
  tenant_id,
  patient_id,
  carbs_g_100g_max,
  sugars_g_100g_max,
  sodium_mg_100g_max,
  satfat_g_100g_max,
  energy_kcal_100g_max,
  fibre_g_100g_min,
  status,
  updated_at
)
WHERE (status = 'active');


-- ============================================================================
-- 2. Target Database: exchange-db (Port 5432)
-- ============================================================================

-- Target table in exchange database (mirrors the allowlisted projection)
CREATE SCHEMA IF NOT EXISTS exchange;

CREATE TABLE IF NOT EXISTS exchange.projection (
  tenant_id            uuid NOT NULL,
  patient_id           uuid NOT NULL,
  carbs_g_100g_max     numeric,
  sugars_g_100g_max    numeric,
  sodium_mg_100g_max   numeric,
  satfat_g_100g_max    numeric,
  energy_kcal_100g_max numeric,
  fibre_g_100g_min     numeric,
  status               text NOT NULL DEFAULT 'active',
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, patient_id)
);

-- Target subscription connected via mTLS to clinical-db
-- (Run inside exchange-db upon cluster cutover)
/*
CREATE SUBSCRIPTION exchange_semantic_sub
  CONNECTION 'host=clinical-db.clinical.svc.cluster.local port=5432 dbname=clinical user=repl_exchange_user sslmode=verify-full sslrootcert=/etc/ssl/certs/k8s-ca.crt'
  PUBLICATION clinical_semantic_pub
  WITH (
    copy_data = true,
    create_slot = true,
    enabled = true,
    slot_name = 'sub_exchange_semantic'
  );
*/
