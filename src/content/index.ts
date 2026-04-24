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

import type { Strategy, TranslationProviderId, TranslateResponse } from '../types';
import { extractErrorMessage, calculateRetryDelay } from '../core/errors';
import { sleep } from '../core/async-utils';
import { siteRules } from '../core/site-rules';
import { glossary, type GlossaryStore } from '../core/glossary';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';
import { safeStorageGet } from '../core/storage';
import { detectLanguage, samplePageText } from '../core/language-detector';
import { browserAPI } from '../core/browser-api';
import { initSubtitleTranslation, cleanupSubtitleTranslation } from './subtitle-translator';
import { isPdfPage, initPdfTranslation, cleanupPdfTranslation } from './pdf-translator';
import {
  observeShadowRoots,
  observeShadowRoot,
  cleanupShadowObservers,
  getDeepSelection,
  installAttachShadowInterceptor,
} from './shadow-dom-walker';
// measureTimeAsync imported for future use in async profiling
// import { measureTimeAsync } from '../core/profiler';
import {
  recordContentTiming,
  getContentTimingStats,
} from './timing';
import {
  TRANSLATED_ATTR,
  ORIGINAL_TEXT_ATTR,
  ORIGINAL_TEXT_NODES_ATTR,
  MACHINE_TRANSLATION_ATTR,
  SOURCE_LANG_ATTR,
  TARGET_LANG_ATTR,
  type ContentMessage,
  type CurrentSettings,
} from './content-types';
import {
  showInfoToast,
  showProgressToast,
  updateProgressToast,
  removeProgressToast,
  showErrorToast,
} from './toast';
import { injectContentStyles } from './styles';
import {
  isValidText,
  sanitizeText,
  getTextNodes,
  getTextNodesFromNodes,
  clearSkipCacheEntry,
} from './dom-utils';
import { getPageContext, getSelectionContext } from './context';
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
import { makeTranslatedElementEditable, showCorrectionHint } from './correction';
import {
  applyBilingualToElement,
  enableBilingualMode,
  disableBilingualMode,
  toggleBilingualMode,
  getBilingualModeState,
} from './bilingual';
import {
  resolveSourceLang,
  translateWithStreaming,
  isTransientError,
  createBatches,
} from './translation-helpers';
import {
  maybeTranslatePageWithSiteTool,
  maybeTranslateSelectionWithSiteTool,
  registerWebMcpTools,
  type WebMcpDetectionResult,
} from './webmcp';

const log = createLogger('Content');

// Install shadow root interceptor ASAP to capture closed roots created during
// page initialization. Content script runs at document_idle, so any shadow roots
// created after this point will be intercepted. The interceptor is idempotent —
// calling it again in startMutationObserver is safe.
installAttachShadowInterceptor();

// ============================================================================
// State
// ============================================================================

let isTranslatingPage = false;
let isTranslatingDynamic = false;
let pendingMutations: MutationRecord[] = [];
let mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let mutationObserver: MutationObserver | null = null;
/** Cleanup function returned by observeShadowRoots */
let shadowRootCleanup: (() => void) | null = null;
/** Queued dynamic nodes that arrived during page translation, translated after page completes */
let queuedDynamicNodes: Node[] = [];

/**
 * Navigation abort controller: signals in-flight translation batches to stop.
 * Created fresh when a page translation starts; aborted on beforeunload or
 * when the user triggers undo. Prevents wasted API calls and DOM writes to
 * nodes that no longer exist after navigation.
 */
let navigationAbortController: AbortController | null = null;

let currentSettings: CurrentSettings | null = null;

// Cache for glossary terms (loaded once per page)
let cachedGlossary: GlossaryStore | null = null;

interface StoredSettings {
  autoTranslate?: boolean;
  sourceLang?: string;
  targetLang?: string;
  strategy?: Strategy;
  provider?: TranslationProviderId;
}


// ============================================================================
// Module Dependency Injection
// ============================================================================

// Provide currentSettings getter to modules that need it
/* v8 ignore start -- DI closures */
screenshotSetGetCurrentSettings(() => currentSettings);
imageSetGetCurrentSettings(() => currentSettings);
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
 * Load glossary if not cached
 */
// Promise guard: prevents concurrent glossary loads from racing.
// Without this, two batches starting simultaneously both see null,
// both load, and the second overwrites the first (benign but wasteful).
let glossaryLoadingPromise: Promise<GlossaryStore> | null = null;

async function loadGlossary(): Promise<GlossaryStore> {
  if (cachedGlossary !== null) return cachedGlossary;
  /* v8 ignore start -- dedup guard: mock resolves synchronously so concurrent loads never race */
  if (glossaryLoadingPromise) return glossaryLoadingPromise;
  /* v8 ignore stop */

  glossaryLoadingPromise = (async () => {
    try {
      cachedGlossary = await glossary.getGlossary();
    } catch (error) {
      log.error(' Failed to load glossary:', error);
      cachedGlossary = {};
    }
    glossaryLoadingPromise = null;
    return cachedGlossary;
  })();

  return glossaryLoadingPromise;
}


/**
 * Translate selected text with error handling
 */
