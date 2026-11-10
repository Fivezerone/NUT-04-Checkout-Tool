// src/ui/src/cad/views/UserManagementView.tsx
// Clinic Staff, Clinicians & Licence Management for Clinic Admin Dashboard
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.1, §6.6), Phase 2 RBAC & Lifecycle
//
// STAGE A (A-03): cadSupabase removed; data fetch and mutations stubbed.
// STAGE B (B-01): Demo clinic roster (knh.or.ke emails, KMPDC numbers) removed.
// TODO (Stage C): Replace stubs with OIDC-authed REST calls via PostgREST + Edge Functions.

import React, { useState, useEffect } from 'react'
import { useCadAuth } from '../context/AuthContext'
import type { TenantMember, CadRole } from '../types'
import { UserPlus, CheckCircle, AlertTriangle, UserX, Copy, Check } from 'lucide-react'
import { PageHeader, StatusBadge } from '../components/Primitives'

const PROVISIONABLE_ROLES: Record<CadRole, CadRole[]> = {
  super_admin: ['tenant_admin', 'compliance_auditor', 'commercial_stakeholder'],
  tenant_admin: ['writing_clinician', 'viewing_dietician', 'compliance_auditor', 'patient'],
  writing_clinician: ['patient'],
  viewing_dietician: [],
  compliance_auditor: [],
  commercial_stakeholder: [],
  patient: [],
}

