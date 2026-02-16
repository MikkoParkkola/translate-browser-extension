import { defineConfig } from '@playwright/test';
import path from 'path';

// __dirname is provided by Playwright's TS transform (CJS context)
const EXTENSION_PATH = path.resolve(__dirname, 'dist');

// Background mode: run Chrome off-screen (no focus stealing)
const BACKGROUND_MODE = process.env.BACKGROUND !== 'false';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Extensions need serial execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for extension tests
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120000, // 2 min for model downloads
  expect: {
    timeout: 30000,
  },

  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'extension',
      use: {
        // Use Playwright's bundled Chromium (NOT system Chrome)
        // System Chrome 144+ silently ignores --load-extension on macOS
        headless: false, // Extensions require headed mode (Chrome limitation)
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-first-run',
            '--disable-component-update',
            // Background mode: off-screen window (no focus stealing)
            ...(BACKGROUND_MODE ? [
              '--window-position=-32000,-32000',
              '--window-size=1280,720',
              '--disable-gpu',
              '--mute-audio',
            ] : []),
          ],
        },
      },
    },
  ],
});
