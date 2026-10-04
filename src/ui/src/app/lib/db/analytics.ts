/**
 * db/analytics.ts
 *
 * Shopping ledger analytics: timeframe resolution, bucket-slot generation,
 * nutrient-trend bucketing and health-alert counting.
 * Extracted from db.ts (SMELL-002 refactor).
 */
import type { Grade } from "../nutriscore";

// Removed MEDICAL_THRESHOLDS (moved entirely to publish pipeline/disease-engine).

export function resolveTimeframe(timeframeKey: string, now = Date.now()) {
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
  } else if (timeframeKey === "all") {
    start.setFullYear(2020);
    bucketUnit = "month";
    bucketCount = 60;
  }

  const tickLabelFn = (ts: number) => {
    const d = new Date(ts);
    if (bucketUnit === "hour") return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (bucketUnit === "day") return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (bucketUnit === "month") return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
    return d.toLocaleDateString([], { year: 'numeric' });
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

function generateBucketSlots(tf: any): { key: string; ts: number; label: string }[] {
  const { windowStart, windowEnd, bucketUnit, tickLabelFn } = tf;
  const slots: { key: string; ts: number; label: string }[] = [];
  const cursor = new Date(windowStart);

  if (bucketUnit === "hour") {
    cursor.setMinutes(0, 0, 0);
  } else if (bucketUnit === "day") {
    cursor.setHours(0, 0, 0, 0);
  } else if (bucketUnit === "week") {
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  } else if (bucketUnit === "month") {
    cursor.setDate(1); cursor.setHours(0, 0, 0, 0);
  } else {
    cursor.setMonth(Math.floor(cursor.getMonth() / 3) * 3, 1); cursor.setHours(0, 0, 0, 0);
  }

  let safety = 0;
  while (cursor.getTime() <= windowEnd && safety++ < 500) {
    const ts = cursor.getTime();
    slots.push({ key: `${bucketUnit}-${ts}`, ts, label: tickLabelFn(ts) });
    if (bucketUnit === "hour")    cursor.setHours(cursor.getHours() + 1);
    else if (bucketUnit === "day")    cursor.setDate(cursor.getDate() + 1);
    else if (bucketUnit === "week")   cursor.setDate(cursor.getDate() + 7);
    else if (bucketUnit === "month")  cursor.setMonth(cursor.getMonth() + 1);
    else                              cursor.setMonth(cursor.getMonth() + 3);
  }
  return slots;
}

function entryBucketKey(ts: number, bu: string): string {
  const d = new Date(ts);
  if (bu === "hour") {
    const s = new Date(d); s.setMinutes(0, 0, 0);
    return `hour-${s.getTime()}`;
  }
  if (bu === "day") {
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    return `day-${s.getTime()}`;
  }
  if (bu === "week") {
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return `week-${s.getTime()}`;
  }
  if (bu === "month")
    return `month-${new Date(d.getFullYear(), d.getMonth(), 1).getTime()}`;
  return `quarter-${new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime()}`;
}

const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D', 'E'];

function computeAverageGrade(counts: Record<string, number>): Grade | null {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const gradeValue: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };
  const weighted = GRADE_ORDER.reduce((sum, g) => sum + (gradeValue[g] as number) * (counts[g] || 0), 0);
  const avgValue = Math.round(weighted / total);
  return GRADE_ORDER[Math.min(Math.max(avgValue, 1), 5) - 1];
}

/** LOGIC-002: accumulator state shape shared across sub-steps */
type AccBucket = { sodium: number; nSodium: number; sugar: number; nSugar: number; satFat: number; nSatFat: number; n: number };
type RiskCounters = { diabetes: number; hypertension: number; kidney: number; obesity: number; cvd: number };
type AccMap = Record<string, AccBucket>;

/** Sub-step 1: basket quality grade distribution */
function recordBasketQuality(
  e: any,
  counts: Record<string, number>,
  gradePts: Record<string, number>,
  state: { ptsSum: number }
): void {
  const g = e.gradeSnapshot || e.grade;
  counts[g] = (counts[g] || 0) + 1;
  state.ptsSum += gradePts[g] || 0;
}

/** Sub-step 2: category spend insights */
function recordCategorySpend(
  e: any,
  categoryMap: Record<string, { price: number; n: number }>
): void {
  const rowPrice = e.priceSnapshot ?? 0;
  const rowGrade = e.gradeSnapshot || e.grade || "";
  if (rowPrice > 0 && rowGrade && rowGrade !== "UNKNOWN") {
    const m = categoryMap[e.category] ?? (categoryMap[e.category] = { price: 0, n: 0 });
    m.price += rowPrice;
    m.n += 1;
  }
}

/** Sub-step 3: disease risk counters (using premium riskFlags) */
function tallyDiseaseRiskCounters(
  riskFlags: any,
  risk: RiskCounters
): void {
  if (!riskFlags) return;
  if (riskFlags.diabetes) risk.diabetes++;
  if (riskFlags.hypertension) risk.hypertension++;
  if (riskFlags.renal) risk.kidney++;
  if (riskFlags.obesity) risk.obesity++;
  if (riskFlags.cvd) risk.cvd++;
}

