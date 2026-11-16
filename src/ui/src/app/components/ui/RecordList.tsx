import * as React from 'react'

export interface RecordField {
  label: string
  value: React.ReactNode
}

export interface RecordItem {
  id: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  badge?: React.ReactNode
  fields?: RecordField[]
  actions?: React.ReactNode
}

export interface RecordListProps {
  items: RecordItem[]
  emptyMessage?: string
  className?: string
}

export function RecordList({
  items,
  emptyMessage = 'No records found',
  className = '',
}: RecordListProps) {
  if (items.length === 0) {
    return <div className="p-6 text-center text-muted text-[12px]">{emptyMessage}</div>
  }

  return (
    <div className={`flex flex-col gap-3 w-full ${className}`}>
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-surface rounded-2xl border border-border-control/20 p-4 flex flex-col gap-3 shadow-xs"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[14px] font-semibold text-strong leading-tight">
                {item.title}
              </span>
              {item.subtitle && (
                <span className="text-[12px] text-muted">{item.subtitle}</span>
              )}
            </div>
            {item.badge && <div className="shrink-0">{item.badge}</div>}
          </div>

          {item.fields && item.fields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border-control/10 text-[12px]">
              {item.fields.map((f, idx) => (
                <div key={idx} className="flex flex-col gap-0.5">
                  <span className="text-muted font-medium uppercase text-[12px] tracking-wider">
                    {f.label}
                  </span>
                  <div className="text-foreground break-words">{f.value}</div>
                </div>
              ))}
            </div>
          )}

          {item.actions && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-control/10">
              {item.actions}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

