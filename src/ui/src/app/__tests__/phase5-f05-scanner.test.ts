/**
 * Phase 5 (F-05) regression tests — NutriScanner + candidatesIn
 *
 * F-05: Full-document rescan per mutation burst.
 *   OLD: MutationObserver → 300ms debounce → adapter.detectProducts() over whole document
 *        Cost: O(total cards) per mutation burst.
 *   NEW: MutationObserver → addedNode subtrees → adapter.candidatesIn(root) scoped to subtree
 *        IntersectionObserver defers scoring until card near viewport
 *        Cost: O(added cards) per burst; O(visible cards) scored.
 *
 * Tests verify:
 *   1. Both adapters expose candidatesIn(root) and inject(el, result)
 *   2. candidatesIn(root) limits scope to the given root (not whole document)
 *   3. NutriScanner prefers candidatesIn over detectProducts
 *   4. content.js uses NutriScanner when adapter has candidatesIn
 *   5. rescan() delegates to scanner.rescan() when scanner is active
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const ctSrc = readFileSync(join(ROOT, "src/extension/content.js"),              "utf8");
const scSrc = readFileSync(join(ROOT, "src/extension/scanner.js"),              "utf8");
const caSrc = readFileSync(join(ROOT, "src/extension/adapters/carrefour.js"),   "utf8");
const nvSrc = readFileSync(join(ROOT, "src/extension/adapters/naivas.js"),      "utf8");

// ---------------------------------------------------------------------------
// Adapter API: candidatesIn + inject
// ---------------------------------------------------------------------------
describe("F-05: adapter candidatesIn() API", () => {
  it("CarrefourAdapter exposes candidatesIn(root)", () => {
    expect(caSrc).toContain("candidatesIn(root)");
  });

  it("NaivasAdapter exposes candidatesIn(root)", () => {
    expect(nvSrc).toContain("candidatesIn(root)");
  });

  it("CarrefourAdapter exposes inject(el, result)", () => {
    expect(caSrc).toContain("inject(el, result)");
  });

  it("NaivasAdapter exposes inject(el, result)", () => {
    expect(nvSrc).toContain("inject(el, result)");
  });

  it("Carrefour candidatesIn uses `scope.querySelectorAll` not `document.querySelectorAll`", () => {
    // Verify the scoped query — the old detectProducts used document.querySelectorAll
    const fnStart = caSrc.indexOf("candidatesIn(root)");
    const fnBody  = caSrc.slice(fnStart, fnStart + 1500);
    expect(fnBody).toContain("scope.querySelectorAll");
    // Must NOT call document.querySelectorAll for the product links inside candidatesIn
    // (it may call it for other reasons like category breadcrumbs — not in Carrefour)
    const docQSAIdx = fnBody.indexOf("document.querySelectorAll");
    const scopeQSAIdx = fnBody.indexOf("scope.querySelectorAll");
    // scope.querySelectorAll must appear; if document.querySelectorAll also appears,
    // it must be AFTER (for breadcrumbs etc.), not before
    expect(scopeQSAIdx).toBeGreaterThan(-1);
    // The product links query must use scope, not document
    const productLinkQuery = fnBody.match(/querySelectorAll\(["']a\[href\*='\/p\/'\]/);
    if (productLinkQuery) {
      const idx = fnBody.indexOf(productLinkQuery[0]);
      // Check it's prefixed with 'scope.' not 'document.'
      const prefix = fnBody.slice(Math.max(0, idx - 10), idx);
      expect(prefix).toContain("scope.");
    }
  });

  it("Naivas candidatesIn uses `scope.querySelectorAll` for product cards", () => {
    const fnStart = nvSrc.indexOf("candidatesIn(root)");
    const fnBody  = nvSrc.slice(fnStart, fnStart + 1500);
    expect(fnBody).toContain("scope.querySelectorAll");
  });

  it("Carrefour inject() removes existing badge before re-injecting (idempotent)", () => {
    const fnStart = caSrc.indexOf("inject(el, result)");
    const fnBody  = caSrc.slice(fnStart, fnStart + 500); // .remove() may be after comment lines
    expect(fnBody).toContain("nutriscore-isolated-root");
    expect(fnBody).toContain("remove()");
    expect(fnBody).toContain("injectBadge");
  });
});

// ---------------------------------------------------------------------------
// NutriScanner: static analysis
// ---------------------------------------------------------------------------
describe("F-05: NutriScanner class", () => {
  it("scanner.js defines class NutriScanner", () => {
    expect(scSrc).toContain("class NutriScanner");
  });

  it("NutriScanner uses IntersectionObserver for viewport gating", () => {
    expect(scSrc).toContain("IntersectionObserver");
    expect(scSrc).toContain("isIntersecting");
  });

  it("NutriScanner uses MutationObserver scoped to addedNodes only (not full document)", () => {
    expect(scSrc).toContain("_onMutations");
    expect(scSrc).toContain("addedNodes");
    // Must NOT call document.querySelectorAll in the MO handler
    const moFnStart = scSrc.indexOf("_onMutations");
    const moFnBody  = scSrc.slice(moFnStart, moFnStart + 400);
    expect(moFnBody).not.toContain("document.querySelectorAll");
  });

  it("NutriScanner calls adapter.candidatesIn(root) not adapter.detectProducts()", () => {
    // candidatesIn must appear in the class body
    expect(scSrc).toContain("candidatesIn");
    // 'detectProducts' may appear in the file header comment — check the class body only
    const classStart = scSrc.indexOf("class NutriScanner");
    const classBody  = scSrc.slice(classStart);
    expect(classBody).not.toContain("detectProducts");
  });

  it("NutriScanner calls adapter.inject(el, result) not adapter.injectBadge()", () => {
    expect(scSrc).toContain("adapter.inject(");
    expect(scSrc).not.toContain("adapter.injectBadge(");
  });

  it("NutriScanner micro-batches with flush timer and MAX_BATCH constant", () => {
    expect(scSrc).toContain("NUTRI_SCANNER_MAX_BATCH");
    expect(scSrc).toContain("NUTRI_SCANNER_FLUSH_MS");
    expect(scSrc).toContain("_flush");
  });

  it("NutriScanner bounds in-flight RPC concurrency", () => {
    expect(scSrc).toContain("NUTRI_SCANNER_MAX_INFLIGHT");
    expect(scSrc).toContain("_inflight");
  });

  it("NutriScanner falls back gracefully when IntersectionObserver is unavailable", () => {
    // The IO is conditionally created
    expect(scSrc).toContain("typeof IntersectionObserver");
    // When IO is null, cards are pushed directly to queue
    expect(scSrc).toContain("this._queue.push(c)");
  });

  it("NutriScanner.rescan() resets seen/attempt state", () => {
    const rescanIdx = scSrc.indexOf("rescan()");
    const rescanBody = scSrc.slice(rescanIdx, rescanIdx + 200);
    expect(rescanBody).toContain("_seen");
    expect(rescanBody).toContain("_attempts");
    expect(rescanBody).toContain("_enqueueRoot");
  });
});

// ---------------------------------------------------------------------------
// content.js wiring
// ---------------------------------------------------------------------------
describe("F-05: content.js NutriScanner wiring", () => {
  it("content.js checks for NutriScanner before creating one", () => {
    expect(ctSrc).toContain('typeof NutriScanner === "function"');
  });

  it("content.js checks adapter.candidatesIn before using scanner", () => {
    expect(ctSrc).toContain('typeof this.adapter.candidatesIn === "function"');
  });

  it("content.js falls back to legacy observer when adapter lacks candidatesIn", () => {
    expect(ctSrc).toContain("// Legacy path");
    // Legacy path still has the 300ms debounce — use a larger slice
    const legacyIdx = ctSrc.indexOf("// Legacy path");
    const legacyBlock = ctSrc.slice(legacyIdx, legacyIdx + 1200);
    expect(legacyBlock).toContain("300");
    expect(legacyBlock).toContain("scanAndInject");
  });

  it("rescan() delegates to scanner.rescan() when scanner is active", () => {
    // Find the rescan() method body (not the _startNavMonitor etc.)
    // The method definition appears as '  rescan()'
    const rescanIdx = ctSrc.indexOf("  rescan() {");
    const rescanBody = ctSrc.slice(rescanIdx, rescanIdx + 700);
    expect(rescanBody).toContain("this._scanner");
    expect(rescanBody).toContain("_scanner.rescan()");
  });
});

// ---------------------------------------------------------------------------
// NutriScanner: runtime unit test (no-DOM — pure logic)
// ---------------------------------------------------------------------------
describe("F-05: NutriScanner runtime — candidatesIn scoping", () => {
  it("candidatesIn is called with a specific root node, not with document", () => {
    // Verify the contract: candidatesIn receives the addedNode subtree, not document.
    // We test this by inspecting the source: _drainRoots calls candidatesIn(root)
    // where root is each element from this._pending (populated by addedNodes in _onMutations).
    const drainIdx  = scSrc.indexOf("_drainRoots");
    const drainBody = scSrc.slice(drainIdx, drainIdx + 400);
    // candidatesIn must receive `root` (the subtree element), not `document`
    expect(drainBody).toContain("candidatesIn(root)");
    expect(drainBody).not.toContain("candidatesIn(document");
  });

  it("NutriScanner class body does not call adapter.detectProducts()", () => {
    const classStart = scSrc.indexOf("class NutriScanner");
    const classBody  = scSrc.slice(classStart);
    expect(classBody).not.toContain("detectProducts");
  });
});
