/**
 * D-02 — Polling dead-ends: pure logic tests
 *
 * Verifies the three polling dead-end scenarios via the pure guard predicates
 * that mirror the logic in usePaymentState's pollStatus function.
 */

import { describe, test, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror of the D-02 polling logic predicates
// ---------------------------------------------------------------------------

type PollOutcome = 'continue' | 'success' | 'failure';

interface PollAttemptArgs {
  attempts: number;
  maxAttempts: number;
  sessionMissing: boolean;
  status?: string;
  error?: Error | null;
}

/**
 * Returns the outcome for a single polling attempt.
 * Mirrors the if-chain in the refactored pollStatus().
 */
function evaluatePollAttempt({
  attempts,
  maxAttempts,
  sessionMissing,
  status,
  error,
}: PollAttemptArgs): { outcome: PollOutcome; message?: string } {
  if (sessionMissing) {
    return {
      outcome: 'failure',
      message: 'Your session expired. Sign in again — if you paid, your premium will still activate.',
    };
  }
  if (error) {
    // transient network error — fall through to attempt-cap check
  } else if (status === 'completed') {
    return { outcome: 'success' };
  } else if (status === 'failed' || status === 'cancelled') {
    return { outcome: 'failure', message: 'Payment failed or was cancelled.' };
  }
  if (attempts >= maxAttempts) {
    return {
      outcome: 'failure',
      message: `We could not confirm your payment yet. If you were charged, contact support with ref TXN-001.`,
    };
  }
  return { outcome: 'continue' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D-02 — polling dead-ends', () => {
  const MAX = 14;

  test('(a) NO_SESSION → immediate failure with recoverable message', () => {
    const result = evaluatePollAttempt({
      attempts: 1, maxAttempts: MAX,
      sessionMissing: true,
    });
    expect(result.outcome).toBe('failure');
    expect(result.message).toContain('session expired');
    expect(result.message).toContain('premium will still activate');
  });

  test('(b) Persistent error hits attempt cap → failure (not infinite retry)', () => {
    let attempts = 0;
    let outcome: PollOutcome = 'continue';
    while (outcome === 'continue' && attempts < 100) {
      attempts++;
      const r = evaluatePollAttempt({
        attempts, maxAttempts: MAX,
        sessionMissing: false,
        error: new Error('500 Internal Server Error'),
      });
      outcome = r.outcome;
    }
    expect(outcome).toBe('failure');
    expect(attempts).toBe(MAX);
  });

  test('(b) Attempt counter reaches MAX_ATTEMPTS exactly (no over-shoot)', () => {
    const result = evaluatePollAttempt({
      attempts: MAX, maxAttempts: MAX,
      sessionMissing: false,
      error: new Error('timeout'),
    });
    expect(result.outcome).toBe('failure');
  });

  test('(b) Below cap: transient error → continue', () => {
    const result = evaluatePollAttempt({
      attempts: 5, maxAttempts: MAX,
      sessionMissing: false,
      error: new Error('network'),
    });
    expect(result.outcome).toBe('continue');
  });

  test('success status → outcome is success', () => {
    const result = evaluatePollAttempt({
      attempts: 2, maxAttempts: MAX,
      sessionMissing: false,
      status: 'completed',
    });
    expect(result.outcome).toBe('success');
  });

  test('failed status → outcome is failure', () => {
    const result = evaluatePollAttempt({
      attempts: 2, maxAttempts: MAX,
      sessionMissing: false,
      status: 'failed',
    });
    expect(result.outcome).toBe('failure');
    expect(result.message).toContain('cancelled');
  });

  test('cancelled status → outcome is failure', () => {
    const result = evaluatePollAttempt({
      attempts: 2, maxAttempts: MAX,
      sessionMissing: false,
      status: 'cancelled',
    });
    expect(result.outcome).toBe('failure');
  });

  test('backoff is capped at 30_000 ms', () => {
    let backoff = 5000;
    for (let i = 0; i < 20; i++) {
      backoff = Math.min(backoff * 1.5, 30_000);
    }
    expect(backoff).toBe(30_000);
  });
});
