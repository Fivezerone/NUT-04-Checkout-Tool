import { BarChart3, CalendarDays, LineChart, Users } from 'lucide-react'
import { ChartBox } from '../../app/components/ChartBox'
import { LineTrend, type TrendPoint } from '../../app/components/charts/Charts'
import { MetricCard, PageHeader, StatusBadge } from '../components/Primitives'

const TREND: TrendPoint[] = [
  { id: 'week-1', label: 'W1', sodium: 640, sugar: 21, satFat: 8 },
  { id: 'week-2', label: 'W2', sodium: 590, sugar: 18, satFat: 7 },
  { id: 'week-3', label: 'W3', sodium: 530, sugar: 16, satFat: 6 },
  { id: 'week-4', label: 'W4', sodium: 510, sugar: 15, satFat: 6 },
]

export function DieticianInsightsView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  return <div className="space-y-6">
    <PageHeader eyebrow="Read-only nutrition insights" title="See dietary change over time" description="Longitudinal trends are paired with plain-language summaries and remain read-only for dietetic review." actions={<button className="ui-button ui-button-secondary" onClick={() => onNavigate('consent')}>Review data scope</button>} />
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3"><MetricCard label="Tracked cohorts" value="4" detail="All within authorised scope" icon={Users} tone="info" /><MetricCard label="Trend direction" value="Improving" detail="Sodium is lower over four weeks" icon={LineChart} tone="success" /><MetricCard label="Next review" value="7 days" detail="Scheduled clinical dietetic review" icon={CalendarDays} tone="neutral" /></section>
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-3"><article className="ui-card p-4 xl:col-span-2"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start"><div><h2 className="font-bold text-[color:var(--color-text-strong)]">Four-week nutrient trajectory</h2><p className="mt-1 text-sm text-[color:var(--color-text-muted)]">Sodium is the focal line; sugar is shown as supporting context. Hover or use the chart controls to inspect a week.</p></div><StatusBadge tone="success">Lower sodium trend</StatusBadge></div><div className="mt-4"><ChartBox height={280}>{(size) => <LineTrend data={TREND} size={size} showSodium showSugar primaryKey="sodium" />}</ChartBox></div></article><aside className="ui-card p-4"><div className="flex items-center gap-2"><span className="metric-icon metric-icon-info"><BarChart3 size={20} /></span><h2 className="font-bold text-[color:var(--color-text-strong)]">Interpretation</h2></div><dl className="mt-4 space-y-3 text-sm"><div><dt className="ui-eyebrow">Sodium</dt><dd className="mt-1 font-semibold text-[color:var(--color-text-strong)]">130 mg lower than week one</dd></div><div><dt className="ui-eyebrow">Sugar</dt><dd className="mt-1 font-semibold text-[color:var(--color-text-strong)]">6 g lower than week one</dd></div><div><dt className="ui-eyebrow">Data handling</dt><dd className="mt-1 text-[color:var(--color-text-muted)]">Numbers are derived from consented shopping events only.</dd></div></dl></aside></section>
  </div>
}
