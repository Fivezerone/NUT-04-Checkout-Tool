import * as React from 'react'
import { Info, AlertCircle, AlertTriangle, ShieldAlert, X } from 'lucide-react'

export type AlertTier = 0 | 1 | 2 | 3

export interface BannerProps {
  tier?: AlertTier
  title?: string
  message: React.ReactNode
  action?: {
    label: string
    onClick: () => void
  }
  onDismiss?: () => void
  className?: string
}

export function Banner({
  tier = 0,
  title,
  message,
  action,
  onDismiss,
  className = '',
}: BannerProps) {
  const config = {
    0: {
      // Tier 0: Ambient / Info
      icon: Info,
      wrapperClass: 'bg-status-info-subtle border-status-info/20 text-foreground',
      iconClass: 'text-status-info',
      role: 'status',
    },
    1: {
      // Tier 1: Advisory
      icon: AlertCircle,
      wrapperClass: 'bg-surface-raised border-border-control text-foreground',
      iconClass: 'text-strong',
      role: 'status',
    },
    2: {
      // Tier 2: Operational Warning / Queue
      icon: AlertTriangle,
      wrapperClass: 'bg-status-warning-subtle border-status-warning/30 text-foreground',
      iconClass: 'text-status-warning',
      role: 'status',
    },
    3: {
      // Tier 3: Critical Blocking Alert
      icon: ShieldAlert,
      wrapperClass: 'bg-status-critical-subtle border-status-critical/40 text-foreground',
      iconClass: 'text-status-critical',
      role: 'alert',
    },
  }[tier]

  const Icon = config.icon

  return (
    <div
      role={config.role}
      className={`rounded-xl border p-3 flex items-start gap-3 text-left transition-colors ${config.wrapperClass} ${className}`}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${config.iconClass}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {title && <span className="text-[12px] font-semibold text-strong">{title}</span>}
        <div className="text-[12px] text-foreground leading-relaxed">{message}</div>
        {action && (
          <div className="mt-2">
            <button
              type="button"
              onClick={action.onClick}
              className="text-[12px] font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer text-strong"
            >
              {action.label}
            </button>
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss alert"
          className="text-muted hover:text-foreground p-1 rounded-lg hover:bg-surface transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

