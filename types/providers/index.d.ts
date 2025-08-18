export interface Provider {
  translate(opts: any): Promise<{ text: string }>;
  listModels?(opts?: any): Promise<string[]>;
  throttle?: { requestLimit: number; windowMs: number; tokenLimit?: number };
}

export interface ProvidersRegistry {
  register(id: string, impl: Provider): void;
  get(id: string): Provider | undefined;
  choose(opts?: { endpoint?: string; provider?: string }): string;
  candidates(opts?: { endpoint?: string; provider?: string }): string[];
  init(def?: Record<string, Provider>): boolean;
  reset(): void;
  isInitialized(): boolean;
}

export interface ProvidersApi {
  registerProvider(id: string, impl: Provider): void;
  getProvider(id: string): Provider | undefined;
  listProviders(): { name: string; label: string }[];
  initProviders(): void;
  ensureProviders(): boolean;
  resetProviders(): void;
  isInitialized(): boolean;
  createRegistry(): ProvidersRegistry;
}

export declare const qwenProviders: ProvidersApi;
