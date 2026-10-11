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

// F-06: per-retailer high-water mark for cart snapshot capturedAt timestamps.
// SW discards any SYNC_CART_STATE message whose capturedAt <= the last accepted one.
// Reset on SW restart (cold wake) — intentional: no stale ordering across lifetimes.
const _lastCartAt = {};

// D-05: 30-second tier memo — one resolveTier call per batch, not per item.
let _tier, _tierAt = 0;
async function currentTier() {
  if (_tier && Date.now() - _tierAt < 30_000) return _tier;
  try {
    let userId;
    try {
      const sessionDataStr = (await chrome.storage.local.get('nutri_supabase_session'))['nutri_supabase_session'];
      if (sessionDataStr) userId = JSON.parse(sessionDataStr)?.user?.id;
    } catch(e) {}
    if (!userId) userId = (await sb().auth.getSession()).data?.session?.user?.id;
    _tier = (await NutriEntitlement.resolveTier(userId)).tier;
  } catch {
    _tier = 'basic';
  }
  _tierAt = Date.now();
  return _tier;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['nutri_supabase_session']) {
    sb().auth.getSession(); // trigger re-read from storage
    _tierAt = 0; // invalidate tier memo
  }
});

let storageReadyPromise = null;
function ensureStorageReady() {
  if (!storageReadyPromise) {
    storageReadyPromise = (async () => {
      if (typeof NutriScoreDB === "undefined") throw new Error("LOCAL_DB_UNAVAILABLE");
      await NutriScoreDB.ensureReady?.();
    })().catch(e => { storageReadyPromise = null; throw e; });
  }
  return storageReadyPromise;
}

async function ensureCatalogReady() {
  await ensureStorageReady();
  try {
    // F-01: do NOT call NutriEntitlement.refresh() here.
    // Entitlement is refreshed by the 'entitlement-refresh' alarm (every 12 h).
    // A plain wake makes 0 network requests unless the catalog or entitlement alarm fires.
    await NutriCatalogSync?.ensureReady?.();
    console.log("[NutriScore SW] Catalog synced and ready.");
  } catch (e) {
    console.warn("[NutriScore SW] catalog unavailable; local DB remains usable:", e);
  }
}

// ── M2/L2: Alarm-driven retry & cache eviction ────────────────────────────────
// Registered synchronously at the top level so the listener is always attached
// even on a cold SW wake, per MV3's requirement for top-level event registration.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "entitlement-refresh") {
    // F-01/F-16: entitlement network call happens ONLY when this alarm fires (every 12 h),
    // not on every SW wake. This reduces entitlement POST calls by ~99%.
    try {
      if (typeof NutriEntitlement !== "undefined") {
        _tierAt = 0; // invalidate memo so next currentTier() re-resolves from fresh token
        await NutriEntitlement.refresh();
        console.log("[NutriScore SW] Entitlement refreshed via alarm.");
      }
    } catch (e) {
      console.warn("[NutriScore SW] entitlement-refresh alarm failed:", e.message);
    }
    return;
  }

  if (alarm.name === "retry-cart-sync") {
    // Drain any pending cart-sync jobs persisted before the previous SW was killed.
    try {
      await ensureStorageReady();
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
    } catch (e) {
      console.warn("[NutriScore SW] Alarm retry aborted (DB init failed):", e.message);
    }
    return;
  }

  if (alarm.name === "cache-eviction") {
    // Evict product_cache entries older than 7 days.
    // Moved from the hot cacheProduct() write path (was a Math.random() < 0.05 coin-flip).
    try {
      await ensureStorageReady();
      if (typeof NutriScoreDB === "undefined" || !NutriScoreDB.evictStaleCacheEntries) return;
      await NutriScoreDB.evictStaleCacheEntries();
    } catch (e) {
      console.warn("[NutriScore SW] Cache eviction alarm failed:", e.message);
    }
    return;
  }
});

// F-01/F-16: boot sequence — 0 network calls on a plain wake.
// - entitlement-refresh alarm runs every 12 h (was: on every wake = ~100 POSTs/day)
// - catalog-sync only runs when the manifest version changes
// chrome.alarms.create is idempotent when the alarm already exists.
chrome.alarms.create("entitlement-refresh", { periodInMinutes: 12 * 60 }); // 12 h
chrome.alarms.create("cache-eviction",      { periodInMinutes: 24 * 60 }); // daily

