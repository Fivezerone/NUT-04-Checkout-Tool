import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trash2, Settings2, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { ChartBox } from "./ChartBox";
import { DonutChart, LineTrend, StackedHBarChart, type StackedHBar } from "./charts/Charts";
import { ChromeExtensionStorage, ExtensionStorage } from "../../services/storage";
import {
  getAllEntries,
  purgeAll,
  getSettings,
  saveSettings,
  deleteLedgerEntry,
  DEFAULT_SETTINGS,
  type Settings,
  calculateAnalytics,
  resolveTimeframe,
} from "../lib/db";
import { MultiLayerStorage } from "../../../../shared/storage";

import {
  GRADE_LABEL,
  GRADE_ORDER,
  gradeColorVar,
  type ShoppingLedgerRow,
  type DashboardViewModel,
  type Grade,
} from "../lib/nutriscore";
import { useTheme } from "../context/ThemeContext";
import { GradeBadge, KpiCard, TargetMeter, ConfirmDialog, ConditionChip } from "./ui";

interface DashboardProps {
  onBack: () => void;
}

const LEDGER_PAGE_SIZE = 50;

const RetailerBadge = React.memo(({ retailer }: { retailer: string }) => {
  const r = (retailer || "").toUpperCase();
  if (r === "QUICKMART") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-xs border bg-red-50 text-red-700 border-red-200">
        <span className="size-1.5 rounded-full bg-red-600 inline-block" />
        Quickmart
      </span>
    );
  }
  if (r === "CARREFOUR") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-xs border bg-blue-50 text-blue-700 border-blue-200">
        <span className="size-1.5 rounded-full bg-blue-600 inline-block" />
        Carrefour
      </span>
    );
  }
  if (r === "NAIVAS") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-xs border bg-emerald-50 text-emerald-700 border-emerald-200">
        <span className="size-1.5 rounded-full bg-emerald-600 inline-block" />
        Naivas
      </span>
    );
  }
  return <span className="text-[color:var(--t-color-text-muted)] text-xs">{retailer}</span>;
});

type Range = "today" | "week" | "month" | "3months";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "3months", label: "Past 3 Months" },
];

type RetailerFilter = "all" | "NAIVAS" | "CARREFOUR" | "QUICKMART";

const RETAILER_OPTIONS: { value: RetailerFilter; label: string; color?: string }[] = [
  { value: "all", label: "All Retailers" },
  { value: "NAIVAS", label: "Naivas", color: "#00843D" },
  { value: "CARREFOUR", label: "Carrefour", color: "#004e9a" },
  { value: "QUICKMART", label: "Quickmart", color: "#ee3434" },
];

