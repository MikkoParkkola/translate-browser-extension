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
  ExtensionMessage, ExtensionMessageResponse, TranslationProviderId, ContentCommand,
  RecordLanguageDetectionMessage,
  GetCloudProviderUsageMessage, OCRImageMessage, CaptureScreenshotMessage,
  DeleteModelMessage, DownloadedModelRecord, MessageResponse,
} from '../types';
import {
  extractErrorMessage,
} from '../core/errors';
import { createLogger } from '../core/logger';
import { safeStorageGet, safeStorageSet, strictStorageSet } from '../core/storage';
import { getPredictionEngine } from '../core/prediction-engine';
import { CONFIG } from '../config';
import { profiler } from '../core/profiler';
import { sleep } from '../core/async-utils';
import { splitIntoSentences } from '../core/text-utils';
import { DEFAULT_PROVIDER_ID } from '../shared/provider-options';
import {
  assertNever,
} from './shared/message-routing';

// Shared modules — extracted from duplicated Chrome/Firefox logic
import {
  createTranslationCache,
  type StorageAdapter,
  type TranslationCache,
  getProvider,
  setProvider,
  getStrategy,
  getDownloadedModelInventory,
  clearDownloadedModelInventory,
  deleteDownloadedModelInventoryEntry,
  handleClearCache,
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
  createContextMenuClickHandler,
  createKeyboardShortcutHandler,
  PROVIDER_LIST,
  createTranslationBackgroundHandler,
  type TranslationBackgroundHandler,
  createRuntimeInfoHandlers,
  createOffscreenTransport,
  relayModelProgress,
  upsertDownloadedModelInventory,
  clearMatchingCaches,
  clearMatchingIndexedDbDatabases,
  createInstallationHandler,
  restorePersistedProvider,
  COMMON_BACKGROUND_MESSAGE_TYPES,
  isCommonBackgroundMessage,
  createBackgroundMessageGuard,
  createBackgroundMessageListener,
  createCommonBackgroundMessageDispatcher,
  createPreloadModelHandler,
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

// Translation request dedup/reset handling is managed by the shared background
// translation handler so offscreen resets can reject any pending requests.
let rejectInFlightRequestsForOffscreenReset: (error: Error) => number = () => 0;

const offscreenTransport = createOffscreenTransport({
  log,
  rejectInFlightRequests: (error) => rejectInFlightRequestsForOffscreenReset(error),
});

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

      offscreenTransport.send<'preloadModel'>({
        type: 'preloadModel',
        sourceLang: prediction.sourceLang,
        targetLang: prediction.targetLang,
        provider: getProvider(),
        priority: 'low',
      })
        .then((response) => {
          if (response.success && response.preloaded) {
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

async function runChromeBuiltinTranslation(
  text: string | string[],
  sourceLang: string,
  targetLang: string
): Promise<string | string[]> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) {
    throw new Error('No active tab for Chrome Translator');
  }

  const texts = Array.isArray(text) ? text : [text];
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
    args: [texts, sourceLang, targetLang],
  });

  const translated = results[0]?.result as string[] | undefined;
  if (!translated) {
    throw new Error('Chrome Translator returned no result');
  }

  return Array.isArray(text) ? translated : translated[0];
}

const translationBackgroundHandler: TranslationBackgroundHandler =
  createTranslationBackgroundHandler({
    cache: translationCache,
    getProvider,
    offscreenTransport,
    profiler,
    acquireKeepAlive,
    releaseKeepAlive,
    recordTranslation,
    recordTranslationToHistory,
    runChromeBuiltinTranslation,
    log,
  });

const handleTranslate = translationBackgroundHandler.handleTranslate;
rejectInFlightRequestsForOffscreenReset = translationBackgroundHandler.rejectInFlightRequests;

// ============================================================================
// Message Handler
// ============================================================================

chrome.runtime.onMessage.addListener(createBackgroundMessageListener({
  extensionUrlPrefix: 'chrome-extension://',
  isHandledMessage: isServiceWorkerHandledMessage,
  dispatch: handleMessage,
  log,
  errorLogPrefix: ' ',
  logUnknownMessage: (type) => log.warn(` Unknown message type: ${type}`),
  beforeRoute: ({ message, sender, sendResponse }) => {
    if (isOffscreenModelMessage(message)) {
      if (!offscreenTransport.isSender(sender)) {
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

    if (message.type === 'translate') {
      if (
        (typeof message.text !== 'string' && !Array.isArray(message.text))
        || typeof message.sourceLang !== 'string'
        || typeof message.targetLang !== 'string'
      ) {
        sendResponse({ success: false, error: 'Invalid translation parameters' });
        return true;
      }
    }

    return undefined;
  },
}));

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
  ...COMMON_BACKGROUND_MESSAGE_TYPES,
  'getPredictionStats',
  'recordLanguageDetection',
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
  return createBackgroundMessageGuard(SERVICE_WORKER_MESSAGE_TYPES)(message);
}

const handlePreloadModel = createPreloadModelHandler({
  log,
  getProvider,
  logPrefix: ' ',
  preloadModel: async (message, provider) => offscreenTransport.send<'preloadModel'>({
    type: 'preloadModel',
    sourceLang: message.sourceLang,
    targetLang: message.targetLang,
    provider,
  }),
});

const {
  handleGetProfilingStats,
  handleClearProfilingStats,
  handleGetProviders,
  handleCheckChromeTranslator,
  handleCheckWebGPU,
  handleCheckWebNN,
} = createRuntimeInfoHandlers({
  getProvider,
  getStrategy,
  providerList: PROVIDER_LIST,
  offscreenTransport,
  profiler,
  log,
  getActiveTabId: async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id;
  },
  probeChromeTranslator: async (tabId) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN' as chrome.scripting.ExecutionWorld,
      /* v8 ignore start */
      func: () => typeof self.Translator !== 'undefined',
      /* v8 ignore stop */
    });
    return { success: true, available: results[0]?.result === true } as const;
  },
});

