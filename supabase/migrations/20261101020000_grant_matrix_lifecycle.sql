-- NutriScore CAD Blueprint Phase 3: lifecycle authority is an explicit grant
-- matrix. No numeric rank participates in authorization.

BEGIN;

ALTER TABLE iam.members ADD COLUMN IF NOT EXISTS partner_org text;
ALTER TABLE iam.members DROP CONSTRAINT IF EXISTS members_partner_org_check;
ALTER TABLE iam.members ADD CONSTRAINT members_partner_org_check CHECK (
  (role = 'commercial_stakeholder' AND length(btrim(partner_org)) > 0)
  OR (role <> 'commercial_stakeholder' AND partner_org IS NULL)
) NOT VALID;

CREATE TABLE IF NOT EXISTS iam.platform_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('super_admin', 'compliance_auditor')),
  auditor_scope text CHECK (auditor_scope IN ('platform')),
  regulator_body text CHECK (regulator_body IN ('DHA', 'ODPC')),
  mandate_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CHECK (
    (role = 'compliance_auditor' AND auditor_scope = 'platform'
      AND regulator_body IN ('DHA', 'ODPC') AND length(btrim(mandate_ref)) > 0)
    OR (role = 'super_admin' AND auditor_scope IS NULL AND regulator_body IS NULL AND mandate_ref IS NULL)
  )
);

INSERT INTO iam.platform_members (user_id, role, status)
SELECT user_id, 'super_admin', status
FROM iam.members
WHERE role = 'super_admin'
ON CONFLICT (user_id) DO NOTHING;

