/**
 * D-14 — Upsell CTA doubly dead: structural tests
 * D-15 — Flyout toggle and stale state bugs: structural tests
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..', '..', '..', '..', '..');

function read(rel: string) { return readFileSync(join(REPO_ROOT, rel), 'utf8'); }

describe('D-14 — Upgrade CTA (shared-ui.js + background.js)', () => {
  test('shared-ui.js uses data-ns-upgrade attribute (not inline onclick)', () => {
    const src = read('src/extension/adapters/shared-ui.js');
    expect(src).toContain('data-ns-upgrade');
    expect(src).not.toContain("onclick=\"chrome.runtime");
  });

  test('shared-ui.js has no onmouseover/onmouseout inline attributes', () => {
    const src = read('src/extension/adapters/shared-ui.js');
    expect(src).not.toContain('onmouseover=');
    expect(src).not.toContain('onmouseout=');
  });

  test('shared-ui.js wires upgrade CTA click listener in content world', () => {
    const src = read('src/extension/adapters/shared-ui.js');
    expect(src).toContain("querySelector('[data-ns-upgrade]')");
    expect(src).toContain("action: 'OPEN_UPGRADE'");
  });

  test('background.js has OPEN_UPGRADE handler', () => {
    const src = read('src/extension/background.js');
    expect(src).toContain("message.action === 'OPEN_UPGRADE'");
    expect(src).toContain("chrome.tabs.create");
    expect(src).toContain("?mode=renew");
  });
});

describe('D-15 — Flyout toggle, listener leak, portal stale, rescan', () => {
  const sharedUi = read('src/extension/adapters/shared-ui.js');
  const contentJs = read('src/extension/content.js');

  test('D-15a: flyout toggle — wasOpen check present', () => {
    expect(sharedUi).toContain('wasOpen');
    expect(sharedUi).toContain('if (wasOpen) return');
    expect(sharedUi).toContain('_nutriscoreActiveTrigger');
  });

  test('D-15b: outside-click listener stored on window (not a local var)', () => {
    expect(sharedUi).toContain('window._nutriscoreOutside');
    // The old local outsideClick variable should not be used
    const codeOnly = sharedUi.replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toContain('const outsideClick =');
  });

  test('D-15b: _closeActiveFlyout removes the outside-click listener', () => {
    const fnStart = sharedUi.indexOf('_closeActiveFlyout() {');
    const fnEnd   = sharedUi.indexOf('\n  },\n', fnStart);
    const body    = sharedUi.slice(fnStart, fnEnd + 10);
    expect(body).toContain('_nutriscoreOutside');
    expect(body).toContain('removeEventListener');
  });

  test('D-15c: _ensureGlobalPortal checks isConnected', () => {
    expect(sharedUi).toContain('isConnected');
  });

  test('D-15d: content.js has rescan() method', () => {
    expect(contentJs).toContain('rescan()');
    // D-16 changed processedElements to WeakSet (still present in legacy rescan path)
    expect(contentJs).toContain('processedElements = new WeakSet()');
    expect(contentJs).toContain('notFoundCache = new Set()');
    // F-05 refactor: rescan() now uses double-quote attribute name
    expect(contentJs).toContain('removeAttribute("data-nutriscore-scanned")');
  });

  test('D-15d: storage change on uiTheme triggers rescan in content.js', () => {
    expect(contentJs).toContain('chrome.storage.onChanged');
    expect(contentJs).toContain('this.rescan()');
  });

  test('D-15b: outside-click uses composedPath (shadow DOM safe)', () => {
    expect(sharedUi).toContain('composedPath()');
  });

  test('Flyout render: does not reference undeclared productInfo', () => {
    // Critical fix: productInfo was undeclared and threw ReferenceError on badge click
    expect(sharedUi).not.toContain('productInfo');
    expect(sharedUi).toContain('productResult?.product_name');
  });

  test('Flyout render: focuses with preventScroll to avoid premature scroll-close', () => {
    expect(sharedUi).toContain('preventScroll: true');
  });

  test('Flyout render: scroll listener is bound idempotently', () => {
    expect(sharedUi).toContain('_nutriscoreScrollBound');
  });
});
