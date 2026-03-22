// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  // Default: mutate core business logic and providers (highest-value targets).
  // Override with --mutate 'src/core/hash.ts' for targeted runs.
  mutate: [
    'src/core/**/*.ts',
    '!src/core/**/*.test.ts',
    '!src/core/index.ts',
    'src/providers/**/*.ts',
    '!src/providers/**/*.test.ts',
    '!src/providers/index.ts',
  ],
  reporters: ['clear-text', 'html'],
  thresholds: {
    high: 85,
    low: 75,
    break: 70,
  },
  // Mutation testing is expensive: runs the full test suite per mutant.
  // Use --concurrency 2 on CI, increase locally if you have CPU headroom.
  concurrency: 2,
  timeoutMS: 120000,
  incremental: true,
  ignoreStatic: true,
};

export default config;
