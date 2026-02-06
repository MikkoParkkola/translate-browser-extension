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
import { siteRules } from '../core/site-rules';
import { glossary, type GlossaryStore } from '../core/glossary';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';
import { safeStorageGet } from '../core/storage';

const log = createLogger('Content');

// Content-script specific message types (extend base types)
interface TranslateSelectionMessage {
  type: 'translateSelection';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
}

interface TranslatePageMessage {
  type: 'translatePage';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
}

type ContentMessage = TranslateSelectionMessage | TranslatePageMessage | { type: 'ping' } | { type: 'stopAutoTranslate' };

// ============================================================================
// Configuration
// ============================================================================

// Elements to skip during translation
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'CODE',
  'PRE',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BUTTON',
  'SVG',
  'MATH',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'IFRAME',
  'OBJECT',
  'EMBED',
]);

// Mark translated nodes to avoid re-translation
const TRANSLATED_ATTR = 'data-translated';

// ============================================================================
// State
// ============================================================================

let isTranslating = false;
let pendingMutations: MutationRecord[] = [];
let mutationDebounceTimer: number | null = null;
let mutationObserver: MutationObserver | null = null;
let currentSettings: {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
} | null = null;

// Cache for glossary terms (loaded once per page)
let cachedGlossary: GlossaryStore | null = null;

// ============================================================================
// Element Filtering
// ============================================================================

/**
 * Check if element should be skipped for translation
 */
function shouldSkip(element: Element): boolean {
  // Skip by tag name
  if (SKIP_TAGS.has(element.tagName)) return true;

  // Skip already translated
  if (element.getAttribute(TRANSLATED_ATTR)) return true;

  // Skip elements with contenteditable
  if (element.closest('[contenteditable="true"]')) return true;

  // Skip elements marked as no-translate
  if (element.hasAttribute('data-no-translate')) return true;

  // Skip elements with translate="no"
  if (element.getAttribute('translate') === 'no') return true;

  // Check visibility
  try {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  } catch {
    // getComputedStyle can throw for detached elements
    return true;
  }

  return false;
}

/**
 * Validate text for translation
 */
function isValidText(text: string | null): text is string {
  if (!text) return false;

  const trimmed = text.trim();
  if (trimmed.length < CONFIG.batching.minTextLength) return false;
  if (trimmed.length > CONFIG.batching.maxTextLength) return false;

  // Skip text that's only whitespace, numbers, or symbols
  if (/^[\s\d\p{P}\p{S}]+$/u.test(trimmed)) return false;

  // Skip text that looks like code or URLs
  if (/^(https?:|www\.|\/\/|{|}|\[|\]|function|const |let |var )/.test(trimmed)) return false;

  return true;
}

/**
 * Sanitize text for translation - remove problematic characters
 */
function sanitizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ============================================================================
// DOM Traversal
// ============================================================================

/**
 * Get all translatable text nodes in element
 */
function getTextNodes(root: Element): Text[] {
  const nodes: Text[] = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || shouldSkip(parent)) return NodeFilter.FILTER_REJECT;
      if (!isValidText(node.textContent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }

  return nodes;
}

/**
 * Get text nodes from a specific set of elements (for mutations)
 */
function getTextNodesFromNodes(nodes: Node[]): Text[] {
  const textNodes: Text[] = [];

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && !shouldSkip(parent) && isValidText(node.textContent)) {
        textNodes.push(node as Text);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (!shouldSkip(element)) {
        textNodes.push(...getTextNodes(element));
      }
    }
  }

  return textNodes;
}

// ============================================================================
// Translation Functions
// ============================================================================

/**
 * Load glossary if not cached
 */
async function loadGlossary(): Promise<GlossaryStore> {
  if (cachedGlossary === null) {
    try {
      cachedGlossary = await glossary.getGlossary();
    } catch (e) {
      log.error(' Failed to load glossary:', e);
      cachedGlossary = {};
    }
  }
  return cachedGlossary;
}

/**
 * Translate selected text with error handling
 */
