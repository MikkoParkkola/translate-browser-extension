/**
 * Tests for src/content/toast.ts
 *
 * Tests showInfoToast, showProgressToast, updateProgressToast,
 * removeProgressToast, and showErrorToast.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  showInfoToast,
  showProgressToast,
  updateProgressToast,
  removeProgressToast,
  showErrorToast,
} from './toast';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  // =========================================================================
  // showInfoToast
  // =========================================================================

  describe('showInfoToast', () => {
    it('appends a toast element to document.body', () => {
      showInfoToast('Hello!');
      const toast = document.getElementById('translate-ext-toast');
      expect(toast).not.toBeNull();
      expect(toast!.textContent).toBe('Hello!');
    });

    it('removes existing toast before adding new one', () => {
      showInfoToast('First');
      showInfoToast('Second');
      const toasts = document.querySelectorAll('#translate-ext-toast');
      expect(toasts.length).toBe(1);
      expect(toasts[0].textContent).toBe('Second');
    });

    it('auto-removes toast after durationMs + 250ms', () => {
      showInfoToast('Auto remove', 100);
      expect(document.getElementById('translate-ext-toast')).not.toBeNull();

      vi.advanceTimersByTime(100); // trigger fade-out
      vi.advanceTimersByTime(250); // trigger remove
      expect(document.getElementById('translate-ext-toast')).toBeNull();
    });

    it('uses 3000ms default duration', () => {
      showInfoToast('Default duration');
      vi.advanceTimersByTime(3000);
      vi.advanceTimersByTime(250);
      expect(document.getElementById('translate-ext-toast')).toBeNull();
    });

    it('toast is positioned fixed', () => {
      showInfoToast('position test');
      const toast = document.getElementById('translate-ext-toast')!;
      expect(toast.style.position).toBe('fixed');
    });

    it('does not remove existing toast if it is the active progress toast', () => {
      const progressToast = showProgressToast('Loading...');
      // Reassign the progress toast's id so getElementById('translate-ext-toast') finds it
      progressToast.id = 'translate-ext-toast';

      showInfoToast('New info');

      // The progress toast element should still be in the DOM (guarded by the !== check)
      expect(document.body.contains(progressToast)).toBe(true);
    });
  });

  // =========================================================================
  // showProgressToast
  // =========================================================================

  describe('showProgressToast', () => {
    it('appends a progress toast to document.body', () => {
      showProgressToast('Loading...');
      const toast = document.getElementById('translate-ext-progress-toast');
      expect(toast).not.toBeNull();
    });

    it('returns the toast element', () => {
      const el = showProgressToast('Working...');
      expect(el).toBeInstanceOf(HTMLElement);
      expect(el.id).toBe('translate-ext-progress-toast');
    });

    it('contains the message text', () => {
      showProgressToast('Translating 5 texts');
      const toast = document.getElementById('translate-ext-progress-toast')!;
      const textEl = toast.querySelector('.translate-progress-text');
      expect(textEl).not.toBeNull();
      expect(textEl!.textContent).toBe('Translating 5 texts');
    });

    it('removes previous progress toast when called again', () => {
      showProgressToast('First');
      showProgressToast('Second');
      // The old one is fading out (opacity 0, not yet removed) and new one added.
      // After the 200ms fade timeout, the old one is removed.
      vi.advanceTimersByTime(200);
      const toasts = document.querySelectorAll('#translate-ext-progress-toast');
      expect(toasts.length).toBe(1);
    });
  });

  // =========================================================================
  // updateProgressToast
  // =========================================================================

  describe('updateProgressToast', () => {
    it('updates the text of the active progress toast', () => {
      showProgressToast('Initial');
      updateProgressToast('Updated message');
      const toast = document.getElementById('translate-ext-progress-toast')!;
      const textEl = toast.querySelector('.translate-progress-text');
      expect(textEl!.textContent).toBe('Updated message');
    });

    it('does not throw when no progress toast is active', () => {
      expect(() => updateProgressToast('No toast')).not.toThrow();
    });

    it('does nothing after toast is removed', () => {
      showProgressToast('Start');
      removeProgressToast();
      expect(() => updateProgressToast('After remove')).not.toThrow();
    });
  });

  // =========================================================================
  // removeProgressToast
  // =========================================================================

  describe('removeProgressToast', () => {
    it('does not throw when no progress toast exists', () => {
      expect(() => removeProgressToast()).not.toThrow();
    });

    it('sets opacity to 0 immediately', () => {
      const toast = showProgressToast('Removing...');
      removeProgressToast();
      expect(toast.style.opacity).toBe('0');
    });

    it('removes the toast element after 200ms', () => {
      showProgressToast('Remove me');
      removeProgressToast();
      expect(document.getElementById('translate-ext-progress-toast')).not.toBeNull();

      vi.advanceTimersByTime(200);
      // The element is removed by setTimeout
      expect(document.getElementById('translate-ext-progress-toast')).toBeNull();
    });

    it('also removes by DOM ID if reference was lost', () => {
      // Manually add an orphaned progress toast without going through showProgressToast
      const orphan = document.createElement('div');
      orphan.id = 'translate-ext-progress-toast';
      document.body.appendChild(orphan);

      // removeProgressToast should find it via getElementById
      removeProgressToast();
      vi.advanceTimersByTime(200);
      expect(document.getElementById('translate-ext-progress-toast')).toBeNull();
    });
  });

  // =========================================================================
  // showErrorToast
  // =========================================================================

  describe('showErrorToast', () => {
    it('appends an error toast to document.body', () => {
      showErrorToast('Something went wrong');
      const toast = document.getElementById('translate-ext-toast');
      expect(toast).not.toBeNull();
    });

    it('contains the error message', () => {
      showErrorToast('API key invalid');
      const toast = document.getElementById('translate-ext-toast')!;
      const msgSpan = toast.querySelector('span');
      expect(msgSpan!.textContent).toBe('API key invalid');
    });

    it('removes existing toast before adding error toast', () => {
      showInfoToast('Info');
      showErrorToast('Error');
      const toasts = document.querySelectorAll('#translate-ext-toast');
      expect(toasts.length).toBe(1);
    });

    it('auto-removes after durationMs + 250ms', () => {
      showErrorToast('Error', 100);
      vi.advanceTimersByTime(100);
      vi.advanceTimersByTime(250);
      expect(document.getElementById('translate-ext-toast')).toBeNull();
    });

    it('uses 6000ms default duration', () => {
      showErrorToast('Persistent error');
      vi.advanceTimersByTime(5999);
      expect(document.getElementById('translate-ext-toast')).not.toBeNull();
      vi.advanceTimersByTime(1);
      vi.advanceTimersByTime(250);
      expect(document.getElementById('translate-ext-toast')).toBeNull();
    });

    it('has an icon element', () => {
      showErrorToast('Error with icon');
      const toast = document.getElementById('translate-ext-toast')!;
      const svg = toast.querySelector('svg');
      expect(svg).not.toBeNull();
    });
  });
});

describe('updateProgressToast — line 132 branch (when textEl exists)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('updates text content of progress toast when element exists', () => {
    showProgressToast('Initial message');
    updateProgressToast('Updated message');

    const textEl = document.querySelector('.translate-progress-text');
    expect(textEl?.textContent).toBe('Updated message');
  });

  it('does nothing when textEl does not exist', () => {
    showProgressToast('Initial message');

    // Remove the text element
    const textEl = document.querySelector('.translate-progress-text');
    if (textEl) {
      textEl.remove();
    }

    // Should not throw
    expect(() => updateProgressToast('New message')).not.toThrow();
  });

  it('updates text multiple times', () => {
    showProgressToast('Start');
    updateProgressToast('Step 1');
    updateProgressToast('Step 2');
    updateProgressToast('Complete');

    const textEl = document.querySelector('.translate-progress-text');
    expect(textEl?.textContent).toBe('Complete');
  });
});
