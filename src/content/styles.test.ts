/**
 * Tests for src/content/styles.ts
 *
 * Tests that injectContentStyles appends a style element to document.head.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { injectContentStyles } from './styles';

describe('injectContentStyles', () => {
  beforeEach(() => {
    // Remove any previously injected style tags to isolate tests
    document.head.querySelectorAll('style').forEach((el) => el.remove());
  });

  it('appends a <style> element to document.head', () => {
    injectContentStyles();
    const styles = document.head.querySelectorAll('style');
    expect(styles.length).toBeGreaterThan(0);
  });

  it('injected style contains keyframe animation names', () => {
    injectContentStyles();
    const style = document.head.querySelector('style');
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain('translateFadeIn');
    expect(style!.textContent).toContain('hoverFadeIn');
  });

  it('injected style contains bilingual class', () => {
    injectContentStyles();
    const style = document.head.querySelector('style');
    expect(style!.textContent).toContain('translate-bilingual');
  });

  it('injected style contains image overlay class', () => {
    injectContentStyles();
    const style = document.head.querySelector('style');
    expect(style!.textContent).toContain('translate-image-overlay');
  });

  it('injected style contains hover spinner class', () => {
    injectContentStyles();
    const style = document.head.querySelector('style');
    expect(style!.textContent).toContain('hover-spinner');
  });

  it('can be called multiple times without throwing', () => {
    expect(() => {
      injectContentStyles();
      injectContentStyles();
    }).not.toThrow();
  });
});
