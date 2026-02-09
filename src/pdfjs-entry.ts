/**
 * Entry point for the standalone pdfjs-dist chunk.
 *
 * Built as an IIFE by vite.pdfjs.config.ts and placed in dist/chunks/pdfjs.js.
 * When loaded via a <script> tag, sets window.__pdfjs so the content script's
 * pdf-loader.ts can access the library without bundling it into content.js.
 */

import * as pdfjsLib from 'pdfjs-dist';

// Expose pdfjs on the global window object for the content script to pick up.
// The content script's pdf-loader.ts reads this after injecting the script tag.
(window as unknown as Record<string, unknown>).__pdfjs = pdfjsLib;
