/**
 * Performance Profiler for TRANSLATE! extension
 *
 * High-resolution timing instrumentation for identifying bottlenecks.
 * Uses performance.now() for sub-millisecond accuracy.
 */

export interface TimingEntry {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface ProfileSession {
  id: string;
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  timings: Map<string, TimingEntry>;
  children: ProfileSession[];
}

export interface AggregateStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  total: number;
}

export interface ProfileReport {
  sessionId: string;
  totalMs: number;
  breakdown: Array<{
    name: string;
    durationMs: number;
    percentOfTotal: number;
  }>;
  aggregates: Map<string, AggregateStats>;
}

// Timing categories for the translation pipeline
export type TimingCategory =
  | 'total'
  | 'ipc_popup_to_background'
  | 'ipc_background_to_offscreen'
  | 'ipc_offscreen_to_background'
  | 'ipc_background_to_content'
  | 'model_load'
  | 'model_inference'
  | 'dom_scan'
  | 'dom_update'
  | 'cache_lookup'
  | 'cache_store'
  | 'glossary_apply'
  | 'language_detect'
  | 'chrome_builtin_translate'
  | 'offscreen_processing'
  | 'validation';

/**
 * Global profiler instance for cross-component timing
 */
class Profiler {
  private sessions: Map<string, ProfileSession> = new Map();
  private aggregateData: Map<string, number[]> = new Map();
  private enabled = true;
  private maxHistorySize = 1000;

  /**
   * Enable or disable profiling (for production)
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Start a new profiling session (e.g., one translation request)
   */
  startSession(sessionId?: string): string {
    if (!this.enabled) return sessionId || '';

    const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.sessions.set(id, {
      id,
      startTime: performance.now(),
      timings: new Map(),
      children: [],
    });
    return id;
  }

  /**
   * End a profiling session
   */
  endSession(sessionId: string): ProfileSession | undefined {
    if (!this.enabled) return undefined;

    const session = this.sessions.get(sessionId);
    if (session) {
      session.endTime = performance.now();
      session.totalDuration = session.endTime - session.startTime;
    }
    return session;
  }

  /**
   * Start timing a specific operation within a session
   */
  startTiming(sessionId: string, name: TimingCategory | string, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.timings.set(name, {
      name,
      startTime: performance.now(),
      metadata,
    });
  }

  /**
   * End timing a specific operation
   */
  endTiming(sessionId: string, name: TimingCategory | string): number {
    if (!this.enabled) return 0;

    const session = this.sessions.get(sessionId);
    if (!session) return 0;

    const timing = session.timings.get(name);
    if (!timing) return 0;

    timing.endTime = performance.now();
    timing.duration = timing.endTime - timing.startTime;

    // Add to aggregate data
    const key = name;
    if (!this.aggregateData.has(key)) {
      this.aggregateData.set(key, []);
    }
    const data = this.aggregateData.get(key)!;
    data.push(timing.duration);

    // Trim history if needed
    if (data.length > this.maxHistorySize) {
      data.shift();
    }

    return timing.duration;
  }

  /**
   * Convenient wrapper to time an async operation
   */
  async timeAsync<T>(
    sessionId: string,
    name: TimingCategory | string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    this.startTiming(sessionId, name, metadata);
    try {
      return await fn();
    } finally {
      this.endTiming(sessionId, name);
    }
  }

  /**
   * Convenient wrapper to time a sync operation
   */
  timeSync<T>(
    sessionId: string,
    name: TimingCategory | string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    this.startTiming(sessionId, name, metadata);
    try {
      return fn();
    } finally {
      this.endTiming(sessionId, name);
    }
  }

  /**
   * Record a timing directly (for when start/end are in different contexts)
   */
  recordTiming(sessionId: string, name: TimingCategory | string, durationMs: number, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    const now = performance.now();
    session.timings.set(name, {
      name,
      startTime: now - durationMs,
      endTime: now,
      duration: durationMs,
      metadata,
    });

    // Add to aggregate data
    if (!this.aggregateData.has(name)) {
      this.aggregateData.set(name, []);
    }
    const data = this.aggregateData.get(name)!;
    data.push(durationMs);

    if (data.length > this.maxHistorySize) {
      data.shift();
    }
  }

