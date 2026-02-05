/**
 * Content Script
 * Handles DOM scanning and text replacement for translations
 *
 * Features:
 * - MutationObserver for dynamic content
 * - Graceful degradation on translation failures
 * - Skip untranslatable elements (scripts, styles, inputs)
 * - Throttled translation to prevent rate limiting
 */

import type { Strategy } from '../types';

interface TranslateMessage {
  type: 'translateSelection' | 'translatePage';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
}

interface TranslateResponse {
  success: boolean;
  result?: string | string[];
  error?: string;
}

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

// Attributes that indicate untranslatable content
const SKIP_ATTRS = [
  'data-no-translate',
  'translate',
  'data-translated',
];

// Mark translated nodes to avoid re-translation
const TRANSLATED_ATTR = 'data-translated';

// Batch configuration
const BATCH_SIZE = 50;
const MAX_TEXT_LENGTH = 5000;
const MIN_TEXT_LENGTH = 2;

// Throttle configuration for dynamic content
const MUTATION_DEBOUNCE_MS = 500;
const MAX_PENDING_MUTATIONS = 100;

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
  if (trimmed.length < MIN_TEXT_LENGTH) return false;
  if (trimmed.length > MAX_TEXT_LENGTH) return false;

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
    console.log('[Content] No text selected');
    return;
  }

  const text = selection.toString().trim();
  if (!isValidText(text)) {
    console.log('[Content] Selected text is not valid for translation');
    return;
  }

  const sanitized = sanitizeText(text);
  console.log('[Content] Translating selection:', sanitized.substring(0, 50) + '...');

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'translate',
      text: sanitized,
      sourceLang,
      targetLang,
      options: { strategy },
      provider,
    })) as TranslateResponse;

    if (response.success && response.result) {
      showTranslationTooltip(response.result as string, selection.getRangeAt(0));
    } else {
      console.error('[Content] Translation failed:', response.error);
      showErrorTooltip(response.error || 'Translation failed', selection.getRangeAt(0));
    }
  } catch (error) {
    console.error('[Content] Translation error:', error);
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
    console.log('[Content] Translation already in progress');
    return;
  }

  isTranslating = true;
  console.log('[Content] Translating page...');

  try {
    const textNodes = getTextNodes(document.body);
    console.log(`[Content] Found ${textNodes.length} text nodes`);

    if (textNodes.length === 0) {
      console.log('[Content] No translatable text found');
      return;
    }

    // Create batches
    const batches: Array<{ nodes: Text[]; texts: string[] }> = [];
    for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
      const batchNodes = textNodes.slice(i, i + BATCH_SIZE);
      const texts = batchNodes.map((n) => sanitizeText(n.textContent || ''));
      batches.push({ nodes: batchNodes, texts });
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
                // Preserve whitespace
                const original = node.textContent || '';
                const leadingSpace = original.match(/^\s*/)?.[0] || '';
                const trailingSpace = original.match(/\s*$/)?.[0] || '';

                node.textContent = leadingSpace + translated + trailingSpace;
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

  const texts = textNodes.map((n) => sanitizeText(n.textContent || ''));

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'translate',
      text: texts,
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
            const original = node.textContent || '';
            const leadingSpace = original.match(/^\s*/)?.[0] || '';
            const trailingSpace = original.match(/\s*$/)?.[0] || '';

            node.textContent = leadingSpace + translated + trailingSpace;
            node.parentElement.setAttribute(TRANSLATED_ATTR, 'true');
          } catch {
            // Ignore - node may have been removed
          }
        }
      });
    }
  } catch (error) {
    console.error('[Content] Dynamic translation error:', error);
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
      if (pendingMutations.length < MAX_PENDING_MUTATIONS) {
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
    }, MUTATION_DEBOUNCE_MS);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('[Content] MutationObserver started');
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
  console.log('[Content] MutationObserver stopped');
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
    message: TranslateMessage | { type: 'ping' } | { type: 'stopAutoTranslate' },
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
  try {
    const settings = await chrome.storage.local.get([
      'autoTranslate',
      'sourceLang',
      'targetLang',
      'strategy',
      'provider',
    ]);

    if (settings.autoTranslate) {
      console.log('[Content] Auto-translate enabled, translating page...');

      currentSettings = {
        sourceLang: settings.sourceLang || 'auto',
        targetLang: settings.targetLang || 'fi',
        strategy: settings.strategy || 'smart',
        provider: settings.provider || 'opus-mt',
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
  } catch (e) {
    console.log('[Content] Could not check auto-translate settings:', e);
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

console.log('[Content] Translation content script loaded v2.2 with MutationObserver + provider support');
