// src/ui/src/app/components/ui/TargetMeter.tsx
// NUT-04 Nutrient Adherence Meter (§4.3 / §4.10)

import React from 'react';

interface TargetMeterProps {
  label: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  warningThresholdPercent?: number; // e.g. 85%
  className?: string;
}

export const TargetMeter: React.FC<TargetMeterProps> = ({
  label,
  currentValue,
  targetValue,
  unit,
  warningThresholdPercent = 85,
  className = '',
}) => {
  const percentage = targetValue > 0 ? Math.round((currentValue / targetValue) * 100) : 0;
  const isExceeded = percentage > 100;
  const isWarning = percentage >= warningThresholdPercent && !isExceeded;

  let barColor = 'bg-teal-600';
  let badgeColor = 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300';
  let statusText = 'On Target';

  if (isExceeded) {
    barColor = 'bg-red-500';
    badgeColor = 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300';
    statusText = 'Exceeded';
  } else if (isWarning) {
    barColor = 'bg-amber-500';
    badgeColor = 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300';
    statusText = 'Near Limit';
  }

  return (
    <div className={`space-y-1.5 ${className}`} role="group" aria-label={`${label} target adherence`}>
      <div className="flex justify-between items-center text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            <strong className="text-foreground">{currentValue}</strong> / {targetValue} {unit}
          </span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badgeColor}`}>
            {statusText} ({percentage}%)
          </span>
        </div>
      </div>

      <div
        className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden border border-border-subtle"
        role="progressbar"
        aria-valuenow={currentValue}
        aria-valuemin={0}
        aria-valuemax={targetValue}
        aria-label={`${label}: ${percentage}% of recommended target`}
      >
        <div
          className={`h-2.5 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
};
