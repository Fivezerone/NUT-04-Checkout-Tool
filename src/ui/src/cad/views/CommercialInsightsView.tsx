// src/ui/src/cad/views/CommercialInsightsView.tsx
import { BarChart3, ShieldCheck, TrendingUp, UsersRound } from 'lucide-react'
import { MetricCard, PageHeader } from '../components/Primitives'

interface CommercialInsightsProps {
  programmes?: Array<{ label: string; adherencePct: number }>
}

export function CommercialInsightsView({ programmes = [] }: CommercialInsightsProps) {
  const hasData = programmes.length > 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Commercial intelligence"
        title="Aggregate adoption, without patient exposure"
        description="Executive reporting is privacy-preserving by design. Small cohorts are suppressed before any metric reaches this workspace."
      />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active cohorts"
          value={hasData ? String(programmes.length) : '—'}
          detail={hasData ? 'Cohorts meeting reporting threshold' : 'No aggregate cohorts connected'}
          icon={UsersRound}
          tone="info"
        />
        <MetricCard
          label="Target adherence"
          value={
            hasData
              ? `${Math.round(
                  programmes.reduce((acc, p) => acc + p.adherencePct, 0) / programmes.length,
                )}%`
              : '—'
          }
          detail="Aggregate clinical programme measure"
          icon={TrendingUp}
          tone={hasData ? 'success' : 'neutral'}
        />
        <MetricCard
          label="Privacy status"
          value="Protected"
          detail="Small-cell threshold enforced"
          icon={ShieldCheck}
          tone="success"
        />
        <MetricCard
          label="Revenue source"
          value="—"
          detail="No financial data feed connected"
          icon={BarChart3}
          tone="neutral"
        />
      </section>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className="ui-card p-4 xl:col-span-2">
          <h2 className="font-bold text-[color:var(--color-text-strong)]">
            Programme adoption
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
            Only aggregate cohort counts and compliance measures are available in this role.
          </p>
          <div className="mt-5 space-y-4">
            {hasData ? (
              programmes.map((p) => (
                <div key={p.label}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-[color:var(--color-text-strong)]">
                      {p.label}
                    </span>
                    <span className="text-xs font-semibold text-[color:var(--color-text-muted)]">
                      {p.adherencePct}% adherence
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
                    <div
                      className="h-full rounded-full bg-[color:var(--color-brand)]"
                      style={{ width: `${p.adherencePct}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-[color:var(--color-border-subtle)] p-6 text-center text-sm text-[color:var(--color-text-muted)]">
                No active programme adoption data connected.
              </div>
            )}
          </div>
        </article>
        <aside className="ui-card p-4">
          <p className="ui-eyebrow">Reporting scope</p>
          <h2 className="mt-1 font-bold text-[color:var(--color-text-strong)]">Safe by default</h2>
          <ul className="mt-4 space-y-3 text-sm text-[color:var(--color-text-muted)]">
            <li>• Patient references never enter commercial reports.</li>
            <li>• Cohorts below the tenant’s small-cell threshold are withheld.</li>
            <li>• Revenue and conversion remain unavailable until an approved source is connected.</li>
          </ul>
        </aside>
      </section>
    </div>
  )
}
