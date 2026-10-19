/**
 * useSubscriptionGuard.ts
 *
 * React hook that checks the 30-day premium subscription lifecycle.
 * Returns a status that callers can use to gate UI. It does NOT sign out
 * the user on expiry — expired users need their session alive to complete
 * payment on the renewal page (onboarding.html?mode=renew).
 *
 * F-09: Uses ever_premium to correctly distinguish:
 *   - 'basic':   user has no active premium and never had it (upgrade gate)
 *   - 'expired': user had premium before but it lapsed (renewal gate)
 *   - 'active':  premium is currently valid
 *
 * Side-effects on expiry/basic:
 *   1. Revokes the local premium flag (nutriscore_is_premium = false).
 *   2. Does NOT call signOut — session must be preserved for renewal payment.
 */

import { useEffect, useState } from 'react';
import { supabase, savePremiumStatus } from '../../services/storage';
import {
  isSubscriptionExpired,
  getDaysRemainingFromExpiry,
  type SubscriptionStatus,
} from '../lib/subscriptionUtils';

export type { SubscriptionStatus };

interface UseSubscriptionGuardResult {
  /** Resolved subscription status ('loading' while the async check is in flight). */
  status: SubscriptionStatus | 'loading';
  /** Whole days remaining (null while loading, 0 when expired). */
  daysRemaining: number | null;
}

// Fix #25: module-level cache — avoids redundant RPC calls on every popup mount.
const GUARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _guardCache: { status: SubscriptionStatus; daysRemaining: number | null; ts: number } | null = null;

export function useSubscriptionGuard(): UseSubscriptionGuardResult {
  const [status, setStatus] = useState<SubscriptionStatus | 'loading'>('loading');
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Fix #25: return cached result if still fresh (5-min TTL).
      // The entitlement token has a TTL of days — no need to verify on every popup open.
      if (
        _guardCache &&
        Date.now() - _guardCache.ts < GUARD_CACHE_TTL_MS
      ) {
        if (!cancelled) {
          setStatus(_guardCache.status);
          setDaysRemaining(_guardCache.daysRemaining);
        }
        return;
      }

      try {
        // Step 1: Verify active session
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setStatus('unauthenticated');
          return;
        }

        // Step 2: Fetch subscription data from authoritative server RPC
        const { data: ent, error } = await supabase.rpc('get_my_entitlement');

        if (error || !ent) {
          // Can't verify — treat as unauthenticated to be safe
          if (!cancelled) setStatus('unauthenticated');
          return;
        }

        // Step 3: F-09 — use ever_premium to distinguish basic vs expired
        // 'expired' = had premium before, now lapsed (ever_premium = true)
        // 'basic'   = never had premium (ever_premium = false)
        const isActive = ent.tier === 'premium' && !isSubscriptionExpired(ent.premium_expires_at, ent.server_now);
        const resolved: SubscriptionStatus = isActive
          ? 'active'
          : ent.ever_premium
            ? 'expired'   // formerly premium, now lapsed
            : 'basic';    // never had premium
        const remaining = getDaysRemainingFromExpiry(ent.premium_expires_at, ent.server_now);

        // Fix #25: cache result
        _guardCache = { status: resolved, daysRemaining: remaining, ts: Date.now() };

        if (!cancelled) {
          setDaysRemaining(remaining);
          setStatus(resolved);
        }

        // Step 4: Revoke local premium flag for non-active states
        if (resolved === 'expired' || resolved === 'basic') {
          await savePremiumStatus(false);
          // Do NOT call signOut() — expired users need session for renewal payment.
        }
      } catch (err) {
        console.error('[useSubscriptionGuard]', err);
        if (!cancelled) setStatus('unauthenticated');
      }
    }

    check();

    return () => {
      cancelled = true;
    };
  }, []);

  return { status, daysRemaining };
}
