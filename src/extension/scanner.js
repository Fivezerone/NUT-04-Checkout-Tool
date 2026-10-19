/**
 * scanner.js — F-05: viewport-aware, incremental product card scanner.
 *
 * Replaces: MutationObserver → 300ms debounce → adapter.detectProducts() over the WHOLE document.
 *   Cost model: O(total cards) per mutation burst. On an infinite-scroll grid this grows without bound.
 *
 * New cost model:
 *   - MutationObserver only records the *added subtrees*       → O(added nodes)
 *   - candidatesIn(root) queries inside those subtrees only   → O(added cards)
 *   - IntersectionObserver defers scoring until a card is
 *     near the viewport                                        → off-screen cards cost ~0
 *   - Results are batched (≤ MAX_BATCH_ITEMS per message)
 *     with bounded in-flight RPC concurrency
 *
 * Backwards-compatibility: if IntersectionObserver is unavailable (test environments,
 * very old Chrome), falls back to direct scoring without viewport gating.
 *
 * Contract with adapters:
 *   adapter.candidatesIn(root)  → Array<{ el: HTMLElement, item: ScoreItem }>
 *   adapter.inject(el, result)  → void  (idempotent — replaces existing badge)
 *   adapter.getRetailerCode()   → string
 */

/* globals chrome */

const NUTRI_SCANNER_MAX_BATCH  = 10;   // items per SW message
const NUTRI_SCANNER_FLUSH_MS   = 30;   // micro-batch window (ms)
const NUTRI_SCANNER_MAX_INFLIGHT = 2;  // bounded RPC concurrency
const NUTRI_SCANNER_MAX_ATTEMPTS = 3;  // per-element retries before giving up
const NUTRI_SCANNER_ROOT_MARGIN = "400px 0px"; // start scoring ~half a screen before card enters

/** requestIdleCallback with 200ms deadline; falls back to rAF on unsupported browsers. */
const _ric = typeof requestIdleCallback === "function"
  ? (cb) => requestIdleCallback(cb, { timeout: 200 })
  : (cb) => setTimeout(cb, 16);

class NutriScanner {
  constructor(adapter, safeSend, observeRoot) {
    this._adapter     = adapter;
    this._safeSend    = safeSend;          // (message, cb?) => void
    this._root        = observeRoot || document.body;

    this._seen        = new WeakSet();     // elements already handed to IO
    this._attempts    = new WeakMap();     // element → retry count
    this._byEl        = new WeakMap();     // element → candidate { el, item }
    this._pending     = new Set();         // subtree roots queued for drainRoots()
    this._queue       = [];                // candidates waiting for flush
    this._inflight    = 0;
    this._drainSched  = false;
    this._flushTimer  = undefined;

    const hasIO = typeof IntersectionObserver === "function";

    this._mo = new MutationObserver((records) => this._onMutations(records));
    this._io = hasIO
      ? new IntersectionObserver((entries) => this._onIntersect(entries), { rootMargin: NUTRI_SCANNER_ROOT_MARGIN })
      : null;
  }

  start() {
    this._mo.observe(this._root, { childList: true, subtree: true });
    this._enqueueRoot(this._root);
  }

  stop() {
    this._mo.disconnect();
    if (this._io) this._io.disconnect();
    clearTimeout(this._flushTimer);
  }

  /** Full teardown — release all DOM references so detached nodes can be GC'd. */
  destroy() {
    this.stop();
    this._io = null;
    this._seen     = new WeakSet();
    this._attempts = new WeakMap();
    this._byEl     = new WeakMap();
    this._pending.clear();
    this._queue.length = 0;
  }

  /** Full rescan — resets seen/attempt state, re-discovers everything in the root. */
  rescan() {
    this._seen     = new WeakSet();
    this._attempts = new WeakMap();
    this._enqueueRoot(this._root);
  }

  // ── 1. DISCOVERY ──────────────────────────────────────────────────────────

  _onMutations(records) {
    let hasRelevant = false;
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        const el = /** @type {Element} */ (n);
        // Ignore our own injected nodes to prevent feedback loop
        if (el.classList.contains("nutriscore-isolated-root") ||
            el.id === "nutriscore-global-portal-host") return;
        this._enqueueRoot(el);
        hasRelevant = true;
      });
    }
    // If only our own nodes changed, skip
    if (!hasRelevant && records.every(r =>
      [...r.addedNodes, ...r.removedNodes].every(n =>
        n.nodeType === 1 && (
          /** @type {Element} */ (n).classList?.contains("nutriscore-isolated-root") ||
          /** @type {Element} */ (n).id === "nutriscore-global-portal"
        )
      )
    )) return;
  }

  _enqueueRoot(root) {
    this._pending.add(root);
    if (this._drainSched) return;
    this._drainSched = true;
    _ric(() => { this._drainSched = false; this._drainRoots(); });
  }

  _drainRoots() {
    const roots = [...this._pending];
    this._pending.clear();
    for (const root of roots) {
      if (!root.isConnected) continue;
      const candidates = this._adapter.candidatesIn(root);
      for (const c of candidates) {
        if (this._seen.has(c.el)) continue;
        this._seen.add(c.el);
        this._byEl.set(c.el, c);
        if (this._io) {
          this._io.observe(c.el);  // scoring deferred until near viewport
        } else {
          // No IntersectionObserver: score immediately (test env / old Chrome)
          this._queue.push(c);
          this._scheduleFlush();
        }
      }
    }
  }

  // ── 2. VIEWPORT GATING + MICRO-BATCHING ───────────────────────────────────

  _onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      this._io.unobserve(e.target);
      const c = this._byEl.get(e.target);
      if (c) this._queue.push(c);
    }
    if (this._queue.length >= NUTRI_SCANNER_MAX_BATCH) {
      void this._flush();
    } else if (this._queue.length > 0) {
      this._scheduleFlush();
    }
  }

  _scheduleFlush() {
    if (this._flushTimer === undefined) {
      this._flushTimer = setTimeout(() => void this._flush(), NUTRI_SCANNER_FLUSH_MS);
    }
  }

  async _flush() {
    clearTimeout(this._flushTimer);
    this._flushTimer = undefined;
    while (this._queue.length > 0 && this._inflight < NUTRI_SCANNER_MAX_INFLIGHT) {
      const batch = this._queue.splice(0, NUTRI_SCANNER_MAX_BATCH);
      this._inflight++;
      void this._score(batch).finally(() => {
        this._inflight--;
        if (this._queue.length > 0) void this._flush();
      });
    }
  }

  // ── 3. SCORING ────────────────────────────────────────────────────────────

  async _score(batch) {
    return new Promise((resolve) => {
      this._safeSend(
        {
          action: "CHECK_PRODUCT_SCORE",
          payload: {
            retailer: this._adapter.getRetailerCode(),
            items: batch.map((c) => c.item),
          },
        },
        (response) => {
          try {
            const results = response?.ok ? (response.response?.results || []) : [];
            batch.forEach((c, i) => {
              const r = results[i];
              if (!r) { this._retryLater(c); return; }
              if (r.status === "error" && r.retryable) { this._retryLater(c); return; }
              this._adapter.inject(c.el, r);
            });
          } catch {
            batch.forEach((c) => this._retryLater(c));
          }
          resolve();
        }
      );
    });
  }

  _retryLater(c) {
    const n = (this._attempts.get(c.el) ?? 0) + 1;
    this._attempts.set(c.el, n);
    if (n >= NUTRI_SCANNER_MAX_ATTEMPTS) return; // give up; next rescan resets counter
    this._seen.delete(c.el);                     // eligible for re-discovery
    this._enqueueRoot(c.el);
  }
}
