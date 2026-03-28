import { extractErrorMessage } from '../../core/errors';
import type {
  ExtensionMessageResponseByType,
  GetCloudProviderUsageMessage,
  PredictionStats,
  RecordLanguageDetectionMessage,
} from '../../types';
import type { OffscreenTransport } from './offscreen-transport';
import { handleClearCache } from './message-handlers';
import type { TranslationCache } from './storage-ops';

export interface DiagnosticsLogger {
  warn: (message: string, ...args: unknown[]) => void;
}

export interface DiagnosticsPredictionEngine {
  getStats: () => Promise<PredictionStats>;
  recordDetection: (url: string, language: string) => Promise<void>;
}

export interface DiagnosticsHandlers {
  handleClearCacheWithOffscreen: () => Promise<
    ExtensionMessageResponseByType<'clearCache'>
  >;
  handleGetPredictionStats: () => Promise<
    ExtensionMessageResponseByType<'getPredictionStats'>
  >;
  handleRecordLanguageDetection: (
    message: RecordLanguageDetectionMessage
  ) => Promise<ExtensionMessageResponseByType<'recordLanguageDetection'>>;
  handleGetCloudProviderUsage: (
    message: GetCloudProviderUsageMessage
  ) => Promise<ExtensionMessageResponseByType<'getCloudProviderUsage'>>;
}

export interface CreateDiagnosticsHandlersOptions {
  cache: TranslationCache;
  offscreenTransport: Pick<OffscreenTransport, 'send'>;
  predictionEngine: DiagnosticsPredictionEngine;
  log: DiagnosticsLogger;
}

async function tryClearOffscreenTranslationCache(
  offscreenTransport: Pick<OffscreenTransport, 'send'>,
  log: DiagnosticsLogger
): Promise<void> {
  try {
    await offscreenTransport.send({ type: 'clearCache' });
  } catch {
    /* v8 ignore start */
    log.warn('Could not clear offscreen translation cache (may not be running)');
    /* v8 ignore stop */
  }
}

async function recordLanguageDetectionSafe(
  predictionEngine: DiagnosticsPredictionEngine,
  log: DiagnosticsLogger,
  url: string,
  language: string
): Promise<void> {
  try {
    await predictionEngine.recordDetection(url, language);
  } catch (error) {
    log.warn('Failed to record language detection:', error);
  }
}

export function createDiagnosticsHandlers({
  cache,
  offscreenTransport,
  predictionEngine,
  log,
}: CreateDiagnosticsHandlersOptions): DiagnosticsHandlers {
  async function handleClearCacheWithOffscreen(): Promise<
    ExtensionMessageResponseByType<'clearCache'>
  > {
    const result = await handleClearCache(cache);
    await tryClearOffscreenTranslationCache(offscreenTransport, log);
    return result;
  }

  async function handleGetPredictionStats(): Promise<
    ExtensionMessageResponseByType<'getPredictionStats'>
  > {
    try {
      const stats = await predictionEngine.getStats();
      return { success: true, prediction: stats };
    } catch (error) {
      log.warn('Failed to get prediction stats:', error);
      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  }

  async function handleRecordLanguageDetection(
    message: RecordLanguageDetectionMessage
  ): Promise<ExtensionMessageResponseByType<'recordLanguageDetection'>> {
    await recordLanguageDetectionSafe(
      predictionEngine,
      log,
      message.url,
      message.language
    );
    return { success: true };
  }

  async function handleGetCloudProviderUsage(
    message: GetCloudProviderUsageMessage
  ): Promise<ExtensionMessageResponseByType<'getCloudProviderUsage'>> {
    try {
      return await offscreenTransport.send<'getCloudProviderUsage'>({
        type: 'getCloudProviderUsage',
        provider: message.provider,
      });
    } catch (error) {
      log.warn(' Failed to get cloud provider usage:', error);
      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  }

  return {
    handleClearCacheWithOffscreen,
    handleGetPredictionStats,
    handleRecordLanguageDetection,
    handleGetCloudProviderUsage,
  };
}
