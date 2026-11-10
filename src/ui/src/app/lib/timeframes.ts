// src/ui/src/app/lib/timeframes.ts
// NUT-04 Shopper Timeline & Retention Specification (§4.10 / §5.3)
// Enforces single source of truth for the 4 timeframes and strict 3-month retention cutoff.

import { startOfDay, startOfWeek, startOfMonth, subMonths, subDays, subWeeks } from 'date-fns';

export type TimeframeKey = 'today' | 'week' | 'month' | '3months';

export interface Timeframe {
  key: TimeframeKey;
  label: string;
  start: number;
  end: number;
  bucket: 'hour' | 'day' | 'week';
  previous: { start: number; end: number } | null;
}

/**
 * Kenyan health-data client-side storage retention limit (3 months).
 * Any purchases or ledger entries older than retentionCutoff() MUST be purged
 * from client IndexedDB and must not be used in comparisons.
 */
export const RETENTION_MONTHS = 3;

export function retentionCutoff(now: Date = new Date()): number {
  return subMonths(startOfDay(now), RETENTION_MONTHS).getTime();
}

export function getTimeframe(key: TimeframeKey, nowMs: number = Date.now()): Timeframe {
  const now = new Date(nowMs);
  switch (key) {
    case 'today': {
      const start = startOfDay(now).getTime();
      const prevStart = subDays(start, 1).getTime();
      const elapsed = nowMs - start;
      return {
        key,
        label: 'Today',
        start,
        end: nowMs,
        bucket: 'hour',
        previous: {
          start: prevStart,
          end: prevStart + elapsed,
        },
      };
    }
    case 'week': {
      const start = startOfWeek(now, { weekStartsOn: 1 }).getTime();
      const prevStart = subWeeks(start, 1).getTime();
      const elapsed = nowMs - start;
      return {
        key,
        label: 'This Week',
        start,
        end: nowMs,
        bucket: 'day',
        previous: {
          start: prevStart,
          end: prevStart + elapsed,
        },
      };
    }
    case 'month': {
      const start = startOfMonth(now).getTime();
      const prevStart = subMonths(start, 1).getTime();
      const elapsed = nowMs - start;
      return {
        key,
        label: 'This Month',
        start,
        end: nowMs,
        bucket: 'day',
        previous: {
          start: prevStart,
          end: Math.min(prevStart + elapsed, start - 1),
        },
      };
    }
    case '3months': {
      const start = retentionCutoff(now);
      return {
        key,
        label: 'Past 3 Months',
        start,
        end: nowMs,
        bucket: 'week',
        previous: null, // Older data does not exist under 3-month retention policy
      };
    }
  }
}

export const TIMEFRAME_OPTIONS: { key: TimeframeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: '3months', label: 'Past 3 Months' },
];

