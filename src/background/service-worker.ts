/**
 * Background Service Worker (Chrome MV3)
 * Uses offscreen document for ML inference (service workers can't access DOM)
 *
 * Performance optimizations:
 * - LRU translation cache (max 100 entries)
 * - Lazy model loading (preload on popup open)
 * - Retry with exponential backoff for transient failures
 * - Predictive model pre-translation based on browsing patterns
 */

import type {
  BackgroundRequestMessage,
  BackgroundRequestMessageType,
  ExtensionMessage, ExtensionMessageResponse, TranslateResponse, Strategy, TranslationProviderId, ContentCommand,
  PreloadModelMessage, PreloadModelResponsePayload, RecordLanguageDetectionMessage,
  GetCloudProviderUsageMessage, OCRImageMessage, CaptureScreenshotMessage,
  DeleteModelMessage, DownloadedModelRecord, MessageResponse,
} from '../types';
import {
  createTranslationError,
  extractErrorMessage,
  withRetry,
  type TranslationError,
  type RetryConfig,
} from '../core/errors';
import { createLogger } from '../core/logger';
import { safeStorageGet, safeStorageSet, strictStorageSet } from '../core/storage';
import { getPredictionEngine } from '../core/prediction-engine';
import { CONFIG } from '../config';
import { profiler, type AggregateStats } from '../core/profiler';
import { sleep } from '../core/async-utils';
import { splitIntoSentences } from '../core/text-utils';
import { DEFAULT_PROVIDER_ID, normalizeTranslationProviderId } from '../shared/provider-options';
import {
  assertNever,
  isExtensionMessage,
  isHandledExtensionMessage,
  isAuthorizedExtensionSender,
  routeHandledExtensionMessage,
} from './shared/message-routing';

// Shared modules — extracted from duplicated Chrome/Firefox logic
import {
  createTranslationCache,
  type StorageAdapter,
  type TranslationCache,
  getProvider,
  setProvider,
  getStrategy,
  formatUserError,
  getDownloadedModelInventory,
  clearDownloadedModelInventory,
  deleteDownloadedModelInventoryEntry,
  handleSetProvider,
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
  isOffscreenDownloadedModelUpdateMessage,
  isOffscreenModelMessage,
  isOffscreenModelProgressMessage,
  getActionSettings,
  PROVIDER_LIST,
  NETWORK_RETRY_CONFIG,
  prepareTranslationExecution,
  finalizeTranslationExecution,
  createTranslateErrorResponse,
  relayModelProgress,
  upsertDownloadedModelInventory,
} from './shared';

const log = createLogger('Background');

// ============================================================================
// Chrome Storage Adapter
// ============================================================================

const chromeStorageAdapter: StorageAdapter = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (data) => chrome.storage.local.set(data),
  remove: (keys) => chrome.storage.local.remove(keys),
};

// ============================================================================
// Translation Cache (backed by shared module)
// ============================================================================

const translationCache: TranslationCache = createTranslationCache(
  chromeStorageAdapter,
  getProvider,
  { enableVersioning: true },
);

// In-flight request deduplication map.
// When multiple frames request the same translation simultaneously,
// they share a single API call instead of making duplicate requests.
const inFlightRequests = new Map<string, { promise: Promise<TranslateResponse>; reject: (error: Error) => void }>();

// Load cache on startup
translationCache.load();

// ============================================================================
// Prediction Engine Integration
// ============================================================================

const predictionEngine = getPredictionEngine();

// Track preloaded models to avoid duplicate preloads
const preloadedModels = new Set<string>();

/**
 * Preload models based on predictions (called on tab navigation)
 */
async function preloadPredictedModels(url: string): Promise<void> {
  try {
    const hasActivity = await predictionEngine.hasRecentActivity();
    if (!hasActivity) {
      log.debug('No recent activity, skipping predictive preload');
      return;
    }

    const predictions = await predictionEngine.predict(url);
    if (predictions.length === 0) {
      return;
    }

    log.info(`Predictive preload: ${predictions.length} candidates for ${url}`);

    for (const prediction of predictions) {
      const key = `${prediction.sourceLang}-${prediction.targetLang}`;

      /* v8 ignore start -- preloaded check branch */
      if (preloadedModels.has(key)) {
        log.debug(`Model ${key} already preloaded`);
        continue;
      }
      /* v8 ignore stop */

      if (prediction.confidence < 0.3) {
        log.debug(`Skipping low confidence prediction: ${key} (${prediction.confidence.toFixed(2)})`);
        continue;
      }

      // Check if preloaded models exceed limit
      if (preloadedModels.size >= CONFIG.inFlight.maxPreloaded) {
        preloadedModels.clear();
      }

      log.info(`Preloading predicted model: ${key} (confidence: ${prediction.confidence.toFixed(2)})`);

      sendToOffscreen<{ success: boolean; preloaded?: boolean }>({
        type: 'preloadModel',
        sourceLang: prediction.sourceLang,
        targetLang: prediction.targetLang,
        provider: getProvider(),
        priority: 'low',
      })
        .then((response) => {
          if (response.preloaded) {
            preloadedModels.add(key);
            log.info(`Predictive preload complete: ${key}`);
          }
        })
        /* v8 ignore start */
        .catch((error) => {
          log.warn(`Predictive preload failed for ${key}:`, error);
        });
        /* v8 ignore stop */
    }
  } catch (error) {
    log.warn('Predictive preload error:', error);
  }
}

/**
 * Record language detection for prediction engine
 */
async function recordLanguageDetection(url: string, language: string): Promise<void> {
  try {
    await predictionEngine.recordDetection(url, language);
  } catch (error) {
    log.warn('Failed to record language detection:', error);
  }
}

/**
 * Record translation for prediction engine
 */
async function recordTranslation(targetLang: string): Promise<void> {
  try {
    await predictionEngine.recordTranslation(targetLang);
  } catch (error) {
    log.warn('Failed to record translation:', error);
  }
}

