/**
 * Screenshot OCR Translation unit tests
 *
 * Tests screenshot mode state management, selection rectangle calculation,
 * minimum selection guard, result tooltip creation, and crop image logic.
 *
 * Since enterScreenshotMode/exitScreenshotMode and related functions are
 * module-internal (not exported), we replicate and test the pure logic
 * following the established pattern in offscreen.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Selection Rectangle Calculation (from onScreenshotMouseMove/MouseUp)
// ============================================================================

describe('Screenshot Selection Rectangle', () => {
  /**
   * Replicates the rectangle calculation from onScreenshotMouseMove and
   * onScreenshotMouseUp in content/index.ts.
   * Handles drag in any direction (top-left to bottom-right, or vice versa).
   */
  function calculateSelectionRect(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): { x: number; y: number; width: number; height: number } {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }

  describe('drag direction handling', () => {
    it('handles top-left to bottom-right drag', () => {
      const rect = calculateSelectionRect({ x: 100, y: 100 }, { x: 300, y: 200 });
      expect(rect).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    });

    it('handles bottom-right to top-left drag', () => {
      const rect = calculateSelectionRect({ x: 300, y: 200 }, { x: 100, y: 100 });
      expect(rect).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    });

    it('handles top-right to bottom-left drag', () => {
      const rect = calculateSelectionRect({ x: 300, y: 100 }, { x: 100, y: 200 });
      expect(rect).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    });

    it('handles bottom-left to top-right drag', () => {
      const rect = calculateSelectionRect({ x: 100, y: 200 }, { x: 300, y: 100 });
      expect(rect).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    });
  });

  describe('edge cases', () => {
    it('handles zero-size selection (click without drag)', () => {
      const rect = calculateSelectionRect({ x: 150, y: 150 }, { x: 150, y: 150 });
      expect(rect).toEqual({ x: 150, y: 150, width: 0, height: 0 });
    });

    it('handles horizontal-only drag', () => {
      const rect = calculateSelectionRect({ x: 100, y: 150 }, { x: 300, y: 150 });
      expect(rect).toEqual({ x: 100, y: 150, width: 200, height: 0 });
    });

    it('handles vertical-only drag', () => {
      const rect = calculateSelectionRect({ x: 150, y: 100 }, { x: 150, y: 300 });
      expect(rect).toEqual({ x: 150, y: 100, width: 0, height: 200 });
    });

    it('handles coordinates at origin', () => {
      const rect = calculateSelectionRect({ x: 0, y: 0 }, { x: 50, y: 50 });
      expect(rect).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    });

    it('handles large coordinates', () => {
      const rect = calculateSelectionRect({ x: 1920, y: 1080 }, { x: 0, y: 0 });
      expect(rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    });
  });

  describe('minimum selection size guard', () => {
    /**
     * Replicates the minimum size check from onScreenshotMouseUp:
     * if (rect.width < 20 || rect.height < 20) return;
     */
    function isSelectionLargeEnough(rect: { width: number; height: number }): boolean {
      return rect.width >= 20 && rect.height >= 20;
    }

    it('rejects selection smaller than 20px width', () => {
      expect(isSelectionLargeEnough({ width: 19, height: 100 })).toBe(false);
    });

    it('rejects selection smaller than 20px height', () => {
      expect(isSelectionLargeEnough({ width: 100, height: 19 })).toBe(false);
    });

    it('rejects selection smaller than 20px in both dimensions', () => {
      expect(isSelectionLargeEnough({ width: 10, height: 10 })).toBe(false);
    });

    it('accepts selection exactly 20px', () => {
      expect(isSelectionLargeEnough({ width: 20, height: 20 })).toBe(true);
    });

    it('accepts large selection', () => {
      expect(isSelectionLargeEnough({ width: 500, height: 300 })).toBe(true);
    });

    it('rejects zero-size selection', () => {
      expect(isSelectionLargeEnough({ width: 0, height: 0 })).toBe(false);
    });
  });
});

// ============================================================================
// Screenshot Mode State Management
// ============================================================================

