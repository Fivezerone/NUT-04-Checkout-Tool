# ADAPTER_REDESIGN_STRATEGY.md — Resilient Supermarket DOM Adapters

> **Target Audience:** Digital Health Platform Engineers, Supermarket Integration Teams, Chrome Extension Developers  
> **Repository:** `NUT-04 Checkout Tool` (NutriScore Kenya Digital Health Platform)  
> **Status:** Active Standard & Technical Specification

---

## 1. Executive Summary & Problem Context

Recent frontend overhauls on Kenya's two primary supermarket platforms broken the legacy DOM scraping and badge injection layer:

1. **Naivas Online (`naivas.online`)**:
   - Completely migrated from Magento 2 + Livewire v3 multi-page templates to a modern **React + Vite + Tailwind CSS v4 + BProgress single-page application (SPA)**.
   - All legacy DOM hooks (`[wire:id]`, `.products.list.items.product-items`, `[class*='border-naivas-bg']`, and `.html` URLs) became obsolete.
   - Clean URLs (e.g. `/rina-vegetable-oil-5l`) replace legacy `.html` product pages. SKU IDs are embedded in CloudFront CDN asset URLs (`/product/(\d+)/`).

2. **Carrefour Kenya (`carrefour.ke`)**:
   - Migrated to **Next.js App Router (React Server Components with streaming hydration)**.
   - Sibling span layout for currency (`KES`) and amount (`18,995.00`) sharing identical typography classes caused legacy queries to match `"KES"` and parse price as `0`.
   - Card containers require modern `.group` and `.border-gray-50` relative wrappers.

3. **Neat Display & Anti-Collision Mandate**:
   - Blind absolute positioning (`position: absolute; top: 8px; right: 8px;`) caused badges to directly collide with and obscure product titles and prices in horizontal row views (e.g., cart, checkout lists) and PDP buy-boxes.
   - Category gating was required to prevent non-food products (e.g., electronics, televisions, appliances, smartphones) from being scanned or receiving badges.

---

## 2. Reverse-Engineered Platform Architectures

### 2.1 Naivas Online (`naivas.online`)

| Layer | Implementation Details |
|---|---|
| **Frontend Stack** | React 18, Vite, Tailwind CSS v4, BProgress SPA Router |
| **URL Topology** | Root slugs (e.g. `https://www.naivas.online/rina-vegetable-oil-5l`), categories at `/food-cupboard`, etc. |
| **Product Identifier** | CloudFront CDN image path: `https://d16zmt6hgq1jhj.cloudfront.net/product/(\d+)/` or slug fallback |
| **Product Name** | `p.line-clamp-2.text-sm.font-medium.text-pretty.text-neutral-700`, `img[alt]` |
| **Product Price** | Flex container containing sibling spans (`KES` + number): `div.flex.items-center span` |
| **Cart & Buy Controls** | Native buttons (`button:has(svg)`) at bottom-right of tile; React cart drawer / checkout rows |

### 2.2 Carrefour Kenya (`carrefour.ke`)

| Layer | Implementation Details |
|---|---|
| **Frontend Stack** | Next.js App Router (RSC streaming hydration), React, Tailwind CSS |
| **URL Topology** | `/mafken/en/c/[category]` (PLP), `/mafken/en/p/[sku]` (PDP) |
| **Product Identifier** | Canonical SKU from `/p/(\d+)` in anchor href or PIM image URL |
| **Product Name** | `[data-testid='product-title']`, `h2`, `h3`, `.line-clamp-2` |
| **Product Price** | Container `div.flex.flex-wrap.items-baseline.gap-2xs` containing `span` with `KES` and `span` with price |
| **Cart Container** | `.relative.flex.items-start.gap-md`, `[data-testid='cart-item']` |

---

## 3. Resilient Selector Hierarchy

| Retailer | Root Card Containers | Title Selector | Price Container Selector | Product ID / SKU Source |
|---|---|---|---|---|
| **Naivas** | `.group`, `div[class*='rounded-lg border']`, `div:has(> a img[src*='cloudfront.net/product/'])`, `.product-item` | `p.line-clamp-2`, `[class*='line-clamp']`, `span.font-medium`, `h1`, `h2`, `img[alt]` | `div.flex.items-center span`, `span[class*='font-semibold']`, `.price`, `[class*='price']` | 1. `data-product-id` / `data-sku`<br>2. CloudFront CDN URL: `/product/(\d+)/`<br>3. Slug: `naivas.online/([a-z0-9_-]+)` |
| **Carrefour** | `[data-testid='product-card']`, `.group`, `.border-gray-50`, `div[class*='relative flex flex-col']` | `[data-testid='product-title']`, `h2`, `h3`, `.line-clamp-2`, `.line-clamp-1` | `div.items-baseline`, `div[class*='items-baseline']`, `[data-testid='product-price']`, `[class*='price']` | 1. URL regex: `/(?:p\|product)/(\d+)`<br>2. `data-product-id` / `data-id`<br>3. Canonical slug |
| **Quickmart** | `.product-listing .products`, `.productInfoJs`, `.product-card`, `.product` | `.products-title`, `.product-title`, `h2`, `h3`, `h4`, `a[title]` | `.products-price-new`, `.products-price`, `.product-price`, `.price` | 1. `input[name="selprod_id"]`<br>2. `data-selprod-id` / `data-product-id`<br>3. `/products/view/(\d+)` |

