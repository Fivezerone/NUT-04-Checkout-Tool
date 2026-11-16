import * as React from 'react'
import { ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options?: SelectOption[]
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', label, error, options, children, id, disabled, ...props }, ref) => {
    const generatedId = React.useId()
    const selectId = id || generatedId

    return (
      <div className="flex flex-col gap-1 w-full text-left">
        {label && (
          <label htmlFor={selectId} className="text-[12px] font-medium text-strong">
            {label}
          </label>
        )}
        <div className="relative w-full">
          <select
            ref={ref}
            id={selectId}
            disabled={disabled}
            className={`w-full h-10 pl-3 pr-8 py-2 bg-surface text-foreground text-[12px] rounded-xl border ${
              error ? 'border-status-critical focus-visible:ring-status-critical' : 'border-border-control focus-visible:ring-focus'
            } outline-none focus-visible:ring-2 appearance-none disabled:opacity-50 disabled:bg-surface-raised cursor-pointer transition-colors ${className}`.trim()}
            {...props}
          >
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        </div>
        {error && <p className="text-[12px] text-status-critical font-medium">{error}</p>}
      </div>
    )
  },
)

Select.displayName = 'Select'

