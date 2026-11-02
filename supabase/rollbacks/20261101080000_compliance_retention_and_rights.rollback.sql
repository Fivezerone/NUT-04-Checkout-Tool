-- NutriScore CAD Blueprint Phase 9
-- Rollback: Compliance machinery, retention enforcement, data-subject rights
-- Reference: Blueprint §4.1, §5.1, Decision D5, Amendments A2-A3

BEGIN;

DROP FUNCTION IF EXISTS clinical.execute_retention_purge(uuid, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS clinical.rectify_clinical_record(uuid, uuid, uuid, jsonb, text) CASCADE;
DROP FUNCTION IF EXISTS clinical.set_patient_restriction(uuid, uuid, boolean, text) CASCADE;

COMMIT;
