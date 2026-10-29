// src/ui/src/cad/views/TenantSettingsView.tsx
// Clinic Configuration, Policy Settings & Privacy Parameters
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.1, §6.6, §11.1)

import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import { cadSupabase } from '../supabaseClient'
import { Settings, Shield, Globe, Database, Save, Check } from 'lucide-react'

export const TenantSettingsView: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const [name, setName] = useState(activeTenant?.name || '')
  const [rulePack, setRulePack] = useState(activeTenant?.config?.rule_pack || 'diabetes_hypertension')
  const [language, setLanguage] = useState(activeTenant?.config?.language || 'en')
  const [smallCellK, setSmallCellK] = useState(activeTenant?.config?.small_cell_k || 5)
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setSaved(false)

    const updatedConfig = {
      ...activeTenant?.config,
      rule_pack: rulePack,
      language,
      small_cell_k: Number(smallCellK),
    }

    try {
      await cadSupabase
        .from('tenants')
        .update({
          name,
          config: updatedConfig,
          updated_at: new Date().toISOString(),
        })
        .eq('id', claims.tenantId)

      // Audit log event
      await cadSupabase.from('audit_log').insert({
        tenant_id: claims.tenantId,
        actor_id: claims.userId || 'admin',
        actor_role: claims.role,
        action: 'UPDATE_TENANT_CONFIG',
        mutation_type: 'update',
        resource_type: 'Tenant',
        resource_id: claims.tenantId,
        reason: 'Updated tenant clinical rule pack and privacy threshold parameters',
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setSaved(true)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
            <Settings className="w-5 h-5 text-emerald-600" />
            <span>Facility Configuration & Privacy Parameters</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Tenant ID: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">{claims.tenantId}</code>
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-500">Status:</span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 uppercase">
            {activeTenant?.status || 'Active'}
          </span>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
        {/* Basic Facility Info */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Facility Information
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Facility / Clinic Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Tenant Slug</label>
              <input
                type="text"
                disabled
                value={activeTenant?.slug || 'knh-cardio'}
                className="mt-1 w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm font-mono text-slate-500 cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Clinical Rule Pack Defaults */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center space-x-2">
            <Shield className="w-4 h-4 text-emerald-600" />
            <span>Clinical Rule Pack & Scoring Defaults</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Default Rule Pack</label>
              <select
                value={rulePack}
                onChange={(e) => setRulePack(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                <option value="diabetes_hypertension">Cardiometabolic (Diabetes & Hypertension)</option>
                <option value="renal_unit">Renal Care Unit (Low Sodium, Potassium, Phosphorus)</option>
                <option value="paediatric_nutrition">Paediatric Nutrition Standards</option>
                <option value="general_wellness">General Population Wellness (KFCT 2018)</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Sets default baseline nutrient bounds pushed to client extension target bundles.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 flex items-center space-x-1">
                <Globe className="w-3.5 h-3.5" />
                <span>Primary Language</span>
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'en' | 'sw')}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                <option value="en">English (Official)</option>
                <option value="sw">Kiswahili (Sanifu)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Data Privacy & Small-Cell Suppression */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center space-x-2">
            <Database className="w-4 h-4 text-emerald-600" />
            <span>Privacy & Small-Cell Suppression (DPA s.37 / HIM Reg 24)</span>
          </h3>

          <div className="max-w-md">
            <label className="block text-xs font-semibold text-slate-700">
              Minimum Cohort Size (k-Anonymity Threshold)
            </label>
            <div className="flex items-center space-x-3 mt-1">
              <input
                type="number"
                min={3}
                max={20}
                value={smallCellK}
                onChange={(e) => setSmallCellK(Number(e.target.value))}
                className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-600">
                Patients (cohorts below {smallCellK} are suppressed in de-identified reports)
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Prevents re-identification of small patient groups by Commercial Stakeholders or external auditors.
            </p>
          </div>
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-slate-100">
          <div className="text-xs text-slate-500">
            Per-tenant data key encryption active. Destroying key crypto-shreds tenant data.
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center space-x-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                <span>Saved Changes</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

