/* Carrefour Kenya Retailer Adapter
 * Implements IRetailerAdapter contract
 * Primary ID: numeric product ID from anchor href "/p/<id>"
 * Fallback: name_hash or synth ID
 */

// ARCH-002: Guard against manifest.json load-order violations.
// adapters/shared-ui.js must load before carrefour.js in content_scripts.
const _shared = (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : null) || {
  parsePrice(text) {
    if (!text) return 0;
    const match = String(text).match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/);
    return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
  },
  generateIdFromName(name) {
    if (!name) return "";
    return "synth_" + String(name).toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 32);
  },
  escapeHTML(str) {
    return String(str ?? "").replace(/[&<>'"`]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;', '`': '&#96;' }[c])
    );
  },
  injectBadge(card, _productResult, _price) {
    return card;
  },
  fetchWithRetry(_url, _options) {
    return { ok: false };
  }
};

if (typeof NutriSharedUI === "undefined" && typeof window !== "undefined" && window.chrome?.runtime?.id) {
  console.error("[NutriScore] Load-order violation: adapters/shared-ui.js must load before carrefour.js. Check manifest.json content_scripts array.");
  throw new Error("[NutriScore] carrefour.js: NutriSharedUI not available");
}

/**
 * Regex utility to scan a product name for unit tags (e.g. "1KG", "500ml", "2L")
 * and extract the standardized unit string.
 * @param {string} productName
 * @returns {string|null} Isolated unit type in uppercase (e.g., "KG", "ML", "L", "G") or null
 */
function extractPackSizeUnit(productName) {
  if (!productName || typeof productName !== "string") return null;
  const match = productName.match(/(?:\d+(?:\.\d+)?)\s*(kg|g|gm|gms|ml|l|ltr|ltrs|litres?|packet|pcs|pieces?|pack|can|bottle|sachet|bunch)\b/i);
  if (match && match[1]) {
    const raw = match[1].toUpperCase();
    if (raw === "GM" || raw === "GMS") return "G";
    if (raw === "LTR" || raw === "LTRS" || raw.startsWith("LITRE")) return "L";
    if (raw.startsWith("PIECE")) return "PCS";
    return raw;
  }
  return null;
}

/**
 * Clean currency symbols (Ksh, KES, commas) and cast to finite Number.
 * @param {string|number} priceVal
 * @returns {number} Clean numerical price in KES
 */
