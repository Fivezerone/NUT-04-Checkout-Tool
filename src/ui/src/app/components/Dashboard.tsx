import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trash2, Droplet, HeartPulse, Activity, UserCircle2, Check, ShieldAlert, Scale, Settings2 } from "lucide-react";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { ChartBox } from "./ChartBox";
import { DonutChart, LineTrend, HBarChart, StackedHBarChart, type StackedHBar } from "./charts/Charts";
import { ExtensionStorage, ChromeExtensionStorage } from "../../services/storage";
import { getAllEntries, purgeAll, getSettings, saveSettings, deleteLedgerEntry, DEFAULT_SETTINGS, type Settings } from "../lib/db";

import {
  GRADE_LABEL,
  GRADE_ORDER,
  gradeColorVar,
  type Grade,
  type ShoppingLedgerRow,
  type DashboardViewModel
} from "../lib/nutriscore";
import { useTheme } from "../context/ThemeContext";

interface DashboardProps {
  onBack: () => void;
}

const PAGE_SIZE = 8;

type Range = "today" | "week" | "month" | "year" | "all";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
  { value: "all", label: "All Time" },
];

// Start-of-period cutoff (ms) for a given range. "all" returns 0.
function rangeStart(range: Range): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  switch (range) {
    case "today":
      return d.getTime();
    case "week": {
      // Week starts on Monday.
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      return d.getTime();
    }
    case "month":
      d.setDate(1);
      return d.getTime();
    case "year":
      d.setMonth(0, 1);
      return d.getTime();
    case "all":
    default:
      return 0;
  }
}

// ── Shared Timeframe Resolver ──────────────────────────────────────────────

import { calculateAnalytics, resolveTimeframe } from "../lib/db";

