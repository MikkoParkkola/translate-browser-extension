/**
 * TypeScript definitions for BackgroundService module
 */

export interface ServiceStatus {
  messageRouter: 'pending' | 'ready' | 'error';
  translationService: 'pending' | 'ready' | 'error';
  configManager: 'pending' | 'ready' | 'error';
  performanceTracker: 'pending' | 'ready' | 'error';
}

export interface ServiceHealthCheck {
  healthy: boolean;
  version: string;
  uptime: number;
  services: ServiceStatus;
  lastCheck: number;
}

export interface HandlerInfo {
  registeredHandlers: string[];
  middlewareCount: number;
}

export declare class BackgroundService {
  constructor();

  readonly version: string;
  readonly isInitialized: boolean;
  readonly startTime: number;
  readonly services: ServiceStatus;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  getHealthCheck(): ServiceHealthCheck;
  logServiceStatus(): void;

  private initializeConfigManager(): Promise<void>;
  private initializeTranslationService(): Promise<void>;
  private initializeMessageRouter(): Promise<void>;
  private initializePerformanceTracking(): Promise<void>;
  private registerMessageHandlers(): void;
  private setupExtensionListeners(): void;
  private setupContextMenu(): Promise<void>;
  private handleFirstInstall(): void;
  private handleUpdate(previousVersion: string): void;
  private handleTabUpdate(tabId: number, tab: chrome.tabs.Tab): Promise<void>;
  private handleContextMenuTranslation(selectionText: string, tab: chrome.tabs.Tab): Promise<void>;
  private handleSuspend(): void;
  private performMigration(previousVersion: string): void;
}