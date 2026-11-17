/**
 * src/extension/catalog-sync.js — global NutriCatalogSync
 *
 * IndexedDB thin-client catalog synchronization.
 * Pulls signed catalog_releases and streams catalog_products / catalog_premium
 *
 * STAGE A (A-11b): @supabase/supabase-js package removed (A-04). The internal
 * getSupabase() factory and all supabase.auth / supabase.from() calls remain
 * and are PRESERVED for reference. These will be replaced with OIDC + REST
 * equivalents in Stage C (TODO(Stage C): rewrite supabase calls to use
 * config.API_URL + Bearer token from OIDC session; see ADR-0005).
 * No functional change in this commit — no test coverage removed.
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

  class IntegrityError extends Error {
    constructor(message, code = "INTEGRITY_ERROR") {
      super(message);
      this.name = "IntegrityError";
      this.code = code;
    }
  }

  const codeUnitCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const legacyCompare = (a, b) => a.localeCompare(b, "en", { sensitivity: "variant" });

  // F-11: injected Supabase client accessor — set once at boot via init().
  let _getSupabase = null;
  function getSupabase() {
    if (_getSupabase) return _getSupabase();
    return NutriSupabase.create(NUTRI_CONFIG.API_URL, NUTRI_CONFIG.OIDC_ISSUER);
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

  async function recordHash(record) {
    return await sha256Hex(stableStringify(record));
  }

  async function computeCatalogHashFromRows(rows, options = {}) {
    const isLegacy = options.legacy === true;
    const comparator = isLegacy
      ? (a, b) => {
          const r = legacyCompare(a.retailer, b.retailer);
          if (r !== 0) return r;
          return legacyCompare(a.product_id, b.product_id);
        }
      : (a, b) => {
          const r = codeUnitCompare(a.retailer, b.retailer);
          if (r !== 0) return r;
          return codeUnitCompare(a.product_id, b.product_id);
        };

    const sorted = [...rows].sort(comparator);
    const lines = sorted.map(r => `${r.retailer}|${r.product_id}|${r.record_hash}\n`).join("");
    return await sha256Hex(lines);
  }

  async function verifyManifest(release, meta) {
    const jwk = NUTRI_CONFIG.CATALOG_PUBLIC_KEYS.find(k => k.kid === release.key_id);
    if (!jwk) throw new Error("Unknown catalog key_id: " + release.key_id);
    const pub = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const manifestStr = stableStringify(release.manifest);
    const dataToVerify = new TextEncoder().encode(manifestStr);
    const sigBytes = await base64urlDecode(release.signature);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sigBytes, dataToVerify);
    if (!valid) throw new Error("Catalog manifest signature invalid");

    // Check future issued_at (> now + 5 min)
    if (release.manifest?.issued_at) {
      const issuedAtMs = Date.parse(release.manifest.issued_at);
      if (Number.isFinite(issuedAtMs) && issuedAtMs > Date.now() + 5 * 60_000) {
        throw new Error("Catalog manifest issued_at is in the future (> now + 5 min)");
      }
    }

    // Invariant A-03: Anti-rollback protection on release_seq
    if (release.manifest?.release_seq !== undefined && meta) {
      const maxSeen = meta.max_release_seen ?? meta.release_seq ?? 0;
      if (release.manifest.release_seq <= maxSeen) {
        throw new Error(
          `Rollback rejected: catalog release_seq ${release.manifest.release_seq} <= stored max_release_seen ${maxSeen}`
        );
      }
    }

    return release.manifest;
  }

  async function computeLocalHash(db, storeName) {
    const tx = db.transaction(storeName, "readonly");
    const hashes = await tx.store.getAll();
    const rows = hashes.map(h => {
      const [retailer, productId] = h.key.split("|");
      return { retailer, product_id: productId, record_hash: h.hash };
    });
    return await computeCatalogHashFromRows(rows, { legacy: false });
  }

  async function verifyStaging(manifest, db) {
    // 1. Read all staged product rows from catalog_staging
    const sTx = db.transaction("catalog_staging", "readonly");
    const stagedRows = await sTx.store.getAll();
    await sTx.done;

    if (!stagedRows || stagedRows.length === 0) return;

    // 2. Per-row integrity verification (A-01): recompute recordHash(row.record)
    for (const row of stagedRows) {
      if (!row.deleted && row.record) {
        const computed = await recordHash(row.record);
        if (computed !== row.record_hash) {
          throw new IntegrityError(
            `Staged row hash mismatch for ${row.key}: expected ${row.record_hash}, computed ${computed}`,
            "ROW_HASH_MISMATCH"
          );
        }
      }
    }

    // 3. Aggregate catalogue hash verification before commit (A-01, A-02, X-10)
    const hTx = db.transaction("catalog_hashes", "readonly");
    const existingHashes = await hTx.store.getAll();
    await hTx.done;

    // Merge staging on top of existing hashes in memory to simulate post-commit state
    const hashSimMap = new Map();
    for (const h of existingHashes) {
      const [retailer, productId] = h.key.split("|");
      hashSimMap.set(h.key, { retailer, product_id: productId, record_hash: h.hash });
    }
    for (const s of stagedRows) {
      if (s.deleted) {
        hashSimMap.delete(s.key);
      } else {
        hashSimMap.set(s.key, { retailer: s.retailer, product_id: s.product_id, record_hash: s.record_hash });
      }
    }

    const simulatedRows = Array.from(hashSimMap.values());
    const computedV2 = await computeCatalogHashFromRows(simulatedRows, { legacy: false });
    const computedLegacy = await computeCatalogHashFromRows(simulatedRows, { legacy: true });

    const expectedV2 = manifest.catalog_hash_v2;
    const expectedLegacy = manifest.catalog_hash;

    const matchedV2 = expectedV2 && computedV2 === expectedV2;
    const matchedLegacy =
      (expectedLegacy && computedLegacy === expectedLegacy) ||
      (expectedLegacy && computedV2 === expectedLegacy);

    if (!matchedV2 && !matchedLegacy) {
      throw new IntegrityError(
        `Catalog aggregate hash mismatch. Expected v2=${expectedV2 || 'none'} legacy=${expectedLegacy || 'none'}; computed v2=${computedV2} legacy=${computedLegacy}`,
        "AGGREGATE_HASH_MISMATCH"
      );
    }
  }

  async function verifyPremiumStaging(manifest, db) {
    const sTx = db.transaction("premium_staging", "readonly");
    const stagedRows = await sTx.store.getAll();
    await sTx.done;

    if (!stagedRows || stagedRows.length === 0) return;

    for (const row of stagedRows) {
      if (!row.deleted && row.assessments) {
        const computed = await recordHash(row.assessments);
        if (computed !== row.record_hash) {
          throw new IntegrityError(
            `Premium row hash mismatch for ${row.key}: expected ${row.record_hash}, computed ${computed}`,
            "ROW_HASH_MISMATCH"
          );
        }
      }
    }

    const simRows = stagedRows
      .filter(r => !r.deleted)
      .map(r => ({ retailer: r.retailer, product_id: r.product_id, record_hash: r.record_hash }));

    const computedV2 = await computeCatalogHashFromRows(simRows, { legacy: false });
    const computedLegacy = await computeCatalogHashFromRows(simRows, { legacy: true });

    const expectedV2 = manifest.premium_hash_v2;
    const expectedLegacy = manifest.premium_hash;

    const matchedV2 = expectedV2 && computedV2 === expectedV2;
    const matchedLegacy =
      (expectedLegacy && computedLegacy === expectedLegacy) ||
      (expectedLegacy && computedV2 === expectedLegacy);

    if (!matchedV2 && !matchedLegacy) {
      throw new IntegrityError(
        `Premium aggregate hash mismatch. Expected v2=${expectedV2 || 'none'} legacy=${expectedLegacy || 'none'}; computed v2=${computedV2} legacy=${computedLegacy}`,
        "AGGREGATE_HASH_MISMATCH"
      );
    }
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

      // 2b. Write NME index entries for this chunk (additive, DB v19, Blueprint §2.2)
      if (db.objectStoreNames.contains("nme_index") && typeof NutriScoreDB !== "undefined" && NutriScoreDB.buildNmeIndexForProduct) {
        const nmeTx = db.transaction("nme_index", "readwrite");
        for (const row of chunk) {
          const ret = (row.retailer || "").toUpperCase();
          if (row.deleted) {
            nmeTx.store.delete(`sku:${ret}:${row.product_id}`);
          } else if (row.record) {
            const entries = NutriScoreDB.buildNmeIndexForProduct(ret, row.record);
            for (const e of entries) {
              if (e.value?.is_blk) {
                const existing = await nmeTx.store.get(e.key);
                const ids = new Set(existing?.product_ids || []);
                ids.add(e.value.product_id);
                nmeTx.store.put({ key: e.key, product_ids: Array.from(ids) });
              } else {
                nmeTx.store.put(e);
              }
            }
          }
        }
        await nmeTx.done;
      }
    }

    if (!hasAny) return;

    // 3. Invalidate in-memory caches so the next lookup reads fresh data
    //    F-13: iterate RETAILER_REGISTRY cacheKeys — no per-retailer branches.
    if (typeof NutriScoreDB !== "undefined") {
      NutriScoreDB.productRecordLru?.clear();
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

  async function syncProducts(manifest, meta, db, supabase) {
    console.log(`[NutriCatalogSync] Pulling products into staging from seq ${meta.stagingCursor} to ${manifest.max_seq}`);
    await pullUpdates(supabase, "catalog_products", meta.stagingCursor, manifest.max_seq, "catalog_staging", db);

    // Verify BEFORE commit (A-01, A-02, Blueprint §2.6)
    try {
      await verifyStaging(manifest, db);
    } catch (err) {
      console.error("[NutriCatalogSync] Staging integrity verification failed. Discarding staging:", err.message);
      // Fail-closed: discard staging, preserve live stores
      const discardTx = db.transaction("catalog_staging", "readwrite");
      await discardTx.store.clear();
      await discardTx.done;

      meta.integrity_failure_count = (meta.integrity_failure_count || 0) + 1;
      meta.last_integrity_failure = {
        timestamp: new Date().toISOString(),
        error: err.message,
        code: err.code || "INTEGRITY_ERROR",
      };
      await NutriScoreDB.putCatalogMeta(meta);

      if (typeof self !== "undefined" && self.NutriObs?.count) {
        self.NutriObs.count("catalog_integrity_failure", 1, { code: err.code || "unknown" });
      }
      throw err;
    }

    // Commit only after verification passes
    await applyStaging(db);

    meta.cursor = manifest.max_seq;
    meta.stagingCursor = manifest.max_seq;
    if (manifest.release_seq !== undefined) {
      meta.max_release_seen = Math.max(meta.max_release_seen || 0, manifest.release_seq);
    }
    meta.updateRequired = false;
    meta.lastSyncAt = new Date().toISOString();
    await NutriScoreDB.putCatalogMeta(meta);
    console.log("[NutriCatalogSync] Product sync verified and committed.");
  }

  async function sync() {
    console.log("[NutriCatalogSync] Starting sync...");
    const db = await NutriScoreDB.getDB();
    // F-11: use the injected singleton client, not a freshly created one.
    const supabase = getSupabase();

    // Bypass stale memory cache in the background script to ensure requests are authenticated
    const local = await chrome.storage.local.get("nutri_oidc_session");
    if (local.nutri_oidc_session) {
      try {
        const parsed = JSON.parse(local.nutri_oidc_session);
        if (parsed?.access_token && parsed?.refresh_token) {
          await supabase.auth.setSession({
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
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
        console.warn("[NutriCatalogSync] Permission denied for catalog_releases in Supabase. User lacks CAD or verified entitlement. Skipping remote sync.");
        return;
      }
      console.warn("[NutriCatalogSync] Failed to fetch catalog release:", releaseErr?.message || releaseErr);
      return;
    }
    if (!releaseData) {
      console.warn("[NutriCatalogSync] No catalog release data returned.");
      return;
    }

    let meta = (await NutriScoreDB.getCatalogMeta()) || {
      retailer: "_catalog",
      version: "",
      maxSeq: 0,
      cursor: 0,
      stagingCursor: 0,
      lastSyncAt: "",
      disclaimer: "",
      updateRequired: true,
      premiumVersion: "",
      max_release_seen: 0,
      integrity_failure_count: 0,
    };

    // A-04 / Blueprint §2.6: Cadence check — skip if checked within last 6 hours unless forced or updateRequired
    const options = arguments[0] || {};
    const force = options.force === true;
    if (!force && meta.lastSyncAt && !meta.updateRequired) {
      const elapsedMs = Date.now() - Date.parse(meta.lastSyncAt);
      if (Number.isFinite(elapsedMs) && elapsedMs < 6 * 3600 * 1000) {
        console.log("[NutriCatalogSync] Sync skipped: catalog checked within last 6 hours.");
        return;
      }
    }

    // Verify manifest signature, issued_at, and anti-rollback release_seq (A-03, §2.6 #3)
    const manifest = await verifyManifest(releaseData, meta);

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
      meta.lastSyncAt = new Date().toISOString();
      await NutriScoreDB.putCatalogMeta(meta);
      return;
    }

    // 2. Stream products into staging & verify BEFORE commit (A-01, A-02, Blueprint §2.6)
    if (meta.updateRequired) {
      await syncProducts(manifest, meta, db, supabase);
    }

    // 3. Stream premium into staging & verify before atomic swap (Blueprint §2.6)
    if (needsPremiumSync) {
      console.log(`[NutriCatalogSync] Pulling premium into staging (seq 0→${manifest.max_seq})...`);
      await db.clear("premium_staging");
      await pullUpdates(supabase, "catalog_premium", 0, manifest.max_seq, "premium_staging", db);

      try {
        await verifyPremiumStaging(manifest, db);
      } catch (err) {
        await db.clear("premium_staging");
        console.error("[NutriCatalogSync] Premium integrity verification failed:", err.message);
        meta.integrity_failure_count = (meta.integrity_failure_count || 0) + 1;
        await NutriScoreDB.putCatalogMeta(meta);
        throw err;
      }

      const localPremHash = await computeLocalHash(db, "premium_staging");
      if (localPremHash !== manifest.premium_hash && localPremHash !== manifest.premium_hash_v2) {
        // Hash mismatch — discard staging, leave premium_assessments untouched
        await db.clear("premium_staging");
        throw new Error(`Premium hash mismatch. Expected ${manifest.premium_hash}, got ${localPremHash}`);
      }

      // Atomic swap
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
      await stagingStore.clear();
      await swapTx.done;

      meta.premiumVersion = manifest.version;
      meta.lastSyncAt = new Date().toISOString();
      await NutriScoreDB.putCatalogMeta(meta);
      console.log("[NutriCatalogSync] Premium sync verified and committed (atomic swap).");
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
          premiumVersion: "",
          max_release_seen: 0,
          integrity_failure_count: 0,
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

        // Schedule periodic 6-hour alarm check if chrome.alarms is available (A-04)
        if (typeof chrome !== "undefined" && chrome.alarms?.create) {
          try {
            chrome.alarms.create("catalog-check", {
              periodInMinutes: 360, // 6 hours
              delayInMinutes: Math.floor(Math.random() * 30), // 0-30m jitter
            });
          } catch (_e) {}
        }

        const meta = await NutriScoreDB.getCatalogMeta();
        // If meta exists and has lastSyncAt within 6 hours, do NOT sync on worker wake (A-04)
        if (meta?.lastSyncAt && !meta?.updateRequired) {
          const elapsed = Date.now() - Date.parse(meta.lastSyncAt);
          if (Number.isFinite(elapsed) && elapsed < 6 * 3600 * 1000) {
            return;
          }
        }

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

  return {
    init,
    ensureReady,
    sync,
    seedFallbackIfEmpty,
    verifyManifest,
    verifyStaging,
    verifyPremiumStaging,
    recordHash,
    codeUnitCompare,
    computeCatalogHashFromRows,
    IntegrityError,
  };
})();
