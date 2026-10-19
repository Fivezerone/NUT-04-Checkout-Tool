-- Enable Realtime for the payments table
-- This is required for the client-side OnboardingWizard to receive
-- Webhook/Edge Function updates (e.g. status changing to 'completed')
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
