/**
 * Tests for src/content/correction.ts
 *
 * Tests makeTranslatedElementEditable and showCorrectionHint.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock toast to avoid DOM side effects
vi.mock('./toast', () => ({
  showInfoToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

// Mock safeStorageGet
const mockSafeStorageGet = vi.fn().mockResolvedValue({});
vi.mock('../core/storage', () => ({
  safeStorageGet: (...args: unknown[]) => mockSafeStorageGet(...args),
}));

// Mock browserAPI
const mockSendMessage = vi.fn().mockResolvedValue({ success: true });
const mockStorageSet = vi.fn().mockResolvedValue(undefined);
vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: {
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    },
    storage: {
      local: {
        set: (...args: unknown[]) => mockStorageSet(...args),
      },
    },
  },
}));

// Mock content-types
vi.mock('./content-types', () => ({
  MACHINE_TRANSLATION_ATTR: 'data-machine-translation',
  ORIGINAL_TEXT_ATTR: 'data-original-text',
  SOURCE_LANG_ATTR: 'data-source-lang',
  TARGET_LANG_ATTR: 'data-target-lang',
  TRANSLATED_ATTR: 'data-translated',
  SKIP_TAGS: new Set(['SCRIPT', 'STYLE']),
}));

import { makeTranslatedElementEditable } from './correction';
import { showInfoToast, showErrorToast } from './toast';

const mockShowInfoToast = vi.mocked(showInfoToast);
const mockShowErrorToast = vi.mocked(showErrorToast);

/** Flush all pending microtasks (async/await chains) */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => queueMicrotask(() => r(undefined)));
  }
}

// Helper: create a properly attributed translated element
function makeTranslatedEl(overrides: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('span');
  el.setAttribute('data-machine-translation', overrides['data-machine-translation'] ?? 'hei');
  el.setAttribute('data-original-text', overrides['data-original-text'] ?? 'hello');
  el.setAttribute('data-source-lang', overrides['data-source-lang'] ?? 'en');
  el.setAttribute('data-target-lang', overrides['data-target-lang'] ?? 'fi');
  el.textContent = overrides.textContent ?? 'hei';
  document.body.appendChild(el);
  return el;
}

