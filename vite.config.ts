import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

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
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep background and content at root level
          if (chunkInfo.name === 'background' || chunkInfo.name === 'content') {
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
