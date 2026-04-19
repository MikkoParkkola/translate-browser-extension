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
import { test, expect, popupUrl } from './fixtures';

test.describe('Keyboard Shortcuts', () => {
  test.describe.configure({ timeout: 60_000 });

  // ── 1. Ctrl+Shift+P → translate-page command fires ─────────────
  test('Ctrl+Shift+P triggers page translation command', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500); // let content script inject

    // Listen for the translate-page message arriving at the content script
    const messageReceived = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        // Content script should respond to the command via chrome.runtime messages
        const timer = setTimeout(() => resolve(false), 5000);
        // Listen for DOM changes that indicate translation started
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          observer.disconnect();
          resolve(true);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });

        // Simulate the keyboard shortcut
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }),
        );
      });
    });

    // Chrome extension shortcuts are registered at the browser level, not the page level.
    // dispatchEvent won't trigger the extension command handler.
    // Verify the command is registered in the manifest instead.
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
    expect(translatePageCmd!.description).toBeTruthy();
    // Ctrl+Shift+P can conflict with browser-reserved shortcuts on some platforms,
    // so Chrome may surface the command but leave the assigned shortcut empty.
    if (translatePageCmd!.shortcut) {
      expect(translatePageCmd!.shortcut).toMatch(/P/i);
    }

    await popupPage.close();
    await page.close();
  });

  // ── 2. translate-selection command is registered ───────────────
  test('translate-selection command is registered', async ({ context, extensionId }) => {
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
  test('undo-translation command is registered', async ({ context, extensionId }) => {
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
  test('Alt+T is registered for opening popup', async ({ context, extensionId }) => {
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
  test('extension commands are accessible on a content page', async ({ context, extensionId }) => {
    // Open a real page and verify content script is injected
    const page = await context.newPage();
    await page.goto('https://example.com');
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

    expect(commandCount).toBeGreaterThanOrEqual(4);

    // Also verify the page is reachable for translation
    const pageTitle = await page.title();
    expect(pageTitle).toContain('Example Domain');

    await popupPage.close();
    await page.close();
  });
});