---

## 4. Anti-Collision Layout Architecture

To prevent badges from colliding with product titles or prices across all form factors:

```
+-----------------------------------------------------------------------------------+
| 1. PLP Grid View (Vertical Card):                                                 |
|    Anchor to the Media / Image Container (mediaWrapper)                           |
|    position: absolute; top: 8px; right: 8px; z-index: 10;                         |
|    -> Badge is physically locked to the product photo, far above title & price.   |
+-----------------------------------------------------------------------------------+
| 2. Horizontal Cart / List View (Shopping Cart, Checkout, Order Review):          |
|    [Checkbox] [Thumbnail] [Title]                                                |
|                           [NUTRISCORE BADGE: in-flow margin: 4px 0 6px 0]         |
|                           [KES 70.00]                                             |
|    targetAnchor = titleEl; targetAnchor.insertAdjacentElement("afterend", badge)  |
|    display: inline-flex; clear: both; width: fit-content;                         |
|    -> Zero collision: title above, badge in middle, price below.                  |
+-----------------------------------------------------------------------------------+
| 3. Product Detail Page (PDP Buy-Box):                                             |
|    [Product Title (H1)]                                                           |
|    [NUTRISCORE BADGE: in-flow margin: 8px 0 12px 0]                               |
|    [KES 1,250.00]                                                                 |
|    [Add to Cart Button]                                                           |
|    targetAnchor = h1; targetAnchor.insertAdjacentElement("afterend", badge)       |
|    display: inline-flex; clear: both; width: fit-content;                         |
|    -> Seamless integration with retailer typography flow.                         |
+-----------------------------------------------------------------------------------+
```

---

## 5. Non-Food Category Gating & Catalog Exclusivity

Badges are exclusively feasible for food segment items validated in the respective retailer database catalogs (`naivas_products.json`, `carrefour_products.json`, `quickmart_products.json`).

### 5.1 Category Filter
Before querying candidate cards or injecting badges, the adapter normalizes the page category and URL:

```javascript
_isNonFoodCategory(categoryText, urlString) {
  const combined = `${categoryText || ""} ${urlString || ""}`.toLowerCase().replace(/[-_&/]/g, " ").replace(/\s+/g, " ");
  const nonFoodKeywords = [
    "electronic", "appliance", "television", "tv", "audio", "video",
    "smartphone", "phone", "mobile", "tablet", "computer", "laptop",
    "clothing", "apparel", "shoe", "fashion",
    "home and living", "home living", "home cleaning", "cleaning", "pet", "furniture", "kitchenware", "cookware",
    "bedding", "bath", "hardware", "tool", "garden",
    "beauty", "cosmetic", "perfume", "fragrance", "personal care",
    "stationery", "office", "toy", "game", "baby gear", "luggage", "automotive"
  ];
  return nonFoodKeywords.some(kw => combined.includes(kw));
}
```

When browsing non-food categories (e.g. electronics, televisions, kitchenware, mobile devices), `candidatesIn()` immediately returns `[]` (zero candidates), saving CPU cycles and network RPCs.

### 5.2 Database Catalog Exclusivity
In `scanner.js` and `shared-ui.js`:
- If a product returns `NOT_FOUND` or has no matching record in the retailer JSON database, `scanner.js` marks `data-nutriscore-scanned="not-found"` and renders **zero badges**.
- If a product is marked `isExcluded: true` (unclassified or non-food segment) with no computed grade, `injectBadge` returns `null` and renders **zero badges**.
- Neutral badges are never blindly attached to arbitrary DOM nodes.

---

## 6. Lifecycle, Debouncing & MutationObserver

1. **Incremental Subtree Scanning (`NutriScanner`)**:
   - `candidatesIn(root)` evaluates only newly mutated subtrees (`O(added nodes)`).
   - `IntersectionObserver` with `rootMargin: 400px 0px` defers RPC lookups until a product card approaches the viewport.
2. **Idempotency**:
   - Previous badges are cleanly removed via `.nutriscore-isolated-root`.
   - Card is marked with `data-nutriscore-scanned="complete"` upon rendering.
3. **Cart Synchronization**:
   - Debounced at 1,000ms using targeted container selectors to prevent thrashing during image loads or Livewire pings.
