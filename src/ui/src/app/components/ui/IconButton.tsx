import * as React from 'react'

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className = '', variant = 'ghost', size = 'md', children, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center rounded-xl transition-colors select-none outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 disabled:pointer-events-none cursor-pointer'

    const sizeStyles = {
      sm: 'w-8 h-8 min-w-[32px] min-h-[32px]',
      md: 'w-10 h-10 min-w-[40px] min-h-[40px]',
      lg: 'w-11 h-11 min-w-[44px] min-h-[44px]',
    }[size]

    const variantStyles = {
      primary: 'bg-brand-mint hover:bg-brand-mint/90 text-brand-navy font-semibold shadow-xs',
      secondary: 'bg-surface hover:bg-surface-raised border border-border-control text-strong',
      destructive: 'bg-status-critical/10 text-status-critical hover:bg-status-critical hover:text-white',
      ghost: 'bg-transparent hover:bg-surface-raised text-strong',
    }[variant]

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    )
  },
)

IconButton.displayName = 'IconButton'

