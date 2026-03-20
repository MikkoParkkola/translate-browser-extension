// ModelPerformanceMonitor stub for LocalModelManager

export interface PerformanceMonitorConfig {
  enabled?: boolean;
  sampleInterval?: number;
  maxSamples?: number;
}

export interface PerformanceSummary {
  [key: string]: unknown;
}

export class ModelPerformanceMonitor {
  constructor(_config?: PerformanceMonitorConfig) {}

  startPerformanceMonitoring(): void {}

  updatePerformanceStats(_stats?: Record<string, unknown>): void {}

  getPerformanceSummary(): PerformanceSummary {
    return {};
  }

  destroy(): void {}
}
