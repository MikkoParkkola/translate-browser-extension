/**
 * Shared Message Handlers
 *
 * Common message handler implementations that both Chrome and Firefox
 * background scripts delegate to. These handlers are platform-agnostic
 * — they depend only on the shared TranslationCache and ProviderState.
 */

import type {
  TranslationProviderId, Strategy, DetailedCacheStats, ThrottleUsage,
  SetCloudApiKeyMessage, ClearCloudApiKeyMessage,
  AddCorrectionMessage, GetCorrectionMessage, DeleteCorrectionMessage, ImportCorrectionsMessage,
  MessageResponse,
} from '../../types';
import { safeStorageGet, safeStorageSet } from '../../core/storage';
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

const log = createLogger('SharedHandlers');

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

export function handleGetUsage(cache: TranslationCache): { throttle: ThrottleUsage; cache: DetailedCacheStats; providers: Record<string, unknown> } {
  const rl = getRateLimitState();
  return {
    throttle: {
      requests: rl.requests,
      tokens: rl.tokens,
      requestLimit: CONFIG_RL.requestsPerMinute,
      tokenLimit: CONFIG_RL.tokensPerMinute,
      totalRequests: rl.requests,
      totalTokens: rl.tokens,
      queue: 0,
    },
    cache: cache.getStats(),
    providers: {},
  };
}

// Import CONFIG for rate limit constants
import { CONFIG } from '../../config';
const CONFIG_RL = CONFIG.rateLimits;

// ============================================================================
// Cloud Provider Handlers
// ============================================================================

export async function handleGetCloudProviderStatus(): Promise<{ success: boolean; status: Record<string, boolean>; error?: string }> {
  return withMessageResponseFallback(
    async () => {
      const keys = Object.values(CLOUD_PROVIDER_KEYS);
      const stored = await safeStorageGet<CloudProviderStatusStorageRecord>(keys);

      const status: Record<string, boolean> = {};
      for (const [provider, storageKey] of Object.entries(CLOUD_PROVIDER_KEYS)) {
        status[provider] = !!stored[storageKey as keyof CloudProviderStatusStorageRecord];
      }

      return { status };
    },
    { status: {} },
    (error) => log.warn('Failed to get cloud provider status:', error)
  );
}

export async function handleSetCloudApiKey(message: SetCloudApiKeyMessage): Promise<{ success: boolean; provider?: SetCloudApiKeyMessage['provider']; error?: string }> {
  const storageKey = CLOUD_PROVIDER_KEYS[message.provider];
  if (!storageKey) {
    return { success: false, error: `Unknown provider: ${message.provider}` };
  }

  return withMessageResponse(
    async () => {
      const dataToStore: CloudProviderStorageMutation = {
        [storageKey]: message.apiKey,
      };

      if (message.options) {
        const optionFields = CLOUD_PROVIDER_OPTION_FIELDS[message.provider];
        Object.assign(
          dataToStore,
          buildValidatedCloudProviderMutation(message.provider, message.options, optionFields),
        );
      }

      await safeStorageSet(dataToStore);
      log.info(`API key set for ${message.provider}`);
      return { provider: message.provider };
    },
    (error) => log.error('Failed to set API key:', error)
  );
}

export async function handleClearCloudApiKey(
  message: ClearCloudApiKeyMessage,
  storageRemove: (keys: string[]) => Promise<void>,
): Promise<{ success: boolean; provider?: ClearCloudApiKeyMessage['provider']; error?: string }> {
  const storageKey = CLOUD_PROVIDER_KEYS[message.provider];
  if (!storageKey) {
    return { success: false, error: `Unknown provider: ${message.provider}` };
  }

  return withMessageResponse(
    async () => {
      const keysToRemove = [...(CLOUD_PROVIDER_STORAGE_KEYS[message.provider] ?? [storageKey])];
      await storageRemove(keysToRemove);
      log.info(`API key cleared for ${message.provider}`);
      return { provider: message.provider };
    },
    (error) => log.error('Failed to clear API key:', error)
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
    (error) => log.warn('Failed to add correction:', error)
  );
}

export async function handleGetCorrection(message: GetCorrectionMessage): Promise<MessageResponse<{ correction: string | null; hasCorrection: boolean }>> {
  return withMessageResponse(
    async () => {
      const correction = await getCorrection(message.original, message.sourceLang, message.targetLang);
      return { correction, hasCorrection: correction !== null };
    },
    (error) => log.warn('Failed to get correction:', error)
  );
}

export async function handleGetAllCorrections(): Promise<{ success: boolean; corrections: Correction[]; error?: string }> {
  return withMessageResponseFallback(
    async () => ({ corrections: await getAllCorrections() }),
    { corrections: [] },
    (error) => log.warn('Failed to get corrections:', error)
  );
}

export async function handleGetCorrectionStats(): Promise<{ success: boolean; stats: CorrectionStats; error?: string }> {
  return withMessageResponseFallback(
    async () => ({ stats: await getCorrectionStats() }),
    { stats: { total: 0, totalUses: 0, topCorrections: [] } },
    (error) => log.warn('Failed to get correction stats:', error)
  );
}

export async function handleClearCorrections(): Promise<{ success: boolean; error?: string }> {
  return withMessageResponse(
    async () => {
      await clearCorrections();
      return {};
    },
    (error) => log.warn('Failed to clear corrections:', error)
  );
}

export async function handleDeleteCorrection(message: DeleteCorrectionMessage): Promise<MessageResponse<{ deleted: boolean }>> {
  return withMessageResponse(
    async () => ({
      deleted: await deleteCorrection(message.original, message.sourceLang, message.targetLang),
    }),
    (error) => log.warn('Failed to delete correction:', error)
  );
}

export async function handleExportCorrections(): Promise<{ success: boolean; json?: string; error?: string }> {
  return withMessageResponse(
    async () => ({ json: await exportCorrections() }),
    (error) => log.warn('Failed to export corrections:', error)
  );
}

export async function handleImportCorrections(message: ImportCorrectionsMessage): Promise<MessageResponse<{ importedCount: number }>> {
  return withMessageResponse(
    async () => ({ importedCount: await importCorrections(message.json) }),
    (error) => log.warn('Failed to import corrections:', error)
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
