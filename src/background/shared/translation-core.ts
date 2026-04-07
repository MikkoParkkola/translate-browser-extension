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
import { normalizeBatchTranslations } from '../../shared/batch-translation-contract';
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

export interface TranslationExecutionContext {
  startTime: number;
  message: TranslateMessagePayload;
  text: string | string[];
  provider: TranslationProviderId;
  cacheKey: string;
}

export interface PreparedTranslationExecution extends TranslationExecutionContext {
  tokenEstimate: number;
}

export type PrepareTranslationExecutionResult =
  | { kind: 'response'; response: TranslateResponse }
  | { kind: 'prepared'; execution: PreparedTranslationExecution };

type EarlyReturnKind =
  | 'validationError'
  | 'sameLanguage'
  | 'cacheHit'
  | 'correctionHit'
  | 'rateLimitExceeded';

export interface PrepareTranslationExecutionHooks {
  onValidationStart?: () => void;
  onValidationEnd?: () => void;
  onCacheLookupStart?: () => void;
  onCacheLookupEnd?: () => void;
  onEarlyReturn?: (
    kind: EarlyReturnKind,
    context: { response: TranslateResponse; execution?: TranslationExecutionContext },
  ) => void;
}

export interface PrepareTranslationExecutionOptions {
  startTime?: number;
  hooks?: PrepareTranslationExecutionHooks;
}

export interface FinalizeTranslationExecutionOptions {
  responsePatch?: Partial<TranslateResponse>;
  recordUsage?: boolean;
  cacheSourceLang?: string | null;
  onBeforeCacheStore?: () => void;
  onAfterCacheStore?: () => void;
  onSuccess?: (context: {
    execution: PreparedTranslationExecution;
    result: string | string[];
    duration: number;
    response: TranslateResponse;
  }) => Partial<TranslateResponse> | void | Promise<Partial<TranslateResponse> | void>;
}

export async function prepareTranslationExecution(
  message: TranslateMessagePayload,
  cache: TranslationCache,
  options: PrepareTranslationExecutionOptions = {},
): Promise<PrepareTranslationExecutionResult> {
  const startTime = options.startTime ?? Date.now();

  if (message.options?.context) {
    const { before, after, pageContext } = message.options.context;
    log.debug('Translation context:', {
      before: before?.substring(0, 50),
      after: after?.substring(0, 50),
      pageContext: pageContext?.substring(0, 80),
    });
  }

  options.hooks?.onValidationStart?.();
  const validation = validateInput(
    message.text,
    message.sourceLang,
    message.targetLang,
  );
  options.hooks?.onValidationEnd?.();

  if (!validation.valid) {
    const response: TranslateResponse = {
      success: false,
      error: formatUserError(validation.error!),
      duration: Date.now() - startTime,
    };
    options.hooks?.onEarlyReturn?.('validationError', { response });
    return { kind: 'response', response };
  }

  const text = validation.sanitizedText!;

  if (message.options?.strategy) {
    setStrategy(message.options.strategy);
  }

  if (message.sourceLang !== 'auto' && message.sourceLang === message.targetLang) {
    const response: TranslateResponse = {
      success: true,
      result: text,
      duration: Date.now() - startTime,
    };
    options.hooks?.onEarlyReturn?.('sameLanguage', { response });
    return { kind: 'response', response };
  }

  const provider = message.provider || getProvider();
  const cacheKey = cache.getKey(text, message.sourceLang, message.targetLang, provider);
  const executionContext: TranslationExecutionContext = {
    startTime,
    message,
    text,
    provider,
    cacheKey,
  };

  options.hooks?.onCacheLookupStart?.();
  if (message.sourceLang !== 'auto') {
    const cached = cache.get(cacheKey);
    options.hooks?.onCacheLookupEnd?.();
    if (cached) {
      const response: TranslateResponse = {
        success: true,
        result: cached.result,
        duration: Date.now() - startTime,
        cached: true,
      };
      log.info(`Cache hit, returning in ${response.duration}ms`);
      options.hooks?.onEarlyReturn?.('cacheHit', {
        response,
        execution: executionContext,
      });
      return { kind: 'response', response };
    }
  } else {
    cache.recordMiss();
    options.hooks?.onCacheLookupEnd?.();
  }

  if (typeof text === 'string' && message.sourceLang !== 'auto') {
    const userCorrection = await getCorrection(text, message.sourceLang, message.targetLang);
    if (userCorrection) {
      const response: TranslateResponse = {
        success: true,
        result: userCorrection,
        duration: Date.now() - startTime,
        fromCorrection: true,
      };
      log.info(`Using user correction, returning in ${response.duration}ms`);
      cache.set(cacheKey, userCorrection, message.sourceLang, message.targetLang);
      options.hooks?.onEarlyReturn?.('correctionHit', {
        response,
        execution: executionContext,
      });
      return { kind: 'response', response };
    }
  }

  const tokenEstimate = estimateTokens(text);
  if (!checkRateLimit(tokenEstimate)) {
    const response: TranslateResponse = {
      success: false,
      error: 'Too many requests. Please wait a moment and try again.',
      duration: Date.now() - startTime,
    };
    options.hooks?.onEarlyReturn?.('rateLimitExceeded', {
      response,
      execution: executionContext,
    });
    return { kind: 'response', response };
  }

  return {
    kind: 'prepared',
    execution: {
      ...executionContext,
      tokenEstimate,
    },
  };
}

