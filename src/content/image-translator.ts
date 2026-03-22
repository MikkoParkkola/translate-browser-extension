/**
 * Image translation — OCR text in images and overlay translations.
 *
 * Usage from index.ts:
 *   import { translateImage, clearImageOverlays, setGetCurrentSettings } from './image-translator';
 *   setGetCurrentSettings(() => currentSettings);
 */

import { showInfoToast, showErrorToast } from './toast';
import { browserAPI } from '../core/browser-api';
import { createLogger } from '../core/logger';
import type { TranslateResponse } from '../types';
import type { CurrentSettings } from './content-types';

const log = createLogger('ImageTranslator');

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

/** Stores active image translation overlays for cleanup */
let imageTranslationOverlays: HTMLElement[] = [];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * OCR block with translation
 */
interface TranslatedBlock {
  original: string;
  translated: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate text in an image using OCR.
 * Reads sourceLang / targetLang / provider from the injected current-settings.
 */
export async function translateImage(imageUrl: string): Promise<void> {
  const settings = getCurrentSettingsFn();
  const sourceLang = settings?.sourceLang ?? 'auto';
  const targetLang = settings?.targetLang ?? 'en';
  const provider = settings?.provider;

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
      /* v8 ignore next */
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
    /* v8 ignore next */
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
export function clearImageOverlays(): void {
  imageTranslationOverlays.forEach((overlay) => overlay.remove());
  imageTranslationOverlays = [];
}
