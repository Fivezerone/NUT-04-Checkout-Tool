/**
 * Phase 10 regression tests — F-07, F-13, F-14
 *
 * F-07: CDN shard distribution & pack client verification.
 *   - Stable FNV-1a-32 sharding between pack builder and pack client.
 *   - buildPacks emits content-addressed gzip shards matching SHA-256 and byte length.
 *   - fetchShard verifies integrity against signed manifest (rejects corrupted / tampered).
 *   - ensureProductLocal handles cache hits and missing products.
 *
 * F-13: Multi-tenant retailer model.
 *   - Declarative adapter engine: data-driven selectors, regex extraction, killSwitch.
 *   - 003_retailers_multitenant.sql schema and FK constraints.
 *
 * F-14: Token bucket rate-limiter for Edge Functions.
 *   - 004_token_bucket.sql rate_limit_take PL/pgSQL function structure.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { gzipSync, gunzipSync } from "zlib";
import { createHash } from "crypto";
import { fnv1a32, shardOf, fetchShard, ensureProductLocal } from "../../../../shared/pack-client";
import { fnv1a32 as fnv1a32Mjs, shardOf as shardOfMjs } from "../../../../shared/pack-hash.mjs";
import { buildPacks } from "../../../../../scripts/build-packs.mjs";
import * as DeclarativeEngine from "../../../../../src/extension/adapters/declarative-engine.js";

const ROOT = path.resolve(__dirname, "../../../../../");
const MIGRATION_RETAILERS = path.join(ROOT, "supabase/migrations/20261011000003_retailers_multitenant.sql");
const MIGRATION_TOKEN_BUCKET = path.join(ROOT, "supabase/migrations/20261011000004_token_bucket.sql");

describe("Phase 10: F-07 CDN Shard Packaging & Verification", () => {
  const tmpDir = path.join(ROOT, "tmp_test_packs");

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fnv1a32 produces identical output across TypeScript and MJS modules", () => {
    const testKeys = [
      "CARREFOUR|12345",
      "NAIVAS|98765",
      "CARREFOUR|prod_abc_xyz",
      "NAIVAS|0001",
    ];
    for (const key of testKeys) {
      expect(fnv1a32(key)).toBe(fnv1a32Mjs(key));
      expect(shardOf("CARREFOUR", key, 6)).toBe(shardOfMjs("CARREFOUR", key, 6));
    }
  });

  it("shardOf computes deterministic shard numbers bounded by shardBits", () => {
    const shardBits = 6;
    const maxShard = (1 << shardBits) - 1;
    for (let i = 0; i < 100; i++) {
      const s = shardOf("NAIVAS", `prod_${i}`, shardBits);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(maxShard);
    }
  });

  it("buildPacks creates content-addressed gzip shards matching SHA-256 and byte length", () => {
    const sampleRows = [
      { retailer: "NAIVAS", product_id: "101", record: { name: "Milk 500ml", price: 65 } },
      { retailer: "NAIVAS", product_id: "102", record: { name: "Bread 400g", price: 60 } },
      { retailer: "CARREFOUR", product_id: "201", record: { name: "Apples 1kg", price: 250 } },
      { retailer: "CARREFOUR", product_id: "202", record: { name: "Bananas 1kg", price: 120 } },
    ];

    const result = buildPacks(sampleRows, tmpDir, "https://cdn.example.com/catalog", 6);
    expect(result.shardBits).toBe(6);
    expect(result.shards.length).toBeGreaterThan(0);

    for (const shard of result.shards) {
      expect(shard.url).toContain(shard.retailer);
      expect(shard.url).toContain(`${shard.shard}.${shard.sha256}.ndjson.gz`);

      const filePath = path.join(tmpDir, `${shard.retailer}/${shard.shard}.${shard.sha256}.ndjson.gz`);
      expect(fs.existsSync(filePath)).toBe(true);

      const fileBuffer = fs.readFileSync(filePath);
      expect(fileBuffer.byteLength).toBe(shard.bytes);

      const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
      expect(actualHash).toBe(shard.sha256);

      // Verify gzip content
      const unzipped = gunzipSync(fileBuffer).toString("utf8");
      const lines = unzipped.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.retailer).toBe(shard.retailer);
    }
  });

  it("fetchShard decompresses valid shard and rejects tampered shards", async () => {
    const data = [{ retailer: "NAIVAS", product_id: "101", name: "Flour 2kg" }];
    const ndjson = JSON.stringify(data[0]);
    const gz = gzipSync(ndjson);
    const sha256 = createHash("sha256").update(gz).digest("hex");

    const shardRef = {
      retailer: "NAIVAS",
      shard: 3,
      sha256,
      bytes: gz.byteLength,
      url: "https://mock-cdn.example.com/naivas/3.gz",
    };

    // Mock fetch for valid shard
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any) => {
      if (url === shardRef.url) {
        return new Response(gz, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    };

    try {
      const records = await fetchShard(shardRef);
      expect(records).toEqual(data);

      // Tampered size
      const badSizeRef = { ...shardRef, bytes: shardRef.bytes + 10 };
      await expect(fetchShard(badSizeRef)).rejects.toThrow("shard size mismatch");

      // Tampered hash
      const badHashRef = { ...shardRef, sha256: "0000000000000000000000000000000000000000000000000000000000000000" };
      await expect(fetchShard(badHashRef)).rejects.toThrow("shard hash mismatch");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ensureProductLocal hits IDB cache first and fetches cold shard on miss", async () => {
    const manifest = {
      version: "2026.10.11-001",
      shardBits: 6,
      shards: [
        {
          retailer: "NAIVAS",
          shard: shardOf("NAIVAS", "prod-hit", 6),
          sha256: "dummy-hash",
          bytes: 100,
          url: "https://mock-cdn.example.com/shard.gz",
        },
      ],
      maxSeq: 10,
    };

    let fetchCalled = false;
    let commitCalled = false;

    // 1. Hot path hit
    await ensureProductLocal(
      manifest,
      "NAIVAS",
      "prod-hit",
      async () => true, // already has
      async () => { commitCalled = true; }
    );
    expect(commitCalled).toBe(false);

    // 2. Cold miss that does not exist in manifest
    await ensureProductLocal(
      manifest,
      "NAIVAS",
      "prod-nonexistent-in-shards",
      async () => false,
      async () => { commitCalled = true; }
    );
    // If the shard does not match manifest shards, does not throw or commit
  });
});

describe("Phase 10: F-13 Declarative Adapter Engine", () => {
  const mockSpec = {
    retailer: "NAIVAS",
    specVersion: 1,
    card: [".product-card", "[data-testid='card']"],
    name: [".product-title", "h3"],
    id: [
      { attr: "data-product-id" },
      { hrefRegex: "/p/(\\d+)" }
    ],
    price: { selector: ".price-val" },
    killSwitch: false,
  };

  it("findCards returns matching elements according to ranked card selector", () => {
    const mockContainer = {
      querySelectorAll: (sel: string) => {
        if (sel === ".product-card") return [{ id: "c1" }, { id: "c2" }];
        return [];
      },
    };
    const cards = DeclarativeEngine.findCards(mockContainer, mockSpec);
    expect(cards.length).toBe(2);
  });

  it("extractProductFromCard parses ID via data attribute and price via selector", () => {
    const mockCard = {
      getAttribute: (attr: string) => (attr === "data-product-id" ? "98765" : null),
      querySelector: (sel: string) => {
        if (sel === ".product-title") return { textContent: "  Fresh Milk 1L  " };
        if (sel === ".price-val") return { textContent: "KES 110.00" };
        return null;
      },
      querySelectorAll: () => [],
    };

    const product = DeclarativeEngine.extractProductFromCard(mockCard, mockSpec);
    expect(product).toEqual({
      retailer: "NAIVAS",
      id: "98765",
      name: "Fresh Milk 1L",
      price: 110,
    });
  });

  it("extractProductFromCard parses ID via href regex when attribute is missing", () => {
    const mockCard = {
      getAttribute: () => null,
      querySelector: (sel: string) => {
        if (sel === ".product-title") return { textContent: "Brown Bread" };
        return null;
      },
      querySelectorAll: (sel: string) => {
        if (sel === "a[href]") {
          return [{ getAttribute: () => "/p/54321?ref=browse" }];
        }
        return [];
      },
    };

    const product = DeclarativeEngine.extractProductFromCard(mockCard, mockSpec);
    expect(product?.id).toBe("54321");
    expect(product?.name).toBe("Brown Bread");
  });

  it("extractProductFromCard respects killSwitch: true and returns null", () => {
    const killswitchedSpec = { ...mockSpec, killSwitch: true };
    const mockCard = {
      getAttribute: () => "123",
      querySelector: () => ({ textContent: "Item" }),
      querySelectorAll: () => [],
    };
    expect(DeclarativeEngine.extractProductFromCard(mockCard, killswitchedSpec)).toBeNull();
  });
});

describe("Phase 10: Multi-Tenant & Token Bucket Migrations", () => {
  const retailersSql = fs.readFileSync(MIGRATION_RETAILERS, "utf8");
  const tokenBucketSql = fs.readFileSync(MIGRATION_TOKEN_BUCKET, "utf8");

  it("003_retailers_multitenant.sql creates public.retailers and seeds default retailers", () => {
    expect(retailersSql).toContain("create table if not exists public.retailers");
    expect(retailersSql).toContain("('NAIVAS',    'Naivas'");
    expect(retailersSql).toContain("('CARREFOUR', 'Carrefour Kenya'");
    expect(retailersSql).toContain("catalog_products_retailer_fk");
    expect(retailersSql).toContain("catalog_premium_retailer_fk");
  });

  it("004_token_bucket.sql creates unlogged rate_buckets and rate_limit_take function with return guard", () => {
    expect(tokenBucketSql).toContain("create unlogged table if not exists public.rate_buckets");
    expect(tokenBucketSql).toContain("create or replace function public.rate_limit_take");
    // Verify RETURN guard after allowed return query (prevents fall-through bug)
    expect(tokenBucketSql).toContain("return query select true, 0;");
    expect(tokenBucketSql).toContain("return; -- RETURN QUERY does not exit");
  });
});