async function translateSelection(
  sourceLang: string,
  targetLang: string,
  strategy: Strategy,
  provider?: string,
  options: {
    agentInvoked?: boolean;
  } = {}
): Promise<void> {
  // Use deep selection to find text in shadow DOMs (e.g., LinkedIn chat)
  const selection = getDeepSelection();
  if (!selection || selection.isCollapsed) {
    log.info(' No text selected (checked main document + shadow roots)');
    showInfoToast('Select text to translate');
    return;
  }

  const text = selection.toString().trim();
  if (!isValidText(text)) {
    log.info(' Selected text is not valid for translation');
    showInfoToast('Select text to translate');
    return;
  }

  const sanitized = sanitizeText(text);
  const range = selection.getRangeAt(0);

  if (!options.agentInvoked) {
    const siteToolResult = await maybeTranslateSelectionWithSiteTool({
      sourceLang,
      targetLang,
      strategy,
      provider,
      text: sanitized,
    });
    if (siteToolResult) {
      log.info(` Translated selection via site tool '${siteToolResult.toolName}'`);
      showTranslationTooltip(siteToolResult.translatedText, range);
      return;
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
    const g = await loadGlossary();
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
            showTranslationTooltip(restore(partial), range, /* streaming */ true);
          },
        );
        showTranslationTooltip(restore(result), range);
        return;
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
    })) as TranslateResponse;

    if (response.success && response.result) {
      // Apply glossary post-processing (restore placeholders)
      const finalResult = restore(response.result as string);
      showTranslationTooltip(finalResult, range);
    } else {
      log.error(' Translation failed:', response.error);
      showErrorTooltip(response.error || 'Translation failed', range);
    }
  } catch (error) {
    log.error(' Translation error:', error);
    const message = extractErrorMessage(error, 'Unknown error');
    showErrorTooltip(message, range);
  }
}

/**
 * Translate entire page with batching and error handling
 */
/**
 * Translate a single batch with retry logic for transient failures.
 * Returns { translatedCount, errorCount } for the batch.
 */
async function translateBatchWithRetry(
  batch: { nodes: Text[]; texts: string[]; restoreFns: Array<(text: string) => string> },
  sourceLang: string,
  targetLang: string,
  strategy: Strategy,
  provider?: string,
  enableProfiling = false,
  maxRetries = 2
): Promise<{ translatedCount: number; errorCount: number; ipcTime: number; domUpdateTime: number }> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Exponential backoff on retry
      if (attempt > 0) {
        const delay = calculateRetryDelay(attempt);
        await sleep(delay);
        log.info(`Retry attempt ${attempt} for batch`);
      }

      // Extract page context from the first node in the batch for disambiguation
      /* v8 ignore start */
      const pageContext = batch.nodes[0] ? getPageContext(batch.nodes[0]) : '';
      /* v8 ignore stop */

      const ipcStart = performance.now();
      const response = (await browserAPI.runtime.sendMessage({
        type: 'translate',
        text: batch.texts,
        sourceLang,
        targetLang,
        options: {
          strategy,
          context: pageContext ? { before: '', after: '', pageContext } : undefined,
        },
        provider,
        enableProfiling,
      })) as TranslateResponse;
      const ipcTime = performance.now() - ipcStart;
      recordContentTiming('ipcRoundtrip', ipcTime);

      if (response.success && Array.isArray(response.result)) {
        const domUpdateStart = performance.now();
        let translatedCount = 0;
        let errorCount = 0;

        response.result.forEach((translated, idx) => {
          const node = batch.nodes[idx];
          // Guard: skip detached nodes (removed from DOM during translation).
          // A single rich text container can legitimately contain multiple sibling
          // text nodes, so reinjection must not stop after the first child update.
          if (node && translated && node.parentElement && document.contains(node)) {
            try {
              const parent = node.parentElement;
              const finalText = batch.restoreFns[idx](translated);
              /* v8 ignore start */
              const original = node.textContent || '';
              /* v8 ignore stop */
              const leadingSpace = original.match(/^\s*/)?.[0] || '';
              const trailingSpace = original.match(/\s*$/)?.[0] || '';

              // Debug: log first 3 replacements to verify translation is actually different
              if (idx < 3) {
                log.debug(`DOM Replace #${idx}: "${original.trim().substring(0, 40)}" -> "${finalText.substring(0, 40)}" (same=${original.trim() === finalText})`);
              }

              ensureOriginalTextSnapshot(parent);

              node.textContent = leadingSpace + finalText + trailingSpace;
              parent.setAttribute(MACHINE_TRANSLATION_ATTR, parent.textContent || '');
              parent.setAttribute(SOURCE_LANG_ATTR, sourceLang);
              parent.setAttribute(TARGET_LANG_ATTR, targetLang);
              parent.setAttribute(TRANSLATED_ATTR, 'true');
              makeTranslatedElementEditable(parent);

              // Auto-apply bilingual annotation if bilingual mode is active
              if (getBilingualModeState()) {
                applyBilingualToElement(parent);
              }

              translatedCount++;
            } catch {
              errorCount++;
            }
          }
        });

        const domUpdateTime = performance.now() - domUpdateStart;
        recordContentTiming('domUpdate', domUpdateTime);

        return { translatedCount, errorCount, ipcTime, domUpdateTime };
      }

      /* v8 ignore start -- non-retryable IPC error; requires real extension messaging */
      // Non-retryable error (e.g. unsupported language pair)
      if (response.error && !isTransientError(response.error)) {
        return { translatedCount: 0, errorCount: batch.nodes.length, ipcTime, domUpdateTime: 0 };
      }

      /* v8 ignore start -- OR default fallback */
      lastError = response.error || 'Translation returned unsuccessful response';
      /* v8 ignore stop */
    } catch (error) {
      lastError = error;
      // Extension context invalidated = service worker restarted, not retryable
      if (error instanceof Error && error.message.includes('Extension context invalidated')) {
        log.warn('Extension context invalidated — stopping translation. Reload the page.');
        stopMutationObserver();
        currentSettings = null;
        return { translatedCount: 0, errorCount: batch.nodes.length, ipcTime: 0, domUpdateTime: 0 };
      }
      // Other errors are retryable
      if (attempt === maxRetries) break;
    }
  }

  log.error(`Batch failed after ${maxRetries + 1} attempts:`, lastError);
  return { translatedCount: 0, errorCount: batch.nodes.length, ipcTime: 0, domUpdateTime: 0 };
}

