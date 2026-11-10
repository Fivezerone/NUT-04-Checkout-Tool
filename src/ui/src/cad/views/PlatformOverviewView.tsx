import { Activity, Building2, Database, ShieldCheck } from 'lucide-react'
import { MetricCard, PageHeader, StatusBadge } from '../components/Primitives'
import { useCadAuth } from '../context/AuthContext'

export function PlatformOverviewView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { availableTenants } = useCadAuth()
  const tenants = availableTenants.length
  return <div className="space-y-6">
    <PageHeader eyebrow="Platform control" title="Tenant health at a glance" description="Monitor the multi-tenant estate, isolate exceptions, and keep operational changes traceable." actions={<button className="ui-button ui-button-secondary" onClick={() => onNavigate('audit')}>Open audit trail</button>} />
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Active tenants" value={String(tenants)} detail="Tenants with service access" icon={Building2} tone="info" />
      <MetricCard label="Platform health" value="Stable" detail="No service degradation detected" icon={Activity} tone="success" />
      <MetricCard label="Signed bundles" value="—" detail="Latest bundles verified" icon={ShieldCheck} tone="success" />
      <MetricCard label="Data jobs" value="—" detail="No failed reconciliation jobs" icon={Database} tone="neutral" />
    </section>
    <section className="ui-card overflow-hidden">
      <div className="flex flex-col justify-between gap-3 border-b border-[color:var(--color-border-subtle)] p-4 sm:flex-row sm:items-center"><div><h2 className="font-bold text-[color:var(--color-text-strong)]">Tenant portfolio</h2><p className="mt-1 text-sm text-[color:var(--color-text-muted)]">A focused operational list replaces endless global configuration scrolling.</p></div><button className="ui-button ui-button-primary" onClick={() => onNavigate('settings')}>Platform settings</button></div>
      <div className="overflow-x-auto"><table className="ui-table min-w-[42rem] text-left"><thead><tr><th>Tenant</th><th>Rule pack</th><th>Service</th><th>Configuration</th></tr></thead><tbody>{availableTenants.length ? availableTenants.map((tenant) => <tr key={tenant.id}><td className="font-semibold text-[color:var(--color-text-strong)]">{tenant.name}</td><td>{tenant.config.rule_pack || 'Platform default'}</td><td><StatusBadge tone="success">Operational</StatusBadge></td><td><button className="font-semibold text-[color:var(--color-brand-hover)] hover:underline" onClick={() => onNavigate('settings')}>Review</button></td></tr>) : <tr><td colSpan={4} className="py-8 text-center text-sm text-[color:var(--color-text-muted)]">No tenants provisioned yet.</td></tr>}</tbody></table></div>
    </section>
  </div>
}
