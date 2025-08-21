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
    window.qwenTranslateBatch = jest.fn(async () => ({ texts: [] }));
    window.qwenLoadConfig = async () => ({ autoTranslate: true, debug: false });
    window.qwenSetTokenBudget = jest.fn();
    window.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
    Element.prototype.getClientRects = () => [1];
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    document.body.innerHTML = '<p>hello</p>';
  });

  test('translation waits until tab is visible', async () => {
    jest.useFakeTimers();
    require('../src/contentScript.js');
    await jest.runOnlyPendingTimersAsync();
    expect(window.qwenTranslateBatch).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false });
    Object.defineProperty(document, 'visibilityState', { value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await jest.runOnlyPendingTimersAsync();
    expect(window.qwenTranslateBatch).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
