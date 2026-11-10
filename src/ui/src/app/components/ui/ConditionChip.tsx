// src/ui/src/app/components/ui/ConditionChip.tsx
// NUT-04 Condition Indicator (§0 / §4.3)
// Expresses active patient/shopper condition with an icon and chip without recoloring the whole interface.

import React from 'react';
import { HeartPulse, Droplet, Activity, Flame, ShieldCheck } from 'lucide-react';
import { ThemeType } from '../../context/ThemeContext';

interface ConditionChipProps {
  condition: ThemeType | string;
  size?: 'sm' | 'md';
  className?: string;
}

const CONDITION_CONFIG: Record<
  string,
  { label: string; icon: React.FC<{ className?: string }>; colorClass: string }
> = {
  general: {
    label: 'General Wellness',
    icon: ShieldCheck,
    colorClass: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  },
  diabetes: {
    label: 'Type 2 Diabetes',
    icon: Droplet,
    colorClass: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
  },
  hypertension: {
    label: 'Hypertension',
    icon: HeartPulse,
    colorClass: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  },
  kidney: {
    label: 'Chronic Kidney Disease',
    icon: Activity,
    colorClass: 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
  },
  obesity: {
    label: 'Weight Management',
    icon: Flame,
    colorClass: 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
  },
};

export const ConditionChip: React.FC<ConditionChipProps> = ({
  condition,
  size = 'md',
  className = '',
}) => {
  const normKey = (condition || 'general').toLowerCase();
  const config = CONDITION_CONFIG[normKey] || CONDITION_CONFIG.general;
  const Icon = config.icon;

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs gap-1' : 'px-2.5 py-1 text-sm gap-1.5';
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border shadow-xs ${config.colorClass} ${sizeClasses} ${className}`}
      aria-label={`Active health focus: ${config.label}`}
    >
      <Icon className={iconSize} />
      <span>{config.label}</span>
    </span>
  );
};

