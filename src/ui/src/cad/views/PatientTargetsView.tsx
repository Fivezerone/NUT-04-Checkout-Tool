// src/ui/src/cad/views/PatientTargetsView.tsx
// Clinician Nutrient Target Prescription & Bundle Management
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§8.1, §8.2, §8.3)

import React, { useState, useRef, useEffect } from 'react'
import { useCadAuth } from '../context/AuthContext'
import type { NutrientTarget } from '../types'
import { Plus, CheckCircle, X } from 'lucide-react'
import { PageHeader } from '../components/Primitives'
import { DataTable } from '../../app/components/ui/DataTable'
import { Badge } from '../../app/components/ui/Badge'
import { Button } from '../../app/components/ui/Button'
import { Input } from '../../app/components/ui/Input'
import { Select } from '../../app/components/ui/Select'

export const PatientTargetsView: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const isWritingClinician = claims.role === 'writing_clinician' || claims.role === 'super_admin'

  const [targets, setTargets] = useState<NutrientTarget[]>([])
  const [showModal, setShowModal] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [patientRef, setPatientRef] = useState('')
  const [nutrientCode, setNutrientCode] = useState('SodiumMG')
  const [comparator, setComparator] = useState<'lte' | 'lt' | 'gte' | 'gt'>('lte')
  const [value, setValue] = useState(2000)
  const [unit, setUnit] = useState<'mg' | 'g'>('mg')
  const [severity, setSeverity] = useState<'info' | 'caution' | 'critical'>('critical')
  const [reason, setReason] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (showModal) {
      if (!dialog.open) {
        dialog.showModal()
      }
    } else {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [showModal])

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
              cosigned_by: claims.userId || 'clinician',
            }
          : t,
      ),
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinical targets"
        title="Nutrient targets and signed bundles"
        description={
          <>
            Clinic: <strong>{activeTenant?.name || claims.tenantId}</strong>. Targets are compiled
            into ES256-signed client bundles.
          </>
        }
        actions={
          isWritingClinician ? (
            <Button variant="primary" onClick={() => setShowModal(true)}>
              <Plus size={17} /> Prescribe target
            </Button>
          ) : undefined
        }
      />

      {/* Targets DataTable: No truncation, Reason placed second */}
      <DataTable<NutrientTarget>
        columns={[
          {
            id: 'subject_ref',
            header: 'Patient Ref',
            accessor: (r) => r.subject_ref || 'Cohort Baseline',
            cell: (v) => <span className="font-mono font-bold text-strong">{v}</span>,
            sortable: true,
            priority: 1,
            kind: 'id',
          },
          {
            id: 'reason',
            header: 'Clinical Reason & Evidence',
            accessor: (r) => r.reason,
            cell: (v) => <span className="text-foreground break-words leading-relaxed">{v || '—'}</span>,
            priority: 1,
            kind: 'text',
          },
          {
            id: 'constraint',
            header: 'Rule Constraint',
            accessor: (r) => `${r.nutrient_code} ${r.comparator} ${r.value}${r.unit}`,
            cell: (_v, r) => (
              <div className="flex items-center gap-1.5 font-semibold text-strong">
                <span>{r.nutrient_code.replace('MG', '').replace('G', '')}</span>
                <span className="font-mono text-muted">
                  {r.comparator === 'lte' ? '≤' : r.comparator === 'lt' ? '<' : '≥'}
                </span>
                <span>
                  {r.value} {r.unit}/day
                </span>
              </div>
            ),
            sortable: true,
            priority: 2,
            kind: 'text',
          },
          {
            id: 'severity',
            header: 'Severity',
            accessor: (r) => r.severity,
            cell: (v) => (
              <Badge variant={v === 'critical' ? 'critical' : v === 'caution' ? 'warning' : 'info'}>
                {v}
              </Badge>
            ),
            sortable: true,
            priority: 2,
            kind: 'status',
          },
          {
            id: 'status',
            header: 'Status',
            accessor: (r) => r.status,
            cell: (v) => (
              <Badge variant={v === 'active' ? 'success' : 'warning'}>
                {v === 'active' ? 'Active' : 'Pending Cosign'}
              </Badge>
            ),
            sortable: true,
            priority: 2,
            kind: 'status',
          },
          {
            id: 'actions',
            header: 'Action',
            accessor: (r) => r.target_id,
            cell: (id, r) =>
              r.status === 'pending_cosign' && isWritingClinician ? (
                <Button size="sm" variant="secondary" onClick={() => handleCosign(id)}>
                  <CheckCircle size={14} /> Cosign
                </Button>
              ) : null,
            priority: 1,
            kind: 'actions',
          },
        ]}
        data={targets}
        keyExtractor={(r) => r.target_id}
        searchable
        searchPlaceholder="Filter targets by patient ref, nutrient, or clinical reason..."
        emptyTitle="No clinical targets prescribed yet"
        emptyDescription="Writing clinicians can prescribe patient-specific thresholds compiled into cryptographic Dietary Profile Tokens."
        caption="Active clinical nutrient prescription rules"
      />

      {/* Native <dialog> Modal with showModal() */}
      <dialog
        ref={dialogRef}
        onClose={() => setShowModal(false)}
        className="backdrop:bg-black/50 backdrop:backdrop-blur-xs rounded-2xl bg-surface border border-border-control p-6 max-w-lg w-full text-foreground shadow-xl m-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border-control/20">
          <h2 className="text-[16px] font-bold text-strong">Prescribe clinical nutrient target</h2>
          <button
            type="button"
            onClick={() => setShowModal(false)}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-muted hover:text-strong hover:bg-surface-raised cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleCreateTarget} className="mt-4 flex flex-col gap-4 text-xs">
          <Input
            label="Patient identifier ref"
            required
            placeholder="patient-test-01"
            value={patientRef}
            onChange={(e) => setPatientRef(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Nutrient"
              value={nutrientCode}
              onChange={(e) => {
                setNutrientCode(e.target.value)
                if (e.target.value === 'SodiumMG' || e.target.value === 'PotassiumMG') {
                  setUnit('mg')
                } else {
                  setUnit('g')
                }
              }}
            >
              <option value="SodiumMG">Sodium (mg)</option>
              <option value="SugarsG">Sugars (g)</option>
              <option value="SaturatedFatG">Saturated Fat (g)</option>
              <option value="PotassiumMG">Potassium (mg) [Renal]</option>
              <option value="PhosphorusMG">Phosphorus (mg) [Renal]</option>
              <option value="ProteinG">Protein (g)</option>
            </Select>

            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium text-strong">Comparator & Limit</label>
              <div className="flex gap-2">
                <select
                  value={comparator}
                  onChange={(e) => setComparator(e.target.value as any)}
                  className="h-10 px-2.5 bg-surface text-foreground text-[12px] rounded-xl border border-border-control outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <option value="lte">≤</option>
                  <option value="lt">&lt;</option>
                  <option value="gte">≥</option>
                </select>
                <input
                  type="number"
                  required
                  value={value}
                  onChange={(e) => setValue(Number(e.target.value))}
                  className="h-10 px-3 bg-surface text-foreground font-bold text-[12px] rounded-xl border border-border-control outline-none focus-visible:ring-2 focus-visible:ring-focus w-full"
                />
              </div>
            </div>
          </div>

          <Select
            label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as any)}
          >
            <option value="critical">Critical (Breach triggers emergency alert)</option>
            <option value="caution">Caution (Warning on high concentration)</option>
            <option value="info">Informational</option>
          </Select>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-medium text-strong">
              Clinical rationale & evidence reference
            </label>
            <textarea
              required
              rows={3}
              placeholder="Clinical indication (e.g. KDIGO 2024 Guidelines, Stage 3 CKD management)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="p-3 bg-surface text-foreground text-[12px] rounded-xl border border-border-control outline-none focus-visible:ring-2 focus-visible:ring-focus leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border-control/20">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Publish Target
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