describe('makeTranslatedElementEditable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('sets data-correction-enabled attribute', () => {
    const el = makeTranslatedEl();
    makeTranslatedElementEditable(el);
    expect(el.getAttribute('data-correction-enabled')).toBe('true');
  });

  it('sets cursor to text', () => {
    const el = makeTranslatedEl();
    makeTranslatedElementEditable(el);
    expect(el.style.cursor).toBe('text');
  });

  it('is idempotent (calling twice does not throw)', () => {
    const el = makeTranslatedEl();
    makeTranslatedElementEditable(el);
    makeTranslatedElementEditable(el);
    expect(el.getAttribute('data-correction-enabled')).toBe('true');
  });

  it('click on element makes it contenteditable', () => {
    const el = makeTranslatedEl();
    makeTranslatedElementEditable(el);
    el.click();
    expect(el.getAttribute('contenteditable')).toBe('true');
  });

  it('click does nothing when already in contenteditable mode', () => {
    const el = makeTranslatedEl();
    makeTranslatedElementEditable(el);
    el.setAttribute('contenteditable', 'true');
    expect(() => el.click()).not.toThrow();
  });

  it('click does not enable editing when target is a link', () => {
    const el = makeTranslatedEl();
    const link = document.createElement('a');
    link.href = '#';
    el.appendChild(link);
    makeTranslatedElementEditable(el);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: link });
    el.dispatchEvent(event);

    expect(el.getAttribute('contenteditable')).toBeNull();
  });

  describe('enableCorrectionEditing behavior', () => {
    it('does not enable editing when required attributes are missing', () => {
      const el = document.createElement('span');
      el.textContent = 'translated text';
      document.body.appendChild(el);

      makeTranslatedElementEditable(el);
      el.click();

      expect(el.getAttribute('contenteditable')).toBeNull();
    });

    it('sends addCorrection message on blur with changed text', async () => {
      const el = makeTranslatedEl();
      makeTranslatedElementEditable(el);
      el.click();

      el.textContent = 'terve'; // different from 'hei' (machine translation)
      el.dispatchEvent(new Event('blur'));

      await flushPromises();

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'addCorrection',
          original: 'hello',
          userCorrection: 'terve',
          sourceLang: 'en',
          targetLang: 'fi',
        })
      );
    });

    it('shows info toast after successful correction save', async () => {
      const el = makeTranslatedEl();
      makeTranslatedElementEditable(el);
      el.click();

      el.textContent = 'terve';
      el.dispatchEvent(new Event('blur'));

      await flushPromises();

      expect(mockShowInfoToast).toHaveBeenCalled();
    });

    it('shows error toast when sendMessage throws', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('IPC error'));
      const el = makeTranslatedEl();
      makeTranslatedElementEditable(el);
      el.click();

      el.textContent = 'terve';
      el.dispatchEvent(new Event('blur'));

      await flushPromises();

      expect(mockShowErrorToast).toHaveBeenCalled();
    });

    it('restores original text when blur text is empty', async () => {
      const el = makeTranslatedEl();
      makeTranslatedElementEditable(el);
      el.click();

      const originalText = el.textContent;
      el.textContent = '  '; // empty after trim
      el.dispatchEvent(new Event('blur'));

      await flushPromises();

      expect(el.textContent).toBe(originalText);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does not send correction when text matches machine translation', async () => {
      const el = makeTranslatedEl();
      makeTranslatedElementEditable(el);
      el.click();

      const originalText = el.textContent;
      el.textContent = 'hei'; // same as machine translation
      el.dispatchEvent(new Event('blur'));

      await flushPromises();

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(el.textContent).toBe(originalText);
    });

    it('Enter key triggers blur', () => {
      const el = makeTranslatedEl();
      makeTranslatedElementEditable(el);
      el.click();

      const blurSpy = vi.spyOn(el, 'blur');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(blurSpy).toHaveBeenCalled();
    });

    it('Shift+Enter does not trigger blur', () => {
      const el = makeTranslatedEl();
      makeTranslatedElementEditable(el);
      el.click();

      const blurSpy = vi.spyOn(el, 'blur');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));

      expect(blurSpy).not.toHaveBeenCalled();
    });

    it('Escape key restores original text and blurs', () => {
      const el = makeTranslatedEl();
      makeTranslatedElementEditable(el);
      el.click();

      const originalText = el.textContent;
      el.textContent = 'changed';
      const blurSpy = vi.spyOn(el, 'blur');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(el.textContent).toBe(originalText);
      expect(blurSpy).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// showCorrectionHint
// ============================================================================
// showCorrectionHint has module-level state (correctionHintShown).
// We use vi.resetModules() in beforeEach so each test gets a fresh module.

describe('showCorrectionHint', () => {
  let showCorrectionHint: (el: HTMLElement) => void;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset modules to clear correctionHintShown module-level variable
    vi.resetModules();
    vi.doMock('../core/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }));
    vi.doMock('./toast', () => ({ showInfoToast: vi.fn(), showErrorToast: vi.fn() }));
    vi.doMock('../core/storage', () => ({
      safeStorageGet: (...args: unknown[]) => mockSafeStorageGet(...args),
    }));
    vi.doMock('../core/browser-api', () => ({
      browserAPI: {
        runtime: { sendMessage: (...args: unknown[]) => mockSendMessage(...args) },
        storage: { local: { set: (...args: unknown[]) => mockStorageSet(...args) } },
      },
    }));
    vi.doMock('./content-types', () => ({
      MACHINE_TRANSLATION_ATTR: 'data-machine-translation',
      ORIGINAL_TEXT_ATTR: 'data-original-text',
      SOURCE_LANG_ATTR: 'data-source-lang',
      TARGET_LANG_ATTR: 'data-target-lang',
      TRANSLATED_ATTR: 'data-translated',
      SKIP_TAGS: new Set(['SCRIPT', 'STYLE']),
    }));

    const mod = await import('./correction');
    showCorrectionHint = mod.showCorrectionHint;

    mockSafeStorageGet.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not throw', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(() => showCorrectionHint(el)).not.toThrow();
    await vi.runAllTimersAsync();
  });

  it('shows hint element when not previously shown', async () => {
    mockSafeStorageGet.mockResolvedValue({});
    const el = document.createElement('div');
    document.body.appendChild(el);

    showCorrectionHint(el);
    // Allow the safeStorageGet promise to resolve and the .then() to execute
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const hint = document.getElementById('translate-correction-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('Tip:');
  });

  it('does not show hint when already shown in storage', async () => {
    mockSafeStorageGet.mockResolvedValue({ translate_correction_hint_shown: true });
    const el = document.createElement('div');
    document.body.appendChild(el);

    showCorrectionHint(el);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const hint = document.getElementById('translate-correction-hint');
    expect(hint).toBeNull();
  });

  it('removes hint after 6000ms fade-out', async () => {
    mockSafeStorageGet.mockResolvedValue({});
    const el = document.createElement('div');
    document.body.appendChild(el);

    showCorrectionHint(el);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('translate-correction-hint')).not.toBeNull();

    vi.advanceTimersByTime(6000);
    vi.advanceTimersByTime(300);

    expect(document.getElementById('translate-correction-hint')).toBeNull();
  });

  it('handles storage error gracefully and marks hint as shown', async () => {
    mockSafeStorageGet.mockRejectedValue(new Error('Storage not available'));
    const el = document.createElement('div');
    document.body.appendChild(el);

    showCorrectionHint(el);

    // Let the rejected promise and catch handler settle
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Hint should not be created (catch just marks correctionHintShown = true)
    expect(document.getElementById('translate-correction-hint')).toBeNull();

    // Second call should be a no-op since correctionHintShown is true
    showCorrectionHint(el);
    expect(document.getElementById('translate-correction-hint')).toBeNull();
  });
});
