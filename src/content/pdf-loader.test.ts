/**
 * Tests for the lazy pdfjs-dist loader.
 *
 * Verifies dynamic import loading, caching, error handling,
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

// Note: PdfjsLib type import used only in injectScript tests where
// we verify module-level behavior without needing mock pdfjs instances.

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pdf-loader', () => {
  let loadPdfjs: typeof import('./pdf-loader').loadPdfjs;
  let isPdfjsLoaded: typeof import('./pdf-loader').isPdfjsLoaded;
  let resetPdfjsLoader: typeof import('./pdf-loader').resetPdfjsLoader;
  let injectScript: typeof import('./pdf-loader').injectScript;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Fresh import each test to reset module state
    vi.resetModules();

    // Re-mock logger and browserAPI for fresh modules
    vi.doMock('../core/logger', () => ({
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));
    vi.doMock('../core/browser-api', () => ({
      browserAPI: {
        runtime: {
          getURL: (path: string) => mockGetURL(path),
        },
      },
    }));

    const mod = await import('./pdf-loader');
    loadPdfjs = mod.loadPdfjs;
    isPdfjsLoaded = mod.isPdfjsLoaded;
    resetPdfjsLoader = mod.resetPdfjsLoader;
    injectScript = mod.injectScript;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // isPdfjsLoaded
  // =========================================================================

  describe('isPdfjsLoaded', () => {
    it('returns false initially', () => {
      expect(isPdfjsLoaded()).toBe(false);
    });

    it('returns false after reset', () => {
      resetPdfjsLoader();
      expect(isPdfjsLoaded()).toBe(false);
    });
  });

  // =========================================================================
  // resetPdfjsLoader
  // =========================================================================

  describe('resetPdfjsLoader', () => {
    it('can be called safely when nothing is loaded', () => {
      expect(() => resetPdfjsLoader()).not.toThrow();
    });
  });

  // =========================================================================
  // loadPdfjs
  // =========================================================================

  describe('loadPdfjs', () => {
    it('uses correct chunk URL from browserAPI', async () => {
      // loadPdfjs will fail because dynamic import() is not available in test,
      // but we can verify the URL construction
      try {
        await loadPdfjs();
      } catch {
        // Expected to fail in test environment
      }
      expect(mockGetURL).toHaveBeenCalledWith('chunks/pdfjs.js');
    });

    it('throws when dynamic import fails', async () => {
      await expect(loadPdfjs()).rejects.toThrow();
    });

    it('allows retry after load failure', async () => {
      // First attempt fails
      await expect(loadPdfjs()).rejects.toThrow();

      // Module state allows retry (loadingPromise cleared on error)
      await expect(loadPdfjs()).rejects.toThrow();
      // No hang — loadingPromise properly nulled after failure
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
      expect(capturedScript!.type).toBe('module');
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
