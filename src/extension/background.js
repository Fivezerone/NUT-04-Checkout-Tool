/* @license SPDX-License-Identifier: Apache-2.0 BackgroundServiceWorker ? Component Architecture v2.0 Orchestrates: NutriScoreDB -> DiseaseEngine */

importScripts(
  "config.js",
  "supabase.js",
  "db.js",
  "entitlement.js",
  "catalog-sync.js",
  "health-modes.js",
  "engine/health-flags.js",
  "engine/scorers/energy-dense.js",
  "engine/scorers/fibre-forward.js",
  "engine/scorers/protein-tradeoff.js",
  "engine/scorers/strict-density.js",
  "engine/scorers/general.js",
  "engine/context-engine.js"
);


console.log("[NutriScore SW] Component Architecture v2.0 active.");

// P5 perf fix: gate per-message logging behind a flag.
// Flip to true in DevTools console (self.NUTRISCORE_DEBUG = true) when diagnosing issues.
const DEBUG = (typeof self !== "undefined" && self.NUTRISCORE_DEBUG === true);

// D-05: module-level Supabase singleton — never create more than one client per SW lifetime.
let _sb;
const sb = () => (_sb ??= NutriSupabase.create(NUTRI_CONFIG.SUPABASE_URL, NUTRI_CONFIG.SUPABASE_ANON_KEY));

// D-05: 30-second tier memo — one resolveTier call per batch, not per item.
let _tier, _tierAt = 0;
async function currentTier() {
  if (_tier && Date.now() - _tierAt < 30_000) return _tier;
  try {
    const { data: { session } } = await sb().auth.getSession();
    _tier = (await NutriEntitlement.resolveTier(session?.user?.id)).tier;
  } catch {
    _tier = 'basic';
  }
  _tierAt = Date.now();
  return _tier;
}

// (Dead cache maps removed per audit)
let initPromise = null;

function initializeDatabases() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        if (typeof NutriCatalogSync !== "undefined") {
          // Entitlement refresh takes ~100ms and updates the clock guard.
          if (typeof NutriEntitlement !== "undefined") {
            await NutriEntitlement.refresh();
          }
          await NutriCatalogSync.ensureReady();
          console.log("[NutriScore SW] Catalog synced and ready.");
        }
      } catch (err) {
        console.error("[NutriScore SW] Init failed:", err);
        initPromise = null;
        throw err;
      }
    })();
  }
  return initPromise;
}


// ── M2/L2: Alarm-driven retry & cache eviction ────────────────────────────────
// Registered synchronously at the top level so the listener is always attached
// even on a cold SW wake, per MV3's requirement for top-level event registration.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "retry-cart-sync") {
    // Drain any pending cart-sync jobs persisted before the previous SW was killed.
    await initializeDatabases();
    if (typeof NutriScoreDB === "undefined" || !NutriScoreDB.getPendingCartSyncs) return;
    const pending = await NutriScoreDB.getPendingCartSyncs();
    if (!pending?.length) return;
    for (const job of pending) {
      try {
        await NutriScoreDB.syncCart(job.retailer, job.items);
        await NutriScoreDB.clearPendingCartSync(job.id);
        chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => { });
        console.log(`[NutriScore SW] Alarm retry succeeded for pending cart-sync job ${job.id}.`);
      } catch (e) {
        console.warn("[NutriScore SW] Alarm cart-sync retry failed, will try again on next alarm:", e.message);
      }
    }
    return;
  }

  if (alarm.name === "cache-eviction") {
    // Evict product_cache entries older than 7 days.
    // Moved from the hot cacheProduct() write path (was a Math.random() < 0.05 coin-flip).
    await initializeDatabases();
    if (typeof NutriScoreDB === "undefined" || !NutriScoreDB.evictStaleCacheEntries) return;
    try {
      await NutriScoreDB.evictStaleCacheEntries();
    } catch (e) {
      console.warn("[NutriScore SW] Cache eviction alarm failed:", e.message);
    }
    return;
  }
});

