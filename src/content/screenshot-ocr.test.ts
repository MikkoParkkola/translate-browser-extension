/**
 * Tests for src/content/screenshot-ocr.ts
 *
 * Tests the exported API: setGetCurrentSettings and enterScreenshotMode.
 * Internal handlers (mousedown/mousemove/mouseup/keydown) are exercised
 * by dispatching real DOM events after entering screenshot mode.
 *
 * Module-level state (screenshotMode, selectionOverlay, selectionStart)
 * persists between tests in the same module instance, so vi.resetModules()
 * + vi.doMock() is used in beforeEach to get a clean state each test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock fns — re-used across module resets
// ---------------------------------------------------------------------------
const mockShowInfoToast = vi.fn();
const mockShowErrorToast = vi.fn();
const mockSendMessage = vi.fn();

/** Flush all pending microtasks (async event handlers). */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => queueMicrotask(() => r(undefined)));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset module and re-import with fresh state. */
async function freshModule() {
  vi.resetModules();
  vi.doMock('./toast', () => ({
    showInfoToast: (...args: unknown[]) => mockShowInfoToast(...args),
    showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
  }));
  vi.doMock('../core/browser-api', () => ({
    browserAPI: {
      runtime: {
        sendMessage: (...args: unknown[]) => mockSendMessage(...args),
      },
    },
  }));
  return import('./screenshot-ocr');
}

// ---------------------------------------------------------------------------
// setGetCurrentSettings
// ---------------------------------------------------------------------------

describe('setGetCurrentSettings', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('accepts a function returning null', () => {
    expect(() => mod.setGetCurrentSettings(() => null)).not.toThrow();
  });

  it('accepts a function returning settings', () => {
    expect(() =>
      mod.setGetCurrentSettings(() => ({
        enabled: true,
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
        strategy: 'smart',
        autoTranslate: false,
        showBilingual: false,
      }))
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// enterScreenshotMode
// ---------------------------------------------------------------------------

describe('enterScreenshotMode', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('sets cursor to crosshair', () => {
    mod.enterScreenshotMode();
    expect(document.body.style.cursor).toBe('crosshair');
  });

  it('appends selection overlay to body', () => {
    mod.enterScreenshotMode();
    // overlay div should be in body
    expect(document.body.children.length).toBeGreaterThanOrEqual(1);
  });

  it('shows info toast on enter', () => {
    mod.enterScreenshotMode();
    expect(mockShowInfoToast).toHaveBeenCalledWith(
      expect.stringContaining('Draw a rectangle')
    );
  });

  it('is idempotent — second call is a no-op', () => {
    mod.enterScreenshotMode();
    const childCount = document.body.children.length;
    mod.enterScreenshotMode();
    // No extra overlay added
    expect(document.body.children.length).toBe(childCount);
    // showInfoToast called only once
    expect(mockShowInfoToast).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Escape key exits screenshot mode
// ---------------------------------------------------------------------------

describe('Escape key exits screenshot mode', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('Escape restores cursor and removes overlay', () => {
    mod.enterScreenshotMode();
    expect(document.body.style.cursor).toBe('crosshair');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.body.style.cursor).toBe('');
    // Overlay should be gone
    const overlays = document.querySelectorAll('div[style*="dashed"]');
    expect(overlays.length).toBe(0);
  });

  it('non-Escape key does not exit', () => {
    mod.enterScreenshotMode();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.body.style.cursor).toBe('crosshair');
  });
});

// ---------------------------------------------------------------------------
// mousedown — shows overlay at click position
// ---------------------------------------------------------------------------

describe('mousedown event', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('shows selection overlay on mousedown', () => {
    mod.enterScreenshotMode();

    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, clientY: 150, bubbles: true })
    );

    // Find the selection overlay div (dashed border)
    const overlay = document.body.querySelector('div');
    expect(overlay).not.toBeNull();
    expect(overlay!.style.display).toBe('block');
  });

  it('positions overlay at mouse coordinates', () => {
    mod.enterScreenshotMode();

    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 200, clientY: 300, bubbles: true })
    );

    const overlay = document.body.querySelector('div');
    expect(overlay!.style.left).toBe('200px');
    expect(overlay!.style.top).toBe('300px');
  });

  it('initializes overlay size to 0px', () => {
    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true })
    );

    const overlay = document.body.querySelector('div');
    expect(overlay!.style.width).toBe('0px');
    expect(overlay!.style.height).toBe('0px');
  });
});

