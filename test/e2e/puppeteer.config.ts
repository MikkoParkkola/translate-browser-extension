/**
 * Puppeteer configuration for Chrome extension E2E testing
 *
 * Handles extension loading, browser launch, and extension ID discovery.
 */

import puppeteer, { Browser } from 'puppeteer';
import path from 'path';
import fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

export interface ExtensionTestConfig {
  /** Path to the built extension directory */
  extensionPath: string;
  /** Temporary user data directory for isolated Chrome profile */
  userDataDir: string;
  /** Whether to run in headless mode (extensions require headless: false) */
  headless: boolean;
  /** Chrome executable path (uses bundled Chromium if not specified) */
  executablePath?: string;
  /** Default timeout for waitFor operations (ms) */
  defaultTimeout: number;
  /** Navigation timeout (ms) */
  navigationTimeout: number;
}

/**
 * Default configuration for extension testing
 */
export const defaultConfig: ExtensionTestConfig = {
  extensionPath: EXTENSION_PATH,
  userDataDir: `/tmp/puppeteer-translate-e2e-${Date.now()}`,
  headless: false, // Extensions require headed mode
  executablePath: process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined,
  defaultTimeout: 10000,
  navigationTimeout: 15000,
};

/**
 * Chrome launch arguments for extension testing
 */
export function getChromeArgs(config: ExtensionTestConfig): string[] {
  return [
    `--disable-extensions-except=${config.extensionPath}`,
    `--load-extension=${config.extensionPath}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--allow-file-access-from-files',
    '--no-first-run',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-features=TranslateUI',
  ];
}

/**
 * Verify extension build exists before running tests
 */
export function verifyExtensionBuild(extensionPath: string): void {
  if (!fs.existsSync(extensionPath)) {
    throw new Error(
      `Extension not built. Run: npm run build\n` +
      `Expected path: ${extensionPath}`
    );
  }

  const manifestPath = path.join(extensionPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `manifest.json not found in ${extensionPath}\n` +
      `The extension may not have built correctly.`
    );
  }
}

/**
 * Launch Chrome browser with extension loaded
 */
export async function launchBrowserWithExtension(
  config: Partial<ExtensionTestConfig> = {}
): Promise<Browser> {
  const finalConfig = { ...defaultConfig, ...config };

  verifyExtensionBuild(finalConfig.extensionPath);

  const browser = await puppeteer.launch({
    headless: finalConfig.headless,
    executablePath: finalConfig.executablePath,
    userDataDir: finalConfig.userDataDir,
    args: getChromeArgs(finalConfig),
    ignoreDefaultArgs: ['--disable-extensions'],
  });

  return browser;
}

/**
 * Clean up user data directory after tests
 */
export function cleanupUserDataDir(userDataDir: string): void {
  if (userDataDir && fs.existsSync(userDataDir)) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Skip tests in CI environment (extensions require display)
 */
export function shouldSkipE2E(): boolean {
  return process.env.CI === 'true' || process.env.SKIP_E2E === 'true';
}

export { EXTENSION_PATH };
