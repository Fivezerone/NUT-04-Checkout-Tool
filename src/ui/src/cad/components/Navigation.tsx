import React from 'react'
import { Building2, Lock, LogOut, Menu } from 'lucide-react'
import { useCadAuth } from '../context/AuthContext'
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

export function Navigation({ onOpenNav }: { onOpenNav: () => void }) {
  const { user, claims, activeTenant, availableTenants, switchTenant, signOut, mfaVerified } = useCadAuth()
  return (
    <header className="cad-topbar">
      <div className="cad-topbar-inner">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <button className="ui-icon-button lg:hidden" onClick={onOpenNav} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="cad-brand" aria-label="NutriScore Clinical Administration Dashboard">
            <span className="cad-brand-mark">N</span>
            <span className="hidden font-bold text-[color:var(--color-text-strong)] sm:inline">NutriScore</span>
            <span className="cad-brand-product">Clinical</span>
          </div>
          <span className="hidden h-6 w-px bg-[color:var(--color-border-subtle)] md:inline" />
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <Building2 size={17} className="shrink-0 text-[color:var(--color-text-muted)]" aria-hidden="true" />
            {claims.role === 'super_admin' ? (
              <select value={claims.tenantId} onChange={(event) => switchTenant(event.target.value)} className="cad-tenant-select" aria-label="Active tenant">
                {availableTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
              </select>
            ) : <span className="truncate text-sm font-semibold text-[color:var(--color-text-strong)]">{activeTenant?.name || 'Clinic tenant'}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="ui-role-badge hidden xl:inline-flex">{ROLE_LABELS[claims.role]}</span>
          {mfaVerified ? <span className="ui-status ui-status-success hidden sm:inline-flex"><Lock size={13} /> MFA verified</span> : null}
          <span className="hidden max-w-48 truncate text-xs text-[color:var(--color-text-muted)] lg:inline">{claims.email || user?.email}</span>
          <button className="ui-icon-button" onClick={() => signOut()} title="Sign out" aria-label="Sign out"><LogOut size={18} /></button>
        </div>
      </div>
    </header>
  )
}
