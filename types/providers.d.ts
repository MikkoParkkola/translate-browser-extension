export interface ProvidersRegistry {
  register(id: string, impl: any): void;
  get(id: string): any;
  choose(opts?: { endpoint?: string; provider?: string }): string;
  candidates(opts?: { endpoint?: string; provider?: string }): string[];
  init(def?: Record<string, any>): boolean;
  reset(): void;
  isInitialized(): boolean;
}

export interface ProvidersApi {
  registerProvider(id: string, impl: any): void;
  getProvider(id: string): any;
  listProviders(): { name: string; label: string }[];
  initProviders(): void;
  ensureProviders(): boolean;
  resetProviders(): void;
  isInitialized(): boolean;
  createRegistry(): ProvidersRegistry;
}

export declare const qwenProviders: ProvidersApi;
