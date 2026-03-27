import { vi } from 'vitest';
import { registerGlobalFixture } from './global-fixture-registry';

type PropertyTarget = object;

type PropertyMockOptions = {
  fixtureKey?: string;
  writable?: boolean;
};

type MockCanvasElementOptions = {
  width?: number;
  height?: number;
  context?: CanvasRenderingContext2D | null;
  getContext?: (...args: Parameters<HTMLCanvasElement['getContext']>) => ReturnType<HTMLCanvasElement['getContext']>;
  toDataURL?: string | (() => string);
};

type MockImageOptions = {
  complete?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
  rect?: Partial<DOMRect>;
};

type ImageConstructorMockOptions = {
  outcome?: 'load' | 'error';
  naturalWidth?: number;
  naturalHeight?: number;
  trigger?: 'microtask' | 'macrotask';
};

export function overrideProperty(
  target: PropertyTarget,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
  options: PropertyMockOptions = {},
) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(target, property);

  Object.defineProperty(target, property, {
    configurable: true,
    ...descriptor,
  });

  const restore = () => {
    if (originalDescriptor) {
      Object.defineProperty(target, property, originalDescriptor);
      return;
    }

    Reflect.deleteProperty(target, property);
  };

  if (options.fixtureKey) {
    registerGlobalFixture(options.fixtureKey, restore);
  }

  return restore;
}

export function mockPropertyValue(
  target: PropertyTarget,
  property: PropertyKey,
  value: unknown,
  options: PropertyMockOptions = {},
) {
  return overrideProperty(
    target,
    property,
    {
      value,
      writable: options.writable ?? true,
    },
    options,
  );
}

export function setupNavigatorGpuMock(gpu: unknown) {
  return mockPropertyValue(globalThis.navigator, 'gpu', gpu, {
    fixtureKey: 'navigator.gpu',
  });
}

export function setupNavigatorMlMock(ml: unknown) {
  return mockPropertyValue(globalThis.navigator, 'ml', ml, {
    fixtureKey: 'navigator.ml',
  });
}

export function createDomRect(rect: Partial<DOMRect> = {}): DOMRect {
  const left = rect.left ?? rect.x ?? 0;
  const top = rect.top ?? rect.y ?? 0;
  const width = rect.width ?? ((rect.right ?? left) - left);
  const height = rect.height ?? ((rect.bottom ?? top) - top);
  const right = rect.right ?? left + width;
  const bottom = rect.bottom ?? top + height;
  const x = rect.x ?? left;
  const y = rect.y ?? top;

  return {
    x,
    y,
    top,
    left,
    right,
    bottom,
    width,
    height,
    toJSON: () => ({
      x,
      y,
      top,
      left,
      right,
      bottom,
      width,
      height,
    }),
  } as DOMRect;
}

export function createLoadedImage(src: string, options: MockImageOptions = {}) {
  const image = document.createElement('img');
  const naturalWidth = options.naturalWidth ?? 200;
  const naturalHeight = options.naturalHeight ?? 100;
  const rect = createDomRect({
    width: naturalWidth,
    height: naturalHeight,
    ...options.rect,
  });

  image.src = src;
  mockPropertyValue(image, 'complete', options.complete ?? true);
  mockPropertyValue(image, 'naturalWidth', naturalWidth);
  mockPropertyValue(image, 'naturalHeight', naturalHeight);
  overrideProperty(image, 'getBoundingClientRect', {
    value: () => rect,
  });

  return image;
}

export function injectLoadedImage(src: string, options: MockImageOptions = {}) {
  const image = createLoadedImage(src, options);
  document.body.appendChild(image);
  return image;
}

export function mockCanvasElement(options: MockCanvasElementOptions = {}) {
  const defaultContext = {
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const createdCanvases: HTMLCanvasElement[] = [];
  const realCreateElement = document.createElement.bind(document);

  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((
    (tagName: string, elementOptions?: ElementCreationOptions) => {
      if (tagName.toLowerCase() !== 'canvas') {
        return realCreateElement(tagName, elementOptions as never);
      }

      const canvas = realCreateElement('canvas') as HTMLCanvasElement;
      canvas.width = options.width ?? 0;
      canvas.height = options.height ?? 0;

      const getContext = options.getContext
        ?? (() => (options.context === undefined ? defaultContext : options.context));
      const toDataUrlImpl = (): string => {
        if (typeof options.toDataURL === 'function') {
          return options.toDataURL();
        }

        return options.toDataURL ?? 'data:image/png;base64,TEST';
      };

      vi.spyOn(canvas, 'getContext').mockImplementation((
        (...args: Parameters<HTMLCanvasElement['getContext']>) => getContext(...args)
      ) as HTMLCanvasElement['getContext']);
      vi.spyOn(canvas, 'toDataURL').mockImplementation(() => toDataUrlImpl());

      createdCanvases.push(canvas);
      return canvas;
    }
  ) as unknown as typeof document.createElement);

  registerGlobalFixture('document.createElement.canvas', () => {
    createElementSpy.mockRestore();
  });

  return {
    createElementSpy,
    createdCanvases,
    defaultContext,
  };
}

export function setupImageConstructorMock(options: ImageConstructorMockOptions = {}) {
  const schedule = (callback: () => void) => {
    if (options.trigger === 'macrotask') {
      setTimeout(callback, 0);
      return;
    }

    Promise.resolve().then(callback);
  };

  class MockImage {
    onload: ((event?: Event) => void) | null = null;
    onerror: ((event?: Event) => void) | null = null;
    crossOrigin = '';
    naturalWidth = options.naturalWidth ?? 200;
    naturalHeight = options.naturalHeight ?? 100;
    currentSrc = '';

    get src() {
      return this.currentSrc;
    }

    set src(value: string) {
      this.currentSrc = value;
      schedule(() => {
        if (options.outcome === 'error') {
          this.onerror?.(new Event('error'));
          return;
        }

        this.onload?.(new Event('load'));
      });
    }
  }

  const restore = mockPropertyValue(globalThis, 'Image', MockImage as unknown as typeof Image, {
    fixtureKey: 'global.Image',
  });

  return {
    MockImage,
    restore,
  };
}
