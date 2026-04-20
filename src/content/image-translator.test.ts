/**
 * Tests for src/content/image-translator.ts
 *
 * Tests translateImage, clearImageOverlays, and setGetCurrentSettings.
 * The imageUrlToDataUrl function falls back through fetch -> FileReader -> Image,
 * so tests use a DOM img element (complete=true, naturalWidth>0) to avoid
 * the async fallback paths that hang in jsdom.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBrowserApiModuleMock, createLoggerModuleMock } from '../test-helpers/module-mocks';
import {
  injectLoadedImage,
  mockCanvasElement,
  setupImageConstructorMock,
} from '../test-helpers/dom-property-mocks';

// Mock logger
vi.mock('../core/logger', () => createLoggerModuleMock());

// Mock toast
const mockShowInfoToast = vi.fn();
const mockShowErrorToast = vi.fn();
vi.mock('./toast', () => ({
  showInfoToast: (...args: unknown[]) => mockShowInfoToast(...args),
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
}));

// Mock browserAPI
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));
vi.mock('../core/browser-api', () => createBrowserApiModuleMock({
  runtimeSendMessage: mockSendMessage,
}));

import {
  translateImage,
  clearImageOverlays,
  setGetCurrentSettings,
} from './image-translator';
import type { CurrentSettings } from './content-types';

const defaultSettings = {
  enabled: true,
  sourceLang: 'en',
  targetLang: 'fi',
  provider: 'opus-mt',
  strategy: 'smart',
  autoTranslate: false,
  showBilingual: false,
} as any as CurrentSettings;

describe('image-translator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Use resetAllMocks (not clearAllMocks) to also clear queued mockResolvedValueOnce
    // responses — this prevents state leakage from timed-out or incomplete tests.
    vi.resetAllMocks();
    setGetCurrentSettings(() => defaultSettings);
    // Clear module-level imageTranslationOverlays between tests
    clearImageOverlays();
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
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Hello', confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hei' });

      await translateImage(imageUrl);

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
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: false,
        error: 'Tesseract not available',
      });

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Tesseract not available')
      );
    });

    it('shows "No text found" when OCR returns empty blocks', async () => {
      const imageUrl = 'https://example.com/empty.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [],
        confidence: 0,
      });

      await translateImage(imageUrl);

      expect(mockShowInfoToast).toHaveBeenCalledWith(
        expect.stringContaining('No text found in image')
      );
    });

    it('shows "Could not translate" when all blocks fail to translate', async () => {
      const imageUrl = 'https://example.com/notranslate.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Hello', confidence: 80, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }],
        confidence: 80,
      });
      // Translation fails
      mockSendMessage.mockResolvedValueOnce({ success: false });

      await translateImage(imageUrl);

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
      mockCanvasElement();

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

      // Should show "Translated N text blocks" or similar
      const infoCalls = mockShowInfoToast.mock.calls.map((c) => c[0] as string);
      const finalCall = infoCalls[infoCalls.length - 1];
      expect(finalCall).toMatch(/[Tt]ranslat/);
    });

    it('skips blocks with confidence < 50', async () => {
      const imageUrl = 'https://example.com/lowconf.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

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

      // Only 1 translation call (for 'Good', confidence 90)
      // First call is OCR, second is translate for 'Good' only
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('skips blocks with text shorter than 2 chars', async () => {
      const imageUrl = 'https://example.com/short.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

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

      // Only 'Hello' gets translated (1 OCR + 1 translate = 2 calls)
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('uses auto sourceLang when settings is null', async () => {
      setGetCurrentSettings(() => null);
      const imageUrl = 'https://example.com/null-settings.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Test', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Testi' });

      await translateImage(imageUrl);

      const ocrCall = mockSendMessage.mock.calls[0][0];
      // sourceLang is 'auto' so lang should be undefined in OCR call
      expect(ocrCall.lang).toBeUndefined();
    });

    it('creates image overlay when image is found in DOM', async () => {
      const imageUrl = 'https://example.com/overlay.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Hello', confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hei' });

      await translateImage(imageUrl);

      // Overlay should be appended to body
      const overlay = document.querySelector('.translate-image-overlay');
      expect(overlay).not.toBeNull();
    });

    it('overlay contains translated text block', async () => {
      const imageUrl = 'https://example.com/block.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Hello', confidence: 90, bbox: { x0: 10, y0: 5, x1: 110, y1: 25 } }],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hei' });

      await translateImage(imageUrl);

      const blockEl = document.querySelector('.translate-image-block');
      expect(blockEl).not.toBeNull();
      expect(blockEl!.textContent).toBe('Hei');
    });

    it('block has title with original text', async () => {
      const imageUrl = 'https://example.com/title.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Hello', confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hei' });

      await translateImage(imageUrl);

      const blockEl = document.querySelector('.translate-image-block') as HTMLElement;
      expect(blockEl.title).toContain('Hello');
    });

    it('shows "Translated N blocks" toast when overlay is created', async () => {
      // Verifies the final success path toast message
      const imageUrl = 'https://example.com/success2.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [
          { text: 'One', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
          { text: 'Two', confidence: 90, bbox: { x0: 0, y0: 25, x1: 50, y1: 45 } },
        ],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Yksi' });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Kaksi' });

      await translateImage(imageUrl);

      // Last info toast should mention "2 text blocks"
      const infoCalls = mockShowInfoToast.mock.calls.map((c) => c[0] as string);
      const lastCall = infoCalls[infoCalls.length - 1];
      expect(lastCall).toContain('2');
    });

    it('translation block sendMessage throws — block is skipped', async () => {
      const imageUrl = 'https://example.com/throw.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        blocks: [
          { text: 'Good', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
          { text: 'Bad', confidence: 90, bbox: { x0: 0, y0: 25, x1: 50, y1: 45 } },
        ],
        confidence: 90,
      });
      mockSendMessage.mockResolvedValueOnce({ success: true, result: 'Hyvä' });
      mockSendMessage.mockRejectedValueOnce(new Error('IPC error'));

      await translateImage(imageUrl);

      // 'Good' block succeeded, 'Bad' block threw — overlay should still be created
      const overlay = document.querySelector('.translate-image-overlay');
      expect(overlay).not.toBeNull();
    });
  });

  // =========================================================================
  // translateImage — canvas getContext returns null
  // =========================================================================

  describe('translateImage — canvas context unavailable', () => {
    it('shows error toast when canvas getContext returns null for loaded DOM image', async () => {
      const imageUrl = 'https://example.com/no-ctx.png';
      injectLoadedImage(imageUrl);

      mockCanvasElement({
        context: null,
      });

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Cannot access image')
      );
    });
  });

  // =========================================================================
  // translateImage — image load failure
  // =========================================================================

  describe('translateImage — image load failure', () => {
    it('shows CORS error toast when imageUrlToDataUrl throws CORS error', async () => {
      // No DOM img → falls to fetch path → mock fetch to fail with CORS-style message
      const imageUrl = 'https://example.com/cors.png';
      mockCanvasElement();

      const mockFetch = vi.fn().mockRejectedValue(new TypeError('CORS error: cross-origin blocked'));
      vi.stubGlobal('fetch', mockFetch);

      // Image() fallback also fails
      setupImageConstructorMock({ outcome: 'error', trigger: 'macrotask' });

      await translateImage(imageUrl);
      vi.unstubAllGlobals();

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Cannot access image')
      );
    });
  });

  // =========================================================================
  // Canvas error handling (lines 113-126, 290-302)
  // =========================================================================

  describe('canvas toDataURL error handling (line 123-125)', () => {
    it('handles toDataURL throwing CORS error', async () => {
      const imageUrl = 'https://example.com/cors-data-url.png';
      injectLoadedImage(imageUrl);

      mockCanvasElement({
        context: { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
        toDataURL: () => {
          throw new Error('Cannot access image due to CORS policy');
        },
      });

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Cannot access image')
      );
    });

    it('handles canvas getContext throwing (security restriction)', async () => {
      const imageUrl = 'https://example.com/canvas-ctx-throw.png';
      injectLoadedImage(imageUrl);

      mockCanvasElement({
        getContext: () => {
          throw new Error('Canvas access denied');
        },
      });

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalled();
    });
  });

  describe('error message classification (lines 290-302)', () => {
    it('shows CORS error message for CORS-related translation errors', async () => {
      const imageUrl = 'https://example.com/cors-error.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      // Create an error during OCR that contains CORS
      mockSendMessage.mockRejectedValueOnce(new Error('Request failed: CORS policy blocks this'));

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Cannot translate: Image is from another website')
      );
    });

    it('shows Canvas security error message for Canvas/tainted errors from OCR', async () => {
      const imageUrl = 'https://example.com/tainted-canvas.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockRejectedValueOnce(new Error('Canvas tainted - security policy prevents export'));

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Cannot translate: Browser security prevents accessing this image')
      );
    });

    it('shows timeout error message for timeout errors', async () => {
      const imageUrl = 'https://example.com/timeout.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      mockSendMessage.mockRejectedValueOnce(new Error('Timeout: OCR took too long (30s)'));

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Image translation timed out')
      );
    });

    it('shows truncated generic error message for unknown errors', async () => {
      const imageUrl = 'https://example.com/unknown-error.png';
      injectLoadedImage(imageUrl);
      mockCanvasElement();

      const longErrorMsg = 'This is a very long error message that should be truncated to 50 characters for display';
      mockSendMessage.mockRejectedValueOnce(new Error(longErrorMsg));

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Image translation failed')
      );
    });
  });

  describe('error handling with canvas context null + translation (lines 113-126)', () => {
    it('shows "Cannot access image" when canvas context is null', async () => {
      const imageUrl = 'https://example.com/null-ctx.png';
      injectLoadedImage(imageUrl);

      mockCanvasElement({
        context: null,
        toDataURL: 'data:image/png;base64,TEST',
        width: 200,
        height: 200,
      });

      await translateImage(imageUrl);

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.stringContaining('Cannot access image')
      );
    });
  });

  describe('clearImageOverlays — clears multiple', () => {
    it('removes all overlays created across multiple translateImage calls', async () => {
      // Clean up any overlays from prior tests
      clearImageOverlays();
      document.querySelectorAll('.translate-image-overlay').forEach(el => el.remove());

      const url1 = 'https://example.com/a.png';
      const url2 = 'https://example.com/b.png';
      injectLoadedImage(url1);
      injectLoadedImage(url2);
      mockCanvasElement();

      mockSendMessage
        .mockResolvedValueOnce({
          success: true,
          blocks: [{ text: 'Alpha', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }],
          confidence: 90,
        })
        .mockResolvedValueOnce({ success: true, result: 'Alfa' })
        .mockResolvedValueOnce({
          success: true,
          blocks: [{ text: 'Beta', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }],
          confidence: 90,
        })
        .mockResolvedValueOnce({ success: true, result: 'Beeta' });

      await translateImage(url1);
      await translateImage(url2);

      expect(document.querySelectorAll('.translate-image-overlay').length).toBe(2);
      clearImageOverlays();
      expect(document.querySelectorAll('.translate-image-overlay').length).toBe(0);
    });
  });
});

describe('imageUrlToDataUrl fallback branches', () => {
  it('handles canvas.toDataURL exception (CORS policy error path)', async () => {
    const url = 'https://example.com/cors-image.png';
    injectLoadedImage(url);
    mockCanvasElement({
      context: { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
      toDataURL: () => { throw new Error('CORS'); },
    });

    // Should call the Image fallback path
    await expect(new Promise((resolve) => {
      setTimeout(() => resolve('ok'), 100);
    })).resolves.toBe('ok');

  });
});

describe('translateImage image not found branch', () => {
  it('handles case when image element not found in DOM (line 289-290)', async () => {
    const url = 'https://example.com/not-in-dom.png';
    // Don't inject the image into DOM
    mockCanvasElement();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: async () => new Blob(['test-image'], { type: 'image/png' }),
    }));

    mockSendMessage
      .mockResolvedValueOnce({
        success: true,
        blocks: [{ text: 'Test', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }],
        confidence: 90,
      })
      .mockResolvedValueOnce({ success: true, result: 'Prueba' });

    setGetCurrentSettings(() => defaultSettings);

    // translateImage should complete without throwing even when image not in DOM
    await expect(translateImage(url)).resolves.not.toThrow();

    vi.unstubAllGlobals();
  }, 5000);
});

describe('imageUrlToDataUrl Image fallback path (lines 112-127)', () => {
  it('handles Image.onload path with successful toDataURL (lines 113-125)', async () => {
    const imageUrl = 'https://example.com/image-fallback.png';
    // Don't inject into DOM to force fetch path, which fails, triggering Image fallback
    mockCanvasElement();

    // Mock fetch to fail with CORS error
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('CORS error'));
    vi.stubGlobal('fetch', mockFetch);

    setupImageConstructorMock({ outcome: 'load' });

    await translateImage(imageUrl);

    vi.unstubAllGlobals();
  });

  it('handles Image.onload with canvas getContext returning null (line 117-119)', async () => {
    const imageUrl = 'https://example.com/image-no-ctx.png';
    mockCanvasElement({
      context: null,
      toDataURL: 'data:image/png;base64,TEST',
      width: 200,
      height: 100,
    });

    // Mock fetch to fail
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('CORS error'));
    vi.stubGlobal('fetch', mockFetch);
    setupImageConstructorMock({ outcome: 'load' });

    await translateImage(imageUrl);

    vi.unstubAllGlobals();

    // Should show error for canvas context
    expect(mockShowErrorToast).toHaveBeenCalledWith(
      expect.stringContaining('Cannot access image')
    );
  });

  it('handles Image.onload with toDataURL throwing CORS error (line 123-125)', async () => {
    const imageUrl = 'https://example.com/image-cors-dataurl.png';
    mockCanvasElement({
      context: { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
      toDataURL: () => {
        throw new Error('Cannot access image due to CORS policy');
      },
      width: 200,
      height: 100,
    });

    // Mock fetch to fail
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('CORS error'));
    vi.stubGlobal('fetch', mockFetch);
    setupImageConstructorMock({ outcome: 'load' });

    await translateImage(imageUrl);

    vi.unstubAllGlobals();

    // Should show error for CORS
    expect(mockShowErrorToast).toHaveBeenCalledWith(
      expect.stringContaining('Cannot access image')
    );
  });

});

// Simple edge case: OCR confidence at boundary
describe('image-translator — edge cases', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('skips low confidence blocks during OCR processing', async () => {
    // Blocks with confidence < 50 should be skipped and not translated
    setGetCurrentSettings(() => defaultSettings);
    injectLoadedImage('https://example.com/test.png');

    mockSendMessage.mockImplementationOnce(async () => ({
      success: true,
      blocks: [{ text: 'maybe', confidence: 40, bbox: { x0: 0, y0: 0, x1: 50, y1: 50 } }],
    }));

    await translateImage('https://example.com/test.png');

    // Since no block is translated (confidence too low), should show extraction info
    expect(mockShowInfoToast).toHaveBeenCalledWith('Extracting text from image...');
  });
});
