/**
 * D-08 — Billing column client writes: structural tests
 * D-09 — Renewal clobbers profile: pure logic + structural tests
 * D-10 — Profile save failure dead-end: structural tests
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..', '..', '..', '..', '..');

function read(rel: string) {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// D-08
// ---------------------------------------------------------------------------

describe('D-08 — billing columns not written by client', () => {
  test('OnboardingWizard finishOnboarding upsert does not set is_premium', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    // Find the upsert in finishOnboarding
    const fnStart = src.indexOf('const finishOnboarding = async');
    const fnEnd   = src.indexOf('\n  const handle', fnStart);
    const body    = src.slice(fnStart, fnEnd);
    expect(body).not.toMatch(/is_premium\s*:/);
  });

  test('OnboardingWizard finishOnboarding upsert does not set subscription_status', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    const fnStart = src.indexOf('const finishOnboarding = async');
    const fnEnd   = src.indexOf('\n  const handle', fnStart);
    const body    = src.slice(fnStart, fnEnd);
    expect(body).not.toMatch(/subscription_status\s*:/);
  });

  test('useSubscriptionGuard client update does not set is_premium', () => {
    const src = read('src/ui/src/app/hooks/useSubscriptionGuard.ts');
    // Only update({ subscription_status }) should appear, not is_premium
    expect(src).not.toContain("is_premium: false");
  });

  test('dashboard.tsx client update does not set is_premium', () => {
    const src = read('src/ui/src/dashboard.tsx');
    expect(src).not.toContain('is_premium: false');
  });

  test('OnboardingWizard no longer writes nutriscore_is_premium directly', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).not.toContain('nutriscore_is_premium');
  });
});

// ---------------------------------------------------------------------------
// D-09
// ---------------------------------------------------------------------------

describe('D-09 — renewal path fixes', () => {
  test('processSession checks active payment BEFORE renew early return', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    // getActivePayment must appear before the renew else-if block
    const paymentIdx = src.indexOf('getActivePayment()');
    const renewIdx   = src.indexOf("initialMode === 'renew'");
    // First occurrence of initialMode === 'renew' in processSession should come AFTER getActivePayment
    expect(paymentIdx).toBeGreaterThan(0);
    expect(renewIdx).toBeGreaterThan(paymentIdx);
  });

  test("finishOnboarding skips upsert for renewals (isRenewal guard present)", () => {
    const src = read('src/ui/src/app/lib/persistOnboarding.ts');
    expect(src).toContain('const isRenewal = initialMode === \'renew\'');
    expect(src).toContain('if (!isRenewal)');
  });

  test("Paystack uses user.email not the form-state fallback", () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).not.toContain('"user@example.com"');
    expect(src).toContain('user?.email || email.trim()');
  });
});

// ---------------------------------------------------------------------------
// D-10
// ---------------------------------------------------------------------------

describe('D-10 - profile save failure retry affordance', () => {
  test('finishError state is declared', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).toContain('finishError');
    expect(src).toContain('setFinishError');
  });

  test('success block has retry button referencing finishError', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).toContain('Retry saving profile');
    expect(src).toContain('setFinishError(null)');
  });

  test('success block no longer shows "Payment Successful! Redirecting..."', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).not.toContain('Payment Successful! Redirecting...');
  });

  test('RPC error path uses setFinishError (not setError)', () => {
    const src = read('src/ui/src/app/lib/persistOnboarding.ts');
    // The complete_onboarding RPC error branch must use setFinishError
    // (previously: if (upsertError); now: if (rpcError || data.error) per audit F-07 fix)
    const errStart = src.indexOf('if (rpcError ||');
    const errEnd   = src.indexOf('return false;', errStart);
    const block    = src.slice(errStart, errEnd);
    expect(block).toContain('setFinishError(');
  });
});
