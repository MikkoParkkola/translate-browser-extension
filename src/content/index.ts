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
import { browserAPI } from '../core/browser-api';
// measureTimeAsync imported for future use in async profiling
// import { measureTimeAsync } from '../core/profiler';

const log = createLogger('Content');

// Simple content-script timing tracker (separate from background profiler)
const contentTimings: {
  domScan: number[];
  domUpdate: number[];
  glossaryApply: number[];
  ipcRoundtrip: number[];
} = {
  domScan: [],
  domUpdate: [],
  glossaryApply: [],
  ipcRoundtrip: [],
};

function recordContentTiming(category: keyof typeof contentTimings, durationMs: number): void {
  const arr = contentTimings[category];
  arr.push(durationMs);
  // Keep last 100 entries
  if (arr.length > 100) arr.shift();
}

function getContentTimingStats(): Record<string, { avg: number; min: number; max: number; count: number }> {
  const result: Record<string, { avg: number; min: number; max: number; count: number }> = {};
  for (const [key, arr] of Object.entries(contentTimings)) {
    if (arr.length === 0) continue;
    const sum = arr.reduce((a, b) => a + b, 0);
    result[key] = {
      avg: sum / arr.length,
      min: Math.min(...arr),
      max: Math.max(...arr),
      count: arr.length,
    };
  }
  return result;
}

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

interface TranslateImageMessage {
  type: 'translateImage';
  imageUrl: string;
  sourceLang: string;
  targetLang: string;
  provider?: string;
}

type ContentMessage =
  | TranslateSelectionMessage
  | TranslatePageMessage
  | TranslateImageMessage
  | { type: 'ping' }
  | { type: 'stopAutoTranslate' }
  | { type: 'undoTranslation' }
  | { type: 'toggleBilingualMode' }
  | { type: 'setBilingualMode'; enabled: boolean }
  | { type: 'getBilingualMode' }
  | { type: 'toggleWidget' }
  | { type: 'showWidget' };

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

// Attribute to store original text for undo
const ORIGINAL_TEXT_ATTR = 'data-original-text';

// Attributes for correction learning
const MACHINE_TRANSLATION_ATTR = 'data-machine-translation';
const SOURCE_LANG_ATTR = 'data-source-lang';
const TARGET_LANG_ATTR = 'data-target-lang';

// ============================================================================
// State
// ============================================================================

let isTranslating = false;
let pendingMutations: MutationRecord[] = [];
let mutationDebounceTimer: number | null = null;
let mutationObserver: MutationObserver | null = null;

// WeakMap cache for shouldSkip results — avoids redundant getComputedStyle
// across text nodes sharing the same parent element. Auto-GC'd when elements detach.
const skipCache = new WeakMap<Element, boolean>();
let currentSettings: {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
} | null = null;

// Cache for glossary terms (loaded once per page)
let cachedGlossary: GlossaryStore | null = null;

// ============================================================================
// Toast Notifications
// ============================================================================

/** Active progress toast reference (for live updates during translation) */
let activeProgressToast: HTMLElement | null = null;

/**
 * Show a brief info toast message to the user
 */
function showInfoToast(message: string, durationMs = 3000): void {
  // Remove any existing toast (but not an active progress toast mid-translation)
  const existing = document.getElementById('translate-ext-toast');
  if (existing && existing !== activeProgressToast) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'translate-ext-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1e293b',
    color: '#f1f5f9',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    zIndex: '2147483647',
    opacity: '0',
    transition: 'opacity 0.2s ease',
  });

  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  // Fade out and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, durationMs);
}

/**
 * Show a persistent progress toast that updates in-place during translation.
 * Returns the toast element for live updates. Call removeProgressToast() when done.
 */
