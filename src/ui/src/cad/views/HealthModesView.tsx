// src/ui/src/cad/views/HealthModesView.tsx
// Clinician Health Mode Designer, Versioning & Nutrient Rules Engine
// Reference: CAD-Only Identity & Onboarding Rollback (Phase 5)

import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import {
  ShieldCheck,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Archive,
  Copy,
  Sparkles,
  Layers,
  ChevronRight,
} from 'lucide-react'

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
        threshold: 6.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'advisory',
        clinicalRationale: 'Protective soluble fibre slows glucose absorption kinetics',
      },
    ],
  },
  hypertension: {
    name: 'Essential Hypertension Care',
    description: 'Vascular resistance reduction and strict sodium restriction',
    rules: [
      {
        id: 'r-htn-1',
        nutrientCode: 'SodiumMG',
        comparator: 'lte',
        threshold: 600.0,
        unit: 'mg',
        basis: 'per_100g',
        severity: 'critical',
        clinicalRationale: 'WHO/MOH Kenya national salt reduction guidelines for hypertension management',
      },
      {
        id: 'r-htn-2',
        nutrientCode: 'SaturatedFatG',
        comparator: 'lte',
        threshold: 5.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'high',
        clinicalRationale: 'Cardiovascular atherosclerotic risk mitigation',
      },
    ],
  },
  kidney: {
    name: 'Chronic Kidney Disease (Stage 3 Renal)',
    description: 'Electrolyte retention prevention and renal solute load moderation',
    rules: [
      {
        id: 'r-ren-1',
        nutrientCode: 'SodiumMG',
        comparator: 'lte',
        threshold: 600.0,
        unit: 'mg',
        basis: 'per_100g',
        severity: 'critical',
        clinicalRationale: 'Fluid overload and blood pressure management in renal insufficiency',
      },
      {
        id: 'r-ren-2',
        nutrientCode: 'PotassiumMG',
        comparator: 'lte',
        threshold: 200.0,
        unit: 'mg',
        basis: 'per_100g',
        severity: 'critical',
        clinicalRationale: 'Hyperkalaemia prevention in impaired glomerular filtration',
      },
      {
        id: 'r-ren-3',
        nutrientCode: 'ProteinG',
        comparator: 'lte',
        threshold: 15.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'warning',
        clinicalRationale: 'Glomerular hyperfiltration reduction and nitrogenous waste management',
      },
    ],
  },
  obesity: {
    name: 'Metabolic Weight Management',
    description: 'Caloric density restriction and saturated fat control',
    rules: [
      {
        id: 'r-obs-1',
        nutrientCode: 'EnergyKcal',
        comparator: 'lte',
        threshold: 400.0,
        unit: 'kcal',
        basis: 'per_100g',
        severity: 'critical',
        clinicalRationale: 'Energy density restriction to promote caloric deficit',
      },
      {
        id: 'r-obs-2',
        nutrientCode: 'SugarsG',
        comparator: 'lte',
        threshold: 22.5,
        unit: 'g',
        basis: 'per_100g',
        severity: 'high',
        clinicalRationale: 'Avoidance of rapid insulin surges and adipogenesis',
      },
      {
        id: 'r-obs-3',
        nutrientCode: 'SaturatedFatG',
        comparator: 'lte',
        threshold: 5.0,
        unit: 'g',
        basis: 'per_100g',
        severity: 'warning',
        clinicalRationale: 'Lipid profile optimization and non-alcoholic fatty liver mitigation',
      },
    ],
  },
}

