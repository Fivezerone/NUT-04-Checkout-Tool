import * as React from 'react'
import { Banner } from './Banner'

export interface PermissionGateProps {
  currentRole?: string
  allowedRoles: string[]
  fallback?: React.ReactNode
  children: React.ReactNode
}

export function PermissionGate({
  currentRole = '',
  allowedRoles,
  fallback,
  children,
}: PermissionGateProps) {
  const hasPermission = allowedRoles.includes(currentRole)

  if (hasPermission) {
    return <>{children}</>
  }

  if (fallback !== undefined) {
    return <>{fallback}</>
  }

  return (
    <Banner
      tier={2}
      title="Access Restricted"
      message={`Your current role (${currentRole || 'unassigned'}) does not have permission to view or perform this operation.`}
      className="my-3"
    />
  )
}