function showProgressToast(message: string): HTMLElement {
  // Remove previous progress toast
  removeProgressToast();

  const toast = document.createElement('div');
  toast.id = 'translate-ext-progress-toast';
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1e293b',
    color: '#f1f5f9',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    zIndex: '2147483647',
    opacity: '0',
    transition: 'opacity 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: '200px',
  });

  // Spinner + message + progress bar
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink: 0; animation: translate-spin 1s linear infinite;">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
    </svg>
    <span class="translate-progress-text">${message}</span>
    <style>
      @keyframes translate-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    </style>
  `;

  document.body.appendChild(toast);
  activeProgressToast = toast;

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  return toast;
}

/**
 * Update the text of the active progress toast
 */
function updateProgressToast(message: string): void {
  if (!activeProgressToast) return;
  const textEl = activeProgressToast.querySelector('.translate-progress-text');
  if (textEl) textEl.textContent = message;
}

/**
 * Remove the progress toast with a fade-out
 */
function removeProgressToast(): void {
  if (activeProgressToast) {
    const toast = activeProgressToast;
    activeProgressToast = null;
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }
  // Also remove by ID in case reference was lost
  const existing = document.getElementById('translate-ext-progress-toast');
  if (existing) {
    existing.style.opacity = '0';
    setTimeout(() => existing.remove(), 200);
  }
}

/**
 * Show an error toast message to the user
 */
function showErrorToast(message: string, durationMs = 6000): void {
  // Remove any existing toast
  const existing = document.getElementById('translate-ext-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'translate-ext-toast';
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#991b1b',
    color: '#fef2f2',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
    zIndex: '2147483647',
    opacity: '0',
    transition: 'opacity 0.2s ease',
    maxWidth: '400px',
    textAlign: 'center',
    lineHeight: '1.4',
  });

  // Add icon and message
  toast.innerHTML = `
    <div style="display: flex; align-items: flex-start; gap: 10px;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="flex-shrink: 0; margin-top: 2px;">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="16" r="1" fill="currentColor"/>
      </svg>
      <span>${message}</span>
    </div>
  `;

  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  // Fade out and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, durationMs);
}

// ============================================================================
// Correction Editing (Learn from user corrections)
// ============================================================================

/**
 * Make a translated element editable for corrections
 * When the user clicks on a translated element, they can edit it
 * and the correction will be saved for future translations
 */
function makeTranslatedElementEditable(element: HTMLElement): void {
  // Already set up for editing
  if (element.hasAttribute('data-correction-enabled')) return;

  element.setAttribute('data-correction-enabled', 'true');

  // Add hover indicator
  element.style.cursor = 'text';

  // Handle click to enable editing
  element.addEventListener('click', (e) => {
    // Only enable editing if not already editing
    if (element.getAttribute('contenteditable') === 'true') return;

    // Don't interfere with link clicks
    if ((e.target as Element).closest('a')) return;

    e.preventDefault();
    e.stopPropagation();

    enableCorrectionEditing(element);
  });
}

/**
 * Enable inline editing for a translated element
 */
function enableCorrectionEditing(element: HTMLElement): void {
  const machineTranslation = element.getAttribute(MACHINE_TRANSLATION_ATTR);
  const originalText = element.getAttribute(ORIGINAL_TEXT_ATTR);
  const sourceLang = element.getAttribute(SOURCE_LANG_ATTR);
  const targetLang = element.getAttribute(TARGET_LANG_ATTR);

  if (!machineTranslation || !originalText || !sourceLang || !targetLang) {
    log.warn('Missing data for correction editing');
    return;
  }

  // Store current state
  const currentText = element.textContent || '';

  // Make editable
  element.setAttribute('contenteditable', 'true');
  element.style.outline = '2px solid #3b82f6';
  element.style.outlineOffset = '2px';
  element.style.borderRadius = '2px';
  element.style.minWidth = '20px';
  element.focus();

  // Select all text for easy replacement
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);

  // Handle blur (finish editing)
  const handleBlur = async () => {
    element.removeAttribute('contenteditable');
    element.style.outline = '';
    element.style.outlineOffset = '';

    const newText = element.textContent?.trim() || '';

    // If user cleared the text, restore original
    if (!newText) {
      element.textContent = currentText;
      return;
    }

    // If text changed and is different from machine translation
    if (newText !== currentText && newText !== machineTranslation) {
      try {
        await browserAPI.runtime.sendMessage({
          type: 'addCorrection',
          original: originalText.trim(),
          machineTranslation: machineTranslation,
          userCorrection: newText,
          sourceLang,
          targetLang,
        });
        showInfoToast('Correction saved! Future translations will use your preference.');
        log.info('Correction saved:', { original: originalText.substring(0, 30), correction: newText.substring(0, 30) });
      } catch (error) {
        log.error('Failed to save correction:', error);
        showErrorToast('Failed to save correction');
      }
    } else if (newText === machineTranslation) {
      // User reverted to machine translation, no correction needed
      element.textContent = currentText;
    }
  };

  element.addEventListener('blur', handleBlur, { once: true });

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      element.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Restore original text on escape
      element.textContent = currentText;
      element.blur();
    }
  };

  element.addEventListener('keydown', handleKeyDown);

  // Clean up keydown listener on blur
  element.addEventListener('blur', () => {
    element.removeEventListener('keydown', handleKeyDown);
  }, { once: true });
}

/**
 * Show a hint tooltip on first translated element hover
 */
let correctionHintShown = false;
function showCorrectionHint(_element: HTMLElement): void {
  if (correctionHintShown) return;

  // Check if we've shown the hint before
  const hintKey = 'translate_correction_hint_shown';
  chrome.storage?.local?.get(hintKey).then((result) => {
    if (result[hintKey]) {
      correctionHintShown = true;
      return;
    }

    // Show hint tooltip
    const hint = document.createElement('div');
    hint.id = 'translate-correction-hint';
    Object.assign(hint.style, {
      position: 'fixed',
      bottom: '60px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1e40af',
      color: '#dbeafe',
      padding: '10px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      zIndex: '2147483647',
      maxWidth: '320px',
      textAlign: 'center',
      lineHeight: '1.4',
    });
    hint.textContent = 'Tip: Click on any translated text to edit it. Your corrections will be remembered for future translations!';

    document.body.appendChild(hint);
    correctionHintShown = true;

    // Mark as shown in storage
    chrome.storage?.local?.set({ [hintKey]: true }).catch(() => {});

    // Remove after a few seconds
    setTimeout(() => {
      hint.style.opacity = '0';
      hint.style.transition = 'opacity 0.3s ease';
      setTimeout(() => hint.remove(), 300);
    }, 6000);
  }).catch(() => {
    // Storage not available, just mark as shown
    correctionHintShown = true;
  });
}

// ============================================================================
// Hover Translation (Alt+Hover)
// ============================================================================

let hoverDebounceTimer: number | null = null;
let lastHoveredText: string = '';
let isAltKeyDown = false;
const hoverTranslationCache = new Map<string, string>();

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
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
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

function removeHoverTooltip(): void {
  const existing = document.getElementById('translate-hover-tooltip');
  if (existing) existing.remove();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Floating Translation Widget
// ============================================================================

let floatingWidget: HTMLElement | null = null;
let widgetVisible = false;
let widgetPosition = { x: 20, y: 20 };
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let widgetDragListenersAdded = false;

const widgetHistory: Array<{ original: string; translated: string }> = [];

// Named handlers for widget dragging (so we can remove them)
function handleWidgetMouseMove(e: MouseEvent): void {
  if (!isDragging || !floatingWidget) return;

  const x = Math.max(0, Math.min(window.innerWidth - 280, e.clientX - dragOffset.x));
  const y = Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.y));

  floatingWidget.style.left = `${x}px`;
  floatingWidget.style.top = `${y}px`;
  floatingWidget.style.right = 'auto';

  widgetPosition = { x, y };
}

function handleWidgetMouseUp(): void {
  if (isDragging && floatingWidget) {
    floatingWidget.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
    isDragging = false;
  }
}

function addWidgetDragListeners(): void {
  if (widgetDragListenersAdded) return;
  document.addEventListener('mousemove', handleWidgetMouseMove);
  document.addEventListener('mouseup', handleWidgetMouseUp);
  widgetDragListenersAdded = true;
}

function removeWidgetDragListeners(): void {
  if (!widgetDragListenersAdded) return;
  document.removeEventListener('mousemove', handleWidgetMouseMove);
  document.removeEventListener('mouseup', handleWidgetMouseUp);
  widgetDragListenersAdded = false;
}

/**
 * Create the floating widget
 */
function createFloatingWidget(): HTMLElement {
  const widget = document.createElement('div');
  widget.id = 'translate-floating-widget';
  widget.innerHTML = `
    <div class="widget-header">
      <span class="widget-title">TRANSLATE!</span>
      <button class="widget-close" title="Close">&times;</button>
    </div>
    <div class="widget-body">
      <textarea class="widget-input" placeholder="Enter text to translate..." rows="2"></textarea>
      <div class="widget-controls">
        <select class="widget-lang-select">
          <option value="en">English</option>
          <option value="fi">Finnish</option>
          <option value="sv">Swedish</option>
          <option value="de">German</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
          <option value="nl">Dutch</option>
          <option value="it">Italian</option>
          <option value="pt">Portuguese</option>
          <option value="ja">Japanese</option>
          <option value="zh">Chinese</option>
          <option value="ko">Korean</option>
          <option value="ru">Russian</option>
        </select>
        <button class="widget-translate-btn">Translate</button>
      </div>
      <div class="widget-output"></div>
      <div class="widget-history"></div>
    </div>
  `;

  // Apply styles
  Object.assign(widget.style, {
    position: 'fixed',
    top: `${widgetPosition.y}px`,
    right: `${widgetPosition.x}px`,
    width: '280px',
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
    zIndex: '2147483646',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#f1f5f9',
    overflow: 'hidden',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  });

  // Header styles
  const header = widget.querySelector('.widget-header') as HTMLElement;
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.05)',
    cursor: 'move',
    userSelect: 'none',
  });

  const title = widget.querySelector('.widget-title') as HTMLElement;
  Object.assign(title.style, {
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.5px',
  });

  const closeBtn = widget.querySelector('.widget-close') as HTMLElement;
  Object.assign(closeBtn.style, {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0',
    lineHeight: '1',
  });

  // Body styles
  const body = widget.querySelector('.widget-body') as HTMLElement;
  Object.assign(body.style, {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  });

  // Input styles
  const input = widget.querySelector('.widget-input') as HTMLTextAreaElement;
  Object.assign(input.style, {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #334155',
    borderRadius: '6px',
    background: '#0f172a',
    color: '#f1f5f9',
    fontSize: '13px',
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  });

  // Controls styles
  const controls = widget.querySelector('.widget-controls') as HTMLElement;
  Object.assign(controls.style, {
    display: 'flex',
    gap: '8px',
  });

  const langSelect = widget.querySelector('.widget-lang-select') as HTMLSelectElement;
  Object.assign(langSelect.style, {
    flex: '1',
    padding: '6px 8px',
    border: '1px solid #334155',
    borderRadius: '6px',
    background: '#0f172a',
    color: '#f1f5f9',
    fontSize: '12px',
    cursor: 'pointer',
  });

  const translateBtn = widget.querySelector('.widget-translate-btn') as HTMLButtonElement;
  Object.assign(translateBtn.style, {
    padding: '6px 14px',
    border: 'none',
    borderRadius: '6px',
    background: '#3b82f6',
    color: 'white',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  });

  // Output styles
  const output = widget.querySelector('.widget-output') as HTMLElement;
  Object.assign(output.style, {
    minHeight: '40px',
    padding: '10px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '6px',
    fontSize: '13px',
    lineHeight: '1.5',
    display: 'none',
  });

  // History styles
  const history = widget.querySelector('.widget-history') as HTMLElement;
  Object.assign(history.style, {
    maxHeight: '100px',
    overflowY: 'auto',
    fontSize: '11px',
    color: '#94a3b8',
  });

  // Event handlers
  closeBtn.addEventListener('click', () => hideFloatingWidget());

  translateBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) return;

    translateBtn.textContent = '...';
    translateBtn.disabled = true;

    try {
      const response = await browserAPI.runtime.sendMessage({
        type: 'translate',
        text,
        sourceLang: 'auto',
        targetLang: langSelect.value,
        options: { strategy: 'fast' },
      }) as TranslateResponse;

      if (response.success && response.result) {
        output.textContent = response.result as string;
        output.style.display = 'block';

        // Add to history
        addToWidgetHistory(text, response.result as string);
      } else {
        output.textContent = 'Translation failed';
        output.style.display = 'block';
      }
    } catch (error) {
      output.textContent = 'Error: ' + String(error);
      output.style.display = 'block';
    }

    translateBtn.textContent = 'Translate';
    translateBtn.disabled = false;
  });

  // Enter to translate
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      translateBtn.click();
    }
  });

  // Dragging - only attach mousedown to header, document listeners managed separately
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = widget.getBoundingClientRect();
    dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    widget.style.transition = 'none';
  });

  // Load saved target language
  safeStorageGet<{ targetLang?: string }>(['targetLang']).then((settings) => {
    if (settings.targetLang) {
      langSelect.value = settings.targetLang;
    }
  });

  return widget;
}

function addToWidgetHistory(original: string, translated: string): void {
  widgetHistory.unshift({ original, translated });
  if (widgetHistory.length > 5) widgetHistory.pop();

  updateWidgetHistory();
}

function updateWidgetHistory(): void {
  if (!floatingWidget) return;

  const historyEl = floatingWidget.querySelector('.widget-history') as HTMLElement;
  if (!historyEl) return;

  if (widgetHistory.length === 0) {
    historyEl.style.display = 'none';
    return;
  }

  historyEl.style.display = 'block';
  historyEl.innerHTML = widgetHistory
    .map(
      (h) => `
    <div style="padding: 4px 0; border-bottom: 1px solid #334155;">
      <div style="color: #64748b;">${escapeHtml(h.original.substring(0, 30))}${h.original.length > 30 ? '...' : ''}</div>
      <div style="color: #94a3b8;">${escapeHtml(h.translated.substring(0, 30))}${h.translated.length > 30 ? '...' : ''}</div>
    </div>
  `
    )
    .join('');
}

/**
 * Show floating widget
 */
function showFloatingWidget(): void {
  if (floatingWidget) {
    floatingWidget.style.display = 'block';
    widgetVisible = true;
    addWidgetDragListeners();
    return;
  }

  floatingWidget = createFloatingWidget();
  document.body.appendChild(floatingWidget);
  widgetVisible = true;
  addWidgetDragListeners();

  // Focus input
  const input = floatingWidget.querySelector('.widget-input') as HTMLTextAreaElement;
  setTimeout(() => input?.focus(), 100);
}

/**
 * Hide floating widget
 */
function hideFloatingWidget(): void {
  if (floatingWidget) {
    floatingWidget.style.display = 'none';
    widgetVisible = false;
    removeWidgetDragListeners();
  }
}

/**
 * Toggle floating widget
 */
function toggleFloatingWidget(): boolean {
  if (widgetVisible) {
    hideFloatingWidget();
  } else {
    showFloatingWidget();
  }
  return widgetVisible;
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

  try {
    // Get current settings
    const settings = await safeStorageGet<{ targetLang?: string; provider?: string }>(['targetLang', 'provider']);
    const targetLang = settings.targetLang || 'en';
    const provider = settings.provider || 'opus-mt';

    const response = (await browserAPI.runtime.sendMessage({
      type: 'translate',
      text: text,
      sourceLang: 'auto',
      targetLang,
      options: { strategy: 'fast' },
      provider,
    })) as TranslateResponse;

    if (response.success && response.result) {
      const translated = response.result as string;
      // LRU: delete then re-insert to move to end of Map iteration order
      hoverTranslationCache.delete(cacheKey);
      hoverTranslationCache.set(cacheKey, translated);

      // Evict oldest (first) entry when over limit — Map preserves insertion order
      if (hoverTranslationCache.size > 100) {
        const firstKey = hoverTranslationCache.keys().next().value;
        if (firstKey) hoverTranslationCache.delete(firstKey);
      }

      showHoverTooltip(text, translated, rect);
    } else {
      removeHoverTooltip();
    }
  } catch (error) {
    log.error('Hover translation failed:', error);
    removeHoverTooltip();
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

// Initialize hover translation listeners
document.addEventListener('mousemove', onMouseMove, { passive: true });
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => {
  isAltKeyDown = false;
  document.body.style.cursor = '';
  removeHoverTooltip();
});

// ============================================================================
// Bilingual Reading Mode
// ============================================================================

let bilingualModeEnabled = false;

/**
 * Apply bilingual display to a single translated element.
 * Appends a small original-text annotation after the translated text
 * WITHOUT destroying DOM nodes, event listeners, or text node references.
 */
function applyBilingualToElement(el: Element): void {
  const originalText = el.getAttribute(ORIGINAL_TEXT_ATTR);
  if (!originalText) return;

  // Skip if already has bilingual annotation
  if (el.querySelector('.translate-bilingual-original')) return;

  // Append a subtle original-text annotation (non-destructive)
  const annotation = document.createElement('span');
  annotation.className = 'translate-bilingual-original';
  annotation.textContent = originalText;
  annotation.setAttribute('aria-hidden', 'true'); // Screen readers skip the duplicate

  el.appendChild(annotation);
  el.classList.add('translate-bilingual');
}

/**
 * Remove bilingual annotation from a single element
 */
function removeBilingualFromElement(el: Element): void {
  const annotation = el.querySelector('.translate-bilingual-original');
  if (annotation) annotation.remove();
  el.classList.remove('translate-bilingual');
}

/**
 * Enable bilingual mode - shows original text below translations.
 * Non-destructive: appends annotation spans without touching existing DOM structure.
 */
function enableBilingualMode(): void {
  bilingualModeEnabled = true;

  const translated = document.querySelectorAll(`[${TRANSLATED_ATTR}]`);
  translated.forEach((el) => applyBilingualToElement(el));

  log.info('Bilingual mode enabled');
  showInfoToast('Bilingual mode: showing originals');
}

/**
 * Disable bilingual mode - remove original text annotations
 */
function disableBilingualMode(): void {
  bilingualModeEnabled = false;

  const bilingualElements = document.querySelectorAll('.translate-bilingual');
  bilingualElements.forEach((el) => removeBilingualFromElement(el));

  log.info('Bilingual mode disabled');
  showInfoToast('Bilingual mode off');
}

/**
 * Toggle bilingual mode
 */
function toggleBilingualMode(): boolean {
  if (bilingualModeEnabled) {
    disableBilingualMode();
  } else {
    enableBilingualMode();
  }
  return bilingualModeEnabled;
}

/**
 * Get current bilingual mode state
 */
function getBilingualModeState(): boolean {
  return bilingualModeEnabled;
}

// ============================================================================
// Element Filtering
// ============================================================================

/**
 * Check if element should be skipped for translation
 */
function shouldSkip(element: Element): boolean {
  // Check WeakMap cache first — many text nodes share parents
  const cached = skipCache.get(element);
  if (cached !== undefined) return cached;

  const result = shouldSkipUncached(element);
  skipCache.set(element, result);
  return result;
}

function shouldSkipUncached(element: Element): boolean {
  // Skip by tag name (cheapest check first)
  if (SKIP_TAGS.has(element.tagName)) return true;

  // Skip already translated
  if (element.getAttribute(TRANSLATED_ATTR)) return true;

  // Skip elements with contenteditable (isContentEditable checks inheritance, avoids DOM traversal)
  if ((element as HTMLElement).isContentEditable) return true;

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

// Pre-compiled regexes for isValidText (called per text node, thousands/page)
const NON_TRANSLATABLE_RE = /^[\s\d\p{P}\p{S}]+$/u;
const CODE_OR_URL_RE = /^(https?:|www\.|\/\/|{|}|\[|\]|function|const |let |var )/;

/**
 * Validate text for translation
 */
function isValidText(text: string | null): text is string {
  if (!text) return false;

  const trimmed = text.trim();
  if (trimmed.length < CONFIG.batching.minTextLength) return false;
  if (trimmed.length > CONFIG.batching.maxTextLength) return false;

  // Skip text that's only whitespace, numbers, or symbols
  if (NON_TRANSLATABLE_RE.test(trimmed)) return false;

  // Skip text that looks like code or URLs
  if (CODE_OR_URL_RE.test(trimmed)) return false;

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
// Context Extraction for Improved Translation
// ============================================================================

/**
 * Get surrounding context for better translation of ambiguous words
 * Extracts text before and after the selection from the containing block element
 */
function getSelectionContext(): { before: string; after: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  // Get the paragraph or block element containing the selection
  const blockElement =
    container.nodeType === Node.TEXT_NODE
      ? container.parentElement?.closest('p, div, article, section, li, td, th, blockquote, h1, h2, h3, h4, h5, h6')
      : (container as Element).closest('p, div, article, section, li, td, th, blockquote, h1, h2, h3, h4, h5, h6');

  if (!blockElement) return null;

  const fullText = blockElement.textContent || '';
  const selectedText = selection.toString();
  const selectionIndex = fullText.indexOf(selectedText);

  if (selectionIndex === -1) return null;

  // Extract up to 150 chars before and after for context
  const maxContextLength = 150;
  const before = fullText.slice(Math.max(0, selectionIndex - maxContextLength), selectionIndex).trim();
  const after = fullText
    .slice(selectionIndex + selectedText.length, selectionIndex + selectedText.length + maxContextLength)
    .trim();

  // Only return context if there's meaningful text
  if (!before && !after) return null;

  return { before, after };
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

  // Get surrounding context for better translation of ambiguous words
  const context = getSelectionContext();

  log.info('Translating selection with context:', {
    text: sanitized.substring(0, 50),
    contextBefore: context?.before?.substring(0, 30),
    contextAfter: context?.after?.substring(0, 30),
  });

  try {
    // Apply glossary pre-processing
    const g = await loadGlossary();
    const { processedText, restore } = await glossary.applyGlossary(sanitized, g);

    const response = (await browserAPI.runtime.sendMessage({
      type: 'translate',
      text: processedText,
      sourceLang,
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
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((r) => setTimeout(r, delay));
        console.log(`[Content] Retry attempt ${attempt} for batch`);
      }

      const ipcStart = performance.now();
      const response = (await browserAPI.runtime.sendMessage({
        type: 'translate',
        text: batch.texts,
        sourceLang,
        targetLang,
        options: { strategy },
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
          if (node && translated && node.parentElement) {
            try {
              const finalText = batch.restoreFns[idx](translated);
              const original = node.textContent || '';
              const leadingSpace = original.match(/^\s*/)?.[0] || '';
              const trailingSpace = original.match(/\s*$/)?.[0] || '';

              if (!node.parentElement.hasAttribute(ORIGINAL_TEXT_ATTR)) {
                node.parentElement.setAttribute(ORIGINAL_TEXT_ATTR, original);
              }

              node.parentElement.setAttribute(MACHINE_TRANSLATION_ATTR, finalText);
              node.parentElement.setAttribute(SOURCE_LANG_ATTR, sourceLang);
              node.parentElement.setAttribute(TARGET_LANG_ATTR, targetLang);

              node.textContent = leadingSpace + finalText + trailingSpace;
              node.parentElement.setAttribute(TRANSLATED_ATTR, 'true');
              makeTranslatedElementEditable(node.parentElement);

              // Auto-apply bilingual annotation if bilingual mode is active
              if (bilingualModeEnabled) {
                applyBilingualToElement(node.parentElement);
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

      // Non-retryable error (e.g. unsupported language pair)
      if (response.error && !isTransientError(response.error)) {
        return { translatedCount: 0, errorCount: batch.nodes.length, ipcTime, domUpdateTime: 0 };
      }

      lastError = response.error || 'Translation returned unsuccessful response';
    } catch (error) {
      lastError = error;
      // Network errors are retryable
      if (attempt === maxRetries) break;
    }
  }

  console.error(`[Content] Batch failed after ${maxRetries + 1} attempts:`, lastError);
  return { translatedCount: 0, errorCount: batch.nodes.length, ipcTime: 0, domUpdateTime: 0 };
}

/**
 * Check if an error is likely transient and worth retrying.
 * Pre-compiled regex for performance (called on every retry).
 */
const TRANSIENT_ERROR_RE = /timeout|network|connection|econnreset|fetch failed|service worker|disconnected|offscreen|loading model/i;

function isTransientError(errorMsg: string): boolean {
  return TRANSIENT_ERROR_RE.test(errorMsg);
}

/** Active IntersectionObserver for scroll-aware below-fold translation */
let belowFoldObserver: IntersectionObserver | null = null;

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
  if (isTranslating) {
    log.info(' Translation already in progress');
    return;
  }

  isTranslating = true;
  stopBelowFoldObserver();
  log.info(' Translating page...');
  const pageStart = performance.now();

  try {
    // Time DOM scanning
    const scanStart = performance.now();
    const textNodes = getTextNodes(document.body);
    const scanDuration = performance.now() - scanStart;
    recordContentTiming('domScan', scanDuration);
    console.log(`[Content] Found ${textNodes.length} text nodes in ${scanDuration.toFixed(2)}ms`);

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
      if (!parent) continue;
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

    console.log(`[Content] Viewport: ${viewportNodes.length} nodes, below fold: ${belowFoldNodes.length} nodes`);

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

    // Translate viewport batches with concurrency limit of 2:
    // Pipelines IPC round-trips while model processes previous batch.
    // DOM updates happen in-order within each batch's callback.
    const BATCH_CONCURRENCY = 2;
    for (let i = 0; i < viewportBatches.length; i += BATCH_CONCURRENCY) {
      const chunk = viewportBatches.slice(i, i + BATCH_CONCURRENCY);

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

      // Split below-fold nodes into chunks by screen-height sections
      // Translate the first chunk immediately, defer the rest to scroll
      const IMMEDIATE_BELOW_FOLD = Math.min(belowFoldNodes.length, CONFIG.batching.maxSize * 2);
      const immediateNodes = belowFoldNodes.slice(0, IMMEDIATE_BELOW_FOLD);
      const deferredNodes = belowFoldNodes.slice(IMMEDIATE_BELOW_FOLD);

      // Translate the first section below fold immediately
      const immediateBatches = await createBatches(immediateNodes, g);
      for (const batch of immediateBatches) {
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

    const totalTime = performance.now() - pageStart;
    console.log(
      `[Content] Page translation complete: ${translatedCount} translated, ${errorCount} errors\n` +
      `  Total: ${totalTime.toFixed(2)}ms\n` +
      `  DOM Scan: ${scanDuration.toFixed(2)}ms (${((scanDuration / totalTime) * 100).toFixed(1)}%)\n` +
      `  IPC Total: ${totalIpcTime.toFixed(2)}ms (${((totalIpcTime / totalTime) * 100).toFixed(1)}%)\n` +
      `  DOM Update: ${totalDomUpdateTime.toFixed(2)}ms (${((totalDomUpdateTime / totalTime) * 100).toFixed(1)}%)`
    );

    // Show summary
    if (errorCount > 0 && translatedCount > 0) {
      showInfoToast(`Translated ${translatedCount} items (${errorCount} failed)`);
    } else if (translatedCount > 0 && errorCount === 0) {
      const deferredMsg = belowFoldNodes.length > CONFIG.batching.maxSize * 2
        ? ' (more translates as you scroll)' : '';
      showInfoToast(`Translated ${translatedCount} items${deferredMsg}`);
    } else if (errorCount > 0 && translatedCount === 0) {
      showErrorToast('Translation failed. Please try again.');
    }

    // Log content timing stats
    if (enableProfiling) {
      console.log('[Content] Timing Stats:', getContentTimingStats());
    }
  } finally {
    isTranslating = false;
  }
}

/**
 * Create translation batches from text nodes with glossary pre-processing
 */
async function createBatches(
  nodes: Text[],
  g: GlossaryStore
): Promise<Array<{ nodes: Text[]; texts: string[]; restoreFns: Array<(text: string) => string> }>> {
  const batches: Array<{ nodes: Text[]; texts: string[]; restoreFns: Array<(text: string) => string> }> = [];
  for (let i = 0; i < nodes.length; i += CONFIG.batching.maxSize) {
    const batchNodes = nodes.slice(i, i + CONFIG.batching.maxSize);
    const rawTexts = batchNodes.map((n) => {
      const text = sanitizeText(n.textContent || '');
      return text.length > CONFIG.batching.maxTextLength
        ? text.substring(0, CONFIG.batching.maxTextLength)
        : text;
    });

    const { processedTexts, restoreFns } = await glossary.applyGlossaryBatch(rawTexts, g);
    batches.push({ nodes: batchNodes, texts: processedTexts, restoreFns });
  }
  return batches;
}

/**
 * Set up IntersectionObserver to translate deferred below-fold content
 * as the user scrolls near it. Translates in chunks using sentinel elements.
 */
function setupScrollAwareTranslation(
  deferredNodes: Text[],
  sourceLang: string,
  targetLang: string,
  strategy: Strategy,
  g: GlossaryStore,
  provider?: string,
  enableProfiling = false
): void {
  // Split deferred nodes into chunks of ~2 batches worth
  const chunkSize = CONFIG.batching.maxSize * 2;
  const chunks: Text[][] = [];
  for (let i = 0; i < deferredNodes.length; i += chunkSize) {
    chunks.push(deferredNodes.slice(i, i + chunkSize));
  }

  console.log(`[Content] Deferring ${deferredNodes.length} nodes in ${chunks.length} scroll-triggered chunks`);

  const translatedChunks = new Set<number>();

  belowFoldObserver = new IntersectionObserver(
    async (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const chunkIndex = Number((entry.target as HTMLElement).dataset.translateChunk);
        if (isNaN(chunkIndex) || translatedChunks.has(chunkIndex)) continue;

        translatedChunks.add(chunkIndex);
        belowFoldObserver?.unobserve(entry.target);

        const chunk = chunks[chunkIndex];
        if (!chunk || !currentSettings) return;

        // Filter out nodes that are no longer in the DOM or already translated
        const validNodes = chunk.filter(
          (n) => n.parentElement && document.contains(n) && !n.parentElement.hasAttribute(TRANSLATED_ATTR)
        );
        if (validNodes.length === 0) return;

        console.log(`[Content] Scroll-triggered: translating chunk ${chunkIndex + 1}/${chunks.length} (${validNodes.length} nodes)`);

        try {
          const batches = await createBatches(validNodes, g);
          for (const batch of batches) {
            await translateBatchWithRetry(
              batch, sourceLang, targetLang, strategy, provider, enableProfiling
            );
          }
        } catch (error) {
          console.error(`[Content] Scroll-triggered translation error for chunk ${chunkIndex}:`, error);
        }
      }
    },
    { rootMargin: '200% 0px' } // Start translating 2 viewports before the user scrolls there
  );

  // Observe a sentinel element near the first node of each chunk
  for (let i = 0; i < chunks.length; i++) {
    const firstNode = chunks[i][0];
    const parent = firstNode?.parentElement;
    if (!parent || !document.contains(parent)) continue;

    // Use the parent element as the observation target, tag it with chunk index
    parent.dataset.translateChunk = String(i);
    belowFoldObserver.observe(parent);
  }
}

/**
 * Translate dynamically added content (with batching to respect MAX_BATCH_SIZE)
 */
async function translateDynamicContent(nodes: Node[]): Promise<void> {
  if (!currentSettings || isTranslating) return;

  const textNodes = getTextNodesFromNodes(nodes);
  if (textNodes.length === 0) return;

  console.log(`[Content] Translating ${textNodes.length} dynamic text nodes`);

  try {
    const g = await loadGlossary();
    const batches = await createBatches(textNodes, g);

    for (const batch of batches) {
      if (!currentSettings) return; // Settings cleared (e.g. undo called)

      const result = await translateBatchWithRetry(
        batch,
        currentSettings.sourceLang,
        currentSettings.targetLang,
        currentSettings.strategy,
        currentSettings.provider,
        false, // enableProfiling
        1      // maxRetries: fewer retries for dynamic content to avoid blocking
      );

      if (result.errorCount > 0 && result.translatedCount === 0) {
        log.error(` Dynamic batch fully failed (${result.errorCount} nodes)`);
      }
    }
  } catch (error) {
    log.error(' Dynamic translation error:', error);
    // Only show error toast for non-transient failures to avoid spamming the user
    if (error instanceof Error && !isTransientError(error.message)) {
      showErrorToast(error.message);
    }
  }
}

// ============================================================================
// Undo Translation
// ============================================================================

/**
 * Undo all translations on the page, restoring original text
 */
function undoTranslation(): number {
  // Stop any ongoing mutation observation
  stopMutationObserver();
  currentSettings = null;

  // Count and clear image translation overlays
  const imageOverlayCount = imageTranslationOverlays.length;
  clearImageOverlays();

  // Find all translated elements
  const translatedElements = document.querySelectorAll(`[${TRANSLATED_ATTR}]`);
  let restoredCount = imageOverlayCount;

  translatedElements.forEach((element) => {
    const originalText = element.getAttribute(ORIGINAL_TEXT_ATTR);
    if (originalText !== null) {
      // Find the text node and restore original
      const textNode = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE
      );
      if (textNode) {
        textNode.textContent = originalText;
        restoredCount++;
      }
    }

    // Clean up attributes and invalidate skip cache
    element.removeAttribute(TRANSLATED_ATTR);
    element.removeAttribute(ORIGINAL_TEXT_ATTR);
    skipCache.delete(element);
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
const MUTATION_BATCH_CAP = 100;

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

  if (addedNodes.length === 0) return;

  // Process in capped chunks to avoid main-thread jank
  if (addedNodes.length <= MUTATION_BATCH_CAP) {
    translateDynamicContent(addedNodes);
  } else {
    // Process first chunk immediately
    translateDynamicContent(addedNodes.slice(0, MUTATION_BATCH_CAP));
    // Defer remaining chunks via requestIdleCallback / setTimeout
    let offset = MUTATION_BATCH_CAP;
    const processNextChunk = () => {
      if (offset >= addedNodes.length) return;
      const chunk = addedNodes.slice(offset, offset + MUTATION_BATCH_CAP);
      offset += MUTATION_BATCH_CAP;
      translateDynamicContent(chunk);
      if (offset < addedNodes.length) {
        if ('requestIdleCallback' in window) {
          (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(processNextChunk);
        } else {
          setTimeout(processNextChunk, 50);
        }
      }
    };
    if ('requestIdleCallback' in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(processNextChunk);
    } else {
      setTimeout(processNextChunk, 50);
    }
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
  stopBelowFoldObserver();
  removeProgressToast();
  log.info(' MutationObserver stopped');
}

// ============================================================================
// Image Translation (OCR)
// ============================================================================

/** Stores active image translation overlays for cleanup */
let imageTranslationOverlays: HTMLElement[] = [];

/**
 * OCR block with translation
 */
interface TranslatedBlock {
  original: string;
  translated: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Create translation overlay for an image
 * Positions translated text blocks over the original image
 */
function createImageOverlay(img: HTMLImageElement, translatedBlocks: TranslatedBlock[]): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'translate-image-overlay';

  const rect = img.getBoundingClientRect();
  const scaleX = rect.width / img.naturalWidth;
  const scaleY = rect.height / img.naturalHeight;

  Object.assign(overlay.style, {
    position: 'absolute',
    top: `${rect.top + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
    zIndex: '999998',
  });

  translatedBlocks.forEach((block) => {
    const blockEl = document.createElement('div');
    blockEl.className = 'translate-image-block';
    blockEl.textContent = block.translated;

    const blockWidth = (block.bbox.x1 - block.bbox.x0) * scaleX;
    const blockHeight = (block.bbox.y1 - block.bbox.y0) * scaleY;
    const fontSize = Math.max(10, Math.min(blockHeight * 0.7, 24));

    Object.assign(blockEl.style, {
      position: 'absolute',
      left: `${block.bbox.x0 * scaleX}px`,
      top: `${block.bbox.y0 * scaleY}px`,
      width: `${blockWidth}px`,
      minHeight: `${blockHeight}px`,
      background: 'rgba(255, 255, 255, 0.95)',
      color: '#1e293b',
      padding: '2px 4px',
      fontSize: `${fontSize}px`,
      lineHeight: '1.2',
      overflow: 'hidden',
      borderRadius: '2px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      wordBreak: 'break-word',
    });

    // Add title with original text for hover
    blockEl.title = `Original: ${block.original}`;

    overlay.appendChild(blockEl);
  });

  document.body.appendChild(overlay);
  imageTranslationOverlays.push(overlay);

  return overlay;
}

