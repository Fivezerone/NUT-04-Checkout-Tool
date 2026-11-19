// src/ui/src/cad/views/PatientCareSummaryView.tsx
import { HeartPulse, ShieldCheck } from 'lucide-react'
import { MetricCard, PageHeader, StatusBadge } from '../components/Primitives'
import { useCadAuth } from '../context/AuthContext'

export function PatientCareSummaryView() {
  const { user, claims } = useCadAuth()
  const hasUser = Boolean(user)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Care access"
        title="Your clinical nutrition support"
        description="Use the shopper dashboard for checkout guidance. This clinical area keeps your care profile and data-sharing state clear."
      />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard
          label="Care profile"
          value={hasUser ? 'Active' : 'Unlinked'}
          detail={
            hasUser
              ? `Enrolled as ${user?.email || 'patient'}`
              : 'Sign in to access assigned clinician targets'
          }
          icon={HeartPulse}
          tone={hasUser ? 'success' : 'neutral'}
        />
        <MetricCard
          label="Data sharing"
          value={hasUser ? 'Protected' : 'Local only'}
          detail="Your consent choices determine clinical visibility"
          icon={ShieldCheck}
          tone="info"
        />
      </section>
      <section className="ui-card p-4">
        <StatusBadge tone={hasUser ? 'success' : 'neutral'}>
          {hasUser ? 'Care profile active' : 'Local shopper mode'}
        </StatusBadge>
        <h2 className="mt-3 text-xl font-bold text-[color:var(--color-text-strong)]">
          Continue in your shopper dashboard
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--color-text-muted)]">
          Checkout guidance uses short, clear actions and your selected health mode.
          Clinical administration remains separate from your shopper experience.
        </p>
      </section>
    </div>
  )
}
