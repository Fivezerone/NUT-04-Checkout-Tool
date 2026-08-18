var NutriScoreDB = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/ui/src/app/lib/products.ts
  // Removed mock PRODUCTS array for production

  // src/ui/src/app/lib/db.ts
  var db_exports = {};
  __export(db_exports, {
    clearCartItems: () => clearCartItems,
    markCartPurchased: () => markCartPurchased,
    removeCartItem: () => removeCartItem,
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS,
    cacheProduct: () => cacheProduct,
    calculateAnalytics: () => calculateAnalytics,
    clearScans: () => clearScans,
    computeGradeFromProduct: () => computeGradeFromProduct,
    countEntries: () => countEntries,
    dedupeActiveCartItems: () => dedupeActiveCartItems,
    entryBucketKey: () => entryBucketKey,
    generateBucketSlots: () => generateBucketSlots,
    getAllEntries: () => getAllEntries,
    getAllScans: () => getAllScans,
    getCachedProduct: () => getCachedProduct,
    getHistoricalTrends: () => getHistoricalTrends,
    getSettings: () => getSettings,
    importDatasets: () => importDatasets,
    interpretProduct: () => interpretProduct,
    logCartEvent: () => logCartEvent,
    getAllProducts: () => getAllProducts,
    getAllShoppingLedger: () => getAllShoppingLedger,
    normalizeProductName: () => normalizeProductName,
    purgeAll: () => purgeAll,
    resolveDisplayCategory: () => resolveDisplayCategory,
    resolveProductMatch: () => resolveProductMatch,
    resolveTimeframe: () => resolveTimeframe,
    saveProduct: () => saveProduct,
    saveSettings: () => saveSettings,
    syncCart: () => syncCart,
    savePrice: () => savePrice,
    getPrice: () => getPrice,
    deleteLedgerEntry: () => deleteLedgerEntry
  });

  // node_modules/idb/build/index.js
  var instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
  var idbProxyableTypes;
  var cursorAdvanceMethods;
  function getIdbProxyableTypes() {
    return idbProxyableTypes || (idbProxyableTypes = [
      IDBDatabase,
      IDBObjectStore,
      IDBIndex,
      IDBCursor,
      IDBTransaction
    ]);
  }
  function getCursorAdvanceMethods() {
    return cursorAdvanceMethods || (cursorAdvanceMethods = [
      IDBCursor.prototype.advance,
      IDBCursor.prototype.continue,
      IDBCursor.prototype.continuePrimaryKey
    ]);
  }
  var transactionDoneMap = /* @__PURE__ */ new WeakMap();
  var transformCache = /* @__PURE__ */ new WeakMap();
  var reverseTransformCache = /* @__PURE__ */ new WeakMap();
  function promisifyRequest(request) {
    const promise = new Promise((resolve, reject) => {
      const unlisten = () => {
        request.removeEventListener("success", success);
        request.removeEventListener("error", error);
      };
      const success = () => {
        resolve(wrap(request.result));
        unlisten();
      };
      const error = () => {
        reject(request.error);
        unlisten();
      };
      request.addEventListener("success", success);
      request.addEventListener("error", error);
    });
    reverseTransformCache.set(promise, request);
    return promise;
  }
  function cacheDonePromiseForTransaction(tx) {
    if (transactionDoneMap.has(tx))
      return;
    const done = new Promise((resolve, reject) => {
      const unlisten = () => {
        tx.removeEventListener("complete", complete);
        tx.removeEventListener("error", error);
        tx.removeEventListener("abort", error);
      };
      const complete = () => {
        resolve();
        unlisten();
      };
      const error = () => {
        reject(tx.error || new DOMException("AbortError", "AbortError"));
        unlisten();
      };
      tx.addEventListener("complete", complete);
      tx.addEventListener("error", error);
      tx.addEventListener("abort", error);
    });
    transactionDoneMap.set(tx, done);
  }
  var idbProxyTraps = {
    get(target, prop, receiver) {
      if (target instanceof IDBTransaction) {
        if (prop === "done")
          return transactionDoneMap.get(target);
        if (prop === "store") {
          return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
        }
      }
      return wrap(target[prop]);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    has(target, prop) {
      if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
        return true;
      }
      return prop in target;
    }
  };
  function replaceTraps(callback) {
    idbProxyTraps = callback(idbProxyTraps);
  }
  function wrapFunction(func) {
    if (getCursorAdvanceMethods().includes(func)) {
      return function(...args) {
        func.apply(unwrap(this), args);
        return wrap(this.request);
      };
    }
    return function(...args) {
      return wrap(func.apply(unwrap(this), args));
    };
  }
  function transformCachableValue(value) {
    if (typeof value === "function")
      return wrapFunction(value);
    if (value instanceof IDBTransaction)
      cacheDonePromiseForTransaction(value);
    if (instanceOfAny(value, getIdbProxyableTypes()))
      return new Proxy(value, idbProxyTraps);
    return value;
  }
  function wrap(value) {
    if (value instanceof IDBRequest)
      return promisifyRequest(value);
    if (transformCache.has(value))
      return transformCache.get(value);
    const newValue = transformCachableValue(value);
    if (newValue !== value) {
      transformCache.set(value, newValue);
      reverseTransformCache.set(newValue, value);
    }
    return newValue;
  }
  var unwrap = (value) => reverseTransformCache.get(value);
  function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
    const request = indexedDB.open(name, version);
    const openPromise = wrap(request);
    if (upgrade) {
      request.addEventListener("upgradeneeded", (event) => {
        upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
      });
    }
    if (blocked) {
      request.addEventListener("blocked", (event) => blocked(
        // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
        event.oldVersion,
        event.newVersion,
        event
      ));
    }
    openPromise.then((db) => {
      if (terminated)
        db.addEventListener("close", () => terminated());
      if (blocking) {
        db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
      }
    }).catch(() => {
    });
    return openPromise;
  }
  var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
  var writeMethods = ["put", "add", "delete", "clear"];
  var cachedMethods = /* @__PURE__ */ new Map();
  function getMethod(target, prop) {
    if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
      return;
    }
    if (cachedMethods.get(prop))
      return cachedMethods.get(prop);
    const targetFuncName = prop.replace(/FromIndex$/, "");
    const useIndex = prop !== targetFuncName;
    const isWrite = writeMethods.includes(targetFuncName);
    if (
      // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
      !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
    ) {
      return;
    }
    const method = async function(storeName, ...args) {
      const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
      let target2 = tx.store;
      if (useIndex)
        target2 = target2.index(args.shift());
      return (await Promise.all([
        target2[targetFuncName](...args),
        isWrite && tx.done
      ]))[0];
    };
    cachedMethods.set(prop, method);
    return method;
  }
  replaceTraps((oldTraps) => ({
    ...oldTraps,
    get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
    has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
  }));
  var advanceMethodProps = ["continue", "continuePrimaryKey", "advance"];
  var methodMap = {};
  var advanceResults = /* @__PURE__ */ new WeakMap();
  var ittrProxiedCursorToOriginalProxy = /* @__PURE__ */ new WeakMap();
  var cursorIteratorTraps = {
    get(target, prop) {
      if (!advanceMethodProps.includes(prop))
        return target[prop];
      let cachedFunc = methodMap[prop];
      if (!cachedFunc) {
        cachedFunc = methodMap[prop] = function(...args) {
          advanceResults.set(this, ittrProxiedCursorToOriginalProxy.get(this)[prop](...args));
        };
      }
      return cachedFunc;
    }
  };
  async function* iterate(...args) {
    let cursor = this;
    if (!(cursor instanceof IDBCursor)) {
      cursor = await cursor.openCursor(...args);
    }
    if (!cursor)
      return;
    cursor = cursor;
    const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
    ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
    reverseTransformCache.set(proxiedCursor, unwrap(cursor));
    while (cursor) {
      yield proxiedCursor;
      cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
      advanceResults.delete(proxiedCursor);
    }
  }
  function isIteratorProp(target, prop) {
    return prop === Symbol.asyncIterator && instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor]) || prop === "iterate" && instanceOfAny(target, [IDBIndex, IDBObjectStore]);
  }
  replaceTraps((oldTraps) => ({
    ...oldTraps,
    get(target, prop, receiver) {
      if (isIteratorProp(target, prop))
        return iterate;
      return oldTraps.get(target, prop, receiver);
    },
    has(target, prop) {
      return isIteratorProp(target, prop) || oldTraps.has(target, prop);
    }
  }));

  // src/ui/src/app/lib/db.ts
  var DEFAULT_SETTINGS = {
    diabetes: true,
    hypertension: true,
    cardiovascular: true,
    kidney: true
  };
  var SETTINGS_KEY = "warning-modules";
  var DB_NAME = "nut04-nutriscore";
  var DB_VERSION = 8;
  var dbPromise = null;
  function getDB() {
    if (!dbPromise) {
      dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) {
          if (oldVersion < 1) {
            const store = db.createObjectStore("shopping_history", { keyPath: "id" });
            store.createIndex("by-viewedAt", "viewedAt");
          }
          if (oldVersion < 2) {
            db.createObjectStore("user_settings");
          }
          if (oldVersion < 3) {
            db.createObjectStore("product_cache");
            if (db.objectStoreNames.contains("ledger")) {
              db.deleteObjectStore("ledger");
            }
            if (db.objectStoreNames.contains("settings")) {
              db.deleteObjectStore("settings");
            }
          }
          if (oldVersion < 4) {
            const cStore = db.createObjectStore("carrefourProducts", { keyPath: "Identity.ProductID" });
            cStore.createIndex("by-url", "Identity.RetailerProductUrl");
            const nStore = db.createObjectStore("naivasProducts", { keyPath: "Identity.ProductID" });
            nStore.createIndex("by-url", "Identity.RetailerProductUrl");
            db.createObjectStore("kfctReference", { keyPath: "Identity.FoodCode" });
          }
          if (oldVersion < 5) {
            const cStore = transaction.objectStore("carrefourProducts");
            cStore.createIndex("by-name", "Identity.ProductName");
            const nStore = transaction.objectStore("naivasProducts");
            nStore.createIndex("by-name", "Identity.ProductName");
          }
          if (oldVersion < 6) {
            if (db.objectStoreNames.contains("shopping_history")) {
              db.deleteObjectStore("shopping_history");
            }
            const ledgerStore = db.createObjectStore("shopping_ledger", { keyPath: "id" });
            ledgerStore.createIndex("by-addedAt", "addedAt");
            db.createObjectStore("dataset_metadata", { keyPath: "retailer" });
          }
          if (oldVersion < 7) {
            if (db.objectStoreNames.contains("carrefourProducts")) db.deleteObjectStore("carrefourProducts");
            if (db.objectStoreNames.contains("naivasProducts")) db.deleteObjectStore("naivasProducts");
            const cStore = db.createObjectStore("carrefourProducts", { keyPath: "Identity.ProductID" });
            cStore.createIndex("by-url", "Identity.RetailerProductUrl");
            cStore.createIndex("by-name", "Identity.ProductName");
            const nStore = db.createObjectStore("naivasProducts", { keyPath: "Identity.ProductID" });
            nStore.createIndex("by-url", "Identity.RetailerProductUrl");
            nStore.createIndex("by-name", "Identity.ProductName");
          }
          if (oldVersion < 8) {
            db.createObjectStore("price_cache");
          }
        }
      });
    }
    return dbPromise;
  }
  async function getSettings() {
    const db = await getDB();
    const stored = await db.get("user_settings", SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...stored ?? {} };
  }
  async function saveSettings(settings) {
    const db = await getDB();
    await db.put("user_settings", settings, SETTINGS_KEY);
  }
  async function getAllShoppingLedger() {
    const db = await getDB();
    return db.getAll("shopping_ledger");
  }

  async function getAllProducts(retailer) {
    const db = await getDB();
    const isCarrefour = retailer.toUpperCase() === "CARREFOUR";
    const storeName = isCarrefour ? "carrefourProducts" : "naivasProducts";
    const all = await db.getAll(storeName);
    
    const allPrices = new Map();
    if (db.objectStoreNames.contains("price_cache")) {
      const tx = db.transaction("price_cache", "readonly");
      let cursor = await tx.store.openCursor();
      while (cursor) {
        allPrices.set(cursor.key, cursor.value);
        cursor = await cursor.continue();
      }
    }
    
    return all.map(p => {
      const interpretation = interpretProduct(p);
      let grade = "C";
      if (interpretation.canDisplayGrade) {
        grade = ScoreEngine.score(mapRecordToCalcData(p), interpretation.nutrientAlgorithmVariant).LetterGrade;
      }
      const productId = String(p.Identity?.ProductID || p.GroceryProductID);
      return {
        productId,
        name: p.Identity?.ProductName || p.GroceryProductName || p.name,
        fsaCategory: interpretation.nutrientAlgorithmVariant || "GENERAL_FOOD",
        grade: grade,
        price: allPrices.get(productId) || 0
      };
    });
  }

  async function logCartEvent(row) {
    const db = await getDB();
    if (row.status === "in_cart") {
      const all = await db.getAllFromIndex("shopping_ledger", "by-addedAt");
      const existing = all.find((r) => r.retailer === row.retailer && r.productId === row.productId && r.status === "in_cart");
      if (existing && existing.id !== row.id) {
        existing.quantity += row.quantity || 1;
        if (row.priceSnapshot) existing.priceSnapshot = row.priceSnapshot;
        await db.put("shopping_ledger", existing);
        return;
      }
    }
    await db.put("shopping_ledger", row);
  }
  async function getAllEntries() {
    const db = await getDB();
    const all = await db.getAllFromIndex("shopping_ledger", "by-addedAt");
    return all.reverse();
  }
  async function syncCart(retailer, cartItems) {
    const db = await getDB();
    await dedupeActiveCartItems(db);
    const allInCart = await db.getAll("shopping_ledger");
    const now = Date.now();
    const tx = db.transaction("shopping_ledger", "readwrite");
    const store = tx.store;
    const processedPayloadIds = /* @__PURE__ */ new Set();
    for (const row of allInCart) {
      if (row.retailer !== retailer) continue;
      if (row.status !== "in_cart") continue;
      const cartMatch = cartItems.find((c) => c.productId === row.productId);
      if (cartMatch) {
        let changed = false;
        if (row.quantity !== cartMatch.quantity) {
          row.quantity = cartMatch.quantity;
          changed = true;
        }
        if (row.priceSnapshot !== cartMatch.priceSnapshot) {
          row.priceSnapshot = cartMatch.priceSnapshot;
          changed = true;
        }
        if (changed) {
          await store.put(row);
        }
        processedPayloadIds.add(cartMatch.productId);
      }
    }
    await tx.done;
    for (const item of cartItems) {
      if (processedPayloadIds.has(item.productId)) continue;
      const matchResult = await resolveProductMatch(
        retailer,
        item.productId,
        null,
        // url not parsed
        item.product_name || null
      );
      if (!matchResult.matched || !matchResult.product) continue;
      const p = matchResult.product;
      const interpretation = interpretProduct(p);
      if (!interpretation.canDisplayGrade) continue;

      let name = p.Identity?.ProductName || p.GroceryProductName || p.name || item.product_name || "Unknown Product";
      let gradeSnapshot = ScoreEngine.score(mapRecordToCalcData(p), interpretation.nutrientAlgorithmVariant).LetterGrade;
      let category = resolveDisplayCategory(p);
      let nutrition = {
        sodiumMg: p.Nutrition?.SodiumMG ?? null,
        sugarsG: p.Nutrition?.SugarsG ?? null,
        satFatG: p.Nutrition?.SaturatedFatG ?? null,
        potassiumMg: p.Nutrition?.PotassiumMG ?? p.Nutrition?.Potassium?.ValueMG ?? null
      };

      const newRow = {
        id: `${retailer}-${item.productId}-${now}`,
        productId: item.productId,
        name,
        retailer,
        addedAt: now,
        quantity: item.quantity || 1,
        priceSnapshot: item.priceSnapshot,
        gradeSnapshot,
        category,
        status: "in_cart",
        nutritionSnapshot: nutrition
      };
      await logCartEvent(newRow);
    }
  }
  /**
   * Delete a specific in_cart item for a retailer by productId.
   */
  async function removeCartItem(retailer, productId) {
    const db = await getDB();
    const all = await db.getAll("shopping_ledger");
    const tx = db.transaction("shopping_ledger", "readwrite");
    const store = tx.store;
    for (const row of all) {
      if (row.retailer === retailer && String(row.productId) === String(productId) && row.status === "in_cart") {
        await store.delete(row.id);
      }
    }
    await tx.done;
  }

  /**
   * Delete all in_cart items for a retailer when the cart is cleared.
   */
  async function clearCartItems(retailer) {
    const db = await getDB();
    const all = await db.getAll("shopping_ledger");
    const tx = db.transaction("shopping_ledger", "readwrite");
    const store = tx.store;
    for (const row of all) {
      if (row.retailer === retailer && row.status === "in_cart") {
        await store.delete(row.id);
      }
    }
    await tx.done;
  }

  /**
   * Mark all in_cart items for a retailer as 'purchased' (order placed).
   */
  async function markCartPurchased(retailer) {
    const db = await getDB();
    const all = await db.getAll("shopping_ledger");
    const tx = db.transaction("shopping_ledger", "readwrite");
    const store = tx.store;
    for (const row of all) {
      if (row.retailer === retailer && row.status === "in_cart") {
        row.status = "purchased";
        row.purchasedAt = Date.now();
        await store.put(row);
      }
    }
    await tx.done;
  }

  async function dedupeActiveCartItems(dbInstance) {
    const db = dbInstance || await getDB();
    const all = await db.getAll("shopping_ledger");
    const activeItems = all.filter((r) => r.status === "in_cart");
    const map = /* @__PURE__ */ new Map();
    const toDelete = [];
    for (const item of activeItems) {
      const key = `${item.retailer}-${item.productId}`;
      if (map.has(key)) {
        const existing = map.get(key);
        existing.quantity += item.quantity;
        toDelete.push(item.id);
      } else {
        map.set(key, item);
      }
    }
    if (toDelete.length > 0) {
      const tx = db.transaction("shopping_ledger", "readwrite");
      const store = tx.store;
      for (const existing of map.values()) {
        await store.put(existing);
      }
      for (const id of toDelete) {
        await store.delete(id);
      }
      await tx.done;
    }
  }
  async function countEntries() {
    const db = await getDB();
    return db.count("shopping_ledger");
  }
  async function getCachedProduct(id) {
    const db = await getDB();
    const cached = await db.get("product_cache", id);
    if (!cached) return null;
    let retailer = cached.retailer || "NAIVAS";
    const metadata = await db.get("dataset_metadata", retailer);
    const currentVersion = metadata ? metadata.datasetVersion : "v2.0.0";
    if (cached.datasetVersion === currentVersion) {
      return cached;
    }
    return null;
  }
  async function cacheProduct(id, product) {
    const db = await getDB();
    product.cachedAt = Date.now();
    let retailer = product.retailer || "NAIVAS";
    const metadata = await db.get("dataset_metadata", retailer);
    product.datasetVersion = metadata ? metadata.datasetVersion : "v2.0.0";
    await db.put("product_cache", product, id);
    if (Math.random() < 0.05) {
      const tx = db.transaction("product_cache", "readwrite");
      let cursor = await tx.store.openCursor();
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
      while (cursor) {
        if (!cursor.value.cachedAt || cursor.value.cachedAt < sevenDaysAgo) {
          await cursor.delete();
        }
        cursor = await cursor.continue();
      }
      await tx.done;
    }
  }
  async function purgeAll() {
    const db = await getDB();
    await Promise.all([
      db.clear("shopping_ledger"),
      db.clear("product_cache")
    ]);
  }
  async function saveProduct(key, result) {
    await cacheProduct(key, result);
  }
  async function getAllScans() {
    return await getAllEntries();
  }
  async function getHistoricalTrends() {
    const entries = await getAllEntries();
    return { count: entries.length };
  }
  async function clearScans() {
    await purgeAll();
  }
  // Removed seedIfEmpty function
  async function importDatasets() {
    const db = await getDB();
    const cCount = await db.count("carrefourProducts");
    const nCount = await db.count("naivasProducts");
    const kCount = await db.count("kfctReference");
    const importStore = async (count, storeName, path) => {
      if (count === 0) {
        console.log(`[NutriScoreDB] Importing ${storeName}...`);
        const res = await fetch(chrome.runtime.getURL(path));
        if (res.ok) {
          const data = await res.json();
          const chunkSize = 500;
          for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            const tx = db.transaction(storeName, "readwrite");
            chunk.forEach((p) => tx.store.put(p));
            await tx.done;
            await new Promise((r) => setTimeout(r, 0));
          }
          const mTx = db.transaction("dataset_metadata", "readwrite");
          mTx.store.put({
            retailer: storeName.replace("Products", "").replace("Reference", "").toUpperCase(),
            datasetVersion: "v2.0.0",
            generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            recordCount: data.length
          });
          await mTx.done;
        } else {
          console.error(`[NutriScoreDB] Failed to import ${storeName} from "${path}": HTTP ${res.status}. This store will remain empty.`);
        }
      }
    };
    await Promise.all([
      importStore(cCount, "carrefourProducts", "data/carrefour_final.json"),
      importStore(nCount, "naivasProducts", "data/naivas_final.json"),
      importStore(kCount, "kfctReference", "data/kfct2018_reference_validated.json")
    ]);
  }
  function resolveDisplayCategory(record) {
    if (!record || !record.Classification) return "Uncategorized";
    const { NutritionCategory, CanonicalFoodClass, FSACategoryCode } = record.Classification;
    if (NutritionCategory && NutritionCategory !== "Uncategorized") return NutritionCategory;
    if (CanonicalFoodClass && CanonicalFoodClass !== "Uncategorized") return CanonicalFoodClass;
    if (FSACategoryCode) return FSACategoryCode;
    return "Uncategorized";
  }
  function mapRecordToCalcData(p) {
    if (!p || !p.Nutrition) return {};
    const n = p.Nutrition;
    return {
      energy: n.EnergyKJ,
      sugars: n.SugarsG,
      sat_fat: n.SaturatedFatG,
      sodium: n.SodiumMG,
      fiber: n.FibreG,
      protein: n.ProteinG,
      fruits_veg_pct: n.FVL?.Percentage || 0,
      total_fat: n.FatG
    };
  }
  var memCache = { carrefour: null, naivas: null };
  var nameIndexCache = { carrefour: null, naivas: null };

  async function resolveProductMatch(retailer, retailerProductId, url, productName) {
    const db = await getDB();
    const isCarrefour = retailer.toUpperCase() === "CARREFOUR";
    const storeName = isCarrefour ? "carrefourProducts" : "naivasProducts";
    const tx = db.transaction(storeName, "readonly");
    const store = tx.store;

    if (!memCache.idIndex) memCache.idIndex = { carrefour: new Map(), naivas: new Map() };
    if (!memCache.urlIndex) memCache.urlIndex = { carrefour: new Map(), naivas: new Map() };

    if (isCarrefour && !memCache.carrefour) {
      memCache.carrefour = await store.getAll();
      nameIndexCache.carrefour = new Map();
      for (const p of memCache.carrefour) {
        if (p.Identity?.ProductID) memCache.idIndex.carrefour.set(String(p.Identity.ProductID), p);
        if (p.GroceryProductID) memCache.idIndex.carrefour.set(String(p.GroceryProductID), p);
        if (p.Identity?.RetailerProductUrl) memCache.urlIndex.carrefour.set(p.Identity.RetailerProductUrl, p);
        if (p.Identity?.ProductName) {
          nameIndexCache.carrefour.set(p.Identity.ProductName.toLowerCase().trim(), p);
          nameIndexCache.carrefour.set(normalizeProductName(p.Identity.ProductName), p);
        }
      }
    }
    if (!isCarrefour && !memCache.naivas) {
      memCache.naivas = await store.getAll();
      nameIndexCache.naivas = new Map();
      for (const p of memCache.naivas) {
        if (p.Identity?.ProductID) memCache.idIndex.naivas.set(String(p.Identity.ProductID), p);
        if (p.GroceryProductID) memCache.idIndex.naivas.set(String(p.GroceryProductID), p);
        if (p.Identity?.RetailerProductUrl) memCache.urlIndex.naivas.set(p.Identity.RetailerProductUrl, p);
        if (p.Identity?.ProductName) {
          nameIndexCache.naivas.set(p.Identity.ProductName.toLowerCase().trim(), p);
          nameIndexCache.naivas.set(normalizeProductName(p.Identity.ProductName), p);
        }
      }
    }

    const cacheArr = isCarrefour ? memCache.carrefour : memCache.naivas;
    const nameIndex = isCarrefour ? nameIndexCache.carrefour : nameIndexCache.naivas;
    const idIndex = isCarrefour ? memCache.idIndex.carrefour : memCache.idIndex.naivas;
    const urlIndex = isCarrefour ? memCache.urlIndex.carrefour : memCache.urlIndex.naivas;

    if (retailerProductId) {
      let hit = idIndex.get(String(retailerProductId));
      if (hit) return { matched: true, matchMethod: "product_id", confidence: "high", product: hit };
      if (retailerProductId && isCarrefour) {
        const pathFragment = `/p/${retailerProductId}`;
        const found = cacheArr.find((p) => (p.Identity?.RetailerProductUrl || "").includes(pathFragment));
        if (found) {
          return { matched: true, matchMethod: "url_path_fragment", confidence: "high", product: found };
        }
      }
    }
    if (url) {
      const urlHit = urlIndex.get(url);
      if (urlHit) return { matched: true, matchMethod: "url", confidence: "high", product: urlHit };
    }
    if (productName) {
      const nameHit = nameIndex.get(productName.toLowerCase().trim());
      if (nameHit) return { matched: true, matchMethod: "exact_name", confidence: "medium", product: nameHit };
      
      const lower = productName.toLowerCase().trim();
      if (nameIndex.has(lower)) {
        return { matched: true, matchMethod: "case_insensitive_name", confidence: "medium", product: nameIndex.get(lower) };
      }
      
      const normSearch = normalizeProductName(productName);
      if (normSearch && nameIndex.has(normSearch)) {
        return { matched: true, matchMethod: "normalized_name", confidence: "low", product: nameIndex.get(normSearch) };
      }
    }
    return { matched: false, matchMethod: "none", confidence: "none", reason: "No matching record found" };
  }
  function normalizeProductName(name) {
    if (!name) return "";
    return name.toLowerCase().replace(/\s*[0-9]+(?:\.[0-9]+)?\s*(g|kg|ml|l|pc|pcs) /g, "").replace(/\s*pack /g, "").replace(/\s*p\/kg /g, "").replace(/\s+/g, " ").trim();
  }
  function interpretProduct(record) {
    if (!record) return { canDisplayGrade: false };
    const validation = record.Validation || {};
    const validationStatus = validation.ReviewState || "pending";
    if (validationStatus === "manual_review_required") {
      return { canDisplayGrade: false, validationStatus };
    }
    const classification = record.Classification || {};
    const foodCategory = resolveDisplayCategory(record);
    const nutrientAlgorithmVariant = classification.FSACategoryCode || null;
    if (!nutrientAlgorithmVariant || foodCategory === "Uncategorized") {
      return { canDisplayGrade: false, validationStatus, foodCategory, nutrientAlgorithmVariant };
    }
    const prov = record.NutritionProvenance || {};
    let evidenceTier = "unverified";
    const rawEvidence = prov.EvidenceLevel;
    if (["retailer_matched_product", "single_ingredient_known_composition"].includes(rawEvidence)) {
      evidenceTier = "high_confidence";
    } else if (rawEvidence === "category_reference") {
      evidenceTier = "estimated";
    } else if (rawEvidence === "international_fct") {
      evidenceTier = "high_confidence";
    } else if (rawEvidence === "manufacturer") {
      evidenceTier = "verified";
    } else if (rawEvidence === "rejected") {
      evidenceTier = "rejected";
    } else if (rawEvidence === "unverified" || rawEvidence === "recovered_pending_evidence" || rawEvidence === "unresolved" || rawEvidence === "retailer_matched_product_low_confidence" || !rawEvidence) {
      evidenceTier = "unverified";
    }
    const checks = validation.ConsistencyChecks || {};
    const canDisplayGrade = ["validated", "approved", "approved_conditional", "approved_category_fallback"].includes(validationStatus) && evidenceTier !== "rejected";
    return {
      foodCategory,
      nutrientAlgorithmVariant,
      validationStatus,
      categoryPlausibilityCheck: checks.CategoryPlausibility || "not_checked",
      energyConsistencyCheck: checks.Atwater || "not_checked",
      saltSodiumConsistencyCheck: checks.SaltSodium || "not_checked",
      dataQualityFlags: validation.DataQualityFlags || [],
      evidenceTier,
      valueSpecificity: prov.ValueSpecificity || null,
      sourceReference: prov.SourceID ? { sourceId: prov.SourceID, sourceName: prov.SourceName } : null,
      canDisplayGrade
    };
  }
  function resolveTimeframe(timeframeKey, now = Date.now()) {
    const start = new Date(now);
    let bucketUnit = "day", bucketCount = 1, tickLabelFormat = "short";
    if (timeframeKey === "today") {
      start.setHours(0, 0, 0, 0);
      bucketUnit = "hour";
      bucketCount = 24;
    } else if (timeframeKey === "week") {
      start.setDate(start.getDate() - 7);
      bucketUnit = "day";
      bucketCount = 7;
    } else if (timeframeKey === "month") {
      start.setMonth(start.getMonth() - 1);
      bucketUnit = "day";
      bucketCount = 30;
    } else if (timeframeKey === "year") {
      start.setFullYear(start.getFullYear() - 1);
      bucketUnit = "month";
      bucketCount = 12;
    } else if (timeframeKey === "quarter") {
      start.setDate(start.getDate() - 90);
      bucketUnit = "week";
      bucketCount = 13;
    } else if (timeframeKey === "all") {
      start.setFullYear(2020);
      bucketUnit = "month";
      bucketCount = 60;
    }
    const tickLabelFn = (ts) => {
      const d = new Date(ts);
      if (bucketUnit === "hour") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (bucketUnit === "day") return d.toLocaleDateString([], { month: "short", day: "numeric" });
      if (bucketUnit === "month") return d.toLocaleDateString([], { month: "short", year: "2-digit" });
      return d.toLocaleDateString([], { year: "numeric" });
    };
    return {
      windowStart: start.getTime(),
      windowEnd: now,
      bucketUnit,
      bucketCount,
      tickLabelFormat,
      tickLabelFn
    };
  }
  function generateBucketSlots(tf) {
    const { windowStart, windowEnd, bucketUnit, tickLabelFn } = tf;
    const slots = [];
    const cursor = new Date(windowStart);
    if (bucketUnit === "hour") {
      cursor.setMinutes(0, 0, 0);
    } else if (bucketUnit === "day") {
      cursor.setHours(0, 0, 0, 0);
    } else if (bucketUnit === "week") {
      cursor.setHours(0, 0, 0, 0);
      cursor.setDate(cursor.getDate() - (cursor.getDay() + 6) % 7);
    } else if (bucketUnit === "month") {
      cursor.setDate(1);
      cursor.setHours(0, 0, 0, 0);
    } else {
      cursor.setMonth(Math.floor(cursor.getMonth() / 3) * 3, 1);
      cursor.setHours(0, 0, 0, 0);
    }
    let safety = 0;
    while (cursor.getTime() <= windowEnd && safety++ < 500) {
      const ts = cursor.getTime();
      slots.push({ key: `${bucketUnit}-${ts}`, ts, label: tickLabelFn(ts) });
      if (bucketUnit === "hour") cursor.setHours(cursor.getHours() + 1);
      else if (bucketUnit === "day") cursor.setDate(cursor.getDate() + 1);
      else if (bucketUnit === "week") cursor.setDate(cursor.getDate() + 7);
      else if (bucketUnit === "month") cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setMonth(cursor.getMonth() + 3);
    }
    return slots;
  }
  function entryBucketKey(ts, bu) {
    const d = new Date(ts);
    if (bu === "hour") {
      const s = new Date(d);
      s.setMinutes(0, 0, 0);
      return `hour-${s.getTime()}`;
    }
    if (bu === "day") {
      const s = new Date(d);
      s.setHours(0, 0, 0, 0);
      return `day-${s.getTime()}`;
    }
    if (bu === "week") {
      const s = new Date(d);
      s.setHours(0, 0, 0, 0);
      s.setDate(s.getDate() - (s.getDay() + 6) % 7);
      return `week-${s.getTime()}`;
    }
    if (bu === "month")
      return `month-${new Date(d.getFullYear(), d.getMonth(), 1).getTime()}`;
    return `quarter-${new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime()}`;
  }
  function calculateAnalytics(filteredLedger, totalStoredCount, tf) {
    const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    let ptsSum = 0;
    const gradePts = { A: 1, B: 3, C: 7, D: 12, E: 20 };
    const categoryMap = {};
    let diabetes = 0;
    let hypertension = 0;
    let cvd = 0;
    let kidney = 0;
    const slots = generateBucketSlots(tf);
    const acc = {};
    for (const s of slots) acc[s.key] = { sodium: 0, sugar: 0, satFat: 0, n: 0 };
    let validCount = 0;
    let missingCount = 0;
    filteredLedger.forEach((e) => {
      counts[e.gradeSnapshot || e.grade] = (counts[e.gradeSnapshot || e.grade] || 0) + 1;
      ptsSum += gradePts[e.gradeSnapshot || e.grade] || 0;
      const m = categoryMap[e.category] ?? (categoryMap[e.category] = { pts: 0, n: 0 });
      m.pts += gradePts[e.gradeSnapshot || e.grade] ?? 0;
      m.n += 1;
      const sugar = e.nutritionSnapshot?.sugarsG ?? e.sugarsG ?? null;
      const sodium = e.nutritionSnapshot?.sodiumMg ?? e.sodiumMg ?? null;
      const satFat = e.nutritionSnapshot?.satFatG ?? e.satFatG ?? null;
      const potassium = e.nutritionSnapshot?.potassiumMg ?? e.potassiumMg ?? null;
      if (sugar !== null) {
        if (Number(sugar) > 22.5) diabetes++;
      }
      if (sodium !== null) {
        if (Number(sodium) > 600) hypertension++;
      }
      if ((sodium !== null && Number(sodium) > 600) || (potassium !== null && Number(potassium) > 200)) {
        kidney++;
      }
      if (satFat !== null || sodium !== null) {
        if (Number(satFat) > 5 || Number(sodium) > 400 && Number(sodium) <= 600) cvd++;
      }
      if (sugar !== null && sodium !== null && satFat !== null) {
        validCount++;
        const key = entryBucketKey(e.addedAt, tf.bucketUnit);
        if (acc[key]) {
          acc[key].sodium += Number(sodium);
          acc[key].sugar += Number(sugar);
          acc[key].satFat += Number(satFat);
          acc[key].n += 1;
        }
      } else {
        missingCount++;
      }
    });
    const categoryInsights = Object.entries(categoryMap).map(([category, m]) => ({
      category,
      pts: Math.round(m.pts / m.n)
    })).sort((a, b) => b.pts - a.pts).slice(0, 6);
    const trendData = slots.map((s) => {
      const b = acc[s.key];
      return {
        ts: s.ts,
        label: s.label,
        id: s.key,
        sodiumMg: b.n > 0 ? Math.round(b.sodium / b.n) : null,
        sugarsG: b.n > 0 ? Math.round(b.sugar / b.n * 10) / 10 : null,
        satFatG: b.n > 0 ? Math.round(b.satFat / b.n * 10) / 10 : null,
        hasData: b.n > 0,
        sodium: b.n > 0 ? Math.round(b.sodium / b.n) : 0,
        sugar: b.n > 0 ? Math.round(b.sugar / b.n * 10) / 10 : 0,
        satFat: b.n > 0 ? Math.round(b.satFat / b.n * 10) / 10 : 0
      };
    });
    const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E'];
    function computeAverageGrade(counts) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total === 0) return null;
      const gradeValue = { A: 1, B: 2, C: 3, D: 4, E: 5 };
      const weighted = GRADE_ORDER.reduce((sum, g) => sum + gradeValue[g] * (counts[g] || 0), 0);
      const avgValue = Math.round(weighted / total);
      return GRADE_ORDER[Math.min(Math.max(avgValue, 1), 5) - 1];
    }
    return {
      totalStoredEvents: totalStoredCount,
      filteredPeriodEvents: filteredLedger.length,
      basketQuality: {
        averageGrade: computeAverageGrade(counts),
        pts: ptsSum,
        distribution: counts
      },
      categoryInsights,
      nutrientTrends: {
        windowStart: tf.windowStart,
        windowEnd: tf.windowEnd,
        ticks: slots.map((s) => ({ ts: s.ts, label: s.label })),
        data: trendData,
        validCount,
        missingCount
      },
      healthAlerts: {
        diabetes,
        hypertension,
        cvd,
        kidney
      }
    };
  }
  
  async function savePrice(productId, price) {
    if (!productId || price == null) return;
    const db = await getDB();
    await db.put("price_cache", price, String(productId));
  }
  
  async function getPrice(productId) {
    if (!productId) return null;
    const db = await getDB();
    const price = await db.get("price_cache", String(productId));
    return price ?? null;
  }
  
  async function deleteLedgerEntry(id) {
    const db = await getDB();
    await db.delete("shopping_ledger", id);
  }

  return __toCommonJS(db_exports);
})();
