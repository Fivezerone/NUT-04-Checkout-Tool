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
  const BATCH_SIZE = 500;
  let syncPromise = null;

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
      const { data, error } = await supabase.from(table)
        .select("*")
        .gt("seq", current)
        .lte("seq", maxSeq)
        .order("seq", { ascending: true })
        .limit(BATCH_SIZE);
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
    const sTx = db.transaction(["catalog_staging", "catalog_hashes"], "readonly");
    const staged = await sTx.objectStore("catalog_staging").getAll();
    if (staged.length === 0) return;

    // 1. Update integrity hashes
    const hTx = db.transaction("catalog_hashes", "readwrite");
    for (const row of staged) {
      if (row.deleted) {
        hTx.store.delete(row.key);
      } else {
        hTx.store.put({ key: row.key, hash: row.record_hash });
      }
    }
    await hTx.done;

    // 2. Write product records into the lookup stores (naivasProducts / carrefourProducts)
    //    so that resolveProductMatch can find them.
    const isNavias    = r => (r.retailer || "").toUpperCase() === "NAIVAS";
    const isCarrefour = r => (r.retailer || "").toUpperCase() === "CARREFOUR";
    const naivasRows       = staged.filter(r => isNavias(r)    && r.record && !r.deleted);
    const carrefourRows    = staged.filter(r => isCarrefour(r) && r.record && !r.deleted);
    const naivasDeletes    = staged.filter(r => isNavias(r)    && r.deleted);
    const carrefourDeletes = staged.filter(r => isCarrefour(r) && r.deleted);

    if (naivasRows.length || naivasDeletes.length) {
      const nTx = db.transaction("naivasProducts", "readwrite");
      for (const row of naivasRows)    nTx.store.put(row.record);
      for (const row of naivasDeletes) nTx.store.delete(row.product_id);
      await nTx.done;
    }
    if (carrefourRows.length || carrefourDeletes.length) {
      const cTx = db.transaction("carrefourProducts", "readwrite");
      for (const row of carrefourRows)    cTx.store.put(row.record);
      for (const row of carrefourDeletes) cTx.store.delete(row.product_id);
      await cTx.done;
    }

    // 3. Invalidate in-memory caches so the next lookup reads fresh data
    if (typeof NutriScoreDB !== "undefined") {
      if (NutriScoreDB.memCache) {
        NutriScoreDB.memCache.naivas    = null;
        NutriScoreDB.memCache.carrefour = null;
      }
      if (NutriScoreDB.normalizedIndexCache) {
        NutriScoreDB.normalizedIndexCache.naivas    = null;
        NutriScoreDB.normalizedIndexCache.carrefour = null;
      }
      if (NutriScoreDB.lowerIndexCache) {
        NutriScoreDB.lowerIndexCache.naivas    = null;
        NutriScoreDB.lowerIndexCache.carrefour = null;
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
    const supabase = NutriSupabase.create(NUTRI_CONFIG.SUPABASE_URL, NUTRI_CONFIG.SUPABASE_ANON_KEY);
    
    const { data: { session } } = await supabase.auth.getSession();
    const isAuth = !!session;

    // 1. Fetch current release
    const { data: releaseData, error: releaseErr } = await supabase
      .from("catalog_releases")
      .select("manifest, signature, key_id")
      .eq("is_current", true)
      .single();
      
    if (releaseErr && releaseErr.code === 'PGRST116') {
      console.warn("[NutriCatalogSync] No active catalog release found in Supabase. Skipping sync.");
      return;
    }
    if (releaseErr || !releaseData) throw new Error("Failed to fetch catalog release: " + (releaseErr?.message || "No data"));
    
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

    // 3. Stream premium
    if (needsPremiumSync) {
      console.log(`[NutriCatalogSync] Pulling premium from seq 0 to ${manifest.max_seq}`);
      // Premium always full-syncs when tier changes, as we don't track a separate cursor.
      // Easiest is to clear and fetch all.
      await db.clear("premium_assessments");
      await pullUpdates(supabase, "catalog_premium", 0, manifest.max_seq, "premium_assessments", db);
      
      const localPremHash = await computeLocalHash(db, "premium_assessments");
      if (localPremHash !== manifest.premium_hash) {
        throw new Error(`Premium hash mismatch. Expected ${manifest.premium_hash}, got ${localPremHash}`);
      }
      
      meta.premiumVersion = manifest.version;
      await NutriScoreDB.putCatalogMeta(meta);
      console.log("[NutriCatalogSync] Premium sync complete and verified.");
    }
  }

  async function ensureReady() {
    if (!syncPromise) {
      syncPromise = sync().catch(async e => {
        console.error("[NutriCatalogSync] Sync failed:", e);
        try {
          // If we already have a catalog, swallow the error and continue
          const meta = await NutriScoreDB.getCatalogMeta();
          if (meta && meta.version) {
             console.warn("[NutriCatalogSync] Continuing with cached catalog version:", meta.version);
             return; // Resolve successfully
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

  return { ensureReady, sync };
})();
