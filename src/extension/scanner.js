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
const NUTRI_SCANNER_RPC_DEADLINE_MS = 1500; // ADR-9: RPC response deadline (ms)
const NUTRI_SCANNER_SLICE_MS   = 16;   // RDA frame budget time-slice (ms)

/** requestIdleCallback with 200ms deadline; falls back to rAF on unsupported browsers. */
const _ric = typeof requestIdleCallback === "function"
  ? (cb) => requestIdleCallback(cb, { timeout: 200 })
  : (cb) => setTimeout(cb, 16);

/**
 * NutriCircuitBreaker — Prevents retry storms against an unresponsive background worker (ADR-9).
 * 5 failures within 10s opens for 15s. Half-open state tests recovery with 1 probe.
 */
class NutriCircuitBreaker {
  constructor(failureThreshold = 5, windowMs = 10000, openDurationMs = 15000) {
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
    this.openDurationMs = openDurationMs;
    this.failures = [];
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
    this.openedAt = 0;
  }

  isOpen() {
    const now = Date.now();
    if (this.state === "OPEN") {
      if (now - this.openedAt >= this.openDurationMs) {
        this.state = "HALF_OPEN";
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.state = "CLOSED";
    this.failures = [];
  }

  recordFailure() {
    const now = Date.now();
    this.failures.push(now);
    this.failures = this.failures.filter(t => now - t <= this.windowMs);
    if (this.failures.length >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = now;
      if (typeof NutriObs !== "undefined" && NutriObs.count) {
        NutriObs.count("circuit_breaker_open", 1);
      }
    }
  }

  reset() {
    this.state = "CLOSED";
    this.failures = [];
    this.openedAt = 0;
  }
}

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
    this._breaker     = new NutriCircuitBreaker();

    const hasIO = typeof IntersectionObserver === "function";

    this._mo = new MutationObserver((records) => this._onMutations(records));
    this._io = hasIO
      ? new IntersectionObserver((entries) => this._onIntersect(entries), { rootMargin: NUTRI_SCANNER_ROOT_MARGIN })
      : null;
  }

  getBreaker() {
    return this._breaker;
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
    this._enqueueRoot(this._root || document.body);
    this._queue.length = 0;
    this._pending.clear();
    if (!this._root?.isConnected) {
      this._mo?.disconnect();
      this._root = this._adapter?.getObserveTarget?.() || document.body;
      if (this._root) this._mo?.observe(this._root, { childList: true, subtree: true });
    }
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
    const start = performance.now();
    const roots = [...this._pending];
    this._pending.clear();
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (root.isConnected) {
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
      // RDA 16ms frame budget slicing
      if (i < roots.length - 1 && performance.now() - start > NUTRI_SCANNER_SLICE_MS) {
        for (let j = i + 1; j < roots.length; j++) {
          this._pending.add(roots[j]);
        }
        _ric(() => this._drainRoots());
        break;
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
      if (this._checkBreaker(batch)) continue;
      this._inflight++;
      const obs = typeof NutriObs !== "undefined" ? NutriObs : null;
      const batchId = obs?.startTrace ? obs.startTrace() : `b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const batchMark = `ns:batch:${batchId}`;
      const rpcStartMark = `ns:rpc_start:${batchId}`;
      batch._id = batchId;
      batch._mk = batchMark;
      batch._rStart = rpcStartMark;
      obs?.mark(batchMark);
      obs?.mark("ns:batch");
      obs?.mark(rpcStartMark);

      void this._score(batch).finally(() => {
        this._inflight--;
        if (this._queue.length > 0) void this._flush();
      });
    }
  }

  // ── 3. SCORING ────────────────────────────────────────────────────────────

  _checkBreaker(batch) {
    if (this._breaker && this._breaker.isOpen()) {
      self.NutriObs?.count("breaker_skip_rpc", 1);
      batch.forEach((c) => {
        if (this._adapter.injectNeutral) this._adapter.injectNeutral(c.el);
        else this._adapter.inject(c.el, { nutriscore_grade: "UNKNOWN", scoringStatus: "not_attempted" });
      });
      return true;
    }
    return false;
  }

  _scheduleRpcTimeout(batch, resolve) {
    return setTimeout(() => {
      this._breaker?.recordFailure();
      self.NutriObs?.count("sw_rpc_timeout", 1);
      batch.forEach((c) => this._retryLater(c));
      resolve();
    }, NUTRI_SCANNER_RPC_DEADLINE_MS);
  }

  async _score(batch) {
    if (this._checkBreaker(batch)) return;
    return new Promise(resolve => {
      const payloads = batch.map(c => ({ product_name: c.item?.name || c.item?.product_name, retailer_product_id: c.item?.id || c.item?.retailer_product_id, price: c.item?.price, url: c.item?.url, name_hash: c.item?.name_hash }));
      const timer = this._scheduleRpcTimeout(batch, resolve);
      this._safeSend({ action: "CHECK_PRODUCT_SCORES_BATCH", retailer: this._adapter.getRetailerCode(), payloads, trace: { id: batch._id } }, (response) => {
        if (timer) clearTimeout(timer);
        self.NutriObs?.measure("sw_rpc_ms", batch._rStart);
        try {
          if (!response?.ok) { self.NutriObs?.count("sw_rpc_fail", 1); this._breaker?.recordFailure(); }
          else this._breaker?.recordSuccess();
          const results = response?.ok ? (response.response?.results || []) : [];
          batch.forEach((c, i) => {
            const r = results[i];
            if (!r || (r.status === "error" && r.retryable)) { this._retryLater(c); return; }
            const product = (r.status === "SUCCESS" && r.data) ? r.data : (r.data || r);
            this._adapter.inject(c.el, product);
            self.NutriObs?.mark("ns:painted");
            self.NutriObs?.measure("badge_ms", batch._mk);
          });
        } catch {
          this._breaker?.recordFailure();
          o?.count("eval_error", 1);
          batch.forEach((c) => this._retryLater(c));
        }
        resolve();
      });
    });
  }

  _retryLater(c) {
    const n = (this._attempts.get(c.el) ?? 0) + 1;
    this._attempts.set(c.el, n);
    if (n >= NUTRI_SCANNER_MAX_ATTEMPTS) {
      const obs = typeof NutriObs !== "undefined" ? NutriObs : null;
      obs?.count("neutral_fallback", 1);
      // Give up: render neutral badge (T-13 zero blocks)
      if (this._adapter.injectNeutral) {
        this._adapter.injectNeutral(c.el);
      } else {
        this._adapter.inject(c.el, { nutriscore_grade: "UNKNOWN", scoringStatus: "not_attempted" });
      }
      return; // give up; next rescan resets counter
    }
    // ADR-9: Full jitter backoff: Math.random() * Math.min(2000, 150 * 2 ** n)
    const delay = Math.random() * Math.min(2000, 150 * Math.pow(2, n));
    setTimeout(() => {
      this._seen.delete(c.el); // eligible for re-discovery
      this._enqueueRoot(c.el);
    }, delay);
  }
}

NutriScanner.CircuitBreaker = NutriCircuitBreaker;
