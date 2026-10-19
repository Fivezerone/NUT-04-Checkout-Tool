/**
 * Phase 6 regression tests — F-10, F-11, F-15, F-16
 *
 * F-10: applyStaging chunked cursor (not getAll)
 *   OLD: getAll() on catalog_staging — peak heap = entire delta
 *   NEW: openCursor() in CHUNK_SIZE=200 batches — peak heap ≤ CHUNK_SIZE rows
 *
 * F-11: Supabase client singleton
 *   All three modules (background.js, entitlement.js, catalog-sync.js)
 *   must share a single client injected via init(sb) — no inline NutriSupabase.create()
 *   in any hot path.
 *
 * F-15: Pending-cart WAL — latest-wins keyed by retailer
 *   OLD: id = `pcs-${Date.now()}-${Math.random()}` — append-only, unbounded
 *   NEW: id = retailer — one row per retailer, idempotent put()
 *
 * F-16: Catalog fetch deadlines
 *   pullUpdates wraps every Supabase page fetch with an AbortController (30 s timeout)
 *   so a hung call never blocks the SW indefinitely.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const bgSrc  = readFileSync(join(ROOT, "src/extension/background.js"),   "utf8");
const entSrc = readFileSync(join(ROOT, "src/extension/entitlement.js"),  "utf8");
const csSrc  = readFileSync(join(ROOT, "src/extension/catalog-sync.js"), "utf8");
const cartSrc = readFileSync(join(ROOT, "src/ui/src/app/lib/db/cart.ts"), "utf8");
const dbJsSrc = readFileSync(join(ROOT, "src/extension/db.js"),          "utf8");

// ---------------------------------------------------------------------------
// F-10: chunked applyStaging
// ---------------------------------------------------------------------------
describe("F-10: applyStaging uses chunked cursor instead of getAll()", () => {
  it("defines CHUNK_SIZE constant", () => {
    expect(csSrc).toContain("CHUNK_SIZE");
  });

  it("applyStaging uses openCursor() not getAll() on catalog_staging", () => {
    const fnStart = csSrc.indexOf("async function applyStaging");
    const fnBody  = csSrc.slice(fnStart, fnStart + 2500);
    expect(fnBody).toContain("openCursor()");
    // Must NOT call getAll() on staging inside applyStaging
    // (getAll might appear in other functions — check only within applyStaging)
    const getAllInFn = fnBody.indexOf(".getAll()");
    // getAll should not appear in applyStaging body
    expect(getAllInFn).toBe(-1);
  });

  it("applyStaging flushes hashes and products per chunk (not all-at-once)", () => {
    const fnStart = csSrc.indexOf("async function applyStaging");
    const fnBody  = csSrc.slice(fnStart, fnStart + 2500);
    // The chunk-level hash tx and product tx must be INSIDE the while loop
    const whileIdx = fnBody.indexOf("while (!done)");
    const hashTxIdx = fnBody.indexOf("catalog_hashes", whileIdx);
    expect(whileIdx).toBeGreaterThan(-1);
    expect(hashTxIdx).toBeGreaterThan(whileIdx); // hash write inside loop
  });

  it("applyStaging still clears staging store after all chunks processed", () => {
    const fnStart = csSrc.indexOf("async function applyStaging");
    const fnBody  = csSrc.slice(fnStart, fnStart + 3800); // store.clear() at ~3174 chars in
    expect(fnBody).toContain("catalog_staging");
    expect(fnBody).toContain("store.clear()");
    // clear() must appear after the while loop (outside the chunk block)
    const clearIdx = fnBody.lastIndexOf("store.clear()");
    const whileIdx = fnBody.indexOf("while (!done)");
    expect(clearIdx).toBeGreaterThan(whileIdx);
  });

  it("applyStaging still invalidates memCache after chunks", () => {
    const fnStart = csSrc.indexOf("async function applyStaging");
    const fnBody  = csSrc.slice(fnStart, fnStart + 3800); // memCache at ~2608 chars in
    expect(fnBody).toContain("memCache");
    expect(fnBody).toContain("normalizedIndexCache");
  });
});

// ---------------------------------------------------------------------------
// F-11: Supabase singleton
// ---------------------------------------------------------------------------
describe("F-11: Single Supabase client shared across all SW modules", () => {
  it("background.js initialises NutriEntitlement and NutriCatalogSync via init(sb)", () => {
    expect(bgSrc).toContain("NutriEntitlement.init");
    expect(bgSrc).toContain("NutriCatalogSync.init");
  });

  it("background.js passes the sb accessor not a new client to init()", () => {
    // The init call must pass `sb` (the module-level lazy accessor), not NutriSupabase.create
    const entInitIdx = bgSrc.indexOf("NutriEntitlement.init");
    const initCall   = bgSrc.slice(entInitIdx, entInitIdx + 50);
    expect(initCall).toContain("sb");
    expect(initCall).not.toContain("NutriSupabase.create");
  });

  it("entitlement.js exposes init(sbAccessor) to receive the shared client", () => {
    expect(entSrc).toContain("NutriEntitlement.init");
    // There should be a _getSupabase pattern
    expect(entSrc).toContain("_getSupabase");
  });

  it("catalog-sync.js exposes init(sbAccessor) and uses _getSupabase", () => {
    expect(csSrc).toContain("_getSupabase");
    expect(csSrc).toContain("init(sbAccessor)");
  });

  it("entitlement.js hot paths do not create a new NutriSupabase client inline", () => {
    // The only NutriSupabase.create call in entitlement.js should be the fallback
    // inside getSupabase() — not in refresh() or any exported function.
    const refreshIdx = entSrc.indexOf("async function refresh");
    expect(refreshIdx).toBeGreaterThan(-1);
    const refreshBody = entSrc.slice(refreshIdx, refreshIdx + 800);
    expect(refreshBody).not.toContain("NutriSupabase.create");
  });

  it("catalog-sync.js hot paths do not create a new NutriSupabase client inline", () => {
    const syncIdx = csSrc.indexOf("async function sync()");
    expect(syncIdx).toBeGreaterThan(-1);
    const syncBody = csSrc.slice(syncIdx, syncIdx + 1500);
    expect(syncBody).not.toContain("NutriSupabase.create");
  });
});

// ---------------------------------------------------------------------------
// F-15: Latest-wins WAL
// ---------------------------------------------------------------------------
describe("F-15: Pending-cart WAL is latest-wins keyed by retailer", () => {
  it("cart.ts savePendingCartSync uses id = payload.retailer (not random id)", () => {
    const fnStart = cartSrc.indexOf("export async function savePendingCartSync");
    const fnBody  = cartSrc.slice(fnStart, fnStart + 600);
    // Must set id to retailer
    expect(fnBody).toContain("payload.retailer");
    expect(fnBody).toContain("id = payload.retailer");
    // Must NOT use the old 'pcs-' random key pattern in active code
    // (the comment mentions it as OLD — check the actual assignment line only)
    const assignLine = fnBody.match(/const id = .+/);
    expect(assignLine).not.toBeNull();
    expect(assignLine![0]).not.toContain("pcs-");
    expect(assignLine![0]).not.toContain("Date.now");
  });

  it("db.js (compiled) savePendingCartSync uses retailer as id", () => {
    const fnStart = dbJsSrc.indexOf("async function savePendingCartSync");
    const fnBody  = dbJsSrc.slice(fnStart, fnStart + 400);
    expect(fnBody).not.toContain("Math.random()");
    // compiled form may differ slightly — check the key pattern is gone
    expect(fnBody).not.toContain("pcs-");
  });

  it("cart.ts clearPendingCartSync accepts retailer string as id (unchanged API)", () => {
    const fnStart = cartSrc.indexOf("export async function clearPendingCartSync");
    const fnBody  = cartSrc.slice(fnStart, fnStart + 200);
    expect(fnBody).toContain("db.delete(\"pending_cart_syncs\", id)");
  });
});

// ---------------------------------------------------------------------------
// F-16: Catalog fetch deadlines
// ---------------------------------------------------------------------------
describe("F-16: Catalog fetch deadline (AbortController)", () => {
  it("PULL_DEADLINE_MS constant defined in catalog-sync.js", () => {
    expect(csSrc).toContain("PULL_DEADLINE_MS");
  });

  it("pullUpdates wraps each page fetch with AbortController", () => {
    const fnStart = csSrc.indexOf("async function pullUpdates");
    const fnBody  = csSrc.slice(fnStart, fnStart + 800);
    expect(fnBody).toContain("AbortController");
    expect(fnBody).toContain("ac.abort");
    expect(fnBody).toContain("abortSignal(ac.signal)");
  });

  it("AbortController timer is always cleared (no leak on success)", () => {
    const fnStart = csSrc.indexOf("async function pullUpdates");
    const fnBody  = csSrc.slice(fnStart, fnStart + 800);
    expect(fnBody).toContain("clearTimeout(timer)");
    // clearTimeout must be in a finally block so it fires even on error
    expect(fnBody).toContain("finally");
  });

  it("PULL_DEADLINE_MS is 30 seconds", () => {
    expect(csSrc).toContain("30_000");
  });
});

// ---------------------------------------------------------------------------
// F-15 + F-06 interaction: background.js uses retailer as WAL key
// ---------------------------------------------------------------------------
describe("F-15 + F-06 integration: background.js WAL key is retailer", () => {
  it("background.js SYNC_CART_STATE handler calls savePendingCartSync with payload (not a random key)", () => {
    const handlerStart = bgSrc.indexOf('"SYNC_CART_STATE"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 2000);
    expect(handlerBody).toContain("savePendingCartSync(message.payload)");
    // The clearPendingCartSync call receives the jobId returned by savePendingCartSync
    // which is now the retailer string — the call shape hasn't changed
    expect(handlerBody).toContain("clearPendingCartSync(jobId)");
  });
});
