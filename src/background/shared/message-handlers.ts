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
} from '../../types';
import { safeStorageGet, safeStorageSet } from '../../core/storage';
import { createLogger } from '../../core/logger';
import { extractErrorMessage } from '../../core/errors';
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
  try {
    const keys = Object.values(CLOUD_PROVIDER_KEYS);
    const stored = await safeStorageGet<Record<string, string>>(keys);

    const status: Record<string, boolean> = {};
    for (const [provider, storageKey] of Object.entries(CLOUD_PROVIDER_KEYS)) {
      status[provider] = !!stored[storageKey];
    }

    return { success: true, status };
  } catch (error) {
    log.warn('Failed to get cloud provider status:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
      status: {},
    };
  }
}

export async function handleSetCloudApiKey(message: SetCloudApiKeyMessage): Promise<{ success: boolean; provider?: string; error?: string }> {
  const storageKey = CLOUD_PROVIDER_KEYS[message.provider];
  if (!storageKey) {
    return { success: false, error: `Unknown provider: ${message.provider}` };
  }

  try {
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
    return { success: true, provider: message.provider };
  } catch (error) {
    log.error('Failed to set API key:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

export async function handleClearCloudApiKey(
  message: ClearCloudApiKeyMessage,
  storageRemove: (keys: string[]) => Promise<void>,
): Promise<{ success: boolean; provider?: string; error?: string }> {
  const storageKey = CLOUD_PROVIDER_KEYS[message.provider];
  if (!storageKey) {
    return { success: false, error: `Unknown provider: ${message.provider}` };
  }

  try {
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
    return { success: true, provider: message.provider };
  } catch (error) {
    log.error('Failed to clear API key:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

// ============================================================================
// History Handlers
// ============================================================================

export async function handleGetHistory(): Promise<{ success: boolean; history: HistoryEntry[]; error?: string }> {
  try {
    const historyEntries = await getHistory();
    return { success: true, history: historyEntries };
  } catch (error) {
    log.warn('Failed to get history:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
      history: [],
    };
  }
}

export async function handleClearHistory(): Promise<{ success: boolean; error?: string }> {
  try {
    await clearTranslationHistory();
    return { success: true };
  } catch (error) {
    log.warn('Failed to clear history:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
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
  try {
    await addCorrection(
      message.original,
      message.machineTranslation,
      message.userCorrection,
      message.sourceLang,
      message.targetLang,
    );
    return { success: true };
  } catch (error) {
    log.warn('Failed to add correction:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

export async function handleGetCorrection(message: GetCorrectionMessage): Promise<unknown> {
  try {
    const correction = await getCorrection(message.original, message.sourceLang, message.targetLang);
    return { success: true, correction, hasCorrection: correction !== null };
  } catch (error) {
    log.warn('Failed to get correction:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
      correction: null,
      hasCorrection: false,
    };
  }
}

export async function handleGetAllCorrections(): Promise<{ success: boolean; corrections: Correction[]; error?: string }> {
  try {
    const corrections = await getAllCorrections();
    return { success: true, corrections };
  } catch (error) {
    log.warn('Failed to get corrections:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
      corrections: [],
    };
  }
}

export async function handleGetCorrectionStats(): Promise<{ success: boolean; stats: CorrectionStats; error?: string }> {
  try {
    const stats = await getCorrectionStats();
    return { success: true, stats };
  } catch (error) {
    log.warn('Failed to get correction stats:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
      stats: { total: 0, totalUses: 0, topCorrections: [] },
    };
  }
}

export async function handleClearCorrections(): Promise<{ success: boolean; error?: string }> {
  try {
    await clearCorrections();
    return { success: true };
  } catch (error) {
    log.warn('Failed to clear corrections:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

export async function handleDeleteCorrection(message: DeleteCorrectionMessage): Promise<unknown> {
  try {
    const deleted = await deleteCorrection(message.original, message.sourceLang, message.targetLang);
    return { success: true, deleted };
  } catch (error) {
    log.warn('Failed to delete correction:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
      deleted: false,
    };
  }
}

export async function handleExportCorrections(): Promise<{ success: boolean; json?: string; error?: string }> {
  try {
    const json = await exportCorrections();
    return { success: true, json };
  } catch (error) {
    log.warn('Failed to export corrections:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

export async function handleImportCorrections(message: ImportCorrectionsMessage): Promise<unknown> {
  try {
    const count = await importCorrections(message.json);
    return { success: true, importedCount: count };
  } catch (error) {
    log.warn('Failed to import corrections:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
      importedCount: 0,
    };
  }
}

// ============================================================================
// Settings Handler
// ============================================================================

export async function handleGetSettings(
  storageGet: (keys: string[]) => Promise<Record<string, unknown>>,
): Promise<unknown> {
  try {
    const settings = await storageGet(['sourceLanguage', 'targetLanguage', 'provider', 'strategy']);
    return {
      success: true,
      data: {
        sourceLanguage: (settings.sourceLanguage as string) || 'auto',
        targetLanguage: (settings.targetLanguage as string) || 'en',
        provider: (settings.provider as string) || 'opus-mt',
        strategy: (settings.strategy as string) || 'smart',
      },
    };
  } catch {
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
    provider?: TranslationProviderId;
  }>(['sourceLang', 'targetLang', 'strategy', 'provider']);

  return {
    sourceLang: settings.sourceLang || 'auto',
    targetLang: settings.targetLang || 'en',
    strategy: settings.strategy || 'smart',
    provider: settings.provider || getProvider(),
  };
}
