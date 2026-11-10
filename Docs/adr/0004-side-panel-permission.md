# ADR 0004 — Side Panel Permission

**Status:** Accepted  
**Date:** 2026-11-10  
**Authors:** NUT-04 Engineering

---

## Context

Binding decision 2 mandates the side panel: "In scope for this release (manifest
`side_panel` plus the `sidePanel` permission; verify its install prompt in Chrome's
documentation and record it in an ADR)."

---

## Decision

Add `side_panel` to the manifest and `sidePanel` to `permissions`.

```json
{
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "permissions": ["alarms", "storage", "scripting", "identity", "sidePanel"]
}
```

**Install-prompt behaviour (verified):**
The `sidePanel` permission does **not** generate a user-visible install warning in
Chrome (verified against Chrome Extensions permission warnings documentation:
https://developer.chrome.com/docs/extensions/mv3/declare_permissions/#warnings).
It is in the "no warning" category, same as `storage` and `alarms`.

**Opening the panel:**
- From the popup: `chrome.sidePanel.open({ windowId })` (Chrome 116+)
- From content script: via `chrome.runtime.sendMessage` → background calls `chrome.sidePanel.open`
- Panel is set to open automatically when clicking the action icon if the user has
  previously opened it (`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`)

**Layout:** Container queries for 320–480 px width; shows basket grade, cart items
sorted worst grade first, reason chip per item, 'Better swap' action, 'Why?' link.

---

## Consequences

**Positive:**
- Side panel provides persistent context without blocking the retailer page
- No install-time warning — smooth onboarding

**Negative / risks:**
- `chrome.sidePanel.open` requires Chrome 116+; `minimum_chrome_version` already set to 110;
  update to 116 in the manifest build argument
- Side panel state is per-window; must sync with the content script via messages

**Stop condition:** If testing reveals the permission does add a warning, stop and
report per §8.6.

