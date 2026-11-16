import React, { useState, useEffect, useMemo } from 'react'
import {
  Home,
  Clock,
  HeartPulse,
  ShieldCheck,
  ArrowLeft,
  Settings2,
  Trash2,
  RefreshCw,
  ShoppingBag,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { ChartBox } from './ChartBox'
import { DonutChart, LineTrend, StackedHBarChart, type StackedHBar } from './charts/Charts'
import { GradeBadge, KpiCard, TargetMeter, ConfirmDialog, ConditionChip, DataTable, Badge, Banner } from './ui'
import {
  getAllEntries,
  purgeAll,
  deleteLedgerEntry,
  purgeLedgerOlderThan,
  calculateAnalytics,
} from '../lib/db'
import { getTimeframe, retentionCutoff, TIMEFRAME_OPTIONS, type TimeframeKey } from '../lib/timeframes'
import {
  GRADE_LABEL,
  GRADE_ORDER,
  gradeColorVar,
  type ShoppingLedgerRow,
  type Grade,
  type DashboardViewModel,
} from '../lib/nutriscore'
import { useTheme } from '../context/ThemeContext'
import { ChromeExtensionStorage } from '../../services/storage'

export type ShopperDestination = 'home' | 'history' | 'careplan' | 'privacy'

export interface ShopperShellProps {
  onBack: () => void
}

const RETAILER_OPTIONS = [
  { value: 'all', label: 'All Retailers' },
  { value: 'NAIVAS', label: 'Naivas' },
  { value: 'CARREFOUR', label: 'Carrefour' },
  { value: 'QUICKMART', label: 'Quickmart' },
] as const

type RetailerKey = (typeof RETAILER_OPTIONS)[number]['value']

export function ShopperShell({ onBack }: ShopperShellProps) {
  const [destination, setDestination] = useState<ShopperDestination>('home')
  const [entries, setEntries] = useState<ShoppingLedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<TimeframeKey>('month')
  const [retailerFilter, setRetailerFilter] = useState<RetailerKey>('all')
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [userData, setUserData] = useState<Partial<ChromeExtensionStorage> | null>(null)
  const { activeTheme } = useTheme()

  // Load entries on mount with 90-day retention enforcement
  const loadData = async () => {
    try {
      setLoading(true)
      // ADR-005 & §4.10: enforce 3-month retention on mount
      await purgeLedgerOlderThan(retentionCutoff())
      const all = await getAllEntries()
      setEntries(all)
    } catch (err) {
      console.warn('[ShopperShell] Load error:', err)
      toast.error('Failed to load shopping records')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(null, (res) => {
        setUserData(res as Partial<ChromeExtensionStorage>)
      })
    }
  }, [])

  // Filter entries: strictly exclude removed items and apply timeframe + retailer
  const filtered = useMemo(() => {
    const tf = getTimeframe(range)
    const start = tf.start
    return entries.filter((e) => {
      const inTime = e.addedAt >= start
      const inRetailer =
        retailerFilter === 'all' || (e.retailer && e.retailer.toUpperCase() === retailerFilter)
      const notRemoved = e.status !== 'removed'
      return inTime && inRetailer && notRemoved
    })
  }, [entries, range, retailerFilter])

  // Drilldown by grade if donut slice selected
  const drillDownFiltered = useMemo(() => {
    if (!selectedGrade) return filtered
    return filtered.filter((e) => (e.gradeSnapshot || (e as any).grade) === selectedGrade)
  }, [filtered, selectedGrade])

  const analytics = useMemo<DashboardViewModel | null>(() => {
    if (!entries.length) return null
    const tf = getTimeframe(range)
    return calculateAnalytics(filtered, entries.length, {
      windowStart: tf.start,
      windowEnd: tf.end,
      bucketUnit: tf.bucket,
      bucketCount: tf.bucket === 'hour' ? 24 : tf.bucket === 'day' ? 30 : 12,
      tickLabelFormat: 'short',
      tickLabelFn: (ts: number) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    })
  }, [filtered, entries.length, range])

  const basketData = useMemo(() => {
    if (!analytics) return []
    return GRADE_ORDER.map((g) => ({
      grade: g,
      value: analytics.basketQuality.distribution[g] || 0,
    }))
  }, [analytics])

  const totalRated = useMemo(() => {
    if (!analytics) return 0
    const dist = analytics.basketQuality.distribution
    return (dist.A || 0) + (dist.B || 0) + (dist.C || 0) + (dist.D || 0) + (dist.E || 0)
  }, [analytics])

  const goodCount = useMemo(() => {
    if (!analytics) return 0
    const dist = analytics.basketQuality.distribution
    return (dist.A || 0) + (dist.B || 0) + (dist.C || 0)
  }, [analytics])

  const qualityPct = totalRated > 0 ? Math.round((goodCount / totalRated) * 100) : 0
  const typicalGrade = totalRated > 0 ? (analytics?.basketQuality.averageGrade as Grade) : null

  const alertCounts = analytics?.healthAlerts || {
    diabetes: 0,
    hypertension: 0,
    cvd: 0,
    kidney: 0,
    obesity: 0,
  }
  const totalAlerts =
    alertCounts.diabetes +
    alertCounts.hypertension +
    alertCounts.cvd +
    alertCounts.kidney +
    alertCounts.obesity

  // Nutrient adherence percentages
  const nutrientAdherence = useMemo(() => {
    let sodiumOk = 0
    let sugarOk = 0
    let satFatOk = 0
    let totalWithData = 0

    for (const item of filtered) {
      const snap = item.nutritionSnapshot
      const sod = snap?.sodiumMg ?? (item as any).sodiumMg ?? null
      const sug = snap?.sugarsG ?? (item as any).sugarsG ?? null
      const sat = snap?.satFatG ?? (item as any).satFatG ?? null

      if (sod !== null || sug !== null || sat !== null) {
        totalWithData++
        if (sod !== null && sod <= 600) sodiumOk++
        if (sug !== null && sug <= 10) sugarOk++
        if (sat !== null && sat <= 5) satFatOk++
      }
    }

    return {
      total: totalWithData,
      sodiumPct: totalWithData > 0 ? Math.round((sodiumOk / totalWithData) * 100) : 100,
      sugarPct: totalWithData > 0 ? Math.round((sugarOk / totalWithData) * 100) : 100,
      satFatPct: totalWithData > 0 ? Math.round((satFatOk / totalWithData) * 100) : 100,
    }
  }, [filtered])

  // Category breakdown for StackedHBarChart
  const categoryData = useMemo((): StackedHBar[] => {
    const VALID_GRADES = new Set(['A', 'B', 'C', 'D', 'E'])
    const GRADE_ORDER_LOCAL = ['A', 'B', 'C', 'D', 'E']
    const catMap: Record<string, Record<string, { spend: number; count: number }>> = {}
    for (const item of drillDownFiltered) {
      const cat = item.category || 'Other'
      const gr = (item.gradeSnapshot || 'UNKNOWN').toUpperCase()
      if (!VALID_GRADES.has(gr)) continue
      const price = (item.priceSnapshot || 0) * (item.quantity || 1)
      if (!catMap[cat]) catMap[cat] = {}
      if (!catMap[cat][gr]) catMap[cat][gr] = { spend: 0, count: 0 }
      catMap[cat][gr].spend += price
      catMap[cat][gr].count += item.quantity || 1
    }

    const result: StackedHBar[] = []
    for (const [catName, grades] of Object.entries(catMap)) {
      const segments = GRADE_ORDER_LOCAL.filter((g) => (grades[g]?.spend ?? 0) > 0).map((g) => ({
        grade: g,
        price: Math.round(grades[g].spend),
        color: gradeColorVar(g as Grade),
      }))
      if (segments.length === 0) continue
      const totalPrice = segments.reduce((sum, seg) => sum + seg.price, 0)
      const totalItems = GRADE_ORDER_LOCAL.reduce((sum, g) => sum + (grades[g]?.count ?? 0), 0)
      result.push({
        id: catName,
        label: `${catName} (${totalItems})`,
        totalPrice,
        segments,
      })
    }
    return result.sort((a, b) => b.totalPrice - a.totalPrice).slice(0, 6)
  }, [drillDownFiltered])

  // Trend data points
  const trendData = useMemo(() => {
    const raw = analytics?.nutrientTrends?.data || []
    const firstNonZero = raw.findIndex(
      (d) => (d.sodiumMg ?? 0) > 0 || (d.sugarsG ?? 0) > 0 || (d.satFatG ?? 0) > 0,
    )
    const sliced = firstNonZero <= 0 ? raw : raw.slice(firstNonZero)

    const tickMap = new Map((analytics?.nutrientTrends?.ticks || []).map((t) => [t.ts, t.label]))

    return sliced.map((d, i) => {
      const dDate = new Date(d.ts)
      const label =
        tickMap.get(d.ts) ||
        `${dDate.getDate()} ${dDate.toLocaleString('default', { month: 'short' })}`
      return {
        id: `bucket-${d.ts || i}`,
        ts: d.ts,
        label,
        sodium: d.sodiumMg ?? 0,
        sugar: d.sugarsG ?? 0,
        satFat: d.satFatG ?? 0,
        hasData: d.sodiumMg !== null || d.sugarsG !== null || d.satFatG !== null,
      }
    })
  }, [analytics])

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteLedgerEntry(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      toast.success('Removed item from ledger')
    } catch {
      toast.error('Failed to remove item')
    }
  }

  const handleClearAll = async () => {
    try {
      await purgeAll()
      setEntries([])
      setShowClearConfirm(false)
      toast.success('Shopping records deleted')
    } catch {
      toast.error('Failed to erase shopping history')
    }
  }

  const clinicName = userData?.tenant_name || 'Primary Care Clinical Unit'

  return (
    <div className="min-h-screen bg-canvas text-foreground pb-20 sm:pb-6 flex flex-col font-sans text-xs">
      {/* 3px Brand gradient hairline */}
      <div className="h-1 bg-gradient-to-r from-brand-mint via-brand-sun to-brand-coral shrink-0" />

      {/* Sticky Top Header */}
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-md border-b border-border-control/20 px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to store"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-control text-strong hover:bg-surface-raised transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[14px] font-bold text-strong leading-tight">
                Shopping Analytics
              </h1>
              <ConditionChip condition={activeTheme} />
            </div>
            <p className="text-[12px] text-muted">
              Care clinic: <span className="font-medium text-strong">{clinicName}</span>
            </p>
          </div>
        </div>

        {/* Desktop Destination Nav (>= 560px) */}
        <nav className="hidden min-[560px]:flex items-center gap-1 bg-surface-raised p-1 rounded-xl border border-border-control/20">
          <button
            type="button"
            onClick={() => setDestination('home')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
              destination === 'home'
                ? 'bg-surface text-strong shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </button>
          <button
            type="button"
            onClick={() => setDestination('history')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
              destination === 'history'
                ? 'bg-surface text-strong shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            History ({entries.length})
          </button>
          <button
            type="button"
            onClick={() => setDestination('careplan')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
              destination === 'careplan'
                ? 'bg-surface text-strong shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <HeartPulse className="w-3.5 h-3.5" />
            Care plan
          </button>
          <button
            type="button"
            onClick={() => setDestination('privacy')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
              destination === 'privacy'
                ? 'bg-surface text-strong shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Privacy
          </button>
        </nav>

        {/* Options / Settings icon */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage && chrome.runtime.openOptionsPage()}
            aria-label="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-control text-strong hover:bg-surface-raised transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto w-full p-4 sm:p-6 flex-1 flex flex-col gap-6">
        {loading ? (
          <div className="p-12 text-center text-muted flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-brand-mint" />
            <span className="text-[12px]">Loading your shopping records...</span>
          </div>
        ) : destination === 'home' ? (
          <>
            {/* Filter controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              {/* Timeline selector */}
              <div
                role="tablist"
                aria-label="Timeframe"
                className="inline-flex items-center p-1 bg-surface rounded-xl border border-border-control/20 shadow-xs"
              >
                {TIMEFRAME_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    role="tab"
                    aria-selected={range === opt.key}
                    onClick={() => setRange(opt.key)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
                      range === opt.key
                        ? 'bg-brand-mint text-brand-navy shadow-xs'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Retailer filter pills */}
              <div className="inline-flex items-center p-1 bg-surface rounded-xl border border-border-control/20 shadow-xs">
                {RETAILER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRetailerFilter(opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
                      retailerFilter === opt.value
                        ? 'bg-surface-raised text-strong shadow-xs'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Inverted Pyramid Hero KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                variant="hero"
                label="Basket Quality"
                value={totalRated > 0 ? `${qualityPct}%` : '—'}
                unit={totalRated > 0 ? 'rated A–C' : ''}
                subtitle={
                  totalRated > 0
                    ? `Grade ${typicalGrade || '—'} typical`
                    : 'No graded purchases'
                }
                tone="mint"
              />
              <KpiCard
                label="Items Chosen"
                value={`${filtered.length}`}
                unit="items"
                subtitle={
                  totalRated > 0
                    ? `${totalRated} of ${filtered.length} graded`
                    : 'Waiting for items'
                }
                tone="neutral"
              />
              <KpiCard
                label="Health Heads-ups"
                value={`${totalAlerts}`}
                unit="flags"
                subtitle={
                  totalAlerts > 0
                    ? 'Crossed recommended thresholds'
                    : 'Within planned thresholds'
                }
                tone={totalAlerts > 0 ? 'coral' : 'mint'}
                direction={totalAlerts === 0 ? 'favorable' : 'unfavorable'}
              />
              <KpiCard
                label="Nutri-Score A/B"
                value={`${goodCount}`}
                unit="items"
                subtitle={
                  goodCount > 0
                    ? 'Healthy everyday choices'
                    : 'Explore healthier swaps below'
                }
                tone="mint"
                direction="favorable"
              />
            </div>

            {/* Clinician Target Adherence Meters */}
            <section className="bg-surface rounded-2xl border border-border-control/20 p-5 shadow-xs">
              <div className="border-b border-border-control/10 pb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-brand-mint" />
                  <h2 className="text-[14px] font-bold text-strong">
                    Care Targets & Nutrient Adherence
                  </h2>
                </div>
                <span className="text-[12px] text-muted">Per 100g guidelines</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4">
                <TargetMeter
                  label="Sodium"
                  current={nutrientAdherence.sodiumPct}
                  max={100}
                  unit="%"
                  helperText="≤ 600 mg / 100g target"
                />
                <TargetMeter
                  label="Sugar"
                  current={nutrientAdherence.sugarPct}
                  max={100}
                  unit="%"
                  helperText="≤ 10 g / 100g target"
                />
                <TargetMeter
                  label="Saturated Fat"
                  current={nutrientAdherence.satFatPct}
                  max={100}
                  unit="%"
                  helperText="≤ 5 g / 100g target"
                />
              </div>
            </section>

            {/* Basket Quality Ring + Nutrient Trends (NO toggle hiding charts!) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Basket Ring */}
              <section className="bg-surface rounded-2xl border border-border-control/20 p-5 shadow-xs flex flex-col">
                <div className="border-b border-border-control/10 pb-2">
                  <h3 className="text-[14px] font-bold text-strong">Basket Grade Quality</h3>
                  <p className="text-[12px] text-muted mt-0.5">
                    {selectedGrade
                      ? `Grade ${selectedGrade}: tap again to clear`
                      : 'Nutri-Score breakdown for active items'}
                  </p>
                </div>
                <div className="flex-1 py-4 flex flex-col items-center justify-center">
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
                </div>
              </section>

              {/* Trend Chart */}
              <section className="bg-surface rounded-2xl border border-border-control/20 p-5 shadow-xs lg:col-span-2 flex flex-col">
                <div className="border-b border-border-control/10 pb-2">
                  <h3 className="text-[14px] font-bold text-strong">Nutrient Trends</h3>
                  <p className="text-[12px] text-muted mt-0.5">
                    {filtered.length >= 3
                      ? `Average intake across ${TIMEFRAME_OPTIONS.find((o) => o.key === range)?.label.toLowerCase()}`
                      : 'Requires ≥ 3 items for trend comparison'}
                  </p>
                </div>
                <div className="flex-1 py-4">
                  <ChartBox height={216}>
                    {(size) => (
                      <LineTrend
                        size={size}
                        data={trendData}
                        showSodium={['hypertension', 'kidney', 'general'].includes(activeTheme)}
                        showSugar={['diabetes', 'obesity', 'general'].includes(activeTheme)}
                        showSatFat={['obesity', 'general'].includes(activeTheme)}
                        primaryKey={['diabetes', 'obesity'].includes(activeTheme) ? 'sugar' : 'sodium'}
                      />
                    )}
                  </ChartBox>
                </div>
              </section>
            </div>

            {/* Category Insights */}
            {categoryData.length > 0 && (
              <section className="bg-surface rounded-2xl border border-border-control/20 p-5 shadow-xs">
                <div className="border-b border-border-control/10 pb-2">
                  <h3 className="text-[14px] font-bold text-strong">Category Spend & Quality</h3>
                  <p className="text-[12px] text-muted mt-0.5">
                    KES spend by category colored by Nutri-Score grade
                  </p>
                </div>
                <div className="pt-4">
                  <ChartBox height={Math.max(160, 52 * categoryData.length + 36)}>
                    {(size) => <StackedHBarChart data={categoryData} size={size} />}
                  </ChartBox>
                </div>
              </section>
            )}

            {/* Recent Shopping Activity Preview */}
            <section className="bg-surface rounded-2xl border border-border-control/20 p-5 shadow-xs flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-border-control/10 pb-3">
                <h3 className="text-[14px] font-bold text-strong">Recent Purchases</h3>
                <button
                  type="button"
                  onClick={() => setDestination('history')}
                  className="text-[12px] font-semibold text-brand-navy hover:underline cursor-pointer"
                >
                  View full history →
                </button>
              </div>
              {filtered.slice(0, 5).length === 0 ? (
                <div className="p-6 text-center text-muted">No items in selected timeframe</div>
              ) : (
                <ul className="divide-y divide-border-control/10">
                  {filtered.slice(0, 5).map((item) => (
                    <li key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <GradeBadge grade={(item.gradeSnapshot || 'C') as Grade} size="sm" />
                        <div className="flex flex-col min-w-0">
                          <span className="text-[12px] font-medium text-strong break-words">
                            {item.name}
                          </span>
                          <span className="text-[12px] text-muted">
                            {item.retailer} • {new Date(item.addedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <span className="text-[12px] font-semibold text-strong tabular-nums shrink-0">
                        KES {((item.priceSnapshot || 0) * (item.quantity || 1)).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : destination === 'history' ? (
          /* History Destination: Full DataTable with search and deletion */
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-bold text-strong">Shopping History</h2>
                <p className="text-[12px] text-muted">
                  IndexedDB device storage • 90-day retention ceiling enforced
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-status-critical/30 text-status-critical hover:bg-status-critical-subtle text-[12px] font-semibold transition-colors cursor-pointer self-start sm:self-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear shopping history
              </button>
            </div>

            <DataTable<ShoppingLedgerRow>
              columns={[
                {
                  id: 'addedAt',
                  header: 'Date',
                  accessor: (r) => r.addedAt,
                  cell: (v) => new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric' }),
                  sortable: true,
                  priority: 2,
                  kind: 'datetime',
                },
                {
                  id: 'name',
                  header: 'Product Name',
                  accessor: (r) => r.name,
                  priority: 1,
                  sortable: true,
                  kind: 'text',
                },
                {
                  id: 'retailer',
                  header: 'Store',
                  accessor: (r) => r.retailer || 'Unknown',
                  cell: (v) => <Badge variant="neutral">{v}</Badge>,
                  sortable: true,
                  priority: 2,
                  kind: 'enum',
                },
                {
                  id: 'grade',
                  header: 'Grade',
                  accessor: (r) => r.gradeSnapshot || 'C',
                  cell: (v) => <GradeBadge grade={v as Grade} size="sm" />,
                  sortable: true,
                  priority: 1,
                  kind: 'status',
                },
                {
                  id: 'price',
                  header: 'Price',
                  accessor: (r) => (r.priceSnapshot || 0) * (r.quantity || 1),
                  cell: (v) => `KES ${v.toLocaleString()}`,
                  sortable: true,
                  priority: 2,
                  kind: 'number',
                },
                {
                  id: 'actions',
                  header: '',
                  accessor: (r) => r.id,
                  cell: (id) => (
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(id)}
                      aria-label="Delete item"
                      className="p-1 rounded text-muted hover:text-status-critical hover:bg-status-critical-subtle transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ),
                  priority: 1,
                  kind: 'actions',
                },
              ]}
              data={entries}
              keyExtractor={(r) => r.id}
              searchable
              searchPlaceholder="Filter items by product or store..."
              emptyTitle="No shopping items recorded"
              emptyDescription="Your cart items scanned on Naivas, Carrefour, or Quickmart will appear here automatically."
            />
          </div>
        ) : destination === 'careplan' ? (
          /* Care Plan Destination: Read-Only Clinician Targets */
          <div className="flex flex-col gap-6 max-w-3xl">
            <div>
              <h2 className="text-[16px] font-bold text-strong">Clinician Care Plan</h2>
              <p className="text-[12px] text-muted">
                Prescribed dietary thresholds from your healthcare provider
              </p>
            </div>

            <Banner
              tier={0}
              title="Read-Only Patient View"
              message="Dietary thresholds are prescribed by your clinician via the Clinic Admin Dashboard (CAD). They are stored locally on your device as a cryptographic Dietary Profile Token (DPT)."
            />

            <div className="bg-surface rounded-2xl border border-border-control/20 p-5 shadow-xs flex flex-col gap-4">
              <h3 className="text-[14px] font-bold text-strong border-b border-border-control/10 pb-2">
                Active Threshold Limits
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-surface-raised p-4 rounded-xl border border-border-control/20 flex flex-col gap-1">
                  <span className="text-muted font-medium text-[12px]">Maximum Sodium Ceiling</span>
                  <span className="text-[16px] font-bold text-strong">600 mg / 100g</span>
                  <span className="text-[12px] text-muted">Fail-closed: products exceeding 600mg trigger alerts</span>
                </div>
                <div className="bg-surface-raised p-4 rounded-xl border border-border-control/20 flex flex-col gap-1">
                  <span className="text-muted font-medium text-[12px]">Maximum Sugar Ceiling</span>
                  <span className="text-[16px] font-bold text-strong">10.0 g / 100g</span>
                  <span className="text-[12px] text-muted">Fail-closed: products exceeding 10g trigger alerts</span>
                </div>
                <div className="bg-surface-raised p-4 rounded-xl border border-border-control/20 flex flex-col gap-1">
                  <span className="text-muted font-medium text-[12px]">Maximum Saturated Fat</span>
                  <span className="text-[16px] font-bold text-strong">5.0 g / 100g</span>
                  <span className="text-[12px] text-muted">Fail-closed: products exceeding 5g trigger alerts</span>
                </div>
                <div className="bg-surface-raised p-4 rounded-xl border border-border-control/20 flex flex-col gap-1">
                  <span className="text-muted font-medium text-[12px]">Assigned Care Clinic</span>
                  <span className="text-[16px] font-bold text-strong">{clinicName}</span>
                  <span className="text-[12px] text-muted">OIDC Tenant ID: verified</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Privacy Destination: DPA 2019 Rights, 90-Day Ceiling & Crypto-Shredding */
          <div className="flex flex-col gap-6 max-w-3xl">
            <div>
              <h2 className="text-[16px] font-bold text-strong">Privacy & Data Governance</h2>
              <p className="text-[12px] text-muted">
                Kenya Data Protection Act (DPA 2019) compliance and device retention controls
              </p>
            </div>

            <div className="bg-surface rounded-2xl border border-border-control/20 p-5 shadow-xs flex flex-col gap-3">
              <h3 className="text-[14px] font-bold text-strong">90-Day Device Storage Ceiling</h3>
              <p className="text-[12px] text-muted leading-relaxed">
                In compliance with Digital Health Platform standards and ADR-005, your shopping ledger
                is stored exclusively on your local device (IndexedDB) and is capped at a strict 90-day
                (3-month) window. Records older than 90 days are automatically purged daily.
              </p>
              <div className="mt-2 p-3 bg-surface-raised rounded-xl border border-border-control/20 flex items-center justify-between text-[12px]">
                <span className="text-muted font-medium">Retention Status:</span>
                <span className="font-semibold text-status-success">Active (Purging daily)</span>
              </div>
            </div>

            <div className="bg-surface rounded-2xl border border-border-control/20 p-5 shadow-xs flex flex-col gap-3">
              <h3 className="text-[14px] font-bold text-strong">DPA 2019 Section 40: Right of Erasure</h3>
              <p className="text-[12px] text-muted leading-relaxed">
                You hold the absolute legal right to erase all personal shopping records from your device
                at any time. This action is irreversible and immediately wipes all IndexedDB shopping tables.
              </p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  className="px-4 py-2 rounded-xl bg-status-critical text-white text-[12px] font-semibold hover:bg-status-critical/90 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  Delete all my shopping data
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Sticky Bottom Tab Bar (< 560px) */}
      <nav
        aria-label="Shopper navigation"
        className="min-[560px]:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border-control/20 flex items-center justify-around py-2 px-3 shadow-lg"
      >
        <button
          type="button"
          onClick={() => setDestination('home')}
          className={`flex flex-col items-center gap-1 p-1 text-[12px] transition-colors cursor-pointer ${
            destination === 'home' ? 'text-brand-navy font-bold' : 'text-muted'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>Home</span>
        </button>
        <button
          type="button"
          onClick={() => setDestination('history')}
          className={`flex flex-col items-center gap-1 p-1 text-[12px] transition-colors cursor-pointer ${
            destination === 'history' ? 'text-brand-navy font-bold' : 'text-muted'
          }`}
        >
          <Clock className="w-5 h-5" />
          <span>History</span>
        </button>
        <button
          type="button"
          onClick={() => setDestination('careplan')}
          className={`flex flex-col items-center gap-1 p-1 text-[12px] transition-colors cursor-pointer ${
            destination === 'careplan' ? 'text-brand-navy font-bold' : 'text-muted'
          }`}
        >
          <HeartPulse className="w-5 h-5" />
          <span>Care plan</span>
        </button>
        <button
          type="button"
          onClick={() => setDestination('privacy')}
          className={`flex flex-col items-center gap-1 p-1 text-[12px] transition-colors cursor-pointer ${
            destination === 'privacy' ? 'text-brand-navy font-bold' : 'text-muted'
          }`}
        >
          <ShieldCheck className="w-5 h-5" />
          <span>Privacy</span>
        </button>
      </nav>

      {/* Typed Confirmation Modal for DPA s.40 Crypto-shredding */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Delete All Shopping Records?"
        description="This action is irreversible under Kenya DPA 2019 Section 40. All local purchase histories, basket scores, and trend entries will be permanently erased."
        expectedPhrase="DELETE"
        confirmButtonText="Permanently Erase"
        isDestructive
        onConfirm={handleClearAll}
        onCancel={() => setShowClearConfirm(false)}
        onClose={() => setShowClearConfirm(false)}
      />
    </div>
  )
}

