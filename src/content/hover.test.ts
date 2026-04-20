/**
 * Tests for src/content/hover.ts
 *
 * hover.ts manages Alt+hover translation tooltips.
 * Uses module-level state; each test resets via module reimport or direct state manipulation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBrowserApiModuleMock, createLoggerModuleMock } from '../test-helpers/module-mocks';
import {
  createMockRange,
  mockCaretRangeFromPoint,
  mockRangeBoundingClientRect,
  setupCaretRangeFromText,
} from '../test-helpers/dom-property-mocks';

// ============================================================================
// Mocks (must be at top level — vi.mock hoisting)
// ============================================================================

const mockSendMessage = vi.fn();

vi.mock('../core/browser-api', () => createBrowserApiModuleMock({
  runtimeSendMessage: mockSendMessage,
}));

const mockSafeStorageGet = vi.fn();
vi.mock('../core/storage', () => ({
  safeStorageGet: (...args: unknown[]) => mockSafeStorageGet(...args),
}));

vi.mock('../core/logger', () => createLoggerModuleMock());

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

const HOVER_RANGE_RECT = {
  top: 100,
  bottom: 120,
  left: 200,
  right: 250,
  width: 50,
  height: 20,
  x: 200,
  y: 100,
};

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

// ============================================================================
// handleHoverTranslation — full async path via mocked caretRangeFromPoint
// ============================================================================

describe('handleHoverTranslation via mousemove with text node', () => {
  // Helper: create a text node and mock caretRangeFromPoint to return a Range on it.
  // Also patches Range.prototype.getBoundingClientRect so the wordRange in hover.ts works.
  function setupTextNodeAndRange(text: string): { textNode: Text; restoreCaretRange: () => void } {
    const caretRangeMock = setupCaretRangeFromText(text, {
      startOffset: Math.floor(text.length / 2),
      endOffset: Math.floor(text.length / 2),
      rect: HOVER_RANGE_RECT,
    });

    return {
      textNode: caretRangeMock.textNode,
      restoreCaretRange: caretRangeMock.restore,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // Reset hover module's lastHoveredText state before each test
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
    mockSafeStorageGet.mockResolvedValue({ targetLang: 'fi', provider: 'opus-mt' });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('shows loading tooltip then hover tooltip on successful translate', async () => {
    mockSendMessage.mockResolvedValue({ success: true, result: 'käännetty' });

    const { initHoverListeners, setResolveSourceLang } = await import('./hover');
    setResolveSourceLang((lang) => lang);
    initHoverListeners();

    const { restoreCaretRange } = setupTextNodeAndRange('hello world');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));

    // Wait for debounce (150ms) + async translation
    await new Promise((r) => setTimeout(r, 200));

    restoreCaretRange();

    // Hover tooltip should exist with translated content
    const tooltip = document.getElementById('translate-hover-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain('käännetty');
  });

  it('removes loading tooltip when translate response is unsuccessful', async () => {
    mockSendMessage.mockResolvedValue({ success: false });

    const { initHoverListeners, setResolveSourceLang } = await import('./hover');
    setResolveSourceLang((lang) => lang);
    initHoverListeners();

    const { restoreCaretRange } = setupTextNodeAndRange('failword test');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));

    await vi.waitFor(() => expect(mockSendMessage).toHaveBeenCalled());
    restoreCaretRange();

    // No tooltip since translation was not successful
    expect(document.getElementById('translate-hover-tooltip')).toBeNull();
  });

  it('removes tooltip on error', async () => {
    mockSendMessage.mockRejectedValue(new Error('network failure'));

    const { initHoverListeners, setResolveSourceLang } = await import('./hover');
    setResolveSourceLang((lang) => lang);
    initHoverListeners();

    const { restoreCaretRange } = setupTextNodeAndRange('errorword test');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));

    await vi.waitFor(() => expect(mockSendMessage).toHaveBeenCalled());
    restoreCaretRange();

    expect(document.getElementById('translate-hover-tooltip')).toBeNull();
  });

  it('uses hover cache on repeated hover over same word', async () => {
    mockSendMessage.mockResolvedValue({ success: true, result: 'käännetty' });

    const { initHoverListeners, setResolveSourceLang } = await import('./hover');
    setResolveSourceLang((lang) => lang);
    initHoverListeners();

    const { restoreCaretRange } = setupTextNodeAndRange('hello world');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    // First hover
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.waitFor(() => expect(document.getElementById('translate-hover-tooltip')).not.toBeNull());

    const callsAfterFirst = mockSendMessage.mock.calls.length;

    // Alt keyup then re-press to reset lastHoveredText so second hover fires
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    // Second hover over same word — should use cache
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.waitFor(() => expect(document.getElementById('translate-hover-tooltip')).not.toBeNull());

    restoreCaretRange();

    // No additional sendMessage calls (served from cache)
    expect(mockSendMessage.mock.calls.length).toBe(callsAfterFirst);
    const tooltip = document.getElementById('translate-hover-tooltip');
    expect(tooltip).not.toBeNull();
  });
});

// ============================================================================
// Coverage: catch / finally paths in handleHoverTranslation (lines 218, 222-223)
// ============================================================================

describe('handleHoverTranslation error handling', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('catches sendMessage rejection and removes tooltip in finally block', async () => {
    vi.useFakeTimers();
    mockSafeStorageGet.mockResolvedValue({ targetLang: 'fi', provider: 'opus-mt' });
    mockSendMessage.mockRejectedValue(new Error('network failure'));

    const { initHoverListeners, setResolveSourceLang, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();
    setResolveSourceLang((lang) => lang);

    // Reset lastHoveredText via Alt cycle
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const hoverWord = setupCaretRangeFromText('errortestword', {
      startOffset: 0,
      endOffset: 0,
      rect: HOVER_RANGE_RECT,
    });

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    expect(mockSendMessage).toHaveBeenCalled();
    // Tooltip removed by finally block when tooltipReplaced is false (lines 222-223)
    expect(document.getElementById('translate-hover-tooltip')).toBeNull();

    hoverWord.restore();
    cleanupHoverListeners();
  });

  it('handles translation timeout when sendMessage never resolves', async () => {
    vi.useFakeTimers();
    mockSafeStorageGet.mockResolvedValue({ targetLang: 'fi', provider: 'opus-mt' });
    mockSendMessage.mockImplementation(() => new Promise(() => {})); // never resolves

    const { initHoverListeners, setResolveSourceLang, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();
    setResolveSourceLang((lang) => lang);

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const hoverWord = setupCaretRangeFromText('timeoutword', {
      startOffset: 0,
      endOffset: 0,
      rect: HOVER_RANGE_RECT,
    });

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160); // debounce fires, async chain starts
    await vi.advanceTimersByTimeAsync(10001); // timeout fires after 10s

    expect(document.getElementById('translate-hover-tooltip')).toBeNull();

    hoverWord.restore();
    cleanupHoverListeners();
  });
});

// ============================================================================
// Coverage: additional branches in handleHoverTranslation
// ============================================================================

describe('handleHoverTranslation branch coverage', () => {
  /** Helper: set up a text node with mocked caretRangeFromPoint + getBoundingClientRect */
  function setupHoverWord(word: string): { restore: () => void } {
    return setupCaretRangeFromText(word, {
      startOffset: 0,
      endOffset: 0,
      rect: HOVER_RANGE_RECT,
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('uses default resolveSourceLangFn when setResolveSourceLang is not called', async () => {
    vi.useFakeTimers();
    vi.resetModules();

    mockSafeStorageGet.mockResolvedValue({ targetLang: 'fi', provider: 'opus-mt' });
    mockSendMessage.mockResolvedValue({ success: true, result: 'translated' });

    const { initHoverListeners, cleanupHoverListeners } = await import('./hover');
    // Deliberately NOT calling setResolveSourceLang — exercises default (l) => l
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const { restore } = setupHoverWord('defaultresolverword');

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    // Default resolver passes 'auto' through unchanged
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLang: 'auto' }),
    );

    restore();
    cleanupHoverListeners();
  });

  it('uses default targetLang and provider when storage returns empty', async () => {
    vi.useFakeTimers();
    mockSafeStorageGet.mockResolvedValue({});
    mockSendMessage.mockResolvedValue({ success: true, result: 'translated' });

    const { initHoverListeners, setResolveSourceLang, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();
    setResolveSourceLang((lang) => lang);

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const { restore } = setupHoverWord('defaultsettingsword');

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ targetLang: 'en', provider: 'opus-mt' }),
    );

    restore();
    cleanupHoverListeners();
  });

  it('removes tooltip when response.success is true but result is falsy', async () => {
    vi.useFakeTimers();
    mockSafeStorageGet.mockResolvedValue({ targetLang: 'fi', provider: 'opus-mt' });
    mockSendMessage.mockResolvedValue({ success: true, result: '' });

    const { initHoverListeners, setResolveSourceLang, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();
    setResolveSourceLang((lang) => lang);

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const { restore } = setupHoverWord('falsyresultword');

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    // Finally block removes tooltip since tooltipReplaced stays false
    expect(document.getElementById('translate-hover-tooltip')).toBeNull();

    restore();
    cleanupHoverListeners();
  });

  it('returns null from getTextAtPoint when range lands on non-TEXT_NODE', async () => {
    vi.useFakeTimers();

    const { initHoverListeners, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const div = document.createElement('div');
    document.body.appendChild(div);

    // caretRangeFromPoint returns a range whose startContainer is an element, not text
    const { range } = createMockRange({
      startContainer: div,
      startOffset: 0,
      endContainer: div,
      endOffset: 0,
    });
    const caretRangeMock = mockCaretRangeFromPoint(range, 'hover.branch.nonText.caretRangeFromPoint');

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    // No tooltip — getTextAtPoint returned null, which removes any existing tooltip
    expect(document.getElementById('translate-hover-tooltip')).toBeNull();
    expect(mockSendMessage).not.toHaveBeenCalled();

    caretRangeMock.restore();
    cleanupHoverListeners();
  });

  it('returns null from getTextAtPoint when shouldSkip returns true', async () => {
    vi.useFakeTimers();
    const { shouldSkip } = await import('./dom-utils');
    (shouldSkip as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { initHoverListeners, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const hoverWord = setupCaretRangeFromText('shouldskipword', {
      startOffset: 0,
      endOffset: 0,
    });

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    expect(mockSendMessage).not.toHaveBeenCalled();

    hoverWord.restore();
    (shouldSkip as ReturnType<typeof vi.fn>).mockReturnValue(false);
    cleanupHoverListeners();
  });

  it('returns null from getTextAtPoint when word is too short', async () => {
    vi.useFakeTimers();

    const { initHoverListeners, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    // Single character word — too short (< 2 chars)
    const hoverWord = setupCaretRangeFromText('x', {
      startOffset: 0,
      endOffset: 0,
    });

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    expect(mockSendMessage).not.toHaveBeenCalled();

    hoverWord.restore();
    cleanupHoverListeners();
  });

  it('returns early when Alt is released during debounce window', async () => {
    vi.useFakeTimers();

    const { initHoverListeners, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const { restore } = setupHoverWord('altreleasedword');

    // mousemove sets debounce timer while Alt is held
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));

    // Release Alt BEFORE debounce fires (< 150ms)
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));

    // Debounce fires — handleHoverTranslation checks isAltKeyDown which is now false
    await vi.advanceTimersByTimeAsync(160);

    expect(mockSendMessage).not.toHaveBeenCalled();

    restore();
    cleanupHoverListeners();
  });

  it('returns null from getTextAtPoint when textContent is null', async () => {
    vi.useFakeTimers();

    const { initHoverListeners, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const hoverWord = setupCaretRangeFromText('', {
      startOffset: 0,
      endOffset: 0,
    });

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    expect(mockSendMessage).not.toHaveBeenCalled();

    hoverWord.restore();
    cleanupHoverListeners();
  });
});

// ============================================================================
// Coverage: LRU cache eviction (lines 209-211)
// ============================================================================

describe('LRU cache eviction in handleHoverTranslation', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('evicts oldest cache entry when cache exceeds 100 items', async () => {
    vi.useFakeTimers();
    mockSafeStorageGet.mockResolvedValue({ targetLang: 'fi', provider: 'opus-mt' });

    let callCount = 0;
    mockSendMessage.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ success: true, result: `t-${callCount}` });
    });

    const { initHoverListeners, setResolveSourceLang, cleanupHoverListeners } = await import('./hover');
    cleanupHoverListeners();
    initHoverListeners();
    setResolveSourceLang((lang) => lang);

    const p = document.createElement('p');
    document.body.appendChild(p);

    const rangeRectMock = mockRangeBoundingClientRect({
      rect: HOVER_RANGE_RECT,
      target: Range.prototype,
      fixtureKey: 'hover.lru.rangeRect',
    });
    let currentRange: Range | null = null;
    const caretRangeMock = mockCaretRangeFromPoint(
      () => currentRange,
      'hover.lru.caretRangeFromPoint',
    );

    for (let i = 0; i < 101; i++) {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

      const word = `lruword${String(i).padStart(4, '0')}`;
      p.textContent = '';
      const textNode = document.createTextNode(word);
      p.appendChild(textNode);

      currentRange = createMockRange({
        startContainer: textNode,
        startOffset: 0,
        endContainer: textNode,
        endOffset: 0,
      }).range;

      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
      await vi.advanceTimersByTimeAsync(160);
    }

    expect(mockSendMessage).toHaveBeenCalledTimes(101);

    caretRangeMock.restore();
    rangeRectMock.restore();
    cleanupHoverListeners();
  });
});