// ---------------------------------------------------------------------------
// mousemove — updates overlay dimensions
// ---------------------------------------------------------------------------

describe('mousemove event', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('updates overlay dimensions during drag', () => {
    mod.enterScreenshotMode();

    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 300, clientY: 250, bubbles: true })
    );

    const overlay = document.body.querySelector('div');
    expect(overlay!.style.width).toBe('200px');
    expect(overlay!.style.height).toBe('150px');
  });

  it('handles reversed drag direction (right-to-left)', () => {
    mod.enterScreenshotMode();

    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 300, clientY: 300, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true })
    );

    const overlay = document.body.querySelector('div');
    expect(overlay!.style.left).toBe('100px');
    expect(overlay!.style.top).toBe('100px');
    expect(overlay!.style.width).toBe('200px');
    expect(overlay!.style.height).toBe('200px');
  });

  it('does nothing when no selection start', () => {
    mod.enterScreenshotMode();
    // mousemove without mousedown first
    expect(() =>
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true })
      )
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// mouseup — small selection ignored
// ---------------------------------------------------------------------------

describe('mouseup — small selection', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('ignores selection smaller than 20px', async () => {
    mod.enterScreenshotMode();

    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 110, clientY: 115, bubbles: true })
    );

    await flushPromises();

    // No sendMessage call — selection too small
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('exits screenshot mode on mouseup regardless of selection size', async () => {
    mod.enterScreenshotMode();
    expect(document.body.style.cursor).toBe('crosshair');

    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 105, clientY: 105, bubbles: true })
    );

    await flushPromises();

    // Mode exited — cursor reset
    expect(document.body.style.cursor).toBe('');
  });
});

// ---------------------------------------------------------------------------
// mouseup — full flow: captureScreenshot success → OCR success → translate success
// ---------------------------------------------------------------------------

