// src/ui/src/cad/views/BillingSubscriptionView.tsx
// Clinic Subscription Lifecycle, Invoices & Payment Attempts View
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§7.1, §7.2, §9.3)

import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import { 
  CreditCard, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Ban, 
  Receipt, 
  Download 
} from 'lucide-react'

export const BillingSubscriptionView: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const isTenantAdmin = claims.role === 'tenant_admin' || claims.role === 'super_admin'

  const [selectedPlan, setSelectedPlan] = useState<'clinic_monthly' | 'clinic_quarterly' | 'clinic_annual'>('clinic_monthly')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [stkSent, setStkSent] = useState(false)

  // Demo active subscription state for visualization
  const [subStatus, setSubStatus] = useState<'active' | 'past_due' | 'suspended'>('active')
  const graceDaysLeft = 5

  // STAGE B: Hardcoded phone numbers and transaction receipts purged.
  // Invoices will be loaded from the billing service in Stage C.
  const invoices: Array<{
    id: string
    period: string
    amount_kes: number
    status: string
    receipt: string
    method: string
  }> = []

  const handleInitiatePayment = (e: React.FormEvent) => {
    e.preventDefault()
    setIsProcessing(true)
    setTimeout(() => {
      setIsProcessing(false)
      setStkSent(true)
    }, 1200)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Status Warning Banners */}
      {subStatus === 'past_due' && (
        <div className="bg-status-warning-subtle border-l-4 border-status-warning p-4 rounded-r-2xl shadow-xs flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 text-status-warning mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <h4 className="font-bold text-strong">Subscription Past Due (Grace Period Active)</h4>
            <p className="text-muted mt-0.5">
              Renewal payment failed. Your clinic is currently in a <strong>{graceDaysLeft}-day grace period</strong>. 
              All clinical monitoring and patient target bundles continue functioning normally during grace.
            </p>
          </div>
        </div>
      )}

      {subStatus === 'suspended' && (
        <div className="bg-status-error-subtle border-l-4 border-status-error p-4 rounded-r-2xl shadow-xs flex items-start space-x-3">
          <Ban className="w-5 h-5 text-status-error mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <h4 className="font-bold text-strong">Facility Account Suspended</h4>
            <p className="text-muted mt-0.5">
              Subscription grace period has concluded without payment. The dashboard is in <strong>read-only mode</strong>. 
              Existing patient targets are <em>never silently dropped</em> and will expire naturally at their scheduled valid date.
            </p>
          </div>
        </div>
      )}

      {/* Subscription Card */}
      <div className="bg-surface p-6 rounded-2xl border border-border-control shadow-xs">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border-control/20 pb-5">
          <div>
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Facility Subscription</span>
            <h2 className="text-xl font-bold text-strong mt-0.5">{activeTenant?.name || 'Clinic Tenant'}</h2>
            <p className="text-xs text-muted mt-1">
              Current Period: <strong>15 Oct 2026 – 15 Nov 2026</strong> &middot; Plan: <strong>Clinic Monthly Tier</strong>
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase border ${
              subStatus === 'active' ? 'bg-status-success-subtle text-status-success border-status-success/30' :
              subStatus === 'past_due' ? 'bg-status-warning-subtle text-status-warning border-status-warning/30' :
              'bg-status-error-subtle text-status-error border-status-error/30'
            }`}>
              {subStatus === 'active' && <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              {subStatus === 'past_due' && <Clock className="w-3.5 h-3.5 mr-1" />}
              {subStatus.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Pricing Tiers Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div
            onClick={() => setSelectedPlan('clinic_monthly')}
            className={`cursor-pointer p-4 rounded-2xl border-2 transition-all ${
              selectedPlan === 'clinic_monthly'
                ? 'border-brand-mint bg-surface-raised shadow-xs'
                : 'border-border-control/30 hover:border-border-control'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-strong">Monthly Tier</span>
              {selectedPlan === 'clinic_monthly' && (
                <span className="w-2 h-2 rounded-full bg-brand-mint" />
              )}
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-strong">KES 5,000</span>
              <span className="text-xs text-muted"> / month</span>
            </div>
            <p className="text-xs text-muted mt-2">Billed every 30 days &middot; Full cohort analytics & targets</p>
          </div>

          <div
            onClick={() => setSelectedPlan('clinic_quarterly')}
            className={`cursor-pointer p-4 rounded-2xl border-2 transition-all ${
              selectedPlan === 'clinic_quarterly'
                ? 'border-brand-mint bg-surface-raised shadow-xs'
                : 'border-border-control/30 hover:border-border-control'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-strong">Quarterly Tier</span>
              <span className="text-xs bg-status-success-subtle text-status-success font-bold px-1.5 py-0.5 rounded border border-status-success/30">10% OFF</span>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-strong">KES 13,500</span>
              <span className="text-xs text-muted"> / 90 days</span>
            </div>
            <p className="text-xs text-muted mt-2">Save KES 1,500 every quarter</p>
          </div>

          <div
            onClick={() => setSelectedPlan('clinic_annual')}
            className={`cursor-pointer p-4 rounded-2xl border-2 transition-all ${
              selectedPlan === 'clinic_annual'
                ? 'border-brand-mint bg-surface-raised shadow-xs'
                : 'border-border-control/30 hover:border-border-control'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-strong">Annual Tier</span>
              <span className="text-xs bg-status-success-subtle text-status-success font-bold px-1.5 py-0.5 rounded border border-status-success/30">20% OFF</span>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-strong">KES 48,000</span>
              <span className="text-xs text-muted"> / year</span>
            </div>
            <p className="text-xs text-muted mt-2">Best value for established hospitals & centres</p>
          </div>
        </div>

        {/* Payment Initiation Box */}
        {isTenantAdmin && (
          <form onSubmit={handleInitiatePayment} className="mt-6 pt-5 border-t border-border-control/20">
            <h4 className="text-xs font-bold text-strong uppercase tracking-wider mb-3">
              Renew or Top-Up Subscription via M-Pesa STK Push
            </h4>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. 254..."
                  className="w-full px-3 py-2 border border-border-control rounded-xl text-xs font-mono bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-focus"
                />
              </div>

              <button
                type="submit"
                disabled={isProcessing}
                className="w-full sm:w-auto px-6 py-2.5 bg-brand-mint text-brand-navy hover:bg-brand-mint/90 rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                <span>{isProcessing ? 'Initiating STK Push...' : 'Send M-Pesa STK Push'}</span>
              </button>
            </div>
            {stkSent && (
              <p className="text-xs text-status-success mt-2 flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                STK push sent to {phoneNumber}. Enter M-Pesa PIN on handset to activate.
              </p>
            )}
          </form>
        )}
      </div>

      {/* Invoices and Receipts History */}
      <div className="bg-surface rounded-2xl border border-border-control shadow-xs">
        <div className="p-5 border-b border-border-control/20 flex justify-between items-center">
          <h3 className="text-xs font-bold text-strong flex items-center space-x-2">
            <Receipt className="w-4 h-4 text-brand-mint" />
            <span>Invoices & Official Payment Receipts</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-control/20 text-left text-xs">
            <thead className="bg-surface-raised font-semibold text-muted">
              <tr>
                <th className="px-4 py-3">Invoice ID</th>
                <th className="px-4 py-3">Billing Coverage</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Receipt Ref</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Download</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-control/10 text-foreground">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-muted">
                    No billing invoices recorded yet.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface-raised transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-strong">
                      {inv.id}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {inv.period}
                    </td>
                    <td className="px-4 py-3 font-bold text-strong">
                      KES {inv.amount_kes.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {inv.method.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3 font-mono text-status-success font-bold">
                      {inv.receipt}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-status-success-subtle text-status-success uppercase border border-status-success/30">
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-xs text-muted hover:text-strong p-1 rounded hover:bg-surface-raised">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

