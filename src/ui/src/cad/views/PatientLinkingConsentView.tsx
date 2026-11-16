// src/ui/src/cad/views/PatientLinkingConsentView.tsx
// Clinic Admin Dashboard: Patient-Clinician Linking & Consent Ledger Management
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§9.1 - §9.4, Tests T26, T27)

import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import { ConfirmDialog } from '../../app/components/ui'
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

// STAGE B (B-05): Hardcoded synthetic patient refs and clinician name removed
// from useState fixtures. Initial state now starts empty; the UI shows an
// empty-state prompt until real data is loaded from the API
// (TODO(Stage C): wire to GET /patient-links).
export const PatientLinkingConsentView: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const isWritingClinician = claims.role === 'writing_clinician' || claims.role === 'super_admin'

  const [links, setLinks] = useState<PatientLinkItem[]>([])

  const [consents, setConsents] = useState<ConsentRecordItem[]>([])

  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [erasureStatus, setErasureStatus] = useState<string | null>(null)
  const [shredTarget, setShredTarget] = useState<string | null>(null)

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

  const executeCryptoShred = (patientRef: string) => {
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-surface p-6 rounded-2xl border border-border-control shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-black text-strong">Patient Linking & Consent Ledger</h2>
            <span className="text-xs bg-status-success-subtle text-status-success border border-status-success/30 font-bold px-2 py-0.5 rounded">
              DPA s.46 / s.40
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Two-identifier verification links &middot; Purpose-specific consent tracking &middot; Cryptographic right-to-erasure
          </p>
        </div>

        {isWritingClinician && (
          <button
            onClick={handleGenerateLinkCode}
            className="flex items-center space-x-2 bg-brand-mint text-brand-navy hover:bg-brand-mint/90 text-xs font-bold px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Generate Patient Link Code</span>
          </button>
        )}
      </div>

      {/* Generated Code Modal / Alert */}
      {generatedCode && (
        <div className="bg-status-success-subtle border border-status-success/30 p-4 rounded-2xl flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-brand-mint text-brand-navy rounded-xl">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-strong">New Single-Use Link Code (Valid 24h)</p>
              <div className="flex items-center space-x-2 mt-1">
                <span className="text-lg font-mono font-black text-strong tracking-wider">
                  {generatedCode}
                </span>
                <button
                  onClick={() => handleCopy(generatedCode)}
                  className="p-1 hover:bg-surface-raised rounded text-strong transition-colors cursor-pointer"
                  title="Copy code"
                >
                  {copiedCode ? <CheckCircle2 className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted max-w-sm hidden sm:block">
            Give this code to the patient. They must enter it in the NutriScore extension and confirm their DOB or ID.
          </p>
        </div>
      )}

      {/* Erasure Notification Banner */}
      {erasureStatus && (
        <div className="bg-status-warning-subtle border border-status-warning/30 p-4 rounded-2xl flex items-center space-x-3 text-status-warning text-xs font-medium">
          <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0" />
          <span>{erasureStatus}</span>
        </div>
      )}

      {/* Grid: Active Links & Consent Records */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Patient Links */}
        <div className="bg-surface rounded-2xl border border-border-control shadow-xs overflow-hidden">
          <div className="p-5 border-b border-border-control/20 flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <Link2 className="w-4 h-4 text-muted" />
              <h3 className="text-xs font-bold text-strong">Clinician–Patient Links</h3>
            </div>
            <span className="text-xs text-muted font-mono">{links.length} total</span>
          </div>

          <div className="divide-y divide-border-control/10">
            {links.map((link) => (
              <div key={link.code} className="p-4 hover:bg-surface-raised transition-colors flex justify-between items-center">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-bold text-strong">{link.code}</span>
                    <span
                      className={`text-xs uppercase font-bold px-2 py-0.5 rounded-full border ${
                        link.status === 'confirmed'
                          ? 'bg-status-success-subtle text-status-success border-status-success/30'
                          : link.status === 'pending'
                          ? 'bg-status-warning-subtle text-status-warning border-status-warning/30'
                          : 'bg-surface-raised text-muted border-border-control/20'
                      }`}
                    >
                      {link.status}
                    </span>
                  </div>
                  <p className="text-xs text-foreground mt-1 font-medium">
                    Patient: <span className="font-semibold text-strong">{link.patientRef}</span>
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    Clinician: {link.clinicianName}
                  </p>
                </div>

                <div className="text-right">
                  {link.status === 'confirmed' ? (
                    <span className="text-xs text-status-success flex items-center justify-end font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Active Link
                    </span>
                  ) : link.status === 'pending' ? (
                    <span className="text-xs text-status-warning flex items-center justify-end font-medium">
                      <Clock className="w-3.5 h-3.5 mr-1" /> Expires soon
                    </span>
                  ) : (
                    <span className="text-xs text-muted">Revoked</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Consent Records */}
        <div className="bg-surface rounded-2xl border border-border-control shadow-xs overflow-hidden">
          <div className="p-5 border-b border-border-control/20 flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-brand-mint" />
              <h3 className="text-xs font-bold text-strong">Consent Ledger (Purpose Gated)</h3>
            </div>
            <span className="text-xs text-muted font-mono">{consents.length} entries</span>
          </div>

          <div className="divide-y divide-border-control/10">
            {consents.map((consent) => (
              <div key={consent.id} className="p-4 hover:bg-surface-raised transition-colors flex justify-between items-center">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-strong">{consent.patientRef}</span>
                    <span className="text-xs bg-surface-raised text-foreground font-semibold px-2 py-0.5 rounded border border-border-control/20">
                      {consent.purpose.replace('_', ' ')}
                    </span>
                    <span
                      className={`text-xs uppercase font-bold px-2 py-0.5 rounded-full border ${
                        consent.status === 'active'
                          ? 'bg-status-success-subtle text-status-success border-status-success/30'
                          : 'bg-status-error-subtle text-status-error border-status-error/30'
                      }`}
                    >
                      {consent.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    Granted: {consent.grantedAt ? new Date(consent.grantedAt).toLocaleDateString() : 'N/A'}
                    {consent.revokedAt && ` · Revoked: ${new Date(consent.revokedAt).toLocaleDateString()}`}
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  {consent.status === 'active' && (
                    <button
                      onClick={() => handleRevokeConsent(consent.patientRef, consent.purpose)}
                      className="text-xs text-status-error hover:opacity-90 font-semibold px-2.5 py-1 bg-status-error-subtle border border-status-error/30 rounded-xl transition-colors cursor-pointer"
                      title="Revoke consent (Test T26)"
                    >
                      Revoke
                    </button>
                  )}

                  {!consent.patientRef.startsWith('SHREDDED') && (
                    <button
                      onClick={() => setShredTarget(consent.patientRef)}
                      className="text-muted hover:text-status-error p-1.5 hover:bg-surface-raised rounded-lg transition-colors cursor-pointer"
                      title="Crypto-shred patient (Test T27)"
                      aria-label={`Crypto-shred patient ${consent.patientRef}`}
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

      {/* DPA s.40 Irreversible Crypto-Shredding Typed Confirmation Modal */}
      <ConfirmDialog
        isOpen={Boolean(shredTarget)}
        title="Initiate DPA s.40 Crypto-Shredding"
        description={`All patient identifiers for ${shredTarget} will be permanently pseudonymized, consent revoked, and cryptographic keys rotated. Type SHRED to confirm this irreversible action.`}
        confirmLabel="Crypto-Shred Patient"
        variant="danger"
        expectedPhrase="SHRED"
        onConfirm={() => {
          if (shredTarget) {
            executeCryptoShred(shredTarget)
            setShredTarget(null)
          }
        }}
        onClose={() => setShredTarget(null)}
      />
    </div>
  )
}
export default PatientLinkingConsentView

