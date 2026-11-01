import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react'
import { useCadAuth } from '../context/AuthContext'

const HEALTH_COPY = {
  super_admin: { tone: 'info', message: 'Platform telemetry is available. Review tenant exceptions before making configuration changes.', icon: Info },
  tenant_admin: { tone: 'warning', message: 'Two staff licences need review before their next clinical shift.', icon: AlertTriangle },
  writing_clinician: { tone: 'critical', message: 'Six dietary threshold breaches require clinical review today.', icon: ShieldAlert },
  viewing_dietician: { tone: 'info', message: 'Trend data is read-only and reflects the latest consented shopping events.', icon: Info },
  compliance_auditor: { tone: 'success', message: 'Audit-chain continuity is currently verified for this tenant.', icon: CheckCircle2 },
  commercial_stakeholder: { tone: 'info', message: 'Commercial reporting is aggregate-only; small cohorts remain protected.', icon: Info },
  patient: { tone: 'success', message: 'Your care profile is active. You control which data you share with your clinic.', icon: CheckCircle2 },
} as const

export function SystemHealthBanner() {
  const { claims } = useCadAuth()
  const { tone, message, icon: Icon } = HEALTH_COPY[claims.role]
  return <div className={`cad-health-banner cad-health-banner-${tone}`} role={tone === 'critical' ? 'alert' : 'status'}><Icon size={18} aria-hidden="true" /><span>{message}</span></div>
}
