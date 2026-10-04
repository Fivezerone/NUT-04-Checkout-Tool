/**
 * src/shared/canonical.mjs
 *
 * Canonical serialization, hashing, and catalog-hash utilities.
 * Importable by: Node (ESM), esbuild, Vitest, and the publish pipeline.
 *
 * Rules:
 *  - Object keys sorted by Unicode code point, recursively.
 *  - Arrays preserved in order.
 *  - undefined properties omitted.
 *  - No whitespace in output.
 *  - Throws on NaN or Infinity (they have no JSON representation).
 */

/**
 * Deterministic JSON serialisation.
 * @param {*} value
 * @returns {string} UTF-8 safe JSON with sorted keys
 */
export function stableStringify(value) {
  if (value === null) return 'null';
  if (value === undefined) return undefined; // caller must filter

  const t = typeof value;

  if (t === 'boolean' || t === 'string') return JSON.stringify(value);

  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`stableStringify: non-finite number ${value} cannot be serialised`);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(v => {
      const s = stableStringify(v);
      return s === undefined ? 'null' : s;
    });
    return '[' + items.join(',') + ']';
  }

  if (t === 'object') {
    const keys = Object.keys(value).sort(); // Unicode code-point order
    const parts = [];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(value, k) && value[k] !== undefined) {
        const v = stableStringify(value[k]);
        if (v !== undefined) {
          parts.push(JSON.stringify(k) + ':' + v);
        }
      }
    }
    return '{' + parts.join(',') + '}';
  }

  // functions, symbols → omit (same as JSON.stringify behaviour)
  return undefined;
}

/**
 * SHA-256 hex digest of a UTF-8 string.
 * Uses globalThis.crypto.subtle (available in Node ≥ 19, browsers, Deno).
 * @param {string} str
 * @returns {Promise<string>} hex string
 */
export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Stable SHA-256 hash of an arbitrary object.
 * @param {*} obj
 * @returns {Promise<string>} hex string
 */
export async function recordHash(obj) {
  return sha256Hex(stableStringify(obj));
}

/**
 * Compute the catalog_hash over a set of {retailer, product_id, record_hash} entries.
 * Line format: "{retailer}|{product_id}|{record_hash}\n"
 * Rows sorted by (retailer, product_id) using plain string comparison.
 *
 * @param {Array<{retailer:string, product_id:string, record_hash:string}>} rows
 * @returns {Promise<string>} hex string
 */
export async function computeCatalogHash(rows) {
  const sorted = [...rows].sort((a, b) => {
    const r = a.retailer.localeCompare(b.retailer, 'en', { sensitivity: 'variant' });
    if (r !== 0) return r;
    return a.product_id.localeCompare(b.product_id, 'en', { sensitivity: 'variant' });
  });
  const lines = sorted.map(r => `${r.retailer}|${r.product_id}|${r.record_hash}\n`).join('');
  return sha256Hex(lines);
}