export function Dashboard({ onBack }: DashboardProps) {
  const [entries, setEntries] = useState<ShoppingLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("month");
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [profileName, setProfileName] = useState("Guest");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("Guest");
  const [userData, setUserData] = useState<Partial<ChromeExtensionStorage> | null>(null);

  const [sortField, setSortField] = useState<keyof ShoppingLedgerRow>("addedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const handleSort = (field: keyof ShoppingLedgerRow) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  async function handleDeleteEntry(id: string) {
    await deleteLedgerEntry(id);
    await load(false);
  }

  const basketRef = useRef<HTMLElement>(null);

  async function load(showLoading = true) {
    if (showLoading) setLoading(true);
    const all = await getAllEntries();
    setEntries(all);
    const s = await getSettings();
    setSettings(s);
    setProfileName(s.profileName);
    setNameInput(s.profileName);
    
    // Load extension storage data
    const storageData = await ExtensionStorage.getOnboardingData();
    setUserData(storageData);
    
    if (showLoading) setLoading(false);
  }

  /**
   * M1 fix: single persistence path for profile name edits.
   * Previously the Enter and button handlers wrote to localStorage("user_health_profile"),
   * a key nothing else ever reads back. load() always overwrote from IDB on next open,
   * silently reverting the name. Now all persistence goes through saveSettings() → IDB.
   */
  function commitNameEdit(rawInput: string) {
    const trimmed = rawInput.trim() || "Guest";
    const initials = trimmed
      .split(" ")
      .map((w: string) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
    const next: Settings = { ...settings, profileName: trimmed, initials };
    setSettings(next);
    setProfileName(trimmed);
    saveSettings(next); // only persistence path that survives reload
    setEditingName(false);
  }

  const { activeTheme, setTheme } = useTheme();

  /** Single-select condition setter — mutually exclusive. Updates Settings flags,
   *  applies the theme attribute, and persists condition to localStorage profile. */
  function selectCondition(condition: "diabetes" | "hypertension" | "kidney" | "obesity" | "general") {
    const next: Settings = {
      ...settings,
      diabetes: condition === "diabetes",
      hypertension: condition === "hypertension",
      kidney: condition === "kidney",
      obesity: condition === "obesity",
    };
    setSettings(next);
    saveSettings(next).catch(console.warn);
    setTheme(condition);
  }

  function updateSetting(key: keyof Settings, value: boolean) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  }

  useEffect(() => {
    load();
    const handleMessage = (msg: any) => {
      if (msg.action === "CART_UPDATED") {
        load();
      }
    };
    
    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.user_account || changes.user_preferences || changes.user_payment) {
        ExtensionStorage.getOnboardingData().then(data => setUserData(data));
      }
    };

    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
      chrome.storage?.onChanged.addListener(storageListener);
      return () => {
        chrome.runtime.onMessage.removeListener(handleMessage);
        chrome.storage?.onChanged.removeListener(storageListener);
      };
    }
  }, []);

  useEffect(() => {
    // @ts-ignore
    if (typeof window !== "undefined" && window.applyPersonalization) {
      // @ts-ignore
      window.applyPersonalization();
    }
  });

  // Entries scoped to the selected duration filter.
  const filtered = useMemo(() => {
    const tf = resolveTimeframe(range);
    const start = tf.windowStart;
    return entries.filter((e) => e.addedAt >= start);
  }, [entries, range]);

  const analytics = useMemo<DashboardViewModel | null>(() => {
    if (!entries.length) return null;
    const tf = resolveTimeframe(range);
    let effectiveTf = tf;
    if (range === "all") {
      const oldest = entries.length > 0
        ? Math.min(...entries.map((e) => e.addedAt))
        : Date.now() - 30 * 86400000;
      const spanDays = (Date.now() - oldest) / 86400000;
      // Build a new object — never mutate the value returned by resolveTimeframe().
      const bucketUnit = spanDays <= 365 ? "week" : spanDays <= 365 * 3 ? "month" : "quarter";
      effectiveTf = { ...tf, windowStart: oldest, bucketUnit };
    }
    return calculateAnalytics(filtered, entries.length, effectiveTf);
  }, [filtered, entries.length, range]);

  const basketData = useMemo(() => {
    if (!analytics) return [];
    return GRADE_ORDER.map((g) => ({ grade: g, value: analytics.basketQuality.distribution[g] || 0 }));
  }, [analytics]);

  // Trim leading all-zero buckets so the trend line fills the plot width.
  // Without this, a week view starting Mon with data only on Sat squashes the
  // lines into the right edge (the flatline effect).
  const trendData = useMemo(() => {
    const raw = analytics?.nutrientTrends.data || [];
    const firstNonZero = raw.findIndex(
      (d) => (d.sodium ?? 0) > 0 || (d.sugar ?? 0) > 0 || (d.satFat ?? 0) > 0
    );
    return firstNonZero <= 0 ? raw : raw.slice(firstNonZero);
  }, [analytics]);
  const alertCounts = analytics?.healthAlerts || { diabetes: 0, hypertension: 0, cvd: 0, kidney: 0 };
  
  const drillDownFiltered = useMemo(() => {
    if (!selectedGrade) return filtered;
    return filtered.filter(e => (e.gradeSnapshot || e.grade) === selectedGrade);
  }, [filtered, selectedGrade]);

  const categoryData = useMemo((): StackedHBar[] => {
    if (drillDownFiltered.length === 0) return [];

    const VALID_GRADES = new Set(["A", "B", "C", "D", "E"]);
    const GRADE_COLORS: Record<string, string> = {
      A: "var(--ns-grade-a)", B: "var(--ns-grade-b)",
      C: "var(--ns-grade-c)", D: "var(--ns-grade-d)", E: "var(--ns-grade-e)",
    };
    const GRADE_ORDER_LOCAL = ["A", "B", "C", "D", "E"];

    // catMap: category → grade → { totalSpend, itemCount }
    const catMap: Record<string, Record<string, { spend: number; count: number }>> = {};

    for (const row of drillDownFiltered) {
      const price = row.priceSnapshot ?? 0;
      const grade = (row.gradeSnapshot || (row as any).grade || "").toUpperCase();

      // Skip rows with no real price or no valid grade
      if (price <= 0 || !VALID_GRADES.has(grade)) continue;

      const cat = row.category && row.category !== "Uncategorized" ? row.category : "Other";
      if (!catMap[cat]) catMap[cat] = {};
      if (!catMap[cat][grade]) catMap[cat][grade] = { spend: 0, count: 0 };
      catMap[cat][grade].spend  += price;
      catMap[cat][grade].count  += 1;
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

        // Only include categories that have at least one valid segment
        if (segments.length === 0) return null;

        const totalPrice  = segments.reduce((s, seg) => s + seg.price, 0);
        const totalItems  = GRADE_ORDER_LOCAL.reduce((s, g) => s + (gradeMap[g]?.count ?? 0), 0);
        const label       = `${category} (${totalItems})`;

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
      
      if (sortField === 'gradeSnapshot' as any) {
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

  async function confirmErase() {
    await purgeAll();
    await load();
    setSelectedGrade(null);
    setShowDeleteConfirm(false);
    toast.success("All your data has been deleted");
  }

  function handleErase() {
    setShowDeleteConfirm(true);
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <header
        className="flex items-center justify-between px-6 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] relative z-10 transition-colors duration-300"
        style={{ backgroundColor: "var(--theme-header-bg, #ffffff)" }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to store"
            className="rounded-md p-1.5 hover:bg-black/10 transition-colors"
          >
            <ArrowLeft size={18} aria-hidden style={{ color: "var(--theme-header-text, #0f172a)" }} />
          </button>
          <div>
            <h1
              id="user-greeting"
              className="font-bold transition-colors duration-300"
              style={{ color: "var(--theme-header-text, #0f172a)" }}
            >
              Shopping Analytics
            </h1>
            <p
              id="user-subtitle"
              style={{ fontSize: "0.78rem", color: "var(--theme-header-sub, #64748b)" }}
            >
              Based on items added to your cart
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 relative">
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            aria-label="Settings"
            title="Settings"
            className="flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors focus:outline-none p-2"
          >
            <Settings2 size={20} className="text-slate-600" />
          </button>
          
          {/* Removed profile dropdown and trigger as they moved to Settings */}
        </div>
      </header>

      {loading ? (
        <div className="p-6" style={{ color: "var(--muted-foreground)" }}>
          Loading your data…
        </div>
      ) : (
        <div
          className="space-y-4 p-6"
          // Reset the donut selection whenever interaction or focus moves to
          // any component outside the basket-quality section.
          onPointerDownCapture={(e) => {
            if (
              basketRef.current &&
              !basketRef.current.contains(e.target as Node)
            ) {
              setSelectedGrade(null);
            }
          }}
          onFocusCapture={(e) => {
            if (
              basketRef.current &&
              !basketRef.current.contains(e.target as Node)
            ) {
              setSelectedGrade(null);
            }
          }}
        >
          {/* Duration filter */}
          <div
            className="inline-flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-black/5"
            role="group"
            aria-label="Filter analytics by time range"
          >
            {RANGE_OPTIONS.map((opt) => {
              const active = range === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRange(opt.value)}
                  className="rounded-md px-3 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                  style={{
                    fontSize: "0.82rem",
                    backgroundColor: active ? "var(--theme-primary)" : "transparent",
                    color: active ? "#fff" : "var(--muted-foreground)",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* User data panels removed */}

          {filtered.length === 0 ? (
            <div
              className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5"
              style={{ color: "var(--muted-foreground)" }}
            >
              Your cart is empty, add first purchase
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Basket quality donut */}
            <section ref={basketRef} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-slate-100 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 transition-colors duration-300" style={{ backgroundColor: "var(--theme-header-bg)" }}>
                <h3 className="font-bold" style={{ color: "var(--theme-header-text)" }}>Basket Quality</h3>
                <p className="text-xs mt-1" style={{ color: "var(--theme-header-sub)" }}>
                  {selectedGrade
                    ? `Grade ${selectedGrade}: ${
                        basketData.find((d) => d.grade === selectedGrade)?.value ?? 0
                      } items — tap again to clear`
                    : "Share of items by grade — tap a segment"}
                </p>
              </div>
              <div className="p-4 flex-1">
                <ChartBox height={190}>
                  {(size) => (
                    <DonutChart
                      size={size}
                      selectedId={selectedGrade}
                      onSelect={(id) =>
                        setSelectedGrade((cur) => (cur === id ? null : id))
                      }
                      data={basketData.map((d) => ({
                        id: d.grade,
                        label: `Grade ${d.grade}`,
                        value: d.value,
                        color: gradeColorVar(d.grade),
                      }))}
                    />
                  )}
                </ChartBox>
                <div className="flex flex-wrap justify-center gap-x-1.5 gap-y-0.5 pt-1.5">
                {basketData.map((d) => {
                  const active = selectedGrade === d.grade;
                  return (
                    <button
                      key={d.grade}
                      type="button"
                      onClick={() =>
                        setSelectedGrade((cur) => (cur === d.grade ? null : d.grade))
                      }
                      className="flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black hover:bg-slate-50"
                      aria-pressed={active}
                      style={{
                        fontSize: "0.67rem",
                        backgroundColor: active ? "var(--accent)" : "transparent",
                        opacity: selectedGrade && !active ? 0.5 : 1,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          backgroundColor: gradeColorVar(d.grade),
                          display: "inline-block",
                          flexShrink: 0,
                        }}
                      />
                      <span className={active ? "font-bold text-slate-800" : "text-slate-600"}>{d.grade} · {GRADE_LABEL[d.grade]} ({d.value})</span>
                    </button>
                  );
                })}
              </div>
              </div>
            </section>

            {/* Nutrient trends line */}
            <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-slate-100 lg:col-span-2 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 transition-colors duration-300" style={{ backgroundColor: "var(--theme-header-bg)" }}>
                <h3 className="font-bold" style={{ color: "var(--theme-header-text)" }}>Nutrient Trends</h3>
                <p className="text-xs mt-1" style={{ color: "var(--theme-header-sub)" }}>
                  Average intake as % of Daily Limit -{" "}
                  {RANGE_OPTIONS.find((o) => o.value === range)?.label.toLowerCase()}
                </p>
              </div>
              <div className="p-4 flex-1">
                <ChartBox height={216}>
                  {(size) => (
                    <LineTrend
                      size={size}
                      data={trendData}
                      showSodium={true}
                      showSugar={true}
                      showSatFat={false}
                      primaryKey={
                        activeTheme === "hypertension" ? "sodium"
                        : activeTheme === "diabetes"   ? "sugar"
                        : "sodium"   // general / kidney → default to sodium as primary
                      }
                    />
                  )}
                </ChartBox>
                <div id="nutrient-legend-list" className="flex flex-wrap gap-4 pt-2">
                  <span
                    className="flex items-center gap-1.5"
                    style={{ fontSize: "0.72rem" }}
                  >
                    <span style={{ width: 14, height: 2.5, backgroundColor: "var(--ns-grade-d)", display: "inline-block", borderRadius: 2 }} />
                    <span className="text-slate-600">
                      Sodium
                      {activeTheme === "hypertension" && <span className="ml-1 text-slate-400">(primary)</span>}
                    </span>
                  </span>
                  <span
                    className="flex items-center gap-1.5"
                    style={{ fontSize: "0.72rem" }}
                  >
                    <span style={{ width: 14, height: 1.5, backgroundColor: "var(--ns-grade-e)", display: "inline-block", borderRadius: 2, borderTop: "1.5px dashed var(--ns-grade-e)" }} />
                    <span className="text-slate-600">
                      Sugar
                      {activeTheme === "diabetes" && <span className="ml-1 text-slate-400">(primary)</span>}
                    </span>
                  </span>
              </div>
              </div>
            </section>
          </div>

          {/* Category insights bar */}
          <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-slate-100 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 transition-colors duration-300" style={{ backgroundColor: "var(--theme-header-bg)" }}>
              <h3 className="font-bold" style={{ color: "var(--theme-header-text)" }}>Category Insights</h3>
              <p className="text-xs mt-1" style={{ color: "var(--theme-header-sub)" }}>
                Average spend by category — coloured by grade (n = items with priced purchases)
              </p>
            </div>
            <div className="p-4 flex-1">
              <ChartBox height={Math.max(160, 52 * categoryData.length + 36)}>
                {(size) => (
                  <StackedHBarChart
                    size={size}
                    data={categoryData}
                  />
                )}
              </ChartBox>
            </div>
          </section>

          {/* Health Alerts Summary */}
          <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-slate-100 lg:col-span-3 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 transition-colors duration-300" style={{ backgroundColor: "var(--theme-header-bg)" }}>
              <h3 className="flex items-center gap-2 font-bold" style={{ color: "var(--theme-header-text)" }}>
                <ShieldAlert size={18} aria-hidden style={{ color: "var(--theme-header-text)" }} />
                Health Alerts
              </h3>
            </div>
            <div className="p-4 flex-1">
              <div className="flex flex-wrap gap-4">
                {(() => {
                  type AlertMode = { count: number; icon: React.ReactNode; label: string; detail: string; bg: string; border: string; iconColor: string; textColor: string; mutedColor: string };
                  const modeAlert: AlertMode | null = (() => {
                    if (activeTheme === "diabetes") return {
                      count: alertCounts.diabetes,
                      icon: <Droplet size={22} />,
                      label: "Blood Sugar",
                      detail: "Sugar > 22.5g/100g",
                      bg: "var(--theme-accent-bg)", border: "var(--theme-border)", iconColor: "var(--theme-primary)", textColor: "var(--theme-primary)", mutedColor: "var(--theme-header-sub)"
                    };
                    if (activeTheme === "hypertension") return {
                      count: alertCounts.hypertension,
                      icon: <HeartPulse size={22} />,
                      label: "Blood Pressure",
                      detail: "Sodium > 600mg/100g",
                      bg: "var(--theme-accent-bg)", border: "var(--theme-border)", iconColor: "var(--theme-primary)", textColor: "var(--theme-primary)", mutedColor: "var(--theme-header-sub)"
                    };
                    if (activeTheme === "kidney") return {
                      count: alertCounts.kidney,
                      icon: <Activity size={22} />,
                      label: "Kidney Health",
                      detail: "Sodium > 600mg or high potassium",
                      bg: "var(--theme-accent-bg)", border: "var(--theme-border)", iconColor: "var(--theme-primary)", textColor: "var(--theme-primary)", mutedColor: "var(--theme-header-sub)"
                    };
                    if (activeTheme === "obesity") return {
                      count: alertCounts.obesity,
                      icon: <Scale size={22} />,
                      label: "Weight & Obesity",
                      detail: "High energy, sugar or sat. fat",
                      bg: "var(--theme-accent-bg)", border: "var(--theme-border)", iconColor: "var(--theme-primary)", textColor: "var(--theme-primary)", mutedColor: "var(--theme-header-sub)"
                    };
                    // general: show all non-zero counts
                    return null;
                  })();

                  if (modeAlert) {
                    return (
                      <div className="flex items-center gap-4 rounded-xl px-5 py-3 border transition-all duration-300 w-full" style={{ backgroundColor: modeAlert.bg, borderColor: modeAlert.border }}>
                        <span style={{ color: modeAlert.iconColor }}>{modeAlert.icon}</span>
                        <div className="flex-1">
                          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: modeAlert.mutedColor }}>{modeAlert.label}</div>
                          <div className="text-xs" style={{ color: modeAlert.mutedColor }}>{modeAlert.detail}</div>
                        </div>
                        <span className="text-3xl font-bold tabular-nums" style={{ color: modeAlert.textColor }}>{modeAlert.count}</span>
                        <span className="text-xs" style={{ color: modeAlert.mutedColor }}>items</span>
                      </div>
                    );
                  }

                  // General mode: show all counts that are non-zero
                  const generalAlerts = [
                    { count: alertCounts.diabetes, label: "Sugar", detail: "> 22.5g", icon: <Droplet size={18} />, iconColor: "var(--theme-primary)" },
                    { count: alertCounts.hypertension, label: "Sodium", detail: "> 600mg", icon: <HeartPulse size={18} />, iconColor: "var(--theme-primary)" },
                    { count: alertCounts.kidney, label: "Kidney", detail: "Na/K flags", icon: <Activity size={18} />, iconColor: "var(--theme-primary)" },
                    { count: alertCounts.obesity, label: "Calories", detail: "High energy", icon: <Scale size={18} />, iconColor: "var(--theme-primary)" },
                  ].filter(a => a.count > 0);

                  if (generalAlerts.length === 0) {
                    return <p className="text-sm text-slate-500">No nutritional alerts in this period.</p>;
                  }

                  return generalAlerts.map(a => (
                    <div key={a.label} className="flex items-center gap-3 rounded-lg px-4 py-2 border transition-all duration-300" style={{ backgroundColor: "#F1F5F9", borderColor: "#CBD5E1" }}>
                      <span style={{ color: a.iconColor }}>{a.icon}</span>
                      <span className="text-xl font-bold" style={{ color: "#0F172A" }}>{a.count}</span>
                      <div>
                        <div className="text-xs font-semibold text-slate-700">{a.label}</div>
                        <div className="text-xs text-slate-500">{a.detail}</div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </section>

          {/* Ledger */}
          <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col border border-slate-100" style={{ maxHeight: "600px" }}>
            <div className="px-4 py-3 border-b border-slate-100 transition-colors duration-300 z-20 relative" style={{ backgroundColor: "var(--theme-header-bg)" }}>
              <h3 className="font-bold" style={{ color: "var(--theme-header-text)" }}>Ledger</h3>
            </div>
            <div className="overflow-y-auto relative" style={{ maxHeight: "500px" }}>
              <table className="w-full caption-bottom text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10 shadow-[0_1px_0_#E2E8F0]" style={{ borderTop: "2px solid var(--theme-primary)" }}>
                  <tr className="border-b border-slate-200">
                    <th className="h-10 px-2 text-left align-middle cursor-pointer hover:bg-slate-100 font-semibold text-xs tracking-wider text-slate-500 uppercase" onClick={() => handleSort("addedAt")}>Date {sortField === "addedAt" && (sortOrder === "asc" ? "↑" : "↓")}</th>
                    <th className="h-10 px-2 text-left align-middle cursor-pointer hover:bg-slate-100 font-semibold text-xs tracking-wider text-slate-500 uppercase" onClick={() => handleSort("name")}>Product {sortField === "name" && (sortOrder === "asc" ? "↑" : "↓")}</th>
                    <th className="h-10 px-2 text-left align-middle cursor-pointer hover:bg-slate-100 font-semibold text-xs tracking-wider text-slate-500 uppercase" onClick={() => handleSort("retailer")}>Retailer {sortField === "retailer" && (sortOrder === "asc" ? "↑" : "↓")}</th>
                    <th className="h-10 px-2 text-left align-middle cursor-pointer hover:bg-slate-100 font-semibold text-xs tracking-wider text-slate-500 uppercase" onClick={() => handleSort("category")}>Category {sortField === "category" && (sortOrder === "asc" ? "↑" : "↓")}</th>
                    <th className="h-10 px-2 text-right align-middle cursor-pointer hover:bg-slate-100 font-semibold text-xs tracking-wider text-slate-500 uppercase" onClick={() => handleSort("quantity")}>Qty {sortField === "quantity" && (sortOrder === "asc" ? "↑" : "↓")}</th>
                    <th className="h-10 px-2 text-right align-middle cursor-pointer hover:bg-slate-100 font-semibold text-xs tracking-wider text-slate-500 uppercase" onClick={() => handleSort("priceSnapshot")}>Price {sortField === "priceSnapshot" && (sortOrder === "asc" ? "↑" : "↓")}</th>
                    <th className="h-10 px-2 text-right align-middle cursor-pointer hover:bg-slate-100 font-semibold text-xs tracking-wider text-slate-500 uppercase" onClick={() => handleSort("status")}>Status {sortField === "status" && (sortOrder === "asc" ? "↑" : "↓")}</th>
                    <th className="h-10 px-2 text-right align-middle cursor-pointer hover:bg-slate-100 font-semibold text-xs tracking-wider text-slate-500 uppercase" onClick={() => handleSort("gradeSnapshot" as any)}>Grade {sortField === "gradeSnapshot" as any && (sortOrder === "asc" ? "↑" : "↓")}</th>
                    <th className="w-[40px]"></th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {sortedFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={9} id="ledger-empty-msg" className="text-center py-8">
                        <span style={{ color: "var(--muted-foreground)" }}>
                          No items yet.
                        </span>
                      </td>
                    </tr>
                  ) : (
                    sortedFiltered.reduce((acc, e, idx, arr) => {
                      const dateStr = new Date(e.addedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
                      const prevDateStr = idx > 0 ? new Date(arr[idx-1].addedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : null;
                      
                      if (dateStr !== prevDateStr && sortField === "addedAt") {
                        acc.push(
                          <tr key={`divider-${dateStr}`} className="bg-slate-50/50 hover:bg-slate-50/50">
                            <td colSpan={9} className="py-2 text-xs font-bold text-slate-500 uppercase tracking-wider pl-2">
                              {dateStr}
                            </td>
                          </tr>
                        );
                      }

                      acc.push(
                        <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                          <td className="p-2 align-middle whitespace-nowrap" style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                            {sortField === "addedAt" ? new Date(e.addedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : new Date(e.addedAt).toLocaleDateString()}
                          </td>
                          <td className="p-2 align-middle whitespace-nowrap font-medium text-slate-700" style={{ fontSize: "0.8rem" }}>{e.name}</td>
                          <td className="p-2 align-middle whitespace-nowrap" style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                            {e.retailer}
                          </td>
                          <td className="p-2 align-middle whitespace-nowrap" style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                            {e.category}
                          </td>
                          <td className="p-2 align-middle whitespace-nowrap text-right" style={{ fontSize: "0.8rem" }}>
                            {e.quantity}
                          </td>
                          <td className="p-2 align-middle whitespace-nowrap text-right" style={{ fontSize: "0.8rem" }}>
                            {e.priceSnapshot !== null
                              ? `KES ${Number(e.priceSnapshot).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </td>
                          <td className="p-2 align-middle whitespace-nowrap text-right" style={{ fontSize: "0.8rem" }}>
                            {e.status.replace('_', ' ')}
                          </td>
                          <td className="p-2 align-middle whitespace-nowrap text-right">
                            <span
                              className="inline-grid size-6 place-items-center rounded-md"
                              style={{
                                backgroundColor: gradeColorVar(e.gradeSnapshot || (e as any).grade),
                                color: "#fff",
                                fontWeight: 700,
                                fontSize: "0.75rem",
                              }}
                            >
                              {e.gradeSnapshot || (e as any).grade}
                            </span>
                          </td>
                          <td className="p-2 align-middle whitespace-nowrap text-right pr-4">
                             <button onClick={() => handleDeleteEntry(e.id)} className="text-slate-400 hover:text-red-500 transition-colors" title="Delete entry" aria-label="Delete entry">
                               <Trash2 size={14} />
                             </button>
                          </td>
                        </tr>
                      );
                      return acc;
                    }, [] as React.ReactNode[])
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Delete confirmation modal moved to Options */}
    </div>
  );
}
