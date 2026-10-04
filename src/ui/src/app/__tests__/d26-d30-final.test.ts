/**
 * D-26 — Misleading health encoding in charts
 * D-27 — Interactive SVG / badge / flyout accessibility
 * D-28 — Signup misleading message and implicit flow
 * D-29 — Manifest hardening (https, min chrome, CSP)
 * D-30 — Minor quality: payload null-check, Dashboard load try/catch
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..', '..', '..', '..', '..');

function read(rel: string) { return readFileSync(join(REPO_ROOT, rel), 'utf8'); }
function readJson(rel: string) { return JSON.parse(read(rel)); }

// ---------------------------------------------------------------------------
// D-26
// ---------------------------------------------------------------------------
describe('D-26 — misleading health encoding', () => {
  const charts = read('src/ui/src/app/components/charts/Charts.tsx');

  test('TREND_SERIES uses neutral chart tokens, not grade colours', () => {
    // Grade colours must not be assigned to risk nutrients
    expect(charts).not.toContain('var(--ns-grade-a)');
    expect(charts).not.toContain('var(--ns-grade-e)');
    expect(charts).toContain('var(--chart-1');
    expect(charts).toContain('var(--chart-2');
  });

  test('each series has a distinct dash pattern for colour-blind users', () => {
    expect(charts).toContain('dash:');
    // All three distinct patterns must exist
    expect(charts).toContain('"0"');
    expect(charts).toContain('"6 4"');
    expect(charts).toContain('"2 3"');
  });

  test('tooltip shows unclamped DV percentage with overshoot indicator', () => {
    expect(charts).toContain('rawPctUnclamped');
    expect(charts).toContain('% DV ⚠');
  });

  test('hasData===false bucket shows No purchases, not 0% DV', () => {
    expect(charts).toContain("'No purchases'");
  });
});

// ---------------------------------------------------------------------------
// D-27
// ---------------------------------------------------------------------------
describe('D-27 — interactive SVG and badge accessibility', () => {
  const sharedUi = read('src/extension/adapters/shared-ui.js');
  const globals  = read('src/ui/src/styles/globals.css');

  test('badge trigger has role=button, tabindex and aria-label', () => {
    expect(sharedUi).toContain("setAttribute('role', 'button')");
    expect(sharedUi).toContain("setAttribute('tabindex', '0')");
    expect(sharedUi).toContain("setAttribute('aria-label'");
  });

  test('badge trigger has keydown handler (Enter/Space)', () => {
    expect(sharedUi).toContain("e.key === 'Enter' || e.key === ' '");
  });

  test('flyout has role=dialog and aria-modal', () => {
    expect(sharedUi).toContain("setAttribute('role', 'dialog')");
    expect(sharedUi).toContain("setAttribute('aria-modal', 'true')");
  });

  test('flyout has Escape key handler', () => {
    expect(sharedUi).toContain("e.key === 'Escape'");
    expect(sharedUi).toContain('_nsEscHandler');
  });

  test('_closeActiveFlyout removes Escape handler', () => {
    const closeIdx  = sharedUi.indexOf('_closeActiveFlyout()');
    const closeBody = sharedUi.slice(closeIdx, closeIdx + 400);
    expect(closeBody).toContain('_nsEscHandler');
    expect(closeBody).toContain('removeEventListener');
  });

  test('prefers-reduced-motion disables ns-pulse', () => {
    expect(globals).toContain('prefers-reduced-motion: reduce');
    expect(globals).toContain('.ns-pulse');
    expect(globals).toContain('animation: none');
  });
});

// ---------------------------------------------------------------------------
// D-28
// ---------------------------------------------------------------------------
describe('D-28 — signup misleading message', () => {
  test('signup no-session path no longer says "Account created!"', () => {
    const src = read('src/ui/src/app/components/OnboardingWizard.tsx');
    expect(src).not.toContain('Account created!');
    // New neutral message
    expect(src).toContain("we've sent a confirmation link");
    expect(src).toContain('Log in option instead');
  });
});

// ---------------------------------------------------------------------------
// D-29
// ---------------------------------------------------------------------------
describe('D-29 — manifest hardening', () => {
  const manifest = readJson('src/extension/manifest.json');

  test('minimum_chrome_version is set', () => {
    expect(manifest.minimum_chrome_version).toBeDefined();
    expect(parseInt(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(110);
  });

  test('all host_permissions use https (no http)', () => {
    for (const perm of manifest.host_permissions) {
      expect(perm).toMatch(/^https:\/\//);
    }
  });

  test('all content_script matches use https', () => {
    for (const cs of manifest.content_scripts) {
      for (const match of cs.matches) {
        expect(match).toMatch(/^https:\/\//);
      }
    }
  });

  test('content_security_policy.extension_pages is defined', () => {
    expect(manifest.content_security_policy?.extension_pages).toBeDefined();
    expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");
  });
});

// ---------------------------------------------------------------------------
// D-30
// ---------------------------------------------------------------------------
describe('D-30 — minor quality items', () => {
  test('CHECK_PRODUCT_SCORE handler guards against missing payload', () => {
    const src = read('src/extension/background.js');
    const handlerIdx = src.indexOf('"CHECK_PRODUCT_SCORE"');
    const handlerBody = src.slice(handlerIdx, handlerIdx + 800);
    expect(handlerBody).toContain('Missing payload');
    expect(handlerBody).toContain('!payload');
  });

  test('Dashboard load() has try/catch to prevent forever-spinner', () => {
    const src = read('src/ui/src/app/components/Dashboard.tsx');
    const loadIdx  = src.indexOf('async function load(');
    const loadBody = src.slice(loadIdx, loadIdx + 900);
    expect(loadBody).toContain('try {');
    expect(loadBody).toContain('} catch');
    expect(loadBody).toContain('finally {');
  });
});
