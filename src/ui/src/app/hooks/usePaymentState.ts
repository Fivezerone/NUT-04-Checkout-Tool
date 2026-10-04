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
        if (payload.new.status === 'completed') {
          handleSuccess();
        } else if (payload.new.status === 'failed') {
          handleFailure("Payment failed or was cancelled.");
        }
      })
      .subscribe();

    // 2. FALLBACK PATH: Active Polling
    const pollStatus = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const { data: { user } } = await supabase.auth.getUser();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken || !user) return; // Wait for session

        const { data, error } = await supabase.functions.invoke('payment-status', {
          body: { transaction_ref: transactionRef, method },
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (error) throw error;
        
        if (data?.status === 'completed') {
          handleSuccess(data.token);
          return;
        } else if (data?.status === 'failed') {
          handleFailure("Payment failed or timed out.");
          return;
        }

        // Still pending: schedule next poll with exponential backoff
        // Cap polling at 2 minutes total backoff per interval
        if (backoffRef.current < 120_000) {
          pollTimerRef.current = setTimeout(pollStatus, backoffRef.current);
          backoffRef.current *= 1.5; // increase by 1.5x
        } else {
          handleFailure("Payment verification timed out. If you paid, contact support.");
        }
      } catch (err) {
        console.error("Polling error:", err);
        // On transient network error, try again
        pollTimerRef.current = setTimeout(pollStatus, backoffRef.current);
      }
    };

    // Start first poll
    pollTimerRef.current = setTimeout(pollStatus, backoffRef.current);

    // Helpers
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

    return () => {
      supabase.removeChannel(channel);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [transactionRef, method]);

  return { status, setStatus };
};
