import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/storage';

type PaymentStatus = 'idle' | 'processing' | 'success' | 'error';
type PaymentMethod = 'paystack' | 'mpesa';

interface UsePaymentStateProps {
  transactionRef: string | null;
  method: PaymentMethod | null;
  onSuccess: (ref: string, method: PaymentMethod, token?: string) => void;
  onError: (errorMsg: string) => void;
}

export const usePaymentState = ({
  transactionRef,
  method,
  onSuccess,
  onError,
}: UsePaymentStateProps) => {
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(5000); // Start polling after 5s

  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Main Effect: Watch for transactionRef and setup listeners
  useEffect(() => {
    if (!transactionRef || !method) {
      setStatus(prev => (prev === 'processing' ? 'idle' : prev));
      return;
    }

    setStatus('processing');
    backoffRef.current = 5000;
    
    // 1. FAST PATH: Realtime Webhook Listener
    const channel = supabase.channel(`payment-${transactionRef}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'payments',
        filter: `transaction_ref=eq.${transactionRef}`
      }, (payload) => {
        // D-03: treat Realtime as a hint only — verify via the authoritative endpoint
        if (payload.new.status === 'completed') {
          void pollStatusOnce();        // defined below; clears timer, runs one verified check
        } else if (payload.new.status === 'failed') {
          handleFailure('Payment failed or was cancelled.');
        }
      })
      .subscribe((s: string) => {
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          console.warn(`[usePaymentState] Realtime degraded (${s}), polling only`);
        }
      });

    // Helpers (defined first so pollStatus can reference them)
    const handleSuccess = (token?: string) => {
      setStatus('success');
      supabase.removeChannel(channel);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      onSuccessRef.current(transactionRef, method, token);
    };

    const handleFailure = (msg: string) => {
      setStatus('error');
      supabase.removeChannel(channel);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      onErrorRef.current(msg);
    };

    // 2. FALLBACK PATH: Active Polling (with attempt cap)
    const MAX_ATTEMPTS = 14; // 14 × backoff growth → ~10 min total
    let attempts = 0;
    const pollStatus = async () => {
      attempts++;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('NO_SESSION');

        const { data, error } = await supabase.functions.invoke('payment-status', {
          body: { transaction_ref: transactionRef, method },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (error) throw error;

        if (data?.status === 'completed') {
          handleSuccess(data.token);
          return;
        }
        if (data?.status === 'failed' || data?.status === 'cancelled') {
          handleFailure('Payment failed or was cancelled.');
          return;
        }
      } catch (err: any) {
        if (err?.message === 'NO_SESSION') {
          handleFailure(
            'Your session expired. Sign in again — if you paid, your premium will still activate.'
          );
          return;
        }
        console.error('[usePaymentState] Polling error:', err);
      }

      if (attempts >= MAX_ATTEMPTS) {
        handleFailure(
          `We could not confirm your payment yet. If you were charged, contact support with ref ${transactionRef}.`
        );
        return;
      }

      backoffRef.current = Math.min(backoffRef.current * 1.5, 30_000);
      pollTimerRef.current = setTimeout(pollStatus, backoffRef.current);
    };

    // D-03: one-shot verification triggered by Realtime 'completed' hint.
    // Cancels any pending backoff timer so the check fires immediately.
    const pollStatusOnce = async () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      await pollStatus();
    };

    // Start first poll
    pollTimerRef.current = setTimeout(pollStatus, backoffRef.current);

    return () => {
      supabase.removeChannel(channel);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [transactionRef, method]);

  return { status, setStatus };
};
