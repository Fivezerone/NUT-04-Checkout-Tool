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
  const [phoneNumber, setPhoneNumber] = useState('254712345678')
  const [isProcessing, setIsProcessing] = useState(false)
  const [stkSent, setStkSent] = useState(false)

  // Demo active subscription state for visualization
  const [subStatus, setSubStatus] = useState<'active' | 'past_due' | 'suspended'>('active')
  const graceDaysLeft = 5

  const invoices = [
    {
      id: 'inv-2026-10',
      period: 'Oct 2026 – Nov 2026',
      amount_kes: 5000.00,
      status: 'paid',
      paid_at: '2026-10-15T09:30:00Z',
      receipt: 'QHJ882194K',
      method: 'mpesa_stk',
    },
    {
      id: 'inv-2026-09',
      period: 'Sep 2026 – Oct 2026',
      amount_kes: 5000.00,
      status: 'paid',
      paid_at: '2026-09-15T11:14:00Z',
      receipt: 'PZX110943A',
      method: 'mpesa_stk',
    },
  ]

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
        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl shadow-sm flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <h4 className="font-bold text-amber-900">Subscription Past Due (Grace Period Active)</h4>
            <p className="text-amber-800 mt-0.5">
              Renewal payment failed. Your clinic is currently in a <strong>{graceDaysLeft}-day grace period</strong>. 
              All clinical monitoring and patient target bundles continue functioning normally during grace.
            </p>
          </div>
        </div>
      )}

      {subStatus === 'suspended' && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl shadow-sm flex items-start space-x-3">
          <Ban className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <h4 className="font-bold text-red-900">Facility Account Suspended</h4>
            <p className="text-red-800 mt-0.5">
              Subscription grace period has concluded without payment. The dashboard is in <strong>read-only mode</strong>. 
              Existing patient targets are <em>never silently dropped</em> and will expire naturally at their scheduled valid date.
            </p>
          </div>
        </div>
      )}

      {/* Subscription Card */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-5">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Facility Subscription</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">{activeTenant?.name || 'Clinic Tenant'}</h2>
            <p className="text-xs text-slate-500 mt-1">
              Current Period: <strong>15 Oct 2026 – 15 Nov 2026</strong> &middot; Plan: <strong>Clinic Monthly Tier</strong>
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase ${
              subStatus === 'active' ? 'bg-emerald-100 text-emerald-800' :
              subStatus === 'past_due' ? 'bg-amber-100 text-amber-800' :
              'bg-red-100 text-red-800'
            }`}>
              {subStatus === 'active' && <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />}
              {subStatus === 'past_due' && <Clock className="w-3.5 h-3.5 mr-1 text-amber-600" />}
              {subStatus.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Pricing Tiers Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div
            onClick={() => setSelectedPlan('clinic_monthly')}
            className={`cursor-pointer p-4 rounded-xl border-2 transition-all ${
              selectedPlan === 'clinic_monthly'
                ? 'border-emerald-600 bg-emerald-50/40 shadow-sm'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-700">Monthly Tier</span>
              {selectedPlan === 'clinic_monthly' && (
                <span className="w-2 h-2 rounded-full bg-emerald-600" />
              )}
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-slate-900">KES 5,000</span>
              <span className="text-xs text-slate-500"> / month</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Billed every 30 days &middot; Full cohort analytics & targets</p>
          </div>

          <div
            onClick={() => setSelectedPlan('clinic_quarterly')}
            className={`cursor-pointer p-4 rounded-xl border-2 transition-all ${
              selectedPlan === 'clinic_quarterly'
                ? 'border-emerald-600 bg-emerald-50/40 shadow-sm'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-700">Quarterly Tier</span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">10% OFF</span>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-slate-900">KES 13,500</span>
              <span className="text-xs text-slate-500"> / 90 days</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Save KES 1,500 every quarter</p>
          </div>

          <div
            onClick={() => setSelectedPlan('clinic_annual')}
            className={`cursor-pointer p-4 rounded-xl border-2 transition-all ${
              selectedPlan === 'clinic_annual'
                ? 'border-emerald-600 bg-emerald-50/40 shadow-sm'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-700">Annual Tier</span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">20% OFF</span>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-slate-900">KES 48,000</span>
              <span className="text-xs text-slate-500"> / year</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Best value for established hospitals & centres</p>
          </div>
        </div>

        {/* Payment Initiation Box */}
        {isTenantAdmin && (
          <form onSubmit={handleInitiatePayment} className="mt-6 pt-5 border-t border-slate-100">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
              Renew or Top-Up Subscription via M-Pesa STK Push
            </h4>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="254712345678"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <button
                type="submit"
                disabled={isProcessing}
                className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                <CreditCard className="w-4 h-4" />
                <span>{isProcessing ? 'Initiating STK Push...' : 'Send M-Pesa STK Push'}</span>
              </button>
            </div>
            {stkSent && (
              <p className="text-xs text-emerald-700 mt-2 flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                STK push sent to {phoneNumber}. Enter M-Pesa PIN on handset to activate.
              </p>
            )}
          </form>
        )}
      </div>

      {/* Invoices and Receipts History */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Receipt className="w-4 h-4 text-emerald-600" />
            <span>Invoices & Official Payment Receipts</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-600">
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
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-slate-900">
                    {inv.id}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {inv.period}
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-900">
                    KES {inv.amount_kes.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 capitalize">
                    {inv.method.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3 font-mono text-emerald-700 font-bold">
                    {inv.receipt}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-xs text-slate-500 hover:text-slate-800 p-1 rounded hover:bg-slate-100">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

