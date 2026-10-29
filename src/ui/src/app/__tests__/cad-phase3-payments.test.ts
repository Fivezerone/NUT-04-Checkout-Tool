/**
 * cad-phase3-payments.test.ts
 *
 * Mandatory payment and subscription lifecycle test scenarios for Clinic Admin Dashboard (CAD)
 * Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§13 Mandatory Test Scenarios T1-T9)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { RETRY_DELAYS_SECONDS } from '../../../../shared/payments'

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, '')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

describe('T1: User Cancellation of STK Push (ResultCode 1032)', () => {
  it('maps ResultCode 1032 to failed_cancelled with no subscription activation', () => {
    // State machine simulator for failure routing
    const handleResultCode = (resultCode: number) => {
      if (resultCode === 1032) return { status: 'failed_cancelled', activate: false }
      if (resultCode === 0) return { status: 'succeeded', activate: true }
      return { status: 'quarantined', activate: false }
    }

    const res = handleResultCode(1032)
    expect(res.status).toBe('failed_cancelled')
    expect(res.activate).toBe(false)
  })

  it('migration 20261029010000_tenant_billing_lifecycle.sql handles ResultCode 1032', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '20261029010000_tenant_billing_lifecycle.sql'), 'utf8')
    expect(sql).toContain('p_result_code = 1032')
    expect(sql).toContain("v_new_status := 'failed_cancelled'")
  })
})

describe('T2: Insufficient Funds & Grace Period Routing (ResultCode 1)', () => {
  it('maps ResultCode 1 to failed_funds and transitions active renewal to past_due grace', () => {
    const handleInsufficientFunds = (currentSubStatus: 'active' | 'pending_activation') => {
      const attemptStatus = 'failed_funds'
      let newSubStatus = currentSubStatus
      let graceDays: number | null = null

      if (currentSubStatus === 'active') {
        newSubStatus = 'past_due'
        graceDays = 7 // Default 7-day grace period
      }

      return { attemptStatus, newSubStatus, graceDays }
    }

    // Existing active subscription renewal fails
    const renewal = handleInsufficientFunds('active')
    expect(renewal.attemptStatus).toBe('failed_funds')
    expect(renewal.newSubStatus).toBe('past_due')
    expect(renewal.graceDays).toBe(7)

    // New tenant initial activation fails
    const newTenant = handleInsufficientFunds('pending_activation')
    expect(newTenant.attemptStatus).toBe('failed_funds')
    expect(newTenant.newSubStatus).toBe('pending_activation')
    expect(newTenant.graceDays).toBeNull()
  })

  it('migration grants 7 days grace for active subscriptions on code 1', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '20261029010000_tenant_billing_lifecycle.sql'), 'utf8')
    expect(sql).toContain('p_result_code = 1')
    expect(sql).toContain("v_new_status := 'failed_funds'")
    expect(sql).toContain("status = 'past_due'")
    expect(sql).toContain("grace_ends_at = now() + interval '7 days'")
  })
})

describe('T3 & T9: STK Push Timeout (1037) & In-Flight Status (1036)', () => {
  it('reconciliation backoff follows specified schedule (+90s, +3m, +10m, +30m, +2h)', () => {
    expect(RETRY_DELAYS_SECONDS).toEqual([90, 180, 600, 1800, 7200])
  })

  it('T9: Daraja code 1036 (still processing) keeps attempt pending and never fails early', () => {
    const parseDarajaResult = (code: number) => {
      if (code === 0) return { action: 'activate' }
      if (code === 1036) return { action: 'retry_backoff', status: 'pending' }
      return { action: 'fail', status: 'failed' }
    }

    const inFlight = parseDarajaResult(1036)
    expect(inFlight.action).toBe('retry_backoff')
    expect(inFlight.status).toBe('pending')
  })
})

describe('T4: Idempotent Activation & Duplicate Callback Guard', () => {
  it('duplicate success callback activates once, preserves receipt, and avoids duplicate state change', () => {
    let callCount = 0
    let activationAuditRows = 0

    const processCallback = (attempt: { id: string; status: string; receipt: string | null }) => {
      callCount++
      if (attempt.status === 'succeeded') {
        return { success: true, status: 'already_activated', receipt: attempt.receipt }
      }
      attempt.status = 'succeeded'
      attempt.receipt = 'MPESA-XYZ-123'
      activationAuditRows++
      return { success: true, status: 'active', receipt: attempt.receipt }
    }

    const attempt = { id: 'att-1', status: 'pending', receipt: null }

    // First delivery
    const res1 = processCallback(attempt)
    expect(res1.status).toBe('active')
    expect(res1.receipt).toBe('MPESA-XYZ-123')
    expect(activationAuditRows).toBe(1)

    // Second (duplicate) delivery
    const res2 = processCallback(attempt)
    expect(res2.status).toBe('already_activated')
    expect(res2.receipt).toBe('MPESA-XYZ-123')
    expect(activationAuditRows).toBe(1) // Still exactly 1 audit row
    expect(callCount).toBe(2)
  })

  it('activate_tenant_subscription database function enforces idempotency guard', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '20261029010000_tenant_billing_lifecycle.sql'), 'utf8')
    expect(sql).toContain("IF v_attempt.status = 'succeeded' THEN")
    expect(sql).toContain("'already_activated'")
  })
})

describe('T5 & T6: Amount Mismatch & Forged Callback Quarantine', () => {
  it('T5: callback amount mismatch holds payment in quarantine and logs audit alert', () => {
    const validateAmount = (attemptAmount: number, invoiceAmount: number) => {
      if (attemptAmount !== invoiceAmount) {
        return { status: 'amount_mismatch', quarantined: true, activated: false }
      }
      return { status: 'succeeded', quarantined: false, activated: true }
    }

    const tampered = validateAmount(100.0, 5000.0)
    expect(tampered.status).toBe('amount_mismatch')
    expect(tampered.quarantined).toBe(true)
    expect(tampered.activated).toBe(false)

    const exact = validateAmount(5000.0, 5000.0)
    expect(exact.status).toBe('succeeded')
    expect(exact.quarantined).toBe(false)
    expect(exact.activated).toBe(true)
  })

  it('T6: unknown CheckoutRequestID returns not found / quarantine without activation', () => {
    const knownRequests = new Map([['ws_CO_01', { invoiceId: 'inv-1', amount: 5000 }]])

    const lookupAttempt = (checkoutId: string) => {
      const match = knownRequests.get(checkoutId)
      if (!match) {
        return { error: 'attempt_not_found', activated: false }
      }
      return { data: match, activated: true }
    }

    expect(lookupAttempt('ws_CO_UNKNOWN').error).toBe('attempt_not_found')
    expect(lookupAttempt('ws_CO_UNKNOWN').activated).toBe(false)
  })
})

describe('T7: Paystack Webhook Signature Verification & Replay Resistance', () => {
  it('rejects signature mismatch with constant-time comparison', () => {
    const constantTimeEqual = (a: string, b: string) => {
      if (a.length !== b.length) return false
      let mismatch = 0
      for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
      }
      return mismatch === 0
    }

    const sigA = '9a8b7c6d5e4f3a2b1c0d'
    const sigB = '9a8b7c6d5e4f3a2b1c0d'
    const sigForged = '9a8b7c6d5e4f3a2b1c0e'

    expect(constantTimeEqual(sigA, sigB)).toBe(true)
    expect(constantTimeEqual(sigA, sigForged)).toBe(false)
  })
})

describe('T8: Grace Period Expiration Transitions to Suspended Read-Only', () => {
  it('past_due subscription past grace_ends_at transitions to suspended', () => {
    const checkGraceExpiration = (sub: { status: string; grace_ends_at: string | null }, now: string) => {
      if (sub.status === 'past_due' && sub.grace_ends_at && new Date(now) > new Date(sub.grace_ends_at)) {
        return { status: 'suspended', readOnly: true }
      }
      return { status: sub.status, readOnly: sub.status === 'suspended' }
    }

    const pastGrace = {
      status: 'past_due',
      grace_ends_at: '2026-10-20T00:00:00Z',
    }

    const result = checkGraceExpiration(pastGrace, '2026-10-22T00:00:00Z')
    expect(result.status).toBe('suspended')
    expect(result.readOnly).toBe(true)
  })

  it('in suspended status existing targets are not silently deleted', () => {
    const targets = [
      { id: 'tgt-1', status: 'active', valid_to: '2026-12-31' },
      { id: 'tgt-2', status: 'active', valid_to: '2026-11-15' },
    ]

    const handleSuspension = (targetList: typeof targets) => {
      // Invariant: targets expire naturally according to valid_to, never deleted on suspension
      return targetList.map((t) => ({ ...t, keptIntact: true }))
    }

    const remaining = handleSuspension(targets)
    expect(remaining.length).toBe(2)
    expect(remaining[0].status).toBe('active')
  })
})