const dispatchCommonMessage = createCommonBackgroundMessageDispatcher({
  translationCache,
  getProvider,
  handleTranslate,
  handleGetProviders,
  handlePreloadModel,
  handleClearCache: handleClearCacheWithOffscreen,
  handleCheckChromeTranslator,
  handleCheckWebGPU,
  handleCheckWebNN,
});

async function handleMessage(message: ServiceWorkerHandledMessage): Promise<ServiceWorkerHandledResponse> {
  if (isCommonBackgroundMessage(message)) {
    return dispatchCommonMessage(message);
  }

  switch (message.type) {
    case 'getPredictionStats':
      return handleGetPredictionStats();
    case 'recordLanguageDetection':
      return handleRecordLanguageDetection(message);
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
 * Clear cache — also forwards to offscreen document's cache.
 */
async function handleClearCacheWithOffscreen(): Promise<{ success: boolean; clearedEntries: number }> {
  const result = await handleClearCache(translationCache);

  // Also clear the offscreen document's translation cache
  try {
    await offscreenTransport.send({ type: 'clearCache' });
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
    await offscreenTransport.send({ type: 'clearPipelineCache' });
  } catch {
    /* v8 ignore start */
    log.warn('Could not clear offscreen pipeline cache (may not be running)');
    /* v8 ignore stop */
  }
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
    const result = await offscreenTransport.send<'getCloudProviderUsage'>({
      type: 'getCloudProviderUsage',
      provider: message.provider,
    });
    return result;
  } catch (error) {
    log.warn(' Failed to get cloud provider usage:', error);
    return {
      success: false,
      error: extractErrorMessage(error),
    };
  }
}

// ============================================================================
// OCR
// ============================================================================

async function handleOCRImage(message: OCRImageMessage): Promise<MessageResponse<{ text?: string; confidence?: number; blocks?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }>> {
  try {
    log.info('Processing OCR request...');

    const result = await offscreenTransport.send<'ocrImage'>({
      type: 'ocrImage',
      imageData: message.imageData,
      lang: message.lang,
    });

    if (result.success) {
      log.info(`OCR completed: ${result.blocks?.length || 0} blocks, ${result.confidence?.toFixed(1)}% confidence`);
    }

    return result;
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
      const cropResponse = await offscreenTransport.send<'cropImage'>({
        type: 'cropImage',
        imageData: dataUrl,
        rect: message.rect,
        devicePixelRatio: message.devicePixelRatio || 1,
      });

      return {
        success: true,
        imageData: cropResponse.success ? cropResponse.imageData : dataUrl,
      };
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

chrome.contextMenus.onClicked.addListener(createContextMenuClickHandler({
  getActionSettings,
  sendMessageToTab,
  log,
}));

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

chrome.commands.onCommand.addListener(createKeyboardShortcutHandler({
  getActionSettings,
  sendMessageToTab,
  log,
}));

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

chrome.runtime.onInstalled.addListener(createInstallationHandler({
  log,
  setupContextMenus,
  getUiLanguage: () => chrome.i18n.getUILanguage(),
  getOnboardingComplete: async () => {
    const stored = await safeStorageGet<{ onboardingComplete?: boolean }>('onboardingComplete');
    return stored.onboardingComplete === true;
  },
  openOnboardingPage: () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/index.html') });
  },
  persistInstallDefaults: async (browserLang) => {
    /* v8 ignore start -- browserLang || default */
    await strictStorageSet({
      sourceLang: 'auto',
      targetLang: browserLang || 'en',
      strategy: 'smart',
      provider: DEFAULT_PROVIDER_ID,
    });
    /* v8 ignore stop */
  },
  onUpdate: async () => {
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
  },
}));

// ============================================================================
// Startup
// ============================================================================

// Load saved provider on startup, auto-detect Chrome Built-in availability
/* v8 ignore start — module-level IIFE runs at import time, before test mocks are configured */
(async () => {
  await restorePersistedProvider({
    log,
    defaultProvider: DEFAULT_PROVIDER_ID,
    readStoredProvider: async () => {
      const result = await safeStorageGet<{ provider?: unknown }>(['provider']);
      return result.provider;
    },
    setProvider,
    getProvider,
  });

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
  offscreenTransport.ensureDocument().catch((error) => {
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
