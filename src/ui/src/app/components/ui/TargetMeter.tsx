// src/ui/src/app/components/ui/TargetMeter.tsx
// NUT-04 Nutrient Adherence Meter (§4.3 / §4.10)

import React from 'react';

export interface TargetMeterProps {
  label: string;
  currentValue?: number;
  current?: number;
  targetValue?: number;
  max?: number;
  unit?: string;
  helperText?: string;
  warningThresholdPercent?: number; // e.g. 85%
  className?: string;
}

export const TargetMeter: React.FC<TargetMeterProps> = ({
  label,
  currentValue,
  current,
  targetValue,
  max,
  unit = '%',
  helperText,
  warningThresholdPercent = 85,
  className = '',
}) => {
  const currentVal = current ?? currentValue ?? 0;
  const targetVal = max ?? targetValue ?? 100;
  const percentage = targetVal > 0 ? Math.round((currentVal / targetVal) * 100) : 0;
  const isExceeded = percentage > 100;
  const isWarning = percentage >= warningThresholdPercent && !isExceeded;

  let barColor = 'bg-brand-mint';
  let badgeColor = 'bg-status-success-subtle text-status-success border-status-success/30';
  let statusText = 'On Target';

  if (isExceeded) {
    barColor = 'bg-status-error';
    badgeColor = 'bg-status-error-subtle text-status-error border-status-error/30';
    statusText = 'Exceeded';
  } else if (isWarning) {
    barColor = 'bg-status-warning';
    badgeColor = 'bg-status-warning-subtle text-status-warning border-status-warning/30';
    statusText = 'Near Limit';
  }

  return (
    <div className={`space-y-1.5 ${className}`} role="group" aria-label={`${label} target adherence`}>
      <div className="flex justify-between items-center text-xs">
        <span className="font-medium text-[color:var(--t-color-text-strong)]">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[color:var(--t-color-text-muted)]">
            <strong className="text-[color:var(--t-color-text-strong)]">{currentVal}</strong> / {targetVal} {unit}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeColor}`}>
            {statusText} ({percentage}%)
          </span>
        </div>
      </div>

      <div
        className="w-full bg-[color:var(--t-color-surface-subtle)] rounded-full h-2.5 overflow-hidden border border-[color:var(--t-color-border-subtle)]"
        role="progressbar"
        aria-valuenow={currentVal}
        aria-valuemin={0}
        aria-valuemax={targetVal}
        aria-label={`${label}: ${percentage}%`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>

      {helperText && (
        <p className="text-xs text-[color:var(--t-color-text-muted)]">
          {helperText}
        </p>
      )}
    </div>
  );
};

export default TargetMeter;