/** Active IntersectionObserver for scroll-aware below-fold translation */
let belowFoldObserver: IntersectionObserver | null = null;

function getDirectTextChildren(element: Element): Text[] {
  return Array.from(element.childNodes).filter((node): node is Text => node.nodeType === Node.TEXT_NODE);
}

function ensureOriginalTextSnapshot(element: Element): void {
  if (!element.hasAttribute(ORIGINAL_TEXT_ATTR)) {
    element.setAttribute(ORIGINAL_TEXT_ATTR, element.textContent || '');
  }

  if (!element.hasAttribute(ORIGINAL_TEXT_NODES_ATTR)) {
    element.setAttribute(
      ORIGINAL_TEXT_NODES_ATTR,
      JSON.stringify(getDirectTextChildren(element).map((node) => node.textContent || ''))
    );
  }
}

/**
 * Clean up scroll-aware translation observer
 */
function stopBelowFoldObserver(): void {
  if (belowFoldObserver) {
    belowFoldObserver.disconnect();
    belowFoldObserver = null;
  }
}

async function translatePage(
  sourceLang: string,
  targetLang: string,
  strategy: Strategy,
  provider?: string,
  enableProfiling = false
): Promise<void> {
  // Fix race condition: set flag BEFORE any await/async operations
  if (isTranslatingPage) {
    log.info(' Translation already in progress');
    return;
  }
  isTranslatingPage = true;

  // Abort any previous translation if running
  if (navigationAbortController) navigationAbortController.abort();
  
  stopBelowFoldObserver();

  // Create abort controller for this translation session.
  // Aborted on navigation (beforeunload) or undo to stop wasting API calls.
  navigationAbortController = new AbortController();
  const { signal } = navigationAbortController;

  log.info(' Translating page...');
  const pageStart = performance.now();

  try {
    // Time DOM scanning
    const scanStart = performance.now();
    const textNodes = getTextNodes(document.body);
    const scanDuration = performance.now() - scanStart;
    recordContentTiming('domScan', scanDuration);
    log.info(`Found ${textNodes.length} text nodes in ${scanDuration.toFixed(2)}ms`);

    if (textNodes.length === 0) {
      log.info(' No translatable text found');
      return;
    }

    // Sort nodes: viewport-visible first, then top-to-bottom by position
    // Users read rendered content top-down, so translate what they see first
    // Performance: cache getBoundingClientRect() results to avoid redundant layout thrashing
    const viewportHeight = window.innerHeight;
    const viewportNodes: Text[] = [];
    const belowFoldWithPos: Array<{ node: Text; top: number }> = [];

    for (const node of textNodes) {
      const parent = node.parentElement;
      /* v8 ignore start -- text nodes from DOM scan always have a parent */
      if (!parent) continue;
      /* v8 ignore stop */
      try {
        const rect = parent.getBoundingClientRect();
        if (rect.top < viewportHeight && rect.bottom > 0) {
          viewportNodes.push(node);
        } else {
          belowFoldWithPos.push({ node, top: rect.top });
        }
      } catch {
        belowFoldWithPos.push({ node, top: Infinity });
      }
    }

    // Sort below-fold by cached Y position (no second getBoundingClientRect pass)
    belowFoldWithPos.sort((a, b) => a.top - b.top);
    const belowFoldNodes = belowFoldWithPos.map(item => item.node);

    log.info(`Viewport: ${viewportNodes.length} nodes, below fold: ${belowFoldNodes.length} nodes`);

    // Time glossary loading
    const glossaryStart = performance.now();
    const g = await loadGlossary();
    const glossaryDuration = performance.now() - glossaryStart;
    recordContentTiming('glossaryApply', glossaryDuration);

    // --- Phase 1: Translate viewport content immediately ---
    const viewportBatches = await createBatches(viewportNodes, g);
    const totalBatches = viewportBatches.length;
    const hasBelowFold = belowFoldNodes.length > 0;

    // Show progress for multi-batch translations
    if (totalBatches > 1 || hasBelowFold) {
      showProgressToast(`Translating visible content...`);
    }

    let translatedCount = 0;
    let errorCount = 0;
    let totalIpcTime = 0;
    let totalDomUpdateTime = 0;
    let firstTranslation = true;

    // Translate viewport batches with concurrency limit — pipelines IPC round-trips
    // while model processes previous batch. DOM updates happen in-order per batch.
    for (let i = 0; i < viewportBatches.length; i += CONFIG.batching.concurrencyLimit) {
      // Check abort signal between batches to stop on navigation
      /* v8 ignore start -- abort timing is non-deterministic in jsdom async */
      if (signal.aborted) {
        log.info('Translation aborted (navigation or undo)');
        break;
      }
      /* v8 ignore stop */

      const chunk = viewportBatches.slice(i, i + CONFIG.batching.concurrencyLimit);

      if (totalBatches > 1) {
        updateProgressToast(`Translating... ${i + 1}/${totalBatches}`);
      }

      const results = await Promise.all(
        chunk.map((batch) =>
          translateBatchWithRetry(batch, sourceLang, targetLang, strategy, provider, enableProfiling)
        )
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        // Show correction hint on first successful translation
        if (firstTranslation && result.translatedCount > 0) {
          const firstNode = chunk[j].nodes[0];
          if (firstNode?.parentElement) {
            showCorrectionHint(firstNode.parentElement);
          }
          firstTranslation = false;
        }

        translatedCount += result.translatedCount;
        errorCount += result.errorCount;
        totalIpcTime += result.ipcTime;
        totalDomUpdateTime += result.domUpdateTime;
      }
    }

    // --- Phase 2: Translate below-fold content progressively as user scrolls ---
    if (belowFoldNodes.length > 0) {
      updateProgressToast(`Translating remaining content...`);

      // Finish modest pages immediately so long descriptions below the fold
      // are translated in the first pass. Only defer the tail of very large pages.
      const immediateBelowFoldCount = Math.min(
        belowFoldNodes.length,
        CONFIG.batching.immediateBelowFoldMaxNodes
      );
      const immediateNodes = belowFoldNodes.slice(0, immediateBelowFoldCount);
      const deferredNodes = belowFoldNodes.slice(immediateBelowFoldCount);

      // Translate the first section below fold immediately
      const immediateBatches = await createBatches(immediateNodes, g);
      for (const batch of immediateBatches) {
        /* v8 ignore start -- abort between below-fold batches; covered at viewport level */
        if (signal.aborted) break;
        /* v8 ignore stop */
        const result = await translateBatchWithRetry(
          batch, sourceLang, targetLang, strategy, provider, enableProfiling
        );
        translatedCount += result.translatedCount;
        errorCount += result.errorCount;
        totalIpcTime += result.ipcTime;
        totalDomUpdateTime += result.domUpdateTime;
      }

      // Defer remaining nodes: use IntersectionObserver to translate when approaching viewport
      if (deferredNodes.length > 0) {
        setupScrollAwareTranslation(deferredNodes, sourceLang, targetLang, strategy, g, provider, enableProfiling);
      }
    }

    removeProgressToast();

    // Start translating video subtitles/captions alongside page text
    initSubtitleTranslation(targetLang);

    const totalTime = performance.now() - pageStart;
    log.info(
      `Page translation complete: ${translatedCount} translated, ${errorCount} errors\n` +
      `  Total: ${totalTime.toFixed(2)}ms\n` +
      `  DOM Scan: ${scanDuration.toFixed(2)}ms (${((scanDuration / totalTime) * 100).toFixed(1)}%)\n` +
      `  IPC Total: ${totalIpcTime.toFixed(2)}ms (${((totalIpcTime / totalTime) * 100).toFixed(1)}%)\n` +
      `  DOM Update: ${totalDomUpdateTime.toFixed(2)}ms (${((totalDomUpdateTime / totalTime) * 100).toFixed(1)}%)`
    );

    // Show summary
    if (errorCount > 0 && translatedCount > 0) {
      showInfoToast(`Translated ${translatedCount} items (${errorCount} failed)`);
    } else if (translatedCount > 0 && errorCount === 0) {
      const deferredMsg = belowFoldNodes.length > CONFIG.batching.immediateBelowFoldMaxNodes
        ? ' (more translates as you scroll)' : '';
      showInfoToast(`Translated ${translatedCount} items${deferredMsg}`);
    } else if (errorCount > 0 && translatedCount === 0) {
      showErrorToast('Translation failed. Please try again.');
    }

    // Log content timing stats
    /* v8 ignore start -- enableProfiling param never passed true from message handler */
    if (enableProfiling) {
      log.info('Timing Stats:', getContentTimingStats());
    }
    /* v8 ignore stop */
  } finally {
    isTranslatingPage = false;

    // Drain any dynamic nodes that were queued during page translation
    if (queuedDynamicNodes.length > 0 && currentSettings) {
      const queued = queuedDynamicNodes;
      queuedDynamicNodes = [];
      log.info(` Draining ${queued.length} queued dynamic nodes`);
      translateDynamicContent(queued);
    }
  }
}

