/**
 * Naivas Retailer Adapter
 * Implements IRetailerAdapter contract
 * Naivas uses Magento 2 -- cart data is available via the section load API
 * and via DOM selectors on the cart page and mini-cart sidebar.
 */

const NaivasAdapter = {

  getRetailerCode() {
    return "NAIVAS";
  },

  getObserveTarget() {
    return document.body;
  },

  detectProducts() {
    const products = [];
    const productSelector = "[class*='border-naivas-bg'], .product-item";
    const nameSelector = "span.line-clamp-2, [class*='line-clamp'], .product-item-name a, a[href*='.html'], h3, h4";
    const priceSelector = "span[class*='text-naivas-green'], .product-price, .price-box .price, .price";
    const categorySelector = ".category-description, .items.breadcrumbs, .breadcrumb, .page-title-wrapper";

    // Category extraction
    let categoryText = "";
    document.querySelectorAll(categorySelector).forEach(el => {
      categoryText += " " + (el?.textContent?.trim() || "");
    });
    const pageCategory = categoryText.toLowerCase();

    const cards = document.querySelectorAll(productSelector);

    cards.forEach((card) => {
      if (card.hasAttribute("data-nutriscore-scanned")) {
        if (!card.querySelector(".nutriscore-isolated-root")) {
          card.removeAttribute("data-nutriscore-scanned");
        } else {
          return;
        }
      }

      const nameEl = card.querySelector(nameSelector);
      let name = nameEl?.textContent?.trim() || "";
      if (!name && nameEl?.tagName?.toLowerCase() === 'a') {
        name = nameEl?.getAttribute("title") || nameEl?.getAttribute("aria-label") || "";
      }

      if (!name) return;

      let priceNumeric = 0;
      const priceEl = card.querySelector(priceSelector);
      if (priceEl) {
        priceNumeric = NutriSharedUI.parsePrice(priceEl.textContent);
      }

      const id = card.getAttribute("data-product-id") || card.getAttribute("data-sku") || NutriSharedUI.generateIdFromName(name);
      const hash = card.getAttribute("data-original-hash") || null;

      products.push({
        domElement: card,
        id: id,
        name: name,
        nameHash: hash,
        price: priceNumeric,
        scrapedCategory: pageCategory,
        url: card.querySelector("a[href]")?.href || null
      });
    });

    return products;
  },

  injectBadge(card, productResult, price) {
    return NutriSharedUI.injectBadge(card, productResult, price);
  },

  /**
   * Walk the DOM with TreeWalker to find all elements that have a wire:click attribute.
   * Avoids CSS selector colon-escaping bugs entirely.
   */
  _wireClickElements() {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.hasAttribute('wire:click')) results.push(node);
    }
    return results;
  },

  /**
   * Scrape visible cart items from the Naivas Livewire-based cart UI.
   * Uses TreeWalker instead of querySelectorAll to avoid CSS colon-escaping issues.
   */
  extractCartState() {
    const items = [];
    const seen = new Set();
    const allWireEls = this._wireClickElements();

    // Build maps: productId → name link, productId → remove link
    const nameLinks  = new Map(); // productId → element
    const removeLinks = new Map(); // productId → element

    for (const el of allWireEls) {
      const wc = el.getAttribute('wire:click') || '';
      let m;
      m = wc.match(/^redirectToProductPage\((\d+)\)/);
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

      // Price: walk up from the remove button to find .font-extrabold (KES amount)
      let price = 0;
      let el = removeBtn.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!el) break;
        const priceEl = el.querySelector('.font-extrabold');
        if (priceEl) { price = NutriSharedUI.parsePrice(priceEl.textContent); break; }
        el = el.parentElement;
      }

      // Quantity: find the quantity display between ± buttons (class: font-semibold with a number)
      let quantity = 1;
      el = removeBtn.parentElement;
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

      items.push({ retailer: 'NAIVAS', productId, product_name: name, priceSnapshot: price, quantity });
    }

    return items;
  },

  /**
   * Fetch cart contents using multiple strategies:
   * 1. Livewire v3 wire:snapshot attributes (JSON component data in the DOM)
   * 2. Livewire v2 window.Livewire JS object
   * 3. Magento section load API (fallback for hybrid setups)
   */
  async fetchCartFromAPI() {
    // --- Strategy 1: Livewire v3 wire:snapshot in DOM ---
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.hasAttribute('wire:snapshot')) continue;
        const snapshot = JSON.parse(node.getAttribute('wire:snapshot'));
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
      }
    } catch (e) { /* silent */ }

    // --- Strategy 2: Livewire v2 window.Livewire object ---
    try {
      if (window.Livewire) {
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
    } catch (e) { /* silent */ }

    // --- Strategy 3: Magento / custom section load API ---
    try {
      const ts = Date.now();
      const res = await fetch(
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
                priceSnapshot: NutriSharedUI.parsePrice(String(i.product_price || i.price || '0')),
                quantity: i.qty || 1,
                url: i.product_url || null
              }));
          }
        }
      }
    } catch (e) { /* silent — Naivas is not a Magento section-load site */ }

    return [];
  },


  /**
   * Detect clicks on Naivas "Add to Cart" buttons.
   * Naivas uses Livewire; add-to-cart anchors have wire:click="addToCart(...)" or similar.
   * Also handles standard Magento 2 .tocart buttons as a fallback.
   */
  extractCartAction(node) {
    // --- A. Livewire add-to-cart: <a wire:click="addToCart(ID)"> or <button wire:click="addToCart(ID)">
    const wireEl = node.closest('[wire\\:click]');
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
        const price = priceEl ? NutriSharedUI.parsePrice(priceEl.textContent) : 0;

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
    const btn = node.closest(
      'button.tocart, button[data-role="tocart"], button.action.tocart, button[title="Add to Cart"]'
    );
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
      || NutriSharedUI.generateIdFromName(name);

    const priceEl = card.querySelector('.price-box .price, .price-wrapper .price, .price');
    const price = priceEl ? NutriSharedUI.parsePrice(priceEl.textContent) : 0;

    return {
      retailer: 'NAIVAS',
      productId: String(productId),
      product_name: name,
      priceSnapshot: price,
      quantity: 1
    };
  },

  /**
   * Detect clicks on Naivas remove/delete buttons OR the 'Clear Cart' button.
   * Returns { retailer, productId, clearAll } or null.
   */
  extractRemoveAction(node) {
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

  /**
   * Returns true when the current page is an order confirmation / success page.
   */
  detectOrderConfirmation() {
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

window.RetailerAdapter = NaivasAdapter;
