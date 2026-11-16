import * as React from 'react'

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`bg-surface rounded-2xl border border-dashed border-border-control/40 p-8 text-center flex flex-col items-center justify-center gap-3 ${className}`}
    >
      {icon && <div className="text-muted/60 p-3 bg-surface-raised rounded-2xl">{icon}</div>}
      <div className="flex flex-col gap-1 max-w-sm">
        <h3 className="text-[14px] font-semibold text-strong">{title}</h3>
        {description && <p className="text-[12px] text-muted leading-relaxed">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 inline-flex items-center justify-center h-9 px-4 text-[12px] font-semibold bg-surface hover:bg-surface-raised border border-border-control text-strong rounded-xl cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

