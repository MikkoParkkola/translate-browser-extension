/**
 * Shared background module barrel export.
 */

export type {
  PersistentCacheEntry,
  DetailedCacheStats,
  StorageAdapter,
  TranslationCache,
  TranslationCacheOptions,
} from './storage-ops';
export { createTranslationCache } from './storage-ops';

export {
  getStrategy,
  setStrategy,
  getProvider,
  setProvider,
  checkRateLimit,
  recordUsage,
  estimateTokens,
  getRateLimitState,
  formatUserError,
  CLOUD_PROVIDER_KEYS,
  CLOUD_PROVIDER_ENABLED_FIELDS,
  CLOUD_PROVIDER_OPTION_FIELDS,
  CLOUD_PROVIDER_STORAGE_KEYS,
  PROVIDER_LIST,
  handleSetProvider,
} from './provider-management';

export type { TranslateFn, TranslateMessagePayload } from './translation-core';
export { NETWORK_RETRY_CONFIG, handleTranslateCore } from './translation-core';

export {
  handleGetCacheStats,
  handleClearCache,
  handleGetUsage,
  handleGetCloudProviderStatus,
  handleSetCloudApiKey,
  handleClearCloudApiKey,
  handleSetCloudProviderEnabled,
  handleGetHistory,
  handleClearHistory,
  recordTranslationToHistory,
  handleAddCorrection,
  handleGetCorrection,
  handleGetAllCorrections,
  handleGetCorrectionStats,
  handleClearCorrections,
  handleDeleteCorrection,
  handleExportCorrections,
  handleImportCorrections,
  handleGetSettings,
  getActionSettings,
} from './message-handlers';
export type { ActionSettings } from './message-handlers';
