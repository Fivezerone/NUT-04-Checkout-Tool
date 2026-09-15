/* @license SPDX-License-Identifier: Apache-2.0 BackgroundServiceWorker ? Component Architecture v2.0 Orchestrates: NutriScoreDB -> DiseaseEngine */

importScripts(
  "db.js",
  "engine/disease-engine.js"
);

console.log("[NutriScore SW] Component Architecture v2.0 active.");

// P5 perf fix: gate per-message logging behind a flag.
// Flip to true in DevTools console (self.NUTRISCORE_DEBUG = true) when diagnosing issues.
const DEBUG = (typeof self !== "undefined" && self.NUTRISCORE_DEBUG === true);

// (Dead cache maps removed per audit)
let initPromise = null;

function initializeDatabases() {
  if (!initPromise) {
    initPromise = (async () => {
      if (typeof NutriScoreDB === "undefined" || !NutriScoreDB.importDatasets) {
        console.warn("[NutriScore SW] NutriScoreDB not available.");
        return;
      }
      try {
        await NutriScoreDB.importDatasets();
        console.log("[NutriScore SW] IndexedDB Datasets imported and ready.");
      } catch (err) {
        console.error("[NutriScore SW] Dataset import failed:", err);
        initPromise = null;
        throw err;
      }
    })();
  }
  return initPromise;
}

initializeDatabases();

// Map flat Settings flags → patientProfile shape for DiseaseEngine.evaluate().
// UI key "kidney" maps to engine key "renal" (DISEASE_RULES uses "renal" internally).
// Hoisted to module scope — was previously defined inside getProductInfo(), which
// allocated a new closure on every product card scan.
function buildPatientProfile(s) {
  return {
    conditions: {
      ...(s.diabetes     && { diabetes:     { active: true } }),
      ...(s.hypertension && { hypertension: { active: true } }),
      ...(s.kidney       && { renal:        { active: true } }),
    }
  };
}

