import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '_legacy'],
    testTimeout: 30000, // 30s default — coverage instrumentation adds overhead
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'json'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/core/index.ts', // Barrel export
        'src/providers/index.ts', // Barrel export
        'src/popup/components/index.ts', // Barrel export
        'src/background/shared/index.ts', // Barrel export
        'src/popup/index.tsx', // Render entry point — no testable logic
        'src/options/index.tsx', // Render entry point — no testable logic
        'src/**/*.test.tsx', // Test files
        'src/types/**', // Type definitions only
        'node_modules',
        'dist',
        '_legacy',
      ],
      thresholds: {
        // Global thresholds — reflect actual coverage after 3170 tests.
        // UI components (Solid.js) and browser API-heavy files lower the avg;
        // core logic and providers are at 85-95%.
        statements: 74,
        branches: 70,
        functions: 66,
        lines: 78,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@providers': resolve(__dirname, 'src/providers'),
    },
  },
});
