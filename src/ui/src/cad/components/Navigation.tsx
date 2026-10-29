// src/ui/src/cad/components/Navigation.tsx
// Clinic Admin Dashboard Top Navigation Bar & Tenant Switcher

import React from 'react'
import { useCadAuth } from '../context/AuthContext'
import type { CadRole } from '../types'
import { 
  Building2, 
  ShieldCheck, 
  UserCheck, 
  FileText, 
  Settings, 
  Activity, 
  LogOut, 
  Lock,
  CreditCard,
  Link2
} from 'lucide-react'

interface NavigationProps {
  currentTab: string
  setCurrentTab: (tab: string) => void
}

const ROLE_LABELS: Record<CadRole, { label: string; color: string }> = {
  super_admin: { label: 'Platform Super Admin', color: 'bg-red-100 text-red-800 border-red-300' },
  compliance_auditor: { label: 'Compliance Auditor', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  tenant_admin: { label: 'Tenant Admin', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  writing_clinician: { label: 'Writing Clinician', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  viewing_dietician: { label: 'Viewing Dietician', color: 'bg-teal-100 text-teal-800 border-teal-300' },
  commercial_stakeholder: { label: 'Commercial Stakeholder', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  patient: { label: 'Patient', color: 'bg-slate-100 text-slate-800 border-slate-300' },
}

export const Navigation: React.FC<NavigationProps> = ({ currentTab, setCurrentTab }) => {
  const { user, claims, activeTenant, availableTenants, switchTenant, signOut, mfaVerified } = useCadAuth()

  const roleMeta = ROLE_LABELS[claims.role] || ROLE_LABELS.patient

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo & Tenant Info */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="bg-emerald-600 text-white font-black text-xl px-2.5 py-1 rounded-lg tracking-tight">
                NutriScore
              </span>
              <span className="text-xs uppercase font-extrabold tracking-wider bg-slate-900 text-white px-2 py-0.5 rounded">
                CAD
              </span>
            </div>

            <div className="h-6 w-px bg-slate-200" />

            <div className="flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-slate-500" />
              {claims.role === 'super_admin' ? (
                <select
                  value={claims.tenantId}
                  onChange={(e) => switchTenant(e.target.value)}
                  className="text-sm font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {availableTenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.slug})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm font-semibold text-slate-800">
                  {activeTenant?.name || 'Clinic Tenant'}
                </span>
              )}
            </div>
          </div>

          {/* User badge, role, and actions */}
          <div className="flex items-center space-x-3">
            <span
              className={`text-xs px-2.5 py-1 font-medium rounded-full border ${roleMeta.color}`}
            >
              {roleMeta.label}
            </span>

            {mfaVerified && (
              <span className="inline-flex items-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full" title="MFA Authenticated">
                <Lock className="w-3 h-3 mr-1" /> MFA Active
              </span>
            )}

            <span className="text-xs text-slate-500 hidden md:inline">
              {claims.email || user?.email || 'clinician@nutriscore.co.ke'}
            </span>

            <button
              onClick={() => signOut()}
              className="text-slate-500 hover:text-red-600 p-1.5 rounded-md hover:bg-slate-100 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex space-x-8 border-t border-slate-100">
          <button
            onClick={() => setCurrentTab('overview')}
            className={`flex items-center space-x-2 py-3 px-1 border-b-2 text-sm font-medium ${
              currentTab === 'overview'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Cohorts & Overview</span>
          </button>

          {(claims.role === 'writing_clinician' ||
            claims.role === 'viewing_dietician' ||
            claims.role === 'tenant_admin' ||
            claims.role === 'super_admin') && (
            <button
              onClick={() => setCurrentTab('targets')}
              className={`flex items-center space-x-2 py-3 px-1 border-b-2 text-sm font-medium ${
                currentTab === 'targets'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Patient Targets</span>
            </button>
          )}

          {(claims.role === 'writing_clinician' ||
            claims.role === 'viewing_dietician' ||
            claims.role === 'tenant_admin' ||
            claims.role === 'super_admin') && (
            <button
              onClick={() => setCurrentTab('consent')}
              className={`flex items-center space-x-2 py-3 px-1 border-b-2 text-sm font-medium ${
                currentTab === 'consent'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Link2 className="w-4 h-4" />
              <span>Linking & Consent</span>
            </button>
          )}

          {(claims.role === 'tenant_admin' || claims.role === 'super_admin') && (
            <button
              onClick={() => setCurrentTab('users')}
              className={`flex items-center space-x-2 py-3 px-1 border-b-2 text-sm font-medium ${
                currentTab === 'users'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Staff & Licences</span>
            </button>
          )}

          {(claims.role === 'compliance_auditor' ||
            claims.role === 'tenant_admin' ||
            claims.role === 'super_admin') && (
            <button
              onClick={() => setCurrentTab('audit')}
              className={`flex items-center space-x-2 py-3 px-1 border-b-2 text-sm font-medium ${
                currentTab === 'audit'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Immutable Audit Log</span>
            </button>
          )}

          {(claims.role === 'tenant_admin' || claims.role === 'super_admin') && (
            <button
              onClick={() => setCurrentTab('billing')}
              className={`flex items-center space-x-2 py-3 px-1 border-b-2 text-sm font-medium ${
                currentTab === 'billing'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>Billing & Plan</span>
            </button>
          )}

          {(claims.role === 'tenant_admin' || claims.role === 'super_admin') && (
            <button
              onClick={() => setCurrentTab('settings')}
              className={`flex items-center space-x-2 py-3 px-1 border-b-2 text-sm font-medium ${
                currentTab === 'settings'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Tenant Settings</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

