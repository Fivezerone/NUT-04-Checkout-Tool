import * as React from 'react'
import { Check } from 'lucide-react'

export interface CheckboxProps {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  disabled?: boolean
  className?: string
  description?: string
}

export function Checkbox({
  id,
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
  description,
}: CheckboxProps) {
  const generatedId = React.useId()
  const checkboxId = id || generatedId

  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <button
        type="button"
        role="checkbox"
        id={checkboxId}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus shrink-0 cursor-pointer ${
          checked
            ? 'bg-brand-mint border-brand-mint text-brand-navy font-bold'
            : 'bg-surface border-border-control hover:border-text-strong'
        } ${disabled ? 'opacity-50 cursor-not-allowed bg-surface-raised' : ''}`}
      >
        {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
      </button>
      {label && (
        <div className="flex flex-col select-none">
          <label
            htmlFor={checkboxId}
            className={`text-[12px] font-medium leading-tight cursor-pointer ${
              disabled ? 'text-muted cursor-not-allowed' : 'text-strong'
            }`}
          >
            {label}
          </label>
          {description && <span className="text-[12px] text-muted mt-0.5">{description}</span>}
        </div>
      )}
    </div>
  )
}