export async function finalizeTranslationExecution(
  execution: PreparedTranslationExecution,
  cache: TranslationCache,
  result: string | string[],
  options: FinalizeTranslationExecutionOptions = {},
): Promise<TranslateResponse> {
  const normalizedResult = Array.isArray(execution.text)
    ? normalizeBatchTranslations(result, execution.text.length)
    : result;

  log.info('Translation complete');

  if (options.recordUsage ?? true) {
    recordUsage(execution.tokenEstimate);
  }

  const cacheSourceLang = options.cacheSourceLang === undefined
    ? (execution.message.sourceLang === 'auto' ? null : execution.message.sourceLang)
    : options.cacheSourceLang;

  options.onBeforeCacheStore?.();
  if (normalizedResult && cacheSourceLang) {
    cache.set(
      execution.cacheKey,
      normalizedResult,
      cacheSourceLang,
      execution.message.targetLang,
    );
  }
  options.onAfterCacheStore?.();

  const duration = Date.now() - execution.startTime;
  let response: TranslateResponse = {
    success: true,
    result: normalizedResult,
    duration,
    ...options.responsePatch,
  };

  const responsePatch = await options.onSuccess?.({
    execution,
    result: normalizedResult,
    duration,
    response,
  });
  if (responsePatch) {
    response = { ...response, ...responsePatch };
  }

  return response;
}

export function createTranslateErrorResponse(
  error: unknown,
  startTime: number,
): TranslateResponse {
  const translationError = createTranslationError(error);
  log.error('Translation error:', translationError.technicalDetails);

  return {
    success: false,
    error: formatUserError(translationError),
    duration: Date.now() - startTime,
  };
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
  const preparedResult = await prepareTranslationExecution(message, cache);
  if (preparedResult.kind === 'response') {
    return preparedResult.response;
  }

  const { execution } = preparedResult;

  try {
    log.info('Translating:', execution.message.sourceLang, '->', execution.message.targetLang);

    // Delegate to platform-specific translation
    const response = await withRetry(
      async () => {
        return translateFn(
          execution.text,
          execution.message.sourceLang,
          execution.message.targetLang,
          execution.provider,
          {
            context: execution.message.options?.context,
            enableProfiling: execution.message.enableProfiling,
          },
        );
      },
      NETWORK_RETRY_CONFIG,
      (error: TranslationError) => {
        return isNetworkError(error.technicalDetails);
      },
    );

    return await finalizeTranslationExecution(
      execution,
      cache,
      response.result,
    );
  } catch (error) {
    return createTranslateErrorResponse(error, execution.startTime);
  }
}
