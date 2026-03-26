/**
 * Shared Message Handlers
 *
 * Common message handler implementations that both Chrome and Firefox
 * background scripts delegate to. These handlers are platform-agnostic
 * — they depend only on the shared TranslationCache and ProviderState.
 */

import type {
  CloudProviderId,
  CloudProviderUsageSummary,
  TranslationProviderId, Strategy, DetailedCacheStats,
  SetCloudApiKeyMessage, ClearCloudApiKeyMessage,
  SetCloudProviderEnabledMessage,
  AddCorrectionMessage, GetCorrectionMessage, DeleteCorrectionMessage, ImportCorrectionsMessage,
  ExtensionMessageResponseByType,
  MessageResponse,
} from '../../types';
import {
  safeStorageGet,
  strictStorageGet,
  strictStorageRemove,
  strictStorageSet,
} from '../../core/storage';
import { createLogger } from '../../core/logger';
import {
  addCorrection,
  getCorrection,
  getAllCorrections,
  clearCorrections,
  deleteCorrection,
  getCorrectionStats,
  exportCorrections,
  importCorrections,
  type Correction,
  type CorrectionStats,
} from '../../core/corrections';
import { addToHistory, getHistory, clearHistory as clearTranslationHistory, type HistoryEntry } from '../../core/history';
import type { TranslationCache } from './storage-ops';
import {
  getProvider,
  getRateLimitState,
  CLOUD_PROVIDER_ENABLED_FIELDS,
  CLOUD_PROVIDER_KEYS,
  CLOUD_PROVIDER_OPTION_FIELDS,
  CLOUD_PROVIDER_STORAGE_KEYS,
} from './provider-management';
import {
  withMessageResponse,
  withMessageResponseFallback,
} from './handler-response';
import type {
  CloudProviderStatusStorageRecord,
  CloudProviderStorageMutation,
  UserSettingsStorageRecord,
} from './provider-config-types';
import {
  buildValidatedCloudProviderMutation,
  normalizeUserSettings,
} from './config-validation';
import {
  buildCloudProviderConfiguredStatusRecord,
  createEmptyCloudProviderConfiguredStatus,
} from '../../shared/cloud-provider-config-state';

const log = createLogger('SharedHandlers');

function getCloudProviderValue<T>(
  provider: CloudProviderId,
  values: Readonly<Record<CloudProviderId, T>>
): T | undefined {
  return (values as Record<string, T | undefined>)[provider];
}

function resolveCloudProviderValueWithFallback<TPrimary, TFallback>(
  provider: CloudProviderId,
  primaryValues: Readonly<Record<CloudProviderId, TPrimary>>,
  fallbackValues?: Readonly<Record<CloudProviderId, TFallback>>
): TPrimary | TFallback | undefined {
  const primaryValue = getCloudProviderValue(provider, primaryValues);
  if (primaryValue !== undefined) {
    return primaryValue;
  }

  return fallbackValues
    ? getCloudProviderValue(provider, fallbackValues)
    : undefined;
}

function createUnknownCloudProviderResponse<T extends Record<string, unknown>>(
  provider: string
): MessageResponse<T> {
  return { success: false, error: `Unknown provider: ${provider}` };
}

async function handleCloudProviderMutation<TResolved, TSuccess extends Record<string, unknown>>(
  provider: CloudProviderId,
  resolve: (provider: CloudProviderId) => TResolved | undefined,
  run: (resolved: TResolved) => Promise<TSuccess>,
  errorLogMessage: string
): Promise<MessageResponse<TSuccess>> {
  const resolved = resolve(provider);
  if (resolved === undefined) {
    return createUnknownCloudProviderResponse<TSuccess>(provider);
  }

  return withMessageResponse(
    () => run(resolved),
    (error) => log.error(errorLogMessage, error)
  );
}

function resolveCloudProviderStorageKeys(provider: CloudProviderId): readonly string[] | undefined {
  const resolved = resolveCloudProviderValueWithFallback(
    provider,
    CLOUD_PROVIDER_STORAGE_KEYS,
    CLOUD_PROVIDER_KEYS
  );
  if (!resolved) {
    return undefined;
  }

  return typeof resolved === 'string' ? [resolved] : resolved;
}

function resolveCloudProviderEnabledField(provider: CloudProviderId): string | undefined {
  return resolveCloudProviderValueWithFallback(
    provider,
    CLOUD_PROVIDER_ENABLED_FIELDS
  );
}

function logCorrectionError(operation: string, error: unknown): void {
  log.warn(`Failed to ${operation}:`, error);
}

// ============================================================================
// Cache Handlers
// ============================================================================

