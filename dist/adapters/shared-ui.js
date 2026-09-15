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
    return str.replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
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

  // --------------------------------------------------------------------------- Feature C — Global Shadow Portal (Part C2) Creates window._nutriscoreGlobalPortal once, appended to document.body. All flyouts are portaled here; badges stay at z-index 10 in their cards. ---------------------------------------------------------------------------
  _ensureGlobalPortal() {
    if (window._nutriscoreGlobalPortal) return window._nutriscoreGlobalPortal;

    const portal = document.createElement("div");
    portal.id = "nutriscore-global-portal";
    portal.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "width:100vw",
      "height:100vh",
      "pointer-events:none",
      "z-index:2147483647",
      "overflow:visible",
    ].join(";");
    document.body.appendChild(portal);
    window._nutriscoreGlobalPortal = portal;

    // Passive scroll listener — close any open flyout on page scroll (Part C3).
    window.addEventListener("scroll", () => {
      NutriSharedUI._closeActiveFlyout();
    }, { passive: true, capture: true });

    return portal;
  },

  // Close whatever flyout is currently open (single-flyout constraint, Part C3).
  _closeActiveFlyout() {
    if (window._nutriscoreActiveFlyout) {
      window._nutriscoreActiveFlyout.remove();
      window._nutriscoreActiveFlyout = null;
    }
  },

  // --------------------------------------------------------------------------- Main badge injection ---------------------------------------------------------------------------

  // --------------------------------------------------------------------------- Main badge injection ---------------------------------------------------------------------------
  injectBadge(card, productResult, price, placementStyle) {
    if (!placementStyle) placementStyle = "position:absolute;top:8px;right:8px;z-index:10;";
    const badgeContainer = document.createElement("div");
    badgeContainer.className  = "nutriscore-isolated-root";
    badgeContainer.style.cssText = placementStyle;

    const shadow = badgeContainer.attachShadow({ mode: "open" });

    const gradeColors = window.NutriScoreGradeColors || {
      C: { bg: "#ffcc00", txt: "#111111", label: "Moderate" }
    };

    let grade  = (productResult.nutriscore_grade || "UNKNOWN").toUpperCase();
    const scoringStatus = productResult.scoringStatus || "computed";
    const isNoData = grade === "UNKNOWN" || grade === "NULL" || scoringStatus === "not_attempted" || scoringStatus === "insufficient_data";

    let info;
    if (isNoData) {
      grade = "—";
      info = { bg: "#e0e0e0", txt: "#555555", label: scoringStatus === "insufficient_data" ? "Incomplete data" : "No data" };
    } else {
      info = gradeColors[grade] || gradeColors.C;
    }

    const name   = this.escapeHTML(productResult.product_name || "");
    const prof   = productResult.nutritional_profile_display || {};
    const diseaseWarnings = productResult.diseaseWarnings || [];
    const disclaimer      = productResult.diseaseDisclaimer || "";

    const rawRows = [
      { label: "Energy",        val: prof.energy_kj,  unit: "kJ" },
      { label: "Fat",           val: prof.fat_g,      unit: "g" },
      { label: "Saturated Fat", val: prof.sat_fat_g,  unit: "g" },
      { label: "Carbohydrates", val: prof.carbs_g,    unit: "g" },
      { label: "Sugars",        val: prof.sugars_g,   unit: "g" },
      { label: "Fibre",         val: prof.fibre_g,    unit: "g" },
      { label: "Protein",       val: prof.protein_g,  unit: "g" },
      { label: "Sodium",        val: prof.sodium_mg,  unit: "mg" },
    ];

    const rows = rawRows
      .filter(r => r.val != null && r.val !== "")
      .map(r => ({ label: r.label, value: `${this.escapeHTML(String(r.val))} ${r.unit}` }));

    const nutriRowsHTML = rows.map(r => `
      <div class="ns-row">
        <span class="ns-label">${r.label}</span>
        <span class="ns-value">${r.value}</span>
      </div>`).join("");

    // Feature B: .ns-qty pill removed — threshold is now inline in condition string.
    const diseaseHTML = diseaseWarnings.length ? `
      <div class="ns-disease-block">
        <div class="ns-disease-title">&#9888; Dietary Flags</div>
        ${diseaseWarnings.map(w => `
          <div class="ns-disease-pill">
            <strong>${this.escapeHTML(w.disease)}</strong> &#8212; ${this.escapeHTML(w.condition)}
          </div>`).join("")}
        ${disclaimer ? `<div class="ns-disclaimer">${this.escapeHTML(disclaimer)}</div>` : ""}
      </div>` : "";

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

    if (!this.sharedStyleSheet) {
      this.sharedStyleSheet = new CSSStyleSheet();
      this.sharedStyleSheet.replaceSync(styles);
    }
    shadow.adoptedStyleSheets = [this.sharedStyleSheet];

    shadow.innerHTML = `
      <div class="badge-trigger" style="--ns-bg: ${info.bg}; --ns-txt: ${info.txt};">
        ${isNoData ? `<span>No data</span>` : `<span class="badge-grade">${grade}</span>`}
      </div>
    `;

    // --------------------------------------------------------------------------- Feature C — badge click: portal flyout into global overlay (Part C3) ---------------------------------------------------------------------------
    const trigger = shadow.querySelector(".badge-trigger");

    trigger.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();

      // Single-flyout constraint: close current flyout before opening new one.
      NutriSharedUI._closeActiveFlyout();

      const portal = NutriSharedUI._ensureGlobalPortal();

      const flyoutEl = document.createElement("div");
      flyoutEl.style.cssText = [
        "position:absolute",
        "width:240px",
        "background:#ffffff",
        "border-radius:16px",
        "box-shadow:0 10px 40px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)",
        "overflow:hidden",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        "color:#334155",
        "font-size:12px",
        "border:1px solid #E2E8F0",
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
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #F1F5F9;">
            <span style="color:#334155;font-size:11px;font-style:italic;">${this.escapeHTML(r.field)}</span>
            <span style="font-weight:600;font-size:11px;color:#0F172A;opacity:0.6;">${this.escapeHTML(String(r.value))} ${r.unit} (plausible)</span>
          </div>`).join("");
      } else {
        rowsHTML = rows.map(r => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #F1F5F9;">
            <span style="color:#334155;font-size:11px;">${r.label}</span>
            <span style="font-weight:600;font-size:11px;color:#0F172A;">${r.value}</span>
          </div>`).join("");
      }

      const diseaseInline = diseaseWarnings.length ? `
        <div style="margin-bottom:8px;">
          <div style="font-weight:700;color:#0F172A;font-size:11px;margin-bottom:2px;display:flex;align-items:center;gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#64748B"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>
            Health Alerts
          </div>
          ${diseaseWarnings.map(w => {
            let bg = "#FEF2F2", accentColor = "#DC2626", labelText = "#DC2626", detailText = "#7F1D1D";
            if (w.condition.toLowerCase().includes("sodium") || w.condition.toLowerCase().includes("salt")) {
               bg = "#FFF7ED"; accentColor = "#EA580C"; labelText = "#EA580C"; detailText = "#7C2D12";
            }
            if (w.disease.toLowerCase().includes("kidney")) {
               bg = "#FAF5FF"; accentColor = "#9333EA"; labelText = "#9333EA"; detailText = "#4C1D95";
            }
            return `
            <div style="background:${bg};border-left:4px solid ${accentColor};border-radius:0 6px 6px 0;padding:4px 8px;margin-bottom:4px;font-size:10px;">
              <strong style="color:${labelText}">${this.escapeHTML(w.disease)}:</strong>
              <span style="color:${detailText}">${this.escapeHTML(w.condition)}</span>
            </div>`
          }).join("")}
        </div>` : "";

      const disclaimerHTML = (diseaseWarnings.length && disclaimer) ? `
        <div style="border-top:1px solid #E2E8F0;margin-top:4px;padding-top:4px;">
          <div style="font-size:11px;color:#6B7280;font-style:italic;">${this.escapeHTML(disclaimer)}</div>
        </div>` : "";

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
          ${diseaseInline}
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#64748B;margin:0 0 4px;">${sectionTitle}</div>
          ${rowsHTML}
          ${confLabel ? `<div style="font-size:11px;color:#6B7280;margin-top:6px;">${confLabel} &middot; ${this.escapeHTML(provCaption)}</div>` : ""}
          ${disclaimerHTML}
        </div>
      `;

      portal.appendChild(flyoutEl);
      window._nutriscoreActiveFlyout = flyoutEl;

      // Wire header close button
      const closeBtn = flyoutEl.querySelector("[data-ns-close]");
      if (closeBtn) {
        closeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          NutriSharedUI._closeActiveFlyout();
        });
      }

      // Dynamic Placement — deferred to requestAnimationFrame so getBoundingClientRect()
      // runs after the browser has laid out the flyout's innerHTML content.
      // Previously this was called synchronously (dimensions were always 0×0), which
      // made the flip-above guard permanently dead code.
      const rect = trigger.getBoundingClientRect();
      requestAnimationFrame(() => {
        const flyoutRect = flyoutEl.getBoundingClientRect();
        const flyoutWidth  = flyoutRect.width  || 280; // fallback width if still not laid out
        const flyoutHeight = flyoutRect.height || 160; // fallback height
        const margin = 12; // Safety margin from screen edges

        // X-axis: default bottom-left relative to badge; clamp within viewport.
        let leftPos = rect.left;
        if (leftPos + flyoutWidth > window.innerWidth - margin) {
          leftPos = window.innerWidth - flyoutWidth - margin;
        }
        if (leftPos < margin) leftPos = margin;

        // Y-axis: default below; flip above if insufficient space below.
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < flyoutHeight + margin && rect.top > flyoutHeight + margin) {
          // Flip above
          flyoutEl.style.bottom = (window.innerHeight - rect.top + 6) + "px";
          flyoutEl.style.top    = "auto";
        } else {
          // Default below
          flyoutEl.style.top    = (rect.bottom + 6) + "px";
          flyoutEl.style.bottom = "auto";
        }
        flyoutEl.style.left       = leftPos + "px";
        flyoutEl.style.visibility = "visible";
      });

      // Close on outside click
      const outsideClick = (ev) => {
        if (!flyoutEl.contains(ev.target) && ev.target !== trigger) {
          NutriSharedUI._closeActiveFlyout();
          document.removeEventListener("click", outsideClick, true);
        }
      };
      setTimeout(() => document.addEventListener("click", outsideClick, true), 0);
    });

    // Feature C Part C1: badge z-index is 10 (passive, inherits card stacking).
    card.setAttribute("data-nutriscore-id", productResult.productId || "");
    card.style.position = "relative";
    card.style.overflow = "visible";
    card.appendChild(badgeContainer);
    return shadow;
  },

};
