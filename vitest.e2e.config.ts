import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // E2E tests use real browser via Puppeteer
    include: ['test/e2e/**/*.test.ts', 'test/e2e/**/*.e2e.test.ts'],
    testTimeout: 120000, // 2 min timeout for model loading
    hookTimeout: 120000,
    pool: 'forks', // Better for Puppeteer
    fileParallelism: false, // Run files sequentially to keep one browser instance stable
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
