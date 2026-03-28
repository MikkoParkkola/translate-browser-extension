import { describe, expect, it, vi } from 'vitest';

import { createStreamPortHandler } from './stream-port-handler';

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
