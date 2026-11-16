import * as React from 'react'

export type CardProps = React.HTMLAttributes<HTMLDivElement>

export function Card({ className = '', children, ...props }: CardProps) {
  return (
    <div
      className={`bg-surface rounded-2xl border border-border-control/20 shadow-xs overflow-hidden ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-4 sm:p-5 flex flex-col gap-1 border-b border-border-control/10 ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className = '', children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-[14px] sm:text-[16px] font-semibold text-strong leading-tight ${className}`.trim()} {...props}>
      {children}
    </h3>
  )
}

export function CardDescription({ className = '', children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`text-[12px] text-muted leading-relaxed ${className}`.trim()} {...props}>
      {children}
    </p>
  )
}

export function CardContent({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-4 sm:p-5 ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-4 sm:p-5 border-t border-border-control/10 flex items-center justify-between ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}