// ============================================================================
// Offscreen Document Management (Chrome-specific)
// ============================================================================

let creatingOffscreen: Promise<void> | null = null;
let offscreenFailureCount = 0;
let offscreenResetCount = 0;

let circuitBreakerCooldownTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCircuitBreakerReset(): void {
  if (circuitBreakerCooldownTimer) {
    clearTimeout(circuitBreakerCooldownTimer);
  }
  /* v8 ignore start -- timer callback */
  circuitBreakerCooldownTimer = setTimeout(() => {
    if (offscreenFailureCount > 0 || offscreenResetCount > 0) {
      log.info(`Circuit breaker cooldown: resetting counters (failures=${offscreenFailureCount}, resets=${offscreenResetCount})`);
      offscreenFailureCount = 0;
      offscreenResetCount = 0;
    }
    circuitBreakerCooldownTimer = null;
  }, CONFIG.retry.offscreenCooldownMs);
  /* v8 ignore stop */
}

// ============================================================================
// Service Worker Keep-Alive (Chrome-specific)
// ============================================================================

let activeTranslationCount = 0;
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function acquireKeepAlive(): void {
  activeTranslationCount++;
  if (activeTranslationCount === 1 && !keepAliveInterval) {
    /* v8 ignore start -- timer callback */
    keepAliveInterval = setInterval(() => {
      if (activeTranslationCount > 0) {
        chrome.runtime.getPlatformInfo(() => {
          /* keep-alive ping */
        });
      }
    }, 25000);
    /* v8 ignore stop */
    log.info(`Keep-alive started (${activeTranslationCount} active translations)`);
  }
}

function releaseKeepAlive(): void {
  activeTranslationCount = Math.max(0, activeTranslationCount - 1);
  if (activeTranslationCount === 0 && keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    log.info('Keep-alive stopped (no active translations)');
  }
}

const OFFSCREEN_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: CONFIG.retry.offscreen.maxRetries,
  baseDelayMs: CONFIG.retry.offscreen.baseDelayMs,
  maxDelayMs: CONFIG.retry.offscreen.maxDelayMs,
};

/**
 * Create or verify offscreen document exists
 */
async function ensureOffscreenDocument(): Promise<void> {
  /* v8 ignore start -- concurrent creation dedup */
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  /* v8 ignore stop */

  const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');

  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [offscreenUrl],
    });

    if (existingContexts.length > 0) {
      offscreenFailureCount = 0;
      return;
    }

    /* v8 ignore start -- concurrent creation dedup */
    if (creatingOffscreen) {
      await creatingOffscreen;
      return;
    }
    /* v8 ignore stop */

    log.info('Creating offscreen document...');

    const createPromise = chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run Transformers.js ML inference in document context',
    });
    creatingOffscreen = createPromise;

    await createPromise;
    creatingOffscreen = null;
    offscreenFailureCount = 0;
    log.info('Offscreen document created successfully');
  } catch (error) {
    creatingOffscreen = null;
    offscreenFailureCount++;
    scheduleCircuitBreakerReset();

    const errMsg = extractErrorMessage(error);

    log.error(' Failed to create offscreen document:', errMsg);

    if (offscreenFailureCount >= CONFIG.retry.maxOffscreenFailures) {
      throw new Error(
        'Translation engine failed to start. Please reload the extension or restart Chrome.'
      );
    }

    throw new Error(`Failed to initialize translation engine: ${errMsg}`);
  }
}

/**
 * Close and recreate offscreen document (for recovery from errors).
 */
/* v8 ignore start -- recovery function only triggered by repeated offscreen crashes */
async function resetOffscreenDocument(): Promise<void> {
  offscreenResetCount++;
  scheduleCircuitBreakerReset();
  if (offscreenResetCount > CONFIG.retry.maxOffscreenResets) {
    const msg = 'Translation engine crashed repeatedly. Please reload the extension or restart Chrome.';
    log.error(msg);
    throw new Error(msg);
  }

  log.info(`Offscreen reset attempt ${offscreenResetCount}/${CONFIG.retry.maxOffscreenResets}`);

  if (inFlightRequests.size > 0) {
    log.info(`Rejecting ${inFlightRequests.size} in-flight requests before offscreen reset`);
    const resetError = new Error('Translation engine reset — please retry');
    for (const [, { reject }] of inFlightRequests) {
      reject(resetError);
    }
    inFlightRequests.clear();
  }

  try {
    const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [offscreenUrl],
    });

    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
      log.info('Closed existing offscreen document');
    }
  } catch (error) {
    log.warn(' Error closing offscreen document:', error);
  }

  creatingOffscreen = null;

  await sleep(500);
  await ensureOffscreenDocument();

  offscreenResetCount = 0;
  log.info('Offscreen document reset successfully');
}
/* v8 ignore stop */

/**
 * Send message to offscreen document with timeout and retry
 */
