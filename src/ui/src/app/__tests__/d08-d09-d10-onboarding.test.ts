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
  test('OnboardingWizard does not write is_premium', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).not.toMatch(/is_premium\s*:/);
  });

  test('OnboardingWizard does not write subscription_status', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).not.toMatch(/subscription_status\s*:/);
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
// D-09 — Phase 3 CAD-Only Patient Sign-In & Forced Password Change
// ---------------------------------------------------------------------------

describe('D-09 — CAD patient sign-in and forced password change', () => {
  test('OnboardingWizard signs in with clinic credentials (email + password)', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).toContain('signInWithPassword');
    expect(src).toContain('handleSignIn');
  });

  test('OnboardingWizard enforces password change when force_password_change is set', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).toContain('force_password_change');
    expect(src).toContain('handlePasswordChange');
    expect(src).toContain('updateUser');
  });

  test('OnboardingWizard does not contain consumer self-registration or Google sign-in', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).not.toContain('signInWithOAuth');
    expect(src).not.toContain('google');
    expect(src).not.toContain('chrome.identity');
  });
});

// ---------------------------------------------------------------------------
// D-10 — Phase 3 Standalone Consent Gate & Excised Consumer Billing
// ---------------------------------------------------------------------------

describe('D-10 — standalone consent gate and excised consumer billing', () => {
  test('OnboardingWizard requires both Terms and Privacy acceptance before activation', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).toContain('termsAccepted');
    expect(src).toContain('privacyAccepted');
    expect(src).toContain('handleAcceptConsent');
  });

  test('OnboardingWizard supports dismissing consent leaving extension inert', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).toContain('consentDismissed');
    expect(src).toContain('Dismiss for now');
  });

  test('OnboardingWizard does not contain consumer plan selection or pricing', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).not.toContain('189.00');
    expect(src).not.toContain('packagePrice');
    expect(src).not.toContain('PaystackPop');
    expect(src).not.toContain('usePaymentState');
  });
});
