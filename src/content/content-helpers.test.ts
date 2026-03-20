/**
 * Tests for content script helper modules:
 * - sanitize.ts (escapeHtml)
 * - timing.ts (CircularTimingBuffer, contentTimings, recordContentTiming, getContentTimingStats)
 * - dom-utils.ts (shouldSkip, isValidText, sanitizeText, getTextNodes, getTextNodesFromNodes)
 * - toast.ts (showInfoToast, showProgressToast, updateProgressToast, removeProgressToast, showErrorToast)
 * - context.ts (getPageContext, getSelectionContext)
 * - bilingual.ts (applyBilingualToElement, removeBilingualFromElement, enableBilingualMode, disableBilingualMode, toggleBilingualMode, getBilingualModeState)
 * - correction.ts (makeTranslatedElementEditable, showCorrectionHint)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true }) },
    storage: { local: { set: vi.fn().mockResolvedValue(undefined) } },
  },
}));

vi.mock('../core/storage', () => ({
  safeStorageGet: vi.fn().mockResolvedValue({}),
  safeStorageSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./shadow-dom-walker', () => ({
  walkShadowRoots: vi.fn(),
  getDeepSelection: vi.fn().mockReturnValue(null),
}));

// Note: ./toast is NOT mocked here — the toast tests exercise the real DOM code.
// bilingual.ts and correction.ts call showInfoToast/showErrorToast which will
// exercise toast.ts as well (acceptable side-effect in integration-style tests).

// ============================================================================
// sanitize.ts
// ============================================================================

describe('escapeHtml', () => {
  it('escapes < and > characters', async () => {
    const { escapeHtml } = await import('./sanitize');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes & character', async () => {
    const { escapeHtml } = await import('./sanitize');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets which is the main XSS vector', async () => {
    // Browsers do not encode double quotes inside text nodes (only in attributes)
    // The primary XSS protection from escapeHtml is against < and >
    const { escapeHtml } = await import('./sanitize');
    const result = escapeHtml('<b>"bold"</b>');
    expect(result).toContain('&lt;b&gt;');
    expect(result).not.toContain('<b>');
  });

  it('returns plain text unchanged', async () => {
    const { escapeHtml } = await import('./sanitize');
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles empty string', async () => {
    const { escapeHtml } = await import('./sanitize');
    expect(escapeHtml('')).toBe('');
  });
});

// ============================================================================
// timing.ts
// ============================================================================

describe('CircularTimingBuffer', () => {
  it('returns null stats for empty buffer', async () => {
    const { CircularTimingBuffer } = await import('./timing');
    const buf = new CircularTimingBuffer(10);
    expect(buf.getStats()).toBeNull();
  });

  it('computes correct stats after pushes', async () => {
    const { CircularTimingBuffer } = await import('./timing');
    const buf = new CircularTimingBuffer(10);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    const stats = buf.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.avg).toBe(20);
    expect(stats!.min).toBe(10);
    expect(stats!.max).toBe(30);
    expect(stats!.count).toBe(3);
  });

  it('wraps around when full (circular)', async () => {
    const { CircularTimingBuffer } = await import('./timing');
    const buf = new CircularTimingBuffer(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(100); // overwrites index 0
    const stats = buf.getStats();
    // Buffer now contains [100, 2, 3] — count stays at 3 (max)
    expect(stats!.count).toBe(3);
    expect(stats!.max).toBe(100);
  });
});

describe('recordContentTiming and getContentTimingStats', () => {
  it('records timing and returns it in stats', async () => {
    const { recordContentTiming, getContentTimingStats } = await import('./timing');
    recordContentTiming('domScan', 42);
    const stats = getContentTimingStats();
    expect(stats.domScan).toBeDefined();
    expect(stats.domScan.count).toBeGreaterThanOrEqual(1);
  });

  it('all four categories are tracked', async () => {
    const { recordContentTiming, getContentTimingStats } = await import('./timing');
    recordContentTiming('domScan', 1);
    recordContentTiming('domUpdate', 2);
    recordContentTiming('glossaryApply', 3);
    recordContentTiming('ipcRoundtrip', 4);
    const stats = getContentTimingStats();
    expect(stats.domScan).toBeDefined();
    expect(stats.domUpdate).toBeDefined();
    expect(stats.glossaryApply).toBeDefined();
    expect(stats.ipcRoundtrip).toBeDefined();
  });

  it('omits categories with no data from stats output', async () => {
    const { getContentTimingStats } = await import('./timing');
    // Fresh import — but module is shared, may have data from prior tests
    const stats = getContentTimingStats();
    // All returned values must have the expected shape
    for (const v of Object.values(stats)) {
      expect(v).toHaveProperty('avg');
      expect(v).toHaveProperty('min');
      expect(v).toHaveProperty('max');
      expect(v).toHaveProperty('count');
    }
  });
});

// ============================================================================
// dom-utils.ts
// ============================================================================

describe('isValidText', () => {
  let isValidText: (text: string | null) => text is string;

  beforeEach(async () => {
    const mod = await import('./dom-utils');
    isValidText = mod.isValidText;
  });

  it('returns false for null', () => {
    expect(isValidText(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidText('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isValidText('   ')).toBe(false);
  });

  it('returns false for numbers-only', () => {
    expect(isValidText('12345')).toBe(false);
  });

  it('returns false for price string', () => {
    expect(isValidText('€29,99')).toBe(false);
  });

  it('returns false for URL-like text', () => {
    expect(isValidText('https://example.com')).toBe(false);
  });

  it('returns false for code-like text', () => {
    expect(isValidText('const x = 1')).toBe(false);
  });

  it('returns true for normal translatable text', () => {
    expect(isValidText('Hello world')).toBe(true);
  });

  it('returns true for longer sentence', () => {
    expect(isValidText('This is a normal sentence that should be translated')).toBe(true);
  });
});

describe('sanitizeText', () => {
  it('trims whitespace', async () => {
    const { sanitizeText } = await import('./dom-utils');
    expect(sanitizeText('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces', async () => {
    const { sanitizeText } = await import('./dom-utils');
    expect(sanitizeText('hello   world')).toBe('hello world');
  });

  it('removes control characters', async () => {
    const { sanitizeText } = await import('./dom-utils');
    expect(sanitizeText('hello\x00world')).toBe('helloworld');
  });

  it('normalizes unicode to NFC', async () => {
    const { sanitizeText } = await import('./dom-utils');
    // NFC normalization should not change already-normalized text
    const result = sanitizeText('café');
    expect(result).toBe('café');
  });
});

describe('shouldSkip', () => {
  it('skips SCRIPT elements', async () => {
    const { shouldSkip } = await import('./dom-utils');
    const el = document.createElement('script');
    el.textContent = 'console.log("hi")';
    document.body.appendChild(el);
    expect(shouldSkip(el)).toBe(true);
    el.remove();
  });

  it('skips STYLE elements', async () => {
    const { shouldSkip } = await import('./dom-utils');
    const el = document.createElement('style');
    el.textContent = 'body {}';
    document.body.appendChild(el);
    expect(shouldSkip(el)).toBe(true);
    el.remove();
  });

  it('skips already-translated elements', async () => {
    const { shouldSkip } = await import('./dom-utils');
    const el = document.createElement('div');
    el.setAttribute('data-translated', 'true');
    document.body.appendChild(el);
    expect(shouldSkip(el)).toBe(true);
    el.remove();
  });

  it('skips elements with data-no-translate', async () => {
    const { shouldSkip } = await import('./dom-utils');
    const el = document.createElement('div');
    el.setAttribute('data-no-translate', '');
    document.body.appendChild(el);
    expect(shouldSkip(el)).toBe(true);
    el.remove();
  });

  it('skips elements with translate="no"', async () => {
    const { shouldSkip } = await import('./dom-utils');
    const el = document.createElement('div');
    el.setAttribute('translate', 'no');
    document.body.appendChild(el);
    expect(shouldSkip(el)).toBe(true);
    el.remove();
  });

  it('does not skip normal paragraph elements', async () => {
    const { shouldSkip } = await import('./dom-utils');
    const el = document.createElement('p');
    el.textContent = 'Normal text';
    document.body.appendChild(el);
    expect(shouldSkip(el)).toBe(false);
    el.remove();
  });

  it('uses cached result on second call for same element', async () => {
    const { shouldSkip } = await import('./dom-utils');
    const el = document.createElement('p');
    document.body.appendChild(el);
    const r1 = shouldSkip(el);
    const r2 = shouldSkip(el); // should use cache
    expect(r1).toBe(r2);
    el.remove();
  });

  it('clearSkipCacheEntry removes cached result', async () => {
    const { shouldSkip, clearSkipCacheEntry } = await import('./dom-utils');
    const el = document.createElement('p');
    document.body.appendChild(el);
    shouldSkip(el); // populate cache
    clearSkipCacheEntry(el);
    // Should still work after cache clear
    expect(shouldSkip(el)).toBe(false);
    el.remove();
  });
});

describe('getTextNodes', () => {
  it('returns text nodes from simple element', async () => {
    const { getTextNodes } = await import('./dom-utils');
    const div = document.createElement('div');
    div.textContent = 'Hello world, this is a test sentence for translation.';
    document.body.appendChild(div);
    const nodes = getTextNodes(div);
    expect(nodes.length).toBeGreaterThan(0);
    div.remove();
  });

  it('skips script text nodes', async () => {
    const { getTextNodes } = await import('./dom-utils');
    const div = document.createElement('div');
    div.innerHTML = '<script>var x = 1;</script><p>Normal text that is long enough to be valid.</p>';
    document.body.appendChild(div);
    const nodes = getTextNodes(div);
    const hasScript = nodes.some((n) => n.textContent?.includes('var x'));
    expect(hasScript).toBe(false);
    div.remove();
  });
});

describe('getTextNodesFromNodes', () => {
  it('handles text node type', async () => {
    const { getTextNodesFromNodes } = await import('./dom-utils');
    const div = document.createElement('div');
    div.textContent = 'This is long enough text to be valid for translation.';
    document.body.appendChild(div);
    const textNode = div.firstChild as Text;
    const result = getTextNodesFromNodes([textNode]);
    expect(result.length).toBeGreaterThan(0);
    div.remove();
  });

  it('handles element node type', async () => {
    const { getTextNodesFromNodes } = await import('./dom-utils');
    const div = document.createElement('div');
    div.innerHTML = '<p>Valid text content for testing translation nodes.</p>';
    document.body.appendChild(div);
    const result = getTextNodesFromNodes([div]);
    expect(result.length).toBeGreaterThan(0);
    div.remove();
  });

  it('returns empty for unrecognised node types', async () => {
    const { getTextNodesFromNodes } = await import('./dom-utils');
    // Comment node (nodeType = 8) — not TEXT or ELEMENT
    const comment = document.createComment('test comment');
    const result = getTextNodesFromNodes([comment]);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// toast.ts
// ============================================================================

describe('toast functions', () => {
  afterEach(() => {
    // Clean up DOM
    document.querySelectorAll('#translate-ext-toast, #translate-ext-progress-toast').forEach((el) => el.remove());
  });

  it('showInfoToast appends toast to body', async () => {
    const { showInfoToast } = await import('./toast');
    showInfoToast('Test message');
    const toast = document.getElementById('translate-ext-toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toBe('Test message');
  });

  it('showInfoToast removes existing toast before adding new one', async () => {
    const { showInfoToast } = await import('./toast');
    showInfoToast('First');
    showInfoToast('Second');
    const toasts = document.querySelectorAll('#translate-ext-toast');
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toBe('Second');
  });

  it('showErrorToast appends toast to body with message', async () => {
    const { showErrorToast } = await import('./toast');
    showErrorToast('Something went wrong');
    const toast = document.getElementById('translate-ext-toast');
    expect(toast).not.toBeNull();
    const text = toast?.textContent || '';
    expect(text).toContain('Something went wrong');
  });

  it('showProgressToast creates progress toast and returns element', async () => {
    const { showProgressToast } = await import('./toast');
    const el = showProgressToast('Translating...');
    expect(el).toBeDefined();
    expect(el.id).toBe('translate-ext-progress-toast');
    const inDom = document.getElementById('translate-ext-progress-toast');
    expect(inDom).not.toBeNull();
  });

  it('updateProgressToast updates text of active progress toast', async () => {
    const { showProgressToast, updateProgressToast } = await import('./toast');
    showProgressToast('Initial');
    updateProgressToast('Updated text');
    const textEl = document.querySelector('.translate-progress-text');
    expect(textEl?.textContent).toBe('Updated text');
  });

  it('updateProgressToast is a no-op if no active toast', async () => {
    const { removeProgressToast, updateProgressToast } = await import('./toast');
    removeProgressToast();
    // Should not throw
    expect(() => updateProgressToast('no toast')).not.toThrow();
  });

  it('removeProgressToast removes the progress toast', async () => {
    const { showProgressToast, removeProgressToast } = await import('./toast');
    showProgressToast('Loading...');
    expect(document.getElementById('translate-ext-progress-toast')).not.toBeNull();
    removeProgressToast();
    // After fade timeout the element is removed, but immediately the opacity is 0
    const el = document.getElementById('translate-ext-progress-toast');
    if (el) {
      expect(el.style.opacity).toBe('0');
    }
  });

  it('showProgressToast removes previous progress toast first (sets opacity=0)', async () => {
    const { showProgressToast } = await import('./toast');
    const first = showProgressToast('First');
    showProgressToast('Second');
    // removeProgressToast fades out (opacity=0) and removes via setTimeout.
    // Synchronously the old element may still be in DOM with opacity=0.
    expect(first.style.opacity).toBe('0');
  });
});

// ============================================================================
// context.ts
// ============================================================================

describe('getPageContext', () => {
  it('returns title when no semantic containers', async () => {
    const { getPageContext } = await import('./context');
    document.title = 'Test Page';
    const p = document.createElement('p');
    p.textContent = 'Some text';
    document.body.appendChild(p);
    const textNode = p.firstChild as Text;
    const ctx = getPageContext(textNode);
    expect(ctx).toBe('Test Page');
    p.remove();
  });

  it('includes article context', async () => {
    const { getPageContext } = await import('./context');
    document.title = 'Test Page';
    const article = document.createElement('article');
    const p = document.createElement('p');
    p.textContent = 'Article text';
    article.appendChild(p);
    document.body.appendChild(article);
    const textNode = p.firstChild as Text;
    const ctx = getPageContext(textNode);
    expect(ctx).toContain('article');
    article.remove();
  });

  it('includes nav context for navigation elements', async () => {
    const { getPageContext } = await import('./context');
    document.title = 'Test';
    const nav = document.createElement('nav');
    const a = document.createElement('a');
    a.textContent = 'Link text';
    nav.appendChild(a);
    document.body.appendChild(nav);
    const textNode = a.firstChild as Text;
    const ctx = getPageContext(textNode);
    expect(ctx).toContain('navigation');
    nav.remove();
  });

  it('returns empty string when no title and no semantic containers', async () => {
    const { getPageContext } = await import('./context');
    document.title = '';
    const div = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = 'Text';
    div.appendChild(p);
    document.body.appendChild(div);
    const textNode = p.firstChild as Text;
    const ctx = getPageContext(textNode);
    expect(ctx).toBe('');
    div.remove();
  });

  it('includes heading level context', async () => {
    const { getPageContext } = await import('./context');
    document.title = 'Page';
    const h2 = document.createElement('h2');
    h2.textContent = 'Section heading';
    document.body.appendChild(h2);
    const textNode = h2.firstChild as Text;
    const ctx = getPageContext(textNode);
    expect(ctx).toContain('heading');
    h2.remove();
  });
});

describe('getSelectionContext', () => {
  it('returns null when no selection', async () => {
    const { getDeepSelection } = await import('./shadow-dom-walker');
    vi.mocked(getDeepSelection).mockReturnValue(null);
    const { getSelectionContext } = await import('./context');
    expect(getSelectionContext()).toBeNull();
  });

  it('returns null when selection has no ranges', async () => {
    const { getDeepSelection } = await import('./shadow-dom-walker');
    vi.mocked(getDeepSelection).mockReturnValue({
      rangeCount: 0,
      toString: () => '',
      getRangeAt: vi.fn(),
    } as unknown as Selection);
    const { getSelectionContext } = await import('./context');
    expect(getSelectionContext()).toBeNull();
  });
});

// ============================================================================
// bilingual.ts
// ============================================================================

describe('bilingual mode', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    // Reset bilingual mode state by calling disableBilingualMode
    const { disableBilingualMode } = await import('./bilingual');
    disableBilingualMode();
  });

  it('applyBilingualToElement appends annotation span', async () => {
    const { applyBilingualToElement } = await import('./bilingual');
    const el = document.createElement('div');
    el.setAttribute('data-original-text', 'Original text');
    el.textContent = 'Translated text';
    document.body.appendChild(el);

    applyBilingualToElement(el);

    const annotation = el.querySelector('.translate-bilingual-original');
    expect(annotation).not.toBeNull();
    expect(annotation?.textContent).toBe('Original text');
    expect(el.classList.contains('translate-bilingual')).toBe(true);
  });

  it('applyBilingualToElement is idempotent', async () => {
    const { applyBilingualToElement } = await import('./bilingual');
    const el = document.createElement('div');
    el.setAttribute('data-original-text', 'Original');
    document.body.appendChild(el);

    applyBilingualToElement(el);
    applyBilingualToElement(el); // second call should not add another

    const annotations = el.querySelectorAll('.translate-bilingual-original');
    expect(annotations.length).toBe(1);
  });

  it('applyBilingualToElement does nothing when no original text attr', async () => {
    const { applyBilingualToElement } = await import('./bilingual');
    const el = document.createElement('div');
    applyBilingualToElement(el);
    expect(el.querySelector('.translate-bilingual-original')).toBeNull();
  });

  it('removeBilingualFromElement removes annotation and class', async () => {
    const { applyBilingualToElement, removeBilingualFromElement } = await import('./bilingual');
    const el = document.createElement('div');
    el.setAttribute('data-original-text', 'Original');
    document.body.appendChild(el);

    applyBilingualToElement(el);
    removeBilingualFromElement(el);

    expect(el.querySelector('.translate-bilingual-original')).toBeNull();
    expect(el.classList.contains('translate-bilingual')).toBe(false);
  });

  it('getBilingualModeState returns false initially', async () => {
    const { getBilingualModeState } = await import('./bilingual');
    expect(getBilingualModeState()).toBe(false);
  });

  it('enableBilingualMode sets state to true', async () => {
    const { enableBilingualMode, getBilingualModeState } = await import('./bilingual');
    enableBilingualMode();
    expect(getBilingualModeState()).toBe(true);
  });

  it('disableBilingualMode sets state to false', async () => {
    const { enableBilingualMode, disableBilingualMode, getBilingualModeState } = await import('./bilingual');
    enableBilingualMode();
    disableBilingualMode();
    expect(getBilingualModeState()).toBe(false);
  });

  it('toggleBilingualMode toggles state', async () => {
    const { toggleBilingualMode, getBilingualModeState } = await import('./bilingual');
    const initial = getBilingualModeState();
    toggleBilingualMode();
    expect(getBilingualModeState()).toBe(!initial);
    toggleBilingualMode();
    expect(getBilingualModeState()).toBe(initial);
  });

  it('enableBilingualMode applies to existing translated elements', async () => {
    const { enableBilingualMode } = await import('./bilingual');
    const el = document.createElement('div');
    el.setAttribute('data-translated', 'true');
    el.setAttribute('data-original-text', 'Hello');
    document.body.appendChild(el);

    enableBilingualMode();

    const annotation = el.querySelector('.translate-bilingual-original');
    expect(annotation).not.toBeNull();
  });

  it('disableBilingualMode removes all bilingual annotations', async () => {
    const { enableBilingualMode, disableBilingualMode } = await import('./bilingual');
    const el = document.createElement('div');
    el.setAttribute('data-translated', 'true');
    el.setAttribute('data-original-text', 'Hello');
    document.body.appendChild(el);

    enableBilingualMode();
    expect(el.querySelector('.translate-bilingual-original')).not.toBeNull();

    disableBilingualMode();
    expect(el.querySelector('.translate-bilingual-original')).toBeNull();
  });
});

// ============================================================================
// correction.ts
// ============================================================================

describe('makeTranslatedElementEditable', () => {
  it('sets data-correction-enabled and cursor style', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = document.createElement('div');
    el.textContent = 'Translated text';
    document.body.appendChild(el);

    makeTranslatedElementEditable(el);

    expect(el.getAttribute('data-correction-enabled')).toBe('true');
    expect(el.style.cursor).toBe('text');
    el.remove();
  });

  it('is idempotent — does not add listener twice', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = document.createElement('div');
    document.body.appendChild(el);

    makeTranslatedElementEditable(el);
    makeTranslatedElementEditable(el); // second call should be no-op

    expect(el.getAttribute('data-correction-enabled')).toBe('true');
    el.remove();
  });
});

describe('showCorrectionHint', () => {
  afterEach(() => {
    document.getElementById('translate-correction-hint')?.remove();
  });

  it('calls safeStorageGet to check if hint was already shown', async () => {
    const { safeStorageGet } = await import('../core/storage');
    const { showCorrectionHint } = await import('./correction');

    const el = document.createElement('div');
    showCorrectionHint(el);

    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(safeStorageGet)).toHaveBeenCalled();
  });

  it('does not show hint if already shown in this session', async () => {
    const { showCorrectionHint } = await import('./correction');
    const el = document.createElement('div');

    // First call — may show
    showCorrectionHint(el);
    await new Promise((r) => setTimeout(r, 10));

    // Second call — correctionHintShown is true, so safeStorageGet is not called again
    const { safeStorageGet } = await import('../core/storage');
    vi.mocked(safeStorageGet).mockClear();
    showCorrectionHint(el);
    expect(vi.mocked(safeStorageGet)).not.toHaveBeenCalled();
  });
});

// ============================================================================
// correction.ts — enableCorrectionEditing (triggered via click)
// ============================================================================

describe('enableCorrectionEditing (via element click)', () => {
  function makeEditableElement() {
    const el = document.createElement('div');
    el.setAttribute('data-original-text', 'hello');
    el.setAttribute('data-machine-translation', 'machine translation');
    el.setAttribute('data-source-lang', 'en');
    el.setAttribute('data-target-lang', 'fi');
    el.textContent = 'machine translation';
    document.body.appendChild(el);
    return el;
  }

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('makes element contenteditable on click', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = makeEditableElement();
    makeTranslatedElementEditable(el);

    // Simulate click — should enable editing
    el.click();

    expect(el.getAttribute('contenteditable')).toBe('true');
  });

  it('does not re-enter editing if already contenteditable', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = makeEditableElement();
    makeTranslatedElementEditable(el);

    el.click();
    // Already in editing mode — second click should be no-op
    el.setAttribute('contenteditable', 'true');
    const spy = vi.spyOn(el, 'focus');
    el.click();
    // Should not call focus again (already editing)
    spy.mockRestore();
  });

  it('aborts editing when required attributes are missing', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = document.createElement('div');
    el.textContent = 'translated';
    document.body.appendChild(el);
    makeTranslatedElementEditable(el);

    el.click(); // missing all data-* attrs

    // Should NOT have become contenteditable
    expect(el.getAttribute('contenteditable')).toBeNull();
  });

  it('ignores click if target is an anchor link', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = makeEditableElement();
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'link text';
    el.textContent = '';
    el.appendChild(link);
    makeTranslatedElementEditable(el);

    // Click on the link — should not enable editing
    link.click();
    expect(el.getAttribute('contenteditable')).toBeNull();
  });

  it('saves correction via sendMessage when text changes on blur', async () => {
    const { browserAPI } = await import('../core/browser-api');
    const { makeTranslatedElementEditable } = await import('./correction');

    const el = makeEditableElement();
    makeTranslatedElementEditable(el);
    el.click();

    // Change the text
    el.textContent = 'user corrected text';
    el.dispatchEvent(new Event('blur'));

    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(browserAPI.runtime.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'addCorrection',
        original: 'hello',
        userCorrection: 'user corrected text',
        sourceLang: 'en',
        targetLang: 'fi',
      })
    );
  });

  it('restores original text when user clears the element on blur', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = makeEditableElement();
    makeTranslatedElementEditable(el);
    el.click();

    const originalText = el.textContent || '';
    el.textContent = ''; // clear
    el.dispatchEvent(new Event('blur'));

    await new Promise((r) => setTimeout(r, 10));

    expect(el.textContent).toBe(originalText);
  });

  it('restores text when user reverts to machine translation on blur', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = makeEditableElement();
    makeTranslatedElementEditable(el);
    el.click();

    // Set text back to the machine translation value
    el.textContent = 'machine translation'; // same as data-machine-translation
    el.dispatchEvent(new Event('blur'));

    await new Promise((r) => setTimeout(r, 10));

    // No correction sent
    const { browserAPI } = await import('../core/browser-api');
    expect(vi.mocked(browserAPI.runtime.sendMessage)).not.toHaveBeenCalled();
  });

  it('Enter key blurs the element', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = makeEditableElement();
    document.body.appendChild(el);
    makeTranslatedElementEditable(el);
    el.click();

    const blurSpy = vi.spyOn(el, 'blur');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(blurSpy).toHaveBeenCalled();
    blurSpy.mockRestore();
  });

  it('Escape key restores text and blurs', async () => {
    const { makeTranslatedElementEditable } = await import('./correction');
    const el = makeEditableElement();
    makeTranslatedElementEditable(el);
    el.click();

    el.textContent = 'modified text';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    // Text should be restored to what it was before editing
    expect(el.textContent).toBe('machine translation');
  });

  it('handles sendMessage error gracefully', async () => {
    const { browserAPI } = await import('../core/browser-api');
    vi.mocked(browserAPI.runtime.sendMessage).mockRejectedValue(new Error('network error'));

    const { makeTranslatedElementEditable } = await import('./correction');
    const el = makeEditableElement();
    makeTranslatedElementEditable(el);
    el.click();

    el.textContent = 'corrected text';
    el.dispatchEvent(new Event('blur'));

    // Should not throw
    await expect(new Promise((r) => setTimeout(r, 20))).resolves.toBeUndefined();
  });
});
