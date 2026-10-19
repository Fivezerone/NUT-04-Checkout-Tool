/**
 * Stable, synchronous 32-bit FNV-1a hash and shard calculation.
 * Shared between CI pack builder and browser pack client.
 */
export function fnv1a32(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export const shardOf = (retailer, productId, shardBits) =>
  fnv1a32(`${retailer}|${productId}`) >>> (32 - shardBits)
