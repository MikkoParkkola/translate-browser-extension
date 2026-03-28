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

export type {
  CommonBackgroundMessage,
  CommonBackgroundResponse,
} from './common-background';
export {
  COMMON_BACKGROUND_MESSAGE_TYPES,
  createBackgroundMessageGuard,
  createCommonBackgroundMessageDispatcher,
  createPreloadModelHandler,
  createSafeCapabilityHandler,
  isCommonBackgroundMessage,
} from './common-background';

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

export type {
  TranslateFn,
  TranslateMessagePayload,
  TranslationExecutionContext,
  PreparedTranslationExecution,
  PrepareTranslationExecutionResult,
  PrepareTranslationExecutionHooks,
  PrepareTranslationExecutionOptions,
  FinalizeTranslationExecutionOptions,
} from './translation-core';
export {
  NETWORK_RETRY_CONFIG,
  prepareTranslationExecution,
  finalizeTranslationExecution,
  createTranslateErrorResponse,
  handleTranslateCore,
} from './translation-core';

export type {
  TranslationBackgroundLogger,
  TranslationProfiler,
  CreateTranslationBackgroundHandlerOptions,
  TranslationBackgroundHandler,
} from './translation-background-handler';
export { createTranslationBackgroundHandler } from './translation-background-handler';

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

export { createBackgroundMessageListener } from './background-message-listener';

export type {
  UIEventCommandId,
  UIEventHandlerDependencies,
  UIEventLogger,
} from './ui-event-handlers';
export {
  createContextMenuClickHandler,
  createKeyboardShortcutHandler,
  resolveContentCommand,
} from './ui-event-handlers';

export {
  clearDownloadedModelInventory,
  deleteDownloadedModelInventoryEntry,
  getDownloadedModelInventory,
  isOffscreenDownloadedModelUpdateMessage,
  isOffscreenModelMessage,
  isOffscreenModelProgressMessage,
  relayModelProgress,
  upsertDownloadedModelInventory,
} from './model-downloads';

export type {
  LifecycleLogger,
  InstallationHandlerDependencies,
  RestorePersistedProviderDependencies,
} from './lifecycle-orchestration';
export {
  clearMatchingCaches,
  clearMatchingIndexedDbDatabases,
  createInstallationHandler,
  restorePersistedProvider,
} from './lifecycle-orchestration';

export type {
  OffscreenRequest,
  OffscreenTransport,
  OffscreenTransportLogger,
  OffscreenTransportResponse,
  CreateOffscreenTransportOptions,
} from './offscreen-transport';
export { createOffscreenTransport } from './offscreen-transport';
