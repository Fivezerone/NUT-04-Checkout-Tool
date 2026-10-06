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

  // D-16: guard against 'Extension context invalidated' after extension update
  _safeSend(msg, cb) {
    try { return chrome.runtime.sendMessage(msg, cb); } catch { return undefined; }
  }

  init() {
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
            chrome.runtime.sendMessage({ action: "CART_CLEARED", retailer: removed.retailer });
            this.lastCartHadItems = false;
            this.lastCartStr = "";
          } else {
            chrome.runtime.sendMessage({ action: "REMOVE_CART_ITEM", payload: removed });
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
      // D-15d: on theme/tier change, full rescan so badges get fresh productResult
      if (msg.action === "THEME_CHANGED") {
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
    this.observer.observe(observeTarget, { childList: true, subtree: true });

    this._startNavMonitor();

    this.scanAndInject();
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
        chrome.runtime.sendMessage({
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
        // Only add if not already extracted from DOM
        if (!itemMap.has(i.productId)) {
           itemMap.set(i.productId, i);
        }
      });
      cartItems = Array.from(itemMap.values());
    }
    
    // 3. Detect cart cleared: had items before, now empty Only detect cart cleared if we are actually checking the API, or if we know the cart DOM is visible. If we only check DOM (fetchApi=false) and the sidebar is closed, extractCartState returns []. To prevent false positives, we only trigger CART_CLEARED if fetchApi=true (which uses the true API state) OR if we know for sure the DOM cart is rendered but empty. For now, rely on fetchApi=true.
    if (fetchApi && cartItems.length === 0 && this.lastCartHadItems) {
      console.log("[NutriScore] Cart cleared -- updating dashboard.");
      chrome.runtime.sendMessage({
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
      chrome.runtime.sendMessage({
        action: "SYNC_CART_STATE",
        payload: {
          retailer: this.adapter.getRetailerCode(),
          items: cartItems
        }
      });
    }
  }

  // D-15d: full rescan — clear all caches and re-inject with current mode/tier
  rescan() {
    if (typeof NutriSharedUI !== 'undefined' && NutriSharedUI._closeActiveFlyout) {
      NutriSharedUI._closeActiveFlyout();
    }
    // D-16: WeakSet cannot be iterated — create a new one for rescan
    this.processedElements = new WeakSet();
    this.notFoundCache = new Set();
    document.querySelectorAll('.nutriscore-isolated-root').forEach(n => n.remove());
    document.querySelectorAll('[data-nutriscore-scanned]').forEach(n => n.removeAttribute('data-nutriscore-scanned'));
    this.scanAndInject();
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

    // D-16: use safeSend so 'Extension context invalidated' after an update doesn't crash
    this._safeSend(message, response => {
      if (chrome.runtime.lastError) {
        console.warn("[NutriScore] SW message failed:", chrome.runtime.lastError.message);
        batch.forEach(({ card }) => { card.removeAttribute("data-nutriscore-scanned"); this.processedElements.delete(card); });
        return;
      }

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
            card.setAttribute("data-nutriscore-scanned", definitive ? "not-found" : "error");
            if (definitive && cacheKey) this.notFoundCache.add(cacheKey);
            else this.processedElements.delete(card);
          }
        });
      } else {
        batch.forEach(({ card }) => { card.setAttribute("data-nutriscore-scanned", "error"); this.processedElements.delete(card); });
      }
      
      chrome.runtime.sendMessage({ action: "POPUP_STATS_UPDATE" }).catch(() => {});
    });
  }
}

// Boot (manifest run_at: document_end handles timing)
const engine = new NutriScoreContentEngine();
engine.init();
