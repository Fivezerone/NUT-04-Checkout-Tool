import * as React from 'react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, helperText, id, disabled, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = id || generatedId
    const errorId = `${inputId}-error`
    const helperId = `${inputId}-helper`

    return (
      <div className="flex flex-col gap-1 w-full text-left">
        {label && (
          <label htmlFor={inputId} className="text-[12px] font-medium text-strong">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={`h-10 px-3 py-2 bg-surface text-foreground placeholder:text-muted text-[12px] rounded-xl border ${
            error ? 'border-status-critical focus-visible:ring-status-critical' : 'border-border-control focus-visible:ring-focus'
          } outline-none focus-visible:ring-2 disabled:opacity-50 disabled:bg-surface-raised transition-colors ${className}`.trim()}
          {...props}
        />
        {error && (
          <p id={errorId} className="text-[12px] text-status-critical font-medium">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={helperId} className="text-[12px] text-muted">
            {helperText}
          </p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'

