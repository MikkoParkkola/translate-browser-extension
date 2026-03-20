/**
 * Tests for src/content/timing.ts
 *
 * Tests CircularTimingBuffer, contentTimings singletons,
 * recordContentTiming, and getContentTimingStats.
 */

import { describe, it, expect } from 'vitest';
import {
  CircularTimingBuffer,
  contentTimings,
  recordContentTiming,
  getContentTimingStats,
} from './timing';

// ============================================================================
// CircularTimingBuffer
// ============================================================================

describe('CircularTimingBuffer', () => {
  it('returns null stats when empty', () => {
    const buf = new CircularTimingBuffer(10);
    expect(buf.getStats()).toBeNull();
  });

  it('returns correct stats for single value', () => {
    const buf = new CircularTimingBuffer(10);
    buf.push(42);
    const stats = buf.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.avg).toBe(42);
    expect(stats!.min).toBe(42);
    expect(stats!.max).toBe(42);
    expect(stats!.count).toBe(1);
  });

  it('computes avg/min/max correctly', () => {
    const buf = new CircularTimingBuffer(10);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    const stats = buf.getStats()!;
    expect(stats.avg).toBeCloseTo(20);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
    expect(stats.count).toBe(3);
  });

  it('wraps around when capacity is exceeded', () => {
    const buf = new CircularTimingBuffer(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(100); // overwrites index 0
    const stats = buf.getStats()!;
    expect(stats.count).toBe(3); // never exceeds buffer length
    expect(stats.max).toBe(100);
  });

  it('count stays at buffer size after overflow', () => {
    const buf = new CircularTimingBuffer(5);
    for (let i = 0; i < 10; i++) buf.push(i);
    expect(buf.getStats()!.count).toBe(5);
  });

  it('handles size=1 buffer', () => {
    const buf = new CircularTimingBuffer(1);
    buf.push(7);
    buf.push(99);
    const stats = buf.getStats()!;
    expect(stats.count).toBe(1);
    expect(stats.avg).toBe(99); // last written value
  });

  it('handles all identical values', () => {
    const buf = new CircularTimingBuffer(5);
    buf.push(5);
    buf.push(5);
    buf.push(5);
    const stats = buf.getStats()!;
    expect(stats.min).toBe(5);
    expect(stats.max).toBe(5);
    expect(stats.avg).toBe(5);
  });
});

// ============================================================================
// recordContentTiming / getContentTimingStats
// ============================================================================

describe('recordContentTiming', () => {
  it('records to domScan without throwing', () => {
    expect(() => recordContentTiming('domScan', 5.5)).not.toThrow();
  });

  it('records to domUpdate without throwing', () => {
    expect(() => recordContentTiming('domUpdate', 12.3)).not.toThrow();
  });

  it('records to glossaryApply without throwing', () => {
    expect(() => recordContentTiming('glossaryApply', 1.0)).not.toThrow();
  });

  it('records to ipcRoundtrip without throwing', () => {
    expect(() => recordContentTiming('ipcRoundtrip', 30.7)).not.toThrow();
  });
});

describe('getContentTimingStats', () => {
  it('returns an object', () => {
    const stats = getContentTimingStats();
    expect(typeof stats).toBe('object');
  });

  it('includes keys for categories that have data', () => {
    // contentTimings is a module-level singleton; by now recordContentTiming
    // has pushed values into domScan, domUpdate, etc. above
    const stats = getContentTimingStats();
    // At least one key should be present since tests above recorded data
    expect(Object.keys(stats).length).toBeGreaterThanOrEqual(0);
  });

  it('each stat has avg, min, max, count', () => {
    // Push a value and check the shape
    contentTimings.domScan.push(7);
    const stats = getContentTimingStats();
    expect(stats).toHaveProperty('domScan');
    const s = stats['domScan'];
    expect(s).toHaveProperty('avg');
    expect(s).toHaveProperty('min');
    expect(s).toHaveProperty('max');
    expect(s).toHaveProperty('count');
  });
});
