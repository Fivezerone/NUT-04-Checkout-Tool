-- Rollback for 20261101000000_cad_schema_foundation.sql.
-- Run only before Phase 2. It restores relation names without deleting data.

BEGIN;

DROP POLICY IF EXISTS tenant_wall ON iam.members;
DROP POLICY IF EXISTS tenant_wall ON audit.legacy_audit_log;
DROP POLICY IF EXISTS tenant_wall ON clinical.targets;
DROP POLICY IF EXISTS tenant_wall ON clinical.target_bundles;
DROP POLICY IF EXISTS tenant_wall ON clinical.consumption_diary;
DROP POLICY IF EXISTS tenant_wall ON clinical.consent_records;
DROP POLICY IF EXISTS tenant_wall ON clinical.patient_links;
DROP POLICY IF EXISTS tenant_wall ON clinical.consents;
DROP POLICY IF EXISTS tenant_wall ON clinical.health_modes;
DROP POLICY IF EXISTS tenant_wall ON clinical.health_mode_rules;
DROP POLICY IF EXISTS tenant_wall ON public.users;
DROP POLICY IF EXISTS tenant_wall ON public.payments;
DROP POLICY IF EXISTS tenant_wall ON public.subscriptions;
DROP POLICY IF EXISTS tenant_wall ON public.invoices;
DROP POLICY IF EXISTS tenant_wall ON public.payment_attempts;

ALTER TABLE iam.members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.legacy_audit_log NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical.targets NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical.target_bundles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical.consumption_diary NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical.consent_records NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical.patient_links NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical.consents NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical.health_modes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical.health_mode_rules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts NO FORCE ROW LEVEL SECURITY;

DROP VIEW IF EXISTS public.audit_log;
DROP VIEW IF EXISTS public.tracked_nutrients;
DROP VIEW IF EXISTS public.health_mode_rules;
DROP VIEW IF EXISTS public.health_modes;
DROP VIEW IF EXISTS public.consents;
DROP VIEW IF EXISTS public.patient_links;
DROP VIEW IF EXISTS public.consent_records;
DROP VIEW IF EXISTS public.consumption_diary;
DROP VIEW IF EXISTS public.target_bundles;
DROP VIEW IF EXISTS public.targets;
DROP VIEW IF EXISTS public.tenant_members;
DROP VIEW IF EXISTS public.tenants;

ALTER TABLE audit.legacy_audit_log RENAME TO audit_log;
ALTER TABLE audit.audit_log SET SCHEMA public;

ALTER TABLE clinical.health_mode_rules SET SCHEMA public;
ALTER TABLE clinical.health_modes SET SCHEMA public;
ALTER TABLE clinical.tracked_nutrients SET SCHEMA public;
ALTER TABLE clinical.consents SET SCHEMA public;
ALTER TABLE clinical.patient_links SET SCHEMA public;
ALTER TABLE clinical.consent_records SET SCHEMA public;
ALTER TABLE clinical.consumption_diary SET SCHEMA public;
ALTER TABLE clinical.target_bundles SET SCHEMA public;
ALTER TABLE clinical.targets SET SCHEMA public;

ALTER TABLE iam.members RENAME TO tenant_members;
ALTER TABLE iam.tenant_members SET SCHEMA public;
ALTER TABLE iam.tenants SET SCHEMA public;

DROP FUNCTION IF EXISTS app_private.apply_tenant_wall(text);
DROP FUNCTION IF EXISTS app_private.is_active_member();
DROP FUNCTION IF EXISTS app_private.ban_until();
DROP FUNCTION IF EXISTS app_private.uid();
DROP FUNCTION IF EXISTS app_private.app_role();
DROP FUNCTION IF EXISTS app_private.tenant_id();
DROP FUNCTION IF EXISTS app_private.claims();

COMMIT;

