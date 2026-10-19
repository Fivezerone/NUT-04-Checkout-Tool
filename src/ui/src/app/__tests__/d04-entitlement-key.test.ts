/**
 * D-04 — Entitlement key mismatch and activation lag: structural tests
 *
 * Verifies:
 *  1. savePremiumStatus writes to 'nutri_entitlement' (not the dead 'nutriscore_is_premium')
 *  2. savePremiumStatus sends REFRESH_ENTITLEMENT to the SW
 *  3. background.js has a REFRESH_ENTITLEMENT message handler
 *  4. entitlement.js exports adopt()
 *  5. Dead IDB write removed from savePremiumStatus
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

describe('D-04 — entitlement key and activation lag fixes', () => {
  test('savePremiumStatus writes to nutri_entitlement', () => {
    const src = read('src/ui/src/services/storage.ts');
    expect(src).toContain("'nutri_entitlement'");
  });

  test('savePremiumStatus sends REFRESH_ENTITLEMENT', () => {
    const src = read('src/ui/src/services/storage.ts');
    expect(src).toContain('REFRESH_ENTITLEMENT');
  });

  test('savePremiumStatus does NOT write nutriscore_is_premium (dead key)', () => {
    const src = read('src/ui/src/services/storage.ts');
    // savePremiumStatus body should not set nutriscore_is_premium
    const bodyStart = src.indexOf('export const savePremiumStatus');
    const bodyEnd   = src.indexOf('\n};', bodyStart);
    const body = src.slice(bodyStart, bodyEnd);
    expect(body).not.toContain('nutriscore_is_premium');
  });

  test('savePremiumStatus does NOT write to IndexedDB isPremium (dead key)', () => {
    const src = read('src/ui/src/services/storage.ts');
    const bodyStart = src.indexOf('export const savePremiumStatus');
    const bodyEnd   = src.indexOf('\n};', bodyStart);
    const body = src.slice(bodyStart, bodyEnd);
    expect(body).not.toContain('isPremium');
    expect(body).not.toContain('indexedDB');
  });

  test('background.js has REFRESH_ENTITLEMENT message handler', () => {
    const src = read('src/extension/background.js');
    expect(src).toContain("'REFRESH_ENTITLEMENT'");
    expect(src).toContain('NutriEntitlement.refresh()');
  });

  test('entitlement.js exports adopt()', () => {
    const src = read('src/extension/entitlement.js');
    expect(src).toContain('function adopt(');
    // Must be in the public API return
    const returnIdx = src.lastIndexOf('return {');
    expect(src.slice(returnIdx)).toContain('adopt');
  });
});