function parseCleanPrice(priceVal) {
  if (typeof priceVal === "number") {
    return Number.isFinite(priceVal) ? priceVal : 0;
  }
  if (!priceVal) return 0;
  try {
    const str = String(priceVal).trim();
    const match = str.match(/(\d+(?:,\d+)*(?:\.\d+)?)/);
    if (!match) return 0;
    const cleanNum = match[1].replace(/,/g, "");
    const parsed = parseFloat(cleanNum);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Maps raw product tile data / scraped attributes into the standardized JSON schema.
 * Employs defensive coding (try/catch) so unexpected DOM shapes fallback gracefully.
 *
 * @param {object} raw - Raw tile data extracted from DOM
 * @returns {object} Standardized Canonical Product Schema
 */
function mapToCanonicalSchema(raw) {
  try {
    const rawId = raw?.id || raw?.productId || "";
    const cleanId = String(rawId).trim();
    const cleanName = (raw?.name || raw?.product_name || raw?.title || "").trim();
    const normalizedName = cleanName.toLowerCase().trim();
    const cleanPrice = parseCleanPrice(raw?.price ?? raw?.priceSnapshot ?? raw?.current_price);
    const packUnit = extractPackSizeUnit(cleanName);
    const cleanUrl = raw?.url || raw?.product_url || null;

    return {
      Identity: {
        ProductID: cleanId || (cleanName ? _shared.generateIdFromName(cleanName) : ""),
        ProductName: cleanName,
        Retailer: "CARREFOUR",
        NormalizedName: normalizedName,
        RetailerProductUrl: cleanUrl,
        BrandName: raw?.brand || null,
      },
      Packaging: {
        PackSizeUnit: packUnit,
      },
      Price: {
        CurrentPriceKES: cleanPrice,
      },
      Nutrition: {
        EnergyKcal: null,
        EnergyKJ: null,
        FatG: null,
        SaturatedFatG: null,
        CarbohydratesG: null,
        SugarsG: null,
        ProteinG: null,
        SodiumMG: null,
        SaltG: null,
        FibreG: null,
        PotassiumMG: null,
      },
      Classification: {
        NutritionCategory: raw?.scrapedCategory || null,
        NutriScore: null,
      },
    };
  } catch (err) {
    console.warn("[CarrefourAdapter] mapToCanonicalSchema error:", err);
    return {
      Identity: {
        ProductID: "",
        ProductName: "",
        Retailer: "CARREFOUR",
        NormalizedName: "",
        RetailerProductUrl: null,
        BrandName: null,
      },
      Packaging: {
        PackSizeUnit: null,
      },
      Price: {
        CurrentPriceKES: 0,
      },
      Nutrition: {
        EnergyKcal: null,
        EnergyKJ: null,
        FatG: null,
        SaturatedFatG: null,
        CarbohydratesG: null,
        SugarsG: null,
        ProteinG: null,
        SodiumMG: null,
        SaltG: null,
        FibreG: null,
        PotassiumMG: null,
      },
      Classification: {
        NutritionCategory: null,
        NutriScore: null,
      },
    };
  }
}

const CarrefourAdapter = {

  getRetailerCode() {
    return "CARREFOUR";
  },

  getObserveTarget() {
    if (typeof document === "undefined") return null;
    return document.querySelector("[data-testid='product-grid']") || 
           document.querySelector(".product-grid") || 
           document.querySelector("#__next main") ||
           document.querySelector("main") ||
           document.querySelector("#__next") ||
           document.body;
  },

  /**
   * Extracts category context from breadcrumbs or main headings.
   * @returns {string} Normalized lowercase category string
   */
  _extractCategory() {
    if (typeof document === "undefined") return "";
    const categorySelector = "[data-testid='breadcrumb'], nav[aria-label='breadcrumb'], .breadcrumbs, .breadcrumb, [class*='breadcrumb'], h1";
    let text = "";
    document.querySelectorAll(categorySelector).forEach(el => {
      text += " " + (el?.textContent?.trim() || "");
    });
    return text.toLowerCase().trim();
  },

  /**
   * Resolves the enclosing product card container for a given anchor link.
   * Prioritizes O(1) indexed selectors (data-testid, classes) before substring style attributes.
   * @param {Element} anchor
   * @returns {Element|null}
   */
  _findCardContainer(anchor) {
    let card = anchor.closest("[data-testid='product-card']") ||
               anchor.closest(".cl-product-card") ||
               anchor.closest(".flex-col.relative") ||
               anchor.closest("li[class*='product']") ||
               anchor.closest("div[class*='product-card']") ||
               anchor.closest("div[class*='ProductCard']") ||
               anchor.closest("li") ||
               anchor.closest('[style*="grid-column"]');

    if (!card) card = anchor.parentElement;
    if (card && card.parentElement && card.parentElement.style?.gridColumn) {
      card = card.parentElement;
    }
    return card;
  },

  /**
   * Centralized helper to parse a product card DOM element and anchor.
   * DRY parsing logic shared by detectProducts() and candidatesIn().
   * @param {Element} card
   * @param {Element} anchor
   * @param {string} pageCategory
   * @returns {{ id: string, name: string, price: number, url: string|null, scrapedCategory: string }|null}
   */
  _parseCard(card, anchor, pageCategory) {
    if (!card) return null;

    // 1. Extract Product ID from the href or data attributes
    let retailerProductId = null;
    const match = anchor?.href ? anchor.href.match(/\/(?:p|product)\/(\d+)/) : null;
    if (match) retailerProductId = match[1];
    if (!retailerProductId && card.getAttribute) {
      retailerProductId = card.getAttribute("data-product-id") || card.getAttribute("data-id") || null;
    }

    // 2. Extract Name
    let name = "";
    const nameEl = card.querySelector("[data-testid='product-title'], h2, h3, h4, [class*='title'], [class*='name'], .line-clamp-2, .line-clamp-1");
    if (nameEl) name = nameEl.textContent?.trim() || "";
    
    if (!name && anchor) {
      name = anchor.getAttribute("title") || anchor.getAttribute("aria-label") || "";
    }
    
    if (!name && anchor) {
      const text = anchor.textContent?.trim() || "";
      if (text && !text.match(/^kes\s*[\d,.]+$/i)) {
        name = text;
      }
    }

    if (!name) return null;

    if (!retailerProductId) {
      retailerProductId = (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).generateIdFromName(name);
    }

    // 3. Extract Price
    let priceNumeric = 0;
    const priceEl = card.querySelector("[data-testid='product-price'], [class*='price'], [class*='Price'], .items-baseline, .text-lg.font-bold, .text-xl.font-bold");
    if (priceEl) {
      priceNumeric = (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(priceEl.textContent);
    }

    return {
      id: String(retailerProductId),
      name: name,
      price: priceNumeric,
      url: anchor?.href || null,
      scrapedCategory: pageCategory || "",
    };
  },

  detectProducts() {
    const products = [];
    const pageCategory = this._extractCategory();
    const productLinks = document.querySelectorAll("a[href*='/p/'], a[href*='/product/']");
    const processedCards = new Set();

    productLinks.forEach(anchor => {
      const card = this._findCardContainer(anchor);
      if (!card || processedCards.has(card)) return;
      if (card.hasAttribute("data-nutriscore-scanned")) {
        if (!card.querySelector(".nutriscore-isolated-root")) {
          card.removeAttribute("data-nutriscore-scanned");
        } else {
          return;
        }
      }

      processedCards.add(card);

      const parsed = this._parseCard(card, anchor, pageCategory);
      if (!parsed) return;

      products.push({
        domElement:         card,
        id:                 parsed.id,
        name:               parsed.name,
        nameHash:           null,
        price:              parsed.price,
        scrapedCategory:    parsed.scrapedCategory,
        url:                parsed.url
      });
    });

    return products;
  },

  injectBadge(card, productResult, price) {
    return (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).injectBadge(card, productResult, price);
  },

  /**
   * F-05: candidatesIn(root) — scoped subtree scan for NutriScanner.
   * Queries only inside `root` instead of the whole document.
   * Returns Array<{ el: HTMLElement, item: ScoreItem }>.
   */
  candidatesIn(root) {
    const candidates = [];
    const processedCards = new Set();
    const pageCategory = this._extractCategory();

    // Use root when it provides querySelectorAll, else document
    const scope = (root && typeof root.querySelectorAll === "function") ? root : (typeof document !== "undefined" ? document : null);
    if (!scope) return candidates;
    const productLinks = [];
    if (scope.matches?.("a[href*='/p/'], a[href*='/product/']")) {
      productLinks.push(scope);
    }
    productLinks.push(...scope.querySelectorAll("a[href*='/p/'], a[href*='/product/']"));

    productLinks.forEach((anchor) => {
      const card = this._findCardContainer(anchor);
      if (!card || processedCards.has(card)) return;
      if (card.querySelector(".nutriscore-isolated-root")) return; // already injected

      processedCards.add(card);

      const parsed = this._parseCard(card, anchor, pageCategory);
      if (!parsed) return;

      candidates.push({
        el: card,
        item: {
          id:              parsed.id,
          name:            parsed.name,
          price:           parsed.price,
          url:             parsed.url,
          scrapedCategory: parsed.scrapedCategory,
        },
      });
    });

    return candidates;
  },

  /**
   * F-05: Idempotent badge injection for NutriScanner.
   * Replaces an existing badge if present.
   */
  inject(el, result) {
    const existing = el.querySelector(".nutriscore-isolated-root");
    if (existing) existing.remove();
    el.removeAttribute("data-nutriscore-scanned");
    const product = (result && result.status === "SUCCESS" && result.data) ? result.data : ((result && result.data) ? result.data : result);
    (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).injectBadge(el, product, product?.price ?? product?.Price?.CurrentPriceKES ?? 0);
  },

  extractCartState() {
    const items = [];
    const processedIds = new Set();

    // High efficiency: scope directly to cart containers first
    const cartContainerSelectors = [
      ".relative.flex.items-start.gap-md",
      "div[class*='relative flex items-start gap-md']",
      "[data-testid='cart-item']",
      "[data-testid='cart-product-item']",
      ".cart-item",
    ].join(", ");

    let cards = Array.from(document.querySelectorAll(cartContainerSelectors));

    // Fallback: if no direct cart containers found, check cart drawer or search product links
    if (cards.length === 0) {
      const cartDrawer = document.querySelector("[data-testid='cart-drawer'], [data-testid='side-cart'], .cart-drawer, [class*='cart-drawer'], [class*='sideCart']");
      const searchRoot = cartDrawer || document;
      const productLinks = searchRoot.querySelectorAll("a[href*='/p/'], a[href*='/product/']");
      productLinks.forEach(anchor => {
        const c = anchor.closest(".relative.flex.items-start.gap-md") ||
                  anchor.closest("div[class*='relative flex items-start gap-md']") ||
                  anchor.closest("[data-testid='cart-item']");
        if (c && !cards.includes(c)) cards.push(c);
      });
    }

    cards.forEach(card => {
      // Find anchor inside card
      const anchor = card.querySelector("a[href*='/p/'], a[href*='/product/']");
      if (!anchor) return;

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
      const anchors = card.querySelectorAll("a[href*='/p/'], a[href*='/product/']");
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
        price = (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(priceWrapper.textContent);
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

  async _cartFromNextData() {
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
    return [];
  },

  async _cartFromCartApi() {
    const endpoints = [
      '/api/cart',
      '/mafken/en/cart',
    ];
    for (const ep of endpoints) {
      const res = await (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).fetchWithRetry(ep, {
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
    return [];
  },

  /* Fetches cart state from Carrefour APIs silently on page load. Checks window.__NEXT_DATA__ (Next.js SSR), then falls back to the cart JSON API. Returns array of cart items without requiring the cart flyout to be open. */
  async fetchCartFromAPI() {
    return await (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).firstNonEmpty([
      this._cartFromNextData.bind(this),
      this._cartFromCartApi.bind(this)
    ]);
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
       price = (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(priceEl.textContent);
    }
    
    let id = card.getAttribute("data-product-id") || card.getAttribute("data-id");
    if (!id) {
       const anchor = card.querySelector("a[href*='/p/'], a[href*='/product/']");
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
       productId: id || (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).generateIdFromName(name),
       product_name: name,
       priceSnapshot: price,
       quantity: 1
    };
  },

  /* Detects immediate per-item remove clicks on Carrefour cart. Traverses ancestors for a [data-testid="trash-icon"] parent. When found, returns { retailer, productId, clearAll: false } so the background can remove the item instantly rather than waiting for syncCart(). */
  extractRemoveAction(node) {
    if (!node) return null;
    const trashBtn = node.closest ? node.closest("[data-testid='trash-icon']") : null;
    const target = trashBtn || node;

    let el = target;
    for (let i = 0; i < 6; i++) {
      if (!el) break;
      if ((el.matches && el.matches("[data-testid='trash-icon']")) || el === trashBtn) {
        // Walk up to the nearest cart-item container
        const card = el.closest(".relative.flex.items-start.gap-md") ||
                     el.closest("div[class*='relative flex items-start gap-md']") ||
                     el.closest("[data-testid='cart-item']") ||
                     el.parentElement;
        if (!card) return null;

        let productId = null;
        const anchor = card.querySelector("a[href*='/p/'], a[href*='/product/']");
        if (anchor) {
          const match = anchor.href.match(/\/(?:p|product)\/(\d+)/);
          if (match) productId = match[1];
        }
        if (!productId) return null;

        return { retailer: "CARREFOUR", productId, clearAll: false };
      }
      el = el.parentElement;
    }
    return null;
  },

  escapeHTML(str) {
    return (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).escapeHTML(str);
  },

  /* Returns true when the current page is an order confirmation page. Carrefour Kenya uses Next.js; we check __NEXT_DATA__ props and URL patterns. */
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

// Expose adapter to content script orchestrator and globals
if (typeof window !== "undefined") {
  window.RetailerAdapter = CarrefourAdapter;
  window.CarrefourAdapter = CarrefourAdapter;
}

if (typeof globalThis !== "undefined") {
  globalThis.RetailerAdapter = CarrefourAdapter;
  globalThis.CarrefourAdapter = CarrefourAdapter;
  globalThis.extractPackSizeUnit = extractPackSizeUnit;
  globalThis.parseCleanPrice = parseCleanPrice;
  globalThis.mapToCanonicalSchema = mapToCanonicalSchema;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CarrefourAdapter,
    extractPackSizeUnit,
    parseCleanPrice,
    mapToCanonicalSchema,
  };
}
