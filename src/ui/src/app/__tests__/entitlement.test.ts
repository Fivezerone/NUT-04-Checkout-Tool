/**
 * P3 entitlement verifier tests.
 *
 * Tests that verifyToken() accepts valid ES256 tokens and rejects:
 *  - alg:none
 *  - alg:HS256
 *  - unknown kid
 *  - wrong sub
 *  - expired exp
 *  - tampered payload
 */
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';

// ── Helpers to create test tokens ──────────────────────────────────────────
async function generateKeyPair() {
  const { privateKey, publicKey } = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  );
  const publicJwk = await webcrypto.subtle.exportKey('jwk', publicKey);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', privateKey);
  return { privateKey, publicKey, publicJwk, privateJwk };
}

function base64url(buf: ArrayBuffer | Uint8Array) {
  return Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodePayload(obj: object) {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function signToken(header: object, payload: object, privateKey: CryptoKey) {
  const h = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const p = encodePayload(payload);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
  return `${h}.${p}.${base64url(sig)}`;
}

// ── Build a minimal NutriEntitlement verifier in Node context ───────────────
// We can't import the browser global directly, so we inline verifyToken logic.
function base64urlDecode(str: string) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - str.length % 4) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function importPublicKeyNode(jwk: object) {
  return webcrypto.subtle.importKey(
    'jwk', jwk as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
  );
}

async function verifyToken(
  token: string,
  expectedSub: string,
  knownKeys: Array<{ kid: string } & Record<string, unknown>>
): Promise<{ valid: boolean; reason?: string; payload?: object }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'malformed' };
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
    if (header.alg !== 'ES256') return { valid: false, reason: 'alg_rejected' };
    const jwk = knownKeys.find(k => k.kid === header.kid);
    if (!jwk) return { valid: false, reason: 'unknown_kid' };
    const publicKey = await importPublicKeyNode(jwk);
    const dataToVerify = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sigBytes = base64urlDecode(sigB64);
    const valid = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicKey, sigBytes, dataToVerify
    );
    if (!valid) return { valid: false, reason: 'bad_signature' };
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
    if (payload.iss !== 'nutriscore-entitlement') return { valid: false, reason: 'wrong_iss' };
    if (payload.sub !== expectedSub) return { valid: false, reason: 'wrong_sub' };
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= nowSeconds) return { valid: false, reason: 'expired' };
    return { valid: true, payload };
  } catch (e: unknown) {
    return { valid: false, reason: `error:${(e as Error).message}` };
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────
let kp: Awaited<ReturnType<typeof generateKeyPair>>;
const USER_ID = 'user-abc-123';
const KID = 'entitlement-v1';
const VALID_HEADER = { alg: 'ES256', kid: KID };
const validPayload = () => ({
  iss: 'nutriscore-entitlement',
  sub: USER_ID,
  tier: 'premium',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
});

beforeAll(async () => {
  kp = await generateKeyPair();
  kp.publicJwk.kid = KID;
});

describe('verifyToken', () => {
  test('accepts a valid ES256 token', async () => {
    const token = await signToken(VALID_HEADER, validPayload(), kp.privateKey);
    const result = await verifyToken(token, USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(true);
    expect((result.payload as any)?.tier).toBe('premium');
  });

  test('rejects alg:none', async () => {
    const header = { alg: 'none', kid: KID };
    const h = base64url(new TextEncoder().encode(JSON.stringify(header)));
    const p = encodePayload(validPayload());
    const token = `${h}.${p}.`;  // no signature
    const result = await verifyToken(token, USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('alg_rejected');
  });

  test('rejects alg:HS256', async () => {
    const header = { alg: 'HS256', kid: KID };
    const h = base64url(new TextEncoder().encode(JSON.stringify(header)));
    const p = encodePayload(validPayload());
    const token = `${h}.${p}.fakesig`;
    const result = await verifyToken(token, USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('alg_rejected');
  });

  test('rejects unknown kid', async () => {
    const token = await signToken({ alg: 'ES256', kid: 'unknown-kid' }, validPayload(), kp.privateKey);
    const result = await verifyToken(token, USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown_kid');
  });

  test('rejects wrong sub', async () => {
    const token = await signToken(VALID_HEADER, { ...validPayload(), sub: 'other-user' }, kp.privateKey);
    const result = await verifyToken(token, USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('wrong_sub');
  });

  test('rejects expired token', async () => {
    const payload = { ...validPayload(), exp: Math.floor(Date.now() / 1000) - 1 };
    const token = await signToken(VALID_HEADER, payload, kp.privateKey);
    const result = await verifyToken(token, USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  test('rejects tampered payload (bad signature)', async () => {
    const token = await signToken(VALID_HEADER, validPayload(), kp.privateKey);
    // Flip one bit in the payload by replacing a character
    const [h, p, s] = token.split('.');
    const tamperedP = p.slice(0, -1) + (p.slice(-1) === 'A' ? 'B' : 'A');
    const result = await verifyToken(`${h}.${tamperedP}.${s}`, USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });

  test('rejects wrong iss', async () => {
    const payload = { ...validPayload(), iss: 'evil-issuer' };
    const token = await signToken(VALID_HEADER, payload, kp.privateKey);
    const result = await verifyToken(token, USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('wrong_iss');
  });

  test('rejects malformed token (wrong part count)', async () => {
    const result = await verifyToken('aaa.bbb', USER_ID, [kp.publicJwk]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('malformed');
  });
});
