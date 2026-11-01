-- Phase 3 rollback preserves clinical/audit data and revocation records.
BEGIN;
DROP FUNCTION IF EXISTS public.update_tenant_member_role(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.deactivate_tenant_member(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.authz_deny(uuid);
DROP FUNCTION IF EXISTS public.remove_platform_member(uuid);
DROP FUNCTION IF EXISTS public.create_platform_member(uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.provisioning_grant_exists(text, text, text);
DROP FUNCTION IF EXISTS public.edge_token_is_denied(text, uuid);
DROP FUNCTION IF EXISTS iam.grant_exists(text, text, text);
DROP TABLE IF EXISTS iam.platform_members;
ALTER TABLE iam.members DROP CONSTRAINT IF EXISTS members_partner_org_check;
ALTER TABLE iam.members DROP COLUMN IF EXISTS partner_org;
COMMIT;
