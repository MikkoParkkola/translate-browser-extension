/**
 * Shared Translation Core
 *
 * Common validation, caching, rate-limiting, and translation dispatch
 * logic used by both Chrome and Firefox background scripts.
 *
 * Platform-specific code (offscreen IPC vs direct ML inference) is
 * injected via the `translateFn` callback.
 */

import type { TranslateResponse, Strategy, TranslationProviderId } from '../../types';
import {
  createTranslationError,
  validateInput,
  withRetry,
  isNetworkError,
  type TranslationError,
  type RetryConfig,
} from '../../core/errors';
import { getCorrection } from '../../core/corrections';
import { createLogger } from '../../core/logger';
import { CONFIG } from '../../config';
import type { TranslationCache } from './storage-ops';
import {
  setStrategy,
  getProvider,
  checkRateLimit,
  recordUsage,
  estimateTokens,
  formatUserError,
} from './provider-management';

const log = createLogger('TranslationCore');

// ============================================================================
// Retry Configuration
// ============================================================================

export const NETWORK_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: CONFIG.retry.network.maxRetries,
  baseDelayMs: CONFIG.retry.network.baseDelayMs,
  maxDelayMs: CONFIG.retry.network.maxDelayMs,
};

// ============================================================================
// Translation Handler
// ============================================================================

/**
 * Platform-specific translation function.
 * Chrome sends to offscreen document; Firefox calls ML inference directly.
 */
export type TranslateFn = (
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId,
  options?: {
    context?: { before: string; after: string; pageContext?: string };
    enableProfiling?: boolean;
    sessionId?: string;
  },
) => Promise<{
  result: string | string[];
  profilingData?: object;
}>;

export interface TranslateMessagePayload {
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  options?: {
    strategy?: Strategy;
    context?: { before: string; after: string; pageContext?: string };
  };
  provider?: TranslationProviderId;
  enableProfiling?: boolean;
}

/**
 * Core translation handler.
 *
 * Performs validation, cache lookup, rate limiting, translation dispatch,
 * and result caching. The actual translation is delegated to `translateFn`.
 */
export async function handleTranslateCore(
  message: TranslateMessagePayload,
  cache: TranslationCache,
  translateFn: TranslateFn,
): Promise<TranslateResponse> {
  const startTime = Date.now();

  // Log context if provided
  if (message.options?.context) {
    const { before, after, pageContext } = message.options.context;
    log.debug('Translation context:', {
      before: before?.substring(0, 50),
      after: after?.substring(0, 50),
      pageContext: pageContext?.substring(0, 80),
    });
  }

  try {
    // Validate input
    const validation = validateInput(
      message.text,
      message.sourceLang,
      message.targetLang,
    );

    if (!validation.valid) {
      return {
        success: false,
        error: formatUserError(validation.error!),
        duration: Date.now() - startTime,
      };
    }

    const text = validation.sanitizedText!;

    if (message.options?.strategy) {
      setStrategy(message.options.strategy);
    }

    const provider = message.provider || getProvider();

    // Check cache first (skip for 'auto' source since detected language may vary)
    const cacheKey = cache.getKey(text, message.sourceLang, message.targetLang, provider);
    if (message.sourceLang !== 'auto') {
      const cached = cache.get(cacheKey);
      if (cached) {
        const duration = Date.now() - startTime;
        log.info(`Cache hit, returning in ${duration}ms`);
        return {
          success: true,
          result: cached.result,
          duration,
          cached: true,
        } as TranslateResponse & { cached: boolean };
      }
    }

    // Check for user corrections (single strings only)
    if (typeof text === 'string' && message.sourceLang !== 'auto') {
      const userCorrection = await getCorrection(text, message.sourceLang, message.targetLang);
      if (userCorrection) {
        const duration = Date.now() - startTime;
        log.info(`Using user correction, returning in ${duration}ms`);
        cache.set(cacheKey, userCorrection, message.sourceLang, message.targetLang);
        return {
          success: true,
          result: userCorrection,
          duration,
          fromCorrection: true,
        } as TranslateResponse & { fromCorrection: boolean };
      }
    }

    const tokenEstimate = estimateTokens(text);

    if (!checkRateLimit(tokenEstimate)) {
      return {
        success: false,
        error: 'Too many requests. Please wait a moment and try again.',
        duration: Date.now() - startTime,
      };
    }

    log.info('Translating:', message.sourceLang, '->', message.targetLang);

    // Delegate to platform-specific translation
    const response = await withRetry(
      async () => {
        return translateFn(text, message.sourceLang, message.targetLang, provider, {
          context: message.options?.context,
          enableProfiling: message.enableProfiling,
        });
      },
      NETWORK_RETRY_CONFIG,
      (error: TranslationError) => {
        return isNetworkError(error.technicalDetails);
      },
    );

    log.info('Translation complete');
    recordUsage(tokenEstimate);

    // Cache the result
    const actualSourceLang = message.sourceLang === 'auto' ? 'auto' : message.sourceLang;
    if (response.result && actualSourceLang !== 'auto') {
      cache.set(cacheKey, response.result, actualSourceLang, message.targetLang);
    }

    return {
      success: true,
      result: response.result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const translationError = createTranslationError(error);
    log.error('Translation error:', translationError.technicalDetails);

    return {
      success: false,
      error: formatUserError(translationError),
      duration: Date.now() - startTime,
    };
  }
}
