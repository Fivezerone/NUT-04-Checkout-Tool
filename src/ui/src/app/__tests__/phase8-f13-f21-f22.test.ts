/**
 * Phase 8 regression tests — F-13, F-21, F-22
 *
 * F-13: Retailers are code, not data.
 *   OLD: Two hard-coded if-branches in applyStaging (isNavias / isCarrefour),
 *        hard-coded property names in cache invalidation (.naivas / .carrefour),
 *        SQL CHECK (retailer IN ('CARREFOUR','NAIVAS')).
 *   NEW: RETAILER_REGISTRY Map drives applyStaging dispatch and cache
 *        invalidation; migration drops the CHECK and replaces with format guard.
 *   Adding a retailer: one entry in RETAILER_REGISTRY + IDB store in db.ts.
 *
 * F-21: Same-day re-publish invisible to clients.
 *   OLD: version = YYYY.MM.DD-001 (constant suffix) → second publish same day
 *        matched meta.version and client treated it as "up to date".
 *   NEW: nextVersion() uses minute-resolution (YYYY.MM.DD-HH:MM) and appends
 *        an integer suffix (.N) on collision, guaranteeing uniqueness.
 *
 * F-22: Publisher fetchAllRows had no ORDER BY.
 *   OLD: .range(from, from+PAGE-1) with no ORDER BY → non-deterministic page
 *        ordering → skipped or duplicated rows → false hash mismatch/pass.
 *   NEW: .order('retailer').order('product_id') before .range().
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const csSrc   = readFileSync(join(ROOT, "src/extension/catalog-sync.js"),  "utf8");
const pubSrc  = readFileSync(join(ROOT, "scripts/publish-catalog.mjs"),    "utf8");
const mig1    = readFileSync(
  join(ROOT, "supabase/migrations/20261011000001_catalog_release_publish_fix.sql"), "utf8"
);
const mig2    = readFileSync(
  join(ROOT, "supabase/migrations/20261011000002_drop_retailer_check_constraint.sql"), "utf8"
);

// ---------------------------------------------------------------------------
// F-13: RETAILER_REGISTRY
// ---------------------------------------------------------------------------
describe("F-13: RETAILER_REGISTRY drives applyStaging dispatch", () => {
  it("RETAILER_REGISTRY constant is defined as a Map", () => {
    expect(csSrc).toContain("RETAILER_REGISTRY = new Map(");
  });

  it("RETAILER_REGISTRY contains NAIVAS and CARREFOUR entries", () => {
    expect(csSrc).toContain("\"NAIVAS\"");
    expect(csSrc).toContain("naivasProducts");
    expect(csSrc).toContain("\"CARREFOUR\"");
    expect(csSrc).toContain("carrefourProducts");
  });

  it("applyStaging chunk dispatch iterates RETAILER_REGISTRY (not hard-coded if-branches)", () => {
    const fnStart = csSrc.indexOf("async function applyStaging");
    const fnBody  = csSrc.slice(fnStart, fnStart + 3800);
    // Must use the registry loop
    expect(fnBody).toContain("RETAILER_REGISTRY.entries()");
    // Must NOT have the old hard-coded isNavias / isCarrefour pattern
    expect(fnBody).not.toContain("isNavias");
    expect(fnBody).not.toContain("isCarrefour");
  });

  it("cache invalidation iterates RETAILER_REGISTRY.values() (not hard-coded keys)", () => {
    const fnStart = csSrc.indexOf("async function applyStaging");
    const fnBody  = csSrc.slice(fnStart, fnStart + 3800);
    expect(fnBody).toContain("RETAILER_REGISTRY.values()");
    // Must NOT use the old literal property invalidation
    expect(fnBody).not.toContain("memCache.naivas");
    expect(fnBody).not.toContain("memCache.carrefour");
  });

  it("migration 002 drops the hard-coded CHECK constraint", () => {
    expect(mig2).toContain("drop constraint if exists catalog_products_retailer_check");
    expect(mig2).toContain("drop constraint if exists catalog_premium_retailer_check");
  });

  it("migration 002 replaces with a format-only guard (not a specific retailer list)", () => {
    expect(mig2).toContain("catalog_products_retailer_fmt");
    expect(mig2).toContain("catalog_premium_retailer_fmt");
    // The new constraints must not re-introduce a hard-coded retailer list.
    // (The migration header comment mentions the old constraint for context — that's fine.)
    // Check that no ADD CONSTRAINT ... CHECK body contains IN ('CARREFOUR' or IN ('NAIVAS'.
    const addConstraintBlocks = mig2
      .split(/add constraint/i)
      .slice(1); // skip text before first 'add constraint'
    for (const block of addConstraintBlocks) {
      const checkBody = block.slice(0, 200);
      expect(checkBody).not.toContain("IN ('CARREFOUR'");
      expect(checkBody).not.toContain("IN ('NAIVAS'");
    }
  });
});

// ---------------------------------------------------------------------------
// F-21: nextVersion — same-day re-publish uniqueness
// ---------------------------------------------------------------------------
describe("F-21: nextVersion() makes same-day re-publish visible to clients", () => {
  it("publish-catalog.mjs defines nextVersion function", () => {
    expect(pubSrc).toContain("function nextVersion(");
  });

  it("nextVersion generates minute-resolution base version (not YYYY.MM.DD-001)", () => {
    // The old pattern was a fixed '-001' suffix; the new one uses HH:MM or similar
    // The key signal is that it no longer hard-codes '-001'
    const fnStart = pubSrc.indexOf("function nextVersion(");
    const fnBody  = pubSrc.slice(fnStart, fnStart + 400);
    // Must not hard-code '-001'
    expect(fnBody).not.toContain("-001");
    // Must use some form of time component (minute/hour)
    expect(fnBody).toMatch(/getUTCHours|getUTCMinutes|HH|:MM/);
  });

  it("nextVersion appends .N on collision (monotonic within same minute)", () => {
    const fnStart = pubSrc.indexOf("function nextVersion(");
    const fnBody  = pubSrc.slice(fnStart, fnStart + 400);
    // The suffix logic increments a counter
    expect(fnBody).toMatch(/\+ 1|slice.*\+ 1|\+= 1/);
  });

  it("manifest.version is set via nextVersion() in COMMIT mode", () => {
    expect(pubSrc).toContain("nextVersion(now");
    expect(pubSrc).toContain("manifest.version = nextVersion");
  });

  it("client checks meta.version !== manifest.version to detect new release", () => {
    expect(csSrc).toContain("meta.version !== manifest.version");
  });
});

// ---------------------------------------------------------------------------
// F-22: fetchAllRows stable pagination ORDER BY
// ---------------------------------------------------------------------------
describe("F-22: fetchAllRows uses ORDER BY for stable pagination", () => {
  it("fetchAllRows function is defined in publish-catalog.mjs", () => {
    expect(pubSrc).toContain("async function fetchAllRows(");
  });

  it("fetchAllRows orders by retailer then product_id before .range()", () => {
    const fnStart = pubSrc.indexOf("async function fetchAllRows(");
    const fnBody  = pubSrc.slice(fnStart, fnStart + 500);
    expect(fnBody).toContain(".order('retailer'");
    expect(fnBody).toContain(".order('product_id'");
    // order must come before range
    const orderIdx = fnBody.indexOf(".order('retailer'");
    const rangeIdx = fnBody.indexOf(".range(");
    expect(orderIdx).toBeGreaterThan(-1);
    expect(rangeIdx).toBeGreaterThan(orderIdx);
  });

  it("fetchAllRows ascending order on both columns", () => {
    const fnStart = pubSrc.indexOf("async function fetchAllRows(");
    const fnBody  = pubSrc.slice(fnStart, fnStart + 500);
    // Supabase default is ascending; the report requires stable order
    expect(fnBody).toContain("ascending: true");
  });
});
