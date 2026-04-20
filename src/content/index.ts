/**
 * Content Script
 * Handles DOM scanning and text replacement for translations
 *
 * Features:
 * - MutationObserver for dynamic content
 * - Graceful degradation on translation failures
 * - Skip untranslatable elements (scripts, styles, inputs)
 * - Throttled translation to prevent rate limiting
 * - Per-site rules for automatic translation preferences
 * - Glossary support for custom term replacements
 */

import type { Strategy, TranslationProviderId } from '../types';
import { extractErrorMessage } from '../core/errors';
import { siteRules } from '../core/site-rules';
import { glossary } from '../core/glossary';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';
import { safeStorageGet } from '../core/storage';
import { browserAPI } from '../core/browser-api';
import { isPdfPage, initPdfTranslation, cleanupPdfTranslation } from './pdf-translator';
import {
  getDeepSelection,
  installAttachShadowInterceptor,
} from './shadow-dom-walker';
import { createMutationOrchestrator } from './mutation-orchestrator';
// measureTimeAsync imported for future use in async profiling
// import { measureTimeAsync } from '../core/profiler';
import { createPageTranslationOrchestrator } from './page-translation-orchestrator';
import {
  AUTO_TRANSLATE_E2E_REQUEST_EVENT,
  AUTO_TRANSLATE_E2E_RESPONSE_EVENT,
  AUTO_TRANSLATE_DIAGNOSTICS_ATTR,
  CONTENT_SCRIPT_READY_ATTR,
  type AutoTranslateDiagnostics,
  type ContentMessageResponse,
} from './content-types';
import {
  defineImmediateContentHandler,
  defineStartedContentHandler,
  routeContentMessage,
  type ContentMessageHandlers,
} from './message-routing';
import {
  showInfoToast,
  removeProgressToast,
} from './toast';
import { injectContentStyles } from './styles';
import {
  isValidText,
  sanitizeText,
} from './dom-utils';
import { getSelectionContext } from './context';
import { showTranslationTooltip, showErrorTooltip } from './tooltip';
import {
  setResolveSourceLang as widgetSetResolveSourceLang,
  removeWidgetDragListeners,
  showFloatingWidget,
  toggleFloatingWidget,
} from './widget';
import {
  setGetCurrentSettings as screenshotSetGetCurrentSettings,
  enterScreenshotMode,
} from './screenshot-ocr';
import {
  setGetCurrentSettings as imageSetGetCurrentSettings,
  translateImage,
  clearImageOverlays,
} from './image-translator';
import {
  setResolveSourceLang as hoverSetResolveSourceLang,
  initHoverListeners,
  cleanupHoverListeners,
} from './hover';
import {
  enableBilingualMode,
  disableBilingualMode,
  toggleBilingualMode,
  getBilingualModeState,
} from './bilingual';
import {
  resolveSourceLang,
  detectSampledLanguage,
  translateWithStreaming,
} from './translation-helpers';
import {
  maybeTranslatePageWithSiteTool,
  maybeTranslateSelectionWithSiteTool,
  registerTranslationWebMcpTools,
  unregisterTranslationWebMcpTools,
  type PageToolSummary,
  type TranslationWebMcpHandlers,
} from './webmcp';

const log = createLogger('Content');

// Install shadow root interceptor ASAP to capture closed roots created during
// page initialization. Content script runs at document_idle, so any shadow roots
// created after this point will be intercepted. The interceptor is idempotent —
// calling it again in startMutationObserver is safe.
installAttachShadowInterceptor();

// ============================================================================
// Page Translation Orchestrator
// ============================================================================

// pageOrchestrator owns all page-translation state and the full state machine.
// stopMutationObserver is a function declaration (hoisted), so it can be passed
// as a callback here before its own body runs at module evaluation time.
const pageOrchestrator = createPageTranslationOrchestrator({
  onStopMutationObserver: stopMutationObserver,
});

// ============================================================================
// Module Dependency Injection
// ============================================================================

// Provide currentSettings getter to modules that need it
/* v8 ignore start -- DI closures */
screenshotSetGetCurrentSettings(() => pageOrchestrator.getCurrentSettings());
imageSetGetCurrentSettings(() => pageOrchestrator.getCurrentSettings());
/* v8 ignore stop */