export const HealthModesView: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const isClinician =
    claims.role === 'writing_clinician' ||
    claims.role === 'tenant_admin' ||
    claims.role === 'super_admin'

  const [modes, setModes] = useState<HealthMode[]>([
    {
      id: 'hm-diab-v1',
      tenantId: claims.tenantId,
      code: 'diabetes',
      name: HEALTH_MODE_PRESETS.diabetes.name,
      version: 1,
      status: 'active',
      description: HEALTH_MODE_PRESETS.diabetes.description,
      rules: HEALTH_MODE_PRESETS.diabetes.rules,
      updatedAt: '2026-10-20T10:00:00Z',
    },
    {
      id: 'hm-htn-v1',
      tenantId: claims.tenantId,
      code: 'hypertension',
      name: HEALTH_MODE_PRESETS.hypertension.name,
      version: 1,
      status: 'active',
      description: HEALTH_MODE_PRESETS.hypertension.description,
      rules: HEALTH_MODE_PRESETS.hypertension.rules,
      updatedAt: '2026-10-22T14:30:00Z',
    },
    {
      id: 'hm-renal-v1',
      tenantId: claims.tenantId,
      code: 'kidney',
      name: HEALTH_MODE_PRESETS.kidney.name,
      version: 1,
      status: 'active',
      description: HEALTH_MODE_PRESETS.kidney.description,
      rules: HEALTH_MODE_PRESETS.kidney.rules,
      updatedAt: '2026-10-24T09:15:00Z',
    },
  ])

  const [selectedModeId, setSelectedModeId] = useState<string>(modes[0]?.id || '')
  const [showAddModal, setShowAddModal] = useState<boolean>(false)
  const [newModeCode, setNewModeCode] = useState<string>('')
  const [newModeName, setNewModeName] = useState<string>('')
  const [newModeDesc, setNewModeDesc] = useState<string>('')
  const [selectedPreset, setSelectedPreset] = useState<string>('none')

  // Rule editor state
  const [showAddRule, setShowAddRule] = useState<boolean>(false)
  const [ruleNutrient, setRuleNutrient] = useState<string>('SugarsG')
  const [ruleComparator, setRuleComparator] = useState<'lte' | 'lt' | 'gte' | 'gt' | 'eq'>('lte')
  const [ruleThreshold, setRuleThreshold] = useState<number>(20)
  const [ruleSeverity, setRuleSeverity] = useState<'advisory' | 'warning' | 'high' | 'critical'>('warning')
  const [ruleRationale, setRuleRationale] = useState<string>('')

  const activeMode = modes.find((m) => m.id === selectedModeId) || modes[0]

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

    let initialRules: HealthModeRule[] = []
    if (selectedPreset !== 'none' && HEALTH_MODE_PRESETS[selectedPreset]) {
      initialRules = HEALTH_MODE_PRESETS[selectedPreset].rules.map((r) => ({
        ...r,
        id: 'r-' + Math.random().toString(36).slice(2, 8),
      }))
    }

    const newMode: HealthMode = {
      id: 'hm-' + Math.random().toString(36).slice(2, 9),
      tenantId: claims.tenantId,
      code: newModeCode.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
      name: newModeName,
      version: 1,
      status: 'active',
      description: newModeDesc,
      rules: initialRules,
      updatedAt: new Date().toISOString(),
    }

    setModes([newMode, ...modes])
    setSelectedModeId(newMode.id)
    setShowAddModal(false)
    setNewModeCode('')
    setNewModeName('')
    setNewModeDesc('')
    setSelectedPreset('none')
  }

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ruleRationale || !activeMode) return

    const nutrientMeta = TRACKED_NUTRIENTS.find((n) => n.code === ruleNutrient)
    const newRule: HealthModeRule = {
      id: 'r-' + Math.random().toString(36).slice(2, 8),
      nutrientCode: ruleNutrient,
      comparator: ruleComparator,
      threshold: Number(ruleThreshold),
      unit: nutrientMeta?.unit || 'g',
      basis: 'per_100g',
      severity: ruleSeverity,
      clinicalRationale: ruleRationale,
    }

    setModes((prev) =>
      prev.map((m) =>
        m.id === activeMode.id
          ? {
              ...m,
              rules: [...m.rules, newRule],
              updatedAt: new Date().toISOString(),
            }
          : m
      )
    )

    setShowAddRule(false)
    setRuleRationale('')
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
          : m
      )
    )
  }

  const handleVersionBump = () => {
    if (!activeMode) return
    const nextVersion = activeMode.version + 1
    const clonedMode: HealthMode = {
      ...activeMode,
      id: `hm-${activeMode.code}-v${nextVersion}`,
      version: nextVersion,
      status: 'active',
      updatedAt: new Date().toISOString(),
    }

    setModes((prev) => [
      clonedMode,
      ...prev.map((m) => (m.id === activeMode.id ? { ...m, status: 'retired' as const } : m)),
    ])
    setSelectedModeId(clonedMode.id)
  }

  const handleRetireMode = () => {
    if (!activeMode) return
    setModes((prev) =>
      prev.map((m) => (m.id === activeMode.id ? { ...m, status: 'retired' } : m))
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
            <Layers className="w-5 h-5 text-emerald-600" />
            <span>Clinician Health Modes & Nutrient Rules Engine</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Clinic: <strong>{activeTenant?.name || claims.tenantId}</strong> &middot; Clinicians define, version, and assign dietary rule suites.
          </p>
        </div>

        {isClinician && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Health Mode</span>
          </button>
        )}
      </div>

      {/* Main Layout: Mode List on Left, Active Rule Suite on Right */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Mode Selector */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
            Clinic Health Modes ({modes.length})
          </h3>

          <div className="space-y-2">
            {modes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setSelectedModeId(mode.id)}
                className={`w-full text-left p-3 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                  mode.id === selectedModeId
                    ? 'border-emerald-600 bg-emerald-50/60 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span>{mode.name}</span>
                    <span className="text-[10px] px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded font-mono">
                      v{mode.version}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">{mode.description}</div>
                  <div className="text-[10px] text-slate-400">
                    {mode.rules.length} rule(s) &middot; Status:{' '}
                    <span
                      className={`capitalize font-semibold ${
                        mode.status === 'active' ? 'text-emerald-700' : 'text-slate-500'
                      }`}
                    >
                      {mode.status}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Right Column: Active Mode Detail & Rule Builder */}
        <div className="md:col-span-2 space-y-4">
          {activeMode && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-5">
              {/* Mode Meta Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{activeMode.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-emerald-100 text-emerald-800 font-bold">
                      Version {activeMode.version}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full capitalize font-semibold ${
                        activeMode.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {activeMode.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{activeMode.description}</p>
                </div>

                {isClinician && activeMode.status === 'active' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleVersionBump}
                      title="Bump to next version"
                      className="px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Bump Version</span>
                    </button>
                    <button
                      onClick={handleRetireMode}
                      title="Retire this mode"
                      className="px-3 py-1.5 border border-rose-300 text-rose-700 hover:bg-rose-50 rounded-lg text-xs font-semibold flex items-center gap-1"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>Retire</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Rules List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Nutrient Threshold Rules ({activeMode.rules.length})
                  </h4>
                  {isClinician && activeMode.status === 'active' && (
                    <button
                      onClick={() => setShowAddRule(true)}
                      className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Nutrient Rule</span>
                    </button>
                  )}
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 text-slate-600 font-semibold">
                      <tr>
                        <th className="px-3 py-2 text-left">Nutrient</th>
                        <th className="px-3 py-2 text-left">Coverage</th>
                        <th className="px-3 py-2 text-left">Constraint</th>
                        <th className="px-3 py-2 text-left">Severity</th>
                        <th className="px-3 py-2 text-left">Clinical Rationale</th>
                        {isClinician && activeMode.status === 'active' && (
                          <th className="px-3 py-2 text-right">Action</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {activeMode.rules.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                            No nutrient rules defined in this mode yet.
                          </td>
                        </tr>
                      ) : (
                        activeMode.rules.map((rule) => {
                          const nutrientMeta = TRACKED_NUTRIENTS.find((n) => n.code === rule.nutrientCode)
                          const coverage = nutrientMeta?.catalogCoveragePct ?? 0

                          return (
                            <tr key={rule.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-semibold text-slate-900">
                                <div>{nutrientMeta?.name || rule.nutrientCode}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{rule.nutrientCode}</div>
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    coverage >= 90
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : coverage >= 60
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {coverage}% catalog
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono font-bold text-slate-900">
                                {rule.comparator.toUpperCase()} {rule.threshold} {rule.unit} / {rule.basis.replace('_', ' ')}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    rule.severity === 'critical'
                                      ? 'bg-red-100 text-red-800'
                                      : rule.severity === 'high'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {rule.severity}
                                </span>
                              </td>
                              <td className="px-3 py-2 min-w-[180px] break-words text-wrap text-slate-600" title={rule.clinicalRationale}>
                                {rule.clinicalRationale}
                              </td>
                              {isClinician && activeMode.status === 'active' && (
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() => handleDeleteRule(rule.id)}
                                    className="text-slate-400 hover:text-rose-600 transition-colors"
                                    title="Delete rule"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Mode Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Create Clinical Health Mode</h3>
            <form onSubmit={handleCreateMode} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Preset Template</label>
                <select
                  value={selectedPreset}
                  onChange={(e) => handleApplyPreset(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="none">Custom Blank Mode</option>
                  <option value="diabetes">Diabetes (Sugars, Carbs, Calories, Fibre)</option>
                  <option value="hypertension">Hypertension (Sodium, Sat Fat)</option>
                  <option value="kidney">Kidney Disease (Sodium, Potassium, Protein)</option>
                  <option value="obesity">Obesity (Calories, Sugars, Sat Fat)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Mode Code (Identifier)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. cardio_metabolic"
                  value={newModeCode}
                  onChange={(e) => setNewModeCode(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Display Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cardio-Metabolic Protocol"
                  value={newModeName}
                  onChange={(e) => setNewModeName(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Clinical Objective / Description</label>
                <textarea
                  rows={2}
                  placeholder="Clinical objectives and patient cohort suitability..."
                  value={newModeDesc}
                  onChange={(e) => setNewModeDesc(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm"
                >
                  Create Mode
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Rule Modal with Nutrient Picker & Catalog Coverage */}
      {showAddRule && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Add Nutrient Rule</h3>
            <p className="text-xs text-slate-500">
              Select a tracked nutrient and calibrate its threshold based on clinical evidence.
            </p>

            <form onSubmit={handleAddRule} className="space-y-4 text-sm">
              {/* Nutrient Picker with Coverage */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tracked Nutrient (Catalog Coverage)
                </label>
                <select
                  value={ruleNutrient}
                  onChange={(e) => setRuleNutrient(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {TRACKED_NUTRIENTS.map((n) => (
                    <option key={n.code} value={n.code}>
                      {n.name} ({n.code}) &middot; {n.catalogCoveragePct}% catalog coverage [{n.unit}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Comparator</label>
                  <select
                    value={ruleComparator}
                    onChange={(e) => setRuleComparator(e.target.value as any)}
                    className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="lte">&le; (Less than or equal - Max limit)</option>
                    <option value="lt">&lt; (Strictly less than)</option>
                    <option value="gte">&ge; (Greater than or equal - Min target)</option>
                    <option value="gt">&gt; (Strictly greater than)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Threshold Value ({TRACKED_NUTRIENTS.find((n) => n.code === ruleNutrient)?.unit || 'g'} / 100g)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={ruleThreshold}
                    onChange={(e) => setRuleThreshold(parseFloat(e.target.value))}
                    className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Alert Severity</label>
                <select
                  value={ruleSeverity}
                  onChange={(e) => setRuleSeverity(e.target.value as any)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="critical">Critical (Hard warning on card & flyout)</option>
                  <option value="high">High (Elevated warning)</option>
                  <option value="warning">Warning (Standard threshold breach)</option>
                  <option value="advisory">Advisory (Informational recommendation)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Clinical Rationale & Evidence</label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. MOH Kenya salt reduction guidelines for hypertension management"
                  value={ruleRationale}
                  onChange={(e) => setRuleRationale(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddRule(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm"
                >
                  Add Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
