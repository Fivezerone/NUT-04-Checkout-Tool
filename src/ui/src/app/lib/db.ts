/**
 * db.ts — Thin barrel re-exporting from the db/ sub-modules.
 *
 * This file is the single esbuild entry-point used by scripts/build-db.mjs.
 * All business logic lives in the sub-modules; this barrel must stay free of
 * top-level side effects so tree-shaking works correctly.
 *
 * Sub-module layout (SMELL-002 refactor):
 *   db/shared.ts            — IndexedDB schema + getDB() factory
 *   db/settings.ts          — User settings, premium token verification, dataset import
 *   db/grading.ts           — FSA-NPS grade computation + product interpretation
 *   db/product-resolution.ts— Product lookup, name normalisation, in-memory cache
 *   db/cart.ts              — Cart event logging, sync, de-dupe, pending-sync helpers
 *   db/analytics.ts         — Timeframe resolution, bucket-slot generation, nutrient trends
 */

// Shared
export { getDB } from "./db/shared";

// Settings + cache management
export type { Settings } from "./db/settings";
export {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  updateSettings,
  getCachedProduct,
  evictStaleCacheEntries,
  purgeAll,
  saveProduct,
  savePrice,
  getPremiumAssessment,
  getCatalogMeta,
  putCatalogMeta,
} from "./db/settings";

// Grading
export type { GradeResult } from "./db/grading";
export {
  NUTRITION_CATEGORY_TO_FSA,
  resolveDisplayCategory,
  computeGradeFromProduct,
  interpretProduct,
} from "./db/grading";

// Product resolution
export {
  resolveProductMatch,
  getAllProducts,
  normalizeProductName,
  memCache,
  normalizedIndexCache,
  lowerIndexCache,
} from "./db/product-resolution";

// Cart
export {
  logCartEvent,
  getAllEntries,
  syncCart,
  deleteLedgerEntry,
  savePendingCartSync,
  clearPendingCartSync,
  getPendingCartSyncs,
} from "./db/cart";

// Analytics
export {
  resolveTimeframe,
  calculateAnalytics,
} from "./db/analytics";