/**
 * Set up IntersectionObserver to translate deferred below-fold content
 * as the user scrolls near it. Translates in chunks using sentinel elements.
 *
 * IMPORTANT: Uses currentSettings at callback time (not closure-captured params)
 * to avoid stale language settings if the user changes language mid-scroll.
 */
function setupScrollAwareTranslation(
  deferredNodes: Text[],
  _sourceLang: string,
  _targetLang: string,
  _strategy: Strategy,
  glossaryStore: GlossaryStore,
  _provider?: string,
  enableProfiling = false
): void {
  // Split deferred nodes into chunks of ~2 batches worth
  const chunkSize = CONFIG.batching.maxSize * 2;
  const chunks: Text[][] = [];
  for (let i = 0; i < deferredNodes.length; i += chunkSize) {
    chunks.push(deferredNodes.slice(i, i + chunkSize));
  }

  log.info(`Deferring ${deferredNodes.length} nodes in ${chunks.length} scroll-triggered chunks`);

  const translatedChunks = new Set<number>();

  belowFoldObserver = new IntersectionObserver(
    async (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const chunkIndex = Number((entry.target as HTMLElement).dataset.translateChunk);
        /* v8 ignore start -- IntersectionObserver in jsdom doesn't fire; scroll guards untestable */
        if (isNaN(chunkIndex) || translatedChunks.has(chunkIndex)) continue;
        /* v8 ignore stop */

        translatedChunks.add(chunkIndex);
        belowFoldObserver?.unobserve(entry.target);

        const chunk = chunks[chunkIndex];
        // Read live settings to avoid stale language/strategy from closure
        /* v8 ignore start -- scroll observer callback not triggered in jsdom */
        if (!chunk || !currentSettings) return;
        /* v8 ignore stop */
        const { sourceLang, targetLang, strategy, provider } = currentSettings;

        // Filter out nodes that are no longer in the DOM or already translated
        const validNodes = chunk.filter(
          (n) => n.parentElement && document.contains(n) && !n.parentElement.hasAttribute(TRANSLATED_ATTR)
        );
        /* v8 ignore start -- scroll observer body: IntersectionObserver not available in jsdom */
        if (validNodes.length === 0) return;

        log.info(`Scroll-triggered: translating chunk ${chunkIndex + 1}/${chunks.length} (${validNodes.length} nodes)`);

        try {
          const batches = await createBatches(validNodes, glossaryStore);
          for (const batch of batches) {
            await translateBatchWithRetry(
              batch, sourceLang, targetLang, strategy, provider, enableProfiling
            );
          }
        } catch (error) {
          log.error(`Scroll-triggered translation error for chunk ${chunkIndex}:`, error);
        }
        /* v8 ignore stop */
      }
    },
    { rootMargin: '200% 0px' } // Start translating 2 viewports before the user scrolls there
  );

  // Observe a sentinel element near the first node of each chunk
  for (let i = 0; i < chunks.length; i++) {
    const firstNode = chunks[i][0];
    const parent = firstNode?.parentElement;
    /* v8 ignore start -- sentinel parents always in DOM during observer setup */
    if (!parent || !document.contains(parent)) continue;
    /* v8 ignore stop */

    // Use the parent element as the observation target, tag it with chunk index
    parent.dataset.translateChunk = String(i);
    belowFoldObserver.observe(parent);
  }
}