async function translateSelection(
  sourceLang: string,
  targetLang: string,
  strategy: Strategy,
  provider?: string
): Promise<void> {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    log.info(' No text selected');
    return;
  }

  const text = selection.toString().trim();
  if (!isValidText(text)) {
    log.info(' Selected text is not valid for translation');
    return;
  }

  const sanitized = sanitizeText(text);
  log.info(' Translating selection:', sanitized.substring(0, 50) + '...');

  try {
    // Apply glossary pre-processing
    const g = await loadGlossary();
    const { processedText, restore } = await glossary.applyGlossary(sanitized, g);

    const response = (await chrome.runtime.sendMessage({
      type: 'translate',
      text: processedText,
      sourceLang,
      targetLang,
      options: { strategy },
      provider,
    })) as TranslateResponse;

    if (response.success && response.result) {
      // Apply glossary post-processing (restore placeholders)
      const finalResult = restore(response.result as string);
      showTranslationTooltip(finalResult, selection.getRangeAt(0));
    } else {
      log.error(' Translation failed:', response.error);
      showErrorTooltip(response.error || 'Translation failed', selection.getRangeAt(0));
    }
  } catch (error) {
    log.error(' Translation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    showErrorTooltip(message, selection.getRangeAt(0));
  }
}

/**
 * Translate entire page with batching and error handling
 */
async function translatePage(
  sourceLang: string,
  targetLang: string,
  strategy: Strategy,
  provider?: string
): Promise<void> {
  if (isTranslating) {
    log.info(' Translation already in progress');
    return;
  }

  isTranslating = true;
  log.info(' Translating page...');

  try {
    const textNodes = getTextNodes(document.body);
    console.log(`[Content] Found ${textNodes.length} text nodes`);

    if (textNodes.length === 0) {
      log.info(' No translatable text found');
      return;
    }

    // Load glossary once for the page
    const g = await loadGlossary();

    // Create batches with length validation (prevent DoS from malicious pages)
    const batches: Array<{ nodes: Text[]; texts: string[]; restoreFns: Array<(text: string) => string> }> = [];
    for (let i = 0; i < textNodes.length; i += CONFIG.batching.maxSize) {
      const batchNodes = textNodes.slice(i, i + CONFIG.batching.maxSize);
      const rawTexts = batchNodes.map((n) => {
        const text = sanitizeText(n.textContent || '');
        // Enforce max length per text (defense against memory exhaustion)
        return text.length > CONFIG.batching.maxTextLength
          ? text.substring(0, CONFIG.batching.maxTextLength)
          : text;
      });

      // Apply glossary to batch
      const { processedTexts, restoreFns } = await glossary.applyGlossaryBatch(rawTexts, g);
      batches.push({ nodes: batchNodes, texts: processedTexts, restoreFns });
    }

    console.log(`[Content] Processing ${batches.length} batches`);

    let translatedCount = 0;
    let errorCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'translate',
          text: batch.texts,
          sourceLang,
          targetLang,
          options: { strategy },
          provider,
        })) as TranslateResponse;

        if (response.success && Array.isArray(response.result)) {
          // Replace text nodes with translations
          response.result.forEach((translated, idx) => {
            const node = batch.nodes[idx];
            if (node && translated && node.parentElement) {
              try {
                // Apply glossary post-processing
                const finalText = batch.restoreFns[idx](translated);

                // Preserve whitespace
                const original = node.textContent || '';
                const leadingSpace = original.match(/^\s*/)?.[0] || '';
                const trailingSpace = original.match(/\s*$/)?.[0] || '';

                node.textContent = leadingSpace + finalText + trailingSpace;
                node.parentElement.setAttribute(TRANSLATED_ATTR, 'true');
                translatedCount++;
              } catch {
                // Node may have been removed from DOM
                errorCount++;
              }
            }
          });
        } else {
          console.error(`[Content] Batch ${batchIndex + 1} failed:`, response.error);
          errorCount += batch.nodes.length;
        }
      } catch (error) {
        console.error(`[Content] Batch ${batchIndex + 1} error:`, error);
        errorCount += batch.nodes.length;
      }
    }

    console.log(
      `[Content] Page translation complete: ${translatedCount} translated, ${errorCount} errors`
    );
  } finally {
    isTranslating = false;
  }
}

