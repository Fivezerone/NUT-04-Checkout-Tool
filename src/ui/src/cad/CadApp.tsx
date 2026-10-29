// src/ui/src/cad/CadApp.tsx
// Root application layout for NutriScore Clinic Admin Dashboard (CAD)
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.6)

import React, { useState } from 'react'
import { CadAuthProvider, useCadAuth } from './context/AuthContext'
import { Navigation } from './components/Navigation'
import { MfaChallenge } from './components/MfaChallenge'
import { ClinicalOverview } from './views/ClinicalOverview'
import { PatientTargetsView } from './views/PatientTargetsView'
import { UserManagementView } from './views/UserManagementView'
import { AuditLogView } from './views/AuditLogView'
import { TenantSettingsView } from './views/TenantSettingsView'
import { BillingSubscriptionView } from './views/BillingSubscriptionView'
import { PatientLinkingConsentView } from './views/PatientLinkingConsentView'
import { Lock, LogIn, AlertCircle } from 'lucide-react'

const CadMainContent: React.FC = () => {
  const { user, isLoading, mfaRequired, signIn } = useCadAuth()
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Loading Clinic Admin Dashboard...
          </p>
        </div>
      </div>
    )
  }

  // Not signed in -> Show CAD Clinical Login
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center items-center space-x-2">
            <span className="bg-emerald-600 text-white font-black text-2xl px-3 py-1 rounded-lg">
              NutriScore
            </span>
            <span className="text-xs uppercase font-extrabold tracking-wider bg-slate-900 text-white px-2 py-0.5 rounded">
              CAD
            </span>
          </div>
          <h2 className="mt-4 text-center text-2xl font-extrabold text-slate-900">
            Clinic Admin Dashboard
          </h2>
          <p className="mt-2 text-center text-xs text-slate-600">
            Secure multi-tenant clinical portal &middot; Authorized medical personnel only
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-xl sm:px-10 border border-slate-200">
            {loginError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="doctor@hospital.co.ke"
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex justify-center items-center space-x-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                <span>{isSubmitting ? 'Authenticating...' : 'Sign In to CAD'}</span>
              </button>
            </form>

            <div className="mt-6 border-t border-slate-100 pt-4 text-center">
              <span className="text-[11px] text-slate-400 flex items-center justify-center space-x-1">
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800">
      <Navigation currentTab={currentTab} setCurrentTab={setCurrentTab} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentTab === 'overview' && <ClinicalOverview />}
        {currentTab === 'targets' && <PatientTargetsView />}
        {currentTab === 'consent' && <PatientLinkingConsentView />}
        {currentTab === 'users' && <UserManagementView />}
        {currentTab === 'billing' && <BillingSubscriptionView />}
        {currentTab === 'audit' && <AuditLogView />}
        {currentTab === 'settings' && <TenantSettingsView />}
      </main>

      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        NutriScore Clinic Admin Dashboard (CAD) &middot; Multi-Tenant Architecture &middot; Version 1.0.0
      </footer>
    </div>
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

