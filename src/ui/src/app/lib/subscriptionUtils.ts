/**
 * subscriptionUtils.ts
 *
 * Pure, framework-agnostic utilities for the 30-day subscription lifecycle.
 * Keeping these as plain functions (no React, no Chrome APIs) makes them
 * trivially unit-testable without any jsdom or extension shims.
 */

export type SubscriptionStatus = 'active' | 'expired' | 'trialing' | 'basic' | 'unauthenticated';

/** Exact duration of a premium subscription in milliseconds. */
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Returns `true` when the current moment is at or beyond the 30-day expiry
 * of the supplied `paymentReceivedAt` timestamp.
 *
 * @param paymentReceivedAt - ISO string, Date object, or null/undefined.
 * @param now               - Optional "current time" override for unit testing.
 */
export function isSubscriptionExpired(
  paymentReceivedAt: Date | string | null | undefined,
  trialStartedAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (paymentReceivedAt) {
    const paymentMs = new Date(paymentReceivedAt).getTime();
    return now.getTime() >= paymentMs + THIRTY_DAYS_MS;
  }
  if (trialStartedAt) {
    const trialMs = new Date(trialStartedAt).getTime();
    return now.getTime() >= trialMs + THIRTY_DAYS_MS;
  }
  return false;
}

export function getDaysRemaining(
  paymentReceivedAt: Date | string | null | undefined,
  trialStartedAt: Date | string | null | undefined,
  now: Date = new Date()
): number {
  if (paymentReceivedAt) {
    const paymentMs = new Date(paymentReceivedAt).getTime();
    const expiryMs = paymentMs + THIRTY_DAYS_MS;
    const diffMs = expiryMs - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
  }
  if (trialStartedAt) {
    const trialMs = new Date(trialStartedAt).getTime();
    const expiryMs = trialMs + THIRTY_DAYS_MS;
    const diffMs = expiryMs - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
  }
  return 30; // fallback if neither is set
}

export function resolveSubscriptionStatus(
  dbStatus: string | null | undefined,
  paymentReceivedAt: Date | string | null | undefined,
  trialStartedAt: Date | string | null | undefined,
  now: Date = new Date()
): SubscriptionStatus {
  if (isSubscriptionExpired(paymentReceivedAt, trialStartedAt, now)) return 'expired';
  if (dbStatus === 'expired') return 'expired';
  if (dbStatus === 'basic') return 'basic';
  if (paymentReceivedAt) return 'active';
  return 'trialing';
}