/**
 * Find the image element on the page that matches the URL
 */
function findImageByUrl(url: string): HTMLImageElement | null {
  const images = document.querySelectorAll('img');
  for (const img of images) {
    if (img.src === url || img.currentSrc === url) {
      return img;
    }
  }
  return null;
}

/**
 * Convert image URL to data URL for OCR processing
 */
async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  // First try to find the image in the DOM to get its dimensions
  const img = findImageByUrl(imageUrl);

  if (img && img.complete && img.naturalWidth > 0) {
    // Image is in DOM and loaded - use canvas to get data URL
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');

    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // Image not in DOM or not loaded - fetch it
  try {
    const response = await fetch(imageUrl, { mode: 'cors' });
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    // CORS error - try loading via Image element
    return new Promise((resolve, reject) => {
      const tempImg = new Image();
      tempImg.crossOrigin = 'anonymous';
      tempImg.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = tempImg.naturalWidth;
        canvas.height = tempImg.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported'));
          return;
        }
        ctx.drawImage(tempImg, 0, 0);
        try {
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(new Error('Cannot access image due to CORS policy'));
        }
      };
      tempImg.onerror = () => reject(new Error('Failed to load image'));
      tempImg.src = imageUrl;
    });
  }
}

/**
 * OCR response from background
 */
