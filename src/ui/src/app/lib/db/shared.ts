/**
 * db/shared.ts
 *
 * Shared IndexedDB schema definition and singleton connection factory.
 * All sub-modules (cart, grading, product-resolution, analytics) import getDB() from here.
 * This file intentionally has no business logic — only infrastructure.
 *
 * Extracted from db.ts (SMELL-002 refactor).
 * DB_VERSION 13: thin-client catalog sync (P4 migration).
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ShoppingLedgerRow, DatasetMetadata } from "../nutriscore";

// Local-first storage. Nothing here is ever transmitted to an external server.
interface NutriDB extends DBSchema {
  shopping_ledger: {
    key: string;
    value: ShoppingLedgerRow;
    indexes: {
      "by-addedAt": number;
      "by-retailer-product-status": [string, string, string];
      "by-status": string;
    };
  };
  dataset_metadata: {
    key: string;
    value: DatasetMetadata;
  };
  user_settings: {
    key: string;
    value: any;
  };
  product_cache: {
    key: string;
    value: any;
  };
  price_cache: {
    key: string;
    value: number;
  };
  carrefourProducts: {
    key: string;
    value: any;
    indexes: { "by-url": string, "by-name": string };
  };
  naivasProducts: {
    key: string;
    value: any;
    indexes: { "by-url": string, "by-name": string };
  };
  pending_cart_syncs: {
    key: string;
    value: { id: string; retailer: string; items: any[]; savedAt: number };
  };
  /** v13: Staged catalog rows from server before they are atomically applied. */
  catalog_staging: {
    key: string; // "RETAILER|ProductID"
    value: { key: string; retailer: string; product_id: string; record: any; record_hash: string; deleted: boolean };
  };
  /** v13: Last-known record_hash per product, used to compute catalog_hash locally. */
  catalog_hashes: {
    key: string; // "RETAILER|ProductID"
    value: { key: string; hash: string };
  };
  /** v13: Pre-computed disease assessments for premium users. */
  premium_assessments: {
    key: string; // "RETAILER|ProductID"
    value: { key: string; retailer: string; product_id: string; assessments: Record<string, any> };
  };
}

const DB_NAME = "nut04-nutriscore";
export const DB_VERSION = 15;
export const SCORING_VERSION = "v4";

/**
 * Metadata stored in dataset_metadata under key "_catalog".
 * Replaces the per-retailer bundled-dataset metadata from v12.
 */
export interface CatalogMeta {
  retailer: "_catalog";
  version: string;       // manifest.version, e.g. "2026.09.28-001"
  maxSeq: number;
  cursor: number;        // last seq applied from catalog_products
  stagingCursor: number; // seq cursor for interrupted sync resumption
  lastSyncAt: string;    // ISO timestamp
  disclaimer: string;
  updateRequired: boolean;
  premiumVersion: string; // manifest.version when premium was last synced
}

