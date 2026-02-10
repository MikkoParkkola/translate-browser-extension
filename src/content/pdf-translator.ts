/**
 * PDF Layout-Preserving Translation Module
 *
 * Detects PDF pages, extracts text spans with positions using pdf.js,
 * translates them via the extension's translation pipeline, and renders
 * a toggle-able overlay that preserves the original layout.
 *
 * Key design decisions:
 * - Text spans are batched into sentences by proximity before translation
 *   to produce higher-quality translations than individual word translation.
 * - The overlay is absolutely positioned on top of Chrome's built-in PDF viewer.
 * - A toggle button lets users switch between original and translated views.
 * - Cleanup releases all DOM elements and state.
 */

import type { TranslateResponse } from '../types';
import { browserAPI } from '../core/browser-api';
import { createLogger } from '../core/logger';
import { detectLanguage } from '../core/language-detector';
import { loadPdfjs } from './pdf-loader';

const log = createLogger('PDF');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single text span extracted from a PDF page with positional data. */
export interface PdfTextSpan {
  /** The text content of the span. */
  str: string;
  /** X position on the page (from transform[4]). */
  x: number;
  /** Y position on the page (from transform[5]). */
  y: number;
  /** Font scale factor (from transform[0]). */
  fontSize: number;
  /** Width of the text in device-space units. */
  width: number;
  /** Height of the text in device-space units. */
  height: number;
  /** Font name as reported by pdf.js. */
  fontName: string;
  /** Whether the span has a trailing line break. */
  hasEOL: boolean;
}

/** A group of adjacent text spans that form a translatable sentence/phrase. */
export interface SpanGroup {
  /** The combined text of all spans in the group. */
  text: string;
  /** The individual spans that were merged. */
  spans: PdfTextSpan[];
  /** Translated text (populated after translation). */
  translatedText?: string;
}

/** Per-page extraction result. */
export interface PdfPageData {
  pageNumber: number;
  width: number;
  height: number;
  spans: PdfTextSpan[];
  groups: SpanGroup[];
}

