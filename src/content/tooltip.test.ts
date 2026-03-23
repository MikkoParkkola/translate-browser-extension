/**
 * Tests for src/content/tooltip.ts
 *
 * All functions manipulate the jsdom DOM directly — no browser-specific APIs needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { showTranslationTooltip, showErrorTooltip, removeTooltip } from './tooltip';

// ============================================================================
// Helpers
// ============================================================================

function makeRange(rect: Partial<DOMRect> = {}): Range {
  const range = document.createRange();
  // Override getBoundingClientRect
  range.getBoundingClientRect = () => ({
    top: 0,
    bottom: 100,
    left: 50,
    right: 200,
    width: 150,
    height: 100,
    x: 50,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  });
  return range;
}

// ============================================================================
// removeTooltip
// ============================================================================

describe('removeTooltip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('removes existing tooltip', () => {
    const div = document.createElement('div');
    div.id = 'translate-tooltip';
    document.body.appendChild(div);

    removeTooltip();

    expect(document.getElementById('translate-tooltip')).toBeNull();
  });

  it('does nothing when no tooltip exists', () => {
    expect(() => removeTooltip()).not.toThrow();
  });
});

// ============================================================================
// showTranslationTooltip
// ============================================================================

describe('showTranslationTooltip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom defaults
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a tooltip with the given text', () => {
    const range = makeRange({ bottom: 100, left: 50 });
    showTranslationTooltip('Hello world', range);

    const tooltip = document.getElementById('translate-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain('Hello world');
  });

  it('adds a close button', () => {
    const range = makeRange();
    showTranslationTooltip('test', range);

    const btn = document.querySelector('#translate-tooltip button');
    expect(btn).not.toBeNull();
  });

  it('close button removes tooltip', () => {
    const range = makeRange();
    showTranslationTooltip('test', range);

    const btn = document.querySelector('#translate-tooltip button') as HTMLButtonElement;
    btn.click();

    expect(document.getElementById('translate-tooltip')).toBeNull();
  });

  it('removes previous tooltip before showing new one', () => {
    const range = makeRange();
    showTranslationTooltip('first', range);
    showTranslationTooltip('second', range);

    const tooltips = document.querySelectorAll('#translate-tooltip');
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0].textContent).toContain('second');
  });

  it('tooltip element exists with translate-tooltip id', () => {
    const range = makeRange({ bottom: 50, left: 100 });
    showTranslationTooltip('test', range);

    const tooltip = document.getElementById('translate-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.id).toBe('translate-tooltip');
  });

  it('positions with extreme values without throwing', () => {
    const range = makeRange({ bottom: 9999, left: -500 });
    expect(() => showTranslationTooltip('test', range)).not.toThrow();
    const tooltip = document.getElementById('translate-tooltip');
    expect(tooltip).not.toBeNull();
  });

  it('auto-removes after 10 seconds', () => {
    vi.useFakeTimers();
    const range = makeRange();
    showTranslationTooltip('test', range);

    expect(document.getElementById('translate-tooltip')).not.toBeNull();
    vi.advanceTimersByTime(10001);
    expect(document.getElementById('translate-tooltip')).toBeNull();
  });

  it('streaming=true updates text in-place without recreating the tooltip', () => {
    const range = makeRange();
    showTranslationTooltip('partial', range);
    const first = document.getElementById('translate-tooltip');
    expect(first).not.toBeNull();

    showTranslationTooltip('updated', range, true);
    const second = document.getElementById('translate-tooltip');

    // Same DOM node — not recreated
    expect(second).toBe(first);
    expect(second!.textContent).toContain('updated');
  });

  it('streaming=true creates a new tooltip if none exists', () => {
    const range = makeRange();
    showTranslationTooltip('hello', range, true);
    const tooltip = document.getElementById('translate-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain('hello');
  });

  it('streaming=false replaces existing tooltip', () => {
    const range = makeRange();
    showTranslationTooltip('first', range);
    showTranslationTooltip('second', range, false);
    expect(document.querySelectorAll('#translate-tooltip')).toHaveLength(1);
    expect(document.getElementById('translate-tooltip')!.textContent).toContain('second');
  });
});

// ============================================================================
// showErrorTooltip
// ============================================================================

describe('showErrorTooltip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an error tooltip with the message', () => {
    const range = makeRange({ bottom: 100, left: 50 });
    showErrorTooltip('Something went wrong', range);

    const tooltip = document.getElementById('translate-tooltip');
    expect(tooltip).not.toBeNull();
    // textContent includes button text; check for message
    expect(tooltip!.textContent).toContain('Something went wrong');
  });

  it('creates tooltip element with correct id', () => {
    const range = makeRange();
    showErrorTooltip('error', range);

    const tooltip = document.getElementById('translate-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.id).toBe('translate-tooltip');
  });

  it('adds a close button that removes tooltip', () => {
    const range = makeRange();
    showErrorTooltip('error', range);

    const btn = document.querySelector('#translate-tooltip button') as HTMLButtonElement;
    btn.click();

    expect(document.getElementById('translate-tooltip')).toBeNull();
  });

  it('removes previous tooltip before showing error', () => {
    const range = makeRange();
    showErrorTooltip('first', range);
    showErrorTooltip('second', range);

    expect(document.querySelectorAll('#translate-tooltip')).toHaveLength(1);
  });

  it('auto-removes after 5 seconds', () => {
    vi.useFakeTimers();
    const range = makeRange();
    showErrorTooltip('error', range);

    expect(document.getElementById('translate-tooltip')).not.toBeNull();
    vi.advanceTimersByTime(5001);
    expect(document.getElementById('translate-tooltip')).toBeNull();
  });

  it('positions error tooltip without throwing on extreme rect values', () => {
    const range = makeRange({ bottom: 9999, left: -100 });
    expect(() => showErrorTooltip('error', range)).not.toThrow();
    expect(document.getElementById('translate-tooltip')).not.toBeNull();
  });
});
