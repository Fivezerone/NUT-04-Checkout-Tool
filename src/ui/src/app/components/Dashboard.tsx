import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trash2, Droplet, HeartPulse, Activity, UserCircle2, Check, ShieldAlert } from "lucide-react";
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
import { getAllEntries, purgeAll, getSettings, saveSettings, deleteLedgerEntry, DEFAULT_SETTINGS, type Settings } from "../lib/db";

import {
  GRADE_LABEL,
  GRADE_ORDER,
  gradeColorVar,
  type Grade,
  type ShoppingLedgerRow,
  type DashboardViewModel
} from "../lib/nutriscore";

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
    if (showLoading) setLoading(false);
  }



  // Derive which single condition is active from the boolean settings flags.
  const activeCondition: "diabetes" | "hypertension" | "kidney" | "general" =
    settings.diabetes ? "diabetes"
    : settings.hypertension ? "hypertension"
    : settings.kidney ? "kidney"
    : "general";

  /** Single-select condition setter — mutually exclusive. Updates Settings flags,
   *  applies the theme attribute, and persists condition to localStorage profile. */
  function selectCondition(condition: "diabetes" | "hypertension" | "kidney" | "general") {
    const next: Settings = {
      ...settings,
      diabetes: condition === "diabetes",
      hypertension: condition === "hypertension",
      kidney: condition === "kidney",
    };
    setSettings(next);
    saveSettings(next);

    const conditionStr = condition === "general" ? "healthy" : condition;
    if (condition === "general") {
      document.documentElement.removeAttribute("data-health-condition");
    } else {
      document.documentElement.setAttribute("data-health-condition", condition);
    }
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
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
      return () => chrome.runtime.onMessage.removeListener(handleMessage);
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
          {/* Profile avatar + dropdown trigger */}
          <button
            type="button"
            onClick={() => { setShowSettings(!showSettings); setEditingName(false); setNameInput(profileName); }}
            aria-label="Edit profile"
            title="Edit profile"
            className="flex items-center justify-center rounded-full hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400"
            style={{ width: "40px", height: "40px" }}
          >
            <div
              id="user-avatar-badge"
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors duration-300"
              style={{
                backgroundColor: "var(--theme-primary, #2563eb)",
                color: "#fff",
                borderColor: "var(--theme-header-bg, #ffffff)",
              }}
            >
              {profileName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
          </button>

          {/* Profile dropdown */}
          {showSettings && (
            <div className="absolute right-0 top-12 z-50 w-76 rounded-xl bg-white p-4 shadow-[0_10px_40px_rgba(0,0,0,0.12)] border border-slate-100" style={{ minWidth: "17rem" }}>

              {/* Edit Profile section */}
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Edit Profile</p>
              {editingName ? (
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const n = nameInput.trim() || "Guest";
                        setProfileName(n);
                        setEditingName(false);
                        try {
                          const raw = localStorage.getItem("user_health_profile");
                          const p = raw ? JSON.parse(raw) : {};
                          p.name = n;
                          p.initials = n.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
                          localStorage.setItem("user_health_profile", JSON.stringify(p));
                        } catch {}
                      }
                      if (e.key === "Escape") setEditingName(false);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const n = nameInput.trim() || "Guest";
                      setProfileName(n);
                      setEditingName(false);
                      try {
                        const raw = localStorage.getItem("user_health_profile");
                        const p = raw ? JSON.parse(raw) : {};
                        p.name = n;
                        p.initials = n.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
                        localStorage.setItem("user_health_profile", JSON.stringify(p));
                      } catch {}
                    }}
                    className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-white hover:bg-blue-700 transition"
                  >
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setEditingName(true); setNameInput(profileName); }}
                  className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 mb-4 text-sm text-slate-700 hover:border-blue-400 hover:bg-slate-50 transition"
                >
                  <span className="font-medium">{profileName}</span>
                  <span className="text-xs text-slate-400">tap to edit</span>
                </button>
              )}

              {/* Health Focus — wizard-style single-select cards */}
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Health Focus</p>
              <div className="flex flex-col gap-2 mb-4">
                {(
                  [
                    {
                      id: "diabetes" as const,
                      icon: <Droplet size={14} style={{ color: "var(--ns-grade-e)", flexShrink: 0 }} />,
                      title: "Blood Sugar & Diabetes",
                    },
                    {
                      id: "hypertension" as const,
                      icon: <HeartPulse size={14} style={{ color: "var(--ns-grade-d)", flexShrink: 0 }} />,
                      title: "Blood Pressure & Sodium",
                    },
                    {
                      id: "kidney" as const,
                      icon: <Activity size={14} style={{ color: "#0d9488", flexShrink: 0 }} />,
                      title: "Renal & Kidney Health",
                    },
                    {
                      id: "general" as const,
                      icon: <UserCircle2 size={14} style={{ color: "#64748b", flexShrink: 0 }} />,
                      title: "General Wellness",
                    },
                  ] satisfies { id: "diabetes" | "hypertension" | "kidney" | "general"; icon: React.ReactNode; title: string }[]
                ).map(({ id, icon, title }) => {
                  const isActive = activeCondition === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectCondition(id)}
                      className="flex w-full items-center justify-between rounded-xl border-2 py-2 px-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-slate-400"
                      style={{
                        borderColor: isActive ? "var(--theme-primary)" : "#e2e8f0",
                        backgroundColor: isActive ? "color-mix(in srgb, var(--theme-primary) 8%, white)" : "#ffffff",
                      }}
                      aria-pressed={isActive}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {icon}
                        <span className="text-xs font-bold text-slate-800 leading-none">{title}</span>
                      </div>
                      {/* Radio indicator */}
                      <div
                        className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                        style={{
                          borderColor: isActive ? "var(--theme-primary)" : "#cbd5e1",
                          backgroundColor: isActive ? "var(--theme-primary)" : "transparent",
                        }}
                      >
                        {isActive && (
                          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Delete data — destructive footer */}
              <div className="pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleErase}
                  className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 transition-opacity"
                  style={{ backgroundColor: "var(--destructive)" }}
                >
                  <Trash2 size={15} aria-hidden />
                  <span style={{ fontSize: "0.82rem", fontWeight: "600" }}>Delete all my data</span>
                </button>
              </div>
            </div>
          )}
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
                        activeCondition === "hypertension" ? "sodium"
                        : activeCondition === "diabetes"   ? "sugar"
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
                      {activeCondition === "hypertension" && <span className="ml-1 text-slate-400">(primary)</span>}
                    </span>
                  </span>
                  <span
                    className="flex items-center gap-1.5"
                    style={{ fontSize: "0.72rem" }}
                  >
                    <span style={{ width: 14, height: 1.5, backgroundColor: "var(--ns-grade-e)", display: "inline-block", borderRadius: 2, borderTop: "1.5px dashed var(--ns-grade-e)" }} />
                    <span className="text-slate-600">
                      Sugar
                      {activeCondition === "diabetes" && <span className="ml-1 text-slate-400">(primary)</span>}
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
                <div id="health-alerts-container"></div>
              {settings.diabetes && (
                <div className="flex items-center gap-3 rounded-lg px-4 py-2 border transition-all duration-300" style={{ backgroundColor: "#ecfeff", borderColor: "#a5f3fc" }}>
                  <Droplet size={18} style={{ color: "#0e7490" }} />
                  <span className="text-xl font-bold" style={{ color: "#0e7490" }}>{alertCounts.diabetes}</span>
                  <span className="text-xs font-medium" style={{ color: "#164e63" }}>Sugar &gt; 22.5g</span>
                </div>
              )}
              {settings.hypertension && (
                <div className="flex items-center gap-3 rounded-lg px-4 py-2 border transition-all duration-300" style={{ backgroundColor: "#fffbeb", borderColor: "#fde68a" }}>
                  <HeartPulse size={18} style={{ color: "#d97706" }} />
                  <span className="text-xl font-bold" style={{ color: "#d97706" }}>{alertCounts.hypertension}</span>
                  <span className="text-xs font-medium" style={{ color: "#92400e" }}>Sodium &gt; 600mg</span>
                </div>
              )}
              {settings.kidney && (
                <div className="flex items-center gap-3 rounded-lg px-4 py-2 border transition-all duration-300" style={{ backgroundColor: "#f0fdfa", borderColor: "#99f6e4" }}>
                  <Activity size={18} style={{ color: "#0d9488" }} />
                  <span className="text-xl font-bold" style={{ color: "#0d9488" }}>{alertCounts.kidney}</span>
                  <span className="text-xs font-medium" style={{ color: "#115e59" }}>Sodium &gt; 600mg or high potassium</span>
                </div>
              )}
              {!settings.diabetes && !settings.hypertension && !settings.kidney && (
                <p className="text-sm text-slate-500">No health alerts enabled. Turn them on in Settings.</p>
              )}
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl ring-1 ring-black/10">
            <h2 className="mb-2 text-lg font-bold text-gray-900">Delete all your data?</h2>
            <p className="mb-6 text-sm text-gray-500">
              This removes every saved item from this device. You cannot undo this.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmErase}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
