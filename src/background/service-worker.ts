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
  ExtensionMessage, ExtensionMessageResponse,
  DownloadedModelRecord,
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
  createDiagnosticsHandlers,
  createMediaHandlers,
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
  createPredictionPreloadHandler,
  createStreamPortHandler,
  createTabMessageSender,
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

const { handleTabUpdated } = createPredictionPreloadHandler({
  log,
  predictionEngine,
  getProvider,
  maxPreloaded: CONFIG.inFlight.maxPreloaded,
  preloadModel: async (message) => offscreenTransport.send<'preloadModel'>(message),
});

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

chrome.runtime.onConnect.addListener(createStreamPortHandler({
  getProvider,
  handleTranslate,
  acquireKeepAlive,
  releaseKeepAlive,
  splitIntoSentences,
  log,
}));


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

const {
  handleClearCacheWithOffscreen,
  handleGetPredictionStats,
  handleRecordLanguageDetection,
  handleGetCloudProviderUsage,
} = createDiagnosticsHandlers({
  cache: translationCache,
  predictionEngine,
  offscreenTransport,
  log,
});

const {
  handleDeleteModel,
  handleClearAllModels,
  handleOCRImage,
  handleCaptureScreenshot,
} = createMediaHandlers({
  offscreenTransport,
  captureVisibleTab: (options) => chrome.tabs.captureVisibleTab(options),
  deleteDownloadedModelInventoryEntry,
  clearDownloadedModelInventory,
  clearMatchingCaches,
  log,
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
// Reliable Tab Messaging (Chrome-specific)
// ============================================================================

const sendMessageToTab = createTabMessageSender({
  log,
  sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  injectContentScript: (tabId) => chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/content/index.js'],
  }),
  waitForContentScriptReady: () => sleep(200),
});

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
chrome.tabs.onUpdated.addListener(handleTabUpdated);

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
