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
  { label: string; icon: React.FC<{ className?: string }> }
> = {
  general: {
    label: 'General Wellness',
    icon: ShieldCheck,
  },
  diabetes: {
    label: 'Type 2 Diabetes',
    icon: Droplet,
  },
  hypertension: {
    label: 'Hypertension',
    icon: HeartPulse,
  },
  kidney: {
    label: 'Chronic Kidney Disease',
    icon: Activity,
  },
  obesity: {
    label: 'Weight Management',
    icon: Flame,
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

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs gap-1' : 'px-2.5 py-1 text-xs gap-1.5';
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border border-border-control/30 bg-surface-raised text-strong shadow-xs ${sizeClasses} ${className}`}
      aria-label={`Active health focus: ${config.label}`}
    >
      <Icon className={iconSize} />
      <span>{config.label}</span>
    </span>
  );
};