/**
 * Translate dynamically added content (with batching to respect MAX_BATCH_SIZE)
 */
async function translateDynamicContent(nodes: Node[]): Promise<void> {
  if (!currentSettings) return;

  // If page translation is running, queue these nodes instead of dropping them
  if (isTranslatingPage) {
    queuedDynamicNodes.push(...nodes);
    return;
  }

  if (isTranslatingDynamic) return;
  isTranslatingDynamic = true;

  try {
    // P0 FIX: Moved inside try/finally so isTranslatingDynamic is always
    // cleared even if getTextNodesFromNodes() throws unexpectedly.
    const textNodes = getTextNodesFromNodes(nodes);
    if (textNodes.length === 0) {
      return; // finally block handles cleanup
    }

    log.info(`Translating ${textNodes.length} dynamic text nodes`);

    const g = await loadGlossary();
    const batches = await createBatches(textNodes, g);

    for (const batch of batches) {
      /* v8 ignore start -- defensive: settings always set when dynamic translation runs */
      if (!currentSettings) return; // Settings cleared (e.g. undo called)
      /* v8 ignore stop */

      const result = await translateBatchWithRetry(
        batch,
        currentSettings.sourceLang,
        currentSettings.targetLang,
        currentSettings.strategy,
        currentSettings.provider,
        false, // enableProfiling
        2      // maxRetries: 3 attempts total. Dynamic content on SPAs (trainline etc)
               // hits transient frame-destroyed errors; a second retry recovers most cases
               // once the background falls back to opus-mt for chrome-builtin transients.
      );

      if (result.errorCount > 0 && result.translatedCount === 0) {
        // Downgraded to warn: with background fallback + 3 retries, remaining failures
        // are usually benign (unmounted SPA nodes) and not user-actionable.
        log.warn(` Dynamic batch fully failed (${result.errorCount} nodes)`);
      }
    }
  } catch (error) {
    log.error(' Dynamic translation error:', error);
    // Only show error toast for non-transient failures to avoid spamming the user
    /* v8 ignore start */
    if (error instanceof Error && !isTransientError(error.message)) {
      showErrorToast(error.message);
    }
    /* v8 ignore stop */
  } finally {
    isTranslatingDynamic = false;
  }
}

