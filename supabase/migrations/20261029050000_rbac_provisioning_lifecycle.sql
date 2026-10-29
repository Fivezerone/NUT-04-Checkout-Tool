-- ============================================================================
-- Migration: 20261029050000_rbac_provisioning_lifecycle.sql
-- Description: Phase 2 — CAD RBAC Lifecycle, Provisioning Guards & Least Privilege
--
-- REVERSAL NOTE:
-- To reverse, execute:
--   ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS primary_clinician_id;
--   ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS invited_by;
--   ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS deactivated_at;
--   ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS suspended_at;
--   DROP FUNCTION IF EXISTS public.deactivate_tenant_member;
-- ============================================================================

-- 1. Extend tenant_members with lifecycle and primary clinician columns
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS primary_clinician_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- Update status check constraint to support full state machine:
-- invited -> active -> suspended -> deactivated
ALTER TABLE public.tenant_members
  DROP CONSTRAINT IF EXISTS tenant_members_status_check;

ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_status_check
  CHECK (status IN ('invited', 'active', 'suspended', 'deactivated', 'revoked'));

CREATE INDEX IF NOT EXISTS idx_tenant_members_primary_clinician
  ON public.tenant_members(primary_clinician_id);

-- 2. Refined RLS Policies on tenant_members
DROP POLICY IF EXISTS tenant_isolation_members ON public.tenant_members;
CREATE POLICY tenant_isolation_members ON public.tenant_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      tenant_id = public.current_jwt_tenant_id()
      AND public.current_jwt_role() IN ('tenant_admin', 'writing_clinician', 'viewing_dietician', 'super_admin')
    )
    OR public.current_jwt_role() = 'super_admin'
  );

-- 3. Refined RLS Policies on users
DROP POLICY IF EXISTS tenant_isolation_users ON public.users;
CREATE POLICY tenant_isolation_users ON public.users
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      -- Writing clinician can only read patients assigned to them within their clinic
      tenant_id = public.current_jwt_tenant_id()
      AND public.current_jwt_role() = 'writing_clinician'
      AND id IN (
        SELECT tm.user_id 
        FROM public.tenant_members tm 
        WHERE tm.tenant_id = public.current_jwt_tenant_id() 
          AND (tm.primary_clinician_id = auth.uid() OR tm.user_id = auth.uid())
      )
    )
    OR (
      -- Tenant admin can read users within their clinic
      tenant_id = public.current_jwt_tenant_id()
      AND public.current_jwt_role() IN ('tenant_admin', 'super_admin')
    )
  );

-- Deny all write on users to non-service role except self preferences
DROP POLICY IF EXISTS user_self_update_preferences ON public.users;
CREATE POLICY user_self_update_preferences ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Cannot edit own role, tenant_id, or clinical state
    AND tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())
  );

