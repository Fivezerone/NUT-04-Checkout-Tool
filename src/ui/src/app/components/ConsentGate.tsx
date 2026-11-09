// src/ui/src/app/components/ConsentGate.tsx
// Standalone consent display and acceptance gate.
// Extracted from OnboardingWizard (deleted in A-02) per §4.9.
// The consent *recording* (server call) is wired in Stage C when the
// OIDC auth provider is in place; for now the gate calls onAccept()
// which callers must handle (store acceptance via the new API).
//
// R7: consent logic semantics preserved — both docs must be accepted
// and notification frequency chosen before proceeding.

import React, { useState } from 'react'
import { ShieldCheck, ArrowRight } from 'lucide-react'
import { ConsentDocModal } from './ConsentDocModal'
import { DECOY_TERMS_OF_SERVICE, DECOY_PRIVACY_POLICY, type LegalDoc } from '../legal/decoyLegalDocs'

export interface ConsentAcceptance {
  termsAccepted: boolean
  privacyAccepted: boolean
  notificationFrequency: 'realtime' | 'daily' | 'weekly' | 'off'
  acceptedAt: string
}

interface ConsentGateProps {
  /** Called when the user has accepted both documents. */
  onAccept: (acceptance: ConsentAcceptance) => void
}

export function ConsentGate({ onAccept }: Readonly<ConsentGateProps>) {
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [notificationFrequency, setNotificationFrequency] = useState<
    'realtime' | 'daily' | 'weekly' | 'off'
  >('realtime')
  const [activeDoc, setActiveDoc] = useState<LegalDoc | null>(null)
  const [isDocModalOpen, setIsDocModalOpen] = useState(false)

  const canProceed = termsAccepted && privacyAccepted

  function openDoc(doc: LegalDoc) {
    setActiveDoc(doc)
    setIsDocModalOpen(true)
  }

  function handleAccept() {
    if (!canProceed) return
    onAccept({
      termsAccepted,
      privacyAccepted,
      notificationFrequency,
      acceptedAt: new Date().toISOString(),
    })
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-6 shrink-0 text-[color:var(--color-brand)]" />
        <div>
          <h2 className="font-bold text-[color:var(--color-text-strong)]">Consent required</h2>
          <p className="text-sm text-[color:var(--color-text-muted)]">
            Please read and accept the following documents to continue.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={termsAccepted}
            onChange={e => setTermsAccepted(e.target.checked)}
          />
          <span className="text-sm">
            I have read and accept the{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => openDoc(DECOY_TERMS_OF_SERVICE)}
            >
              Terms of Service
            </button>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={privacyAccepted}
            onChange={e => setPrivacyAccepted(e.target.checked)}
          />
          <span className="text-sm">
            I have read and accept the{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => openDoc(DECOY_PRIVACY_POLICY)}
            >
              Privacy Policy
            </button>
          </span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-[color:var(--color-text-strong)]">
          Notification frequency
        </label>
        <select
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
          value={notificationFrequency}
          onChange={e =>
            setNotificationFrequency(
              e.target.value as 'realtime' | 'daily' | 'weekly' | 'off',
            )
          }
        >
          <option value="realtime">Real-time</option>
          <option value="daily">Daily digest</option>
          <option value="weekly">Weekly digest</option>
          <option value="off">Off</option>
        </select>
      </div>

      <button
        type="button"
        disabled={!canProceed}
        onClick={handleAccept}
        className="ui-button ui-button-primary flex w-full items-center justify-center gap-2 disabled:opacity-50"
      >
        Continue <ArrowRight size={16} />
      </button>

      {activeDoc && (
        <ConsentDocModal
          doc={activeDoc}
          isOpen={isDocModalOpen}
          onClose={() => setIsDocModalOpen(false)}
        />
      )}
    </div>
  )
}