describe('Screenshot Mode State Management', () => {
  /**
   * Replicates the state management from enterScreenshotMode/exitScreenshotMode.
   */
  interface ScreenshotState {
    screenshotMode: boolean;
    selectionOverlay: HTMLDivElement | null;
    selectionStart: { x: number; y: number } | null;
  }

  function createState(): ScreenshotState {
    return {
      screenshotMode: false,
      selectionOverlay: null,
      selectionStart: null,
    };
  }

  function enterMode(state: ScreenshotState): ScreenshotState {
    if (state.screenshotMode) return state;
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      border: '2px dashed #4A90D9',
      backgroundColor: 'rgba(74, 144, 217, 0.1)',
      zIndex: '2147483646',
      display: 'none',
      pointerEvents: 'none',
    });
    document.body.appendChild(overlay);

    return {
      screenshotMode: true,
      selectionOverlay: overlay,
      selectionStart: null,
    };
  }

  function exitMode(state: ScreenshotState): ScreenshotState {
    if (state.selectionOverlay) {
      state.selectionOverlay.remove();
    }
    return {
      screenshotMode: false,
      selectionOverlay: null,
      selectionStart: null,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts in non-screenshot mode', () => {
    const state = createState();
    expect(state.screenshotMode).toBe(false);
    expect(state.selectionOverlay).toBeNull();
    expect(state.selectionStart).toBeNull();
  });

  it('enters screenshot mode and creates overlay', () => {
    const state = enterMode(createState());
    expect(state.screenshotMode).toBe(true);
    expect(state.selectionOverlay).not.toBeNull();
    expect(state.selectionOverlay?.style.position).toBe('fixed');
    expect(state.selectionOverlay?.style.display).toBe('none');
  });

  it('overlay starts hidden', () => {
    const state = enterMode(createState());
    expect(state.selectionOverlay?.style.display).toBe('none');
  });

  it('overlay has correct visual properties', () => {
    const state = enterMode(createState());
    // jsdom converts hex colors to rgb format
    expect(state.selectionOverlay?.style.border).toMatch(/2px dashed/);
    expect(state.selectionOverlay?.style.zIndex).toBe('2147483646');
    expect(state.selectionOverlay?.style.pointerEvents).toBe('none');
  });

  it('does not re-enter if already in screenshot mode', () => {
    const state1 = enterMode(createState());
    const state2 = enterMode(state1);
    // Should return the same state reference (no-op)
    expect(state2).toBe(state1);
  });

  it('exits screenshot mode and removes overlay', () => {
    const state1 = enterMode(createState());
    expect(document.body.children.length).toBe(1); // overlay appended

    const state2 = exitMode(state1);
    expect(state2.screenshotMode).toBe(false);
    expect(state2.selectionOverlay).toBeNull();
    expect(state2.selectionStart).toBeNull();
    expect(document.body.children.length).toBe(0); // overlay removed
  });

  it('exit is safe when no overlay exists', () => {
    const state = createState();
    expect(() => exitMode(state)).not.toThrow();
  });

  it('clears selection start on exit', () => {
    let state = enterMode(createState());
    state.selectionStart = { x: 100, y: 200 };
    state = exitMode(state);
    expect(state.selectionStart).toBeNull();
  });
});

// ============================================================================
// Screenshot Result Tooltip
// ============================================================================

describe('Screenshot Result Tooltip', () => {
  /**
   * Replicates showScreenshotResult from content/index.ts.
   */
  function showScreenshotResult(
    translation: string,
    original: string,
    rect: { x: number; y: number; width: number; height: number }
  ): HTMLDivElement {
    const tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
      position: 'fixed',
      left: `${rect.x}px`,
      top: `${rect.y + rect.height + 8}px`,
      maxWidth: `${Math.max(rect.width, 300)}px`,
      padding: '12px 16px',
      backgroundColor: 'rgba(30, 30, 30, 0.95)',
      backdropFilter: 'blur(12px)',
      color: '#fff',
      borderRadius: '8px',
      fontSize: '14px',
      lineHeight: '1.5',
      zIndex: '2147483647',
      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.1)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const originalEl = document.createElement('div');
    originalEl.textContent = original;
    Object.assign(originalEl.style, {
      color: 'rgba(255,255,255,0.5)',
      fontSize: '12px',
      marginBottom: '8px',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      paddingBottom: '8px',
    });

    const translationEl = document.createElement('div');
    translationEl.textContent = translation;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00D7';
    closeBtn.onclick = () => tooltip.remove();

    tooltip.appendChild(closeBtn);
    tooltip.appendChild(originalEl);
    tooltip.appendChild(translationEl);
    document.body.appendChild(tooltip);

    return tooltip;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates tooltip with translation and original text', () => {
    const tooltip = showScreenshotResult('Hei maailma', 'Hello world', {
      x: 100, y: 100, width: 400, height: 50,
    });

    expect(tooltip.textContent).toContain('Hei maailma');
    expect(tooltip.textContent).toContain('Hello world');
  });

  it('positions tooltip below the selection rectangle', () => {
    const tooltip = showScreenshotResult('Test', 'Original', {
      x: 50, y: 200, width: 300, height: 100,
    });

    expect(tooltip.style.left).toBe('50px');
    expect(tooltip.style.top).toBe('308px'); // 200 + 100 + 8
  });

  it('uses minimum width of 300px for narrow selections', () => {
    const tooltip = showScreenshotResult('Test', 'Original', {
      x: 50, y: 50, width: 100, height: 50,
    });

    expect(tooltip.style.maxWidth).toBe('300px');
  });

  it('uses selection width when wider than 300px', () => {
    const tooltip = showScreenshotResult('Test', 'Original', {
      x: 50, y: 50, width: 500, height: 50,
    });

    expect(tooltip.style.maxWidth).toBe('500px');
  });

  it('has close button that removes tooltip', () => {
    const tooltip = showScreenshotResult('Test', 'Original', {
      x: 0, y: 0, width: 300, height: 50,
    });

    const closeBtn = tooltip.querySelector('button');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.textContent).toBe('\u00D7');

    closeBtn?.click();
    expect(document.body.contains(tooltip)).toBe(false);
  });

  it('has correct z-index for maximum overlay priority', () => {
    const tooltip = showScreenshotResult('Test', 'Original', {
      x: 0, y: 0, width: 300, height: 50,
    });

    expect(tooltip.style.zIndex).toBe('2147483647');
  });

  it('shows original text with subdued styling', () => {
    const tooltip = showScreenshotResult('Kaannetty', 'Original text', {
      x: 0, y: 0, width: 300, height: 50,
    });

    const divs = tooltip.querySelectorAll('div');
    // First div is original, second is translation
    expect(divs[0].textContent).toBe('Original text');
    expect(divs[0].style.fontSize).toBe('12px');
    expect(divs[1].textContent).toBe('Kaannetty');
  });

  describe('auto-dismiss', () => {
    it('tooltip is appended to document body', () => {
      showScreenshotResult('Test', 'Original', {
        x: 0, y: 0, width: 300, height: 50,
      });

      expect(document.body.children.length).toBe(1);
    });
  });
});

