/**
 * scripts/build-packs.mjs — runs in CI right after catalog_upsert() and BEFORE signing the manifest.
 * Emits content-addressed, gzip-compressed NDJSON shards + a manifest body the existing signer already knows how to sign.
 */
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fnv1a32 } from '../src/shared/pack-hash.mjs'

export function buildPacks(rows, outDir, cdnBase, shardBits = 6) {
  const buckets = new Map() // "RETAILER|shard" -> NDJSON lines
  for (const r of rows) {
    const shard = fnv1a32(`${r.retailer}|${r.product_id}`) >>> (32 - shardBits)
    const k = `${r.retailer}|${shard}`
    if (!buckets.has(k)) {
      buckets.set(k, [])
    }
    buckets
      .get(k)
      .push(JSON.stringify({ retailer: r.retailer, product_id: r.product_id, ...(r.record || {}) }))
  }

  const shards = []
  for (const [k, lines] of [...buckets.entries()].sort()) {
    const [retailer, shardStr] = k.split('|')
    const gz = gzipSync(lines.join('\n'), { level: 9 })
    const sha256 = createHash('sha256').update(gz).digest('hex')
    const name = `${retailer}/${shardStr}.${sha256}.ndjson.gz`
    mkdirSync(`${outDir}/${retailer}`, { recursive: true })
    writeFileSync(`${outDir}/${name}`, gz)
    shards.push({
      retailer,
      shard: Number(shardStr),
      sha256,
      bytes: gz.byteLength,
      url: `${cdnBase}/${name}`,
    })
  }
  return { shardBits, shards }
}