async function getProductInfo(payload, retailerCode) {
  await initializeDatabases();

  const { product_name, name_hash, retailer_product_id, url, price } = payload;

  if (retailer_product_id && price) {
    if (NutriScoreDB.savePrice) await NutriScoreDB.savePrice(retailer_product_id, price);
  }
  
  const settings = await (NutriScoreDB.getSettings ? NutriScoreDB.getSettings() : { diabetes: true, hypertension: true, kidney: true });

  const cacheKey = retailer_product_id || url || product_name;
  if (cacheKey && typeof NutriScoreDB !== "undefined" && NutriScoreDB.getCachedProduct) {
    const cached = await NutriScoreDB.getCachedProduct(cacheKey);
    if (cached) {
      // Re-evaluate diseases in case settings changed
      try {
        // Reconstruct a product-shaped object from the cached display fields so
        // DiseaseEngine.evaluate() receives the { Nutrition: {...} } shape it requires.
        const cachedProduct = {
          Identity: { ProductID: cached.productId },
          Nutrition: {
            SugarsG:        cached.nutritional_profile_display?.sugars_g   ?? null,
            SaturatedFatG:  cached.nutritional_profile_display?.sat_fat_g  ?? null,
            SodiumMG:       cached.nutritional_profile_display?.sodium_mg  ?? null,
            PotassiumMG:    cached.nutritional_profile_display?.potassium_mg ?? null,
            // energy_kj stored as kJ; engine uses EnergyKcal (kJ ÷ 4.184)
            EnergyKcal:     cached.nutritional_profile_display?.energy_kj != null
                              ? cached.nutritional_profile_display.energy_kj / 4.184
                              : null,
            CarbohydratesG: cached.nutritional_profile_display?.carbs_g   ?? null,
            FibreG:         cached.nutritional_profile_display?.fibre_g   ?? null,
            ProteinG:       cached.nutritional_profile_display?.protein_g ?? null,
          }
        };
        const diseaseResult = DiseaseEngine.evaluate(cachedProduct, buildPatientProfile(settings));
        cached.diseaseWarnings  = diseaseResult.warnings;
        cached.diseaseDisclaimer = diseaseResult.disclaimer;
      } catch (e) {
        console.warn("[NutriScore SW] DiseaseEngine (cache path):", e.message);
        cached.diseaseWarnings  = [];
        cached.diseaseDisclaimer = "";
      }
      return cached;
    }
  }

  const matchResult = await NutriScoreDB.resolveProductMatch(
    retailerCode,
    retailer_product_id || null,
    url                 || null,
    product_name        || null
  );

  if (!matchResult.matched) {
    throw new Error(`Product not found: "${product_name}" [${retailerCode}]`);
  }

  const groceryProduct = matchResult.product;
  const interpretation = NutriScoreDB.interpretProduct(groceryProduct);

  const nutrition = groceryProduct.Nutrition || {};
  const identity = groceryProduct.Identity || {};

  const parseNumeric = (val) => {
    if (val == null) return null;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed;
  };

  // Pass groceryProduct directly — it already has the { Nutrition: {...} } shape the
  // reviewed engine requires. buildPatientProfile() converts flat Settings booleans to
  // { conditions: { <key>: { active: true } } } and translates kidney → renal.
  let diseaseResult = { warnings: [], disclaimer: "" };
  try {
    diseaseResult = DiseaseEngine.evaluate(groceryProduct, buildPatientProfile(settings));
  } catch (e) {
    console.warn("[NutriScore SW] DiseaseEngine:", e.message);
  }

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
    productId:                   identity.ProductID || groceryProduct.GroceryProductID || payload.retailer_product_id,
    product_name:                identity.ProductName || product_name,
    retailer:                    retailerCode,
    nutriscore_grade:            grade,
    scoringStatus:               scoringStatus,
    plausibleFields:             plausibleFields,
    score:                       0,
    score_details:               {},
    fsaCategory:                 interpretation.nutrientAlgorithmVariant || "GENERAL_FOOD",
    displayCategory:             interpretation.foodCategory || "Uncategorized",
    isExcluded:                  isExcluded,
    algorithmVersion:            "FSA-NPS-2023",
    diseaseWarnings:             diseaseResult.warnings,
    diseaseDisclaimer:           diseaseResult.disclaimer,
    nutritional_profile_display: {
      energy_kj:  parseNumeric(nutrition.EnergyKJ ?? (nutrition.EnergyKcal != null ? nutrition.EnergyKcal * 4.184 : null)),
      fat_g:      parseNumeric(nutrition.FatG),
      sat_fat_g:  parseNumeric(nutrition.SaturatedFatG),
      carbs_g:    parseNumeric(nutrition.CarbohydratesG),
      sugars_g:   parseNumeric(nutrition.SugarsG),
      fibre_g:    parseNumeric(nutrition.FibreG),
      protein_g:  parseNumeric(nutrition.ProteinG),
      sodium_mg:  parseNumeric(nutrition.SodiumMG ?? nutrition.Sodium?.ValueMG),
      potassium_mg: parseNumeric(nutrition.PotassiumMG ?? nutrition.Potassium?.ValueMG),
    },
    confidence:                  interpretation.evidenceTier,
    canDisplayGrade:             interpretation.canDisplayGrade,
    validationStatus:            interpretation.validationStatus,
    evidenceTier:                interpretation.evidenceTier,
    valueSpecificity:            interpretation.valueSpecificity,
    categoryPlausibilityCheck:   interpretation.categoryPlausibilityCheck,
    energyConsistencyCheck:      interpretation.energyConsistencyCheck,
    saltSodiumConsistencyCheck:  interpretation.saltSodiumConsistencyCheck,
    dataQualityFlags:            interpretation.dataQualityFlags,
    sourceReference:             interpretation.sourceReference,
    packSizeUnit:                groceryProduct.Packaging?.PackSizeUnit || (interpretation.foodCategory === "BEVERAGE" ? "ml" : "g"),
    matchInfo: {
      matched: matchResult.matched,
      matchMethod: matchResult.matchMethod,
      confidence: matchResult.confidence,
    },
  };

  if (cacheKey && typeof NutriScoreDB !== "undefined" && NutriScoreDB.saveProduct) {
    NutriScoreDB.saveProduct(cacheKey, result).catch(e => console.warn("[NutriScore SW] IndexedDB save:", e.message));
  }

  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (DEBUG) console.log("[NutriScore SW] Action:", message.action);

  if (message.action === "CHECK_PRODUCT_SCORE") {
    const retailerCode = message.retailer || "NAIVAS";

    getProductInfo(message.payload, retailerCode)
      .then(prod => {
        sendResponse({ status: "SUCCESS", data: prod });
      })
      .catch(err => {
        if (!err.message.startsWith("Product not found")) {
          console.warn(`[NutriScore SW] Processing failed: ${err.message}`);
        }
        sendResponse({
          status: "NOT_FOUND",
          data:   { product_name: message.payload.product_name, nutriscore_grade: "UNKNOWN" },
          error:  err.message
        });
      });

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
            const prodInfo = await getProductInfo(item, retailerCode);
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
              nutritionSnapshot: {
                sodiumMg: p.Nutrition?.SodiumMG ?? p.Nutrition?.Sodium?.ValueMG ?? null,
                sugarsG: p.Nutrition?.SugarsG ?? null,
                satFatG: p.Nutrition?.SaturatedFatG ?? null,
                potassiumMg: p.Nutrition?.PotassiumMG ?? p.Nutrition?.Potassium?.ValueMG ?? null
              }
            };
            await NutriScoreDB.logCartEvent(row);
            chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => {});
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
        
        await NutriScoreDB.syncCart(message.payload.retailer, message.payload.items);
        chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => {});
        if (sendResponse) sendResponse({ status: "SUCCESS" });
      } catch (err) {
        console.error("Cart sync failed:", err);
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
        chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => {});
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
        chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => {});
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
        chrome.runtime.sendMessage({ action: "CART_UPDATED" }).catch(() => {});
      } catch (err) {
        console.error("ORDER_PLACED failed:", err);
      }
    })();
    return true;
  }
});