// ============================================================================
// Crop Image Canvas Logic
// ============================================================================

describe('Crop Image Logic', () => {
  /**
   * Replicates the cropImage handler from offscreen.ts.
   * Tests the canvas dimension calculation with devicePixelRatio.
   */

  interface CropParams {
    rect: { x: number; y: number; width: number; height: number };
    devicePixelRatio: number;
  }

  function calculateCropDimensions(params: CropParams): {
    canvasWidth: number;
    canvasHeight: number;
    srcX: number;
    srcY: number;
    srcWidth: number;
    srcHeight: number;
  } {
    const dpr = params.devicePixelRatio;
    return {
      canvasWidth: params.rect.width * dpr,
      canvasHeight: params.rect.height * dpr,
      srcX: params.rect.x * dpr,
      srcY: params.rect.y * dpr,
      srcWidth: params.rect.width * dpr,
      srcHeight: params.rect.height * dpr,
    };
  }

  describe('with devicePixelRatio = 1', () => {
    it('canvas dimensions match rect dimensions', () => {
      const result = calculateCropDimensions({
        rect: { x: 100, y: 50, width: 400, height: 200 },
        devicePixelRatio: 1,
      });

      expect(result.canvasWidth).toBe(400);
      expect(result.canvasHeight).toBe(200);
      expect(result.srcX).toBe(100);
      expect(result.srcY).toBe(50);
      expect(result.srcWidth).toBe(400);
      expect(result.srcHeight).toBe(200);
    });
  });

  describe('with devicePixelRatio = 2 (Retina)', () => {
    it('doubles all dimensions for Retina displays', () => {
      const result = calculateCropDimensions({
        rect: { x: 100, y: 50, width: 400, height: 200 },
        devicePixelRatio: 2,
      });

      expect(result.canvasWidth).toBe(800);
      expect(result.canvasHeight).toBe(400);
      expect(result.srcX).toBe(200);
      expect(result.srcY).toBe(100);
      expect(result.srcWidth).toBe(800);
      expect(result.srcHeight).toBe(400);
    });
  });

  describe('with devicePixelRatio = 3', () => {
    it('triples all dimensions for 3x displays', () => {
      const result = calculateCropDimensions({
        rect: { x: 50, y: 25, width: 200, height: 100 },
        devicePixelRatio: 3,
      });

      expect(result.canvasWidth).toBe(600);
      expect(result.canvasHeight).toBe(300);
      expect(result.srcX).toBe(150);
      expect(result.srcY).toBe(75);
    });
  });

  describe('with fractional devicePixelRatio', () => {
    it('handles 1.5x scaling', () => {
      const result = calculateCropDimensions({
        rect: { x: 100, y: 100, width: 200, height: 200 },
        devicePixelRatio: 1.5,
      });

      expect(result.canvasWidth).toBe(300);
      expect(result.canvasHeight).toBe(300);
      expect(result.srcX).toBe(150);
      expect(result.srcY).toBe(150);
    });
  });

  describe('edge cases', () => {
    it('handles rect at origin', () => {
      const result = calculateCropDimensions({
        rect: { x: 0, y: 0, width: 100, height: 100 },
        devicePixelRatio: 2,
      });

      expect(result.srcX).toBe(0);
      expect(result.srcY).toBe(0);
      expect(result.canvasWidth).toBe(200);
      expect(result.canvasHeight).toBe(200);
    });

    it('handles very small rect', () => {
      const result = calculateCropDimensions({
        rect: { x: 10, y: 10, width: 20, height: 20 },
        devicePixelRatio: 2,
      });

      expect(result.canvasWidth).toBe(40);
      expect(result.canvasHeight).toBe(40);
    });
  });
});