initializeDatabases();

// Register the low-frequency cache-eviction alarm once. chrome.alarms.create is
// idempotent when the alarm already exists, so this is safe to call on every SW wake.
chrome.alarms.create("cache-eviction", { periodInMinutes: 24 * 60 }); // daily

// buildPatientProfile and reevaluateCachedProduct were deleted. Disease fields are no longer cached.

/**
 * SMELL-003: Extracted helper — build the nutritional_profile_display DTO
 * from a raw Nutrition object. Pure data transformation, no side effects.
 *
 * @param {object} nutrition - The Nutrition sub-object from a grocery product.
 * @returns {object} Flat display-ready nutrient object.
 */
function buildNutritionalProfileDisplay(nutrition) {
  const parseNumeric = (val) => {
    if (val == null) return null;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed;
  };
  return {
    energy_kj: parseNumeric(nutrition.EnergyKJ ?? (nutrition.EnergyKcal != null ? nutrition.EnergyKcal * 4.184 : null)),
    fat_g: parseNumeric(nutrition.FatG),
    sat_fat_g: parseNumeric(nutrition.SaturatedFatG),
    carbs_g: parseNumeric(nutrition.CarbohydratesG),
    sugars_g: parseNumeric(nutrition.SugarsG),
    fibre_g: parseNumeric(nutrition.FibreG),
    protein_g: parseNumeric(nutrition.ProteinG),
    sodium_mg: parseNumeric(nutrition.SodiumMG ?? nutrition.Sodium?.ValueMG),
    potassium_mg: parseNumeric(nutrition.PotassiumMG ?? nutrition.Potassium?.ValueMG),
  };
}

async function getProductInfo(payload, retailerCode) {
  await initializeDatabases();

  const { product_name, name_hash, retailer_product_id, url, price } = payload;

  const settings = await (NutriScoreDB.getSettings ? NutriScoreDB.getSettings() : { diabetes: true, hypertension: true, kidney: true, activeTheme: "general" });
  
  // D-05: use singleton client + memoised tier (eliminates N-parallel-client refresh storm)
  let tier = "basic";
  if (typeof NutriEntitlement !== "undefined") {
    tier = await currentTier();
  }
  settings.isPremium = (tier === "premium");

  const cacheKey = retailer_product_id || url || product_name;

  if (cacheKey && typeof NutriScoreDB !== "undefined" && NutriScoreDB.getCachedProduct) {
    const cached = await NutriScoreDB.getCachedProduct(cacheKey);
    if (cached) {
      return await appendPremiumAssessment(cached, retailerCode, cached.productId, settings.activeTheme, tier);
    }
  }

  const matchResult = await NutriScoreDB.resolveProductMatch(
    retailerCode,
    retailer_product_id || null,
    url || null,
    product_name || null
  );

  if (!matchResult.matched) {
    throw new Error(`Product not found: "${product_name}" [${retailerCode}]`);
  }

  const groceryProduct = matchResult.product;
  const interpretation = NutriScoreDB.interpretProduct(groceryProduct);

  const nutrition = groceryProduct.Nutrition || {};
  const identity = groceryProduct.Identity || {};

  const productId = identity.ProductID || groceryProduct.GroceryProductID || payload.retailer_product_id;
  const isExcluded = !interpretation.canDisplayGrade;
  let grade = "UNKNOWN";
  let scoringStatus = interpretation.scoringStatus || "not_attempted";
  let plausibleFields = [];
  if (!isExcluded) {
    const gradeResult = NutriScoreDB.computeGradeFromProduct(groceryProduct);
    grade = gradeResult.grade;
    scoringStatus = gradeResult.status;
    plausibleFields = gradeResult.plausibleFields || [];
  }

  const result = {
    productId: identity.ProductID || groceryProduct.GroceryProductID || payload.retailer_product_id,
    product_name: identity.ProductName || product_name,
    retailer: retailerCode,
    nutriscore_grade: grade,
    scoringStatus: scoringStatus,
    plausibleFields: plausibleFields,
    score: 0,
    score_details: {},
    fsaCategory: interpretation.nutrientAlgorithmVariant || "GENERAL_FOOD",
    displayCategory: interpretation.foodCategory || "Uncategorized",
    isExcluded: isExcluded,
    algorithmVersion: "FSA-NPS-2023",
    nutritional_profile_display: buildNutritionalProfileDisplay(nutrition),
    confidence: interpretation.evidenceTier,
    canDisplayGrade: interpretation.canDisplayGrade,
    validationStatus: interpretation.validationStatus,
    evidenceTier: interpretation.evidenceTier,
    valueSpecificity: interpretation.valueSpecificity,
    categoryPlausibilityCheck: interpretation.categoryPlausibilityCheck,
    energyConsistencyCheck: interpretation.energyConsistencyCheck,
    saltSodiumConsistencyCheck: interpretation.saltSodiumConsistencyCheck,
    dataQualityFlags: interpretation.dataQualityFlags,
    sourceReference: interpretation.sourceReference,
    packSizeUnit: groceryProduct.Packaging?.PackSizeUnit || (interpretation.foodCategory === "BEVERAGE" ? "ml" : "g"),
    matchInfo: {
      matched: matchResult.matched,
      matchMethod: matchResult.matchMethod,
      confidence: matchResult.confidence,
    }
  };

  if (cacheKey && typeof NutriScoreDB !== "undefined" && NutriScoreDB.saveProduct) {
    NutriScoreDB.saveProduct(cacheKey, result).catch(e => console.warn("[NutriScore SW] IndexedDB save:", e.message));
  }

  return await appendPremiumAssessment(result, retailerCode, productId, settings.activeTheme, tier);
}

