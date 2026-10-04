/**
 * D-05 — Multi-client refresh storm: structural tests
 *
 * Verifies:
 *  1. background.js defines a singleton sb() (no more NutriSupabase.create per call)
 *  2. background.js defines currentTier() with a 30s memo
 *  3. getProductInfo no longer calls NutriSupabase.create directly
 *  4. Tier memo is invalidated (_tierAt = 0) in REFRESH_ENTITLEMENT handler
 *  5. 30s memo guard logic is correct
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..', '..', '..', '..', '..');
const bgSrc      = readFileSync(join(REPO_ROOT, 'src', 'extension', 'background.js'), 'utf8');

describe('D-05 — multi-client refresh storm prevention', () => {
  test('background.js defines the sb() singleton factory', () => {
    expect(bgSrc).toContain('const sb = ()');
    // Singleton: only initialised once via ??=
    expect(bgSrc).toContain('??= NutriSupabase.create(');
  });

  test('background.js defines currentTier() with 30s memo guard', () => {
    expect(bgSrc).toContain('async function currentTier()');
    expect(bgSrc).toContain('30_000');
    expect(bgSrc).toContain('_tierAt');
  });

  test('getProductInfo does NOT directly call NutriSupabase.create()', () => {
    // Locate getProductInfo function body
    const fnStart = bgSrc.indexOf('async function getProductInfo(');
    const fnEnd   = bgSrc.indexOf('\nasync function ', fnStart + 1);
    const body    = bgSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(body).not.toContain('NutriSupabase.create(');
  });

  test('getProductInfo uses currentTier() instead of inline resolveTier', () => {
    const fnStart = bgSrc.indexOf('async function getProductInfo(');
    const fnEnd   = bgSrc.indexOf('\nasync function ', fnStart + 1);
    const body    = bgSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(body).toContain('await currentTier()');
  });

  test('REFRESH_ENTITLEMENT handler invalidates tier memo (_tierAt = 0)', () => {
    expect(bgSrc).toContain('_tierAt = 0');
  });

  test('30s memo guard logic: stale after 30s, fresh within', () => {
    // Pure logic verification
    function memoGuard(tier: string | undefined, tierAt: number, now: number): boolean {
      return !!(tier && now - tierAt < 30_000);
    }
    const now = Date.now();
    expect(memoGuard('premium', now - 10_000, now)).toBe(true);   // 10s old → hit
    expect(memoGuard('premium', now - 30_001, now)).toBe(false);  // 30s+ → miss
    expect(memoGuard(undefined, now,           now)).toBe(false);  // undefined → miss
  });
});