interface OCRResponse {
  success: boolean;
  text?: string;
  confidence?: number;
  blocks?: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
  error?: string;
}

/**
 * Translate text in an image using OCR
 */
async function translateImage(
  imageUrl: string,
  sourceLang: string,
  targetLang: string,
  provider?: string
): Promise<void> {
  showInfoToast('Extracting text from image...');

  try {
    // Convert image to data URL for OCR
    let imageData: string;
    try {
      imageData = await imageUrlToDataUrl(imageUrl);
    } catch (error) {
      log.error('Failed to load image:', error);
      showErrorToast('Cannot access image (CORS restriction)');
      return;
    }

    // Send to background for OCR
    const ocrResult = (await browserAPI.runtime.sendMessage({
      type: 'ocrImage',
      imageData,
      lang: sourceLang !== 'auto' ? sourceLang : undefined,
    })) as OCRResponse;

    if (!ocrResult.success) {
      showErrorToast(ocrResult.error || 'OCR failed');
      return;
    }

    if (!ocrResult.blocks || ocrResult.blocks.length === 0) {
      showInfoToast('No text found in image');
      return;
    }

    log.info(`OCR found ${ocrResult.blocks.length} text blocks (${ocrResult.confidence?.toFixed(1)}% confidence)`);
    showInfoToast(`Translating ${ocrResult.blocks.length} text blocks...`);

    // Translate each block
    const translatedBlocks: TranslatedBlock[] = [];

    for (const block of ocrResult.blocks) {
      // Skip very short text (likely noise)
      if (block.text.trim().length < 2) continue;

      // Skip low confidence blocks
      if (block.confidence < 50) {
        log.debug(`Skipping low confidence block: "${block.text}" (${block.confidence.toFixed(1)}%)`);
        continue;
      }

      try {
        const response = (await browserAPI.runtime.sendMessage({
          type: 'translate',
          text: block.text,
          sourceLang,
          targetLang,
          provider,
        })) as TranslateResponse;

        if (response.success && response.result) {
          translatedBlocks.push({
            original: block.text,
            translated: response.result as string,
            bbox: block.bbox,
          });
        }
      } catch (error) {
        log.warn(`Failed to translate block: "${block.text}"`, error);
      }
    }

    if (translatedBlocks.length === 0) {
      showInfoToast('Could not translate image text');
      return;
    }

    // Find the image element and create overlay
    const img = findImageByUrl(imageUrl);
    if (img) {
      createImageOverlay(img, translatedBlocks);
      showInfoToast(`Translated ${translatedBlocks.length} text blocks`);
    } else {
      log.warn('Could not find image element for overlay');
      showInfoToast(`Translated ${translatedBlocks.length} blocks (overlay unavailable)`);
    }
  } catch (error) {
    log.error('Image translation failed:', error);
    // Provide more specific error message based on error type
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('CORS') || errorMessage.includes('cross-origin')) {
      showErrorToast('Cannot translate: Image is from another website (CORS blocked)');
    } else if (errorMessage.includes('Canvas') || errorMessage.includes('tainted')) {
      showErrorToast('Cannot translate: Browser security prevents accessing this image');
    } else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      showErrorToast('Image translation timed out. Try a smaller image.');
    } else {
      showErrorToast('Image translation failed: ' + errorMessage.substring(0, 50));
    }
  }
}