/**
 * Translate dynamically added content
 */
async function translateDynamicContent(nodes: Node[]): Promise<void> {
  if (!currentSettings || isTranslating) return;

  const textNodes = getTextNodesFromNodes(nodes);
  if (textNodes.length === 0) return;

  console.log(`[Content] Translating ${textNodes.length} dynamic text nodes`);

  // Apply length validation (prevent DoS from malicious dynamic content)
  const rawTexts = textNodes.map((n) => {
    const text = sanitizeText(n.textContent || '');
    return text.length > CONFIG.batching.maxTextLength
      ? text.substring(0, CONFIG.batching.maxTextLength)
      : text;
  });

  try {
    // Apply glossary to batch
    const g = await loadGlossary();
    const { processedTexts, restoreFns } = await glossary.applyGlossaryBatch(rawTexts, g);

    const response = (await chrome.runtime.sendMessage({
      type: 'translate',
      text: processedTexts,
      sourceLang: currentSettings.sourceLang,
      targetLang: currentSettings.targetLang,
      options: { strategy: currentSettings.strategy },
      provider: currentSettings.provider,
    })) as TranslateResponse;

    if (response.success && Array.isArray(response.result)) {
      response.result.forEach((translated, idx) => {
        const node = textNodes[idx];
        if (node && translated && node.parentElement) {
          try {
            // Apply glossary post-processing
            const finalText = restoreFns[idx](translated);

            const original = node.textContent || '';
            const leadingSpace = original.match(/^\s*/)?.[0] || '';
            const trailingSpace = original.match(/\s*$/)?.[0] || '';

            node.textContent = leadingSpace + finalText + trailingSpace;
            node.parentElement.setAttribute(TRANSLATED_ATTR, 'true');
          } catch {
            // Ignore - node may have been removed
          }
        }
      });
    }
  } catch (error) {
    log.error(' Dynamic translation error:', error);
  }
}

// ============================================================================
// MutationObserver for Dynamic Content
// ============================================================================

/**
 * Process pending mutations with debouncing
 */
function processPendingMutations(): void {
  if (pendingMutations.length === 0) return;

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

  if (addedNodes.length > 0) {
    translateDynamicContent(addedNodes);
  }
}

/**
 * Start observing DOM mutations for auto-translation
 */