// Provide resolveSourceLang to modules that need it
widgetSetResolveSourceLang(resolveSourceLang);
hoverSetResolveSourceLang(resolveSourceLang);

// Register hover listeners and inject UI styles
initHoverListeners();
injectContentStyles();

// ============================================================================
// Translation Functions
// ============================================================================

/**
 * Translate selected text with error handling
 */
async function translateSelection(
  sourceLang: string,
  targetLang: string,
  strategy: Strategy,
  provider?: TranslationProviderId,
  options: {
    agentInvoked?: boolean;
    showTooltip?: boolean;
  } = {}
): Promise<string | null> {
  const showTooltip = options.showTooltip ?? true;

  // Use deep selection to find text in shadow DOMs (e.g., LinkedIn chat)
  const selection = getDeepSelection();
  if (!selection || selection.isCollapsed) {
    log.info(' No text selected (checked main document + shadow roots)');
    if (showTooltip) showInfoToast('Select text to translate');
    return null;
  }

  const text = selection.toString().trim();
  if (!isValidText(text)) {
    log.info(' Selected text is not valid for translation');
    if (showTooltip) showInfoToast('Select text to translate');
    return null;
  }

  const sanitized = sanitizeText(text);
  const range = selection.getRangeAt(0);

  // Prevent recursive delegation when the extension's own WebMCP tool executes.
  if (!options.agentInvoked) {
    const siteToolResult = await maybeTranslateSelectionWithSiteTool({
      sourceLang,
      targetLang,
      strategy,
      provider: provider as TranslationProviderId | undefined,
      text: sanitized,
    });
    if (siteToolResult) {
      log.info(` Translated selection via site tool '${siteToolResult.toolName}'`);
      if (showTooltip) showTranslationTooltip(siteToolResult.translatedText, range);
      return siteToolResult.translatedText;
    }
  }

  // Get surrounding context for better translation of ambiguous words
  const context = getSelectionContext();
  const resolvedSourceLang = resolveSourceLang(sourceLang, sanitized);

  log.info('Translating selection with context:', {
    text: sanitized.substring(0, 50),
    contextBefore: context?.before?.substring(0, 30),
    contextAfter: context?.after?.substring(0, 30),
  });

  try {
    // Apply glossary pre-processing
    const g = await pageOrchestrator.loadGlossary();
    const { processedText, restore } = await glossary.applyGlossary(sanitized, g);

    // Use port-based streaming for long texts so the tooltip updates progressively.
    if (processedText.length >= CONFIG.selection.streamThresholdChars) {
      try {
        const result = await translateWithStreaming(
          processedText,
          resolvedSourceLang,
          targetLang,
          provider,
          (partial) => {
            if (showTooltip) {
              showTranslationTooltip(restore(partial), range, /* streaming */ true);
            }
          },
        );
        const finalResult = restore(result);
        if (showTooltip) showTranslationTooltip(finalResult, range);
        return finalResult;
      } catch (streamError) {
        log.debug('Streaming failed, falling back to sendMessage:', streamError);
        // Fall through to the regular sendMessage path below
      }
    }

    const response = (await browserAPI.runtime.sendMessage({
      type: 'translate',
      text: processedText,
      sourceLang: resolvedSourceLang,
      targetLang,
      options: {
        strategy,
        context: context || undefined,
      },
      provider,
    })) as { success: boolean; result?: unknown; error?: string };

    if (response.success && response.result) {
      // Apply glossary post-processing (restore placeholders)
      const finalResult = restore(response.result as string);
      if (showTooltip) showTranslationTooltip(finalResult, range);
      return finalResult;
    } else {
      log.error(' Translation failed:', response.error);
      if (showTooltip) {
        showErrorTooltip(response.error || 'Translation failed', range);
        return null;
      }
      throw new Error(response.error || 'Translation failed');
    }
  } catch (error) {
    log.error(' Translation error:', error);
    const message = extractErrorMessage(error, 'Unknown error');
    if (showTooltip) {
      showErrorTooltip(message, range);
      return null;
    }
    throw error;
  }
}