// ============================================================================
// Undo Translation
// ============================================================================

/**
 * Undo all translations on the page, restoring original text
 */
function undoTranslation(): number {
  // Abort any in-flight translation batches
  if (navigationAbortController) {
    navigationAbortController.abort();
    navigationAbortController = null;
  }

  // Stop any ongoing mutation observation
  stopMutationObserver();
  currentSettings = null;

  // Clean up subtitle translation overlays and observers
  cleanupSubtitleTranslation();

  // Count and clear image translation overlays
  clearImageOverlays();

  // Find all translated elements
  const translatedElements = document.querySelectorAll(`[${TRANSLATED_ATTR}]`);
  let restoredCount = 0;

  translatedElements.forEach((element) => {
    const originalText = element.getAttribute(ORIGINAL_TEXT_ATTR);
    const originalNodeTexts = element.getAttribute(ORIGINAL_TEXT_NODES_ATTR);
    let restoredViaNodes = false;
    if (originalNodeTexts !== null) {
      try {
        const originals = JSON.parse(originalNodeTexts) as unknown;
        if (Array.isArray(originals)) {
          const textNodes = getDirectTextChildren(element);
          textNodes.forEach((textNode, index) => {
            if (typeof originals[index] === 'string') {
              textNode.textContent = originals[index];
            }
          });
          restoredCount++;
          restoredViaNodes = true;
        }
      } catch {
        // Fall back to the legacy single-text-node restoration path below.
      }
    }

    if (!restoredViaNodes && originalText !== null) {
      // Find the text node and restore original
      const textNode = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE
      );
      /* v8 ignore start */
      if (textNode) {
      /* v8 ignore stop */
        textNode.textContent = originalText;
        restoredCount++;
      }
    }

    // Clean up attributes and invalidate skip cache
    element.removeAttribute(TRANSLATED_ATTR);
    element.removeAttribute(ORIGINAL_TEXT_ATTR);
    element.removeAttribute(ORIGINAL_TEXT_NODES_ATTR);
    clearSkipCacheEntry(element);
  });

  log.info(` Restored ${restoredCount} elements to original text`);
  showInfoToast(`Restored ${restoredCount} translations`);
  return restoredCount;
}

// ============================================================================
// MutationObserver for Dynamic Content
// ============================================================================

/**
 * Process pending mutations with debouncing and chunked processing.
 * Caps per-cycle processing to avoid blocking the main thread on
 * content-heavy pages that generate hundreds of mutations.
 */
function processPendingMutations(): void {
  /* v8 ignore start -- debounce timer always fires with pending mutations */
  if (pendingMutations.length === 0) return;
  /* v8 ignore stop */

  // Collect all added nodes
  const addedNodes: Node[] = [];
  for (const mutation of pendingMutations) {
    for (const node of mutation.addedNodes) {
      if (
        node.nodeType === Node.ELEMENT_NODE ||
        node.nodeType === Node.TEXT_NODE
      ) {
        addedNodes.push(node);
      }
    }
  }

  pendingMutations = [];

  if (addedNodes.length === 0) return;

  // Process in capped chunks to avoid main-thread jank
  if (addedNodes.length <= CONFIG.mutations.batchCapPerCycle) {
    translateDynamicContent(addedNodes);
  } else {
    // Process first chunk immediately
    translateDynamicContent(addedNodes.slice(0, CONFIG.mutations.batchCapPerCycle));
    // Defer remaining chunks via requestIdleCallback / setTimeout
    let offset = CONFIG.mutations.batchCapPerCycle;
    const processNextChunk = () => {
      /* v8 ignore start -- chunk boundary guard in deferred processing */
      if (offset >= addedNodes.length) return;
      /* v8 ignore stop */
      const chunk = addedNodes.slice(offset, offset + CONFIG.mutations.batchCapPerCycle);
      offset += CONFIG.mutations.batchCapPerCycle;
      translateDynamicContent(chunk);
      if (offset < addedNodes.length) {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(processNextChunk);
        } else {
          setTimeout(processNextChunk, 50);
        }
      }
    };
    /* v8 ignore start -- requestIdleCallback: chunked processing not reachable in jsdom */
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(processNextChunk);
    } else {
      setTimeout(processNextChunk, 50);
    }
    /* v8 ignore stop */
  }
}

/** Counter for mutations dropped due to buffer overflow (diagnostic) */
let droppedMutationCount = 0;

/**
 * Shared mutation callback for both the main observer and shadow root observers.
 */
function handleMutations(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    if (pendingMutations.length < CONFIG.mutations.maxPending) {
      pendingMutations.push(mutation);
    } else {
      droppedMutationCount++;
    }
  }

  // Log dropped mutations periodically so heavy SPAs are diagnosable
  /* v8 ignore start -- requires exactly 200 dropped mutations; diagnostic-only */
  if (droppedMutationCount > 0 && droppedMutationCount % 200 === 0) {
    log.warn(`Dropped ${droppedMutationCount} mutations (maxPending=${CONFIG.mutations.maxPending})`);
  }
  /* v8 ignore stop */

  if (mutationDebounceTimer !== null) {
    clearTimeout(mutationDebounceTimer);
  }

  mutationDebounceTimer = setTimeout(() => {
    mutationDebounceTimer = null;
    processPendingMutations();
  }, CONFIG.mutations.debounceMs);
}