export function Dashboard({ onBack }: DashboardProps) {
  const [entries, setEntries] = useState<ShoppingLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("month");
  const [retailerFilter, setRetailerFilter] = useState<RetailerFilter>("all");
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [showDetailedInsights, setShowDetailedInsights] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [userData, setUserData] = useState<Partial<ChromeExtensionStorage> | null>(null);

  const [sortField, setSortField] = useState<keyof ShoppingLedgerRow>("addedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [ledgerVisible, setLedgerVisible] = useState(LEDGER_PAGE_SIZE);

  const { activeTheme } = useTheme();
  const basketRef = useRef<HTMLElement>(null);

  /** Single-select condition setter — syncs activeTheme across storage layers */
  function selectCondition(condition: "diabetes" | "hypertension" | "kidney" | "obesity" | "general") {
    const next: Settings = {
      ...settings,
      diabetes: condition === "diabetes",
      hypertension: condition === "hypertension",
      kidney: condition === "kidney",
      obesity: condition === "obesity",
      activeTheme: condition,
      condition: condition,
    };
    setSettings(next);
    saveSettings(next).catch(console.warn);
    MultiLayerStorage.updateDraft({ uiTheme: condition }).then(() => {
      MultiLayerStorage.commitDraftToLive();
    });
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ uiTheme: condition }).catch(() => {});
      ExtensionStorage.updatePreferences({
        healthMode: condition !== "general",
        selectedTags: [condition, settings.primaryMetric || "Sugar"].filter(Boolean)
      }).catch(() => {});
    }
  }

  const handleSort = (field: keyof ShoppingLedgerRow) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  async function load(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const [all, s, storageData] = await Promise.all([
        getAllEntries(),
        getSettings(),
        MultiLayerStorage.getLive(),
      ]);
      setEntries(all);
      setSettings(s);
      setUserData(storageData as any);
    } catch (err) {
      console.error("[NutriScore] Dashboard load() failed:", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function handleDeleteEntry(id: string) {
    await deleteLedgerEntry(id);
    await load(false);
    toast.success("Item removed from ledger");
  }

  async function confirmErase() {
    await purgeAll();
    await load();
    setSelectedGrade(null);
    setShowDeleteConfirm(false);
    toast.success("All your local shopping data has been deleted");
  }

  useEffect(() => {
    load();
    const handleMessage = (msg: any) => {
      if (msg.action === "CART_UPDATED") {
        load();
      }
    };
    const unsubscribeLive = MultiLayerStorage.subscribeLive((newLive) => {
      if (newLive) {
        setUserData(newLive as any);
      }
    });

    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
      return () => {
        chrome.runtime.onMessage.removeListener(handleMessage);
        unsubscribeLive();
      };
    } else {
      return unsubscribeLive;
    }
  }, []);

  const filtered = useMemo(() => {
    const tf = resolveTimeframe(range);
    const start = tf.windowStart;
    return entries.filter((e) => {
      const inTime = e.addedAt >= start;
      const inRetailer = retailerFilter === "all" || (e.retailer && e.retailer.toUpperCase() === retailerFilter);
      return inTime && inRetailer;
    });
  }, [entries, range, retailerFilter]);

  const analytics = useMemo<DashboardViewModel | null>(() => {
    if (!entries.length) return null;
    const tf = resolveTimeframe(range);
    return calculateAnalytics(filtered, entries.length, tf);
  }, [filtered, entries.length, range]);

  const basketData = useMemo(() => {
    if (!analytics) return [];
    return GRADE_ORDER.map((g) => ({ grade: g, value: analytics.basketQuality.distribution[g] || 0 }));
  }, [analytics]);

  const totalRated = useMemo(() => {
    if (!analytics) return 0;
    const dist = analytics.basketQuality.distribution;
    return (dist.A || 0) + (dist.B || 0) + (dist.C || 0) + (dist.D || 0) + (dist.E || 0);
  }, [analytics]);

  const goodCount = useMemo(() => {
    if (!analytics) return 0;
    const dist = analytics.basketQuality.distribution;
    return (dist.A || 0) + (dist.B || 0) + (dist.C || 0);
  }, [analytics]);

  const qualityPct = totalRated > 0 ? Math.round((goodCount / totalRated) * 100) : 0;
  const typicalGrade = (analytics?.basketQuality.averageGrade || "C") as Grade;

  const alertCounts = analytics?.healthAlerts || { diabetes: 0, hypertension: 0, cvd: 0, kidney: 0, obesity: 0 };
  const totalAlerts = alertCounts.diabetes + alertCounts.hypertension + alertCounts.cvd + alertCounts.kidney + alertCounts.obesity;

  // Nutrient adherence percentages across filtered items with nutrition info
  const nutrientAdherence = useMemo(() => {
    let sodiumOk = 0;
    let sugarOk = 0;
    let satFatOk = 0;
    let totalWithData = 0;

    for (const item of filtered) {
      const snap = item.nutritionSnapshot;
      const sod = snap?.sodiumMg ?? (item as any).sodiumMg ?? null;
      const sug = snap?.sugarsG ?? (item as any).sugarsG ?? null;
      const sat = snap?.satFatG ?? (item as any).satFatG ?? null;

      if (sod !== null || sug !== null || sat !== null) {
        totalWithData++;
        // General Kenyan clinical guidance: sodium <= 600mg, sugar <= 10g, satFat <= 5g per 100g
        if (sod !== null && sod <= 600) sodiumOk++;
        if (sug !== null && sug <= 10) sugarOk++;
        if (sat !== null && sat <= 5) satFatOk++;
      }
    }

    return {
      total: totalWithData,
      sodiumPct: totalWithData > 0 ? Math.round((sodiumOk / totalWithData) * 100) : 100,
      sugarPct: totalWithData > 0 ? Math.round((sugarOk / totalWithData) * 100) : 100,
      satFatPct: totalWithData > 0 ? Math.round((satFatOk / totalWithData) * 100) : 100,
    };
  }, [filtered]);

  const trendData = useMemo(() => {
    const raw = analytics?.nutrientTrends.data || [];
    const firstNonZero = raw.findIndex(
      (d) => (d.sodiumMg ?? 0) > 0 || (d.sugarsG ?? 0) > 0 || (d.satFatG ?? 0) > 0
    );
    const sliced = firstNonZero <= 0 ? raw : raw.slice(firstNonZero);

    const tickMap = new Map(
      (analytics?.nutrientTrends.ticks || []).map((t) => [t.ts, t.label])
    );

    return sliced.map((d, i) => {
      const dDate = new Date(d.ts);
      const label = tickMap.get(d.ts) || `${dDate.getDate()} ${dDate.toLocaleString("default", { month: "short" })}`;
      return {
        id: `bucket-${d.ts || i}`,
        ts: d.ts,
        label,
        sodium: d.sodiumMg ?? 0,
        sugar: d.sugarsG ?? 0,
        satFat: d.satFatG ?? 0,
        hasData: d.sodiumMg !== null || d.sugarsG !== null || d.satFatG !== null,
      };
    });
  }, [analytics]);

  const drillDownFiltered = useMemo(() => {
    if (!selectedGrade) return filtered;
    return filtered.filter((e) => e.gradeSnapshot === selectedGrade);
  }, [filtered, selectedGrade]);

  const categoryData = useMemo((): StackedHBar[] => {
    if (drillDownFiltered.length === 0) return [];
    const VALID_GRADES = new Set(["A", "B", "C", "D", "E"]);
    const GRADE_COLORS: Record<string, string> = {
      A: "var(--ns-grade-a)",
      B: "var(--ns-grade-b)",
      C: "var(--ns-grade-c)",
      D: "var(--ns-grade-d)",
      E: "var(--ns-grade-e)",
    };
    const GRADE_ORDER_LOCAL = ["A", "B", "C", "D", "E"];
    const catMap: Record<string, Record<string, { spend: number; count: number }>> = {};

    for (const row of drillDownFiltered) {
      const price = row.priceSnapshot ?? 0;
      const grade = (row.gradeSnapshot || (row as any).grade || "").toUpperCase();
      if (price <= 0 || !VALID_GRADES.has(grade)) continue;

      const cat = row.category && row.category !== "Uncategorized" ? row.category : "Other";
      if (!catMap[cat]) catMap[cat] = {};
      if (!catMap[cat][grade]) catMap[cat][grade] = { spend: 0, count: 0 };
      catMap[cat][grade].spend += price;
      catMap[cat][grade].count += 1;
    }

    return Object.entries(catMap)
      .map(([category, gradeMap]) => {
        const segments = GRADE_ORDER_LOCAL
          .filter((g) => (gradeMap[g]?.spend ?? 0) > 0)
          .map((g) => ({
            grade: g,
            price: Math.round(gradeMap[g].spend),
            color: GRADE_COLORS[g],
          }));

        if (segments.length === 0) return null;
        const totalPrice = segments.reduce((s, seg) => s + seg.price, 0);
        const totalItems = GRADE_ORDER_LOCAL.reduce((s, g) => s + (gradeMap[g]?.count ?? 0), 0);
        const label = `${category} (${totalItems})`;

        return { id: category, label, totalPrice, segments };
      })
      .filter((d): d is StackedHBar => d !== null)
      .sort((a, b) => b.totalPrice - a.totalPrice)
      .slice(0, 7);
  }, [drillDownFiltered]);

  const sortedFiltered = useMemo(() => {
    const arr = [...drillDownFiltered];
    arr.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (sortField === ("gradeSnapshot" as any)) {
        valA = a.gradeSnapshot || (a as any).grade;
        valB = b.gradeSnapshot || (b as any).grade;
      }
      if (valA == null) valA = "";
      if (valB == null) valB = "";
      let cmp = 0;
      if (valA < valB) cmp = -1;
      if (valA > valB) cmp = 1;
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [drillDownFiltered, sortField, sortOrder]);

  const clinicName = userData?.tenant_name || "Primary Care Clinical Unit";

  return (
    <div className="min-h-full bg-[color:var(--t-color-canvas)] text-[color:var(--t-color-text-strong)]" data-surface="shopper">
      {/* Shopper Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] px-4 py-3.5 shadow-sm sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to store"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--t-color-border-subtle)] text-[color:var(--t-color-text-muted)] hover:bg-[color:var(--t-color-surface-subtle)] hover:text-[color:var(--t-color-text-strong)] transition-colors"
          >
            <ArrowLeft size={18} aria-hidden />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-[color:var(--t-color-text-strong)]">
                Shopping Analytics
              </h1>
              <ConditionChip condition={activeTheme} />
            </div>
            <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">
              Care clinic: <span className="font-medium text-[color:var(--t-color-text)]">{clinicName}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            aria-label="Open care settings"
            title="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--t-color-border-subtle)] text-[color:var(--t-color-text-muted)] hover:bg-[color:var(--t-color-surface-subtle)] hover:text-[color:var(--t-color-text-strong)] transition-colors"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="p-8 text-center text-sm text-[color:var(--t-color-text-muted)]">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--t-color-action-primary)] border-t-transparent" />
          <p className="mt-3">Loading your shopping insights…</p>
        </div>
      ) : (
        <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
          {/* Controls bar: 4-timeframe timeline selector & Retailer filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Timeline segmented buttons */}
            <div
              className="inline-flex flex-wrap gap-1 rounded-xl bg-[color:var(--t-color-surface)] p-1 border border-[color:var(--t-color-border-subtle)] shadow-xs"
              role="tablist"
              aria-label="Filter shopping history timeframe"
            >
              {RANGE_OPTIONS.map((opt) => {
                const active = range === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setRange(opt.value)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      active
                        ? "bg-[color:var(--t-color-action-primary)] text-white shadow-xs"
                        : "text-[color:var(--t-color-text-muted)] hover:text-[color:var(--t-color-text-strong)] hover:bg-[color:var(--t-color-surface-subtle)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Retailer filter pills */}
            <div
              className="inline-flex flex-wrap gap-1 rounded-xl bg-[color:var(--t-color-surface)] p-1 border border-[color:var(--t-color-border-subtle)] shadow-xs"
              role="group"
              aria-label="Filter by retailer"
            >
              {RETAILER_OPTIONS.map((opt) => {
                const active = retailerFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRetailerFilter(opt.value)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                      active
                        ? "bg-[color:var(--t-color-surface-subtle)] text-[color:var(--t-color-text-strong)] ring-1 ring-[color:var(--t-color-border-control)]"
                        : "text-[color:var(--t-color-text-muted)] hover:text-[color:var(--t-color-text-strong)]"
                    }`}
                  >
                    {opt.color && (
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: opt.color }}
                        aria-hidden
                      />
                    )}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Retention notice on 3-month view */}
          {range === "3months" && (
            <div className="rounded-xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] px-4 py-2.5 text-xs text-[color:var(--t-color-text-muted)] shadow-xs">
              Showing your last 3 months. Older shopping history is removed automatically to preserve your privacy and device storage.
            </div>
          )}

          {/* Hero Inverted Pyramid: Hero Quality + 3 Supporting KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              variant="hero"
              label="Basket Quality"
              value={totalRated > 0 ? `${qualityPct}%` : "—"}
              unit={totalRated > 0 ? "rated A–C" : ""}
              subtitle={totalRated > 0 ? `Grade ${typicalGrade} typical` : "No graded purchases"}
              tone="mint"
            />
            <KpiCard
              label="Items Chosen"
              value={filtered.length > 0 ? `${filtered.length}` : "0"}
              unit="items"
              subtitle={totalRated > 0 ? `${totalRated} of ${filtered.length} graded` : "Waiting for items"}
              tone="neutral"
            />
            <KpiCard
              label="Health Heads-ups"
              value={`${totalAlerts}`}
              unit="flags"
              subtitle={totalAlerts > 0 ? "Crossed recommended limits" : "Within planned thresholds"}
              tone={totalAlerts > 0 ? "coral" : "mint"}
              direction={totalAlerts === 0 ? "favorable" : "unfavorable"}
            />
            <KpiCard
              label="Nutri-Score A/B"
              value={`${goodCount}`}
              unit="items"
              subtitle={goodCount > 0 ? "Everyday healthy choices" : "Explore better swaps below"}
              tone="mint"
              direction="favorable"
            />
          </div>

          {/* Clinician Target Meters: Adherence to Nutrition Goals */}
          <section className="rounded-2xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[color:var(--t-color-border-subtle)] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[color:var(--t-color-text-strong)] flex items-center gap-2">
                  <Sparkles size={16} className="text-[color:var(--t-color-action-primary)]" />
                  <span>Your Care Targets & Threshold Adherence</span>
                </h2>
                <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">
                  Proportion of cart items meeting your primary care dietary guidelines
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDetailedInsights((v) => !v)}
                className="text-xs font-semibold text-[color:var(--t-color-action-primary)] hover:underline self-start sm:self-auto"
              >
                {showDetailedInsights ? "Hide Detailed Charts" : "Show Detailed Charts"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
              <TargetMeter
                label="Sodium (Salt) Adherence"
                current={nutrientAdherence.sodiumPct}
                max={100}
                unit="%"
                helperText="≤ 600mg per 100g of food"
              />
              <TargetMeter
                label="Free Sugars Adherence"
                current={nutrientAdherence.sugarPct}
                max={100}
                unit="%"
                helperText="≤ 10g per 100g of food"
              />
              <TargetMeter
                label="Saturated Fat Adherence"
                current={nutrientAdherence.satFatPct}
                max={100}
                unit="%"
                helperText="≤ 5g per 100g of food"
              />
            </div>
          </section>

          {/* Detailed Charts (Donut + Trend + Categories) */}
          {showDetailedInsights && (
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Basket Quality Distribution */}
              <section
                ref={basketRef}
                className="rounded-2xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] p-4 shadow-xs flex flex-col"
              >
                <div className="border-b border-[color:var(--t-color-border-subtle)] pb-2">
                  <h3 className="font-bold text-sm text-[color:var(--t-color-text-strong)]">Nutri-Score Distribution</h3>
                  <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">
                    {selectedGrade
                      ? `Grade ${selectedGrade}: ${basketData.find((d) => d.grade === selectedGrade)?.value ?? 0} items (tap to clear)`
                      : "Tap a grade slice to filter the ledger"}
                  </p>
                </div>
                <div className="p-2 flex-1">
                  <ChartBox height={190}>
                    {(size) => (
                      <DonutChart
                        size={size}
                        selectedId={selectedGrade}
                        onSelect={(id) => setSelectedGrade((cur) => (cur === id ? null : id))}
                        data={basketData.map((d) => ({
                          id: d.grade,
                          label: `Grade ${d.grade}`,
                          value: d.value,
                          color: gradeColorVar(d.grade),
                        }))}
                      />
                    )}
                  </ChartBox>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    {basketData.map((d) => {
                      const active = selectedGrade === d.grade;
                      return (
                        <button
                          key={d.grade}
                          type="button"
                          onClick={() => setSelectedGrade((cur) => (cur === d.grade ? null : d.grade))}
                          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors ${
                            active
                              ? "ring-2 ring-[color:var(--t-color-action-primary)] bg-[color:var(--t-color-surface-subtle)] font-bold"
                              : "hover:bg-[color:var(--t-color-surface-subtle)] text-[color:var(--t-color-text-muted)]"
                          }`}
                        >
                          <GradeBadge grade={d.grade as Grade} size="sm" />
                          <span>{d.value}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Nutrient Trends */}
              <section className="rounded-2xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] p-4 shadow-xs lg:col-span-2 flex flex-col">
                <div className="border-b border-[color:var(--t-color-border-subtle)] pb-2">
                  <h3 className="font-bold text-sm text-[color:var(--t-color-text-strong)]">Nutrient Trends</h3>
                  <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">
                    Average intake levels across {RANGE_OPTIONS.find((o) => o.value === range)?.label.toLowerCase()}
                  </p>
                </div>
                <div className="p-2 flex-1">
                  <ChartBox height={216}>
                    {(size) => (
                      <LineTrend
                        size={size}
                        data={trendData}
                        showSodium={["hypertension", "kidney", "general"].includes(activeTheme)}
                        showSugar={["diabetes", "obesity", "general"].includes(activeTheme)}
                        showSatFat={["obesity", "general"].includes(activeTheme)}
                        primaryKey={["diabetes", "obesity"].includes(activeTheme) ? "sugar" : "sodium"}
                      />
                    )}
                  </ChartBox>
                </div>
              </section>
            </div>
          )}

          {/* Category insights */}
          {showDetailedInsights && categoryData.length > 0 && (
            <section className="rounded-2xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] p-4 shadow-xs">
              <div className="border-b border-[color:var(--t-color-border-subtle)] pb-2">
                <h3 className="font-bold text-sm text-[color:var(--t-color-text-strong)]">Category Spend & Quality</h3>
                <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">
                  Spend breakdown by category with Nutri-Score grade distribution
                </p>
              </div>
              <div className="p-2">
                <ChartBox height={Math.max(160, 52 * categoryData.length + 36)}>
                  {(size) => <StackedHBarChart size={size} data={categoryData} />}
                </ChartBox>
              </div>
            </section>
          )}

          {/* Shopper Ledger Table: Responsive, Zero-Truncation Contract */}
          <section className="rounded-2xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] shadow-xs overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[color:var(--t-color-border-subtle)] px-5 py-4 bg-[color:var(--t-color-surface)]">
              <div>
                <h3 className="font-bold text-base text-[color:var(--t-color-text-strong)]">Purchase & Basket History</h3>
                <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">
                  {selectedGrade ? `Filtered to Grade ${selectedGrade} · ` : ""}
                  Showing {Math.min(sortedFiltered.length, ledgerVisible)} of {sortedFiltered.length} items
                </p>
              </div>
              {sortedFiltered.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 font-semibold self-start sm:self-auto"
                >
                  <Trash2 size={14} />
                  <span>Clear All Shopping Data</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" role="table">
                <thead className="bg-[color:var(--t-color-surface-subtle)] border-b border-[color:var(--t-color-border-subtle)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-xs text-[color:var(--t-color-text-muted)] uppercase tracking-wider">
                      <button
                        type="button"
                        onClick={() => handleSort("addedAt")}
                        className="inline-flex items-center gap-1 hover:text-[color:var(--t-color-text-strong)]"
                        aria-sort={sortField === "addedAt" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                      >
                        Date {sortField === "addedAt" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold text-xs text-[color:var(--t-color-text-muted)] uppercase tracking-wider min-w-[200px]">
                      <button
                        type="button"
                        onClick={() => handleSort("name")}
                        className="inline-flex items-center gap-1 hover:text-[color:var(--t-color-text-strong)]"
                        aria-sort={sortField === "name" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                      >
                        Product {sortField === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold text-xs text-[color:var(--t-color-text-muted)] uppercase tracking-wider">
                      Retailer
                    </th>
                    <th className="px-4 py-3 font-semibold text-xs text-[color:var(--t-color-text-muted)] uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-4 py-3 font-semibold text-xs text-[color:var(--t-color-text-muted)] uppercase tracking-wider text-right">
                      Price
                    </th>
                    <th className="px-4 py-3 font-semibold text-xs text-[color:var(--t-color-text-muted)] uppercase tracking-wider text-center">
                      Grade
                    </th>
                    <th className="px-4 py-3 font-semibold text-xs text-[color:var(--t-color-text-muted)] uppercase tracking-wider text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--t-color-border-subtle)]">
                  {sortedFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-[color:var(--t-color-text-muted)]">
                        No shopping records found for this period. Add items at checkout to start tracking nutrition.
                      </td>
                    </tr>
                  ) : (
                    sortedFiltered.slice(0, ledgerVisible).map((item) => {
                      const grade = (item.gradeSnapshot || (item as any).grade || "C") as Grade;
                      const dateStr = new Date(item.addedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                      return (
                        <tr
                          key={item.id}
                          className="hover:bg-[color:var(--t-color-surface-subtle)] transition-colors"
                        >
                          <td className="px-4 py-3 text-xs text-[color:var(--t-color-text-muted)] whitespace-nowrap">
                            {dateStr}
                          </td>
                          <td className="px-4 py-3 font-medium text-[color:var(--t-color-text-strong)] text-sm max-w-xs break-words">
                            {item.name}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <RetailerBadge retailer={item.retailer} />
                          </td>
                          <td className="px-4 py-3 text-xs text-[color:var(--t-color-text-muted)] whitespace-nowrap">
                            {item.category || "General Grocery"}
                          </td>
                          <td className="px-4 py-3 text-xs text-[color:var(--t-color-text-strong)] font-semibold text-right whitespace-nowrap">
                            {item.priceSnapshot !== null
                              ? `KES ${Number(item.priceSnapshot).toLocaleString("en-KE", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <GradeBadge grade={grade} size="sm" />
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(item.id)}
                              className="text-[color:var(--t-color-text-muted)] hover:text-rose-600 transition-colors p-1"
                              title="Delete item"
                              aria-label={`Delete ${item.name}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {ledgerVisible < sortedFiltered.length && (
              <div className="flex justify-center border-t border-[color:var(--t-color-border-subtle)] p-3 bg-[color:var(--t-color-surface)]">
                <button
                  type="button"
                  onClick={() => setLedgerVisible((v) => v + LEDGER_PAGE_SIZE)}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-[color:var(--t-color-action-primary)] hover:bg-[color:var(--t-color-surface-subtle)] transition-colors"
                >
                  Show more ({sortedFiltered.length - ledgerVisible} remaining)
                </button>
              </div>
            )}
          </section>
        </main>
      )}

      {/* Accessible Typed-Confirmation Dialog for Purge */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete All Shopping Data?"
        description="This will permanently delete all shopping records and nutrition history stored in your browser. This action cannot be undone. Type DELETE to confirm."
        confirmLabel="Delete Everything"
        variant="danger"
        expectedPhrase="DELETE"
        onConfirm={confirmErase}
        onClose={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
export default Dashboard;
