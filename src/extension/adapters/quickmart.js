/* Quickmart Kenya Retailer Adapter
 * Implements IRetailerAdapter contract for Growcer-based ecommerce storefront (quickmart.co.ke)
 * Primary ID: numeric product ID from input[name="selprod_id"], data attributes, or /products/view/<id>
 * Fallback: synth ID from product name
 */

// ARCH-002: Guard against manifest.json load-order violations.
// adapters/shared-ui.js must load before quickmart.js in content_scripts.
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
  async fetchWithRetry(_url, _options) {
    return { ok: false };
  }
};

// ARCH-002: In extension runtime, guard against manifest.json load-order violations.
if (typeof NutriSharedUI === "undefined" && typeof window !== "undefined" && window.chrome?.runtime?.id) {
  console.error("[NutriScore] Load-order violation: adapters/shared-ui.js must load before quickmart.js. Check manifest.json content_scripts array.");
  throw new Error("[NutriScore] quickmart.js: NutriSharedUI not available");
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
    const rawId = raw?.id || raw?.productId || raw?.selprod_id || "";
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
        Retailer: "QUICKMART",
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
    console.warn("[QuickmartAdapter] mapToCanonicalSchema error:", err);
    return {
      Identity: {
        ProductID: "",
        ProductName: "",
        Retailer: "QUICKMART",
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

const QuickmartAdapter = {
  getRetailerCode() {
    return "QUICKMART";
  },

  getObserveTarget() {
    if (typeof document === "undefined") return null;
    return document.querySelector(".product-listing") ||
           document.querySelector(".product-listing-js") ||
           document.querySelector("#products-section") ||
           document.querySelector("#productsList") ||
           document.querySelector("main") ||
           document.body;
  },

  /**
   * Helper to parse a single product card element.
   * Returns null if product name cannot be resolved.
   * @param {Element} card
   * @param {string} pageCategory
   * @returns {{ id: string, name: string, price: number, url: string|null, scrapedCategory: string }|null}
   */
  _parseCard(card, pageCategory) {
    if (!card) return null;

    // 1. Extract Product ID
    let id = null;
    const selProdInput = card.querySelector('input[name="selprod_id"]');
    if (selProdInput && selProdInput.value) {
      id = selProdInput.value.trim();
    }
    if (!id) {
      id = card.getAttribute("data-product-id") ||
           card.getAttribute("data-selprod-id") ||
           card.getAttribute("data-id") ||
           null;
    }
    if (!id) {
      const form = card.querySelector('form[name*="frmBuyProduct"], form[id*="frmBuyProd"]');
      if (form && form.id) {
        const formMatch = form.id.match(/frmBuyProd(?:uct)?-(\d+)/i);
        if (formMatch) id = formMatch[1];
      }
    }

    // 2. Extract Name
    let name = "";
    const nameEl = card.querySelector(".products-title, .product-title, h2, h3, h4, a[title]");
    if (nameEl) {
      name = nameEl.textContent?.trim() || nameEl.getAttribute("title") || "";
    }
    if (!name) {
      const link = card.querySelector("a.products-title, a[href]");
      if (link) {
        name = link.getAttribute("title") || link.getAttribute("aria-label") || link.textContent?.trim() || "";
      }
    }
    if (!name) return null;

    if (!id) {
      id = _shared.generateIdFromName(name);
    }

    // 3. Extract Price
    let priceNumeric = 0;
    const priceEl = card.querySelector(".products-price-new, .products-price, .product-price, .price, .special-price");
    if (priceEl) {
      priceNumeric = _shared.parsePrice(priceEl.textContent);
    }

    // 4. Extract URL (slug URLs on Growcer platform, e.g. /brookside-fresh-milk-500ml-51)
    const anchor = card.querySelector("a.products-title, a[href]:not([href='#'])");
    const url = anchor ? anchor.href : null;

    return {
      id: String(id),
      name: name,
      price: priceNumeric,
      url: url,
      scrapedCategory: pageCategory,
    };
  },

  /**
   * Scrapes product cards across the whole document.
   * Returns Array<{ domElement, id, name, nameHash, price, scrapedCategory, url }>
   */
  detectProducts() {
    const products = [];
    if (typeof document === "undefined") return products;
    const processedCards = new Set();

    try {
      // Category extraction from document breadcrumbs / headings
      let categoryText = "";
      const catEls = document.querySelectorAll(".breadcrumb, .breadcrumbs, .section-head, .page-title");
      catEls.forEach(el => {
        categoryText += " " + (el?.textContent?.trim() || "");
      });
      const pageCategory = categoryText.toLowerCase();

      // Quickmart product cards on Growcer:
      // Primary: .product-listing .products, .productInfoJs, or card ancestor of product links
      const cardSelectors = [
        ".product-listing .products",
        ".product-listing .productInfoJs",
        ".product-card",
        ".product-tile",
        ".product",
        "div[class*='productInfoJs']",
        "div[class*='products-card']",
        "li.product-item",
      ];
      const directCards = Array.from(document.querySelectorAll(cardSelectors.join(", ")));

      // Also scan anchor tags that lead to product detail pages
      const productAnchors = Array.from(document.querySelectorAll("a.products-title, a[href*='/products/view/'], a[href*='/product/view/']"));
      const allFound = [...directCards];

      productAnchors.forEach(a => {
        const parentCard = a.closest(".products") ||
                           a.closest(".productInfoJs") ||
                           a.closest(".product-card") ||
                           a.closest(".product-tile") ||
                           a.closest("li") ||
                           a.closest("div[class*='product']") ||
                           a.parentElement;
        if (parentCard && !allFound.includes(parentCard)) {
          allFound.push(parentCard);
        }
      });

      for (const card of allFound) {
        if (!card || processedCards.has(card)) continue;

        // Skip cards that already have an active injected badge
        if (card.hasAttribute("data-nutriscore-scanned")) {
          if (!card.querySelector(".nutriscore-isolated-root")) {
            card.removeAttribute("data-nutriscore-scanned");
          } else {
            continue;
          }
        }

        processedCards.add(card);

        const parsed = this._parseCard(card, pageCategory);
        if (!parsed) continue;

        products.push({
          domElement: card,
          id: parsed.id,
          name: parsed.name,
          nameHash: null,
          price: parsed.price,
          scrapedCategory: parsed.scrapedCategory,
          url: parsed.url,
        });
      }
    } catch (err) {
      console.warn("[QuickmartAdapter] detectProducts error:", err);
    }

    return products;
  },

  injectBadge(card, productResult, price) {
    return _shared.injectBadge(card, productResult, price);
  },

  /**
   * F-05: candidatesIn(root) — scoped subtree scan for NutriScanner.
   * Queries only inside `root` instead of the whole document.
   * Returns Array<{ el: HTMLElement, item: ScoreItem }>.
   */
  candidatesIn(root) {
    const candidates = [];
    const processedCards = new Set();

    try {
      const hasDoc = typeof document !== "undefined";
      if (!hasDoc && (!root || typeof root.querySelectorAll !== "function")) {
        return candidates;
      }

      let categoryText = "";
      if (hasDoc) {
        const catEls = document.querySelectorAll(".breadcrumb, .breadcrumbs, .section-head, .page-title");
        catEls.forEach(el => {
          categoryText += " " + (el?.textContent?.trim() || "");
        });
      }
      const pageCategory = categoryText.toLowerCase();

      const scope = (root && typeof root.querySelectorAll === "function") ? root : (hasDoc ? document : null);
      if (!scope) return candidates;
      const cardSelectors = [
        ".product-listing .products",
        ".product-listing .productInfoJs",
        ".product-card",
        ".product-tile",
        ".product",
        "div[class*='productInfoJs']",
        "div[class*='products-card']",
        "li.product-item",
      ];
      const directCards = Array.from(scope.querySelectorAll(cardSelectors.join(", ")));
      const productAnchors = Array.from(scope.querySelectorAll("a.products-title, a[href*='/products/view/'], a[href*='/product/view/']"));
      const allFound = [...directCards];

      productAnchors.forEach(a => {
        const parentCard = a.closest(".products") ||
                           a.closest(".productInfoJs") ||
                           a.closest(".product-card") ||
                           a.closest(".product-tile") ||
                           a.closest("li") ||
                           a.closest("div[class*='product']") ||
                           a.parentElement;
        if (parentCard && !allFound.includes(parentCard)) {
          allFound.push(parentCard);
        }
      });

      for (const card of allFound) {
        if (!card || processedCards.has(card)) continue;
        if (card.querySelector(".nutriscore-isolated-root")) continue; // already injected

        processedCards.add(card);

        const parsed = this._parseCard(card, pageCategory);
        if (!parsed) continue;

        candidates.push({
          el: card,
          item: {
            id: parsed.id,
            name: parsed.name,
            price: parsed.price,
            url: parsed.url,
            scrapedCategory: parsed.scrapedCategory,
          },
        });
      }
    } catch (err) {
      console.warn("[QuickmartAdapter] candidatesIn error:", err);
    }

    return candidates;
  },

  /**
   * F-05: inject(el, result) — idempotent badge injection for NutriScanner.
   */
  inject(el, result) {
    const existing = el.querySelector(".nutriscore-isolated-root");
    if (existing) existing.remove();
    el.removeAttribute("data-nutriscore-scanned");
    const product = (result && result.status === "SUCCESS" && result.data) ? result.data : ((result && result.data) ? result.data : result);
    _shared.injectBadge(el, product, product?.price ?? product?.Price?.CurrentPriceKES ?? 0);
  },

  /**
   * Extracts active cart items from Quickmart's offcanvas cart drawer (#sideCartJs / .cart-summary).
   * Returns Array<{ retailer: 'QUICKMART', productId, product_name, priceSnapshot, quantity, url }>
   */
  extractCartState() {
    const items = [];
    if (typeof document === "undefined") return items;
    const seen = new Set();

    try {
      // Quickmart offcanvas cart container
      const cartContainers = document.querySelectorAll(
        "#sideCartJs, .cart-summary, .cart-listing, .cart-item, .cart-product, .dropdown-cart-item, [class*='cart-item']"
      );
      if (!cartContainers || cartContainers.length === 0) return items;

      const itemEls = document.querySelectorAll(
        "#sideCartJs .cart-item, #sideCartJs li, .cart-listing li, .cart-summary .product-cart, .dropdown-cart-item"
      );

      itemEls.forEach(card => {
        let name = "";
        const nameEl = card.querySelector(".product-title, .title, a[href*='/products/view/'], h4, h5");
        if (nameEl) name = nameEl.textContent?.trim() || nameEl.getAttribute("title") || "";
        if (!name) return;

        let productId = card.getAttribute("data-product-id") || card.getAttribute("data-selprod-id");
        if (!productId) {
          const anchor = card.querySelector("a[href*='/products/view/']");
          if (anchor) {
            const m = anchor.href.match(/\/products?\/view\/(\d+)/i);
            if (m) productId = m[1];
          }
        }
        if (!productId) productId = _shared.generateIdFromName(name);
        if (seen.has(productId)) return;
        seen.add(productId);

        let price = 0;
        const priceEl = card.querySelector(".price, .product-price, .products-price, span[class*='price']");
        if (priceEl) price = _shared.parsePrice(priceEl.textContent);

        let quantity = 1;
        const qtyEl = card.querySelector('input[name*="quantity"], input[name*="qty"], .quantity, .qty');
        if (qtyEl) {
          const val = parseInt(qtyEl.value || qtyEl.textContent || "1", 10);
          if (!isNaN(val) && val > 0) quantity = val;
        }

        const anchor = card.querySelector("a[href*='/products/view/'], a[href]");
        const url = anchor ? anchor.href : null;

        items.push({
          retailer: "QUICKMART",
          productId: String(productId),
          product_name: name,
          priceSnapshot: price,
          quantity: quantity,
          url: url,
        });
      });
    } catch (err) {
      console.warn("[QuickmartAdapter] extractCartState error:", err);
    }

    return items;
  },

  /**
   * Fetches cart state from Quickmart APIs silently on page load.
   */
  async fetchCartFromAPI() {
    try {
      const endpoints = [
        "/cart/listing",
        "/cart/get-cart-summary",
        "/cart",
      ];
      for (const ep of endpoints) {
        const res = await _shared.fetchWithRetry(ep, {
          credentials: "include",
          headers: { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" },
        });
        if (res.ok) {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("json")) {
            const data = await res.json();
            const items = data?.items || data?.products || data?.cartItems || [];
            if (Array.isArray(items) && items.length > 0) {
              return items.map(item => ({
                retailer: "QUICKMART",
                productId: String(item.selprod_id || item.product_id || item.id || ""),
                product_name: item.selprod_title || item.product_name || item.name || "",
                priceSnapshot: parseCleanPrice(item.theprice || item.price || item.total || 0),
                quantity: parseInt(item.quantity || item.qty || 1, 10) || 1,
                url: item.url ? (item.url.startsWith("http") ? item.url : `https://www.quickmart.co.ke${item.url}`) : null,
              })).filter(i => i.productId && i.product_name);
            }
          }
        }
      }
    } catch (err) {
      // Silent failure, fall back to DOM extraction
    }
    return [];
  },

  /**
   * Detects clicks on Quickmart's "Add to Cart" buttons.
   * Extracts { retailer: 'QUICKMART', productId, product_name, priceSnapshot, quantity }
   */
  extractCartAction(node) {
    try {
      const btn = node.closest(
        'button[name="btnAddToCart"], button.add-to-cart--js, input[name="btnAddToCart"], button.btn-add-to-cart, .add-to-cart, [data-action="add-to-cart"]'
      ) || (node.closest("button, a")?.textContent?.match(/add to cart|quick add|buy now/i) ? node.closest("button, a") : null);

      if (!btn) return null;

      // Card container or form wrapper
      const card = btn.closest(".products") ||
                   btn.closest(".productInfoJs") ||
                   btn.closest("form.addToCartForm") ||
                   btn.closest("form[name*='frmBuyProduct']") ||
                   btn.closest(".product-card") ||
                   btn.closest(".product-tile") ||
                   btn.closest("li") ||
                   document.body;

      let name = "";
      const nameEl = card.querySelector(".products-title, .product-title, h1, h2, h3, h4, a[title]");
      if (nameEl) name = nameEl.textContent?.trim() || nameEl.getAttribute("title") || "";
      if (!name) name = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
      if (!name) return null;

      let id = card.querySelector('input[name="selprod_id"]')?.value ||
               card.getAttribute("data-product-id") ||
               card.getAttribute("data-selprod-id");

      if (!id) {
        const form = card.querySelector('form[name*="frmBuyProduct"], form[id*="frmBuyProd"]') || (card.tagName === "FORM" ? card : null);
        if (form && form.id) {
          const match = form.id.match(/frmBuyProd(?:uct)?-(\d+)/i);
          if (match) id = match[1];
        }
      }

      if (!id) {
        const match = window.location.href.match(/\/products?\/view\/(\d+)/i);
        if (match) id = match[1];
      }

      if (!id) id = _shared.generateIdFromName(name);

      let price = 0;
      const priceEl = card.querySelector(".products-price-new, .products-price, .product-price, .price, .special-price");
      if (priceEl) price = _shared.parsePrice(priceEl.textContent);

      let quantity = 1;
      const qtyInput = card.querySelector('input[name="quantity"], input[name="qty"], .quantity input');
      if (qtyInput) {
        const val = parseInt(qtyInput.value, 10);
        if (!isNaN(val) && val > 0) quantity = val;
      }

      return {
        retailer: "QUICKMART",
        productId: String(id),
        product_name: name,
        priceSnapshot: price,
        quantity: quantity,
      };
    } catch (err) {
      console.warn("[QuickmartAdapter] extractCartAction error:", err);
      return null;
    }
  },

  /**
   * Detects clicks on Quickmart's cart item remove buttons or clear cart.
   * Returns { retailer: 'QUICKMART', productId, clearAll } or null.
   */
  extractRemoveAction(node) {
    try {
      let el = node;
      for (let i = 0; i < 6; i++) {
        if (!el) break;
        if (
          (el.matches && (
            el.matches(".cart-remove") ||
            el.matches(".remove-cart-item") ||
            el.matches("a.delete, button.delete") ||
            el.matches("[data-action='delete']") ||
            el.matches("[onclick*='cart.remove']") ||
            el.matches("[onclick*='cart.delete']") ||
            el.matches("[data-testid='trash-icon']")
          )) ||
          el.getAttribute?.("title")?.match(/remove|delete/i)
        ) {
          const card = el.closest(".cart-item, li, .dropdown-cart-item") || el.parentElement;
          if (!card) return null;

          let productId = card.getAttribute("data-product-id") ||
                          card.getAttribute("data-selprod-id") ||
                          card.querySelector('input[name="selprod_id"]')?.value;
          if (!productId) {
            const oc = el.getAttribute?.("onclick") || "";
            const ocMatch = oc.match(/cart\.(?:remove|delete)\s*\(\s*['"]?[^,'"]+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/i);
            if (ocMatch) productId = ocMatch[1];
          }

          // Check if it's a "clear all" cart button
          const isClearAll = el.textContent?.match(/clear all|empty cart/i) || el.getAttribute?.("onclick")?.includes("cart.clear");
          if (isClearAll) {
            return { retailer: "QUICKMART", productId: null, clearAll: true };
          }

          if (productId) {
            return { retailer: "QUICKMART", productId: String(productId), clearAll: false };
          }
        }
        el = el.parentElement;
      }
    } catch (err) {
      console.warn("[QuickmartAdapter] extractRemoveAction error:", err);
    }
    return null;
  },

  escapeHTML(str) {
    return _shared.escapeHTML(str);
  },

  /**
   * Returns true when the current page is an order confirmation / thank you page.
   */
  detectOrderConfirmation() {
    const url = window.location.href.toLowerCase();
    const successPatterns = [
      "/checkout/success",
      "/order/success",
      "/orders/success",
      "/thank-you",
      "/thankyou",
      "/order-confirmation",
      "order_success",
      "order-success",
    ];
    if (successPatterns.some(p => url.includes(p))) return true;

    if (typeof document === "undefined") return false;
    const domSignals = [
      ".order-success",
      ".order-confirmation",
      ".checkout-success",
      "[class*='order-complete']",
      ".success-message",
    ];
    for (const sel of domSignals) {
      if (document.querySelector(sel)) return true;
    }

    const headings = document.querySelectorAll("h1, h2, h3, .section-head");
    for (const h of headings) {
      const text = h.textContent?.trim().toLowerCase() || "";
      if (text.includes("thank you for your order") || text.includes("order placed successfully")) {
        return true;
      }
    }

    return false;
  },
};

// Expose adapter to content script orchestrator and globals
if (typeof window !== "undefined") {
  window.RetailerAdapter = QuickmartAdapter;
  window.QuickmartAdapter = QuickmartAdapter;
}

if (typeof globalThis !== "undefined") {
  globalThis.RetailerAdapter = QuickmartAdapter;
  globalThis.QuickmartAdapter = QuickmartAdapter;
  globalThis.extractPackSizeUnit = extractPackSizeUnit;
  globalThis.parseCleanPrice = parseCleanPrice;
  globalThis.mapToCanonicalSchema = mapToCanonicalSchema;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    QuickmartAdapter,
    extractPackSizeUnit,
    parseCleanPrice,
    mapToCanonicalSchema,
  };
}