/** Internal state of the PDF translator. */
interface PdfTranslatorState {
  pdfUrl: string;
  targetLang: string;
  pages: PdfPageData[];
  overlayContainer: HTMLDivElement | null;
  toggleButton: HTMLButtonElement | null;
  showingTranslation: boolean;
  translationCache: Map<string, string>;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let state: PdfTranslatorState | null = null;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the current page is displaying a PDF.
 *
 * Checks (in order):
 * 1. document.contentType === 'application/pdf' (most reliable, works for
 *    URLs like arxiv.org/pdf/1706.03762 that lack a .pdf extension)
 * 2. URL ends with `.pdf` (with optional query/hash)
 * 3. An `<embed type="application/pdf">` is present (Chrome's built-in viewer)
 * 4. Chrome's newer `<pdf-viewer>` custom element
 * 5. Content-type meta tag indicates PDF
 */
export function isPdfPage(): boolean {
  // Most reliable: browser knows the content type from the HTTP response
  if (document.contentType === 'application/pdf') {
    return true;
  }

  // Check URL pattern (.pdf with optional query/hash)
  const url = window.location.href;
  if (/\.pdf(\?[^#]*)?(#.*)?$/i.test(url)) {
    return true;
  }

  // Check for embedded PDF viewer (classic Chrome viewer)
  const embed = document.querySelector('embed[type="application/pdf"]');
  if (embed) {
    return true;
  }

  // Check for Chrome's newer PDF viewer custom element
  if (document.querySelector('pdf-viewer')) {
    return true;
  }

  // Check content-type meta (some servers set this)
  const meta = document.querySelector('meta[http-equiv="content-type"]');
  if (meta && meta.getAttribute('content')?.includes('application/pdf')) {
    return true;
  }

  return false;
}

/**
 * Extract the actual PDF URL from the current page.
 * Chrome's PDF viewer uses the page URL directly.
 */
export function getPdfUrl(): string {
  // Chrome's built-in PDF viewer: the URL IS the PDF
  const embed = document.querySelector('embed[type="application/pdf"]') as HTMLEmbedElement | null;
  if (embed?.src) {
    return embed.src;
  }
  return window.location.href;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/**
 * Extract text spans from a single PDF page's text content items.
 *
 * Each item from `page.getTextContent()` has:
 * - `str`: the text string
 * - `transform`: [scaleX, skewX, skewY, scaleY, translateX, translateY]
 * - `width`, `height`: dimensions in device-space
 * - `fontName`: the font identifier
 * - `hasEOL`: whether followed by a line break
 *
 * We extract positional data and filter out empty strings.
 */
export function extractTextSpans(
  items: Array<{
    str: string;
    transform: number[];
    width: number;
    height: number;
    fontName: string;
    hasEOL: boolean;
  }>
): PdfTextSpan[] {
  const spans: PdfTextSpan[] = [];

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;

    spans.push({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      fontSize: Math.abs(item.transform[0]),
      width: item.width,
      height: item.height,
      fontName: item.fontName,
      hasEOL: item.hasEOL,
    });
  }

  return spans;
}

/**
 * Group adjacent text spans into translatable sentences/phrases.
 *
 * Spans are grouped when they are:
 * - On the same line (Y position within threshold)
 * - Close horizontally (gap < 2x average character width)
 * - Using the same font size (within 10% tolerance)
 *
 * A new group starts when there is:
 * - A line break (hasEOL on previous span)
 * - A large vertical gap (different line)
 * - A significant font size change (likely a heading boundary)
 */
export function groupSpansIntoSentences(
  spans: PdfTextSpan[],
  lineThreshold = 5
): SpanGroup[] {
  if (spans.length === 0) return [];

  const groups: SpanGroup[] = [];
  let currentSpans: PdfTextSpan[] = [spans[0]];

  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const curr = spans[i];

    // Check if on the same line (Y distance within threshold)
    const sameLine = Math.abs(curr.y - prev.y) < lineThreshold;

    // Check horizontal proximity: gap between end of prev and start of curr
    const prevEnd = prev.x + prev.width;
    const gap = curr.x - prevEnd;
    const avgCharWidth = prev.width / Math.max(prev.str.length, 1);
    const closeHorizontally = gap < avgCharWidth * 2 && gap > -avgCharWidth;

    // Check font size similarity (within 10%)
    const fontSizeSimilar =
      prev.fontSize > 0 &&
      curr.fontSize > 0 &&
      Math.abs(curr.fontSize - prev.fontSize) / prev.fontSize < 0.1;

    // Continue current group if on same line, close, and similar font
    const shouldGroup =
      sameLine && closeHorizontally && fontSizeSimilar && !prev.hasEOL;

    if (shouldGroup) {
      currentSpans.push(curr);
    } else {
      // Finish current group and start new one
      groups.push(createSpanGroup(currentSpans));
      currentSpans = [curr];
    }
  }

  // Don't forget the last group
  if (currentSpans.length > 0) {
    groups.push(createSpanGroup(currentSpans));
  }

  return groups;
}

/** Create a SpanGroup from an array of spans, joining their text. */
function createSpanGroup(spans: PdfTextSpan[]): SpanGroup {
  const text = spans.map((s) => s.str).join(' ');
  return { text, spans };
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

/**
 * Translate an array of span groups via the extension's background service.
 *
 * Sends each group's text through `browserAPI.runtime.sendMessage` and
 * populates `translatedText` on each group.
 *
 * Translation is sequential (one group at a time) to prevent loading
 * multiple OPUS-MT models simultaneously, which exhausts WASM memory
 * (~170MB per model). The first request loads the model; subsequent
 * requests reuse it from the pipeline cache and are fast.
 *
 * Uses a local cache to avoid re-translating identical text.
 */
export async function translateGroups(
  groups: SpanGroup[],
  sourceLang: string,
  targetLang: string,
  cache: Map<string, string>,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  const total = groups.length;
  let completed = 0;

  // Translate sequentially to avoid concurrent model loading.
  // Each OPUS-MT model is ~170MB; parallel requests for different
  // language pairs exhaust WASM memory with ~200MB allocation failures.
  // After the first request loads the model, subsequent requests
  // use the cached pipeline and translate quickly.
  for (const group of groups) {
    // Check cache first
    const cached = cache.get(group.text);
    if (cached) {
      group.translatedText = cached;
      completed++;
      onProgress?.(completed, total);
      continue;
    }

    try {
      const response = (await browserAPI.runtime.sendMessage({
        type: 'translate',
        text: group.text,
        sourceLang,
        targetLang,
      })) as TranslateResponse;

      if (response?.success && response.result) {
        const translated =
          typeof response.result === 'string'
            ? response.result
            : response.result[0];
        group.translatedText = translated;
        cache.set(group.text, translated);
      }
    } catch (err) {
      log.error('Translation failed for group', group.text, err);
      // Leave translatedText undefined on failure
    }

    completed++;
    onProgress?.(completed, total);
  }
}

// ---------------------------------------------------------------------------
// Overlay rendering
// ---------------------------------------------------------------------------

/**
 * Create the main overlay container that sits on top of the PDF viewer.
 * Returns the container element.
 */
export function createOverlayContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = 'translate-pdf-overlay';
  Object.assign(container.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2147483640',
    overflow: 'hidden',
    display: 'none',
  });

  document.body.appendChild(container);
  return container;
}

/**
 * Create the toggle button for switching between original and translated.
 */
export function createToggleButton(
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = 'translate-pdf-toggle';
  button.textContent = 'Show Translation';
  Object.assign(button.style, {
    position: 'fixed',
    top: '10px',
    right: '10px',
    zIndex: '2147483647',
    padding: '8px 16px',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    backdropFilter: 'blur(8px)',
    color: '#f1f5f9',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    pointerEvents: 'auto',
    transition: 'background-color 0.2s ease',
  });

  button.addEventListener('mouseenter', () => {
    button.style.backgroundColor = 'rgba(51, 65, 85, 0.95)';
  });
  button.addEventListener('mouseleave', () => {
    button.style.backgroundColor = 'rgba(30, 41, 59, 0.9)';
  });
  button.addEventListener('click', onClick);

  document.body.appendChild(button);
  return button;
}

/**
 * Render translated text for a single page onto the overlay container.
 *
 * For each SpanGroup that has a translation, creates a positioned div
 * at the coordinates of the first span in the group, with matching
 * font size.
 *
 * The page dimensions from pdf.js are in PDF points (1 point = 1/72 inch).
 * We scale to match the viewport.
 */
export function renderPageOverlay(
  container: HTMLDivElement,
  pageData: PdfPageData,
  pageIndex: number,
  viewportScale: number
): void {
  const pageDiv = document.createElement('div');
  pageDiv.className = 'translate-pdf-page-overlay';
  pageDiv.dataset.pageNumber = String(pageData.pageNumber);
  Object.assign(pageDiv.style, {
    position: 'relative',
    width: `${pageData.width * viewportScale}px`,
    height: `${pageData.height * viewportScale}px`,
    margin: '0 auto',
    // Slight offset for Chrome's PDF viewer page gaps
    marginTop: pageIndex === 0 ? '0' : '8px',
  });

  for (const group of pageData.groups) {
    if (!group.translatedText) continue;

    const firstSpan = group.spans[0];
    const lastSpan = group.spans[group.spans.length - 1];

    // Calculate bounding box of the group
    const groupX = firstSpan.x * viewportScale;
    // PDF Y-axis is bottom-up, so we flip: pageHeight - y
    const groupY =
      (pageData.height - firstSpan.y) * viewportScale;
    const groupWidth =
      (lastSpan.x + lastSpan.width - firstSpan.x) * viewportScale;
    const groupHeight = firstSpan.height * viewportScale;
    const scaledFontSize = firstSpan.fontSize * viewportScale;

    const textDiv = document.createElement('div');
    textDiv.className = 'translate-pdf-text';
    textDiv.textContent = group.translatedText;
    Object.assign(textDiv.style, {
      position: 'absolute',
      left: `${groupX}px`,
      top: `${groupY - groupHeight}px`,
      width: `${Math.max(groupWidth, 50)}px`,
      minHeight: `${groupHeight}px`,
      fontSize: `${scaledFontSize}px`,
      lineHeight: '1.2',
      fontFamily: 'sans-serif',
      color: '#000',
      backgroundColor: 'rgba(255, 255, 255, 0.92)',
      padding: '1px 2px',
      boxSizing: 'border-box',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    });

    pageDiv.appendChild(textDiv);
  }

  container.appendChild(pageDiv);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Initialize PDF translation for the current page.
 *
 * This is the main public API called from content/index.ts when a PDF
 * page is detected.
 *
 * Steps:
 * 1. Load the PDF using pdf.js
 * 2. Extract text spans from each page
 * 3. Group spans into sentences
 * 4. Translate all groups
 * 5. Render the overlay
 * 6. Show the toggle button
 */
export async function initPdfTranslation(targetLang: string): Promise<void> {
  if (state?.active) {
    log.warn('PDF translation already active');
    return;
  }

  const pdfUrl = getPdfUrl();
  log.info('Initializing PDF translation', { pdfUrl, targetLang });

  state = {
    pdfUrl,
    targetLang,
    pages: [],
    overlayContainer: null,
    toggleButton: null,
    showingTranslation: false,
    translationCache: new Map(),
    active: true,
  };

  try {
    // Lazy-load pdfjs from a separate chunk to keep content.js small.
    // The pdf-loader handles script injection and worker configuration.
    const pdfjsLib = await loadPdfjs();

    // Use object form to disable streaming/auto-fetch which can fail
    // in content script context due to CORS restrictions
    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      disableAutoFetch: true,
      disableStream: true,
    });
    const pdf = await loadingTask.promise;

    log.info(`PDF loaded: ${pdf.numPages} pages`);

    // Extract text from all pages
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();

      // Filter to TextItem only (not TextMarkedContent)
      const textItems = textContent.items.filter(
        (item): item is { str: string; transform: number[]; width: number; height: number; fontName: string; hasEOL: boolean; dir: string } =>
          'str' in item
      );

      const spans = extractTextSpans(textItems);
      const groups = groupSpansIntoSentences(spans);

      state.pages.push({
        pageNumber: pageNum,
        width: viewport.width,
        height: viewport.height,
        spans,
        groups,
      });
    }

    const totalGroups = state.pages.reduce((sum, p) => sum + p.groups.length, 0);
    log.info(`Extracted ${totalGroups} text groups from ${pdf.numPages} pages`);

    // Detect document language ONCE from a large sample of all pages.
    // This prevents per-fragment false positives (e.g. short references
    // being misidentified as Dutch/Turkish/Czech) which would trigger
    // loading many different OPUS-MT models and exhausting WASM memory.
    const allGroups = state.pages.flatMap((p) => p.groups);
    const sampleText = allGroups
      .slice(0, 50)
      .map((g) => g.text)
      .join(' ');
    const detected = detectLanguage(sampleText);
    const documentLang = detected?.lang ?? 'en';
    log.info(`Document language detected: ${documentLang} (confidence: ${detected?.confidence ?? 0})`);

    // Skip translation if document is already in target language
    if (documentLang === targetLang) {
      log.info('Document already in target language, skipping translation');
      return;
    }

    await translateGroups(allGroups, documentLang, targetLang, state.translationCache);

    const translatedCount = allGroups.filter((g) => g.translatedText).length;
    log.info(`Translated ${translatedCount}/${totalGroups} groups`);

    // Build overlay
    state.overlayContainer = createOverlayContainer();

    const viewportScale = window.innerWidth / (state.pages[0]?.width || 612);

    for (let i = 0; i < state.pages.length; i++) {
      renderPageOverlay(state.overlayContainer, state.pages[i], i, viewportScale);
    }

    // Create toggle button
    state.toggleButton = createToggleButton(() => {
      togglePdfTranslation();
    });

    log.info('PDF translation ready. Use toggle button to view.');
  } catch (err) {
    log.error('PDF translation failed', err);
    cleanupPdfTranslation();
    throw err;
  }
}

