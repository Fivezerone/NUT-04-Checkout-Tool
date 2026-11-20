// src/ui/src/cad/views/DieticianInsightsView.tsx
import { BarChart3, CalendarDays, LineChart, Users } from 'lucide-react'
import { ChartBox } from '../../app/components/ChartBox'
import { LineTrend, type TrendPoint } from '../../app/components/charts/Charts'
import { MetricCard, PageHeader, StatusBadge } from '../components/Primitives'

interface DieticianInsightsProps {
  onNavigate: (tab: string) => void
  cohortTrend?: TrendPoint[]
}

export function DieticianInsightsView({ onNavigate, cohortTrend = [] }: DieticianInsightsProps) {
  const hasData = cohortTrend.length > 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Read-only nutrition insights"
        title="See dietary change over time"
        description="Longitudinal trends are paired with plain-language summaries and remain read-only for dietetic review."
        actions={
          <button className="ui-button ui-button-secondary" onClick={() => onNavigate('consent')}>
            Review data scope
          </button>
        }
      />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Tracked cohorts"
          value={hasData ? String(cohortTrend.length) : '—'}
          detail={hasData ? 'Within authorized scope' : 'No cohort data connected'}
          icon={Users}
          tone="info"
        />
        <MetricCard
          label="Trend direction"
          value={hasData ? 'Active' : '—'}
          detail={hasData ? 'Derived from consented events' : 'No longitudinal events recorded'}
          icon={LineChart}
          tone={hasData ? 'success' : 'neutral'}
        />
        <MetricCard
          label="Review cadence"
          value="Weekly"
          detail="Scheduled clinical dietetic review"
          icon={CalendarDays}
          tone="neutral"
        />
      </section>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className="ui-card p-4 xl:col-span-2">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
            <div>
              <h2 className="font-bold text-[color:var(--color-text-strong)]">
                Nutrient trajectory
              </h2>
              <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
                Sodium is the focal line; sugar is shown as supporting context.
              </p>
            </div>
            {hasData && <StatusBadge tone="success">Active trend</StatusBadge>}
          </div>
          <div className="mt-4">
            {hasData ? (
              <ChartBox height={280}>
                {(size) => (
                  <LineTrend
                    data={cohortTrend}
                    size={size}
                    showSodium
                    showSugar
                    primaryKey="sodium"
                  />
                )}
              </ChartBox>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--color-border-subtle)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
                <BarChart3 className="mb-2 h-8 w-8 text-[color:var(--color-text-muted)]" />
                <p className="font-semibold text-[color:var(--color-text-strong)]">
                  No cohort trend data available
                </p>
                <p className="mt-1 max-w-sm text-xs">
                  Longitudinal dietetic trends will populate as linked patients sync consented
                  grocery purchase events.
                </p>
              </div>
            )}
          </div>
        </article>
        <aside className="ui-card p-4">
          <div className="flex items-center gap-2">
            <span className="metric-icon metric-icon-info">
              <BarChart3 size={20} />
            </span>
            <h2 className="font-bold text-[color:var(--color-text-strong)]">Interpretation</h2>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="ui-eyebrow">Data source</dt>
              <dd className="mt-1 font-semibold text-[color:var(--color-text-strong)]">
                Consented shopping ledger
              </dd>
            </div>
            <div>
              <dt className="ui-eyebrow">Status</dt>
              <dd className="mt-1 text-[color:var(--color-text-muted)]">
                {hasData
                  ? 'Active cohort measurements available.'
                  : 'Awaiting initial cohort sync.'}
              </dd>
            </div>
            <div>
              <dt className="ui-eyebrow">Data handling</dt>
              <dd className="mt-1 text-[color:var(--color-text-muted)]">
                Metrics are derived from consented shopping events only.
              </dd>
            </div>
          </dl>
        </aside>
      </section>
    </div>
  )
}