async function translatePageContent(
  sourceLang: string,
  targetLang: string,
  strategy: Strategy,
  provider?: TranslationProviderId,
  options: {
    agentInvoked?: boolean;
  } = {}
): Promise<PageToolSummary & { handledBy: 'extension' | 'site-tool' | 'pdf' }> {
  if (isPdfPage()) {
    await initPdfTranslation(targetLang);
    return { translatedCount: 0, errorCount: 0, handledBy: 'pdf' };
  }

  // Prevent recursive self-invocation once the extension registers its own tools.
  if (!options.agentInvoked) {
    const siteToolResult = await maybeTranslatePageWithSiteTool({
      sourceLang,
      targetLang,
      strategy,
      provider,
    });
    if (siteToolResult) {
      log.info(` Translated page via site tool '${siteToolResult.toolName}'`);
      stopMutationObserver();
      pageOrchestrator.setCurrentSettings(null);
      return { translatedCount: 0, errorCount: 0, handledBy: 'site-tool' };
    }
  }

  const resolvedSourceLang = resolveSourceLang(sourceLang);
  pageOrchestrator.setCurrentSettings({
    sourceLang: resolvedSourceLang,
    targetLang,
    strategy,
    provider,
  });

  const summary = await pageOrchestrator.translatePage(
    resolvedSourceLang,
    targetLang,
    strategy,
    provider
  );
  startMutationObserver();
  return { ...summary, handledBy: 'extension' };
}

function detectCurrentPageLanguage(text?: string): { lang: string; confidence: number } | null {
  const selectionText = getDeepSelection()?.toString();
  const selectedText = text ?? (selectionText?.trim() || undefined);
  return detectSampledLanguage(selectedText);
}

const translationWebMcpHandlers: TranslationWebMcpHandlers = {
  translatePage: async ({ sourceLang, targetLang, strategy, provider }) => {
    const result = await translatePageContent(sourceLang, targetLang, strategy, provider, {
      agentInvoked: true,
    });
    return {
      translatedCount: result.translatedCount,
      errorCount: result.errorCount,
    };
  },
  translateSelection: async ({ sourceLang, targetLang, strategy, provider }) =>
    translateSelection(sourceLang, targetLang, strategy, provider, {
      agentInvoked: true,
      showTooltip: false,
    }),
  detectLanguage: async (text) => detectCurrentPageLanguage(text),
};

function installWebMcpE2eHook(handlers: TranslationWebMcpHandlers): void {
  if (!window.location.pathname.endsWith('/e2e/webmcp-harness.html')) return;

  (window as Window & {
    __translateWebMcpTest?: {
      registerTools: () => Promise<boolean>;
      unregisterTools: () => Promise<void>;
    };
  }).__translateWebMcpTest = {
    registerTools: () => registerTranslationWebMcpTools(handlers),
    unregisterTools: () => unregisterTranslationWebMcpTools(),
  };
}

installWebMcpE2eHook(translationWebMcpHandlers);
installAutoTranslateE2eBridge();
void registerTranslationWebMcpTools(translationWebMcpHandlers);

// ============================================================================
// MutationObserver for Dynamic Content
// ============================================================================

const mutationOrchestrator = createMutationOrchestrator({
  log,
  config: CONFIG,
  onNodesAdded: (nodes) => {
    void pageOrchestrator.translateDynamicContent(nodes);
  },
});

/**
 * Start observing DOM mutations for auto-translation.
 * Also starts shadow root observation so mutations inside web components
 * are captured for dynamic translation.
 */
function startMutationObserver(): void {
  mutationOrchestrator.start();
}

/**
 * Stop observing DOM mutations (including shadow root observers)
 */
function stopMutationObserver(): void {
  mutationOrchestrator.stop();
  pageOrchestrator.stopBelowFoldObserver();
  removeProgressToast();
}

// ============================================================================
// Message Handling
// ============================================================================

function logContentMessageFailure(action: string, error: unknown, fallbackMessage: string): void {
  const msg = extractErrorMessage(error, fallbackMessage);
  log.error(`${action} failed:`, msg);
}

type AutoTranslateStartTrigger =
  | 'requestIdleCallback'
  | 'requestIdleCallbackTimeout'
  | 'setTimeoutFallback';

type AutoTranslateE2eRequest = {
  requestId: string;
  type: 'translatePage';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: TranslationProviderId;
};

type AutoTranslateE2eResponse =
  | {
      requestId: string;
      success: true;
      summary: {
        translatedCount: number;
        errorCount: number;
        handledBy: 'extension' | 'site-tool' | 'pdf';
      };
    }
  | {
      requestId: string;
      success: false;
      error: string;
    };

