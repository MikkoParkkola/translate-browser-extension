// ModelUpdater stub for LocalModelManager

export interface ModelUpdaterConfig {
  checkInterval?: number;
  autoUpdate?: boolean;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  version?: string;
  url?: string;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  version?: string;
  releaseNotes?: string;
}

export class ModelUpdater {
  constructor(_config?: ModelUpdaterConfig) {}

  checkForUpdates(): Promise<UpdateCheckResult> {
    return Promise.resolve({ hasUpdate: false });
  }

  scheduleUpdateCheck(_intervalMs?: number): void {}

  getUpdateInfo(): UpdateInfo {
    return { hasUpdate: false };
  }

  destroy(): void {}
}
