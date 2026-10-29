// src/shared/payments.ts
// Shared payment constants and backoff schedules for CAD payments

export const RETRY_DELAYS_SECONDS = [90, 180, 600, 1800, 7200]

export type SubscriptionStatus =
  'pending_activation' | 'active' | 'past_due' | 'suspended' | 'cancelled'

export type PaymentMethod = 'mpesa_stk' | 'mpesa_c2b' | 'paystack_card'

export type PaymentAttemptStatus =
  | 'pending'
  | 'succeeded'
  | 'failed_funds'
  | 'failed_cancelled'
  | 'failed_timeout'
  | 'failed_pin'
  | 'amount_mismatch'
  | 'quarantined'
