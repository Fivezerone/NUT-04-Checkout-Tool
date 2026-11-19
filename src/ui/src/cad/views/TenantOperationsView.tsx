// src/ui/src/cad/views/TenantOperationsView.tsx
import { useEffect, useState } from 'react'
import { CalendarClock, ClipboardCheck, UserCheck, Users } from 'lucide-react'
import { MetricCard, PageHeader, StatusBadge } from '../components/Primitives'
import { useCadAuth } from '../context/AuthContext'
import { cadApi, type TenantMember } from '../api/cad-api'

export function TenantOperationsView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { activeTenant } = useCadAuth()
  const [members, setMembers] = useState<TenantMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    if (activeTenant?.id) {
      cadApi
        .getMembers(activeTenant.id)
        .then((data) => {
          if (mounted) {
            setMembers(data || [])
            setLoading(false)
          }
        })
        .catch(() => {
          if (mounted) {
            setMembers([])
            setLoading(false)
          }
        })
    } else {
      setLoading(false)
    }
    return () => {
      mounted = false
    }
  }, [activeTenant?.id])

  const activeStaff = members.filter((m) => m.status === 'active').length
  const pendingInvites = members.filter((m) => m.status === 'invited').length
  const licencesDue = members.filter((m) => !m.licence_verified || m.status === 'invited').length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tenant operations"
        title="Run the clinic with fewer hand-offs"
        description={
          <>
            Staff access, clinical capacity, and care-enrollment work for{' '}
            <strong>{activeTenant?.name || 'this tenant'}</strong>.
          </>
        }
        actions={
          <button className="ui-button ui-button-primary" onClick={() => onNavigate('users')}>
            Manage staff
          </button>
        }
      />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active staff"
          value={loading ? '…' : String(activeStaff)}
          detail={
            pendingInvites > 0
              ? `${pendingInvites} invitation(s) await acceptance`
              : 'All staff active'
          }
          icon={Users}
          tone="info"
        />
        <MetricCard
          label="Licences due"
          value={loading ? '…' : String(licencesDue)}
          detail={
            licencesDue > 0
              ? 'Credentials pending validation'
              : 'All credentials in order'
          }
          icon={CalendarClock}
          tone={licencesDue > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="Patient links"
          value="—"
          detail="Consent-confirmed clinician links"
          icon={UserCheck}
          tone="neutral"
        />
        <MetricCard
          label="Care tasks"
          value="—"
          detail="Assignments awaiting triage"
          icon={ClipboardCheck}
          tone="neutral"
        />
      </section>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className="ui-card p-4 xl:col-span-2">
          <h2 className="font-bold text-[color:var(--color-text-strong)]">
            Today’s operational queue
          </h2>
          <div className="mt-4 grid gap-3">
            {[
              [
                'Licence verification',
                licencesDue > 0
                  ? `${licencesDue} clinician credential(s) need validation`
                  : 'Zero pending licence checks',
                licencesDue > 0 ? 'warning' : 'neutral',
                'users',
              ],
              [
                'Consent review',
                'Patient linking and consent authorization queue',
                'info',
                'consent',
              ],
              [
                'Billing review',
                'Your current plan includes cohort analytics',
                'success',
                'billing',
              ],
            ].map(([title, detail, tone, tab]) => (
              <button
                key={title}
                className="flex items-center justify-between gap-4 rounded-lg border border-[color:var(--color-border-subtle)] p-3 text-left hover:bg-[color:var(--color-canvas-subtle)]"
                onClick={() => onNavigate(tab)}
              >
                <span>
                  <span className="block font-semibold text-[color:var(--color-text-strong)]">
                    {title}
                  </span>
                  <span className="mt-1 block text-sm text-[color:var(--color-text-muted)]">
                    {detail}
                  </span>
                </span>
                <StatusBadge tone={tone as 'warning' | 'info' | 'success'}>Review</StatusBadge>
              </button>
            ))}
          </div>
        </article>
        <aside className="ui-card p-4">
          <p className="ui-eyebrow">Capacity</p>
          <p className="mt-2 text-2xl font-bold text-[color:var(--color-text-strong)]">
            Active
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
            <div className="h-full w-full rounded-full bg-[color:var(--color-brand)]" />
          </div>
          <p className="mt-3 text-sm text-[color:var(--color-text-muted)]">
            Patient-support capacity remains within the tenant plan.
          </p>
        </aside>
      </section>
    </div>
  )
}
