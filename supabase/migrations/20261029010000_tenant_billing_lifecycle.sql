-- ============================================================================
-- Migration: 20261029010000_tenant_billing_lifecycle.sql
-- Description: Clinic Admin Dashboard (CAD) Phase 3 Payments & Subscription Lifecycle
-- Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§7.1, §7.2, §7.4, §13 Tests T1-T9)
-- ============================================================================

-- 1. Extend Plans Table with Clinic Subscriptions
INSERT INTO public.plans (code, price_kes, duration_days, active) VALUES
  ('clinic_monthly', 5000.00, 30, true),
  ('clinic_quarterly', 13500.00, 90, true),
  ('clinic_annual', 48000.00, 365, true)
ON CONFLICT (code) DO NOTHING;

-- 2. Tenant Subscriptions Table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan                 text NOT NULL REFERENCES public.plans(code),
  status               text NOT NULL DEFAULT 'pending_activation'
                         CHECK (status IN (
                           'pending_activation','active','past_due',
                           'suspended','cancelled'
                         )),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  grace_ends_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON public.subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- 3. Invoices Table
CREATE TABLE IF NOT EXISTS public.invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  amount_kes      numeric(10,2) NOT NULL CHECK (amount_kes >= 0),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','paid','void','uncollectible')),
  due_at          timestamptz NOT NULL,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON public.invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON public.invoices(subscription_id);

