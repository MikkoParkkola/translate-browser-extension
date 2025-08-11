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
  webServer: {
    command: "npx http-server -p 8080 -c-1 . -H 'Permissions-Policy: accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=()'",
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: true,
    timeout: 120000
  }
};

module.exports = config;

