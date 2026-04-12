import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '_legacy'],
    testTimeout: 30000, // 30s default — coverage instrumentation adds overhead
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
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
        // Global thresholds — 5026 tests, 127 test files, all metrics at 100%.
        // Branches at 98%+ (V8 tracks internal branches for ?., ??, ||, && etc.)
        statements: 100,
        branches: 98,
        functions: 100,
        lines: 100,
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
