import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Separate Vite config for the pdfjs-dist chunk.
 *
 * Builds pdfjs-dist as a standalone IIFE that sets window.__pdfjs.
 * This chunk is loaded on-demand by the content script only when
 * a PDF page is detected, keeping the main content.js small.
 */
export default defineConfig({
  plugins: [],
  base: '',
  build: {
    outDir: 'dist/chunks',
    emptyOutDir: false,
    sourcemap: true,
    target: 'esnext',
    lib: {
      entry: resolve(__dirname, 'src/pdfjs-entry.ts'),
      name: 'PdfjsChunk',
      fileName: () => 'pdfjs.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        globals: {},
      },
    },
  },
});
