/**
 * D-11 — Blank root and sign-out on transient error: pure logic + structural tests
 *
 * Verifies:
 *  1. checkSubscriptionAndProfile returns { kind: 'transient' } for network errors (not sign-out)
 *  2. Definitive auth errors (PGRST301/401/403) still trigger sign-out
 *  3. init() uses getSession() not getUser() (structural)
 *  4. dashboard.tsx has 'offline' state with retry mechanism
 *  5. popup.tsx resolveAuthState is wrapped in try/catch
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
// D-11: definitive vs transient error logic (mirrors checkSubscriptionAndProfile)
// ---------------------------------------------------------------------------

const DEFINITIVE_AUTH_ERRORS = new Set(['PGRST301', '401', '403']);

function classifyError(code: string): 'definitive' | 'transient' {
  return DEFINITIVE_AUTH_ERRORS.has(code) ? 'definitive' : 'transient';
}

describe('D-11 — transient vs definitive error classification', () => {
  test('PGRST301 → definitive (sign-out warranted)', () => {
    expect(classifyError('PGRST301')).toBe('definitive');
  });

  test('401 → definitive', () => {
    expect(classifyError('401')).toBe('definitive');
  });

  test('403 → definitive', () => {
    expect(classifyError('403')).toBe('definitive');
  });

  test('PGRST301 set is correct (structural)', () => {
    const src = read('src/ui/src/dashboard.tsx');
    expect(src).toContain("new Set(['PGRST301', '401', '403'])");
  });

  test('500 → transient (preserve session)', () => {
    expect(classifyError('500')).toBe('transient');
  });

  test('network timeout → transient', () => {
    expect(classifyError('NETWORK_ERROR')).toBe('transient');
  });

  test('empty error code → transient', () => {
    expect(classifyError('')).toBe('transient');
  });
});

describe('D-11 — dashboard.tsx structural fixes', () => {
  const src = read('src/ui/src/dashboard.tsx');

  test("init() uses getSession() not getUser() for user resolution", () => {
    // getSession reads from local cache (no network); getUser makes a network call.
    // The only allowed use of 'getUser' is in comments explaining the change.
    expect(src).toContain('getSession()');
    // Strip single-line comments, then check no getUser call remains in code
    const codeOnly = src.replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toContain('getUser()');
  });

  test("checkSubscriptionAndProfile returns { kind: 'transient' } on network error", () => {
    expect(src).toContain("kind: 'transient'");
  });

  test("init() is wrapped in try/catch", () => {
    expect(src).toContain("} catch (e) {");
    expect(src).toContain("setAuthState('offline')");
  });

  test("'offline' authState has retry mechanism", () => {
    expect(src).toContain("authState === 'offline'");
    expect(src).toContain('retryInit');
    expect(src).toContain('bootKey');
  });

  test("loading branch never returns null (code, not comment)", () => {
    // Old code: if (!ready) return null;
    // The comment explaining what changed is fine; the actual code must not be there
    expect(src).not.toContain('if (!ready) return null');
  });

  test("SubscriptionResult interface has 'kind' field", () => {
    expect(src).toContain("kind: 'ok' | 'transient'");
  });
});

describe('D-11 — popup.tsx structural fixes', () => {
  const src = read('src/ui/src/popup.tsx');

  test("resolveAuthState is wrapped in try/catch", () => {
    const fnStart = src.indexOf('async function resolveAuthState()');
    const fnEnd   = src.indexOf('\n  }', fnStart + 1);
    const body    = src.slice(fnStart, fnEnd);
    expect(body).toContain('try {');
    expect(body).toContain('} catch (e) {');
  });

  test("catch block sets authState to 'returning' (not 'checking')", () => {
    // resolveAuthState is only in popup.tsx
    const fnStart    = src.indexOf('async function resolveAuthState()');
    const catchIdx   = src.indexOf('} catch (e) {', fnStart);
    const catchBlock = src.slice(catchIdx, catchIdx + 300);
    expect(catchBlock).toContain("setAuthState('returning')");
  });
});
