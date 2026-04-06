import { describe, expect, it, vi } from 'vitest';

import { createStreamPortHandler, createStreamPortSender } from './stream-port-handler';

function createLogger() {
  return {
    debug: vi.fn(),
  };
}

function createStreamPort(name = 'translate-stream') {
  let messageListener: ((message: Record<string, unknown>) => Promise<void> | void) | undefined;
  let disconnectListener: (() => void) | undefined;
  const postMessage = vi.fn();

  const port = {
    name,
    postMessage,
    onMessage: {
      addListener: vi.fn((listener) => {
        messageListener = listener;
      }),
    },
    onDisconnect: {
      addListener: vi.fn((listener) => {
        disconnectListener = listener;
      }),
    },
  };

  return {
    port,
    async start(message: Record<string, unknown>) {
      await messageListener?.(message);
    },
    disconnect() {
      disconnectListener?.();
    },
    postMessage,
  };
}

describe('stream-port-handler', () => {
  it('stops sending once the port disconnects', () => {
    const stream = createStreamPort();
    const logger = createLogger();
    const postToStream = createStreamPortSender(
      stream.port as unknown as chrome.runtime.Port,
      logger
    );

    expect(postToStream({ type: 'chunk', partial: 'first' })).toBe(true);
    stream.disconnect();
    expect(postToStream({ type: 'chunk', partial: 'second' })).toBe(false);
    expect(stream.postMessage).toHaveBeenCalledTimes(1);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs and stops sending when postMessage throws', () => {
    const stream = createStreamPort();
    const logger = createLogger();
    stream.postMessage.mockImplementation(() => {
      throw new Error('Port closed');
    });

    const postToStream = createStreamPortSender(
      stream.port as unknown as chrome.runtime.Port,
      logger
    );

    expect(postToStream({ type: 'chunk', partial: 'first' })).toBe(false);
    expect(postToStream({ type: 'chunk', partial: 'second' })).toBe(false);
    expect(stream.postMessage).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      'Stream port closed before message delivery:',
      expect.any(Error)
    );
  });

  it('ignores unrelated runtime ports', () => {
    const handleTranslate = vi.fn();
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate,
      acquireKeepAlive: vi.fn(),
      releaseKeepAlive: vi.fn(),
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort('not-translate-stream');
    handler(stream.port as unknown as chrome.runtime.Port);

    expect(stream.port.onMessage.addListener).not.toHaveBeenCalled();
  });

  it('ignores unrelated port messages after attaching the stream listener', async () => {
    const handleTranslate = vi.fn();
    const acquireKeepAlive = vi.fn();
    const releaseKeepAlive = vi.fn();
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate,
      acquireKeepAlive,
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({ type: 'noop' });

    expect(handleTranslate).not.toHaveBeenCalled();
    expect(acquireKeepAlive).not.toHaveBeenCalled();
    expect(releaseKeepAlive).not.toHaveBeenCalled();
    expect(stream.postMessage).not.toHaveBeenCalled();
  });

  it('reports missing required fields without acquiring keep-alive', async () => {
    const acquireKeepAlive = vi.fn();
    const releaseKeepAlive = vi.fn();
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate: vi.fn(),
      acquireKeepAlive,
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({ type: 'startStream', text: 'missing target', sourceLang: 'en' });

    expect(acquireKeepAlive).not.toHaveBeenCalled();
    expect(releaseKeepAlive).not.toHaveBeenCalled();
    expect(stream.postMessage).toHaveBeenCalledWith({ type: 'error', error: 'Missing required fields' });
  });

  it('keeps translations alive while handling a normal stream request', async () => {
    const acquireKeepAlive = vi.fn();
    const releaseKeepAlive = vi.fn();
    const handleTranslate = vi.fn().mockResolvedValue({ success: true, result: 'translated stream result' });
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate,
      acquireKeepAlive,
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({
      type: 'startStream',
      text: 'Hello stream',
      sourceLang: 'en',
      targetLang: 'fi',
    });

    expect(acquireKeepAlive).toHaveBeenCalledTimes(1);
    expect(releaseKeepAlive).toHaveBeenCalledTimes(1);
    expect(handleTranslate).toHaveBeenCalledWith({
      text: 'Hello stream',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
    });
    expect(stream.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'chunk',
      partial: 'translated stream result',
    });
    expect(stream.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'done',
      result: 'translated stream result',
    });
  });

  it('normalizes single-item array responses before streaming them', async () => {
    const releaseKeepAlive = vi.fn();
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate: vi.fn().mockResolvedValue({
        success: true,
        result: ['translated stream result'],
      }),
      acquireKeepAlive: vi.fn(),
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({
      type: 'startStream',
      text: 'Hello stream',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
    });

    expect(stream.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'chunk',
      partial: 'translated stream result',
    });
    expect(stream.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'done',
      result: 'translated stream result',
    });
    expect(releaseKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('reports an explicit error when a stream translation returns multiple results', async () => {
    const releaseKeepAlive = vi.fn();
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate: vi.fn().mockResolvedValue({
        success: true,
        result: ['first', 'second'],
      }),
      acquireKeepAlive: vi.fn(),
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({
      type: 'startStream',
      text: 'Hello stream',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
    });

    expect(stream.postMessage).toHaveBeenCalledWith({
      type: 'error',
      error: 'Stream translation returned 2 result(s) for 1 input text(s)',
    });
    expect(releaseKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('streams chrome built-in sentences progressively and skips empty sentences', async () => {
    const acquireKeepAlive = vi.fn();
    const releaseKeepAlive = vi.fn();
    const handleTranslate = vi
      .fn()
      .mockResolvedValueOnce({ success: true, result: 'Hei' })
      .mockResolvedValueOnce({ success: true, result: 'maailma' });
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate,
      acquireKeepAlive,
      releaseKeepAlive,
      splitIntoSentences: () => ['Hello', '', 'world'],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({
      type: 'startStream',
      text: 'Hello world',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'chrome-builtin',
    });

    expect(handleTranslate).toHaveBeenCalledTimes(2);
    expect(handleTranslate).toHaveBeenNthCalledWith(1, {
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'chrome-builtin',
    });
    expect(handleTranslate).toHaveBeenNthCalledWith(2, {
      text: 'world',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'chrome-builtin',
    });
    expect(stream.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'chunk',
      partial: 'Hei',
    });
    expect(stream.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'chunk',
      partial: 'Hei  maailma',
    });
    expect(stream.postMessage).toHaveBeenNthCalledWith(3, {
      type: 'done',
      result: 'Hei  maailma',
    });
    expect(acquireKeepAlive).toHaveBeenCalledTimes(1);
    expect(releaseKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('reports translation failures as stream errors', async () => {
    const releaseKeepAlive = vi.fn();
    const handler = createStreamPortHandler({
      getProvider: () => 'chrome-builtin',
      handleTranslate: vi.fn().mockResolvedValue({ success: false, error: 'Translation failed upstream' }),
      acquireKeepAlive: vi.fn(),
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({
      type: 'startStream',
      text: 'Hello stream',
      sourceLang: 'en',
      targetLang: 'fi',
    });

    expect(stream.postMessage).toHaveBeenCalledWith({
      type: 'error',
      error: 'Translation failed upstream',
    });
    expect(releaseKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('uses the default translation failed message when the provider returns no error text', async () => {
    const releaseKeepAlive = vi.fn();
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate: vi.fn().mockResolvedValue({ success: false }),
      acquireKeepAlive: vi.fn(),
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({
      type: 'startStream',
      text: 'Hello stream',
      sourceLang: 'en',
      targetLang: 'fi',
    });

    expect(stream.postMessage).toHaveBeenCalledWith({
      type: 'error',
      error: 'Translation failed',
    });
    expect(releaseKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('stops chrome built-in streaming when chunk delivery closes mid-stream', async () => {
    const logger = createLogger();
    const releaseKeepAlive = vi.fn();
    const stream = createStreamPort();
    stream.postMessage.mockImplementationOnce(() => {
      throw new Error('Port closed');
    });

    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate: vi.fn().mockResolvedValue({ success: true, result: 'Hei' }),
      acquireKeepAlive: vi.fn(),
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: logger,
    });

    handler(stream.port as unknown as chrome.runtime.Port);

    await stream.start({
      type: 'startStream',
      text: 'Hello stream',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'chrome-builtin',
    });

    expect(stream.postMessage).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      'Stream port closed before message delivery:',
      expect.any(Error)
    );
    expect(releaseKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('stops streaming cleanly when the port closes before chunk delivery', async () => {
    const releaseKeepAlive = vi.fn();
    const handler = createStreamPortHandler({
      getProvider: () => 'opus-mt',
      handleTranslate: vi.fn().mockResolvedValue({ success: true, result: 'translated stream result' }),
      acquireKeepAlive: vi.fn(),
      releaseKeepAlive,
      splitIntoSentences: (text) => [text],
      log: createLogger(),
    });

    const stream = createStreamPort();
    handler(stream.port as unknown as chrome.runtime.Port);

    stream.postMessage.mockImplementation(() => {
      stream.disconnect();
      throw new Error('Port closed');
    });

    await expect(stream.start({
      type: 'startStream',
      text: 'Hello stream',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
    })).resolves.toBeUndefined();

    expect(stream.postMessage).toHaveBeenCalledTimes(1);
    expect(stream.postMessage).toHaveBeenCalledWith({
      type: 'chunk',
      partial: 'translated stream result',
    });
    expect(releaseKeepAlive).toHaveBeenCalledTimes(1);
  });
});
