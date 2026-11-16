// src/ui/src/cad/views/HealthModesView.tsx
// Clinician Health Mode Designer, Versioning & Nutrient Rules Engine
// Reference: CAD-Only Identity & Onboarding Rollback (Phase 5)

import React, { useState, useRef, useEffect } from 'react'
import { useCadAuth } from '../context/AuthContext'
import {
  ShieldCheck,
  Plus,
  Trash2,
  CheckCircle,
  Archive,
  Copy,
  Sparkles,
  Layers,
  ChevronRight,
  X,
} from 'lucide-react'
import { DataTable } from '../../app/components/ui/DataTable'
import { Badge } from '../../app/components/ui/Badge'
import { Button } from '../../app/components/ui/Button'
import { Input } from '../../app/components/ui/Input'
import { Select } from '../../app/components/ui/Select'

export interface TrackedNutrient {
  code: string
  name: string
  unit: string
  catalogCoveragePct: number
  defaultBasis: string
}

export interface HealthModeRule {
  id: string
  nutrientCode: string
  comparator: 'lte' | 'lt' | 'gte' | 'gt' | 'eq'
  threshold: number
  unit: string
  basis: 'per_100g' | 'per_serving' | 'per_day'
  severity: 'advisory' | 'warning' | 'high' | 'critical'
  clinicalRationale: string
}

export interface HealthMode {
  id: string
  tenantId: string
  code: string
  name: string
  version: number
  status: 'active' | 'draft' | 'retired'
  description: string
  rules: HealthModeRule[]
  updatedAt: string
}

export const TRACKED_NUTRIENTS: TrackedNutrient[] = [
  { code: 'SugarsG', name: 'Sugars', unit: 'g', catalogCoveragePct: 98, defaultBasis: 'per_100g' },
  { code: 'SodiumMG', name: 'Sodium', unit: 'mg', catalogCoveragePct: 96, defaultBasis: 'per_100g' },
  { code: 'SaturatedFatG', name: 'Saturated Fat', unit: 'g', catalogCoveragePct: 94, defaultBasis: 'per_100g' },
  { code: 'CarbohydratesG', name: 'Carbohydrates', unit: 'g', catalogCoveragePct: 99, defaultBasis: 'per_100g' },
  { code: 'EnergyKcal', name: 'Energy / Calories', unit: 'kcal', catalogCoveragePct: 99, defaultBasis: 'per_100g' },
  { code: 'ProteinG', name: 'Protein', unit: 'g', catalogCoveragePct: 97, defaultBasis: 'per_100g' },
  { code: 'FibreG', name: 'Dietary Fibre', unit: 'g', catalogCoveragePct: 88, defaultBasis: 'per_100g' },
  { code: 'PotassiumMG', name: 'Potassium', unit: 'mg', catalogCoveragePct: 65, defaultBasis: 'per_100g' },
  { code: 'PhosphorusMG', name: 'Phosphorus', unit: 'mg', catalogCoveragePct: 52, defaultBasis: 'per_100g' },
  { code: 'TransFatG', name: 'Trans Fat', unit: 'g', catalogCoveragePct: 45, defaultBasis: 'per_100g' },
]

