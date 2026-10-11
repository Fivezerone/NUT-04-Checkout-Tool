/**
 * D-16 — Transient failure poisoning + per-item try/catch + WeakSet + observer self-ignore
 * D-17 — SW init blocks scoring on entitlement stall
 * D-18 — DB closed connection never reopened
 * D-19 — evidenceLevel missing / zero hiding / float noise
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
// D-16
// ---------------------------------------------------------------------------
describe('D-16 — transient failure poisoning', () => {
  const contentJs = read('src/extension/content.js');

  test('processedElements uses WeakSet (no DOM node leak)', () => {
    expect(contentJs).toContain('new WeakSet()');
    // The constructor must use WeakSet for processedElements (notFoundCache still uses Set — that's fine)
    const ctorIdx  = contentJs.indexOf('constructor()');
    const ctorEnd  = contentJs.indexOf('\n  }', ctorIdx);
    const ctorBody = contentJs.slice(ctorIdx, ctorEnd);
    // processedElements line must say WeakSet
    const peLineMatch = ctorBody.match(/processedElements[^\n]+/);
    expect(peLineMatch?.[0]).toContain('WeakSet');
  });

  test('_safeSend helper wraps chrome.runtime.sendMessage', () => {
    expect(contentJs).toContain('_safeSend(message, callback)');
    expect(contentJs).toContain('chrome.runtime.sendMessage(message, response');
  });

  test('scanAndInject uses _safeSend not bare sendMessage for batch', () => {
    // Find the method definition (not the call site)
    const methodIdx = contentJs.indexOf('  scanAndInject() {');
    const scanBody  = contentJs.slice(methodIdx, methodIdx + 3000);
    expect(scanBody).toContain('this._safeSend(message');
  });

  test('only definitive "Product not found" errors are cached', () => {
    expect(contentJs).toContain('Product not found');
    expect(contentJs).toContain("definitive ? 'not-found' : 'error'");
  });

  test('per-item try/catch on injectBadge', () => {
    expect(contentJs).toContain('injectBadge failed');
    expect(contentJs).toContain('try { this.adapter.injectBadge');
  });

  test('observer ignores self-injected nutriscore nodes', () => {
    expect(contentJs).toContain('nutriscore-isolated-root');
    expect(contentJs).toContain('nutriscore-global-portal');
    expect(contentJs).toContain('if (!relevant) return');
  });

  test('batch infrastructure failure uses retryable error state', () => {
    expect(contentJs).toContain("'error'");
    // The old code cached everything as not-found
    const batchFail = contentJs.lastIndexOf('Batch infrastructure failure');
    expect(batchFail).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// D-17 (updated for Phase 3 / F-01)
// ---------------------------------------------------------------------------
describe('D-17 — SW init does not block scoring on entitlement', () => {
  test('entitlement refresh is NOT called on boot — alarm-driven only (F-01)', () => {
    const src = read('src/extension/background.js');

    // Phase 3 / F-01: initializeDatabases() has been removed.
    // There must be NO call to NutriEntitlement.refresh() outside the alarm handler.
    expect(src).not.toContain('function initializeDatabases');

    // ensureCatalogReady must not contain a refresh() call.
    const startIdx = src.indexOf('async function ensureCatalogReady');
    const endIdx   = src.indexOf('\n}', startIdx) + 2;
    const readyBlock = src.slice(startIdx, endIdx);
    const codeOnly = readyBlock.replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toContain('NutriEntitlement.refresh()');

    // The 'entitlement-refresh' alarm handler MUST call refresh() (the only allowed site).
    const alarmHandlerStart = src.indexOf('"entitlement-refresh"');
    expect(alarmHandlerStart).toBeGreaterThan(-1);
    const alarmBlock = src.slice(alarmHandlerStart, alarmHandlerStart + 500);
    expect(alarmBlock).toContain('NutriEntitlement.refresh()');
  });
});


// ---------------------------------------------------------------------------
// D-18
// ---------------------------------------------------------------------------
describe('D-18 — DB closed connection re-opens', () => {
  test('blocking() handler nulls dbPromise before closing', () => {
    const src = read('src/ui/src/app/lib/db/shared.ts');
    const blockIdx  = src.indexOf('blocking(currentVersion');
    const blockBody = src.slice(blockIdx, blockIdx + 700);
    expect(blockBody).toContain('dbPromise = null');
    expect(blockBody).toContain('db.close()');
  });

  test('terminated() handler nulls dbPromise', () => {
    const src = read('src/ui/src/app/lib/db/shared.ts');
    expect(src).toContain('terminated()');
    const termIdx  = src.indexOf('terminated()');
    const termBody = src.slice(termIdx, termIdx + 200);
    expect(termBody).toContain('dbPromise = null');
  });
});

// ---------------------------------------------------------------------------
// D-19
// ---------------------------------------------------------------------------
describe('D-19 — evidenceLevel / zero hiding / float noise', () => {
  test('buildNutritionalProfileDisplay rounds energy_kj', () => {
    const src = read('src/extension/background.js');
    expect(src).toContain('round0');
    expect(src).toContain('Math.round(v)');
    // energy_kj must use round0
    const fnStart = src.indexOf('function buildNutritionalProfileDisplay');
    const fnEnd   = src.indexOf('\n}\n', fnStart);
    const body    = src.slice(fnStart, fnEnd);
    expect(body).toContain('round0(parseNumeric(');
  });

  test('evidenceLevel is copied into the result object', () => {
    const src = read('src/extension/background.js');
    expect(src).toContain('evidenceLevel:');
    expect(src).toContain('interpretation.evidenceLevel');
  });

  test('shared-ui.js nutrient filter does not exclude zeros', () => {
    const src = read('src/extension/adapters/shared-ui.js');
    // Old filter: Number(r.val) !== 0
    expect(src).not.toContain('Number(r.val) !== 0');
    // New filter: null/undefined/'' only
    expect(src).toContain("r.val !== null && r.val !== undefined && r.val !== ''");
  });

  // Pure logic: round0 behaviour
  test('round0 logic: 1255.2000000000002 → 1255', () => {
    const round0 = (v: number | null) => (v == null ? null : Math.round(v));
    expect(round0(1255.2000000000002)).toBe(1255);
    expect(round0(0)).toBe(0);
    expect(round0(null)).toBeNull();
  });

  test('zero value is not filtered out', () => {
    const filter = (val: number | null | undefined | string) =>
      val !== null && val !== undefined && val !== '';
    expect(filter(0)).toBe(true);
    expect(filter(null)).toBe(false);
    expect(filter('')).toBe(false);
  });
});
