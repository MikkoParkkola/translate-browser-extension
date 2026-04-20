import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import {
  defaultTestExclude,
  sharedResolveConfig,
  sharedTestConfig,
} from './vitest.shared';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    ...sharedTestConfig,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [...defaultTestExclude, 'src/__benchmarks__/**'],
  },
  resolve: sharedResolveConfig,
});
