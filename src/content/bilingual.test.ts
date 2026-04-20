/**
 * Tests for src/content/bilingual.ts
 *
 * Tests applyBilingualToElement, removeBilingualFromElement,
 * enableBilingualMode, disableBilingualMode, toggleBilingualMode,
 * and getBilingualModeState.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLoggerModuleMock } from '../test-helpers/module-mocks';

// Mock logger
vi.mock('../core/logger', () => createLoggerModuleMock());

// Mock toast
vi.mock('./toast', () => ({
  showInfoToast: vi.fn(),
}));

// Mock content-types
vi.mock('./content-types', () => ({
  TRANSLATED_ATTR: 'data-translated',
  ORIGINAL_TEXT_ATTR: 'data-original-text',
  MACHINE_TRANSLATION_ATTR: 'data-machine-translation',
  SOURCE_LANG_ATTR: 'data-source-lang',
  TARGET_LANG_ATTR: 'data-target-lang',
  SKIP_TAGS: new Set(['SCRIPT', 'STYLE']),
}));

import {
  applyBilingualToElement,
  removeBilingualFromElement,
  enableBilingualMode,
  disableBilingualMode,
  toggleBilingualMode,
  getBilingualModeState,
} from './bilingual';

/** Helper: create a translated element with original-text attribute */
function makeTranslatedEl(originalText = 'Hello world'): HTMLElement {
  const el = document.createElement('p');
  el.setAttribute('data-translated', 'true');
  el.setAttribute('data-original-text', originalText);
  el.textContent = 'Translated text';
  document.body.appendChild(el);
  return el;
}

describe('bilingual', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    // Reset bilingual mode to disabled between tests
    disableBilingualMode();
  });

  // =========================================================================
  // applyBilingualToElement
  // =========================================================================

  describe('applyBilingualToElement', () => {
    it('adds .translate-bilingual-original annotation span', () => {
      const el = makeTranslatedEl('Hello world');
      applyBilingualToElement(el);
      const annotation = el.querySelector('.translate-bilingual-original');
      expect(annotation).not.toBeNull();
      expect(annotation!.textContent).toBe('Hello world');
    });

    it('adds translate-bilingual class to element', () => {
      const el = makeTranslatedEl('Hello');
      applyBilingualToElement(el);
      expect(el.classList.contains('translate-bilingual')).toBe(true);
    });

    it('sets aria-hidden on annotation', () => {
      const el = makeTranslatedEl('Hello');
      applyBilingualToElement(el);
      const annotation = el.querySelector('.translate-bilingual-original');
      expect(annotation!.getAttribute('aria-hidden')).toBe('true');
    });

    it('does nothing when element has no data-original-text', () => {
      const el = document.createElement('p');
      el.textContent = 'No attribute';
      document.body.appendChild(el);
      applyBilingualToElement(el);
      expect(el.querySelector('.translate-bilingual-original')).toBeNull();
    });

    it('is idempotent — does not add duplicate annotations', () => {
      const el = makeTranslatedEl('Hello');
      applyBilingualToElement(el);
      applyBilingualToElement(el);
      const annotations = el.querySelectorAll('.translate-bilingual-original');
      expect(annotations.length).toBe(1);
    });
  });

  // =========================================================================
  // removeBilingualFromElement
  // =========================================================================

  describe('removeBilingualFromElement', () => {
    it('removes annotation span', () => {
      const el = makeTranslatedEl('Hello');
      applyBilingualToElement(el);
      removeBilingualFromElement(el);
      expect(el.querySelector('.translate-bilingual-original')).toBeNull();
    });

    it('removes translate-bilingual class', () => {
      const el = makeTranslatedEl('Hello');
      applyBilingualToElement(el);
      removeBilingualFromElement(el);
      expect(el.classList.contains('translate-bilingual')).toBe(false);
    });

    it('does not throw when element has no annotation', () => {
      const el = makeTranslatedEl('Hello');
      expect(() => removeBilingualFromElement(el)).not.toThrow();
    });
  });

  // =========================================================================
  // enableBilingualMode
  // =========================================================================

  describe('enableBilingualMode', () => {
    it('applies bilingual annotation to all translated elements', () => {
      const el1 = makeTranslatedEl('One');
      const el2 = makeTranslatedEl('Two');

      enableBilingualMode();

      expect(el1.querySelector('.translate-bilingual-original')).not.toBeNull();
      expect(el2.querySelector('.translate-bilingual-original')).not.toBeNull();
    });

    it('sets getBilingualModeState to true', () => {
      enableBilingualMode();
      expect(getBilingualModeState()).toBe(true);
    });
  });

  // =========================================================================
  // disableBilingualMode
  // =========================================================================

  describe('disableBilingualMode', () => {
    it('removes bilingual annotations from all elements', () => {
      const el1 = makeTranslatedEl('One');
      const el2 = makeTranslatedEl('Two');
      enableBilingualMode();
      disableBilingualMode();

      expect(el1.querySelector('.translate-bilingual-original')).toBeNull();
      expect(el2.querySelector('.translate-bilingual-original')).toBeNull();
    });

    it('sets getBilingualModeState to false', () => {
      enableBilingualMode();
      disableBilingualMode();
      expect(getBilingualModeState()).toBe(false);
    });
  });

  // =========================================================================
  // toggleBilingualMode
  // =========================================================================

  describe('toggleBilingualMode', () => {
    it('enables mode when currently disabled', () => {
      // Mode starts disabled (set in beforeEach)
      toggleBilingualMode();
      expect(getBilingualModeState()).toBe(true);
    });

    it('disables mode when currently enabled', () => {
      enableBilingualMode();
      toggleBilingualMode();
      expect(getBilingualModeState()).toBe(false);
    });

    it('returns new mode state', () => {
      // starts disabled
      const result1 = toggleBilingualMode();
      expect(result1).toBe(true);
      const result2 = toggleBilingualMode();
      expect(result2).toBe(false);
    });
  });

  // =========================================================================
  // getBilingualModeState
  // =========================================================================

  describe('getBilingualModeState', () => {
    it('returns false initially (after disable)', () => {
      expect(getBilingualModeState()).toBe(false);
    });

    it('returns true after enableBilingualMode', () => {
      enableBilingualMode();
      expect(getBilingualModeState()).toBe(true);
    });
  });
});
