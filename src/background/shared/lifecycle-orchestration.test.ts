import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearMatchingCaches,
  clearMatchingIndexedDbDatabases,
  createInstallationHandler,
  restorePersistedProvider,
} from './lifecycle-orchestration';

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('lifecycle-orchestration', () => {
  const originalCaches = globalThis.caches;
  const originalIndexedDb = globalThis.indexedDB;

  afterEach(() => {
    if (originalCaches === undefined) {
      delete (globalThis as Record<string, unknown>).caches;
    } else {
      globalThis.caches = originalCaches;
    }

    if (originalIndexedDb === undefined) {
      delete (globalThis as Record<string, unknown>).indexedDB;
    } else {
      globalThis.indexedDB = originalIndexedDb;
    }
  });

  describe('clearMatchingCaches', () => {
    it('returns null when CacheStorage is unavailable', async () => {
      delete (globalThis as Record<string, unknown>).caches;

      await expect(clearMatchingCaches(['transformers'])).resolves.toBeNull();
    });

    it('clears only matching cache names', async () => {
      const deleteCache = vi.fn().mockResolvedValue(true);
      globalThis.caches = {
        keys: vi.fn().mockResolvedValue(['transformers-v1', 'app-cache', 'onnx-models']),
        delete: deleteCache,
      } as unknown as CacheStorage;

      const cleared = await clearMatchingCaches(['transformers', 'onnx']);

      expect(cleared).toEqual(['transformers-v1', 'onnx-models']);
      expect(deleteCache).toHaveBeenCalledTimes(2);
      expect(deleteCache).toHaveBeenCalledWith('transformers-v1');
      expect(deleteCache).toHaveBeenCalledWith('onnx-models');
    });
  });

  describe('clearMatchingIndexedDbDatabases', () => {
    it('returns null when database listing is unavailable', async () => {
      globalThis.indexedDB = {} as IDBFactory;

      await expect(clearMatchingIndexedDbDatabases(['transformers'])).resolves.toBeNull();
    });

    it('deletes only matching database names', async () => {
      const deleteDatabase = vi.fn();
      globalThis.indexedDB = {
        databases: vi.fn().mockResolvedValue([
          { name: 'transformers-cache' },
          { name: 'other-db' },
          { name: 'huggingface-store' },
        ]),
        deleteDatabase,
      } as unknown as IDBFactory;

      const cleared = await clearMatchingIndexedDbDatabases(['transformers', 'huggingface']);

      expect(cleared).toEqual(['transformers-cache', 'huggingface-store']);
      expect(deleteDatabase).toHaveBeenCalledTimes(2);
      expect(deleteDatabase).toHaveBeenCalledWith('transformers-cache');
      expect(deleteDatabase).toHaveBeenCalledWith('huggingface-store');
    });
  });

  describe('createInstallationHandler', () => {
    it('runs full install flow including onboarding and defaults', async () => {
      const log = createLogger();
      const setupContextMenus = vi.fn();
      const getOnboardingComplete = vi.fn().mockResolvedValue(false);
      const openOnboardingPage = vi.fn();
      const persistInstallDefaults = vi.fn().mockResolvedValue(undefined);

      const handler = createInstallationHandler({
        log,
        setupContextMenus,
        getOnboardingComplete,
        openOnboardingPage,
        getUiLanguage: () => 'fi-FI',
        persistInstallDefaults,
      });

      await handler({ reason: 'install' });

      expect(setupContextMenus).toHaveBeenCalledTimes(1);
      expect(getOnboardingComplete).toHaveBeenCalledTimes(1);
      expect(openOnboardingPage).toHaveBeenCalledTimes(1);
      expect(persistInstallDefaults).toHaveBeenCalledWith('fi');
      expect(log.info).toHaveBeenCalledWith('Extension installed');
      expect(log.info).toHaveBeenCalledWith('Opening onboarding page');
      expect(log.info).toHaveBeenCalledWith('Browser language detected:', 'fi');
    });

    it('runs update callback only for updates', async () => {
      const log = createLogger();
      const onUpdate = vi.fn().mockResolvedValue(undefined);

      const handler = createInstallationHandler({
        log,
        getUiLanguage: () => 'en-US',
        persistInstallDefaults: vi.fn().mockResolvedValue(undefined),
        onUpdate,
      });

      await handler({ reason: 'update', previousVersion: '1.2.3' });

      expect(onUpdate).toHaveBeenCalledWith({ previousVersion: '1.2.3' });
      expect(log.info).toHaveBeenCalledWith('Extension updated from', '1.2.3');
    });

    it('logs install default persistence failures without throwing', async () => {
      const log = createLogger();
      const error = new Error('boom');

      const handler = createInstallationHandler({
        log,
        getUiLanguage: () => '',
        persistInstallDefaults: vi.fn().mockRejectedValue(error),
      });

      await expect(handler({ reason: 'install' })).resolves.toBeUndefined();
      expect(log.error).toHaveBeenCalledWith('Failed to persist install defaults:', error);
    });
  });

  describe('restorePersistedProvider', () => {
    it('restores a normalized stored provider and logs migration', async () => {
      const log = createLogger();
      const setProvider = vi.fn();
      const getProvider = vi.fn().mockReturnValue('opus-mt');

      await restorePersistedProvider({
        log,
        defaultProvider: 'opus-mt',
        readStoredProvider: async () => 'opus-mt-local',
        setProvider,
        getProvider,
      });

      expect(setProvider).toHaveBeenCalledWith('opus-mt');
      expect(log.info).toHaveBeenCalledWith('Migrated legacy stored provider alias to opus-mt');
      expect(log.info).toHaveBeenCalledWith('Restored provider:', 'opus-mt');
    });

    it('warns on invalid stored providers and falls back via normalization', async () => {
      const log = createLogger();
      const setProvider = vi.fn();
      const getProvider = vi.fn().mockReturnValue('opus-mt');

      await restorePersistedProvider({
        log,
        defaultProvider: 'opus-mt',
        readStoredProvider: async () => 'totally-invalid-provider',
        setProvider,
        getProvider,
      });

      expect(setProvider).toHaveBeenCalledWith('opus-mt');
      expect(log.warn).toHaveBeenCalledWith('Ignoring invalid stored provider:', 'totally-invalid-provider');
    });

    it('logs the default provider when no stored value exists', async () => {
      const log = createLogger();

      await restorePersistedProvider({
        log,
        defaultProvider: 'opus-mt',
        readStoredProvider: async () => undefined,
        setProvider: vi.fn(),
        getProvider: vi.fn().mockReturnValue('opus-mt'),
      });

      expect(log.info).toHaveBeenCalledWith('No stored provider found, using default opus-mt');
    });
  });
});
