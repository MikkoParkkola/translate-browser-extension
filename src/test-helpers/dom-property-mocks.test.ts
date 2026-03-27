import { describe, expect, it } from 'vitest';
import {
  createLoadedImage,
  injectLoadedImage,
  mockCanvasElement,
  mockPropertyValue,
  setupImageConstructorMock,
  setupNavigatorGpuMock,
  setupNavigatorMlMock,
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
});
