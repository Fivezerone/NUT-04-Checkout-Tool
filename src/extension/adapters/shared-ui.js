// shared-ui.js — NUT-04 Checkout Tool Handles badge injection, flyout rendering, alternatives accordion, and portal stacking. Feature B: Disease warning copy now embeds threshold inline — .ns-qty pill removed. Feature A: findHealthierAlternatives() + accordion render from live IndexedDB data. Feature C: Global Shadow Portal — badge z-index 10 (passive flow), flyout portaled to window._nutriscoreGlobalPortal (position:fixed, z-index max). Single-flyout constraint.

const NutriSharedUI = {
  parsePrice(text) {
    if (!text) return 0;
    const match = text.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/);
    if (match) {
      return parseFloat(match[0].replace(/,/g, ''));
    }
    return 0;
  },

  generateIdFromName(name) {
    if (!name) return "";
    return "synth_" + name.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 32);
  },

  escapeHTML(str) {
    if (typeof str !== "string") return String(str ?? "");
    return str.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  },

  async fetchWithRetry(url, options, maxRetries = 3) {
    let delay = 500;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
          // Success, or a client error that shouldn't be retried (except 429)
          return res;
        }
      } catch (e) {
        if (i === maxRetries - 1) throw e;
      }
      await new Promise(r => setTimeout(r, delay));
      delay *= 2; // exponential backoff
    }
    throw new Error(`fetchWithRetry failed after ${maxRetries} attempts`);
  },

  async firstNonEmpty(strategies) {
    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result && result.length > 0) return result;
      } catch (e) {
        // Strategy failed, continue to next
      }
    }
    return [];
  },


  // Close whatever flyout is currently open (single-flyout constraint, Part C3).
  _closeActiveFlyout() {
    if (window._nutriscoreActiveFlyout) {
      // D-27: remove Escape handler before removing element
      if (window._nutriscoreActiveFlyout._nsEscHandler) {
        document.removeEventListener('keydown', window._nutriscoreActiveFlyout._nsEscHandler);
      }
      window._nutriscoreActiveFlyout.remove();
      window._nutriscoreActiveFlyout = null;
    }
    // D-15b: always remove the outside-click listener to prevent leaks
    if (window._nutriscoreOutside) {
      document.removeEventListener('click', window._nutriscoreOutside, true);
      window._nutriscoreOutside = null;
    }
    window._nutriscoreActiveTrigger = null;
  },

  // --------------------------------------------------------------------------- Feature C — Global Shadow Portal (Part C2) Creates window._nutriscoreGlobalPortal once, appended to document.body. All flyouts are portaled here; badges stay at z-index 10 in their cards. ---------------------------------------------------------------------------
  _ensureGlobalPortal() {
    // D-15c: check isConnected to handle SPA body swaps that detach the portal
    if (window._nutriscoreGlobalPortal?.isConnected) return window._nutriscoreGlobalPortal;

    const host = document.createElement("div");
    host.id = "nutriscore-global-portal-host";
    host.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "width:100vw",
      "height:100vh",
      "pointer-events:none",
      "z-index:2147483647",
      "overflow:visible",
    ].join(";");
    
    // Match dark theme from root element if present
    if (document.documentElement.getAttribute('data-theme') === 'dark' || document.documentElement.classList.contains('dark')) {
      host.setAttribute('data-theme', 'dark');
    }
    
    (document.body || document.documentElement).appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    
    const style = document.createElement('style');
    style.textContent = `
:host { --ns-surface:#fff; --ns-surface-raised:#f8fafc; --ns-text:#0f172a; --ns-text-muted:#64748b; --ns-border:#e2e8f0; --ns-focus:#2563eb; --ns-radius:10px;
        --ns-font-body: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
:host([data-theme="dark"]) { --ns-surface:#0f172a; --ns-surface-raised:#1e293b; --ns-text:#f8fafc; --ns-text-muted:#cbd5e1; --ns-border:#334155; --ns-focus:#60a5fa; }
    `;
    shadow.appendChild(style);

    const portal = document.createElement("div");
    portal.id = "nutriscore-global-portal";
    shadow.appendChild(portal);

    window._nutriscoreGlobalPortalHost = host;
    window._nutriscoreGlobalPortal = portal;

    // Fix #9: store handler reference so it can be removed on teardown.
    if (!window._nutriscoreScrollBound) {
      window._nutriscoreScrollBound = true;
      window._nutriscoreScrollHandler = () => {
        NutriSharedUI._closeActiveFlyout();
      };
      window.addEventListener("scroll", window._nutriscoreScrollHandler,
        { passive: true, capture: true });
    }

    return portal;
  },

  // --------------------------------------------------------------------------- Main badge injection ---------------------------------------------------------------------------

  injectBadge(card, productResult, price, placementStyle) {
    const existingBadge = card.querySelector?.(".nutriscore-isolated-root");
    if (existingBadge) existingBadge.remove();

    if (!placementStyle) placementStyle = "position:absolute;top:8px;right:8px;z-index:10;";
    const badgeContainer = document.createElement("div");
    badgeContainer.className = "nutriscore-isolated-root";
    badgeContainer.style.cssText = placementStyle;

    const shadow = badgeContainer.attachShadow({ mode: "open" });

    const gradeColors = window.NutriScoreGradeColors || {
      C: { bg: "#ffcc00", txt: "#111111", label: "Moderate" }
    };

    let grade = (productResult.nutriscore_grade || "UNKNOWN").toUpperCase();
    const scoringStatus = productResult.scoringStatus || "computed";
    const isNoData = grade === "UNKNOWN" || grade === "NULL" || scoringStatus === "not_attempted" || scoringStatus === "insufficient_data";

    let info;
    if (isNoData) {
      grade = "—";
      info = { bg: "#e0e0e0", txt: "#555555", label: scoringStatus === "insufficient_data" ? "Incomplete data" : "No data" };
    } else {
      info = gradeColors[grade] || gradeColors.C;
    }

    const styles = `
      *{box-sizing:border-box;margin:0;padding:0}
      .badge-trigger{
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        background:var(--ns-bg);color:var(--ns-txt);
        font-weight:800;font-size:11px;letter-spacing:.5px;
        padding:3px 8px;border-radius:4px;
        box-shadow:0 2px 6px rgba(0,0,0,.2);
        cursor:pointer;display:inline-flex;align-items:center;gap:5px;
        transition:transform .15s;user-select:none;
      }
      .badge-trigger:hover{transform:scale(1.05)}
      .badge-grade{font-size:15px;font-weight:900}
    `;

    // Fix #10: module-scope CSSStyleSheet — parsed once for the page lifetime.
    if (!NutriSharedUI._badgeStyleSheet) {
      NutriSharedUI._badgeStyleSheet = new CSSStyleSheet();
      NutriSharedUI._badgeStyleSheet.replaceSync(styles);
    }
    shadow.adoptedStyleSheets = [NutriSharedUI._badgeStyleSheet];

    // Fix #11: createElement instead of innerHTML — avoids HTML parse overhead
    // on every badge injection (20-60 cards per scroll burst on Quickmart PLP).
    const trigger = document.createElement("div");
    trigger.className = "badge-trigger";
    trigger.style.setProperty("--ns-bg", info.bg);
    trigger.style.setProperty("--ns-txt", info.txt);

    const label = document.createElement("span");
    if (isNoData) {
      label.textContent = "No data";
    } else {
      label.className = "badge-grade";
      label.textContent = grade;
    }
    trigger.appendChild(label);
    shadow.appendChild(trigger);

    // --------------------------------------------------------------------------- Feature C — badge click: portal flyout into global overlay (Part C3) ---------------------------------------------------------------------------

    // D-27: make badge keyboard-accessible
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-label', `NutriScore ${grade}${info?.label ? ' — ' + info.label : ''}, tap to open details`);
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
    });

    trigger.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();

      // D-15a: toggle — if the same badge was already open, just close it
      const wasOpen = window._nutriscoreActiveTrigger === trigger && !!window._nutriscoreActiveFlyout;
      NutriSharedUI._closeActiveFlyout();
      if (wasOpen) return;

      window._nutriscoreActiveTrigger = trigger;
      const portal = NutriSharedUI._ensureGlobalPortal();

      // Performance: compute nutritional rows & display metadata on-demand upon click (lazy evaluation)
      const name = this.escapeHTML(productResult.product_name || "");
      const prof = productResult.nutritional_profile_display || {};
      const diseaseWarnings = productResult.diseaseWarnings || [];
      const disclaimer = productResult.diseaseDisclaimer || "";

      const rawRows = [
        { label: "Energy", val: prof.energy_kj, unit: "kJ" },
        { label: "Fat", val: prof.fat_g, unit: "g" },
        { label: "Saturated Fat", val: prof.sat_fat_g, unit: "g" },
        { label: "Carbohydrates", val: prof.carbs_g, unit: "g" },
        { label: "Sugars", val: prof.sugars_g, unit: "g" },
        { label: "Fibre", val: prof.fibre_g, unit: "g" },
        { label: "Protein", val: prof.protein_g, unit: "g" },
        { label: "Sodium", val: prof.sodium_mg, unit: "mg" },
      ];

      const rows = rawRows
        // D-19: preserve zero values (e.g. 0g sugar, 0mg sodium) — they are nutritionally significant
        .filter(r => r.val !== null && r.val !== undefined && r.val !== '')
        .map(r => ({ label: r.label, value: `${this.escapeHTML(String(r.val))} ${r.unit}` }));

      let diseaseHTML = "";

      const conf = productResult.evidenceTier || productResult.confidence || "";
      let confLabel = "";
      if (conf === "high_confidence") confLabel = "ⓘ High confidence";
      else if (conf === "confirmed") confLabel = "📊 Verified";
      else if (conf === "estimated") confLabel = "📋 Category est.";
      else if (conf === "not_rated") confLabel = "⚠ Not enough data";
      else if (conf) confLabel = "⚠ Estimated";

      const provLevel = productResult.evidenceLevel || "unknown";
      const EVIDENCE_LABEL = {
        direct_label: "Product label",
        retailer_product_page: "Retailer website",
        manufacturer: "Manufacturer data",
        kfct2018_database: "KFCT 2018 reference",
        international_fct_database: "Matched reference",
        derived: "Derived from ingredients",
        category_reference: "Category estimate",
        unknown: "Unknown provenance",
      };
      const provCaption = EVIDENCE_LABEL[provLevel] || "Unknown provenance";

      const flyoutEl = document.createElement("div");
      flyoutEl.style.cssText = [
        "position:absolute",
        "width:240px",
        "background:var(--ns-surface)",
        "border-radius:16px",
        "box-shadow:0 10px 40px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)",
        "overflow:hidden",
        "font-family:var(--ns-font-body)",
        "color:var(--ns-text)",
        "font-size:12px",
        "border:1px solid var(--ns-border)",
        "pointer-events:auto",
        "z-index:999999",
        "visibility:hidden"
      ].join(";");

      const sectionTitle = this.escapeHTML(
        productResult.packSizeUnit ? ('Per 100 ' + productResult.packSizeUnit) : "Per 100g / 100ml"
      );

      // Inline styles for flyout content (outside shadow, no adoptedStyleSheets)
      let rowsHTML = "";
      if (scoringStatus === "insufficient_data" && productResult.plausibleFields && productResult.plausibleFields.length > 0) {
        rowsHTML = productResult.plausibleFields.map(r => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--ns-surface-raised);">
            <span style="color:var(--ns-text-muted);font-size:11px;font-style:italic;">${this.escapeHTML(r.field)}</span>
            <span style="font-weight:600;font-size:11px;color:var(--ns-text);opacity:0.6;">${this.escapeHTML(String(r.value))} ${r.unit} (plausible)</span>
          </div>`).join("");
      } else {
        rowsHTML = rows.map(r => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--ns-surface-raised);">
            <span style="color:var(--ns-text-muted);font-size:11px;">${r.label}</span>
            <span style="font-weight:600;font-size:11px;color:var(--ns-text);">${r.value}</span>
          </div>`).join("");
      }

      let activeTheme = window._nutriscoreCurrentTheme !== undefined
        ? window._nutriscoreCurrentTheme
        : (productResult.activeTheme || "general");

      const modeObj = self.NutriHealthModes && self.NutriHealthModes[activeTheme];
      if (activeTheme !== 'general' && !modeObj) console.error('[NutriScore] NutriHealthModes missing in content world — check manifest.json content_scripts ordering');
      const tc = modeObj ? { bg: modeObj.palette.accentBg, accent: modeObj.palette.primary, label: modeObj.palette.primary, detail: modeObj.palette.headerSub } : null;
      const chipPrefix = modeObj ? modeObj.chipPrefix : "";
      // Ensure WCAG AA (>= 4.5:1) text contrast on white surface (specifically darken hypertension to #C2410C)
      const alertColor = activeTheme === "hypertension" ? "#C2410C" : (tc ? tc.label : "#C2410C");

      // Render disease warnings using plain colored text whenever any health condition except general wellness is selected.
      let warningsList = Array.isArray(diseaseWarnings) ? [...diseaseWarnings] : [];

      // Dynamic calculation fallback if diseaseWarnings is empty but nutritional values exceed benchmark
      if (activeTheme !== "general" && warningsList.length === 0) {
        if (activeTheme === "diabetes") {
          if (prof.sugars_g !== null && prof.sugars_g !== undefined && prof.sugars_g > 22.5) {
            warningsList.push({ disease: "Diabetes Risk", condition: "High sugar (>22.5g per 100g)", triggerQuantity: `${prof.sugars_g}g` });
          }
          if (prof.carbs_g !== null && prof.carbs_g !== undefined && prof.carbs_g > 60.0) {
            warningsList.push({ disease: "Diabetes Risk", condition: "High carbohydrates (>60g per 100g)", triggerQuantity: `${prof.carbs_g}g` });
          }
        } else if (activeTheme === "hypertension") {
          if (prof.sodium_mg !== null && prof.sodium_mg !== undefined && prof.sodium_mg > 600.0) {
            warningsList.push({ disease: "Hypertension Risk", condition: "High sodium (>600mg per 100g)", triggerQuantity: `${prof.sodium_mg}mg` });
          }
          if (prof.sat_fat_g !== null && prof.sat_fat_g !== undefined && prof.sat_fat_g > 5.0) {
            warningsList.push({ disease: "Hypertension Risk", condition: "High saturated fat (>5g per 100g)", triggerQuantity: `${prof.sat_fat_g}g` });
          }
        } else if (activeTheme === "kidney") {
          if (prof.sodium_mg !== null && prof.sodium_mg !== undefined && prof.sodium_mg > 600.0) {
            warningsList.push({ disease: "Kidney Risk", condition: "High sodium (>600mg per 100g)", triggerQuantity: `${prof.sodium_mg}mg` });
          }
          if (prof.potassium_mg !== null && prof.potassium_mg !== undefined && prof.potassium_mg > 200.0) {
            warningsList.push({ disease: "Kidney Risk", condition: "High potassium (>200mg per 100g)", triggerQuantity: `${prof.potassium_mg}mg` });
          }
          if (prof.protein_g !== null && prof.protein_g !== undefined && prof.protein_g > 15.0) {
            warningsList.push({ disease: "Kidney Risk", condition: "High protein (>15g per 100g)", triggerQuantity: `${prof.protein_g}g` });
          }
        } else if (activeTheme === "obesity") {
          if (prof.sugars_g !== null && prof.sugars_g !== undefined && prof.sugars_g > 22.5) {
            warningsList.push({ disease: "Obesity Risk", condition: "High sugar (>22.5g per 100g)", triggerQuantity: `${prof.sugars_g}g` });
          }
          if (prof.sat_fat_g !== null && prof.sat_fat_g !== undefined && prof.sat_fat_g > 5.0) {
            warningsList.push({ disease: "Obesity Risk", condition: "High saturated fat (>5g per 100g)", triggerQuantity: `${prof.sat_fat_g}g` });
          }
        }
      }

      if (activeTheme !== "general" && tc && warningsList.length > 0) {
        diseaseHTML = warningsList.map(w => `
          <div style="margin-bottom:5px;line-height:1.25;">
            <div style="color:${alertColor};font-size:11px;font-weight:700;">
              ${this.escapeHTML(chipPrefix)}
            </div>
            <div style="color:${alertColor};font-size:11px;font-weight:400;">
              ${this.escapeHTML(w.condition)}
            </div>
          </div>`).join("");
        diseaseHTML += `<div style="font-size:10px;color:var(--ns-text-muted);margin:4px 0 10px;line-height:1.2;">Informational only, not medical advice.</div>`;
      } else {
        diseaseHTML = "";
      }

      // Full-width flush colored header — top corners inherit container's 16px radius via
      // overflow:hidden on the root element; bottom corners are sharp (border-radius:0).
      flyoutEl.innerHTML = `
        <div style="
          background:${info.bg};
          color:${info.txt};
          padding:13px 14px 11px 14px;
          border-radius:0;
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:8px;
        ">
          <div>
            <div style="font-weight:800;font-size:14px;line-height:1.3;margin-bottom:3px;">${name}</div>
            <div style="font-size:11.5px;opacity:.88;font-weight:500;">NutriScore ${grade}&nbsp;&middot;&nbsp;${info.label}</div>
          </div>
          <button data-ns-close style="
            background:none;
            border:none;
            cursor:pointer;
            color:${info.txt};
            opacity:.7;
            padding:0;
            line-height:1;
            font-size:18px;
            flex-shrink:0;
            margin-top:1px;
          " aria-label="Close">&times;</button>
        </div>
        <div style="padding:11px 14px 13px 14px;">
          ${diseaseHTML}
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--ns-text-muted);margin:0 0 4px;">${sectionTitle}</div>
          ${rowsHTML}
          ${confLabel ? `<div style="font-size:11px;color:var(--ns-text-muted);margin-top:6px;">${confLabel} &middot; ${this.escapeHTML(provCaption)}</div>` : ""}
        </div>
      `;

      portal.appendChild(flyoutEl);
      window._nutriscoreActiveFlyout = flyoutEl;

      // D-27: flyout accessibility — role=dialog so screen readers announce it correctly
      flyoutEl.setAttribute('role', 'dialog');
      flyoutEl.setAttribute('aria-label', productResult?.product_name || 'Product details');
      flyoutEl.setAttribute('aria-modal', 'true');
      flyoutEl.setAttribute('tabindex', '-1');

      // D-27: Escape key closes flyout (auto-removed when flyout closes via _closeActiveFlyout)
      const escHandler = (e) => {
        if (e.key === 'Escape') { NutriSharedUI._closeActiveFlyout(); }
      };
      document.addEventListener('keydown', escHandler);
      // Store on flyoutEl so _closeActiveFlyout can remove it
      flyoutEl._nsEscHandler = escHandler;

      // Wire header close button
      const closeBtn = flyoutEl.querySelector("[data-ns-close]");
      if (closeBtn) {
        closeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          NutriSharedUI._closeActiveFlyout();
        });
      }

      // D-14: wire upgrade CTA in the content-script world where chrome.runtime works
      const upgradeCta = flyoutEl.querySelector('[data-ns-upgrade]');
      if (upgradeCta) {
        upgradeCta.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'OPEN_UPGRADE' }).catch(() => {});
        });
        // CSS :hover substitute — inline style toggle in content world
        upgradeCta.addEventListener('mouseenter', () => { upgradeCta.style.opacity = '0.8'; });
        upgradeCta.addEventListener('mouseleave', () => { upgradeCta.style.opacity = '1'; });
      }

      const rect = trigger.getBoundingClientRect();
      const margin = 12; // Safety margin from screen edges
      const initialFlyoutWidth = 240;

      // X-axis: default bottom-left relative to badge; clamp within viewport.
      let leftPos = rect.left;
      if (leftPos + initialFlyoutWidth > window.innerWidth - margin) {
        leftPos = window.innerWidth - initialFlyoutWidth - margin;
      }
      if (leftPos < margin) leftPos = margin;

      // Immediate synchronous placement (<1ms render without blank frame delay)
      flyoutEl.style.left = leftPos + "px";
      flyoutEl.style.top = (rect.bottom + 6) + "px";
      flyoutEl.style.visibility = "visible";

      // Dynamic geometry refinement & accessible focus management
      requestAnimationFrame(() => {
        const flyoutRect = flyoutEl.getBoundingClientRect();
        const flyoutWidth = flyoutRect.width || initialFlyoutWidth;
        const flyoutHeight = flyoutRect.height || 160;

        let refinedLeft = rect.left;
        if (refinedLeft + flyoutWidth > window.innerWidth - margin) {
          refinedLeft = window.innerWidth - flyoutWidth - margin;
        }
        if (refinedLeft < margin) refinedLeft = margin;
        flyoutEl.style.left = refinedLeft + "px";

        // Y-axis: flip above if insufficient space below
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < flyoutHeight + margin && rect.top > flyoutHeight + margin) {
          // Flip above
          flyoutEl.style.bottom = (window.innerHeight - rect.top + 6) + "px";
          flyoutEl.style.top = "auto";
        } else {
          // Default below
          flyoutEl.style.top = (rect.bottom + 6) + "px";
          flyoutEl.style.bottom = "auto";
        }

        // Move focus into flyout so SR announces it without triggering scroll disruption
        const firstFocusable = flyoutEl.querySelector('button,[tabindex="0"]');
        (firstFocusable || flyoutEl).focus?.({ preventScroll: true });
      });

      // D-15b: store outside-click listener on window so _closeActiveFlyout can always remove it
      window._nutriscoreOutside = (ev) => {
        const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
        if (!path.includes(flyoutEl) && !path.includes(trigger)) {
          NutriSharedUI._closeActiveFlyout();
        }
      };
      setTimeout(() => {
        if (window._nutriscoreActiveFlyout === flyoutEl && window._nutriscoreOutside) {
          document.addEventListener('click', window._nutriscoreOutside, true);
        }
      }, 0);
    });

    // Feature C Part C1: badge z-index is 10 (passive, inherits card stacking).
    card.setAttribute("data-nutriscore-id", productResult.productId || "");
    card.style.position = "relative";
    card.style.overflow = "visible";
    card.appendChild(badgeContainer);
    return shadow;
  },

  // Fix #9: teardown portal and scroll listener to prevent memory leaks.
  _teardownPortal() {
    if (window._nutriscoreScrollHandler) {
      window.removeEventListener("scroll", window._nutriscoreScrollHandler,
        { capture: true });
      window._nutriscoreScrollBound = false;
      window._nutriscoreScrollHandler = null;
    }
    window._nutriscoreGlobalPortalHost?.remove();
    window._nutriscoreGlobalPortal = null;
    window._nutriscoreGlobalPortalHost = null;
  },

};

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  try {
    chrome.storage.local.get(['uiTheme', 'settings_live', 'user_preferences'], (res) => {
      const theme = res?.uiTheme || res?.settings_live?.uiTheme || (res?.user_preferences?.selectedTags && res.user_preferences.selectedTags[0]) || "general";
      window._nutriscoreCurrentTheme = theme;
    });
  } catch (e) {}

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const newTheme = changes.uiTheme?.newValue ?? changes.settings_live?.newValue?.uiTheme ?? (changes.user_preferences?.newValue?.selectedTags && changes.user_preferences.newValue.selectedTags[0]);
      if (newTheme !== undefined) {
        window._nutriscoreCurrentTheme = newTheme || "general";
      }
      if (changes.uiTheme || changes.settings_live || changes.user_preferences) {
        // Instantly unmount any active flyout when the user switches modes in the dashboard or options
        if (window._nutriscoreActiveFlyout && NutriSharedUI._closeActiveFlyout) {
          NutriSharedUI._closeActiveFlyout();
        }
      }
    }
  });
}
