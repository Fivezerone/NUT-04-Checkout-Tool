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

  injectBadge(card, productResult, price, placementStyle = "position:absolute;top:8px;right:8px;z-index:1000;") {
    const badgeContainer = document.createElement("div");
    badgeContainer.className  = "nutriscore-isolated-root";
    badgeContainer.style.cssText = placementStyle;

    const shadow = badgeContainer.attachShadow({ mode: "open" });

    const gradeColors = window.NutriScoreGradeColors || {
      C: { bg: "#ffcc00", txt: "#111111", label: "Moderate" }
    };

    let grade  = (productResult.nutriscore_grade || "UNKNOWN").toUpperCase();
    const isNoData = grade === "UNKNOWN" || grade === "NULL";
    
    let info;
    if (isNoData) {
      grade = "—";
      info = { bg: "#e0e0e0", txt: "#555555", label: "No data" };
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

    const diseaseHTML = diseaseWarnings.length ? `
      <div class="ns-disease-block">
        <div class="ns-disease-title">⚠ Dietary Flags</div>
        ${diseaseWarnings.map(w => `
          <div class="ns-disease-pill">
            <strong>${this.escapeHTML(w.disease)}</strong> — ${this.escapeHTML(w.condition)}
            <span class="ns-qty">${this.escapeHTML(w.triggerQuantity)}</span>
          </div>`).join("")}
        ${disclaimer ? `<div class="ns-disclaimer">${this.escapeHTML(disclaimer)}</div>` : ""}
      </div>` : "";

    const conf = productResult.evidenceTier || productResult.confidence || "";
    const confLabel = conf === "verified" ? "📊 Verified"
                    : conf === "high_confidence" ? "ⓘ High confidence"
                    : conf === "estimated" ? "📋 Category est."
                    : (conf === "unverified" || conf === "rejected") ? "⚠ Not enough data"
                    : conf ? "⚠ Estimated" : "";

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
      .flyout{
        display:none;position:absolute;top:calc(100% + 6px);left:0;
        width:268px;background:#fff;border-radius:10px;
        box-shadow:0 10px 30px rgba(0,0,0,.18);
        padding:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        color:#222;font-size:12px;z-index:9999;
        border:1px solid #e8e8e8;
      }
      .flyout.open{display:block}
      .ns-header{
        background:var(--ns-bg);color:var(--ns-txt);
        padding:8px 10px;border-radius:7px;margin-bottom:10px;
      }
      .ns-header-name{font-weight:700;font-size:13px;line-height:1.3;margin-bottom:2px;}
      .ns-header-grade{font-size:11px;opacity:.9}
      .ns-section-title{
        font-size:10px;font-weight:700;text-transform:uppercase;
        letter-spacing:.8px;color:#777;margin:8px 0 4px;
      }
      .ns-row{
        display:flex;justify-content:space-between;align-items:center;
        padding:4px 0;border-bottom:1px solid #f0f0f0;
      }
      .ns-row:last-child{border-bottom:none}
      .ns-label{color:#555;font-size:11px}
      .ns-value{font-weight:600;font-size:11px;color:#111}
      .ns-conf{font-size:9px;color:#aaa;margin-top:6px;font-style:italic;}
      .ns-disease-block{
        margin-top:10px;padding-top:8px;border-top:2px solid #ffe8e8;
      }
      .ns-disease-title{font-weight:700;color:#c62828;font-size:11px;margin-bottom:5px;}
      .ns-disease-pill{
        background:#fff3f3;border:1px solid #ffd0d0;color:#c62828;
        padding:5px 7px;border-radius:5px;margin-bottom:4px;font-size:10px;
        display:flex;justify-content:space-between;align-items:center;
      }
      .ns-qty{
        background:#c62828;color:#fff;padding:1px 5px;
        border-radius:3px;font-size:9px;font-weight:700;flex-shrink:0;margin-left:6px;
      }
      .ns-disclaimer{font-size:9px;color:#999;margin-top:4px;font-style:italic;}
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
      <div class="flyout">
        <button class="ns-close" style="display:none"></button>
        <div class="ns-header" style="--ns-bg: ${info.bg}; --ns-txt: ${info.txt};">
          <div class="ns-header-name">${name}</div>
          <div class="ns-header-grade">NutriScore ${grade} — ${info.label}</div>
        </div>
        <div class="ns-section-title">${this.escapeHTML(productResult.packSizeUnit ? ('Per 100 ' + productResult.packSizeUnit) : "Per 100g / 100ml")}</div>
        ${nutriRowsHTML}
        ${confLabel ? ('<div class="ns-conf">' + confLabel + '</div>') : ""}
        ${diseaseHTML}
      </div>
    `;

    const trigger = shadow.querySelector(".badge-trigger");
    const flyout  = shadow.querySelector(".flyout");

    trigger.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      const rect = trigger.getBoundingClientRect();
      // Determine if the flyout (width 268px) goes off-screen to the right
      if (rect.left + 268 > window.innerWidth) {
        flyout.style.left = "auto";
        flyout.style.right = "0";
      } else {
        flyout.style.left = "0";
        flyout.style.right = "auto";
      }
      flyout.classList.toggle("open");
    });
    const closeBtn = shadow.querySelector(".ns-close");
    if (closeBtn) closeBtn.addEventListener("click", () => flyout.classList.remove("open"));

    card.setAttribute("data-nutriscore-id", productResult.productId || "");
    // Force the card to be the positioned ancestor so absolute children
    // anchor to it — not to any inner Tailwind `relative` wrapper (e.g. image containers).
    // overflow:visible ensures the badge is never clipped.
    card.style.position = "relative";
    card.style.overflow = "visible";
    card.appendChild(badgeContainer);
    return shadow;
  }
};
