/**
 * Tests for src/content/widget.ts
 *
 * Floating translation widget — DOM creation, drag, translate, history, show/hide/toggle.
 *
 * Note: widget.ts has module-level state (floatingWidget, widgetVisible).
 * We use vi.resetModules() before each test to get a fresh module instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks — must be declared at top level (vi.mock hoisting)
// ============================================================================

const mockSendMessage = vi.fn();

vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: {
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    },
  },
}));

const mockSafeStorageGet = vi.fn();
vi.mock('../core/storage', () => ({
  safeStorageGet: (...args: unknown[]) => mockSafeStorageGet(...args),
}));

vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./sanitize', () => ({
  escapeHtml: (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));

// ============================================================================
// Helper to get a fresh module instance
// ============================================================================

async function freshWidget() {
  vi.resetModules();
  return import('./widget');
}

// ============================================================================
// setResolveSourceLang
// ============================================================================

describe('setResolveSourceLang', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('can be called without error', async () => {
    const { setResolveSourceLang } = await freshWidget();
    expect(() => setResolveSourceLang((lang) => lang)).not.toThrow();
  });
});

// ============================================================================
// removeWidgetDragListeners
// ============================================================================

describe('removeWidgetDragListeners', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('does nothing when listeners not added', async () => {
    const { removeWidgetDragListeners } = await freshWidget();
    expect(() => removeWidgetDragListeners()).not.toThrow();
  });
});

// ============================================================================
// showFloatingWidget
// ============================================================================

describe('showFloatingWidget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockSafeStorageGet.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('creates widget and appends to body', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    expect(document.getElementById('translate-floating-widget')).not.toBeNull();
  });

  it('calling showFloatingWidget twice reuses existing widget', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();
    showFloatingWidget();

    const widgets = document.querySelectorAll('#translate-floating-widget');
    expect(widgets).toHaveLength(1);
  });

  it('widget has TRANSLATE! title', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const title = document.querySelector('.widget-title');
    expect(title?.textContent).toBe('TRANSLATE!');
  });

  it('widget has language select', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const select = document.querySelector('.widget-lang-select');
    expect(select).not.toBeNull();
  });

  it('loads saved targetLang from storage', async () => {
    mockSafeStorageGet.mockResolvedValue({ targetLang: 'de' });
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();

    // Allow storage promise to resolve
    await new Promise((r) => setTimeout(r, 20));

    const select = document.querySelector('.widget-lang-select') as HTMLSelectElement;
    expect(select?.value).toBe('de');
  });
});

// ============================================================================
// hideFloatingWidget
// ============================================================================

describe('hideFloatingWidget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockSafeStorageGet.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('hides widget by setting display:none', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget, hideFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    hideFloatingWidget();

    const widget = document.getElementById('translate-floating-widget');
    expect(widget?.style.display).toBe('none');
  });

  it('does nothing if widget not created', async () => {
    const { hideFloatingWidget } = await freshWidget();
    expect(() => hideFloatingWidget()).not.toThrow();
  });

  it('close button hides widget', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const closeBtn = document.querySelector('.widget-close') as HTMLButtonElement;
    closeBtn.click();

    const widget = document.getElementById('translate-floating-widget');
    expect(widget?.style.display).toBe('none');
  });
});

// ============================================================================
// toggleFloatingWidget
// ============================================================================

describe('toggleFloatingWidget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockSafeStorageGet.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows widget when not visible', async () => {
    vi.useFakeTimers();
    const { toggleFloatingWidget } = await freshWidget();
    toggleFloatingWidget();
    vi.runAllTimers();

    expect(document.getElementById('translate-floating-widget')).not.toBeNull();
  });

  it('toggles visible state off after first show', async () => {
    vi.useFakeTimers();
    const { toggleFloatingWidget } = await freshWidget();

    toggleFloatingWidget(); // show (widgetVisible = true)
    vi.runAllTimers();

    const result = toggleFloatingWidget(); // hide (widgetVisible = false)
    expect(result).toBe(false);
  });
});

// ============================================================================
// Translate button
// ============================================================================

describe('translate button', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockSafeStorageGet.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('calls sendMessage when translate button clicked with text', async () => {
    mockSendMessage.mockResolvedValue({ success: true, result: 'translated!' });
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = 'hello world';

    const translateBtn = document.querySelector('.widget-translate-btn') as HTMLButtonElement;
    translateBtn.click();

    await vi.runAllTimersAsync();

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'translate', text: 'hello world' })
    );
  });

  it('shows translation result in output', async () => {
    mockSendMessage.mockResolvedValue({ success: true, result: 'translated!' });
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = 'hello';
    const translateBtn = document.querySelector('.widget-translate-btn') as HTMLButtonElement;
    translateBtn.click();

    await vi.runAllTimersAsync();

    const output = document.querySelector('.widget-output') as HTMLElement;
    expect(output.textContent).toBe('translated!');
    expect(output.style.display).toBe('block');
  });

  it('shows failure message when translation fails', async () => {
    mockSendMessage.mockResolvedValue({ success: false });
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = 'hello';
    const translateBtn = document.querySelector('.widget-translate-btn') as HTMLButtonElement;
    translateBtn.click();

    await vi.runAllTimersAsync();

    const output = document.querySelector('.widget-output') as HTMLElement;
    expect(output.textContent).toBe('Translation failed');
  });

  it('shows error text when sendMessage throws', async () => {
    mockSendMessage.mockRejectedValue(new Error('network error'));
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = 'hello';
    const translateBtn = document.querySelector('.widget-translate-btn') as HTMLButtonElement;
    translateBtn.click();

    await vi.runAllTimersAsync();

    const output = document.querySelector('.widget-output') as HTMLElement;
    expect(output.textContent).toContain('Error');
  });

  it('does not send message when input is empty/whitespace', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = '   ';

    const translateBtn = document.querySelector('.widget-translate-btn') as HTMLButtonElement;
    translateBtn.click();

    await vi.runAllTimersAsync();

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('Enter key triggers translate', async () => {
    mockSendMessage.mockResolvedValue({ success: true, result: 'result' });
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = 'hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.runAllTimersAsync();

    expect(mockSendMessage).toHaveBeenCalled();
  });

  it('Shift+Enter does not trigger translate', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = 'hello';
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
    );

    await vi.runAllTimersAsync();

    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Drag interactions
// ============================================================================

describe('widget drag', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockSafeStorageGet.mockResolvedValue({});
    (window as { innerWidth: number }).innerWidth = 1200;
    (window as { innerHeight: number }).innerHeight = 800;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('mousedown on header does not throw', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const header = document.querySelector('.widget-header') as HTMLElement;
    expect(() => {
      header.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }));
    }).not.toThrow();
  });

  it('mousemove during drag updates widget position', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const widget = document.getElementById('translate-floating-widget') as HTMLElement;
    widget.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 380, bottom: 300,
      width: 280, height: 200, x: 100, y: 100, toJSON: () => ({})
    });

    const header = document.querySelector('.widget-header') as HTMLElement;
    // dragOffset = { x: 150-100=50, y: 120-100=20 }
    header.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 120, bubbles: true }));

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
    // new x = clamp(200-50=150, 0, 1200-280=920) = 150
    // new y = clamp(200-20=180, 0, 800-200=600) = 180

    expect(widget.style.left).toBe('150px');
    expect(widget.style.top).toBe('180px');
  });

  it('mouseup stops dragging and restores transition', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const widget = document.getElementById('translate-floating-widget') as HTMLElement;
    widget.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 380, bottom: 300,
      width: 280, height: 200, x: 100, y: 100, toJSON: () => ({})
    });

    const header = document.querySelector('.widget-header') as HTMLElement;
    header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(widget.style.transition).toContain('transform');
  });
});

// ============================================================================
// History
// ============================================================================

describe('history', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockSafeStorageGet.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows history after successful translation', async () => {
    mockSendMessage.mockResolvedValue({ success: true, result: 'translated!' });
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = 'hello';
    const translateBtn = document.querySelector('.widget-translate-btn') as HTMLButtonElement;
    translateBtn.click();

    await vi.runAllTimersAsync();

    const history = document.querySelector('.widget-history') as HTMLElement;
    expect(history.style.display).toBe('block');
    expect(history.innerHTML).toContain('hello');
    expect(history.innerHTML).toContain('translated!');
  });

  it('history element starts with no display:block before any translations', async () => {
    vi.useFakeTimers();
    const { showFloatingWidget } = await freshWidget();
    showFloatingWidget();
    vi.runAllTimers();

    const history = document.querySelector('.widget-history') as HTMLElement;
    expect(history).toBeTruthy();
    // Before any translation, history should not be displayed as block
    expect(history.style.display).not.toBe('block');
  });

  it('hides history element when widgetHistory is cleared (lines 304-305)', async () => {
    mockSendMessage.mockResolvedValue({ success: true, result: 'translated!' });
    vi.useFakeTimers();
    const module = await freshWidget();
    const { showFloatingWidget, __testExports } = module;
    const testExports = __testExports();

    showFloatingWidget();
    vi.runAllTimers();

    // First translation
    const input = document.querySelector('.widget-input') as HTMLTextAreaElement;
    input.value = 'hello';
    const translateBtn = document.querySelector('.widget-translate-btn') as HTMLButtonElement;
    translateBtn.click();

    await vi.runAllTimersAsync();

    const history = document.querySelector('.widget-history') as HTMLElement;
    expect(history.style.display).toBe('block');
    expect(history.innerHTML).toContain('hello');

    // Now clear history and verify it hides (lines 304-305)
    testExports.clearWidgetHistory();
    testExports.updateWidgetHistory();

    // History should be hidden when empty
    expect(history.style.display).toBe('none');
  });
});
