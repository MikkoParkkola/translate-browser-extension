/**
 * Lazy loader for pdfjs-dist in the content script.
 *
 * The content script is bundled as IIFE and injected into every page.
 * Including pdfjs-dist (~400KB) in the main bundle is wasteful since
 * PDF translation is only needed on PDF pages.
 *
 * This module loads pdfjs from a separate chunk (`chunks/pdfjs.js`)
 * that is built as a standalone IIFE and exposed via the extension's
 * web_accessible_resources. The chunk sets `window.__pdfjs` which
 * this loader reads after the script executes.
 *
 * Usage:
 *   const pdfjsLib = await loadPdfjs();
 *   const doc = await pdfjsLib.getDocument(url).promise;
 */

import { browserAPI } from '../core/browser-api';
import { createLogger } from '../core/logger';

const log = createLogger('PDFLoader');

/** Minimal interface for the pdfjs API surface we use. */
export interface PdfjsLib {
  getDocument(src: string | URL): { promise: Promise<PdfjsDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

export interface PdfjsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
}

export interface PdfjsPage {
  getViewport(params: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<PdfjsTextContent>;
}

export interface PdfjsTextContent {
  items: PdfjsTextItem[];
}

export interface PdfjsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
  dir: string;
}

// Singleton: once loaded, reuse the same instance.
let cachedPdfjs: PdfjsLib | null = null;
let loadingPromise: Promise<PdfjsLib> | null = null;

/**
 * Inject a script tag pointing to the extension-bundled pdfjs chunk
 * and wait for it to finish loading.
 *
 * The chunk sets `window.__pdfjs` as its export mechanism.
 */
export function injectScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.type = 'text/javascript';
    script.onload = () => {
      // Clean up the script tag after loading
      script.remove();
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load pdfjs chunk from ${url}`));
    };
    (document.head || document.documentElement).appendChild(script);
  });
}

// Declare the global that pdfjs chunk will set
declare global {
  interface Window {
    __pdfjs?: PdfjsLib;
  }
}

/**
 * Load pdfjs-dist lazily from a separate chunk.
 *
 * Returns the pdfjs library object. Caches the result so subsequent
 * calls return immediately.
 *
 * @throws Error if the chunk fails to load or the global is not set.
 */
export async function loadPdfjs(): Promise<PdfjsLib> {
  // Return cached instance if already loaded
  if (cachedPdfjs) {
    return cachedPdfjs;
  }

  // Deduplicate concurrent calls
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    log.info('Loading pdfjs-dist chunk...');

    const chunkUrl = browserAPI.runtime.getURL('chunks/pdfjs.js');
    await injectScript(chunkUrl);

    const pdfjsLib = window.__pdfjs;
    if (!pdfjsLib) {
      throw new Error(
        'pdfjs-dist chunk loaded but window.__pdfjs is not set. ' +
        'Ensure chunks/pdfjs.js is built correctly.'
      );
    }

    // Configure the worker path
    pdfjsLib.GlobalWorkerOptions.workerSrc = browserAPI.runtime.getURL(
      'pdf.worker.min.mjs'
    );

    cachedPdfjs = pdfjsLib;
    log.info('pdfjs-dist loaded successfully');
    return pdfjsLib;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    // Reset so a retry is possible
    loadingPromise = null;
    throw err;
  }
}

/**
 * Check if pdfjs is already loaded (without triggering a load).
 */
export function isPdfjsLoaded(): boolean {
  return cachedPdfjs !== null;
}

/**
 * Reset the loader state. Used in tests and cleanup.
 */
export function resetPdfjsLoader(): void {
  cachedPdfjs = null;
  loadingPromise = null;
  delete window.__pdfjs;
}
