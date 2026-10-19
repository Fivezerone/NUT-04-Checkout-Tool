import { describe, test, expect, vi } from 'vitest';
import { resolveProductMatch } from '../lib/db';

vi.mock('idb', () => ({
  openDB: async () => ({
    transaction: () => ({
      store: {
        get: async () => null,
        getAll: async () => [
          { Identity: { RetailerProductUrl: 'https://example.com/p/12345' } },
          { Identity: { RetailerProductUrl: 'https://example.com/p/67890?a=b' } },
        ],
        index: () => ({ get: async () => null })
      }
    })
  })
}));

describe('SEC-005: ReDoS protection', () => {
  test('retailerProductId with malicious regex pattern returns promptly', async () => {
    const maliciousInput = '(a+)+$';
    
    const startTime = performance.now();
    await resolveProductMatch('CARREFOUR', maliciousInput, null, null);
    const endTime = performance.now();
    
    expect(endTime - startTime).toBeLessThan(50);
  });
});
