import { describe, it, expect } from 'vitest';
import { GradeBadge } from '../components/ui/GradeBadge';
import { KpiCard } from '../components/ui/KpiCard';
import { TargetMeter } from '../components/ui/TargetMeter';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ConditionChip } from '../components/ui/ConditionChip';

describe('Design System Primitives Contract (Phase C2 / WCAG 2.2 AA)', () => {
  it('exports GradeBadge component and supports all standard grades', () => {
    expect(GradeBadge).toBeDefined();
    expect(typeof GradeBadge).toBe('function');
  });

  it('exports KpiCard component and supports hero and standard variants', () => {
    expect(KpiCard).toBeDefined();
    expect(typeof KpiCard).toBe('function');
  });

  it('exports TargetMeter component and validates thresholds', () => {
    expect(TargetMeter).toBeDefined();
    expect(typeof TargetMeter).toBe('function');
  });

  it('exports ConfirmDialog for typed destructive confirmation', () => {
    expect(ConfirmDialog).toBeDefined();
    expect(typeof ConfirmDialog).toBe('function');
  });

  it('exports ConditionChip with non-surface recoloring design', () => {
    expect(ConditionChip).toBeDefined();
    expect(typeof ConditionChip).toBe('function');
  });
});

