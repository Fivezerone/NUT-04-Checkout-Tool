import React, { useState } from 'react'
import type { ComponentType } from 'react'
import {
  Activity,
  Building2,
  CreditCard,
  FileText,
  HeartPulse,
  Link2,
  Settings,
  ShieldCheck,
  UserCheck,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react'
import type { CadRole } from '../types'
import { getCadNavigationIds, type CadNavigationId } from '../navigation'
import { useCapabilities } from '../hooks/useCapabilities'
import { isCadFlagEnabled } from '../flags'

type NavIcon = ComponentType<{ className?: string; size?: number }>
export interface CadNavigationItem {
  id: CadNavigationId
  label: string
  icon: NavIcon
}

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

interface NavGroup {
  id: 'care' | 'admin' | 'govern'
  label: string
  items: CadNavigationId[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'care',
    label: 'Care',
    items: ['overview', 'targets', 'modes', 'consent'],
  },
  {
    id: 'admin',
    label: 'Administer',
    items: ['users', 'billing', 'platform'],
  },
  {
    id: 'govern',
    label: 'Govern',
    items: ['audit', 'settings'],
  },
]

export function SidebarNavigation({
  role,
  currentTab,
  setCurrentTab,
  open,
  onClose,
  navigationIds,
}: {
  role: CadRole
  currentTab: string
  setCurrentTab: (tab: string) => void
  open: boolean
  onClose: () => void
  navigationIds?: CadNavigationId[]
}) {
  const { nav: dynamicNav } = useCapabilities({ role })
  const allowed = navigationIds || (isCadFlagEnabled('ns.cad.bff_client') ? dynamicNav : getCadNavigationIds(role))
  const allowedIds = new Set(allowed)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  return (
    <>
      {open && (
        <button
          className="cad-nav-scrim"
          onClick={onClose}
          aria-label="Close navigation"
          tabIndex={-1}
        />
      )}
      <aside
        className={`cad-rail ${open ? 'cad-rail-open' : ''} flex flex-col justify-between`}
        aria-label="Primary navigation"
      >
        <div className="flex flex-col gap-4">
          <div className="cad-rail-heading flex items-center justify-between pb-2 border-b border-border-control/20">
            <span className="ui-eyebrow text-strong font-bold">Clinical Workspace</span>
            <button
              className="ui-icon-button lg:hidden cursor-pointer"
              onClick={onClose}
              aria-label="Close navigation"
            >
              <X size={20} />
            </button>
          </div>

          <nav className="flex flex-col gap-4" aria-label="Workspaces">
            {NAV_GROUPS.map((group) => {
              const visibleItems = group.items.filter((id) => allowedIds.has(id))
              if (visibleItems.length === 0) return null

              const isCollapsed = !!collapsedGroups[group.id]

              return (
                <div key={group.id} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex items-center justify-between px-2 py-1 text-[12px] font-bold uppercase tracking-wider text-muted hover:text-strong transition-colors cursor-pointer"
                  >
                    <span>{group.label}</span>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {!isCollapsed && (
                    <div className="flex flex-col gap-0.5">
                      {visibleItems.map((id) => {
                        const { label, icon: Icon } = ALL_ITEMS[id]
                        // D-09 fix: strictly single active item
                        const active = currentTab === id

                        return (
                          <button
                            key={id}
                            type="button"
                            className={`cad-nav-item flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors cursor-pointer text-left ${
                              active
                                ? 'cad-nav-item-active bg-surface-raised font-bold text-strong border-l-4 border-brand-mint'
                                : 'text-muted hover:text-strong hover:bg-surface-raised/50'
                            }`}
                            onClick={() => {
                              setCurrentTab(id)
                              onClose()
                            }}
                            aria-current={active ? 'page' : undefined}
                          >
                            <Icon size={18} aria-hidden="true" className={active ? 'text-brand-mint' : ''} />
                            <span>{label}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </div>

        <p className="cad-rail-note text-[12px] text-muted p-2 border-t border-border-control/20">
          Clinical access is recorded in the immutable audit trail.
        </p>
      </aside>
    </>
  )
}
