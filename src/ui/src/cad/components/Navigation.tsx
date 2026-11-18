import React from 'react'
import { Building2, Lock, LogOut, Menu, Search } from 'lucide-react'
import { useCadAuth } from '../context/AuthContext'
import { Combobox } from '../../app/components/ui/Combobox'
import type { CadRole } from '../types'

const ROLE_LABELS: Record<CadRole, string> = {
  super_admin: 'Platform super administrator',
  compliance_auditor: 'Compliance auditor',
  tenant_admin: 'Tenant administrator',
  writing_clinician: 'Writing clinician',
  viewing_dietician: 'Viewing dietician',
  commercial_stakeholder: 'Commercial stakeholder',
  patient: 'Patient',
}

export function Navigation({
  onOpenNav,
  onOpenCommandPalette,
}: {
  onOpenNav: () => void
  onOpenCommandPalette?: () => void
}) {
  const { user, claims, activeTenant, availableTenants, switchTenant, signOut, mfaVerified } =
    useCadAuth()

  const tenantOptions = availableTenants.map((t) => ({
    value: t.id,
    label: t.name,
    description: t.slug,
  }))

  return (
    <header className="cad-topbar bg-surface border-b border-border-control/20 px-4 py-2.5">
      <div className="cad-topbar-inner flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <button
            className="ui-icon-button lg:hidden cursor-pointer"
            onClick={onOpenNav}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div
            className="cad-brand flex items-center gap-2"
            aria-label="NutriScore Clinical Administration Dashboard"
          >
            <span className="cad-brand-mark px-2 py-0.5 rounded-lg bg-brand-mint text-brand-navy font-bold text-sm">
              N
            </span>
            <span className="hidden font-bold text-strong sm:inline">NutriScore</span>
            <span className="cad-brand-product text-[12px] font-semibold text-muted bg-surface-raised px-2 py-0.5 rounded-md">
              Clinical
            </span>
          </div>

          <span className="hidden h-6 w-px bg-border-control/20 md:inline" />

          {/* Tenant Selector: Combobox replacing truncated <select> */}
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <Building2
              size={17}
              className="shrink-0 text-muted"
              aria-hidden="true"
            />
            {claims.role === 'super_admin' ? (
              <div className="w-56">
                <Combobox
                  options={tenantOptions}
                  value={claims.tenantId}
                  onChange={(val) => switchTenant(val)}
                  placeholder="Select tenant..."
                  searchPlaceholder="Search tenants..."
                />
              </div>
            ) : (
              <span className="text-[12px] font-semibold text-strong">
                {activeTenant?.name || 'Clinic tenant'}
              </span>
            )}
          </div>
        </div>

        {/* Right tools: Command palette button, user role, MFA status, sign out */}
        <div className="flex shrink-0 items-center gap-2.5">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border-control/40 bg-surface-raised text-muted hover:text-strong text-[12px] transition-colors cursor-pointer"
              title="Command Palette (Ctrl+K)"
            >
              <Search size={14} />
              <span>Search...</span>
              <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border-control/30 text-[12px] font-mono">
                ⌘K
              </kbd>
            </button>
          )}

          <span className="ui-role-badge hidden xl:inline-flex text-[12px] px-2.5 py-1 rounded-md bg-surface-raised border border-border-control/20 text-strong font-medium">
            {claims.role ? ROLE_LABELS[claims.role] : 'Unauthenticated'}
          </span>

          {mfaVerified && (
            <span className="ui-status ui-status-success hidden sm:inline-flex text-[12px] items-center gap-1 text-status-success bg-status-success-subtle px-2 py-0.5 rounded-md border border-status-success/20 font-medium">
              <Lock size={13} /> MFA verified
            </span>
          )}

          <span className="hidden text-[12px] text-muted lg:inline">
            {claims.email || user?.email}
          </span>

          <button
            className="ui-icon-button p-2 rounded-xl text-muted hover:text-strong hover:bg-surface-raised transition-colors cursor-pointer"
            onClick={() => signOut()}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  )
}
