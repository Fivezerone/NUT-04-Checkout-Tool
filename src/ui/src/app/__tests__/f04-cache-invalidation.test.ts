/**
 * F-04 regression test: score cache must invalidate on catalog version change.
 *
 * Finding F-04: getCachedProduct compared cached.datasetVersion against
 * dataset_metadata[retailer].datasetVersion. DB upgrades v13/v14/v15 clear
 * dataset_metadata, so both sides fall back to the literal "v2.0.0" and
 * always match — meaning corrected grades could be served stale for 7 days.
 *
 * Fix: cache entries now carry catalogVersion (the manifest version string).
 * A mismatch is a miss. This test verifies:
 *   1. A cache hit is returned when catalogVersion matches.
 *   2. A cache miss is returned when the catalog version changes.
 *   3. A cache miss is returned when catalogVersion is absent (legacy entry).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Minimal mocks for the IDB layer
// ---------------------------------------------------------------------------
const mockDb = {
  get: vi.fn(),
  put: vi.fn(),
};

vi.mock("../lib/db/shared", () => ({
  getDB: vi.fn(() => Promise.resolve(mockDb)),
  SCORING_VERSION: "v4",
}));

// We import the actual module under test so we exercise the real logic.
// getCatalogMeta is also from settings.ts — we'll control it via the mockDb.
import { getCachedProduct } from "../lib/db/settings";
import { getCatalogMeta } from "../lib/db/settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SCORING_VERSION = "v4";
const V1 = "2026.09.28-1200";
const V2 = "2026.10.01-0900";

function makeEntry(catalogVersion: string | undefined): Record<string, unknown> {
  return {
    scoringVersion: SCORING_VERSION,
    catalogVersion,
    datasetVersion: catalogVersion ?? "v2.0.0",
    grade: "B",
    retailer: "NAIVAS",
    cachedAt: Date.now(),
  };
}

function makeCatalogMeta(version: string) {
  return { retailer: "_catalog", version, maxSeq: 100, cursor: 100 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("F-04 regression: cache invalidation on catalogVersion change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a cache hit when catalogVersion matches the live manifest version", async () => {
    const entry = makeEntry(V1);
    // db.get("product_cache", id) → entry; db.get("dataset_metadata", "_catalog") → meta
    mockDb.get.mockImplementation((_store: string, key: string) => {
      if (key === "test-product") return Promise.resolve(entry);
      if (key === "_catalog") return Promise.resolve(makeCatalogMeta(V1));
      return Promise.resolve(null);
    });

    const result = await getCachedProduct("test-product");
    expect(result).not.toBeNull();
    expect(result.grade).toBe("B");
  });

  it("returns null (cache miss) when the catalog version changes — F-04 core case", async () => {
    // Entry was cached against V1; live catalog is now V2.
    const entry = makeEntry(V1);
    mockDb.get.mockImplementation((_store: string, key: string) => {
      if (key === "test-product") return Promise.resolve(entry);
      if (key === "_catalog") return Promise.resolve(makeCatalogMeta(V2));
      return Promise.resolve(null);
    });

    const result = await getCachedProduct("test-product");
    expect(result).toBeNull(); // must be a miss so the fresh catalog is used
  });

  it("returns null when the cached entry has no catalogVersion (legacy entry)", async () => {
    const entry = makeEntry(undefined); // old entry written before the F-04 fix
    mockDb.get.mockImplementation((_store: string, key: string) => {
      if (key === "test-product") return Promise.resolve(entry);
      if (key === "_catalog") return Promise.resolve(makeCatalogMeta(V1));
      return Promise.resolve(null);
    });

    const result = await getCachedProduct("test-product");
    expect(result).toBeNull();
  });

  it("returns null when no catalog meta exists yet (fresh install, catalog not yet synced)", async () => {
    const entry = makeEntry(V1);
    mockDb.get.mockImplementation((_store: string, key: string) => {
      if (key === "test-product") return Promise.resolve(entry);
      if (key === "_catalog") return Promise.resolve(null); // not yet synced
      return Promise.resolve(null);
    });

    const result = await getCachedProduct("test-product");
    expect(result).toBeNull();
  });
});
