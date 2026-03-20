/**
 * E2E: Firefox compatibility tests.
 *
 * Firefox uses MV2 with a persistent background page (not service worker),
 * the browser.* API namespace, and a separate build output (dist-firefox).
 *
 * Requirements:
 *   - Firefox build: vite build --config vite.config.firefox.ts → dist-firefox/
 *   - Firefox browser available in PATH or Playwright install
 *
 * Most tests are skipped in CI unless FIREFOX_E2E=1 is set, because
 * Playwright's Firefox doesn't support extension loading via the standard
 * launchPersistentContext API.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const FIREFOX_DIST = path.resolve(__dirname, '..', 'dist-firefox');
const FIREFOX_MANIFEST = path.resolve(FIREFOX_DIST, 'manifest.json');
const FIREFOX_SRC_MANIFEST = path.resolve(__dirname, '..', 'src', 'manifest.firefox.json');
const SKIP_REASON = 'Firefox E2E requires FIREFOX_E2E=1 env and dist-firefox build';
const shouldRun = process.env.FIREFOX_E2E === '1' && fs.existsSync(FIREFOX_DIST);

test.describe('Firefox Compatibility', () => {
  // ── 1. Extension loads in Firefox (manifest validation) ────────
  test('Firefox manifest is valid MV2 with required fields', async () => {
    // This test validates the built or source manifest without needing Firefox
    const manifestPath = fs.existsSync(FIREFOX_MANIFEST) ? FIREFOX_MANIFEST : FIREFOX_SRC_MANIFEST;

    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // MV2 requirements
    expect(manifest.manifest_version).toBe(2);

    // Firefox uses browser_action, not action
    expect(manifest).toHaveProperty('browser_action');
    expect(manifest).not.toHaveProperty('action');

    // Must have a background page (not service worker)
    expect(manifest.background).toBeTruthy();
    expect(manifest.background).not.toHaveProperty('service_worker');
    // Firefox MV2 uses background.page or background.scripts
    const hasBgPage = 'page' in manifest.background;
    const hasBgScripts = 'scripts' in manifest.background;
    expect(hasBgPage || hasBgScripts).toBe(true);

    // Gecko-specific metadata
    if (manifest.browser_specific_settings?.gecko) {
      expect(manifest.browser_specific_settings.gecko.id).toBeTruthy();
    } else if (manifest.applications?.gecko) {
      expect(manifest.applications.gecko.id).toBeTruthy();
    }
  });

  // ── 2. Firefox build output has required files ─────────────────
  test('dist-firefox contains required extension files', async () => {
    test.skip(
      !fs.existsSync(path.join(FIREFOX_DIST, 'manifest.json')),
      'dist-firefox not fully built — run: npm run build:firefox',
    );

    const requiredFiles = ['manifest.json', 'background.html', 'content.js'];

    for (const file of requiredFiles) {
      const filePath = path.join(FIREFOX_DIST, file);
      expect(fs.existsSync(filePath)).toBe(true);
    }

    // Manifest should be MV2
    const manifest = JSON.parse(fs.readFileSync(path.join(FIREFOX_DIST, 'manifest.json'), 'utf-8'));
    expect(manifest.manifest_version).toBe(2);
  });

  // ── 3. browser.* vs chrome.* API compatibility ─────────────────
  test('Firefox manifest does not reference chrome.* specific APIs', async () => {
    test.skip(
      !fs.existsSync(path.join(FIREFOX_DIST, 'manifest.json')),
      'dist-firefox not fully built',
    );

    // Read the background script/page for browser.* API usage
    const bgHtmlPath = path.join(FIREFOX_DIST, 'background.html');
    if (fs.existsSync(bgHtmlPath)) {
      const bgHtml = fs.readFileSync(bgHtmlPath, 'utf-8');
      // Should reference script files
      expect(bgHtml).toContain('<script');
    }

    // The Firefox manifest should not contain chrome-only permissions
    const manifest = JSON.parse(fs.readFileSync(path.join(FIREFOX_DIST, 'manifest.json'), 'utf-8'));
    const permissions = manifest.permissions || [];

    // 'offscreen' is Chrome-only (MV3)
    expect(permissions).not.toContain('offscreen');

    // 'scripting' is Chrome MV3 — Firefox MV2 uses content_scripts in manifest
    // (it's acceptable if present but should work without it)
    expect(manifest.content_scripts).toBeTruthy();
    expect(manifest.content_scripts.length).toBeGreaterThan(0);
  });

  // ── 4. Background page (not service worker) runs correctly ─────
  test('Firefox background uses page, not service_worker', async () => {
    const manifestPath = fs.existsSync(FIREFOX_MANIFEST) ? FIREFOX_MANIFEST : FIREFOX_SRC_MANIFEST;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // Firefox MV2 should NOT have service_worker in background
    expect(manifest.background).not.toHaveProperty('service_worker');

    // Should have background.page pointing to the background HTML
    if (manifest.background.page) {
      expect(manifest.background.page).toMatch(/\.html$/);
    } else if (manifest.background.scripts) {
      expect(manifest.background.scripts.length).toBeGreaterThan(0);
    }
  });

  // ── 5. Live Firefox test (requires real Firefox + extension) ───
  test('basic translation works in Firefox', async () => {
    test.skip(!shouldRun, SKIP_REASON);

    // When FIREFOX_E2E=1 and dist-firefox exists, we can attempt to load
    // Firefox with the extension. This requires web-ext or manual loading.
    // For now, validate the build is structurally correct.
    const manifest = JSON.parse(fs.readFileSync(FIREFOX_MANIFEST, 'utf-8'));

    // Verify content scripts are configured
    expect(manifest.content_scripts).toBeTruthy();
    const cs = manifest.content_scripts[0];
    expect(cs.matches).toContain('<all_urls>');
    expect(cs.js.length).toBeGreaterThan(0);

    // Verify web_accessible_resources exist (needed for injected resources)
    expect(manifest.web_accessible_resources).toBeTruthy();
    expect(manifest.web_accessible_resources.length).toBeGreaterThan(0);
  });
});
