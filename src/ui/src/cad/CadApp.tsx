// src/ui/src/cad/CadApp.tsx
// Root application layout for NutriScore Clinic Admin Dashboard (CAD)
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.6)

import React, { useState } from 'react'
import { Router, Route, Switch, useLocation } from 'wouter'
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
import { getCadNavigationIds, type CadNavigationId } from './navigation'
import { useCapabilities } from './hooks/useCapabilities'
import { isCadFlagEnabled } from './flags'

const CadMainContent: React.FC = () => {
  const { user, claims, isLoading, mfaRequired, signIn } = useCadAuth()
  const [location, navigate] = useLocation()
  const { nav: dynamicNav } = useCapabilities({ role: claims.role || undefined })

  // Compute currentTab from URL path
  const normalizedPath = location.replace(/^\/cad\/?/, '/').replace(/^\//, '')
  const currentTab: string = normalizedPath === '' || normalizedPath === 'overview' ? 'overview' : normalizedPath

  const handleNavigate = (tab: string) => {
    navigate(tab === 'overview' ? '/' : `/${tab}`)
  }

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
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-brand-mint border-t-transparent" />
          <p className="ui-eyebrow text-muted text-[12px]">
            Loading Clinic Admin Dashboard...
          </p>
        </div>
      </div>
    )
  }

  // Not signed in -> Show CAD Clinical Login
  if (!user) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans text-xs">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center items-center space-x-2">
            <span className="bg-brand-mint text-brand-navy font-black text-2xl px-3 py-1 rounded-xl">
              NutriScore
            </span>
            <span className="text-[12px] uppercase font-extrabold tracking-wider bg-surface-raised text-strong px-2 py-0.5 rounded-md border border-border-control/20">
              CAD
            </span>
          </div>
          <h1 className="mt-4 text-center text-2xl font-extrabold text-strong">
            Clinic Admin Dashboard
          </h1>
          <p className="mt-2 text-center text-[12px] text-muted">
            Secure multi-tenant clinical portal &middot; Authorized medical personnel only
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-surface border border-border-control/20 rounded-2xl shadow-sm py-8 px-4 sm:px-10">
            {loginError && (
              <div className="mb-4 flex items-center gap-2 rounded-xl bg-status-critical-subtle border border-status-critical/30 px-4 py-3 text-[12px] text-status-critical font-medium">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="cad-login-email" className="text-[12px] font-semibold text-strong">Email address</label>
                <input
                  id="cad-login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="doctor@hospital.co.ke"
                  className="mt-1 w-full h-10 px-3 py-2 bg-surface text-foreground text-[12px] rounded-xl border border-border-control outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </div>

              <div>
                <label htmlFor="cad-login-password" className="text-[12px] font-semibold text-strong">Password</label>
                <input
                  id="cad-login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full h-10 px-3 py-2 bg-surface text-foreground text-[12px] rounded-xl border border-border-control outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-11 px-4 mt-2 bg-brand-mint text-brand-navy rounded-xl font-bold text-[12px] hover:bg-brand-mint/90 transition-colors flex items-center justify-center gap-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <LogIn className="w-4 h-4" />
                <span>{isSubmitting ? 'Authenticating...' : 'Sign In to CAD'}</span>
              </button>
            </form>

            <div className="mt-6 border-t border-border-control/20 pt-4 text-center">
              <span className="flex items-center justify-center gap-1 text-[12px] text-muted">
                <Lock className="w-3.5 h-3.5" />
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

  const allowedTabs = isCadFlagEnabled('ns.cad.bff_client')
    ? dynamicNav
    : claims.role
      ? getCadNavigationIds(claims.role)
      : []

  const overview = (() => {
    if (claims.role === 'super_admin') return <PlatformOverviewView onNavigate={handleNavigate} />
    if (claims.role === 'tenant_admin') return <TenantOperationsView onNavigate={handleNavigate} />
    if (claims.role === 'writing_clinician') return <ClinicianWorkspaceView onNavigate={handleNavigate} />
    if (claims.role === 'viewing_dietician') return <DieticianInsightsView onNavigate={handleNavigate} />
    if (claims.role === 'compliance_auditor') return <AuditLogView />
    if (claims.role === 'commercial_stakeholder') return <CommercialInsightsView />
    return <PatientCareSummaryView />
  })()

  return (
    <AppShell currentTab={currentTab} setCurrentTab={handleNavigate}>
      <Switch>
        <Route path="/" component={() => overview} />
        <Route path="/overview" component={() => overview} />
        {allowedTabs.includes('targets') && <Route path="/targets" component={PatientTargetsView} />}
        {allowedTabs.includes('modes') && <Route path="/modes" component={HealthModesView} />}
        {allowedTabs.includes('consent') && <Route path="/consent" component={PatientLinkingConsentView} />}
        {allowedTabs.includes('users') && <Route path="/users" component={UserManagementView} />}
        {allowedTabs.includes('billing') && <Route path="/billing" component={BillingSubscriptionView} />}
        {allowedTabs.includes('audit') && <Route path="/audit" component={AuditLogView} />}
        {allowedTabs.includes('settings') && <Route path="/settings" component={TenantSettingsView} />}
        {allowedTabs.includes('platform') && <Route path="/platform">{() => <PlatformOverviewView onNavigate={handleNavigate} />}</Route>}
        {/* Fallback to role overview */}
        <Route component={() => overview} />
      </Switch>
    </AppShell>
  )
}

export const CadApp: React.FC = () => {
  return (
    <CadAuthProvider>
      <Router>
        <CadMainContent />
      </Router>
    </CadAuthProvider>
  )
}
export default CadApp
