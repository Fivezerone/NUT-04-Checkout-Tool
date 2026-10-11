/**
 * Phase 5 regression tests — F-06 / F-09
 *
 * F-06: Cart sync tabs coordination.
 *   - syncCart() must bail immediately if document.visibilityState !== 'visible'
 *   - SYNC_CART_STATE messages carry capturedAt; SW rejects stale snapshots
 *     (capturedAt <= last accepted capturedAt for that retailer)
 *
 * F-09: Premium sync atomicity.
 *   - Old path: clear(premium_assessments) → pull → verify
 *     A network drop between clear and verify leaves an EMPTY store.
 *   - New path: pull → premium_staging → verify hash → atomic swap
 *     A network drop at any point leaves premium_assessments intact.
 *   - Verify: premium_staging is used for pulling; premium_assessments is only
 *     touched during the atomic swap AFTER hash verification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const bgSrc  = readFileSync(join(ROOT, "src/extension/background.js"),  "utf8");
const csSrc  = readFileSync(join(ROOT, "src/extension/catalog-sync.js"), "utf8");
const ctSrc  = readFileSync(join(ROOT, "src/extension/content.js"),     "utf8");

// ---------------------------------------------------------------------------
// F-06: content-script visibility gate (static analysis)
// ---------------------------------------------------------------------------
describe("F-06: syncCart() visibility gate", () => {
  it("content.js syncCart() checks document.visibilityState before capturing cart", () => {
    // The guard must appear before any adapter call or cart fetch
    const fnStart = ctSrc.indexOf("async syncCart(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody  = ctSrc.slice(fnStart, fnStart + 600);
    const visIdx  = fnBody.indexOf("visibilityState");
    const adpIdx  = fnBody.indexOf("extractCartState");
    expect(visIdx).toBeGreaterThan(-1);     // guard exists
    expect(visIdx).toBeLessThan(adpIdx);    // guard runs BEFORE extraction
  });

  it("SYNC_CART_STATE payload includes capturedAt field", () => {
    expect(ctSrc).toContain("capturedAt");
    expect(ctSrc).toContain("capturedAt: Date.now()");
  });
});

// ---------------------------------------------------------------------------
// F-06: SW capturedAt ordering guard (static analysis)
// ---------------------------------------------------------------------------
describe("F-06: SW rejects stale cart snapshots", () => {
  it("background.js declares _lastCartAt map at module level", () => {
    expect(bgSrc).toContain("const _lastCartAt = {}");
  });

  it("background.js SYNC_CART_STATE handler checks capturedAt against _lastCartAt", () => {
    const handlerStart = bgSrc.indexOf('"SYNC_CART_STATE"');
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerBody = bgSrc.slice(handlerStart, handlerStart + 800);
    expect(handlerBody).toContain("capturedAt");
    expect(handlerBody).toContain("_lastCartAt");
    expect(handlerBody).toContain("STALE");
  });

  it("SW updates _lastCartAt[retailer] before persisting the sync job", () => {
    const handlerStart = bgSrc.indexOf('"SYNC_CART_STATE"');
    const handlerBody  = bgSrc.slice(handlerStart, handlerStart + 2000); // savePendingCartSync at ~1089
    const lastCartIdx  = handlerBody.indexOf("_lastCartAt[retailer] = capturedAt");
    const saveIdx      = handlerBody.indexOf("savePendingCartSync");
    expect(lastCartIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(-1);
    // high-water mark updated BEFORE the IDB write
    expect(lastCartIdx).toBeLessThan(saveIdx);
  });
});

// ---------------------------------------------------------------------------
// F-06: runtime simulation of stale-snapshot rejection
// ---------------------------------------------------------------------------
describe("F-06: capturedAt ordering — runtime simulation", () => {
  // Simulate the SW guard logic in isolation
  function makeSwGuard() {
    const lastCartAt: Record<string, number> = {};
    return function handle(retailer: string, capturedAt: number) {
      if (capturedAt <= (lastCartAt[retailer] ?? 0)) return "STALE";
      lastCartAt[retailer] = capturedAt;
      return "ACCEPTED";
    };
  }

  it("accepts the first snapshot for a retailer", () => {
    const handle = makeSwGuard();
    expect(handle("NAIVAS", 1000)).toBe("ACCEPTED");
  });

  it("accepts a newer snapshot", () => {
    const handle = makeSwGuard();
    handle("NAIVAS", 1000);
    expect(handle("NAIVAS", 2000)).toBe("ACCEPTED");
  });

  it("rejects a snapshot with the same capturedAt (duplicate delivery)", () => {
    const handle = makeSwGuard();
    handle("NAIVAS", 1000);
    expect(handle("NAIVAS", 1000)).toBe("STALE");
  });

  it("rejects an older snapshot (last-writer-wins bug scenario)", () => {
    const handle = makeSwGuard();
    handle("NAIVAS", 2000); // newer arrives first (network reorder)
    expect(handle("NAIVAS", 1000)).toBe("STALE");
  });

  it("tracks retailers independently", () => {
    const handle = makeSwGuard();
    handle("NAIVAS", 5000);
    // CARREFOUR has its own high-water mark — should accept any timestamp
    expect(handle("CARREFOUR", 1000)).toBe("ACCEPTED");
    // NAIVAS at 4000 < 5000: stale
    expect(handle("NAIVAS", 4000)).toBe("STALE");
  });
});

// ---------------------------------------------------------------------------
// F-09: atomic swap — static analysis of catalog-sync.js
// ---------------------------------------------------------------------------
describe("F-09: premium sync atomicity", () => {
  it("does NOT call db.clear('premium_assessments') before pulling data", () => {
    const premStart = csSrc.indexOf("needsPremiumSync");
    expect(premStart).toBeGreaterThan(-1);
    const premBlock = csSrc.slice(premStart, premStart + 3500); // assessStore.clear at ~2797

    const stagingClearIdx  = premBlock.indexOf('clear("premium_staging")');
    // pullUpdates call targeting premium_staging (distinct from the clear call above it)
    const pullTargetIdx    = premBlock.indexOf("catalog_premium");
    const assessClearIdx   = premBlock.indexOf("assessStore.clear()");
    const hashCheckIdx     = premBlock.indexOf("manifest.premium_hash");

    expect(stagingClearIdx).toBeGreaterThan(-1);   // staging is cleared first
    expect(pullTargetIdx).toBeGreaterThan(-1);      // pull goes into staging
    expect(assessClearIdx).toBeGreaterThan(-1);     // live store cleared inside tx
    expect(hashCheckIdx).toBeGreaterThan(-1);       // hash verified

    // ORDER: staging clear → pull(catalog_premium) → hash check → assessments clear (swap)
    expect(stagingClearIdx).toBeLessThan(pullTargetIdx);
    expect(pullTargetIdx).toBeLessThan(hashCheckIdx);
    expect(hashCheckIdx).toBeLessThan(assessClearIdx);
  });

  it("uses premium_staging as the pull target (never pulls directly into premium_assessments)", () => {
    // pullUpdates for premium must target "premium_staging", not "premium_assessments"
    const pullCall = csSrc.match(/pullUpdates\([^)]+catalog_premium[^)]+\)/);
    expect(pullCall).not.toBeNull();
    expect(pullCall![0]).toContain("premium_staging");
    expect(pullCall![0]).not.toContain("premium_assessments");
  });

  it("clears staging after a hash mismatch to avoid stale rows on next attempt", () => {
    const premBlock = csSrc.slice(csSrc.indexOf("needsPremiumSync"), csSrc.indexOf("needsPremiumSync") + 2500);
    const mismatchBlock = premBlock.slice(
      premBlock.indexOf("manifest.premium_hash"),
      premBlock.indexOf("manifest.premium_hash") + 400
    );
    expect(mismatchBlock).toContain('clear("premium_staging")');
  });

  it("verifies hash BEFORE touching premium_assessments (F-09 core invariant)", () => {
    const premStart = csSrc.indexOf("needsPremiumSync");
    const premBlock = csSrc.slice(premStart, premStart + 3500); // swapTx at ~2568
    const hashIdx   = premBlock.indexOf("manifest.premium_hash");
    const swapTxIdx = premBlock.indexOf("swapTx");
    // Hash check must appear before the swap transaction
    expect(hashIdx).toBeGreaterThan(-1);
    expect(swapTxIdx).toBeGreaterThan(-1);
    expect(hashIdx).toBeLessThan(swapTxIdx);
  });

  it("IDB schema v16 adds premium_staging store", () => {
    const sharedSrc = readFileSync(join(ROOT, "src/ui/src/app/lib/db/shared.ts"), "utf8");
    expect(sharedSrc).toContain("DB_VERSION = 16");
    expect(sharedSrc).toContain("premium_staging");
    expect(sharedSrc).toContain("oldVersion < 16");
  });
});
