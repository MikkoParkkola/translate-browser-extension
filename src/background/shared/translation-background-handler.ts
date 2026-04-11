import { CONFIG } from '../../config';
import {
  extractErrorMessage,
  withRetry,
  type RetryConfig,
  type TranslationError,
} from '../../core/errors';
import type { TranslateResponse, TranslationProviderId } from '../../types';
import type { OffscreenTransport } from './offscreen-transport';
import type { TranslationCache } from './storage-ops';
import {
  NETWORK_RETRY_CONFIG,
  createTranslateErrorResponse,
  finalizeTranslationExecution,
  prepareTranslationExecution,
  type PreparedTranslationExecution,
  type TranslateMessagePayload,
} from './translation-core';

export interface TranslationBackgroundLogger {
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface TranslationProfiler {
  startSession: () => string;
  startTiming: (sessionId: string, label: string) => void;
  endTiming: (sessionId: string, label: string) => void;
  importSessionData: (data: object) => void;
  getReport: (sessionId: string) => object | null | undefined;
  formatReport: (sessionId: string) => string;
}

export interface CreateTranslationBackgroundHandlerOptions {
  cache: TranslationCache;
  getProvider: () => TranslationProviderId;
  offscreenTransport: Pick<OffscreenTransport, 'send'>;
  profiler: TranslationProfiler;
  acquireKeepAlive: () => void;
  releaseKeepAlive: () => void;
  recordTranslation: (targetLang: string) => Promise<void>;
  recordTranslationToHistory: (
    sourceText: string,
    translatedText: string,
    sourceLang: string,
    targetLang: string
  ) => void;
  runChromeBuiltinTranslation: (
    text: string | string[],
    sourceLang: string,
    targetLang: string
  ) => Promise<string | string[]>;
  log: TranslationBackgroundLogger;
  maxInFlightRequests?: number;
  networkRetryConfig?: Partial<RetryConfig>;
}

export interface TranslationBackgroundHandler {
  handleTranslate: (message: TranslateMessagePayload) => Promise<TranslateResponse>;
  rejectInFlightRequests: (error: Error) => number;
}

type InFlightRequest = {
  promise: Promise<TranslateResponse>;
  reject: (error: Error) => void;
};

export function createTranslationBackgroundHandler({
  cache,
  getProvider,
  offscreenTransport,
  profiler,
  acquireKeepAlive,
  releaseKeepAlive,
  recordTranslation,
  recordTranslationToHistory,
  runChromeBuiltinTranslation,
  log,
  maxInFlightRequests = CONFIG.inFlight.maxRequests,
  networkRetryConfig = NETWORK_RETRY_CONFIG,
}: CreateTranslationBackgroundHandlerOptions): TranslationBackgroundHandler {
  const inFlightRequests = new Map<string, InFlightRequest>();

  function rejectInFlightRequests(error: Error): number {
    const rejectedCount = inFlightRequests.size;
    for (const [, { reject }] of inFlightRequests) {
      reject(error);
    }
    inFlightRequests.clear();
    return rejectedCount;
  }

  function handleSuccessfulTranslationSideEffects(
    successfulExecution: PreparedTranslationExecution,
    result: string | string[],
    sessionId: string | undefined,
    includeProfilingReport = false,
  ): Partial<TranslateResponse> | void {
    /* v8 ignore start -- fire-and-forget */
    recordTranslation(successfulExecution.message.targetLang).catch((error: unknown) => {
      log.debug('recordTranslation skipped:', error);
    });
    /* v8 ignore stop */

    if (typeof successfulExecution.text === 'string' && typeof result === 'string') {
      recordTranslationToHistory(
        successfulExecution.text,
        result,
        successfulExecution.message.sourceLang,
        successfulExecution.message.targetLang
      );
    }

    if (!includeProfilingReport || !sessionId) {
      return;
    }

    const report = profiler.getReport(sessionId);
    if (!report) {
      return;
    }

    log.info(profiler.formatReport(sessionId));
    return { profilingReport: report };
  }

  async function handleChromeBuiltinTranslation(
    execution: PreparedTranslationExecution,
    sessionId: string | undefined
  ): Promise<TranslateResponse> {
    if (sessionId) profiler.startTiming(sessionId, 'chrome_builtin_translate');

    try {
      const result = await runChromeBuiltinTranslation(
        execution.text,
        execution.message.sourceLang,
        execution.message.targetLang
      );

      if (sessionId) profiler.endTiming(sessionId, 'chrome_builtin_translate');

      return await finalizeTranslationExecution(
        execution,
        cache,
        result,
        {
          responsePatch: { provider: 'chrome-builtin' },
          recordUsage: false,
          cacheSourceLang: execution.message.sourceLang !== 'auto' ? execution.message.sourceLang : null,
          onSuccess: ({ execution: successfulExecution, result: translatedResult }) =>
            handleSuccessfulTranslationSideEffects(
              successfulExecution,
              translatedResult,
              sessionId,
            ),
          onAfterCacheStore: () => {
            if (sessionId) profiler.endTiming(sessionId, 'total');
          },
        }
      );
    } catch (error) {
      if (sessionId) {
        profiler.endTiming(sessionId, 'chrome_builtin_translate');
        profiler.endTiming(sessionId, 'total');
      }
      const errMsg = extractErrorMessage(error);

      log.error('Chrome Built-in translation failed:', errMsg);
      return { success: false, error: errMsg, duration: Date.now() - execution.startTime };
    }
  }

  async function requestOffscreenTranslation(
    execution: PreparedTranslationExecution,
    sessionId: string | undefined
  ) {
    return withRetry(
      async () => {
        const result = await offscreenTransport.send<'translate'>({
          type: 'translate',
          text: execution.text,
          sourceLang: execution.message.sourceLang,
          targetLang: execution.message.targetLang,
          provider: execution.provider,
          sessionId,
          pageContext: execution.message.options?.context?.pageContext,
        });

        if (!result) {
          throw new Error('No response from translation engine');
        }

        if (!result.success) {
          throw new Error(result.error);
        }

        return result;
      },
      networkRetryConfig,
      (error: TranslationError) => {
        return error.retryable !== false && !!error.technicalDetails;
      }
    );
  }

  async function handleTranslateInner(
    message: TranslateMessagePayload
  ): Promise<TranslateResponse> {
    const startTime = Date.now();
    const sessionId = message.enableProfiling ? profiler.startSession() : undefined;

    if (sessionId) {
      profiler.startTiming(sessionId, 'total');
    }

    try {
      const preparedResult = await prepareTranslationExecution(message, cache, {
        startTime,
        hooks: {
          onValidationStart: () => {
            if (sessionId) profiler.startTiming(sessionId, 'validation');
          },
          onValidationEnd: () => {
            if (sessionId) profiler.endTiming(sessionId, 'validation');
          },
          onCacheLookupStart: () => {
            if (sessionId) profiler.startTiming(sessionId, 'cache_lookup');
          },
          onCacheLookupEnd: () => {
            if (sessionId) profiler.endTiming(sessionId, 'cache_lookup');
          },
          onEarlyReturn: () => {
            if (sessionId) profiler.endTiming(sessionId, 'total');
          },
        },
      });

      if (preparedResult.kind === 'response') {
        return preparedResult.response;
      }

      const { execution } = preparedResult;

      log.info('Translating:', execution.message.sourceLang, '->', execution.message.targetLang);

      if (execution.provider === 'chrome-builtin') {
        return handleChromeBuiltinTranslation(execution, sessionId);
      }

      if (sessionId) profiler.startTiming(sessionId, 'ipc_background_to_offscreen');

      const response = await requestOffscreenTranslation(execution, sessionId);

      if (sessionId) {
        profiler.endTiming(sessionId, 'ipc_background_to_offscreen');

        if (response.profilingData) {
          profiler.importSessionData(response.profilingData);
        }
      }

      if (response.result === undefined) {
        throw new Error('Translation engine returned no result');
      }

      return await finalizeTranslationExecution(
        execution,
        cache,
        response.result,
        {
          onBeforeCacheStore: () => {
            if (sessionId) profiler.startTiming(sessionId, 'cache_store');
          },
          onAfterCacheStore: () => {
            if (sessionId) {
              profiler.endTiming(sessionId, 'cache_store');
              profiler.endTiming(sessionId, 'total');
            }
          },
          onSuccess: ({ execution: successfulExecution, result }) =>
            handleSuccessfulTranslationSideEffects(
              successfulExecution,
              result,
              sessionId,
              true,
            ),
        }
      );
    } catch (error) {
      if (sessionId) {
        profiler.endTiming(sessionId, 'ipc_background_to_offscreen');
        profiler.endTiming(sessionId, 'cache_store');
        profiler.endTiming(sessionId, 'total');
      }
      return createTranslateErrorResponse(error, startTime);
    }
  }

  async function handleTranslate(message: TranslateMessagePayload): Promise<TranslateResponse> {
    await cache.load();

    const provider = message.provider || getProvider();
    const dedupKey = cache.getKey(
      message.text,
      message.sourceLang,
      message.targetLang,
      provider
    );

    if (inFlightRequests.size >= maxInFlightRequests) {
      const [oldestKey] = inFlightRequests.keys();
      const oldestEntry = inFlightRequests.get(oldestKey);
      if (oldestEntry) {
        oldestEntry.reject(new Error('In-flight request limit exceeded'));
        inFlightRequests.delete(oldestKey);
      }
    }

    const existing = inFlightRequests.get(dedupKey);
    if (existing) {
      log.debug('Deduplicating in-flight request:', dedupKey.substring(0, 40));
      return existing.promise;
    }

    let innerPromise: Promise<TranslateResponse>;
    try {
      innerPromise = handleTranslateInner(message);
    } catch (syncError) {
      /* v8 ignore start -- defensive sync throw handler */
      log.error('handleTranslateInner threw synchronously:', syncError);
      return {
        success: false,
        error: extractErrorMessage(syncError),
      };
      /* v8 ignore stop */
    }

    let rejectInFlight!: (error: Error) => void;
    const controllablePromise = new Promise<TranslateResponse>((resolve, reject) => {
      rejectInFlight = reject;
      innerPromise.then(resolve, reject);
    });
    inFlightRequests.set(dedupKey, {
      promise: controllablePromise,
      reject: rejectInFlight,
    });

    acquireKeepAlive();
    try {
      return await controllablePromise;
    } finally {
      inFlightRequests.delete(dedupKey);
      releaseKeepAlive();
    }
  }

  return {
    handleTranslate,
    rejectInFlightRequests,
  };
}
