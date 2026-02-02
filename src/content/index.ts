/**
 * Content Script
 * Handles DOM scanning and text replacement for translations
 */

import type { Strategy } from '../types';

interface TranslateMessage {
  type: 'translateSelection' | 'translatePage';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
}

interface TranslateResponse {
  success: boolean;
  result?: string | string[];
  error?: string;
}

// Skip these elements
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
]);

// Mark translated nodes to avoid re-translation
const TRANSLATED_ATTR = 'data-translated';

/**
 * Check if element should be skipped
 */
function shouldSkip(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.getAttribute(TRANSLATED_ATTR)) return true;
  if (element.closest('[contenteditable="true"]')) return true;

  // Check visibility
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return true;

  return false;
}

/**
 * Get all translatable text nodes in element
 */
function getTextNodes(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || shouldSkip(parent)) return NodeFilter.FILTER_REJECT;

      const text = node.textContent?.trim();
      if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;

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
 * Translate selected text
 */
async function translateSelection(
  sourceLang: string,
  targetLang: string,
  strategy: Strategy
): Promise<void> {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    console.log('[Content] No text selected');
    return;
  }

  const text = selection.toString().trim();
  if (!text) return;

  console.log('[Content] Translating selection:', text.substring(0, 50) + '...');

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'translate',
      text,
      sourceLang,
      targetLang,
      options: { strategy },
    })) as TranslateResponse;

    if (response.success && response.result) {
      // Show translation in tooltip or replace
      showTranslationTooltip(response.result as string, selection.getRangeAt(0));
    } else {
      console.error('[Content] Translation failed:', response.error);
    }
  } catch (error) {
    console.error('[Content] Translation error:', error);
  }
}

/**
 * Translate entire page
 */
async function translatePage(
  sourceLang: string,
  targetLang: string,
  strategy: Strategy
): Promise<void> {
  console.log('[Content] Translating page...');

  const textNodes = getTextNodes(document.body);
  console.log(`[Content] Found ${textNodes.length} text nodes`);

  if (textNodes.length === 0) return;

  // Batch texts for efficient translation
  const BATCH_SIZE = 50;
  const batches: Array<{ nodes: Text[]; texts: string[] }> = [];

  for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
    const batchNodes = textNodes.slice(i, i + BATCH_SIZE);
    const texts = batchNodes.map((n) => n.textContent || '');
    batches.push({ nodes: batchNodes, texts });
  }

  console.log(`[Content] Processing ${batches.length} batches`);

  for (const batch of batches) {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'translate',
        text: batch.texts,
        sourceLang,
        targetLang,
        options: { strategy },
      })) as TranslateResponse;

      if (response.success && Array.isArray(response.result)) {
        // Replace text nodes with translations
        response.result.forEach((translated, idx) => {
          const node = batch.nodes[idx];
          if (node && translated) {
            // Preserve whitespace
            const original = node.textContent || '';
            const leadingSpace = original.match(/^\s*/)?.[0] || '';
            const trailingSpace = original.match(/\s*$/)?.[0] || '';

            node.textContent = leadingSpace + translated + trailingSpace;
            node.parentElement?.setAttribute(TRANSLATED_ATTR, 'true');
          }
        });
      }
    } catch (error) {
      console.error('[Content] Batch translation error:', error);
    }
  }

  console.log('[Content] Page translation complete');
}

/**
 * Show translation tooltip
 */
function showTranslationTooltip(text: string, range: Range): void {
  // Remove existing tooltip
  const existing = document.getElementById('translate-tooltip');
  if (existing) existing.remove();

  const rect = range.getBoundingClientRect();

  const tooltip = document.createElement('div');
  tooltip.id = 'translate-tooltip';
  tooltip.textContent = text;
  tooltip.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 8}px;
    left: ${rect.left}px;
    max-width: 400px;
    padding: 12px 16px;
    background: #1e293b;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 999999;
    animation: fadeIn 0.2s ease;
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
  `;
  closeBtn.onclick = () => tooltip.remove();
  tooltip.appendChild(closeBtn);

  document.body.appendChild(tooltip);

  // Auto-remove after 10 seconds
  setTimeout(() => tooltip.remove(), 10000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(style);

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener(
  (message: TranslateMessage, _sender, sendResponse: (response: boolean) => void) => {
    if (message.type === 'translateSelection') {
      translateSelection(message.sourceLang, message.targetLang, message.strategy)
        .then(() => sendResponse(true))
        .catch(() => sendResponse(false));
      return true;
    }

    if (message.type === 'translatePage') {
      translatePage(message.sourceLang, message.targetLang, message.strategy)
        .then(() => sendResponse(true))
        .catch(() => sendResponse(false));
      return true;
    }

    return false;
  }
);

// Check for automatic translation mode
async function checkAutoTranslate(): Promise<void> {
  try {
    const settings = await chrome.storage.local.get(['autoTranslate', 'sourceLang', 'targetLang', 'strategy']);
    if (settings.autoTranslate) {
      console.log('[Content] Auto-translate enabled, translating page...');
      // Small delay to let page settle
      setTimeout(() => {
        translatePage(
          settings.sourceLang || 'auto',
          settings.targetLang || 'fi',
          settings.strategy || 'smart'
        );
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

console.log('[Content] Translation content script loaded');
