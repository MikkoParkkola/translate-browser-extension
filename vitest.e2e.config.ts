import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // E2E tests use real browser via Puppeteer
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 120000, // 2 min timeout for model loading
    hookTimeout: 120000,
    pool: 'forks', // Better for Puppeteer
    poolOptions: {
      forks: {
        singleFork: true, // Run tests sequentially (one browser instance)
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
