// src/ui/src/app/components/ui/KpiCard.tsx
// NUT-04 Dashboard Metric Cards (§4.1 / §4.10)

import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  delta?: {
    value: number; // Percentage or points change
    label: string; // e.g. "vs last week"
    favorableDirection?: 'up' | 'down'; // e.g. for nutrition score, 'up' is favorable; for sodium, 'down' is favorable
  };
  variant?: 'hero' | 'standard';
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  subtitle,
  delta,
  variant = 'standard',
  icon,
  badge,
  className = '',
}) => {
  const isHero = variant === 'hero';

  const renderDelta = () => {
    if (!delta) return null;
    const { value: deltaVal, label, favorableDirection = 'up' } = delta;
    if (deltaVal === 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Minus className="w-3.5 h-3.5" />
          <span>Same {label}</span>
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
        aria-label={`${Math.abs(deltaVal)}% ${isPositive ? 'increase' : 'decrease'} ${label}`}
      >
        <ArrowIcon className="w-3.5 h-3.5" />
        <span>
          {isPositive ? '+' : ''}
          {deltaVal}%
        </span>
        <span className="text-muted-foreground font-normal ml-0.5">{label}</span>
      </span>
    );
  };

  return (
    <div
      className={`rounded-2xl bg-surface border border-border-subtle p-5 shadow-sm transition-shadow hover:shadow-md ${
        isHero
          ? 'bg-gradient-to-br from-teal-50/50 to-white dark:from-slate-900 dark:to-slate-950 border-teal-200 dark:border-teal-900/60'
          : ''
      } ${className}`}
      role="region"
      aria-label={`${title}: ${value}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {icon && (
          <div className="p-2 rounded-lg bg-teal-50 dark:bg-slate-800 text-teal-700 dark:text-teal-400">
            {icon}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-3 mb-2">
        <span
          className={`font-extrabold tracking-tight text-foreground ${
            isHero ? 'text-4xl text-teal-900 dark:text-teal-200' : 'text-2xl text-foreground'
          }`}
        >
          {value}
        </span>
        {badge}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
        {subtitle && <span>{subtitle}</span>}
        {renderDelta()}
      </div>
    </div>
  );
};