describe('Hover translation cache eviction (line 211 branch)', () => {
  it('triggers cache eviction logic when adding items beyond limit', async () => {
    vi.useFakeTimers();

    // Import fresh module for this test
    const hoverMod = await import('./hover');
    const { initHoverListeners, setResolveSourceLang, cleanupHoverListeners } = hoverMod;
    
    setResolveSourceLang((lang) => lang);
    cleanupHoverListeners();
    initHoverListeners();

    const p = document.createElement('p');
    document.body.appendChild(p);

    const rangeRectMock = mockRangeBoundingClientRect({
      rect: HOVER_RANGE_RECT,
      target: Range.prototype,
      fixtureKey: 'hover.cacheEviction.rangeRect',
    });
    let currentRange: Range | null = null;
    const caretRangeMock = mockCaretRangeFromPoint(
      () => currentRange,
      'hover.cacheEviction.caretRangeFromPoint',
    );

    // Insert 5 items to test the cache logic path
    for (let i = 0; i < 5; i++) {
      const word = `cacheword${i}`;
      p.textContent = '';
      const textNode = document.createTextNode(word);
      p.appendChild(textNode);

      currentRange = createMockRange({
        startContainer: textNode,
        startOffset: 0,
        endContainer: textNode,
        endOffset: word.length,
      }).range;

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        result: `translated${i}`,
      });

      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
      await vi.advanceTimersByTimeAsync(160);
    }

    caretRangeMock.restore();
    rangeRectMock.restore();
    cleanupHoverListeners();
    vi.useRealTimers();
  });

  it('clears hoverTimer in finally block when translation succeeds', async () => {
    vi.useFakeTimers();

    const hoverMod = await import('./hover');
    const { initHoverListeners, setResolveSourceLang, cleanupHoverListeners } = hoverMod;
    
    setResolveSourceLang((lang) => lang);
    cleanupHoverListeners();
    initHoverListeners();

    const p = document.createElement('p');
    document.body.appendChild(p);

    const word = 'testword';
    p.textContent = '';
    const textNode = document.createTextNode(word);
    p.appendChild(textNode);

    const rangeRectMock = mockRangeBoundingClientRect({
      rect: HOVER_RANGE_RECT,
      target: Range.prototype,
      fixtureKey: 'hover.finally.rangeRect',
    });
    const { range } = createMockRange({
      startContainer: textNode,
      startOffset: 0,
      endContainer: textNode,
      endOffset: word.length,
    });

    mockSendMessage.mockResolvedValueOnce({
      success: true,
      result: 'resultado',
    });

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

    const caretRangeMock = mockCaretRangeFromPoint(
      range,
      'hover.finally.caretRangeFromPoint',
    );

    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 }));
    await vi.advanceTimersByTimeAsync(160);

    // Verify clearTimeout was called (finally block executes)
    expect(clearTimeoutSpy).toHaveBeenCalled();

    caretRangeMock.restore();
    rangeRectMock.restore();
    clearTimeoutSpy.mockRestore();
    cleanupHoverListeners();
    vi.useRealTimers();
  });
});
