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

type MockRangeRectOptions = {
  rect?: Partial<DOMRect>;
  fixtureKey?: string;
  target?: Range | typeof Range.prototype;
};

type CreateMockRangeOptions = {
  startContainer?: Node;
  startOffset?: number;
  endContainer?: Node;
  endOffset?: number;
  rect?: Partial<DOMRect>;
  rectTarget?: Range | typeof Range.prototype;
  fixtureKey?: string;
};

type MockSelectionOptions = {
  range?: Range | null;
  text?: string;
  isCollapsed?: boolean;
  rangeCount?: number;
  anchorNode?: Node | null;
  focusNode?: Node | null;
  selection?: Partial<Selection>;
  fixtureKey?: string;
};

type SetupCaretRangeFromTextOptions = {
  hostTag?: keyof HTMLElementTagNameMap;
  startOffset?: number;
  endOffset?: number;
  rect?: Partial<DOMRect>;
  fixtureKeyPrefix?: string;
};

let domMockFixtureSequence = 0;

function nextFixtureKey(prefix: string) {
  domMockFixtureSequence += 1;
  return `${prefix}.${domMockFixtureSequence}`;
}

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

export function mockRangeBoundingClientRect(options: MockRangeRectOptions = {}) {
  const rect = createDomRect(options.rect);
  const target = options.target ?? Range.prototype;
  const restore = overrideProperty(target, 'getBoundingClientRect', {
    value: () => rect,
  }, {
    fixtureKey: options.fixtureKey ?? nextFixtureKey('range.getBoundingClientRect'),
  });

  return {
    rect,
    restore,
  };
}

export function createMockRange(options: CreateMockRangeOptions = {}) {
  const range = document.createRange();

  if (options.startContainer) {
    range.setStart(options.startContainer, options.startOffset ?? 0);
  }

  if (options.endContainer) {
    range.setEnd(options.endContainer, options.endOffset ?? 0);
  } else if (options.startContainer) {
    range.setEnd(options.startContainer, options.startOffset ?? 0);
  }

  const rectMock = options.rect
    ? mockRangeBoundingClientRect({
      rect: options.rect,
      target: options.rectTarget ?? range,
      fixtureKey: options.fixtureKey,
    })
    : null;

  return {
    range,
    rect: rectMock?.rect ?? null,
    restore: () => {
      rectMock?.restore();
    },
  };
}

export function mockCaretRangeFromPoint(
  rangeOrFactory: Range | null | ((x: number, y: number) => Range | null),
  fixtureKey = nextFixtureKey('document.caretRangeFromPoint'),
) {
  const caretRangeFromPointMock = vi.fn((x: number, y: number) =>
    typeof rangeOrFactory === 'function'
      ? rangeOrFactory(x, y)
      : rangeOrFactory
  );

  const restore = overrideProperty(document, 'caretRangeFromPoint', {
    value: caretRangeFromPointMock,
    writable: true,
  }, {
    fixtureKey,
  });

  return {
    caretRangeFromPointMock,
    restore,
  };
}

export function mockDocumentCreateRange(
  rangeOrFactory: Range | (() => Range),
  fixtureKey = nextFixtureKey('document.createRange'),
) {
  const createRangeMock = vi.fn(() =>
    typeof rangeOrFactory === 'function'
      ? rangeOrFactory()
      : rangeOrFactory
  );

  const restore = overrideProperty(document, 'createRange', {
    value: createRangeMock,
    writable: true,
  }, {
    fixtureKey,
  });

  return {
    createRangeMock,
    restore,
  };
}

export function mockWindowSelection(
  selectionOrFactory: Selection | null | (() => Selection | null),
  fixtureKey = nextFixtureKey('window.getSelection'),
) {
  const getSelectionMock = vi.fn(() =>
    typeof selectionOrFactory === 'function'
      ? selectionOrFactory()
      : selectionOrFactory
  );

  const restore = overrideProperty(window, 'getSelection', {
    value: getSelectionMock,
    writable: true,
  }, {
    fixtureKey,
  });

  return {
    getSelectionMock,
    restore,
  };
}

export function setupSelectionMock(options: MockSelectionOptions = {}) {
  const selection = {
    isCollapsed: options.isCollapsed ?? false,
    rangeCount: options.rangeCount ?? (options.range ? 1 : 0),
    toString: () => options.text ?? '',
    getRangeAt: vi.fn(() => {
      if (!options.range) {
        throw new Error('No mock range configured');
      }
      return options.range;
    }),
    anchorNode: options.anchorNode ?? options.range?.startContainer ?? null,
    focusNode: options.focusNode ?? options.range?.endContainer ?? null,
    ...options.selection,
  } as unknown as Selection;

  const selectionMock = mockWindowSelection(selection, options.fixtureKey);

  return {
    selection,
    getSelectionMock: selectionMock.getSelectionMock,
    restore: selectionMock.restore,
  };
}

export function setupCaretRangeFromText(text: string, options: SetupCaretRangeFromTextOptions = {}) {
  const host = document.createElement(options.hostTag ?? 'p');
  const textNode = document.createTextNode(text);
  host.appendChild(textNode);
  document.body.appendChild(host);

  const fallbackOffset = Math.floor(text.length / 2);
  const rangeMock = createMockRange({
    startContainer: textNode,
    startOffset: options.startOffset ?? fallbackOffset,
    endContainer: textNode,
    endOffset: options.endOffset ?? options.startOffset ?? fallbackOffset,
    rect: options.rect,
    rectTarget: Range.prototype,
    fixtureKey: options.fixtureKeyPrefix
      ? `${options.fixtureKeyPrefix}.rangeRect`
      : nextFixtureKey('hoverText.rangeRect'),
  });
  const caretRangeMock = mockCaretRangeFromPoint(
    rangeMock.range,
    options.fixtureKeyPrefix
      ? `${options.fixtureKeyPrefix}.caretRangeFromPoint`
      : nextFixtureKey('hoverText.caretRangeFromPoint'),
  );

  return {
    host,
    textNode,
    range: rangeMock.range,
    rect: rangeMock.rect,
    restore: () => {
      caretRangeMock.restore();
      rangeMock.restore();
      host.remove();
    },
  };
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
