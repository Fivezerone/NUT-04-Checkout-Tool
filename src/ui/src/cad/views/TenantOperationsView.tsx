import { CalendarClock, ClipboardCheck, UserCheck, Users } from 'lucide-react'
import { MetricCard, PageHeader, StatusBadge } from '../components/Primitives'
import { useCadAuth } from '../context/AuthContext'

export function TenantOperationsView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { activeTenant } = useCadAuth()
  return <div className="space-y-6">
    <PageHeader eyebrow="Tenant operations" title="Run the clinic with fewer hand-offs" description={<>Staff access, clinical capacity, and care-enrollment work for <strong>{activeTenant?.name || 'this tenant'}</strong>.</>} actions={<button className="ui-button ui-button-primary" onClick={() => onNavigate('users')}>Manage staff</button>} />
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Active staff" value="18" detail="Two invitations await acceptance" icon={Users} tone="info" /><MetricCard label="Licences due" value="2" detail="Review before the next shift" icon={CalendarClock} tone="warning" /><MetricCard label="Patient links" value="97" detail="Consent-confirmed clinician links" icon={UserCheck} tone="success" /><MetricCard label="Care tasks" value="6" detail="Assignments awaiting triage" icon={ClipboardCheck} tone="warning" /></section>
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <article className="ui-card p-4 xl:col-span-2"><h2 className="font-bold text-[color:var(--color-text-strong)]">Today’s operational queue</h2><div className="mt-4 grid gap-3">{[['Licence verification', '2 clinician credentials need validation', 'warning', 'users'], ['Consent review', '1 patient link has not been confirmed', 'info', 'consent'], ['Billing review', 'Your current plan includes cohort analytics', 'success', 'billing']].map(([title, detail, tone, tab]) => <button key={title} className="flex items-center justify-between gap-4 rounded-lg border border-[color:var(--color-border-subtle)] p-3 text-left hover:bg-[color:var(--color-canvas-subtle)]" onClick={() => onNavigate(tab)}><span><span className="block font-semibold text-[color:var(--color-text-strong)]">{title}</span><span className="mt-1 block text-sm text-[color:var(--color-text-muted)]">{detail}</span></span><StatusBadge tone={tone as 'warning' | 'info' | 'success'}>Review</StatusBadge></button>)}</div></article>
      <aside className="ui-card p-4"><p className="ui-eyebrow">Capacity</p><p className="mt-2 text-2xl font-bold text-[color:var(--color-text-strong)]">74% used</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]"><div className="h-full w-3/4 rounded-full bg-[color:var(--color-brand)]" /></div><p className="mt-3 text-sm text-[color:var(--color-text-muted)]">Patient-support capacity remains within the tenant plan.</p></aside>
    </section>
  </div>
}
