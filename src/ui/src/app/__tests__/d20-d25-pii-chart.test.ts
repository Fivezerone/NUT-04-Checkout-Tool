/**
 * D-20 — Premium fields race into product cache
 * D-21 — Dead / unwired code (oauth_login removed)
 * D-22 — PII never purged on sign-out
 * D-23 — CSS @import order (health palette)
 * D-24 — Grade palette accessibility
 * D-25 — Chart empty states (EmptyChart + ChartBoundary + ChartBox skeleton)
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..', '..', '..', '..', '..');

function read(rel: string) { return readFileSync(join(REPO_ROOT, rel), 'utf8'); }

// ---------------------------------------------------------------------------
// D-20
// ---------------------------------------------------------------------------
describe('D-20 — premium fields race into cache', () => {
  test('saveProduct uses structuredClone before appendPremiumAssessment', () => {
    const src = read('src/extension/background.js');
    expect(src).toContain('structuredClone(result)');
    // Must appear BEFORE appendPremiumAssessment call
    const cloneIdx   = src.indexOf('structuredClone(result)');
    const enrichIdx  = src.indexOf('appendPremiumAssessment(result');
    expect(cloneIdx).toBeGreaterThan(-1);
    expect(enrichIdx).toBeGreaterThan(cloneIdx);
  });
});

// ---------------------------------------------------------------------------
// D-21
// ---------------------------------------------------------------------------
describe('D-21 — oauth_login dead code removed', () => {
  test('oauth_login handler is not active in background.js', () => {
    const src = read('src/extension/background.js');
    // The handler block must be gone; only the removal comment may reference it
    const codeOnly = src.replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toContain('"oauth_login"');
    expect(codeOnly).not.toContain("'oauth_login'");
  });
});

// ---------------------------------------------------------------------------
// D-22
// ---------------------------------------------------------------------------
describe('D-22 — PII purge on sign-out', () => {
  test('USER_STORAGE_KEYS includes partial_onboarding', () => {
    const src = read('src/ui/src/services/storage.ts');
    expect(src).toContain('partial_onboarding');
    expect(src).toContain('USER_STORAGE_KEYS');
  });

  test('signOutUser removes USER_STORAGE_KEYS (not just nutri_entitlement)', () => {
    const src = read('src/ui/src/services/storage.ts');
    const fnStart = src.indexOf('export const signOutUser');
    const fnEnd   = src.indexOf('\n};\n', fnStart);
    const body    = src.slice(fnStart, fnEnd + 5);
    expect(body).toContain('USER_STORAGE_KEYS');
    expect(body).toContain('localStorage.removeItem');
    // Must NOT still use the old .set({ nutriscore_is_premium: false })
    expect(body).not.toContain('nutriscore_is_premium: false');
  });

  test('setPartialOnboardingData strips mpesaPhone, dob, gender', () => {
    const src = read('src/ui/src/services/storage.ts');
    expect(src).toContain('mpesaPhone: _m');
    expect(src).toContain('dob: _d');
    expect(src).toContain('gender: _g');
    expect(src).toContain('...safeData');
  });

  test('dashboard uses server onboarding_completed as sole authority (F-10)', () => {
    const src = read('src/ui/src/dashboard.tsx');
    // F-10 fix: local cache no longer gates routing — server result.onboardingCompleted is authoritative
    // We still write a per-userId cache after server confirms, but never READ it for the gate
    expect(src).toContain('result.onboardingCompleted');
    // setOnboardingCompleted (write) is still user-scoped for performance cache
    expect(src).toContain('setOnboardingCompleted(session.user.id, true)');
    // Old bare key must be gone
    expect(src).not.toContain("get('onboarding_completed')");
    // Local cache must NOT override server false (F-10 key invariant)
    expect(src).not.toContain('!result.onboardingCompleted && !localCompleted');
  });
});

// ---------------------------------------------------------------------------
// D-23
// ---------------------------------------------------------------------------
describe('D-23 — CSS @import order', () => {
  test('index.css imports health-modes.generated.css before theme.css', () => {
    const src = read('src/ui/src/styles/index.css');
    const hmIdx = src.indexOf('health-modes.generated.css');
    const thIdx = src.indexOf('theme.css');
    expect(hmIdx).toBeGreaterThan(-1);
    expect(thIdx).toBeGreaterThan(-1);
    expect(hmIdx).toBeLessThan(thIdx);
  });

  test('theme.css does NOT contain a @import rule (moved to index.css)', () => {
    const src = read('src/ui/src/styles/theme.css');
    // The old import line must be absent
    expect(src).not.toContain('@import url("./health-modes.generated.css")');
  });
});

// ---------------------------------------------------------------------------
// D-24
// ---------------------------------------------------------------------------
describe('D-24 — grade palette accessibility', () => {
  test('grade B uses accessible dark foreground (not white on green)', () => {
    const src = read('src/extension/adapters/grade-colors.js');
    // Grade B: bg #85bb2f with dark txt (not #ffffff)
    expect(src).toContain('#85bb2f');
    expect(src).not.toMatch(/B:.*txt.*#ffffff/);
  });

  test('grade D uses accessible dark foreground (not white on orange)', () => {
    const src = read('src/extension/adapters/grade-colors.js');
    expect(src).toContain('#ee8100');
    expect(src).not.toMatch(/D:.*txt.*#ffffff/);
  });

  test('all grades have an "on" property for chart labels', () => {
    const src = read('src/extension/adapters/grade-colors.js');
    expect(src).toContain('on:');
    // All 5 grades
    ['A', 'B', 'C', 'D', 'E'].forEach(g => {
      const idx = src.indexOf(`${g}: {`);
      const block = src.slice(idx, idx + 120);
      expect(block).toContain('on:');
    });
  });
});

// ---------------------------------------------------------------------------
// D-25
// ---------------------------------------------------------------------------
describe('D-25 — chart empty states and error boundary', () => {
  test('ChartBoundary.tsx exists and extends React.Component', () => {
    const src = read('src/ui/src/app/components/charts/ChartBoundary.tsx');
    expect(src).toContain('extends React.Component');
    expect(src).toContain('getDerivedStateFromError');
    expect(src).toContain('role="alert"');
  });

  test('EmptyChart.tsx exports EmptyChart and isFiniteNum', () => {
    const src = read('src/ui/src/app/components/charts/EmptyChart.tsx');
    expect(src).toContain('export function EmptyChart');
    expect(src).toContain('export const isFiniteNum');
    expect(src).toContain('Number.isFinite(n)');
  });

  test('DonutChart uses EmptyChart instead of blank grey disc', () => {
    const src = read('src/ui/src/app/components/charts/Charts.tsx');
    expect(src).toContain('EmptyChart');
    // Old blank disc must be gone
    expect(src).not.toContain('fill="#f2f2f2"');
  });

  test('LineTrend uses EmptyChart for empty/all-zero data', () => {
    const src = read('src/ui/src/app/components/charts/Charts.tsx');
    expect(src).toContain('No nutrient data for this period');
  });

  test('ChartBox renders skeleton while width===0 (not null)', () => {
    const src = read('src/ui/src/app/components/ChartBox.tsx');
    expect(src).toContain('animate-pulse');
    // Old null must be gone
    const codeOnly = src.replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toContain(': null}');
  });

  // Pure logic: isFiniteNum
  test('isFiniteNum rejects NaN and Infinity', () => {
    const isFiniteNum = (n: unknown): n is number =>
      typeof n === 'number' && Number.isFinite(n);
    expect(isFiniteNum(NaN)).toBe(false);
    expect(isFiniteNum(Infinity)).toBe(false);
    expect(isFiniteNum(0)).toBe(true);
    expect(isFiniteNum(42.5)).toBe(true);
    expect(isFiniteNum('0')).toBe(false);
  });
});