async function sendToOffscreen<T>(
  message: Record<string, unknown>,
  timeoutMs = CONFIG.timeouts.offscreenMs
): Promise<T> {
  return withRetry(
    async () => {
      await ensureOffscreenDocument();

      return new Promise<T>((resolve, reject) => {
        /* v8 ignore start -- timeout callback */
        const timeout = setTimeout(() => {
          reject(new Error('Offscreen communication timeout'));
        }, timeoutMs);
        /* v8 ignore stop */

        try {
          chrome.runtime.sendMessage(
            { ...message, target: 'offscreen' },
            (response) => {
              clearTimeout(timeout);

              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              if (response === undefined) {
                reject(new Error('No response from translation engine'));
                return;
              }

              resolve(response as T);
            }
          );
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    },
    OFFSCREEN_RETRY_CONFIG,
    /* v8 ignore start -- retry handler with offscreen reset */
    (error: TranslationError) => {
      if (!error.retryable) return false;

      if (error.technicalDetails.includes('offscreen')) {
        log.info('Attempting offscreen document reset...');
        resetOffscreenDocument().catch((resetError) => {
          log.error('Offscreen reset failed:', extractErrorMessage(resetError));
        });
      }

      return true;
    /* v8 ignore stop */
    }
  );
}

function isOffscreenDocumentSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.url === chrome.runtime.getURL('src/offscreen/offscreen.html');
}

// ============================================================================
// Message Handler
// ============================================================================

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: TranslateResponse | unknown) => void
  ) => {
    if (!isExtensionMessage(message)) return;

    // Ignore messages from offscreen document
    if ('target' in message && message.target === 'offscreen') return false;

    if (isOffscreenModelMessage(message)) {
      if (!isOffscreenDocumentSender(sender)) {
        sendResponse({ success: false, error: 'Unauthorized sender' });
        return true;
      }

      if (isOffscreenModelProgressMessage(message)) {
        const relayUpdate = {
          modelId: message.modelId,
          status: message.status,
          progress: message.progress,
          loaded: message.loaded,
          total: message.total,
          file: message.file,
          error: message.error,
        } as const;
        const persistInventory = message.status === 'ready' || message.status === 'done'
          ? upsertDownloadedModelInventory({
            type: 'offscreenDownloadedModelUpdate',
            target: 'background',
            modelId: message.modelId,
            size: message.total,
            lastUsed: Date.now(),
          })
          : Promise.resolve();

        persistInventory
          .then(() => {
            relayModelProgress(relayUpdate);
            sendResponse({ success: true });
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: extractErrorMessage(error),
            });
          });
        return true;
      }

      if (isOffscreenDownloadedModelUpdateMessage(message)) {
        upsertDownloadedModelInventory(message)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: extractErrorMessage(error),
            });
          });
        return true;
      }
    }

    // For translation messages, validate text/sourceLang/targetLang are strings
    if (message.type === 'translate') {
      // TypeScript narrows message to TranslateMessage here; validation is a runtime guard
      // against malformed messages from content scripts (the union type ensures correct types
      // for well-formed callers, but runtime messages are untyped).
      if (typeof message.text !== 'string' && !Array.isArray(message.text) ||
          typeof message.sourceLang !== 'string' ||
          typeof message.targetLang !== 'string') {
        sendResponse({ success: false, error: 'Invalid translation parameters' });
        return true;
      }
    }

    // Validate sender for sensitive operations — only allow from extension pages (popup/options),
    // not content scripts running on arbitrary web pages. Content scripts always have sender.url
    // set to the web page URL; extension pages have chrome-extension:// URLs.
    if (!isAuthorizedExtensionSender(message, sender.url, 'chrome-extension://')) {
      sendResponse({ success: false, error: 'Unauthorized sender' });
      return true;
    }

    return routeHandledExtensionMessage({
      message,
      sendResponse,
      isHandledMessage: isServiceWorkerHandledMessage,
      dispatch: handleMessage,
      logUnknownMessage: (type) => log.warn(` Unknown message type: ${type}`),
      createErrorResponse: (error) => {
        const translationError = createTranslationError(error);
        log.error(' Error:', translationError.technicalDetails);
        return {
          success: false,
          error: formatUserError(translationError),
        };
      },
    });
  }
);

// ============================================================================
// Streaming Translation via Port (chrome.runtime.connect)
// ============================================================================
//
// Content scripts connect with name 'translate-stream' to receive incremental
// translation tokens. This is used for long selected text so the tooltip can
// show partial results as they arrive rather than waiting for the full response.
//
// Protocol:
//   CS → SW  { type: 'startStream', text, sourceLang, targetLang, provider? }
//   SW → CS  { type: 'chunk', partial: string }  (one or more)
//   SW → CS  { type: 'done', result: string }
//   SW → CS  { type: 'error', error: string }

function createStreamPortSender(port: chrome.runtime.Port): (message: Record<string, unknown>) => boolean {
  let closed = false;
  port.onDisconnect.addListener(() => {
    closed = true;
  });

  return (message: Record<string, unknown>) => {
    if (closed) return false;
    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      closed = true;
      log.debug('Stream port closed before message delivery:', error);
      return false;
    }
  };
}

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name !== 'translate-stream') return;
  const postToStream = createStreamPortSender(port);

  port.onMessage.addListener(async (msg: {
    type: string;
    text?: string;
    sourceLang?: string;
    targetLang?: string;
    provider?: string;
  }) => {
    if (msg.type !== 'startStream') return;
    const { text, sourceLang, targetLang, provider: requestedProvider } = msg;

    if (!text || !sourceLang || !targetLang) {
      postToStream({ type: 'error', error: 'Missing required fields' });
      return;
    }

    const provider = (requestedProvider || getProvider()) as TranslationProviderId;
    acquireKeepAlive();

    try {
      // For chrome-builtin: translate sentence-by-sentence for progressive feedback.
      // The Chrome Translator API only supports streaming within the main world of a tab
      // (not from the service worker), so we approximate streaming by splitting on
      // sentence boundaries and posting each translated sentence as a chunk.
      if (provider === 'chrome-builtin') {
        const sentences = splitIntoSentences(text);
        const accumulated: string[] = [];

        for (const sentence of sentences) {
          if (!sentence.trim()) {
            accumulated.push(sentence);
            continue;
          }

          const response = await handleTranslate({
            text: sentence,
            sourceLang,
            targetLang,
            provider: 'chrome-builtin',
          });

          if (response.success && response.result) {
            accumulated.push(response.result as string);
            if (!postToStream({ type: 'chunk', partial: accumulated.join(' ') })) return;
          } else {
            throw new Error(response.error || 'Translation failed');
          }
        }

        postToStream({ type: 'done', result: accumulated.join(' ') });
        return;
      }

      // For all other providers: translate via offscreen IPC (they already batch-
      // translate efficiently; send the whole text and return a single done message).
      const response = await handleTranslate({ text, sourceLang, targetLang, provider });
      if (response.success && response.result) {
        if (!postToStream({ type: 'chunk', partial: response.result as string })) return;
        postToStream({ type: 'done', result: response.result as string });
      } else {
        throw new Error(response.error || 'Translation failed');
      }
    } catch (error) {
      const errMsg = extractErrorMessage(error);
      postToStream({ type: 'error', error: errMsg });
    } finally {
      releaseKeepAlive();
    }
  });
});


