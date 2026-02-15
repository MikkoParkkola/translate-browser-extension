// ModelUpdater stub for LocalModelManager
export class ModelUpdater {
  constructor() {
    this.checkForUpdates = function() {
      return Promise.resolve({ hasUpdate: false });
    };
    this.scheduleUpdateCheck = function() {};
    this.getUpdateInfo = function() {
      return { hasUpdate: false };
    };
    this.destroy = function() {};
  }
}