  /**
   * Get aggregate statistics for a timing category
   */
  getAggregateStats(name: string): AggregateStats | null {
    const data = this.aggregateData.get(name);
    if (!data || data.length === 0) return null;

    const sorted = [...data].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      total: sum,
    };
  }

  /**
   * Generate a detailed report for a session
   */
  getReport(sessionId: string): ProfileReport | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.totalDuration) return null;

    const breakdown: ProfileReport['breakdown'] = [];

    session.timings.forEach((timing, name) => {
      if (timing.duration !== undefined) {
        breakdown.push({
          name,
          durationMs: timing.duration,
          percentOfTotal: (timing.duration / session.totalDuration!) * 100,
        });
      }
    });

    // Sort by duration descending
    breakdown.sort((a, b) => b.durationMs - a.durationMs);

    const aggregates = new Map<string, AggregateStats>();
    Array.from(this.aggregateData.keys()).forEach((name) => {
      const stats = this.getAggregateStats(name);
      if (stats) {
        aggregates.set(name, stats);
      }
    });

    return {
      sessionId,
      totalMs: session.totalDuration,
      breakdown,
      aggregates,
    };
  }

  /**
   * Format a report as a readable string
   */
  formatReport(sessionId: string): string {
    const report = this.getReport(sessionId);
    if (!report) return 'No report available';

    const lines: string[] = [
      '',
      '========================================',
      '    Translation Profile Report',
      '========================================',
      `Session: ${report.sessionId}`,
      `Total: ${report.totalMs.toFixed(2)}ms`,
      '',
      'Breakdown:',
      '-----------------------------------------',
    ];

    for (const item of report.breakdown) {
      const bar = '|'.repeat(Math.round(item.percentOfTotal / 2));
      lines.push(
        `  ${item.name.padEnd(30)} ${item.durationMs.toFixed(2).padStart(10)}ms (${item.percentOfTotal.toFixed(1).padStart(5)}%) ${bar}`
      );
    }

    // Calculate IPC overhead
    const ipcCategories = report.breakdown.filter(b => b.name.startsWith('ipc_'));
    if (ipcCategories.length > 0) {
      const ipcTotal = ipcCategories.reduce((sum, b) => sum + b.durationMs, 0);
      lines.push('');
      lines.push(`IPC Overhead: ${ipcTotal.toFixed(2)}ms (${((ipcTotal / report.totalMs) * 100).toFixed(1)}%)`);
    }

    lines.push('');
    lines.push('========================================');

    return lines.join('\n');
  }

  /**
   * Format aggregate statistics as a readable string
   */
  formatAggregates(): string {
    const lines: string[] = [
      '',
      '========================================',
      '    Aggregate Performance Statistics',
      '========================================',
      '',
    ];

    const sortedKeys = Array.from(this.aggregateData.keys()).sort();

    sortedKeys.forEach((name) => {
      const stats = this.getAggregateStats(name);
      if (stats) {
        lines.push(`${name}:`);
        lines.push(`  Count: ${stats.count}`);
        lines.push(`  Min:   ${stats.min.toFixed(2)}ms`);
        lines.push(`  Max:   ${stats.max.toFixed(2)}ms`);
        lines.push(`  Avg:   ${stats.avg.toFixed(2)}ms`);
        lines.push(`  P50:   ${stats.p50.toFixed(2)}ms`);
        lines.push(`  P95:   ${stats.p95.toFixed(2)}ms`);
        lines.push(`  P99:   ${stats.p99.toFixed(2)}ms`);
        lines.push('');
      }
    });

    lines.push('========================================');
    return lines.join('\n');
  }

  /**
   * Get raw session data (for serialization across contexts)
   */
  getSessionData(sessionId: string): object | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Convert Map to object for serialization
    const timingsObj: Record<string, TimingEntry> = {};
    session.timings.forEach((timing, name) => {
      timingsObj[name] = timing;
    });

    return {
      id: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      totalDuration: session.totalDuration,
      timings: timingsObj,
    };
  }

  /**
   * Import session data from another context
   */
  importSessionData(data: object): void {
    const sessionData = data as {
      id: string;
      startTime: number;
      endTime?: number;
      totalDuration?: number;
      timings: Record<string, TimingEntry>;
    };

    const session: ProfileSession = {
      id: sessionData.id,
      startTime: sessionData.startTime,
      endTime: sessionData.endTime,
      totalDuration: sessionData.totalDuration,
      timings: new Map(Object.entries(sessionData.timings)),
      children: [],
    };

    this.sessions.set(session.id, session);

    // Add to aggregates
    session.timings.forEach((timing, name) => {
      if (timing.duration !== undefined) {
        if (!this.aggregateData.has(name)) {
          this.aggregateData.set(name, []);
        }
        this.aggregateData.get(name)!.push(timing.duration);
      }
    });
  }

  /**
   * Clear all profiling data
   */
  clear(): void {
    this.sessions.clear();
    this.aggregateData.clear();
  }

  /**
   * Get all aggregate data for export
   */
  getAllAggregates(): Record<string, AggregateStats> {
    const result: Record<string, AggregateStats> = {};
    Array.from(this.aggregateData.keys()).forEach((name) => {
      const stats = this.getAggregateStats(name);
      if (stats) {
        result[name] = stats;
      }
    });
    return result;
  }
}

// Singleton instance
export const profiler = new Profiler();

/**
 * Quick timing helper for one-off measurements
 */
export function measureTime(label: string, fn: () => void): number {
  const start = performance.now();
  fn();
  const duration = performance.now() - start;
  console.log(`[Profiler] ${label}: ${duration.toFixed(2)}ms`);
  return duration;
}

/**
 * Quick async timing helper
 */
export async function measureTimeAsync<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  console.log(`[Profiler] ${label}: ${duration.toFixed(2)}ms`);
  return { result, duration };
}