let dbPromise: Promise<IDBPDatabase<NutriDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<NutriDB>(DB_NAME, DB_VERSION, {
      blocked(currentVersion, blockedVersion, _event) {
        console.warn(`[NutriScoreDB] IndexedDB upgrade to ${blockedVersion} is blocked by an older connection (v${currentVersion}). Close other extension tabs!`);
      },
      blocking(currentVersion, blockedVersion, _event) {
        console.warn(`[NutriScoreDB] IndexedDB connection (v${currentVersion}) is blocking a newer version (${blockedVersion}). Closing this connection.`);
        if (dbPromise) dbPromise.then(db => db.close());
      },
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("shopping_history" as any, { keyPath: "id" });
          (store as any).createIndex("by-viewedAt", "viewedAt");
        }
        if (oldVersion < 2) {
          db.createObjectStore("user_settings");
        }
        if (oldVersion < 3) {
          db.createObjectStore("product_cache");
          if (db.objectStoreNames.contains("ledger" as any)) {
            db.deleteObjectStore("ledger" as any);
          }
          if (db.objectStoreNames.contains("settings" as any)) {
            db.deleteObjectStore("settings" as any);
          }
        }
        if (oldVersion < 4) {
          const cStore = db.createObjectStore("carrefourProducts", { keyPath: "Identity.ProductID" });
          cStore.createIndex("by-url", "Identity.RetailerProductUrl");
          const nStore = db.createObjectStore("naivasProducts", { keyPath: "Identity.ProductID" });
          nStore.createIndex("by-url", "Identity.RetailerProductUrl");
        }
        if (oldVersion < 5) {
          const cStore = transaction.objectStore("carrefourProducts");
          cStore.createIndex("by-name", "Identity.ProductName");
          const nStore = transaction.objectStore("naivasProducts");
          nStore.createIndex("by-name", "Identity.ProductName");
        }
        if (oldVersion < 6) {
          if (db.objectStoreNames.contains("shopping_history" as any)) {
            db.deleteObjectStore("shopping_history" as any);
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
        if (oldVersion < 9) {
          if (db.objectStoreNames.contains("kfctReference" as any)) {
            db.deleteObjectStore("kfctReference" as any);
          }
        }
        // v11: Compound indexes on shopping_ledger replace O(n) full-table scans.
        if (oldVersion < 11) {
          const ledger = transaction.objectStore("shopping_ledger");
          ledger.createIndex("by-retailer-product-status", ["retailer", "productId", "status"]);
          ledger.createIndex("by-status", "status");
        }
        // v12: Durable pending-cart-sync store for SW-termination-resilient alarm retry.
        if (oldVersion < 12) {
          db.createObjectStore("pending_cart_syncs", { keyPath: "id" });
        }
        // v13: Thin-client catalog sync.
        // Clear legacy bundled-data stores and create catalog sync stores.
        if (oldVersion < 13) {
          // Clear legacy product stores (data will come from Supabase)
          if (db.objectStoreNames.contains("carrefourProducts")) {
            const s = transaction.objectStore("carrefourProducts");
            s.clear();
          }
          if (db.objectStoreNames.contains("naivasProducts")) {
            const s = transaction.objectStore("naivasProducts");
            s.clear();
          }
          if (db.objectStoreNames.contains("product_cache")) {
            transaction.objectStore("product_cache").clear();
          }
          // Clear bundled dataset_metadata — replaced by _catalog meta
          if (db.objectStoreNames.contains("dataset_metadata")) {
            transaction.objectStore("dataset_metadata").clear();
          }
          // New catalog sync stores
          db.createObjectStore("catalog_staging",    { keyPath: "key" });
          db.createObjectStore("catalog_hashes",     { keyPath: "key" });
          db.createObjectStore("premium_assessments", { keyPath: "key" });
        }
        // v14: Force a fresh catalog sync to populate naivasProducts / carrefourProducts.
        // The v13 sync wrote to catalog_hashes but not to the product lookup stores
        // (bug now fixed in applyStaging). Clear stale hashes + product stores and
        // reset the catalog meta so ensureReady() re-pulls everything.
        if (oldVersion < 14) {
          if (db.objectStoreNames.contains("catalog_hashes"))      transaction.objectStore("catalog_hashes").clear();
          if (db.objectStoreNames.contains("catalog_staging"))     transaction.objectStore("catalog_staging").clear();
          if (db.objectStoreNames.contains("naivasProducts"))      transaction.objectStore("naivasProducts").clear();
          if (db.objectStoreNames.contains("carrefourProducts"))   transaction.objectStore("carrefourProducts").clear();
          if (db.objectStoreNames.contains("dataset_metadata")) {
            // Reset updateRequired flag stored as _catalog row
            const metaStore = transaction.objectStore("dataset_metadata");
            metaStore.clear();
          }
        }
        // v15: Re-sync with fixed applyStaging (retailer case-sensitivity was "NAIVAS"/"CARREFOUR"
        // not "naivas"/"carrefour" — so v14 sync cleared stores but wrote 0 products).
        if (oldVersion < 15) {
          if (db.objectStoreNames.contains("catalog_hashes"))    transaction.objectStore("catalog_hashes").clear();
          if (db.objectStoreNames.contains("catalog_staging"))   transaction.objectStore("catalog_staging").clear();
          if (db.objectStoreNames.contains("naivasProducts"))    transaction.objectStore("naivasProducts").clear();
          if (db.objectStoreNames.contains("carrefourProducts")) transaction.objectStore("carrefourProducts").clear();
          if (db.objectStoreNames.contains("dataset_metadata"))  transaction.objectStore("dataset_metadata").clear();
        }
      },
    });
  }
  return dbPromise;
}
