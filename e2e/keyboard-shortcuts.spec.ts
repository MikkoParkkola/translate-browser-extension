/**
 * E2E: Keyboard shortcut tests.
 *
 * Validates that the extension's manifest-defined keyboard commands are
 * wired correctly. Uses the persistent-context extension fixture pattern
 * from extension-load.spec.ts and translation-e2e.spec.ts.
 *
 * Manifest commands (Chrome MV3):
 *   _execute_action    → Alt+T         → Open popup
 *   translate-page     → Ctrl+Shift+P  → Translate entire page
 *   translate-selection→ Ctrl+Shift+T  → Translate selected text
 *   undo-translation   → Ctrl+Shift+U  → Undo translation
 */
import fs from 'fs';
import {
  test,
  expect,
  popupUrl,
  waitForTabPing,
} from './fixtures';
import { getExtensionManifestPath } from './extension-launch';
import { MOCK_HARNESS_FRAGMENT, MOCK_HARNESS_URL } from './mock-harness';

interface ExtensionCommandManifestEntry {
  suggested_key?: {
    default?: string;
    mac?: string;
  };
  description?: string;
}

interface ExtensionManifest {
  commands?: Record<string, ExtensionCommandManifestEntry>;
}

test.describe('Keyboard Shortcuts', () => {
  test.describe.configure({ timeout: 60_000 });

  // ── 1. translate-page command is registered in the manifest ─────
  test('translate-page command is registered in the manifest', async ({
    context,
    extensionId,
  }) => {
    const manifestPath = getExtensionManifestPath();
    expect(fs.existsSync(manifestPath), 'Manifest should exist').toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf-8'),
    ) as ExtensionManifest;
    const translatePageManifestCommand = manifest.commands?.['translate-page'];

    expect(translatePageManifestCommand).toBeTruthy();
    expect(translatePageManifestCommand?.suggested_key?.default).toMatch(/P/i);
    expect(translatePageManifestCommand?.description).toBeTruthy();

    // Chrome extension shortcuts are registered at the browser level, not the page level,
    // so synthetic page keydown events cannot trigger the extension handler.
    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const commands = await popupPage.evaluate(async () => {
      return new Promise<chrome.commands.Command[]>((resolve) => {
        chrome.commands.getAll((cmds) => resolve(cmds));
      });
    });

    const translatePageCmd = commands.find((c) => c.name === 'translate-page');
    expect(translatePageCmd).toBeTruthy();
    // Chromium may drop conflicting suggested keys at runtime on some CI images,
    // even when the manifest correctly declares the shortcut.
    if (translatePageCmd?.shortcut) {
      // macOS reports ⇧⌘P; Windows/Linux reports Ctrl+Shift+P
      expect(translatePageCmd.shortcut).toMatch(/P/i);
    }
    expect(translatePageCmd!.description).toBeTruthy();

    await popupPage.close();
  });

  // ── 2. translate-selection command is registered ───────────────
  test('translate-selection command is registered', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
    await page.waitForLoadState('domcontentloaded');

    const commands = await page.evaluate(async () => {
      return new Promise<chrome.commands.Command[]>((resolve) => {
        chrome.commands.getAll((cmds) => resolve(cmds));
      });
    });

    const selectionCmd = commands.find((c) => c.name === 'translate-selection');
    expect(selectionCmd).toBeTruthy();
    expect(selectionCmd!.description).toContain('selected text');
    // Shortcut may be empty if Chrome reassigned a conflicting key
    // (Ctrl+Shift+T conflicts with "Reopen closed tab" on some platforms)

    await page.close();
  });

  // ── 3. undo-translation command is registered ─────────────────
  test('undo-translation command is registered', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
    await page.waitForLoadState('domcontentloaded');

    const commands = await page.evaluate(async () => {
      return new Promise<chrome.commands.Command[]>((resolve) => {
        chrome.commands.getAll((cmds) => resolve(cmds));
      });
    });

    const undoCmd = commands.find((c) => c.name === 'undo-translation');
    expect(undoCmd).toBeTruthy();
    expect(undoCmd!.description).toBeTruthy();

    await page.close();
  });

  // ── 4. Alt+T → _execute_action (open popup) registered ────────
  test('Alt+T is registered for opening popup', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
    await page.waitForLoadState('domcontentloaded');

    const commands = await page.evaluate(async () => {
      return new Promise<chrome.commands.Command[]>((resolve) => {
        chrome.commands.getAll((cmds) => resolve(cmds));
      });
    });

    const actionCmd = commands.find((c) => c.name === '_execute_action');
    expect(actionCmd).toBeTruthy();
    // macOS reports ⌥T; Windows/Linux reports Alt+T
    expect(actionCmd!.shortcut).toMatch(/T/i);

    await page.close();
  });

  // ── 5. Shortcuts work on a page with content ──────────────────
  test('extension commands are accessible on a content page', async ({
    context,
    extensionId,
  }) => {
    // Open a local content page and verify content script is injected
    const page = await context.newPage();
    await page.goto(MOCK_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // let content script inject

    // Verify we can communicate with the extension from the page context
    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    // Extension should report all 4+ commands
    const commandCount = await popupPage.evaluate(async () => {
      return new Promise<number>((resolve) => {
        chrome.commands.getAll((cmds) => resolve(cmds.length));
      });
    });
    const tabId = await waitForTabPing(popupPage, MOCK_HARNESS_FRAGMENT);

    expect(commandCount).toBeGreaterThanOrEqual(4);
    expect(tabId).toBeGreaterThan(0);

    await popupPage.close();
    await page.close();
  });
});
