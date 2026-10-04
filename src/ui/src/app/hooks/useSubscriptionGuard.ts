/**
 * useSubscriptionGuard.ts
 *
 * React hook that checks the 30-day premium subscription lifecycle.
 * Returns a status that callers can use to gate UI. It does NOT sign out
 * the user on expiry — expired users need their session alive to complete
 * payment on the renewal page (onboarding.html?mode=renew).
 *
 * Side-effects on expiry:
 *   1. Writes subscription_status = 'expired' back to the DB (if stale).
 *   2. Revokes the local premium flag (nutriscore_is_premium = false).
 *   ❌  Does NOT call signOut. Signing out here would break the renewal flow.
 */

import { useEffect, useState } from 'react';
import { supabase, savePremiumStatus } from '../../services/storage';
import {
  resolveSubscriptionStatus,
  getDaysRemaining,
  type SubscriptionStatus,
} from '../lib/subscriptionUtils';

export type { SubscriptionStatus };

interface UseSubscriptionGuardResult {
  /** Resolved subscription status ('loading' while the async check is in flight). */
  status: SubscriptionStatus | 'loading';
  /** Whole days remaining (null while loading, 0 when expired). */
  daysRemaining: number | null;
}

export function useSubscriptionGuard(): UseSubscriptionGuardResult {
  const [status, setStatus] = useState<SubscriptionStatus | 'loading'>('loading');
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        // ── Step 1: Verify active session ──────────────────────────────────
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setStatus('unauthenticated');
          return;
        }

        // ── Step 2: Fetch subscription data ────────────────────────────────
        const { data: row, error } = await supabase
          .from('users')
          .select('payment_received_at, subscription_status, trial_started_at')
          .eq('id', user.id)
          .single();

        if (error || !row) {
          // Can't verify — treat as unauthenticated to be safe
          if (!cancelled) setStatus('unauthenticated');
          return;
        }

        const { payment_received_at, subscription_status, trial_started_at } = row as {
          payment_received_at: string | null;
          subscription_status: string | null;
          trial_started_at: string | null;
        };

        // ── Step 3: Resolve status (client-side 30-day check) ──────────────
        const resolved = resolveSubscriptionStatus(subscription_status, payment_received_at, trial_started_at);
        const remaining = getDaysRemaining(payment_received_at, trial_started_at);

        if (!cancelled) {
          setDaysRemaining(remaining);
          setStatus(resolved);
        }

        // ── Step 4: Handle expiry side-effects ─────────────────────────────
        if (resolved === 'expired') {
          // 4a. Flip DB status (optimistic UI update — subscription_status only)
          // D-08: is_premium is a billing column — do NOT write it from the client.
          // The server-side trigger (enforce_billing_state) is the sole authority.
          if (subscription_status !== 'expired') {
            await supabase
              .from('users')
              .update({ subscription_status: 'expired' })
              .eq('id', user.id);
          }

          // 4b. Revoke the local premium flag written by savePremiumStatus()
          await savePremiumStatus(false);

          // ❌  Do NOT call signOut() here.
          //     The expired user will be shown SubscriptionExpiredPage with a
          //     "Renew" button. Clicking it opens onboarding.html?mode=renew where
          //     Step 4 (payment) needs a valid auth session. If we sign out here,
          //     the user lands on the renew page with no session → payment fails →
          //     they are stuck in an endless login/logout loop.
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
