/**
 * Alt+Hover translation — translate words on hover while Alt key is held
 */

import type { TranslateResponse } from '../types';
import { escapeHtml } from './sanitize';
import { shouldSkip } from './dom-utils';
import { browserAPI } from '../core/browser-api';
import { safeStorageGet } from '../core/storage';
import { createLogger } from '../core/logger';

const log = createLogger('Content');

let hoverDebounceTimer: number | null = null;
let lastHoveredText: string = '';
let isAltKeyDown = false;
const hoverTranslationCache = new Map<string, string>();

/** Provided by index.ts to resolve 'auto' source language */
let resolveSourceLangFn: (lang: string, text?: string) => string = (l) => l;

/**
 * Inject the resolveSourceLang dependency (avoids circular imports)
 */
export function setResolveSourceLang(fn: (lang: string, text?: string) => string): void {
  resolveSourceLangFn = fn;
}

/**
 * Get word or phrase at cursor position
 */
function getTextAtPoint(x: number, y: number): { text: string; range: Range } | null {
  // Use caretRangeFromPoint if available (Chrome)
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range) return null;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const parent = node.parentElement;
  if (!parent || shouldSkip(parent)) return null;

  const text = node.textContent || '';
  const offset = range.startOffset;

  // Find word boundaries
  let start = offset;
  let end = offset;

  // Expand to word boundaries
  while (start > 0 && /\S/.test(text[start - 1])) start--;
  while (end < text.length && /\S/.test(text[end])) end++;

  const word = text.slice(start, end).trim();
  if (!word || word.length < 2) return null;

  // Create range for the word
  const wordRange = document.createRange();
  wordRange.setStart(node, start);
  wordRange.setEnd(node, end);

  return { text: word, range: wordRange };
}

/**
 * Show hover translation tooltip
 */
function showHoverTooltip(text: string, translatedText: string, rect: DOMRect): void {
  removeHoverTooltip();

  const tooltip = document.createElement('div');
  tooltip.id = 'translate-hover-tooltip';
  tooltip.className = 'translate-hover-tooltip';

  tooltip.innerHTML = `
    <div class="hover-original">${escapeHtml(text)}</div>
    <div class="hover-arrow">-></div>
    <div class="hover-translation">${escapeHtml(translatedText)}</div>
  `;

  Object.assign(tooltip.style, {
    position: 'fixed',
    top: `${Math.max(8, rect.top - 50)}px`,
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 320))}px`,
    maxWidth: '300px',
    padding: '8px 12px',
    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
    color: '#f1f5f9',
    borderRadius: '8px',
    fontSize: '13px',
    lineHeight: '1.4',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(96, 165, 250, 0.2)',
    border: '1px solid rgba(96, 165, 250, 0.15)',
    zIndex: '2147483647',
    animation: 'hoverFadeIn 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    pointerEvents: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });

  document.body.appendChild(tooltip);
}

/**
 * Show loading tooltip
 */
function showLoadingTooltip(rect: DOMRect): void {
  removeHoverTooltip();

  const tooltip = document.createElement('div');
  tooltip.id = 'translate-hover-tooltip';
  tooltip.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <div class="hover-spinner"></div>
      <span>Translating...</span>
    </div>
  `;

  Object.assign(tooltip.style, {
    position: 'fixed',
    top: `${Math.max(8, rect.top - 40)}px`,
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 150))}px`,
    padding: '6px 12px',
    background: '#1e293b',
    color: '#94a3b8',
    borderRadius: '6px',
    fontSize: '12px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
    zIndex: '2147483647',
    pointerEvents: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });

  document.body.appendChild(tooltip);
}

export function removeHoverTooltip(): void {
  const existing = document.getElementById('translate-hover-tooltip');
  if (existing) existing.remove();
}

/**
 * Handle hover translation
 */
async function handleHoverTranslation(e: MouseEvent): Promise<void> {
  if (!isAltKeyDown) return;

  const result = getTextAtPoint(e.clientX, e.clientY);
  if (!result) {
    removeHoverTooltip();
    return;
  }

  const { text, range } = result;

  // Skip if same text
  if (text === lastHoveredText) return;
  lastHoveredText = text;

  const rect = range.getBoundingClientRect();

  // Check cache first (LRU: re-insert on hit to keep at end)
  const cacheKey = text.toLowerCase();
  const cachedTranslation = hoverTranslationCache.get(cacheKey);
  if (cachedTranslation !== undefined) {
    // Touch: move to end of Map for LRU ordering
    hoverTranslationCache.delete(cacheKey);
    hoverTranslationCache.set(cacheKey, cachedTranslation);
    showHoverTooltip(text, cachedTranslation, rect);
    return;
  }

  // Show loading
  showLoadingTooltip(rect);

  let tooltipReplaced = false;
  try {
    // Get current settings
    const settings = await safeStorageGet<{ targetLang?: string; provider?: string }>(['targetLang', 'provider']);
    const targetLang = settings.targetLang || 'en';
    const provider = settings.provider || 'opus-mt';

    // Timeout prevents indefinite hang if service worker is unresponsive
    const HOVER_TIMEOUT_MS = 10000;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    const response = (await Promise.race([
      browserAPI.runtime.sendMessage({
        type: 'translate',
        text: text,
        sourceLang: resolveSourceLangFn('auto', text),
        targetLang,
        options: { strategy: 'fast' },
        provider,
      }),
      new Promise<never>((_, reject) => {
        hoverTimer = setTimeout(() => reject(new Error('Hover translation timed out')), HOVER_TIMEOUT_MS);
      }),
    /* v8 ignore start */
    ]).finally(() => { if (hoverTimer) clearTimeout(hoverTimer); })) as TranslateResponse;
    /* v8 ignore stop */

    if (response.success && response.result) {
      const translated = response.result as string;
      // LRU: delete then re-insert to move to end of Map iteration order
      hoverTranslationCache.delete(cacheKey);
      hoverTranslationCache.set(cacheKey, translated);

      // Evict oldest (first) entry when over limit — Map preserves insertion order
      if (hoverTranslationCache.size > 100) {
        const firstKey = hoverTranslationCache.keys().next().value;
        /* v8 ignore start */
        if (firstKey) hoverTranslationCache.delete(firstKey);
        /* v8 ignore stop */
      }

      showHoverTooltip(text, translated, rect);
      tooltipReplaced = true;
    }
  } catch (error) {
    log.error('Hover translation failed:', error);
  } finally {
    // Always clean up loading tooltip on error/timeout/failure paths.
    // Only keep DOM element if showHoverTooltip replaced it with a result.
    if (!tooltipReplaced) {
      removeHoverTooltip();
    }
  }
}

// Debounced hover handler
function onMouseMove(e: MouseEvent): void {
  if (!isAltKeyDown) return;

  if (hoverDebounceTimer !== null) {
    clearTimeout(hoverDebounceTimer);
  }

  hoverDebounceTimer = window.setTimeout(() => {
    handleHoverTranslation(e);
  }, 150);
}

// Key handlers for Alt key
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Alt' && !isAltKeyDown) {
    isAltKeyDown = true;
    document.body.style.cursor = 'help';
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Alt') {
    isAltKeyDown = false;
    document.body.style.cursor = '';
    removeHoverTooltip();
    lastHoveredText = '';
  }
}

/**
 * Initialize hover translation listeners
 */
export function initHoverListeners(): void {
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    isAltKeyDown = false;
    document.body.style.cursor = '';
    removeHoverTooltip();
  });
}

/**
 * Remove hover translation listeners and clear cache
 */
export function cleanupHoverListeners(): void {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  hoverTranslationCache.clear();
}
