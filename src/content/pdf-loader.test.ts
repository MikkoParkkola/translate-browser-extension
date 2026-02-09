/**
 * Tests for the lazy pdfjs-dist loader.
 *
 * Verifies script injection, caching, error handling,
 * and the resetPdfjsLoader cleanup function.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock browserAPI
const mockGetURL = vi.fn((path: string) => `chrome-extension://test-id/${path}`);
vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: {
      getURL: (path: string) => mockGetURL(path),
    },
  },
}));

import {
  loadPdfjs,
  isPdfjsLoaded,
  resetPdfjsLoader,
  injectScript,
} from './pdf-loader';
import type { PdfjsLib } from './pdf-loader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock PdfjsLib object. */
function makeMockPdfjs(): PdfjsLib {
  return {
    getDocument: vi.fn().mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn() }),
    }),
    GlobalWorkerOptions: { workerSrc: '' },
  };
}

/**
 * Simulate a script tag that fires onload and sets window.__pdfjs.
 *
 * We intercept document.createElement and document.head.appendChild
 * to capture the script element and manually trigger its callbacks.
 */
function setupScriptInjectionMock(pdfjs: PdfjsLib | null, shouldError = false) {
  let capturedScript: HTMLScriptElement | null = null;

  const originalAppendChild = document.head.appendChild.bind(document.head);
  const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
    if (node instanceof HTMLScriptElement && node.src.includes('pdfjs')) {
      capturedScript = node;
      // Simulate async script load
      setTimeout(() => {
        if (shouldError) {
          capturedScript?.onerror?.(new Event('error'));
        } else {
          if (pdfjs) {
            (window as unknown as Record<string, unknown>).__pdfjs = pdfjs;
          }
          capturedScript?.onload?.(new Event('load'));
        }
      }, 0);
      return node;
    }
    return originalAppendChild(node);
  });

  return { appendSpy, getCapturedScript: () => capturedScript };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pdf-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPdfjsLoader();
  });

  afterEach(() => {
    resetPdfjsLoader();
  });

  // =========================================================================
  // isPdfjsLoaded
  // =========================================================================

  describe('isPdfjsLoaded', () => {
    it('returns false initially', () => {
      expect(isPdfjsLoaded()).toBe(false);
    });

    it('returns true after successful load', async () => {
      const mockPdfjs = makeMockPdfjs();
      setupScriptInjectionMock(mockPdfjs);

      await loadPdfjs();
      expect(isPdfjsLoaded()).toBe(true);
    });

    it('returns false after reset', async () => {
      const mockPdfjs = makeMockPdfjs();
      setupScriptInjectionMock(mockPdfjs);

      await loadPdfjs();
      expect(isPdfjsLoaded()).toBe(true);

      resetPdfjsLoader();
      expect(isPdfjsLoaded()).toBe(false);
    });
  });

  // =========================================================================
  // resetPdfjsLoader
  // =========================================================================

  describe('resetPdfjsLoader', () => {
    it('clears cached instance', async () => {
      const mockPdfjs = makeMockPdfjs();
      setupScriptInjectionMock(mockPdfjs);

      await loadPdfjs();
      expect(isPdfjsLoaded()).toBe(true);

      resetPdfjsLoader();
      expect(isPdfjsLoaded()).toBe(false);
      expect(window.__pdfjs).toBeUndefined();
    });

    it('can be called safely when nothing is loaded', () => {
      expect(() => resetPdfjsLoader()).not.toThrow();
    });

    it('allows re-loading after reset', async () => {
      const mockPdfjs1 = makeMockPdfjs();
      setupScriptInjectionMock(mockPdfjs1);
      const result1 = await loadPdfjs();

      resetPdfjsLoader();

      const mockPdfjs2 = makeMockPdfjs();
      setupScriptInjectionMock(mockPdfjs2);
      const result2 = await loadPdfjs();

      // Should be different instances since we reset
      expect(result1).not.toBe(result2);
    });
  });

  // =========================================================================
  // loadPdfjs
  // =========================================================================

  describe('loadPdfjs', () => {
    it('returns the pdfjs library after loading chunk', async () => {
      const mockPdfjs = makeMockPdfjs();
      setupScriptInjectionMock(mockPdfjs);

      const result = await loadPdfjs();
      expect(result).toBe(mockPdfjs);
      expect(result.GlobalWorkerOptions).toBeDefined();
      expect(result.getDocument).toBeDefined();
    });

    it('uses correct chunk URL from browserAPI', async () => {
      const mockPdfjs = makeMockPdfjs();
      const { appendSpy } = setupScriptInjectionMock(mockPdfjs);

      await loadPdfjs();

      expect(mockGetURL).toHaveBeenCalledWith('chunks/pdfjs.js');
      expect(appendSpy).toHaveBeenCalled();
    });

    it('configures worker source after loading', async () => {
      const mockPdfjs = makeMockPdfjs();
      setupScriptInjectionMock(mockPdfjs);

      const result = await loadPdfjs();

      expect(mockGetURL).toHaveBeenCalledWith('pdf.worker.min.mjs');
      expect(result.GlobalWorkerOptions.workerSrc).toBe(
        'chrome-extension://test-id/pdf.worker.min.mjs'
      );
    });

    it('returns cached instance on second call (no re-injection)', async () => {
      const mockPdfjs = makeMockPdfjs();
      const { appendSpy } = setupScriptInjectionMock(mockPdfjs);

      const result1 = await loadPdfjs();
      const result2 = await loadPdfjs();

      expect(result1).toBe(result2);
      // Script should only be injected once
      expect(appendSpy).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent calls', async () => {
      const mockPdfjs = makeMockPdfjs();
      const { appendSpy } = setupScriptInjectionMock(mockPdfjs);

      // Fire two calls simultaneously
      const [result1, result2] = await Promise.all([
        loadPdfjs(),
        loadPdfjs(),
      ]);

      expect(result1).toBe(result2);
      // Only one script injection should occur
      expect(appendSpy).toHaveBeenCalledTimes(1);
    });

    it('throws if script fails to load', async () => {
      setupScriptInjectionMock(null, true /* shouldError */);

      await expect(loadPdfjs()).rejects.toThrow('Failed to load pdfjs chunk');
    });

    it('throws if window.__pdfjs is not set after load', async () => {
      // Script loads successfully but doesn't set the global
      setupScriptInjectionMock(null, false);

      await expect(loadPdfjs()).rejects.toThrow(
        'pdfjs-dist chunk loaded but window.__pdfjs is not set'
      );
    });

    it('allows retry after load failure', async () => {
      // First attempt: error
      setupScriptInjectionMock(null, true);
      await expect(loadPdfjs()).rejects.toThrow();

      // Reset mock for second attempt
      vi.restoreAllMocks();

      // Second attempt: success
      const mockPdfjs = makeMockPdfjs();
      setupScriptInjectionMock(mockPdfjs);
      const result = await loadPdfjs();
      expect(result).toBe(mockPdfjs);
    });
  });

  // =========================================================================
  // injectScript
  // =========================================================================

  describe('injectScript', () => {
    it('creates a script element with the given URL', async () => {
      let capturedScript: HTMLScriptElement | null = null;

      vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLScriptElement) {
          capturedScript = node;
          setTimeout(() => capturedScript?.onload?.(new Event('load')), 0);
        }
        return node;
      });

      await injectScript('chrome-extension://test/chunks/pdfjs.js');

      expect(capturedScript).not.toBeNull();
      expect(capturedScript!.src).toContain('chunks/pdfjs.js');
      expect(capturedScript!.type).toBe('text/javascript');
    });

    it('rejects when script fails to load', async () => {
      vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLScriptElement) {
          setTimeout(() => node.onerror?.(new Event('error')), 0);
        }
        return node;
      });

      await expect(
        injectScript('chrome-extension://test/chunks/bad.js')
      ).rejects.toThrow('Failed to load pdfjs chunk');
    });

    it('removes script tag after successful load', async () => {
      const removeSpy = vi.fn();

      vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLScriptElement) {
          node.remove = removeSpy;
          setTimeout(() => node.onload?.(new Event('load')), 0);
        }
        return node;
      });

      await injectScript('chrome-extension://test/chunks/pdfjs.js');
      expect(removeSpy).toHaveBeenCalled();
    });

    it('removes script tag after failed load', async () => {
      const removeSpy = vi.fn();

      vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
        if (node instanceof HTMLScriptElement) {
          node.remove = removeSpy;
          setTimeout(() => node.onerror?.(new Event('error')), 0);
        }
        return node;
      });

      await expect(
        injectScript('chrome-extension://test/chunks/bad.js')
      ).rejects.toThrow();
      expect(removeSpy).toHaveBeenCalled();
    });
  });
});