export async function handleGetCacheStats(cache: TranslationCache): Promise<{ success: boolean; cache: DetailedCacheStats }> {
  await cache.load();
  return {
    success: true,
    cache: cache.getStats(),
  };
}

export async function handleClearCache(cache: TranslationCache): Promise<{ success: boolean; clearedEntries: number }> {
  const previousSize = cache.size;
  await cache.clear();
  return {
    success: true,
    clearedEntries: previousSize,
  };
}

// ============================================================================
// Usage / Providers
// ============================================================================

export function handleGetUsage(
  cache: TranslationCache,
): ExtensionMessageResponseByType<'getUsage'> {
  const rl = getRateLimitState();
  const providers: CloudProviderUsageSummary = {};
  return {
    throttle: {
      requests: rl.requests,
      tokens: rl.tokens,
      requestLimit: CONFIG_RL.requestsPerMinute,
      tokenLimit: CONFIG_RL.tokensPerMinute,
    },
    cache: cache.getStats(),
    // Aggregate cloud/offscreen usage is intentionally not folded into this
    // background-local snapshot; fetch provider usage separately.
    providers,
  };
}

// Import CONFIG for rate limit constants
import { CONFIG } from '../../config';
const CONFIG_RL = CONFIG.rateLimits;

// ============================================================================
// Cloud Provider Handlers
// ============================================================================

export async function handleGetCloudProviderStatus(): Promise<
  ExtensionMessageResponseByType<'getCloudProviderStatus'>
> {
  return withMessageResponseFallback(
    async () => {
      const keys = Object.values(CLOUD_PROVIDER_KEYS);
      const stored = await strictStorageGet<CloudProviderStatusStorageRecord>(keys);
      return { status: buildCloudProviderConfiguredStatusRecord(stored) };
    },
    { status: createEmptyCloudProviderConfiguredStatus() },
    (error) => log.warn('Failed to get cloud provider status:', error)
  );
}

export async function handleSetCloudApiKey(
  message: SetCloudApiKeyMessage
): Promise<ExtensionMessageResponseByType<'setCloudApiKey'>> {
  // Security-sensitive: keep this as a direct allow-list lookup so unknown providers
  // cannot write arbitrary storage keys through broader cleanup metadata.
  const storageKey = CLOUD_PROVIDER_KEYS[message.provider];
  if (!storageKey) {
    return createUnknownCloudProviderResponse<{ provider: CloudProviderId }>(message.provider);
  }

  const optionFields = getCloudProviderValue(message.provider, CLOUD_PROVIDER_OPTION_FIELDS) ?? {};

  return withMessageResponse(
    async () => {
      const dataToStore: CloudProviderStorageMutation = {
        [storageKey]: message.apiKey,
      };

      if (message.options) {
        Object.assign(
          dataToStore,
          buildValidatedCloudProviderMutation(message.provider, message.options, optionFields),
        );
      }

      await strictStorageSet(dataToStore);
      log.info(`API key set for ${message.provider}`);
      return { provider: message.provider };
    },
    (error) => log.error('Failed to set API key:', error)
  );
}

export async function handleClearCloudApiKey(
  message: ClearCloudApiKeyMessage,
  storageRemove: (keys: string[]) => Promise<void> = strictStorageRemove,
): Promise<ExtensionMessageResponseByType<'clearCloudApiKey'>> {
  // Clear prefers the full cleanup list when available, but falls back to the
  // primary API-key entry so older provider metadata still remains removable.
  return handleCloudProviderMutation(
    message.provider,
    resolveCloudProviderStorageKeys,
    async (keysToRemove) => {
      await storageRemove([...keysToRemove]);
      log.info(`API key cleared for ${message.provider}`);
      return { provider: message.provider };
    },
    'Failed to clear API key:'
  );
}

export async function handleSetCloudProviderEnabled(
  message: SetCloudProviderEnabledMessage
): Promise<ExtensionMessageResponseByType<'setCloudProviderEnabled'>> {
  // Enabled-state writes intentionally resolve through the dedicated enabled-field map.
  return handleCloudProviderMutation(
    message.provider,
    resolveCloudProviderEnabledField,
    async (enabledField) => {
      await strictStorageSet({ [enabledField]: message.enabled });
      log.info(`Provider ${message.provider} enabled=${message.enabled}`);
      return { provider: message.provider, enabled: message.enabled };
    },
    'Failed to update cloud provider enabled state:'
  );
}

// ============================================================================
// History Handlers
// ============================================================================

