import * as React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', isLoading = false, disabled, children, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium rounded-xl transition-colors select-none outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer'

    const sizeStyles = {
      sm: 'h-8 px-3 text-[12px] gap-1.5 min-h-[32px]',
      md: 'h-10 px-4 text-[12px] gap-2 min-h-[40px]',
      lg: 'h-11 px-5 text-[14px] gap-2.5 min-h-[44px]',
    }[size]

    const variantStyles = {
      primary: 'bg-brand-mint hover:bg-brand-mint/90 text-brand-navy font-semibold shadow-xs active:translate-y-px',
      secondary: 'bg-surface hover:bg-surface-raised border border-border-control text-strong active:translate-y-px',
      destructive: 'bg-status-critical hover:bg-status-critical/90 text-white font-medium shadow-xs active:translate-y-px',
      ghost: 'bg-transparent hover:bg-surface-raised text-strong active:bg-surface-raised/80',
      outline: 'bg-transparent hover:bg-surface border border-border-control text-strong',
    }[variant]

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`.trim()}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'

