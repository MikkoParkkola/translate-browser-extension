describe('ContentObserver coverage', () => {
  let OriginalIntersectionObserver;
  let OriginalMutationObserver;
  let ContentObserver;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    OriginalIntersectionObserver = global.IntersectionObserver;
    OriginalMutationObserver = global.MutationObserver;

    class FakeIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        this.observe = jest.fn();
        this.disconnect = jest.fn();
      }
      trigger(entries) {
        this.callback(entries);
      }
    }

    class FakeMutationObserver {
      constructor(callback) {
        this.callback = callback;
        this.observe = jest.fn();
        this.disconnect = jest.fn();
      }
    }

    global.IntersectionObserver = FakeIntersectionObserver;
    global.MutationObserver = FakeMutationObserver;
    if (window.ContentObserver) delete window.ContentObserver;
    if (global.ContentObserver) delete global.ContentObserver;

    document.body.innerHTML = `
      <div id="root">
        <p id="visible">Hello World</p>
        <p id="code">functionCall()</p>
        <p id="hidden" style="display:none">Hidden text</p>
      </div>
    `;

    jest.isolateModules(() => {
      require('../src/lib/contentObserver.js');
    });
    ContentObserver = window.ContentObserver;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (OriginalIntersectionObserver) {
      global.IntersectionObserver = OriginalIntersectionObserver;
    } else {
      delete global.IntersectionObserver;
    }
    if (OriginalMutationObserver) {
      global.MutationObserver = OriginalMutationObserver;
    } else {
      delete global.MutationObserver;
    }
  });

  test('collects nodes, batches, and reacts to visibility', () => {
    const newContent = jest.fn();
    const observer = new ContentObserver(newContent, { batchDelay: 1, maxBatchSize: 5, processHiddenContent: true });

    const root = document.getElementById('root');
    const nodes = new Set();
    observer.collectTranslatableNodes(root, nodes);

    const visibleText = document.getElementById('visible').firstChild;
    const codeText = document.getElementById('code').firstChild;
    observer.isTranslatableTextNode(visibleText);
    observer.isTranslatableTextNode(codeText);
    expect(observer.isCodeOrUrl('https://example.com')).toBe(true);

    observer.addToBatch(new Set([visibleText]));
    jest.runAllTimers();
    expect(newContent).toHaveBeenCalled();

    const hiddenElement = document.getElementById('hidden');
    expect(observer.isElementHidden(hiddenElement)).toBe(true);

    // Trigger intersection updates
    const fake = observer.intersectionObserver;
    if (fake && typeof fake.trigger === 'function') {
      fake.trigger([{ target: hiddenElement, isIntersecting: true }]);
    }

    // Rescan existing content
    observer.scanExistingContent(root);

    observer.destroy();
    expect(observer.pendingNodes.size).toBe(0);
  });
});