export const UserManagementView: React.FC = () => {
  const { claims, activeTenant, availableTenants } = useCadAuth()
  const [members, setMembers] = useState<TenantMember[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false)
  const [newEmail, setNewEmail] = useState<string>('')
  const [newRole, setNewRole] = useState<CadRole>('writing_clinician')
  const [newLicence, setNewLicence] = useState<string>('')
  const [partnerOrg, setPartnerOrg] = useState<string>('')
  const [regulatorBody, setRegulatorBody] = useState<'DHA' | 'ODPC'>('DHA')
  const [mandateRef, setMandateRef] = useState<string>('')
  const [targetTenantId, setTargetTenantId] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [provisionSuccess, setProvisionSuccess] = useState<{
    email: string
    role: string
    password?: string
  } | null>(null)
  const [copiedPwd, setCopiedPwd] = useState<boolean>(false)

  const permittedProvisionRoles = PROVISIONABLE_ROLES[claims.role]
  // This is visibility only. The Edge Function asks iam.role_grants for every
  // decision; no UI array is an authorization source.
  const isPlatformAuditor = claims.role === 'super_admin' && newRole === 'compliance_auditor'
  const tenantChoices = availableTenants.filter(
    (tenant) => tenant.id !== '00000000-0000-0000-0000-000000000000',
  )
  const selectedTenantId = claims.role === 'super_admin' ? targetTenantId : claims.tenantId

  useEffect(() => {
    loadMembers()
  }, [claims.tenantId])

  useEffect(() => {
    if (claims.role !== 'super_admin') return
    const preferredTenant = tenantChoices.some((tenant) => tenant.id === claims.tenantId)
      ? claims.tenantId
      : tenantChoices[0]?.id || ''
    setTargetTenantId(preferredTenant)
  }, [claims.role, claims.tenantId, availableTenants])

  const loadMembers = async () => {
    setLoading(true)
    try {
      // TODO (Stage C): GET /tenant_members?tenant_id=eq.{tenantId} via PostgREST.
      // Stub: returns empty list (B-01 — demo roster with clinic-domain emails removed).
      setMembers([])
    } catch {
      // Ignore
    } finally {
      setLoading(false)
    }
  }

  const toggleVerifyLicence = async (memberUserId: string, currentStatus: boolean) => {
    // TODO (Stage C): PATCH /tenant_members and POST /audit_log via PostgREST.
    // Stub: optimistic local update only.
    setMembers((prev) =>
      prev.map((m) =>
        m.user_id === memberUserId ? { ...m, licence_verified: !currentStatus } : m
      )
    )
  }

  const handleStatusChange = async (memberUserId: string, _targetRole: CadRole, newStatus: 'active' | 'suspended' | 'deactivated') => {
    // TODO (Stage C): POST /functions/v1/admin-provision-user via OIDC-authed fetch.
    // Stub: optimistic local update only.
    setMembers((prev) =>
      prev.map((m) => (m.user_id === memberUserId ? { ...m, status: newStatus } : m))
    )
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmail) return

    if (!permittedProvisionRoles.includes(newRole) || (!isPlatformAuditor && !selectedTenantId)) {
      alert('Permission Denied')
      return
    }

    setSubmitting(true)
    try {
      // TODO (Stage C): POST /functions/v1/admin-provision-user via OIDC-authed fetch.
      // Stub: no-op until Edge Function is wired.
      alert('User provisioning is not yet available — awaiting Stage C OIDC adapter.')
    } catch {
      alert('Permission Denied')
    } finally {
      setSubmitting(false)
      setShowInviteModal(false)
      setNewEmail('')
      setNewLicence('')
      setPartnerOrg('')
      setMandateRef('')
      setTargetTenantId(claims.role === 'super_admin' ? tenantChoices[0]?.id || '' : claims.tenantId)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tenant access"
        title="Clinical staff and licence verification"
        description={<>Clinic: <strong>{activeTenant?.name || claims.tenantId}</strong>. Writing clinicians must be verified before prescribing patient targets.</>}
        actions={permittedProvisionRoles.length > 0 ? <button onClick={() => { setProvisionSuccess(null); setShowInviteModal(true) }} className="ui-button ui-button-primary"><UserPlus size={17} /> Provision member</button> : undefined}
      />

      {/* Provisioning Success Modal / Notification */}
      {provisionSuccess && (
        <div className="ui-card flex items-start justify-between border-[color:var(--color-success-border)] bg-[color:var(--color-success-subtle)] p-4">
          <div className="space-y-1">
            <div className="text-sm font-bold text-[color:var(--color-success-text)] flex items-center gap-1.5">
              <CheckCircle size={17} />
              <span>User Successfully Provisioned ({provisionSuccess.email})</span>
            </div>
            <p className="text-xs text-[color:var(--color-success-text)]">
              Assigned Role: <strong className="capitalize">{provisionSuccess.role.replace('_', ' ')}</strong>. Deliver the temporary credentials below to the member:
            </p>
            {provisionSuccess.password && (
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-xs bg-[color:var(--color-surface)] px-2 py-1 rounded border border-[color:var(--color-success-border)] font-bold text-[color:var(--color-text-strong)] select-all">
                  {provisionSuccess.password}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(provisionSuccess.password || '')
                    setCopiedPwd(true)
                    setTimeout(() => setCopiedPwd(false), 2000)
                  }}
                  className="ui-button ui-button-secondary"
                >
                  {copiedPwd ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedPwd ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setProvisionSuccess(null)}
            className="ui-icon-button ml-4"
            aria-label="Dismiss provisioning confirmation"
          >
            ✕
          </button>
        </div>
      )}

      {/* Staff Table */}
      <div className="ui-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ui-table min-w-full text-left">
            <thead>
              <tr>
                <th className="px-4 py-3">User / Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Licence Ref (KMPDC/KNDI)</th>
                <th className="px-4 py-3">Licence Expiry</th>
                <th className="px-4 py-3">Licence Status</th>
                <th className="px-4 py-3">Account Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[color:var(--color-text-muted)]">
                    Loading roster...
                  </td>
                </tr>
              ) : (
                members.map((member) => {
                  const canManage = claims.role === 'super_admin'
                    || (claims.role === 'tenant_admin' && member.role !== 'super_admin')

                  return (
                    <tr key={member.user_id}>
                      <td className="font-medium text-[color:var(--color-text-strong)]">
                        <div>{member.email || member.user_id}</div>
                        <div className="mt-1 text-xs text-[color:var(--color-text-muted)] font-mono">{member.user_id}</div>
                      </td>
                      <td>
                        <StatusBadge tone="neutral">{member.role.replace('_', ' ')}</StatusBadge>
                      </td>
                      <td className="font-mono">
                        {member.licence_number || '—'}
                      </td>
                      <td className="text-[color:var(--color-text-muted)]">
                        {member.licence_expiry || '—'}
                      </td>
                      <td>
                        {member.role === 'writing_clinician' || member.role === 'viewing_dietician' ? (
                          member.licence_verified ? (
                            <StatusBadge tone="success"><CheckCircle size={14} /> Verified</StatusBadge>
                          ) : (
                            <StatusBadge tone="warning"><AlertTriangle size={14} /> Pending validation</StatusBadge>
                          )
                        ) : (
                          <span className="text-xs text-[color:var(--color-text-muted)]">Not applicable</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge tone={member.status === 'active' ? 'success' : member.status === 'suspended' ? 'warning' : 'critical'}>{member.status}</StatusBadge>
                      </td>
                      <td className="text-right space-x-2">
                        {canManage &&
                          (member.role === 'writing_clinician' || member.role === 'viewing_dietician') && (
                            <button
                              onClick={() => toggleVerifyLicence(member.user_id, member.licence_verified)}
                              className="ui-button ui-button-secondary"
                            >
                              {member.licence_verified ? 'Unverify' : 'Verify Licence'}
                            </button>
                          )}

                        {canManage && (
                          <>
                            {member.status === 'active' ? (
                              <button
                                onClick={() => handleStatusChange(
                                  member.user_id,
                                  member.role,
                                  claims.role === 'tenant_admin' && member.role === 'commercial_stakeholder'
                                    ? 'suspended'
                                    : 'deactivated',
                                )}
                                className="ui-button ui-button-critical"
                              >
                                <UserX size={14} />
                                <span>{claims.role === 'tenant_admin' && member.role === 'commercial_stakeholder' ? 'Suspend' : 'Deactivate'}</span>
                              </button>
                            ) : !(claims.role === 'tenant_admin' && member.role === 'commercial_stakeholder') && (
                              <button
                                onClick={() => handleStatusChange(member.user_id, member.role, 'active')}
                                className="ui-button ui-button-secondary"
                              >
                                Reactivate
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="ui-modal-backdrop" role="presentation">
          <div className="ui-modal space-y-4" role="dialog" aria-modal="true" aria-labelledby="provision-dialog-title">
            <h2 id="provision-dialog-title" className="text-xl font-bold text-[color:var(--color-text-strong)]">Provision clinic staff member</h2>
            <p className="text-sm text-[color:var(--color-text-muted)]">
              Available roles are determined by the provisioning grant matrix.
            </p>
            <form onSubmit={handleInvite} className="space-y-4 text-sm">
              <div>
                <label className="ui-field-label">Email address</label>
                <input
                  type="email"
                  required
                  placeholder="doctor@clinic.co.ke"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="ui-input mt-1"
                />
              </div>

              <div>
                <label className="ui-field-label">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as CadRole)}
                  className="ui-select mt-1"
                >
                  {permittedProvisionRoles.includes('writing_clinician') && (
                    <option value="writing_clinician">Writing Clinician (Prescribe Targets)</option>
                  )}
                  {permittedProvisionRoles.includes('viewing_dietician') && (
                    <option value="viewing_dietician">Viewing Dietician (Read & Consult)</option>
                  )}
                  {permittedProvisionRoles.includes('compliance_auditor') && (
                    <option value="compliance_auditor">Compliance Auditor (Read-only)</option>
                  )}
                  {permittedProvisionRoles.includes('commercial_stakeholder') && (
                    <option value="commercial_stakeholder">Commercial Stakeholder</option>
                  )}
                  {permittedProvisionRoles.includes('tenant_admin') && (
                    <option value="tenant_admin">Tenant Administrator</option>
                  )}
                </select>
              </div>

              {claims.role === 'super_admin' && !isPlatformAuditor && (
                <div>
                  <label className="ui-field-label">Tenant</label>
                  <select
                    required
                    value={targetTenantId}
                    onChange={(event) => setTargetTenantId(event.target.value)}
                    className="ui-select mt-1"
                  >
                    <option value="" disabled>Select tenant</option>
                    {tenantChoices.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {(newRole === 'writing_clinician' || newRole === 'viewing_dietician') && (
                <div>
                  <label className="ui-field-label">Medical or dietetic licence number</label>
                  <input
                    type="text"
                    placeholder="Reg-No/YYYY/NNNNN"
                    value={newLicence}
                    onChange={(e) => setNewLicence(e.target.value)}
                    className="ui-input mt-1"
                  />
                </div>
              )}

              {newRole === 'commercial_stakeholder' && (
                <div>
                  <label className="ui-field-label">Commercial partner legal entity</label>
                  <input
                    type="text"
                    required
                    value={partnerOrg}
                    onChange={(event) => setPartnerOrg(event.target.value)}
                    className="ui-input mt-1"
                  />
                </div>
              )}

              {isPlatformAuditor && (
                <>
                  <div>
                    <label className="ui-field-label">Regulator body</label>
                    <select
                      value={regulatorBody}
                      onChange={(event) => setRegulatorBody(event.target.value as 'DHA' | 'ODPC')}
                      className="ui-select mt-1"
                    >
                      <option value="DHA">Digital Health Agency (DHA)</option>
                      <option value="ODPC">Office of the Data Protection Commissioner (ODPC)</option>
                    </select>
                  </div>
                  <div>
                    <label className="ui-field-label">Written mandate reference</label>
                    <input
                      type="text"
                      required
                      value={mandateRef}
                      onChange={(event) => setMandateRef(event.target.value)}
                      className="ui-input mt-1"
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="ui-button ui-button-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="ui-button ui-button-primary"
                >
                  {submitting ? 'Provisioning...' : 'Provision Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
