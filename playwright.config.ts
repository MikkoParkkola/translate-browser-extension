import { defineConfig } from '@playwright/test';
import { getExtensionLaunchSettings } from './e2e/extension-launch';

const extensionLaunchSettings = getExtensionLaunchSettings();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Extensions need serial execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for extension tests
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120000, // 2 min for model downloads
  webServer: {
    command: 'npm run serve:e2e',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
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
        headless: extensionLaunchSettings.headless,
        launchOptions: {
          args: extensionLaunchSettings.args,
        },
      },
    },
  ],
});
