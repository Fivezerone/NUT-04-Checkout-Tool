// src/ui/src/cad/views/UserManagementView.tsx
// Clinic Staff & Licence Management (RBAC Provisioning)
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§7.1, §7.2, §7.3)

import React, { useState, useEffect, useRef } from 'react'
import { useCadAuth } from '../context/AuthContext'
import type { CadRole, TenantMember } from '../types'
import { UserPlus, UserX, CheckCircle, AlertTriangle, Copy, Check, X } from 'lucide-react'
import { PageHeader, StatusBadge } from '../components/Primitives'
import { DataTable } from '../../app/components/ui/DataTable'
import { Badge } from '../../app/components/ui/Badge'
import { Button } from '../../app/components/ui/Button'
import { Input } from '../../app/components/ui/Input'
import { Select } from '../../app/components/ui/Select'
import { cadApi } from '../api/cad-api'

const PROVISIONABLE_ROLES: Record<CadRole, CadRole[]> = {
  super_admin: [
    'tenant_admin',
    'writing_clinician',
    'viewing_dietician',
    'compliance_auditor',
    'commercial_stakeholder',
  ],
  tenant_admin: ['writing_clinician', 'viewing_dietician', 'commercial_stakeholder'],
  writing_clinician: [],
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
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [newEmail, setNewEmail] = useState<string>('')
  const [newRole, setNewRole] = useState<CadRole>('writing_clinician')
  const [newLicence, setNewLicence] = useState<string>('')
  const [partnerOrg, setPartnerOrg] = useState<string>('')
  const [regulatorBody, setRegulatorBody] = useState<'DHA' | 'ODPC'>('DHA')
  const [mandateRef, setMandateRef] = useState<string>('')
  const [targetTenantId, setTargetTenantId] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [provisionSuccess, setProvisionSuccess] = useState<{
    email: string
    role: string
    password?: string
  } | null>(null)
  const [copiedPwd, setCopiedPwd] = useState<boolean>(false)

  const permittedProvisionRoles = claims.role ? PROVISIONABLE_ROLES[claims.role] || [] : []
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

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (showInviteModal) {
      if (!dialog.open) {
        dialog.showModal()
      }
    } else {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [showInviteModal])

  const loadMembers = async () => {
    setLoading(true)
    try {
      const data = await cadApi.getMembers(selectedTenantId || claims.tenantId)
      setMembers(data)
    } catch {
      setMembers([])
    } finally {
      setLoading(false)
    }
  }

  const toggleVerifyLicence = async (memberUserId: string, currentStatus: boolean) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.user_id === memberUserId ? { ...m, licence_verified: !currentStatus } : m,
      ),
    )
  }

  const handleStatusChange = async (
    memberUserId: string,
    _targetRole: CadRole,
    newStatus: 'active' | 'suspended' | 'deactivated',
  ) => {
    setMembers((prev) =>
      prev.map((m) => (m.user_id === memberUserId ? { ...m, status: newStatus } : m)),
    )
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmail) return

    if (!permittedProvisionRoles.includes(newRole) || (!isPlatformAuditor && !selectedTenantId)) {
      setErrorMsg('Permission Denied: You do not have authority to provision this role or tenant.')
      return
    }

    setSubmitting(true)
    setErrorMsg(null)
    try {
      const res = await cadApi.inviteStaff({
        email: newEmail,
        role: newRole,
        tenantId: selectedTenantId || claims.tenantId,
        licenceNumber: newLicence || undefined,
      })
      if (res.success) {
        const newMember: TenantMember = {
          tenant_id: selectedTenantId || claims.tenantId,
          user_id: res.inviteId || `inv-${Date.now().toString(36)}`,
          email: newEmail,
          role: newRole,
          licence_number: newLicence || undefined,
          licence_verified: false,
          status: 'invited',
          created_at: new Date().toISOString(),
        }
        setMembers((prev) => [newMember, ...prev])
        setProvisionSuccess({
          email: newEmail,
          role: newRole,
        })
      } else {
        setErrorMsg(res.error || 'Keycloak staff provisioning endpoint unavailable.')
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Permission Denied or network error while provisioning member.')
    } finally {
      setSubmitting(false)
      setShowInviteModal(false)
      setNewEmail('')
      setNewLicence('')
      setPartnerOrg('')
      setMandateRef('')
      setTargetTenantId(
        claims.role === 'super_admin' ? tenantChoices[0]?.id || '' : claims.tenantId,
      )
    }
  }

  const canManage = (memberRole: CadRole) =>
    claims.role === 'super_admin' || (claims.role === 'tenant_admin' && memberRole !== 'super_admin')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tenant access"
        title="Clinical staff and licence verification"
        description={
          <>
            Clinic: <strong>{activeTenant?.name || claims.tenantId}</strong>. Writing clinicians
            must be verified before prescribing patient targets.
          </>
        }
        actions={
          permittedProvisionRoles.length > 0 ? (
            <Button
              variant="primary"
              onClick={() => {
                setProvisionSuccess(null)
                setShowInviteModal(true)
              }}
            >
              <UserPlus size={17} /> Provision member
            </Button>
          ) : undefined
        }
      />

      {/* Provisioning Success Notification */}
      {provisionSuccess && (
        <div className="rounded-2xl border border-status-success/30 bg-status-success-subtle p-4 flex items-start justify-between shadow-xs">
          <div className="space-y-1">
            <div className="text-[14px] font-bold text-status-success flex items-center gap-1.5">
              <CheckCircle size={17} />
              <span>User Successfully Provisioned ({provisionSuccess.email})</span>
            </div>
            <p className="text-[12px] text-foreground">
              Assigned Role: <strong className="capitalize">{provisionSuccess.role.replace('_', ' ')}</strong>. Deliver the temporary credentials below to the member:
            </p>
            {provisionSuccess.password && (
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-[12px] bg-surface px-3 py-1.5 rounded-xl border border-border-control font-bold text-strong select-all">
                  {provisionSuccess.password}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(provisionSuccess.password || '')
                    setCopiedPwd(true)
                    setTimeout(() => setCopiedPwd(false), 2000)
                  }}
                >
                  {copiedPwd ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedPwd ? 'Copied' : 'Copy'}</span>
                </Button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setProvisionSuccess(null)}
            className="p-1 rounded-lg text-muted hover:text-strong cursor-pointer"
            aria-label="Dismiss provisioning confirmation"
          >
            ✕
          </button>
        </div>
      )}

      {/* Staff DataTable: No truncation contract */}
      <DataTable<TenantMember>
        columns={[
          {
            id: 'email',
            header: 'Staff Member',
            accessor: (m) => m.email || m.user_id,
            cell: (v, m) => (
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-strong break-words">{v}</span>
                <span className="font-mono text-[12px] text-muted">{m.user_id}</span>
              </div>
            ),
            sortable: true,
            priority: 1,
            kind: 'email',
          },
          {
            id: 'role',
            header: 'Role',
            accessor: (m) => m.role.replace('_', ' '),
            cell: (v) => <Badge variant="neutral">{v}</Badge>,
            sortable: true,
            priority: 1,
            kind: 'enum',
          },
          {
            id: 'licence',
            header: 'Licence Reference',
            accessor: (m) => m.licence_number || '—',
            cell: (v) => <span className="font-mono text-strong">{v}</span>,
            priority: 2,
            kind: 'text',
          },
          {
            id: 'licence_status',
            header: 'Licence Status',
            accessor: (m) => m.licence_verified,
            cell: (verified, m) =>
              m.role === 'writing_clinician' || m.role === 'viewing_dietician' ? (
                verified ? (
                  <Badge variant="success">Verified</Badge>
                ) : (
                  <Badge variant="warning">Pending validation</Badge>
                )
              ) : (
                <span className="text-[12px] text-muted">Not applicable</span>
              ),
            priority: 2,
            kind: 'status',
          },
          {
            id: 'account_status',
            header: 'Account Status',
            accessor: (m) => m.status,
            cell: (status) => (
              <Badge
                variant={status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'critical'}
              >
                {status}
              </Badge>
            ),
            sortable: true,
            priority: 1,
            kind: 'status',
          },
          {
            id: 'actions',
            header: 'Actions',
            accessor: (m) => m.user_id,
            cell: (_id, m) => {
              if (!canManage(m.role)) return null
              const isClinician = m.role === 'writing_clinician' || m.role === 'viewing_dietician'

              return (
                <div className="flex items-center gap-2 justify-end">
                  {isClinician && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => toggleVerifyLicence(m.user_id, m.licence_verified)}
                    >
                      {m.licence_verified ? 'Unverify' : 'Verify Licence'}
                    </Button>
                  )}

                  {m.status === 'active' ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        handleStatusChange(
                          m.user_id,
                          m.role,
                          claims.role === 'tenant_admin' && m.role === 'commercial_stakeholder'
                            ? 'suspended'
                            : 'deactivated',
                        )
                      }
                    >
                      <UserX size={14} />
                      <span>
                        {claims.role === 'tenant_admin' && m.role === 'commercial_stakeholder'
                          ? 'Suspend'
                          : 'Deactivate'}
                      </span>
                    </Button>
                  ) : (
                    !(claims.role === 'tenant_admin' && m.role === 'commercial_stakeholder') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleStatusChange(m.user_id, m.role, 'active')}
                      >
                        Reactivate
                      </Button>
                    )
                  )}
                </div>
              )
            },
            priority: 1,
            kind: 'actions',
          },
        ]}
        data={members}
        keyExtractor={(m) => m.user_id}
        searchable
        searchPlaceholder="Filter clinical staff by email, ID, or licence..."
        emptyTitle="No staff members registered"
        emptyDescription="Authorized tenant administrators can provision clinical staff, verify medical licences, and manage role assignments."
        caption="Clinic staff registry and licence verification list"
      />

      {/* Native <dialog> Modal with showModal() */}
      <dialog
        ref={dialogRef}
        onClose={() => setShowInviteModal(false)}
        className="backdrop:bg-black/50 backdrop:backdrop-blur-xs rounded-2xl bg-surface border border-border-control p-6 max-w-lg w-full text-foreground shadow-xl m-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border-control/20">
          <h2 className="text-[16px] font-bold text-strong">Provision clinic staff member</h2>
          <button
            type="button"
            onClick={() => setShowInviteModal(false)}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-muted hover:text-strong hover:bg-surface-raised cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-2 text-[12px] text-muted">
          Available roles are determined by the provisioning grant matrix.
        </p>

        {errorMsg && (
          <div className="mt-3 p-3 rounded-xl bg-status-critical-subtle border border-status-critical/30 text-status-critical text-[12px] font-medium">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleInvite} className="mt-4 flex flex-col gap-4 text-xs">
          <Input
            label="Email address"
            type="email"
            required
            placeholder="doctor@clinic.co.ke"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />

          <Select
            label="Role"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as CadRole)}
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
          </Select>

          {claims.role === 'super_admin' && !isPlatformAuditor && (
            <Select
              label="Tenant"
              required
              value={targetTenantId}
              onChange={(e) => setTargetTenantId(e.target.value)}
            >
              <option value="" disabled>
                Select tenant
              </option>
              {tenantChoices.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </Select>
          )}

          {(newRole === 'writing_clinician' || newRole === 'viewing_dietician') && (
            <Input
              label="Medical or dietetic licence number"
              type="text"
              placeholder="Reg-No/YYYY/NNNNN"
              value={newLicence}
              onChange={(e) => setNewLicence(e.target.value)}
            />
          )}

          {newRole === 'commercial_stakeholder' && (
            <Input
              label="Commercial partner legal entity"
              type="text"
              required
              value={partnerOrg}
              onChange={(e) => setPartnerOrg(e.target.value)}
            />
          )}

          {isPlatformAuditor && (
            <>
              <Select
                label="Regulator body"
                value={regulatorBody}
                onChange={(e) => setRegulatorBody(e.target.value as 'DHA' | 'ODPC')}
              >
                <option value="DHA">Digital Health Agency (DHA)</option>
                <option value="ODPC">Office of the Data Protection Commissioner (ODPC)</option>
              </Select>
              <Input
                label="Written mandate reference"
                type="text"
                required
                value={mandateRef}
                onChange={(e) => setMandateRef(e.target.value)}
              />
            </>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border-control/20">
            <Button type="button" variant="secondary" onClick={() => setShowInviteModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Provisioning...' : 'Provision Member'}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
export default UserManagementView
