/**
 * Content Script
 * Component Layer: Client / Frontend Extension Layer
 * Constraints (Component Diagram v1.0):
 *   - NO business logic, classification, or disease evaluation
 *   - Only: adapter routing, MutationObserver, message relay, badge injection via adapter
 */

class NutriScoreContentEngine {
  constructor() {
    this.adapter      = window.RetailerAdapter || null;
    this.processedElements = new Set();
    this.observer     = null;
    this.debounceTimer = null;
    this.lastCartStr  = "";
    this.lastCartHadItems = false;
    this.orderDetected = false;
    this.lastHref     = location.href;
  }

  init() {
    if (!this.adapter) {
      console.warn("[NutriScore] No RetailerAdapter found on window.RetailerAdapter. Aborting.");
      return;
    }
    console.log(`[NutriScore] Adapter loaded: ${this.adapter.getRetailerCode()}`);
    this.activeFlyouts = new Set();

    document.addEventListener("click", (e) => {
      if (this.adapter) {
        let isRemove = false;
        // Check for item removal first (highest priority)
        if (this.adapter.extractRemoveAction) {
          const removed = this.adapter.extractRemoveAction(e.target);
          if (removed) {
            isRemove = true;
            if (removed.clearAll) {
              // "Clear Cart" button — wipe all in_cart items immediately
              chrome.runtime.sendMessage({
                action: "CART_CLEARED",
                retailer: removed.retailer
              });
              this.lastCartHadItems = false;
              this.lastCartStr = "";
            } else {
              chrome.runtime.sendMessage({
                action: "REMOVE_CART_ITEM",
                payload: removed
              });
            }
          }
        }
        // Check for add-to-cart only if not a remove action
        if (!isRemove && this.adapter.extractCartAction) {
          const item = this.adapter.extractCartAction(e.target);
          if (item) {
            chrome.runtime.sendMessage({
              action: "LOG_CART_ADD",
              payload: item
            });
          }
        }
      }

      if (this.activeFlyouts.size === 0) return;
      const path = e.composedPath();
      for (const shadow of this.activeFlyouts) {
        // Garbage collect detached shadows
        if (!shadow.host || !document.contains(shadow.host)) {
          this.activeFlyouts.delete(shadow);
          continue;
        }
        if (!path.includes(shadow.host)) {
          const flyout = shadow.querySelector(".flyout");
          if (flyout && flyout.classList.contains("open")) {
            flyout.classList.remove("open");
          }
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

    // 300ms debounce per topology specification
    this.observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.scanAndInject();
          this.syncCart();
          this.checkOrderConfirmation();
        }, 300);
      }
    });

    const observeTarget = (this.adapter.getObserveTarget && this.adapter.getObserveTarget()) || document.body;
    this.observer.observe(observeTarget, { childList: true, subtree: true });

    // Monitor SPA navigations (Next.js / React Router do not fire full page loads)
    this._startNavMonitor();

    this.notFoundCache = new Set();
    this.scanAndInject();
    this.syncCart(true);
    this.checkOrderConfirmation();
  }

  /**
   * Poll for URL changes (covers SPA navigation on both Naivas and Carrefour).
   * Falls back gracefully when the Navigation API is not available.
   */
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

  /**
   * Check whether the current page is an order confirmation page.
   * If so, mark all in-cart items as purchased.
   */
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
    
    // 3. Detect cart cleared: had items before, now empty
    // Only detect cart cleared if we are actually checking the API, or if we know the cart DOM is visible.
    // If we only check DOM (fetchApi=false) and the sidebar is closed, extractCartState returns [].
    // To prevent false positives, we only trigger CART_CLEARED if fetchApi=true (which uses the true API state)
    // OR if we know for sure the DOM cart is rendered but empty. For now, rely on fetchApi=true.
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

  scanAndInject() {
    if (!this.adapter) return;

    const products = this.adapter.detectProducts();

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

      chrome.runtime.sendMessage(
        {
          action:  "CHECK_PRODUCT_SCORE",
          retailer: this.adapter.getRetailerCode(),
          payload: {
            product_name:        prodInfo.name,
            name_hash:           prodInfo.nameHash || null,
            retailer_product_id: prodInfo.id || null,
            url:                 prodInfo.url || null,
            price:               prodInfo.price || null
          }
        },
        response => {
          if (chrome.runtime.lastError) {
            console.warn("[NutriScore] SW message error:", chrome.runtime.lastError.message);
            card.removeAttribute("data-nutriscore-scanned");
            this.processedElements.delete(card);
            return;
          }

          if (response && response.status === "SUCCESS" && response.data) {
            const product = response.data;
            card.setAttribute("data-nutriscore-scanned", "complete");
            card.setAttribute("data-nutriscore-grade",   product.nutriscore_grade);
            // Delegate all UI rendering to the adapter (no logic here)
            const shadowRoot = this.adapter.injectBadge(card, product, prodInfo.price);
            if (shadowRoot) this.activeFlyouts.add(shadowRoot);
          } else {
            card.setAttribute("data-nutriscore-scanned", "not-found");
            if (cacheKey) this.notFoundCache.add(cacheKey);
          }
        }
      );
    });
  }
}

// Boot after a short delay to let the adapter script fully initialise
setTimeout(() => {
  const engine = new NutriScoreContentEngine();
  engine.init();
}, 300);
