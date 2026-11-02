-- NutriScore CAD Blueprint Phase 2
-- Canonical application claims, immediate-token denylist, and removal of the
-- application role from the Supabase-reserved `role` claim.

BEGIN;

ALTER TABLE iam.members
  ADD COLUMN IF NOT EXISTS auditor_scope text
    CHECK (auditor_scope IN ('tenant', 'platform')),
  ADD COLUMN IF NOT EXISTS licence_body text;

ALTER TABLE iam.members
  DROP CONSTRAINT IF EXISTS members_auditor_scope_check;
ALTER TABLE iam.members
  ADD CONSTRAINT members_auditor_scope_check CHECK (
    (role = 'compliance_auditor' AND auditor_scope IN ('tenant', 'platform'))
    OR (role <> 'compliance_auditor' AND auditor_scope IS NULL)
  ) NOT VALID;

UPDATE iam.members
SET auditor_scope = 'tenant'
WHERE role = 'compliance_auditor' AND auditor_scope IS NULL;

-- This is deliberately introduced with the claims cutover because it replaces
-- the last numeric-rank authorizer. Phase 3 consumes it for all provisioning
-- and lifecycle transitions and adds the platform-member constraints.
CREATE TABLE IF NOT EXISTS iam.role_grants (
  grantor_role text NOT NULL,
  grantee_role text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('platform', 'tenant', 'own_patients')),
  PRIMARY KEY (grantor_role, grantee_role, scope)
);

INSERT INTO iam.role_grants (grantor_role, grantee_role, scope) VALUES
  ('super_admin', 'tenant_admin', 'platform'),
  ('super_admin', 'compliance_auditor', 'platform'),
  ('super_admin', 'commercial_stakeholder', 'platform'),
  ('tenant_admin', 'writing_clinician', 'tenant'),
  ('tenant_admin', 'viewing_dietician', 'tenant'),
  ('tenant_admin', 'compliance_auditor', 'tenant'),
  ('tenant_admin', 'patient', 'tenant'),
  ('writing_clinician', 'patient', 'own_patients')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS iam.token_denylist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sid text,
  user_id uuid NOT NULL,
  reason_code text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sid IS NOT NULL OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS iam_token_denylist_sid_key
  ON iam.token_denylist (sid) WHERE sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS iam_token_denylist_user_active
  ON iam.token_denylist (user_id, expires_at DESC);

ALTER TABLE iam.token_denylist ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.token_denylist FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_wall ON iam.token_denylist;
CREATE POLICY tenant_wall ON iam.token_denylist AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION app_private.is_token_denied()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, app_private
AS $$
DECLARE
  current_sid text := app_private.claims() ->> 'sid';
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM iam.token_denylist revoked
    WHERE revoked.expires_at > now()
      AND (
        revoked.user_id = app_private.uid()
        OR (current_sid IS NOT NULL AND revoked.sid = current_sid)
      )
  );
END
$$;
ALTER FUNCTION app_private.is_token_denied() OWNER TO postgres;
REVOKE ALL ON FUNCTION app_private.is_token_denied() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_token_denied() TO authenticated;

CREATE OR REPLACE FUNCTION app_private.is_active_member()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, auth, app_private
AS $$
DECLARE
  member_is_active boolean;
  banned_at timestamptz;
BEGIN
  EXECUTE
    'SELECT EXISTS (
       SELECT 1 FROM iam.members member_row
       WHERE member_row.user_id = app_private.uid()
         AND member_row.status = ''active''
     )'
    INTO member_is_active;

  SELECT NULLIF(to_jsonb(auth_user) ->> 'banned_until', '')::timestamptz
  INTO banned_at
  FROM auth.users auth_user
  WHERE auth_user.id = app_private.uid();

  RETURN coalesce(member_is_active, false)
    AND coalesce(banned_at, '-infinity'::timestamptz) < app_private.ban_until()
    AND NOT app_private.is_token_denied();
END
$$;
ALTER FUNCTION app_private.is_active_member() OWNER TO postgres;

-- A1 / Option 2: leave Supabase's database-role claim untouched, but remove
-- all application authorization data from it. Application readers use only
-- app_role. The token hook rejects inactive/banned members instead of issuing a
-- degraded token carrying a synthetic suspended role.
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
  member_row iam.members%ROWTYPE;
  member_found boolean := false;
  auth_banned_until timestamptz;
BEGIN
  SELECT * INTO member_row
  FROM iam.members
  WHERE user_id = issued_user_id
  ORDER BY created_at DESC
  LIMIT 1;
  member_found := FOUND;

  SELECT NULLIF(to_jsonb(auth_user) ->> 'banned_until', '')::timestamptz
  INTO auth_banned_until
  FROM auth.users auth_user
  WHERE auth_user.id = issued_user_id;

  IF NOT member_found
    OR member_row.status <> 'active'
    OR coalesce(auth_banned_until, '-infinity'::timestamptz) >= app_private.ban_until()
  THEN
    RAISE EXCEPTION 'access token issuance refused' USING ERRCODE = '42501';
  END IF;

  -- `role` is deliberately not changed: Supabase owns it as the database-role
  -- selector. app_role below is the only application authorization claim.
  -- email and phone are blanked rather than removed: GoTrue validates that both
  -- keys are present in the hook's returned claims object (SQLSTATE 42501 if absent).
  issued_claims := issued_claims
    - 'name'
    - 'national_id'
    - 'diagnosis'
    - 'health_mode'
    - 'primary_clinician_id'
    - 'account_status'
    - 'licence_verified';

  issued_claims := jsonb_set(issued_claims, '{email}', '""', true);
  issued_claims := jsonb_set(issued_claims, '{phone}', '""', true);

  issued_claims := jsonb_set(issued_claims, '{tenant_id}', to_jsonb(member_row.tenant_id), true);
  issued_claims := jsonb_set(issued_claims, '{app_role}', to_jsonb(member_row.role), true);
  issued_claims := jsonb_set(issued_claims, '{lic_ok}',   to_jsonb(member_row.licence_verified), true);
  issued_claims := jsonb_set(issued_claims, '{ver}',      '1'::jsonb, true);

  IF member_row.role = 'compliance_auditor' THEN
    issued_claims := jsonb_set(issued_claims, '{auditor_scope}', to_jsonb(member_row.auditor_scope), true);
  ELSE
    issued_claims := issued_claims - 'auditor_scope';
  END IF;

  RETURN jsonb_set(event, '{claims}', issued_claims, true);
END
$$;
ALTER FUNCTION public.custom_access_token_hook(jsonb) OWNER TO postgres;

-- GoTrue (supabase_auth_admin) must have USAGE on public schema and EXECUTE on
-- the hook function, otherwise every sign-in returns SQLSTATE 42501.
-- See: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
GRANT USAGE  ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- Legacy policies and functions are replaced in the Phase 3 grant/lifecycle
-- migration. These helpers make their accessors canonical immediately.
CREATE OR REPLACE FUNCTION public.current_jwt_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT app_private.tenant_id() $$;

CREATE OR REPLACE FUNCTION public.current_jwt_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT app_private.app_role() $$;

COMMIT;

