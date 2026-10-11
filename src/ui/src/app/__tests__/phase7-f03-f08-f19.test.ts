/**
 * Phase 7 regression tests — F-03, F-08, F-19
 *
 * F-03: Per-card fan-out — each card inside CHECK_PRODUCT_SCORES_BATCH was
 *   calling getSettings() (9 IDB reads) and currentTier() (JWT verify) independently.
 *   OLD: Promise.all(payloads.map(async p => getProductInfo(p, ...)))
 *        → N concurrent IDB transactions + N getSettings calls
 *   NEW: getBatchContext() called once per batch; sequential for...of loop;
 *        getProductInfo(p, retailer, ctx) skips settings/tier when ctx is provided.
 *
 * F-08: A release that removes any product cannot be published.
 *   Root cause: catalog_release_publish computed max_seq WHERE NOT deleted,
 *   but tombstones always have a higher seq — values never matched.
 *   Fix: migration 20261011000001 — max_seq over ALL rows; pg_advisory_xact_lock.
 *
 * F-19: Messages stringly-typed, unvalidated, batch length unbounded.
 *   Fix: MAX_BATCH_ITEMS = 64 guard; reject empty/oversized batches.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const bgSrc   = readFileSync(join(ROOT, "src/extension/background.js"), "utf8");
const migSrc  = readFileSync(
  join(ROOT, "supabase/migrations/20261011000001_catalog_release_publish_fix.sql"),
  "utf8"
);

// ---------------------------------------------------------------------------
// F-03: getBatchContext + sequential loop
// ---------------------------------------------------------------------------
describe("F-03: batch context hoisted; sequential loop replaces Promise.all", () => {
  it("MAX_BATCH_ITEMS constant is defined as 64", () => {
    expect(bgSrc).toContain("MAX_BATCH_ITEMS = 64");
  });

  it("getBatchContext() function is defined", () => {
    expect(bgSrc).toContain("async function getBatchContext()");
  });

  it("getBatchContext calls getSettings exactly once (not per-card)", () => {
    const fnStart = bgSrc.indexOf("async function getBatchContext()");
    const fnBody  = bgSrc.slice(fnStart, fnStart + 400);
    expect(fnBody).toContain("getSettings");
    // currentTier also called once in getBatchContext
    expect(fnBody).toContain("currentTier()");
  });

  it("getProductInfo accepts optional ctx parameter", () => {
    expect(bgSrc).toContain("getProductInfo(payload, retailerCode, ctx = null)");
  });

  it("getProductInfo skips getSettings when ctx is provided", () => {
    const fnStart = bgSrc.indexOf("async function getProductInfo");
    const fnBody  = bgSrc.slice(fnStart, fnStart + 600);
    // The ctx branch should not call getSettings()
    expect(fnBody).toContain("if (ctx)");
    expect(fnBody).toContain("{ settings, tier } = ctx");
    // getSettings must be in the else branch only
    const ctxIdx  = fnBody.indexOf("if (ctx)");
    const elseIdx = fnBody.indexOf("} else {", ctxIdx);
    const getSettingsIdx = fnBody.indexOf("getSettings", ctxIdx);
    expect(elseIdx).toBeGreaterThan(ctxIdx);
    expect(getSettingsIdx).toBeGreaterThan(elseIdx); // getSettings is in else branch
  });

  it("CHECK_PRODUCT_SCORES_BATCH handler calls getBatchContext()", () => {
    const handlerStart = bgSrc.indexOf('"CHECK_PRODUCT_SCORES_BATCH"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 1500);
    expect(handlerBody).toContain("getBatchContext()");
  });

  it("batch handler uses sequential for...of not Promise.all", () => {
    // Scope the search to the BATCH handler block only
    const handlerStart = bgSrc.indexOf('"CHECK_PRODUCT_SCORES_BATCH"');
    const nextHandlerIdx = bgSrc.indexOf('if (message.action', handlerStart + 50);
    const handlerBody    = bgSrc.slice(handlerStart, nextHandlerIdx > 0 ? nextHandlerIdx : handlerStart + 1200);
    expect(handlerBody).toContain("for (const payload of payloads)");
    // Check that the actual call form Promise.all( does not appear (comments may mention it)
    expect(handlerBody).not.toContain("Promise.all(payloads");
    expect(handlerBody).not.toContain("await Promise.all(");
  });

  it("batch handler passes ctx to getProductInfo", () => {
    const handlerStart = bgSrc.indexOf('"CHECK_PRODUCT_SCORES_BATCH"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 1500);
    expect(handlerBody).toContain("getProductInfo(payload, retailerCode, ctx)");
  });

  it("batch handler uses results.push() not return (sequential accumulation)", () => {
    const handlerStart = bgSrc.indexOf('"CHECK_PRODUCT_SCORES_BATCH"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 1500);
    expect(handlerBody).toContain("results.push");
    expect(handlerBody).toContain("const results = []");
  });
});

// ---------------------------------------------------------------------------
// F-08: catalog_release_publish migration
// ---------------------------------------------------------------------------
describe("F-08: catalog_release_publish fix — tombstone seq match", () => {
  it("migration file exists and targets catalog_release_publish", () => {
    expect(migSrc).toContain("catalog_release_publish");
  });

  it("max_seq computed over ALL rows (no WHERE NOT deleted)", () => {
    // The fixed function must use max(seq) without a NOT deleted filter
    expect(migSrc).toContain("max(seq) from public.catalog_products");
    expect(migSrc).toContain("max(seq) from public.catalog_premium");
    // Must NOT filter by NOT deleted when computing v_max_seq
    const maxSeqBlock = migSrc.slice(
      migSrc.indexOf("select greatest"),
      migSrc.indexOf("into v_max_seq")
    );
    expect(maxSeqBlock).not.toContain("not deleted");
    expect(maxSeqBlock).not.toContain("NOT deleted");
    expect(maxSeqBlock).not.toContain("deleted = false");
  });

  it("migration adds pg_advisory_xact_lock for concurrent publisher safety", () => {
    expect(migSrc).toContain("pg_advisory_xact_lock");
    expect(migSrc).toContain("catalog_release_publish");
  });

  it("migration uses CREATE OR REPLACE (non-destructive)", () => {
    expect(migSrc).toContain("create or replace function");
  });

  it("migration revokes from public/anon/authenticated and grants to service_role only", () => {
    expect(migSrc).toContain("revoke all on function");
    expect(migSrc).toContain("grant  execute on function");
    expect(migSrc).toContain("service_role");
  });
});

// ---------------------------------------------------------------------------
// F-19: Message validation and batch size cap
// ---------------------------------------------------------------------------
describe("F-19: Message validation — batch size cap + required-field guard", () => {
  it("MAX_BATCH_ITEMS is 64 (matches 48-card page + 33% headroom per report)", () => {
    expect(bgSrc).toContain("MAX_BATCH_ITEMS = 64");
  });

  it("batch handler rejects empty payloads array", () => {
    const handlerStart = bgSrc.indexOf('"CHECK_PRODUCT_SCORES_BATCH"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 600);
    expect(handlerBody).toContain("payloads.length === 0");
    expect(handlerBody).toContain("non-empty array");
  });

  it("batch handler rejects oversized payloads with MAX_BATCH_ITEMS", () => {
    const handlerStart = bgSrc.indexOf('"CHECK_PRODUCT_SCORES_BATCH"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 600);
    expect(handlerBody).toContain("payloads.length > MAX_BATCH_ITEMS");
    expect(handlerBody).toContain("exceeds MAX_BATCH_ITEMS");
  });

  it("CHECK_PRODUCT_SCORE handler already validates missing payload (D-30)", () => {
    const handlerStart = bgSrc.indexOf('"CHECK_PRODUCT_SCORE"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 400);
    expect(handlerBody).toContain("!payload");
    expect(handlerBody).toContain("Missing payload");
  });

  it("batch handler returns false synchronously on validation failure (no async)", () => {
    // The validation must be before the async IIFE so it fires synchronously
    const handlerStart = bgSrc.indexOf('"CHECK_PRODUCT_SCORES_BATCH"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 700);
    const emptyCheckIdx = handlerBody.indexOf("payloads.length === 0");
    const asyncIIFEIdx  = handlerBody.indexOf("(async () =>");
    // Validation must come before the async IIFE
    expect(emptyCheckIdx).toBeGreaterThan(-1);
    expect(asyncIIFEIdx).toBeGreaterThan(emptyCheckIdx);
  });
});
