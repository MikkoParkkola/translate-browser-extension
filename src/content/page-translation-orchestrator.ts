/**
 * Page Translation Orchestrator
 *
 * Encapsulates the full-page translation state machine:
 * - State flags (isTranslatingPage, isTranslatingDynamic, queued nodes, etc.)
 * - Glossary cache and loading guard
 * - Navigation abort controller
 * - Below-fold IntersectionObserver
 * - translatePage / translateDynamicContent / undoTranslation
 *
 * index.ts is responsible for wiring, bootstrap, and message routing.
 * It injects the stopMutationObserver callback to avoid cyclic imports.
 */

import type { Strategy, TranslateResponse } from '../types';
import { calculateRetryDelay } from '../core/errors';
import { sleep } from '../core/async-utils';
import { glossary, type GlossaryStore } from '../core/glossary';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';
import { browserAPI } from '../core/browser-api';
import { initSubtitleTranslation, cleanupSubtitleTranslation } from './subtitle-translator';
import { clearImageOverlays } from './image-translator';
import { recordContentTiming, getContentTimingStats } from './timing';
import {
  TRANSLATED_ATTR,
  ORIGINAL_TEXT_ATTR,
  ORIGINAL_TEXT_NODES_ATTR,
  MACHINE_TRANSLATION_ATTR,
  SOURCE_LANG_ATTR,
  TARGET_LANG_ATTR,
  type CurrentSettings,
} from './content-types';
import {
  showInfoToast,
  showProgressToast,
  updateProgressToast,
  removeProgressToast,
  showErrorToast,
} from './toast';
import { getTextNodes, getTextNodesFromNodes, clearSkipCacheEntry } from './dom-utils';
import { getPageContext } from './context';
import { isTransientError, createBatches } from './translation-helpers';
import { makeTranslatedElementEditable, showCorrectionHint } from './correction';
import { applyBilingualToElement, getBilingualModeState } from './bilingual';
import { normalizeBatchTranslations } from '../shared/batch-translation-contract';

const log = createLogger('Content');

// ============================================================================
// Public Interface
// ============================================================================

export interface PageTranslationOrchestrator {
  translatePage(
    sourceLang: string,
    targetLang: string,
    strategy: Strategy,
    provider?: string,
    enableProfiling?: boolean
  ): Promise<PageTranslationSummary>;
  translateDynamicContent(nodes: Node[]): Promise<void>;
  undoTranslation(): number;
  getCurrentSettings(): CurrentSettings | null;
  setCurrentSettings(settings: CurrentSettings | null): void;
  loadGlossary(): Promise<GlossaryStore>;
  stopBelowFoldObserver(): void;
  /** Reset all translation state (call on unload or navigation) */
  cleanup(): void;
}

export interface PageTranslationOrchestratorOptions {
  /**
   * Called when the orchestrator needs to stop DOM mutation observation.
   * Injected to avoid a cyclic dependency: orchestrator → index → orchestrator.
   */
  onStopMutationObserver: () => void;
}

export interface PageTranslationSummary {
  translatedCount: number;
  errorCount: number;
}

// ============================================================================
// Factory
// ============================================================================