/**
 * Start observing DOM mutations for auto-translation.
 * Also starts shadow root observation so mutations inside web components
 * are captured for dynamic translation.
 */
function startMutationObserver(): void {
  if (mutationObserver) return;

  mutationObserver = new MutationObserver(handleMutations);

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Observe shadow roots: when a new shadow root appears, attach a
  // MutationObserver inside it so dynamic content is translated.
  shadowRootCleanup = observeShadowRoots(document, (shadowRoot) => {
    observeShadowRoot(shadowRoot, handleMutations);
  });

  log.info(' MutationObserver started (with shadow DOM support)');
}

/**
 * Stop observing DOM mutations (including shadow root observers)
 */
function stopMutationObserver(): void {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }

  // Clean up shadow root observers and interceptor
  if (shadowRootCleanup) {
    shadowRootCleanup();
    shadowRootCleanup = null;
  }
  cleanupShadowObservers();

  if (mutationDebounceTimer !== null) {
    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = null;
  }

  pendingMutations = [];
  stopBelowFoldObserver();
  removeProgressToast();
  log.info(' MutationObserver stopped');
}

async function resolveEffectivePageSettings(): Promise<{
  hostname: string;
  siteSpecificRules: Awaited<ReturnType<typeof siteRules.getRules>>;
  shouldAutoTranslate: boolean | undefined;
  settings: CurrentSettings;
}> {
  const hostname = window.location.hostname;
  const siteSpecificRules = await siteRules.getRules(hostname);
  const settings = await safeStorageGet<StoredSettings>([
    'autoTranslate',
    'sourceLang',
    'targetLang',
    'strategy',
    'provider',
  ]);

  const rawSourceLang = siteSpecificRules?.sourceLang || settings.sourceLang || 'auto';
  const resolvedSettings: CurrentSettings = {
    sourceLang: resolveSourceLang(rawSourceLang),
    targetLang: siteSpecificRules?.targetLang || settings.targetLang || 'fi',
    strategy: (siteSpecificRules?.strategy || settings.strategy || 'smart') as Strategy,
    provider: (siteSpecificRules?.preferredProvider || settings.provider || 'opus-mt') as TranslationProviderId,
  };

  return {
    hostname,
    siteSpecificRules,
    shouldAutoTranslate: siteSpecificRules?.autoTranslate ?? settings.autoTranslate,
    settings: resolvedSettings,
  };
}

function getDeepSelectionText(): string {
  const selection = getDeepSelection();
  if (!selection || selection.isCollapsed) return '';
  return selection.toString().trim();
}

function detectWebMcpLanguage(scope: 'page' | 'selection'): WebMcpDetectionResult | null {
  const sample = scope === 'selection' ? getDeepSelectionText() : samplePageText(500);
  if (!sample) return null;

  const detected = detectLanguage(sample);
  if (!detected) return null;

  return {
    language: detected.lang,
    confidence: detected.confidence,
    sampleLength: sample.length,
  };
}

async function startSelectionTranslation(
  settings: CurrentSettings,
  options: {
    agentInvoked?: boolean;
  } = {}
): Promise<void> {
  await translateSelection(
    settings.sourceLang,
    settings.targetLang,
    settings.strategy,
    settings.provider,
    options
  );
}

async function startPageTranslation(
  settings: CurrentSettings,
  options: {
    agentInvoked?: boolean;
  } = {}
): Promise<void> {
  if (isPdfPage()) {
    await initPdfTranslation(settings.targetLang);
    return;
  }

  if (!options.agentInvoked) {
    const siteToolResult = await maybeTranslatePageWithSiteTool({
      sourceLang: settings.sourceLang,
      targetLang: settings.targetLang,
      strategy: settings.strategy,
      provider: settings.provider,
    });
    if (siteToolResult) {
      log.info(` Translated page via site tool '${siteToolResult.toolName}'`);
      stopMutationObserver();
      currentSettings = null;
      return;
    }
  }

  const resolvedSettings: CurrentSettings = {
    ...settings,
    sourceLang: resolveSourceLang(settings.sourceLang),
  };

  currentSettings = resolvedSettings;
  await translatePage(
    resolvedSettings.sourceLang,
    resolvedSettings.targetLang,
    resolvedSettings.strategy,
    resolvedSettings.provider
  );
  startMutationObserver();
}

const cleanupWebMcp = registerWebMcpTools({
  getCurrentSettings: async () => (await resolveEffectivePageSettings()).settings,
  translatePage: (settings) => startPageTranslation(settings, { agentInvoked: true }),
  translateSelection: (settings) =>
    startSelectionTranslation(settings, { agentInvoked: true }),
  hasSelectionText: () => getDeepSelectionText().length > 0,
  detectLanguage: detectWebMcpLanguage,
});


// ============================================================================
// Message Handling
// ============================================================================

