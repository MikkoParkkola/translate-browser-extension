export interface TranslateOptions {
  endpoint: string;
  apiKey?: string;
  model?: string;
  text: string;
  source: string;
  target: string;
  signal?: AbortSignal;
  debug?: boolean;
  stream?: boolean;
  noProxy?: boolean;
  provider?: string;
  detector?: string;
  force?: boolean;
  skipTM?: boolean;
  providerOrder?: string[];
  endpoints?: Record<string, string>;
  failover?: boolean;
}
export interface BatchOptions {
  texts: string[];
  source?: string;
  target: string;
  detector?: string;
  debug?: boolean;
  noProxy?: boolean;
  tokenBudget?: number;
  maxBatchSize?: number;
  retries?: number;
  onProgress?: (s: {
    phase: string;
    request: number;
    requests: number;
    sample: string;
    elapsedMs: number;
    etaMs: number;
  }) => void;
  providerOrder?: string[];
  endpoints?: Record<string, string>;
  failover?: boolean;
  parallel?: boolean | 'auto';
}
export declare function qwenTranslate(opts: TranslateOptions): Promise<{ text: string }>
export declare function qwenTranslateStream(opts: TranslateOptions, onData: (chunk: string) => void): Promise<{ text: string }>
export declare function qwenTranslateBatch(opts: BatchOptions): Promise<{ texts: string[] }>
export declare function qwenClearCache(): void;
export declare const qwenFetchStrategy: {
  choose(opts?: { noProxy?: boolean }): 'proxy' | 'direct';
  setChooser(fn?: (opts?: any) => 'proxy' | 'direct'): void;
};

export * from './background';
export * from './contentScript';
export * from './providers';
export * from './messaging';
export * from './popup';
export * from './tm';

// Modular architecture types
export * from './background/backgroundService';
export * from './background/configManager';
export * from './background/messageRouter';
export * from './background/translationService';
export * from './content/contentObserver';
export * from './content/languageDetector';
export * from './content/translationService';
export * from './lib/performanceTracker';
