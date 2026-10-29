/* Content Script Component Layer: Client / Frontend Extension Layer Constraints (Component Diagram v1.0):   - NO business logic, classification, or disease evaluation   - Only: adapter routing, MutationObserver, message relay, badge injection via adapter */

// ARCH-002: Guard against manifest.json load-order violations.
// shared-ui.js must appear before this file in content_scripts.
// NOTE: NutriScoreDB lives only in the service worker — never check it here.
if (typeof NutriSharedUI === "undefined") {
  console.error("[NutriScore] Load-order violation: NutriSharedUI not available. Check manifest.json content_scripts ordering.");
  throw new Error("[NutriScore] content.js: NutriSharedUI not available");
}

class NutriScoreContentEngine {
  constructor() {
    this.adapter          = window.RetailerAdapter || null;
    // D-16: WeakSet so DOM nodes can be GC'd on infinite scroll (no memory leak)
    this.processedElements = new WeakSet();
    this.notFoundCache    = new Set();
    this.observer         = null;
    this.debounceTimer    = null;   // scan debounce — 300ms
    this.cartDebounceTimer = null;  // P3: cart debounce — 1000ms (separate, longer)
    this.lastCartStr      = "";
    this.lastCartHadItems = false;
    this.orderDetected    = false;
    this.lastHref         = location.href;
  }

