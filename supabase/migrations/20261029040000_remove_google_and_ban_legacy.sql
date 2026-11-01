-- ============================================================================
-- Migration: 20261029040000_remove_google_and_ban_legacy.sql
-- Description: Phase 1 — Remove Google Auth and Ban Legacy Unprovisioned Users
--
-- REVERSAL NOTE:
-- To reverse, execute:
--   UPDATE auth.users SET banned_until = NULL WHERE id IN (SELECT id FROM public.users WHERE legacy_unprovisioned = true);
--   UPDATE public.users SET legacy_unprovisioned = false;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS legacy_unprovisioned;
-- Note: Deleted Google OAuth rows from auth.identities cannot be auto-restored.
-- ============================================================================

-- 1. Add legacy_unprovisioned marker to public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS legacy_unprovisioned boolean NOT NULL DEFAULT false;

-- 2. Identify users with Google identities and terminate their sessions
DO $$
DECLARE
  v_google_user_ids uuid[];
  v_legacy_user_ids uuid[];
BEGIN
  -- Collect Google OAuth user IDs
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_google_user_ids
  FROM auth.identities
  WHERE provider = 'google';

  IF v_google_user_ids IS NOT NULL AND array_length(v_google_user_ids, 1) > 0 THEN
    -- Delete refresh tokens and sessions for Google users
    DELETE FROM auth.refresh_tokens WHERE user_id = ANY(v_google_user_ids);
    DELETE FROM auth.sessions WHERE user_id = ANY(v_google_user_ids);
    
    -- Delete the Google identities
    DELETE FROM auth.identities WHERE provider = 'google';
  END IF;

  -- 3. Identify legacy unprovisioned users (no verified active clinic membership in tenant_members)
  SELECT ARRAY_AGG(DISTINCT u.id) INTO v_legacy_user_ids
  FROM public.users u
  LEFT JOIN public.tenant_members tm 
    ON tm.user_id = u.id 
   AND tm.status = 'active'
   AND tm.tenant_id != '00000000-0000-0000-0000-000000000000'
  WHERE tm.user_id IS NULL;

  IF v_legacy_user_ids IS NOT NULL AND array_length(v_legacy_user_ids, 1) > 0 THEN
    -- Mark users as legacy unprovisioned
    UPDATE public.users
    SET legacy_unprovisioned = true
    WHERE id = ANY(v_legacy_user_ids);

    -- Ban the unprovisioned legacy users in auth.users
    UPDATE auth.users
    SET banned_until = '3000-01-01 00:00:00+00'
    WHERE id = ANY(v_legacy_user_ids);

    -- Revoke all active sessions and refresh tokens
    DELETE FROM auth.refresh_tokens WHERE user_id = ANY(v_legacy_user_ids);
    DELETE FROM auth.sessions WHERE user_id = ANY(v_legacy_user_ids);
  END IF;
END $$;

-- 4. Record the cleanup action in the platform audit log
INSERT INTO public.audit_log (
  tenant_id,
  actor_id,
  actor_role,
  action,
  mutation_type,
  resource_type,
  reason
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  'super_admin',
  'REMOVE_GOOGLE_AUTH_AND_BAN_LEGACY',
  'revoke',
  'AuthIdentities',
  'CAD Phase 1: All Google OAuth identities purged; legacy unprovisioned accounts banned'
);

