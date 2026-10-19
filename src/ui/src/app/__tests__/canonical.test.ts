import { describe, test, expect } from 'vitest';
import { stableStringify, sha256Hex, recordHash, computeCatalogHash } from '../../../../shared/canonical.mjs';

describe('stableStringify', () => {
  test('sorts object keys by code point', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test('sorts nested object keys recursively', () => {
    expect(stableStringify({ z: { b: 1, a: 2 }, a: 3 }))
      .toBe('{"a":3,"z":{"a":2,"b":1}}');
  });

  test('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  test('omits undefined properties', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  test('null is kept', () => {
    expect(stableStringify({ a: null })).toBe('{"a":null}');
  });

  test('throws on NaN', () => {
    expect(() => stableStringify(NaN)).toThrow(/non-finite/);
  });

  test('throws on Infinity', () => {
    expect(() => stableStringify(Infinity)).toThrow(/non-finite/);
  });

  test('handles primitives at root', () => {
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify(null)).toBe('null');
  });

  test('produces identical output for equivalent objects', () => {
    const a = stableStringify({ x: 1, y: 2 });
    const b = stableStringify({ y: 2, x: 1 });
    expect(a).toBe(b);
  });
});

describe('sha256Hex', () => {
  test('known vector: empty string', async () => {
    // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const result = await sha256Hex('');
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('produces 64-char hex string', async () => {
    const result = await sha256Hex('hello world');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  test('different strings produce different hashes', async () => {
    const h1 = await sha256Hex('abc');
    const h2 = await sha256Hex('abd');
    expect(h1).not.toBe(h2);
  });
});

describe('recordHash', () => {
  test('two equivalent objects produce the same hash', async () => {
    const h1 = await recordHash({ b: 2, a: 1 });
    const h2 = await recordHash({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });
});

describe('computeCatalogHash', () => {
  test('sorts rows by retailer then product_id', async () => {
    const rows = [
      { retailer: 'NAIVAS', product_id: 'n1', record_hash: 'hh1' },
      { retailer: 'CARREFOUR', product_id: 'c2', record_hash: 'hh2' },
      { retailer: 'CARREFOUR', product_id: 'c1', record_hash: 'hh3' },
    ];
    // Expected: CARREFOUR|c1|hh3\n CARREFOUR|c2|hh2\n NAIVAS|n1|hh1\n
    const expected = await sha256Hex('CARREFOUR|c1|hh3\nCARREFOUR|c2|hh2\nNAIVAS|n1|hh1\n');
    const actual = await computeCatalogHash(rows);
    expect(actual).toBe(expected);
  });

  test('same rows in different order produce same hash', async () => {
    const rows1 = [
      { retailer: 'NAIVAS', product_id: 'n1', record_hash: 'abc' },
      { retailer: 'CARREFOUR', product_id: 'c1', record_hash: 'def' },
    ];
    const rows2 = [...rows1].reverse();
    const h1 = await computeCatalogHash(rows1);
    const h2 = await computeCatalogHash(rows2);
    expect(h1).toBe(h2);
  });
});
