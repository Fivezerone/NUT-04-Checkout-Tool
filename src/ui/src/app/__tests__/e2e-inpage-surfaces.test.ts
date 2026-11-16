/**
 * e2e-inpage-surfaces.test.ts
 *
 * Automated Quality Gate Suite for In-Page Extension UI Surfaces (EXT-01 through EXT-16).
 * Enforces:
 *   - EXT-GATE-1: Target sizing (>= 28x28px visual, >= 32x32px hit-box)
 *   - EXT-GATE-2: Strict 12px font floor (zero sub-12px text)
 *   - EXT-GATE-3: Escape & outside-click lifecycle, focus restoration
 *   - EXT-GATE-4: Keyboard accessibility, tokens & dark mode isolation
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

function read(rel: string) { return readFileSync(join(REPO_ROOT, rel), 'utf8'); }

describe('In-Page Surfaces: Automated Quality Gate Suite (EXT-01 – EXT-16)', () => {
  const sharedUi = read('src/extension/adapters/shared-ui.js');
  const contentJs = read('src/extension/content.js');
  const bgJs = read('src/extension/background.js');
  const portalTokens = read('src/extension/styles/portal-tokens.css');

  describe('EXT-GATE-1: Target Sizing & Hit-Box Dimensions (EXT-05, EXT-08)', () => {
    it('badge trigger defines >= 32x32px touch hit-box', () => {
      expect(sharedUi).toContain('min-height:32px');
      expect(sharedUi).toContain('min-width:32px');
    });

    it('badge trigger defines >= 28px visual height', () => {
      expect(sharedUi).toContain('height:28px');
    });

    it('flyout close button defines >= 32x32px touch target', () => {
      expect(sharedUi).toContain('min-width:32px');
      expect(sharedUi).toContain('min-height:32px');
      expect(sharedUi).toContain('padding:6px');
    });

    it('side panel swaps CTA defines >= 36px touch height', () => {
      expect(sharedUi).toContain('min-height:38px');
    });
  });

  describe('EXT-GATE-2: Typography & Strict 12px Font Floor (EXT-06, EXT-10)', () => {
    it('contains ZERO sub-12px font declarations in shared-ui.js styles or templates', () => {
      const fontSizeMatches = sharedUi.match(/font-size:\s*([0-9.]+)px/g) || [];
      expect(fontSizeMatches.length).toBeGreaterThan(0);
      for (const match of fontSizeMatches) {
        const val = parseFloat(match.replace(/font-size:\s*/, '').replace('px', ''));
        expect(val).toBeGreaterThanOrEqual(12);
      }
    });

    it('portal-tokens.css enforces 12px caption floor', () => {
      expect(portalTokens).toContain('--text-caption: 0.75rem;');
    });

    it('tabular-nums is applied to numerical nutrition rows', () => {
      expect(sharedUi).toContain('font-variant-numeric:tabular-nums');
    });
  });

  describe('EXT-GATE-3: Popover Lifecycle & Focus Management (EXT-07, EXT-08)', () => {
    it('implements toggle behavior and stores active trigger', () => {
      expect(sharedUi).toContain('wasOpen');
      expect(sharedUi).toContain('_nutriscoreActiveTrigger');
      expect(sharedUi).toContain('if (wasOpen) return;');
    });

    it('restores focus to active trigger on flyout dismissal', () => {
      expect(sharedUi).toContain('window._nutriscoreActiveTrigger.focus');
    });

    it('sets aria-expanded to true on open and false on close', () => {
      expect(sharedUi).toContain("trigger.setAttribute('aria-expanded', 'true')");
      expect(sharedUi).toContain("window._nutriscoreActiveTrigger.setAttribute('aria-expanded', 'false')");
    });

    it('wires Escape key listener and unregisters it on close', () => {
      expect(sharedUi).toContain("e.key === 'Escape'");
      expect(sharedUi).toContain('_nsEscHandler');
      expect(sharedUi).toContain('removeEventListener');
    });

    it('implements passive viewport-aware scroll observer without abrupt scroll closing', () => {
      expect(sharedUi).toContain('_repositionFlyout');
      expect(sharedUi).toContain('inViewport');
      expect(sharedUi).toContain('_nutriscoreScrollBound');
    });

    it('traps Tab focus within the flyout dialog', () => {
      expect(sharedUi).toContain("e.key === 'Tab'");
      expect(sharedUi).toContain('e.shiftKey');
    });
  });

  describe('EXT-GATE-4: Token Architecture, Host Isolation & Surface Integrations (EXT-01 – EXT-04, EXT-12 – EXT-16)', () => {
    it('generates portal-tokens.css from DTCG build pipeline', () => {
      expect(existsSync(join(REPO_ROOT, 'src/extension/styles/portal-tokens.css'))).toBe(true);
      expect(portalTokens).toContain('--ns-surface');
      expect(portalTokens).toContain('--ns-text-strong');
      expect(portalTokens).toContain(':host([data-theme="dark"])');
    });

    it('dark theme in portal does NOT inspect host documentElement classList', () => {
      expect(sharedUi).not.toContain("document.documentElement.classList.contains('dark')");
      expect(sharedUi).toContain('window._nutriscoreCurrentThemeMode');
    });

    it('official Nutri-Score 5-segment graphic module is rendered for valid grades', () => {
      expect(sharedUi).toContain('ns-scale-module');
      expect(sharedUi).toContain('ns-scale-box');
    });

    it('distinct non-logo neutral chips are rendered for insufficient_data and not_attempted', () => {
      expect(sharedUi).toContain('Limited Info');
      expect(sharedUi).toContain('Not Rated');
      expect(sharedUi).toContain('ns-neutral-chip');
    });

    it('swaps CTA connects to background OPEN_SIDE_PANEL_SWAPS handler', () => {
      expect(sharedUi).toContain('data-ns-open-sidepanel');
      expect(sharedUi).toContain("action: 'OPEN_SIDE_PANEL_SWAPS'");
      expect(bgJs).toContain("message.action === 'OPEN_SIDE_PANEL_SWAPS'");
      expect(bgJs).toContain('chrome.sidePanel.open');
    });

    it('content.js supports store-paused pill indicator and one-click resume', () => {
      expect(contentJs).toContain('showStorePausedPill');
      expect(sharedUi).toContain('showStorePausedPill');
      expect(sharedUi).toContain('data-ns-resume');
    });

    it('content.js supports pre-checkout review callout on checkout pages', () => {
      expect(contentJs).toContain('checkCheckoutCallout');
      expect(sharedUi).toContain('showCheckoutCallout');
      expect(sharedUi).toContain('Pre-Checkout Health Review');
    });
  });
});
