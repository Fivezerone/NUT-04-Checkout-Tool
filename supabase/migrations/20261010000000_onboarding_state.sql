-- Migration 20261010000000_onboarding_state.sql

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_step integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS privacy_version text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;

-- Function to save step 2 (health condition)
CREATE OR REPLACE FUNCTION public.save_onboarding_step2(
  p_condition text,
  p_metric text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_condition IS NULL OR p_condition = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Condition is required');
  END IF;

  UPDATE public.users 
  SET 
    condition = p_condition,
    metric = p_metric,
    health_mode = p_condition <> 'general',
    selected_tags = ARRAY[p_condition, p_metric],
    onboarding_step = GREATEST(onboarding_step, 2),
    updated_at = NOW()
  WHERE id = auth.uid();
  
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Function to save step 3 (consent)
CREATE OR REPLACE FUNCTION public.save_onboarding_step3(
  p_terms_accepted boolean,
  p_privacy_accepted boolean,
  p_terms_version text,
  p_privacy_version text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT p_terms_accepted OR NOT p_privacy_accepted THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must accept terms and privacy');
  END IF;

  UPDATE public.users 
  SET 
    terms_accepted = p_terms_accepted,
    privacy_accepted = p_privacy_accepted,
    terms_version = p_terms_version,
    privacy_version = p_privacy_version,
    terms_accepted_at = NOW(),
    privacy_accepted_at = NOW(),
    consent_timestamp = NOW(),
    onboarding_step = GREATEST(onboarding_step, 3),
    updated_at = NOW()
  WHERE id = auth.uid();
  
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Function to complete onboarding
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_tier text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.users 
  SET 
    onboarding_completed = true,
    onboarding_step = GREATEST(onboarding_step, 4),
    updated_at = NOW()
  WHERE id = auth.uid();
  
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.save_onboarding_step2(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_onboarding_step2(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.save_onboarding_step3(boolean, boolean, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_onboarding_step3(boolean, boolean, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_onboarding(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text) TO authenticated;
