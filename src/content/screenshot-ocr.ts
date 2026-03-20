/**
 * Screenshot translation mode — captures a screen region, OCRs it, and translates.
 *
 * Usage from index.ts:
 *   import { enterScreenshotMode, setGetCurrentSettings } from './screenshot-ocr';
 *   setGetCurrentSettings(() => currentSettings);
 */

import { showInfoToast, showErrorToast } from './toast';
import { browserAPI } from '../core/browser-api';
import type { TranslateResponse } from '../types';
import type { CurrentSettings } from './content-types';

// ---------------------------------------------------------------------------
// Dependency injection — avoids circular imports with index.ts
// ---------------------------------------------------------------------------
let getCurrentSettingsFn: () => CurrentSettings | null = () => null;

export function setGetCurrentSettings(fn: () => CurrentSettings | null): void {
  getCurrentSettingsFn = fn;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------
let screenshotMode = false;
let selectionOverlay: HTMLDivElement | null = null;
let selectionStart: { x: number; y: number } | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function enterScreenshotMode(): void {
  if (screenshotMode) return;
  screenshotMode = true;
  document.body.style.cursor = 'crosshair';

  // Create selection overlay
  selectionOverlay = document.createElement('div');
  Object.assign(selectionOverlay.style, {
    position: 'fixed',
    border: '2px dashed #4A90D9',
    backgroundColor: 'rgba(74, 144, 217, 0.1)',
    zIndex: '2147483646',
    display: 'none',
    pointerEvents: 'none',
  });
  document.body.appendChild(selectionOverlay);

  document.addEventListener('mousedown', onScreenshotMouseDown);
  document.addEventListener('mousemove', onScreenshotMouseMove);
  document.addEventListener('mouseup', onScreenshotMouseUp);
  document.addEventListener('keydown', onScreenshotKeyDown);

  showInfoToast('Draw a rectangle over text to translate');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function exitScreenshotMode(): void {
  screenshotMode = false;
  document.body.style.cursor = '';
  selectionStart = null;

  if (selectionOverlay) {
    selectionOverlay.remove();
    selectionOverlay = null;
  }

  document.removeEventListener('mousedown', onScreenshotMouseDown);
  document.removeEventListener('mousemove', onScreenshotMouseMove);
  document.removeEventListener('mouseup', onScreenshotMouseUp);
  document.removeEventListener('keydown', onScreenshotKeyDown);
}

function onScreenshotKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') exitScreenshotMode();
}

function onScreenshotMouseDown(e: MouseEvent): void {
  if (!screenshotMode) return;
  e.preventDefault();
  selectionStart = { x: e.clientX, y: e.clientY };
  if (selectionOverlay) {
    selectionOverlay.style.display = 'block';
    selectionOverlay.style.left = `${e.clientX}px`;
    selectionOverlay.style.top = `${e.clientY}px`;
    selectionOverlay.style.width = '0px';
    selectionOverlay.style.height = '0px';
  }
}

function onScreenshotMouseMove(e: MouseEvent): void {
  if (!selectionStart || !selectionOverlay) return;
  const x = Math.min(selectionStart.x, e.clientX);
  const y = Math.min(selectionStart.y, e.clientY);
  const w = Math.abs(e.clientX - selectionStart.x);
  const h = Math.abs(e.clientY - selectionStart.y);
  Object.assign(selectionOverlay.style, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`,
  });
}

async function onScreenshotMouseUp(e: MouseEvent): Promise<void> {
  if (!selectionStart) return;

  const rect = {
    x: Math.min(selectionStart.x, e.clientX),
    y: Math.min(selectionStart.y, e.clientY),
    width: Math.abs(e.clientX - selectionStart.x),
    height: Math.abs(e.clientY - selectionStart.y),
  };

  exitScreenshotMode();

  // Minimum selection size
  if (rect.width < 20 || rect.height < 20) return;

  showInfoToast('Extracting text from selection...');

  try {
    // Ask background to capture the visible tab
    const response = await browserAPI.runtime.sendMessage({
      type: 'captureScreenshot',
      rect,
      devicePixelRatio: window.devicePixelRatio || 1,
    }) as { success: boolean; imageData?: string; error?: string };

    if (!response?.success) {
      showErrorToast(response?.error || 'Screenshot failed');
      return;
    }

    // OCR the captured region
    const ocrResponse = await browserAPI.runtime.sendMessage({
      type: 'ocrImage',
      imageData: response.imageData,
    }) as { success: boolean; text?: string; error?: string };

    if (!ocrResponse?.success || !ocrResponse.text?.trim()) {
      showInfoToast('No text found in selection');
      return;
    }

    // Translate the extracted text
    const settings = getCurrentSettingsFn() || { sourceLang: 'auto', targetLang: 'en' };
    const translateResponse = await browserAPI.runtime.sendMessage({
      type: 'translate',
      text: ocrResponse.text,
      sourceLang: settings.sourceLang,
      targetLang: settings.targetLang,
    }) as TranslateResponse;

    if (translateResponse?.success && translateResponse.result) {
      // Show result as overlay at selection position
      showScreenshotResult(translateResponse.result as string, ocrResponse.text, rect);
    } else {
      showErrorToast((translateResponse as { error?: string })?.error || 'Translation failed');
    }
  } catch (error) {
    showErrorToast(`OCR error: ${(error as Error).message}`);
  }
}

function showScreenshotResult(
  translation: string,
  original: string,
  rect: { x: number; y: number; width: number; height: number }
): void {
  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, {
    position: 'fixed',
    left: `${rect.x}px`,
    top: `${rect.y + rect.height + 8}px`,
    maxWidth: `${Math.max(rect.width, 300)}px`,
    padding: '12px 16px',
    backgroundColor: 'rgba(30, 30, 30, 0.95)',
    backdropFilter: 'blur(12px)',
    color: '#fff',
    borderRadius: '8px',
    fontSize: '14px',
    lineHeight: '1.5',
    zIndex: '2147483647',
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.1)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });

  const originalEl = document.createElement('div');
  originalEl.textContent = original;
  Object.assign(originalEl.style, {
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    marginBottom: '8px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    paddingBottom: '8px',
  });

  const translationEl = document.createElement('div');
  translationEl.textContent = translation;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00D7';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '4px',
    right: '8px',
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0 4px',
  });
  closeBtn.onclick = () => tooltip.remove();

  tooltip.appendChild(closeBtn);
  tooltip.appendChild(originalEl);
  tooltip.appendChild(translationEl);
  document.body.appendChild(tooltip);

  // Auto-remove after 30s
  setTimeout(() => tooltip.remove(), 30000);
}