-- D1 replaces the previous tenant-admin stakeholder row. The only stakeholder
-- provisioning authority is a super-admin platform grant; the resulting
-- account still has exactly one tenant membership (assumption O1).
DELETE FROM iam.role_grants
WHERE grantor_role = 'tenant_admin' AND grantee_role = 'commercial_stakeholder' AND scope = 'tenant';
INSERT INTO iam.role_grants (grantor_role, grantee_role, scope)
VALUES ('super_admin', 'commercial_stakeholder', 'platform')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION iam.grant_exists(
  p_grantor text,
  p_grantee text,
  p_scope text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
  SELECT EXISTS (
    SELECT 1 FROM iam.role_grants
    WHERE grantor_role = p_grantor AND grantee_role = p_grantee AND scope = p_scope
  )
$$;
ALTER FUNCTION iam.grant_exists(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION iam.grant_exists(text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.provisioning_grant_exists(
  p_grantor text,
  p_grantee text,
  p_scope text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$ SELECT iam.grant_exists(p_grantor, p_grantee, p_scope) $$;
ALTER FUNCTION public.provisioning_grant_exists(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provisioning_grant_exists(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provisioning_grant_exists(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_platform_member(
  p_user_id uuid,
  p_role text,
  p_regulator_body text,
  p_mandate_ref text,
  p_created_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
BEGIN
  INSERT INTO iam.platform_members (
    user_id, role, auditor_scope, regulator_body, mandate_ref, status, created_by
  ) VALUES (
    p_user_id, p_role,
    CASE WHEN p_role = 'compliance_auditor' THEN 'platform' ELSE NULL END,
    p_regulator_body, p_mandate_ref, 'active', p_created_by
  )
  ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role,
      auditor_scope = EXCLUDED.auditor_scope,
      regulator_body = EXCLUDED.regulator_body,
      mandate_ref = EXCLUDED.mandate_ref,
      status = 'active',
      created_by = EXCLUDED.created_by;
END
$$;
ALTER FUNCTION public.create_platform_member(uuid, text, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_platform_member(uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_platform_member(uuid, text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.remove_platform_member(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$ DELETE FROM iam.platform_members WHERE user_id = p_user_id $$;
ALTER FUNCTION public.remove_platform_member(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_platform_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_platform_member(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.edge_token_is_denied(p_sid text, p_sub uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
  SELECT EXISTS (
    SELECT 1 FROM iam.token_denylist
    WHERE expires_at > now()
      AND (user_id = p_sub OR (p_sid IS NOT NULL AND sid = p_sid))
  )
$$;
ALTER FUNCTION public.edge_token_is_denied(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.edge_token_is_denied(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_token_is_denied(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.authz_deny(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, audit, app_private, extensions
AS $$
DECLARE
  audit_tenant_id uuid := coalesce(app_private.tenant_id(), p_tenant_id);
BEGIN
  IF audit_tenant_id IS NOT NULL AND app_private.uid() IS NOT NULL THEN
    INSERT INTO audit.legacy_audit_log (
      tenant_id, actor_id, actor_role, action, mutation_type, resource_type, reason
    ) VALUES (
      audit_tenant_id, app_private.uid(), coalesce(app_private.app_role(), 'unknown'),
      'AUTHZ_DENY', 'read', 'Authorization', 'GRANT_MATRIX'
    );
  END IF;

  -- PostgREST honours this transaction-local status, so a direct RPC denial
  -- returns generic 403 while its audit event commits.
  PERFORM set_config('response.status', '403', true);
  RETURN jsonb_build_object('success', false, 'error', 'forbidden');
END
$$;
ALTER FUNCTION public.authz_deny(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authz_deny(uuid) FROM PUBLIC;

ALTER FUNCTION public.process_audit_log_insert() SET search_path = pg_catalog, audit, public, extensions;

CREATE OR REPLACE FUNCTION public.deactivate_tenant_member(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_new_status text,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, iam, audit, auth, app_private, public, extensions
AS $$
DECLARE
  caller_role text := app_private.app_role();
  caller_tenant uuid := app_private.tenant_id();
  target iam.members%ROWTYPE;
BEGIN
  IF NOT app_private.is_active_member() THEN
    RETURN public.authz_deny(p_tenant_id);
  END IF;

  IF p_new_status NOT IN ('active', 'suspended', 'deactivated') THEN
    RETURN public.authz_deny(p_tenant_id);
  END IF;

  SELECT * INTO target FROM iam.members
  WHERE tenant_id = p_tenant_id AND user_id = p_target_user_id;
  IF NOT FOUND THEN
    RETURN public.authz_deny(p_tenant_id);
  END IF;

  IF caller_role = 'super_admin' THEN
    NULL;
  ELSIF caller_role = 'tenant_admin' AND caller_tenant = p_tenant_id AND target.role <> 'super_admin' THEN
    -- D1 judgment: tenant admins may suspend a stakeholder in their tenant as
    -- a leaver safeguard, but may not reactivate one.
    IF target.role = 'commercial_stakeholder' AND p_new_status <> 'suspended' THEN
      RETURN public.authz_deny(p_tenant_id);
    END IF;
  ELSE
    RETURN public.authz_deny(p_tenant_id);
  END IF;

  UPDATE iam.members
  SET status = p_new_status,
      suspended_at = CASE WHEN p_new_status = 'suspended' THEN now() ELSE suspended_at END,
      deactivated_at = CASE WHEN p_new_status = 'deactivated' THEN now() ELSE deactivated_at END
  WHERE tenant_id = p_tenant_id AND user_id = p_target_user_id;

  IF p_new_status IN ('suspended', 'deactivated') THEN
    INSERT INTO iam.token_denylist (user_id, reason_code, expires_at)
    VALUES (p_target_user_id, 'MEMBER_STATUS_' || upper(p_new_status), now() + interval '5 minutes');
    DELETE FROM auth.refresh_tokens WHERE user_id = p_target_user_id::text;
    DELETE FROM auth.sessions WHERE user_id = p_target_user_id;
    IF p_new_status = 'deactivated' THEN
      UPDATE auth.users SET banned_until = app_private.ban_until() WHERE id = p_target_user_id;
    END IF;
  ELSIF p_new_status = 'active' THEN
    UPDATE auth.users SET banned_until = NULL WHERE id = p_target_user_id;
  END IF;

  INSERT INTO audit.legacy_audit_log (
    tenant_id, actor_id, actor_role, action, mutation_type, resource_type, resource_id, subject_ref, reason
  ) VALUES (
    p_tenant_id, app_private.uid(), caller_role,
    'MEMBER_STATUS_' || upper(p_new_status),
    CASE WHEN p_new_status = 'active' THEN 'update' ELSE 'suspend' END,
    'TenantMember', p_target_user_id::text, p_target_user_id::text,
    coalesce(nullif(p_reason, ''), 'Member lifecycle transition')
  );

  RETURN jsonb_build_object('success', true, 'status', p_new_status, 'sessions_revoked', p_new_status <> 'active');
END
$$;
ALTER FUNCTION public.deactivate_tenant_member(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.deactivate_tenant_member(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_tenant_member(uuid, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_tenant_member_role(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_new_role text,
  p_partner_org text DEFAULT NULL,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, iam, audit, auth, app_private, public, extensions
AS $$
DECLARE
  caller_role text := app_private.app_role();
  caller_tenant uuid := app_private.tenant_id();
  target iam.members%ROWTYPE;
BEGIN
  IF NOT app_private.is_active_member() THEN
    RETURN public.authz_deny(p_tenant_id);
  END IF;

  SELECT * INTO target FROM iam.members WHERE tenant_id = p_tenant_id AND user_id = p_target_user_id;
  IF NOT FOUND OR p_new_role NOT IN (
    'tenant_admin', 'writing_clinician', 'viewing_dietician',
    'compliance_auditor', 'commercial_stakeholder', 'patient'
  ) THEN
    RETURN public.authz_deny(p_tenant_id);
  END IF;
  IF caller_role <> 'super_admin' AND caller_tenant <> p_tenant_id THEN
    RETURN public.authz_deny(p_tenant_id);
  END IF;

  IF target.role = 'commercial_stakeholder' OR p_new_role = 'commercial_stakeholder' THEN
    IF caller_role <> 'super_admin'
       OR NOT iam.grant_exists(caller_role, 'commercial_stakeholder', 'platform') THEN
      RETURN public.authz_deny(p_tenant_id);
    END IF;
    IF p_new_role = 'commercial_stakeholder' AND coalesce(length(btrim(p_partner_org)), 0) = 0 THEN
      RETURN public.authz_deny(p_tenant_id);
    END IF;
  ELSIF NOT iam.grant_exists(caller_role, target.role, 'tenant')
     OR NOT iam.grant_exists(caller_role, p_new_role, 'tenant') THEN
    RETURN public.authz_deny(p_tenant_id);
  END IF;

  UPDATE iam.members
  SET role = p_new_role,
      auditor_scope = CASE WHEN p_new_role = 'compliance_auditor' THEN 'tenant' ELSE NULL END,
      partner_org = CASE WHEN p_new_role = 'commercial_stakeholder' THEN btrim(p_partner_org) ELSE NULL END
  WHERE tenant_id = p_tenant_id AND user_id = p_target_user_id;
  INSERT INTO iam.token_denylist (user_id, reason_code, expires_at)
  VALUES (p_target_user_id, 'UPDATE_ROLE', now() + interval '5 minutes');
  DELETE FROM auth.refresh_tokens WHERE user_id = p_target_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_target_user_id;

  INSERT INTO audit.legacy_audit_log (
    tenant_id, actor_id, actor_role, action, mutation_type, resource_type, resource_id, subject_ref, reason
  ) VALUES (p_tenant_id, app_private.uid(), caller_role, 'UPDATE_ROLE', 'update', 'TenantMember',
    p_target_user_id::text, p_target_user_id::text, coalesce(nullif(p_reason, ''), 'Member role transition'));
  RETURN jsonb_build_object('success', true, 'role', p_new_role);
END
$$;
ALTER FUNCTION public.update_tenant_member_role(uuid, uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_tenant_member_role(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_tenant_member_role(uuid, uuid, text, text, text) TO authenticated, service_role;

-- Platform accounts participate in current-token revocation but receive no
-- tenant wall bypass. Their only eventual data surface is the Phase 5 audit
-- metadata view.
CREATE OR REPLACE FUNCTION app_private.is_active_member()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, auth, app_private
AS $$
DECLARE
  tenant_member_is_active boolean;
  platform_member_is_active boolean;
  banned_at timestamptz;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM iam.members member_row
    WHERE member_row.user_id = app_private.uid() AND member_row.status = 'active'
  ) INTO tenant_member_is_active;

  SELECT EXISTS (
    SELECT 1 FROM iam.platform_members platform_row
    WHERE platform_row.user_id = app_private.uid() AND platform_row.status = 'active'
  ) INTO platform_member_is_active;

  SELECT NULLIF(to_jsonb(auth_user) ->> 'banned_until', '')::timestamptz
  INTO banned_at FROM auth.users auth_user WHERE auth_user.id = app_private.uid();

  RETURN (coalesce(tenant_member_is_active, false) OR coalesce(platform_member_is_active, false))
    AND coalesce(banned_at, '-infinity'::timestamptz) < app_private.ban_until()
    AND NOT app_private.is_token_denied();
END
$$;
ALTER FUNCTION app_private.is_active_member() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, auth, app_private, public
AS $$
DECLARE
  issued_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  issued_user_id uuid := (event ->> 'user_id')::uuid;
  tenant_member iam.members%ROWTYPE;
  platform_member iam.platform_members%ROWTYPE;
  tenant_member_found boolean := false;
  platform_member_found boolean := false;
  auth_banned_until timestamptz;
BEGIN
  SELECT * INTO tenant_member FROM iam.members
  WHERE user_id = issued_user_id ORDER BY created_at DESC LIMIT 1;
  tenant_member_found := FOUND;

  SELECT * INTO platform_member FROM iam.platform_members WHERE user_id = issued_user_id;
  platform_member_found := FOUND;

  SELECT NULLIF(to_jsonb(auth_user) ->> 'banned_until', '')::timestamptz
  INTO auth_banned_until FROM auth.users auth_user WHERE auth_user.id = issued_user_id;

  IF coalesce(auth_banned_until, '-infinity'::timestamptz) >= app_private.ban_until()
    OR (tenant_member_found AND tenant_member.status <> 'active')
    OR (NOT tenant_member_found AND (NOT platform_member_found OR platform_member.status <> 'active'))
  THEN
    RAISE EXCEPTION 'access token issuance refused' USING ERRCODE = '42501';
  END IF;

  issued_claims := issued_claims - 'email' - 'name' - 'phone' - 'national_id'
    - 'diagnosis' - 'health_mode' - 'primary_clinician_id' - 'account_status' - 'licence_verified';

  IF tenant_member_found THEN
    issued_claims := jsonb_set(issued_claims, '{tenant_id}', to_jsonb(tenant_member.tenant_id), true);
    issued_claims := jsonb_set(issued_claims, '{app_role}', to_jsonb(tenant_member.role), true);
    issued_claims := jsonb_set(issued_claims, '{lic_ok}', to_jsonb(tenant_member.licence_verified), true);
    IF tenant_member.role = 'compliance_auditor' THEN
      issued_claims := jsonb_set(issued_claims, '{auditor_scope}', to_jsonb(tenant_member.auditor_scope), true);
    ELSE
      issued_claims := issued_claims - 'auditor_scope';
    END IF;
  ELSE
    issued_claims := issued_claims - 'tenant_id';
    issued_claims := jsonb_set(issued_claims, '{app_role}', to_jsonb(platform_member.role), true);
    issued_claims := jsonb_set(issued_claims, '{lic_ok}', 'false'::jsonb, true);
    IF platform_member.role = 'compliance_auditor' THEN
      issued_claims := jsonb_set(issued_claims, '{auditor_scope}', '"platform"'::jsonb, true);
    ELSE
      issued_claims := issued_claims - 'auditor_scope';
    END IF;
  END IF;

  issued_claims := jsonb_set(issued_claims, '{ver}', '1'::jsonb, true);
  RETURN jsonb_set(event, '{claims}', issued_claims, true);
END
$$;
ALTER FUNCTION public.custom_access_token_hook(jsonb) OWNER TO postgres;

COMMIT;
