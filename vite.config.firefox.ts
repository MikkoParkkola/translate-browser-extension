import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { sharedManualChunks } from './vite.shared';

const __dirname = import.meta.dirname;

// Plugin to copy Firefox-specific files
function copyFirefoxExtensionFiles() {
  return {
    name: 'copy-firefox-extension-files',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist-firefox');
      const assetsDir = resolve(distDir, 'assets');

      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }
      if (!existsSync(assetsDir)) {
        mkdirSync(assetsDir, { recursive: true });
      }

      // Copy Firefox manifest
      copyFileSync(
        resolve(__dirname, 'src/manifest.firefox.json'),
        resolve(distDir, 'manifest.json')
      );

      // Copy Firefox background page HTML
      copyFileSync(
        resolve(__dirname, 'src/background-firefox.html'),
        resolve(distDir, 'background.html')
      );

      // Copy ONNX Runtime WASM loader/runtime files from onnxruntime-web.
      const onnxRuntimeDir = resolve(
        __dirname,
        'node_modules/onnxruntime-web/dist'
      );
      const wasmFiles = readdirSync(onnxRuntimeDir).filter((file) =>
        file.startsWith('ort-wasm') && (file.endsWith('.wasm') || file.endsWith('.mjs'))
      );

      for (const file of wasmFiles) {
        const src = resolve(onnxRuntimeDir, file);
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
  plugins: [solidPlugin(), copyFirefoxExtensionFiles()],
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
    outDir: 'dist-firefox',
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        // Firefox: no offscreen document, use background page directly
        background: resolve(__dirname, 'src/background/background-firefox.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background' || chunkInfo.name === 'content') {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks: sharedManualChunks,
      },
    },
  },
  optimizeDeps: {
    include: ['solid-js'],
    exclude: ['@huggingface/transformers'],
  },
});
