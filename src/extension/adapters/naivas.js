/* Naivas Retailer Adapter
 * Implements IRetailerAdapter contract
 * Naivas uses Magento 2 + Livewire -- cart data is available via the section load API,
 * Livewire v3 wire:snapshot, Livewire v2 JS object, and via DOM selectors on the cart page and mini-cart sidebar.
 */

// ARCH-002: Guard against manifest.json load-order violations.
// shared-ui.js must appear before this file in the content_scripts array.
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
  console.error("[NutriScore] Load-order violation: adapters/shared-ui.js must load before naivas.js. Check manifest.json content_scripts array.");
  throw new Error("[NutriScore] naivas.js: NutriSharedUI not available");
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
    const rawId = raw?.id || raw?.productId || raw?.sku || "";
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
        Retailer: "NAIVAS",
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
    console.warn("[NaivasAdapter] mapToCanonicalSchema error:", err);
    return {
      Identity: {
        ProductID: "",
        ProductName: "",
        Retailer: "NAIVAS",
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

const NaivasAdapter = {

  getRetailerCode() {
    return "NAIVAS";
  },

  getObserveTarget() {
    if (typeof document === "undefined") return null;
    return document.querySelector(".products.list.items.product-items") || 
           document.querySelector("[wire\\:id]") || 
           document.querySelector(".columns") || 
           document.querySelector("main") ||
           document.querySelector("#maincontent") ||
           document.body;
  },

  /**
   * Reads category metadata from document breadcrumbs / headings.
   * @returns {string} Lowercase category text
   */
  _extractCategory() {
    if (typeof document === "undefined") return "";
    const categorySelector = ".category-description, .items.breadcrumbs, .breadcrumb, .page-title-wrapper";
    let categoryText = "";
    document.querySelectorAll(categorySelector).forEach(el => {
      categoryText += " " + (el?.textContent?.trim() || "");
    });
    return categoryText.toLowerCase().trim();
  },

  /**
   * Helper to parse a single product card element.
   * Returns null if product name cannot be resolved.
   * @param {Element} card
   * @param {string} pageCategory
   * @returns {{ id: string, name: string, nameHash: string|null, price: number, url: string|null, scrapedCategory: string }|null}
   */
  _parseCard(card, pageCategory) {
    if (!card) return null;

    const nameSelector = "span.line-clamp-2, [class*='line-clamp'], .product-item-name a, a[href*='.html'], h3, h4";
    const priceSelector = "span[class*='text-naivas-green'], .product-price, .price-box .price, .price";

    const nameEl = card.querySelector(nameSelector);
    let name = nameEl?.textContent?.trim() || "";
    if (!name && nameEl?.tagName?.toLowerCase() === 'a') {
      name = nameEl?.getAttribute("title") || nameEl?.getAttribute("aria-label") || "";
    }

    if (!name) return null;

    let priceNumeric = 0;
    const priceEl = card.querySelector(priceSelector);
    if (priceEl) {
      priceNumeric = (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(priceEl.textContent);
    }

    const id = card.getAttribute("data-product-id") ||
               card.getAttribute("data-sku") ||
               (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).generateIdFromName(name);
    const hash = card.getAttribute("data-original-hash") || null;
    const url = card.querySelector("a[href]")?.href || null;

    return {
      id: String(id),
      name: name,
      nameHash: hash,
      price: priceNumeric,
      url: url,
      scrapedCategory: pageCategory || "",
    };
  },

  detectProducts() {
    const products = [];
    const productSelector = "[class*='border-naivas-bg'], .product-item";
    const pageCategory = this._extractCategory();

    const cards = document.querySelectorAll(productSelector);

    cards.forEach((card) => {
      if (card.hasAttribute("data-nutriscore-scanned")) {
        if (!card.querySelector(".nutriscore-isolated-root")) {
          card.removeAttribute("data-nutriscore-scanned");
        } else {
          return;
        }
      }

      const parsed = this._parseCard(card, pageCategory);
      if (!parsed) return;

      products.push({
        domElement:      card,
        id:              parsed.id,
        name:            parsed.name,
        nameHash:        parsed.nameHash,
        price:           parsed.price,
        scrapedCategory: parsed.scrapedCategory,
        url:             parsed.url
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
    const productSelector = "[class*='border-naivas-bg'], .product-item";
    const pageCategory = this._extractCategory();

    // Use root when it provides querySelectorAll, else document
    const scope = (root && typeof root.querySelectorAll === "function") ? root : (typeof document !== "undefined" ? document : null);
    if (!scope) return candidates;
    const cards = [];
    if (scope.matches?.(productSelector)) {
      cards.push(scope);
    }
    cards.push(...scope.querySelectorAll(productSelector));

    cards.forEach((card) => {
      if (card.querySelector(".nutriscore-isolated-root")) return; // already injected

      const parsed = this._parseCard(card, pageCategory);
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
   * F-05: inject(el, result) — idempotent badge injection for NutriScanner.
   */
  inject(el, result) {
    const existing = el.querySelector(".nutriscore-isolated-root");
    if (existing) existing.remove();
    el.removeAttribute("data-nutriscore-scanned");
    const product = (result && result.status === "SUCCESS" && result.data) ? result.data : ((result && result.data) ? result.data : result);
    (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).injectBadge(el, product, product?.price ?? product?.Price?.CurrentPriceKES ?? 0);
  },

  /* Returns all elements with a wire:click attribute. P6 perf fix: uses querySelectorAll (browser-indexed) instead of a full TreeWalker DOM walk. 'wire:click' contains a colon — CSS.escape handles it safely across browsers. */
  _wireClickElements() {
    try {
      return Array.from(document.querySelectorAll("[wire\\:click]"));
    } catch (e) {
      // Fallback to TreeWalker if the selector is rejected by an older engine
      const results = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.hasAttribute('wire:click')) results.push(node);
      }
      return results;
    }
  },

  /* Scrape visible cart items from the Naivas Livewire-based cart UI. */
  extractCartState() {
    const items = [];
    const seen = new Set();
    const allWireEls = this._wireClickElements();

    // Build maps: productId → name link, productId → remove link
    const nameLinks  = new Map(); // productId → element
    const removeLinks = new Map(); // productId → element

    for (const el of allWireEls) {
      const wc = el.getAttribute('wire:click') || '';
      let m = wc.match(/^redirectToProductPage\((\d+)\)/);
      if (m) { nameLinks.set(m[1], el); continue; }
      m = wc.match(/^remove\((\d+)\)/);
      if (m) { removeLinks.set(m[1], el); }
    }

    // Cart items = products that appear in BOTH maps (they have a name link AND a remove button)
    for (const [productId, removeBtn] of removeLinks) {
      if (seen.has(productId)) continue;
      seen.add(productId);

      // Name: prefer the redirectToProductPage link's title, then text content
      const nameEl = nameLinks.get(productId);
      const name = nameEl?.getAttribute('title') || nameEl?.textContent?.trim() || '';
      if (!name) continue;

      // Container lookup for fast scoped querying
      const cartItem = (removeBtn.closest && removeBtn.closest('[class*="cart-item"], [class*="flex"], li, article')) || removeBtn.parentElement;

      // Price: look inside closest cartItem container first; fallback to 8-level parent walk
      let price = 0;
      const priceEl = cartItem ? cartItem.querySelector('.font-extrabold') : null;
      if (priceEl) {
        price = (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(priceEl.textContent);
      } else {
        let el = removeBtn.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!el) break;
          const pEl = el.querySelector('.font-extrabold');
          if (pEl) { price = (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(pEl.textContent); break; }
          el = el.parentElement;
        }
      }

      // Quantity: find the quantity display between ± buttons (class: font-semibold with a number)
      let quantity = 1;
      let foundQty = false;
      if (cartItem) {
        const qtyEls = cartItem.querySelectorAll('.font-semibold');
        for (const q of qtyEls) {
          const val = parseInt(q.textContent.trim(), 10);
          if (!isNaN(val) && val > 0) { quantity = val; foundQty = true; break; }
        }
      }
      if (!foundQty) {
        let el = removeBtn.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!el) break;
          const qtyEls = el.querySelectorAll('.font-semibold');
          for (const q of qtyEls) {
            const val = parseInt(q.textContent.trim(), 10);
            if (!isNaN(val) && val > 0) { quantity = val; break; }
          }
          if (quantity > 1) break;
          el = el.parentElement;
        }
      }

      items.push({ retailer: 'NAIVAS', productId, product_name: name, priceSnapshot: price, quantity });
    }

    return items;
  },

  async _cartFromLivewireV3Snapshot() {
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll('[wire\\:snapshot]'));
    } catch (e) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.hasAttribute('wire:snapshot')) nodes.push(node);
      }
    }

    for (const node of nodes) {
      try {
        const rawAttr = node.getAttribute('wire:snapshot');
        if (!rawAttr) continue;
        const snapshot = JSON.parse(rawAttr);
        const data = snapshot?.data || {};
        const rawItems = data.cartItems || data.cart_items
          || data.cart?.items || data.items || [];
        if (rawItems.length > 0) {
          return rawItems
            .filter(i => i.id || i.product_id || i.productId)
            .map(i => ({
              retailer: 'NAIVAS',
              productId: String(i.id || i.product_id || i.productId),
              product_name: i.name || i.product_name || i.title || '',
              priceSnapshot: parseFloat(i.price || i.subtotal || 0),
              quantity: i.quantity || i.qty || 1
            }));
        }
      } catch (err) {
        /* skip invalid JSON */
      }
    }
    return [];
  },

  async _cartFromLivewireV2Object() {
    if (typeof window !== "undefined" && window.Livewire) {
      const components = Object.values(
        window.Livewire.components?.componentsById || {}
      );
      for (const component of components) {
        const data = component.data || {};
        const rawItems = data.cartItems || data.cart_items
          || data.cart?.items || data.items || [];
        if (rawItems.length > 0) {
          return rawItems
            .filter(i => i.id || i.product_id || i.productId)
            .map(i => ({
              retailer: 'NAIVAS',
              productId: String(i.id || i.product_id || i.productId),
              product_name: i.name || i.product_name || '',
              priceSnapshot: parseFloat(i.price || 0),
              quantity: i.quantity || i.qty || 1
            }));
        }
      }
    }
    return [];
  },

  async _cartFromMagentoSections() {
    const ts = Date.now();
    const res = await (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).fetchWithRetry(
      '/customer/section/load/?sections=cart&force_new_section_timestamp=false&_=' + ts,
      { credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } }
    );
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const data = await res.json();
        const rawItems = data?.cart?.items || [];
        if (rawItems.length > 0) {
          return rawItems
            .filter(i => i.item_id || i.product_id)
            .map(i => ({
              retailer: 'NAIVAS',
              productId: String(i.product_id || i.item_id),
              product_name: i.product_name || i.name || '',
              priceSnapshot: (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(String(i.product_price || i.price || '0')),
              quantity: i.qty || 1,
              url: i.product_url || null
            }));
        }
      }
    }
    return [];
  },

  /* Fetch cart contents using multiple strategies: 1. Livewire v3 wire:snapshot attributes 2. Livewire v2 window.Livewire JS object 3. Magento section load API */
  async fetchCartFromAPI() {
    return await (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).firstNonEmpty([
      this._cartFromLivewireV3Snapshot.bind(this),
      this._cartFromLivewireV2Object.bind(this),
      this._cartFromMagentoSections.bind(this)
    ]);
  },

  /* Detect clicks on Naivas "Add to Cart" buttons. */
  extractCartAction(node) {
    if (!node) return null;
    // --- A. Livewire add-to-cart: <a wire:click="addToCart(ID)"> or <button wire:click="addToCart(ID)">
    const wireEl = node.closest ? node.closest('[wire\\:click]') : null;
    if (wireEl) {
      const wireClick = wireEl.getAttribute('wire:click') || '';
      const addMatch = wireClick.match(/addToCart\((\d+)\)/);
      if (addMatch) {
        const productId = addMatch[1];
        // Walk up to find card container with the product name and price
        const card = wireEl.closest('.product-item, [class*="product-card"], li, article')
          || wireEl.parentElement;

        let name = '';
        const nameEl = card.querySelector(
          'a[wire\\:click^="redirectToProductPage"], [class*="product-name"], h2, h3'
        );
        if (nameEl) name = nameEl.getAttribute('title') || nameEl.textContent.trim();
        if (!name) name = wireEl.getAttribute('title') || '';
        if (!name) return null;

        const priceEl = card.querySelector('.font-extrabold, [class*="text-naivas-green"], .price-box .price');
        const price = priceEl ? (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(priceEl.textContent) : 0;

        return {
          retailer: 'NAIVAS',
          productId: String(productId),
          product_name: name,
          priceSnapshot: price,
          quantity: 1
        };
      }

      // Livewire redirect to product page click — not an add-to-cart, skip
      if (wireClick.includes('redirectToProductPage')) return null;
    }

    // --- B. Magento 2 standard .tocart button fallback ---
    const btn = node.closest ? node.closest(
      'button.tocart, button[data-role="tocart"], button.action.tocart, button[title="Add to Cart"]'
    ) : null;
    if (!btn) return null;

    const card = btn.closest(
      '.product-item, .product-info-main, [class*="product-card"], .product-item-info'
    ) || btn.parentElement;

    let name = '';
    const nameEl = card.querySelector(
      '.product-item-name a, .product-item-name, h1.page-title span, [itemprop="name"]'
    );
    if (nameEl) name = nameEl.textContent.trim();
    if (!name) name = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
    if (!name) return null;

    const productId = card.getAttribute('data-product-id')
      || card.querySelector('input[name="product"]')?.value
      || (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).generateIdFromName(name);

    const priceEl = card.querySelector('.price-box .price, .price-wrapper .price, .price');
    const price = priceEl ? (typeof NutriSharedUI !== "undefined" ? NutriSharedUI : _shared).parsePrice(priceEl.textContent) : 0;

    return {
      retailer: 'NAIVAS',
      productId: String(productId),
      product_name: name,
      priceSnapshot: price,
      quantity: 1
    };
  },

  /* Detect clicks on Naivas remove/delete buttons OR the 'Clear Cart' button. Returns { retailer, productId, clearAll } or null. */
  extractRemoveAction(node) {
    if (!node) return null;
    let el = node;
    for (let i = 0; i < 6; i++) {
      if (!el) break;
      if (el.hasAttribute && el.hasAttribute('wire:click')) {
        const wc = el.getAttribute('wire:click') || '';
        // Individual item removal: remove(ID)
        const match = wc.match(/^remove\((\d+)\)/);
        if (match) return { retailer: 'NAIVAS', productId: String(match[1]), clearAll: false };
        // Full cart clear button
        if (/^clearCart|clearCartItems|clearAll/.test(wc)) {
          return { retailer: 'NAIVAS', productId: null, clearAll: true };
        }
      }
      el = el.parentElement;
    }
    return null;
  },

  /* Returns true when the current page is an order confirmation / success page. */
  detectOrderConfirmation() {
    if (typeof window === "undefined") return false;
    const url = window.location.href.toLowerCase();
    const successUrls = [
      '/checkout/onestepcheckout/success',
      '/checkout/success',
      '/sales/order/view',
      '/checkout/cart/success',
      'order-received',
      'order_success',
      'thank-you',
      'thankyou',
      'order-confirmation',
    ];
    if (successUrls.some(p => url.includes(p))) return true;
    const domSignals = [
      '.checkout-success',
      '.order-number',
      '[class*="order-success"]',
      '[class*="checkout-success"]',
      '.page-title-wrapper .page-title span',
    ];
    for (const sel of domSignals) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim().toLowerCase();
        if (/^thank you for your order\.?$/.test(text) || /^thank you for your purchase\.?$/.test(text)) return true;
      }
    }
    return false;
  }
};

// Expose adapter to content script orchestrator and globals
if (typeof window !== "undefined") {
  window.RetailerAdapter = NaivasAdapter;
  window.NaivasAdapter = NaivasAdapter;
}

if (typeof globalThis !== "undefined") {
  globalThis.RetailerAdapter = NaivasAdapter;
  globalThis.NaivasAdapter = NaivasAdapter;
  globalThis.extractPackSizeUnit = extractPackSizeUnit;
  globalThis.parseCleanPrice = parseCleanPrice;
  globalThis.mapToCanonicalSchema = mapToCanonicalSchema;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NaivasAdapter,
    extractPackSizeUnit,
    parseCleanPrice,
    mapToCanonicalSchema,
  };
}
