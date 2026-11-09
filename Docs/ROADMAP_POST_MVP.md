# NutriScore CAD — Post-MVP Commercial Roadmap

**Reference:** Decision D6 (Overlay-only MVP), Blueprint §4.3

---

## 1. Executive Summary

Under **Decision D6**, the NutriScore CAD MVP is strictly **overlay-only**:
- Operates via the Chrome extension (and companion app) scoring overlays on external grocery platforms (Naivas, Carrefour Kenya, Quickmart Kenya).
- Captures grocery shopping events into `commercial.orders` and `commercial.order_lines` as **observed ledger events** (`source = 'extension_observed'`).
- Eliminates inventory management, payment gateways, native shopping carts, and storefront logistics from the current MVP scope.

This document records the architectural roadmap for transitioning from an overlay-only model to a first-party digital health storefront post-MVP.

---

## 2. First-Party Storefront Architecture & Schema Support

The **CAD Multi-Tenant Healthcare Backend Blueprint §4.3** already designs the foundational schema for direct commercial operations:

### Blueprint Schema Support: `commercial`

| Capability | Blueprint Schema & Table | Description |
|---|---|---|
| **Inventory & Stock Management** | `commercial.inventory` | Defined in Blueprint §4.3 (`tenant_id`, `sku_id`, `partner_site`, `on_hand`, `price_kes`, `updated_at`). Tracks partner-site availability and real-time localized pricing. |
| **Partner SKU Cross-Referencing** | `commercial.sku_mappings` | Shipped in Phase 8 (`tenant_id`, `sku_id`, `partner_sku`, `tags`). Connects external retailer product catalogs to clinical tags and internal SKU models. |
| **Direct Order Processing** | `commercial.orders` | Evolution from `source = 'extension_observed'` to native transactions (`source = 'storefront_direct'`), introducing delivery address references and fulfilment states. |
| **Order Itemization** | `commercial.order_lines` | Shipped in Phase 8 (`order_id`, `sku_id`, `qty`, `unit_price_kes`). Pre-configured for direct transaction line-item calculation. |
| **De-Identified Demand Analytics** | `commercial.v_sku_demand` | Shipped in Phase 8 ($k \ge 5$ distinct shoppers gate). Provides partner retailers with weekly SKU velocity without individual re-identification. |

---

## 3. Post-MVP Feature Phases

### Phase A: Partner Inventory Synchronization
- Implement scheduled or webhook-based ingestion into `commercial.inventory`.
- Support multi-store availability checks based on the shopper's delivery locale.
- Introduce price discrepancy tracking between observed catalog and live inventory.

### Phase B: First-Party Storefront (`shop.nutriscore.co.ke`)
- Stand up consumer-facing web storefront with DPT-driven constraint enforcement.
- Enable direct-to-consumer basket assembly conforming to prescribed dietary profiles.
- Automated alternative product recommendations when a selected item violates a nutrient band.

### Phase C: Payment Routing & Settlement
- Integrate sovereign mobile money APIs (M-Pesa / Daraja B2C/C2B) and card processors for direct transaction clearing.
- Multi-party settlement between healthcare provider tenants, retail fulfillment partners, and NutriScore platform.

### Phase D: Fulfillment & Logistics
- Partner dispatch API integration for automated picking, packing, and courier delivery tracking.
- Cold-chain compliance telemetry for temperature-sensitive dietary provisions.
