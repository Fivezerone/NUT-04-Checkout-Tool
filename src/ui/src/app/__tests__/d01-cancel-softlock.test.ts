/**
 * D-01 — Cancel Soft-Lock: pure logic test
 *
 * Tests that the cancel-state transition logic works:
 * when transactionRef/method become null while status='processing',
 * the new status must be 'idle'.
 *
 * This is a pure function test (no React, no DOM) that verifies the
 * predicate used inside usePaymentState's effect guard.
 */

import { describe, test, expect } from 'vitest';

/**
 * Extracted cancel-guard predicate — mirrors the fix in usePaymentState:
 *   if (!transactionRef || !method) {
 *     setStatus(prev => (prev === 'processing' ? 'idle' : prev));
 *   }
 */
function cancelGuard(
  ref: string | null,
  method: string | null,
  prevStatus: 'idle' | 'processing' | 'success' | 'error'
): 'idle' | 'processing' | 'success' | 'error' {
  if (!ref || !method) {
    return prevStatus === 'processing' ? 'idle' : prevStatus;
  }
  return prevStatus;
}

describe('D-01 — cancel soft-lock predicate', () => {
  test('processing → idle when ref is cleared', () => {
    expect(cancelGuard(null, null, 'processing')).toBe('idle');
  });

  test('processing → idle when only ref is null', () => {
    expect(cancelGuard(null, 'mpesa', 'processing')).toBe('idle');
  });

  test('processing → idle when only method is null', () => {
    expect(cancelGuard('TXN-001', null, 'processing')).toBe('idle');
  });

  test('idle stays idle when ref is null', () => {
    expect(cancelGuard(null, null, 'idle')).toBe('idle');
  });

  test('success stays success when ref is null (completed payment cleared)', () => {
    expect(cancelGuard(null, null, 'success')).toBe('success');
  });

  test('error stays error when ref is null', () => {
    expect(cancelGuard(null, null, 'error')).toBe('error');
  });

  test('status unchanged when ref and method are both present', () => {
    expect(cancelGuard('TXN-001', 'mpesa', 'processing')).toBe('processing');
    expect(cancelGuard('TXN-001', 'paystack', 'idle')).toBe('idle');
  });
});
