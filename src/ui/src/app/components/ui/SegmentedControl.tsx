import * as React from 'react'

export interface SegmentOption<T extends string = string> {
  value: T
  label: string
  icon?: React.ReactNode
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
  'aria-label': ariaLabel = 'Options',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex items-center p-1 bg-surface-raised rounded-xl border border-border-control/20 ${className}`}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium transition-all select-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              size === 'sm' ? 'px-2.5 py-1 min-h-[28px]' : 'px-3.5 py-1.5 min-h-[34px]'
            } ${
              isSelected
                ? 'bg-surface text-strong shadow-xs font-semibold'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {opt.icon && <span className="w-3.5 h-3.5 shrink-0">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