describe('mouseup — full success flow', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('shows extraction toast then result tooltip', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,TEST' })
      .mockResolvedValueOnce({ success: true, text: 'Hello world' })
      .mockResolvedValueOnce({ success: true, result: 'Hei maailma' });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 400, clientY: 300, bubbles: true })
    );

    await flushPromises();

    expect(mockShowInfoToast).toHaveBeenCalledWith(
      expect.stringContaining('Extracting text')
    );

    // Result tooltip should exist in body
    const bodyText = document.body.textContent;
    expect(bodyText).toContain('Hei maailma');
    expect(bodyText).toContain('Hello world');
  });

  it('sends captureScreenshot with rect and devicePixelRatio', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,TEST' })
      .mockResolvedValueOnce({ success: true, text: 'Text' })
      .mockResolvedValueOnce({ success: true, result: 'Teksti' });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 250, clientY: 200, bubbles: true })
    );

    await flushPromises();

    const captureCall = mockSendMessage.mock.calls[0][0];
    expect(captureCall.type).toBe('captureScreenshot');
    expect(captureCall.rect).toEqual({ x: 50, y: 50, width: 200, height: 150 });
    expect(captureCall.devicePixelRatio).toBeGreaterThan(0);
  });

  it('uses settings sourceLang/targetLang for translate call', async () => {
    mod.setGetCurrentSettings(() => ({
      enabled: true,
      sourceLang: 'de',
      targetLang: 'sv',
      provider: 'opus-mt',
      strategy: 'smart',
      autoTranslate: false,
      showBilingual: false,
    }));

    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,X' })
      .mockResolvedValueOnce({ success: true, text: 'Hallo' })
      .mockResolvedValueOnce({ success: true, result: 'Hej' });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 100, clientY: 100, bubbles: true })
    );

    await flushPromises();

    const translateCall = mockSendMessage.mock.calls[2][0];
    expect(translateCall.type).toBe('translate');
    expect(translateCall.sourceLang).toBe('de');
    expect(translateCall.targetLang).toBe('sv');
  });

  it('uses auto sourceLang when settings is null', async () => {
    mod.setGetCurrentSettings(() => null);

    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,X' })
      .mockResolvedValueOnce({ success: true, text: 'Test' })
      .mockResolvedValueOnce({ success: true, result: 'Testi' });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    const translateCall = mockSendMessage.mock.calls[2][0];
    expect(translateCall.sourceLang).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// mouseup — error paths
// ---------------------------------------------------------------------------

describe('mouseup — screenshot capture failure', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('shows error toast when captureScreenshot returns success=false', async () => {
    mockSendMessage.mockResolvedValueOnce({
      success: false,
      error: 'Permission denied',
    });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    expect(mockShowErrorToast).toHaveBeenCalledWith(
      expect.stringContaining('Permission denied')
    );
  });

  it('shows generic error when captureScreenshot returns no error message', async () => {
    mockSendMessage.mockResolvedValueOnce({ success: false });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    expect(mockShowErrorToast).toHaveBeenCalledWith(
      expect.stringContaining('Screenshot failed')
    );
  });
});

describe('mouseup — OCR failure', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('shows "No text found" when OCR returns success=false', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,X' })
      .mockResolvedValueOnce({ success: false, text: '' });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    expect(mockShowInfoToast).toHaveBeenCalledWith(
      expect.stringContaining('No text found')
    );
  });

  it('shows "No text found" when OCR text is empty/whitespace', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,X' })
      .mockResolvedValueOnce({ success: true, text: '   ' });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    expect(mockShowInfoToast).toHaveBeenCalledWith(
      expect.stringContaining('No text found')
    );
  });
});

describe('mouseup — translation failure', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('shows error toast when translation fails', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,X' })
      .mockResolvedValueOnce({ success: true, text: 'Hello' })
      .mockResolvedValueOnce({ success: false, error: 'Model unavailable' });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    expect(mockShowErrorToast).toHaveBeenCalledWith(
      expect.stringContaining('Model unavailable')
    );
  });

  it('shows generic translation error when no error message', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,X' })
      .mockResolvedValueOnce({ success: true, text: 'Hello' })
      .mockResolvedValueOnce({ success: false });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    expect(mockShowErrorToast).toHaveBeenCalledWith(
      expect.stringContaining('Translation failed')
    );
  });
});

describe('mouseup — sendMessage throws', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('shows error toast with exception message', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('IPC disconnected'));

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    expect(mockShowErrorToast).toHaveBeenCalledWith(
      expect.stringContaining('IPC disconnected')
    );
  });
});

// ---------------------------------------------------------------------------
// Result tooltip close button and auto-remove
// ---------------------------------------------------------------------------

describe('result tooltip', () => {
  let mod: Awaited<ReturnType<typeof freshModule>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mod = await freshModule();
  });

  it('close button removes tooltip', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,X' })
      .mockResolvedValueOnce({ success: true, text: 'Hello' })
      .mockResolvedValueOnce({ success: true, result: 'Hei' });

    mod.enterScreenshotMode();
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
    );

    await flushPromises();

    // Find close button
    const closeBtn = document.querySelector('button');
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();

    expect(document.querySelector('button')).toBeNull();
  });

  it('tooltip auto-removes after 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, imageData: 'data:image/png;base64,X' })
        .mockResolvedValueOnce({ success: true, text: 'Hello' })
        .mockResolvedValueOnce({ success: true, result: 'Hei' });

      mod.enterScreenshotMode();
      document.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true })
      );

      // Flush promises while fake timers advance real time
      await flushPromises();

      // Tooltip exists before 30s
      expect(document.body.textContent).toContain('Hei');

      // 30 seconds pass
      vi.advanceTimersByTime(30001);

      // Tooltip removed
      expect(document.querySelector('button')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
