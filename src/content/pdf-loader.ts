/**
 * Lazy loader for pdfjs-dist in the content script.
 *
 * The content script is bundled as IIFE and injected into every page.
 * Including pdfjs-dist (~400KB) in the main bundle is wasteful since
 * PDF translation is only needed on PDF pages.
 *
 * Loading strategy:
 * - Uses dynamic import() to load the ES module chunk from the
 *   extension's web_accessible_resources. This runs in the content
 *   script's isolated world — no eval, no globals, no CSP issues.
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
  getDocument(src: string | URL | { url: string; disableAutoFetch?: boolean; disableStream?: boolean }): { promise: Promise<PdfjsDocument> };
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
 * Dynamic import wrapper.
 *
 * The @vite-ignore comment tells Vite/Rollup to leave this import()
 * as-is in the output. Chrome content scripts support native import()
 * for URLs in web_accessible_resources (Chrome 89+).
 */
function dynamicImport(url: string): Promise<Record<string, unknown>> {
  return import(/* @vite-ignore */ url);
}

/**
 * Inject a script tag pointing to the extension-bundled pdfjs chunk
 * and wait for it to finish loading.
 *
 * NOTE: This is a fallback for environments without dynamic import().
 * The script runs in the page's main world, not the content script's
 * isolated world, so it has limited usefulness.
 */
export function injectScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.type = 'module';
    script.onload = () => {
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

/**
 * Load pdfjs-dist lazily from a separate ES module chunk.
 *
 * Returns the pdfjs library object. Caches the result so subsequent
 * calls return immediately.
 *
 * @throws Error if the chunk fails to load or the module exports are invalid.
 */
export async function loadPdfjs(): Promise<PdfjsLib> {
  if (cachedPdfjs) {
    return cachedPdfjs;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    log.info('Loading pdfjs-dist chunk...');

    const chunkUrl = browserAPI.runtime.getURL('chunks/pdfjs.js');

    // Dynamic import() works in Chrome MV3 content scripts (Chrome 89+)
    // for URLs listed in web_accessible_resources.
    let module: Record<string, unknown>;
    try {
      module = await dynamicImport(chunkUrl);
    } catch (importError) {
      log.error('Dynamic import of pdfjs chunk failed:', importError);
      throw new Error(
        `Failed to import pdfjs chunk: ${importError instanceof Error ? importError.message : String(importError)}`
      );
    }

    // The ES module default export is the pdfjs library
    const pdfjsLib = (module.default || module) as PdfjsLib;
    if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
      throw new Error(
        'pdfjs chunk loaded but exports are invalid. ' +
        'Expected getDocument function on default export.'
      );
    }

    // Point worker to the bundled worker file in web_accessible_resources.
    // Chrome content scripts can spawn workers from extension URLs.
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      browserAPI.runtime.getURL('chunks/pdf.worker.min.mjs');

    cachedPdfjs = pdfjsLib;
    log.info('pdfjs-dist loaded successfully');
    return pdfjsLib;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
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
}