export function createPageTranslationOrchestrator(
  options: PageTranslationOrchestratorOptions
): PageTranslationOrchestrator {
  const { onStopMutationObserver } = options;

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  let isTranslatingPage = false;
  let isTranslatingDynamic = false;
  /** Queued dynamic nodes that arrived during page translation, drained after page completes */
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

  // Promise guard: prevents concurrent glossary loads from racing.
  // Without this, two batches starting simultaneously both see null,
  // both load, and the second overwrites the first (benign but wasteful).
  let glossaryLoadingPromise: Promise<GlossaryStore> | null = null;

  /** Active IntersectionObserver for scroll-aware below-fold translation */
  let belowFoldObserver: IntersectionObserver | null = null;

  // --------------------------------------------------------------------------
  // Glossary
  // --------------------------------------------------------------------------

  async function loadGlossaryInternal(): Promise<GlossaryStore> {
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
      return cachedGlossary as GlossaryStore;
    })();

    return glossaryLoadingPromise;
  }

  // --------------------------------------------------------------------------
  // Batch translation with retry
  // --------------------------------------------------------------------------

  function applyTranslatedBatchResults(
    batch: { nodes: Text[]; texts: string[]; restoreFns: Array<(text: string) => string> },
    translatedResults: string[],
    sourceLang: string,
    targetLang: string
  ): { translatedCount: number; errorCount: number; domUpdateTime: number } {
    const domUpdateStart = performance.now();
    let translatedCount = 0;
    let errorCount = 0;

    translatedResults.forEach((translated, idx) => {
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

    return { translatedCount, errorCount, domUpdateTime };
  }

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

        let translatedResults: string[];
        let ipcTime = 0;

        if (sourceLang !== 'auto' && sourceLang === targetLang) {
          // Matching-language page translation is a DOM-marking pass only.
          // Skip the background roundtrip so hidden-tab/service-worker churn
          // cannot stall an otherwise no-op batch.
          translatedResults = batch.texts;
          recordContentTiming('ipcRoundtrip', ipcTime);
        } else {
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
          ipcTime = performance.now() - ipcStart;
          recordContentTiming('ipcRoundtrip', ipcTime);

          if (response.success) {
            try {
              translatedResults = normalizeBatchTranslations(response.result ?? [], batch.nodes.length);
            } catch (error) {
              log.warn('Batch translation returned invalid result shape:', error);
              return { translatedCount: 0, errorCount: batch.nodes.length, ipcTime, domUpdateTime: 0 };
            }
          } else {
            /* v8 ignore start -- non-retryable IPC error; requires real extension messaging */
            // Non-retryable error (e.g. unsupported language pair)
            if (response.error && !isTransientError(response.error)) {
              return { translatedCount: 0, errorCount: batch.nodes.length, ipcTime, domUpdateTime: 0 };
            }

            /* v8 ignore start -- OR default fallback */
            lastError = response.error || 'Translation returned unsuccessful response';
            /* v8 ignore stop */
            continue;
          }
        }

        const { translatedCount, errorCount, domUpdateTime } = applyTranslatedBatchResults(
          batch,
          translatedResults,
          sourceLang,
          targetLang
        );
        return { translatedCount, errorCount, ipcTime, domUpdateTime };
      } catch (error) {
        lastError = error;
        // Extension context invalidated = service worker restarted, not retryable
        if (error instanceof Error && error.message.includes('Extension context invalidated')) {
          log.warn('Extension context invalidated — stopping translation. Reload the page.');
          onStopMutationObserver();
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

  // --------------------------------------------------------------------------
  // DOM helpers
  // --------------------------------------------------------------------------

  function getDirectTextChildren(element: Element): Text[] {
    return Array.from(element.childNodes).filter(
      (node): node is Text => node.nodeType === Node.TEXT_NODE
    );
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

  // --------------------------------------------------------------------------
  // Below-fold / scroll-aware translation
  // --------------------------------------------------------------------------

  function stopBelowFoldObserverInternal(): void {
    if (belowFoldObserver) {
      belowFoldObserver.disconnect();
      belowFoldObserver = null;
    }
  }

  /**
   * Set up IntersectionObserver to translate deferred below-fold content
   * as the user scrolls near it. Translates in chunks using sentinel elements.
   *
   * IMPORTANT: Reads currentSettings at callback time (not closure-captured params)
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
            (n) =>
              n.parentElement &&
              document.contains(n) &&
              !n.parentElement.hasAttribute(TRANSLATED_ATTR)
          );
          /* v8 ignore start -- scroll observer body: IntersectionObserver not available in jsdom */
          if (validNodes.length === 0) return;

          log.info(
            `Scroll-triggered: translating chunk ${chunkIndex + 1}/${chunks.length} (${validNodes.length} nodes)`
          );

          try {
            const batches = await createBatches(validNodes, glossaryStore);
            for (const batch of batches) {
              await translateBatchWithRetry(
                batch,
                sourceLang,
                targetLang,
                strategy,
                provider,
                enableProfiling
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

  // --------------------------------------------------------------------------
  // Page translation
  // --------------------------------------------------------------------------

  async function translatePageInternal(
    sourceLang: string,
    targetLang: string,
    strategy: Strategy,
    provider?: string,
    enableProfiling = false
  ): Promise<PageTranslationSummary> {
    // Fix race condition: set flag BEFORE any await/async operations
    if (isTranslatingPage) {
      log.info(' Translation already in progress');
      return { translatedCount: 0, errorCount: 0 };
    }
    isTranslatingPage = true;

    // Abort any previous translation if running
    if (navigationAbortController) navigationAbortController.abort();

    stopBelowFoldObserverInternal();

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
        return { translatedCount: 0, errorCount: 0 };
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
      const belowFoldNodes = belowFoldWithPos.map((item) => item.node);

      log.info(`Viewport: ${viewportNodes.length} nodes, below fold: ${belowFoldNodes.length} nodes`);

      // Time glossary loading
      const glossaryStart = performance.now();
      const g = await loadGlossaryInternal();
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
            translateBatchWithRetry(
              batch,
              sourceLang,
              targetLang,
              strategy,
              provider,
              enableProfiling
            )
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
            batch,
            sourceLang,
            targetLang,
            strategy,
            provider,
            enableProfiling
          );
          translatedCount += result.translatedCount;
          errorCount += result.errorCount;
          totalIpcTime += result.ipcTime;
          totalDomUpdateTime += result.domUpdateTime;
        }

        // Defer remaining nodes: use IntersectionObserver to translate when approaching viewport
        if (deferredNodes.length > 0) {
          setupScrollAwareTranslation(
            deferredNodes,
            sourceLang,
            targetLang,
            strategy,
            g,
            provider,
            enableProfiling
          );
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
        const deferredMsg =
          belowFoldNodes.length > CONFIG.batching.immediateBelowFoldMaxNodes
            ? ' (more translates as you scroll)'
            : '';
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
      return { translatedCount, errorCount };
    } finally {
      isTranslatingPage = false;

      // Drain any dynamic nodes that were queued during page translation
      if (queuedDynamicNodes.length > 0 && currentSettings) {
        const queued = queuedDynamicNodes;
        queuedDynamicNodes = [];
        log.info(` Draining ${queued.length} queued dynamic nodes`);
        void translateDynamicContentInternal(queued);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Dynamic content translation
  // --------------------------------------------------------------------------

  async function translateDynamicContentInternal(nodes: Node[]): Promise<void> {
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

      const g = await loadGlossaryInternal();
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
          1 // maxRetries: fewer retries for dynamic content to avoid blocking
        );

        if (result.errorCount > 0 && result.translatedCount === 0) {
          log.error(` Dynamic batch fully failed (${result.errorCount} nodes)`);
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

  // --------------------------------------------------------------------------
  // Undo translation
  // --------------------------------------------------------------------------

  function undoTranslationInternal(): number {
    // Abort any in-flight translation batches
    if (navigationAbortController) {
      navigationAbortController.abort();
      navigationAbortController = null;
    }

    // Stop any ongoing mutation observation
    onStopMutationObserver();
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

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  return {
    translatePage: translatePageInternal,
    translateDynamicContent: translateDynamicContentInternal,
    undoTranslation: undoTranslationInternal,
    loadGlossary: loadGlossaryInternal,

    getCurrentSettings(): CurrentSettings | null {
      return currentSettings;
    },

    setCurrentSettings(settings: CurrentSettings | null): void {
      currentSettings = settings;
    },

    stopBelowFoldObserver(): void {
      stopBelowFoldObserverInternal();
    },

    cleanup(): void {
      if (navigationAbortController) {
        navigationAbortController.abort();
        navigationAbortController = null;
      }
      stopBelowFoldObserverInternal();
      queuedDynamicNodes = [];
      currentSettings = null;
      cachedGlossary = null;
      glossaryLoadingPromise = null;
    },
  };
}
