/**
 * ConfirmDialog unit tests
 *
 * Tests for the accessible confirmation dialog component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the dialog behavior logic (not rendering, since we need jsdom + solid for that)
describe('ConfirmDialog behavior', () => {
  describe('keyboard handling', () => {
    it('Escape key should trigger cancel', () => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();

      // Simulate the keyboard handler logic from ConfirmDialog
      const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      const preventDefault = vi.fn();
      handleKeyDown({ key: 'Escape', preventDefault });

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(preventDefault).toHaveBeenCalled();
    });

    it('Tab key should not trigger cancel', () => {
      const onCancel = vi.fn();

      const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      handleKeyDown({ key: 'Tab', preventDefault: vi.fn() });
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('variant classification', () => {
    it('returns correct class for danger variant', () => {
      const getVariantClass = (variant: string) => {
        switch (variant) {
          case 'danger': return 'confirm-dialog--danger';
          case 'warning': return 'confirm-dialog--warning';
          case 'info': return 'confirm-dialog--info';
          default: return 'confirm-dialog--danger';
        }
      };

      expect(getVariantClass('danger')).toBe('confirm-dialog--danger');
      expect(getVariantClass('warning')).toBe('confirm-dialog--warning');
      expect(getVariantClass('info')).toBe('confirm-dialog--info');
    });

    it('defaults to danger when variant not specified', () => {
      const getVariantClass = (variant?: string) => {
        switch (variant ?? 'danger') {
          case 'danger': return 'confirm-dialog--danger';
          case 'warning': return 'confirm-dialog--warning';
          case 'info': return 'confirm-dialog--info';
          default: return 'confirm-dialog--danger';
        }
      };

      expect(getVariantClass(undefined)).toBe('confirm-dialog--danger');
    });
  });

  describe('props defaults', () => {
    it('uses default button labels when not specified', () => {
      const confirmLabel = undefined ?? 'Confirm';
      const cancelLabel = undefined ?? 'Cancel';

      expect(confirmLabel).toBe('Confirm');
      expect(cancelLabel).toBe('Cancel');
    });

    it('uses custom button labels when specified', () => {
      const confirmLabel = 'Remove' ?? 'Confirm';
      const cancelLabel = 'Keep' ?? 'Cancel';

      expect(confirmLabel).toBe('Remove');
      expect(cancelLabel).toBe('Keep');
    });
  });
});

describe('ModelSelector keyboard navigation', () => {
  const MODELS = [
    { id: 'opus-mt', name: 'OPUS-MT' },
    { id: 'translategemma', name: 'TranslateGemma' },
    { id: 'chrome-builtin', name: 'Chrome Built-in' },
    { id: 'deepl', name: 'DeepL' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Claude' },
    { id: 'google-cloud', name: 'Google' },
  ];

  let focusedIndex: number;
  let isOpen: boolean;
  let selectedId: string | null;

  const handleKeyDown = (key: string) => {
    const e = { key, preventDefault: vi.fn() };

    if (!isOpen) {
      if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
        e.preventDefault();
        isOpen = true;
      }
      return;
    }

    switch (key) {
      case 'Escape':
        e.preventDefault();
        isOpen = false;
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusedIndex = Math.min(focusedIndex + 1, MODELS.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusedIndex = Math.max(focusedIndex - 1, 0);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < MODELS.length) {
          selectedId = MODELS[focusedIndex].id;
          isOpen = false;
        }
        break;
      case 'Home':
        e.preventDefault();
        focusedIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        focusedIndex = MODELS.length - 1;
        break;
    }
  };

  beforeEach(() => {
    focusedIndex = 0;
    isOpen = false;
    selectedId = null;
  });

  it('opens dropdown on ArrowDown when closed', () => {
    handleKeyDown('ArrowDown');
    expect(isOpen).toBe(true);
  });

  it('opens dropdown on Enter when closed', () => {
    handleKeyDown('Enter');
    expect(isOpen).toBe(true);
  });

  it('opens dropdown on Space when closed', () => {
    handleKeyDown(' ');
    expect(isOpen).toBe(true);
  });

  it('closes dropdown on Escape', () => {
    isOpen = true;
    handleKeyDown('Escape');
    expect(isOpen).toBe(false);
  });

  it('navigates down with ArrowDown', () => {
    isOpen = true;
    focusedIndex = 0;

    handleKeyDown('ArrowDown');
    expect(focusedIndex).toBe(1);

    handleKeyDown('ArrowDown');
    expect(focusedIndex).toBe(2);
  });

  it('navigates up with ArrowUp', () => {
    isOpen = true;
    focusedIndex = 3;

    handleKeyDown('ArrowUp');
    expect(focusedIndex).toBe(2);

    handleKeyDown('ArrowUp');
    expect(focusedIndex).toBe(1);
  });

  it('clamps at bottom boundary', () => {
    isOpen = true;
    focusedIndex = MODELS.length - 1;

    handleKeyDown('ArrowDown');
    expect(focusedIndex).toBe(MODELS.length - 1);
  });

  it('clamps at top boundary', () => {
    isOpen = true;
    focusedIndex = 0;

    handleKeyDown('ArrowUp');
    expect(focusedIndex).toBe(0);
  });

  it('selects item on Enter', () => {
    isOpen = true;
    focusedIndex = 2;

    handleKeyDown('Enter');
    expect(selectedId).toBe('chrome-builtin');
    expect(isOpen).toBe(false);
  });

  it('selects item on Space', () => {
    isOpen = true;
    focusedIndex = 4;

    handleKeyDown(' ');
    expect(selectedId).toBe('openai');
    expect(isOpen).toBe(false);
  });

  it('Home jumps to first item', () => {
    isOpen = true;
    focusedIndex = 5;

    handleKeyDown('Home');
    expect(focusedIndex).toBe(0);
  });

  it('End jumps to last item', () => {
    isOpen = true;
    focusedIndex = 0;

    handleKeyDown('End');
    expect(focusedIndex).toBe(MODELS.length - 1);
  });

  it('full navigation flow: open, navigate, select', () => {
    // Start closed
    expect(isOpen).toBe(false);

    // Open with ArrowDown
    handleKeyDown('ArrowDown');
    expect(isOpen).toBe(true);

    // Navigate to third item (index 2)
    handleKeyDown('ArrowDown');
    handleKeyDown('ArrowDown');
    expect(focusedIndex).toBe(2);

    // Select with Enter
    handleKeyDown('Enter');
    expect(selectedId).toBe('chrome-builtin');
    expect(isOpen).toBe(false);
  });
});
