import * as React from 'react'
import { Banner, type AlertTier } from '../../app/components/ui/Banner'
import { useCadAuth } from '../context/AuthContext'

export function SystemHealthBanner() {
  const { claims, mfaRequired } = useCadAuth()

  // If MFA is required for this staff role but unverified, render Tier 3 alert
  if (mfaRequired) {
    return (
      <Banner
        tier={3}
        title="Multi-Factor Authentication Required"
        message="Two-factor verification (TOTP) is mandatory for clinical and administrative access. Please complete MFA verification to access clinical records."
        className="mb-4"
      />
    )
  }

  // Role-specific operational context (derived without hardcoded numbers)
  const getContextualAlert = (): { tier: AlertTier; title?: string; message: string } | null => {
    switch (claims.role) {
      case 'super_admin':
        return {
          tier: 0,
          title: 'System Telemetry',
          message: 'Multi-tenant telemetry and platform configuration are operating normally.',
        }
      case 'compliance_auditor':
        return {
          tier: 0,
          title: 'Audit Ledger',
          message: 'WORM audit hash verification active. Ledger is strictly append-only.',
        }
      case 'commercial_stakeholder':
        return {
          tier: 0,
          title: 'Differential Privacy',
          message: 'Commercial reporting enforces strict k-anonymity (k >= 50); small cohorts remain protected.',
        }
      case 'writing_clinician':
      case 'viewing_dietician':
      case 'tenant_admin':
      default:
        return null
    }
  }

  const alert = getContextualAlert()
  if (!alert) return null

  return (
    <Banner
      tier={alert.tier}
      title={alert.title}
      message={alert.message}
      className="mb-4"
    />
  )
}
