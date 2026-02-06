import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, 'dist');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Extensions need serial execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for extension tests
  reporter: 'html',
  timeout: 60000,

  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'extension',
      use: {
        // Chrome with extension loaded
        channel: 'chrome',
        headless: false, // Extensions require headed mode
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-first-run',
          ],
        },
      },
    },
  ],
});