/**
 * Toggle between showing the translated overlay and the original PDF.
 */
export function togglePdfTranslation(): void {
  if (!state) return;

  state.showingTranslation = !state.showingTranslation;

  if (state.overlayContainer) {
    state.overlayContainer.style.display = state.showingTranslation
      ? 'block'
      : 'none';
  }

  if (state.toggleButton) {
    state.toggleButton.textContent = state.showingTranslation
      ? 'Show Original'
      : 'Show Translation';
  }

  log.info(
    `PDF view toggled to: ${state.showingTranslation ? 'translated' : 'original'}`
  );
}

/**
 * Get whether the translation overlay is currently visible.
 */
export function isShowingTranslation(): boolean {
  return state?.showingTranslation ?? false;
}

/**
 * Cleanup PDF translation - remove overlays, toggle button, release state.
 */
export function cleanupPdfTranslation(): void {
  if (state) {
    if (state.overlayContainer) {
      state.overlayContainer.remove();
    }
    if (state.toggleButton) {
      state.toggleButton.remove();
    }
    state.translationCache.clear();
    state.active = false;
  }

  // Also remove any orphaned elements
  document.getElementById('translate-pdf-overlay')?.remove();
  document.getElementById('translate-pdf-toggle')?.remove();

  state = null;
  log.info('PDF translation cleaned up');
}