/** Sub-step 4: per-bucket nutrient trend accumulation */
function recordNutrientTrendBucket(
  e: any,
  sugar: number | null,
  sodium: number | null,
  satFat: number | null,
  acc: AccMap,
  tf: any,
  state: { validCount: number; missingCount: number }
): void {
  const hasAny = sugar !== null || sodium !== null || satFat !== null;
  if (!hasAny) { state.missingCount++; return; }
  state.validCount++;
  const key = entryBucketKey(e.addedAt, tf.bucketUnit);
  if (!acc[key]) return;
  acc[key].n += 1;
  if (sodium !== null) { acc[key].sodium += Number(sodium); acc[key].nSodium += 1; }
  if (sugar  !== null) { acc[key].sugar  += Number(sugar);  acc[key].nSugar  += 1; }
  if (satFat !== null) { acc[key].satFat += Number(satFat); acc[key].nSatFat += 1; }
}

/**
 * LOGIC-002: Named accumulator — replaces the anonymous forEach arrow.
 * Each sub-step is independently testable and complexity-reportable.
 */
function accumulateLedgerEntry(
  e: any,
  counts: Record<string, number>,
  gradePts: Record<string, number>,
  ptsState: { ptsSum: number },
  categoryMap: Record<string, { price: number; n: number }>,
  risk: RiskCounters,
  acc: AccMap,
  tf: any,
  countState: { validCount: number; missingCount: number }
): void {
  recordBasketQuality(e, counts, gradePts, ptsState);
  recordCategorySpend(e, categoryMap);
  const sugar    = e.nutritionSnapshot?.sugarsG    ?? e.sugarsG    ?? null;
  const sodium   = e.nutritionSnapshot?.sodiumMg   ?? e.sodiumMg   ?? null;
  const satFat   = e.nutritionSnapshot?.satFatG    ?? e.satFatG    ?? null;
  
  tallyDiseaseRiskCounters(e.riskFlags, risk);
  recordNutrientTrendBucket(e, sugar, sodium, satFat, acc, tf, countState);
}

export function calculateAnalytics(filteredLedger: any[], totalStoredCount: number, tf: any) {
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const ptsState = { ptsSum: 0 };
  const gradePts: Record<string, number> = { A: 1, B: 3, C: 7, D: 12, E: 20 };
  const categoryMap: Record<string, { price: number; n: number }> = {};
  const risk: RiskCounters = { diabetes: 0, hypertension: 0, kidney: 0, obesity: 0, cvd: 0 };
  const slots = generateBucketSlots(tf);
  const acc: AccMap = {};
  for (const s of slots) acc[s.key] = { sodium: 0, nSodium: 0, sugar: 0, nSugar: 0, satFat: 0, nSatFat: 0, n: 0 };
  const countState = { validCount: 0, missingCount: 0 };

  for (const e of filteredLedger) {
    accumulateLedgerEntry(e, counts, gradePts, ptsState, categoryMap, risk, acc, tf, countState);
  }



  const categoryInsights = Object.entries(categoryMap)
    .map(([category, m]) => ({
      category,
      avgPrice: Math.round(m.price / m.n),
      count: m.n
    }))
    .sort((a, b) => b.avgPrice - a.avgPrice)
    .slice(0, 6);

  const trendData = slots.map((s) => {
    const b = acc[s.key];
    return {
      ts: s.ts,
      label: s.label,
      id: s.key,
      sodiumMg: b.nSodium > 0 ? Math.round(b.sodium / b.nSodium) : null,
      sugarsG:  b.nSugar  > 0 ? Math.round((b.sugar  / b.nSugar)  * 10) / 10 : null,
      satFatG:  b.nSatFat > 0 ? Math.round((b.satFat / b.nSatFat) * 10) / 10 : null,
      hasData: b.n > 0,
      sodium:  b.nSodium > 0 ? Math.round(b.sodium / b.nSodium) : 0,
      sugar:   b.nSugar  > 0 ? Math.round((b.sugar  / b.nSugar)  * 10) / 10 : 0,
      satFat:  b.nSatFat > 0 ? Math.round((b.satFat / b.nSatFat) * 10) / 10 : 0
    };
  });

  return {
    totalStoredEvents: totalStoredCount,
    filteredPeriodEvents: filteredLedger.length,
    basketQuality: {
      averageGrade: computeAverageGrade(counts) || "C",
      pts: ptsState.ptsSum,
      distribution: counts as any
    },
    categoryInsights,
    nutrientTrends: {
      windowStart: tf.windowStart,
      windowEnd: tf.windowEnd,
      ticks: slots.map(s => ({ ts: s.ts, label: s.label })),
      data: trendData as any,
      validCount: countState.validCount,
      missingCount: countState.missingCount,
    },
    healthAlerts: {
      diabetes: risk.diabetes,
      hypertension: risk.hypertension,
      kidney: risk.kidney,
      obesity: risk.obesity,
      cvd: risk.cvd,
    }
  };
}
