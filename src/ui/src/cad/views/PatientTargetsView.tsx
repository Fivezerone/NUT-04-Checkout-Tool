// src/ui/src/cad/views/PatientTargetsView.tsx
// Clinician Nutrient Target Prescription & Bundle Management
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§8.1, §8.2, §8.3)

import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import type { NutrientTarget } from '../types'
import { Plus, CheckCircle, Clock } from 'lucide-react'
import { PageHeader, StatusBadge } from '../components/Primitives'

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
      <PageHeader
        eyebrow="Clinical targets"
        title="Nutrient targets and signed bundles"
        description={<>Clinic: <strong>{activeTenant?.name || claims.tenantId}</strong>. Targets are compiled into ES256-signed client bundles.</>}
        actions={isWritingClinician ? <button onClick={() => setShowModal(true)} className="ui-button ui-button-primary"><Plus size={17} /> Prescribe target</button> : undefined}
      />

      {/* Targets Table */}
      <div className="ui-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ui-table min-w-full text-left">
            <thead>
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
            <tbody>
              {targets.map((tgt) => (
                <tr key={tgt.target_id}>
                  <td>
                    <div className="font-semibold text-[color:var(--color-text-strong)]">{tgt.subject_ref || 'Tenant Default'}</div>
                    <div className="mt-1 text-xs text-[color:var(--color-text-muted)] capitalize">{tgt.scope} scope</div>
                  </td>
                  <td className="font-semibold text-[color:var(--color-text-strong)]">
                    {tgt.nutrient_code}
                  </td>
                  <td className="font-mono font-bold text-[color:var(--color-text-strong)]">
                    {tgt.comparator.toUpperCase()} {tgt.value} {tgt.unit} / {tgt.basis.replace('_', ' ')}
                  </td>
                  <td>
                    <StatusBadge tone={tgt.severity === 'critical' ? 'critical' : tgt.severity === 'caution' ? 'warning' : 'info'}>{tgt.severity}</StatusBadge>
                  </td>
                  <td>
                    {tgt.status === 'active' ? (
                      <StatusBadge tone="success"><CheckCircle size={14} /> Active</StatusBadge>
                    ) : tgt.status === 'pending_cosign' ? (
                      <StatusBadge tone="warning"><Clock size={14} /> Pending co-sign</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">{tgt.status}</StatusBadge>
                    )}
                  </td>
                  <td className="max-w-xs truncate" title={tgt.reason}>
                    {tgt.reason}
                  </td>
                  <td className="text-right">
                    {tgt.status === 'pending_cosign' && isWritingClinician && (
                      <button
                        onClick={() => handleCosign(tgt.target_id)}
                        className="ui-button ui-button-secondary"
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
        <div className="ui-modal-backdrop" role="presentation">
          <div className="ui-modal space-y-4" role="dialog" aria-modal="true" aria-labelledby="target-dialog-title">
            <h2 id="target-dialog-title" className="text-xl font-bold text-[color:var(--color-text-strong)]">Prescribe clinical nutrient target</h2>
            <form onSubmit={handleCreateTarget} className="space-y-4 text-sm">
              <div>
                <label className="ui-field-label">Patient identifier ref</label>
                <input
                  type="text"
                  required
                  placeholder="pat-anon-1234"
                  value={patientRef}
                  onChange={(e) => setPatientRef(e.target.value)}
                  className="ui-input mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="ui-field-label">Nutrient</label>
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
                    className="ui-select mt-1"
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
                  <label className="ui-field-label">Comparator and limit</label>
                  <div className="flex space-x-2 mt-1">
                    <select
                      value={comparator}
                      onChange={(e) => setComparator(e.target.value as any)}
                      className="ui-select w-auto"
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
                      className="ui-input flex-1 font-bold"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="ui-field-label">Severity</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                  className="ui-select mt-1"
                >
                  <option value="critical">Critical (Breach triggers emergency alert)</option>
                  <option value="caution">Caution (Warning on high concentration)</option>
                  <option value="info">Informational</option>
                </select>
              </div>

              <div>
                <label className="ui-field-label">Clinical rationale and evidence reference</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Clinical indication (e.g. KDIGO 2024 Guidelines, Stage 3 CKD management)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="ui-textarea mt-1"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="ui-button ui-button-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ui-button ui-button-primary"
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

