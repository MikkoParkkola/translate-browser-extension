/**
 * LocalModelManager update mechanism tests
 * Tests model versioning, updates, rollback, and migration functionality
 */

// Mock fetch API
global.fetch = jest.fn();

// Mock IndexedDB
global.indexedDB = {
  open: jest.fn(),
  deleteDatabase: jest.fn()
};

describe('LocalModelManager Update Mechanism', () => {
  let LocalModelManager;
  let modelManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Mock timers
    jest.useFakeTimers();

    LocalModelManager = require('../src/localModel.js');
    modelManager = new LocalModelManager();

    // Mock Date.now for consistent timestamps
    jest.spyOn(Date, 'now').mockReturnValue(1640995200000); // 2022-01-01T00:00:00.000Z
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Version Management', () => {
    test('should validate version format correctly', () => {
      expect(() => modelManager.validateVersionFormat('1.0.0')).not.toThrow();
      expect(() => modelManager.validateVersionFormat('2.10.15')).not.toThrow();

      expect(() => modelManager.validateVersionFormat('1.0')).toThrow('Invalid version format');
      expect(() => modelManager.validateVersionFormat('v1.0.0')).toThrow('Invalid version format');
      expect(() => modelManager.validateVersionFormat('1.0.0-beta')).toThrow('Invalid version format');
      expect(() => modelManager.validateVersionFormat('')).toThrow('Invalid version format');
    });

    test('should compare versions correctly', () => {
      expect(modelManager.compareVersions('1.0.0', '1.0.1')).toBe(-1);
      expect(modelManager.compareVersions('1.0.1', '1.0.0')).toBe(1);
      expect(modelManager.compareVersions('1.0.0', '1.0.0')).toBe(0);

      expect(modelManager.compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(modelManager.compareVersions('2.0.0', '1.0.0')).toBe(1);

      expect(modelManager.compareVersions('1.2.0', '1.10.0')).toBe(-1);
      expect(modelManager.compareVersions('1.10.0', '1.2.0')).toBe(1);
    });

    test('should get current model version', () => {
      modelManager.currentModelVersion = '1.1.0';
      expect(modelManager.getCurrentVersion()).toBe('1.1.0');
    });

    test('should get latest available version', () => {
      expect(modelManager.getLatestVersion()).toBe('2.0.0');
    });

    test('should check if update is available', () => {
      modelManager.currentModelVersion = '1.0.0';
      expect(modelManager.isUpdateAvailable()).toBe(true);

      modelManager.currentModelVersion = '2.0.0';
      expect(modelManager.isUpdateAvailable()).toBe(false);
    });
  });

  describe('Update Checking', () => {
    test('should check for model updates', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          latest_version: '2.1.0',
          versions: {
            '2.1.0': {
              size: 4.9 * 1024 * 1024 * 1024,
              download_url: 'https://example.com/model-v2.1.0.gguf',
              checksums: {
                sha256: 'newchecksum'
              }
            }
          }
        })
      };

      global.fetch.mockResolvedValue(mockResponse);

      modelManager.currentModelVersion = '2.0.0';
      const updateInfo = await modelManager.checkForModelUpdates();

      expect(updateInfo.hasUpdate).toBe(true);
      expect(updateInfo.latestVersion).toBe('2.1.0');
      expect(updateInfo.currentVersion).toBe('2.0.0');
      expect(global.fetch).toHaveBeenCalledWith(
        modelManager.modelRegistry['hunyuan-mt-7b'].updateApiUrl
      );
    });

    test('should handle no updates available', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          latest_version: '2.0.0'
        })
      };

      global.fetch.mockResolvedValue(mockResponse);

      modelManager.currentModelVersion = '2.0.0';
      const updateInfo = await modelManager.checkForModelUpdates();

      expect(updateInfo.hasUpdate).toBe(false);
      expect(updateInfo.latestVersion).toBe('2.0.0');
    });

    test('should handle update check failures', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(modelManager.checkForModelUpdates()).rejects.toThrow('Failed to check for updates: Network error');
    });

    test('should handle invalid update API response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      };

      global.fetch.mockResolvedValue(mockResponse);

      await expect(modelManager.checkForModelUpdates()).rejects.toThrow('Update check failed: 404 Not Found');
    });

    test('should schedule periodic update checks', () => {
      modelManager.checkForModelUpdates = jest.fn().mockResolvedValue({ hasUpdate: false });

      modelManager.scheduleUpdateChecks();

      expect(modelManager.updateCheckTimer).toBeDefined();

      // Fast forward 24 hours
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);

      expect(modelManager.checkForModelUpdates).toHaveBeenCalled();
    });

    test('should not schedule if already scheduled', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      modelManager.scheduleUpdateChecks();
      const firstTimer = modelManager.updateCheckTimer;

      modelManager.scheduleUpdateChecks();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimer);
    });
  });

  describe('Model Updates', () => {
    test('should update model to newer version', async () => {
      modelManager.currentModelVersion = '1.0.0';

      // Mock dependencies
      modelManager.createModelBackup = jest.fn().mockResolvedValue('backup-id');
      modelManager.downloadModel = jest.fn().mockResolvedValue();
      modelManager.validateModelIntegrity = jest.fn().mockResolvedValue({ isValid: true });
      modelManager.applyMigration = jest.fn().mockResolvedValue();

      const progressCallback = jest.fn();

      await modelManager.updateModelToVersion('1.1.0', progressCallback);

      expect(modelManager.createModelBackup).toHaveBeenCalledWith('1.0.0');
      expect(modelManager.downloadModel).toHaveBeenCalled();
      expect(modelManager.validateModelIntegrity).toHaveBeenCalled();
      expect(modelManager.currentModelVersion).toBe('1.1.0');
      expect(progressCallback).toHaveBeenCalledWith({
        step: 'completed',
        progress: 100,
        message: 'Model updated successfully to version 1.1.0'
      });
    });

    test('should handle breaking changes with migration', async () => {
      modelManager.currentModelVersion = '1.1.0';

      modelManager.createModelBackup = jest.fn().mockResolvedValue('backup-id');
      modelManager.downloadModel = jest.fn().mockResolvedValue();
      modelManager.validateModelIntegrity = jest.fn().mockResolvedValue({ isValid: true });
      modelManager.applyMigration = jest.fn().mockResolvedValue();

      await modelManager.updateModelToVersion('2.0.0');

      expect(modelManager.applyMigration).toHaveBeenCalledWith('1.1.0', '2.0.0');
    });

    test('should rollback on update failure', async () => {
      modelManager.currentModelVersion = '1.0.0';

      modelManager.createModelBackup = jest.fn().mockResolvedValue('backup-id');
      modelManager.downloadModel = jest.fn().mockRejectedValue(new Error('Download failed'));
      modelManager.rollbackFromBackup = jest.fn().mockResolvedValue();

      await expect(modelManager.updateModelToVersion('1.1.0')).rejects.toThrow('Model update failed: Download failed');

      expect(modelManager.rollbackFromBackup).toHaveBeenCalledWith('1.0.0');
    });

    test('should validate target version exists', async () => {
      await expect(modelManager.updateModelToVersion('99.0.0')).rejects.toThrow('Target version not found in registry: 99.0.0');
    });

    test('should prevent downgrade without explicit flag', async () => {
      modelManager.currentModelVersion = '2.0.0';

      await expect(modelManager.updateModelToVersion('1.0.0')).rejects.toThrow('Cannot downgrade from 2.0.0 to 1.0.0');
    });

    test('should allow forced downgrade', async () => {
      modelManager.currentModelVersion = '2.0.0';

      modelManager.createModelBackup = jest.fn().mockResolvedValue('backup-id');
      modelManager.downloadModel = jest.fn().mockResolvedValue();
      modelManager.validateModelIntegrity = jest.fn().mockResolvedValue({ isValid: true });
      modelManager.applyMigration = jest.fn().mockResolvedValue();

      await modelManager.updateModelToVersion('1.0.0', null, { allowDowngrade: true });

      expect(modelManager.currentModelVersion).toBe('1.0.0');
    });

    test('should handle validation failure during update', async () => {
      modelManager.currentModelVersion = '1.0.0';

      modelManager.createModelBackup = jest.fn().mockResolvedValue('backup-id');
      modelManager.downloadModel = jest.fn().mockResolvedValue();
      modelManager.validateModelIntegrity = jest.fn().mockResolvedValue({
        isValid: false,
        error: 'Checksum mismatch'
      });
      modelManager.rollbackFromBackup = jest.fn().mockResolvedValue();

      await expect(modelManager.updateModelToVersion('1.1.0')).rejects.toThrow('Model validation failed: Checksum mismatch');

      expect(modelManager.rollbackFromBackup).toHaveBeenCalled();
    });
  });

  describe('Model Backup and Rollback', () => {
    test('should create model backup', async () => {
      const mockModelData = new ArrayBuffer(1024);
      modelManager.modelData = mockModelData;

      // Mock IndexedDB operations
      const mockTransaction = {
        objectStore: jest.fn().mockReturnValue({
          put: jest.fn().mockReturnValue({ onsuccess: null, onerror: null })
        })
      };

      const mockDB = {
        transaction: jest.fn().mockReturnValue(mockTransaction),
        close: jest.fn()
      };

      global.indexedDB.open = jest.fn().mockReturnValue({
        onsuccess: null,
        result: mockDB
      });

      const backupId = await modelManager.createModelBackup('1.0.0');

      expect(backupId).toBe('backup_1.0.0_1640995200000');
      expect(mockDB.transaction).toHaveBeenCalledWith(['model_backups'], 'readwrite');
    });

    test('should rollback from backup', async () => {
      // Mock IndexedDB operations for reading backup
      const mockBackupData = new ArrayBuffer(1024);
      const mockTransaction = {
        objectStore: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({
            onsuccess: null,
            result: {
              version: '1.0.0',
              data: mockBackupData,
              timestamp: Date.now()
            }
          }),
          put: jest.fn().mockReturnValue({ onsuccess: null, onerror: null })
        })
      };

      const mockDB = {
        transaction: jest.fn().mockReturnValue(mockTransaction),
        close: jest.fn()
      };

      global.indexedDB.open = jest.fn().mockReturnValue({
        onsuccess: null,
        result: mockDB
      });

      await modelManager.rollbackFromBackup('1.0.0');

      expect(modelManager.currentModelVersion).toBe('1.0.0');
      expect(modelManager.modelData).toBe(mockBackupData);
    });

    test('should handle missing backup during rollback', async () => {
      const mockTransaction = {
        objectStore: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({
            onsuccess: null,
            result: undefined // No backup found
          })
        })
      };

      const mockDB = {
        transaction: jest.fn().mockReturnValue(mockTransaction),
        close: jest.fn()
      };

      global.indexedDB.open = jest.fn().mockReturnValue({
        onsuccess: null,
        result: mockDB
      });

      await expect(modelManager.rollbackFromBackup('1.0.0')).rejects.toThrow('Backup not found for version: 1.0.0');
    });
  });

  describe('Migration Handling', () => {
    test('should apply seamless migration', async () => {
      const result = await modelManager.applyMigration('1.0.0', '1.1.0');

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('seamless');
      expect(result.message).toContain('Seamless migration completed');
    });

    test('should apply migration-required strategy', async () => {
      // Mock migration functions
      modelManager.migrateConfigurationFormat = jest.fn().mockResolvedValue();
      modelManager.updateStorageSchema = jest.fn().mockResolvedValue();

      const result = await modelManager.applyMigration('1.1.0', '2.0.0');

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('migration_required');
      expect(modelManager.migrateConfigurationFormat).toHaveBeenCalled();
      expect(modelManager.updateStorageSchema).toHaveBeenCalled();
    });

    test('should handle missing migration strategy', async () => {
      await expect(modelManager.applyMigration('1.0.0', '99.0.0')).rejects.toThrow('No migration strategy found for 1.0.0 -> 99.0.0');
    });

    test('should handle migration failures', async () => {
      modelManager.migrateConfigurationFormat = jest.fn().mockRejectedValue(new Error('Config migration failed'));

      await expect(modelManager.applyMigration('1.1.0', '2.0.0')).rejects.toThrow('Migration failed: Config migration failed');
    });
  });

  describe('Version Registry Management', () => {
    test('should get model registry', () => {
      const registry = modelManager.getModelRegistry('hunyuan-mt-7b');

      expect(registry).toBeDefined();
      expect(registry.versions).toHaveProperty('1.0.0');
      expect(registry.versions).toHaveProperty('2.0.0');
      expect(registry.latest).toBe('2.0.0');
    });

    test('should throw error for unknown model', () => {
      expect(() => modelManager.getModelRegistry('unknown-model')).toThrow('Model not found in registry: unknown-model');
    });

    test('should get available versions', () => {
      const versions = modelManager.getAvailableVersions();

      expect(versions).toEqual(['1.0.0', '1.1.0', '2.0.0']);
    });

    test('should get version changelog', () => {
      const changelog = modelManager.getVersionChangelog('2.0.0');

      expect(changelog.version).toBe('2.0.0');
      expect(changelog.features).toContain('Major architecture update');
      expect(changelog.breaking).toBe(true);
    });

    test('should throw error for unknown version', () => {
      expect(() => modelManager.getVersionChangelog('99.0.0')).toThrow('Version not found in registry: 99.0.0');
    });
  });

  describe('Update Configuration', () => {
    test('should check version compatibility', async () => {
      const modelStatus = {
        version: '1.0.0',
        downloaded: true
      };

      await modelManager.checkModelVersionCompatibility(modelStatus);

      expect(modelManager.currentModelVersion).toBe('1.0.0');
    });

    test('should handle deprecated version', async () => {
      // Mark version as deprecated
      modelManager.modelRegistry['hunyuan-mt-7b'].versions['1.0.0'].deprecated = true;

      const modelStatus = {
        version: '1.0.0',
        downloaded: true
      };

      await modelManager.checkModelVersionCompatibility(modelStatus);

      expect(console.warn).toHaveBeenCalledWith('[LocalModel] Current model version 1.0.0 is deprecated');
    });

    test('should handle unknown version in storage', async () => {
      const modelStatus = {
        version: '0.5.0', // Not in registry
        downloaded: true
      };

      await modelManager.checkModelVersionCompatibility(modelStatus);

      expect(console.warn).toHaveBeenCalledWith('[LocalModel] Unknown model version in storage: 0.5.0');
      expect(modelManager.currentModelVersion).toBe('0.5.0'); // Still set for compatibility
    });
  });

  describe('Public API Methods', () => {
    test('should expose update API methods', () => {
      expect(typeof modelManager.checkForModelUpdates).toBe('function');
      expect(typeof modelManager.updateModel).toBe('function');
      expect(typeof modelManager.getAvailableVersions).toBe('function');
      expect(typeof modelManager.rollbackModel).toBe('function');
      expect(typeof modelManager.getVersionChangelog).toBe('function');
    });

    test('should update to latest version', async () => {
      modelManager.updateModelToVersion = jest.fn().mockResolvedValue();

      await modelManager.updateModel();

      expect(modelManager.updateModelToVersion).toHaveBeenCalledWith('2.0.0', undefined);
    });

    test('should update to specific version', async () => {
      modelManager.updateModelToVersion = jest.fn().mockResolvedValue();

      await modelManager.updateModel('1.1.0');

      expect(modelManager.updateModelToVersion).toHaveBeenCalledWith('1.1.0', undefined);
    });

    test('should rollback model', async () => {
      modelManager.rollbackFromBackup = jest.fn().mockResolvedValue();

      await modelManager.rollbackModel('1.0.0');

      expect(modelManager.rollbackFromBackup).toHaveBeenCalledWith('1.0.0');
    });
  });
});