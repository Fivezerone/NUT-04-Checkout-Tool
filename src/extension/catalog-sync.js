/**
 * src/extension/catalog-sync.js — global NutriCatalogSync
 *
 * IndexedDB thin-client catalog synchronization.
 * Pulls signed catalog_releases and streams catalog_products / catalog_premium
 * from Supabase, atomically committing changes via the catalog_staging store.
 * Replaces the static bundled JSON ingestion (db/settings.ts importDatasets).
 */

/* global NUTRI_CONFIG, NutriScoreDB, NutriSupabase, NutriEntitlement */

self.NutriCatalogSync = (() => {
  const BATCH_SIZE  = 500;   // pullUpdates page size (network rows per request)
  const CHUNK_SIZE  = 200;   // F-10: applyStaging cursor chunk size (caps peak heap)
  const PULL_DEADLINE_MS = 30_000; // F-16: per-page catalog fetch deadline (30 s)

  // F-13: data-driven retailer registry — adding a new retailer requires only
  // a one-line entry here; applyStaging and cache invalidation iterate the map.
  // Key: uppercase retailer code as stored in catalog_products.retailer
  // Value: { store — IDB objectStore name; cacheKey — memCache / index key }
  const RETAILER_REGISTRY = new Map([
    ["NAIVAS",    { store: "naivasProducts",    cacheKey: "naivas"    }],
    ["CARREFOUR", { store: "carrefourProducts", cacheKey: "carrefour" }],
    ["QUICKMART", { store: "quickmartProducts", cacheKey: "quickmart" }],
  ]);

  let syncPromise = null;

  // F-11: injected Supabase client accessor — set once at boot via init().
  let _getSupabase = null;
  function getSupabase() {
    if (_getSupabase) return _getSupabase();
    return NutriSupabase.create(NUTRI_CONFIG.SUPABASE_URL, NUTRI_CONFIG.SUPABASE_ANON_KEY);
  }

  async function base64urlDecode(str) {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - str.length % 4) % 4);
    const bin = atob(padded);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Same stableStringify from canonical.mjs, implemented for browser WebCrypto
  function stableStringify(value) {
    if (value === null) return "null";
    if (value === undefined) return undefined;
    const t = typeof value;
    if (t === "boolean" || t === "string") return JSON.stringify(value);
    if (t === "number") {
      if (!Number.isFinite(value)) throw new TypeError("non-finite number");
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return "[" + value.map(v => { const s = stableStringify(v); return s === undefined ? "null" : s; }).join(",") + "]";
    }
    if (t === "object") {
      const keys = Object.keys(value).sort();
      const parts = [];
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(value, k) && value[k] !== undefined) {
          const v = stableStringify(value[k]);
          if (v !== undefined) parts.push(JSON.stringify(k) + ":" + v);
        }
      }
      return "{" + parts.join(",") + "}";
    }
    return undefined;
  }

  async function verifyManifest(release) {
    const jwk = NUTRI_CONFIG.CATALOG_PUBLIC_KEYS.find(k => k.kid === release.key_id);
    if (!jwk) throw new Error("Unknown catalog key_id: " + release.key_id);
    const pub = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const manifestStr = stableStringify(release.manifest);
    const dataToVerify = new TextEncoder().encode(manifestStr);
    const sigBytes = await base64urlDecode(release.signature);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sigBytes, dataToVerify);
    if (!valid) throw new Error("Catalog manifest signature invalid");
    return release.manifest;
  }

  async function computeLocalHash(db, storeName) {
    const tx = db.transaction(storeName, "readonly");
    const hashes = await tx.store.getAll();
    const sorted = hashes.sort((a, b) => {
      const [ar, ap] = a.key.split("|");
      const [br, bp] = b.key.split("|");
      const r = ar.localeCompare(br, "en", { sensitivity: "variant" });
      if (r !== 0) return r;
      return ap.localeCompare(bp, "en", { sensitivity: "variant" });
    });
    const lines = sorted.map(r => `${r.key.replace("|", "|")}|${r.hash}\n`).join("");
    return await sha256Hex(lines);
  }

  async function pullUpdates(supabase, table, cursor, maxSeq, dbStore, db) {
    let current = cursor;
    let total = 0;
    while (current < maxSeq) {
      // F-16: per-page deadline — a hung Supabase call will abort after 30 s.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error("pullUpdates timeout")), PULL_DEADLINE_MS);
      let data, error;
      try {
        ({ data, error } = await supabase.from(table)
          .select("*")
          .gt("seq", current)
          .lte("seq", maxSeq)
          .order("seq", { ascending: true })
          .limit(BATCH_SIZE)
          .abortSignal(ac.signal));
      } finally {
        clearTimeout(timer);
      }
      if (error) throw error;
      if (!data || data.length === 0) break;

      const tx = db.transaction(dbStore, "readwrite");
      for (const row of data) {
        tx.store.put({
          key: `${row.retailer}|${row.product_id}`,
          retailer: row.retailer,
          product_id: row.product_id,
          record: table === "catalog_products" ? row.record : undefined,
          assessments: table === "catalog_premium" ? row.assessments : undefined,
          record_hash: row.record_hash,
          deleted: row.deleted
        });
      }
      await tx.done;
      current = data[data.length - 1].seq;
      total += data.length;

      // Update stagingCursor
      const meta = await NutriScoreDB.getCatalogMeta();
      meta.stagingCursor = current;
      await NutriScoreDB.putCatalogMeta(meta);
    }
    return total;
  }

  async function applyStaging(db) {
    // F-10: chunked cursor iteration — cap peak heap to CHUNK_SIZE rows.
    // OLD: getAll() on catalog_staging loaded the *entire* delta into a single
    //      JS array; on first install that equals the whole catalog (~26 MB).
    // NEW: iterate via IDB openCursor in CHUNK_SIZE batches, flushing writes
    //      after each chunk. Peak JS heap ≤ CHUNK_SIZE records at any time.
    let hasAny = false;
    let done = false;
    let lastKey = null;

    while (!done) {
      const readTx = db.transaction("catalog_staging", "readonly");
      const range = (lastKey !== null && typeof IDBKeyRange !== "undefined")
        ? IDBKeyRange.lowerBound(lastKey, true)
        : undefined;
      let cursor = await (range ? readTx.store.openCursor(range) : readTx.store.openCursor());
      const chunk = [];
      // Collect up to CHUNK_SIZE rows from the cursor
      while (cursor && chunk.length < CHUNK_SIZE) {
        chunk.push(cursor.value);
        lastKey = cursor.key;
        cursor = await cursor.continue();
      }
      await readTx.done;
      if (chunk.length === 0) break;
      hasAny = true;
      done = !cursor; // no more rows after this chunk

      // 1. Update integrity hashes for this chunk
      const hTx = db.transaction("catalog_hashes", "readwrite");
      for (const row of chunk) {
        if (row.deleted) {
          hTx.store.delete(row.key);
        } else {
          hTx.store.put({ key: row.key, hash: row.record_hash });
        }
      }
      await hTx.done;

      // 2. Write product records into the lookup stores for this chunk
      //    F-13: data-driven dispatch — iterate RETAILER_REGISTRY, no per-retailer branches.
      for (const [code, { store }] of RETAILER_REGISTRY.entries()) {
        const match = r => (r.retailer || "").toUpperCase() === code;
        const upserts = chunk.filter(r => match(r) && r.record && !r.deleted);
        const deletes = chunk.filter(r => match(r) && r.deleted);
        if (upserts.length || deletes.length) {
          const rTx = db.transaction(store, "readwrite");
          for (const row of upserts) rTx.store.put(row.record);
          for (const row of deletes) rTx.store.delete(row.product_id);
          await rTx.done;
        }
      }
    }

    if (!hasAny) return;

    // 3. Invalidate in-memory caches so the next lookup reads fresh data
    //    F-13: iterate RETAILER_REGISTRY cacheKeys — no per-retailer branches.
    if (typeof NutriScoreDB !== "undefined") {
      for (const { cacheKey } of RETAILER_REGISTRY.values()) {
        if (NutriScoreDB.memCache)             NutriScoreDB.memCache[cacheKey]             = null;
        if (NutriScoreDB.normalizedIndexCache) NutriScoreDB.normalizedIndexCache[cacheKey] = null;
        if (NutriScoreDB.lowerIndexCache)      NutriScoreDB.lowerIndexCache[cacheKey]      = null;
      }
    }

    // 4. Clear staging store
    const cTx = db.transaction("catalog_staging", "readwrite");
    await cTx.store.clear();
    await cTx.done;
  }

  async function sync() {
    console.log("[NutriCatalogSync] Starting sync...");
    const db = await NutriScoreDB.getDB();
    // F-11: use the injected singleton client, not a freshly created one.
    const supabase = getSupabase();
    
    // Bypass stale memory cache in the background script to ensure requests are authenticated
    const local = await chrome.storage.local.get("nutri_supabase_session");
    if (local.nutri_supabase_session) {
      try {
        const parsed = JSON.parse(local.nutri_supabase_session);
        if (parsed?.access_token && parsed?.refresh_token) {
          await supabase.auth.setSession({
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token
          });
        }
      } catch (e) {
        console.warn("[NutriCatalogSync] Failed to parse local session", e);
      }
    }

    const { data: { session } } = await supabase.auth.getSession();
    const isAuth = !!session;

    if (!isAuth) {
      console.warn("[NutriCatalogSync] User is unauthenticated. Skipping remote Supabase catalog sync; using local catalog.");
      return;
    }

    // 1. Fetch current release
    const { data: releaseData, error: releaseErr } = await supabase
      .from("catalog_releases")
      .select("manifest, signature, key_id")
      .eq("is_current", true)
      .single();
      
    if (releaseErr) {
      if (releaseErr.code === 'PGRST116') {
        console.warn("[NutriCatalogSync] No active catalog release found in Supabase. Skipping sync.");
        return;
      }
      if (releaseErr.code === '42501') {
        console.warn("[NutriCatalogSync] Permission denied for catalog_releases in Supabase. Skipping sync; using local catalog.");
        return;
      }
      console.warn("[NutriCatalogSync] Failed to fetch catalog release:", releaseErr?.message || releaseErr);
      return;
    }
    if (!releaseData) {
      console.warn("[NutriCatalogSync] No catalog release data returned.");
      return;
    }
    
    const manifest = await verifyManifest(releaseData);
    let meta = (await NutriScoreDB.getCatalogMeta()) || {
      retailer: "_catalog", version: "", maxSeq: 0, cursor: 0, stagingCursor: 0, lastSyncAt: "", disclaimer: "", updateRequired: true, premiumVersion: ""
    };
    
    const isNewVersion = meta.version !== manifest.version;
    if (isNewVersion) {
      meta.updateRequired = true;
      meta.stagingCursor = meta.cursor;
      meta.version = manifest.version;
      meta.maxSeq = manifest.max_seq;
      meta.disclaimer = manifest.disclaimer || "";
      await NutriScoreDB.putCatalogMeta(meta);
    }

    const { tier } = await NutriEntitlement.resolveTier(session?.user?.id);
    const needsPremiumSync = tier === "premium" && meta.premiumVersion !== manifest.version;

    if (!meta.updateRequired && !needsPremiumSync) {
      console.log("[NutriCatalogSync] Up to date.");
      return;
    }

    // 2. Stream products
    if (meta.updateRequired) {
      console.log(`[NutriCatalogSync] Pulling products from seq ${meta.stagingCursor} to ${manifest.max_seq}`);
      await pullUpdates(supabase, "catalog_products", meta.stagingCursor, manifest.max_seq, "catalog_staging", db);
      await applyStaging(db);
      
      const localHash = await computeLocalHash(db, "catalog_hashes");
      if (localHash !== manifest.catalog_hash) {
        throw new Error(`Catalog hash mismatch. Expected ${manifest.catalog_hash}, got ${localHash}`);
      }
      
      meta.cursor = manifest.max_seq;
      meta.stagingCursor = manifest.max_seq;
      meta.updateRequired = false;
      meta.lastSyncAt = new Date().toISOString();
      await NutriScoreDB.putCatalogMeta(meta);
      console.log("[NutriCatalogSync] Product sync complete and verified.");
    }

    // 3. Stream premium — F-09: atomic-swap pattern.
    // OLD (broken): clear("premium_assessments") → pull → verify
    //   → A network drop between clear and verify leaves an EMPTY store.
    // NEW: pull into "premium_staging" → verify hash → atomic swap into "premium_assessments"
    //   → A drop at any point leaves "premium_assessments" intact.
    if (needsPremiumSync) {
      console.log(`[NutriCatalogSync] Pulling premium into staging (seq 0→${manifest.max_seq})...`);

      // Step 1: Clear the staging store from any previous aborted attempt
      await db.clear("premium_staging");

      // Step 2: Pull all premium rows into premium_staging (never touches premium_assessments)
      await pullUpdates(supabase, "catalog_premium", 0, manifest.max_seq, "premium_staging", db);

      // Step 3: Verify integrity BEFORE touching the live store
      const localPremHash = await computeLocalHash(db, "premium_staging");
      if (localPremHash !== manifest.premium_hash) {
        // Hash mismatch — discard staging, leave premium_assessments untouched
        await db.clear("premium_staging");
        throw new Error(`Premium hash mismatch. Expected ${manifest.premium_hash}, got ${localPremHash}`);
      }

      // Step 4: Atomic swap — read all staging rows then replace premium_assessments
      // in a single IDB transaction so there is no window where both stores are empty.
      const stagingRows = await db.getAll("premium_staging");
      const swapTx = db.transaction(["premium_assessments", "premium_staging"], "readwrite");
      const assessStore = swapTx.objectStore("premium_assessments");
      const stagingStore = swapTx.objectStore("premium_staging");
      await assessStore.clear();
      for (const row of stagingRows) {
        if (!row.deleted) {
          assessStore.put({
            key: row.key,
            retailer: row.retailer,
            product_id: row.product_id,
            assessments: row.assessments,
          });
        }
      }
      await stagingStore.clear(); // clean up staging after successful swap
      await swapTx.done;

      meta.premiumVersion = manifest.version;
      await NutriScoreDB.putCatalogMeta(meta);
      console.log("[NutriCatalogSync] Premium sync complete and verified (atomic swap).");
    }
  }

  async function seedFallbackIfEmpty(db) {
    for (const [code, { store, cacheKey }] of RETAILER_REGISTRY.entries()) {
      try {
        const count = await db.count(store).catch(() => 0);
        if (count === 0) {
          const filename = `${cacheKey}_products.json`;
          const url = (typeof chrome !== "undefined" && chrome.runtime?.getURL)
            ? chrome.runtime.getURL(`data/${filename}`)
            : `/data/${filename}`;
          const resp = await fetch(url).catch(e => {
            console.warn(`[NutriCatalogSync] Could not fetch bundled ${filename}:`, e);
            return null;
          });
          if (resp && resp.ok) {
            const products = await resp.json();
            if (Array.isArray(products) && products.length > 0) {
              console.log(`[NutriCatalogSync] Seeding ${products.length} ${code} products into ${store}...`);
              const tx = db.transaction(store, "readwrite");
              for (const p of products) {
                if (p?.Identity?.ProductID) {
                  tx.store.put(p);
                }
              }
              await tx.done;
              console.log(`[NutriCatalogSync] ${code} local seed complete.`);
              if (typeof NutriScoreDB !== "undefined") {
                if (NutriScoreDB.memCache) NutriScoreDB.memCache[cacheKey] = null;
                if (NutriScoreDB.normalizedIndexCache) NutriScoreDB.normalizedIndexCache[cacheKey] = null;
                if (NutriScoreDB.lowerIndexCache) NutriScoreDB.lowerIndexCache[cacheKey] = null;
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[NutriCatalogSync] Error seeding ${code} fallback:`, err);
      }
    }
    try {
      const meta = await NutriScoreDB.getCatalogMeta();
      if (!meta || !meta.version) {
        await NutriScoreDB.putCatalogMeta({
          retailer: "_catalog",
          version: "local-bundled",
          maxSeq: 0,
          cursor: 0,
          stagingCursor: 0,
          lastSyncAt: new Date().toISOString(),
          disclaimer: "NutriScore grades are for informational purposes only. Consult a healthcare professional for dietary advice.",
          updateRequired: false,
          premiumVersion: ""
        });
      }
    } catch (err) {
      // Ignore meta error
    }
  }

  async function ensureReady() {
    if (!syncPromise) {
      syncPromise = (async () => {
        const db = await NutriScoreDB.getDB();
        await seedFallbackIfEmpty(db);
        return await sync();
      })().catch(async e => {
        const errName = e?.name || (e?.constructor?.name ?? "Error");
        const errMsg = e?.message || String(e);
        console.error(`[NutriCatalogSync] Sync failed (${errName}): ${errMsg}`, e);
        try {
          // If we already have a catalog, swallow the error and continue
          const meta = await NutriScoreDB.getCatalogMeta();
          if (meta && meta.version) {
             console.warn("[NutriCatalogSync] Continuing with cached catalog version:", meta.version);
             return; // Resolve successfully
          }
          // If local products exist in either retailer store, allow continuing with local data
          const db = await NutriScoreDB.getDB();
          const naivasCount = await db.count("naivasProducts").catch(() => 0);
          const carrefourCount = await db.count("carrefourProducts").catch(() => 0);
          const quickmartCount = await db.count("quickmartProducts").catch(() => 0);
          if (naivasCount > 0 || carrefourCount > 0 || quickmartCount > 0) {
            console.warn(`[NutriCatalogSync] Continuing with local catalog (${naivasCount + carrefourCount + quickmartCount} products).`);
            return;
          }
        } catch(err) {
          // Ignore meta fetch errors here
        }
        // If we don't have a catalog, we must throw because the extension cannot function
        syncPromise = null;
        throw e;
      });
    }
    return syncPromise;
  }

  /**
   * Wire the SW's Supabase singleton into this module.
   * @param {() => object} sbAccessor
   */
  function init(sbAccessor) {
    _getSupabase = sbAccessor;
  }

  return { init, ensureReady, sync, seedFallbackIfEmpty };
})();
