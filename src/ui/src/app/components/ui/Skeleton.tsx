import * as React from 'react'

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number
  height?: string | number
}

export function Skeleton({ className = '', style, width, height, ...props }: SkeletonProps) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={`bg-surface-raised animate-pulse rounded-lg ${className}`.trim()}
      style={{
        width,
        height,
        ...style,
      }}
      {...props}
    />
  )
}

