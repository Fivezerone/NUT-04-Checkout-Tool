// src/ui/src/cad/views/PatientTargetsView.tsx
// Clinician Nutrient Target Prescription & Bundle Management
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§8.1, §8.2, §8.3)

import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import type { NutrientTarget } from '../types'
import { ShieldCheck, Plus, CheckCircle, Clock } from 'lucide-react'

export const PatientTargetsView: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const isWritingClinician = claims.role === 'writing_clinician' || claims.role === 'super_admin'

  const [targets, setTargets] = useState<NutrientTarget[]>([
    {
      target_id: 'tgt-001',
      tenant_id: claims.tenantId,
      version: 1,
      scope: 'patient',
      subject_ref: 'pat-anon-8821',
      nutrient_code: 'SodiumMG',
      unit: 'mg',
      basis: 'per_day',
      comparator: 'lte',
      value: 2000,
      severity: 'critical',
      valid_from: '2026-10-01',
      valid_to: '2026-12-31',
      status: 'active',
      set_by: claims.userId || 'usr-dr-omondi',
      reason: 'Stage 2 Hypertension strict dietary sodium restriction',
      created_at: new Date().toISOString(),
    },
    {
      target_id: 'tgt-002',
      tenant_id: claims.tenantId,
      version: 1,
      scope: 'cohort',
      subject_ref: 'cohort-diabetes-type2',
      nutrient_code: 'SugarsG',
      unit: 'g',
      basis: 'per_100g',
      comparator: 'lte',
      value: 10,
      severity: 'caution',
      valid_from: '2026-09-01',
      status: 'active',
      set_by: 'usr-dr-omondi',
      reason: 'Standard ADA/KFCT threshold for glycemic management',
      created_at: new Date().toISOString(),
    },
    {
      target_id: 'tgt-003',
      tenant_id: claims.tenantId,
      version: 1,
      scope: 'patient',
      subject_ref: 'pat-anon-4109',
      nutrient_code: 'PotassiumMG',
      unit: 'mg',
      basis: 'per_day',
      comparator: 'lte',
      value: 2000,
      severity: 'critical',
      valid_from: '2026-10-15',
      status: 'pending_cosign',
      set_by: 'usr-diet-wanjiku',
      reason: 'Renal stage 3 hyperkalemia prevention (requires physician co-sign)',
      created_at: new Date().toISOString(),
    },
  ])

  const [showModal, setShowModal] = useState(false)
  const [patientRef, setPatientRef] = useState('')
  const [nutrientCode, setNutrientCode] = useState('SodiumMG')
  const [comparator, setComparator] = useState<'lte' | 'lt' | 'gte' | 'gt'>('lte')
  const [value, setValue] = useState(2000)
  const [unit, setUnit] = useState<'mg' | 'g'>('mg')
  const [severity, setSeverity] = useState<'info' | 'caution' | 'critical'>('critical')
  const [reason, setReason] = useState('')

  const handleCreateTarget = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason || !patientRef) return

    const isRenalOrPaediatric = nutrientCode === 'PotassiumMG' || nutrientCode === 'PhosphorusMG'
    const newTarget: NutrientTarget = {
      target_id: 'tgt-' + Math.random().toString(36).slice(2, 9),
      tenant_id: claims.tenantId,
      version: 1,
      scope: 'patient',
      subject_ref: patientRef,
      nutrient_code: nutrientCode,
      unit,
      basis: 'per_day',
      comparator,
      value: Number(value),
      severity,
      valid_from: new Date().toISOString().slice(0, 10),
      status: isRenalOrPaediatric ? 'pending_cosign' : 'active',
      set_by: claims.userId || 'clinician',
      reason,
      created_at: new Date().toISOString(),
    }

    setTargets([newTarget, ...targets])
    setShowModal(false)
    setPatientRef('')
    setReason('')
  }

  const handleCosign = (targetId: string) => {
    setTargets((prev) =>
      prev.map((t) =>
        t.target_id === targetId
          ? {
              ...t,
              status: 'active',
              cosigned_by: claims.userId || 'usr-dr-omondi',
            }
          : t
      )
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>Clinical Nutrient Targets & Signed Bundles</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Clinic: <strong>{activeTenant?.name || claims.tenantId}</strong> &middot; Targets are compiled into ES256 cryptographically signed bundles for client extensions.
          </p>
        </div>

        {isWritingClinician && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Prescribe Target</span>
          </button>
        )}
      </div>

      {/* Targets Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Scope / Subject</th>
                <th className="px-4 py-3">Nutrient</th>
                <th className="px-4 py-3">Rule Constraint</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Reason / Clinical Evidence</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {targets.map((tgt) => (
                <tr key={tgt.target_id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{tgt.subject_ref || 'Tenant Default'}</div>
                    <div className="text-[10px] text-slate-400 capitalize">{tgt.scope} Scope</div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {tgt.nutrient_code}
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-slate-900">
                    {tgt.comparator.toUpperCase()} {tgt.value} {tgt.unit} / {tgt.basis.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      tgt.severity === 'critical' ? 'bg-red-100 text-red-800' :
                      tgt.severity === 'caution' ? 'bg-amber-100 text-amber-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {tgt.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {tgt.status === 'active' ? (
                      <span className="inline-flex items-center text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-bold">
                        <CheckCircle className="w-3 h-3 mr-1" /> Active
                      </span>
                    ) : tgt.status === 'pending_cosign' ? (
                      <span className="inline-flex items-center text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-bold">
                        <Clock className="w-3 h-3 mr-1" /> Pending Co-Sign
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">{tgt.status}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-slate-600" title={tgt.reason}>
                    {tgt.reason}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tgt.status === 'pending_cosign' && isWritingClinician && (
                      <button
                        onClick={() => handleCosign(tgt.target_id)}
                        className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold px-2.5 py-1 rounded transition-colors"
                      >
                        Co-Sign Rule
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Target Prescription Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Prescribe Clinical Nutrient Target</h3>
            <form onSubmit={handleCreateTarget} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Patient Identifier Ref</label>
                <input
                  type="text"
                  required
                  placeholder="pat-anon-1234"
                  value={patientRef}
                  onChange={(e) => setPatientRef(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Nutrient</label>
                  <select
                    value={nutrientCode}
                    onChange={(e) => {
                      setNutrientCode(e.target.value)
                      if (e.target.value === 'SodiumMG' || e.target.value === 'PotassiumMG') {
                        setUnit('mg')
                      } else {
                        setUnit('g')
                      }
                    }}
                    className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="SodiumMG">Sodium (mg)</option>
                    <option value="SugarsG">Sugars (g)</option>
                    <option value="SaturatedFatG">Saturated Fat (g)</option>
                    <option value="PotassiumMG">Potassium (mg) [Renal]</option>
                    <option value="PhosphorusMG">Phosphorus (mg) [Renal]</option>
                    <option value="ProteinG">Protein (g)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Comparator & Limit</label>
                  <div className="flex space-x-2 mt-1">
                    <select
                      value={comparator}
                      onChange={(e) => setComparator(e.target.value as any)}
                      className="px-2 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      <option value="lte">&le; (Max)</option>
                      <option value="lt">&lt; (Less)</option>
                      <option value="gte">&ge; (Min)</option>
                    </select>
                    <input
                      type="number"
                      required
                      value={value}
                      onChange={(e) => setValue(Number(e.target.value))}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Severity</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="critical">Critical (Breach triggers emergency alert)</option>
                  <option value="caution">Caution (Warning on high concentration)</option>
                  <option value="info">Informational</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Clinical Rationale & Evidence Ref</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Clinical indication (e.g. KDIGO 2024 Guidelines, Stage 3 CKD management)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                >
                  Publish Target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

