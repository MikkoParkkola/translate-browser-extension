// @jest-environment jsdom

describe('content script auto-translate visibility', () => {
  beforeEach(() => {
    jest.resetModules();
    const sendMessage = jest.fn();
    global.chrome = {
      runtime: {
        sendMessage,
        getURL: () => 'chrome-extension://abc/',
        onMessage: { addListener: () => {} },
      },
    };
    
    // Mock location for contentScript.js - jsdom already provides location
    // Just need to ensure it has the right href
    console.log('location.href before:', location.href);
    // Test will work with jsdom's default location
    window.qwenTranslateBatch = jest.fn(async () => ({ texts: [] }));
    window.qwenLoadConfig = async () => ({ autoTranslate: true, debug: false });
    window.qwenSetTokenBudget = jest.fn();
    
    // Add debug hooks to trace batching flow
    global.originalSetTimeout = setTimeout;
    global.setTimeout = jest.fn((fn, ms) => {
      if (typeof fn === 'function') {
        // Execute setTimeout callbacks immediately for faster testing
        return originalSetTimeout(() => fn(), 0);
      }
      return originalSetTimeout(fn, ms);
    });
    
    // Override requestIdleCallback for immediate execution
    window.requestIdleCallback = jest.fn((callback, options) => {
      originalSetTimeout(callback, 0);
    });
    
    // Mock the DOM optimizer to avoid script loading issues
    window.qwenDOMOptimizer = {
      replaceText: jest.fn(),
      batchReplace: jest.fn(),
      batchTranslate: jest.fn()
    };
    // Add debug logging for prefetching
    let prefetchCallCount = 0;
    window.prefetchNodesMock = (original) => {
      return function(...args) {
        prefetchCallCount++;
        console.log(`prefetchNodes called with ${args[0]?.length} nodes`);
        return original.apply(this, args);
      };
    };
    window.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
    Element.prototype.getClientRects = () => [1];
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    document.body.innerHTML = '<p>hello world this should be long enough to translate</p>';
    
  });

  test('translation waits until tab is visible', async () => {
    const originalLoadConfig = window.qwenLoadConfig;
    window.qwenLoadConfig = jest.fn(async () => ({ autoTranslate: true, debug: false }));
    
    // Use real timers to avoid complex timing issues
    require('../src/contentScript.js');
    
    // Wait for async initialization to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Add debug logging
    console.log('After loading contentScript.js and waiting');
    console.log('Document body content:', document.body.innerHTML);
    console.log('Document hidden:', document.hidden);
    console.log('qwenLoadConfig calls:', window.qwenLoadConfig.mock.calls.length);
    console.log('window.qwenTranslateBatch calls so far:', window.qwenTranslateBatch.mock.calls.length);
    
    // Initial state - should not translate while hidden
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(window.qwenTranslateBatch).not.toHaveBeenCalled();
    
    // Make document visible and dispatch event
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    console.log('Before visibilitychange event - Document hidden:', document.hidden);
    document.dispatchEvent(new Event('visibilitychange'));
    console.log('After visibilitychange event dispatched');
    
    // Allow async chain to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log('After 200ms wait - qwenTranslateBatch calls:', window.qwenTranslateBatch.mock.calls.length);
    
    expect(window.qwenTranslateBatch).toHaveBeenCalled();
    
    // Restore original
    window.qwenLoadConfig = originalLoadConfig;
  });
});
