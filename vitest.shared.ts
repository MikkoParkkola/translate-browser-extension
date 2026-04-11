import { resolve } from 'path';

export const defaultTestExclude = ['node_modules', 'dist', '_legacy'];

export const sharedResolveConfig = {
  alias: {
    '@': resolve(__dirname, 'src'),
    '@core': resolve(__dirname, 'src/core'),
    '@providers': resolve(__dirname, 'src/providers'),
  },
};

export const sharedTestConfig = {
  globals: true,
  environment: 'jsdom' as const,
  pool: 'forks' as const,
  fileParallelism: false,
  maxWorkers: 1,
  setupFiles: ['./src/test-setup.ts'],
  testTimeout: 30000,
  hookTimeout: 30000,
  coverage: {
    provider: 'v8' as const,
    reportsDirectory: './coverage',
    reporter: ['text', 'text-summary', 'json-summary', 'json'],
    include: ['src/**/*.ts', 'src/**/*.tsx'],
    exclude: [
      'src/**/*.test.ts',
      'src/**/*.d.ts',
      'src/core/index.ts',
      'src/providers/index.ts',
      'src/popup/components/index.ts',
      'src/background/shared/index.ts',
      'src/popup/index.tsx',
      'src/options/index.tsx',
      'src/**/*.test.tsx',
      'src/types/**',
      'src/test-helpers/**',
      'src/test-setup.ts',
      'node_modules',
      'dist',
      '_legacy',
    ],
    thresholds: {
      // Keep coverage gates close to the current repo-wide floor.
      // Tighten these as legacy/runtime cleanup closes the remaining gaps.
      statements: 97,
      branches: 94,
      functions: 98,
      lines: 97,
    },
  },
};
