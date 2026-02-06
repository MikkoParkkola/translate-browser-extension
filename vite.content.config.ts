import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Separate Vite config for content script.
 * Content scripts cannot use ES modules - must be IIFE format with all deps inlined.
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
      output: {
        // Inline all dependencies
        inlineDynamicImports: true,
        // Ensure globals are handled
        globals: {},
      },
    },
  },
});
