/**
 * Performance Profiler unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { profiler, measureTime, measureTimeAsync } from './profiler';
import type { TimingCategory } from './profiler';

describe('Profiler', () => {
  beforeEach(() => {
    profiler.clear();
    profiler.setEnabled(true);
  });

  describe('setEnabled', () => {
    it('disables profiling when set to false', () => {
      profiler.setEnabled(false);
      // When disabled with a provided sessionId, it returns the sessionId as-is
      const id = profiler.startSession('test');
      expect(id).toBe('test');

      // When disabled without sessionId, it returns empty string
      const id2 = profiler.startSession();
      expect(id2).toBe('');
    });

    it('re-enables profiling when set to true', () => {
      profiler.setEnabled(false);
      profiler.setEnabled(true);
      const id = profiler.startSession('re-enabled');
      expect(id).toBe('re-enabled');
    });
  });

  describe('startSession', () => {
    it('creates a session with provided ID', () => {
      const id = profiler.startSession('my-session');
      expect(id).toBe('my-session');
    });

    it('generates a unique ID when none provided', () => {
      const id = profiler.startSession();
      expect(id).toMatch(/^session_\d+_[a-z0-9]+$/);
    });

    it('returns empty string when disabled', () => {
      profiler.setEnabled(false);
      const id = profiler.startSession();
      expect(id).toBe('');
    });

    it('can create multiple sessions', () => {
      const id1 = profiler.startSession('session-1');
      const id2 = profiler.startSession('session-2');
      expect(id1).not.toBe(id2);

      const data1 = profiler.getSessionData(id1);
      const data2 = profiler.getSessionData(id2);
      expect(data1).not.toBeNull();
      expect(data2).not.toBeNull();
    });
  });

  describe('endSession', () => {
    it('ends a session and calculates total duration', () => {
      const id = profiler.startSession('end-test');
      const session = profiler.endSession(id);

      expect(session).toBeDefined();
      expect(session!.endTime).toBeDefined();
      expect(session!.totalDuration).toBeDefined();
      expect(session!.totalDuration!).toBeGreaterThanOrEqual(0);
    });

    it('returns undefined for non-existent session', () => {
      const result = profiler.endSession('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns undefined when disabled', () => {
      profiler.setEnabled(false);
      const result = profiler.endSession('any');
      expect(result).toBeUndefined();
    });
  });

  describe('startTiming / endTiming', () => {
    it('records timing duration', () => {
      const id = profiler.startSession('timing-test');
      profiler.startTiming(id, 'model_load');

      // Small delay to ensure measurable duration
      const duration = profiler.endTiming(id, 'model_load');
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('stores metadata with timing', () => {
      const id = profiler.startSession('meta-test');
      profiler.startTiming(id, 'dom_scan', { nodeCount: 150 });

      profiler.endTiming(id, 'dom_scan');
      const data = profiler.getSessionData(id) as {
        timings: Record<string, { metadata?: Record<string, unknown> }>;
      };
      expect(data.timings['dom_scan'].metadata).toEqual({ nodeCount: 150 });
    });

    it('returns 0 for non-existent session', () => {
      profiler.startTiming('nonexistent', 'test');
      const duration = profiler.endTiming('nonexistent', 'test');
      expect(duration).toBe(0);
    });

    it('returns 0 for non-existent timing', () => {
      const id = profiler.startSession('no-timing');
      const duration = profiler.endTiming(id, 'never_started');
      expect(duration).toBe(0);
    });

    it('returns 0 when disabled', () => {
      profiler.setEnabled(false);
      const duration = profiler.endTiming('any', 'any');
      expect(duration).toBe(0);
    });

    it('does nothing on startTiming when disabled', () => {
      profiler.setEnabled(false);
      profiler.startTiming('any', 'any');
      // No error thrown
    });

    it('does nothing on startTiming for non-existent session', () => {
      profiler.startTiming('nonexistent', 'test');
      // No error thrown
    });

    it('adds duration to aggregate data', () => {
      const id = profiler.startSession('agg-test');
      profiler.startTiming(id, 'cache_lookup');
      profiler.endTiming(id, 'cache_lookup');

      const stats = profiler.getAggregateStats('cache_lookup');
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(1);
    });
  });

  describe('timeAsync', () => {
    it('times an async operation and returns its result', async () => {
      const id = profiler.startSession('async-test');

      const result = await profiler.timeAsync(id, 'model_inference', async () => {
        return 'translated text';
      });

      expect(result).toBe('translated text');
    });

    it('records timing even when function throws', async () => {
      const id = profiler.startSession('async-error');

      await expect(
        profiler.timeAsync(id, 'model_inference', async () => {
          throw new Error('inference failed');
        })
      ).rejects.toThrow('inference failed');

      // Timing should still be recorded in aggregates
      const stats = profiler.getAggregateStats('model_inference');
      expect(stats).not.toBeNull();
      expect(stats!.count).toBeGreaterThanOrEqual(1);
    });

    it('passes metadata through', async () => {
      const id = profiler.startSession('async-meta');

      await profiler.timeAsync(
        id,
        'dom_update',
        async () => 'done',
        { batchSize: 10 }
      );

      const data = profiler.getSessionData(id) as {
        timings: Record<string, { metadata?: Record<string, unknown> }>;
      };
      expect(data.timings['dom_update'].metadata).toEqual({ batchSize: 10 });
    });
  });

  describe('timeSync', () => {
    it('times a sync operation and returns its result', () => {
      const id = profiler.startSession('sync-test');

      const result = profiler.timeSync(id, 'validation', () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('records timing even when function throws', () => {
      const id = profiler.startSession('sync-error');

      expect(() =>
        profiler.timeSync(id, 'validation', () => {
          throw new Error('validation failed');
        })
      ).toThrow('validation failed');

      const stats = profiler.getAggregateStats('validation');
      expect(stats).not.toBeNull();
    });

    it('passes metadata through', () => {
      const id = profiler.startSession('sync-meta');

      profiler.timeSync(
        id,
        'cache_store',
        () => 'cached',
        { size: 1024 }
      );

      const data = profiler.getSessionData(id) as {
        timings: Record<string, { metadata?: Record<string, unknown> }>;
      };
      expect(data.timings['cache_store'].metadata).toEqual({ size: 1024 });
    });
  });

  describe('recordTiming', () => {
    it('records a timing directly with a given duration', () => {
      const id = profiler.startSession('record-test');
      profiler.recordTiming(id, 'ipc_popup_to_background', 15.5);

      const stats = profiler.getAggregateStats('ipc_popup_to_background');
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(1);
      expect(stats!.avg).toBeCloseTo(15.5, 1);
    });

    it('stores metadata with recorded timing', () => {
      const id = profiler.startSession('record-meta');
      profiler.recordTiming(id, 'chrome_builtin_translate', 50, { provider: 'chrome' });

      const data = profiler.getSessionData(id) as {
        timings: Record<string, { metadata?: Record<string, unknown>; duration: number }>;
      };
      expect(data.timings['chrome_builtin_translate'].metadata).toEqual({ provider: 'chrome' });
      expect(data.timings['chrome_builtin_translate'].duration).toBe(50);
    });

    it('does nothing when disabled', () => {
      profiler.setEnabled(false);
      profiler.recordTiming('any', 'test', 100);
      profiler.setEnabled(true);

      const stats = profiler.getAggregateStats('test');
      expect(stats).toBeNull();
    });

    it('does nothing for non-existent session', () => {
      profiler.recordTiming('nonexistent', 'test', 100);
      // Should not throw
    });

    it('adds to aggregate data', () => {
      const id = profiler.startSession('agg-record');
      profiler.recordTiming(id, 'language_detect', 5);
      profiler.recordTiming(id, 'language_detect', 10);
      profiler.recordTiming(id, 'language_detect', 15);

      const stats = profiler.getAggregateStats('language_detect');
      expect(stats!.count).toBe(3);
      expect(stats!.avg).toBe(10);
      expect(stats!.min).toBe(5);
      expect(stats!.max).toBe(15);
    });
  });

  describe('getAggregateStats', () => {
    it('returns null for unknown timing name', () => {
      const stats = profiler.getAggregateStats('nonexistent');
      expect(stats).toBeNull();
    });

    it('calculates correct statistics for single value', () => {
      const id = profiler.startSession('stats-single');
      profiler.recordTiming(id, 'test_timing', 100);

      const stats = profiler.getAggregateStats('test_timing')!;
      expect(stats.count).toBe(1);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(100);
      expect(stats.avg).toBe(100);
      expect(stats.p50).toBe(100);
      expect(stats.p95).toBe(100);
      expect(stats.p99).toBe(100);
      expect(stats.total).toBe(100);
    });

    it('calculates correct statistics for multiple values', () => {
      const id = profiler.startSession('stats-multi');
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const v of values) {
        profiler.recordTiming(id, 'multi_timing', v);
      }

      const stats = profiler.getAggregateStats('multi_timing')!;
      expect(stats.count).toBe(10);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(100);
      expect(stats.avg).toBe(55);
      expect(stats.total).toBe(550);
      // p50 = sorted[5] = 60
      expect(stats.p50).toBe(60);
      // p95 = sorted[9] = 100
      expect(stats.p95).toBe(100);
      // p99 = sorted[9] = 100
      expect(stats.p99).toBe(100);
    });

    it('handles large datasets for accurate percentiles', () => {
      const id = profiler.startSession('stats-large');
      for (let i = 1; i <= 100; i++) {
        profiler.recordTiming(id, 'large_timing', i);
      }

      const stats = profiler.getAggregateStats('large_timing')!;
      expect(stats.count).toBe(100);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(100);
      expect(stats.avg).toBe(50.5);
      expect(stats.p50).toBe(51); // sorted[50]
      expect(stats.p95).toBe(96); // sorted[95]
      expect(stats.p99).toBe(100); // sorted[99]
    });
  });

  describe('circular buffer behavior (maxHistorySize)', () => {
    it('trims old data when exceeding max history size', () => {
      const id = profiler.startSession('buffer-test');

      // Record 1001 timings (exceeds default 1000 limit)
      for (let i = 0; i < 1001; i++) {
        profiler.recordTiming(id, 'buffer_timing', i);
      }

      const stats = profiler.getAggregateStats('buffer_timing')!;
      // Should have trimmed to 1000
      expect(stats.count).toBe(1000);
      // First value (0) should have been shifted out
      expect(stats.min).toBe(1);
    });

    it('trims via endTiming as well', () => {
      const sessionId = profiler.startSession('trim-endTiming');

      for (let i = 0; i < 1002; i++) {
        profiler.startTiming(sessionId, 'trim_test');
        profiler.endTiming(sessionId, 'trim_test');
      }

      const stats = profiler.getAggregateStats('trim_test')!;
      expect(stats.count).toBe(1000);
    });
  });

  describe('getReport', () => {
    it('returns null for non-existent session', () => {
      const report = profiler.getReport('nonexistent');
      expect(report).toBeNull();
    });

    it('returns null for session without totalDuration (not ended)', () => {
      const id = profiler.startSession('not-ended');
      const report = profiler.getReport(id);
      expect(report).toBeNull();
    });

    it('generates report with breakdown sorted by duration', () => {
      const id = profiler.startSession('report-test');
      profiler.recordTiming(id, 'model_load', 100);
      profiler.recordTiming(id, 'dom_scan', 50);
      profiler.recordTiming(id, 'cache_lookup', 10);
      profiler.endSession(id);

      const report = profiler.getReport(id)!;
      expect(report).not.toBeNull();
      expect(report.sessionId).toBe(id);
      expect(report.totalMs).toBeGreaterThan(0);
      expect(report.breakdown).toHaveLength(3);

      // Sorted by duration descending
      expect(report.breakdown[0].name).toBe('model_load');
      expect(report.breakdown[0].durationMs).toBe(100);
      expect(report.breakdown[1].name).toBe('dom_scan');
      expect(report.breakdown[2].name).toBe('cache_lookup');
    });

    it('calculates percent of total correctly', () => {
      const id = profiler.startSession('percent-test');
      profiler.recordTiming(id, 'op1', 75);
      profiler.recordTiming(id, 'op2', 25);
      profiler.endSession(id);

      const report = profiler.getReport(id)!;
      const totalMs = report.totalMs;

      for (const item of report.breakdown) {
        expect(item.percentOfTotal).toBeCloseTo(
          (item.durationMs / totalMs) * 100,
          1
        );
      }
    });

    it('includes aggregate statistics', () => {
      const id = profiler.startSession('agg-report');
      profiler.recordTiming(id, 'model_load', 100);
      profiler.recordTiming(id, 'model_load', 200);
      profiler.endSession(id);

      const report = profiler.getReport(id)!;
      expect(report.aggregates.size).toBeGreaterThan(0);
      const loadStats = report.aggregates.get('model_load');
      expect(loadStats).toBeDefined();
      expect(loadStats!.count).toBe(2);
    });

    it('excludes timings without duration from breakdown', () => {
      const id = profiler.startSession('no-duration');
      // Start a timing but never end it
      profiler.startTiming(id, 'unfinished');
      profiler.recordTiming(id, 'finished', 50);
      profiler.endSession(id);

      const report = profiler.getReport(id)!;
      const names = report.breakdown.map((b) => b.name);
      expect(names).toContain('finished');
      expect(names).not.toContain('unfinished');
    });
  });

  describe('formatReport', () => {
    it('returns "No report available" for invalid session', () => {
      const output = profiler.formatReport('nonexistent');
      expect(output).toBe('No report available');
    });

    it('contains report header and breakdown', () => {
      const id = profiler.startSession('format-test');
      profiler.recordTiming(id, 'model_load', 100);
      profiler.recordTiming(id, 'dom_scan', 50);
      profiler.endSession(id);

      const output = profiler.formatReport(id);
      expect(output).toContain('Translation Profile Report');
      expect(output).toContain('model_load');
      expect(output).toContain('dom_scan');
      expect(output).toContain('ms');
      expect(output).toContain('%');
    });

    it('includes IPC overhead section when IPC timings exist', () => {
      const id = profiler.startSession('ipc-test');
      profiler.recordTiming(id, 'ipc_popup_to_background', 20);
      profiler.recordTiming(id, 'ipc_background_to_offscreen', 15);
      profiler.recordTiming(id, 'model_load', 100);
      profiler.endSession(id);

      const output = profiler.formatReport(id);
      expect(output).toContain('IPC Overhead');
      expect(output).toContain('35.00ms');
    });

    it('does not include IPC section when no IPC timings', () => {
      const id = profiler.startSession('no-ipc');
      profiler.recordTiming(id, 'model_load', 100);
      profiler.endSession(id);

      const output = profiler.formatReport(id);
      expect(output).not.toContain('IPC Overhead');
    });
  });

  describe('formatAggregates', () => {
    it('returns header when no data', () => {
      const output = profiler.formatAggregates();
      expect(output).toContain('Aggregate Performance Statistics');
    });

    it('includes all timing categories with stats', () => {
      const id = profiler.startSession('format-agg');
      profiler.recordTiming(id, 'model_load', 100);
      profiler.recordTiming(id, 'dom_scan', 50);

      const output = profiler.formatAggregates();
      expect(output).toContain('model_load:');
      expect(output).toContain('dom_scan:');
      expect(output).toContain('Count:');
      expect(output).toContain('Min:');
      expect(output).toContain('Max:');
      expect(output).toContain('Avg:');
      expect(output).toContain('P50:');
      expect(output).toContain('P95:');
      expect(output).toContain('P99:');
    });

    it('sorts keys alphabetically', () => {
      const id = profiler.startSession('sort-test');
      profiler.recordTiming(id, 'zzz_timing', 10);
      profiler.recordTiming(id, 'aaa_timing', 20);

      const output = profiler.formatAggregates();
      const aaaIndex = output.indexOf('aaa_timing');
      const zzzIndex = output.indexOf('zzz_timing');
      expect(aaaIndex).toBeLessThan(zzzIndex);
    });
  });

  describe('getSessionData', () => {
    it('returns null for non-existent session', () => {
      expect(profiler.getSessionData('nonexistent')).toBeNull();
    });

    it('returns serializable session data', () => {
      const id = profiler.startSession('data-test');
      profiler.recordTiming(id, 'model_load', 100, { model: 'opus-mt' });
      profiler.endSession(id);

      const data = profiler.getSessionData(id) as {
        id: string;
        startTime: number;
        endTime: number;
        totalDuration: number;
        timings: Record<string, { name: string; duration: number; metadata?: Record<string, unknown> }>;
      };

      expect(data).not.toBeNull();
      expect(data.id).toBe(id);
      expect(data.startTime).toBeDefined();
      expect(data.endTime).toBeDefined();
      expect(data.totalDuration).toBeDefined();
      expect(data.timings).toBeDefined();
      expect(data.timings['model_load']).toBeDefined();
      expect(data.timings['model_load'].duration).toBe(100);
      expect(data.timings['model_load'].metadata).toEqual({ model: 'opus-mt' });
    });

    it('returns data as plain object (not Map)', () => {
      const id = profiler.startSession('plain-obj');
      profiler.recordTiming(id, 'test', 10);

      const data = profiler.getSessionData(id)!;
      // Should be JSON-serializable
      const json = JSON.stringify(data);
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(id);
    });
  });

  describe('importSessionData', () => {
    it('imports session data from another context', () => {
      const sessionData = {
        id: 'imported-session',
        startTime: 1000,
        endTime: 2000,
        totalDuration: 1000,
        timings: {
          model_load: {
            name: 'model_load',
            startTime: 1100,
            endTime: 1500,
            duration: 400,
          },
          dom_scan: {
            name: 'dom_scan',
            startTime: 1500,
            endTime: 1700,
            duration: 200,
          },
        },
      };

      profiler.importSessionData(sessionData);

      const data = profiler.getSessionData('imported-session');
      expect(data).not.toBeNull();

      // Aggregates should be populated
      const loadStats = profiler.getAggregateStats('model_load');
      expect(loadStats).not.toBeNull();
      expect(loadStats!.count).toBeGreaterThanOrEqual(1);
    });

    it('adds imported timings to aggregate data', () => {
      const id = profiler.startSession('pre-import');
      profiler.recordTiming(id, 'model_load', 100);

      const sessionData = {
        id: 'imported',
        startTime: 0,
        endTime: 1000,
        totalDuration: 1000,
        timings: {
          model_load: {
            name: 'model_load',
            startTime: 0,
            endTime: 500,
            duration: 500,
          },
        },
      };

      profiler.importSessionData(sessionData);

      const stats = profiler.getAggregateStats('model_load')!;
      expect(stats.count).toBe(2);
    });

    it('does not add timings without duration to aggregates', () => {
      const sessionData = {
        id: 'no-duration-import',
        startTime: 0,
        timings: {
          unfinished: {
            name: 'unfinished',
            startTime: 0,
            // No duration
          },
        },
      };

      profiler.importSessionData(sessionData);

      const stats = profiler.getAggregateStats('unfinished');
      expect(stats).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes all sessions and aggregate data', () => {
      const id = profiler.startSession('clear-test');
      profiler.recordTiming(id, 'model_load', 100);
      profiler.endSession(id);

      profiler.clear();

      expect(profiler.getSessionData(id)).toBeNull();
      expect(profiler.getAggregateStats('model_load')).toBeNull();
      expect(profiler.getReport(id)).toBeNull();
    });
  });

  describe('getAllAggregates', () => {
    it('returns empty object when no data', () => {
      const result = profiler.getAllAggregates();
      expect(result).toEqual({});
    });

    it('returns all aggregates as plain object', () => {
      const id = profiler.startSession('all-agg');
      profiler.recordTiming(id, 'model_load', 100);
      profiler.recordTiming(id, 'dom_scan', 50);

      const result = profiler.getAllAggregates();
      expect(result['model_load']).toBeDefined();
      expect(result['model_load'].count).toBe(1);
      expect(result['dom_scan']).toBeDefined();
      expect(result['dom_scan'].count).toBe(1);
    });

    it('result is JSON-serializable', () => {
      const id = profiler.startSession('json-agg');
      profiler.recordTiming(id, 'test', 42);

      const result = profiler.getAllAggregates();
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);
      expect(parsed['test'].avg).toBe(42);
    });
  });

  describe('cross-session aggregation', () => {
    it('aggregates data across multiple sessions', () => {
      const id1 = profiler.startSession('session-a');
      profiler.recordTiming(id1, 'model_load', 100);
      profiler.endSession(id1);

      const id2 = profiler.startSession('session-b');
      profiler.recordTiming(id2, 'model_load', 200);
      profiler.endSession(id2);

      const stats = profiler.getAggregateStats('model_load')!;
      expect(stats.count).toBe(2);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(200);
      expect(stats.avg).toBe(150);
    });
  });

  describe('TimingCategory type support', () => {
    it('accepts all defined timing categories', () => {
      const id = profiler.startSession('category-test');
      const categories: TimingCategory[] = [
        'total',
        'ipc_popup_to_background',
        'ipc_background_to_offscreen',
        'ipc_offscreen_to_background',
        'ipc_background_to_content',
        'model_load',
        'model_inference',
        'dom_scan',
        'dom_update',
        'cache_lookup',
        'cache_store',
        'glossary_apply',
        'language_detect',
        'chrome_builtin_translate',
        'offscreen_processing',
        'validation',
      ];

      for (const cat of categories) {
        profiler.recordTiming(id, cat, 10);
      }

      const stats = profiler.getAllAggregates();
      expect(Object.keys(stats)).toHaveLength(categories.length);
    });

    it('also accepts arbitrary string names', () => {
      const id = profiler.startSession('custom-name');
      profiler.recordTiming(id, 'custom_operation', 25);

      const stats = profiler.getAggregateStats('custom_operation');
      expect(stats).not.toBeNull();
    });
  });
});

describe('measureTime', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('executes the function and returns duration', () => {
    let called = false;
    const duration = measureTime('test', () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('logs the label and duration', () => {
    const logSpy = vi.spyOn(console, 'log');
    measureTime('my-operation', () => {});

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Profiler] my-operation:'),
      // Has a duration string like "0.01ms"
    );
  });

  it('measures actual work time', () => {
    const duration = measureTime('busy', () => {
      // Do some work
      let sum = 0;
      for (let i = 0; i < 10000; i++) {
        sum += i;
      }
      return sum;
    });

    expect(duration).toBeGreaterThanOrEqual(0);
  });
});

describe('measureTimeAsync', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('executes the async function and returns result with duration', async () => {
    const { result, duration } = await measureTimeAsync('async-test', async () => {
      return 'hello';
    });

    expect(result).toBe('hello');
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('logs the label and duration', async () => {
    const logSpy = vi.spyOn(console, 'log');
    await measureTimeAsync('async-op', async () => 42);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Profiler] async-op:'),
    );
  });

  it('returns correct result type', async () => {
    const { result } = await measureTimeAsync('typed', async () => {
      return { count: 5, items: ['a', 'b'] };
    });

    expect(result.count).toBe(5);
    expect(result.items).toEqual(['a', 'b']);
  });
});
