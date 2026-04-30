import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/__benchmarks__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '_legacy'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@providers': resolve(__dirname, 'src/providers'),
    },
  },
});
