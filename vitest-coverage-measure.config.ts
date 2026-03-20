import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '_legacy'],
    coverage: {
      provider: 'v8',
      reporter: ['json-summary'],
      reportsDirectory: '/tmp/vitest-cov-measure',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/core/index.ts',
        'src/providers/index.ts',
        'src/popup/components/index.ts',
        'src/types/**',
        'node_modules',
        'dist',
        '_legacy',
      ],
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