function startMutationObserver(): void {
  if (mutationObserver) return;

  mutationObserver = new MutationObserver((mutations) => {
    // Add to pending mutations
    for (const mutation of mutations) {
      if (pendingMutations.length < CONFIG.mutations.maxPending) {
        pendingMutations.push(mutation);
      }
    }

    // Debounce processing
    if (mutationDebounceTimer !== null) {
      clearTimeout(mutationDebounceTimer);
    }

    mutationDebounceTimer = window.setTimeout(() => {
      mutationDebounceTimer = null;
      processPendingMutations();
    }, CONFIG.mutations.debounceMs);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  log.info(' MutationObserver started');
}

/**
 * Stop observing DOM mutations
 */
function stopMutationObserver(): void {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }

  if (mutationDebounceTimer !== null) {
    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = null;
  }

  pendingMutations = [];
  log.info(' MutationObserver stopped');
}

// ============================================================================
// UI Components
// ============================================================================

/**
 * Show translation tooltip
 */
function showTranslationTooltip(text: string, range: Range): void {
  removeTooltip();

  const rect = range.getBoundingClientRect();

  const tooltip = document.createElement('div');
  tooltip.id = 'translate-tooltip';
  tooltip.textContent = text;
  tooltip.style.cssText = `
    position: fixed;
    top: ${Math.min(rect.bottom + 8, window.innerHeight - 100)}px;
    left: ${Math.max(8, Math.min(rect.left, window.innerWidth - 416))}px;
    max-width: 400px;
    padding: 12px 16px;
    background: #1e293b;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 999999;
    animation: translateFadeIn 0.2s ease;
    word-wrap: break-word;
  `;

  // Add close button
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    position: absolute;
    top: 4px;
    right: 8px;
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  `;
  closeBtn.onclick = () => removeTooltip();
  tooltip.appendChild(closeBtn);

  document.body.appendChild(tooltip);

  // Auto-remove after 10 seconds
  setTimeout(() => removeTooltip(), 10000);
}

/**
 * Show error tooltip
 */
function showErrorTooltip(message: string, range: Range): void {
  removeTooltip();

  const rect = range.getBoundingClientRect();

  const tooltip = document.createElement('div');
  tooltip.id = 'translate-tooltip';
  tooltip.style.cssText = `
    position: fixed;
    top: ${Math.min(rect.bottom + 8, window.innerHeight - 100)}px;
    left: ${Math.max(8, Math.min(rect.left, window.innerWidth - 416))}px;
    max-width: 400px;
    padding: 12px 16px;
    background: #991b1b;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 999999;
    animation: translateFadeIn 0.2s ease;
  `;

  tooltip.textContent = message;

  // Add close button
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    position: absolute;
    top: 4px;
    right: 8px;
    background: none;
    border: none;
    color: #fca5a5;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  `;
  closeBtn.onclick = () => removeTooltip();
  tooltip.appendChild(closeBtn);

  document.body.appendChild(tooltip);

  // Auto-remove after 5 seconds
  setTimeout(() => removeTooltip(), 5000);
}

/**
 * Remove tooltip
 */
function removeTooltip(): void {
  const existing = document.getElementById('translate-tooltip');
  if (existing) existing.remove();
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes translateFadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(style);

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    _sender,
    sendResponse: (response: boolean | { loaded: boolean }) => void
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

    if (message.type === 'translateSelection') {
      translateSelection(message.sourceLang, message.targetLang, message.strategy, message.provider)
        .then(() => sendResponse(true))
        .catch(() => sendResponse(false));
      return true;
    }

    if (message.type === 'translatePage') {
      // Store settings for dynamic content translation
      currentSettings = {
        sourceLang: message.sourceLang,
        targetLang: message.targetLang,
        strategy: message.strategy,
        provider: message.provider,
      };

      translatePage(message.sourceLang, message.targetLang, message.strategy, message.provider)
        .then(() => {
          // Start observing for dynamic content
          startMutationObserver();
          sendResponse(true);
        })
        .catch(() => sendResponse(false));
      return true;
    }

    return false;
  }
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
  const sourceLang = siteSpecificRules?.sourceLang || settings.sourceLang || 'auto';
  const targetLang = siteSpecificRules?.targetLang || settings.targetLang || 'fi';
  const strategy = siteSpecificRules?.strategy || settings.strategy || 'smart';
  const provider = siteSpecificRules?.preferredProvider || settings.provider || 'opus-mt';

  if (siteSpecificRules) {
    log.info(' Site-specific rules found for', hostname, siteSpecificRules);
  }

  if (shouldAutoTranslate) {
    log.info(' Auto-translate enabled, translating page...');

    currentSettings = {
      sourceLang,
      targetLang,
      strategy: strategy as Strategy,
      provider: provider as TranslationProviderId,
    };

    // Small delay to let page settle
    setTimeout(() => {
      translatePage(
        currentSettings!.sourceLang,
        currentSettings!.targetLang,
        currentSettings!.strategy,
        currentSettings!.provider
      ).then(() => {
        startMutationObserver();
      });
    }, 1000);
  }
}

// Run auto-translate check on load
if (document.readyState === 'complete') {
  checkAutoTranslate();
} else {
  window.addEventListener('load', checkAutoTranslate);
}

// Cleanup on unload
window.addEventListener('unload', () => {
  stopMutationObserver();
});

log.info(' Translation content script loaded v2.3 with MutationObserver + site rules + glossary support');