const SERVICE_WORKER_MESSAGE_TYPES = [
  'ping',
  'translate',
  'getUsage',
  'getProviders',
  'preloadModel',
  'setProvider',
  'getCacheStats',
  'clearCache',
  'checkChromeTranslator',
  'checkWebGPU',
  'checkWebNN',
  'getPredictionStats',
  'recordLanguageDetection',
  'getCloudProviderStatus',
  'setCloudApiKey',
  'clearCloudApiKey',
  'setCloudProviderEnabled',
  'getCloudProviderUsage',
  'getProfilingStats',
  'clearProfilingStats',
  'getHistory',
  'clearHistory',
  'addCorrection',
  'getCorrection',
  'getAllCorrections',
  'getCorrectionStats',
  'clearCorrections',
  'deleteCorrection',
  'exportCorrections',
  'importCorrections',
  'ocrImage',
  'captureScreenshot',
  'getDownloadedModels',
  'deleteModel',
  'clearAllModels',
  'getSettings',
] as const satisfies readonly BackgroundRequestMessageType[];

type ServiceWorkerHandledMessage = Extract<
  BackgroundRequestMessage,
  { type: (typeof SERVICE_WORKER_MESSAGE_TYPES)[number] }
>;

type ServiceWorkerHandledResponse = ExtensionMessageResponse<ServiceWorkerHandledMessage>;

function isServiceWorkerHandledMessage(
  message: ExtensionMessage
): message is ServiceWorkerHandledMessage {
  return isHandledExtensionMessage(message, SERVICE_WORKER_MESSAGE_TYPES);
}

async function handleMessage(message: ServiceWorkerHandledMessage): Promise<ServiceWorkerHandledResponse> {
  switch (message.type) {
    case 'ping':
      return { success: true, status: 'ready', provider: getProvider() };
    case 'translate':
      return handleTranslate(message);
    case 'getUsage':
      return handleGetUsage(translationCache);
    case 'getProviders':
      return handleGetProviders();
    case 'preloadModel':
      return handlePreloadModel(message);
    case 'setProvider':
      return handleSetProvider(message);
    case 'getCacheStats':
      return handleGetCacheStats(translationCache);
    case 'clearCache':
      return handleClearCacheWithOffscreen();
    case 'checkChromeTranslator':
      return handleCheckChromeTranslator();
    case 'checkWebGPU':
      return handleCheckWebGPU();
    case 'checkWebNN':
      return handleCheckWebNN();
    case 'getPredictionStats':
      return handleGetPredictionStats();
    case 'recordLanguageDetection':
      return handleRecordLanguageDetection(message);
    case 'getCloudProviderStatus':
      return handleGetCloudProviderStatus();
    case 'setCloudApiKey':
      return handleSetCloudApiKey(message);
    case 'clearCloudApiKey':
      return handleClearCloudApiKey(message);
    case 'setCloudProviderEnabled':
      return handleSetCloudProviderEnabled(message);
    case 'getCloudProviderUsage':
      return handleGetCloudProviderUsage(message);
    case 'getProfilingStats':
      return handleGetProfilingStats();
    case 'clearProfilingStats':
      return handleClearProfilingStats();
    case 'getHistory':
      return handleGetHistory();
    case 'clearHistory':
      return handleClearHistory();
    case 'addCorrection':
      return handleAddCorrection(message);
    case 'getCorrection':
      return handleGetCorrection(message);
    case 'getAllCorrections':
      return handleGetAllCorrections();
    case 'getCorrectionStats':
      return handleGetCorrectionStats();
    case 'clearCorrections':
      return handleClearCorrections();
    case 'deleteCorrection':
      return handleDeleteCorrection(message);
    case 'exportCorrections':
      return handleExportCorrections();
    case 'importCorrections':
      return handleImportCorrections(message);
    case 'ocrImage':
      return handleOCRImage(message);
    case 'captureScreenshot':
      return handleCaptureScreenshot(message);
    case 'getDownloadedModels': {
      const models: DownloadedModelRecord[] = await getDownloadedModelInventory();
      return { success: true, models };
    }
    case 'deleteModel':
      return handleDeleteModel(message);
    case 'clearAllModels':
      return handleClearAllModels();
    case 'getSettings':
      return handleGetSettings((keys) => safeStorageGet(keys));
    default:
      return assertNever(message);
  }
}

// ============================================================================
// Chrome-Specific Handlers
// ============================================================================

/**
 * Preload model for a language pair
 */
async function handlePreloadModel(message: PreloadModelMessage): Promise<MessageResponse<PreloadModelResponsePayload>> {
  const provider = message.provider || getProvider();
  log.info(` Preloading ${provider} model: ${message.sourceLang} -> ${message.targetLang}`);
  try {
    const response = await sendToOffscreen<{
      success: boolean;
      preloaded?: boolean;
      partial?: boolean;
      available?: boolean;
      error?: string;
    }>({
      type: 'preloadModel',
      sourceLang: message.sourceLang,
      targetLang: message.targetLang,
      provider,
    });
    return response as MessageResponse<PreloadModelResponsePayload>;
  } catch (error) {
    /* v8 ignore start -- preload failure fallback */
    log.warn(' Preload failed:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
    };
    /* v8 ignore stop */
  }
}

/**
 * Clear cache — also forwards to offscreen document's cache.
 */