/**
 * Clear all image translation overlays
 */
function clearImageOverlays(): void {
  imageTranslationOverlays.forEach((overlay) => overlay.remove());
  imageTranslationOverlays = [];
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
  @keyframes hoverFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .hover-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #475569;
    border-top-color: #60a5fa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .hover-original { color: #94a3b8; }
  .hover-arrow { color: #60a5fa; font-weight: bold; }
  .hover-translation { color: #f1f5f9; font-weight: 500; }

  /* Bilingual Reading Mode - non-destructive annotation */
  .translate-bilingual {
    position: relative;
  }
  .translate-bilingual-original {
    display: block;
    font-size: 0.8em;
    line-height: 1.3;
    color: #6b7280;
    font-style: italic;
    opacity: 0.7;
    margin-top: 1px;
    pointer-events: none;
    user-select: none;
  }
  /* Inline elements (span, a, em, strong) — keep annotation inline-block to avoid breaking flow */
  span.translate-bilingual > .translate-bilingual-original,
  a.translate-bilingual > .translate-bilingual-original,
  em.translate-bilingual > .translate-bilingual-original,
  strong.translate-bilingual > .translate-bilingual-original {
    display: inline-block;
    margin-top: 0;
    margin-left: 4px;
    vertical-align: baseline;
  }
  /* Inline elements: parenthesized format for compact display */
  span.translate-bilingual > .translate-bilingual-original::before { content: '('; }
  span.translate-bilingual > .translate-bilingual-original::after { content: ')'; }
  a.translate-bilingual > .translate-bilingual-original::before { content: '('; }
  a.translate-bilingual > .translate-bilingual-original::after { content: ')'; }
  em.translate-bilingual > .translate-bilingual-original::before { content: '('; }
  em.translate-bilingual > .translate-bilingual-original::after { content: ')'; }
  strong.translate-bilingual > .translate-bilingual-original::before { content: '('; }
  strong.translate-bilingual > .translate-bilingual-original::after { content: ')'; }
  @media (prefers-color-scheme: dark) {
    .translate-bilingual-original {
      color: #9ca3af;
    }
  }

  /* Image Translation Overlay */
  .translate-image-overlay {
    pointer-events: none;
  }
  .translate-image-block {
    pointer-events: auto;
    cursor: help;
    transition: transform 0.1s ease;
  }
  .translate-image-block:hover {
    transform: scale(1.02);
    z-index: 1;
  }
`;
document.head.appendChild(style);

// ============================================================================
// Message Handling
// ============================================================================

browserAPI.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    _sender,
    sendResponse: (response: boolean | { loaded: boolean } | { success: boolean; restoredCount: number } | { enabled: boolean } | { visible: boolean }) => void
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

    if (message.type === 'translateImage') {
      translateImage(
        message.imageUrl,
        message.sourceLang,
        message.targetLang,
        message.provider
      )
        .then(() => sendResponse(true))
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
    log.info(' Auto-translate enabled, waiting for page idle...');

    currentSettings = {
      sourceLang,
      targetLang,
      strategy: strategy as Strategy,
      provider: provider as TranslationProviderId,
    };

    // Wait for browser idle to avoid competing with page rendering.
    // requestIdleCallback fires when browser has spare cycles; fallback to 500ms for Firefox.
    const startTranslation = () => {
      if (!currentSettings) return; // User may have cancelled
      translatePage(
        currentSettings.sourceLang,
        currentSettings.targetLang,
        currentSettings.strategy,
        currentSettings.provider
      ).then(() => {
        startMutationObserver();
      });
    };

    if ('requestIdleCallback' in window) {
      (window as Window).requestIdleCallback(startTranslation, { timeout: 2000 });
    } else {
      setTimeout(startTranslation, 500);
    }
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
  stopBelowFoldObserver();
  removeProgressToast();
});

log.info(' Translation content script loaded v2.3 with MutationObserver + site rules + glossary support');
