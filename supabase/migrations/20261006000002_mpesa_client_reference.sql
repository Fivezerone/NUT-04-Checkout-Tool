-- Migration for M-018 (Provider transaction initiated before local record)
ALTER TABLE public.payments ALTER COLUMN transaction_ref DROP NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS client_reference text UNIQUE;
CREATE INDEX IF NOT EXISTS idx_payments_client_reference ON public.payments(client_reference);