-- 4. Payment Attempts Table
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  method         text NOT NULL CHECK (method IN ('mpesa_stk','mpesa_c2b','paystack_card')),
  provider_ref   text,
  receipt_number text UNIQUE,
  amount_kes     numeric(10,2) NOT NULL CHECK (amount_kes >= 0),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN (
                     'pending','succeeded','failed_funds',
                     'failed_cancelled','failed_timeout','failed_pin',
                     'amount_mismatch','quarantined'
                   )),
  raw_callback   jsonb,
  resolved_by    text CHECK (resolved_by IN ('callback','query','manual')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_tenant ON public.payment_attempts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice ON public.payment_attempts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_ref ON public.payment_attempts(provider_ref);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies: Subscriptions
DROP POLICY IF EXISTS tenant_isolation_subscriptions ON public.subscriptions;
CREATE POLICY tenant_isolation_subscriptions ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

DROP POLICY IF EXISTS tenant_admin_manage_subscriptions ON public.subscriptions;
CREATE POLICY tenant_admin_manage_subscriptions ON public.subscriptions
  FOR ALL
  TO authenticated
  USING (
    (tenant_id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin','super_admin'))
  )
  WITH CHECK (
    (tenant_id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin','super_admin'))
  );

-- 7. RLS Policies: Invoices
DROP POLICY IF EXISTS tenant_isolation_invoices ON public.invoices;
CREATE POLICY tenant_isolation_invoices ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

DROP POLICY IF EXISTS tenant_admin_manage_invoices ON public.invoices;
CREATE POLICY tenant_admin_manage_invoices ON public.invoices
  FOR ALL
  TO authenticated
  USING (
    (tenant_id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin','super_admin'))
  )
  WITH CHECK (
    (tenant_id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin','super_admin'))
  );

-- 8. RLS Policies: Payment Attempts
DROP POLICY IF EXISTS tenant_isolation_payment_attempts ON public.payment_attempts;
CREATE POLICY tenant_isolation_payment_attempts ON public.payment_attempts
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

DROP POLICY IF EXISTS tenant_admin_insert_payment_attempts ON public.payment_attempts;
CREATE POLICY tenant_admin_insert_payment_attempts ON public.payment_attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

-- 9. Authoritative Clinic Subscription Activation Function
CREATE OR REPLACE FUNCTION public.activate_tenant_subscription(
  p_attempt_id uuid,
  p_receipt_number text DEFAULT NULL,
  p_resolved_by text DEFAULT 'callback'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt record;
  v_invoice record;
  v_sub record;
  v_plan record;
  v_duration int;
BEGIN
  -- 1. Fetch payment attempt with lock
  SELECT * INTO v_attempt
  FROM public.payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'attempt_not_found');
  END IF;

  -- Idempotency invariant (T4 duplicate callback guard)
  IF v_attempt.status = 'succeeded' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'already_activated',
      'attempt_id', v_attempt.id,
      'receipt', v_attempt.receipt_number
    );
  END IF;

  -- 2. Fetch invoice with lock
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_attempt.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invoice_not_found');
  END IF;

  -- Amount check invariant (T5 amount mismatch guard)
  IF v_attempt.amount_kes IS DISTINCT FROM v_invoice.amount_kes THEN
    UPDATE public.payment_attempts
    SET status = 'amount_mismatch', updated_at = now()
    WHERE id = p_attempt_id;

    -- Audit quarantine
    INSERT INTO public.audit_log (
      tenant_id, actor_id, actor_role, action, mutation_type, resource_type,
      resource_id, reason
    ) VALUES (
      v_attempt.tenant_id, '00000000-0000-0000-0000-000000000000', 'system',
      'QUARANTINE_PAYMENT_AMOUNT_MISMATCH', 'update', 'PaymentAttempt',
      v_attempt.id::text,
      'Attempt amount ' || v_attempt.amount_kes::text || ' differs from invoice ' || v_invoice.amount_kes::text
    );

    RETURN jsonb_build_object('success', false, 'error', 'amount_mismatch', 'status', 'quarantined');
  END IF;

  -- 3. Fetch subscription and plan
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = v_invoice.subscription_id FOR UPDATE;
  SELECT * INTO v_plan FROM public.plans WHERE code = v_sub.plan;
  v_duration := COALESCE(v_plan.duration_days, 30);

  -- 4. Mark payment attempt succeeded
  UPDATE public.payment_attempts
  SET status = 'succeeded',
      receipt_number = COALESCE(p_receipt_number, v_attempt.receipt_number, 'REC-' || v_attempt.id::text),
      resolved_by = p_resolved_by,
      updated_at = now()
  WHERE id = p_attempt_id;

  -- 5. Mark invoice paid
  UPDATE public.invoices
  SET status = 'paid',
      paid_at = now()
  WHERE id = v_invoice.id;

  -- 6. Transition subscription to active and advance period
  UPDATE public.subscriptions
  SET status = 'active',
      current_period_start = now(),
      current_period_end = now() + (v_duration || ' days')::interval,
      grace_ends_at = NULL,
      updated_at = now()
  WHERE id = v_sub.id;

  -- 7. Activate tenant
  UPDATE public.tenants
  SET status = 'active',
      updated_at = now()
  WHERE id = v_sub.tenant_id;

  -- 8. Append to immutable audit log (T4 single audit row invariant)
  INSERT INTO public.audit_log (
    tenant_id, actor_id, actor_role, action, mutation_type, resource_type,
    resource_id, reason
  ) VALUES (
    v_sub.tenant_id, '00000000-0000-0000-0000-000000000000', 'system',
    'ACTIVATE_TENANT_SUBSCRIPTION', 'update', 'Subscription',
    v_sub.id::text,
    'Subscription activated for plan ' || v_sub.plan || ' via ' || v_attempt.method
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'active',
    'subscription_id', v_sub.id,
    'current_period_end', (now() + (v_duration || ' days')::interval)::text
  );
END;
$$;

-- 10. Failure Routing Function (T1, T2, T3, T5, T6)
CREATE OR REPLACE FUNCTION public.route_payment_failure(
  p_attempt_id uuid,
  p_result_code int,
  p_error_desc text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt record;
  v_sub record;
  v_new_status text;
BEGIN
  SELECT * INTO v_attempt FROM public.payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'attempt_not_found');
  END IF;

  SELECT s.* INTO v_sub
  FROM public.subscriptions s
  JOIN public.invoices i ON i.subscription_id = s.id
  WHERE i.id = v_attempt.invoice_id
  FOR UPDATE;

  -- Failure code mapping
  IF p_result_code = 1032 THEN
    -- User cancelled (T1)
    v_new_status := 'failed_cancelled';
  ELSIF p_result_code = 1 THEN
    -- Insufficient funds (T2)
    v_new_status := 'failed_funds';
    -- If subscription was active (renewal), enter past_due grace (7 days default)
    IF v_sub.status = 'active' THEN
      UPDATE public.subscriptions
      SET status = 'past_due',
          grace_ends_at = now() + interval '7 days',
          updated_at = now()
      WHERE id = v_sub.id;

      UPDATE public.tenants
      SET status = 'past_due', updated_at = now()
      WHERE id = v_sub.tenant_id;
    END IF;
  ELSIF p_result_code = 1037 THEN
    -- Timeout (T3)
    v_new_status := 'failed_timeout';
  ELSIF p_result_code = 2001 THEN
    -- Wrong PIN
    v_new_status := 'failed_pin';
  ELSE
    v_new_status := 'quarantined';
  END IF;

  UPDATE public.payment_attempts
  SET status = v_new_status, updated_at = now()
  WHERE id = p_attempt_id;

  INSERT INTO public.audit_log (
    tenant_id, actor_id, actor_role, action, mutation_type, resource_type,
    resource_id, reason
  ) VALUES (
    v_attempt.tenant_id, '00000000-0000-0000-0000-000000000000', 'system',
    'PAYMENT_ATTEMPT_FAILED', 'update', 'PaymentAttempt',
    v_attempt.id::text,
    'Payment failed: code ' || p_result_code::text || ' (' || v_new_status || ') - ' || p_error_desc
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'subscription_status', v_sub.status
  );
END;
$$;

