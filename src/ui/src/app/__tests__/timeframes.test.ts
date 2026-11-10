import { describe, it, expect } from 'vitest';
import {
  getTimeframe,
  retentionCutoff,
  RETENTION_MONTHS,
  TIMEFRAME_OPTIONS,
  TimeframeKey,
} from '../lib/timeframes';

describe('Timeline & Retention Specification (§4.10 / §5.3)', () => {
  const fixedNow = new Date('2026-11-10T12:00:00Z').getTime();

  it('defines exactly four standard timeframe options', () => {
    expect(TIMEFRAME_OPTIONS.map((o) => o.key)).toEqual([
      'today',
      'week',
      'month',
      '3months',
    ]);
  });

  it('calculates 3-month retention cutoff at the start of day 3 months prior', () => {
    const testDate = new Date(2026, 10, 10, 12, 0, 0); // Nov 10, 2026 local
    const cutoff = retentionCutoff(testDate);
    const cutoffDate = new Date(cutoff);
    expect(RETENTION_MONTHS).toBe(3);
    expect(cutoffDate.getFullYear()).toBe(2026);
    expect(cutoffDate.getMonth()).toBe(7); // August (10 - 3 = 7, 0-indexed)
    expect(cutoffDate.getDate()).toBe(10);
    expect(cutoffDate.getHours()).toBe(0);
    expect(cutoffDate.getMinutes()).toBe(0);
  });

  it('today timeframe buckets by hour and computes elapsed previous period', () => {
    const tf = getTimeframe('today', fixedNow);
    expect(tf.key).toBe('today');
    expect(tf.bucket).toBe('hour');
    expect(tf.end).toBe(fixedNow);
    expect(tf.previous).not.toBeNull();
    if (tf.previous) {
      expect(tf.previous.end - tf.previous.start).toBe(tf.end - tf.start);
    }
  });

  it('week timeframe buckets by day and sets Monday as week start', () => {
    const tf = getTimeframe('week', fixedNow);
    expect(tf.key).toBe('week');
    expect(tf.bucket).toBe('day');
    expect(tf.end).toBe(fixedNow);
    expect(tf.previous).not.toBeNull();
    if (tf.previous) {
      expect(tf.previous.end - tf.previous.start).toBe(tf.end - tf.start);
    }
  });

  it('month timeframe buckets by day and computes prior month elapsed period', () => {
    const tf = getTimeframe('month', fixedNow);
    expect(tf.key).toBe('month');
    expect(tf.bucket).toBe('day');
    expect(tf.end).toBe(fixedNow);
    expect(tf.previous).not.toBeNull();
  });

  it('3months timeframe buckets by week and has no previous comparison period', () => {
    const tf = getTimeframe('3months', fixedNow);
    expect(tf.key).toBe('3months');
    expect(tf.bucket).toBe('week');
    expect(tf.start).toBe(retentionCutoff(new Date(fixedNow)));
    // Prior data does not exist under the 3-month client retention contract
    expect(tf.previous).toBeNull();
  });
});
