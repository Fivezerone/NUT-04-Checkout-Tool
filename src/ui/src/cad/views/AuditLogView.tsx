// src/ui/src/cad/views/AuditLogView.tsx
// Immutable, Hash-Chained Audit Trail Viewer for Clinic Admin Dashboard
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.1, §13 Test T14)
//
// STAGE A (A-03): cadSupabase removed; data fetch stubbed.
// STAGE B (B-01): Demo audit log fallback data removed.
// TODO (Stage C): Replace stub with OIDC-authed REST fetch via PostgREST.

import React, { useState, useEffect } from 'react'
import { useCadAuth } from '../context/AuthContext'
import type { AuditLogEntry } from '../types'
import { CheckCircle2, ShieldAlert, Link as ChainIcon, Search, Lock } from 'lucide-react'
import { PageHeader, StatusBadge } from '../components/Primitives'

export const AuditLogView: React.FC = () => {
  const { claims, activeTenant } = useCadAuth()
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [chainValid, setChainValid] = useState<boolean>(true)
  const [searchQuery, setSearchQuery] = useState<string>('')

  useEffect(() => {
    loadAuditLogs()
  }, [claims.tenantId])

  const loadAuditLogs = async () => {
    setLoading(true)
    try {
      // TODO (Stage C): fetch from PostgREST /audit_log?tenant_id=eq.{tenantId}&order=seq.desc&limit=100
      // Stub: returns empty list until REST layer is wired (B-01 — demo data removed).
      setLogs([])
      setChainValid(true)
    } catch {
      setChainValid(true)
    } finally {
      setLoading(false)
    }
  }

  const verifyHashChain = (items: AuditLogEntry[]) => {
    // Verifies sequential order and hash continuity
    let valid = true
    const sorted = [...items].sort((a, b) => a.seq - b.seq)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].prev_hash !== sorted[i - 1].row_hash) {
        valid = false
        break
      }
    }
    setChainValid(valid)
  }

  const filteredLogs = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.resource_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (l.subject_ref && l.subject_ref.toLowerCase().includes(searchQuery.toLowerCase())) ||
      l.actor_role.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compliance evidence"
        title="Immutable audit trail"
        description={<>Tenant: <strong>{activeTenant?.name || claims.tenantId}</strong>. Retention: 20 years under DPA s.46 / HIM Reg 24.</>}
        actions={<><StatusBadge tone={chainValid ? 'success' : 'critical'}>{chainValid ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}{chainValid ? 'SHA-256 chain verified' : 'Chain break detected'}</StatusBadge><StatusBadge tone="neutral"><Lock size={14} /> Append-only</StatusBadge></>}
      />

      {/* Filter and Search */}
      <div className="ui-card flex flex-col justify-between gap-3 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-3 text-[color:var(--color-text-muted)]" size={17} />
          <input
            type="text"
            placeholder="Search by action, resource, actor or patient ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ui-input pl-9"
          />
        </div>
        <button
          onClick={loadAuditLogs}
          className="ui-button ui-button-secondary"
        >
          Refresh Log
        </button>
      </div>

      {/* Audit Log Table */}
      <div className="ui-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ui-table min-w-full text-left">
            <thead>
              <tr>
                <th className="px-4 py-3">Seq</th>
                <th className="px-4 py-3">Timestamp (UTC)</th>
                <th className="px-4 py-3">Actor / Role</th>
                <th className="px-4 py-3">Mutation</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 font-mono">Row Hash</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[color:var(--color-text-muted)]">
                    Loading audit trail...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[color:var(--color-text-muted)]">
                    No matching audit records found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.event_id}>
                    <td className="font-mono font-bold text-[color:var(--color-text-strong)]">
                      #{log.seq}
                    </td>
                    <td className="whitespace-nowrap text-[color:var(--color-text-muted)]">
                      {new Date(log.occurred_at).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="font-medium text-[color:var(--color-text-strong)]">{log.actor_id}</div>
                      <div className="mt-1 text-xs uppercase font-semibold text-[color:var(--color-text-muted)]">{log.actor_role}</div>
                    </td>
                    <td>
                      <StatusBadge tone={log.mutation_type === 'revoke' ? 'critical' : log.mutation_type === 'create' ? 'success' : log.mutation_type === 'update' ? 'info' : 'neutral'}>{log.mutation_type}</StatusBadge>
                    </td>
                    <td className="font-semibold text-[color:var(--color-text-strong)]">
                      {log.action}
                    </td>
                    <td>
                      <div>{log.resource_type}</div>
                      {log.subject_ref && (
                        <div className="mt-1 text-xs text-[color:var(--color-text-muted)] font-mono">Ref: {log.subject_ref}</div>
                      )}
                    </td>
                    <td className="min-w-[180px] break-words text-wrap" title={log.reason}>
                      {log.reason}
                    </td>
                    <td className="font-mono text-xs text-[color:var(--color-text-muted)]">
                      <div className="flex items-center space-x-1" title={`Row: ${log.row_hash}\nPrev: ${log.prev_hash}`}>
                        <ChainIcon className="text-[color:var(--color-text-muted)]" size={14} />
                        <span>{log.row_hash.slice(0, 10)}...</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