async function handleClearCacheWithOffscreen(): Promise<{ success: boolean; clearedEntries: number }> {
  const result = await handleClearCache(translationCache);

  // Also clear the offscreen document's translation cache
  try {
    await sendToOffscreen({ type: 'clearCache' });
  } catch {
    /* v8 ignore start */
    log.warn('Could not clear offscreen translation cache (may not be running)');
    /* v8 ignore stop */
  }

  return result;
}

/** Best-effort clear of the offscreen pipeline cache (offscreen may not be running). */
async function tryClearOffscreenPipelineCache(): Promise<void> {
  try {
    await sendToOffscreen({ type: 'clearPipelineCache' });
  } catch {
    /* v8 ignore start */
    log.warn('Could not clear offscreen pipeline cache (may not be running)');
    /* v8 ignore stop */
  }
}

type IndexedDbWithDatabases = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string }>>;
};

function getCacheStorage(): CacheStorage | null {
  return typeof globalThis.caches === 'undefined' ? null : globalThis.caches;
}

function getIndexedDbFactory(): IndexedDbWithDatabases | null {
  return typeof globalThis.indexedDB === 'undefined'
    ? null
    : globalThis.indexedDB as IndexedDbWithDatabases;
}

async function clearMatchingCaches(patterns: readonly string[]): Promise<string[] | null> {
  const cacheStorage = getCacheStorage();
  if (!cacheStorage) {
    return null;
  }

  const cacheNames = await cacheStorage.keys();
  const cleared: string[] = [];
  for (const name of cacheNames) {
    if (patterns.some((pattern) => name.includes(pattern))) {
      await cacheStorage.delete(name);
      cleared.push(name);
    }
  }
  return cleared;
}

async function clearMatchingIndexedDbDatabases(
  patterns: readonly string[]
): Promise<string[] | null> {
  const indexedDbFactory = getIndexedDbFactory();
  if (!indexedDbFactory || typeof indexedDbFactory.databases !== 'function') {
    return null;
  }

  const databases = await indexedDbFactory.databases();
  const cleared: string[] = [];
  for (const db of databases) {
    const name = db.name;
    if (name && patterns.some((pattern) => name.includes(pattern))) {
      indexedDbFactory.deleteDatabase(name);
      cleared.push(name);
    }
  }
  return cleared;
}

/**
 * Delete a specific downloaded model.
 */
async function handleDeleteModel(message: DeleteModelMessage): Promise<MessageResponse> {
  const { modelId } = message;
  log.info(`Deleting model: ${modelId}`);

  try {
    await tryClearOffscreenPipelineCache();
    await deleteDownloadedModelInventoryEntry(modelId);

    log.info(`Model ${modelId} deleted`);
    return { success: true };
  } catch (error) {
    log.error('Failed to delete model:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
    };
  }
}

/**
 * Clear all downloaded models.
 */
async function handleClearAllModels(): Promise<MessageResponse> {
  log.info('Clearing all downloaded models...');

  try {
    await tryClearOffscreenPipelineCache();
    await clearDownloadedModelInventory();

    try {
      const clearedCaches = await clearMatchingCaches(['transformers', 'onnx', 'model']);
      if (clearedCaches === null) {
        log.info('CacheStorage unavailable in service worker; skipping model cache cleanup');
      } else {
        for (const name of clearedCaches) {
          log.info(`Cleared cache: ${name}`);
        }
        log.info(`Cleared ${clearedCaches.length} model caches`);
      }
    } catch (cacheError) {
      log.warn('Model cache cleanup failed:', cacheError);
    }

    log.info('All models cleared');
    return { success: true };
  } catch (error) {
    log.error('Failed to clear all models:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
    };
  }
}

/**
 * Check if Chrome Translator API is available (Chrome 138+)
 */
async function handleCheckChromeTranslator(): Promise<{ success: true; available: boolean }> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) {
      return { success: true, available: false };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN' as chrome.scripting.ExecutionWorld,
      /* v8 ignore start */
      func: () => typeof self.Translator !== 'undefined',
      /* v8 ignore stop */
    });
    return { success: true, available: results[0]?.result === true };
  } catch (error) {
    log.debug('Chrome Translator check failed (restricted page?):', error);
    return { success: true, available: false };
  }
}

/**
 * Check WebGPU availability via the offscreen document.
 */
async function handleCheckWebGPU(): Promise<{ success: true; supported: boolean; fp16: boolean }> {
  try {
    const response = await sendToOffscreen<{
      success: boolean;
      supported: boolean;
      fp16: boolean;
    }>({ type: 'checkWebGPU' });
    return response as { success: true; supported: boolean; fp16: boolean };
  } catch (error) {
    log.debug('WebGPU check failed:', error);
    return { success: true, supported: false, fp16: false };
  }
}

/**
 * Check WebNN availability via the offscreen document.
 */
async function handleCheckWebNN(): Promise<{ success: true; supported: boolean }> {
  try {
    const response = await sendToOffscreen<{
      success: boolean;
      supported: boolean;
    }>({ type: 'checkWebNN' });
    return response as { success: true; supported: boolean };
  } catch (error) {
    log.debug('WebNN check failed:', error);
    return { success: true, supported: false };
  }
}

/**
 * Get prediction engine statistics
 */
