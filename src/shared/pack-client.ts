/**
 * pack-client.ts — fetch catalog shards from an untrusted CDN and verify them against the signed manifest.
 *
 * Why this is safe: the existing release manifest is already ES256-signed and carries content hashes
 * (catalog-sync.js: verifyManifest + catalog_hash). Integrity therefore does not depend on WHO serves
 * the bytes — only on matching the hash the signed manifest names. The CDN can be dumb and cache forever.
 */

export interface ShardRef {
  retailer: string
  shard: number
  sha256: string
  bytes: number
  url: string
}

export interface PackManifest {
  version: string
  shardBits: number
  shards: ShardRef[]
  maxSeq: number
}

/** Stable, synchronous 32-bit FNV-1a. The pack builder MUST use the identical function. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export const shardOf = (retailer: string, productId: string, shardBits: number): number =>
  fnv1a32(`${retailer}|${productId}`) >>> (32 - shardBits)

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function fetchShard(ref: ShardRef, signal?: AbortSignal): Promise<unknown[]> {
  // The URL is content-addressed (.../{shard}.{sha256}.ndjson.gz), so it is immutable: browsers and CDNs may cache it forever.
  const res = await fetch(ref.url, { signal, cache: 'force-cache' })
  if (!res.ok) throw new Error(`shard ${ref.retailer}/${ref.shard}: HTTP ${res.status}`)

  const compressed = await res.arrayBuffer()
  if (compressed.byteLength !== ref.bytes) throw new Error('shard size mismatch')
  if (hex(await crypto.subtle.digest('SHA-256', compressed)) !== ref.sha256) {
    throw new Error('shard hash mismatch (corrupt or tampered)')
  }

  // Decompress gzip payload via standard Web Streams DecompressionStream
  const text = await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown)
}

/** Resolve one product on demand: hot path = IDB hit; cold path = one shard fetch (~1/4096th of the catalog). */
export async function ensureProductLocal(
  m: PackManifest,
  retailer: string,
  productId: string,
  has: (r: string, id: string) => Promise<boolean>,
  commit: (rows: unknown[]) => Promise<void>,
): Promise<void> {
  if (await has(retailer, productId)) return
  const shard = shardOf(retailer, productId, m.shardBits)
  const ref = m.shards.find((s) => s.retailer === retailer && s.shard === shard)
  if (!ref) return // product genuinely not in catalog -> negative-cache upstream
  await commit(await fetchShard(ref))
}
