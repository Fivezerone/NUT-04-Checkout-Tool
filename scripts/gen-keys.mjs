#!/usr/bin/env node
/**
 * scripts/gen-keys.mjs
 *
 * Generates two ES256 (ECDSA P-256) key pairs:
 *  - catalog:     signs catalog release manifests (private key → CATALOG_SIGNING_KEY env / CI secret)
 *  - entitlement: signs entitlement tokens (private key → ENTITLEMENT_SIGNING_KEY Supabase secret)
 *
 * USAGE:
 *   node scripts/gen-keys.mjs
 *
 * OUTPUT:
 *   - Prints private JWKs to STDOUT only (NEVER written to disk).
 *   - Writes public JWKs to config/public-keys/catalog.jwks.json
 *                          config/public-keys/entitlement.jwks.json
 *
 * The build pipeline will fail if either public-key file is missing.
 */

import { webcrypto } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const KEYS_DIR = join(ROOT, 'config', 'public-keys');

async function generateKeyPair(kid) {
  const { privateKey, publicKey } = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,  // extractable
    ['sign', 'verify']
  );
  const privateJwk = await subtle.exportKey('jwk', privateKey);
  const publicJwk  = await subtle.exportKey('jwk', publicKey);

  privateJwk.kid = kid;
  publicJwk.kid  = kid;

  return { privateJwk, publicJwk };
}

mkdirSync(KEYS_DIR, { recursive: true });

const catalog     = await generateKeyPair('catalog-v1');
const entitlement = await generateKeyPair('entitlement-v1');

// Write public keys to disk
writeFileSync(
  join(KEYS_DIR, 'catalog.jwks.json'),
  JSON.stringify({ keys: [catalog.publicJwk] }, null, 2)
);
writeFileSync(
  join(KEYS_DIR, 'entitlement.jwks.json'),
  JSON.stringify({ keys: [entitlement.publicJwk] }, null, 2)
);

console.error('✓ Public keys written to config/public-keys/');
console.error('  catalog.jwks.json      → embed in extension config (CATALOG_PUBLIC_KEYS)');
console.error('  entitlement.jwks.json  → embed in extension config (ENTITLEMENT_PUBLIC_KEYS)');
console.error('');
console.error('Private keys (printed to stdout — pipe to a password manager, do NOT save to disk):');
console.error('  CATALOG_SIGNING_KEY    → GitHub Actions secret (publish-catalog workflow)');
console.error('  ENTITLEMENT_SIGNING_KEY→ Supabase secret (entitlement edge function)');
console.error('');

// Private keys go ONLY to stdout
console.log(JSON.stringify({
  CATALOG_SIGNING_KEY:     catalog.privateJwk,
  ENTITLEMENT_SIGNING_KEY: entitlement.privateJwk,
}, null, 2));
