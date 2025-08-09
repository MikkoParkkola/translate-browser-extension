// @ts-check
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  timeout: 120000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    headless: true,
    viewport: { width: 1200, height: 900 },
  },
  testDir: 'e2e',
};

module.exports = config;