export const HEALTH_MODE_PRESETS: Record<string, { name: string; description: string; rules: HealthModeRule[] }> = {
  diabetes: {
    name: 'Cardio-Metabolic (Type 2 Diabetes)',
    description: 'Glycaemic regulation, carbohydrate thresholding, and energy density control',
    rules: [
      {
        id: 'r-diab-1',
        nutrientCode: 'SugarsG',
        comparator: 'lte',
        threshold: 22.5,
        unit: 'g',
        basis: 'per_100g',
        severity: 'critical',
        clinicalRationale: 'Direct post-prandial glycaemic risk reduction per ADA guidelines',
      },
      {
        id: 'r-diab-2',
        nutrientCode: 'CarbohydratesG',
        comparator: 'lte',
        threshold: 60.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'high',
        clinicalRationale: 'Glycaemic load restriction for insulin sensitivity optimization',
      },
      {
        id: 'r-diab-3',
        nutrientCode: 'EnergyKcal',
        comparator: 'lte',
        threshold: 400.0,
        unit: 'kcal',
        basis: 'per_100g',
        severity: 'warning',
        clinicalRationale: 'Energy density regulation to prevent metabolic overload',
      },
      {
        id: 'r-diab-4',
        nutrientCode: 'FibreG',
        comparator: 'gte',
        threshold: 3.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'advisory',
        clinicalRationale: 'Fibre satiety enhancement slows carbohydrate absorption',
      },
    ],
  },
  hypertension: {
    name: 'Cardiovascular / Hypertension',
    description: 'Stringent sodium ceiling and saturated fat restriction for blood pressure regulation',
    rules: [
      {
        id: 'r-hyp-1',
        nutrientCode: 'SodiumMG',
        comparator: 'lte',
        threshold: 600.0,
        unit: 'mg',
        basis: 'per_100g',
        severity: 'critical',
        clinicalRationale: 'WHO & MOH Kenya sodium ceiling for cardiovascular risk reduction',
      },
      {
        id: 'r-hyp-2',
        nutrientCode: 'SaturatedFatG',
        comparator: 'lte',
        threshold: 5.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'high',
        clinicalRationale: 'Atherosclerotic plaque progression reduction per ESC guidelines',
      },
    ],
  },
  kidney: {
    name: 'Chronic Kidney Disease (Non-Dialysis)',
    description: 'Renal solute load management: sodium, potassium, and phosphorus control',
    rules: [
      {
        id: 'r-ckd-1',
        nutrientCode: 'SodiumMG',
        comparator: 'lte',
        threshold: 400.0,
        unit: 'mg',
        basis: 'per_100g',
        severity: 'critical',
        clinicalRationale: 'KDIGO 2024 renal blood pressure and fluid overload control',
      },
      {
        id: 'r-ckd-2',
        nutrientCode: 'PotassiumMG',
        comparator: 'lte',
        threshold: 200.0,
        unit: 'mg',
        basis: 'per_100g',
        severity: 'high',
        clinicalRationale: 'Hyperkalaemia prevention in stage 3-4 chronic kidney disease',
      },
      {
        id: 'r-ckd-3',
        nutrientCode: 'ProteinG',
        comparator: 'lte',
        threshold: 12.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'warning',
        clinicalRationale: 'Glomerular hyperfiltration reduction in non-dialysis nephropathy',
      },
    ],
  },
  obesity: {
    name: 'Metabolic Weight Management',
    description: 'Caloric density restriction, free sugar suppression, and trans-fat elimination',
    rules: [
      {
        id: 'r-obe-1',
        nutrientCode: 'EnergyKcal',
        comparator: 'lte',
        threshold: 250.0,
        unit: 'kcal',
        basis: 'per_100g',
        severity: 'critical',
        clinicalRationale: 'Hypocaloric diet adherence for sustainable metabolic deficit',
      },
      {
        id: 'r-obe-2',
        nutrientCode: 'SugarsG',
        comparator: 'lte',
        threshold: 10.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'high',
        clinicalRationale: 'Fructose/sucrose reduction to reduce visceral adiposity',
      },
      {
        id: 'r-obe-3',
        nutrientCode: 'SaturatedFatG',
        comparator: 'lte',
        threshold: 3.5,
        unit: 'g',
        basis: 'per_100g',
        severity: 'high',
        clinicalRationale: 'Hepatic steatosis risk minimization',
      },
    ],
  },
}

