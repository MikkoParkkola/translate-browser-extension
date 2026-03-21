// ModelUpdater stub for LocalModelManager

export interface ModelUpdaterConfig {
  checkInterval?: number;
  autoUpdate?: boolean;
  currentModelVersion?: string;
  autoUpdateEnabled?: boolean;
  updateCheckInterval?: number;
  updateNotifications?: boolean;
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
  constructor(_registry?: unknown, _config?: ModelUpdaterConfig) {}

  checkForUpdates(): Promise<UpdateCheckResult> {
    return Promise.resolve({ hasUpdate: false });
  }

  scheduleUpdateCheck(_intervalMs?: number): void {}

  getUpdateInfo(): UpdateInfo {
    return { hasUpdate: false };
  }

  updateModelToVersion(
    _version: string | null,
    _progressCallback?: ((info: unknown) => void) | null,
    _downloadFn?: ((...args: unknown[]) => unknown) | null,
  ): Promise<unknown> {
    return Promise.resolve();
  }

  destroy(): void {}
}
