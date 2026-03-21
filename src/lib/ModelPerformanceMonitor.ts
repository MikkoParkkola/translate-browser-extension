// ModelPerformanceMonitor stub for LocalModelManager

export interface PerformanceMonitorConfig {
  enabled?: boolean;
  sampleInterval?: number;
  maxSamples?: number;
  enableMemoryMonitoring?: boolean;
  enableInferenceTracking?: boolean;
  enableAdaptiveOptimization?: boolean;
  memoryThreshold?: number;
}

export interface PerformanceSummary {
  [key: string]: unknown;
}

export class ModelPerformanceMonitor {
  constructor(_config?: PerformanceMonitorConfig) {}

  startPerformanceMonitoring(): void {}

  updatePerformanceStats(_inferenceTime?: number, _success?: boolean, _textLength?: number): void {}

  getPerformanceSummary(): PerformanceSummary {
    return {};
  }

  destroy(): void {}
}
