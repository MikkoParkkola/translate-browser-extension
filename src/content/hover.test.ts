/**
 * Tests for src/content/hover.ts
 *
 * hover.ts manages Alt+hover translation tooltips.
 * Uses module-level state; each test resets via module reimport or direct state manipulation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks (must be at top level — vi.mock hoisting)
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

vi.mock('./toast', () => ({
  showInfoToast: vi.fn(),
  showErrorToast: vi.fn(),
  showProgressToast: vi.fn(),
  removeProgressToast: vi.fn(),
}));

vi.mock('./dom-utils', () => ({
  shouldSkip: vi.fn().mockReturnValue(false),
  isValidText: vi.fn().mockReturnValue(true),
  sanitizeText: vi.fn((t: string) => t),
  getTextNodes: vi.fn().mockReturnValue([]),
  getTextNodesFromNodes: vi.fn().mockReturnValue([]),
}));

// ============================================================================
// Tests
// ============================================================================

describe('setResolveSourceLang', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('can be imported and called without error', async () => {
    const { setResolveSourceLang } = await import('./hover');
    expect(() => setResolveSourceLang((lang) => lang)).not.toThrow();
  });
});

describe('removeHoverTooltip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('removes existing hover tooltip', async () => {
    const { removeHoverTooltip } = await import('./hover');

    const div = document.createElement('div');
    div.id = 'translate-hover-tooltip';
    document.body.appendChild(div);

    removeHoverTooltip();

    expect(document.getElementById('translate-hover-tooltip')).toBeNull();
  });

  it('does nothing when no hover tooltip exists', async () => {
    const { removeHoverTooltip } = await import('./hover');
    expect(() => removeHoverTooltip()).not.toThrow();
  });
});

describe('initHoverListeners / cleanupHoverListeners', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('initHoverListeners registers event handlers without throwing', async () => {
    const { initHoverListeners } = await import('./hover');
    const addSpy = vi.spyOn(document, 'addEventListener');
    initHoverListeners();
    // At least mousemove, keydown, keyup registered
    expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), expect.anything());
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
    addSpy.mockRestore();
  });

  it('cleanupHoverListeners removes event handlers without throwing', async () => {
    const { cleanupHoverListeners } = await import('./hover');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    cleanupHoverListeners();
    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
    removeSpy.mockRestore();
  });
});

describe('Alt key state management via keyboard events', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('sets cursor to help on Alt keydown', async () => {
    const { initHoverListeners } = await import('./hover');
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
    expect(document.body.style.cursor).toBe('help');
  });

  it('clears cursor on Alt keyup', async () => {
    const { initHoverListeners, removeHoverTooltip } = await import('./hover');
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));

    expect(document.body.style.cursor).toBe('');
    removeHoverTooltip(); // cleanup
  });

  it('ignores non-Alt keys on keydown', async () => {
    const { initHoverListeners } = await import('./hover');
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    expect(document.body.style.cursor).not.toBe('help');
  });

  it('ignores non-Alt keys on keyup', async () => {
    const { initHoverListeners } = await import('./hover');
    initHoverListeners();

    // Alt down, then random key up — Alt should remain active
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
    expect(document.body.style.cursor).toBe('help');
  });

  it('clears hover state on window blur', async () => {
    const { initHoverListeners } = await import('./hover');
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
    window.dispatchEvent(new Event('blur'));

    expect(document.body.style.cursor).toBe('');
  });
});

describe('mousemove debouncing', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('does not fire translation when Alt is not held', async () => {
    vi.useFakeTimers();
    const { initHoverListeners } = await import('./hover');
    initHoverListeners();

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    vi.advanceTimersByTime(200);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('debounces mousemove events when Alt is held', async () => {
    vi.useFakeTimers();
    mockSafeStorageGet.mockResolvedValue({ targetLang: 'fi', provider: 'opus-mt' });
    mockSendMessage.mockResolvedValue({ success: false });

    const { initHoverListeners } = await import('./hover');
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    // Fire multiple mousemoves — only last one should trigger (debounced)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 101, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 102, clientY: 100 }));

    // No translation yet (debounce pending)
    expect(mockSendMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    // caretRangeFromPoint returns null in jsdom (no text at cursor)
    // so handleHoverTranslation removes tooltip and returns without calling sendMessage
    expect(document.getElementById('translate-hover-tooltip')).toBeNull();
  });
});
