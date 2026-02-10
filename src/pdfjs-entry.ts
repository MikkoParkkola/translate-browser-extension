/**
 * Entry point for the standalone pdfjs-dist chunk.
 *
 * Built as an ES module by vite.pdfjs.config.ts and placed in dist/chunks/pdfjs.js.
 * Loaded via dynamic import() from the content script's pdf-loader.ts.
 */

import * as pdfjsLib from 'pdfjs-dist';

export default pdfjsLib;
