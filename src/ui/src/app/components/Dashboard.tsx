import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trash2, Droplet, HeartPulse, Heart, ShieldAlert, Activity } from "lucide-react";
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
import { DonutChart, LineTrend, HBarChart } from "./charts/Charts";
import { getAllEntries, purgeAll, getSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from "../lib/db";
import { auth, subscribeToCloudLedger } from "../lib/cloudDb";
import { onAuthStateChanged, User } from "firebase/auth";
import { Switch } from "./ui/switch";
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
  const [page, setPage] = useState(0);
  const [range, setRange] = useState<Range>("month");
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [user, setUser] = useState<User | null>(null);
  const [isWebsite] = useState(!window.location.protocol.startsWith("chrome-extension"));
  const basketRef = useRef<HTMLElement>(null);

  async function load() {
    setLoading(true);
    if (!isWebsite) {
      const all = await getAllEntries();
      setEntries(all);
    }
    const s = await getSettings();
    setSettings(s);
    setLoading(false);
  }

  useEffect(() => {
    if (isWebsite) {
      const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        if (!currentUser) {
          setEntries([]);
          setLoading(false);
        }
      });
      return () => unsubscribeAuth();
    }
  }, [isWebsite]);

  useEffect(() => {
    if (isWebsite && user) {
      setLoading(true);
      const unsubscribeLedger = subscribeToCloudLedger(user.uid, (cloudEntries) => {
        setEntries(cloudEntries);
        setLoading(false);
      });
      return () => unsubscribeLedger();
    }
  }, [isWebsite, user]);

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

  // Reset pagination whenever the range changes.
  useEffect(() => {
    setPage(0);
  }, [range]);

  // Entries scoped to the selected duration filter.
  const filtered = useMemo(() => {
    const tf = resolveTimeframe(range);
    const start = tf.windowStart;
    return entries.filter((e) => e.addedAt >= start);
  }, [entries, range]);

  const analytics = useMemo<DashboardViewModel | null>(() => {
    if (!entries.length) return null;
    const tf = resolveTimeframe(range);
    const oldest = entries.length > 0 ? Math.min(...entries.map((e) => e.addedAt)) : Date.now() - 30 * 86400000;
    if (range === "all") {
      tf.windowStart = oldest;
      const spanDays = (Date.now() - oldest) / 86400000;
      if (spanDays <= 365) tf.bucketUnit = "week";
      else if (spanDays <= 365 * 3) tf.bucketUnit = "month";
      else tf.bucketUnit = "quarter";
    }
    return calculateAnalytics(filtered, entries.length, tf);
  }, [filtered, entries.length, range]);

  const basketData = useMemo(() => {
    if (!analytics) return [];
    return GRADE_ORDER.map((g) => ({ grade: g, value: analytics.basketQuality.distribution[g] || 0 }));
  }, [analytics]);

  const trendData = analytics?.nutrientTrends.data || [];
  const alertCounts = analytics?.healthAlerts || { diabetes: 0, hypertension: 0, cvd: 0, kidney: 0 };
  
  const drillDownFiltered = useMemo(() => {
    if (!selectedGrade) return filtered;
    return filtered.filter(e => (e.gradeSnapshot || e.grade) === selectedGrade);
  }, [filtered, selectedGrade]);

  const categoryData = useMemo(() => {
    if (drillDownFiltered.length === 0) return [];
    const catMap: Record<string, { pts: number; n: number }> = {};
    const gradePts: Record<string, number> = { A: 1, B: 3, C: 7, D: 12, E: 20 };
    
    for (const row of drillDownFiltered) {
      const g = row.gradeSnapshot || row.grade;
      const c = row.category || "Uncategorized";
      const m = catMap[c] ?? (catMap[c] = { pts: 0, n: 0 });
      m.pts += gradePts[g] ?? 0;
      m.n += 1;
    }
    
    return Object.entries(catMap)
      .map(([category, m]) => ({
        category,
        pts: Math.round(m.pts / m.n),
      }))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 6);
  }, [drillDownFiltered]);

  const pageCount = Math.ceil(drillDownFiltered.length / PAGE_SIZE) || 1;
  const pageRows = drillDownFiltered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function confirmErase() {
    await purgeAll();
    await load();
    setPage(0);
    setSelectedGrade(null);
    setShowDeleteConfirm(false);
    toast.success("All your data has been deleted");
  }

  function handleErase() {
    setShowDeleteConfirm(true);
  }

  return (
    <div className="min-h-full bg-[#f6f7f9]">
      <header className="flex items-center justify-between border-b border-black/5 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to store"
            className="rounded-md p-1.5 hover:bg-black/5"
          >
            <ArrowLeft size={18} aria-hidden />
          </button>
          <div>
            <h1>Shopping Analytics</h1>
            <p style={{ fontSize: "0.78rem", color: "var(--muted-foreground)" }}>
              {isWebsite && user ? `Logged in as ${user.email}` : "Based on items added to your cart"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {isWebsite && !user && (
            <a 
              href="/health.html"
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
            >
              Sign In to View Dashboard
            </a>
          )}
          <button
            type="button"
            onClick={handleErase}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            style={{ backgroundColor: "var(--destructive)" }}
          >
            <Trash2 size={16} aria-hidden />
            <span style={{ fontSize: "0.82rem" }}>Delete all my data</span>
          </button>
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
                    backgroundColor: active ? "var(--primary)" : "transparent",
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
              No items in this time range. Try a wider range.
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Basket quality donut */}
            <section ref={basketRef} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <h3 className="pb-1">Basket Quality</h3>
              <p
                className="pb-2"
                style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}
              >
                {selectedGrade
                  ? `Grade ${selectedGrade}: ${
                      basketData.find((d) => d.grade === selectedGrade)?.value ?? 0
                    } items — tap again to clear`
                  : "Share of items by grade — tap a segment"}
              </p>
              <ChartBox height={200}>
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
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {basketData.map((d) => {
                  const active = selectedGrade === d.grade;
                  return (
                    <button
                      key={d.grade}
                      type="button"
                      onClick={() =>
                        setSelectedGrade((cur) => (cur === d.grade ? null : d.grade))
                      }
                      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black"
                      aria-pressed={active}
                      style={{
                        fontSize: "0.72rem",
                        backgroundColor: active ? "var(--accent)" : "transparent",
                        opacity: selectedGrade && !active ? 0.5 : 1,
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          backgroundColor: gradeColorVar(d.grade),
                          display: "inline-block",
                        }}
                      />
                      {d.grade} · {GRADE_LABEL[d.grade]} ({d.value})
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Nutrient trends line */}
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5 lg:col-span-2">
              <h3 className="pb-1">Nutrient Trends</h3>
              <p
                className="pb-2"
                style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}
              >
                Average sodium (mg), sugar (g), and saturated fat (g) —{" "}
                {RANGE_OPTIONS.find((o) => o.value === range)?.label.toLowerCase()}
              </p>
              <ChartBox height={220}>
                {(size) => (
                  <LineTrend
                    size={size}
                    data={trendData}
                    showSodium={settings.hypertension}
                    showSugar={settings.diabetes}
                    showSatFat={settings.cardiovascular}
                  />
                )}
              </ChartBox>
              <div className="flex flex-wrap gap-4 pt-2">
                {analytics?.nutrientTrends.validCount !== undefined && (
                  <span className="w-full text-xs text-gray-500 mb-1 block">
                    {analytics.nutrientTrends.validCount} records with nutrition data, {analytics.nutrientTrends.missingCount} missing.
                  </span>
                )}
                <span
                  className="flex items-center gap-1"
                  style={{ fontSize: "0.72rem", opacity: settings.hypertension ? 1 : 0.3, transition: "opacity 0.2s" }}
                >
                  <span
                    style={{
                      width: 12, height: 3,
                      backgroundColor: "var(--ns-grade-d)",
                      display: "inline-block",
                    }}
                  />
                  Sodium (mg)
                </span>
                <span
                  className="flex items-center gap-1"
                  style={{ fontSize: "0.72rem", opacity: settings.diabetes ? 1 : 0.3, transition: "opacity 0.2s" }}
                >
                  <span
                    style={{
                      width: 12, height: 3,
                      backgroundColor: "var(--ns-grade-e)",
                      display: "inline-block",
                    }}
                  />
                  Sugar (g)
                </span>
                <span
                  className="flex items-center gap-1"
                  style={{ fontSize: "0.72rem", opacity: settings.cardiovascular ? 1 : 0.3, transition: "opacity 0.2s" }}
                >
                  <span
                    style={{
                      width: 12, height: 3,
                      backgroundColor: "var(--ns-grade-a)",
                      display: "inline-block",
                    }}
                  />
                  Saturated Fat (g)
                </span>
              </div>
            </section>
          </div>

          {/* Category insights bar */}
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <h3 className="pb-1">Category Insights</h3>
            <p
              className="pb-2"
              style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}
            >
              Average negative points (P pts) by category — higher is worse
            </p>
            <ChartBox height={44 * categoryData.length + 16}>
              {(size) => (
                <HBarChart
                  size={size}
                  data={categoryData.map((d) => ({
                    id: d.category,
                    label: d.category,
                    value: d.pts,
                    color:
                      d.pts >= 12
                        ? "var(--ns-grade-e)"
                        : d.pts >= 7
                          ? "var(--ns-grade-d)"
                          : "var(--ns-grade-c)",
                  }))}
                />
              )}
            </ChartBox>
          </section>

          {/* Health Alerts & Controls */}
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5 lg:col-span-3">
            <h3 className="flex items-center gap-2 pb-1">
              <ShieldAlert size={18} className="text-gray-700" aria-hidden />
              Health Alerts & Controls
            </h3>
            <p
              className="pb-4"
              style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}
            >
              Toggle warnings per condition. Counts show how many scanned items triggered each flag.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Diabetes */}
              <div className="flex flex-col gap-3 rounded-lg border border-black/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-sm">
                    <Droplet size={16} style={{ color: "var(--ns-grade-e)" }} aria-hidden />
                    Diabetes
                  </span>
                  <Switch
                    checked={settings.diabetes}
                    onCheckedChange={(v) => updateSetting("diabetes", v)}
                    aria-label="Toggle diabetes warnings"
                  />
                </div>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "var(--muted-foreground)" }}>Sugar &gt; 22.5g flagged</p>
                </div>
                <span className="text-2xl font-bold" style={{ color: "var(--ns-grade-e)" }}>
                  {alertCounts.diabetes}
                  <span style={{ fontSize: "0.75rem", fontWeight: 400, marginLeft: 4, color: "var(--muted-foreground)" }}>items</span>
                </span>
              </div>

              {/* Hypertension */}
              <div className="flex flex-col gap-3 rounded-lg border border-black/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-sm">
                    <HeartPulse size={16} style={{ color: "var(--ns-grade-d)" }} aria-hidden />
                    Hypertension
                  </span>
                  <Switch
                    checked={settings.hypertension}
                    onCheckedChange={(v) => updateSetting("hypertension", v)}
                    aria-label="Toggle hypertension warnings"
                  />
                </div>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "var(--muted-foreground)" }}>Sodium &gt; 600mg flagged</p>
                </div>
                <span className="text-2xl font-bold" style={{ color: "var(--ns-grade-d)" }}>
                  {alertCounts.hypertension}
                  <span style={{ fontSize: "0.75rem", fontWeight: 400, marginLeft: 4, color: "var(--muted-foreground)" }}>items</span>
                </span>
              </div>

              {/* CVD */}
              <div className="flex flex-col gap-3 rounded-lg border border-black/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-sm">
                    <Heart size={16} style={{ color: "var(--ns-grade-e)" }} aria-hidden />
                    Cardiovascular
                  </span>
                  <Switch
                    checked={settings.cardiovascular}
                    onCheckedChange={(v) => updateSetting("cardiovascular", v)}
                    aria-label="Toggle CVD warnings"
                  />
                </div>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "var(--muted-foreground)" }}>Sat fat &gt; 5g or salt &gt; 400mg</p>
                </div>
                <span className="text-2xl font-bold" style={{ color: "var(--ns-grade-e)" }}>
                  {alertCounts.cvd}
                  <span style={{ fontSize: "0.75rem", fontWeight: 400, marginLeft: 4, color: "var(--muted-foreground)" }}>items</span>
                </span>
              </div>

              {/* Kidney */}
              <div className="flex flex-col gap-3 rounded-lg border border-black/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-sm">
                    <Activity size={16} style={{ color: "#7c3aed" }} aria-hidden />
                    Kidney Disease
                  </span>
                  <Switch
                    checked={settings.kidney}
                    onCheckedChange={(v) => updateSetting("kidney", v)}
                    aria-label="Toggle kidney disease warnings"
                  />
                </div>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "var(--muted-foreground)" }}>Sodium &gt; 600mg or high potassium</p>
                </div>
                <span className="text-2xl font-bold" style={{ color: "#7c3aed" }}>
                  {alertCounts.kidney}
                  <span style={{ fontSize: "0.75rem", fontWeight: 400, marginLeft: 4, color: "var(--muted-foreground)" }}>items</span>
                </span>
              </div>
            </div>
          </section>

          {/* Ledger */}
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <h3 className="pb-2">Ledger</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Retailer</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="text-right">Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center">
                      <span style={{ color: "var(--muted-foreground)" }}>
                        No items yet.
                      </span>
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell style={{ fontSize: "0.8rem" }}>
                        {new Date(e.addedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell style={{ fontSize: "0.8rem" }}>{e.name}</TableCell>
                      <TableCell style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                        {e.retailer}
                      </TableCell>
                      <TableCell
                        style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}
                      >
                        {e.category}
                      </TableCell>
                      <TableCell className="text-right" style={{ fontSize: "0.8rem" }}>
                        {e.quantity}
                      </TableCell>
                      <TableCell className="text-right" style={{ fontSize: "0.8rem" }}>
                        {e.priceSnapshot !== null ? `KES ${e.priceSnapshot}` : '—'}
                      </TableCell>
                      <TableCell className="text-right" style={{ fontSize: "0.8rem" }}>
                        {e.status.replace('_', ' ')}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className="inline-grid size-6 place-items-center rounded-md"
                          style={{
                            backgroundColor: gradeColorVar(e.gradeSnapshot || e.grade),
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: "0.75rem",
                          }}
                        >
                          {e.gradeSnapshot || e.grade}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {filtered.length > PAGE_SIZE && (
              <div className="flex items-center justify-between pt-3">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded-md border border-black/10 px-3 py-1 disabled:opacity-40"
                  style={{ fontSize: "0.8rem" }}
                >
                  Previous
                </button>
                <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  Page {page + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="rounded-md border border-black/10 px-3 py-1 disabled:opacity-40"
                  style={{ fontSize: "0.8rem" }}
                >
                  Next
                </button>
              </div>
            )}
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