async function appendPremiumAssessment(result, retailerCode, productId, activeTheme, tier) {
  result.activeTheme = activeTheme || "general";
  result.isPremium = (tier === "premium");
  result.tier = tier;
  result.upsell = (tier === "basic" && result.activeTheme !== "general");

  // SECURITY INVARIANT: Always zero out these fields first.
  // If the product was passed from a cache created while the user was premium,
  // we must not leak the old diseaseWarnings if their tier is now basic.
  result.diseaseAssessment = {};
  result.diseaseWarnings = [];
  result.diseaseDisclaimer = "";

  if (tier === "premium" && result.activeTheme !== "general") {
    const mode = self.NutriHealthModes && self.NutriHealthModes[result.activeTheme];
    if (mode && mode.engineKey) {
      try {
        const assessments = await NutriScoreDB.getPremiumAssessment(retailerCode, productId);
        if (assessments && assessments[mode.engineKey]) {
          const ass = assessments[mode.engineKey];
          result.diseaseAssessment = ass.diseaseAssessment || {};
          result.diseaseWarnings = ass.warnings || [];
          
          if (result.diseaseWarnings.length > 0) {
            const meta = await NutriScoreDB.getCatalogMeta();
            result.diseaseDisclaimer = meta ? meta.disclaimer : "";
          }
        }
      } catch (e) {
        console.warn("[NutriScore SW] Error reading premium assessment:", e);
      }
    }
  }

  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (DEBUG) console.log("[NutriScore SW] Action:", message.action);

  if (message.action === "CHECK_TIER") {
    (async () => {
      let tier = "basic";
      if (typeof NutriEntitlement !== "undefined") {
        try {
          const { data: { session } } = await sb().auth.getSession();
          const res = await NutriEntitlement.resolveTier(session?.user?.id);
          tier = res.tier;
        } catch (err) {
          console.warn("[NutriScore SW] CHECK_TIER error:", err);
        }
      }
      sendResponse({ tier });
    })();
    return true;
  }

  // D-04: UI calls this right after savePremiumStatus() to trigger immediate
  // token adoption in the SW, eliminating activation lag.
  if (message.action === 'REFRESH_ENTITLEMENT') {
    (async () => {
      let tier = 'basic';
      if (typeof NutriEntitlement !== 'undefined') {
        try {
          // D-05: invalidate tier memo on refresh so the next currentTier() call re-resolves
          _tierAt = 0;
          tier = await NutriEntitlement.refresh();
        } catch (err) {
          console.warn('[NutriScore SW] REFRESH_ENTITLEMENT error:', err);
        }
      }
      sendResponse({ tier });
    })();
    return true;
  }

  // D-14: open the upgrade/renewal page in a new tab from the SW
  // (content-script calls sendMessage — cannot open tabs directly)
  if (message.action === 'OPEN_UPGRADE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') + '?mode=renew' });
    return false;
  }

  if (message.action === "CHECK_PRODUCT_SCORE") {
    const retailerCode = message.retailer || "NAIVAS";

    const payload = message.payload;
    if (payload.retailer_product_id && payload.price && typeof NutriScoreDB !== "undefined" && NutriScoreDB.savePrice) {
      NutriScoreDB.savePrice(payload.retailer_product_id, payload.price).catch(()=>{});
    }

    getProductInfo(payload, retailerCode)
      .then(prod => {
        sendResponse({ status: "SUCCESS", data: prod });
      })
      .catch(err => {
        if (!err.message.startsWith("Product not found")) {
          console.warn(`[NutriScore SW] Processing failed: ${err.message}`);
        }
        sendResponse({
          status: "NOT_FOUND",
          data: { product_name: message.payload.product_name, nutriscore_grade: "UNKNOWN" },
          error: err.message
        });
      });

    return true;
  }

  if (message.action === "CHECK_PRODUCT_SCORES_BATCH") {
    const retailerCode = message.retailer || "NAIVAS";
    const payloads = message.payloads || [];

    (async () => {
      try {
        const results = await Promise.all(payloads.map(async (payload) => {
          try {
            if (payload.retailer_product_id && payload.price && typeof NutriScoreDB !== "undefined" && NutriScoreDB.savePrice) {
              await NutriScoreDB.savePrice(payload.retailer_product_id, payload.price);
            }
            const data = await getProductInfo(payload, retailerCode);
            return { status: "SUCCESS", data };
          } catch (err) {
            return {
              status: "NOT_FOUND",
              data: { product_name: payload.product_name, nutriscore_grade: "UNKNOWN" },
              error: err.message
            };
          }
        }));
        sendResponse({ status: "SUCCESS", results });
      } catch (err) {
        sendResponse({ status: "ERROR", error: err.message });
      }
    })();

    return true;
  }

  if (message.action === "LOG_CART_ADD") {
    (async () => {
      await initializeDatabases();
      try {
        if (typeof NutriScoreDB === "undefined" || !NutriScoreDB.logCartEvent) {
          throw new Error("DB not initialized");
        }

        const item = message.payload;
        const retailerCode = item.retailer;
        const now = Date.now();

        const matchResult = await NutriScoreDB.resolveProductMatch(
          retailerCode,
          item.productId,
          null,
          item.product_name
        );

        if (matchResult.matched && matchResult.product) {
          const p = matchResult.product;
          const name = p.Identity?.ProductName || p.GroceryProductName || p.name || item.product_name || "Unknown Product";
          const interpretation = NutriScoreDB.interpretProduct(p);
          if (interpretation.canDisplayGrade) {
            if (item.retailer_product_id && item.priceSnapshot && typeof NutriScoreDB !== "undefined" && NutriScoreDB.savePrice) {
               await NutriScoreDB.savePrice(item.retailer_product_id, item.priceSnapshot);
            }
            const prodInfo = await getProductInfo(item, retailerCode);
            let riskFlags = null;
            if (prodInfo.tier === "premium") {
              const assessments = await NutriScoreDB.getPremiumAssessment(retailerCode, item.productId);
              if (assessments) {
                riskFlags = {
                  diabetes: !!(assessments.diabetes?.warnings?.length),
                  hypertension: !!(assessments.hypertension?.warnings?.length),
                  renal: !!(assessments.renal?.warnings?.length),
                  obesity: !!(assessments.obesity?.warnings?.length)
                };
              } else {
                riskFlags = { diabetes: false, hypertension: false, renal: false, obesity: false };
              }
            }

            const row = {
              id: `${retailerCode}-${item.productId}-${now}`,
              productId: item.productId,
              name,
              retailer: retailerCode,
              addedAt: now,
              quantity: item.quantity || 1,
              priceSnapshot: item.priceSnapshot,
              gradeSnapshot: prodInfo.nutriscore_grade,
              scoringStatus: prodInfo.scoringStatus,
              category: NutriScoreDB.resolveDisplayCategory(p),
              status: "in_cart",
              riskFlags,
              nutritionSnapshot: {
                sodiumMg: p.Nutrition?.SodiumMG ?? p.Nutrition?.Sodium?.ValueMG ?? null,
                sugarsG: p.Nutrition?.SugarsG ?? null,
                satFatG: p.Nutrition?.SaturatedFatG ?? null,
                potassiumMg: p.Nutrition?.PotassiumMG ?? p.Nutrition?.Potassium?.ValueMG ?? null
              }
            };
            await NutriScoreDB.logCartEvent(row);
            chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => { });
          }
        }
      } catch (err) {
        console.error("LOG_CART_ADD failed:", err);
      }
    })();
    return true;
  }

  if (message.action === "SYNC_CART_STATE") {
    (async () => {
      await initializeDatabases();
      try {
        if (typeof NutriScoreDB === "undefined" || !NutriScoreDB.syncCart) {
          throw new Error("DB not initialized or syncCart missing");
        }

        // M2: Persist the payload to IDB before attempting the sync.
        // If the SW is killed mid-flight, the "retry-cart-sync" alarm (registered
        // at the top of this file) will drain this store on the next SW wake.
        const jobId = await NutriScoreDB.savePendingCartSync(message.payload);

        // Schedule the safety-net alarm. If the sync below completes synchronously
        // and we call chrome.alarms.clear(), this alarm will never fire. If the SW
        // is killed before we clear it, the alarm fires ~30s later and retries.
        chrome.alarms.create("retry-cart-sync", { delayInMinutes: 0.5 });

        try {
          await NutriScoreDB.syncCart(message.payload.retailer, message.payload.items);
          await NutriScoreDB.clearPendingCartSync(jobId);
          // Cancel the safety-net alarm — sync completed successfully.
          chrome.alarms.clear("retry-cart-sync");
          chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => { });
          if (sendResponse) sendResponse({ status: "SUCCESS" });
        } catch (err) {
          console.error("Cart sync failed:", err);
          // Leave jobId in pending_cart_syncs and the alarm standing — retry on next wake.
          if (sendResponse) sendResponse({ status: "ERROR", error: err.message });
        }
      } catch (err) {
        console.error("Cart sync setup failed:", err);
        if (sendResponse) sendResponse({ status: "ERROR", error: err.message });
      }
    })();
    return true;
  }

  if (message.action === "REMOVE_CART_ITEM") {
    (async () => {
      await initializeDatabases();
      try {
        const { retailer, productId } = message.payload;
        console.log(`[NutriScore SW] Removing cart item ${productId} for ${retailer}`);
        if (NutriScoreDB.removeCartItem) {
          await NutriScoreDB.removeCartItem(retailer, productId);
        }
        chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => { });
      } catch (err) {
        console.error("REMOVE_CART_ITEM failed:", err);
      }
    })();
    return true;
  }

  if (message.action === "CART_CLEARED") {
    (async () => {
      await initializeDatabases();
      try {
        const retailer = message.retailer;
        console.log(`[NutriScore SW] Cart cleared for ${retailer}`);
        if (NutriScoreDB.clearCartItems) {
          await NutriScoreDB.clearCartItems(retailer);
        }
        chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => { });
      } catch (err) {
        console.error("CART_CLEARED failed:", err);
      }
    })();
    return true;
  }

  if (message.action === "ORDER_PLACED") {
    (async () => {
      await initializeDatabases();
      try {
        const retailer = message.retailer;
        console.log(`[NutriScore SW] Order placed for ${retailer} -- marking items purchased`);
        if (NutriScoreDB.markCartPurchased) {
          await NutriScoreDB.markCartPurchased(retailer);
        }
        chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => { });
      } catch (err) {
        console.error("ORDER_PLACED failed:", err);
      }
    })();
    return true;
  }

  if (message.action === "THEME_CHANGED") {
    if (chrome.tabs) {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      });
    }
    return true;
  }

  // ── OAuth Login via chrome.identity.launchWebAuthFlow ──────────────────────
  // Triggered from the React UI (OnboardingWizard) with a pre-built Supabase
  // OAuth URL. We execute the auth flow here in the SW so it survives popup
  // closure. On success, we return the raw tokens to the UI so it can call
  // supabase.auth.setSession() and hydrate the chromeStorageAdapter.
  if (message.action === "oauth_login") {
    (async () => {
      try {
        const { authUrl } = message;
        if (!authUrl) throw new Error("No authUrl provided in oauth_login message.");

        // Log the exact URL so you can verify the redirect_to param matches
        // what's registered in Supabase → Auth → URL Configuration → Redirect URLs.
        // Check this in: chrome://extensions → Service Worker → Inspect → Console
        console.log("[NutriScore SW] Starting OAuth flow. authUrl:", authUrl);

        // launchWebAuthFlow opens a browser-managed auth popup. 'interactive: true'
        // shows the Google account picker. When Supabase redirects back to the
        // chrome extension's redirect URL, Chrome intercepts it and returns the
        // full URL here — without ever opening a visible new tab.
        const responseUrl = await chrome.identity.launchWebAuthFlow({
          url: authUrl,
          interactive: true,
        });

        if (!responseUrl) {
          throw new Error("OAuth flow cancelled: auth window was closed prematurely.");
        }

        const url = new URL(responseUrl);

        // Check for a provider-level error in the query string first.
        // Supabase forwards OAuth errors as query params (e.g. ?error=access_denied).
        const queryParams = new URLSearchParams(url.search);
        const oauthError = queryParams.get("error_description") || queryParams.get("error");
        if (oauthError) {
          throw new Error(`OAuth provider error: ${oauthError}`);
        }

        // Supabase appends the session as a URI fragment (#) for implicit grant.
        // Example: https://<ext-id>.chromiumapp.org/#access_token=...&refresh_token=...
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");
        const expires_in = hashParams.get("expires_in");

        if (!access_token) {
          throw new Error("Access token missing from redirect URL. Check Supabase redirect config.");
        }

        console.log("[NutriScore SW] OAuth flow successful. Returning tokens to UI.");
        sendResponse({ success: true, access_token, refresh_token, expires_in });

      } catch (err) {
        // Common case: user closed the popup window. Treat gracefully.
        const isUserCancelled =
          err.message?.includes("cancelled") ||
          err.message?.includes("closed") ||
          err.message?.includes("The user did not approve access");

        if (isUserCancelled) {
          console.log("[NutriScore SW] OAuth flow cancelled by user.");
        } else {
          console.error("[NutriScore SW] OAuth flow failed:", err.message);
        }
        sendResponse({ success: false, error: err.message });
      }
    })();
    // Return true to keep the message channel open while the async flow runs.
    return true;
  }
});
