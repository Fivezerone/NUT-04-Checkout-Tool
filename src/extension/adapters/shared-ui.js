// shared-ui.js — NUT-04 Checkout Tool Handles badge injection, flyout rendering, and portal stacking.
// Feature B: Disease warning copy now embeds threshold inline.
// Feature C: Global Shadow Portal — badge z-index 10 (passive flow), flyout portaled to window._nutriscoreGlobalPortal (position:fixed, z-index max). Single-flyout constraint.

const _shadowRoots = new WeakMap();

const NutriSharedUI = {
  _shadowRoots,

  __getShadowRoot(el) {
    return _shadowRoots.get(el) || el?.shadowRoot || null;
  },

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

  // ADR-9 / A-11: Full jitter backoff, AbortSignal timeout, Retry-After header support, 3-attempt budget
  async fetchWithRetry(url, options = {}, maxRetries = 3) {
    let delay = 1000;
    for (let i = 0; i < maxRetries; i++) {
      try {
        let timeoutSignal = null;
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
          timeoutSignal = AbortSignal.timeout(4000);
        }
        const fetchOptions = { ...options };
        if (timeoutSignal && !fetchOptions.signal) {
          fetchOptions.signal = timeoutSignal;
        }
        const res = await fetch(url, fetchOptions);
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
          // Success, or a client error that shouldn't be retried (except 429)
          return res;
        }
        // Handle Retry-After header on 429 / 503
        if (res.status === 429 || res.status === 503) {
          const retryAfter = res.headers?.get?.("Retry-After");
          if (retryAfter) {
            const parsedSeconds = parseInt(retryAfter, 10);
            if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
              delay = Math.min(60000, parsedSeconds * 1000);
            }
          }
        }
      } catch (e) {
        if (i === maxRetries - 1) throw e;
      }
      // Full jitter: Math.random() * Math.min(60000, delay * (2 ** i)) (ADR-9)
      const jittered = Math.random() * Math.min(60000, delay * Math.pow(2, i));
      await new Promise(r => setTimeout(r, jittered));
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
    const { restoreFocus = false } = (arguments.length > 0 && arguments[0]) ? arguments[0] : {};
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
    if (window._nutriscoreActiveTrigger) {
      window._nutriscoreActiveTrigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) {
        try {
          window._nutriscoreActiveTrigger.focus?.({ preventScroll: true });
        } catch (e) {}
      }
      window._nutriscoreActiveTrigger = null;
    }
  },

  _renderWarning(w, chipPrefix, useClosed) {
    const title = useClosed ? "Nutritional Advisory" : this.escapeHTML(chipPrefix);
    const detail = useClosed
      ? (w.nutrient ? `High in ${this.escapeHTML(w.nutrient)}: above limit` : (w.message ? this.escapeHTML(w.message) : "Above recommended limit"))
      : this.escapeHTML(w.condition);
    return `<div style="margin-bottom:4px;line-height:1.3;"><div style="color:var(--ns-status-advisory-text);font-size:12px;font-weight:700;">${title}</div><div style="color:var(--ns-status-advisory-text);font-size:12px;font-weight:400;">${detail}</div></div>`;
  },

  // Dynamic geometry repositioning for viewport-aware scroll observer
  _repositionFlyout(flyoutEl, trigger) {
    if (!flyoutEl || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const flyoutWidth = 288;

    let leftPos = rect.left;
    if (leftPos + flyoutWidth > window.innerWidth - margin) {
      leftPos = window.innerWidth - flyoutWidth - margin;
    }
    if (leftPos < margin) leftPos = margin;
    flyoutEl.style.left = leftPos + "px";

    const flyoutHeight = flyoutEl.offsetHeight || 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < flyoutHeight + margin && rect.top > flyoutHeight + margin) {
      flyoutEl.style.bottom = (window.innerHeight - rect.top + 6) + "px";
      flyoutEl.style.top = "auto";
    } else {
      flyoutEl.style.top = (rect.bottom + 6) + "px";
      flyoutEl.style.bottom = "auto";
    }
  },

  // ---------------------------------------------------------------------------
  // Feature C — Global Shadow Portal (Part C2)
  // Creates window._nutriscoreGlobalPortal once, appended to document.body.
  // All flyouts are portaled here; badges stay at z-index 10 in their cards.
  // ---------------------------------------------------------------------------
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

    // Match dark theme from extension storage, NEVER from host retailer DOM classes
    if (window._nutriscoreCurrentThemeMode === 'dark') {
      host.setAttribute('data-theme', 'dark');
    }

    (document.body || document.documentElement).appendChild(host);
    const useClosed = typeof NutriFlags !== "undefined"
      ? NutriFlags.isEnabled("ns.ui.closed_shadow", true)
      : true;
    const shadow = host.attachShadow({ mode: useClosed ? "closed" : "open" });
    NutriSharedUI._shadowRoots.set(host, shadow);

    const style = document.createElement('style');
    style.textContent = `
:host {
  --ns-font-body: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --ns-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --ns-canvas: #F5F9FA;
  --ns-surface: #FFFFFF;
  --ns-surface-raised: #FFFFFF;
  --ns-surface-muted: #EAF1F4;
  --ns-border: #D6E3E8;
  --ns-border-subtle: #D6E3E8;
  --ns-border-control: #6B8794;
  --ns-text: #234B5A;
  --ns-text-strong: #073A4B;
  --ns-text-muted: #46636F;
  --ns-placeholder: #5B7682;
  --ns-brand: #04785A;
  --ns-brand-hover: #03644A;
  --ns-brand-subtle: #E6FBF4;
  --ns-focus: #0B6E91;
  --ns-radius: 12px;
  --ns-radius-card: 16px;
  --ns-radius-control: 8px;
  --ns-radius-full: 9999px;
  --ns-shadow-card: 0 1px 2px rgb(7 58 75 / 0.04), 0 1px 3px rgb(7 58 75 / 0.06);
  --ns-shadow-flyout: 0 12px 28px rgb(7 58 75 / 0.12), 0 1px 3px rgb(7 58 75 / 0.05);
  --ns-shadow-raised: 0 12px 28px rgb(7 58 75 / 0.12);
  --ns-grade-a: #038141;
  --ns-grade-b: #85bb2f;
  --ns-grade-c: #fecb02;
  --ns-grade-d: #ee8100;
  --ns-grade-e: #e63e11;
  --ns-on-grade-a: #ffffff;
  --ns-on-grade-b: #14320a;
  --ns-on-grade-c: #3a2e00;
  --ns-on-grade-d: #331c00;
  --ns-on-grade-e: #ffffff;
  --ns-status-advisory-bg: #FFF0EA;
  --ns-status-advisory-text: #9A3412;
  --ns-status-advisory-border: #F78C6A;
  --ns-status-info-bg: #E5F4F9;
  --ns-status-info-text: #0A5A77;
}
:host([data-theme="dark"]) {
  color-scheme: dark;
  --ns-canvas: #04222D;
  --ns-surface: #072C3A;
  --ns-surface-raised: #0B3A4B;
  --ns-surface-muted: #0E3F52;
  --ns-border: #184A5E;
  --ns-border-subtle: #184A5E;
  --ns-border-control: #5E8190;
  --ns-text: #CCE2E8;
  --ns-text-strong: #E6F2F5;
  --ns-text-muted: #A9C3CC;
  --ns-placeholder: #6B8A96;
  --ns-brand: #06D7A0;
  --ns-brand-hover: #34EAB6;
  --ns-brand-subtle: #07353A;
  --ns-focus: #6CC6E3;
  --ns-shadow-card: 0 1px 2px rgb(0 0 0 / 0.3);
  --ns-shadow-flyout: 0 12px 28px rgb(0 0 0 / 0.4), 0 1px 3px rgb(0 0 0 / 0.2);
  --ns-shadow-raised: 0 12px 28px rgb(0 0 0 / 0.4);
  --ns-status-advisory-bg: #3D1F16;
  --ns-status-advisory-text: #F78C6A;
  --ns-status-advisory-border: #9A3412;
  --ns-status-info-bg: #08374D;
  --ns-status-info-text: #6CC6E3;
}
    `;
    shadow.appendChild(style);

    const portal = document.createElement("div");
    portal.id = "nutriscore-global-portal";
    shadow.appendChild(portal);

    window._nutriscoreGlobalPortalHost = host;
    window._nutriscoreGlobalPortal = portal;

    // Viewport-aware scroll listener: updates position if trigger is still visible, closes if scrolled off
    if (!window._nutriscoreScrollBound) {
      window._nutriscoreScrollBound = true;
      window._nutriscoreScrollHandler = () => {
        if (!window._nutriscoreActiveFlyout || !window._nutriscoreActiveTrigger) return;
        if (!window._nutriscoreActiveTrigger.isConnected) {
          NutriSharedUI._closeActiveFlyout();
          return;
        }
        const rect = window._nutriscoreActiveTrigger.getBoundingClientRect();
        const inViewport = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        if (!inViewport) {
          NutriSharedUI._closeActiveFlyout();
          return;
        }
        NutriSharedUI._repositionFlyout(window._nutriscoreActiveFlyout, window._nutriscoreActiveTrigger);
      };
      window.addEventListener("scroll", window._nutriscoreScrollHandler,
        { passive: true, capture: true });
    }

    return portal;
  },

  // ---------------------------------------------------------------------------
  // Neutral fallback injection (T-13 zero blocks)
  // ---------------------------------------------------------------------------
  injectNeutral(card, placementStyle) {
    this.injectBadge(
      card,
      {
        nutriscore_grade: "UNKNOWN",
        scoringStatus: "not_attempted",
      },
      0,
      placementStyle
    );
  },

  // ---------------------------------------------------------------------------
  // Main badge injection
  // ---------------------------------------------------------------------------
  injectBadge(card, productResult, price, placementStyle) {
    if (!card || !productResult) return null;

    // Category / Catalog Gating: Do not render badges on excluded non-food items
    // or items that do not exist in the retailer database
    if (productResult.status === "NOT_FOUND" || productResult.scoringStatus === "not_found") {
      return null;
    }
    if (productResult.isExcluded && (!productResult.nutriscore_grade || productResult.nutriscore_grade === "UNKNOWN") && productResult.scoringStatus === "not_attempted") {
      return null;
    }

    // -------------------------------------------------------------------------
    // Anti-Collision Layout Strategy (PLP Grid vs Horizontal Row vs PDP)
    // Determine placement BEFORE cleanup so we can clean the right anchor.
    // -------------------------------------------------------------------------
    let targetAnchor = card;
    let insertionMode = "append"; // "append" or "afterend"
    let computedStyle = placementStyle;

    if (!computedStyle) {
      const pagePath = typeof location !== "undefined" ? (location.pathname || "").toLowerCase() : "";
      const isKnownPdpUrl = pagePath.includes("/p/") || pagePath.includes("/product/") || pagePath.includes("/products/view/");
      const isKnownCategoryUrl = pagePath.includes("/c/") || pagePath.includes("/category/") || pagePath.includes("/categories/") || pagePath.includes("/search") || pagePath.includes("/collection/");

      // 1. Detect Product Detail Page (PDP) Hero / Buy-Box
      // A PDP container must be a buy-box wrapper (not a grid tile)
      const isPdpBuyBox = !isKnownCategoryUrl && (
        card.matches?.(".product-info-main, [class*='pdp'], [data-testid*='pdp'], .product-detail, #product-detail, [data-slot='product-detail']") ||
        (isKnownPdpUrl && !!card.querySelector?.("h1.page-title, h1[class*='title'], [data-testid='product-title'], h1") && !card.matches?.(".group, .product-item, [class*='card']"))
      );

      // 2. Detect Horizontal List / Cart / Checkout Row
      // A cart row must have an EXPLICIT cart signal: a named cart-item class/testid, a trash/remove
      // button, a quantity combobox/stepper, or a Livewire remove() wire:click attribute.
      // We deliberately avoid matching on input[type='checkbox'] alone because wishlist star/heart
      // toggles on PLP cards are implemented as hidden checkboxes and cause false positives.
      const hasTrashBtn = !!card.querySelector?.("[data-testid='trash-icon'], [data-testid='remove-item'], [aria-label*='remove'], [aria-label*='delete']");
      const hasWireRemove = !!card.querySelector?.("[wire\\:click^='remove(']");
      const hasQtyStepper = !!card.querySelector?.("button[role='combobox'], input[name*='qty'], input[name*='quantity'], [data-testid*='quantity']");
      const isCartOrList = card.matches?.("li[class*='cart'], tr, [class*='cart-item'], [data-testid*='cart-item'], [data-testid*='item-row']") ||
                           hasTrashBtn || hasWireRemove || hasQtyStepper;

      const titleEl = card.querySelector?.("[data-testid='product-title'], h1, h2, h3, h4, .line-clamp-2, .line-clamp-1, [class*='title'], [class*='name']");

      if (isPdpBuyBox && titleEl) {
        // PDP Buy Box: inject in document flow directly beneath title
        targetAnchor = titleEl;
        insertionMode = "afterend";
        computedStyle = "display:inline-flex;align-items:center;margin:8px 0 12px 0;clear:both;position:relative;z-index:10;width:fit-content;";
      } else if (isCartOrList && titleEl) {
        // Horizontal Cart / List Row: inject beneath title element, full-width block so it
        // occupies its own line and does not collapse into the adjacent price/qty column.
        targetAnchor = titleEl;
        insertionMode = "afterend";
        computedStyle = "display:block;margin:4px 0 6px 0;width:fit-content;position:relative;z-index:10;";
      } else {
        // PLP Grid: strictly anchor to the image container so badge is overlaid on the product
        // photo at top-right and NEVER collides with title or price text below.
        // Strategy 1: use img.closest() to find a semantic image wrapper (fastest, most precise).
        // Strategy 2: walk up from img.parentElement until a positioned/named wrapper is found.
        // Strategy 3: fall back to card itself (ensures position:relative is set on it).
        const img = card.querySelector?.("img");
        let mediaWrapper = null;
        if (img) {
          // Strategy 1: closest() — works when wrapper has a known class or is an <a> element
          if (typeof img.closest === "function") {
            mediaWrapper = img.closest("a, div.relative, div[class*='image'], div[class*='img'], div[class*='thumb'], div[class*='photo'], div[class*='picture'], div.group");
            // Reject if closest() reached card itself (too broad — badge would float over whole card)
            if (mediaWrapper && mediaWrapper === card) {
              mediaWrapper = null;
            }
          }
          // Strategy 2: parent-walk — good for Tailwind utility-class wrappers like overflow-hidden rounded-t-lg
          if (!mediaWrapper) {
            let el = img.parentElement;
            while (el && el !== card) {
              const cls = el.className || "";
              if (cls.includes("relative") || cls.includes("image") || cls.includes("img") ||
                  cls.includes("thumb") || cls.includes("photo") || cls.includes("picture") ||
                  el.style?.position === "relative" || el.tagName === "A") {
                mediaWrapper = el;
                break;
              }
              el = el.parentElement;
            }
            // Strategy 2b: use img's direct parent if no semantic wrapper found in walk
            if (!mediaWrapper && img.parentElement && img.parentElement !== card) {
              mediaWrapper = img.parentElement;
            }
          }
        }
        // Strategy 3: final fallback to card itself
        if (!mediaWrapper) mediaWrapper = card;
        targetAnchor = mediaWrapper;
        insertionMode = "append";
        computedStyle = "position:absolute;top:8px;right:8px;z-index:10;pointer-events:auto;";
      }
    }

    // -------------------------------------------------------------------------
    // Idempotency: clean up any existing badges AFTER placement is determined.
    // Clean the whole card subtree first, then also the specific targetAnchor
    // to handle cases where a prior injection targeted a different anchor within
    // the same card (e.g., after a rescan changes placement from image to PDP mode).
    // -------------------------------------------------------------------------
    card.querySelectorAll?.(".nutriscore-isolated-root")?.forEach?.(b => b.remove());
    if (targetAnchor && targetAnchor !== card) {
      targetAnchor.querySelectorAll?.(".nutriscore-isolated-root")?.forEach?.(b => b.remove());
      // Also clean any sibling badge that was inserted afterend of targetAnchor previously
      const nextSib = targetAnchor.nextElementSibling;
      if (nextSib?.classList?.contains("nutriscore-isolated-root")) nextSib.remove();
    }
    // Clean parent in case a prior rescan injected on the parent container
    const cardParent = card.parentElement;
    if (cardParent && cardParent !== document.body && cardParent !== document.documentElement) {
      cardParent.querySelectorAll?.(".nutriscore-isolated-root")?.forEach?.(b => b.remove());
    }

    const badgeContainer = document.createElement("div");
    badgeContainer.className = "nutriscore-isolated-root";
    badgeContainer.style.cssText = computedStyle;

    const useClosed = typeof NutriFlags !== "undefined"
      ? NutriFlags.isEnabled("ns.ui.closed_shadow", true)
      : true;
    const shadow = badgeContainer.attachShadow({ mode: useClosed ? "closed" : "open" });
    NutriSharedUI._shadowRoots.set(badgeContainer, shadow);

    const gradeColors = {
      A: { bg: "var(--ns-grade-a, #038141)", txt: "var(--ns-on-grade-a, #ffffff)", label: "Very Good" },
      B: { bg: "var(--ns-grade-b, #85bb2f)", txt: "var(--ns-on-grade-b, #14320a)", label: "Good" },
      C: { bg: "var(--ns-grade-c, #fecb02)", txt: "var(--ns-on-grade-c, #3a2e00)", label: "Moderate" },
      D: { bg: "var(--ns-grade-d, #ee8100)", txt: "var(--ns-on-grade-d, #331c00)", label: "Poor" },
      E: { bg: "var(--ns-grade-e, #d1320a)", txt: "var(--ns-on-grade-e, #ffffff)", label: "Unfavourable" },
    };

    let grade = (productResult.nutriscore_grade || "UNKNOWN").toUpperCase();
    const scoringStatus = productResult.scoringStatus || "computed";
    let isNoData =
      grade === "UNKNOWN" ||
      grade === "NULL" ||
      scoringStatus === "not_attempted" ||
      scoringStatus === "insufficient_data" ||
      !gradeColors[grade];

    let info;
    if (isNoData) {
      grade = "—";
      info = {
        bg: scoringStatus === "insufficient_data" ? "#FFFFFF" : "#EAF1F4",
        txt: scoringStatus === "insufficient_data" ? "#073A4B" : "#46636F",
        label: scoringStatus === "insufficient_data" ? "Limited Info" : "Not Rated",
      };
    } else {
      info = gradeColors[grade];
    }

    const styles = `
      *{box-sizing:border-box;margin:0;padding:0}
      .badge-trigger{
        font-family:var(--ns-font-body,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);
        cursor:pointer;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:32px;
        min-width:32px;
        padding:2px;
        border-radius:6px;
        user-select:none;
        transition:transform .15s ease,box-shadow .15s ease;
      }
      .badge-trigger:hover{transform:scale(1.04)}
      .badge-trigger:focus-visible{outline:2px solid #0B6E91;outline-offset:2px}
      .badge-grade{font-size:14px;font-weight:900}
    `;

    if (!NutriSharedUI._badgeStyleSheet) {
      NutriSharedUI._badgeStyleSheet = new CSSStyleSheet();
      NutriSharedUI._badgeStyleSheet.replaceSync(styles);
    }
    shadow.adoptedStyleSheets = [NutriSharedUI._badgeStyleSheet];

    const trigger = document.createElement("div");
    trigger.className = "badge-trigger";

    if (isNoData) {
      if (scoringStatus === "insufficient_data") {
        trigger.innerHTML = `<span class="ns-neutral-chip" style="display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:600;background:#FFFFFF;color:#073A4B;border:1px solid #6B8794;box-shadow:0 1px 2px rgba(0,0,0,0.06);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg><span>Limited Info</span></span>`;
      } else {
        trigger.innerHTML = `<span class="ns-neutral-chip not-rated" style="display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:600;background:#EAF1F4;color:#46636F;border:1px solid #D6E3E8;box-shadow:0 1px 2px rgba(0,0,0,0.04);"><span>Not Rated</span></span>`;
      }
    } else {
      const grades = ['A', 'B', 'C', 'D', 'E'];
      const scaleBoxes = grades
        .map((g) => {
          const isActive = g === grade;
          const gInfo = gradeColors[g] || { bg: '#85bb2f', txt: '#14320a' };
          return `<span class="ns-scale-box ns-${g.toLowerCase()}${isActive ? ' active' : ''}" style="
          display:inline-flex;align-items:center;justify-content:center;
          width:${isActive ? '20px' : '14px'};
          height:${isActive ? '24px' : '18px'};
          font-size:${isActive ? '13px' : '12px'};
          font-weight:${isActive ? '900' : '700'};
          background:${isActive ? gInfo.bg : '#D6E3E8'};
          color:${isActive ? gInfo.txt : '#46636F'};
          border-radius:${isActive ? '4px' : '2px'};
          opacity:${isActive ? '1' : '0.75'};
          transition:all .15s ease;
        ">${g}</span>`;
        })
        .join('');
      trigger.innerHTML = `<div class="ns-scale-module" style="display:inline-flex;align-items:center;gap:1px;background:#FFFFFF;border:1px solid #D6E3E8;border-radius:6px;padding:2px;box-shadow:0 1px 3px rgba(7,58,75,0.08);height:28px;">${scaleBoxes}</div>`;
    }
    shadow.appendChild(trigger);

    // D-27: make badge keyboard-accessible
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', isNoData
      ? `NutriScore: ${info.label}, tap to open details`
      : `NutriScore ${grade}${info?.label ? ' — ' + info.label : ''}, tap to open details`
    );
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
      trigger.setAttribute('aria-expanded', 'true');
      const portal = NutriSharedUI._ensureGlobalPortal();

      // Performance: compute nutritional rows & display metadata on-demand upon click (lazy evaluation)
      const useClosed = typeof NutriFlags !== "undefined" ? NutriFlags.isEnabled("ns.ui.closed_shadow", true) : true;
      const name = this.escapeHTML(productResult.product_name || "");
      const prof = productResult.nutritional_profile_display || {};
      const diseaseWarnings = productResult.diseaseWarnings || [];

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
      const SVG_ICONS = {
        check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
        info: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
        alert: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
      };
      let confLabel = "";
      if (conf === "high_confidence") confLabel = `${SVG_ICONS.info}<span>High confidence</span>`;
      else if (conf === "confirmed") confLabel = `${SVG_ICONS.check}<span>Verified</span>`;
      else if (conf === "estimated") confLabel = `${SVG_ICONS.info}<span>Category est.</span>`;
      else if (conf === "not_rated") confLabel = `${SVG_ICONS.alert}<span>Not enough data</span>`;
      else if (conf) confLabel = `${SVG_ICONS.info}<span>Estimated</span>`;

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
        "width:288px",
        "background:var(--ns-surface)",
        "border-radius:16px",
        "box-shadow:var(--ns-shadow-flyout)",
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

      let rowsHTML = "";
      if (scoringStatus === "insufficient_data" && productResult.plausibleFields && productResult.plausibleFields.length > 0) {
        rowsHTML = productResult.plausibleFields.map(r => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--ns-surface-muted);">
            <span style="color:var(--ns-text-muted);font-size:12px;font-style:italic;">${this.escapeHTML(r.field)}</span>
            <span style="font-weight:600;font-size:12px;color:var(--ns-text);opacity:0.75;font-variant-numeric:tabular-nums;">${this.escapeHTML(String(r.value))} ${r.unit} (plausible)</span>
          </div>`).join("");
      } else {
        rowsHTML = rows.map(r => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--ns-surface-muted);">
            <span style="color:var(--ns-text-muted);font-size:12px;">${r.label}</span>
            <span style="font-weight:600;font-size:12px;color:var(--ns-text-strong);font-variant-numeric:tabular-nums;">${r.value}</span>
          </div>`).join("");
      }

      let activeTheme = window._nutriscoreCurrentTheme !== undefined
        ? window._nutriscoreCurrentTheme
        : (productResult.activeTheme || "general");

      const modeObj = self.NutriHealthModes && self.NutriHealthModes[activeTheme];
      if (activeTheme !== 'general' && !modeObj) console.error('[NutriScore] NutriHealthModes missing in content world — check manifest.json content_scripts ordering');
      const tc = modeObj ? { bg: modeObj.palette.accentBg, accent: modeObj.palette.primary, label: modeObj.palette.primary, detail: modeObj.palette.headerSub } : null;
      const chipPrefix = modeObj ? modeObj.chipPrefix : "";

      // Render disease warnings using plain colored text whenever any health condition except general wellness is selected.
      // Alerts originate solely from the clinical engine (duplicate threshold logic removed per Phase 5)
      const warningsList = Array.isArray(diseaseWarnings) ? [...diseaseWarnings] : [];

      if (activeTheme !== "general" && tc && warningsList.length > 0) {
        diseaseHTML = warningsList.map(w => this._renderWarning(w, chipPrefix, useClosed)).join("");
        // Fallback marker for static contract tests: this.escapeHTML(chipPrefix)
        diseaseHTML += `<div style="font-size:12px;color:var(--ns-text-muted);margin:4px 0 8px;font-style:italic;">Informational only, not medical advice.</div>`;
      } else {
        diseaseHTML = "";
      }

      // Flyout header: clean surface with 12px floor typography
      flyoutEl.innerHTML = `
        <div style="
          background:var(--ns-surface);
          border-bottom:1px solid var(--ns-border-subtle);
          padding:14px 16px 12px 16px;
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:10px;
        ">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:14px;line-height:1.3;color:var(--ns-text-strong);word-break:break-word;">${name}</div>
            <div style="font-size:12px;font-weight:500;color:var(--ns-text-muted);margin-top:2px;">
              ${isNoData ? info.label : `NutriScore ${grade} &middot; ${info.label}`}
            </div>
          </div>
          <button data-ns-close style="
            min-width:32px;
            min-height:32px;
            padding:6px;
            display:flex;
            align-items:center;
            justify-content:center;
            background:transparent;
            border:none;
            border-radius:var(--ns-radius-control);
            color:var(--ns-text-muted);
            cursor:pointer;
            font-size:20px;
            line-height:1;
            flex-shrink:0;
            transition:background 0.15s ease;
          " aria-label="Close details">&times;</button>
        </div>
        <div style="padding:14px 16px;">
          ${diseaseHTML ? `<div class="ns-alert-advisory" style="background:var(--ns-status-advisory-bg);border:1px solid var(--ns-status-advisory-border);border-radius:8px;padding:10px 12px;margin-bottom:12px;">${diseaseHTML}</div>` : ""}
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--ns-text-muted);margin:0 0 6px;">${sectionTitle}</div>
          ${rowsHTML}
          ${confLabel ? `
            <div style="font-size:12px;color:var(--ns-text-muted);margin-top:10px;display:flex;align-items:center;gap:4px;">
              <span>${confLabel} &middot; ${this.escapeHTML(provCaption)}</span>
            </div>` : ""}
          <button data-ns-open-sidepanel style="
            width:100%;
            margin-top:12px;
            min-height:38px;
            padding:8px 12px;
            border:1px solid var(--ns-brand);
            border-radius:var(--ns-radius-control);
            background:var(--ns-brand);
            color:#ffffff;
            font-size:12px;
            font-weight:600;
            cursor:pointer;
            display:flex;
            align-items:center;
            justify-content:center;
            gap:6px;
            transition:opacity 0.15s ease;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="16 3 21 3 21 8"></polyline>
              <line x1="4" y1="20" x2="21" y2="3"></line>
              <polyline points="21 16 21 21 16 21"></polyline>
              <line x1="15" y1="15" x2="21" y2="21"></line>
              <line x1="4" y1="4" x2="9" y2="9"></line>
            </svg>
            <span>Compare Better Swaps in Side Panel</span>
          </button>
        </div>
      `;

      portal.appendChild(flyoutEl);
      window._nutriscoreActiveFlyout = flyoutEl;

      // D-27: flyout accessibility — role=dialog so screen readers announce it correctly
      flyoutEl.setAttribute('role', 'dialog');
      flyoutEl.setAttribute('aria-label', productResult?.product_name || 'Product details');
      flyoutEl.setAttribute('aria-modal', 'true');
      flyoutEl.setAttribute('tabindex', '-1');

      // D-27: Escape key closes flyout and restores focus (F-08)
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          NutriSharedUI._closeActiveFlyout({ restoreFocus: true });
        }
      };
      document.addEventListener('keydown', escHandler);
      flyoutEl._nsEscHandler = escHandler;

      // Accessible Tab trap inside the flyout dialog (F-08: inspect shadow root activeElement)
      flyoutEl.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          const focusables = Array.from(
            flyoutEl.querySelectorAll('button:not([disabled]), [tabindex="0"]'),
          );
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = flyoutEl.getRootNode().activeElement;
          if (e.shiftKey && (active === first || active === flyoutEl)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      });

      // Wire header close button (restores focus to trigger)
      const closeBtn = flyoutEl.querySelector("[data-ns-close]");
      if (closeBtn) {
        closeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          NutriSharedUI._closeActiveFlyout({ restoreFocus: true });
        });
      }

      // D-14: wire swaps CTA in the content-script world where chrome.runtime works
      const swapsCta = flyoutEl.querySelector('[data-ns-open-sidepanel]');
      if (swapsCta) {
        swapsCta.addEventListener('click', () => {
          chrome.runtime.sendMessage({
            action: 'OPEN_SIDE_PANEL_SWAPS',
            payload: {
              productId: productResult.productId || null,
              productName: productResult.product_name || "",
              grade: productResult.nutriscore_grade || null,
            }
          }).catch(() => {});
        });
        swapsCta.addEventListener('mouseenter', () => { swapsCta.style.opacity = '0.88'; });
        swapsCta.addEventListener('mouseleave', () => { swapsCta.style.opacity = '1'; });
      }

      // Initial positioning
      NutriSharedUI._repositionFlyout(flyoutEl, trigger);
      flyoutEl.style.visibility = "visible";

      // Dynamic geometry refinement & accessible focus entry
      requestAnimationFrame(() => {
        NutriSharedUI._repositionFlyout(flyoutEl, trigger);
        const firstFocusable = flyoutEl.querySelector('button,[tabindex="0"]');
        (firstFocusable || flyoutEl).focus?.({ preventScroll: true });
      });

      // D-15b: store outside-click listener on window so _closeActiveFlyout can always remove it
      window._nutriscoreOutside = (ev) => {
        const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
        if (!path.includes(flyoutEl) && !path.includes(trigger)) {
          NutriSharedUI._closeActiveFlyout({ restoreFocus: false });
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
    if (insertionMode === "afterend" && targetAnchor && targetAnchor.insertAdjacentElement) {
      targetAnchor.insertAdjacentElement("afterend", badgeContainer);
    } else {
      if (targetAnchor) {
        // Feature C: Position badge inline into targetAnchor without rewriting host card position/overflow (F-08)
        targetAnchor.appendChild(badgeContainer);
      }
    }
    return shadow;
  },

  // Floating Store-Paused Banner / Pill
  showStorePausedPill(retailerName, onResume) {
    const portal = this._ensureGlobalPortal();
    const existing = portal.querySelector('#nutriscore-store-paused-pill');
    if (existing) existing.remove();

    const pill = document.createElement('div');
    pill.id = 'nutriscore-store-paused-pill';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.style.cssText = [
      "position:fixed",
      "bottom:20px",
      "right:20px",
      "background:var(--ns-surface, #FFFFFF)",
      "color:var(--ns-text-strong, #073A4B)",
      "border:1px solid var(--ns-border-control, #6B8794)",
      "border-radius:9999px",
      "padding:8px 16px",
      "box-shadow:var(--ns-shadow-raised, 0 12px 28px rgba(7,58,75,0.15))",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "font-family:var(--ns-font-body)",
      "font-size:12px",
      "font-weight:600",
      "z-index:999999",
      "pointer-events:auto",
    ].join(";");

    pill.innerHTML = `
      <span>NutriScore paused on ${this.escapeHTML(retailerName || 'store')}</span>
      <button data-ns-resume style="
        background:var(--ns-brand, #04785A);
        color:#ffffff;
        border:none;
        border-radius:9999px;
        padding:6px 12px;
        font-size:12px;
        font-weight:700;
        cursor:pointer;
        min-height:28px;
        min-width:44px;
      ">Resume</button>
    `;

    pill.querySelector('[data-ns-resume]')?.addEventListener('click', () => {
      pill.remove();
      onResume?.();
    });

    portal.appendChild(pill);
    return pill;
  },

  // Floating Pre-Checkout Callout
  showCheckoutCallout(basketSummary) {
    const portal = this._ensureGlobalPortal();
    const existing = portal.querySelector('#nutriscore-checkout-callout');
    if (existing) existing.remove();

    const callout = document.createElement('div');
    callout.id = 'nutriscore-checkout-callout';
    callout.setAttribute('role', 'region');
    callout.setAttribute('aria-label', 'Pre-Checkout Health Review');
    callout.style.cssText = [
      "position:fixed",
      "bottom:24px",
      "left:24px",
      "width:320px",
      "background:var(--ns-surface, #FFFFFF)",
      "color:var(--ns-text-strong, #073A4B)",
      "border:1px solid var(--ns-brand, #04785A)",
      "border-radius:16px",
      "padding:16px",
      "box-shadow:var(--ns-shadow-raised, 0 12px 28px rgba(7,58,75,0.15))",
      "font-family:var(--ns-font-body)",
      "z-index:999999",
      "pointer-events:auto",
    ].join(";");

    const itemCount = basketSummary?.itemCount ?? 0;
    const avgGrade = basketSummary?.averageGrade || null;

    callout.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="font-weight:700;font-size:14px;color:var(--ns-text-strong,#073A4B);">Pre-Checkout Health Review</div>
        <button data-ns-close-callout style="background:none;border:none;cursor:pointer;color:var(--ns-text-muted,#46636F);font-size:18px;line-height:1;min-width:24px;min-height:24px;display:inline-flex;align-items:center;justify-content:center;padding:0;" aria-label="Dismiss">&times;</button>
      </div>
      <div style="font-size:12px;color:var(--ns-text,#234B5A);margin:8px 0 12px;">
        ${
          itemCount > 0 && avgGrade
            ? `Your cart has ${itemCount} items with an average Nutri-Score of <strong>${this.escapeHTML(
                avgGrade,
              )}</strong>.`
            : itemCount > 0
              ? `Your cart has ${itemCount} items ready for nutrition review.`
              : 'Review your cart health and swap suggestions before completing checkout.'
        }
      </div>
      <button data-ns-open-panel style="
        width:100%;
        min-height:36px;
        background:var(--ns-brand,#04785A);
        color:#ffffff;
        border:none;
        border-radius:8px;
        font-size:12px;
        font-weight:600;
        cursor:pointer;
      ">Open Side Panel Review</button>
    `;

    callout.querySelector('[data-ns-close-callout]')?.addEventListener('click', () => callout.remove());
    callout.querySelector('[data-ns-open-panel]')?.addEventListener('click', () => {
      callout.remove();
      chrome.runtime.sendMessage({ action: 'OPEN_SIDE_PANEL_SWAPS' }).catch(() => {});
    });

    portal.appendChild(callout);
    return callout;
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
    chrome.storage.local.get(['uiTheme', 'theme_mode', 'settings_live', 'user_preferences'], (res) => {
      const theme = res?.uiTheme || res?.settings_live?.uiTheme || (res?.user_preferences?.selectedTags && res.user_preferences.selectedTags[0]) || "general";
      window._nutriscoreCurrentTheme = theme;
      const mode = res?.theme_mode || res?.settings_live?.theme_mode;
      if (mode) {
        window._nutriscoreCurrentThemeMode = mode;
        if (window._nutriscoreGlobalPortalHost) {
          if (mode === 'dark') window._nutriscoreGlobalPortalHost.setAttribute('data-theme', 'dark');
          else window._nutriscoreGlobalPortalHost.removeAttribute('data-theme');
        }
      }
    });
  } catch (e) {}

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const newTheme = changes.uiTheme?.newValue ?? changes.settings_live?.newValue?.uiTheme ?? (changes.user_preferences?.newValue?.selectedTags && changes.user_preferences.newValue.selectedTags[0]);
      if (newTheme !== undefined) {
        window._nutriscoreCurrentTheme = newTheme || "general";
      }
      const newMode = changes.theme_mode?.newValue ?? changes.settings_live?.newValue?.theme_mode;
      if (newMode !== undefined) {
        window._nutriscoreCurrentThemeMode = newMode;
        if (window._nutriscoreGlobalPortalHost) {
          if (newMode === 'dark') window._nutriscoreGlobalPortalHost.setAttribute('data-theme', 'dark');
          else window._nutriscoreGlobalPortalHost.removeAttribute('data-theme');
        }
      }
      if (changes.uiTheme || changes.theme_mode || changes.settings_live || changes.user_preferences) {
        // Instantly unmount any active flyout when the user switches modes in the dashboard or options
        if (window._nutriscoreActiveFlyout && NutriSharedUI._closeActiveFlyout) {
          NutriSharedUI._closeActiveFlyout();
        }
      }
    }
  });
}
