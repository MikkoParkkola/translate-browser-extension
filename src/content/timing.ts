/**
 * Content-script timing tracker
 *
 * Uses pre-allocated circular buffers instead of shift() which is O(n).
 */

const TIMING_BUFFER_SIZE = 100;

export class CircularTimingBuffer {
  private buffer: Float64Array;
  private writeIndex = 0;
  private count = 0;

  constructor(size: number) {
    this.buffer = new Float64Array(size);
  }

  push(value: number): void {
    this.buffer[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    if (this.count < this.buffer.length) this.count++;
  }

  getStats(): { avg: number; min: number; max: number; count: number } | null {
    if (this.count === 0) return null;
    let sum = 0, min = Infinity, max = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const val = this.buffer[i];
      sum += val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    return { avg: sum / this.count, min, max, count: this.count };
  }
}

export const contentTimings = {
  domScan: new CircularTimingBuffer(TIMING_BUFFER_SIZE),
  domUpdate: new CircularTimingBuffer(TIMING_BUFFER_SIZE),
  glossaryApply: new CircularTimingBuffer(TIMING_BUFFER_SIZE),
  ipcRoundtrip: new CircularTimingBuffer(TIMING_BUFFER_SIZE),
};

export function recordContentTiming(category: keyof typeof contentTimings, durationMs: number): void {
  contentTimings[category].push(durationMs);
}

export function getContentTimingStats(): Record<string, { avg: number; min: number; max: number; count: number }> {
  const result: Record<string, { avg: number; min: number; max: number; count: number }> = {};
  for (const [key, buffer] of Object.entries(contentTimings)) {
    const stats = buffer.getStats();
    if (stats) result[key] = stats;
  }
  return result;
}