-- 4. Function: Deactivate or Suspend Tenant Member with Global Session Revocation
CREATE OR REPLACE FUNCTION public.deactivate_tenant_member(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_new_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role text := coalesce(auth.jwt() ->> 'role', 'patient');
  v_caller_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_target_role text;
BEGIN
  IF p_new_status NOT IN ('suspended', 'deactivated', 'active') THEN
    RAISE EXCEPTION 'Invalid target status: %', p_new_status USING ERRCODE = 'P0002';
  END IF;

  -- Verify caller authority (tenant_admin in same clinic, or super_admin)
  IF v_caller_role != 'super_admin' THEN
    IF v_caller_role != 'tenant_admin' OR v_caller_tenant != p_tenant_id THEN
      RAISE EXCEPTION 'Unauthorized: only tenant administrators can alter member lifecycle' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Get target user role
  SELECT role INTO v_target_role
  FROM public.tenant_members
  WHERE tenant_id = p_tenant_id AND user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found in tenant' USING ERRCODE = 'P0002';
  END IF;

  -- Prevent modifying super_admin unless caller is super_admin
  IF v_target_role = 'super_admin' AND v_caller_role != 'super_admin' THEN
    RAISE EXCEPTION 'Cannot modify platform super administrator' USING ERRCODE = '42501';
  END IF;

  -- Update member status
  UPDATE public.tenant_members
  SET status = p_new_status,
      suspended_at = CASE WHEN p_new_status = 'suspended' THEN now() ELSE suspended_at END,
      deactivated_at = CASE WHEN p_new_status = 'deactivated' THEN now() ELSE deactivated_at END
  WHERE tenant_id = p_tenant_id AND user_id = p_target_user_id;

  -- If suspended or deactivated, revoke all sessions (global sign-out)
  IF p_new_status IN ('suspended', 'deactivated') THEN
    DELETE FROM auth.refresh_tokens WHERE user_id = p_target_user_id;
    DELETE FROM auth.sessions WHERE user_id = p_target_user_id;
    
    IF p_new_status = 'deactivated' THEN
      UPDATE auth.users 
      SET banned_until = '3000-01-01 00:00:00+00'
      WHERE id = p_target_user_id;
    END IF;
  ELSIF p_new_status = 'active' THEN
    UPDATE auth.users 
    SET banned_until = NULL
    WHERE id = p_target_user_id;
  END IF;

  -- Record in audit log
  INSERT INTO public.audit_log (
    tenant_id,
    actor_id,
    actor_role,
    action,
    mutation_type,
    resource_type,
    resource_id,
    subject_ref,
    reason
  ) VALUES (
    p_tenant_id,
    auth.uid(),
    v_caller_role,
    'MEMBER_STATUS_' || upper(p_new_status),
    CASE WHEN p_new_status = 'active' THEN 'update' ELSE 'suspend' END,
    'TenantMember',
    p_target_user_id::text,
    p_target_user_id::text,
    coalesce(p_reason, 'Admin lifecycle transition to ' || p_new_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_target_user_id,
    'status', p_new_status,
    'sessions_revoked', (p_new_status IN ('suspended', 'deactivated'))
  );
END;
$$;

-- 5. Updated custom_access_token_hook to enforce account active state
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_claims jsonb;
  v_user_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_licence_verified boolean;
  v_status text;
  v_primary_clinician uuid;
BEGIN
  v_claims := event -> 'claims';
  v_user_id := (event ->> 'user_id')::uuid;

  -- Lookup active tenant membership for user
  SELECT tenant_id, role, licence_verified, status, primary_clinician_id
  INTO v_tenant_id, v_role, v_licence_verified, v_status, v_primary_clinician
  FROM public.tenant_members
  WHERE user_id = v_user_id
  ORDER BY (status = 'active') DESC, created_at DESC
  LIMIT 1;

  -- If account is deactivated or suspended, reject valid privileges
  IF v_status IN ('suspended', 'deactivated') THEN
    v_claims := jsonb_set(v_claims, '{role}', '"suspended"'::jsonb);
    v_claims := jsonb_set(v_claims, '{account_status}', to_jsonb(v_status));
    RETURN jsonb_set(event, '{claims}', v_claims);
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id));
    v_claims := jsonb_set(v_claims, '{role}', to_jsonb(v_role));
    v_claims := jsonb_set(v_claims, '{licence_verified}', to_jsonb(v_licence_verified));
    v_claims := jsonb_set(v_claims, '{account_status}', to_jsonb(v_status));
    IF v_primary_clinician IS NOT NULL THEN
      v_claims := jsonb_set(v_claims, '{primary_clinician_id}', to_jsonb(v_primary_clinician));
    END IF;
  ELSE
    -- Default to platform tenant as patient
    v_claims := jsonb_set(v_claims, '{tenant_id}', '"00000000-0000-0000-0000-000000000000"'::jsonb);
    v_claims := jsonb_set(v_claims, '{role}', '"patient"'::jsonb);
    v_claims := jsonb_set(v_claims, '{licence_verified}', 'false'::jsonb);
    v_claims := jsonb_set(v_claims, '{account_status}', '"active"'::jsonb);
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;
