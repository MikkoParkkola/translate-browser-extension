import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Separate Vite config for content script.
 * Content scripts cannot use ES modules - must be IIFE format with all deps inlined.
 *
 * pdfjs-dist is externalized here because it's large (~400KB) and only needed
 * on PDF pages. It's built as a separate chunk via vite.pdfjs.config.ts and
 * loaded on-demand by pdf-loader.ts.
 */
export default defineConfig({
  // No plugins needed for content script
  plugins: [],
  base: '',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false, // Don't clear - main build runs first
    sourcemap: true,
    target: 'esnext',
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'TranslateContent',
      fileName: () => 'content.js',
      formats: ['iife'], // IIFE format - no imports
    },
    rollupOptions: {
      // Externalize pdfjs-dist so it's NOT bundled into content.js.
      // The pdf-loader.ts loads it from a separate chunk at runtime.
      external: ['pdfjs-dist'],
      output: {
        // Inline all dependencies (except externals above)
        inlineDynamicImports: true,
        globals: {
          'pdfjs-dist': 'window.__pdfjs',
        },
      },
    },
  },
});
