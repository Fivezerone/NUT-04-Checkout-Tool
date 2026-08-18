/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BackgroundServiceWorker ? Component Architecture v2.0
 * Orchestrates: FoodClassifier -> ScoreEngine -> DiseaseEngine
 */

importScripts(
  "db.js",
  "engine/food-classifier.js",
  "engine/score-engine.js",
  "engine/disease-engine.js",
  "engine/alternatives-engine.js"
);

console.log("[NutriScore SW] Component Architecture v2.0 active.");

self.__nutriscorePriceIndex = new Map();

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

// resolveBadgeSignal replaced by NutriScoreDB.interpretProduct

async function getProductInfo(payload, retailerCode) {
  await initializeDatabases();

  const { product_name, name_hash, retailer_product_id, url, price } = payload;

  if (retailer_product_id && price) {
    if (NutriScoreDB.savePrice) await NutriScoreDB.savePrice(retailer_product_id, price);
  }
  
  const settings = await (NutriScoreDB.getSettings ? NutriScoreDB.getSettings() : { diabetes: true, hypertension: true, cardiovascular: true, kidney: true });

  const cacheKey = retailer_product_id || url || product_name;
  if (cacheKey && typeof NutriScoreDB !== "undefined" && NutriScoreDB.getCachedProduct) {
    const cached = await NutriScoreDB.getCachedProduct(cacheKey);
    if (cached) {
      const diseaseResult = DiseaseEngine.evaluate(cached, settings);
      cached.diseaseWarnings = diseaseResult.warnings;
      cached.diseaseDisclaimer = diseaseResult.disclaimer;
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
  const classification = groceryProduct.Classification || {};
  const identity = groceryProduct.Identity || {};

  const parseNumeric = (val) => {
    if (val == null) return null;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed;
  };

  let fsaCategoryCode = interpretation.nutrientAlgorithmVariant;
  
  const calcData = {
    name:          identity.ProductName || product_name,
    category:      fsaCategoryCode || "GENERAL_FOOD",
    is_beverage:   (fsaCategoryCode || "GENERAL_FOOD") === "BEVERAGE",
    is_raw_food:   false,
    energy:        parseNumeric(nutrition.EnergyKJ ?? (nutrition.EnergyKcal != null ? nutrition.EnergyKcal * 4.184 : null)),
    sugars:        parseNumeric(nutrition.SugarsG),
    sat_fat:       parseNumeric(nutrition.SaturatedFatG),
    sodium:        parseNumeric(nutrition.SodiumMG ?? nutrition.Sodium?.ValueMG),
    fiber:         parseNumeric(nutrition.FibreG),
    protein:       parseNumeric(nutrition.ProteinG),
    fruits_veg_pct: parseNumeric(nutrition.FVL?.Percentage),
    potassium:     parseNumeric(nutrition.PotassiumMG ?? nutrition.Potassium?.ValueMG),
    total_fat:     parseNumeric(nutrition.FatG),
    carbs:         parseNumeric(nutrition.CarbohydratesG),
    confidence:    interpretation.evidenceTier,
  };

  const classResult = FoodClassifier.classify(calcData);
  const isExcluded = classResult.isExcluded;

  if (!fsaCategoryCode) {
    fsaCategoryCode = classResult.FSAProductCategoryCode || "GENERAL_FOOD";
    calcData.category = fsaCategoryCode;
    calcData.is_beverage = fsaCategoryCode === "BEVERAGE";
  }

  const diseaseResult = DiseaseEngine.evaluate(calcData, settings);

  let scoreResult;
  let altsResult = { alternatives: [], disclaimer: "" };

  if (isExcluded) {
    scoreResult = { LetterGrade: "UNKNOWN", NumericScore: null, breakdown: null, AlgorithmVersion: "FSA-NPS-2023" };
  } else {
    scoreResult = ScoreEngine.score(calcData, fsaCategoryCode);
    
    // Make sure we have the full list of products for the AlternativesEngine
    const allProducts = (typeof NutriScoreDB !== "undefined" && NutriScoreDB.getAllProducts)
      ? await NutriScoreDB.getAllProducts(retailerCode)
      : [];

    altsResult = AlternativesEngine.getAlternatives(
      { 
        productId: identity.ProductID, 
        fsaCategory: fsaCategoryCode, 
        score: scoreResult.NumericScore, 
        grade: scoreResult.LetterGrade,
        price: payload.price 
      },
      allProducts
    );
  }

  const displayCategory = interpretation.foodCategory;

  const result = {
    productId:                   identity.ProductID || groceryProduct.GroceryProductID || payload.retailer_product_id,
    product_name:                calcData.name,
    retailer:                    retailerCode,
    nutriscore_grade:            scoreResult.LetterGrade || "UNKNOWN",
    score:                       scoreResult.NumericScore ?? 0,
    score_details:               scoreResult.breakdown || {},
    fsaCategory:                 fsaCategoryCode,
    displayCategory:             displayCategory,
    isExcluded:                  isExcluded,
    algorithmVersion:            scoreResult.AlgorithmVersion || "FSA-NPS-2023",
    diseaseWarnings:             diseaseResult.warnings,
    diseaseDisclaimer:           diseaseResult.disclaimer,
    alternatives:                altsResult.alternatives,
    nutritional_profile_display: {
      energy_kj:  nutrition.EnergyKJ,
      fat_g:      nutrition.FatG,
      sat_fat_g:  nutrition.SaturatedFatG,
      carbs_g:    nutrition.CarbohydratesG,
      sugars_g:   nutrition.SugarsG,
      fibre_g:    nutrition.FibreG,
      protein_g:  nutrition.ProteinG,
      sodium_mg:  nutrition.Sodium?.ValueMG,
    },
    confidence:                  calcData.confidence,
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
    ...calcData,
  };

  if (cacheKey && typeof NutriScoreDB !== "undefined" && NutriScoreDB.saveProduct) {
    NutriScoreDB.saveProduct(cacheKey, result).catch(e => console.warn("[NutriScore SW] IndexedDB save:", e.message));
  }

  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[NutriScore SW] Action:", message.action);

  if (message.action === "CHECK_PRODUCT_SCORE") {
    const retailerCode = message.retailer || "NAIVAS";

    getProductInfo(message.payload, retailerCode)
      .then(prod => {
        sendResponse({ status: "SUCCESS", data: prod });
      })
      .catch(err => {
        console.warn(`[NutriScore SW] Processing failed: ${err.message}`);
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


