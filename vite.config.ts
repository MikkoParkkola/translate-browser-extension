import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'fs';

// Plugin to copy manifest.json and ONNX Runtime files to dist
function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const assetsDir = resolve(distDir, 'assets');

      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }
      if (!existsSync(assetsDir)) {
        mkdirSync(assetsDir, { recursive: true });
      }

      // Copy manifest
      copyFileSync(
        resolve(__dirname, 'src/manifest.json'),
        resolve(distDir, 'manifest.json')
      );

      // Copy extension icons
      const iconsDir = resolve(distDir, 'assets', 'icons');
      if (!existsSync(iconsDir)) {
        mkdirSync(iconsDir, { recursive: true });
      }
      const iconSizes = ['icon16.png', 'icon48.png', 'icon128.png'];
      for (const icon of iconSizes) {
        const src = resolve(__dirname, 'src/assets/icons', icon);
        const dest = resolve(iconsDir, icon);
        if (existsSync(src)) {
          copyFileSync(src, dest);
          console.log(`Copied: icons/${icon}`);
        }
      }

      // Copy ONNX Runtime WASM files from transformers package
      // These are needed for local inference without CDN
      const transformersDir = resolve(
        __dirname,
        'node_modules/@huggingface/transformers/dist'
      );
      const wasmFiles = [
        'ort-wasm-simd-threaded.jsep.wasm',
        'ort-wasm-simd-threaded.jsep.mjs',
      ];

      for (const file of wasmFiles) {
        const src = resolve(transformersDir, file);
        const dest = resolve(assetsDir, file);
        if (existsSync(src)) {
          copyFileSync(src, dest);
          console.log(`Copied: ${file}`);
        }
      }

      // Copy Tesseract.js WASM files for OCR
      const tesseractCoreDir = resolve(
        __dirname,
        'node_modules/tesseract.js-core'
      );
      const tesseractWasmFiles = [
        'tesseract-core-simd-lstm.wasm',
        'tesseract-core-simd-lstm.wasm.js',
      ];

      for (const file of tesseractWasmFiles) {
        const src = resolve(tesseractCoreDir, file);
        const dest = resolve(assetsDir, file);
        if (existsSync(src)) {
          copyFileSync(src, dest);
          console.log(`Copied: ${file}`);
        }
      }

      // Copy _locales directory for chrome.i18n
      const localesDir = resolve(__dirname, 'src/_locales');
      if (existsSync(localesDir)) {
        cpSync(localesDir, resolve(distDir, '_locales'), { recursive: true });
        console.log('Copied: _locales/');
      }
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), copyExtensionFiles()],
  // Chrome extensions need relative paths, not root-absolute
  base: '',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@providers': resolve(__dirname, 'src/providers'),
      '@components': resolve(__dirname, 'src/popup/components'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
    // Transformers.js is ~870KB minified - unavoidable for ML inference
    // Suppress warning since it's in a lazy-loaded chunk
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        onboarding: resolve(__dirname, 'src/onboarding/index.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        // Content script is built separately via vite.content.config.ts (IIFE format)
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep background at root level (content script built separately)
          if (chunkInfo.name === 'background') {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // Keep WASM files without hash - Transformers.js expects exact names
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        // Manual chunks for better code splitting
        manualChunks: (id) => {
          // Transformers.js core - shared by all ML providers
          if (id.includes('@huggingface/transformers')) {
            return 'transformers';
          }
          // ONNX Runtime - separate chunk for WASM-based inference
          if (id.includes('onnxruntime')) {
            return 'onnx-runtime';
          }
          // Solid.js - UI framework (popup/options only)
          if (id.includes('solid-js') || id.includes('solid-refresh')) {
            return 'solid';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['solid-js'],
    exclude: ['@huggingface/transformers'],
  },
});
