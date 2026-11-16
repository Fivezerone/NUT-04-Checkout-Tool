import * as React from 'react'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'neutral' | 'info' | 'warning' | 'critical' | 'success' | 'outline'
  size?: 'sm' | 'md'
  icon?: React.ReactNode
}

export function Badge({
  variant = 'neutral',
  size = 'md',
  icon,
  className = '',
  children,
  ...props
}: BadgeProps) {
  const sizeStyles = {
    sm: 'px-2 py-0.5 text-[12px] gap-1',
    md: 'px-2.5 py-1 text-[12px] gap-1.5',
  }[size]

  const variantStyles = {
    neutral: 'bg-surface-raised text-strong border border-border-control/30',
    info: 'bg-status-info-subtle text-status-info border border-status-info/20',
    warning: 'bg-status-warning-subtle text-status-warning border border-status-warning/20',
    critical: 'bg-status-critical-subtle text-status-critical border border-status-critical/20',
    success: 'bg-status-success-subtle text-status-success border border-status-success/20',
    outline: 'bg-transparent text-strong border border-border-control',
  }[variant]

  return (
    <span
      className={`inline-flex items-center font-medium rounded-md leading-tight shrink-0 ${sizeStyles} ${variantStyles} ${className}`.trim()}
      {...props}
    >
      {icon && <span className="w-3.5 h-3.5 shrink-0">{icon}</span>}
      {children}
    </span>
  )
}