async function handleGetPredictionStats(): Promise<MessageResponse<{ prediction: { domainCount: number; totalTranslations: number; recentTranslations: number; preferredTarget: string; topDomains: Array<{ domain: string; detections: number }> } }>> {
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

/**
 * Handle language detection recording
 */
async function handleRecordLanguageDetection(message: RecordLanguageDetectionMessage): Promise<MessageResponse> {
  await recordLanguageDetection(message.url, message.language);
  return { success: true };
}

/**
 * Get usage statistics for a cloud provider
 */
async function handleGetCloudProviderUsage(message: GetCloudProviderUsageMessage): Promise<MessageResponse<{ usage?: { tokens: number; cost: number; limitReached: boolean } }>> {
  try {
    const result = await sendToOffscreen<{
      success: boolean;
      usage?: { tokens: number; cost: number; limitReached: boolean };
      error?: string;
    }>({
      type: 'getCloudProviderUsage',
      provider: message.provider,
    });
    return result as MessageResponse<{ usage?: { tokens: number; cost: number; limitReached: boolean } }>;
  } catch (error) {
    log.warn(' Failed to get cloud provider usage:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
    };
  }
}

// ============================================================================
// Translation Handler (Chrome — uses offscreen document)
// ============================================================================

async function handleTranslate(message: {
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  options?: { strategy?: Strategy; context?: { before: string; after: string; pageContext?: string } };
  provider?: TranslationProviderId;
  enableProfiling?: boolean;
}): Promise<TranslateResponse> {
  await translationCache.load();
  const provider = message.provider || getProvider();
  const dedupKey = translationCache.getKey(message.text, message.sourceLang, message.targetLang, provider);

  // Check if in-flight requests exceed limit
  if (inFlightRequests.size >= CONFIG.inFlight.maxRequests) {
    // Delete the oldest entry (first in Map)
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
  inFlightRequests.set(dedupKey, { promise: controllablePromise, reject: rejectInFlight });

  acquireKeepAlive();
  try {
    return await controllablePromise;
  } finally {
    inFlightRequests.delete(dedupKey);
    releaseKeepAlive();
  }
}

/**
 * Inner translation handler — Chrome-specific with offscreen IPC + profiling.
 */
async function handleTranslateInner(message: {
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  options?: { strategy?: Strategy; context?: { before: string; after: string; pageContext?: string } };
  provider?: TranslationProviderId;
  enableProfiling?: boolean;
}): Promise<TranslateResponse> {
  const startTime = Date.now();

  // Profiling session
  const sessionId = message.enableProfiling ? profiler.startSession() : undefined;
  if (sessionId) {
    profiler.startTiming(sessionId, 'total');
  }

  try {
    const preparedResult = await prepareTranslationExecution(message, translationCache, {
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

    // Chrome Built-in Translator: runs in tab's main world
    if (execution.provider === 'chrome-builtin') {
      if (sessionId) profiler.startTiming(sessionId, 'chrome_builtin_translate');
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) throw new Error('No active tab for Chrome Translator');

        const texts = Array.isArray(execution.text) ? execution.text : [execution.text];
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
          /* v8 ignore start — runs in tab's main world via executeScript, not in service-worker context */
          func: async (textsToTranslate: string[], srcLang: string, tgtLang: string) => {
            const TranslatorAPI = self.Translator;
            if (!TranslatorAPI) {
              throw new Error('Chrome Translator API not available (requires Chrome 138+)');
            }
            const avail = await TranslatorAPI.availability({ sourceLanguage: srcLang, targetLanguage: tgtLang });
            if (avail.available === 'no') {
              throw new Error(`Language pair not supported: ${srcLang}-${tgtLang}`);
            }
            const t = await TranslatorAPI.create({ sourceLanguage: srcLang, targetLanguage: tgtLang });
            const translated: string[] = [];
            for (const txt of textsToTranslate) {
              translated.push(txt.trim() ? await t.translate(txt) : txt);
            }
            t.destroy();
            return translated;
          },
          /* v8 ignore stop */
          args: [texts, execution.message.sourceLang, execution.message.targetLang],
        });

        if (sessionId) profiler.endTiming(sessionId, 'chrome_builtin_translate');
        const translated = results[0]?.result as string[] | undefined;
        if (!translated) throw new Error('Chrome Translator returned no result');

        const result = Array.isArray(execution.text) ? translated : translated[0];
        return finalizeTranslationExecution(
          execution,
          translationCache,
          result,
          {
            responsePatch: { provider: 'chrome-builtin' },
            recordUsage: false,
            cacheSourceLang: execution.message.sourceLang,
            onAfterCacheStore: () => {
              if (sessionId) profiler.endTiming(sessionId, 'total');
            },
          },
        );
      } catch (error) {
        if (sessionId) {
          profiler.endTiming(sessionId, 'chrome_builtin_translate');
          profiler.endTiming(sessionId, 'total');
        }
        const errMsg = extractErrorMessage(error);

        log.error('Chrome Built-in translation failed:', errMsg);
        return { success: false, error: errMsg, duration: Date.now() - startTime };
      }
    }

    // Offscreen IPC translation
    if (sessionId) profiler.startTiming(sessionId, 'ipc_background_to_offscreen');

    const response = await withRetry(
      async () => {
        const result = await sendToOffscreen<{
          success: boolean;
          result?: string | string[];
          error?: unknown;
          profilingData?: object;
        }>({
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
          /* v8 ignore start -- typeof + instanceof ternary chain + || */
          const errorMsg = typeof result.error === 'string'
            ? result.error
            : result.error instanceof Error
              ? result.error.message
              : JSON.stringify(result.error) || 'Translation failed';
          /* v8 ignore stop */
          throw new Error(errorMsg);
        }

        return result;
      },
      NETWORK_RETRY_CONFIG,
      (error: TranslationError) => {
        return error.retryable !== false && !!(error.technicalDetails);
      }
    );

    if (sessionId) {
      profiler.endTiming(sessionId, 'ipc_background_to_offscreen');

      if (response.profilingData) {
        profiler.importSessionData(response.profilingData);
      }
    }
    if (response.result === undefined) {
      throw new Error('Translation engine returned no result');
    }
    return finalizeTranslationExecution(
      execution,
      translationCache,
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
        onSuccess: ({ execution: successfulExecution, result }) => {
          /* v8 ignore start -- fire-and-forget */
          recordTranslation(successfulExecution.message.targetLang).catch((err: unknown) => {
            log.debug('recordTranslation skipped:', err);
          });
          /* v8 ignore stop */

          if (typeof successfulExecution.text === 'string' && typeof result === 'string') {
            recordTranslationToHistory(
              successfulExecution.text,
              result,
              successfulExecution.message.sourceLang,
              successfulExecution.message.targetLang,
            );
          }

          if (!sessionId) {
            return;
          }

          const report = profiler.getReport(sessionId);
          if (!report) {
            return;
          }

          log.info(profiler.formatReport(sessionId));
          return { profilingReport: report };
        },
      },
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

// ============================================================================
// Profiling Handlers (Chrome-specific — offscreen profiling)
// ============================================================================

async function handleGetProfilingStats(): Promise<MessageResponse<{ aggregates: Record<string, AggregateStats>; formatted: string }>> {
  try {
    const localStats = profiler.getAllAggregates();

    let offscreenStats: Record<string, AggregateStats> = {};
    try {
      const offscreenResult = await sendToOffscreen<{
        success: boolean;
        aggregates?: Record<string, AggregateStats>;
        formatted?: string;
      }>({
        type: 'getProfilingStats',
      });
      if (offscreenResult?.success && offscreenResult.aggregates) {
        offscreenStats = offscreenResult.aggregates;
      }
    } catch {
      // Offscreen may not be available; continue with local stats only
      log.debug('Offscreen not available for profiling stats merge');
    }

    const mergedStats = { ...localStats, ...offscreenStats };

    return {
      success: true,
      aggregates: mergedStats,
      formatted: profiler.formatAggregates(),
    };
  } catch (error) {
    log.warn('Failed to get profiling stats:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
    };
  }
}

function handleClearProfilingStats(): MessageResponse {
  profiler.clear();
  log.info('Profiling stats cleared');
  return { success: true };
}

// ============================================================================
// Providers Handler (Chrome — gets languages from offscreen)
// ============================================================================

async function handleGetProviders(): Promise<{ providers: typeof PROVIDER_LIST; activeProvider: TranslationProviderId; strategy: Strategy; supportedLanguages: Array<{ src: string; tgt: string }>; error?: string }> {
  try {
    const response = await sendToOffscreen<{
      success: boolean;
      languages?: Array<{ src: string; tgt: string }>;
    }>({
      type: 'getSupportedLanguages',
    });

    return {
      providers: [...PROVIDER_LIST],
      activeProvider: getProvider(),
      strategy: getStrategy(),
      supportedLanguages: response.success ? (response.languages ?? []) : [],
    };
  } catch (error) {
    /* v8 ignore start -- defensive fallback when offscreen language fetch fails */
    log.warn(' Error getting providers:', error);

    return {
      providers: [...PROVIDER_LIST],
      activeProvider: getProvider(),
      strategy: getStrategy(),
      supportedLanguages: [],
      error: 'Could not load language list. Translation may still work.',
    };
    /* v8 ignore stop */
  }
}

// ============================================================================
// OCR
// ============================================================================

async function handleOCRImage(message: OCRImageMessage): Promise<MessageResponse<{ text?: string; confidence?: number; blocks?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }>> {
  try {
    log.info('Processing OCR request...');

    const result = await sendToOffscreen<{
      success: boolean;
      text?: string;
      confidence?: number;
      blocks?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
      error?: string;
    }>({
      type: 'ocrImage',
      imageData: message.imageData,
      lang: message.lang,
    });

    if (result.success) {
      log.info(`OCR completed: ${result.blocks?.length || 0} blocks, ${result.confidence?.toFixed(1)}% confidence`);
    }

    return result as MessageResponse<{ text?: string; confidence?: number; blocks?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }>;
  } catch (error) {
    log.error('OCR failed:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

// ============================================================================
// Screenshot Capture
// ============================================================================

async function handleCaptureScreenshot(message: CaptureScreenshotMessage): Promise<MessageResponse<{ imageData: string }>> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });

    if (message.rect) {
      const cropResponse = await sendToOffscreen<{
        success: boolean;
        imageData?: string;
        error?: string;
      }>({
        type: 'cropImage',
        imageData: dataUrl,
        rect: message.rect,
        devicePixelRatio: message.devicePixelRatio || 1,
      });

      return { success: true, imageData: cropResponse.imageData ?? dataUrl };
    }

    return { success: true, imageData: dataUrl };
  } catch (error) {
    log.error('Screenshot capture failed:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
    };
  }
}

// ============================================================================
// Reliable Tab Messaging (Chrome-specific)
// ============================================================================

async function sendMessageToTab(tabId: number, message: ContentCommand): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (firstError) {
    const errMsg = extractErrorMessage(firstError);

    if (!errMsg.includes('establish connection') && !errMsg.includes('Receiving end does not exist')) {
      throw firstError;
    }

    log.info(`Content script not ready in tab ${tabId}, injecting...`);

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/index.js'],
      });

      await sleep(200);

      await chrome.tabs.sendMessage(tabId, message);
      log.info(`Message delivered to tab ${tabId} after injection`);
    } catch (injectError) {
      const injectMsg = extractErrorMessage(injectError);
      log.warn(`Cannot inject content script into tab ${tabId}: ${injectMsg}`);
      throw new Error(`Translation not available on this page. ${injectMsg}`);
    }
  }
}

