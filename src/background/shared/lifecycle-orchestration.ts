import type { TranslationProviderId } from '../../types';
import { normalizeTranslationProviderId } from '../../shared/provider-options';

export interface LifecycleLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

type IndexedDbWithDatabases = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string }>>;
};

export interface InstallationHandlerDependencies {
  log: LifecycleLogger;
  getUiLanguage: () => string;
  persistInstallDefaults: (browserLang: string) => Promise<void>;
  setupContextMenus?: () => void;
  getOnboardingComplete?: () => Promise<boolean>;
  openOnboardingPage?: () => void;
  onUpdate?: (details: { previousVersion?: string }) => Promise<void>;
}

export interface RestorePersistedProviderDependencies {
  log: LifecycleLogger;
  defaultProvider: TranslationProviderId;
  readStoredProvider: () => Promise<unknown>;
  setProvider: (provider: TranslationProviderId) => void;
  getProvider: () => TranslationProviderId;
}

function getCacheStorage(): CacheStorage | null {
  return typeof globalThis.caches === 'undefined' ? null : globalThis.caches;
}

function getIndexedDbFactory(): IndexedDbWithDatabases | null {
  return typeof globalThis.indexedDB === 'undefined'
    ? null
    : globalThis.indexedDB as IndexedDbWithDatabases;
}

export async function clearMatchingCaches(patterns: readonly string[]): Promise<string[] | null> {
  const cacheStorage = getCacheStorage();
  if (!cacheStorage) {
    return null;
  }

  const cacheNames = await cacheStorage.keys();
  const cleared: string[] = [];
  for (const name of cacheNames) {
    if (patterns.some((pattern) => name.includes(pattern))) {
      await cacheStorage.delete(name);
      cleared.push(name);
    }
  }
  return cleared;
}

export async function clearMatchingIndexedDbDatabases(
  patterns: readonly string[]
): Promise<string[] | null> {
  const indexedDbFactory = getIndexedDbFactory();
  if (!indexedDbFactory || typeof indexedDbFactory.databases !== 'function') {
    return null;
  }

  const databases = await indexedDbFactory.databases();
  const cleared: string[] = [];
  for (const db of databases) {
    const name = db.name;
    if (name && patterns.some((pattern) => name.includes(pattern))) {
      indexedDbFactory.deleteDatabase(name);
      cleared.push(name);
    }
  }
  return cleared;
}

export function createInstallationHandler({
  log,
  getUiLanguage,
  persistInstallDefaults,
  setupContextMenus,
  getOnboardingComplete,
  openOnboardingPage,
  onUpdate,
}: InstallationHandlerDependencies) {
  return async (details: { reason: string; previousVersion?: string }): Promise<void> => {
    setupContextMenus?.();

    if (details.reason === 'install') {
      log.info('Extension installed');

      if (getOnboardingComplete && openOnboardingPage) {
        const onboardingComplete = await getOnboardingComplete();
        if (!onboardingComplete) {
          log.info('Opening onboarding page');
          openOnboardingPage();
        }
      }

      const browserLang = getUiLanguage().split('-')[0];
      log.info('Browser language detected:', browserLang);
      try {
        await persistInstallDefaults(browserLang);
      } catch (error) {
        log.error('Failed to persist install defaults:', error);
      }
      return;
    }

    if (details.reason === 'update') {
      log.info('Extension updated from', details.previousVersion);
      await onUpdate?.({ previousVersion: details.previousVersion });
    }
  };
}

export async function restorePersistedProvider({
  log,
  defaultProvider,
  readStoredProvider,
  setProvider,
  getProvider,
}: RestorePersistedProviderDependencies): Promise<void> {
  const storedProvider = await readStoredProvider();
  if (storedProvider !== undefined) {
    const restoredProvider = normalizeTranslationProviderId(storedProvider);
    if (storedProvider === 'opus-mt-local') {
      log.info('Migrated legacy stored provider alias to opus-mt');
    } else if (restoredProvider !== storedProvider) {
      log.warn('Ignoring invalid stored provider:', storedProvider);
    }
    setProvider(restoredProvider);
    log.info('Restored provider:', getProvider());
    return;
  }

  log.info(`No stored provider found, using default ${defaultProvider}`);
}
