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

// Grading & Unified Item Evaluation
export type {
  GradeResult,
  EvalStatus,
  ItemEvaluation,
  NutrientVector,
  PolicyDecision,
  PolicyTrigger,
} from "./db/grading";
export {
  SALT_TO_SODIUM_FACTOR_MG_PER_G,
  PLAUSIBILITY_BOUNDS,
  NUTRITION_CATEGORY_TO_FSA,
  resolveDisplayCategory,
  computeGradeFromProduct,
  interpretProduct,
  canonicalise,
  gateNutrients,
  evaluatePolicy,
  evaluateItem,
  clearEvaluationCache,
  isScoringV5Enabled,
  isPolicyV2Enabled,
} from "./db/grading";

// Product resolution
export type {
  RetailerCode,
  Observation,
  Resolution,
} from "./db/product-resolution";
export {
  resolveProductMatch,
  resolveBatch,
  getAllProducts,
  normalizeProductName,
  buildNmeIndexForProduct,
  rebuildNmeIndex,
  productRecordLru,
  isNmeV2Enabled,
  extractSize,
  extractBrand,
  extractUrlSlug,
  getSizeBucket,
  computeTokenSetSimilarity,
  memCache,
  normalizedIndexCache,
  lowerIndexCache,
} from "./db/product-resolution";

// Cart & Ledger v2
export type { LedgerRow, CartItemInput } from "./db/cart";
export {
  logCartEvent,
  getAllEntries,
  getAllLedgerRows,
  syncCart,
  applyCartSnapshot,
  dedupeActiveCartItems,
  deleteLedgerEntry,
  purgeLedgerOlderThan,
  getEntriesSince,
  savePendingCartSync,
  clearPendingCartSync,
  getPendingCartSyncs,
  isLedgerV2Enabled,
  getNextClientSeq,
  getOrCreateCartEpisodeId,
  normalizeLedgerRow,
  computeCartCoverage,
  _consecutiveAbsentMap,
  resetConsecutiveAbsentTracker,
  getRetentionCutoff,
} from "./db/cart";

// Analytics
export {
  resolveTimeframe,
  calculateAnalytics,
} from "./db/analytics";

// Telemetry Client (WP-12, Blueprint §2.8)
export type {
  TelemetryEventType,
  TelemetryStatus,
  TelemetryEvent,
  QueuedTelemetryRecord,
  EnqueueOptions,
  FlushResult,
} from "./db/telemetry";
export {
  generateUlid,
  enqueueTelemetryEvent,
  flushTelemetryQueue,
  purgeTelemetryQueue,
  pruneDeadLetters,
  computeBatchIdempotencyKey,
  isTelemetryV2Enabled,
  getGatewayUrl,
  resetTelemetryCounters,
  telemetryDroppedCount,
  telemetryEnqueuedCount,
  telemetryAckedCount,
  QUEUE_MAX_EVENTS,
  QUEUE_MAX_BYTES,
  BATCH_MAX_EVENTS,
  BATCH_MAX_BYTES,
  FLUSH_TIMEOUT_MS,
  RATE_LIMIT_PER_SEC,
  DEAD_LETTER_RETENTION_MS,
} from "./db/telemetry";