// ============================================================================
// Context Menus
// ============================================================================

function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'translate-selection',
      title: 'Translate Selection',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: 'translate-page',
      title: 'Translate Page',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['page', 'selection'],
    });

    chrome.contextMenus.create({
      id: 'undo-translation',
      title: 'Undo Translation',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'translate-image',
      title: 'Translate Image Text',
      contexts: ['image'],
    });

    log.info('Context menus created');
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const settings = await getActionSettings();

  try {
    switch (info.menuItemId) {
      case 'translate-selection':
        await sendMessageToTab(tab.id, {
          type: 'translateSelection',
          ...settings,
        });
        break;

      case 'translate-page':
        await sendMessageToTab(tab.id, {
          type: 'translatePage',
          ...settings,
        });
        break;

      case 'undo-translation':
        await sendMessageToTab(tab.id, {
          type: 'undoTranslation',
        });
        break;

      case 'translate-image':
        await sendMessageToTab(tab.id, {
          type: 'translateImage',
          imageUrl: info.srcUrl,
          ...settings,
        });
        break;
    }
  } catch (error) {
    log.warn('Context menu action failed:', error);
  }
});

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

chrome.commands.onCommand.addListener(async (command, tab) => {
  log.info('Command received:', command);

  if (!tab?.id) return;

  const settings = await getActionSettings();

  try {
    switch (command) {
      case 'translate-page':
        await sendMessageToTab(tab.id, {
          type: 'translatePage',
          ...settings,
        });
        break;

      case 'translate-selection':
        await sendMessageToTab(tab.id, {
          type: 'translateSelection',
          ...settings,
        });
        break;

      case 'undo-translation':
        await sendMessageToTab(tab.id, {
          type: 'undoTranslation',
        });
        break;

      case 'toggle-widget':
        await sendMessageToTab(tab.id, {
          type: 'toggleWidget',
        });
        break;

      case 'screenshot-translate':
        await sendMessageToTab(tab.id, {
          type: 'enterScreenshotMode',
        });
        break;
    }
  } catch (error) {
    log.warn('Keyboard shortcut action failed:', error);
  }
});

