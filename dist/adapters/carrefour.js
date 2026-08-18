/**
 * Carrefour Kenya Retailer Adapter
 * Implements IRetailerAdapter contract
 * Primary ID: numeric product ID from anchor href "/p/<id>"
 * Fallback:   name_hash
 */

const CarrefourAdapter = {

  getRetailerCode() {
    return "CARREFOUR";
  },

  getObserveTarget() {
    return document.body;
  },

  detectProducts() {
    const products = [];

    // Most robust way: find ALL product links first. A product link is an anchor containing "/p/" or "/product/".
    const productLinks = document.querySelectorAll("a[href*='/p/'], a[href*='/product/']");
    const processedCards = new Set();

    productLinks.forEach(anchor => {
        // The outer Carrefour product card is a flex-col div with style="grid-column:span N".
        // All other selectors resolved to inner wrappers, causing badge mis-placement.
        let card = anchor.closest('[style*="grid-column"]') ||
                   anchor.closest("li") ||
                   anchor.closest("[data-testid='product-card']") ||
                   anchor.closest(".cl-product-card") ||
                   anchor.closest("li[class*='product']") ||
                   anchor.closest("div[class*='product-card']") ||
                   anchor.closest("div[class*='ProductCard']");

        if (!card) card = anchor.parentElement;
        // If we landed on the narrow text-only inner div (max-w-[134px]), walk up to the real card.
        if (card && card.parentElement && card.parentElement.style?.gridColumn) {
          card = card.parentElement;
        }
      if (!card || processedCards.has(card)) return;
      if (card.hasAttribute("data-nutriscore-scanned")) {
        if (!card.querySelector(".nutriscore-isolated-root")) {
          card.removeAttribute("data-nutriscore-scanned");
        } else {
          return;
        }
      }

      processedCards.add(card);

      // 1. Extract Product ID from the href
      let retailerProductId = null;
      const match = anchor.href.match(/\/(?:p|product)\/(\d+)/);
      if (match) retailerProductId = match[1];
      if (!retailerProductId) {
        retailerProductId = card.getAttribute("data-product-id") || card.getAttribute("data-id") || null;
      }

      // 2. Extract Name
      let name = "";
      const nameEl = card.querySelector("[data-testid='product-title'], h2, h3, h4, [class*='title'], [class*='name']");
      if (nameEl) name = nameEl.textContent?.trim() || "";
      
      if (!name) {
        name = anchor.getAttribute("title") || anchor.getAttribute("aria-label") || "";
      }
      
      if (!name) {
         const text = anchor.textContent?.trim() || "";
         if (text && !text.match(/^kes\s*[\d,.]+$/i)) {
             name = text;
         }
      }

      if (!name) return;

      // 3. Extract Price
      let priceNumeric = 0;
      const priceEl = card.querySelector("[data-testid='product-price'], [class*='price'], [class*='Price'], .text-lg.font-bold, .text-xl.font-bold");
      if (priceEl) {
        priceNumeric = NutriSharedUI.parsePrice(priceEl.textContent);
      }

      products.push({
        domElement:         card,
        id:                 retailerProductId,
        name:               name,
        nameHash:           null,
        price:              priceNumeric,
        scrapedCategory:    "",
        url:                anchor.href
      });
    });

    return products;
  },

  injectBadge(card, productResult, price) {
    return NutriSharedUI.injectBadge(card, productResult, price);
  },

  extractCartState() {
    const items = [];
    const cartContainers = document.querySelectorAll("a[href*='/p/']");
    
    // We want to avoid duplicate counting if there are multiple links for the same cart item
    const processedIds = new Set();
    
    cartContainers.forEach(anchor => {
      // Find the card container (often the relative flex item containing the trash button)
      const card = anchor.closest(".relative.flex.items-start.gap-md") || anchor.closest("div[class*='relative flex items-start gap-md']");
      if (!card) return;
      
      const match = anchor.href.match(/\/(?:p|product)\/(\d+)/);
      if (!match) return;
      const productId = match[1];
      
      if (processedIds.has(productId)) return;
      
      // We know it's a cart item if it has a trash button (data-testid="trash-icon") or combobox
      const hasTrash = card.querySelector("[data-testid='trash-icon']");
      const hasCombobox = card.querySelector("button[role='combobox']");
      if (!hasTrash && !hasCombobox) return; // Not a cart item, maybe a product grid item
      
      processedIds.add(productId);
      
      // Name
      let name = "";
      
      // 1. Prefer text inside the anchor (avoids bad image alt tags)
      const anchors = card.querySelectorAll("a[href*='/p/']");
      for (const a of anchors) {
        const textEl = a.querySelector(".line-clamp-1, [class*='name']");
        if (textEl && textEl.textContent.trim()) {
           name = textEl.textContent.trim();
           break;
        }
      }
      
      // 2. Fallback to anchor's direct text if no .line-clamp-1
      if (!name) {
        for (const a of anchors) {
          const txt = a.textContent.trim();
          if (txt) { name = txt; break; }
        }
      }
      
      // 3. Fallback to image alt
      if (!name) {
        const img = card.querySelector("img");
        if (img && img.getAttribute("alt")) name = img.getAttribute("alt").trim();
      }
      
      // 4. Ultimate fallback to any line-clamp in the card
      if (!name) {
          const textEl = card.querySelector(".line-clamp-1, [data-testid='cart-product-name']");
          if (textEl) name = textEl.textContent.trim();
      }
      
      // Price
      let price = 0;
      // Look for the specific div holding the price number, or a data-testid
      const priceWrapper = card.querySelector("[data-testid='product-price'], .text-lg.leading-5.font-bold, .text-xl.font-bold, .text-lg.font-bold");
      if (priceWrapper) {
        price = NutriSharedUI.parsePrice(priceWrapper.textContent);
      } else {
        // Fallback: look for KES
        const allText = card.textContent || "";
        const kesMatch = allText.match(/KES\s*([\d,.]+)/i);
        if (kesMatch) price = parseFloat(kesMatch[1].replace(/,/g, ''));
      }
      
      // Quantity
      let quantity = 1;
      const qtyBtn = card.querySelector("button[role='combobox'] span");
      if (qtyBtn) {
        quantity = parseInt(qtyBtn.textContent?.trim() || "1", 10) || 1;
      }
      
      items.push({
        retailer: "CARREFOUR",
        productId,
        product_name: name,
        priceSnapshot: price,
        quantity,
        url: anchor.href || null
      });
    });
    
    return items;
  },

  /**
   * Fetches cart state from Carrefour APIs silently on page load.
   * Checks window.__NEXT_DATA__ (Next.js SSR), then falls back to the cart JSON API.
   * Returns array of cart items without requiring the cart flyout to be open.
   */
  async fetchCartFromAPI() {
    // Strategy 1: Read Next.js SSR page data
    try {
      const nextDataScript = document.getElementById('__NEXT_DATA__');
      if (nextDataScript) {
        const nextData = JSON.parse(nextDataScript.textContent);
        const cart = nextData?.props?.pageProps?.initialData?.cart ||
                     nextData?.props?.pageProps?.cart ||
                     nextData?.props?.cart;
        if (cart?.items?.length) {
          return cart.items.map(item => ({
            retailer: 'CARREFOUR',
            productId: String(item.productCode || item.id || item.ean || ''),
            product_name: item.product?.name || item.name || '',
            priceSnapshot: item.basePrice || item.totalPrice || item.price || 0,
            quantity: item.quantity || 1,
            url: item.product?.url ? `https://www.carrefour.ke${item.product.url}` : null
          })).filter(i => i.productId);
        }
      }
    } catch (e) { /* silent */ }

    // Strategy 2: Fetch cart JSON API (Carrefour OCC/SAP Commerce style)
    try {
      // Try common cart API paths used by Carrefour Kenya (SAP Commerce Cloud)
      const endpoints = [
        '/api/cart',
        '/mafken/en/cart',
      ];
      for (const ep of endpoints) {
        const res = await fetch(ep, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) {
            const data = await res.json();
            const entries = data?.entries || data?.items || data?.cartData?.entries || [];
            if (entries.length > 0) {
              return entries.map(e => ({
                retailer: 'CARREFOUR',
                productId: String(e.product?.code || e.productCode || e.id || ''),
                product_name: e.product?.name || e.name || '',
                priceSnapshot: e.basePrice?.value || e.totalPrice?.value || e.price || 0,
                quantity: e.quantity || 1,
                url: e.product?.url ? `https://www.carrefour.ke${e.product.url}` : null
              })).filter(i => i.productId);
            }
          }
        }
      }
    } catch (e) {
      // Silent catch; fallback to DOM extraction if API is unavailable or blocked
    }
    return [];
  },

  extractCartAction(node) {
    const btn = node.closest("button");
    if (!btn) return null;
    
    const aria = btn.getAttribute("aria-label") || "";
    const text = btn.textContent || "";
    if (!aria.toLowerCase().includes("add to cart") && !text.toLowerCase().includes("add to cart")) return null;
    
    const card = btn.closest("li") || btn.closest("[data-testid='product-card']") || btn.closest(".cl-product-card") || document.body;
    
    let name = "";
    const nameEl = card.querySelector("[data-testid='product-title'], h1, h2, h3, [class*='title'], [class*='name']");
    if (nameEl) name = nameEl.textContent.trim();
    
    let price = 0;
    const priceEl = card.querySelector("[data-testid='product-price'], [class*='price'], .text-xl.font-bold, .text-lg.font-bold");
    if (priceEl) {
       price = NutriSharedUI.parsePrice(priceEl.textContent);
    }
    
    let id = card.getAttribute("data-product-id") || card.getAttribute("data-id");
    if (!id) {
       const anchor = card.querySelector("a[href*='/p/']");
       if (anchor) {
          const match = anchor.href.match(/\/(?:p|product)\/(\d+)/);
          if (match) id = match[1];
       }
    }
    if (!id) {
       const match = window.location.href.match(/\/(?:p|product)\/(\d+)/);
       if (match) id = match[1];
    }
    
    if (!id && !name) return null;
    
    return {
       retailer: "CARREFOUR",
       productId: id || NutriSharedUI.generateIdFromName(name),
       product_name: name,
       priceSnapshot: price,
       quantity: 1
    };
  },

  escapeHTML(str) {
    return NutriSharedUI.escapeHTML(str);
  },

  /**
   * Returns true when the current page is an order confirmation page.
   * Carrefour Kenya uses Next.js; we check __NEXT_DATA__ props and URL patterns.
   */
  detectOrderConfirmation() {
    const url = window.location.href.toLowerCase();
    // URL-based signals for Carrefour Kenya
    const successPatterns = [
      '/order/confirmation',
      '/checkout/order-confirmation',
      '/checkout/confirmation',
      '/order-confirmation',
      '/thankyou',
      '/thank-you',
      'order_success',
      'order-success',
    ];
    if (successPatterns.some(p => url.includes(p))) return true;
    // Next.js SSR page props check
    try {
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl) {
        const data = JSON.parse(nextDataEl.textContent);
        const pageProps = data?.props?.pageProps || {};
        // Order confirmation pages typically have an order object
        if (pageProps.order || pageProps.orderCode || pageProps.confirmationData) return true;
      }
    } catch (e) { /* silent */ }
    // DOM-based signals
    const domSignals = [
      '[data-testid="order-confirmation"]',
      '[data-testid="confirmation-number"]',
      '[class*="order-confirmation"]',
      '[class*="OrderConfirmation"]',
      '.order-confirmation',
    ];
    for (const sel of domSignals) {
      if (document.querySelector(sel)) return true;
    }
    return false;
  }
};

window.RetailerAdapter = CarrefourAdapter;
