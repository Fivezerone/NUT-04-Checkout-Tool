// src/ui/src/app/components/ui/KpiCard.tsx
// NUT-04 Dashboard Metric Cards (§4.1 / §4.10)

import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

export interface KpiCardProps {
  title?: string;
  label?: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  delta?: {
    value: number; // Percentage or points change
    label: string; // e.g. "vs last week"
    favorableDirection?: 'up' | 'down'; // e.g. for nutrition score, 'up' is favorable; for sodium, 'down' is favorable
  };
  variant?: 'hero' | 'standard';
  tone?: 'mint' | 'coral' | 'neutral' | string;
  direction?: 'favorable' | 'unfavorable' | string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  label,
  value,
  unit,
  subtitle,
  delta,
  variant = 'standard',
  tone = 'neutral',
  direction,
  icon,
  badge,
  className = '',
}) => {
  const isHero = variant === 'hero';
  const displayTitle = title || label || '';

  const renderDelta = () => {
    if (!delta) return null;
    const { value: deltaVal, label: deltaLabel, favorableDirection = 'up' } = delta;
    if (deltaVal === 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Minus className="w-3.5 h-3.5" />
          <span>Same {deltaLabel}</span>
        </span>
      );
    }

    const isPositive = deltaVal > 0;
    const isFavorable = isPositive
      ? favorableDirection === 'up'
      : favorableDirection === 'down';

    const colorClass = isFavorable
      ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
      : 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800';

    const ArrowIcon = isPositive ? ArrowUpRight : ArrowDownRight;

    return (
      <span
        className={`inline-flex items-center gap-0.5 px-2 py-0.5 text-xs font-semibold rounded-full border ${colorClass}`}
        aria-label={`${Math.abs(deltaVal)}% ${isPositive ? 'increase' : 'decrease'} ${deltaLabel}`}
      >
        <ArrowIcon className="w-3 h-3" />
        <span>{Math.abs(deltaVal)}% {deltaLabel}</span>
      </span>
    );
  };

  return (
    <article
      className={`rounded-2xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] shadow-xs transition-shadow hover:shadow-md ${
        isHero
          ? 'p-5 bg-gradient-to-br from-[color:var(--t-color-surface)] to-[color:var(--t-color-surface-subtle)]'
          : 'p-4'
      } ${className}`}
      aria-label={`${displayTitle}: ${value} ${unit || ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-[color:var(--t-color-text-muted)] tracking-wide">
          {displayTitle}
        </span>
        {icon && <div className="text-[color:var(--t-color-text-muted)] shrink-0">{icon}</div>}
        {badge && <div className="shrink-0">{badge}</div>}
      </div>

      <div className="mt-2.5 flex items-baseline gap-2">
        <span
          className={`font-black tracking-tight text-[color:var(--t-color-text-strong)] tabular-nums ${
            isHero ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
          }`}
        >
          {value}
        </span>
        {unit && (
          <span className="text-xs font-medium text-[color:var(--t-color-text-muted)]">
            {unit}
          </span>
        )}
      </div>

      {(subtitle || delta) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {renderDelta()}
          {subtitle && (
            <p className="text-xs text-[color:var(--t-color-text-muted)] font-medium leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      )}
    </article>
  );
};

export default KpiCard;