// Tab update listener for predictive model preloading
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    log.debug(`Tab updated: ${tab.url}`);

    /* v8 ignore start */
    preloadPredictedModels(tab.url).catch((error) => {
      log.warn('Predictive preload trigger failed:', error);
    });
    /* v8 ignore stop */
  }
});

// Extension icon click handler
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    log.info('Extension icon clicked for tab:', tab.id);
  }
});

// ============================================================================
// Installation Handler
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  setupContextMenus();

  if (details.reason === 'install') {
    log.info('Extension installed');

    const stored = await safeStorageGet<{ onboardingComplete?: boolean }>('onboardingComplete');
    if (!stored.onboardingComplete) {
      log.info('Opening onboarding page');
      chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/index.html') });
    }

    const browserLang = chrome.i18n.getUILanguage().split('-')[0];
    log.info('Browser language detected:', browserLang);
    /* v8 ignore start -- browserLang || default */
    try {
      await strictStorageSet({
        sourceLang: 'auto',
        targetLang: browserLang || 'en',
        strategy: 'smart',
        provider: DEFAULT_PROVIDER_ID,
      });
    } catch (error) {
      log.error('Failed to persist install defaults:', error);
    }
    /* v8 ignore stop */
  /* v8 ignore start -- else-if branch: update reason */
  } else if (details.reason === 'update') {
  /* v8 ignore stop */
    log.info('Extension updated from', details.previousVersion);

    try {
      const clearedCaches = await clearMatchingCaches(['transformers', 'onnx', 'huggingface']);
      if (clearedCaches === null) {
        log.info('CacheStorage unavailable during update cleanup; skipping model cache cleanup');
      } else if (clearedCaches.length > 0) {
        log.info(`Cleared ${clearedCaches.length} model caches on update`);
      }

      const clearedDatabases = await clearMatchingIndexedDbDatabases([
        'transformers',
        'onnx',
        'huggingface',
      ]);
      if (clearedDatabases === null) {
        log.info('IndexedDB database listing unavailable during update cleanup; skipping database cleanup');
      } else {
        for (const name of clearedDatabases) {
          log.info(`Cleared IndexedDB: ${name}`);
        }
      }
    } catch (error) {
      log.warn('Update cache cleanup failed:', error);
    }
  }
});

// ============================================================================
// Startup
// ============================================================================

// Load saved provider on startup, auto-detect Chrome Built-in availability
/* v8 ignore start — module-level IIFE runs at import time, before test mocks are configured */
(async () => {
  const result = await safeStorageGet<{ provider?: unknown }>(['provider']);
  if (result.provider !== undefined) {
    const restoredProvider = normalizeTranslationProviderId(result.provider);
    if (result.provider === 'opus-mt-local') {
      log.info('Migrated legacy stored provider alias to opus-mt');
    } else if (restoredProvider !== result.provider) {
      log.warn('Ignoring invalid stored provider:', result.provider);
    }
    setProvider(restoredProvider);
    log.info('Restored provider:', getProvider());
  } else {
    log.info(`No stored provider found, using default ${DEFAULT_PROVIDER_ID}`);
  }

  // Auto-detect Chrome Built-in Translator
  try {
    if (getProvider() === DEFAULT_PROVIDER_ID) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId) {
        const detection = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
          func: () => {
            return typeof self.Translator !== 'undefined';
          },
        });
        const chromeBuiltinAvailable = detection[0]?.result === true;
        if (chromeBuiltinAvailable) {
          setProvider('chrome-builtin');
          await safeStorageSet({ provider: 'chrome-builtin' });
          log.info('Auto-detected Chrome Built-in Translator, setting as default');
        }
      }
    }
  } catch (error) {
    log.debug('Chrome Built-in auto-detection skipped:', error);
  }
})();

// Pre-warm the offscreen document
chrome.runtime.onStartup.addListener(() => {
  log.info('Extension startup, pre-warming offscreen document...');
  ensureOffscreenDocument().catch((error) => {
    log.warn(' Pre-warm failed (will retry on first use):', error);
  });
});

// Initialize prediction engine
(async () => {
  try {
    await predictionEngine.load();
    log.info('Prediction engine initialized');
  } catch (error) {
    log.warn('Failed to initialize prediction engine:', error);
  }
})();

// Flush pending cache writes when service worker is about to shut down.
if (chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    log.info('Service worker suspending, flushing cache...');
    translationCache.flush();
  });
}
/* v8 ignore stop */

log.info('Service worker initialized v2.3 with predictive model preloading');
