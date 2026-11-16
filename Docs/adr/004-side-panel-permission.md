# ADR-004: Adoption of Chrome MV3 Side Panel Architecture

## Metadata
- **Date:** 2026-11-10
- **Status:** Accepted
- **Authors:** NUT-04 Engineering & UX Team

---

## Context
The shopper extension interface was previously confined to a modal popup (`popup.html`). In live supermarket shopping sessions (e.g., browsing hundreds of grocery items on Quickmart, Naivas, or Carrefour):
1. **Focus Loss Dismissal:** Clicking outside the extension popup immediately dismisses it, losing the shopper's active cart review, nutritional comparison, or filter selections.
2. **Viewport Obstruction:** Large floating modals or injected overlays on the supermarket web page obscure retailer product details, search bars, and native checkout controls.
3. **Persistent Workflow Requirement:** Shoppers need continuous real-time visibility into their basket NutriScore grade, allergen warnings, and clinical prescription adherence as they navigate between product categories.
4. **Install Permission Warning Barrier:** Any browser permission that prompts scary security warnings upon extension installation (e.g., "Read and change all your data on the websites you visit") causes significant drop-off.

---

## Decision
We adopt the Chrome Manifest V3 `side_panel` API (`chrome.sidePanel`) with the `sidePanel` permission:

```json
{
  "permissions": ["alarms", "storage", "scripting", "identity", "sidePanel"],
  "side_panel": {
    "default_path": "sidepanel.html"
  }
}
```

1. **Zero Install Warning:** The `sidePanel` permission is categorized in the "no warning" category by Google Chrome documentation, identical to `storage` and `alarms`. Users encounter zero install friction.
2. **Context Synchronization:** The side panel is launched programmatically via `chrome.sidePanel.open({ windowId })` from the popup or automatically upon action click (`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`).
3. **Responsive Container Queries:** The side panel layout adapts dynamically between 320px and 480px widths using modern CSS container queries, displaying the basket grade, cart items sorted worst-grade first, reason chips, and recommended healthier swaps.

---

## Consequences & Rules

### Positive Consequences
- **Persistent Shopper Surface:** The side panel stays pinned to the side of the browser window as the shopper browses, adds items, and proceeds through checkout.
- **Unobstructed Retailer DOM:** Retailer UI is completely unobstructed.
- **High Retention:** No popup dismissal when clicking in the retailer search box or adding an item to the cart.

### Trade-offs & Operational Risks
- **Minimum Chrome Version:** Requires Google Chrome version 116 or higher. The manifest sets `minimum_chrome_version: "116"`.
- **Per-Window State Synchronization:** The side panel lives in its own DOM window; it synchronizes state with the service worker and content scripts via runtime messaging.

### Strict Enforcement Rules
1. **Never Inject Full-Page Overlays:** Content scripts must not inject blocking modal dialogs into the supermarket DOM; all rich multi-item comparisons belong in the Side Panel or Shadow DOM flyout.
2. **Respect `openPanelOnActionClick`:** Clicking the action icon must respect the user's preference to view the side panel or popup.

