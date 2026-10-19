/**
 * D-06 — Token wipe on transient failure: pure logic tests
 * D-07 — Clock guard permanent lockout: pure logic tests
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..', '..', '..', '..', '..');
const entitlementSrc = readFileSync(join(REPO_ROOT, 'src', 'extension', 'entitlement.js'), 'utf8');

// ---------------------------------------------------------------------------
// D-06 pure logic: definitive vs transient failure discrimination
// ---------------------------------------------------------------------------

const DEFINITIVE_RE = /refresh_token_not_found|invalid_grant|session_not_found/i;

function isDefinitiveError(code: string, message: string): boolean {
  return DEFINITIVE_RE.test(code || message || '');
}

function shouldClear(error: { code?: string; message?: string } | null): boolean {
  if (!error) return true;   // no error and no session → definitive sign-out
  return isDefinitiveError(error.code ?? '', error.message ?? '');
}

describe('D-06 — token wipe discrimination', () => {
  test('no error + no session → clear (definitive sign-out)', () => {
    expect(shouldClear(null)).toBe(true);
  });

  test('refresh_token_not_found → clear (definitive)', () => {
    expect(shouldClear({ code: 'refresh_token_not_found' })).toBe(true);
  });

  test('invalid_grant → clear (definitive)', () => {
    expect(shouldClear({ message: 'invalid_grant' })).toBe(true);
  });

  test('session_not_found → clear (definitive)', () => {
    expect(shouldClear({ code: 'session_not_found' })).toBe(true);
  });

  test('network error (no code, no matching message) → do NOT clear', () => {
    expect(shouldClear({ message: 'Failed to fetch' })).toBe(false);
  });

  test('503 error body → do NOT clear', () => {
    expect(shouldClear({ message: 'Service Unavailable' })).toBe(false);
  });

  test('non-ok HTTP response returns unchanged (structural check)', () => {
    // Verify the fix is in the source
    expect(entitlementSrc).toContain("if (!res.ok) return 'unchanged'");
  });

  test('fetch has AbortSignal.timeout (structural check)', () => {
    expect(entitlementSrc).toContain('AbortSignal.timeout(5000)');
  });

  test('catch block returns unchanged (not basic)', () => {
    expect(entitlementSrc).toContain("return 'unchanged'");
    // Old code returned "basic" in catch — check the bad string is gone
    const catchIdx = entitlementSrc.lastIndexOf('catch (e)');
    const catchBlock = entitlementSrc.slice(catchIdx, catchIdx + 200);
    expect(catchBlock).not.toContain("return 'basic'");
    expect(catchBlock).not.toContain('return "basic"');
  });
});

// ---------------------------------------------------------------------------
// D-07 pure logic: clock guard self-healing
// ---------------------------------------------------------------------------

const CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function updateTimeGuardLogic(storedMax: number, now: number, serverNow: number | null): number {
  let maxLocalSeen = Math.max(storedMax, now);
  if (serverNow) maxLocalSeen = Math.min(maxLocalSeen, serverNow + CLOCK_SKEW_MS);
  return maxLocalSeen;
}

function isClockRolledBack(maxLocalSeen: number, now: number): boolean {
  return now < maxLocalSeen - CLOCK_SKEW_MS;
}

describe('D-07 — clock guard self-healing', () => {
  test('without serverNow, maxLocalSeen can only grow (existing behaviour)', () => {
    const now = 1_700_000_000_000;
    const result = updateTimeGuardLogic(now + 10_000, now, null);
    expect(result).toBe(now + 10_000); // stored max wins
  });

  test('serverNow caps maxLocalSeen → clock self-heals', () => {
    const realNow    = 1_700_000_000_000;
    const storedMax  = realNow + 20 * 60 * 1000; // clock was once 20 min fast
    const serverNow  = realNow;                    // server says real time

    const result = updateTimeGuardLogic(storedMax, realNow, serverNow);
    // Cap = serverNow + CLOCK_SKEW_MS = realNow + 5 min
    const expectedCap = serverNow + CLOCK_SKEW_MS;
    expect(result).toBe(expectedCap);

    // After healing, isClockRolledBack should return false
    expect(isClockRolledBack(result, realNow)).toBe(false);
  });

  test('without D-07 fix, a 20-min-fast clock would permanently lock out', () => {
    const realNow   = 1_700_000_000_000;
    const storedMax = realNow + 20 * 60 * 1000; // 20 min fast
    // Without fix: maxLocalSeen stays at storedMax, no server cap
    const unfixedMax = Math.max(storedMax, realNow);
    expect(isClockRolledBack(unfixedMax, realNow)).toBe(true); // locked out!
  });

  test('D-07 structural: source contains serverNow + CLOCK_SKEW_MS cap', () => {
    expect(entitlementSrc).toContain('Math.min(maxLocalSeen, serverNow + CLOCK_SKEW_MS)');
  });
});