browserAPI.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    _sender,
    sendResponse: (response: boolean | { loaded: boolean } | { success: boolean; restoredCount: number } | { enabled: boolean } | { visible: boolean } | { success: boolean; status: string } | { success: boolean; error: string }) => void
  ) => {
    if (message.type === 'ping') {
      sendResponse({ loaded: true });
      return true;
    }

    if (message.type === 'stopAutoTranslate') {
      stopMutationObserver();
      currentSettings = null;
      sendResponse(true);
      return true;
    }

    if (message.type === 'undoTranslation') {
      const restoredCount = undoTranslation();
      sendResponse({ success: true, restoredCount });
      return true;
    }

    if (message.type === 'toggleBilingualMode') {
      const enabled = toggleBilingualMode();
      sendResponse({ enabled });
      return true;
    }

    if (message.type === 'setBilingualMode') {
      if (message.enabled) {
        enableBilingualMode();
      } else {
        disableBilingualMode();
      }
      sendResponse({ enabled: getBilingualModeState() });
      return true;
    }

    if (message.type === 'getBilingualMode') {
      sendResponse({ enabled: getBilingualModeState() });
      return true;
    }

    if (message.type === 'toggleWidget') {
      const visible = toggleFloatingWidget();
      sendResponse({ visible });
      return true;
    }

    if (message.type === 'showWidget') {
      showFloatingWidget();
      sendResponse({ visible: true });
      return true;
    }

    if (message.type === 'translateSelection') {
      // Acknowledge immediately so the caller does not time out
      sendResponse({ success: true, status: 'started' });
      startSelectionTranslation({
        sourceLang: message.sourceLang,
        targetLang: message.targetLang,
        strategy: message.strategy,
        provider: message.provider,
      })
        .catch((error) => {
          const msg = extractErrorMessage(error, 'Translation failed');
          log.error('translateSelection failed:', msg);
        });
      return true;
    }

    if (message.type === 'translatePage') {
      // Acknowledge immediately so the caller does not time out
      sendResponse({ success: true, status: 'started' });
      startPageTranslation({
        sourceLang: message.sourceLang,
        targetLang: message.targetLang,
        strategy: message.strategy,
        provider: message.provider,
      })
        .catch((error) => {
          const msg = extractErrorMessage(error, 'Page translation failed');
          log.error('translatePage failed:', msg);
        });
      return true;
    }

    if (message.type === 'translatePdf') {
      // Acknowledge immediately so the caller does not time out
      sendResponse({ success: true, status: 'started' });
      initPdfTranslation(message.targetLang)
        .catch((error) => {
          const msg = extractErrorMessage(error, 'PDF translation failed');
          log.error('translatePdf failed:', msg);
        });
      return true;
    }

    if (message.type === 'translateImage') {
      // Acknowledge immediately so the caller does not time out
      sendResponse({ success: true, status: 'started' });
      translateImage(
        message.imageUrl
      )
        .catch((error) => {
          const msg = extractErrorMessage(error, 'Image translation failed');
          log.error('translateImage failed:', msg);
        });
      return true;
    }

    if (message.type === 'enterScreenshotMode') {
      enterScreenshotMode();
      sendResponse(true);
      return true;
    }

    return false;
  }
);

// ============================================================================
// Auto-Translate Check
// ============================================================================

async function checkAutoTranslate(): Promise<void> {
  const { hostname, siteSpecificRules, shouldAutoTranslate, settings } =
    await resolveEffectivePageSettings();

  if (siteSpecificRules) {
    log.info(' Site-specific rules found for', hostname, siteSpecificRules);
  }

  if (shouldAutoTranslate) {
    log.info(' Auto-translate enabled, waiting for page idle...');

    currentSettings = settings;

    // Wait for browser idle to avoid competing with page rendering.
    // requestIdleCallback fires when browser has spare cycles; fallback to 500ms for Firefox.
    const startTranslation = () => {
      /* v8 ignore start -- defensive: user can't cancel before idle callback fires in tests */
      if (!currentSettings) return; // User may have cancelled
      /* v8 ignore stop */
      startPageTranslation(currentSettings)
        .catch((error) => {
          const msg = extractErrorMessage(error, 'Auto-translate failed');
          log.error('auto-translate failed:', msg);
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
// beforeunload fires BEFORE pagehide and is allowed on most pages.
window.addEventListener('beforeunload', () => {
  cleanupWebMcp?.();
  if (navigationAbortController) {
    navigationAbortController.abort();
    navigationAbortController = null;
  }
  stopBelowFoldObserver();
  stopMutationObserver();
  removeProgressToast();
});

// Full resource cleanup on pagehide.
// Replaces the deprecated `unload` listener: `unload` is blocked by
// Permissions-Policy on many modern sites (thetrainline.com, gmail.com etc.),
// produces console warnings, and never fires. `pagehide` is the modern
// replacement — always allowed, covers both real navigation and bfcache entry.
window.addEventListener('pagehide', () => {
  cleanupWebMcp?.();
  if (navigationAbortController) {
    navigationAbortController.abort();
    navigationAbortController = null;
  }

  stopMutationObserver();
  stopBelowFoldObserver();
  removeProgressToast();
  clearImageOverlays();
  cleanupPdfTranslation();
  cleanupHoverListeners();
  queuedDynamicNodes = [];
  currentSettings = null;
  cachedGlossary = null;
  glossaryLoadingPromise = null;

  removeWidgetDragListeners();
});
/* v8 ignore stop */

log.info(' Translation content script loaded v2.3 with MutationObserver + site rules + glossary support');
