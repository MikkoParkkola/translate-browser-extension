/**
 * TypeScript definitions for PerformanceTracker module
 */

export interface TimerContext {
  operation?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  textLength?: number;
  provider?: string;
  batch?: boolean;
  tokensNeeded?: number;
  retries?: number;
  [key: string]: any;
}

export interface TimerData {
  operation: string;
  startTime: number;
  context: TimerContext;
}

export interface CompletedTimer extends TimerData {
  duration: number;
  success: boolean;
  error?: string;
  additionalData?: Record<string, any>;
}

export interface TranslationMetrics {
  count: number;
  totalDuration: number;
  averageDuration: number;
  cacheHitRate: number;
  totalTextLength: number;
  averageTextLength: number;
}

export interface DOMScanMetrics {
  count: number;
  totalDuration: number;
  averageDuration: number;
  totalNodesProcessed: number;
  averageNodesProcessed: number;
  viewportScans: number;
}

export interface APICallMetrics {
  count: number;
  totalDuration: number;
  averageDuration: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  averageTokens: number;
}

export interface ErrorMetrics {
  count: number;
  byType: Record<string, number>;
  recentErrors: Array<{
    timestamp: number;
    type: string;
    message: string;
    context?: Record<string, any>;
  }>;
}

export interface PerformanceDashboardData {
  summary: {
    activeOperations: number;
    totalOperations: number;
    averageResponseTime: number;
    errorRate: number;
    uptime: number;
  };
  translations: TranslationMetrics;
  domScans: DOMScanMetrics;
  apiCalls: APICallMetrics;
  errors: ErrorMetrics;
  recentActivity: CompletedTimer[];
  insights: {
    performance: string[];
    efficiency: string[];
    reliability: string[];
    recommendations: string[];
  };
}

export declare class PerformanceTracker {
  constructor();

  startTimer(operation: string, context?: TimerContext): string;
  endTimer(timerId: string, additionalData?: Record<string, any>): number;

  trackTranslation(sourceText: string, targetText: string, duration: number, fromCache?: boolean): void;
  trackDOMScan(nodesProcessed: number, duration: number, viewport?: boolean): void;
  trackAPICall(endpoint: string, duration: number, success: boolean, tokenCount?: number): void;
  trackError(type: string, error: Error, context?: Record<string, any>): void;

  getDashboardData(): PerformanceDashboardData;
  clearMetrics(): void;
  exportMetrics(): Record<string, any>;

  private generateInsights(): PerformanceDashboardData['insights'];
  private addToCircularBuffer<T>(buffer: T[], item: T, maxSize: number): void;
  private saveMetricsToStorage(): Promise<void>;
  private loadMetricsFromStorage(): Promise<void>;
}

export declare function getTracker(): PerformanceTracker;
export declare function startTimer(operation: string, context?: TimerContext): string;
export declare function endTimer(timerId: string, additionalData?: Record<string, any>): number;
export declare function trackTranslation(sourceText: string, targetText: string, duration: number, fromCache?: boolean): void;
export declare function trackDOMScan(nodesProcessed: number, duration: number, viewport?: boolean): void;
export declare function trackAPICall(endpoint: string, duration: number, success: boolean, tokenCount?: number): void;
export declare function trackError(type: string, error: Error, context?: Record<string, any>): void;