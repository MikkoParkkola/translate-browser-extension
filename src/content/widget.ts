/**
 * Floating translation widget
 */

import type { TranslateResponse } from '../types';
import { escapeHtml } from './sanitize';
import { browserAPI } from '../core/browser-api';
import { safeStorageGet } from '../core/storage';

let floatingWidget: HTMLElement | null = null;
let widgetVisible = false;
let widgetPosition = { x: 20, y: 20 };
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let widgetDragListenersAdded = false;

const widgetHistory: Array<{ original: string; translated: string }> = [];

/** Provided by index.ts to resolve 'auto' source language */
let resolveSourceLangFn: (lang: string, text?: string) => string = (l) => l;

/**
 * Inject the resolveSourceLang dependency (avoids circular imports)
 */
export function setResolveSourceLang(fn: (lang: string, text?: string) => string): void {
  resolveSourceLangFn = fn;
}

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

export function removeWidgetDragListeners(): void {
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
        sourceLang: resolveSourceLangFn('auto', text),
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
export function showFloatingWidget(): void {
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
export function hideFloatingWidget(): void {
  if (floatingWidget) {
    floatingWidget.style.display = 'none';
    widgetVisible = false;
    removeWidgetDragListeners();
  }
}

/**
 * Toggle floating widget
 */
export function toggleFloatingWidget(): boolean {
  if (widgetVisible) {
    hideFloatingWidget();
  } else {
    showFloatingWidget();
  }
  return widgetVisible;
}

// Test exports (for testing uncovered branches)
export function __testExports() {
  return {
    addToWidgetHistory,
    updateWidgetHistory,
    getWidgetHistory: () => [...widgetHistory],
    clearWidgetHistory: () => widgetHistory.splice(0),
  };
}
