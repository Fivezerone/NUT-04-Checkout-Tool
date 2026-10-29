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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
            <KeyRound className="w-6 h-6" />
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-extrabold text-slate-900">
          Multi-Factor Authentication
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600">
          MFA is mandatory for role <strong className="text-slate-800">{claims.role}</strong> under DPA s.46 clinical compliance.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm flex items-start space-x-2">
              <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="mfa-code" className="block text-sm font-medium text-slate-700">
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
                  className="appearance-none block w-full px-3 py-3 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 text-center text-2xl tracking-widest font-mono focus:outline-none focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <p className="mt-2 text-xs text-slate-500 text-center">
                Enter the 6-digit code from Google Authenticator or your clinic TOTP device.
              </p>
            </div>

            <div>
              <button
                type="submit"
                disabled={isSubmitting || code.length < 6}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50"
              >
                {isSubmitting ? 'Verifying...' : 'Verify & Continue to CAD'}
              </button>
            </div>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => signOut()}
                className="text-xs text-slate-500 hover:text-slate-800 underline"
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