const AUTO_TRANSLATE_E2E_DIAGNOSTICS_PATH = '/e2e/mock.html';

function shouldPublishAutoTranslateDiagnostics(): boolean {
  const { hostname, pathname } = window.location;
  const isLocalE2eHost = hostname === '127.0.0.1' || hostname === 'localhost';
  return isLocalE2eHost && pathname.endsWith(AUTO_TRANSLATE_E2E_DIAGNOSTICS_PATH);
}

function dispatchAutoTranslateE2eResponse(
  detail: AutoTranslateE2eResponse
): void {
  document.dispatchEvent(
    new CustomEvent(AUTO_TRANSLATE_E2E_RESPONSE_EVENT, {
      detail,
    })
  );
}

function installAutoTranslateE2eBridge(): void {
  const bridgeWindow = window as Window &
    typeof globalThis & {
      __translateAutoTranslateE2eBridgeInstalled?: boolean;
    };
  if (bridgeWindow.__translateAutoTranslateE2eBridgeInstalled) return;
  bridgeWindow.__translateAutoTranslateE2eBridgeInstalled = true;

  document.addEventListener(AUTO_TRANSLATE_E2E_REQUEST_EVENT, (event) => {
    if (!shouldPublishAutoTranslateDiagnostics()) return;

    const detail = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== 'object') return;

    const request = detail as Partial<AutoTranslateE2eRequest>;
    if (
      request.type !== 'translatePage' ||
      typeof request.requestId !== 'string' ||
      typeof request.sourceLang !== 'string' ||
      typeof request.targetLang !== 'string' ||
      typeof request.strategy !== 'string'
    ) {
      return;
    }
    const requestId = request.requestId;

    void translatePageContent(
      request.sourceLang,
      request.targetLang,
      request.strategy as Strategy,
      typeof request.provider === 'string'
        ? (request.provider as TranslationProviderId)
        : undefined
    )
      .then((summary) => {
        dispatchAutoTranslateE2eResponse({
          requestId,
          success: true,
          summary,
        });
      })
      .catch((error) => {
        const message = extractErrorMessage(error, 'Page translation failed');
        dispatchAutoTranslateE2eResponse({
          requestId,
          success: false,
          error: message,
        });
        logContentMessageFailure(
          'translatePageE2e',
          error,
          'Page translation failed'
        );
      });
  });
}

function createAutoTranslateDiagnostics(): AutoTranslateDiagnostics {
  return {
    contentLoaded: true,
    checkStarted: false,
    settingsLoaded: false,
    hasSiteSpecificRules: false,
    shouldAutoTranslate: false,
    currentSettingsApplied: false,
    startScheduled: false,
    scheduleMethod: null,
    startTriggeredBy: null,
    startRan: false,
    translationRequested: false,
    translationCompleted: false,
    handledBy: null,
    translatedCount: null,
    errorCount: null,
    sourceLang: null,
    targetLang: null,
    provider: null,
    lastError: null,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
  };
}

let autoTranslateDiagnostics = createAutoTranslateDiagnostics();

function publishAutoTranslateDiagnostics(): void {
  const root = document.documentElement;
  if (!root) return;

  if (!shouldPublishAutoTranslateDiagnostics()) {
    root.removeAttribute(CONTENT_SCRIPT_READY_ATTR);
    root.removeAttribute(AUTO_TRANSLATE_DIAGNOSTICS_ATTR);
    return;
  }

  root.setAttribute(CONTENT_SCRIPT_READY_ATTR, 'true');
  root.setAttribute(
    AUTO_TRANSLATE_DIAGNOSTICS_ATTR,
    JSON.stringify(autoTranslateDiagnostics)
  );
}

function resetAutoTranslateDiagnostics(): void {
  autoTranslateDiagnostics = createAutoTranslateDiagnostics();
  publishAutoTranslateDiagnostics();
}

function updateAutoTranslateDiagnostics(
  update: Partial<AutoTranslateDiagnostics>
): void {
  autoTranslateDiagnostics = {
    ...autoTranslateDiagnostics,
    ...update,
    contentLoaded: true,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
  };
  publishAutoTranslateDiagnostics();
}

