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
}
export declare function qwenTranslate(opts: TranslateOptions): Promise<{ text: string }>
export declare function qwenTranslateStream(opts: TranslateOptions, onData: (chunk: string) => void): Promise<{ text: string }>
export declare function qwenTranslateBatch(opts: BatchOptions): Promise<{ texts: string[] }>
export declare function qwenClearCache(): void;
export declare const qwenProviders: {
  registerProvider(id: string, impl: any): void;
  getProvider(id: string): any;
  listProviders(): { name: string; label: string }[];
  initProviders(): void;
  isInitialized(): boolean;
};
export declare const qwenFetchStrategy: {
  choose(opts?: { noProxy?: boolean }): 'proxy' | 'direct';
  setChooser(fn?: (opts?: any) => 'proxy' | 'direct'): void;
};
