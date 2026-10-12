/**
 * subscriptionUtils.ts
 *
 * Pure, framework-agnostic utilities for the 30-day subscription lifecycle.
 * Keeping these as plain functions (no React, no Chrome APIs) makes them
 * trivially unit-testable without any jsdom or extension shims.
 */

export type SubscriptionStatus = 'active' | 'expired' | 'trialing' | 'basic' | 'unauthenticated';

export interface Entitlement { 
  tier: "premium" | "basic"; 
  premium_expires_at: string | null; 
  server_now: string; 
}

export function getDaysRemainingFromExpiry(expiresAt: string | null | undefined, serverNow = new Date().toISOString()): number {
  if (!expiresAt) return 0;
  const e = Date.parse(expiresAt), n = Date.parse(serverNow);
  return Number.isFinite(e) && Number.isFinite(n) ? Math.max(0, Math.ceil((e - n) / 86_400_000)) : 0;
}

export function isSubscriptionExpired(expiresAt: string | null | undefined, serverNow = new Date().toISOString()): boolean {
  if (!expiresAt) return true;
  const e = Date.parse(expiresAt), n = Date.parse(serverNow);
  return Number.isFinite(e) && Number.isFinite(n) ? e <= n : true;
}