const contentMessageHandlers: ContentMessageHandlers = {
  ping: defineImmediateContentHandler('ping', () => ({ loaded: true })),
  stopAutoTranslate: defineImmediateContentHandler('stopAutoTranslate', () => {
    stopMutationObserver();
    pageOrchestrator.setCurrentSettings(null);
    return true;
  }),
  undoTranslation: defineImmediateContentHandler('undoTranslation', () => {
    const restoredCount = pageOrchestrator.undoTranslation();
    return { success: true, restoredCount };
  }),
  toggleBilingualMode: defineImmediateContentHandler('toggleBilingualMode', () => ({
    enabled: toggleBilingualMode(),
  })),
  setBilingualMode: defineImmediateContentHandler('setBilingualMode', (message) => {
    if (message.enabled) {
      enableBilingualMode();
    } else {
      disableBilingualMode();
    }
    return { enabled: getBilingualModeState() };
  }),
  getBilingualMode: defineImmediateContentHandler('getBilingualMode', () => ({
    enabled: getBilingualModeState(),
  })),
  toggleWidget: defineImmediateContentHandler('toggleWidget', () => ({
    visible: toggleFloatingWidget(),
  })),
  showWidget: defineImmediateContentHandler('showWidget', () => {
    showFloatingWidget();
    return { visible: true };
  }),
  translateSelection: defineStartedContentHandler(
    'translateSelection',
    async (message) => {
      await translateSelection(message.sourceLang, message.targetLang, message.strategy, message.provider);
    },
    (error) => {
      logContentMessageFailure('translateSelection', error, 'Translation failed');
    }
  ),
  translatePage: defineStartedContentHandler(
    'translatePage',
    async (message) => {
      await translatePageContent(
        message.sourceLang,
        message.targetLang,
        message.strategy,
        message.provider
      );
    },
    (error) => {
      logContentMessageFailure('translatePage', error, 'Page translation failed');
    }
  ),
  translatePdf: defineStartedContentHandler(
    'translatePdf',
    async (message) => {
      await initPdfTranslation(message.targetLang);
    },
    (error) => {
      logContentMessageFailure('translatePdf', error, 'PDF translation failed');
    }
  ),
  translateImage: defineStartedContentHandler(
    'translateImage',
    async (message) => {
      await translateImage(message.imageUrl);
    },
    (error) => {
      logContentMessageFailure('translateImage', error, 'Image translation failed');
    }
  ),
  enterScreenshotMode: defineImmediateContentHandler('enterScreenshotMode', () => {
    enterScreenshotMode();
    return true;
  }),
};

browserAPI.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: ContentMessageResponse) => void
  ) => routeContentMessage(message, sendResponse, contentMessageHandlers)
);
publishAutoTranslateDiagnostics();

// ============================================================================
// Auto-Translate Check
// ============================================================================

function scheduleAutoTranslateStart(
  startTranslation: (trigger: AutoTranslateStartTrigger) => void
): void {
  let started = false;
  let idleCallbackId: number | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const runStartTranslation = (trigger: AutoTranslateStartTrigger): void => {
    if (started) return;
    started = true;

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    if (idleCallbackId !== undefined && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleCallbackId);
    }

    updateAutoTranslateDiagnostics({
      startRan: true,
      startTriggeredBy: trigger,
    });
    startTranslation(trigger);
  };

  if ('requestIdleCallback' in window) {
    updateAutoTranslateDiagnostics({
      startScheduled: true,
      scheduleMethod: 'requestIdleCallback',
    });
    idleCallbackId = window.requestIdleCallback(() => {
      runStartTranslation('requestIdleCallback');
    }, {
      timeout: 2000,
    });
    // Some browsers can indefinitely defer idle callbacks for hidden/background
    // tabs even when the API exists, so keep a hard timeout fallback too.
    timeoutId = setTimeout(() => {
      runStartTranslation('requestIdleCallbackTimeout');
    }, 2000);
    return;
  }

  updateAutoTranslateDiagnostics({
    startScheduled: true,
    scheduleMethod: 'setTimeoutFallback',
  });
  timeoutId = setTimeout(() => {
    runStartTranslation('setTimeoutFallback');
  }, 500);
}