// F-11: wire the SW singleton into NutriEntitlement and NutriCatalogSync so
// refresh() and sync() never create their own Supabase clients.
// Must run before the first alarm fires or ensureCatalogReady() is called.
if (typeof NutriEntitlement   !== "undefined" && NutriEntitlement.init)   NutriEntitlement.init(sb);
if (typeof NutriCatalogSync   !== "undefined" && NutriCatalogSync.init)   NutriCatalogSync.init(sb);

// Open DB and start catalog sync. No entitlement network call here.
ensureCatalogReady();

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
  // D-19: round kJ to avoid float noise (e.g. EnergyKcal * 4.184 = 1255.2000000000002)
  const round0 = (v) => (v == null ? null : Math.round(v));
  return {
    energy_kj:    round0(parseNumeric(nutrition.EnergyKJ ?? (nutrition.EnergyKcal != null ? nutrition.EnergyKcal * 4.184 : null))),
    fat_g:        parseNumeric(nutrition.FatG),
    sat_fat_g:    parseNumeric(nutrition.SaturatedFatG),
    carbs_g:      parseNumeric(nutrition.CarbohydratesG),
    sugars_g:     parseNumeric(nutrition.SugarsG),
    fibre_g:      parseNumeric(nutrition.FibreG),
    protein_g:    parseNumeric(nutrition.ProteinG),
    sodium_mg:    parseNumeric(nutrition.SodiumMG ?? nutrition.Sodium?.ValueMG),
    potassium_mg: parseNumeric(nutrition.PotassiumMG ?? nutrition.Potassium?.ValueMG),
  };
}

async function getProductInfo(payload, retailerCode) {
  await ensureStorageReady();

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
    confidence:                    interpretation.evidenceTier,
    canDisplayGrade:               interpretation.canDisplayGrade,
    validationStatus:              interpretation.validationStatus,
    evidenceTier:                  interpretation.evidenceTier,
    // D-19: copy evidenceLevel so flyout shows correct provenance (not always 'Unknown')
    evidenceLevel:                 interpretation.evidenceLevel,
    valueSpecificity:              interpretation.valueSpecificity,
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
    // D-20: clone before enrichment so tier/isPremium/activeTheme don't race into the cache
    NutriScoreDB.saveProduct(cacheKey, structuredClone(result)).catch(() => {});
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
          let userId = message.userId;
          if (!userId) {
            try {
              const sessionDataStr = (await chrome.storage.local.get('nutri_supabase_session'))['nutri_supabase_session'];
              if (sessionDataStr) userId = JSON.parse(sessionDataStr)?.user?.id;
            } catch(e) {}
          }
          if (!userId) userId = (await sb().auth.getSession()).data?.session?.user?.id;
          const res = await NutriEntitlement.resolveTier(userId);
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

    // D-30: guard against malformed messages — payload missing would throw TypeError
    const payload = message.payload;
    if (!payload) {
      sendResponse({ status: "ERROR", error: "Missing payload" });
      return false;
    }

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
          data: { product_name: payload.product_name, nutriscore_grade: "UNKNOWN" },
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
      try {
        await ensureStorageReady();
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
      try {
        await ensureStorageReady();
        if (typeof NutriScoreDB === "undefined" || !NutriScoreDB.syncCart) {
          throw new Error("DB not initialized or syncCart missing");
        }

        // F-06: reject stale snapshots from hidden/background tabs.
        // capturedAt is the timestamp at which the content script captured the cart.
        // If a newer snapshot already arrived, this one is a race loser — discard it.
        const retailer = message.payload.retailer;
        const capturedAt = message.payload.capturedAt ?? 0;
        if (capturedAt <= (_lastCartAt[retailer] ?? 0)) {
          if (sendResponse) sendResponse({ status: "STALE" });
          return;
        }
        _lastCartAt[retailer] = capturedAt;

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
      try {
        await ensureStorageReady();
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
      try {
        await ensureStorageReady();
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
      try {
        await ensureStorageReady();
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



  // D-21: oauth_login handler REMOVED.
  // It had zero callers, returned raw access/refresh tokens to any extension sender,
  // and logged the full auth URL. Re-implement with sender origin validation if needed.
});
