// src/ui/src/cad/CadApp.tsx
// Root application layout for NutriScore Clinic Admin Dashboard (CAD)
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.6)

import React, { useState } from 'react'
import { CadAuthProvider, useCadAuth } from './context/AuthContext'
import { AppShell } from './components/AppShell'
import { MfaChallenge } from './components/MfaChallenge'
import { PatientTargetsView } from './views/PatientTargetsView'
import { HealthModesView } from './views/HealthModesView'
import { UserManagementView } from './views/UserManagementView'
import { AuditLogView } from './views/AuditLogView'
import { TenantSettingsView } from './views/TenantSettingsView'
import { BillingSubscriptionView } from './views/BillingSubscriptionView'
import { PatientLinkingConsentView } from './views/PatientLinkingConsentView'
import { PlatformOverviewView } from './views/PlatformOverviewView'
import { TenantOperationsView } from './views/TenantOperationsView'
import { ClinicianWorkspaceView } from './views/ClinicianWorkspaceView'
import { DieticianInsightsView } from './views/DieticianInsightsView'
import { CommercialInsightsView } from './views/CommercialInsightsView'
import { PatientCareSummaryView } from './views/PatientCareSummaryView'
import { Lock, LogIn, AlertCircle } from 'lucide-react'

const CadMainContent: React.FC = () => {
  const { user, claims, isLoading, mfaRequired, signIn } = useCadAuth()
  const [currentTab, setCurrentTab] = useState<string>('overview')

  // Login form state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setLoginError('')
    const res = await signIn(email, password)
    if (!res.success) {
      setLoginError(res.error || 'Invalid credentials')
    }
    setIsSubmitting(false)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[color:var(--color-canvas)] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[color:var(--color-brand)] border-t-transparent" />
          <p className="ui-eyebrow">
            Loading Clinic Admin Dashboard...
          </p>
        </div>
      </div>
    )
  }

  // Not signed in -> Show CAD Clinical Login
  if (!user) {
    return (
      <div className="min-h-screen bg-[color:var(--color-canvas)] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center items-center space-x-2">
            <span className="bg-[color:var(--color-brand)] text-[color:var(--color-on-brand)] font-black text-2xl px-3 py-1 rounded-lg">
              NutriScore
            </span>
            <span className="text-xs uppercase font-extrabold tracking-wider bg-[color:var(--color-text-strong)] text-[color:var(--color-on-brand)] px-2 py-0.5 rounded">
              CAD
            </span>
          </div>
          <h1 className="mt-4 text-center text-2xl font-extrabold text-[color:var(--color-text-strong)]">
            Clinic Admin Dashboard
          </h1>
          <p className="mt-2 text-center text-sm text-[color:var(--color-text-muted)]">
            Secure multi-tenant clinical portal &middot; Authorized medical personnel only
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="ui-card py-8 px-4 sm:px-10">
            {loginError && (
              <div className="ui-status-critical mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="ui-field-label">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="doctor@hospital.co.ke"
                  className="ui-input mt-1"
                />
              </div>

              <div>
                <label className="ui-field-label">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ui-input mt-1"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="ui-button ui-button-primary w-full"
              >
                <LogIn className="w-4 h-4" />
                <span>{isSubmitting ? 'Authenticating...' : 'Sign In to CAD'}</span>
              </button>
            </form>

            <div className="mt-6 border-t border-[color:var(--color-border-subtle)] pt-4 text-center">
              <span className="flex items-center justify-center gap-1 text-xs text-[color:var(--color-text-muted)]">
                <Lock className="w-3 h-3" />
                <span>DPA s.46 Processor Compliant &middot; TLS 1.3 Encrypted</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // MFA Required for non-patient roles
  if (mfaRequired) {
    return <MfaChallenge />
  }

  const overview = (() => {
    if (claims.role === 'super_admin') return <PlatformOverviewView onNavigate={setCurrentTab} />
    if (claims.role === 'tenant_admin') return <TenantOperationsView onNavigate={setCurrentTab} />
    if (claims.role === 'writing_clinician') return <ClinicianWorkspaceView onNavigate={setCurrentTab} />
    if (claims.role === 'viewing_dietician') return <DieticianInsightsView onNavigate={setCurrentTab} />
    if (claims.role === 'compliance_auditor') return <AuditLogView />
    if (claims.role === 'commercial_stakeholder') return <CommercialInsightsView />
    return <PatientCareSummaryView />
  })()

  return (
    <AppShell currentTab={currentTab} setCurrentTab={setCurrentTab}>
      {currentTab === 'overview' && overview}
      {currentTab === 'targets' && <PatientTargetsView />}
      {currentTab === 'modes' && <HealthModesView />}
      {currentTab === 'consent' && <PatientLinkingConsentView />}
      {currentTab === 'users' && <UserManagementView />}
      {currentTab === 'billing' && <BillingSubscriptionView />}
      {currentTab === 'audit' && <AuditLogView />}
      {currentTab === 'settings' && <TenantSettingsView />}
    </AppShell>
  )
}

export const CadApp: React.FC = () => {
  return (
    <CadAuthProvider>
      <CadMainContent />
    </CadAuthProvider>
  )
}
export default CadApp

