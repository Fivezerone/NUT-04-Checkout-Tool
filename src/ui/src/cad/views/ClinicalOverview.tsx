// src/ui/src/cad/views/ClinicalOverview.tsx
// Clinic Cohort Overview & Small-Cell Privacy Analytics
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§9.3, §9.4, §13 Test T13)

import React from 'react'
import { useCadAuth } from '../context/AuthContext'
import { Users, TrendingUp, AlertCircle, HeartPulse, Sparkles } from 'lucide-react'

interface CohortSummary {
  name: string
  condition: string
  count: number
  avgSodiumMg: number
  avgSugarG: number
  compliancePct: number
  suppressed?: boolean
}

export const ClinicalOverview: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const isCommercial = claims.role === 'commercial_stakeholder'
  const k = activeTenant?.config?.small_cell_k || 5

  const rawCohorts: CohortSummary[] = [
    {
      name: 'Cardio-Metabolic (Type 2 Diabetes)',
      condition: 'diabetes',
      count: 48,
      avgSodiumMg: 420,
      avgSugarG: 14.2,
      compliancePct: 76,
    },
    {
      name: 'Essential Hypertension Cohort',
      condition: 'hypertension',
      count: 35,
      avgSodiumMg: 510,
      avgSugarG: 18.0,
      compliancePct: 68,
    },
    {
      name: 'Chronic Kidney Disease (Stage 3 Renal)',
      condition: 'renal',
      count: 14,
      avgSodiumMg: 380,
      avgSugarG: 11.5,
      compliancePct: 82,
    },
    {
      name: 'Rare Paediatric Inborn Metabolic Cohort',
      condition: 'paediatric_rare',
      count: 3, // Less than k=5 -> Must be suppressed for commercial stakeholders
      avgSodiumMg: 210,
      avgSugarG: 8.0,
      compliancePct: 91,
    },
  ]

  // Enforce small-cell suppression when viewed by Commercial Stakeholder (Plan §9.4 / Test T13)
  const cohorts = rawCohorts.map((c) => {
    if (isCommercial && c.count < k) {
      return {
        ...c,
        count: 0,
        avgSodiumMg: 0,
        avgSugarG: 0,
        compliancePct: 0,
        suppressed: true,
      }
    }
    return c
  })

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Cohorts</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">4 Cohorts</h3>
            </div>
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3 flex items-center">
            <span className="text-emerald-600 font-bold mr-1">97</span> Patients Monitored
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Target Compliance</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">74.2%</h3>
            </div>
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3 text-emerald-600 font-medium">
            +4.8% improvement vs last month
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Prescriptions</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">112 Targets</h3>
            </div>
            <div className="p-2.5 bg-purple-50 text-purple-600 rounded-lg">
              <HeartPulse className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Signed ES256 client bundles
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Critical Alerts</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">6 Flags</h3>
            </div>
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-amber-700 mt-3">
            High sodium cart breaches logged
          </p>
        </div>
      </div>

      {/* Cohorts Population Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <span>Patient Cohorts & Aggregated Dietary Quality</span>
              {isCommercial && (
                <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold uppercase">
                  De-Identified Commercial View (k &ge; {k})
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Population-level monitoring derived from user-confirmed shopping events and consumption logs.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Cohort Name</th>
                <th className="px-4 py-3">Cohort Size</th>
                <th className="px-4 py-3">Mean Sodium Intake</th>
                <th className="px-4 py-3">Mean Sugar Intake</th>
                <th className="px-4 py-3">Dietary Target Adherence</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {cohorts.map((cohort, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3.5 font-bold text-slate-900">
                    {cohort.name}
                  </td>
                  <td className="px-4 py-3.5 font-medium">
                    {cohort.suppressed ? (
                      <span className="text-amber-700 font-mono italic bg-amber-50 px-1.5 py-0.5 rounded">
                        Suppressed (&lt; {k})
                      </span>
                    ) : (
                      <span>{cohort.count} patients</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {cohort.suppressed ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span>{cohort.avgSodiumMg} mg / day</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {cohort.suppressed ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span>{cohort.avgSugarG} g / 100g</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {cohort.suppressed ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <div className="w-16 bg-slate-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-2 rounded-full"
                            style={{ width: `${cohort.compliancePct}%` }}
                          />
                        </div>
                        <span className="font-semibold text-slate-800">{cohort.compliancePct}%</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {cohort.suppressed ? (
                      <span className="inline-flex items-center text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        Privacy Protected
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        <Sparkles className="w-3 h-3 mr-1" /> Active Tracking
                      </span>
                    )}
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