export async function handleGetHistory(): Promise<{ success: boolean; history: HistoryEntry[]; error?: string }> {
  return withMessageResponseFallback(
    async () => ({ history: await getHistory() }),
    { history: [] },
    (error) => log.warn('Failed to get history:', error)
  );
}

export async function handleClearHistory(): Promise<{ success: boolean; error?: string }> {
  return withMessageResponse(
    async () => {
      await clearTranslationHistory();
      return {};
    },
    (error) => log.warn('Failed to clear history:', error)
  );
}

/**
 * Record a successful translation to history (fire-and-forget).
 */
export function recordTranslationToHistory(
  text: string,
  result: string,
  sourceLang: string,
  targetLang: string,
): void {
  addToHistory(text, result, sourceLang, targetLang).catch(() => {
    // Non-critical
  });
}

// ============================================================================
// Corrections Handlers
// ============================================================================

export async function handleAddCorrection(message: AddCorrectionMessage): Promise<{ success: boolean; error?: string }> {
  return withMessageResponse(
    async () => {
      await addCorrection(
        message.original,
        message.machineTranslation,
        message.userCorrection,
        message.sourceLang,
        message.targetLang,
      );
      return {};
    },
    (error) => logCorrectionError('add correction', error)
  );
}

export async function handleGetCorrection(message: GetCorrectionMessage): Promise<MessageResponse<{ correction: string | null; hasCorrection: boolean }>> {
  return withMessageResponse(
    async () => {
      const correction = await getCorrection(message.original, message.sourceLang, message.targetLang);
      return { correction, hasCorrection: correction !== null };
    },
    (error) => logCorrectionError('get correction', error)
  );
}

export async function handleGetAllCorrections(): Promise<{ success: boolean; corrections: Correction[]; error?: string }> {
  return withMessageResponseFallback(
    async () => ({ corrections: await getAllCorrections() }),
    { corrections: [] },
    (error) => logCorrectionError('get corrections', error)
  );
}

export async function handleGetCorrectionStats(): Promise<{ success: boolean; stats: CorrectionStats; error?: string }> {
  return withMessageResponseFallback(
    async () => ({ stats: await getCorrectionStats() }),
    { stats: { total: 0, totalUses: 0, topCorrections: [] } },
    (error) => logCorrectionError('get correction stats', error)
  );
}

export async function handleClearCorrections(): Promise<{ success: boolean; error?: string }> {
  return withMessageResponse(
    async () => {
      await clearCorrections();
      return {};
    },
    (error) => logCorrectionError('clear corrections', error)
  );
}

export async function handleDeleteCorrection(message: DeleteCorrectionMessage): Promise<MessageResponse<{ deleted: boolean }>> {
  return withMessageResponse(
    async () => ({
      deleted: await deleteCorrection(message.original, message.sourceLang, message.targetLang),
    }),
    (error) => logCorrectionError('delete correction', error)
  );
}

export async function handleExportCorrections(): Promise<{ success: boolean; json?: string; error?: string }> {
  return withMessageResponse(
    async () => ({ json: await exportCorrections() }),
    (error) => logCorrectionError('export corrections', error)
  );
}

export async function handleImportCorrections(message: ImportCorrectionsMessage): Promise<MessageResponse<{ importedCount: number }>> {
  return withMessageResponse(
    async () => ({ importedCount: await importCorrections(message.json) }),
    (error) => logCorrectionError('import corrections', error)
  );
}

// ============================================================================
// Settings Handler
// ============================================================================

export async function handleGetSettings(
  storageGet: (keys: string[]) => Promise<UserSettingsStorageRecord>,
): Promise<MessageResponse<{ data: { sourceLanguage: string; targetLanguage: string; provider: TranslationProviderId; strategy: string } }>> {
  try {
    const settings = normalizeUserSettings(
      await storageGet(['sourceLang', 'targetLang', 'provider', 'strategy']),
      'opus-mt',
    );
    return {
      success: true,
      data: {
        // Keep the legacy response shape for existing getSettings consumers.
        sourceLanguage: settings.sourceLang,
        targetLanguage: settings.targetLang,
        provider: settings.provider,
        strategy: settings.strategy,
      },
    };
  } catch (error) {
    log.warn('Failed to get settings:', error);
    return { success: false, error: 'Failed to get settings' };
  }
}

// ============================================================================
// Helpers for context menu / keyboard shortcut settings
// ============================================================================

export interface ActionSettings {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider: TranslationProviderId;
}

export async function getActionSettings(): Promise<ActionSettings> {
  return normalizeUserSettings(
    await safeStorageGet<UserSettingsStorageRecord>(['sourceLang', 'targetLang', 'strategy', 'provider']),
    getProvider(),
  );
}
