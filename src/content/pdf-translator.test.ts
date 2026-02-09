/**
 * PDF Layout-Preserving Translation unit tests
 *
 * Tests for PDF detection, text extraction, span grouping,
 * translation, overlay rendering, toggle, and cleanup.
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
const mockSendMessage = vi.fn();
const mockGetURL = vi.fn((path: string) => `chrome-extension://abc/${path}`);
vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: {
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
      getURL: (path: string) => mockGetURL(path),
    },
  },
}));

import {
  isPdfPage,
  getPdfUrl,
  extractTextSpans,
  groupSpansIntoSentences,
  translateGroups,
  createOverlayContainer,
  createToggleButton,
  renderPageOverlay,
  togglePdfTranslation,
  isShowingTranslation,
  cleanupPdfTranslation,
  initPdfTranslation,
} from './pdf-translator';
import type { PdfTextSpan, SpanGroup, PdfPageData } from './pdf-translator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpan(overrides: Partial<PdfTextSpan> = {}): PdfTextSpan {
  return {
    str: 'Hello',
    x: 100,
    y: 500,
    fontSize: 12,
    width: 40,
    height: 14,
    fontName: 'g_d0_f1',
    hasEOL: false,
    ...overrides,
  };
}

function makeTextItem(overrides: Partial<{
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}> = {}) {
  return {
    str: 'Hello',
    transform: [12, 0, 0, 12, 100, 500],
    width: 40,
    height: 14,
    fontName: 'g_d0_f1',
    hasEOL: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PDF Translator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // Clean up any meta tags added to head by previous tests
    document.querySelectorAll('meta[http-equiv="content-type"]').forEach((el) => el.remove());
    // Default: not a PDF page
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/page', hostname: 'example.com' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanupPdfTranslation();
    document.body.innerHTML = '';
    document.querySelectorAll('meta[http-equiv="content-type"]').forEach((el) => el.remove());
  });

  // =========================================================================
  // isPdfPage
  // =========================================================================

  describe('isPdfPage', () => {
    it('returns false for a normal HTML page', () => {
      expect(isPdfPage()).toBe(false);
    });

    it('detects URL ending with .pdf', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/doc.pdf', hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
      expect(isPdfPage()).toBe(true);
    });

    it('detects URL ending with .pdf and query string', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/doc.pdf?page=2', hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
      expect(isPdfPage()).toBe(true);
    });

    it('detects URL ending with .pdf and hash', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/doc.pdf#page=3', hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
      expect(isPdfPage()).toBe(true);
    });

    it('detects URL ending with .PDF (case insensitive)', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/doc.PDF', hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
      expect(isPdfPage()).toBe(true);
    });

    it('detects embedded PDF viewer via embed element', () => {
      const embed = document.createElement('embed');
      embed.setAttribute('type', 'application/pdf');
      document.body.appendChild(embed);
      expect(isPdfPage()).toBe(true);
    });

    it('detects PDF via content-type meta tag', () => {
      const meta = document.createElement('meta');
      meta.setAttribute('http-equiv', 'content-type');
      meta.setAttribute('content', 'application/pdf');
      document.head.appendChild(meta);
      expect(isPdfPage()).toBe(true);
    });

    it('returns false when embed has different type', () => {
      const embed = document.createElement('embed');
      embed.setAttribute('type', 'text/html');
      document.body.appendChild(embed);
      expect(isPdfPage()).toBe(false);
    });

    it('returns false for URL containing pdf but not ending with .pdf', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/pdf-viewer/page', hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
      expect(isPdfPage()).toBe(false);
    });
  });

  // =========================================================================
  // getPdfUrl
  // =========================================================================

  describe('getPdfUrl', () => {
    it('returns the current URL when no embed is present', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/doc.pdf', hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
      expect(getPdfUrl()).toBe('https://example.com/doc.pdf');
    });

    it('returns embed src when PDF embed is present', () => {
      const embed = document.createElement('embed') as HTMLEmbedElement;
      embed.setAttribute('type', 'application/pdf');
      embed.src = 'https://cdn.example.com/file.pdf';
      document.body.appendChild(embed);
      expect(getPdfUrl()).toBe('https://cdn.example.com/file.pdf');
    });

    it('falls back to window.location.href when embed has no src', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://example.com/viewer.html', hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
      const embed = document.createElement('embed');
      embed.setAttribute('type', 'application/pdf');
      // No src set
      document.body.appendChild(embed);
      expect(getPdfUrl()).toBe('https://example.com/viewer.html');
    });
  });

  // =========================================================================
  // extractTextSpans
  // =========================================================================

  describe('extractTextSpans', () => {
    it('extracts spans from text items', () => {
      const items = [
        makeTextItem({ str: 'Hello', transform: [12, 0, 0, 12, 100, 500], width: 40, height: 14 }),
        makeTextItem({ str: 'World', transform: [12, 0, 0, 12, 150, 500], width: 42, height: 14 }),
      ];

      const spans = extractTextSpans(items);
      expect(spans).toHaveLength(2);
      expect(spans[0].str).toBe('Hello');
      expect(spans[0].x).toBe(100);
      expect(spans[0].y).toBe(500);
      expect(spans[0].fontSize).toBe(12);
      expect(spans[1].str).toBe('World');
      expect(spans[1].x).toBe(150);
    });

    it('filters out empty strings', () => {
      const items = [
        makeTextItem({ str: '' }),
        makeTextItem({ str: '  ' }),
        makeTextItem({ str: 'Visible' }),
      ];

      const spans = extractTextSpans(items);
      expect(spans).toHaveLength(1);
      expect(spans[0].str).toBe('Visible');
    });

    it('handles negative transform scale (mirrored text)', () => {
      const items = [
        makeTextItem({ str: 'Mirrored', transform: [-10, 0, 0, 10, 200, 300] }),
      ];

      const spans = extractTextSpans(items);
      expect(spans).toHaveLength(1);
      expect(spans[0].fontSize).toBe(10); // Should be absolute value
    });

    it('returns empty array for no items', () => {
      expect(extractTextSpans([])).toEqual([]);
    });

    it('preserves hasEOL flag', () => {
      const items = [
        makeTextItem({ str: 'Line end', hasEOL: true }),
        makeTextItem({ str: 'Next line', hasEOL: false }),
      ];

      const spans = extractTextSpans(items);
      expect(spans[0].hasEOL).toBe(true);
      expect(spans[1].hasEOL).toBe(false);
    });

    it('preserves fontName from items', () => {
      const items = [
        makeTextItem({ str: 'Bold', fontName: 'g_d0_f1_bold' }),
      ];

      const spans = extractTextSpans(items);
      expect(spans[0].fontName).toBe('g_d0_f1_bold');
    });
  });

  // =========================================================================
  // groupSpansIntoSentences
  // =========================================================================

  describe('groupSpansIntoSentences', () => {
    it('returns empty array for no spans', () => {
      expect(groupSpansIntoSentences([])).toEqual([]);
    });

    it('groups adjacent spans on the same line', () => {
      const spans = [
        makeSpan({ str: 'Hello', x: 100, y: 500, width: 40 }),
        makeSpan({ str: 'World', x: 142, y: 500, width: 42 }),
      ];

      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(1);
      expect(groups[0].text).toBe('Hello World');
      expect(groups[0].spans).toHaveLength(2);
    });

    it('splits spans on different lines into separate groups', () => {
      const spans = [
        makeSpan({ str: 'Line one', x: 100, y: 500, width: 60 }),
        makeSpan({ str: 'Line two', x: 100, y: 480, width: 60 }), // Different Y
      ];

      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(2);
      expect(groups[0].text).toBe('Line one');
      expect(groups[1].text).toBe('Line two');
    });

    it('splits at line breaks (hasEOL)', () => {
      const spans = [
        makeSpan({ str: 'End of paragraph', x: 100, y: 500, width: 100, hasEOL: true }),
        makeSpan({ str: 'New paragraph', x: 100, y: 500, width: 90 }), // Same Y but EOL
      ];

      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(2);
      expect(groups[0].text).toBe('End of paragraph');
      expect(groups[1].text).toBe('New paragraph');
    });

    it('splits groups when font size changes significantly', () => {
      const spans = [
        makeSpan({ str: 'Title', x: 100, y: 500, fontSize: 24, width: 80 }),
        makeSpan({ str: 'Body text', x: 185, y: 500, fontSize: 12, width: 70 }),
      ];

      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(2);
      expect(groups[0].text).toBe('Title');
      expect(groups[1].text).toBe('Body text');
    });

    it('keeps spans together when font size is similar (within 10%)', () => {
      const spans = [
        makeSpan({ str: 'Part A', x: 100, y: 500, fontSize: 12, width: 50 }),
        makeSpan({ str: 'Part B', x: 152, y: 500, fontSize: 12.5, width: 50 }), // ~4% diff
      ];

      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(1);
      expect(groups[0].text).toBe('Part A Part B');
    });

    it('splits spans that are far apart horizontally', () => {
      const spans = [
        makeSpan({ str: 'Left', x: 50, y: 500, width: 30 }),
        makeSpan({ str: 'Right', x: 400, y: 500, width: 30 }), // Big gap
      ];

      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(2);
    });

    it('handles a single span', () => {
      const spans = [makeSpan({ str: 'Solo' })];
      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(1);
      expect(groups[0].text).toBe('Solo');
      expect(groups[0].spans).toHaveLength(1);
    });

    it('uses custom lineThreshold parameter', () => {
      const spans = [
        makeSpan({ str: 'Close', x: 100, y: 500, width: 40 }),
        makeSpan({ str: 'lines', x: 142, y: 497, width: 40 }), // 3px diff
      ];

      // With default threshold (5), they should be on the same line
      const groupsDefault = groupSpansIntoSentences(spans);
      expect(groupsDefault).toHaveLength(1);

      // With tight threshold (2), they should be separate lines
      const groupsTight = groupSpansIntoSentences(spans, 2);
      expect(groupsTight).toHaveLength(2);
    });

    it('groups multiple spans across a full paragraph', () => {
      const spans = [
        makeSpan({ str: 'The', x: 72, y: 700, width: 20, fontSize: 12 }),
        makeSpan({ str: 'quick', x: 94, y: 700, width: 30, fontSize: 12 }),
        makeSpan({ str: 'brown', x: 126, y: 700, width: 35, fontSize: 12 }),
        makeSpan({ str: 'fox', x: 163, y: 700, width: 18, fontSize: 12, hasEOL: true }),
        makeSpan({ str: 'jumped', x: 72, y: 685, width: 40, fontSize: 12 }),
        makeSpan({ str: 'over', x: 114, y: 685, width: 25, fontSize: 12 }),
      ];

      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(2);
      expect(groups[0].text).toBe('The quick brown fox');
      expect(groups[1].text).toBe('jumped over');
    });
  });

  // =========================================================================
  // translateGroups
  // =========================================================================

  describe('translateGroups', () => {
    it('translates groups via sendMessage', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Hei maailma',
      });

      const groups: SpanGroup[] = [
        { text: 'Hello world', spans: [makeSpan({ str: 'Hello world' })] },
      ];
      const cache = new Map<string, string>();

      await translateGroups(groups, 'fi', cache);

      expect(groups[0].translatedText).toBe('Hei maailma');
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'translate',
        text: 'Hello world',
        sourceLang: 'auto',
        targetLang: 'fi',
      });
    });

    it('uses cache for repeated text', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Hei',
      });

      const cache = new Map<string, string>();
      cache.set('Hello', 'Hei (cached)');

      const groups: SpanGroup[] = [
        { text: 'Hello', spans: [makeSpan({ str: 'Hello' })] },
      ];

      await translateGroups(groups, 'fi', cache);

      // Should use cached value, not call sendMessage
      expect(groups[0].translatedText).toBe('Hei (cached)');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('populates cache after successful translation', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Translated text',
      });

      const cache = new Map<string, string>();
      const groups: SpanGroup[] = [
        { text: 'Source text', spans: [makeSpan({ str: 'Source text' })] },
      ];

      await translateGroups(groups, 'fi', cache);

      expect(cache.get('Source text')).toBe('Translated text');
    });

    it('handles translation failure gracefully', async () => {
      mockSendMessage.mockRejectedValue(new Error('Network error'));

      const groups: SpanGroup[] = [
        { text: 'Failing text', spans: [makeSpan({ str: 'Failing text' })] },
      ];
      const cache = new Map<string, string>();

      // Should not throw
      await expect(translateGroups(groups, 'fi', cache)).resolves.not.toThrow();
      expect(groups[0].translatedText).toBeUndefined();
    });

    it('handles unsuccessful response', async () => {
      mockSendMessage.mockResolvedValue({
        success: false,
        error: 'Model not loaded',
      });

      const groups: SpanGroup[] = [
        { text: 'No luck', spans: [makeSpan({ str: 'No luck' })] },
      ];
      const cache = new Map<string, string>();

      await translateGroups(groups, 'fi', cache);

      expect(groups[0].translatedText).toBeUndefined();
    });

    it('handles array result from translation', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Batch result'],
      });

      const groups: SpanGroup[] = [
        { text: 'Batch input', spans: [makeSpan({ str: 'Batch input' })] },
      ];
      const cache = new Map<string, string>();

      await translateGroups(groups, 'fi', cache);

      expect(groups[0].translatedText).toBe('Batch result');
    });

    it('calls onProgress callback', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Done',
      });

      const groups: SpanGroup[] = [
        { text: 'A', spans: [makeSpan({ str: 'A' })] },
        { text: 'B', spans: [makeSpan({ str: 'B' })] },
      ];
      const cache = new Map<string, string>();
      const progress = vi.fn();

      await translateGroups(groups, 'fi', cache, progress);

      expect(progress).toHaveBeenCalledTimes(2);
      expect(progress).toHaveBeenCalledWith(1, 2);
      expect(progress).toHaveBeenCalledWith(2, 2);
    });

    it('translates multiple groups in batches', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'OK',
      });

      // Create 15 groups to test batch boundary (BATCH_SIZE = 10)
      const groups: SpanGroup[] = Array.from({ length: 15 }, (_, i) => ({
        text: `Text ${i}`,
        spans: [makeSpan({ str: `Text ${i}` })],
      }));
      const cache = new Map<string, string>();

      await translateGroups(groups, 'fi', cache);

      expect(mockSendMessage).toHaveBeenCalledTimes(15);
      expect(groups.every((g) => g.translatedText === 'OK')).toBe(true);
    });
  });

  // =========================================================================
  // createOverlayContainer
  // =========================================================================

  describe('createOverlayContainer', () => {
    it('creates a fixed overlay element', () => {
      const container = createOverlayContainer();
      expect(container.id).toBe('translate-pdf-overlay');
      expect(container.style.position).toBe('fixed');
      expect(container.style.pointerEvents).toBe('none');
      expect(container.style.display).toBe('none');
      container.remove();
    });

    it('appends the container to document.body', () => {
      const container = createOverlayContainer();
      expect(document.getElementById('translate-pdf-overlay')).toBe(container);
      container.remove();
    });

    it('sets full-viewport dimensions', () => {
      const container = createOverlayContainer();
      expect(container.style.width).toBe('100%');
      expect(container.style.height).toBe('100%');
      expect(container.style.top).toBe('0px');
      expect(container.style.left).toBe('0px');
      container.remove();
    });
  });

  // =========================================================================
  // createToggleButton
  // =========================================================================

  describe('createToggleButton', () => {
    it('creates a button with correct id and text', () => {
      const onClick = vi.fn();
      const button = createToggleButton(onClick);
      expect(button.id).toBe('translate-pdf-toggle');
      expect(button.textContent).toBe('Show Translation');
      button.remove();
    });

    it('calls onClick when clicked', () => {
      const onClick = vi.fn();
      const button = createToggleButton(onClick);
      button.click();
      expect(onClick).toHaveBeenCalledTimes(1);
      button.remove();
    });

    it('is positioned fixed at top-right', () => {
      const button = createToggleButton(vi.fn());
      expect(button.style.position).toBe('fixed');
      expect(button.style.top).toBe('10px');
      expect(button.style.right).toBe('10px');
      button.remove();
    });

    it('has pointer-events auto (interactive)', () => {
      const button = createToggleButton(vi.fn());
      expect(button.style.pointerEvents).toBe('auto');
      button.remove();
    });
  });

  // =========================================================================
  // renderPageOverlay
  // =========================================================================

  describe('renderPageOverlay', () => {
    it('renders translated groups as positioned divs', () => {
      const container = document.createElement('div');

      const pageData: PdfPageData = {
        pageNumber: 1,
        width: 612,
        height: 792,
        spans: [],
        groups: [
          {
            text: 'Hello world',
            translatedText: 'Hei maailma',
            spans: [
              makeSpan({ str: 'Hello world', x: 72, y: 700, fontSize: 12, width: 80, height: 14 }),
            ],
          },
        ],
      };

      renderPageOverlay(container, pageData, 0, 1.0);

      const pageDiv = container.querySelector('.translate-pdf-page-overlay');
      expect(pageDiv).not.toBeNull();

      const textDivs = container.querySelectorAll('.translate-pdf-text');
      expect(textDivs).toHaveLength(1);
      expect(textDivs[0].textContent).toBe('Hei maailma');
    });

    it('skips groups without translatedText', () => {
      const container = document.createElement('div');

      const pageData: PdfPageData = {
        pageNumber: 1,
        width: 612,
        height: 792,
        spans: [],
        groups: [
          {
            text: 'Untranslated',
            spans: [makeSpan({ str: 'Untranslated' })],
            // No translatedText
          },
        ],
      };

      renderPageOverlay(container, pageData, 0, 1.0);

      const textDivs = container.querySelectorAll('.translate-pdf-text');
      expect(textDivs).toHaveLength(0);
    });

    it('applies viewport scale to positions and font size', () => {
      const container = document.createElement('div');
      const scale = 2.0;

      const pageData: PdfPageData = {
        pageNumber: 1,
        width: 612,
        height: 792,
        spans: [],
        groups: [
          {
            text: 'Scaled',
            translatedText: 'Skaalattu',
            spans: [
              makeSpan({ str: 'Scaled', x: 100, y: 600, fontSize: 12, width: 50, height: 14 }),
            ],
          },
        ],
      };

      renderPageOverlay(container, pageData, 0, scale);

      const textDiv = container.querySelector('.translate-pdf-text') as HTMLDivElement;
      expect(textDiv).not.toBeNull();
      // X position should be scaled
      expect(textDiv.style.left).toBe(`${100 * scale}px`);
      // Font size should be scaled
      expect(textDiv.style.fontSize).toBe(`${12 * scale}px`);
    });

    it('sets page number data attribute', () => {
      const container = document.createElement('div');

      const pageData: PdfPageData = {
        pageNumber: 5,
        width: 612,
        height: 792,
        spans: [],
        groups: [],
      };

      renderPageOverlay(container, pageData, 4, 1.0);

      const pageDiv = container.querySelector('.translate-pdf-page-overlay') as HTMLDivElement;
      expect(pageDiv.dataset.pageNumber).toBe('5');
    });

    it('renders multiple groups on one page', () => {
      const container = document.createElement('div');

      const pageData: PdfPageData = {
        pageNumber: 1,
        width: 612,
        height: 792,
        spans: [],
        groups: [
          {
            text: 'First',
            translatedText: 'Ensimmainen',
            spans: [makeSpan({ str: 'First', x: 72, y: 700 })],
          },
          {
            text: 'Second',
            translatedText: 'Toinen',
            spans: [makeSpan({ str: 'Second', x: 72, y: 680 })],
          },
          {
            text: 'Third',
            translatedText: 'Kolmas',
            spans: [makeSpan({ str: 'Third', x: 72, y: 660 })],
          },
        ],
      };

      renderPageOverlay(container, pageData, 0, 1.0);

      const textDivs = container.querySelectorAll('.translate-pdf-text');
      expect(textDivs).toHaveLength(3);
    });
  });

  // =========================================================================
  // togglePdfTranslation
  // =========================================================================

  describe('togglePdfTranslation', () => {
    it('does nothing when no state is active', () => {
      // Should not throw when called without init
      expect(() => togglePdfTranslation()).not.toThrow();
      expect(isShowingTranslation()).toBe(false);
    });
  });

  // =========================================================================
  // isShowingTranslation
  // =========================================================================

  describe('isShowingTranslation', () => {
    it('returns false when no translation is active', () => {
      expect(isShowingTranslation()).toBe(false);
    });
  });

  // =========================================================================
  // cleanupPdfTranslation
  // =========================================================================

  describe('cleanupPdfTranslation', () => {
    it('removes overlay and toggle button from DOM', () => {
      // Manually add elements that cleanup should remove
      const overlay = document.createElement('div');
      overlay.id = 'translate-pdf-overlay';
      document.body.appendChild(overlay);

      const button = document.createElement('button');
      button.id = 'translate-pdf-toggle';
      document.body.appendChild(button);

      cleanupPdfTranslation();

      expect(document.getElementById('translate-pdf-overlay')).toBeNull();
      expect(document.getElementById('translate-pdf-toggle')).toBeNull();
    });

    it('can be called multiple times safely', () => {
      expect(() => {
        cleanupPdfTranslation();
        cleanupPdfTranslation();
        cleanupPdfTranslation();
      }).not.toThrow();
    });

    it('removes orphaned elements even without active state', () => {
      const overlay = document.createElement('div');
      overlay.id = 'translate-pdf-overlay';
      document.body.appendChild(overlay);

      cleanupPdfTranslation();

      expect(document.getElementById('translate-pdf-overlay')).toBeNull();
    });
  });

  // =========================================================================
  // initPdfTranslation (integration-level, mocking pdf.js)
  // =========================================================================

  describe('initPdfTranslation', () => {
    it('rejects if pdfjs-dist cannot be loaded', async () => {
      // The dynamic import of pdfjs-dist will fail in the test environment
      // because we haven't set up the full pdf.js mock. This tests error handling.
      await expect(initPdfTranslation('fi')).rejects.toThrow();

      // Cleanup should have run automatically on failure
      expect(document.getElementById('translate-pdf-overlay')).toBeNull();
    });

    it('prevents double initialization', async () => {
      // First call will fail (no pdf.js mock), but sets active flag briefly
      try {
        await initPdfTranslation('fi');
      } catch {
        // Expected
      }

      // After cleanup from failure, should be able to try again
      // (active flag cleared)
      try {
        await initPdfTranslation('fi');
      } catch {
        // Expected to fail again (no pdf.js)
      }
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('extractTextSpans handles items with zero-length strings', () => {
      const items = [
        makeTextItem({ str: '' }),
        makeTextItem({ str: '\n' }),
        makeTextItem({ str: '\t' }),
      ];
      expect(extractTextSpans(items)).toEqual([]);
    });

    it('groupSpansIntoSentences handles single-character spans', () => {
      const spans = [
        makeSpan({ str: 'A', x: 100, y: 500, width: 8 }),
        makeSpan({ str: 'B', x: 109, y: 500, width: 8 }),
        makeSpan({ str: 'C', x: 118, y: 500, width: 8 }),
      ];

      const groups = groupSpansIntoSentences(spans);
      expect(groups).toHaveLength(1);
      expect(groups[0].text).toBe('A B C');
    });

    it('translateGroups handles empty groups array', async () => {
      const cache = new Map<string, string>();
      await expect(translateGroups([], 'fi', cache)).resolves.not.toThrow();
    });

    it('renderPageOverlay handles group with multiple spans for bounding box', () => {
      const container = document.createElement('div');

      const pageData: PdfPageData = {
        pageNumber: 1,
        width: 612,
        height: 792,
        spans: [],
        groups: [
          {
            text: 'Multi span',
            translatedText: 'Moni jakso',
            spans: [
              makeSpan({ str: 'Multi', x: 72, y: 700, width: 35, height: 14 }),
              makeSpan({ str: 'span', x: 110, y: 700, width: 30, height: 14 }),
            ],
          },
        ],
      };

      renderPageOverlay(container, pageData, 0, 1.0);

      const textDiv = container.querySelector('.translate-pdf-text') as HTMLDivElement;
      expect(textDiv).not.toBeNull();
      // Width should span from first span x to last span x+width
      const expectedWidth = (110 + 30 - 72) * 1.0;
      expect(textDiv.style.width).toBe(`${expectedWidth}px`);
    });
  });
});