async function checkAutoTranslate(): Promise<void> {
  resetAutoTranslateDiagnostics();
  updateAutoTranslateDiagnostics({
    checkStarted: true,
  });

  // First check per-site rules
  const hostname = window.location.hostname;
  const siteSpecificRules = await siteRules.getRules(hostname);

  // Get global settings as fallback
  interface StoredSettings {
    autoTranslate?: boolean;
    sourceLang?: string;
    targetLang?: string;
    strategy?: Strategy;
    provider?: TranslationProviderId;
  }
  const settings = await safeStorageGet<StoredSettings>([
    'autoTranslate',
    'sourceLang',
    'targetLang',
    'strategy',
    'provider',
  ]);

  // Merge settings: site rules take precedence over global settings
  const shouldAutoTranslate = siteSpecificRules?.autoTranslate ?? settings.autoTranslate;
  const rawSourceLang = siteSpecificRules?.sourceLang || settings.sourceLang || 'auto';
  const targetLang = siteSpecificRules?.targetLang || settings.targetLang || 'fi';
  const strategy = siteSpecificRules?.strategy || settings.strategy || 'smart';
  const provider = siteSpecificRules?.preferredProvider || settings.provider || 'opus-mt';

  updateAutoTranslateDiagnostics({
    settingsLoaded: true,
    hasSiteSpecificRules: Boolean(siteSpecificRules),
    shouldAutoTranslate: Boolean(shouldAutoTranslate),
    sourceLang: rawSourceLang,
    targetLang,
    provider,
  });

  if (siteSpecificRules) {
    log.info(' Site-specific rules found for', hostname, siteSpecificRules);
  }

  if (shouldAutoTranslate) {
    log.info(' Auto-translate enabled, waiting for page idle...');

    pageOrchestrator.setCurrentSettings({
      sourceLang: rawSourceLang,
      targetLang,
      strategy: strategy as Strategy,
      provider: provider as TranslationProviderId,
    });
    updateAutoTranslateDiagnostics({
      currentSettingsApplied: true,
    });

    // Wait for browser idle to avoid competing with page rendering.
    // Keep a bounded timeout fallback so hidden/background tabs still start.
    const startTranslation = () => {
      /* v8 ignore start -- defensive: user can't cancel before idle callback fires in tests */
      const liveSettings = pageOrchestrator.getCurrentSettings();
      if (!liveSettings) {
        updateAutoTranslateDiagnostics({
          lastError: 'Auto-translate settings were cleared before startup',
        });
        return; // User may have cancelled
      }
      /* v8 ignore stop */
      updateAutoTranslateDiagnostics({
        translationRequested: true,
        sourceLang: liveSettings.sourceLang,
        targetLang: liveSettings.targetLang,
        provider: liveSettings.provider ?? null,
        lastError: null,
      });
      void translatePageContent(
        liveSettings.sourceLang,
        liveSettings.targetLang,
        liveSettings.strategy,
        liveSettings.provider
      )
        .then((summary) => {
          updateAutoTranslateDiagnostics({
            translationCompleted: true,
            handledBy: summary.handledBy,
            translatedCount: summary.translatedCount,
            errorCount: summary.errorCount,
          });
        })
        .catch((error) => {
          updateAutoTranslateDiagnostics({
            lastError: extractErrorMessage(error, 'Page translation failed'),
          });
          logContentMessageFailure('autoTranslate', error, 'Page translation failed');
        });
    };

    scheduleAutoTranslateStart(startTranslation);
  }
}

// Run auto-translate check on load
/* v8 ignore start — module-level code runs at import time before tests can configure mocks */
if (document.readyState === 'complete') {
  checkAutoTranslate();
} else {
  window.addEventListener('load', checkAutoTranslate);
}

// Abort in-flight translations and release observers on navigation.
// beforeunload fires BEFORE unload (which is unreliable on some browsers),
// so we do full cleanup here to prevent resource leaks.
window.addEventListener('beforeunload', () => {
  void unregisterTranslationWebMcpTools();
  pageOrchestrator.cleanup();
  stopMutationObserver();
  removeProgressToast();
});

// Cleanup on unload - release all resources
window.addEventListener('unload', () => {
  // Ensure abort fires even if beforeunload didn't (e.g., some mobile browsers)
  pageOrchestrator.cleanup();

  stopMutationObserver();
  removeProgressToast();
  clearImageOverlays();
  cleanupPdfTranslation();
  cleanupHoverListeners();

  removeWidgetDragListeners();
});
/* v8 ignore stop */

log.info(' Translation content script loaded v2.3 with MutationObserver + site rules + glossary support');
