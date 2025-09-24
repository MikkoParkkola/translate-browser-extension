/**
 * TypeScript definitions for ConfigManager module
 */

export type ConfigObserverCallback = (data: any) => void;

export interface ConfigDefaults {
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
  strategy: 'smart' | 'fast' | 'quality';
  autoTranslate: boolean;
  autoTranslateLanguages: string[];
  skipLanguages: string[];
  batchSize: number;
  batchDelay: number;
  maxRetries: number;
  requestsPerMinute: number;
  tokensPerMinute: number;
  theme: 'light' | 'dark';
  showUsageStats: boolean;
  showPerformanceDashboard: boolean;
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableTelemetry: boolean;
  cacheEnabled: boolean;
  cacheTimeout: number;
  allowedOrigins: string[];
  requireAuth: boolean;
  enableLocalModels: boolean;
  enableAdvancedFiltering: boolean;
  enableSmartBatching: boolean;
  monthlyBudget: number;
  costAlertThreshold: number;
  trackCosts: boolean;
}

export interface ConfigSummary {
  loaded: boolean;
  keys: number;
  observers: number;
  defaults: number;
}

export interface ConfigExport {
  version: string;
  timestamp: string;
  config: Partial<ConfigDefaults>;
}

export declare class ConfigManager {
  constructor();

  readonly isLoaded: boolean;

  initialize(): Promise<void>;

  get<K extends keyof ConfigDefaults>(key: K, defaultValue?: ConfigDefaults[K]): ConfigDefaults[K];
  get(key: string, defaultValue?: any): any;

  set<K extends keyof ConfigDefaults>(key: K, value: ConfigDefaults[K], persist?: boolean): Promise<void>;
  set(key: string, value: any, persist?: boolean): Promise<void>;

  update(updates: Partial<ConfigDefaults>, persist?: boolean): Promise<void>;
  getAll(): ConfigDefaults & Record<string, any>;

  resetToDefaults(keys?: string | string[] | null): Promise<void>;
  getDefault<K extends keyof ConfigDefaults>(key: K): ConfigDefaults[K];
  getDefault(key: string): any;

  addObserver(eventType: 'config:loaded' | 'config:saved' | 'config:changed' | 'config:reset' | 'config:external_change' | 'config:imported', callback: ConfigObserverCallback): () => void;

  getSummary(): ConfigSummary;
  exportConfig(): ConfigExport;
  importConfig(importData: ConfigExport): Promise<void>;

  private loadConfig(): Promise<void>;
  private saveConfig(syncOnly?: boolean): Promise<void>;
  private validateAndFixConfig(): void;
  private validateConfigValue(key: string, value: any): void;
  private notifyObservers(eventType: string, data: any): void;
  private setupStorageListener(): void;
}