export const HealthModesView: React.FC = () => {
  const { claims } = useCadAuth()
  const isClinician = claims.role === 'writing_clinician' || claims.role === 'super_admin'

  const [modes, setModes] = useState<HealthMode[]>([
    {
      id: 'hm-1',
      tenantId: claims.tenantId,
      code: 'diabetes',
      name: HEALTH_MODE_PRESETS.diabetes.name,
      version: 1,
      status: 'active',
      description: HEALTH_MODE_PRESETS.diabetes.description,
      rules: HEALTH_MODE_PRESETS.diabetes.rules,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'hm-2',
      tenantId: claims.tenantId,
      code: 'hypertension',
      name: HEALTH_MODE_PRESETS.hypertension.name,
      version: 1,
      status: 'active',
      description: HEALTH_MODE_PRESETS.hypertension.description,
      rules: HEALTH_MODE_PRESETS.hypertension.rules,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'hm-3',
      tenantId: claims.tenantId,
      code: 'kidney',
      name: HEALTH_MODE_PRESETS.kidney.name,
      version: 1,
      status: 'active',
      description: HEALTH_MODE_PRESETS.kidney.description,
      rules: HEALTH_MODE_PRESETS.kidney.rules,
      updatedAt: new Date().toISOString(),
    },
  ])

  const [selectedModeId, setSelectedModeId] = useState<string>('hm-1')
  const activeMode = modes.find((m) => m.id === selectedModeId) || modes[0]

  const [showAddModal, setShowAddModal] = useState<boolean>(false)
  const addModalRef = useRef<HTMLDialogElement>(null)

  const [selectedPreset, setSelectedPreset] = useState<string>('none')
  const [newModeCode, setNewModeCode] = useState<string>('')
  const [newModeName, setNewModeName] = useState<string>('')
  const [newModeDesc, setNewModeDesc] = useState<string>('')

  const [showAddRule, setShowAddRule] = useState<boolean>(false)
  const addRuleModalRef = useRef<HTMLDialogElement>(null)

  const [ruleNutrient, setRuleNutrient] = useState<string>('SodiumMG')
  const [ruleComparator, setRuleComparator] = useState<'lte' | 'lt' | 'gte' | 'gt' | 'eq'>('lte')
  const [ruleThreshold, setRuleThreshold] = useState<number>(600)
  const [ruleSeverity, setRuleSeverity] = useState<'advisory' | 'warning' | 'high' | 'critical'>('critical')
  const [ruleRationale, setRuleRationale] = useState<string>('')

  // Control dialogs
  useEffect(() => {
    const d = addModalRef.current
    if (!d) return
    if (showAddModal) {
      if (!d.open) d.showModal()
    } else {
      if (d.open) d.close()
    }
  }, [showAddModal])

  useEffect(() => {
    const d = addRuleModalRef.current
    if (!d) return
    if (showAddRule) {
      if (!d.open) d.showModal()
    } else {
      if (d.open) d.close()
    }
  }, [showAddRule])

  const handleApplyPreset = (presetKey: string) => {
    setSelectedPreset(presetKey)
    if (presetKey !== 'none' && HEALTH_MODE_PRESETS[presetKey]) {
      const p = HEALTH_MODE_PRESETS[presetKey]
      setNewModeCode(presetKey)
      setNewModeName(p.name)
      setNewModeDesc(p.description)
    }
  }

  const handleCreateMode = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newModeCode || !newModeName) return

    const initialRules =
      selectedPreset !== 'none' && HEALTH_MODE_PRESETS[selectedPreset]
        ? HEALTH_MODE_PRESETS[selectedPreset].rules
        : []

    const newMode: HealthMode = {
      id: `hm-${Date.now().toString(36)}`,
      tenantId: claims.tenantId,
      code: newModeCode.toLowerCase().trim().replace(/\s+/g, '_'),
      name: newModeName.trim(),
      version: 1,
      status: 'active',
      description: newModeDesc.trim(),
      rules: initialRules,
      updatedAt: new Date().toISOString(),
    }

    setModes((prev) => [newMode, ...prev])
    setSelectedModeId(newMode.id)
    setShowAddModal(false)
    setNewModeCode('')
    setNewModeName('')
    setNewModeDesc('')
    setSelectedPreset('none')
  }

  const handleVersionBump = () => {
    if (!activeMode) return
    setModes((prev) =>
      prev.map((m) =>
        m.id === activeMode.id
          ? {
              ...m,
              version: m.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : m,
      ),
    )
  }

  const handleRetireMode = () => {
    if (!activeMode) return
    setModes((prev) =>
      prev.map((m) =>
        m.id === activeMode.id
          ? {
              ...m,
              status: 'retired',
              updatedAt: new Date().toISOString(),
            }
          : m,
      ),
    )
  }

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeMode || !ruleRationale) return

    const nutrientMeta = TRACKED_NUTRIENTS.find((n) => n.code === ruleNutrient)
    const newRule: HealthModeRule = {
      id: `r-${Date.now().toString(36)}`,
      nutrientCode: ruleNutrient,
      comparator: ruleComparator,
      threshold: ruleThreshold,
      unit: nutrientMeta?.unit || 'g',
      basis: 'per_100g',
      severity: ruleSeverity,
      clinicalRationale: ruleRationale.trim(),
    }

    setModes((prev) =>
      prev.map((m) =>
        m.id === activeMode.id
          ? {
              ...m,
              rules: [...m.rules, newRule],
              updatedAt: new Date().toISOString(),
            }
          : m,
      ),
    )

    setShowAddRule(false)
    setRuleRationale('')
    setRuleThreshold(600)
  }

  const handleDeleteRule = (ruleId: string) => {
    if (!activeMode) return
    setModes((prev) =>
      prev.map((m) =>
        m.id === activeMode.id
          ? {
              ...m,
              rules: m.rules.filter((r) => r.id !== ruleId),
              updatedAt: new Date().toISOString(),
            }
          : m,
      ),
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border-control/20 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="ui-eyebrow text-strong font-bold">Clinical Nutrition Rules</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full font-mono bg-surface-raised border border-border-control text-strong">
              W3C DTCG
            </span>
          </div>
          <h1 className="text-[20px] font-bold text-strong mt-1">Health Mode Designer & Rules Engine</h1>
          <p className="text-[12px] text-muted max-w-2xl mt-0.5">
            Configure disease-specific nutrient threshold profiles. Rules calibrate real-time alerts
            and smart swap recommendations.
          </p>
        </div>

        {isClinician && (
          <Button variant="primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> Create Mode
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {/* Left Column: Mode Selector Cards */}
        <div className="bg-surface rounded-2xl border border-border-control/20 p-4 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-border-control/10">
            <h2 className="text-[12px] font-bold text-strong uppercase tracking-wider">
              Health Modes ({modes.length})
            </h2>
            <span className="text-[12px] text-muted">Clinic Tenant</span>
          </div>

          <div className="flex flex-col gap-2">
            {modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setSelectedModeId(mode.id)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                  selectedModeId === mode.id
                    ? 'border-brand-mint bg-surface-raised shadow-xs'
                    : 'border-border-control/20 hover:bg-surface-raised/50'
                }`}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-strong text-[12px]">{mode.name}</span>
                    <span className="text-[12px] font-mono font-bold bg-surface px-1.5 py-0.5 rounded border border-border-control text-muted">
                      v{mode.version}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-muted">
                    <span>{mode.rules.length} rules</span>
                    <span>&middot;</span>
                    <span
                      className={`capitalize font-semibold ${
                        mode.status === 'active' ? 'text-status-success' : 'text-muted'
                      }`}
                    >
                      {mode.status}
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Right Column: Active Mode Detail & Rule Builder */}
        <div className="md:col-span-2 flex flex-col gap-4">
          {activeMode && (
            <div className="bg-surface rounded-2xl border border-border-control/20 shadow-xs p-5 flex flex-col gap-5">
              {/* Mode Meta Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-control/10 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[16px] font-bold text-strong">{activeMode.name}</h3>
                    <span className="text-[12px] px-2 py-0.5 rounded-full font-mono bg-surface-raised border border-border-control text-strong font-bold">
                      Version {activeMode.version}
                    </span>
                    <Badge variant={activeMode.status === 'active' ? 'success' : 'neutral'}>
                      {activeMode.status}
                    </Badge>
                  </div>
                  <p className="text-[12px] text-muted mt-1">{activeMode.description}</p>
                </div>

                {isClinician && activeMode.status === 'active' && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={handleVersionBump} title="Bump to next version">
                      <Copy size={14} /> Bump Version
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleRetireMode} title="Retire this mode">
                      <Archive size={14} /> Retire
                    </Button>
                  </div>
                )}
              </div>

              {/* Rules DataTable */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[12px] font-bold text-strong uppercase tracking-wider">
                    Nutrient Threshold Rules ({activeMode.rules.length})
                  </h4>
                  {isClinician && activeMode.status === 'active' && (
                    <Button size="sm" variant="primary" onClick={() => setShowAddRule(true)}>
                      <Plus size={14} /> Add Nutrient Rule
                    </Button>
                  )}
                </div>

                <DataTable<HealthModeRule>
                  columns={[
                    {
                      id: 'nutrient',
                      header: 'Nutrient',
                      accessor: (r) => {
                        const meta = TRACKED_NUTRIENTS.find((n) => n.code === r.nutrientCode)
                        return meta?.name || r.nutrientCode
                      },
                      cell: (v, r) => (
                        <div className="flex flex-col">
                          <span className="font-semibold text-strong">{v}</span>
                          <span className="font-mono text-[12px] text-muted">{r.nutrientCode}</span>
                        </div>
                      ),
                      sortable: true,
                      priority: 1,
                      kind: 'text',
                    },
                    {
                      id: 'rationale',
                      header: 'Clinical Rationale & Evidence',
                      accessor: (r) => r.clinicalRationale,
                      cell: (v) => <span className="text-foreground break-words leading-relaxed">{v || '—'}</span>,
                      priority: 1,
                      kind: 'text',
                    },
                    {
                      id: 'coverage',
                      header: 'Catalog Coverage',
                      accessor: (r) => {
                        const meta = TRACKED_NUTRIENTS.find((n) => n.code === r.nutrientCode)
                        return meta?.catalogCoveragePct ?? 0
                      },
                      cell: (cov) => (
                        <Badge variant={cov >= 90 ? 'success' : cov >= 60 ? 'warning' : 'critical'}>
                          {cov}% coverage
                        </Badge>
                      ),
                      sortable: true,
                      priority: 2,
                      kind: 'number',
                    },
                    {
                      id: 'constraint',
                      header: 'Constraint',
                      accessor: (r) => `${r.comparator} ${r.threshold} ${r.unit}`,
                      cell: (_v, r) => (
                        <span className="font-mono font-bold text-strong">
                          {r.comparator.toUpperCase()} {r.threshold} {r.unit} / {r.basis.replace('_', ' ')}
                        </span>
                      ),
                      priority: 2,
                      kind: 'text',
                    },
                    {
                      id: 'severity',
                      header: 'Severity',
                      accessor: (r) => r.severity,
                      cell: (v) => (
                        <Badge
                          variant={v === 'critical' ? 'critical' : v === 'high' ? 'warning' : 'info'}
                        >
                          {v}
                        </Badge>
                      ),
                      sortable: true,
                      priority: 2,
                      kind: 'status',
                    },
                    {
                      id: 'actions',
                      header: '',
                      accessor: (r) => r.id,
                      cell: (id) =>
                        isClinician && activeMode.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteRule(id)}
                            className="p-1 rounded text-muted hover:text-status-critical cursor-pointer"
                            title="Delete rule"
                          >
                            <Trash2 size={15} />
                          </button>
                        ) : null,
                      priority: 1,
                      kind: 'actions',
                    },
                  ]}
                  data={activeMode.rules}
                  keyExtractor={(r) => r.id}
                  emptyTitle="No nutrient rules defined in this mode yet"
                  emptyDescription="Click 'Add Nutrient Rule' above to establish threshold limits for this mode."
                  caption="Nutrient threshold limits and clinical indications"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Mode Modal */}
      <dialog
        ref={addModalRef}
        onClose={() => setShowAddModal(false)}
        className="backdrop:bg-black/50 backdrop:backdrop-blur-xs rounded-2xl bg-surface border border-border-control p-6 max-w-md w-full text-foreground shadow-xl m-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border-control/20">
          <h3 className="text-[16px] font-bold text-strong">Create Clinical Health Mode</h3>
          <button
            type="button"
            onClick={() => setShowAddModal(false)}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-muted hover:text-strong cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleCreateMode} className="mt-4 flex flex-col gap-4 text-xs">
          <Select
            label="Preset Template"
            value={selectedPreset}
            onChange={(e) => handleApplyPreset(e.target.value)}
          >
            <option value="none">Custom Blank Mode</option>
            <option value="diabetes">Diabetes (Sugars, Carbs, Calories, Fibre)</option>
            <option value="hypertension">Hypertension (Sodium, Sat Fat)</option>
            <option value="kidney">Kidney Disease (Sodium, Potassium, Protein)</option>
            <option value="obesity">Obesity (Calories, Sugars, Sat Fat)</option>
          </Select>

          <Input
            label="Mode Code (Identifier)"
            type="text"
            required
            placeholder="e.g. cardio_metabolic"
            value={newModeCode}
            onChange={(e) => setNewModeCode(e.target.value)}
          />

          <Input
            label="Display Name"
            type="text"
            required
            placeholder="e.g. Cardio-Metabolic Protocol"
            value={newModeName}
            onChange={(e) => setNewModeName(e.target.value)}
          />

          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-medium text-strong">
              Clinical Objective / Description
            </label>
            <textarea
              rows={2}
              placeholder="Clinical objectives and patient cohort suitability..."
              value={newModeDesc}
              onChange={(e) => setNewModeDesc(e.target.value)}
              className="p-3 bg-surface text-foreground text-[12px] rounded-xl border border-border-control outline-none focus-visible:ring-2 focus-visible:ring-focus leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border-control/20">
            <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create Mode
            </Button>
          </div>
        </form>
      </dialog>

      {/* Add Rule Modal */}
      <dialog
        ref={addRuleModalRef}
        onClose={() => setShowAddRule(false)}
        className="backdrop:bg-black/50 backdrop:backdrop-blur-xs rounded-2xl bg-surface border border-border-control p-6 max-w-lg w-full text-foreground shadow-xl m-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border-control/20">
          <h3 className="text-[16px] font-bold text-strong">Add Nutrient Rule</h3>
          <button
            type="button"
            onClick={() => setShowAddRule(false)}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-muted hover:text-strong cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-2 text-[12px] text-muted">
          Select a tracked nutrient and calibrate its threshold based on clinical evidence.
        </p>

        <form onSubmit={handleAddRule} className="mt-4 flex flex-col gap-4 text-xs">
          <Select
            label="Tracked Nutrient (Catalog Coverage)"
            value={ruleNutrient}
            onChange={(e) => setRuleNutrient(e.target.value)}
          >
            {TRACKED_NUTRIENTS.map((n) => (
              <option key={n.code} value={n.code}>
                {n.name} ({n.code}) &middot; {n.catalogCoveragePct}% catalog coverage [{n.unit}]
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Comparator"
              value={ruleComparator}
              onChange={(e) => setRuleComparator(e.target.value as any)}
            >
              <option value="lte">≤ (Less than or equal - Max limit)</option>
              <option value="lt">&lt; (Strictly less than)</option>
              <option value="gte">≥ (Greater than or equal - Min target)</option>
              <option value="gt">&gt; (Strictly greater than)</option>
            </Select>

            <Input
              label={`Threshold (${TRACKED_NUTRIENTS.find((n) => n.code === ruleNutrient)?.unit || 'g'} / 100g)`}
              type="number"
              step="0.1"
              required
              value={ruleThreshold}
              onChange={(e) => setRuleThreshold(parseFloat(e.target.value))}
            />
          </div>

          <Select
            label="Alert Severity"
            value={ruleSeverity}
            onChange={(e) => setRuleSeverity(e.target.value as any)}
          >
            <option value="critical">Critical (Hard warning on card & flyout)</option>
            <option value="high">High (Elevated warning)</option>
            <option value="warning">Warning (Standard threshold breach)</option>
            <option value="advisory">Advisory (Informational recommendation)</option>
          </Select>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-medium text-strong">Clinical Rationale & Evidence</label>
            <textarea
              rows={2}
              required
              placeholder="e.g. MOH Kenya salt reduction guidelines for hypertension management"
              value={ruleRationale}
              onChange={(e) => setRuleRationale(e.target.value)}
              className="p-3 bg-surface text-foreground text-[12px] rounded-xl border border-border-control outline-none focus-visible:ring-2 focus-visible:ring-focus leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border-control/20">
            <Button type="button" variant="secondary" onClick={() => setShowAddRule(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Add Rule
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
export default HealthModesView
