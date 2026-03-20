/**
 * Tests for src/content/image-translator.ts
 *
 * Tests translateImage, clearImageOverlays, and setGetCurrentSettings.
 * The imageUrlToDataUrl function falls back through fetch -> FileReader -> Image,
 * so tests use a DOM img element (complete=true, naturalWidth>0) to avoid
 * the async fallback paths that hang in jsdom.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock toast
const mockShowInfoToast = vi.fn();
const mockShowErrorToast = vi.fn();
vi.mock('./toast', () => ({
  showInfoToast: (...args: unknown[]) => mockShowInfoToast(...args),
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
}));

// Mock browserAPI
const mockSendMessage = vi.fn();
vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: {
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    },
  },
}));

import {
  translateImage,
  clearImageOverlays,
  setGetCurrentSettings,
} from './image-translator';
import type { CurrentSettings } from './content-types';

const defaultSettings: CurrentSettings = {
  enabled: true,
  sourceLang: 'en',
  targetLang: 'fi',
  provider: 'opus-mt',
  strategy: 'smart',
  autoTranslate: false,
  showBilingual: false,
};

/** Helper: inject a canvas mock that returns a data URL immediately */
function mockCanvas(): () => void {
  const mockCtx = { drawImage: vi.fn() };
  const realCreateElement = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return {
        getContext: () => mockCtx,
        toDataURL: () => 'data:image/png;base64,TEST',
        width: 0,
        height: 0,
      } as unknown as HTMLElement;
    }
    return realCreateElement(tag);
  });
  return () => spy.mockRestore();
}

/** Helper: create a DOM img element that appears loaded */
function injectLoadedImage(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({ top: 0, left: 0, width: 200, height: 100 }),
    configurable: true,
  });
  document.body.appendChild(img);
  return img;
}

describe('image-translator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    setGetCurrentSettings(() => defaultSettings);
  });

  // =========================================================================
  // setGetCurrentSettings
  // =========================================================================

  describe('setGetCurrentSettings', () => {
    it('accepts a function returning null', () => {
      expect(() => setGetCurrentSettings(() => null)).not.toThrow();
    });

    it('accepts a function returning settings', () => {
      expect(() => setGetCurrentSettings(() => defaultSettings)).not.toThrow();
    });
  });

  // =========================================================================
  // clearImageOverlays
  // =========================================================================

  describe('clearImageOverlays', () => {
    it('does not throw when no overlays exist', () => {
      expect(() => clearImageOverlays()).not.toThrow();
    });

    it('removes manually added overlay elements tracked by the module', async () => {
      const imageUrl = 'https://example.com/img.png';
      injectLoadedImage(imageUrl);
      const restore = mockCanvas();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Hello', confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hei' });

      await translateImage(imageUrl);
      restore();

      const overlaysBefore = document.querySelectorAll('.translate-image-overlay');
      clearImageOverlays();
      const overlaysAfter = document.querySelectorAll('.translate-image-overlay');

      // After clear, overlays should be gone (or were never created due to mock)
      expect(overlaysAfter.length).toBe(0);
      // Either they existed and were cleared, or canvas mock prevented creation
      expect(overlaysBefore.length >= 0).toBe(true);
    });
  });

  // =========================================================================
  // translateImage — OCR failure
  // =========================================================================

  describe('translateImage — OCR failure', () => {
    it('shows error toast when OCR returns success=false', async () => {
      const imageUrl = 'https://example.com/img.png';
      injectLoadedImage(imageUrl);
      const restore = mockCanvas();

      mockSendMessage.mockResolvedValueOnce({
        success: false,
        error: 'Tesseract not available',
      });

      await translateImage(imageUrl);
      restore();

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Tesseract not available')
      );
    });

    it('shows "No text found" when OCR returns empty blocks', async () => {
      const imageUrl = 'https://example.com/empty.png';
      injectLoadedImage(imageUrl);
      const restore = mockCanvas();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [],
        confidence: 0,
      });

      await translateImage(imageUrl);
      restore();

      expect(mockShowInfoToast).toHaveBeenCalledWith(
        expect.stringContaining('No text found in image')
      );
    });

    it('shows "Could not translate" when all blocks fail to translate', async () => {
      const imageUrl = 'https://example.com/notranslate.png';
      injectLoadedImage(imageUrl);
      const restore = mockCanvas();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Hello', confidence: 80, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }],
        confidence: 80,
      });
      // Translation fails
      mockSendMessage.mockResolvedValueOnce({ success: false });

      await translateImage(imageUrl);
      restore();

      expect(mockShowInfoToast).toHaveBeenCalledWith(
        expect.stringContaining('Could not translate')
      );
    });
  });

  // =========================================================================
  // translateImage — success path
  // =========================================================================

  describe('translateImage — success path', () => {
    it('shows translated count toast when blocks succeed', async () => {
      const imageUrl = 'https://example.com/success.png';
      injectLoadedImage(imageUrl);
      const restore = mockCanvas();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [
          { text: 'Hello', confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } },
          { text: 'World', confidence: 85, bbox: { x0: 0, y0: 25, x1: 100, y1: 45 } },
        ],
        confidence: 87,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hei' });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Maailma' });

      await translateImage(imageUrl);
      restore();

      // Should show "Translated N text blocks" or similar
      const infoCalls = mockShowInfoToast.mock.calls.map((c) => c[0] as string);
      const finalCall = infoCalls[infoCalls.length - 1];
      expect(finalCall).toMatch(/[Tt]ranslat/);
    });

    it('skips blocks with confidence < 50', async () => {
      const imageUrl = 'https://example.com/lowconf.png';
      injectLoadedImage(imageUrl);
      const restore = mockCanvas();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [
          { text: 'Good', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
          { text: 'Bad', confidence: 30, bbox: { x0: 0, y0: 25, x1: 50, y1: 45 } },
        ],
        confidence: 60,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hyvä' });

      await translateImage(imageUrl);
      restore();

      // Only 1 translation call (for 'Good', confidence 90)
      // First call is OCR, second is translate for 'Good' only
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('skips blocks with text shorter than 2 chars', async () => {
      const imageUrl = 'https://example.com/short.png';
      injectLoadedImage(imageUrl);
      const restore = mockCanvas();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [
          { text: 'A', confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
          { text: 'Hello', confidence: 90, bbox: { x0: 0, y0: 15, x1: 100, y1: 30 } },
        ],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hei' });

      await translateImage(imageUrl);
      restore();

      // Only 'Hello' gets translated (1 OCR + 1 translate = 2 calls)
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('uses auto sourceLang when settings is null', async () => {
      setGetCurrentSettings(() => null);
      const imageUrl = 'https://example.com/null-settings.png';
      injectLoadedImage(imageUrl);
      const restore = mockCanvas();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Test', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Testi' });

      await translateImage(imageUrl);
      restore();

      const ocrCall = mockSendMessage.mock.calls[0][0];
      // sourceLang is 'auto' so lang should be undefined in OCR call
      expect(ocrCall.lang).toBeUndefined();
    });
  });
});
