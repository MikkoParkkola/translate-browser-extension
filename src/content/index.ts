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

void registerTranslationWebMcpTools({
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
});

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

// ============================================================================
// Auto-Translate Check
// ============================================================================

async function checkAutoTranslate(): Promise<void> {
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

    // Wait for browser idle to avoid competing with page rendering.
    // requestIdleCallback fires when browser has spare cycles; fallback to 500ms for Firefox.
    const startTranslation = () => {
      /* v8 ignore start -- defensive: user can't cancel before idle callback fires in tests */
      const liveSettings = pageOrchestrator.getCurrentSettings();
      if (!liveSettings) return; // User may have cancelled
      /* v8 ignore stop */
      void translatePageContent(
        liveSettings.sourceLang,
        liveSettings.targetLang,
        liveSettings.strategy,
        liveSettings.provider
      ).catch((error) => {
        logContentMessageFailure('autoTranslate', error, 'Page translation failed');
      });
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(startTranslation, { timeout: 2000 });
    } else {
      setTimeout(startTranslation, 500);
    }
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
