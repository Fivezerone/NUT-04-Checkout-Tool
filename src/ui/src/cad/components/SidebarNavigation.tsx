import type { ComponentType } from 'react'
import { Activity, Building2, CreditCard, FileText, HeartPulse, Link2, Settings, ShieldCheck, UserCheck, X } from 'lucide-react'
import type { CadRole } from '../types'
import { getCadNavigationIds, type CadNavigationId } from '../navigation'

type NavIcon = ComponentType<{ className?: string; size?: number }>
export interface CadNavigationItem { id: string; label: string; icon: NavIcon }

const ALL_ITEMS: Record<CadNavigationId, CadNavigationItem> = {
  overview: { id: 'overview', label: 'Overview', icon: Activity },
  targets: { id: 'targets', label: 'Clinical targets', icon: ShieldCheck },
  modes: { id: 'modes', label: 'Health modes', icon: HeartPulse },
  consent: { id: 'consent', label: 'Linking & consent', icon: Link2 },
  users: { id: 'users', label: 'Staff & licences', icon: UserCheck },
  audit: { id: 'audit', label: 'Audit trail', icon: FileText },
  billing: { id: 'billing', label: 'Billing & plan', icon: CreditCard },
  settings: { id: 'settings', label: 'Tenant settings', icon: Settings },
  platform: { id: 'platform', label: 'Platform tenants', icon: Building2 },
}

export function SidebarNavigation({ role, currentTab, setCurrentTab, open, onClose }: { role: CadRole; currentTab: string; setCurrentTab: (tab: string) => void; open: boolean; onClose: () => void }) {
  return <>
    {open ? <button className="cad-nav-scrim" onClick={onClose} aria-label="Close navigation" /> : null}
    <aside className={`cad-rail ${open ? 'cad-rail-open' : ''}`} aria-label="Primary navigation">
      <div className="cad-rail-heading"><span className="ui-eyebrow">Workspace</span><button className="ui-icon-button lg:hidden" onClick={onClose} aria-label="Close navigation"><X size={20} /></button></div>
      <nav className="cad-nav-list">
        {getCadNavigationIds(role).map((id) => {
          const { label, icon: Icon } = ALL_ITEMS[id]
          const active = currentTab === id || (id === 'platform' && currentTab === 'overview' && role === 'super_admin')
          return <button key={id} type="button" className={`cad-nav-item ${active ? 'cad-nav-item-active' : ''}`} onClick={() => { setCurrentTab(id === 'platform' ? 'overview' : id); onClose() }} aria-current={active ? 'page' : undefined}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>
        })}
      </nav>
      <p className="cad-rail-note">Clinical access is recorded in the immutable audit trail.</p>
    </aside>
  </>
}
