// src/ui/src/cad/components/MfaChallenge.tsx
// MFA verification gate for Clinic Admin Dashboard (CAD)
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.4)

import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import { ShieldAlert, KeyRound } from 'lucide-react'

export const MfaChallenge: React.FC = () => {
  const { verifyMfa, signOut, claims } = useCadAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) {
      setError('Please enter a valid 6-digit authenticator code')
      return
    }

    setIsSubmitting(true)
    setError('')
    try {
      const ok = await verifyMfa(code)
      if (!ok) {
        setError('Invalid verification code. Please check your authenticator app.')
      }
    } catch {
      setError('Verification failed. Please retry.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-brand-mint text-brand-navy rounded-full flex items-center justify-center font-bold">
            <KeyRound className="w-6 h-6" />
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-extrabold text-strong">
          Multi-Factor Authentication
        </h2>
        <p className="mt-2 text-center text-xs text-muted">
          MFA is mandatory for role <strong className="text-strong">{claims.role}</strong> under DPA s.46 clinical compliance.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-surface py-8 px-4 shadow-sm sm:rounded-2xl sm:px-10 border border-border-control">
          {error && (
            <div className="mb-4 bg-status-error-subtle border border-status-error/30 text-status-error px-4 py-3 rounded-xl text-xs flex items-start space-x-2">
              <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="mfa-code" className="block text-xs font-semibold text-strong">
                Authenticator Security Code
              </label>
              <div className="mt-1">
                <input
                  id="mfa-code"
                  type="text"
                  maxLength={6}
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="appearance-none block w-full px-3 py-3 border border-border-control rounded-xl shadow-xs placeholder:text-muted text-center text-2xl tracking-widest font-mono bg-surface text-strong focus:outline-none focus:ring-2 focus:ring-focus"
                />
              </div>
              <p className="mt-2 text-xs text-muted text-center">
                Enter the 6-digit code from your authenticator app (TOTP) or clinic hardware token.
              </p>
            </div>

            <div>
              <button
                type="submit"
                disabled={isSubmitting || code.length < 6}
                className="w-full flex justify-center py-2.5 px-4 rounded-xl shadow-xs text-xs font-bold text-brand-navy bg-brand-mint hover:bg-brand-mint/90 focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-50 transition-all cursor-pointer"
              >
                {isSubmitting ? 'Verifying...' : 'Verify & Continue to CAD'}
              </button>
            </div>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => signOut()}
                className="text-xs text-muted hover:text-strong underline cursor-pointer"
              >
                Sign out and use another account
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

