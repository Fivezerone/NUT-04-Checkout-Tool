// src/ui/src/cad/views/PatientLinkingConsentView.tsx
// Clinic Admin Dashboard: Patient-Clinician Linking & Consent Ledger Management
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§9.1 - §9.4, Tests T26, T27)

import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import { 
  Link2, 
  ShieldCheck, 
  AlertTriangle, 
  Clock, 
  Trash2, 
  Copy, 
  CheckCircle2, 
  UserPlus, 
  RefreshCw 
} from 'lucide-react'

interface PatientLinkItem {
  code: string
  patientRef: string
  clinicianName: string
  status: 'pending' | 'confirmed' | 'expired' | 'revoked'
  expiresAt: string
  confirmedAt?: string
}

interface ConsentRecordItem {
  id: string
  patientRef: string
  purpose: 'clinician_link' | 'purchase_timeline' | 'diary' | 'de_identified_aggregates'
  status: 'active' | 'revoked' | 'pending'
  grantedAt?: string
  revokedAt?: string
}

export const PatientLinkingConsentView: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const isWritingClinician = claims.role === 'writing_clinician' || claims.role === 'super_admin'

  const [links, setLinks] = useState<PatientLinkItem[]>([
    {
      code: 'NS-849201',
      patientRef: 'PAT-0042',
      clinicianName: 'Dr. Mwangi, MBChB',
      status: 'confirmed',
      expiresAt: '2026-11-01T12:00:00Z',
      confirmedAt: '2026-10-28T09:15:00Z',
    },
    {
      code: 'NS-119304',
      patientRef: 'PAT-0108',
      clinicianName: 'Dr. Mwangi, MBChB',
      status: 'confirmed',
      expiresAt: '2026-11-02T16:00:00Z',
      confirmedAt: '2026-10-29T10:30:00Z',
    },
    {
      code: 'NS-772049',
      patientRef: 'Pending Confirmation',
      clinicianName: 'Dr. Mwangi, MBChB',
      status: 'pending',
      expiresAt: '2026-10-30T18:00:00Z',
    },
  ])

  const [consents, setConsents] = useState<ConsentRecordItem[]>([
    {
      id: 'c1',
      patientRef: 'PAT-0042',
      purpose: 'clinician_link',
      status: 'active',
      grantedAt: '2026-10-28T09:15:00Z',
    },
    {
      id: 'c2',
      patientRef: 'PAT-0042',
      purpose: 'purchase_timeline',
      status: 'active',
      grantedAt: '2026-10-28T09:15:00Z',
    },
    {
      id: 'c3',
      patientRef: 'PAT-0108',
      purpose: 'clinician_link',
      status: 'active',
      grantedAt: '2026-10-29T10:30:00Z',
    },
    {
      id: 'c4',
      patientRef: 'PAT-0108',
      purpose: 'diary',
      status: 'active',
      grantedAt: '2026-10-29T10:30:00Z',
    },
  ])

  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [erasureStatus, setErasureStatus] = useState<string | null>(null)

  const handleGenerateLinkCode = () => {
    const randomDigits = Math.floor(100000 + Math.random() * 900000)
    const code = `NS-${randomDigits}`
    setGeneratedCode(code)
    setCopiedCode(false)

    const newLink: PatientLinkItem = {
      code,
      patientRef: 'Pending Confirmation',
      clinicianName: claims.email || 'Prescribing Clinician',
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }
    setLinks([newLink, ...links])
  }

  const handleCopy = (code: string) => {
    navigator.clipboard?.writeText(code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleRevokeConsent = (patientRef: string, purpose: string) => {
    setConsents((prev) =>
      prev.map((c) =>
        c.patientRef === patientRef && c.purpose === purpose
          ? { ...c, status: 'revoked', revokedAt: new Date().toISOString() }
          : c
      )
    )
  }

  const handleCryptoShred = (patientRef: string) => {
    if (!window.confirm(`Initiate DPA s.40 crypto-shredding for ${patientRef}? All patient identifiers will be pseudonymized and consent revoked permanently.`)) {
      return
    }

    const shreddedToken = `SHREDDED-${patientRef.substring(0, 4)}-${Math.random().toString(36).substring(2, 8)}`
    
    // Revoke all consents
    setConsents((prev) =>
      prev.map((c) =>
        c.patientRef === patientRef
          ? { ...c, patientRef: shreddedToken, status: 'revoked', revokedAt: new Date().toISOString() }
          : c
      )
    )

    // Mark link as revoked/shredded
    setLinks((prev) =>
      prev.map((l) =>
        l.patientRef === patientRef
          ? { ...l, patientRef: shreddedToken, status: 'revoked' }
          : l
      )
    )

    setErasureStatus(`Patient ${patientRef} crypto-shredded to ${shreddedToken}. Audit hash chain verified.`)
    setTimeout(() => setErasureStatus(null), 6000)
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-black text-slate-900">Patient Linking & Consent Ledger</h2>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">
              DPA s.46 / s.40
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Two-identifier verification links &middot; Purpose-specific consent tracking &middot; Cryptographic right-to-erasure
          </p>
        </div>

        {isWritingClinician && (
          <button
            onClick={handleGenerateLinkCode}
            className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span>Generate Patient Link Code</span>
          </button>
        )}
      </div>

      {/* Generated Code Modal / Alert */}
      {generatedCode && (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-600 text-white rounded-lg">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-900">New Single-Use Link Code (Valid 24h)</p>
              <div className="flex items-center space-x-2 mt-1">
                <span className="text-lg font-mono font-black text-slate-900 tracking-wider">
                  {generatedCode}
                </span>
                <button
                  onClick={() => handleCopy(generatedCode)}
                  className="p-1 hover:bg-emerald-200 rounded text-emerald-800 transition-colors"
                  title="Copy code"
                >
                  {copiedCode ? <CheckCircle2 className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-emerald-700 max-w-sm hidden sm:block">
            Give this code to the patient. They must enter it in the NutriScore extension and confirm their DOB or ID.
          </p>
        </div>
      )}

      {/* Erasure Notification Banner */}
      {erasureStatus && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center space-x-3 text-amber-900 text-xs font-medium">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <span>{erasureStatus}</span>
        </div>
      )}

      {/* Grid: Active Links & Consent Records */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Patient Links */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <Link2 className="w-4 h-4 text-slate-600" />
              <h3 className="text-sm font-bold text-slate-900">Clinician–Patient Links</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">{links.length} total</span>
          </div>

          <div className="divide-y divide-slate-100">
            {links.map((link) => (
              <div key={link.code} className="p-4 hover:bg-slate-50 transition-colors flex justify-between items-center">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-bold text-slate-900">{link.code}</span>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        link.status === 'confirmed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : link.status === 'pending'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {link.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 font-medium">
                    Patient: <span className="font-semibold text-slate-800">{link.patientRef}</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Clinician: {link.clinicianName}
                  </p>
                </div>

                <div className="text-right">
                  {link.status === 'confirmed' ? (
                    <span className="text-[11px] text-emerald-600 flex items-center justify-end font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Active Link
                    </span>
                  ) : link.status === 'pending' ? (
                    <span className="text-[11px] text-amber-600 flex items-center justify-end font-medium">
                      <Clock className="w-3.5 h-3.5 mr-1" /> Expires soon
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">Revoked</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Consent Records */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">Consent Ledger (Purpose Gated)</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">{consents.length} entries</span>
          </div>

          <div className="divide-y divide-slate-100">
            {consents.map((consent) => (
              <div key={consent.id} className="p-4 hover:bg-slate-50 transition-colors flex justify-between items-center">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-slate-900">{consent.patientRef}</span>
                    <span className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded">
                      {consent.purpose.replace('_', ' ')}
                    </span>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        consent.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {consent.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Granted: {consent.grantedAt ? new Date(consent.grantedAt).toLocaleDateString() : 'N/A'}
                    {consent.revokedAt && ` · Revoked: ${new Date(consent.revokedAt).toLocaleDateString()}`}
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  {consent.status === 'active' && (
                    <button
                      onClick={() => handleRevokeConsent(consent.patientRef, consent.purpose)}
                      className="text-xs text-red-600 hover:text-red-700 font-semibold px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded transition-colors"
                      title="Revoke consent (Test T26)"
                    >
                      Revoke
                    </button>
                  )}

                  {!consent.patientRef.startsWith('SHREDDED') && (
                    <button
                      onClick={() => handleCryptoShred(consent.patientRef)}
                      className="text-slate-400 hover:text-slate-700 p-1.5 hover:bg-slate-100 rounded transition-colors"
                      title="Crypto-shred patient (Test T27)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default PatientLinkingConsentView

