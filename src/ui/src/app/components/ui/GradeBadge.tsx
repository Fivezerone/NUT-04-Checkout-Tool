// src/ui/src/app/components/ui/GradeBadge.tsx
// Official Nutri-Score Grade A-E Badge Component (§4.3 / §5.3)

import React from 'react';

export type NutriGrade = 'a' | 'b' | 'c' | 'd' | 'e' | 'A' | 'B' | 'C' | 'D' | 'E';

interface GradeBadgeProps {
  grade: NutriGrade | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showScale?: boolean;
  className?: string;
}

const GRADE_DATA: Record<
  string,
  { label: string; bg: string; text: string; description: string }
> = {
  A: {
    label: 'A',
    bg: '#038141',
    text: '#ffffff',
    description: 'Very Good nutritional quality',
  },
  B: {
    label: 'B',
    bg: '#85bb2f',
    text: '#ffffff',
    description: 'Good nutritional quality',
  },
  C: {
    label: 'C',
    bg: '#fecb02',
    text: '#212121',
    description: 'Average nutritional quality',
  },
  D: {
    label: 'D',
    bg: '#ee8100',
    text: '#ffffff',
    description: 'Poor nutritional quality',
  },
  E: {
    label: 'E',
    bg: '#e63e11',
    text: '#ffffff',
    description: 'Unfavourable nutritional quality',
  },
};

const ALL_GRADES = ['A', 'B', 'C', 'D', 'E'];

export const GradeBadge: React.FC<GradeBadgeProps> = ({
  grade,
  size = 'md',
  showScale = false,
  className = '',
}) => {
  const normGrade = grade ? grade.toUpperCase() : null;
  const gradeInfo = normGrade ? GRADE_DATA[normGrade] : null;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 min-w-[24px]',
    md: 'text-sm px-2.5 py-1 min-w-[32px]',
    lg: 'text-lg px-3.5 py-1.5 min-w-[42px] font-bold',
  }[size];

  if (showScale) {
    return (
      <div
        className={`inline-flex items-center gap-1 p-1 bg-surface rounded-md border border-border-subtle shadow-sm ${className}`}
        role="group"
        aria-label={`Nutri-Score Scale, current grade ${normGrade || 'Unscored'}`}
      >
        {ALL_GRADES.map((g) => {
          const isActive = g === normGrade;
          const info = GRADE_DATA[g];
          return (
            <span
              key={g}
              style={{
                backgroundColor: isActive ? info.bg : '#e2e8f0',
                color: isActive ? info.text : '#64748b',
              }}
              className={`inline-flex items-center justify-center font-bold rounded transition-transform ${
                isActive ? 'scale-110 shadow-sm z-10 px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-xs opacity-75'
              }`}
              aria-current={isActive ? 'true' : undefined}
            >
              {g}
            </span>
          );
        })}
      </div>
    );
  }

  if (!gradeInfo) {
    return (
      <span
        className={`inline-flex items-center justify-center font-semibold rounded bg-muted text-muted-foreground border border-border-subtle ${sizeClasses} ${className}`}
        aria-label="Product Unscored"
      >
        —
      </span>
    );
  }

  return (
    <span
      style={{ backgroundColor: gradeInfo.bg, color: gradeInfo.text }}
      className={`inline-flex items-center justify-center font-bold rounded shadow-sm ${sizeClasses} ${className}`}
      aria-label={`Nutri-Score Grade ${normGrade}: ${gradeInfo.description}`}
      title={`Nutri-Score ${normGrade} — ${gradeInfo.description}`}
    >
      {normGrade}
    </span>
  );
};

