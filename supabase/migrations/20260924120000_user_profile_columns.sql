-- ============================================================
-- NUT-04 User Profile Columns Migration
-- Adds onboarding preference columns to public.users so all
-- account data lives in Supabase (not chrome.storage.local).
-- ============================================================

-- 1. Add profile/preference columns (idempotent via IF NOT EXISTS)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS dob          TEXT,
  ADD COLUMN IF NOT EXISTS gender       TEXT,
  ADD COLUMN IF NOT EXISTS condition    TEXT,
  ADD COLUMN IF NOT EXISTS metric       TEXT,
  ADD COLUMN IF NOT EXISTS notification_frequency TEXT DEFAULT 'realtime',
  ADD COLUMN IF NOT EXISTS terms_accepted    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS privacy_accepted  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- 2. Allow authenticated users to INSERT their own row.
--    (The existing UPDATE policy already covers subsequent writes.)
--    Uses IF NOT EXISTS–equivalent guard via DO block to stay idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'users'
      AND policyname = 'Users can insert own profile'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Users can insert own profile"
      ON public.users FOR INSERT
      WITH CHECK (auth.uid() = id)
    $policy$;
  END IF;
END;
$$;

-- 3. Trigger: auto-set updated_at on every row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
