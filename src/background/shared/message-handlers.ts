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
} from './provider-management';
import {
  withMessageResponse,
  withMessageResponseFallback,
} from './handler-response';
import { normalizeTranslationProviderId } from '../../shared/provider-options';

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
    const stored = await safeStorageGet<Record<string, string>>(keys);

    const status: Record<string, boolean> = {};
    for (const [provider, storageKey] of Object.entries(CLOUD_PROVIDER_KEYS)) {
      status[provider] = !!stored[storageKey];
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
      const dataToStore: Record<string, unknown> = {
        [storageKey]: message.apiKey,
      };

      // Provider-specific options
      if (message.provider === 'deepl' && message.options) {
        if (message.options.isPro !== undefined) dataToStore['deepl_is_pro'] = message.options.isPro;
        if (message.options.formality !== undefined) dataToStore['deepl_formality'] = message.options.formality;
      } else if (message.provider === 'openai' && message.options) {
        if (message.options.model !== undefined) dataToStore['openai_model'] = message.options.model;
        if (message.options.formality !== undefined) dataToStore['openai_formality'] = message.options.formality;
      } else if (message.provider === 'anthropic' && message.options) {
        if (message.options.model !== undefined) dataToStore['anthropic_model'] = message.options.model;
        if (message.options.formality !== undefined) dataToStore['anthropic_formality'] = message.options.formality;
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
      const keysToRemove = [storageKey];
      if (message.provider === 'deepl') {
        keysToRemove.push('deepl_is_pro', 'deepl_formality');
      } else if (message.provider === 'openai') {
        keysToRemove.push('openai_model', 'openai_formality', 'openai_temperature', 'openai_tokens_used');
      } else if (message.provider === 'anthropic') {
        keysToRemove.push('anthropic_model', 'anthropic_formality', 'anthropic_tokens_used');
      } else if (message.provider === 'google-cloud') {
        keysToRemove.push('google_cloud_chars_used');
      }

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
  storageGet: (keys: string[]) => Promise<Record<string, unknown>>,
): Promise<MessageResponse<{ data: { sourceLanguage: string; targetLanguage: string; provider: TranslationProviderId; strategy: string } }>> {
  try {
    const settings = await storageGet(['sourceLang', 'targetLang', 'provider', 'strategy']);
    return {
      success: true,
      data: {
        // Keep the legacy response shape for existing getSettings consumers.
        sourceLanguage: (settings.sourceLang as string) || 'auto',
        targetLanguage: (settings.targetLang as string) || 'en',
        provider: normalizeTranslationProviderId(settings.provider),
        strategy: (settings.strategy as string) || 'smart',
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
  const settings = await safeStorageGet<{
    sourceLang?: string;
    targetLang?: string;
    strategy?: Strategy;
    provider?: unknown;
  }>(['sourceLang', 'targetLang', 'strategy', 'provider']);

  return {
    sourceLang: settings.sourceLang || 'auto',
    targetLang: settings.targetLang || 'en',
    strategy: settings.strategy || 'smart',
    provider: normalizeTranslationProviderId(settings.provider, getProvider()),
  };
}
