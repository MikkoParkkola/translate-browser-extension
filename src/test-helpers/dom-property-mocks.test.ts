import { describe, expect, it } from 'vitest';
import {
  createMockRange,
  createLoadedImage,
  injectLoadedImage,
  mockCaretRangeFromPoint,
  mockDocumentCreateRange,
  mockCanvasElement,
  mockPropertyValue,
  setupCaretRangeFromText,
  setupImageConstructorMock,
  setupNavigatorGpuMock,
  setupNavigatorMlMock,
  setupSelectionMock,
} from './dom-property-mocks';
import { cleanupGlobalFixtures } from './global-fixture-registry';

describe('dom-property-mocks', () => {
  it('restores original property descriptors after cleanup', () => {
    const target = {} as { value?: string };
    Object.defineProperty(target, 'value', {
      get: () => 'original',
      configurable: true,
      enumerable: false,
    });

    const before = Object.getOwnPropertyDescriptor(target, 'value');
    mockPropertyValue(target, 'value', 'mocked', { fixtureKey: 'test.property.value' });

    expect(target.value).toBe('mocked');

    cleanupGlobalFixtures();

    const after = Object.getOwnPropertyDescriptor(target, 'value');
    expect(after).toEqual(before);
    expect(target.value).toBe('original');
  });

  it('installs navigator GPU and ML properties with cleanup restoration', () => {
    const gpuBefore = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    const mlBefore = Object.getOwnPropertyDescriptor(navigator, 'ml');

    setupNavigatorGpuMock({ requestAdapter: async () => ({}) });
    setupNavigatorMlMock({ createContext: async () => ({}) });

    expect((navigator as Navigator & { gpu?: unknown }).gpu).toBeDefined();
    expect((navigator as Navigator & { ml?: unknown }).ml).toBeDefined();

    cleanupGlobalFixtures();

    expect(Object.getOwnPropertyDescriptor(navigator, 'gpu')).toEqual(gpuBefore);
    expect(Object.getOwnPropertyDescriptor(navigator, 'ml')).toEqual(mlBefore);
  });

  it('creates loaded images with stable dimensions and rects', () => {
    const image = createLoadedImage('https://example.com/test.png', {
      naturalWidth: 320,
      naturalHeight: 180,
      rect: { top: 12, left: 24 },
    });

    expect(image.complete).toBe(true);
    expect(image.naturalWidth).toBe(320);
    expect(image.naturalHeight).toBe(180);
    expect(image.getBoundingClientRect()).toMatchObject({
      top: 12,
      left: 24,
      width: 320,
      height: 180,
      right: 344,
      bottom: 192,
    });

    const appendedImage = injectLoadedImage('https://example.com/injected.png');
    expect(document.body.contains(appendedImage)).toBe(true);
  });

  it('mocks canvas creation and restores document.createElement on cleanup', () => {
    const originalCreateElement = document.createElement;
    const { defaultContext } = mockCanvasElement({
      width: 40,
      height: 20,
      toDataURL: 'data:image/png;base64,CANVAS',
    });

    const canvas = document.createElement('canvas');

    expect(canvas.getContext('2d')).toBe(defaultContext);
    expect(canvas.toDataURL()).toBe('data:image/png;base64,CANVAS');
    expect(canvas.width).toBe(40);
    expect(canvas.height).toBe(20);

    cleanupGlobalFixtures();

    expect(document.createElement).toBe(originalCreateElement);
  });

  it('mocks Image constructor load and error outcomes', async () => {
    setupImageConstructorMock({ outcome: 'load' });
    const loadedImage = new Image();
    const loadEvent = new Promise<Event>((resolve) => {
      loadedImage.onload = (event) => resolve(event ?? new Event('load'));
    });
    loadedImage.src = 'https://example.com/load.png';

    await expect(loadEvent).resolves.toBeInstanceOf(Event);

    cleanupGlobalFixtures();

    setupImageConstructorMock({ outcome: 'error' });
    const failedImage = new Image();
    const errorEvent = new Promise<Event>((resolve) => {
      failedImage.onerror = () => resolve(new Event('error'));
    });
    failedImage.src = 'https://example.com/fail.png';

    await expect(errorEvent).resolves.toBeInstanceOf(Event);
  });

  it('creates mock ranges with cleanup-safe getBoundingClientRect overrides', () => {
    const range = document.createRange();
    const originalDescriptor = Object.getOwnPropertyDescriptor(range, 'getBoundingClientRect');
    const textNode = document.createTextNode('range text');

    const { range: mockedRange } = createMockRange({
      startContainer: textNode,
      startOffset: 1,
      endContainer: textNode,
      endOffset: 4,
      rect: { top: 12, left: 34, width: 56, height: 18 },
    });

    expect(mockedRange.getBoundingClientRect()).toMatchObject({
      top: 12,
      left: 34,
      right: 90,
      bottom: 30,
      width: 56,
      height: 18,
    });

    cleanupGlobalFixtures();

    expect(Object.getOwnPropertyDescriptor(mockedRange, 'getBoundingClientRect')).toEqual(originalDescriptor);
  });

  it('mocks caretRangeFromPoint and prototype range rects via setupCaretRangeFromText', () => {
    const originalCaretDescriptor = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint');
    const originalRangeDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');

    const { range, textNode, host } = setupCaretRangeFromText('hover seam', {
      startOffset: 2,
      endOffset: 2,
      rect: { top: 100, left: 200, width: 50, height: 20 },
    });

    expect(document.body.contains(host)).toBe(true);
    expect(range.startContainer).toBe(textNode);
    expect(document.caretRangeFromPoint?.(10, 20)).toBe(range);

    const siblingRange = document.createRange();
    expect(siblingRange.getBoundingClientRect()).toMatchObject({
      top: 100,
      left: 200,
      right: 250,
      bottom: 120,
    });

    cleanupGlobalFixtures();

    expect(Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')).toEqual(originalCaretDescriptor);
    expect(Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')).toEqual(originalRangeDescriptor);
    host.remove();
  });

  it('mocks document.createRange and window.getSelection together for selection scenarios', () => {
    const originalCreateRange = Object.getOwnPropertyDescriptor(document, 'createRange');
    const originalGetSelection = Object.getOwnPropertyDescriptor(window, 'getSelection');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Selected text here';
    document.body.appendChild(paragraph);
    const textNode = paragraph.firstChild as Text;

    const { range } = createMockRange({
      startContainer: textNode,
      startOffset: 0,
      endContainer: textNode,
      endOffset: 8,
      rect: { top: 8, left: 16, width: 80, height: 24 },
    });
    mockDocumentCreateRange(range);
    setupSelectionMock({
      range,
      text: 'Selected',
      isCollapsed: false,
    });

    expect(document.createRange()).toBe(range);
    const selection = window.getSelection();
    expect(selection?.toString()).toBe('Selected');
    expect(selection?.getRangeAt(0)).toBe(range);

    cleanupGlobalFixtures();

    expect(Object.getOwnPropertyDescriptor(document, 'createRange')).toEqual(originalCreateRange);
    expect(Object.getOwnPropertyDescriptor(window, 'getSelection')).toEqual(originalGetSelection);
    paragraph.remove();
  });

  it('supports dynamic caret range factories', () => {
    const firstRange = document.createRange();
    const secondRange = document.createRange();
    let currentRange: Range | null = firstRange;

    const { caretRangeFromPointMock } = mockCaretRangeFromPoint(() => currentRange);

    expect(document.caretRangeFromPoint?.(1, 2)).toBe(firstRange);
    currentRange = secondRange;
    expect(document.caretRangeFromPoint?.(3, 4)).toBe(secondRange);
    expect(caretRangeFromPointMock).toHaveBeenCalledTimes(2);
  });
});
