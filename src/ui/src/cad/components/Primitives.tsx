import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export type StatusTone = 'critical' | 'warning' | 'success' | 'info' | 'neutral'

const STATUS_CLASS: Record<StatusTone, string> = {
  critical: 'ui-status-critical',
  warning: 'ui-status-warning',
  success: 'ui-status-success',
  info: 'ui-status-info',
  neutral: 'ui-status-neutral',
}

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`ui-status ${STATUS_CLASS[tone]}`}>{children}</span>
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ui-page-header">
      <div>
        <p className="ui-eyebrow">{eyebrow}</p>
        <h1 className="mt-1 text-[length:var(--text-page)] leading-[var(--leading-page)] font-bold text-[color:var(--color-text-strong)]">{title}</h1>
        <div className="mt-1 max-w-3xl text-[length:var(--text-body)] leading-[var(--leading-body)] text-[color:var(--color-text-muted)]">{description}</div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function MetricCard({ label, value, detail, icon: Icon, tone = 'neutral' }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: StatusTone }) {
  return (
    <article className="ui-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="ui-eyebrow">{label}</p>
          <p className="mt-2 text-[length:var(--text-display)] leading-none font-bold text-[color:var(--color-text-strong)]">{value}</p>
        </div>
        <span className={`metric-icon metric-icon-${tone}`} aria-hidden="true"><Icon size={20} strokeWidth={2.25} /></span>
      </div>
      <p className="mt-3 text-[length:var(--text-caption)] leading-[var(--leading-caption)] text-[color:var(--color-text-muted)]">{detail}</p>
    </article>
  )
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="ui-card px-4 py-8 text-center"><p className="font-bold text-[color:var(--color-text-strong)]">{title}</p><p className="mt-1 text-sm text-[color:var(--color-text-muted)]">{detail}</p></div>
}
