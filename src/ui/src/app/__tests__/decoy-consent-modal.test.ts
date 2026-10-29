import { describe, it, test, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { DECOY_TERMS_OF_SERVICE, DECOY_PRIVACY_POLICY } from '../legal/decoyLegalDocs';
import { ConsentDocModal } from '../components/ConsentDocModal';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..', '..', '..', '..', '..');

function read(rel: string) {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

describe('Decoy Legal Documents Data Specification', () => {
  it('DECOY_TERMS_OF_SERVICE has required sections and draft metadata', () => {
    expect(DECOY_TERMS_OF_SERVICE.title).toBe('NutriScore Terms of Service');
    expect(DECOY_TERMS_OF_SERVICE.isDraft).toBe(true);
    expect(DECOY_TERMS_OF_SERVICE.version).toContain('draft');
    
    const headings = DECOY_TERMS_OF_SERVICE.sections.map(s => s.heading);
    expect(headings.some(h => h.includes('Notice & Replacement Status'))).toBe(true);
    expect(headings.some(h => h.includes('Medical Disclaimer'))).toBe(true);
    expect(headings.some(h => h.includes('Service Tiers'))).toBe(true);
    expect(headings.some(h => h.includes('Retailer Compatibility'))).toBe(true);
  });

  it('DECOY_PRIVACY_POLICY has required sections and local-first protections', () => {
    expect(DECOY_PRIVACY_POLICY.title).toBe('NutriScore Privacy Policy');
    expect(DECOY_PRIVACY_POLICY.isDraft).toBe(true);
    expect(DECOY_PRIVACY_POLICY.version).toContain('draft');

    const headings = DECOY_PRIVACY_POLICY.sections.map(s => s.heading);
    expect(headings.some(h => h.includes('Notice & Replacement Status'))).toBe(true);
    expect(headings.some(h => h.includes('Local-First Privacy'))).toBe(true);
    expect(headings.some(h => h.includes('Do NOT Collect'))).toBe(true);
    expect(headings.some(h => h.includes('Payment Data Security'))).toBe(true);
  });
});

describe('ConsentDocModal Component Logic & VNode Output', () => {
  it('returns null when isOpen is false', () => {
    const vnode = ConsentDocModal({
      isOpen: false,
      doc: DECOY_TERMS_OF_SERVICE,
      onClose: () => {}
    });
    expect(vnode).toBeNull();
  });

  it('returns null when doc is null', () => {
    const vnode = ConsentDocModal({
      isOpen: true,
      doc: null,
      onClose: () => {}
    });
    expect(vnode).toBeNull();
  });

  it('returns structured modal tree when open with document', () => {
    const onClose = vi.fn();
    const vnode = ConsentDocModal({
      isOpen: true,
      doc: DECOY_TERMS_OF_SERVICE,
      onClose
    }) as any;

    expect(vnode).not.toBeNull();
    expect(vnode.type).toBe('div');
    expect(vnode.props.className).toContain('fixed inset-0');
  });
});

describe('OnboardingWizard Decoy Integration & Consent Ledger', () => {
  test('Consent gate contains interactive links for Terms and Privacy decoy modals', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).toContain('id="view-terms-link"');
    expect(src).toContain('id="view-privacy-link"');
    expect(src).toContain('DECOY_TERMS_OF_SERVICE');
    expect(src).toContain('DECOY_PRIVACY_POLICY');
    expect(src).toContain('<ConsentDocModal');
  });

  test('Consent gate records consent in Supabase consents table', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).toContain('from("consents")');
    expect(src).toContain('consent_version');
    expect(src).toContain('ExtensionStorage.setOnboardingComplete');
  });
});
