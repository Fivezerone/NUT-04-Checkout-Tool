/**
 * grade-rendering-nutrition-sync.test.ts
 *
 * Comprehensive regression tests preventing regressions in:
 * 1. Product tile grade rendering across all 3 retailers (Quickmart, Naivas, Carrefour).
 * 2. IPC message action, batch payload contract, and result unwrapping in NutriScanner.
 * 3. Service worker batch handling, catalog readiness gates, and attribute normalization.
 * 4. Supabase nutrition catalog sync, RLS unauthenticated fallback, and slim client methods.
 * 5. Adapter single-root matching and idempotent badge injection.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const scannerSrc     = readFileSync(join(ROOT, "src/extension/scanner.js"), "utf8");
const bgSrc          = readFileSync(join(ROOT, "src/extension/background.js"), "utf8");
const catalogSrc     = readFileSync(join(ROOT, "src/extension/catalog-sync.js"), "utf8");
const buildSwSrc     = readFileSync(join(ROOT, "scripts/build-sw-client.mjs"), "utf8");
const naivasSrc      = readFileSync(join(ROOT, "src/extension/adapters/naivas.js"), "utf8");
const carrefourSrc   = readFileSync(join(ROOT, "src/extension/adapters/carrefour.js"), "utf8");
const quickmartSrc   = readFileSync(join(ROOT, "src/extension/adapters/quickmart.js"), "utf8");
const sharedUiSrc    = readFileSync(join(ROOT, "src/extension/adapters/shared-ui.js"), "utf8");
const gradeColorsSrc = readFileSync(join(ROOT, "src/extension/adapters/grade-colors.js"), "utf8");
const manifestSrc    = readFileSync(join(ROOT, "src/extension/manifest.json"), "utf8");

// ── 1. SCANNER IPC & CONTRACT TESTS ───────────────────────────────────────────
describe("NutriScanner IPC & Payload Mapping Contract", () => {
  it("NutriScanner sends CHECK_PRODUCT_SCORES_BATCH for candidate card batches", () => {
    const scoreIdx = scannerSrc.indexOf("async _score(batch)");
    expect(scoreIdx).toBeGreaterThan(-1);
    const scoreBody = scannerSrc.slice(scoreIdx, scoreIdx + 1200);

    expect(scoreBody).toContain('action: "CHECK_PRODUCT_SCORES_BATCH"');
    expect(scoreBody).not.toMatch(/action:\s*["']CHECK_PRODUCT_SCORE["'],\s*payload:\s*{\s*retailer/);
  });

  it("NutriScanner standardizes product attributes into payloads array", () => {
    const scoreIdx = scannerSrc.indexOf("async _score(batch)");
    const scoreBody = scannerSrc.slice(scoreIdx, scoreIdx + 1200);

    expect(scoreBody).toContain("payloads");
    expect(scoreBody).toContain("product_name: c.item?.name || c.item?.product_name");
    expect(scoreBody).toContain("retailer_product_id: c.item?.id || c.item?.retailer_product_id");
    expect(scoreBody).toContain("price: c.item?.price");
    expect(scoreBody).toContain("url: c.item?.url");
  });

  it("NutriScanner unwraps response data before calling adapter.inject", () => {
    const scoreIdx = scannerSrc.indexOf("async _score(batch)");
    const scoreBody = scannerSrc.slice(scoreIdx, scoreIdx + 1200);

    // Must unwrap r.data so inject receives the product object, not the envelope
    expect(scoreBody).toMatch(/const\s+product\s*=\s*\(r\.status\s*===\s*["']SUCCESS["']\s*&&\s*r\.data\)\s*\?\s*r\.data/);
    expect(scoreBody).toContain("this._adapter.inject(c.el, product)");
  });
});

// ── 2. BACKGROUND SERVICE WORKER READINESS & NORMALIZATION ─────────────────────
describe("Background Service Worker Catalog Readiness & IPC Resilience", () => {
  it("ensureCatalogReady memoizes catalogReadyPromise to prevent duplicate sync storms", () => {
    expect(bgSrc).toContain("let catalogReadyPromise = null;");
    const fnStart = bgSrc.indexOf("function ensureCatalogReady()");
    const fnBody = bgSrc.slice(fnStart, fnStart + 500);
    expect(fnBody).toContain("if (!catalogReadyPromise)");
    expect(fnBody).toContain("NutriCatalogSync?.ensureReady?.()");
  });

  it("getBatchContext awaits ensureCatalogReady to prevent race conditions on empty IDB", () => {
    const ctxStart = bgSrc.indexOf("async function getBatchContext()");
    const ctxBody = bgSrc.slice(ctxStart, ctxStart + 400);
    expect(ctxBody).toContain("await ensureCatalogReady()");
  });

  it("getProductInfo awaits ensureCatalogReady on standalone single-product calls", () => {
    const infoStart = bgSrc.indexOf("async function getProductInfo(");
    const infoBody = bgSrc.slice(infoStart, infoStart + 1200);
    expect(infoBody).toContain("await ensureCatalogReady()");
  });

  it("getProductInfo normalizes both product_name and name, and retailer_product_id and id", () => {
    const infoStart = bgSrc.indexOf("async function getProductInfo(");
    const infoBody = bgSrc.slice(infoStart, infoStart + 1200);
    expect(infoBody).toContain("payload.product_name || payload.name");
    expect(infoBody).toContain("payload.retailer_product_id || payload.id");
  });

  it("CHECK_PRODUCT_SCORE gracefully handles legacy batch payloads with items array", () => {
    const scoreHandlerStart = bgSrc.indexOf('if (message.action === "CHECK_PRODUCT_SCORE")');
    const scoreHandlerBody = bgSrc.slice(scoreHandlerStart, scoreHandlerStart + 1600);
    expect(scoreHandlerBody).toContain("Array.isArray(payload.items)");
    expect(scoreHandlerBody).toContain('sendResponse({ status: "SUCCESS", results })');
  });

  it("CHECK_PRODUCT_SCORES_BATCH accepts payloads from multiple property variants", () => {
    const batchHandlerStart = bgSrc.indexOf('if (message.action === "CHECK_PRODUCT_SCORES_BATCH")');
    const batchHandlerBody = bgSrc.slice(batchHandlerStart, batchHandlerStart + 600);
    expect(batchHandlerBody).toContain("message.payloads || message.payload?.items || message.items");
  });
});

// ── 3. SUPABASE NUTRITION SYNC & RLS RESILIENCE ────────────────────────────────
describe("Supabase Nutrition Sync & Local Fallback Resilience", () => {
  it("catalog-sync.js skips remote network sync gracefully when unauthenticated", () => {
    const syncStart = catalogSrc.indexOf("async function sync()");
    const syncBody = catalogSrc.slice(syncStart, syncStart + 1500);

    expect(syncBody).toContain("const isAuth = !!session;");
    expect(syncBody).toContain("if (!isAuth)");
    expect(syncBody).toContain("User is unauthenticated. Skipping remote Supabase catalog sync");
  });

  it("catalog-sync.js handles RLS permission denied (42501) without throwing unhandled error", () => {
    const syncStart = catalogSrc.indexOf("async function sync()");
    const syncBody = catalogSrc.slice(syncStart, syncStart + 2500);

    expect(syncBody).toContain("releaseErr.code === '42501'");
    expect(syncBody).toContain("Permission denied for catalog_releases in Supabase");
  });

  it("seedFallbackIfEmpty covers all 3 retailers and seeds default metadata", () => {
    const seedStart = catalogSrc.indexOf("async function seedFallbackIfEmpty");
    const seedBody = catalogSrc.slice(seedStart, seedStart + 2200);

    expect(seedBody).toContain("RETAILER_REGISTRY.entries()");
    expect(seedBody).toContain('version: "local-bundled"');
    expect(seedBody).toContain("NutriScoreDB.putCatalogMeta");
  });

  it("build-sw-client.mjs exposes auth, from, rpc, and schema on NutriSupabase client", () => {
    expect(buildSwSrc).toContain("from: (table) => rest.from(table)");
    expect(buildSwSrc).toContain("rpc: (fn, args, options) => rest.rpc(fn, args, options)");
    expect(buildSwSrc).toContain("schema: (s) => rest.schema(s)");
  });

  it("manifest.json defines web_accessible_resources for local data JSON fallbacks", () => {
    const manifest = JSON.parse(manifestSrc);
    expect(manifest.web_accessible_resources).toBeDefined();
    const hasDataJson = manifest.web_accessible_resources.some((war: any) =>
      war.resources?.includes("data/*.json")
    );
    expect(hasDataJson).toBe(true);
  });
});

// ── 4. ADAPTER MATCHING & BADGE INJECTION TESTS ────────────────────────────────
describe("Retailer Adapters Single-Root Scoping & Badge Injection", () => {
  it("NaivasAdapter candidatesIn matches both single card root and container descendants", () => {
    const candStart = naivasSrc.indexOf("candidatesIn(root) {");
    const candBody = naivasSrc.slice(candStart, candStart + 600);
    expect(candBody).toContain("scope.matches?.(productSelector)");
    expect(candBody).toContain("scope.querySelectorAll(productSelector)");
  });

  it("CarrefourAdapter candidatesIn matches both single link root and container descendants", () => {
    const candStart = carrefourSrc.indexOf("candidatesIn(root) {");
    const candBody = carrefourSrc.slice(candStart, candStart + 600);
    expect(candBody).toContain('scope.matches?.("a[href*=\'/p/\'], a[href*=\'/product/\']")');
    expect(candBody).toContain('scope.querySelectorAll("a[href*=\'/p/\'], a[href*=\'/product/\']")');
  });

  it("All 3 adapters unwrap product envelopes in inject() before calling injectBadge", () => {
    const nvInject = naivasSrc.slice(naivasSrc.indexOf("inject(el, result) {"), naivasSrc.indexOf("inject(el, result) {") + 450);
    const caInject = carrefourSrc.slice(carrefourSrc.indexOf("inject(el, result) {"), carrefourSrc.indexOf("inject(el, result) {") + 450);
    const qmInject = quickmartSrc.slice(quickmartSrc.indexOf("inject(el, result) {"), quickmartSrc.indexOf("inject(el, result) {") + 450);

    expect(nvInject).toContain("result.status === \"SUCCESS\" && result.data");
    expect(caInject).toContain("result.status === \"SUCCESS\" && result.data");
    expect(qmInject).toContain("result.status === \"SUCCESS\" && result.data");

    expect(nvInject).toContain("injectBadge(el, product");
    expect(caInject).toContain("injectBadge(el, product");
    expect(qmInject).toContain("injectBadge(el, product");
  });

  it("shared-ui.js and grade-colors.js handle grade mapping and missing data fallback", () => {
    expect(gradeColorsSrc).toContain('A: { bg: "#037b3e"');
    expect(gradeColorsSrc).toContain('E: { bg: "#e63e11"');
    expect(gradeColorsSrc).toContain('NutriScoreGradeColors');
    expect(sharedUiSrc).toContain('let grade = (productResult.nutriscore_grade || "UNKNOWN").toUpperCase();');
    expect(sharedUiSrc).toContain('grade = "—";');
  });
});