  _safeSend(message, callback) {
    try {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) { callback?.({ ok: false, error: "EXTENSION_CONTEXT_INVALIDATED" }); return; }
        callback?.({ ok: true, response });
      });
    } catch { callback?.({ ok: false, error: "EXTENSION_CONTEXT_INVALIDATED" }); }
  }

  init() {
    if (!this.adapter) {
      this.adapter = window.RetailerAdapter || (typeof globalThis !== "undefined" ? globalThis.RetailerAdapter : null);
    }
    if (!this.adapter) {
      console.warn("[NutriScore] No RetailerAdapter found on window.RetailerAdapter. Aborting.");
      return;
    }
    console.log(`[NutriScore] Adapter loaded: ${this.adapter.getRetailerCode()}`);

    // Click handler: cart add/remove only. P2/P7: activeFlyouts loop removed — Feature C (_closeActiveFlyout / global portal) handles flyout lifecycle.
    document.addEventListener("click", (e) => {
      if (!this.adapter) return;
      let isRemove = false;

      if (this.adapter.extractRemoveAction) {
        const removed = this.adapter.extractRemoveAction(e.target);
        if (removed) {
          isRemove = true;
          if (removed.clearAll) {
            this._safeSend({ action: "CART_CLEARED", retailer: removed.retailer });
            this.lastCartHadItems = false;
            this.lastCartStr = "";
          } else {
            this._safeSend({ action: "REMOVE_CART_ITEM", payload: removed });
          }
        }
      }

      if (!isRemove && this.adapter.extractCartAction) {
        const item = this.adapter.extractCartAction(e.target);
        if (item) {
          // D-16: use safeSend to survive extension context invalidation
          this._safeSend({ action: "LOG_CART_ADD", payload: item });
        }
      }
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === "GET_PAGE_STATS") {
        const count = document.querySelectorAll('[data-nutriscore-scanned="complete"]').length;
        const total = document.querySelectorAll('[data-nutriscore-scanned]').length;
        const retailer = this.adapter ? this.adapter.getRetailerCode() : null;
        sendResponse({ count, total, retailer });
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && (changes.uiTheme || changes.settings_live || changes.user_preferences)) {
        this.rescan();
      }
    });

    // P3: Two separate debounce timers. scanAndInject: 300ms — fires on new product cards appearing (lazy load, SPA nav). syncCart: 1000ms — fires less aggressively; cart state changes much less than DOM mutations.
    this.observer = new MutationObserver(mutations => {
      // D-16: ignore mutations caused by our own injected nodes to prevent feedback loop
      const relevant = mutations.some(m =>
        [...m.addedNodes, ...m.removedNodes].some(n =>
          !(n.nodeType === 1 && (
            n.classList?.contains('nutriscore-isolated-root') ||
            n.id === 'nutriscore-global-portal'
          ))
        )
      );
      if (!relevant) return;

      // Scan debounce: 300ms
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.scanAndInject();
        this.checkOrderConfirmation();
      }, 300);

      // Cart debounce: 1000ms — separate, longer window prevents thrashing on image loads / Livewire pings
      if (this.cartDebounceTimer) clearTimeout(this.cartDebounceTimer);
      this.cartDebounceTimer = setTimeout(() => {
        this.syncCart();
      }, 1000);
    });

    const observeTarget = (this.adapter.getObserveTarget && this.adapter.getObserveTarget()) || document.body;

    // F-05: Use NutriScanner when the adapter implements candidatesIn() (viewport-gated,
    // incremental scanning — O(added cards) instead of O(total cards) per mutation burst).
    // Falls back to the legacy MutationObserver+debounce+scanAndInject() path for adapters
    // that haven't yet implemented the new interface.
    if (typeof NutriScanner === "function" && typeof this.adapter.candidatesIn === "function") {
      this._scanner = new NutriScanner(this.adapter, this._safeSend.bind(this), observeTarget);
      this._scanner.start();

      // Cart debounce needs its own observer since NutriScanner's MO only enqueues scan work.
      // P1-fix: only schedule syncCart when a mutation touches a cart-related container,
      // not on every DOM mutation (image loads, product card lazy-load, Livewire pings).
      const CART_SELECTORS = '#sideCartJs, .cart-summary, .cart-listing, .cart-item, .cart-product, [class*="cart"], [class*="basket"], [data-cart], .mini-cart, .offcanvas-cart, .dropdown-cart';
      this._cartObserver = new MutationObserver((mutations) => {
        const cartMutated = mutations.some(m => {
          const target = m.target;
          if (target.nodeType !== 1) return false;
          // Check if the mutated target is inside or is a cart container
          return target.closest?.(CART_SELECTORS) ||
                 target.matches?.(CART_SELECTORS) ||
                 [...m.addedNodes, ...m.removedNodes].some(n =>
                   n.nodeType === 1 && (n.matches?.(CART_SELECTORS) || n.querySelector?.(CART_SELECTORS))
                 );
        });
        if (!cartMutated) return;
        if (this.cartDebounceTimer) clearTimeout(this.cartDebounceTimer);
        this.cartDebounceTimer = setTimeout(() => this.syncCart(), 1000);
      });
      this._cartObserver.observe(observeTarget, { childList: true, subtree: true });

    } else {
      // Legacy path (adapter has no candidatesIn)
      this.observer = new MutationObserver((mutations) => {
        // D-16: ignore mutations from our own injected nodes to prevent feedback loop
        const relevant = mutations.some((m) =>
          [...m.addedNodes, ...m.removedNodes].some((n) =>
            !(n.nodeType === 1 && (
              n.classList?.contains("nutriscore-isolated-root") ||
              n.id === "nutriscore-global-portal"
            ))
          )
        );
        if (!relevant) return;

        // Scan debounce: 300ms
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.scanAndInject();
          this.checkOrderConfirmation();
        }, 300);

        // Cart debounce: 1000ms
        if (this.cartDebounceTimer) clearTimeout(this.cartDebounceTimer);
        this.cartDebounceTimer = setTimeout(() => this.syncCart(), 1000);
      });
      this.observer.observe(observeTarget, { childList: true, subtree: true });
    }

    this._startNavMonitor();

    // Initial scan + cart snapshot
    if (this._scanner) {
      // NutriScanner.start() already enqueued the initial full-root scan
    } else {
      this.scanAndInject();
    }
    this.syncCart(true);
    this.checkOrderConfirmation();
  }


  /* Poll for URL changes (covers SPA navigation on both Naivas and Carrefour). Falls back gracefully when the Navigation API is not available. */
  _startNavMonitor() {
    // Modern Navigation API (Chrome 102+)
    if (typeof navigation !== "undefined") {
      navigation.addEventListener("navigate", () => {
        setTimeout(() => {
          this.orderDetected = false;
          this.syncCart(true);
          this.checkOrderConfirmation();
        }, 800); // give the new page time to render
      });
    } else {
      // Polling fallback for older Chrome or Naivas (Magento multi-page)
      setInterval(() => {
        if (location.href !== this.lastHref) {
          this.lastHref = location.href;
          // Reset order detection flag on new page
          this.orderDetected = false;
          setTimeout(() => {
            this.syncCart(true);
            this.checkOrderConfirmation();
          }, 800);
        }
      }, 1000);
    }
  }

  /* Check whether the current page is an order confirmation page. If so, mark all in-cart items as purchased. */
  checkOrderConfirmation() {
    if (this.orderDetected) return; // only fire once per page load
    if (!this.adapter || !this.adapter.detectOrderConfirmation) return;

    try {
      if (this.adapter.detectOrderConfirmation()) {
        this.orderDetected = true;
        console.log("[NutriScore] Order confirmation detected -- marking cart as purchased.");
        this._safeSend({
          action: "ORDER_PLACED",
          retailer: this.adapter.getRetailerCode()
        });
      }
    } catch (e) {
      console.warn("[NutriScore] detectOrderConfirmation error:", e);
    }
  }

  async syncCart(fetchApi = false) {
    if (!this.adapter) return;

    // F-06: only a visible tab should capture and send cart snapshots.
    // Hidden tabs (preloaded pages, background tabs) see stale DOM / incomplete API responses.
    if (document.visibilityState !== "visible") return;

    try {
      let cartItems = [];
      // 1. Extract from DOM (Sidebar/flyout if open)
      if (this.adapter.extractCartState) {
        cartItems = this.adapter.extractCartState();
      }

      // 2. Auto-detect from API silently (only on page load or explicit navigation)
      if (fetchApi && this.adapter.fetchCartFromAPI) {
        const apiItems = await this.adapter.fetchCartFromAPI();
        // Merge, giving preference to DOM items (what the user actually sees)
        const itemMap = new Map();
        cartItems.forEach(i => itemMap.set(i.productId, i));
        apiItems.forEach(i => {
          if (!itemMap.has(i.productId)) {
             itemMap.set(i.productId, i);
          }
        });
        cartItems = Array.from(itemMap.values());
      }

      if (fetchApi && cartItems.length === 0 && this.lastCartHadItems) {
        console.log("[NutriScore] Cart cleared -- updating dashboard.");
        this._safeSend({
          action: "CART_CLEARED",
          retailer: this.adapter.getRetailerCode()
        });
        this.lastCartHadItems = false;
        this.lastCartStr = "";
        return;
      }

      if (cartItems.length > 0) {
        this.lastCartHadItems = true;
      }

      const cartStr = JSON.stringify(cartItems);
      if (cartStr !== this.lastCartStr) {
        this.lastCartStr = cartStr;
        this._safeSend({
          action: "SYNC_CART_STATE",
          payload: {
            retailer: this.adapter.getRetailerCode(),
            items: cartItems,
            // F-06: SW uses capturedAt to reject snapshots older than the last accepted one per retailer.
            capturedAt: Date.now(),
          }
        });
      }
    } catch (e) {
      console.warn("[NutriScore] syncCart error:", e);
    }
  }

  // D-15d: full rescan — clear all caches and re-inject with current mode/tier
  rescan() {
    if (typeof NutriSharedUI !== "undefined" && NutriSharedUI._closeActiveFlyout) {
      NutriSharedUI._closeActiveFlyout();
    }
    document.querySelectorAll(".nutriscore-isolated-root").forEach((n) => n.remove());
    document.querySelectorAll("[data-nutriscore-scanned]").forEach((n) => n.removeAttribute("data-nutriscore-scanned"));

    if (this._scanner) {
      // F-05: NutriScanner.rescan() resets seen/attempt state and re-enqueues the whole root
      this._scanner.rescan();
    } else {
      // Legacy path
      this.processedElements = new WeakSet();
      this.notFoundCache = new Set();
      this.scanAndInject();
    }
  }


  scanAndInject() {
    if (!this.adapter) return;

    const products = this.adapter.detectProducts();
    const batch = [];

    products.forEach(prodInfo => {
      const card = prodInfo.domElement;
      const cacheKey = prodInfo.id || prodInfo.name;

      if (this.processedElements.has(card)) return;
      if (cacheKey && this.notFoundCache.has(cacheKey)) {
        card.setAttribute("data-nutriscore-scanned", "not-found");
        return;
      }

      // Mark pending to prevent duplicate async fetches
      card.setAttribute("data-nutriscore-scanned", "pending");
      this.processedElements.add(card);

      batch.push({
        card,
        cacheKey,
        payload: {
          product_name:        prodInfo.name,
          name_hash:           prodInfo.nameHash || null,
          retailer_product_id: prodInfo.id || null,
          url:                 prodInfo.url || null,
          price:               prodInfo.price || null
        }
      });
    });

    if (batch.length === 0) return;

    const message = {
      action: "CHECK_PRODUCT_SCORES_BATCH",
      retailer: this.adapter.getRetailerCode(),
      payloads: batch.map(b => b.payload)
    };

    this._safeSend(message, result => {
      if (!result || !result.ok) {
        console.warn("[NutriScore] SW message failed:", result?.error);
        batch.forEach(({ card }) => { card.removeAttribute("data-nutriscore-scanned"); this.processedElements.delete(card); });
        return;
      }

      const response = result.response;
      if (response?.status === "SUCCESS" && Array.isArray(response.results)) {
        response.results.forEach((res, index) => {
          const item = batch[index];
          if (!item) return;
          const { card, cacheKey, payload } = item;

          if (res.status === "SUCCESS" && res.data) {
            const product = res.data;
            card.setAttribute("data-nutriscore-scanned", "complete");
            card.setAttribute("data-nutriscore-grade", product.nutriscore_grade || "UNKNOWN");
            try { this.adapter.injectBadge(card, product, payload.price); }
            catch (e) { console.warn("[NutriScore] injectBadge failed:", e); card.removeAttribute("data-nutriscore-scanned"); this.processedElements.delete(card); }
          } else {
            const definitive = /^Product not found/i.test(res.error || "");
            card.setAttribute("data-nutriscore-scanned", definitive ? 'not-found' : 'error');
            if (definitive && cacheKey) this.notFoundCache.add(cacheKey);
            else this.processedElements.delete(card);
          }
        });
      } else {
        // Batch infrastructure failure
        batch.forEach(({ card }) => { card.setAttribute("data-nutriscore-scanned", 'error'); this.processedElements.delete(card); });
      }
      
      this._safeSend({ action: "POPUP_STATS_UPDATE" });
    });
  }

  // Fix #8: full lifecycle teardown — disconnect all observers and timers.
  destroy() {
    if (this._scanner) {
      this._scanner.destroy();
      this._scanner = null;
    }
    if (this._cartObserver) {
      this._cartObserver.disconnect();
      this._cartObserver = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    clearTimeout(this.debounceTimer);
    clearTimeout(this.cartDebounceTimer);
    this.debounceTimer = null;
    this.cartDebounceTimer = null;
  }
}

// Boot (manifest run_at: document_end handles timing)
const engine = new NutriScoreContentEngine();
engine.init();

// Fix #8: release observers + detached DOM refs on page teardown
window.addEventListener("pagehide", () => engine.destroy(), { once: true });
